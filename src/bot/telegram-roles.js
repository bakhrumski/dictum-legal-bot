'use strict';

/**
 * Who a Telegram chat is, for the legal-question bot (2026-10-03).
 *
 * The admins table holds staff (master, lawyer, student) and platform
 * customers (role 'user') alike; a customer links Telegram with /link to keep
 * one account across the website and the bot. The message handler treated any
 * row with this chat's telegram_chat_id as an admin, so a linked customer was
 * told "siz admin sifatida ulangansiz" and their legal question was dropped,
 * while /me correctly showed "user". Staff routing now depends on an explicit
 * list of staff roles; an unknown or empty role is never staff.
 */

// Roles that work requests from the bot (notifications, respond_ buttons,
// typed answers). Mirrors the staff list the dashboard uses (server.js:
// a.role IN ('master', 'lawyer', 'student')).
const STAFF_ROLES = Object.freeze(['master', 'lawyer', 'student']);

const ROLE_LABELS = Object.freeze({ master: 'Admin', lawyer: 'Yurist', student: 'Student', user: 'Foydalanuvchi' });

function normalizeRole(role) {
  return typeof role === 'string' ? role.trim().toLowerCase() : '';
}

function isStaffRole(role) {
  return STAFF_ROLES.includes(normalizeRole(role));
}

function isMasterRole(role) {
  return normalizeRole(role) === 'master';
}

function roleLabel(role) {
  return ROLE_LABELS[normalizeRole(role)] || String(role || '—');
}

/** The platform account linked to this chat ({ id, full_name, username, role }) or null. */
async function getLinkedAccount(db, chatId) {
  const { rows } = await db.query(
    'SELECT id, full_name, username, role FROM admins WHERE telegram_chat_id = $1',
    [chatId]
  );
  return rows[0] || null;
}

/**
 * 'staff' or 'user': which path a chat's messages take. Only a staff role
 * routes to the staff path; a master in /testmode is routed as a user, and
 * goes back to staff when test mode ends.
 */
function chatRoute(account, { testMode = false } = {}) {
  if (!account || !isStaffRole(account.role)) return 'user';
  if (testMode && isMasterRole(account.role)) return 'user';
  return 'staff';
}

const PRODUCTION_APP_URL = 'https://juristai.uz';

function isProduction(env) {
  return env.NODE_ENV === 'production' || Boolean(env.RENDER);
}

function isLocalUrl(url) {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/|$)/iu.test(String(url || ''));
}

/**
 * The dashboard link in staff messages. DASHBOARD_URL, else APP_URL, else
 * https://juristai.uz in production (localhost:3000 only in development).
 * A bare origin gets /dashboard.html; a localhost value never reaches a
 * production message.
 */
function dashboardUrl(env = process.env) {
  const prod = isProduction(env);
  const candidates = [env.DASHBOARD_URL, env.APP_URL]
    .map(v => String(v || '').trim())
    .filter(v => /^https?:\/\//iu.test(v))
    .filter(v => !(prod && isLocalUrl(v)));
  const base = (candidates[0] || (prod ? PRODUCTION_APP_URL : 'http://localhost:3000')).replace(/\/+$/u, '');
  return /\/[^/]+\.html$/iu.test(new URL(base).pathname) ? base : `${base}/dashboard.html`;
}

module.exports = {
  STAFF_ROLES, ROLE_LABELS, normalizeRole, isStaffRole, isMasterRole, roleLabel,
  getLinkedAccount, chatRoute, dashboardUrl,
};
