// bot.js
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const moment = require("moment");

// Get bot token from environment
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Create bot instance (using polling mode)
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// In-memory storage
let userLinks = {};       // username => link count
let userVideos = new Set();
let unsafeUsers = new Set();
let activityStarted = false;

// In-memory user ID map (username => numeric ID)
let userIdMap = {};

// Helper function: Parse duration strings like "10m", "2h", etc.
function parseDuration(durationText) {
  const match = durationText.match(/(\d+)([smhd])$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "s":
      return value;
    case "m":
      return value * 60;
    case "h":
      return value * 3600;
    case "d":
      return value * 86400;
    default:
      return null;
  }
}

// Check if user is admin using getChatMember
async function isAdmin(chatId, userId) {
  try {
    const member = await bot.getChatMember(chatId, userId);
    return ["administrator", "creator"].includes(member.status);
  } catch (err) {
    console.error(err);
    return false;
  }
}

// Helper: Look up a user ID by username (normalized to lowercase)
async function getUserIdByUsername(username) {
  return userIdMap[username.toLowerCase()] || null;
}

// --------------------------------------
// Command Handlers
// --------------------------------------

// /start_count command
bot.onText(/\/start_count(?:@\w+)?/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(chatId, userId))) {
    bot.sendMessage(chatId, "Only VED and admins can use this command.");
    return;
  }
  userLinks = {}; // reset
  activityStarted = true;
  bot.sendMessage(chatId, `Total Users Sent Links: 0\nTotal Links: 0`);
});

// /show_count command
bot.onText(/\/show_count(?:@\w+)?/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(chatId, userId))) {
    bot.sendMessage(chatId, "Only VED and admins can use this command.");
    return;
  }
  const totalUsers = Object.keys(userLinks).length;
  const totalLinks = totalUsers * 2;
  bot.sendMessage(chatId, `Total Users Sent Links: ${totalUsers}\nTotal Links: ${totalLinks}`);
});

// /start_activity command
bot.onText(/\/start_activity(?:@\w+)?/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(chatId, userId))) {
    bot.sendMessage(chatId, "Only VED and admins can use this command.");
    return;
  }
  activityStarted = true;
  bot.sendMessage(chatId, "Start your activities and send your SR with a caption 'AD' or 'Done'.");
});

// /verify command
bot.onText(/\/verify(?:@\w+)?/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(chatId, userId))) {
    bot.sendMessage(chatId, "Only VED and admins can use this command.");
    return;
  }
  unsafeUsers = new Set();
  let chatAdmins = [];
  try {
    const admins = await bot.getChatAdministrators(chatId);
    chatAdmins = admins.map((admin) => admin.user.username).filter(Boolean);
  } catch (err) {
    console.error(err);
  }
  // Anyone who hasn't posted a video but has posted links is unsafe.
  Object.keys(userLinks).forEach((user) => {
    if (!userVideos.has(user) && !chatAdmins.includes(user)) {
      unsafeUsers.add(user);
    }
  });
  if (unsafeUsers.size > 0) {
    const unsafeList = Array.from(unsafeUsers)
      .map((user, i) => `${i + 1}. @${user}`)
      .join("\n");
    bot.sendMessage(chatId, `Unsafe list:\n${unsafeList}`);
  } else {
    bot.sendMessage(chatId, "Cheers! Everyone is SAFE.");
  }
});

// /clear command
bot.onText(/\/clear(?:@\w+)?/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!(await isAdmin(chatId, userId))) {
    bot.sendMessage(chatId, "Only VED and admins can use this command.");
    return;
  }
  userLinks = {};
  userVideos = new Set();
  unsafeUsers = new Set();
  activityStarted = false;
  bot.sendMessage(chatId, "Cleared all data. Ready for a new session.");
});

// /mute command: Supports /mute @username [duration]
// Default duration is now 48 hours.
bot.onText(/\/mute(?:@\w+)?\s+(@\S+)(?:\s+(\d+[smhd]))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const adminUserId = msg.from.id;
  if (!(await isAdmin(chatId, adminUserId))) {
    bot.sendMessage(chatId, "Only VED and admins can use this command.");
    return;
  }

  // match[1] is the target username (with @), match[2] is an optional duration.
  let targetUsername = match[1].substring(1).toLowerCase(); // remove the '@'
  // Default mute duration: 48 hours.
  let durationStr = match[2] || "48h";
  let muteSeconds = parseDuration(durationStr) || 48 * 3600;

  // Look up the user ID from our in-memory map.
  let targetUserId = await getUserIdByUsername(targetUsername);
  if (!targetUserId) {
    bot.sendMessage(
      chatId,
      `Unable to locate @${targetUsername} in our records. Ensure the user has interacted with the bot recently.`
    );
    return;
  }

  // Check if the target is an admin.
  try {
    const member = await bot.getChatMember(chatId, targetUserId);
    if (["administrator", "creator"].includes(member.status)) {
      bot.sendMessage(chatId, `Cannot mute @${targetUsername} (Admin).`);
      return;
    }
  } catch (err) {
    bot.sendMessage(chatId, `Error retrieving user info: ${err.message}`);
    return;
  }

  const muteUntil = moment().add(muteSeconds, "seconds").unix();
  try {
    await bot.restrictChatMember(chatId, targetUserId, {
      permissions: {
        can_send_messages: false,
        can_send_media_messages: false,
        can_send_polls: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
        can_change_info: false,
        can_invite_users: false,
        can_pin_messages: false,
      },
      until_date: muteUntil,
    });
    bot.sendMessage(chatId, `Muted @${targetUsername} for ${durationStr}.`);
  } catch (err) {
    bot.sendMessage(chatId, `Failed to mute @${targetUsername}: ${err.message}`);
  }
});

// --------------------------------------
// Message Handlers
// --------------------------------------

// Detect links in text messages and update user ID map.
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = (msg.from.username || `User-${userId}`).toLowerCase();
  // Update our user ID map for lookup later.
  userIdMap[username] = userId;

  if (activityStarted && msg.text && msg.text.includes("http")) {
    // Increment link count – if not present, default to 0 then increment.
    userLinks[username] = (userLinks[username] || 0) + 1;
  }
});

// Detect videos with required captions (using caption property)
bot.on("video", (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = (msg.from.username || `User-${userId}`).toLowerCase();
  if (activityStarted) {
    const captions = ["AD", "Ad", "aD", "Done", "done", "DONE", "ad", "All Done", "all done"];
    const videoCaption = msg.caption || "";
    if (captions.some((c) => videoCaption.toLowerCase().includes(c.toLowerCase()))) {
      userVideos.add(username);
    }
  }
});

module.exports = bot;
