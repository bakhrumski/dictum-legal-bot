'use strict';

/**
 * MAINTENANCE_MODE (2026-10-06): during a rollback the running release takes
 * no work - every API request but the health check gets 503, the Telegram
 * bot only sends a notice (no AI, no usage) - so the database is put in
 * order before the other release serves (docs/tariffs-v2-rollback.md).
 *
 *   node tests/maintenance.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const m = require('../src/api/maintenance');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
function run(env, p) {
  const out = { status: 200, next: false, headers: {} };
  const res = { set(k, v) { out.headers[k] = v; return this; }, status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  m.maintenanceGate(env)({ path: p }, res, () => { out.next = true; });
  return out;
}

(async () => {
  console.log('maintenance switch');
  await test('on: every API request but /api/health gets 503 MAINTENANCE; pages and health pass', () => {
    const env = { MAINTENANCE_MODE: 'on' };
    for (const p of ['/api/legal-chat', '/api/tariff/me', '/api/admin/tariff/grant', '/api/workspaces/x/assistant/ask']) {
      const r = run(env, p);
      assert.deepStrictEqual([r.next, r.status, r.body.code, r.headers['Retry-After']], [false, 503, 'MAINTENANCE', '300'], p);
    }
    assert.ok(run(env, '/api/health').next);
    assert.ok(run(env, '/dashboard.html').next);
  });
  await test('off (unset or anything but "on"): nothing changes', () => {
    for (const env of [{}, { MAINTENANCE_MODE: 'off' }, { MAINTENANCE_MODE: '1' }]) assert.ok(run(env, '/api/legal-chat').next);
  });
  await test('wired before every API route, and the bot makes no AI call or usage row while it is on', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
    assert.ok(server.indexOf("app.use(require('./maintenance').maintenanceGate());") < server.indexOf("app.use('/api/', globalLimiter);"));
    assert.ok(server.indexOf("app.use(require('./maintenance').maintenanceGate());") < server.indexOf("app.post('/api/legal-chat'"));
    const bot = fs.readFileSync(path.join(__dirname, '..', 'src', 'bot', 'bot.js'), 'utf8');
    const msg = bot.slice(bot.indexOf('async function handleTelegramMessage'), bot.indexOf('async function handleTelegramMessage') + 600);
    assert.ok(msg.indexOf('maintenance.maintenanceOn()') < msg.indexOf('testAccountFor('), 'checked before anything else');
    const cb = bot.slice(bot.indexOf('async function handleCallbackQuery'), bot.indexOf('async function handleCallbackQuery') + 400);
    assert.match(cb, /maintenanceOn\(\)\) \{[\s\S]*?return;/u);
  });
  await test('the rollback document puts the switch before the SQL and the old code after it', () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'tariffs-v2-rollback.md'), 'utf8');
    const a = doc.indexOf('MAINTENANCE_MODE=on` → Save');
    const d = doc.indexOf('`[SHUTDOWN] done`');
    const q = doc.indexOf('SELECT max(ts) FROM tariff_usage;');
    const b = doc.indexOf('scripts/rollback/tariffs-v2-to-v1.sql`.');
    const c = doc.indexOf('Manual Deploy → commit `a3b858b`');
    assert.ok(a > 0 && a < d && d < q && q < b && b < c, 'switch -> old instance drained -> database quiet -> SQL -> old code');
    assert.match(doc, /eski instansiya trafikni qabul qilishda davom etadi/u, 'the switch does not block traffic during the swap');
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
