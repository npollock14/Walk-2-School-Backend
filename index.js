const express = require("express");
const MongoClient = require("mongodb").MongoClient;
const cors = require("cors");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const path = require("path");
const ejs = require("ejs");
require("dotenv").config();

const MONGODB_URI = process.env.MONGODB_URI;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const DB_NAME = "app-data";
const COLLECTION_NAME = "users";
const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

let client;

async function connectToMongo() {
  try {
    client = await MongoClient.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    setTimeout(connectToMongo, 5000); // Attempt to reconnect after 5 seconds
  }
}

connectToMongo();

async function getUsersCollection() {
  if (!client || !client.topology.isConnected()) {
    await connectToMongo();
  }

  return client.db(DB_NAME).collection(COLLECTION_NAME);
}

// computes a sha256 hash for the given password
function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

// authenticate a user using the username and hashed password provided from the client
// return a session token that can be used to authenticate the user in the future
async function authenticate(username, password) {
  const usersCollection = await getUsersCollection();
  const user = await usersCollection.findOne({ username, password });
  if (!user) {
    return null;
  }
  const sessionToken = generateSessionToken();
  // put the session token in the database
  // put it in root of the user document under sessionInfo. Also include the expiration date - 7 days from now
  await usersCollection.updateOne(user, {
    $set: {
      sessionInfo: {
        sessionToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    },
  });
  return sessionToken;
}

// authenticate a user using the username and session token provided from the client
//make sure that the session token is valid and not expired
async function authenticateBySessionToken(username, sessionToken) {
  const usersCollection = await getUsersCollection();
  const user = await usersCollection.findOne({
    username,
    "sessionInfo.sessionToken": sessionToken,
  });
  if (!user) {
    return null;
  }
  const sessionInfo = user.sessionInfo;
  if (sessionInfo.expiresAt < new Date()) {
    return null;
  }
  return user;
}

async function createUser(username, password) {
  // make sure the username is unique
  // try to find a user with the same username
  const usersCollection = await getUsersCollection();

  const existingUser = await usersCollection.findOne({ username });
  if (existingUser) {
    return null;
  }

  // create a new user document
  const newUser = { username, password };

  // insert the new user into the database
  const result = await usersCollection.insertOne(newUser);

  return result.insertedId;
}

function generateSessionToken() {
  return crypto.randomBytes(20).toString("hex");
}

// authenticate a user using the username and hashed password provided from the client
app.post("/authenticate", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Missing username or password" });
  }

  const sessionToken = await authenticate(username, password);
  if (sessionToken) {
    res.status(200).json({ message: "Authenticated", sessionToken });
  } else {
    res.status(401).json({ message: "Invalid credentials" });
  }
});

var emailRegex =
  /^[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~](\.?[-!#$%&'*+\/0-9=?A-Z^_a-z`{|}~])*@[a-zA-Z0-9](-*\.?[a-zA-Z0-9])*\.[a-zA-Z](-?[a-zA-Z0-9])+$/;

function isEmailValid(email) {
  if (!email) return false;

  if (email.length > 254) return false;

  var valid = emailRegex.test(email);
  if (!valid) return false;

  // Further checking of some things regex can't handle
  var parts = email.split("@");
  if (parts[0].length > 64) return false;

  var domainParts = parts[1].split(".");
  if (
    domainParts.some(function (part) {
      return part.length > 63;
    })
  )
    return false;

  return true;
}

// create a new user account using the username and hashed password provided from the client
app.post("/create-account", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Missing username or password" });
  }

  // username must also be in email format
  if (!isEmailValid(username)) {
    return res.status(400).json({ message: "Invalid Username Format" });
  }

  const userId = await createUser(username, password);

  if (userId) {
    res.status(200).json({ message: "Account created" });
  } else {
    res.status(400).json({ message: "Username already exists" });
  }
});

function renderPasswordResetEmail(passwordResetLink) {
  return new Promise((resolve, reject) => {
    ejs.renderFile(
      "views/reset-password-email.ejs",
      { passwordResetLink },
      (err, html) => {
        if (err) {
          reject(err);
        } else {
          resolve(html);
        }
      }
    );
  });
}

