'use strict';

/**
 * Master creates an ordinary test account, end to end through the real
 * server, its session store and Postgres (2026-10-07, production report: the
 * page sent the master to sign-in and no account was made). A wrong master
 * password must not read as "signed out", must create nothing and must keep
 * the master's session; the right one creates a role 'user' account that
 * signs in with its own password in its own session. No AI call.
 *
 * Needs a running server (BASE_URL) and its throwaway database
 * (TEST_DATABASE_URL). Passwords are made at run time, never written down.
 *
 *   BASE_URL=http://localhost:3300 TEST_DATABASE_URL=postgresql://... PGSSL=disable node tests/test-user.e2e.test.js
 */

const assert = require('assert');
const crypto = require('crypto');

const BASE = process.env.BASE_URL;
if (!BASE || !process.env.TEST_DATABASE_URL) {
  console.log('test user (e2e): skipped, BASE_URL and TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\.|juristai\.uz/i.test(process.env.TEST_DATABASE_URL + BASE)) {
  console.error('refusing to run against what looks like production');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const bcrypt = require('bcryptjs');
const { pool } = require('../src/database/db');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const tag = `tu${Date.now().toString(36)}`;
const made = [];
const secret = () => `${crypto.randomBytes(12).toString('base64url')}-Q7`;

/** A browser on this site: its own cookies, its own Origin on every POST. */
function browser() {
  const jar = new Map();
  const call = async (path, { method = 'GET', body = null } = {}) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(`${BASE}${path}`, { method, body: body ? JSON.stringify(body) : undefined,
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { origin: BASE } : {}) } });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  return { call, login: (username, password) => call('/api/login', { method: 'POST', body: { username, password } }) };
}

(async () => {
  console.log('test user (e2e, real server)');
  const masterPw = secret();
  const m = await pool.query(
    `INSERT INTO admins (username, password, full_name, role) VALUES ($1, $2, 'E2E master', 'master') RETURNING id`,
    [`${tag}_master`, await bcrypt.hash(masterPw, 10)]);
  made.push(m.rows[0].id);
  const masterId = m.rows[0].id;
  const M = browser();
  const login = `test${Date.now() % 100000}`;
  const pw = secret();

  try {
    await test('master signs in; a wrong master password creates nothing, is not a 401, and the master stays signed in', async () => {
      assert.strictEqual((await M.login(`${tag}_master`, masterPw)).status, 200);
      assert.strictEqual((await M.call('/api/user-info')).status, 200);
      const wrong = await M.call('/api/admin/test-users', { method: 'POST', body: { login, password: pw, passwordConfirm: pw, masterPassword: `${masterPw}x` } });
      assert.deepStrictEqual([wrong.status, wrong.body.error], [403, 'master_password']);
      const lookup = await M.call(`/api/admin/test-users?login=${login}`);
      assert.deepStrictEqual([lookup.status, lookup.body.lookup.exists], [200, false]);
      assert.strictEqual((await M.call('/api/user-info')).status, 200, 'still signed in');
    });

    let userId = null;
    await test('the right master password: #id · login, role user; the master session is unchanged', async () => {
      const r = await M.call('/api/admin/test-users', { method: 'POST', body: { login, fullName: 'E2E Test', password: pw, passwordConfirm: pw, masterPassword: masterPw } });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.deepStrictEqual([r.body.user.login, r.body.user.role], [login, 'user']);
      userId = r.body.user.id; made.push(userId);
      assert.ok(!JSON.stringify(r.body).includes(pw) && !/\$2[aby]\$/u.test(JSON.stringify(r.body)), 'no password or hash in the reply');
      const me = await M.call('/api/user-info');
      assert.strictEqual(me.status, 200);
      assert.deepStrictEqual([me.body.adminId, me.body.role], [masterId, 'master'], 'the master\'s own session, not the new user\'s');
      const row = (await pool.query('SELECT role, created_by_master_id FROM admins WHERE id = $1', [userId])).rows[0];
      assert.deepStrictEqual([row.role, row.created_by_master_id], ['user', masterId]);
    });

    await test('the new account signs in with its own password, in its own session, as an ordinary user', async () => {
      const U = browser();
      const r = await U.login(login, pw);
      assert.deepStrictEqual([r.status, r.body.role], [200, 'user']);
      const me = await U.call('/api/user-info');
      assert.strictEqual(me.status, 200);
      assert.deepStrictEqual([me.body.adminId, me.body.role], [userId, 'user']);
      assert.strictEqual((await U.call('/api/admin/test-users')).status, 403, 'no master rights');
      assert.strictEqual((await M.call('/api/user-info')).status, 200, 'the master is still signed in');
      assert.strictEqual((await browser().login(login, `${pw}x`)).status, 401, 'a wrong password is refused');
    });
  } finally {
    await pool.query(`DELETE FROM user_sessions WHERE (sess->>'adminId') = ANY($1::text[])`, [made.map(String)]).catch(() => {});
    await pool.query('DELETE FROM audit_log WHERE admin_id = ANY($1)', [made]).catch(() => {});
    await pool.query('DELETE FROM admins WHERE id = ANY($1)', [made]).catch(() => {});
    await pool.end().catch(() => {});
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
