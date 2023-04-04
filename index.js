const express = require("express");
const MongoClient = require("mongodb").MongoClient;
const cors = require("cors");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const path = require("path");
const ejs = require("ejs");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
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
app.use(cookieParser());

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

async function getShopCollection() {
  if (!client || !client.topology.isConnected()) {
    await connectToMongo();
  }

  return client.db(DB_NAME).collection("shop");
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

async function authenticateRaw(username, password) {
  return await authenticate(username, hashPassword(password));
}

// authenticate a user using the username and session token provided from the client
//make sure that the session token is valid and not expired
async function authenticateBySessionToken(sessionToken) {
  const usersCollection = await getUsersCollection();
  const user = await usersCollection.findOne({
    "sessionInfo.sessionToken": sessionToken,
  });
  if (
    !user ||
    !user.sessionInfo ||
    !user.sessionInfo.sessionToken ||
    !user.sessionInfo.expiresAt
  ) {
    console.log("No user found");
    return null;
  }
  const sessionInfo = user.sessionInfo;
  if (sessionInfo.expiresAt < new Date()) {
    console.log("Session expired");
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

const ensureAdminPrivileges = async (req, res, next) => {
  const { sessionToken } = req.body;

  if (!sessionToken) {
    return res.status(400).json({ message: "Missing session token" });
  }

  const user = await authenticateBySessionToken(sessionToken);

  if (!user) {
    return res.status(400).json({ message: "Invalid session token" });
  }

  console.log("User privileges:", user.privileges);

  if (user.privileges !== "admin") {
    return res.status(403).json({ message: "Unauthorized" });
  }

  // Attach user object to the request for further use in the route handler
  req.user = user;
  next();
};

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

app.post("/authenticate-raw", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Missing username or password" });
  }

  const sessionToken = await authenticateRaw(username, password);
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
  const { sessionToken } = req.body;

  if (!sessionToken) {
    return res.status(400).json({ message: "Missing session token" });
  }

  const user = await authenticateBySessionToken(sessionToken);

  if (!user) {
    return res.status(400).json({ message: "Invalid session token" });
  }

  // now we have a valid user, we can return their data at user.data
  // if no data exists, we can return an empty object
  // userdata looks like: {data: { "key": "value", ... }}
  // Just send back the value of the data key, not the whole object

  let data = user.data || {};
  console.log(data);
  res.status(200).json(data);
});

app.post("/set-data", async (req, res) => {
  let { sessionToken, data } = req.body;

  // if data is a string, try to parse it as JSON
  // if it fails, return an error
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch (e) {
      console.log(e);
      console.log(data);
      return res.status(400).json({ message: "Invalid data format" });
    }
  }

  if (!sessionToken || !data) {
    return res.status(400).json({ message: "Missing session token, or data" });
  }

  const user = await authenticateBySessionToken(sessionToken);

  if (!user) {
    return res.status(400).json({ message: "Invalid session token" });
  }

  const usersCollection = await getUsersCollection();

  // Make a copy of the data object and delete the "privileges" attribute
  const allowedData = { ...data };
  delete allowedData.privileges;

  // Update the user data with only the allowed attributes
  const result = await usersCollection.updateOne(
    user,
    {
      $set: {
        data: allowedData,
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

// Create a rate limiter to allow a maximum of 10 requests per minute
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: "Too many requests from this IP, please try again later",
});

app.get("/leaderboard", limiter, async (req, res) => {
  try {
    const usersCollection = await getUsersCollection();

    // Find all users and sort them by their points in descending order
    const leaderboard = await usersCollection
      .find()
      .sort({ "data.currPoints": -1 })
      .toArray();

    // Create a new array with only the username and points fields
    const leaderboardData = leaderboard.map((user) => ({
      username: user.username.split("@")[0],
      points: !user.data || !user.data.currPoints ? 0 : user.data.currPoints,
    }));

    // Return the leaderboard data as JSON
    res.json(leaderboardData);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
});

app.post("/shop/items", async (req, res) => {
  const { sessionToken } = req.body;
  let criteria = { visible: true }; // Only show visible items in the shop

  if (sessionToken) {
    // try to authenticate the user
    const user = await authenticateBySessionToken(sessionToken);
    if (user) {
      // if the user is admin, show all items
      if (user.data && user.privileges === "admin") {
        criteria = {};
      }
    }
  }

  try {
    const shopCollection = await getShopCollection(); // Assuming you have already implemented this function
    const itemsCursor = shopCollection.find(criteria, {
      projection: {
        _id: 0,
        name: 1,
        price: 1,
        url: 1,
        quantity: 1,
        description: 1,
        visible: 1,
      },
    });
    const itemsArray = await itemsCursor.toArray();

    if (!itemsArray) {
      res
        .status(404)
        .json({ message: "Unable to retrieve items from the shop" });
    } else if (itemsArray.length === 0) {
      res.status(200).json([]);
    } else {
      res.status(200).json(itemsArray);
    }
  } catch (error) {
    console.error("Error retrieving items from the shop:", error);
    res.status(500).json({
      message: "An error occurred while retrieving items from the shop.",
    });
  }
});

//any other request, send the file
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

app.get("/home", (req, res) => {
  res.sendFile(path.join(__dirname, "home.html"));
});

app.get("/shop-status", (req, res) => {
  res.sendFile(path.join(__dirname, "shop-status.html"));
});

app.post("/get-user-info", async (req, res) => {
  const { sessionToken } = req.body;
  if (!sessionToken) {
    return res.status(400).json({ message: "Missing session token" });
  }

  const user = await authenticateBySessionToken(sessionToken);

  if (!user) {
    return res.status(400).json({ message: "Invalid session token" });
  }

  res.status(200).json({
    username: user.username,
    privileges: user.privileges,
  });
});

app.post("/add-listing", ensureAdminPrivileges, async (req, res) => {
  const { newListing } = req.body;
  const { name, price, url, quantity, description, visible } = newListing;

  try {
    if (!name || !price || !url || !quantity || !description) {
      console.error(
        "Missing required fields: ",
        name,
        price,
        url,
        quantity,
        description
      );
      return res.status(400).json({ message: "Missing required fields" });
    }

    const shopCollection = await getShopCollection();

    const result = await shopCollection.insertOne({
      name,
      price,
      url,
      quantity,
      description,
      visible,
    });

    if (result.acknowledged) {
      res.status(201).json({ message: "Listing added successfully" });
    } else {
      console.error("Failed to add listing: ", result);
      res.status(500).json({ message: "Failed to add listing" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/delete-listing/:name", ensureAdminPrivileges, async (req, res) => {
  try {
    const { name } = req.params;

    if (!name) {
      return res.status(400).json({ message: "Missing listing name" });
    }

    const shopCollection = await getShopCollection();

    const result = await shopCollection.deleteOne({ name });

    if (result.acknowledged) {
      res.status(200).json({ message: "Listing deleted successfully" });
    } else {
      res.status(404).json({ message: "Listing not found" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/update-listing", ensureAdminPrivileges, async (req, res) => {
  const { updatedListing } = req.body;

  if (!updatedListing) {
    return res.status(400).json({ message: "Missing updated listing data" });
  }

  try {
    const { name, price, url, quantity, description, visible } = updatedListing;

    if (!name || !price || !url || !quantity || !description) {
      console.error(
        "Missing required fields: ",
        name,
        price,
        url,
        quantity,
        description
      );
      return res.status(400).json({ message: "Missing required fields" });
    }

    const shopCollection = await getShopCollection();

    const result = await shopCollection.updateOne(
      { name },
      {
        $set: {
          price,
          url,
          quantity,
          description,
          visible,
        },
      }
    );

    if (result.acknowledged) {
      res.status(200).json({ message: "Listing updated successfully" });
    } else {
      res.status(404).json({ message: "Listing not found" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// also make sure scripts and css can be loaded
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, req.path));
});
