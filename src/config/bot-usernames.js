'use strict';

/**
 * Telegram bot usernames. Production uses @yuristga_savolbot (legal answers)
 * and @juristAI_registration_bot (sign-in, OTP, recovery). A staging service
 * runs its own test bots, so deep links, "open the bot" buttons and the
 * token check must name those instead: set LEGAL_BOT_USERNAME and
 * REG_BOT_USERNAME (without @). Unset means production, as before.
 */
function clean(v, fallback) {
  const s = String(v || '').trim().replace(/^@/, '');
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(s) ? s : fallback;
}

const LEGAL_BOT_USERNAME = clean(process.env.LEGAL_BOT_USERNAME, 'yuristga_savolbot');
const AUTH_BOT_USERNAME = clean(process.env.REG_BOT_USERNAME, 'juristAI_registration_bot');

module.exports = { LEGAL_BOT_USERNAME, AUTH_BOT_USERNAME, clean };
