// index.js
require("dotenv").config();
const express = require("express");
const bot = require("./bot");

const app = express();
const PORT = process.env.PORT || 3000;

// A simple route to confirm the service is running.
app.get("/", (req, res) => {
  res.send("Telegram Bot is running.");
});

// Start Express server
app.listen(PORT, () => {
  console.log(`Express server is running on port ${PORT}`);
});