// create a forgot password route
app.post("/forgot-password", async (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ message: "Missing username" });
  }

  const usersCollection = await getUsersCollection();

  const existingUser = await usersCollection.findOne({ username });
  if (!existingUser) {
    return res.status(400).json({ message: "Username does not exist" });
  }

  const token = crypto.randomBytes(20).toString("hex");
  const tokenExpiration = Date.now() + 15 * 60 * 1000; // 15 minutes

  const result = await usersCollection.updateOne(
    existingUser,
    {
      $set: {
        resetPasswordToken: token,
        resetPasswordExpires: tokenExpiration,
      },
    },
    { upsert: true }
  );

  const passwordResetLink = `https://walk-2-school-backend.vercel.app/reset-password?token=${token}`;
  const emailContent = await renderPasswordResetEmail(passwordResetLink);

  if (result.modifiedCount === 1) {
    const msg = {
      to: username,
      from: "walk2schoolteam@gmail.com",
      subject: "Password Reset - Walk to School",
      text: passwordResetLink,
      html: emailContent,
    };

    // console.log(msg);
    sentStatus = await sgMail.send(msg);
    // console.log(sentStatus);

    if (sentStatus[0].statusCode === 202) {
      res.status(200).json({ message: "Email sent" });
    } else {
      res.status(400).json({ message: "Error sending email" });
    }
  } else {
    console.log(result);
    res.status(400).json({ message: "Error modifying user" });
  }
});

// create a reset password route
app.post("/reset-password", async (req, res) => {
  let { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ message: "Missing token or password" });
  }

  if (password.length < 4) {
    return res
      .status(400)
      .json({ message: "Password must be at least 4 characters" });
  }

  const usersCollection = await getUsersCollection();

  const existingUser = await usersCollection.findOne({
    resetPasswordToken: token,
    resetPasswordExpires: { $gt: Date.now() },
  });

  if (!existingUser) {
    return res.status(400).json({ message: "Invalid token" });
  }

  // hash the password
  password = hashPassword(password);

  const result = await usersCollection.updateOne(
    existingUser,
    {
      $set: {
        password,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    },
    { upsert: true }
  );

  if (result.modifiedCount === 1) {
    res.status(200).json({ message: "Password reset" });
  } else {
    res.status(400).json({ message: "Error resetting password" });
  }
});

app.post("/get-data", async (req, res) => {
  const { username, sessionToken } = req.body;

  if (!username || !sessionToken) {
    return res
      .status(400)
      .json({ message: "Missing username or session token" });
  }

  const user = await authenticateBySessionToken(username, sessionToken);

  if (!user) {
    return res
      .status(400)
      .json({ message: "Invalid username or session token" });
  }

  // now we have a valid user, we can return their data at user.data
  // if no data exists, we can return an empty object
  res.status(200).json({ data: user.data || {} });
});

app.post("/set-data", async (req, res) => {
  const { username, sessionToken, data } = req.body;

  if (!username || !sessionToken || !data) {
    return res
      .status(400)
      .json({ message: "Missing username, session token, or data" });
  }

  const user = await authenticateBySessionToken(username, sessionToken);

  if (!user) {
    return res
      .status(400)
      .json({ message: "Invalid username or session token" });
  }

  const usersCollection = await getUsersCollection();

  const result = await usersCollection.updateOne(
    user,
    {
      $set: {
        data,
      },
    },
    { upsert: true }
  );

  if (result.modifiedCount === 1) {
    res.status(200).json({ message: "Data updated" });
  } else {
    res.status(400).json({ message: "Error updating data" });
  }
});

// serve a reset password html page for the user to enter their new password
app.get("/reset-password", async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ message: "Missing token" });
  }
  const usersCollection = await getUsersCollection();

  const existingUser = await usersCollection.findOne({
    resetPasswordToken: token,
    resetPasswordExpires: { $gt: Date.now() },
  });

  if (!existingUser) {
    return res.status(400).json({ message: "Invalid token" });
  }

  res.sendFile(path.join(__dirname, "reset-password.html"));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
