'use strict';

/**
 * Account credentials routes (2026-10-07, src/auth/credentials.js):
 *
 *   GET  /api/account/credentials                  what the account page shows
 *   POST /api/account/credentials/stepup           { method: 'telegram' } -> bot link
 *                                                  { method: 'password', currentPassword }
 *   GET  /api/account/credentials/stepup/:token    { approved, expired } for this session only
 *   POST /api/account/credentials                  { stepupToken, login, password, passwordConfirm }
 *   POST /api/admin/test-users                     master: an ordinary test account
 *
 * No reply carries a password or a hash; audit rows name the action and
 * the account, never the password.
 */

const credentials = require('./credentials');

function mountCredentialRoutes(app, { pool, requireAuth, requireMasterAdmin, logAudit = () => {}, authBotUsername = 'juristAI_registration_bot' }) {
  const who = req => ({ adminId: req.session.adminId, sid: req.sessionID });

  app.get('/api/account/credentials', requireAuth, async (req, res) => {
    try {
      const s = await credentials.credentialStatus(pool, req.session.adminId);
      if (!s) return res.status(401).json({ error: 'Unauthorized' });
      res.json(s);
    } catch (e) {
      console.error('[CREDENTIALS] status:', e.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/account/credentials/stepup', requireAuth, async (req, res) => {
    try {
      const b = req.body || {};
      const out = await credentials.startStepup(pool, { ...who(req), method: String(b.method || ''), currentPassword: b.currentPassword });
      if (out.error) {
        if (out.error === 'wrong_password' || out.error === 'throttled') logAudit(req, 'account.stepup_failed', 'admin', req.session.adminId);
        return res.status(out.status || 400).json({ error: out.error, message: out.message || null });
      }
      logAudit(req, `account.stepup_${out.method}`, 'admin', req.session.adminId);
      res.json({ token: out.token, method: out.method, approved: !!out.approved, expiresInSec: out.expiresInSec,
        botUrl: out.method === 'telegram' ? `https://t.me/${authBotUsername}?start=stepup_${out.token}` : null });
    } catch (e) {
      console.error('[CREDENTIALS] stepup:', e.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.get('/api/account/credentials/stepup/:token', requireAuth, (req, res) => {
    const s = credentials.stepupStatus(req.params.token, who(req));
    if (!s.found) return res.status(404).json({ error: 'not_found' });
    res.json({ approved: s.approved, expired: s.expired });
  });

  app.post('/api/account/credentials', requireAuth, async (req, res) => {
    try {
      const b = req.body || {};
      if (!credentials.consumeStepup(b.stepupToken, who(req))) {
        return res.status(403).json({ error: 'stepup_required', message: "Avval Telegram yoki joriy parol bilan tasdiqlang (5 daqiqa amal qiladi)." });
      }
      const out = await credentials.setCredentials(pool, { ...who(req), login: b.login, password: b.password, confirm: b.passwordConfirm });
      if (!out.ok) return res.status(out.status || 400).json({ error: out.error, message: out.message || null });
      req.session.username = out.login;
      logAudit(req, 'account.credentials_set', 'admin', req.session.adminId);
      res.json({ ok: true, login: out.login, otherSessionsEnded: true });
    } catch (e) {
      console.error('[CREDENTIALS] set:', e.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/api/admin/test-users', requireMasterAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const out = await credentials.createTestUser(pool, {
        masterId: req.session.adminId, masterPassword: b.masterPassword,
        login: b.login, fullName: b.fullName, password: b.password, confirm: b.passwordConfirm,
      });
      if (!out.ok) {
        if (out.error === 'master_password') logAudit(req, 'admin.test_user_reauth_failed', 'admin', req.session.adminId);
        return res.status(out.status || 400).json({ error: out.error, message: out.message || null });
      }
      logAudit(req, 'admin.test_user_create', 'admin', out.user.id);
      res.json({ ok: true, user: { id: out.user.id, login: out.user.username, role: out.user.role } });
    } catch (e) {
      console.error('[TEST USER] create:', e.message);
      res.status(500).json({ error: 'Server error' });
    }
  });
}

module.exports = { mountCredentialRoutes };
