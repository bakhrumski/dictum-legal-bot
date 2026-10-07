'use strict';

/**
 * Login with a login name and password (moved out of server.js, 2026-10-07).
 * Behaviour kept: a published seed password is refused, and a master with a
 * linked Telegram gets a 6-digit second factor from the auth bot before a
 * session exists (MASTER_2FA=off disables it). Added:
 *   - an unknown login and a wrong password give the same reply after the
 *     same bcrypt work (credentials.checkPassword);
 *   - at most 10 failures per login name in 15 minutes (the IP limiter on
 *     /api/login is separate), the same reply whether the login exists;
 *   - a new session id at sign-in (no fixation of a pre-login session).
 * An ordinary account opens here only once its owner has set a login and
 * password (src/auth/credentials.js); one made through Telegram has a
 * random password nobody knows.
 */

const crypto = require('crypto');
const credentials = require('./credentials');

function regenerate(req) {
  return new Promise((resolve, reject) => {
    if (!req.session || typeof req.session.regenerate !== 'function') return resolve();
    req.session.regenerate(err => (err ? reject(err) : resolve()));
  });
}

async function startSession(req, admin) {
  await regenerate(req);
  req.session.isAuthenticated = true;
  req.session.role = admin.role;
  req.session.adminId = admin.id;
  req.session.username = admin.username;
  req.session.fullName = admin.full_name;
  await new Promise((resolve, reject) => req.session.save(err => (err ? reject(err) : resolve())));
}

function mountLoginRoutes(app, { pool, logAudit = () => {}, getAuthBot = () => null, authBotUsername = 'juristAI_registration_bot' }) {
  // token -> { adminId, role, username, full_name, code, expiresAt, tries }
  const pending2fa = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of pending2fa) if (now > v.expiresAt) pending2fa.delete(k);
  }, 60 * 1000).unref();

  app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {};
    const identifier = String(username || '').replace(/^@/u, '').trim();
    try {
      if (credentials.loginThrottled(identifier)) {
        logAudit(req, 'login.throttled', 'admin', identifier.slice(0, 64), null);
        return res.status(429).json({ error: credentials.THROTTLED_ERROR });
      }
      const admin = await credentials.checkPassword(pool, identifier, password);
      if (!admin) {
        credentials.loginFailed(identifier);
        logAudit(req, 'login.fail', 'admin', identifier.slice(0, 64), null);
        return res.status(401).json({ error: credentials.GENERIC_LOGIN_ERROR });
      }

      if (require('./master-bootstrap').isPublishedMasterPassword(password)) {
        // This password was committed to the repository as a seeded login;
        // anyone could use it. Refuse until it is changed.
        logAudit(req, 'login.published_password_refused', 'admin', admin.id, admin.id);
        return res.status(403).json({
          code: 'PASSWORD_MUST_CHANGE',
          error: 'Bu parol xavfsiz emas va bloklangan. Parolni tiklash orqali yangi parol o‘rnating.',
        });
      }
      credentials.loginSucceeded(identifier);

      // Master with linked Telegram → the second factor. /link stores
      // telegram_chat_id, the self-signup telegram_user_id; either is a
      // delivery target (in a private chat they are equal).
      const tgTarget = admin.telegram_user_id || admin.telegram_chat_id;
      if (admin.role === 'master' && tgTarget && process.env.MASTER_2FA !== 'off') {
        const authBot = getAuthBot();
        const authBotUrl = `https://t.me/${authBotUsername}`;
        if (!authBot) {
          console.error('[2FA] REG_BOT_TOKEN is not configured');
          return res.status(503).json({
            code: 'AUTH_BOT_NOT_CONFIGURED',
            error: `Tasdiqlash boti @${authBotUsername} sozlanmagan. Administrator REG_BOT_TOKEN ni sozlashi kerak.`,
            botUsername: authBotUsername, botUrl: authBotUrl,
          });
        }
        const code = require('./otp').digitCode(6);
        const token = crypto.randomBytes(24).toString('hex');
        pending2fa.set(token, {
          adminId: admin.id, role: admin.role, username: admin.username,
          full_name: admin.full_name, code, expiresAt: Date.now() + 5 * 60 * 1000, tries: 0,
        });
        try {
          await authBot.sendMessage(tgTarget,
            `🔐 JuristAI kirish kodi: ${code}\n\n5 daqiqa amal qiladi.\nAgar bu siz bo'lmasangiz — DARHOL parolni almashtiring!`);
        } catch (e) {
          pending2fa.delete(token);
          console.error(`[2FA] @${authBotUsername} send failed:`, e.message);
          return res.status(503).json({
            code: 'AUTH_BOT_DELIVERY_FAILED',
            error: `Tasdiqlash kodi yuborilmadi. @${authBotUsername} botini ochib Start bosing, so'ng qayta kiring.`,
            botUsername: authBotUsername, botUrl: authBotUrl,
          });
        }
        logAudit(req, 'login.2fa_sent', 'admin', admin.id, admin.id);
        return res.json({ twofa: true, token });
      }

      await startSession(req, admin);
      logAudit(req, 'login.success', 'admin', admin.id, admin.id);
      res.json({ success: true, role: admin.role, fullName: admin.full_name });
    } catch (error) {
      console.error('Login error:', error.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Second factor confirmation (rate-limited by the /api/login limiter prefix).
  app.post('/api/login/2fa', async (req, res) => {
    const token = String((req.body || {}).token || '');
    const code = String((req.body || {}).code || '').trim();
    const p = pending2fa.get(token);
    if (!p || Date.now() > p.expiresAt) {
      pending2fa.delete(token);
      return res.status(401).json({ error: 'Kod muddati tugadi — qaytadan kiring', expired: true });
    }
    p.tries++;
    if (p.tries > 5) {
      pending2fa.delete(token);
      logAudit(req, 'login.2fa_lockout', 'admin', p.adminId, p.adminId);
      return res.status(429).json({ error: 'Juda ko\'p urinish — qaytadan kiring', expired: true });
    }
    if (code !== p.code) return res.status(401).json({ error: 'Kod noto\'g\'ri' });
    pending2fa.delete(token);
    try {
      await startSession(req, { id: p.adminId, role: p.role, username: p.username, full_name: p.full_name });
    } catch (e) {
      console.error('[2FA] session failed:', e.message);
      return res.status(500).json({ error: 'Server error' });
    }
    logAudit(req, 'login.2fa_success', 'admin', p.adminId, p.adminId);
    res.json({ success: true, role: p.role, fullName: p.full_name });
  });

  return { pending2fa };
}

module.exports = { mountLoginRoutes, startSession };
