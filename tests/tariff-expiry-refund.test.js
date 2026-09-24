'use strict';

/**
 * Owner's decisions D-4, D-5 and D-6 (docs/audit/DECISIONS.md):
 *   D-4  an expired paid or trial plan continues on bepul, not blocked;
 *   D-5  chat fails open when the quota cannot be checked, expensive paths
 *        (opinion, OCR/analyze, explain, enterprise) fail closed;
 *   D-6  a failed request gives its unit back and says so.
 *
 *   node tests/tariff-expiry-refund.test.js
 */

const assert = require('assert');
const Module = require('module');
const path = require('path');
const fs = require('fs');

const state = {
  plan: 'silver', role: 'user', used: 0,
  expiresAt: new Date(Date.now() - 2 * 864e5),
  startsAt: new Date(Date.now() - 32 * 864e5),
  failQueries: false, nextId: 100, deleted: [], inserted: [],
};
const fakePool = {
  query: async (sql, params = []) => {
    if (state.failQueries) throw new Error('db down');
    if (/FROM admins WHERE id/i.test(sql)) {
      return { rows: [{
        tariff_plan: state.plan, tariff_starts_at: state.startsAt, tariff_expires_at: state.expiresAt,
        bepul_used: true, role: state.role, tariff_rollover: 0,
        telegram_user_id: 1, telegram_username: 'u', channel_verified_at: new Date(),
        survey_completed_at: new Date(), free_gate_since: new Date(), created_at: new Date('2026-01-01'),
      }] };
    }
    if (/INSERT INTO tariff_usage/i.test(sql)) { const id = state.nextId++; state.inserted.push({ id, params }); return { rows: [{ id }] }; }
    if (/DELETE FROM tariff_usage/i.test(sql)) { state.deleted.push(params[0]); return { rows: [], rowCount: 1 }; }
    if (/COUNT\(\*\)|SUM\(/i.test(sql)) return { rows: [{ used: state.used, n: state.used }] };
    return { rows: [] };
  },
};

const modPath = require.resolve('../src/rag/subscription-tiers');
const m = new Module(modPath);
m.filename = modPath;
m.paths = Module._nodeModulePaths(path.dirname(modPath));
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '../database/db') return { pool: fakePool };
  return orig.apply(this, arguments);
};
m._compile(fs.readFileSync(modPath, 'utf8'), modPath);
Module.prototype.require = orig;
const tiers = m.exports;

function fakeRes() {
  const listeners = {};
  const res = {
    statusCode: 200, body: null, headersSent: false, locals: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.headersSent = true; if (listeners.finish) listeners.finish(); return this; },
    on(ev, fn) { listeners[ev] = fn; return this; },
  };
  return res;
}
async function run(mw, res = fakeRes()) {
  let nexted = false;
  await mw({ session: { adminId: 7, role: 'user' } }, res, () => { nexted = true; });
  return { res, nexted };
}
const tick = () => new Promise(r => setImmediate(r));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}
function reset(over = {}) {
  Object.assign(state, {
    plan: 'silver', role: 'user', used: 0, failQueries: false, deleted: [], inserted: [],
    expiresAt: new Date(Date.now() - 2 * 864e5), startsAt: new Date(Date.now() - 32 * 864e5),
  }, over);
}

