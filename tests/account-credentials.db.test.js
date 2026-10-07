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
    'telegram_user_id bigint', 'telegram_chat_id bigint', 'channel_verified_at timestamptz', 'survey_completed_at timestamptz', 'free_gate_since timestamptz']) {
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
function client() {
  let cookie = '';
  const call = async (method, p, json) => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: json ? JSON.stringify(json) : undefined });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  return {
    get: p => call('GET', p), post: (p, j) => call('POST', p, j || {}),
    login: (username, password) => call('POST', '/api/login', { username, password }),
    tg: (row) => call('POST', '/test/telegram-signin', { tg: String(row.telegram_user_id) }),
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
      assert.deepStrictEqual([bad.status, bad.body.error], [401, 'wrong_password']);
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
      assert.deepStrictEqual([wrong.status, wrong.body.error], [401, 'master_password']);
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
      assert.ok(/target\.role === 'user'/u.test(server_), 'a reset link does not set an ordinary account password');
      const regBot = fs.readFileSync(path.join(__dirname, '../src/bot/reg-bot.js'), 'utf8');
      assert.ok(/row && row\.role === 'user'/u.test(regBot) && /stepup_/u.test(regBot));
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
