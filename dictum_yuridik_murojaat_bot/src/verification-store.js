// Shared in-memory store for Telegram verification codes
// Used by both server.js and bot.js
const verificationCodes = new Map(); // key: cleaned_telegram_username, value: { code, token, expiresAt, sentAt }
const verificationTokens = new Map(); // key: token, value: cleaned_telegram_username (reverse lookup for deep links)

module.exports = { verificationCodes, verificationTokens };