(async () => {
  console.log('D-4: expired plans fall back to bepul');

  await test('an expired silver plan reads as bepul, remembering what it was', async () => {
    reset();
    const u = await tiers.getUserPlan(7);
    assert.strictEqual(u.plan, 'bepul');
    assert.strictEqual(u.downgradedFrom, 'silver');
    assert.strictEqual(u.expiresAt, null);
  });

  await test('an expired trial also falls back to bepul', async () => {
    reset({ plan: 'sinov' });
    assert.strictEqual((await tiers.getUserPlan(7)).plan, 'bepul');
  });

  await test('the expired user is let through on the bepul allowance, not blocked', async () => {
    reset({ used: 0 });
    const q = await tiers.checkQuota(7);
    assert.strictEqual(q.allowed, true);
    assert.strictEqual(q.plan, 'bepul');
    assert.strictEqual(q.limit, 10, 'bepul counts its 30 generous days from the expiry');
    const { nexted } = await run(tiers.enforceQuota('/api/legal-chat'));
    assert.ok(nexted, 'request passed');
  });

  await test('an active plan is untouched', async () => {
    reset({ expiresAt: new Date(Date.now() + 5 * 864e5) });
    const u = await tiers.getUserPlan(7);
    assert.strictEqual(u.plan, 'silver');
    assert.strictEqual(u.downgradedFrom, null);
  });

  console.log('D-5: fail-open for chat, fail-closed for expensive paths');

  await test('chat still passes when the database is down', async () => {
    reset({ failQueries: true });
    const { nexted, res } = await run(tiers.enforceQuota('/api/legal-chat'));
    assert.ok(nexted);
    assert.strictEqual(res.body, null);
  });

  await test('an expensive path answers 503 when the database is down', async () => {
    reset({ failQueries: true });
    const { nexted, res } = await run(tiers.enforceQuota('/api/analyze', { failClosed: true }));
    assert.ok(!nexted);
    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.body.code, 'QUOTA_UNAVAILABLE');
  });

  await test('server wiring: opinion, explain, analyze and enterprise fail closed; chat does not', () => {
    const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const server = read('src/api/server.js');
    assert.ok(/'\/api\/draft\/legal-opinion', requireAuth, tariffModule\.enforceQuota\('\/api\/legal-chat', \{ failClosed: true \}\)/.test(server));
    assert.ok(/'\/api\/draft\/explain-document', requireAuth, tariffModule\.enforceQuota\('\/api\/legal-chat', \{ failClosed: true \}\)/.test(server));
    assert.ok(/'\/api\/legal-chat', requireAuth, tariffModule\.enforceQuota\('\/api\/legal-chat'\),/.test(server));
    assert.ok(/credit check failed \(refusing\)/.test(server), 'opinion credit check no longer allows on error');
    assert.ok(/enforceQuota\('\/api\/analyze', \{ failClosed: true \}\)/.test(read('src/ocr/routes.js')));
    assert.ok(/enforceQuota\('\/api\/enterprise-chat', \{ failClosed: true \}\)/.test(read('src/enterprise/routes.js')));
  });

  console.log('D-6: failed requests are refunded and say so');

  await test('an error reply deletes the recorded unit and carries the notice', async () => {
    reset({ expiresAt: new Date(Date.now() + 5 * 864e5) });
    const { res, nexted } = await run(tiers.enforceQuota('/api/legal-chat'));
    assert.ok(nexted);
    const id = state.inserted[0].id;
    res.status(500).json({ error: 'Qonun qidirish xatoligi: boom' });
    await tick();
    assert.deepStrictEqual(state.deleted, [id]);
    assert.strictEqual(res.body.quotaRefunded, true);
    assert.ok(/qaytarildi/.test(res.body.refundNotice));
    assert.strictEqual(res.body.error, 'Qonun qidirish xatoligi: boom', 'original error kept');
  });

  await test('a successful reply keeps the unit', async () => {
    reset({ expiresAt: new Date(Date.now() + 5 * 864e5) });
    const { res } = await run(tiers.enforceQuota('/api/legal-chat'));
    res.json({ reply: 'ok' });
    await tick();
    assert.deepStrictEqual(state.deleted, []);
    assert.strictEqual(res.body.quotaRefunded, undefined);
  });

  await test('a refund happens once even when called again (stream error + finish)', async () => {
    reset({ expiresAt: new Date(Date.now() + 5 * 864e5) });
    const { res } = await run(tiers.enforceQuota('/api/legal-chat'));
    const a = tiers.refundUsage(res, 'stream_error');
    const b = tiers.refundUsage(res, 'again');
    res.status(500).json({ error: 'x' });
    await tick();
    assert.strictEqual(a.quotaRefunded, true);
    assert.deepStrictEqual(b, {});
    assert.strictEqual(state.deleted.length, 1);
  });

  await test('legal-chat refunds on a stream error and on an empty reply', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'src/api/server.js'), 'utf8');
    assert.ok(/refundUsage\(res, 'stream_error'\)/.test(server));
    assert.ok(/refundUsage\(res, 'empty_reply'\)/.test(server));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
