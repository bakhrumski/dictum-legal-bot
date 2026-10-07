'use strict';

/**
 * Web sign-in and registration through Telegram (moved out of server.js,
 * 2026-10-07). The browser starts a link; the auth bot sends a 6-digit code
 * to the Telegram chat that opens it (src/auth/telegram-confirm.js); the
 * person types the code into the same browser. Opening the link or pressing
 * Start never signs anyone in, and no API returns the code.
 *
 *   POST /api/login-session                  { token, botUsername } + browser cookie
 *   POST /api/reg-session                    { token, botUsername } + browser cookie
 *   GET  /api/telegram-auth/status/:mode/:t  { codeSent, expired } - never the code
 *   POST /api/login/telegram-otp             { token, otp_code }
 *   POST /api/register/telegram-otp          { token, otp_code, device_fingerprint }
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const confirm = require('./telegram-confirm');
const { requireSameOrigin } = require('./same-origin');
const { startSession } = require('./login-routes');

function mountTelegramAuthRoutes(app, { pool, loginSessions, regSessions, logAudit = () => {}, authBotUsername = 'juristAI_registration_bot' }) {
  const storeOf = mode => (mode === 'register' ? regSessions : mode === 'login' ? loginSessions : null);

  const start = (store, flow) => (req, res) => {
    const { token, cookie } = confirm.createLink(store, flow);
    confirm.setLinkCookie(req, res, cookie);
    res.json({ token, botUsername: authBotUsername });
  };
  app.post('/api/reg-session', start(regSessions, 'register'));
  app.post('/api/login-session', start(loginSessions, 'login'));

  app.get('/api/telegram-auth/status/:mode/:token', (req, res) => {
    const store = storeOf(req.params.mode);
    if (!store) return res.status(400).json({ error: 'Noto‘g‘ri tasdiqlash turi' });
    res.json(confirm.linkStatus(store, req.params.mode, req.params.token));
  });

  app.post('/api/login/telegram-otp', requireSameOrigin, async (req, res) => {
    try {
      const { token, otp_code } = req.body || {};
      const v = confirm.verifyCode(loginSessions, 'login', token, otp_code, req);
      if (!v.ok) return res.status(v.status).json({ error: v.message, code: v.error });
      const row = (await pool.query('SELECT id, role, full_name, username FROM admins WHERE telegram_user_id = $1', [v.telegramUserId])).rows[0];
      if (!row) return res.status(404).json({ error: 'Bu Telegram hisob bilan ro\'yxatdan o\'tilmagan. Iltimos, avval ro\'yxatdan o\'ting.' });
      await startSession(req, row);
      logAudit(req, 'login.telegram_code', 'admin', row.id, row.id);
      res.json({ success: true, redirect: '/dashboard.html' });
    } catch (err) {
      console.error('[login/telegram-otp]', err.message);
      res.status(500).json({ error: 'Kirishda xatolik' });
    }
  });

  app.post('/api/register/telegram-otp', requireSameOrigin, async (req, res) => {
    try {
      const { token, otp_code, device_fingerprint } = req.body || {};
      const dfp = typeof device_fingerprint === 'string' ? device_fingerprint.slice(0, 64) : null;
      const v = confirm.verifyCode(regSessions, 'register', token, otp_code, req);
      if (!v.ok) return res.status(v.status).json({ error: v.message, code: v.error });
      const session = v.session;
      const tgUserId = v.telegramUserId;

      // The account exists: log its owner in. The trial limit stops a SECOND
      // account, never the owner of the first one (2026-10-03).
      const existing = await pool.query('SELECT id, bepul_used, role, full_name, username FROM admins WHERE telegram_user_id = $1', [tgUserId]);
      if (existing.rows.length > 0) {
        await startSession(req, existing.rows[0]);
        logAudit(req, 'login.telegram_code', 'admin', existing.rows[0].id, existing.rows[0].id);
        return res.json({ success: true, redirect: '/dashboard.html' });
      }

      // Sinov abuse: same device fingerprint
      if (dfp) {
        const fpAbuse = await pool.query('SELECT id FROM admins WHERE device_fingerprint = $1 AND bepul_used = TRUE', [dfp]);
        if (fpAbuse.rows.length > 0) return res.status(409).json({ error: 'sinov_used' });
      }

      // Build unique username
      const baseName = session.username || `tg${tgUserId}`;
      const safeBase = baseName.replace(/[^a-z0-9._-]/gi, '').toLowerCase() || `tg${tgUserId}`;
      let username = safeBase;
      for (let i = 1; i <= 200; i++) {
        const dup = await pool.query('SELECT id FROM admins WHERE LOWER(username) = $1', [username]);
        if (dup.rows.length === 0) break;
        username = `${safeBase}${i}`;
      }

      const fullName = `${session.firstName || ''} ${session.lastName || ''}`.trim() || baseName;
      const randomPwd = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
      const insert = await pool.query(
        `INSERT INTO admins (username, password, full_name, role, telegram_username, telegram_chat_id, telegram_user_id, device_fingerprint)
         VALUES ($1, $2, $3, 'user', $4, $5, $6, $7) RETURNING id, username, full_name, role`,
        [username, randomPwd, fullName, session.username || null,
          parseInt(tgUserId, 10), BigInt(tgUserId), dfp || null]
      );
      const admin = insert.rows[0];
      await startSession(req, admin);
      logAudit(req, 'register.telegram_code', 'admin', admin.id, admin.id);
      res.json({ success: true, role: admin.role, fullName: admin.full_name, redirect: '/tariff.html' });
    } catch (err) {
      console.error('[register/telegram-otp]', err.message);
      res.status(500).json({ error: 'Ro\'yxatdan o\'tishda xatolik' });
    }
  });
}

module.exports = { mountTelegramAuthRoutes };
