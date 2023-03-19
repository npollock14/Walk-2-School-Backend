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

async function getUsersCollection() {
  const client = await MongoClient.connect(MONGODB_URI);
  return client.db(DB_NAME).collection(COLLECTION_NAME);
}

// computes a sha256 hash for the given password
function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

async function authenticate(username, password) {
  const usersCollection = await getUsersCollection();
  const user = await usersCollection.findOne({ username, password });

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
