// Shared in-memory store for Telegram verification codes
// Used by both server.js and bot.js
// Key: token (random hex), Value: { code, expiresAt, sentAt }
const verificationTokens = new Map();

// Registration sessions for Telegram OTP flow
// Key: token (random hex), Value: { verified, telegramUserId, createdAt }
const regSessions = new Map();

module.exports = { verificationTokens, regSessions };
