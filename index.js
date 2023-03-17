const express = require("express");
const MongoClient = require("mongodb").MongoClient;
const cors = require("cors");
const bodyParser = require("body-parser");
require("dotenv").config();

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = "app-data";
const COLLECTION_NAME = "users";
const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(bodyParser.json());

async function authenticate(username, password) {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const collection = db.collection(COLLECTION_NAME);

  const user = await collection.findOne({ username, password });
  await client.close();

  return user;
}

async function createUser(username, password) {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const collection = db.collection(COLLECTION_NAME);

  // make sure the username is unique
  // try to find a user with the same username
  const existingUser = await collection.findOne({ username });
  if (existingUser) {
    return null;
  }

  // create a new user document
  const newUser = { username, password };

  // insert the new user into the database
  const result = await collection.insertOne(newUser);

  // close the database connection
  await client.close();

  return result.insertedId;
}

// authenticate a user using the username and hashed password provided from the client
app.post("/authenticate", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Missing username or password" });
  }

  const user = await authenticate(username, password);

  if (user) {
    res.status(200).json({ message: "Authenticated" });
  } else {
    res.status(401).json({ message: "Invalid credentials" });
  }
});

// create a new user account using the username and hashed password provided from the client
app.post("/create-account", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Missing username or password" });
  }

  // make sure that the username is greater than 3 characters and less than 20 and uses only letters and numbers
  if (
    username.length < 3 ||
    username.length > 20 ||
    !/^[a-zA-Z0-9]+$/.test(username)
  ) {
    return res.status(400).json({ message: "Invalid Username Format" });
  }

  const userId = await createUser(username, password);

  if (userId) {
    res.status(200).json({ message: "Account created" });
  } else {
    res.status(400).json({ message: "Username already exists" });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
