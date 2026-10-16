'use strict';

// Word add-in: device pairing, token-only routes, manifest.
const assert = require('assert');
const w = require('../src/addin/word-addin');

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); } catch (e) { failed++; console.error('  ✗ ' + name + '\n      ' + (e && e.stack || e)); }
}
function res() {
  const r = { statusCode: 200, body: null, headers: {}, locals: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.set = (k, v) => { r.headers[k] = v; return r; };
  r.setHeader = r.set;
  r.removeHeader = (k) => { delete r.headers[k]; };
  return r;
}

(async () => {
  console.log('\nword-addin\n');

  await test('codes use 6 unambiguous characters', () => {
    for (let i = 0; i < 200; i++) assert.match(w.newCode(), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    assert.strictEqual(w.normCode(' ab-c 12x '), 'ABC12X');
  });

  await test('a pairing hands its token over once, after approval only', () => {
    const p = w.createPairings();
    const a = p.create();
    assert.match(a.pairId, /^[a-f0-9]{64}$/);
    assert.deepStrictEqual(p.poll(a.pairId), { status: 'pending', code: a.code });
    const f = p.findByCode(a.code.toLowerCase());
    assert.ok(f, 'code found case-insensitively');
    f.entry.adminId = 7; f.entry.token = 'jai_x';
    assert.strictEqual(p.findByCode(a.code), null, 'an approved code cannot be approved again');
    assert.deepStrictEqual(p.poll(a.pairId), { status: 'approved', token: 'jai_x' });
    assert.deepStrictEqual(p.poll(a.pairId), { status: 'expired' }, 'second poll gets nothing');
  });

  await test('a pairing expires after 10 minutes', () => {
    let t = 1000;
    const p = w.createPairings({ now: () => t });
    const a = p.create();
    t += w.PAIR_TTL_MS + 1;
    assert.strictEqual(p.findByCode(a.code), null);
    assert.deepStrictEqual(p.poll(a.pairId), { status: 'expired' });
  });

  await test('an unknown pair id learns nothing', () => {
    const p = w.createPairings(); p.create();
    assert.deepStrictEqual(p.poll('0'.repeat(64)), { status: 'expired' });
  });

  const account = { token_id: 3, id: 42, role: 'user', username: 'ali', full_name: 'Ali Valiyev' };
  function pool(rows) {
    const calls = [];
    return { calls, query: async (sql, params) => { calls.push({ sql, params }); return { rows: /FROM addin_tokens t JOIN admins/.test(sql) ? rows : [], rowCount: 1 }; } };
  }
  const TOKEN = 'jai_' + 'A'.repeat(43);

  await test('a token opens an allowed route as its account', async () => {
    const pl = pool([account]);
    const mw = w.createBearerAuth(pl);
    const req = { method: 'POST', path: '/api/legal-chat', headers: { authorization: 'Bearer ' + TOKEN } };
    let nexted = false; await mw(req, res(), () => { nexted = true; });
    assert.ok(nexted);
    assert.deepStrictEqual(req.session, { isAuthenticated: true, role: 'user', adminId: 42, username: 'ali', fullName: 'Ali Valiyev', addin: 'word' });
    assert.strictEqual(pl.calls[0].params[0], w.sha256(TOKEN), 'looked up by hash, never by the token');
  });

  await test('a token is ignored on any other route', async () => {
    const pl = pool([account]);
    const mw = w.createBearerAuth(pl);
    for (const [method, path] of [['GET', '/api/requests'], ['POST', '/api/admin/landing-config'], ['GET', '/api/export-excel'], ['POST', '/api/user-info']]) {
      const req = { method, path, headers: { authorization: 'Bearer ' + TOKEN } };
      let nexted = false; await mw(req, res(), () => { nexted = true; });
      assert.ok(nexted && !req.session, `${method} ${path} must not get a session from a token`);
    }
    assert.strictEqual(pl.calls.length, 0);
  });

  await test('an unknown or revoked token gets 401 on an allowed route', async () => {
    const mw = w.createBearerAuth(pool([]));
    const r = res(); let nexted = false;
    await mw({ method: 'GET', path: '/api/user-info', headers: { authorization: 'Bearer ' + TOKEN } }, r, () => { nexted = true; });
    assert.ok(!nexted); assert.strictEqual(r.statusCode, 401); assert.strictEqual(r.body.code, 'ADDIN_TOKEN_INVALID');
  });

  await test('no or malformed header passes through untouched', async () => {
    const mw = w.createBearerAuth(pool([account]));
    for (const hdr of [undefined, 'Bearer abc', 'Basic xyz', 'Bearer jai_short']) {
      const req = { method: 'GET', path: '/api/user-info', headers: hdr ? { authorization: hdr } : {} };
      let nexted = false; await mw(req, res(), () => { nexted = true; });
      assert.ok(nexted && !req.session);
    }
  });

  await test('logout forgets a cached token at once', async () => {
    let rows = [account];
    const pl = { query: async (sql) => ({ rows: /JOIN admins/.test(sql) ? rows : [] }) };
    const mw = w.createBearerAuth(pl);
    const mk = () => ({ method: 'GET', path: '/api/user-info', headers: { authorization: 'Bearer ' + TOKEN } });
    await mw(mk(), res(), () => {});
    rows = [];
    mw.forget(w.sha256(TOKEN));
    const r = res(); await mw(mk(), r, () => {});
    assert.strictEqual(r.statusCode, 401);
  });

  await test('/word/ pages may be framed by Office, other pages keep their headers', () => {
    const r1 = res(); r1.headers['X-Frame-Options'] = 'SAMEORIGIN';
    w.wordFrameHeaders({ path: '/word/taskpane.html' }, r1, () => {});
    assert.ok(!r1.headers['X-Frame-Options']);
    assert.match(r1.headers['Content-Security-Policy'], /frame-ancestors 'self' .*officeapps\.live\.com/);
    const r2 = res(); r2.headers['X-Frame-Options'] = 'SAMEORIGIN';
    w.wordFrameHeaders({ path: '/app/index.html' }, r2, () => {});
    assert.strictEqual(r2.headers['X-Frame-Options'], 'SAMEORIGIN');
  });

  await test('manifest points at the host it was made for, with a stable id per host', () => {
    const a = w.manifestXml('https://juristai-staging.onrender.com');
    const b = w.manifestXml('https://juristai.uz');
    assert.match(a, /<SourceLocation DefaultValue="https:\/\/juristai-staging\.onrender\.com\/word\/taskpane\.html"\/>/);
    assert.match(a, /<Permissions>ReadWriteDocument<\/Permissions>/);
    const id = (x) => x.match(/<Id>([^<]+)<\/Id>/)[1];
    assert.match(id(a), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notStrictEqual(id(a), id(b));
    assert.strictEqual(id(a), id(w.manifestXml('https://juristai-staging.onrender.com')));
    assert.ok(!/juristai\.uz/.test(a));
  });

  await test('Google Docs sidebar origin may call only the add-in routes, without cookies', () => {
    const g = 'https://n-abc123def-0lu-script.googleusercontent.com';
    const mk = (method, path, extra = {}) => ({ method, path, headers: { origin: g, ...extra } });
    assert.ok(w.addinCorsAllowed(mk('POST', '/api/legal-chat')));
    assert.ok(w.addinCorsAllowed(mk('OPTIONS', '/api/legal-chat', { 'access-control-request-method': 'POST' })));
    assert.ok(w.addinCorsAllowed(mk('POST', '/api/addin/pair')));
    assert.ok(w.addinCorsAllowed(mk('GET', '/api/addin/pair/' + 'a'.repeat(64))));
    assert.ok(w.addinCorsAllowed(mk('GET', '/api/user-info')));
    assert.ok(!w.addinCorsAllowed(mk('GET', '/api/requests')));
    assert.ok(!w.addinCorsAllowed(mk('POST', '/api/addin/pair/approve')), 'approval stays on the site');
    assert.ok(!w.addinCorsAllowed(mk('POST', '/api/admin/landing-config')));
    assert.ok(!w.addinCorsAllowed({ method: 'POST', path: '/api/legal-chat', headers: { origin: 'https://evil.googleusercontent.com.attacker.io' } }));
    assert.ok(!w.addinCorsAllowed({ method: 'POST', path: '/api/legal-chat', headers: { origin: 'http://n-abc-script.googleusercontent.com' } }));
    assert.strictEqual(w.ADDIN_CORS.credentials, false);
  });

  await test('the sidebar markup comes from the Word pane page, without its scripts', () => {
    const js = w.panelScript('<html><body>\n<header>A</header><main id="vMain"></main>\n<script src="/word/taskpane.js?v=3"></script></body></html>');
    assert.ok(js.startsWith('document.body.insertAdjacentHTML("afterbegin", '));
    assert.ok(js.includes('vMain') && !js.includes('taskpane.js'));
    const real = w.panelScript(require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'word', 'taskpane.html'), 'utf8'));
    assert.ok(real.includes('chatInput') && real.includes('pairCode') && !/<script/i.test(real));
  });

  await test('pane assets may be loaded by the Google sidebar', () => {
    const r = res(); w.wordFrameHeaders({ path: '/gdocs/host.js' }, r, () => {});
    assert.strictEqual(r.headers['Cross-Origin-Resource-Policy'], 'cross-origin');
    const r2 = res(); w.wordFrameHeaders({ path: '/api/user-info' }, r2, () => {});
    assert.ok(!r2.headers['Cross-Origin-Resource-Policy']);
  });

  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
