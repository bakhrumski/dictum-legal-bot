'use strict';

/**
 * Word add-in end to end through the real server: the task pane pairs, the
 * signed-in person confirms the code, the task pane gets its token and uses
 * it on the allowed routes only; logout and "disconnect all" end it. No AI call.
 *
 *   BASE_URL=http://localhost:3000 TEST_DATABASE_URL=postgresql://... PGSSL=disable node tests/word-addin.e2e.test.js
 */

const assert = require('assert');
const crypto = require('crypto');

const BASE = process.env.BASE_URL;
if (!BASE || !process.env.TEST_DATABASE_URL) {
  console.log('word add-in (e2e): skipped, BASE_URL and TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\.|juristai\.uz/i.test(process.env.TEST_DATABASE_URL + BASE)) {
  console.error('refusing to run against what looks like production');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const bcrypt = require('bcryptjs');
const { pool } = require('../src/database/db');

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const tag = `wa${Date.now().toString(36)}`;
const made = [];

function browser() {
  const jar = new Map();
  const call = async (path, { method = 'GET', body = null, headers = {} } = {}) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(`${BASE}${path}`, { method, body: body ? JSON.stringify(body) : undefined,
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { origin: BASE } : {}), ...headers } });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
    return { status: r.status, headers: r.headers, body: await r.json().catch(() => ({})) };
  };
  return { call, jar };
}
/** the task pane: no cookies, only its token */
function pane() {
  let token = '';
  const call = async (path, { method = 'GET', body = null } = {}) => {
    const r = await fetch(`${BASE}${path}`, { method, body: body ? JSON.stringify(body) : undefined,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) } });
    return { status: r.status, headers: r.headers, body: await r.json().catch(() => ({})) };
  };
  return { call, setToken: (t) => { token = t; }, get token() { return token; } };
}

