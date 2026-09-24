'use strict';

/**
 * Telegram webhook authentication.
 *
 * The webhook used to be mounted at `/webhook/${TELEGRAM_BOT_TOKEN}`. A bot
 * token is `<bot id>:<secret>`, and Express 5 (path-to-regexp 8) reads
 * everything after a `:` in a route as a parameter name — so the "secret"
 * part of the path matched any value up to its first `-`. Anyone who knew the
 * bot's public numeric id could post updates as any user, including a forged
 * `successful_payment`. The token was also written to the logs in full.
 *
 * Now:
 *   - the path is derived from a hash of the token: hex only, no `:`, and the
 *     token itself never appears in a URL or a log line;
 *   - Telegram is given a `secret_token` when the webhook is set, and every
 *     update must carry it back in `X-Telegram-Bot-Api-Secret-Token`, compared
 *     in constant time. A request without it is rejected before the bot sees
 *     it, whatever path it arrived on.
 *
 * TELEGRAM_WEBHOOK_SECRET may be set to rotate the secret without changing
 * the bot token; otherwise it is derived from the token.
 */

const crypto = require('crypto');

function digest(label, token) {
  return crypto.createHmac('sha256', String(token || '')).update(label).digest('hex');
}

/** URL path for the webhook: /webhook/tg/<32 hex chars>. */
function webhookPath(token) {
  return `/webhook/tg/${digest('juristai-webhook-path', token).slice(0, 32)}`;
}

/**
 * The secret Telegram echoes in X-Telegram-Bot-Api-Secret-Token.
 * Telegram allows 1-256 characters of A-Z a-z 0-9 _ -.
 */
function webhookSecret(token, override = process.env.TELEGRAM_WEBHOOK_SECRET) {
  const configured = String(override || '').trim();
  if (configured && /^[A-Za-z0-9_-]{1,256}$/.test(configured)) return configured;
  return digest('juristai-webhook-secret', token).slice(0, 64);
}

/** Constant-time check of the header Telegram sends with each update. */
function isTelegramRequest(headerValue, secret) {
  if (typeof headerValue !== 'string' || !secret) return false;
  const given = Buffer.from(headerValue);
  const expected = Buffer.from(secret);
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(given, expected);
}

/** A webhook URL safe to log: host and path only, never the token. */
function describeWebhook(domain, token) {
  return `https://${domain}${webhookPath(token)}`;
}

module.exports = { webhookPath, webhookSecret, isTelegramRequest, describeWebhook };
