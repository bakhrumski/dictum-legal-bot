'use strict';

/**
 * X1 of the 2026-11-10 audit (docs/audit/2026-11-10-audit.md §2): S1 /link
 * (per-login limit, an account linked elsewhere is not moved), S3 the legacy
 * registration code counts wrong tries, S4 only a master lists customers,
 * S8 no question text in the log, S9 lex.uz by host on every hop, S10 one
 * password rule for staff accounts, S12 the master role read from the database.
 *
 *   node tests/security-x1.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

(async () => {
  console.log('security fixes X1');
  const server = read('src', 'api', 'server.js'), bot = read('src', 'bot', 'bot.js');

  await test('S1: /link is limited per sender and per target login', () => {
    let now = 1e6;
    const g = require('../src/bot/link-guard').createLinkGuard({ clock: () => now });
    for (let sender = 1; sender <= 5; sender++) { assert.ok(g.allowed(sender, 'Master')); g.failed(sender, 'Master'); }
    assert.strictEqual(g.allowed(99, 'master'), false, 'a sixth Telegram account cannot go on trying the same login');
    assert.strictEqual(g.allowed(99, 'other'), true);
    for (let i = 0; i < 5; i++) g.failed(7, 'login' + i);
    assert.strictEqual(g.allowed(7, 'fresh'), false, 'one sender, many logins');
    g.succeeded(7); assert.strictEqual(g.allowed(7, 'fresh'), true);
    now += 16 * 60e3; assert.strictEqual(g.allowed(99, 'master'), true, 'the window ends');
  });
  await test('S1: an account linked to another Telegram is not moved by its password', () => {
    const { linkedElsewhere } = require('../src/bot/link-guard');
    assert.strictEqual(linkedElsewhere({ telegram_chat_id: null, telegram_user_id: null }, 5, 5), false, 'a first link');
    assert.strictEqual(linkedElsewhere({ telegram_chat_id: '5', telegram_user_id: '5' }, 5, 5), false, 'the same Telegram again');
    assert.strictEqual(linkedElsewhere({ telegram_chat_id: '5', telegram_user_id: null }, 5, 5), false);
    assert.strictEqual(linkedElsewhere({ telegram_chat_id: '5', telegram_user_id: '5' }, 9, 9), true);
    assert.strictEqual(linkedElsewhere({ telegram_chat_id: null, telegram_user_id: '5' }, 9, 9), true);
    const at = bot.indexOf("linkedElsewhere(admin, chatId, msg.from.id)");
    assert.ok(at > 0 && at < bot.indexOf("'UPDATE admins SET telegram_chat_id = $1, telegram_user_id = $3 WHERE id = $2'"), 'checked before the link is written');
    assert.ok(bot.includes('linkGuard.allowed(msg.from.id, username)') && bot.includes('linkGuard.failed(msg.from.id, username)'));
  });
  await test('S3: a registration code is gone after five wrong tries, and when it expires', () => {
    const { checkCode } = require('../src/auth/verify-code');
    const store = new Map([['t', { code: '4821', expiresAt: 1000 }]]);
    for (let i = 0; i < 4; i++) assert.strictEqual(checkCode(store, 't', '0000', { now: 1 }), null);
    assert.ok(checkCode(store, 't', '4821', { now: 1 }), 'the right code still works after four wrong ones');
    assert.strictEqual(checkCode(store, 't', '1111', { now: 1 }), null);
    assert.strictEqual(store.has('t'), false, 'the fifth wrong try removes the token');
    assert.strictEqual(checkCode(store, 't', '4821', { now: 1 }), null);
    store.set('e', { code: '1', expiresAt: 10 });
    assert.strictEqual(checkCode(store, 'e', '1', { now: 11 }), null); assert.strictEqual(store.has('e'), false);
    assert.strictEqual(checkCode(store, undefined, undefined), null);
    assert.strictEqual((server.match(/require\('\.\.\/auth\/verify-code'\)\.checkCode\(verificationTokens, verification_token, verification_code\)/g) || []).length, 2);
    assert.ok(!/storedCode\.code !== verification_code/.test(server));
  });
  await test('S4: only a master lists every account; other staff get staff', () => {
    assert.ok(/app\.get\('\/api\/admins', requireStaff[\s\S]{0,700}WHERE \(\$1::boolean OR role IN \('master', 'lawyer', 'student'\)\)[\s\S]{0,120}\[req\.session\.role === 'master'\]/.test(server));
  });
  await test('S8: a question is never written to the log', () => {
    assert.ok(!/console\.(log|warn)\([^\n]*\$\{message\}/.test(server));
    assert.ok(!/console\.(log|warn)\([^\n]*question[^\n]*substring/.test(server + read('src', 'rag', 'qa-korpus.js')));
  });
  await test('S9: lex.uz by its host, on the first request and on every redirect', async () => {
    const f = require('../src/rag/fetch-lex');
    for (const ok of ['https://lex.uz/docs/111', 'http://www.lex.uz/uz/docs/-5', 'https://static.lex.uz/x']) assert.strictEqual(f.isLexUrl(ok), true, ok);
    for (const bad of ['https://evil.example/?u=lex.uz', 'https://lex.uz.evil.example/', 'https://lex.uz@evil.example/', 'http://169.254.169.254/lex.uz', 'file:///etc/passwd', 'ftp://lex.uz/', '', null]) assert.strictEqual(f.isLexUrl(bad), false, String(bad));
    await assert.rejects(f.httpGet('http://127.0.0.1:1/lex.uz'), e => e.code === 'not_lex');
    // a redirect away from lex.uz is refused: the test's own server stands for lex.uz
    const http = require('http');
    const srv = http.createServer((req, res) => { res.writeHead(302, { Location: 'http://127.0.0.1:1/internal' }); res.end(); });
    await new Promise(r => srv.listen(0, r));
    f.allowHostForTests(`127.0.0.1:${srv.address().port}`);
    await assert.rejects(f.httpGet(`http://127.0.0.1:${srv.address().port}/docs/1`), e => e.code === 'not_lex');
    srv.close();
    assert.ok(server.includes("require('../rag/fetch-lex').isLexUrl(url)") && !server.includes("url.includes('lex.uz')"));
  });
  await test('S10: staff passwords follow the one rule; the default-password script is gone', () => {
    assert.strictEqual((server.match(/require\('\.\.\/auth\/credentials'\)\.validatePassword\(password, password, username\)/g) || []).length, 2, 'create and update');
    assert.ok(!/password\.length < 6/.test(server) && !/bcrypt\.hash\(password, 10\)/.test(server.slice(server.indexOf("app.post('/api/admins'"), server.indexOf("app.post('/api/admins'") + 4000)));
    assert.ok(!fs.existsSync(path.join(__dirname, '..', 'src', 'database', 'update-admin-password.js')));
    assert.strictEqual(require('../src/auth/credentials').validatePassword('short1', 'short1', 'x').ok, undefined);
  });
  await test('S12: the master role is read from the database on every master request', async () => {
    const src = server.slice(server.indexOf('function requireMasterAdmin'), server.indexOf('function requireMasterAdmin') + 700);
    assert.ok(src.includes("pool.query('SELECT role FROM admins WHERE id = $1', [req.session.adminId])") && src.includes("r.rows[0].role === 'master' ? next()"));
    // behaviour, with the function taken out of the file
    const make = pool => new Function('pool', 'console', `${src.slice(0, src.indexOf('\n}\n') + 2)}; return requireMasterAdmin;`)(pool, { error() {} });
    const run = (fn, session) => new Promise(resolve => { const res = { status(c) { this.c = c; return this; }, json() { resolve(this.c); } }; fn({ session }, res, () => resolve('next')); });
    const asRole = role => make({ query: async () => ({ rows: role ? [{ role }] : [] }) });
    assert.strictEqual(await run(asRole('master'), { isAuthenticated: true, role: 'master', adminId: 1 }), 'next');
    assert.strictEqual(await run(asRole('user'), { isAuthenticated: true, role: 'master', adminId: 1 }), 403, 'demoted in the database');
    assert.strictEqual(await run(asRole(null), { isAuthenticated: true, role: 'master', adminId: 1 }), 403, 'deleted');
    assert.strictEqual(await run(asRole('master'), { isAuthenticated: true, role: 'student', adminId: 1 }), 403);
    assert.strictEqual(await run(make({ query: async () => { throw new Error('db'); } }), { isAuthenticated: true, role: 'master', adminId: 1 }), 503, 'a failed check never lets through');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
