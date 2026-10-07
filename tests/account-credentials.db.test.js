'use strict';

/**
 * Login and password as a second way into a Telegram account (2026-10-07),
 * through the real login and credential routes on a real Postgres with the
 * real session store (connect-pg-simple), so ending sessions is real too.
 * The auth bot is a stub: no Telegram message is sent, no AI is called.
 * Needs TEST_DATABASE_URL (throwaway).
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/account-credentials.db.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

if (!process.env.TEST_DATABASE_URL) {
  console.log('account credentials (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like a hosted database');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
delete process.env.MASTER_2FA;

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/database/db');
const tiers = require('../src/rag/subscription-tiers');
const ledger = require('../src/rag/tariff-ledger');
const credentials = require('../src/auth/credentials');
const { mountLoginRoutes } = require('../src/auth/login-routes');
const { mountCredentialRoutes } = require('../src/auth/credential-routes');
const { mountTelegramAuthRoutes } = require('../src/auth/telegram-auth-routes');
const { handleAuthStart, createRecoverLink } = require('../src/bot/auth-start');
const { resetWithLink } = require('../src/auth/recovery');
const { verificationTokens, regSessions, loginSessions } = require('../src/verification-store');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const rnd = () => Math.floor(Math.random() * 1e9);
const made = [];
const audits = [];
const replies = []; // every JSON reply body, checked for passwords at the end
const botMessages = [];
// test passwords are made per run, never written in the repository
const secret = (tag) => `${tag}-${require('crypto').randomBytes(9).toString('base64url')}`;

async function ensureSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS admins (id serial PRIMARY KEY, username varchar(255) UNIQUE NOT NULL, password varchar(255) NOT NULL, full_name varchar(255) NOT NULL, role varchar(50) NOT NULL DEFAULT 'student')`);
  for (const col of ['created_at timestamptz DEFAULT now()', 'telegram_username varchar(100)', 'tariff_plan varchar(20)', 'tariff_starts_at timestamptz', 'tariff_expires_at timestamptz',
    'telegram_user_id bigint', 'telegram_chat_id bigint', 'channel_verified_at timestamptz', 'survey_completed_at timestamptz', 'free_gate_since timestamptz',
    'device_fingerprint varchar(64)', 'bepul_used boolean DEFAULT false']) {
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS ${col}`);
  }
  await tiers.initSubscriptionSchema();
  for (const f of ['20261004_013_tariff_periods.sql', '20261006_014_test_budget_risk.sql', '20261007_016_account_credentials.sql']) {
    await pool.query(fs.readFileSync(path.join(__dirname, '../migrations', f), 'utf8'));
  }
}

async function makeAccount({ role = 'user', login = null, password = null, telegram = true, tgUsername = null } = {}) {
  const pw = password ? await bcrypt.hash(password, 10) : await bcrypt.hash(require('crypto').randomBytes(16).toString('hex'), 10);
  const tg = telegram ? 6000000000 + rnd() : null;
  const r = await pool.query(
    `INSERT INTO admins (username, password, full_name, role, telegram_user_id, telegram_username, credentials_set_at)
     VALUES ($1, $2, 'Cred Test', $3, $4, $5, $6) RETURNING *`,
    [login || `cr_${Date.now()}_${rnd()}`, pw, role, tg, tgUsername, password && role === 'user' ? new Date() : null]);
  made.push(r.rows[0].id);
  return r.rows[0];
}

let base;
const stubBot = { sendMessage: async (to, text) => { botMessages.push({ to: String(to), text }); } };
async function startApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(session({
    store: new (require('connect-pg-simple')(session))({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
    secret: 'test-session-secret-not-used-elsewhere', resave: false, saveUninitialized: false,
  }));
  app.use((req, res, next) => { const j = res.json.bind(res); res.json = (b) => { replies.push(b); return j(b); }; next(); });
  const requireAuth = (req, res, next) => (req.session && req.session.isAuthenticated ? next() : res.status(401).json({ error: 'Unauthorized' }));
  const requireMasterAdmin = (req, res, next) => (req.session && req.session.role === 'master' ? next() : res.status(403).json({ error: 'Forbidden' }));
  const logAudit = (req, ...args) => audits.push(args);
  mountLoginRoutes(app, { pool, logAudit, getAuthBot: () => stubBot });
  mountCredentialRoutes(app, { pool, requireAuth, requireMasterAdmin, logAudit });
  mountTelegramAuthRoutes(app, { pool, loginSessions, regSessions, logAudit });
  app.get('/whoami', requireAuth, (req, res) => res.json({ adminId: req.session.adminId, role: req.session.role, sid: req.sessionID }));
  // a Telegram sign-in, as /api/login/telegram-otp does after the bot approved it
  app.post('/test/telegram-signin', async (req, res) => {
    const row = (await pool.query('SELECT id, role, username, full_name FROM admins WHERE telegram_user_id = $1', [req.body.tg])).rows[0];
    if (!row) return res.status(404).json({});
    Object.assign(req.session, { isAuthenticated: true, role: row.role, adminId: row.id, username: row.username, fullName: row.full_name });
    req.session.save(() => res.json({ ok: true }));
  });
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  return server;
}

/** A browser: keeps its own cookie. */
function client({ origin } = {}) {
  const jar = new Map(); // a browser keeps every cookie it is given
  const call = async (method, p, json, extra = {}) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const o = origin === undefined ? base : origin; // a browser sends its page's Origin on POST
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(method !== 'GET' && o ? { origin: o } : {}), ...extra },
      body: json ? JSON.stringify(json) : undefined });
    for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) {
      const [kv] = c.split(';'); const i = kv.indexOf('=');
      jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  return {
    get: p => call('GET', p), post: (p, j, extra) => call('POST', p, j || {}, extra),
    login: (username, password) => call('POST', '/api/login', { username, password }),
    tg: (row) => call('POST', '/test/telegram-signin', { tg: String(row.telegram_user_id) }),
    jar,
  };
}

