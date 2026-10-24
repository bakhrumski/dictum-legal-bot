'use strict';

/**
 * One-step web sign-in and registration with Telegram Login (2026-10-13).
 *
 * The page opens Telegram's own login window (oauth.telegram.org) for the
 * auth bot. Telegram asks the person to confirm in the Telegram app and
 * returns their id and name signed with the bot token. The server checks the
 * signature, so the data cannot be forged, and Telegram only signs for the
 * domain set with BotFather (/setdomain), so a link sent to someone else
 * cannot sign that person into another browser (the reason the old
 * "open the link = signed in" flow was replaced by codes, telegram-confirm.js).
 *
 * One endpoint does both: an existing Telegram account is signed in, a new
 * one is created (same rules as /api/register/telegram-otp: one trial per
 * device fingerprint).
 *
 *   POST /api/auth/telegram  { auth: {id, first_name, last_name, username, photo_url, auth_date, hash}, device_fingerprint }
 *        -> { success, isNew, redirect }
 *
 * Turned on with TELEGRAM_LOGIN_ENABLED=true (after BotFather /setdomain for
 * the auth bot). The bot token is REG_BOT_TOKEN; only its numeric bot id is
 * shown to the browser (telegramLoginOptions), never the token.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { requireSameOrigin } = require('./same-origin');
const { startSession } = require('./login-routes');

const MAX_AGE_S = 10 * 60;            // a signed login is accepted for 10 minutes
const SEEN_TTL_MS = MAX_AGE_S * 1000;

function enabled(env = process.env) {
  return env.TELEGRAM_LOGIN_ENABLED === 'true' && /^\d+:[\w-]+$/.test(env.REG_BOT_TOKEN || '');
}

/** What the login page may know: the numeric bot id (public), or null. */
function telegramLoginOptions(env = process.env) {
  return enabled(env) ? { botId: String(env.REG_BOT_TOKEN).split(':')[0] } : null;
}

/**
 * Check Telegram's signature (core.telegram.org/widgets/login#checking-authorization).
 * Returns { ok: true, user } or { ok: false, error }.
 */
function checkTelegramAuth(auth, botToken, now = Date.now()) {
  if (!auth || typeof auth !== 'object' || Array.isArray(auth) || !botToken) return { ok: false, error: 'bad_request' };
  const hash = String(auth.hash || '');
  if (!/^[a-f0-9]{64}$/.test(hash)) return { ok: false, error: 'bad_signature' };
  const keys = Object.keys(auth).filter(k => k !== 'hash');
  if (!keys.length || keys.length > 12) return { ok: false, error: 'bad_request' };
  for (const k of keys) {
    const v = auth[k];
    if (!/^[a-z_]{1,32}$/.test(k) || !(typeof v === 'string' || typeof v === 'number') || String(v).length > 512) return { ok: false, error: 'bad_request' };
  }
  const dataCheck = keys.sort().map(k => `${k}=${auth[k]}`).join('\n');
  const secret = crypto.createHash('sha256').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheck).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return { ok: false, error: 'bad_signature' };
  const age = now / 1000 - Number(auth.auth_date);
  if (!Number.isFinite(age) || age < -60 || age > MAX_AGE_S) return { ok: false, error: 'expired' };
  const id = String(auth.id);
  if (!/^\d{1,15}$/.test(id)) return { ok: false, error: 'bad_request' };
  return { ok: true, hash, user: { id, firstName: String(auth.first_name || ''), lastName: String(auth.last_name || ''), username: auth.username ? String(auth.username) : null } };
}

function mountTelegramLoginRoutes(app, { pool, logAudit = () => {}, appHome = null, env = process.env }) {
  const seen = new Map();                       // signature -> expiry: each signed login is used once
  const used = (h, now) => {
    for (const [k, t] of seen) if (t < now) seen.delete(k);
    if (seen.has(h)) return true;
    seen.set(h, now + SEEN_TTL_MS); return false;
  };

  app.post('/api/auth/telegram', requireSameOrigin, async (req, res) => {
    if (!enabled(env)) return res.status(404).json({ error: 'telegram_login_disabled' });
    try {
      const body = req.body || {};
      const v = checkTelegramAuth(body.auth, env.REG_BOT_TOKEN);
      if (!v.ok) return res.status(v.error === 'expired' ? 401 : 400).json({ error: v.error });
      if (used(v.hash, Date.now())) return res.status(401).json({ error: 'expired' });
      const tg = v.user;

      const existing = (await pool.query('SELECT id, role, full_name, username FROM admins WHERE telegram_user_id = $1', [tg.id])).rows[0];
      if (existing) {
        await startSession(req, existing);
        logAudit(req, 'login.telegram_widget', 'admin', existing.id, existing.id);
        return res.json({ success: true, isNew: false, redirect: appHome || '/dashboard.html' });
      }

      // New account: one trial per device (same rule as /api/register/telegram-otp)
      const dfp = typeof body.device_fingerprint === 'string' ? body.device_fingerprint.slice(0, 64) : null;
      if (dfp) {
        const fpAbuse = await pool.query('SELECT id FROM admins WHERE device_fingerprint = $1 AND bepul_used = TRUE', [dfp]);
        if (fpAbuse.rows.length > 0) return res.status(409).json({ error: 'sinov_used' });
      }
      const baseName = tg.username || `tg${tg.id}`;
      const safeBase = baseName.replace(/[^a-z0-9._-]/gi, '').toLowerCase() || `tg${tg.id}`;
      let username = safeBase;
      for (let i = 1; i <= 200; i++) {
        const dup = await pool.query('SELECT id FROM admins WHERE LOWER(username) = $1', [username]);
        if (dup.rows.length === 0) break;
        username = `${safeBase}${i}`;
      }
      const fullName = `${tg.firstName} ${tg.lastName}`.trim() || baseName;
      const randomPwd = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
      const insert = await pool.query(
        `INSERT INTO admins (username, password, full_name, role, telegram_username, telegram_chat_id, telegram_user_id, device_fingerprint)
         VALUES ($1, $2, $3, 'user', $4, $5, $6, $7) RETURNING id, username, full_name, role`,
        [username, randomPwd, fullName, tg.username, parseInt(tg.id, 10), BigInt(tg.id), dfp]
      );
      const admin = insert.rows[0];
      await startSession(req, admin);
      logAudit(req, 'register.telegram_widget', 'admin', admin.id, admin.id);
      res.json({ success: true, isNew: true, redirect: appHome || '/tariff.html' });
    } catch (err) {
      console.error('[auth/telegram]', err.message);
      res.status(500).json({ error: 'Kirishda xatolik' });
    }
  });
}

module.exports = { mountTelegramLoginRoutes, checkTelegramAuth, telegramLoginOptions };
