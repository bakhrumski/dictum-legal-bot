'use strict';

/**
 * The old dashboard is the master's only (2026-11-02, src/auth/old-dashboard-gate.js):
 * a master (role read again from the database) gets the page, anyone else is
 * redirected to the new app, a visitor to sign-in; other paths pass through.
 *
 *   node tests/old-dashboard-gate.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createOldDashboardGate } = require('../src/auth/old-dashboard-gate');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n   ', e.message); }
}

function run(gate, { path: p, query = {}, method = 'GET', sess, dbMaster }) {
  return new Promise((resolve) => {
    const req = { method, path: p, query };
    const out = { headers: {} };
    const res = {
      set(k, v) { out.headers[k] = v; return res; },
      redirect(code, to) { out.code = code; out.to = to; resolve(out); },
    };
    gate.__sess = sess; gate.__db = dbMaster;
    gate(req, res, (err) => { out.next = true; out.err = err; resolve(out); });
  });
}

function make(sess, dbMaster) {
  const asked = [];
  const gate = createOldDashboardGate({
    getSession: () => (req, res, next) => { req.session = sess; next(); },
    verifyMaster: async (id) => { asked.push(id); return dbMaster; },
  });
  return { gate, asked };
}

(async () => {
  console.log('old dashboard gate');
  await test('master in session and in database gets the page, not cached', async () => {
    const { gate, asked } = make({ isAuthenticated: true, role: 'master', adminId: 7 }, true);
    const r = await run(gate, { path: '/dashboard.html' });
    assert.strictEqual(r.next, true); assert.strictEqual(r.err, undefined);
    assert.strictEqual(r.headers['Cache-Control'], 'no-store');
    assert.deepStrictEqual(asked, [7]);
  });
  await test('a session that says master but the database does not -> /app/', async () => {
    const { gate } = make({ isAuthenticated: true, role: 'master', adminId: 7 }, false);
    const r = await run(gate, { path: '/dashboard.html' });
    assert.strictEqual(r.to, '/app/');
  });
  for (const role of ['user', 'lawyer', 'student']) {
    await test(`${role} -> /app/, database not asked`, async () => {
      const { gate, asked } = make({ isAuthenticated: true, role, adminId: 9 }, true);
      const r = await run(gate, { path: '/dashboard.html' });
      assert.strictEqual(r.code, 302); assert.strictEqual(r.to, '/app/'); assert.deepStrictEqual(asked, []);
    });
  }
  await test('?tab=jamoa -> the new app\'s team page', async () => {
    const { gate } = make({ isAuthenticated: true, role: 'user', adminId: 9 }, false);
    assert.strictEqual((await run(gate, { path: '/dashboard.html', query: { tab: 'jamoa' } })).to, '/app/#/jamoa');
  });
  await test('a visitor -> sign-in', async () => {
    const { gate } = make({}, false);
    assert.strictEqual((await run(gate, { path: '/dashboard.html' })).to, '/login.html');
  });
  await test('/dashboard and /ai-dashboard.html are closed too', async () => {
    const { gate } = make({ isAuthenticated: true, role: 'lawyer', adminId: 3 }, false);
    assert.strictEqual((await run(gate, { path: '/dashboard' })).to, '/app/');
    assert.strictEqual((await run(gate, { path: '/ai-dashboard.html' })).to, '/app/');
    const m = make({ isAuthenticated: true, role: 'master', adminId: 1 }, true);
    assert.strictEqual((await run(m.gate, { path: '/dashboard' })).to, '/dashboard.html');
  });
  await test('a database error is not a master', async () => {
    const gate = createOldDashboardGate({
      getSession: () => (req, res, next) => { req.session = { isAuthenticated: true, role: 'master', adminId: 1 }; next(); },
      verifyMaster: async () => { throw new Error('db down'); },
    });
    assert.strictEqual((await run(gate, { path: '/dashboard.html' })).to, '/app/');
  });
  await test('other paths and methods pass through without a session', async () => {
    let used = 0;
    const gate = createOldDashboardGate({ getSession: () => { used++; return (q, s, n) => n(); }, verifyMaster: async () => false });
    for (const p of ['/', '/app/', '/login.html', '/dashboard.html.bak', '/api/user-info']) assert.strictEqual((await run(gate, { path: p })).next, true);
    assert.strictEqual((await run(gate, { path: '/dashboard.html', method: 'POST' })).next, true);
    assert.strictEqual(used, 0);
  });
  await test('server registers the gate before the static files; new app is the home', async () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    const g = src.indexOf("require('../auth/old-dashboard-gate')"), st = src.indexOf("app.use(express.static('public'))");
    assert.ok(g > 0 && st > g);
    assert.ok(/process\.env\.APP_HOME : '\/app\/'/.test(src));
  });
  await test('the new app shows the old-dashboard link to a master only', async () => {
    const app = fs.readFileSync(path.join(__dirname, '../public/app/app.js'), 'utf8');
    assert.ok(app.includes(`(J.isMaster && J.isMaster() ? '<a class="mi" href="/dashboard.html">'`));
    const ob = fs.readFileSync(path.join(__dirname, '../public/app/onboarding.js'), 'utf8');
    assert.ok(!ob.includes('/dashboard.html'), 'the survey is in the app now');
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