/** Telegram step-up as the person would do it: start, open the bot link, approve. */
async function telegramStepup(c, fromId) {
  const s = await c.post('/api/account/credentials/stepup', { method: 'telegram' });
  assert.strictEqual(s.status, 200, JSON.stringify(s.body));
  assert.match(s.body.botUrl, /\?start=stepup_[0-9a-f]+$/u);
  const out = await credentials.approveStepupFromTelegram(pool, s.body.token, fromId);
  return { token: s.body.token, approved: out.ok, text: out.text };
}

const balanceOf = async (adminId) => {
  const b = await ledger.balance({ adminId });
  return JSON.stringify({ kind: b.kind, plan: b.plan, services: b.services || null, trialQuotas: b.trialQuotas || null });
};

(async () => {
  console.log('account credentials (db, real routes, real session store)');
  await ensureSchema();
  const server = await startApp();

  try {
    await test('a Telegram account has no usable password until its owner sets one; its Telegram username is not a login', async () => {
      const u = await makeAccount({ tgUsername: `tgname${rnd()}` });
      const c = client();
      const viaTgName = await c.login(u.telegram_username, 'anything-at-all');
      const unknown = await c.login(`nobody_${rnd()}`, 'anything-at-all');
      assert.deepStrictEqual([viaTgName.status, viaTgName.body], [401, { error: credentials.GENERIC_LOGIN_ERROR }]);
      assert.deepStrictEqual([unknown.status, unknown.body], [401, { error: credentials.GENERIC_LOGIN_ERROR }], 'unknown login: the same reply');
      await c.tg(u);
      const st = await c.get('/api/account/credentials');
      assert.deepStrictEqual([st.body.enabled, st.body.login, st.body.telegramLinked, st.body.stepupMethods, st.body.canManage], [false, null, true, ['telegram'], true]);
    });

    await test('Telegram user -> fresh Telegram confirmation -> own login and password -> signs in to the SAME account, same quota', async () => {
      const u = await makeAccount();
      // Sinov already in use on this account
      const r0 = await ledger.reserve({ adminId: u.id, service: 'chat', units: 1, endpoint: '/api/legal-chat', channel: 'web', actorId: u.id });
      assert.ok(r0.allowed); await ledger.commit(r0.jobKey);
      const before = await balanceOf(u.id);
      const c = client();
      await c.tg(u);
      const noStepup = await c.post('/api/account/credentials', { login: `ali${rnd()}`, password: secret('pw'), passwordConfirm: 'x' });
      assert.deepStrictEqual([noStepup.status, noStepup.body.error], [403, 'stepup_required'], 'no credentials without a fresh confirmation');
      const s = await telegramStepup(c, u.telegram_user_id);
      assert.strictEqual(s.approved, true);
      assert.deepStrictEqual((await c.get(`/api/account/credentials/stepup/${s.token}`)).body, { approved: true, expired: false });
      const login = `Ali.Valiyev${rnd() % 1000}`;
      const pw = secret('Pw');
      const set = await c.post('/api/account/credentials', { stepupToken: s.token, login, password: pw, passwordConfirm: pw });
      assert.deepStrictEqual([set.status, set.body.ok, set.body.login], [200, true, login.toLowerCase()]);
      const row = (await pool.query('SELECT id, role, username, credentials_set_at, telegram_user_id FROM admins WHERE id = $1', [u.id])).rows[0];
      assert.deepStrictEqual([row.role, row.username, !!row.credentials_set_at, String(row.telegram_user_id)], ['user', login.toLowerCase(), true, String(u.telegram_user_id)], 'one account: role and Telegram link kept');
      const c2 = client();
      const ok = await c2.login(login.toUpperCase(), pw);
      assert.deepStrictEqual([ok.status, ok.body.role], [200, 'user']);
      assert.strictEqual((await c2.get('/whoami')).body.adminId, u.id, 'the same user_id');
      assert.strictEqual(await balanceOf(u.id), before, 'the same quota and subscription: nothing new granted');
      const count = await pool.query('SELECT count(*)::int AS n FROM admins WHERE telegram_user_id = $1', [u.telegram_user_id]);
      assert.strictEqual(count.rows[0].n, 1, 'no second account');
      // Telegram sign-in still opens the same account
      const c3 = client(); await c3.tg(u);
      assert.strictEqual((await c3.get('/whoami')).body.adminId, u.id);
    });

    await test('only the Telegram id linked to the account can approve; a step-up belongs to its account and its session; used once; expires', async () => {
      const u = await makeAccount();
      const other = await makeAccount();
      const c = client(); await c.tg(u);
      const s = await telegramStepup(c, other.telegram_user_id);
      assert.strictEqual(s.approved, false, 'another Telegram account cannot approve');
      assert.match(s.text, /boshqa JuristAI hisobi/u);
      assert.deepStrictEqual((await c.get(`/api/account/credentials/stepup/${s.token}`)).body.approved, false);
      // the other person, signed in, cannot see or use this step-up
      const co = client(); await co.tg(other);
      assert.strictEqual((await co.get(`/api/account/credentials/stepup/${s.token}`)).status, 404);
      await credentials.approveStepupFromTelegram(pool, s.token, u.telegram_user_id);
      const pw = secret('Pw');
      const stolen = await co.post('/api/account/credentials', { stepupToken: s.token, login: `thief${rnd()}`, password: pw, passwordConfirm: pw });
      assert.deepStrictEqual([stolen.status, stolen.body.error], [403, 'stepup_required'], 'a step-up of another account is refused');
      // the same account in another browser session cannot use it either
      const c2 = client(); await c2.tg(u);
      const otherSession = await c2.post('/api/account/credentials', { stepupToken: s.token, login: `same${rnd()}`, password: pw, passwordConfirm: pw });
      assert.strictEqual(otherSession.status, 403, 'bound to the session that asked');
      const login = `once${rnd()}`;
      const first = await c.post('/api/account/credentials', { stepupToken: s.token, login, password: pw, passwordConfirm: pw });
      assert.strictEqual(first.status, 200, JSON.stringify(first.body));
      const again = await c.post('/api/account/credentials', { stepupToken: s.token, login: `${login}x`, password: pw, passwordConfirm: pw });
      assert.strictEqual(again.status, 403, 'used once');
      // expired
      const s2 = await telegramStepup(c, u.telegram_user_id);
      credentials._stepups.get(s2.token).createdAt -= credentials.STEPUP_TTL_MS + 1000;
      const late = await c.post('/api/account/credentials', { stepupToken: s2.token, login: `${login}y`, password: pw, passwordConfirm: pw });
      assert.strictEqual(late.status, 403, 'expired after 5 minutes');
      assert.match((await credentials.approveStepupFromTelegram(pool, s2.token, u.telegram_user_id)).text, /muddati o'tgan/u);
    });

    await test('a login is unique case-insensitively (another user, a staff account); the format and the password rules hold', async () => {
      const taken = await makeAccount({ login: `taken${rnd()}` });
      const master = await makeAccount({ role: 'master', login: `boss${rnd()}`, password: secret('M') });
      const u = await makeAccount();
      const c = client(); await c.tg(u);
      const pw = secret('Pw');
      for (const login of [taken.username.toUpperCase(), master.username]) {
        const s = await telegramStepup(c, u.telegram_user_id);
        const r = await c.post('/api/account/credentials', { stepupToken: s.token, login, password: pw, passwordConfirm: pw });
        assert.deepStrictEqual([r.status, r.body.error], [409, 'login_taken'], login);
      }
      const cases = [['ab', 'login_format'], ['9lives', 'login_format'], ['admin', 'login_reserved'], [`tg${rnd()}`, 'login_reserved']];
      for (const [login, code] of cases) {
        const s = await telegramStepup(c, u.telegram_user_id);
        const r = await c.post('/api/account/credentials', { stepupToken: s.token, login, password: pw, passwordConfirm: pw });
        assert.deepStrictEqual([r.status, r.body.error], [400, code], login);
      }
      const good = `vali${rnd()}`;
      for (const [p, p2, code] of [['short', 'short', 'password_short'], [pw, `${pw}x`, 'password_mismatch'], [`${good}12345`, `${good}12345`, 'password_has_login'], ['aaaaaaaaaaaa', 'aaaaaaaaaaaa', 'password_weak']]) {
        const s = await telegramStepup(c, u.telegram_user_id);
        const r = await c.post('/api/account/credentials', { stepupToken: s.token, login: good, password: p, passwordConfirm: p2 });
        assert.deepStrictEqual([r.status, r.body.error], [400, code], code);
      }
      const after = (await pool.query('SELECT username, password FROM admins WHERE id = ANY($1) ORDER BY id', [[taken.id, master.id]])).rows;
      assert.deepStrictEqual(after.map(x => x.username), [taken.username, master.username], 'other accounts untouched');
      assert.deepStrictEqual(after.map(x => x.password), [taken.password, master.password]);
    });

    await test('a wrong password and an unknown login answer alike; 10 failures lock that login for 15 minutes, not others', async () => {
      credentials.resetThrottle();
      const pw = secret('Pw');
      const u = await makeAccount({ login: `lock${rnd()}`, password: pw });
      const other = await makeAccount({ login: `free${rnd()}`, password: pw });
      const c = client();
      const wrong = await c.login(u.username, `${pw}!`);
      const unknown = await c.login(`ghost${rnd()}`, pw);
      assert.deepStrictEqual([wrong.status, wrong.body], [unknown.status, unknown.body]);
      for (let i = 0; i < credentials.LOGIN_FAILS; i++) await c.login(u.username, `${pw}${i}`);
      const locked = await c.login(u.username, pw);
      assert.deepStrictEqual([locked.status, locked.body.error], [429, credentials.THROTTLED_ERROR], 'even the right password waits');
      for (let i = 0; i < credentials.LOGIN_FAILS; i++) await c.login(`ghost-${u.id}`, `${pw}${i}`);
      assert.strictEqual((await c.login(`ghost-${u.id}`, pw)).status, 429, 'an unknown login locks the same way');
      assert.strictEqual((await client().login(other.username, pw)).status, 200, 'another login is not affected');
      credentials.resetThrottle();
    });

    await test('changing the password needs a fresh confirmation too (current password or Telegram); 5 wrong current passwords stop it', async () => {
      const pw = secret('Pw');
      const u = await makeAccount({ login: `chg${rnd()}`, password: pw });
      const c = client(); assert.strictEqual((await c.login(u.username, pw)).status, 200);
      assert.deepStrictEqual((await c.get('/api/account/credentials')).body.stepupMethods, ['telegram', 'password']);
      const bad = await c.post('/api/account/credentials/stepup', { method: 'password', currentPassword: `${pw}-no` });
      assert.deepStrictEqual([bad.status, bad.body.error], [403, 'wrong_password']);
      const good = await c.post('/api/account/credentials/stepup', { method: 'password', currentPassword: pw });
      assert.deepStrictEqual([good.status, good.body.approved], [200, true]);
      const pw2 = secret('Pw2');
      const r = await c.post('/api/account/credentials', { stepupToken: good.body.token, login: u.username, password: pw2, passwordConfirm: pw2 });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual((await client().login(u.username, pw)).status, 401, 'the old password no longer opens it');
      assert.strictEqual((await client().login(u.username, pw2)).status, 200);
      for (let i = 0; i < 5; i++) await c.post('/api/account/credentials/stepup', { method: 'password', currentPassword: `wrong${i}` });
      const stopped = await c.post('/api/account/credentials/stepup', { method: 'password', currentPassword: pw2 });
      assert.deepStrictEqual([stopped.status, stopped.body.error], [429, 'throttled']);
      // an account whose owner never set a password cannot use "current password"
      const t = await makeAccount();
      const ct = client(); await ct.tg(t);
      assert.deepStrictEqual((await ct.post('/api/account/credentials/stepup', { method: 'password', currentPassword: 'x' })).body.error, 'no_password');
    });

    await test('forgot the password: sign in with Telegram, confirm with Telegram, set a new one; every other session ends', async () => {
      const pw = secret('Pw');
      const u = await makeAccount({ login: `forgot${rnd()}`, password: pw });
      const laptop = client(); assert.strictEqual((await laptop.login(u.username, pw)).status, 200);
      const phone = client(); assert.strictEqual((await phone.login(u.username, pw)).status, 200);
      assert.strictEqual((await phone.get('/whoami')).status, 200);
      const now = client(); await now.tg(u);
      const s = await telegramStepup(now, u.telegram_user_id);
      const pw2 = secret('New');
      const r = await now.post('/api/account/credentials', { stepupToken: s.token, login: u.username, password: pw2, passwordConfirm: pw2 });
      assert.deepStrictEqual([r.status, r.body.otherSessionsEnded], [200, true]);
      assert.strictEqual((await laptop.get('/whoami')).status, 401, 'old sessions end');
      assert.strictEqual((await phone.get('/whoami')).status, 401);
      assert.strictEqual((await now.get('/whoami')).status, 200, 'the session that changed it stays');
      assert.strictEqual((await client().login(u.username, pw2)).status, 200);
    });

    await test('no other user or role is affected: staff cannot use this page; a set-up never changes a role', async () => {
      const lawyer = await makeAccount({ role: 'lawyer' });
      const c = client(); await c.tg(lawyer);
      const s = await c.post('/api/account/credentials/stepup', { method: 'telegram' });
      assert.deepStrictEqual([s.status, s.body.error], [403, 'not_for_role']);
      assert.strictEqual((await c.get('/api/account/credentials')).body.canManage, false);
      // even with a token in hand (made directly), the update refuses a non-user row
      const out = await credentials.setCredentials(pool, { adminId: lawyer.id, sid: null, login: `law${rnd()}`, password: secret('P'), confirm: undefined });
      assert.deepStrictEqual([out.status, out.error], [403, 'not_for_role']);
      const row = (await pool.query('SELECT role, username, password FROM admins WHERE id = $1', [lawyer.id])).rows[0];
      assert.deepStrictEqual([row.role, row.username, row.password], ['lawyer', lawyer.username, lawyer.password]);
      // an ordinary user cannot create a test account
      const u = await makeAccount(); const cu = client(); await cu.tg(u);
      assert.strictEqual((await cu.post('/api/admin/test-users', { login: `x${rnd()}`, password: 'x', masterPassword: 'x' })).status, 403);
    });

    await test('master login (regression): a linked master gets the Telegram code first; an unlinked one signs in; a published password is refused', async () => {
      credentials.resetThrottle();
      const pw = secret('Master');
      const linked = await makeAccount({ role: 'master', login: `mst${rnd()}`, password: pw });
      const c = client();
      const step1 = await c.login(linked.username, pw);
      assert.deepStrictEqual([step1.status, step1.body.twofa], [200, true]);
      assert.strictEqual((await c.get('/whoami')).status, 401, 'no session before the second factor');
      const sent = botMessages.filter(m => m.to === String(linked.telegram_user_id)).pop();
      const code = /(\d{6})/u.exec(sent.text)[1];
      assert.strictEqual((await c.post('/api/login/2fa', { token: step1.body.token, code: '000000' === code ? '111111' : '000000' })).status, 401);
      const step2 = await c.post('/api/login/2fa', { token: step1.body.token, code });
      assert.deepStrictEqual([step2.status, step2.body.role], [200, 'master']);
      assert.deepStrictEqual((await c.get('/whoami')).body.role, 'master');
      const unlinked = await makeAccount({ role: 'master', login: `mst2${rnd()}`, password: pw, telegram: false });
      const c2 = client();
      assert.deepStrictEqual((await c2.login(unlinked.username, pw)).body.role, 'master');
      const published = await makeAccount({ role: 'master', login: `mst3${rnd()}`, password: 'juristAI', telegram: false });
      const c3 = client();
      const refused = await c3.login(published.username, 'juristAI');
      assert.deepStrictEqual([refused.status, refused.body.code], [403, 'PASSWORD_MUST_CHANGE']);
      assert.strictEqual((await c3.get('/whoami')).status, 401);
      // a new session id at sign-in: a session that existed before the
      // password login is not the one that ends up signed in (no fixation)
      const someone = await makeAccount({ login: `fix${rnd()}`, password: pw });
      const c4 = client(); await c4.tg(someone);
      const sidBefore = (await c4.get('/whoami')).body.sid;
      assert.strictEqual((await c4.login(someone.username, pw)).status, 200);
      const sidAfter = (await c4.get('/whoami')).body.sid;
      assert.ok(sidBefore && sidAfter && sidBefore !== sidAfter, 'the session id changes at sign-in');
      const oldRow = await pool.query('SELECT count(*)::int AS n FROM user_sessions WHERE sid = $1', [sidBefore]);
      assert.strictEqual(oldRow.rows[0].n, 0, 'the old session is gone');
    });

    await test('master creates an ordinary test account: re-auth, role user, no plan or payment, normal Sinov, no second Sinov after Telegram', async () => {
      credentials.resetThrottle();
      const mpw = secret('Master');
      const master = await makeAccount({ role: 'master', login: `own${rnd()}`, password: mpw, telegram: false });
      const cm = client(); assert.strictEqual((await cm.login(master.username, mpw)).status, 200);
      const login = `sinovtest${rnd()}`;
      const tpw = secret('Test');
      const wrong = await cm.post('/api/admin/test-users', { login, password: tpw, passwordConfirm: tpw, masterPassword: `${mpw}x` });
      assert.deepStrictEqual([wrong.status, wrong.body.error], [403, 'master_password']);
      const made_ = await cm.post('/api/admin/test-users', { login, fullName: 'Sinov Tester', password: tpw, passwordConfirm: tpw, masterPassword: mpw });
      assert.deepStrictEqual([made_.status, made_.body.user.role, made_.body.user.login], [200, 'user', login]);
      const id = made_.body.user.id; made.push(id);
      const row = (await pool.query('SELECT role, tariff_plan, telegram_user_id, created_by_master_id, credentials_set_at FROM admins WHERE id = $1', [id])).rows[0];
      assert.deepStrictEqual([row.role, row.tariff_plan, row.telegram_user_id, row.created_by_master_id, !!row.credentials_set_at], ['user', null, null, master.id, true]);
      const periods = await pool.query('SELECT count(*)::int AS n FROM tariff_periods WHERE admin_id = $1', [id]);
      assert.strictEqual(periods.rows[0].n, 0, 'no plan, no payment, no revenue row');
      const dup = await cm.post('/api/admin/test-users', { login: login.toUpperCase(), password: tpw, passwordConfirm: tpw, masterPassword: mpw });
      assert.strictEqual(dup.status, 409);
      // it signs in like anyone, as an ordinary user
      const ct = client();
      assert.deepStrictEqual((await ct.login(login, tpw)).body.role, 'user');
      assert.strictEqual((await ct.post('/api/admin/test-users', {})).status, 403, 'no admin rights');
      // ordinary Sinov on first use, the usual limits
      const r = await ledger.reserve({ adminId: id, service: 'chat', units: 1, endpoint: '/api/legal-chat', channel: 'web', actorId: id });
      assert.strictEqual(r.allowed, true); await ledger.commit(r.jobKey);
      const b1 = await ledger.balance({ adminId: id });
      assert.deepStrictEqual([b1.kind, b1.services.chat.limit, b1.services.chat.used], ['trial', ledger.PLAN_CATALOG.sinov.quotas.chat, 1]);
      // later a Telegram account that had its own Sinov is linked: still one Sinov
      const tg = 6900000000 + rnd();
      const rt = await ledger.reserve({ telegramUserId: tg, service: 'chat', units: 1, endpoint: 'telegram', channel: 'telegram', actorId: null });
      assert.strictEqual(rt.allowed, true, 'the Telegram id had its own Sinov');
      await ledger.commit(rt.jobKey);
      const trials = await pool.query(`SELECT subject FROM tariff_periods WHERE source = 'trial' AND subject = ANY($1)`, [[`a:${id}`, `t:${tg}`]]);
      assert.strictEqual(trials.rows.length, 2, 'two trial rows exist before the link: the account\'s and the Telegram id\'s');
      await pool.query('UPDATE admins SET telegram_user_id = $2 WHERE id = $1', [id, tg]);
      const b2 = await ledger.balance({ adminId: id });
      assert.strictEqual(b2.services.chat.limit, ledger.PLAN_CATALOG.sinov.quotas.chat, 'no second Sinov, no new quota');
      assert.ok(b2.services.chat.used >= 1);
    });

    await test('PRODUCTION CASE: master (password + Telegram 2FA) creates "test": the master stays signed in, the new account is role user and signs in with its own password', async () => {
      credentials.resetThrottle();
      const mpw = secret('Master');
      const master = await makeAccount({ role: 'master', login: `own2fa${rnd()}`, password: mpw });
      const cm = client();
      const s1 = await cm.login(master.username, mpw);
      assert.strictEqual(s1.body.twofa, true);
      const code = /(\d{6})/u.exec(botMessages.filter(m => m.to === String(master.telegram_user_id)).pop().text)[1];
      assert.strictEqual((await cm.post('/api/login/2fa', { token: s1.body.token, code })).status, 200);
      assert.deepStrictEqual((await cm.get('/whoami')).body.role, 'master');
      const login = `test${rnd() % 100000}`;
      const tpw = secret('Tst');
      // a wrong master password: nothing created, the master stays signed in,
      // and the reply is not a 401 (the page read a 401 as "signed out")
      const wrong = await cm.post('/api/admin/test-users', { login, password: tpw, passwordConfirm: tpw, masterPassword: `${mpw}x` });
      assert.deepStrictEqual([wrong.status, wrong.body.error], [403, 'master_password']);
      assert.match(wrong.body.message, /Hisob yaratilmadi; siz tizimda qolasiz/u);
      assert.deepStrictEqual((await cm.get(`/api/admin/test-users?login=${login}`)).body.lookup.exists, false, 'no account');
      const me1 = await cm.get('/whoami');
      assert.deepStrictEqual([me1.status, me1.body.adminId, me1.body.role], [200, master.id, 'master'], 'master session kept');
      // the right one
      const ok = await cm.post('/api/admin/test-users', { login, fullName: 'Test', password: tpw, passwordConfirm: tpw, masterPassword: mpw });
      assert.deepStrictEqual([ok.status, ok.body.user.role, ok.body.user.login], [200, 'user', login]);
      made.push(ok.body.user.id);
      assert.ok(ok.body.user.id !== master.id);
      const me2 = await cm.get('/whoami');
      assert.deepStrictEqual([me2.status, me2.body.adminId, me2.body.role, me2.body.sid], [200, master.id, 'master', me1.body.sid], 'the same master session, not the new user\'s');
      // diagnostics: ids, logins, roles, dates; never a secret
      const diag = await cm.get(`/api/admin/test-users?login=${login.toUpperCase()}`);
      assert.deepStrictEqual([diag.body.lookup.exists, diag.body.lookup.account.id, diag.body.lookup.account.role, diag.body.lookup.account.createdByMaster, diag.body.lookup.account.credentialsSet],
        [true, ok.body.user.id, 'user', master.id, true]);
      assert.ok(diag.body.created.some(u => u.id === ok.body.user.id));
      assert.ok(!/password|hash|\$2[aby]\$|sess|telegram_user_id/iu.test(JSON.stringify(diag.body).replace(/"telegramLinked"/gu, '')), 'no secrets in diagnostics');
      // the new account signs in with its own password, in its own session
      const cu = client();
      const lu = await cu.login(login, tpw);
      assert.deepStrictEqual([lu.status, lu.body.role], [200, 'user']);
      assert.strictEqual((await cu.get('/whoami')).body.adminId, ok.body.user.id);
      assert.strictEqual((await cm.get('/whoami')).body.adminId, master.id, 'and the master is still the master');
      // five wrong master passwords stop the form for 15 minutes; still signed in
      for (let i = 0; i < 5; i++) await cm.post('/api/admin/test-users', { login: `${login}z`, password: tpw, passwordConfirm: tpw, masterPassword: `bad${i}` });
      assert.strictEqual((await cm.post('/api/admin/test-users', { login: `${login}z`, password: tpw, passwordConfirm: tpw, masterPassword: mpw })).status, 429);
      assert.strictEqual((await cm.get('/whoami')).status, 200);
      // the page sends only a missing session to sign-in
      const page = fs.readFileSync(path.join(__dirname, '../public/account.html'), 'utf8');
      assert.ok(/if \(r\.status === 401 && \(!d \|\| !d\.error \|\| d\.error === 'Unauthorized'\)\)/u.test(page));
      assert.ok(!/if \(r\.status === 401\) \{ location\.href/u.test(page));
    });

    // ── Telegram sign-in: a link opened by someone else signs no one in ──
    const appUrl = 'https://juristai.example';
    const bot = (param, from) => handleAuthStart(param, from, { pool, loginSessions, regSessions, verificationTokens, appUrl });
    const codeIn = (text) => { const m = /kod[a-z' ]*: (\d{6})/iu.exec(text || ''); return m ? m[1] : null; };
    const tgFrom = (row) => ({ id: Number(row.telegram_user_id), first_name: 'T', username: row.telegram_username || null });

    await test('ATTACK: A starts a Telegram sign-in, B opens the link in B\'s Telegram -> A is NOT signed in to B; the code goes to B only', async () => {
      const victim = await makeAccount();
      const a = client();
      const start = await a.post('/api/login-session');
      assert.strictEqual(start.status, 200);
      assert.ok(a.jar.has('jai_tga_login'), 'the starting browser is marked by a cookie');
      const text = await bot(`login_${start.body.token}`, tgFrom(victim));
      const code = codeIn(text);
      assert.ok(code, 'B gets a code in B\'s own chat');
      assert.match(text, /KIRISH uchun/u, 'the bot names the action');
      assert.match(text, /hech kimga bermang/u, 'and warns not to give the code away');
      // A only learns that a code was sent - never the code, never "approved"
      const st = await a.get(`/api/telegram-auth/status/login/${start.body.token}`);
      assert.deepStrictEqual(st.body, { codeSent: true, expired: false });
      assert.ok(!JSON.stringify(st.body).includes(code));
      // what the old page did ("APPROVED") and guessing do not sign A in
      const old = await a.post('/api/login/telegram-otp', { token: start.body.token, otp_code: 'APPROVED' });
      assert.strictEqual(old.status, 400);
      assert.strictEqual((await a.get('/whoami')).status, 401, 'A is not signed in');
      for (let i = 0; i < 3; i++) await a.post('/api/login/telegram-otp', { token: start.body.token, otp_code: String(100000 + i) });
      assert.strictEqual((await a.get('/whoami')).status, 401);
    });

    await test('the right person: the code from their own Telegram, typed in the browser that started -> their account, a new session id', async () => {
      const u = await makeAccount();
      const c = client();
      const start = await c.post('/api/login-session');
      const code = codeIn(await bot(`login_${start.body.token}`, tgFrom(u)));
      const ok = await c.post('/api/login/telegram-otp', { token: start.body.token, otp_code: code });
      assert.deepStrictEqual([ok.status, ok.body.success], [200, true]);
      assert.strictEqual((await c.get('/whoami')).body.adminId, u.id);
      // the same code again: spent
      const again = await c.post('/api/login/telegram-otp', { token: start.body.token, otp_code: code });
      assert.strictEqual(again.status, 400, 'used once');
    });

    await test('a code works only in the browser that started it, only for its flow, only for the Telegram id that opened the link', async () => {
      const u = await makeAccount();
      const other = await makeAccount();
      const c = client();
      const start = await c.post('/api/login-session');
      const code = codeIn(await bot(`login_${start.body.token}`, tgFrom(u)));
      // another Telegram account cannot take over a link already opened
      const second = await bot(`login_${start.body.token}`, tgFrom(other));
      assert.match(second, /boshqa Telegram hisobi uchun allaqachon ochilgan/u);
      assert.strictEqual(codeIn(second), null);
      // another browser (no cookie, or its own cookie) with the right token and code
      const thief = client();
      await thief.post('/api/login-session');
      const t1 = await thief.post('/api/login/telegram-otp', { token: start.body.token, otp_code: code });
      assert.deepStrictEqual([t1.status, t1.body.code], [400, 'other_browser']);
      // another flow: the login link at the registration endpoint, and the other way round
      const asReg = await c.post('/api/register/telegram-otp', { token: start.body.token, otp_code: code });
      assert.deepStrictEqual([asReg.status, asReg.body.code], [400, 'not_found']);
      const reg = await c.post('/api/reg-session');
      const regCode = codeIn(await bot(`reg_${reg.body.token}`, tgFrom(u)));
      const regAsLogin = await c.post('/api/login/telegram-otp', { token: reg.body.token, otp_code: regCode });
      assert.deepStrictEqual([regAsLogin.status, regAsLogin.body.code], [400, 'not_found']);
      // tokens of one flow do nothing in the bot under another prefix
      assert.match(await bot(`reg_${start.body.token}`, tgFrom(u)), /topilmadi|muddati/u);
      assert.match(await bot(`stepup_${start.body.token}`, tgFrom(u)), /topilmadi|muddati/u);
      assert.match(await bot(`recover_${start.body.token}`, tgFrom(u)), /topilmadi|muddati/u);
      // the real browser still signs in with its code
      const ok = await c.post('/api/login/telegram-otp', { token: start.body.token, otp_code: code });
      assert.strictEqual(ok.status, 200);
      assert.strictEqual((await c.get('/whoami')).body.adminId, u.id);
    });

    await test('expired codes, five wrong tries, at most three codes a link; two parallel requests with one code -> only one passes', async () => {
      const u = await makeAccount();
      const c = client();
      let start = await c.post('/api/login-session');
      let code = codeIn(await bot(`login_${start.body.token}`, tgFrom(u)));
      loginSessions.get(start.body.token).codeIssuedAt -= 5 * 60 * 1000 + 1000;
      assert.deepStrictEqual((await c.post('/api/login/telegram-otp', { token: start.body.token, otp_code: code })).body.code, 'expired');
      start = await c.post('/api/login-session');
      code = codeIn(await bot(`login_${start.body.token}`, tgFrom(u)));
      for (let i = 0; i < 4; i++) assert.strictEqual((await c.post('/api/login/telegram-otp', { token: start.body.token, otp_code: '000000' === code ? '111111' : '000000' })).body.code, 'wrong_code');
      assert.deepStrictEqual((await c.post('/api/login/telegram-otp', { token: start.body.token, otp_code: '999999' === code ? '888888' : '999999' })).status, 429);
      assert.strictEqual((await c.post('/api/login/telegram-otp', { token: start.body.token, otp_code: code })).status, 400, 'locked: even the right code');
      start = await c.post('/api/login-session');
      for (let i = 0; i < 3; i++) assert.ok(codeIn(await bot(`login_${start.body.token}`, tgFrom(u))));
      assert.match(await bot(`login_${start.body.token}`, tgFrom(u)), /kodlar soni tugadi/u);
      start = await c.post('/api/login-session');
      code = codeIn(await bot(`login_${start.body.token}`, tgFrom(u)));
      const both = await Promise.all([c.post('/api/login/telegram-otp', { token: start.body.token, otp_code: code }), c.post('/api/login/telegram-otp', { token: start.body.token, otp_code: code })]);
      assert.deepStrictEqual(both.map(x => x.status).sort(), [200, 400], 'exactly one');
    });

    await test('registration: a new Telegram user gets an account by the code; an existing one is signed in; the link never approves by itself', async () => {
      const c = client();
      const reg = await c.post('/api/reg-session');
      const tg = { id: 6800000000 + rnd(), first_name: 'Yangi', last_name: 'User', username: `new${rnd()}` };
      const text = await bot(`reg_${reg.body.token}`, tg);
      assert.match(text, /RO'YXATDAN O'TISH uchun/u);
      assert.deepStrictEqual((await c.get(`/api/telegram-auth/status/register/${reg.body.token}`)).body, { codeSent: true, expired: false });
      assert.strictEqual((await c.get('/whoami')).status, 401, 'opening the link created no session');
      const r = await c.post('/api/register/telegram-otp', { token: reg.body.token, otp_code: codeIn(text) });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      const row = (await pool.query('SELECT id, role FROM admins WHERE telegram_user_id = $1', [tg.id])).rows[0];
      made.push(row.id);
      assert.deepStrictEqual([row.role, (await c.get('/whoami')).body.adminId], ['user', row.id]);
    });

    await test('recovery: an ordinary account gets no reset link; a staff account gets a single-use one in its own chat; the browser learns only "confirmed"', async () => {
      const user = await makeAccount();
      const t1 = createRecoverLink(verificationTokens);
      const before = [...verificationTokens.keys()].filter(k => k.startsWith('pwreset_')).length;
      const textU = await bot(`recover_${t1}`, tgFrom(user));
      assert.match(textU, /Kirish usullari/u);
      assert.ok(!/recover=/u.test(textU), 'no reset link for an ordinary account');
      assert.strictEqual([...verificationTokens.keys()].filter(k => k.startsWith('pwreset_')).length, before);
      assert.match(await bot(`recover_${t1}`, tgFrom(user)), /topilmadi|muddati/u, 'a recovery link is used once');
      // staff
      const pw = secret('Staff');
      const lawyer = await makeAccount({ role: 'lawyer', login: `law${rnd()}`, password: pw });
      const session1 = client(); assert.strictEqual((await session1.login(lawyer.username, pw)).status, 200);
      const t2 = createRecoverLink(verificationTokens);
      const textS = await bot(`recover_${t2}`, tgFrom(lawyer));
      const link = /recover=([0-9a-f]{40})/u.exec(textS);
      assert.ok(link, 'a reset link in the staff member\'s own chat');
      assert.match(textS, /hech kimga yubormang/u);
      assert.deepStrictEqual(verificationTokens.get(`botinit_${t2}`).confirmed, true);
      // somebody else opening the same staff link later gets nothing
      assert.match(await bot(`recover_${t2}`, tgFrom(user)), /topilmadi|muddati/u);
      const npw = secret('NewStaff');
      const both = await Promise.all([resetWithLink(pool, verificationTokens, link[1], npw), resetWithLink(pool, verificationTokens, link[1], npw)]);
      assert.deepStrictEqual(both.map(x => (x ? x.status : null)).sort(), [200, null], 'single use, also in parallel');
      assert.strictEqual((await session1.get('/whoami')).status, 401, 'sessions end');
      credentials.resetThrottle();
      assert.strictEqual((await client().login(lawyer.username, npw)).status, 200);
      // a reset link made for an ordinary account (as Google recovery could) is refused
      verificationTokens.set('pwreset_forged', { adminId: user.id, expiresAt: Date.now() + 60000 });
      assert.deepStrictEqual((await resetWithLink(pool, verificationTokens, 'forged', npw)).code, 'USE_ACCOUNT_PAGE');
      // a master who reset still gets the Telegram second factor
      const mpw = secret('Mst');
      const master = await makeAccount({ role: 'master', login: `rm${rnd()}`, password: mpw });
      const t3 = createRecoverLink(verificationTokens);
      const ml = /recover=([0-9a-f]{40})/u.exec(await bot(`recover_${t3}`, tgFrom(master)))[1];
      const mpw2 = secret('Mst2');
      assert.strictEqual((await resetWithLink(pool, verificationTokens, ml, mpw2)).status, 200);
      const mc = client();
      const m1 = await mc.login(master.username, mpw2);
      assert.deepStrictEqual([m1.status, m1.body.twofa], [200, true], 'master 2FA kept after a reset');
      assert.strictEqual((await mc.get('/whoami')).status, 401);
    });

    await test('CSRF: a cross-site page cannot set credentials, step up, create a test user or finish a Telegram sign-in with the cookie', async () => {
      const pw = secret('Pw');
      const u = await makeAccount({ login: `csrf${rnd()}`, password: pw });
      const evil = client({ origin: 'https://evil.example' });
      // the evil page rides on a real signed-in cookie
      const good = client(); assert.strictEqual((await good.login(u.username, pw)).status, 200);
      for (const [k, v] of good.jar) evil.jar.set(k, v);
      const none = client({ origin: null }); for (const [k, v] of good.jar) none.jar.set(k, v);
      for (const c of [evil, none]) {
        assert.strictEqual((await c.post('/api/account/credentials/stepup', { method: 'password', currentPassword: pw })).status, 403);
        assert.strictEqual((await c.post('/api/account/credentials', { stepupToken: 'x', login: `z${rnd()}`, password: pw, passwordConfirm: pw })).status, 403);
        assert.strictEqual((await c.post('/api/admin/test-users', { login: `z${rnd()}` })).status, 403);
        assert.strictEqual((await c.post('/api/login/telegram-otp', { token: 'x', otp_code: '123456' })).status, 403);
        assert.strictEqual((await c.post('/api/register/telegram-otp', { token: 'x', otp_code: '123456' })).status, 403);
      }
      assert.deepStrictEqual((await evil.post('/api/account/credentials/stepup', { method: 'password', currentPassword: pw })).body.error, 'cross_site');
      // a Referer from this site is enough when Origin is missing
      const refOnly = client({ origin: null }); for (const [k, v] of good.jar) refOnly.jar.set(k, v);
      assert.strictEqual((await refOnly.post('/api/account/credentials/stepup', { method: 'password', currentPassword: pw }, { referer: `${base}/account.html` })).status, 200);
      // the same site goes through
      assert.strictEqual((await good.post('/api/account/credentials/stepup', { method: 'password', currentPassword: pw })).status, 200);
      const sess = (await pool.query('SELECT sess FROM user_sessions LIMIT 1')).rows[0];
      assert.ok(sess, 'sessions are stored');
    });

    await test('no reply, audit row or bot message carries a password or a hash', async () => {
      const text = JSON.stringify([replies, audits, botMessages]);
      assert.ok(!/\$2[aby]\$\d\d\$/u.test(text), 'no bcrypt hash');
      assert.ok(!/"password"\s*:/u.test(JSON.stringify(replies)), 'no password field in a reply');
      assert.ok(!/(Pw|Pw2|New|Master|Test)-[A-Za-z0-9_-]{12}/u.test(text), 'no test password anywhere');
    });

    await test('recovery: the browser never gets a reset token; the username-based request is closed; an ordinary account uses its account page', () => {
      const server_ = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
      const status = server_.slice(server_.indexOf("app.get('/api/recover/status/:token'"), server_.indexOf("// ========== COMMON USER REGISTRATION"));
      assert.ok(!/resetToken/u.test(status.replace(/^\/\/.*$/gmu, '')), 'status hands no reset token to the browser');
      const req_ = server_.slice(server_.indexOf("app.post('/api/password-recovery/request'"), server_.indexOf('const RECOVERY_MAX_TRIES'));
      assert.ok(/status\(410\)/u.test(req_) && !/telegram_username/u.test(req_.replace(/^\/\/.*$/gmu, '')), 'no lookup by Telegram username');
      const recovery = fs.readFileSync(path.join(__dirname, '../src/auth/recovery.js'), 'utf8');
      assert.ok(/target\.role === 'user'/u.test(recovery) && /resetWithLink/u.test(server_), 'a reset link does not set an ordinary account password');
      // a reset link unknown here (used, expired, issued before a restart) gets a plain message
      const reset = server_.slice(server_.indexOf("app.post('/api/password-recovery/reset'"));
      assert.ok(/if \(!code\) return res\.status\(400\)\.json\(\{ error: "Tiklash havolasi eskirgan yoki allaqachon ishlatilgan/u.test(reset));
      const regBot = fs.readFileSync(path.join(__dirname, '../src/bot/reg-bot.js'), 'utf8');
      const authStart = fs.readFileSync(path.join(__dirname, '../src/bot/auth-start.js'), 'utf8');
      assert.ok(/row\.role === 'user'/u.test(authStart) && /auth-start/u.test(regBot) && !/'APPROVED'/u.test(regBot + authStart));
      assert.ok(!/s\.resetToken = resetToken/u.test(regBot + fs.readFileSync(path.join(__dirname, '../src/bot/bot.js'), 'utf8')));
      const login = fs.readFileSync(path.join(__dirname, '../public/login.html'), 'utf8');
      assert.ok(!/d\.resetToken/u.test(login));
    });
  } finally {
    if (made.length) {
      await pool.query(`DELETE FROM user_sessions WHERE (sess->>'adminId') = ANY($1::text[])`, [made.map(String)]).catch(() => {});
      await pool.query('DELETE FROM tariff_usage WHERE admin_id = ANY($1)', [made]).catch(() => {});
      await pool.query('DELETE FROM tariff_periods WHERE admin_id = ANY($1)', [made]).catch(() => {});
      await pool.query('DELETE FROM admins WHERE id = ANY($1)', [made]).catch(() => {});
    }
    server.close();
    await pool.end().catch(() => {});
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
