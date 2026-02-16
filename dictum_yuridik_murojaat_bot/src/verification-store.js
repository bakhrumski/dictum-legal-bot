// Shared in-memory store for Telegram verification codes
// Used by both server.js and bot.js
const verificationCodes = new Map(); // key: cleaned_telegram_username, value: { code, expiresAt, sentAt }

module.exports = { verificationCodes };
