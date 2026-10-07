'use strict';

/**
 * Login and password as a second way into an account (2026-10-07).
 *
 * Telegram is how people register and the main way in. A person signed in
 * through Telegram can add a login and a password to the SAME account (same
 * admins.id, so the same quota, subscription and history) from the account
 * page. Creating or changing them needs a fresh step-up first:
 *   - telegram: a one-time link to the auth bot, approved only by the
 *     Telegram id already linked to this account (telegram_user_id, or
 *     telegram_chat_id for a private /link) - never by a username;
 *   - password: the current password, only where the person set one.
 * The step-up is bound to the account and to the browser session that asked
 * for it, lasts 5 minutes and is used once.
 *
 * The login is chosen by the person (never taken from the Telegram username),
 * is unique case-insensitively, and the change touches only the person's own
 * row: never the role, never another account. Passwords are bcrypt hashes
 * and never appear in a log, an audit row or an API reply.
 *
 * A master can create one ordinary test account (role 'user', no plan, no
 * Telegram) with a login and the initial password the master types; it then
 * lives like any account: Sinov on first use, the same gates and limits.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const BCRYPT_COST = 12;
const STEPUP_TTL_MS = 5 * 60 * 1000;
const STEPUP_PASSWORD_TRIES = 5;
const LOGIN_FAILS = 10;               // per login name, in LOGIN_WINDOW_MS
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const RESERVED = new Set(['admin', 'administrator', 'master', 'root', 'support', 'juristai', 'system', 'null', 'undefined', 'api', 'bot', 'moderator', 'help']);
// a hash of a random secret: unknown logins still cost one bcrypt compare,
// so a reply's timing does not tell which logins exist
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

const GENERIC_LOGIN_ERROR = "Noto'g'ri foydalanuvchi nomi yoki parol";
const THROTTLED_ERROR = "Juda ko'p urinish — 15 daqiqadan so'ng qayta urinib ko'ring";

/** A login the person may choose: 3-32 characters, a-z 0-9 . _ -, starting with a letter. */
function validateLogin(raw) {
  const login = String(raw || '').trim().replace(/^@/u, '').toLowerCase();
  if (!/^[a-z][a-z0-9._-]{2,31}$/u.test(login)) {
    return { error: 'login_format', message: "Login 3–32 belgi: lotin harflari, raqamlar, nuqta, _ yoki -; harf bilan boshlanadi." };
  }
  if (RESERVED.has(login) || /^tg\d+$/u.test(login)) return { error: 'login_reserved', message: "Bu login band qilingan nomlardan. Boshqasini tanlang." };
  return { login };
}

/** A password: 10-72 bytes (bcrypt reads 72), not the login, not a known published one. */
function validatePassword(password, confirm, login) {
  const p = String(password || '');
  if (p !== String(confirm == null ? p : confirm)) return { error: 'password_mismatch', message: 'Parollar mos kelmaydi.' };
  if (p.length < 10) return { error: 'password_short', message: "Parol kamida 10 belgi bo'lishi kerak." };
  if (Buffer.byteLength(p, 'utf8') > 72) return { error: 'password_long', message: "Parol ko'pi bilan 72 bayt bo'lishi kerak." };
  if (login && p.toLowerCase().includes(String(login).toLowerCase())) return { error: 'password_has_login', message: "Parol login'ni o'z ichiga olmasin." };
  if (/^(.)\1+$/u.test(p) || /^(0123456789|1234567890|qwertyuiop)/iu.test(p)) return { error: 'password_weak', message: 'Parol juda oddiy.' };
  try { if (require('./master-bootstrap').isPublishedMasterPassword(p)) return { error: 'password_weak', message: 'Bu parol xavfsiz emas.' }; } catch (_) { /* optional */ }
  return { ok: true };
}

// ── Login attempt throttle, per login name (the IP limiter is separate) ──
const loginFails = new Map(); // lower(login) -> { n, since }
function loginThrottled(identifier, now = Date.now()) {
  const k = String(identifier || '').toLowerCase();
  const f = loginFails.get(k);
  if (!f) return false;
  if (now - f.since > LOGIN_WINDOW_MS) { loginFails.delete(k); return false; }
  return f.n >= LOGIN_FAILS;
}
function loginFailed(identifier, now = Date.now()) {
  const k = String(identifier || '').toLowerCase();
  const f = loginFails.get(k);
  if (!f || now - f.since > LOGIN_WINDOW_MS) loginFails.set(k, { n: 1, since: now });
  else f.n += 1;
}
function loginSucceeded(identifier) { loginFails.delete(String(identifier || '').toLowerCase()); }
function resetThrottle() { loginFails.clear(); }

/**
 * The account a login and password open, or null. Same work and same answer
 * for an unknown login and a wrong password.
 */
async function checkPassword(db, identifier, password) {
  const clean = String(identifier || '').replace(/^@/u, '').trim();
  const r = clean ? await db.query('SELECT * FROM admins WHERE LOWER(username) = LOWER($1)', [clean]) : { rows: [] };
  const row = r.rows[0] || null;
  const ok = await bcrypt.compare(String(password || ''), row && row.password ? row.password : DUMMY_HASH);
  return row && ok ? row : null;
}