(async () => {
  console.log('word add-in (e2e, real server)');
  const pw = `${crypto.randomBytes(12).toString('base64url')}-Q7`;
  const u = await pool.query(
    `INSERT INTO admins (username, password, full_name, role, credentials_set_at) VALUES ($1, $2, 'Word Sinov', 'user', NOW()) RETURNING id`,
    [`${tag}_user`, await bcrypt.hash(pw, 10)]);
  made.push(u.rows[0].id);
  const B = browser(), P = pane();
  let pair;

  try {
    await test('task pane page and manifest are served; the pane may be framed by Office', async () => {
      const r = await fetch(`${BASE}/word/taskpane.html`);
      assert.strictEqual(r.status, 200);
      assert.ok(!r.headers.get('x-frame-options'));
      assert.match(r.headers.get('content-security-policy') || '', /frame-ancestors/);
      const m = await fetch(`${BASE}/word/manifest.xml`);
      const xml = await m.text();
      assert.strictEqual(m.status, 200);
      assert.match(xml, /<SourceLocation DefaultValue="https:\/\/[^"]+\/word\/taskpane\.html"\/>/);
      const other = await fetch(`${BASE}/app/index.html`);
      assert.ok(other.headers.get('x-frame-options'), 'the rest of the site keeps X-Frame-Options');
    });

    await test('pairing: pending until the signed-in person confirms the code', async () => {
      const r = await P.call('/api/addin/pair', { method: 'POST', body: {} });
      assert.strictEqual(r.status, 200);
      pair = r.body;
      assert.match(pair.code, /^[A-Z2-9]{6}$/);
      assert.match(pair.connectUrl, /\/word\/ulash\.html\?code=/);
      assert.strictEqual((await P.call(`/api/addin/pair/${pair.pairId}`)).body.status, 'pending');
    });

    await test('confirming needs a signed-in account and this site as origin', async () => {
      assert.strictEqual((await B.call('/api/addin/pair/approve', { method: 'POST', body: { code: pair.code } })).status, 401);
      assert.strictEqual((await B.call('/api/login', { method: 'POST', body: { username: `${tag}_user`, password: pw } })).status, 200);
      const cross = await B.call('/api/addin/pair/approve', { method: 'POST', body: { code: pair.code }, headers: { origin: 'https://evil.example' } });
      assert.strictEqual(cross.status, 403);
      assert.strictEqual((await B.call('/api/addin/pair/approve', { method: 'POST', body: { code: 'ZZZZZZ' } })).status, 404);
    });

    await test('after confirmation the pane gets its token exactly once', async () => {
      assert.strictEqual((await B.call('/api/addin/pair/approve', { method: 'POST', body: { code: pair.code } })).status, 200);
      const r = await P.call(`/api/addin/pair/${pair.pairId}`);
      assert.strictEqual(r.body.status, 'approved');
      assert.match(r.body.token, /^jai_[A-Za-z0-9_-]{43}$/);
      P.setToken(r.body.token);
      assert.strictEqual((await P.call(`/api/addin/pair/${pair.pairId}`)).body.status, 'expired');
      const row = await pool.query('SELECT token_hash FROM addin_tokens WHERE admin_id = $1', [made[0]]);
      assert.strictEqual(row.rows.length, 1);
      assert.notStrictEqual(row.rows[0].token_hash, r.body.token, 'only the hash is stored');
    });

    await test('the token works on the allowed routes as that account, without a cookie', async () => {
      const me = await P.call('/api/user-info');
      assert.strictEqual(me.status, 200);
      assert.strictEqual(me.body.adminId, made[0]);
      assert.strictEqual(me.body.role, 'user');
      assert.ok(!me.headers.get('set-cookie'), 'no session cookie is created for a token request');
      assert.strictEqual((await P.call('/api/addin/me')).body.fullName, 'Word Sinov');
      assert.strictEqual((await P.call('/api/tariff/me')).status, 200);
      // past requireAuth: an empty message is the handler's own 400, not a 401
      const chat = await P.call('/api/legal-chat', { method: 'POST', body: { message: '' } });
      assert.notStrictEqual(chat.status, 401);
    });

    await test('the token opens nothing else', async () => {
      for (const p of ['/api/ai-chat-sessions', '/api/requests', '/api/addin/connections', '/api/export-excel']) {
        const st = (await P.call(p)).status; assert.ok(st === 401 || st === 403, p + ' -> ' + st);
      }
    });

    await test('the person sees the connection and can end every one of them', async () => {
      assert.strictEqual((await B.call('/api/addin/connections')).body.n, 1);
      assert.strictEqual((await B.call('/api/addin/connections/revoke-all', { method: 'POST', body: {} })).body.revoked, 1);
      // cached for at most a minute on the server; a fresh token check refuses it
      const row = await pool.query('SELECT revoked_at FROM addin_tokens WHERE admin_id = $1', [made[0]]);
      assert.ok(row.rows[0].revoked_at);
    });

    await test('logout from the pane revokes its own token at once', async () => {
      const p2 = (await P.call('/api/addin/pair', { method: 'POST', body: {} })).body;
      assert.strictEqual((await B.call('/api/addin/pair/approve', { method: 'POST', body: { code: p2.code } })).status, 200);
      const t = (await P.call(`/api/addin/pair/${p2.pairId}`)).body.token;
      P.setToken(t);
      assert.strictEqual((await P.call('/api/user-info')).status, 200);
      assert.strictEqual((await P.call('/api/addin/logout', { method: 'POST', body: {} })).status, 200);
      const after = await P.call('/api/user-info');
      assert.strictEqual(after.status, 401);
      assert.strictEqual(after.body.code, 'ADDIN_TOKEN_INVALID');
    });
  } finally {
    await pool.query('DELETE FROM addin_tokens WHERE admin_id = ANY($1)', [made]).catch(() => {});
    await pool.query('DELETE FROM audit_log WHERE admin_id = ANY($1)', [made]).catch(() => {});
    await pool.query('DELETE FROM admins WHERE id = ANY($1)', [made]).catch(() => {});
    await pool.end();
  }
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
