// Shared in-memory store for Telegram verification codes
// Used by both server.js and bot.js
// Key: token (random hex), Value: { code, expiresAt, sentAt }
const verificationTokens = new Map();

module.exports = { verificationTokens };