// ── Step-up: a fresh confirmation before credentials are created or changed ──
const stepups = new Map(); // token -> { adminId, sid, method, approved, approvedAt, createdAt, used, tries }
function sweep(now = Date.now()) {
  for (const [k, s] of stepups) if (now - s.createdAt > STEPUP_TTL_MS * 2) stepups.delete(k);
}

/** The account's linked Telegram ids (stable ids, never a username). */
function telegramIdsOf(row) {
  return [row && row.telegram_user_id, row && row.telegram_chat_id].filter(x => x != null && String(x) !== '').map(String);
}

async function accountRow(db, adminId) {
  const r = await db.query(
    `SELECT id, username, role, full_name, password, telegram_user_id, telegram_chat_id, credentials_set_at
       FROM admins WHERE id = $1`, [adminId]);
  return r.rows[0] || null;
}

/** Start a step-up for the signed-in account. method 'telegram' | 'password'. */
async function startStepup(db, { adminId, sid, method, currentPassword = null, now = Date.now() }) {
  sweep(now);
  const row = await accountRow(db, adminId);
  if (!row) return { error: 'no_account', status: 401 };
  if (row.role !== 'user') return { error: 'not_for_role', status: 403, message: "Xodim hisoblari login/parolini boshqaruv bo'limida o'zgartiradi." };
  const token = crypto.randomBytes(18).toString('hex');
  if (method === 'telegram') {
    if (!telegramIdsOf(row).length) return { error: 'no_telegram', status: 409, message: "Hisobingizga Telegram ulanmagan. Joriy parol bilan tasdiqlang." };
    stepups.set(token, { adminId: Number(adminId), sid: String(sid), method, approved: false, approvedAt: null, createdAt: now, used: false });
    return { token, method, expiresInSec: STEPUP_TTL_MS / 1000 };
  }
  if (method === 'password') {
    if (!row.credentials_set_at) return { error: 'no_password', status: 409, message: "Bu hisobda siz o'rnatgan parol yo'q. Telegram orqali tasdiqlang." };
    const key = `pw:${adminId}`;
    const t = stepups.get(key) || { tries: 0, createdAt: now };
    if (now - t.createdAt > LOGIN_WINDOW_MS) { t.tries = 0; t.createdAt = now; }
    if (t.tries >= STEPUP_PASSWORD_TRIES) return { error: 'throttled', status: 429, message: THROTTLED_ERROR };
    const ok = await bcrypt.compare(String(currentPassword || ''), row.password || DUMMY_HASH);
    if (!ok) { t.tries += 1; stepups.set(key, t); return { error: 'wrong_password', status: 401, message: "Joriy parol noto'g'ri." }; }
    stepups.delete(key);
    stepups.set(token, { adminId: Number(adminId), sid: String(sid), method, approved: true, approvedAt: now, createdAt: now, used: false });
    return { token, method, approved: true, expiresInSec: STEPUP_TTL_MS / 1000 };
  }
  return { error: 'method', status: 400 };
}

/**
 * The auth bot's /start stepup_<token>: approved only when the Telegram id
 * that opened it is the one linked to the account that asked. Returns the
 * text the bot sends.
 */
async function approveStepupFromTelegram(db, token, fromId, now = Date.now()) {
  const s = stepups.get(String(token || ''));
  if (!s || s.method !== 'telegram' || now - s.createdAt > STEPUP_TTL_MS) return { ok: false, text: "⏳ Tasdiqlash so'rovi topilmadi yoki muddati o'tgan. Saytda qayta urinib ko'ring." };
  const row = await accountRow(db, s.adminId);
  if (!row || !telegramIdsOf(row).includes(String(fromId))) {
    return { ok: false, text: "❌ Bu tasdiqlash boshqa JuristAI hisobi uchun. Faqat o'sha hisobga ulangan Telegram tasdiqlay oladi." };
  }
  s.approved = true;
  s.approvedAt = now;
  return { ok: true, text: "✅ Login va parolni o'rnatish/almashtirish tasdiqlandi. Saytga qayting.\n\nAgar buni siz so'ramagan bo'lsangiz, hech narsa qilmang va Telegram orqali kirib hisobingizni tekshiring." };
}

/** Step-up state for the session that asked (no one else can read it). */
function stepupStatus(token, { adminId, sid }, now = Date.now()) {
  const s = stepups.get(String(token || ''));
  if (!s || s.adminId !== Number(adminId) || s.sid !== String(sid)) return { found: false };
  return { found: true, approved: s.approved, used: s.used, expired: now - s.createdAt > STEPUP_TTL_MS };
}

/** Use a step-up once: approved, fresh, this account, this session. */
function consumeStepup(token, { adminId, sid }, now = Date.now()) {
  const s = stepups.get(String(token || ''));
  if (!s || s.adminId !== Number(adminId) || s.sid !== String(sid)) return false;
  if (!s.approved || s.used || now - s.createdAt > STEPUP_TTL_MS || now - s.approvedAt > STEPUP_TTL_MS) return false;
  s.used = true;
  stepups.delete(String(token));
  return true;
}

