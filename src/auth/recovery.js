'use strict';

/**
 * A staff account's password reset through the link the auth bot sent to
 * that account's own Telegram chat (src/bot/auth-start.js, 2026-10-07).
 * The link is spent before any database work, so a replay or a parallel
 * request cannot use it twice. An ordinary account is refused here: it
 * signs in with Telegram and changes its password on the account page
 * after a fresh confirmation (src/auth/credentials.js). Every session of
 * the account ends; a master still gets the Telegram second factor at the
 * next sign-in (src/auth/login-routes.js).
 */

const bcrypt = require('bcryptjs');
const { validatePassword, BCRYPT_COST } = require('./credentials');

async function resetWithLink(pool, verificationTokens, token, newPassword, { now = Date.now() } = {}) {
  const key = 'pwreset_' + String(token || '');
  const pending = verificationTokens.get(key);
  if (!pending) return null; // not a reset link: the caller tries its legacy path
  verificationTokens.delete(key); // spent now, whatever happens next
  if (now > pending.expiresAt) return { status: 400, error: "Sessiya muddati o'tgan. Qayta urinib ko'ring." };
  const target = (await pool.query('SELECT id, role, username FROM admins WHERE id = $1', [pending.adminId])).rows[0];
  if (!target || target.role === 'user') {
    return { status: 403, code: 'USE_ACCOUNT_PAGE', error: "Telegram bilan kiring va «Kirish usullari» sahifasida parolni almashtiring." };
  }
  const v = validatePassword(newPassword, newPassword, target.username);
  if (v.error) return { status: 400, error: v.message, code: v.error };
  const hash = await bcrypt.hash(String(newPassword), BCRYPT_COST);
  await pool.query('UPDATE admins SET password = $1 WHERE id = $2', [hash, target.id]);
  await pool.query(`DELETE FROM user_sessions WHERE (sess->>'adminId') = $1::text`, [String(target.id)]);
  return { status: 200, success: true, adminId: target.id };
}

module.exports = { resetWithLink };
