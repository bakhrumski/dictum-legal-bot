'use strict';

// Which role may reach which route, checked against the source without a
// running server (tests/authz-matrix.test.js needs one on :3000).
//
// Any self-registered account has role 'user', and requireAuth admits it.
// These routes used requireAuth alone, so a 'user' could read every client
// request (including the full Excel export), answer or reassign requests,
// read the staff chat and write "lawyer-verified" answers into the corpus.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');

function middlewareOf(method, route) {
  const re = new RegExp(`app\\.${method}\\('${route.replace(/[/:.]/g, (c) => '\\' + c)}',\\s*([A-Za-z]+)`);
  const m = re.exec(src);
  assert.ok(m, `${method.toUpperCase()} ${route} not found`);
  return m[1];
}

const STAFF = 'requireStaff';
const MASTER = 'requireMasterAdmin';
const expected = [
  ['get', '/api/requests', STAFF], ['get', '/api/requests/:id', STAFF],
  ['post', '/api/student-response', STAFF], ['post', '/api/update-category', STAFF],
  ['post', '/api/requests/:id/classify', STAFF], ['get', '/api/requests/:id/traces', STAFF],
  ['get', '/api/admin-stats/:id', STAFF], ['get', '/api/chat/messages', STAFF],
  ['post', '/api/chat/messages', STAFF], ['get', '/api/events', STAFF], ['get', '/api/stats', STAFF],
  ['get', '/api/admins', STAFF], ['get', '/api/rankings', STAFF], ['get', '/api/monte-carlo', STAFF],
  ['post', '/api/assign-request', MASTER], ['post', '/api/unassign-request', MASTER],
  ['post', '/api/assign-student', MASTER], ['post', '/api/unassign-student', MASTER],
  ['post', '/api/rag/verify-chat-answer', MASTER], ['get', '/api/export-excel', MASTER],
];

// Run the real canAccessRequest() against a stand-in pool.
function loadCanAccess(rowsFor) {
  const start = src.indexOf('async function canAccessRequest(');
  const end = src.indexOf('\n}\n', start) + 2;
  const calls = [];
  const ctx = { pool: { query: async (sql, params) => { calls.push({ sql, params }); return { rows: rowsFor(params) }; } } };
  vm.createContext(ctx);
  vm.runInContext(src.slice(start, end) + '\nthis.canAccessRequest = canAccessRequest;', ctx);
  return { canAccessRequest: ctx.canAccessRequest, calls };
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n      ${e.message}`); }
}

(async () => {
  console.log('\nauthz — routes a self-registered user must not reach\n');

  await test('each route carries the role its data needs', () => {
    const wrong = expected.filter(([m, r, want]) => middlewareOf(m, r) !== want)
      .map(([m, r, want]) => `${m.toUpperCase()} ${r}: ${middlewareOf(m, r)} (want ${want})`);
    assert.deepStrictEqual(wrong, []);
  });

  await test('the master may open any request without a lookup', async () => {
    const { canAccessRequest, calls } = loadCanAccess(() => []);
    assert.strictEqual(await canAccessRequest({ session: { role: 'master', adminId: 1 } }, 42), true);
    assert.strictEqual(calls.length, 0);
  });

  await test('a lawyer or student reaches only requests assigned to them', async () => {
    const assigned = new Set(['42:7']);
    const { canAccessRequest, calls } = loadCanAccess(([id, admin]) => (assigned.has(`${id}:${admin}`) ? [{ '?column?': 1 }] : []));
    assert.strictEqual(await canAccessRequest({ session: { role: 'lawyer', adminId: 7 } }, 42), true);
    assert.strictEqual(await canAccessRequest({ session: { role: 'student', adminId: 8 } }, 42), false);
    assert.match(calls[0].sql, /assigned_to = \$2/);
    assert.match(calls[0].sql, /request_students/);
  });

  await test('a malformed id is refused without querying', async () => {
    const { canAccessRequest, calls } = loadCanAccess(() => [{}]);
    for (const bad of ['abc', '0', '-3', '1.5', undefined]) {
      assert.strictEqual(await canAccessRequest({ session: { role: 'lawyer', adminId: 7 } }, bad), false, String(bad));
    }
    assert.strictEqual(calls.length, 0);
  });

  await test('request-id routes check the assignment before touching data', () => {
    for (const sig of ["app.get('/api/requests/:id'", "app.post('/api/student-response'", "app.post('/api/update-category'",
      "app.post('/api/requests/:id/classify'", "app.get('/api/requests/:id/traces'"]) {
      const at = src.indexOf(sig);
      const body = src.slice(at, src.indexOf('\n});\n', at));
      const check = body.indexOf('canAccessRequest(');
      const firstQuery = body.indexOf('pool.query(');
      assert.ok(check > 0, `${sig} has no assignment check`);
      assert.ok(firstQuery < 0 || check < firstQuery, `${sig} queries before checking`);
    }
  });

  await test('staff see only their own admin-stats unless master', () => {
    const at = src.indexOf("app.get('/api/admin-stats/:id'");
    assert.match(src.slice(at, at + 600), /req\.session\.role !== 'master' && adminId !== Number\(req\.session\.adminId\)/);
  });

  await test('registration requests never return password_hash', () => {
    const at = src.indexOf("app.get('/api/registration-requests'");
    assert.match(src.slice(at, at + 1600), /column_name NOT IN \('document_base64', 'password_hash'\)/);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
})();