/** Is `login` free for `adminId` (case-insensitive, any role)? Checked in the caller's transaction. */
async function loginFree(client, login, adminId) {
  const r = await client.query('SELECT id FROM admins WHERE LOWER(username) = LOWER($1) AND id <> $2 LIMIT 1', [login, adminId]);
  return r.rows.length === 0;
}

/**
 * Create or change the login and password of the person's own account.
 * Ends every other session of the account (the current one stays).
 */
async function setCredentials(pool, { adminId, sid, login: rawLogin, password, confirm }) {
  const v = validateLogin(rawLogin);
  if (v.error) return { status: 400, ...v };
  const p = validatePassword(password, confirm, v.login);
  if (p.error) return { status: 400, ...p };
  const hash = await bcrypt.hash(String(password), BCRYPT_COST);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`juristai:login:${v.login}`]);
    if (!(await loginFree(client, v.login, adminId))) {
      await client.query('ROLLBACK');
      return { status: 409, error: 'login_taken', message: 'Bu login band. Boshqasini tanlang.' };
    }
    // the person's own row, and only an ordinary account: never the role
    const r = await client.query(
      `UPDATE admins SET username = $2, password = $3, credentials_set_at = now()
        WHERE id = $1 AND role = 'user' RETURNING id, username`, [adminId, v.login, hash]);
    if (!r.rows.length) { await client.query('ROLLBACK'); return { status: 403, error: 'not_for_role' }; }
    await client.query(
      `DELETE FROM user_sessions WHERE (sess->>'adminId') = $1::text AND ($2::text IS NULL OR sid <> $2)`,
      [String(adminId), sid ? String(sid) : null]);
    await client.query('COMMIT');
    return { status: 200, ok: true, login: r.rows[0].username };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e && e.code === '23505') return { status: 409, error: 'login_taken', message: 'Bu login band. Boshqasini tanlang.' };
    throw e;
  } finally {
    client.release();
  }
}

/** What the account page shows. Never a password or a hash. */
async function credentialStatus(db, adminId) {
  const row = await accountRow(db, adminId);
  if (!row) return null;
  return {
    role: row.role,
    enabled: !!row.credentials_set_at,
    login: row.credentials_set_at ? row.username : null,
    setAt: row.credentials_set_at || null,
    telegramLinked: telegramIdsOf(row).length > 0,
    stepupMethods: [telegramIdsOf(row).length ? 'telegram' : null, row.credentials_set_at ? 'password' : null].filter(Boolean),
    canManage: row.role === 'user',
  };
}

/**
 * A master creates an ordinary test account (role 'user'). The master
 * confirms with the master's own current password; the initial password is
 * typed by the master and only its hash is stored. No plan, no Telegram, no
 * payment: Sinov starts on first use as for anyone.
 */
async function createTestUser(pool, { masterId, masterPassword, login: rawLogin, fullName, password, confirm }) {
  const m = await pool.query('SELECT id, role, password FROM admins WHERE id = $1', [masterId]);
  const master = m.rows[0];
  if (!master || master.role !== 'master') return { status: 403, error: 'master_only' };
  if (!(await bcrypt.compare(String(masterPassword || ''), master.password || DUMMY_HASH))) {
    return { status: 401, error: 'master_password', message: "Master paroli noto'g'ri." };
  }
  const v = validateLogin(rawLogin);
  if (v.error) return { status: 400, ...v };
  const p = validatePassword(password, confirm, v.login);
  if (p.error) return { status: 400, ...p };
  const name = String(fullName || '').trim().slice(0, 120) || 'Test foydalanuvchi';
  const hash = await bcrypt.hash(String(password), BCRYPT_COST);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`juristai:login:${v.login}`]);
    if (!(await loginFree(client, v.login, -1))) {
      await client.query('ROLLBACK');
      return { status: 409, error: 'login_taken', message: 'Bu login band. Boshqasini tanlang.' };
    }
    const r = await client.query(
      `INSERT INTO admins (username, password, full_name, role, credentials_set_at, created_by_master_id)
       VALUES ($1, $2, $3, 'user', now(), $4) RETURNING id, username, role`, [v.login, hash, name, masterId]);
    await client.query('COMMIT');
    return { status: 200, ok: true, user: r.rows[0] };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e && e.code === '23505') return { status: 409, error: 'login_taken', message: 'Bu login band. Boshqasini tanlang.' };
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  BCRYPT_COST, STEPUP_TTL_MS, LOGIN_FAILS, LOGIN_WINDOW_MS, GENERIC_LOGIN_ERROR, THROTTLED_ERROR,
  validateLogin, validatePassword, checkPassword, loginThrottled, loginFailed, loginSucceeded, resetThrottle,
  startStepup, approveStepupFromTelegram, stepupStatus, consumeStepup, setCredentials, credentialStatus, createTestUser,
  telegramIdsOf, _stepups: stepups,
};
