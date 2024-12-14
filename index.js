const express = require('express');
const { argv } = require("process");
const path = require("path");
const bodyParser = require("body-parser");
const SpotifyWebApi = require('spotify-web-api-node');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { type } = require('os');
//const { LocalStorage } = require('node-localstorage');


const uri = "mongodb+srv://shankarsoma:mongotest@cluster0.uim0o.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const databaseAndCollection = {db: "SpotiFinder", collection: "authentication"};
//const localStorage = new LocalStorage('./scratch');

require("dotenv").config({ path: path.resolve(__dirname, '.env') });

const app = express();
const port = process.env.PORT || 8000;

const client = new MongoClient(uri, {
    serverApi: ServerApiVersion.v1
});

const spotifyApi = new SpotifyWebApi({
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI
});

console.log(process.env.CLIENT_ID);
console.log(process.env.CLIENT_SECRET);
console.log(process.env.REDIRECT_URI);

let accessToken = null;
let user = null;
let artists = null;
let q = null;
let favorites = [];

let error = null;

// if (localStorage.getItem('user')) {
//     user = localStorage.getItem('user');
// }

// if (localStorage.getItem('favorites')) {
//     favorites = JSON.parse(localStorage.getItem('favorites')) || [];

// }

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());


app.set("views", path.resolve(__dirname, "public/templates"));
app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, 'public')));

app.listen(port, () => {
    console.log(`Server live :)`);
});

app.get("/", (req, res) => {
    res.render("index", { artists: artists, error: error, user: user, favorites: favorites });
});

app.get('/login', (req, res) => {
    const scopes = ['user-read-private', 'user-read-email'];
    const authorizeURL = spotifyApi.createAuthorizeURL(scopes);
    console.log(authorizeURL);
    res.redirect(authorizeURL);
});

app.get('/callback', async (req, res) => {
    const { code } = req.query;
    try {
        const data = await spotifyApi.authorizationCodeGrant(code);
        accessToken = data.body.access_token;
        //localStorage.setItem('accessToken', accessToken);

        spotifyApi.setAccessToken(accessToken);
        spotifyApi.setRefreshToken(data.body.refresh_token);

        setInterval(async () => {
            const refreshedData = await spotifyApi.refreshAccessToken();
            accessToken = refreshedData.body.access_token;
            //localStorage.setItem('accessToken', accessToken);
            spotifyApi.setAccessToken(accessToken);
        }, data.body.expires_in / 2 * 1000);

        res.redirect('/search');
    } catch (e) {
        console.error('Error during callback:', e);
        res.send('Error during callback: ' + e.message);
    }
});

app.get('/search', async (req, res) => {
    const { artist } = req.query;
    q = (artist) ? artist : q;

    if (!accessToken) {
        console.log('No access token found, trying to login');
        return res.redirect('/login');
    }

    try {
        const data = await spotifyApi.searchArtists(q);
        console.log(data.body.artists.items);
        const art = data.body.artists.items.map(artist => ({
            name: artist.name,
            genres: (artist.genres.length > 3) ? artist.genres.slice(0, 3) : artist.genres,
            image: artist.images[0]?.url,
            url: artist.external_urls.spotify,
            followers: artist.followers.total,
            type: artist.type
        }));

        artists = art;
        
        res.redirect('/');
    } catch (e) {
        console.error('Error during search (possibly due to invalid access token):', e);
        accessToken = null;
        res.redirect('/login');
    }
});

app.get('/signin', (req, res) => {
    res.render("signin", { error: null });
});

app.get('/signup', (req, res) => {
    res.render("signup", { error: null });
});

async function signIn(email, password) {
    try {
        await client.connect();
        console.log(email, password);
        const query = { email: email, password: password };
        const result = await client.db(databaseAndCollection.db).collection(databaseAndCollection.collection).findOne(query);
        console.log("RESULT: " + result);
        return result;
    } catch (e) {
        console.error(e);
    }
}

app.post('/processSignIn', async (req, res) => {
    const { email, password } = req.body;
    try {
        let result = await signIn(email, password);
        if (result) {
            user = { username: result.username, email: result.email, password: result.password };
            favorites = result.favorites;
            //localStorage.setItem('user', user);
            //localStorage.setItem('favorites', favorites);
            res.redirect('/');
        } else {
            res.render("signin", { error: 'Invalid email or password. Please try again.' });
        }
    } catch (e) {
        console.error('Error during sign in:', e);
        res.render("signin", { error: 'Error signing in. Please try again.' });
    }
});

async function signUp(username, email, password) {
    try {
        await client.connect();
        const query = { email: email };
        const result = await client.db(databaseAndCollection.db).collection(databaseAndCollection.collection).findOne(query);
        if (result) {
            return null;
        }
        
        const entry = { username: username, email: email, password: password, favorites: [] };
        const res = await client.db(databaseAndCollection.db).collection(databaseAndCollection.collection).insertOne(entry);
        return { username: username, email: email, password: password, favorites: []};
    } catch (e) {
        console.error(e);
    }
}

app.post('/processSignUp', async (req, res) => {
    const { username, email, password } = req.body;    
    try {
        let result = await signUp(username, email, password);
        if (!result) {
            res.render("signup", { error: 'Username already exists. Please try again.' });
        } else {
            user = result;
            //localStorage.setItem('user', user);
            //localStorage.setItem('favorites', []);
            res.redirect('/');
        }
    } catch (e) {
        console.error('Error during sign up:', e);
        res.render("signup", { error: 'Error signing up. Please try again.' });
    }
});

app.get('/signout', (req, res) => {
    user = null;
    favorites = [];
    //localStorage.removeItem('user');
    //localStorage.removeItem('favorites');
    //localStorage.removeItem('artists');
    res.redirect('/');
});

async function updateFavorites(favorites) {
    try {
        await client.connect();
        const query = { email: user.email, password: user.password };
        const newValues = { $set: { favorites: favorites } };
        const result = await client.db(databaseAndCollection.db).collection(databaseAndCollection.collection).updateOne(query, newValues);
        return result;
    } catch (e) {
        console.error(e);
    }
}

app.post('/addFav', async (req, res) => {
    if (!user) {
        return res.redirect('/signin');
    }

    const { name, image, url, genres, followers, type } = req.body;

    if (favorites.length > 0 && favorites.some(fav => fav.url === url)) {
        return res.redirect('/'); 
    }

    favorites.push({ name, image, url, genres, followers, type });
    updateFavorites(favorites);
    //localStorage.setItem('favorites', favorites);
    return res.redirect('/'); 
});