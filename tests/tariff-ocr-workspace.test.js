'use strict';

/**
 * DECISIONS.md D-7 and the fixes that came with it:
 *   - OCR has its own daily page allowance per plan (weight 0 in fair-use);
 *   - Workspace AI is metered on the asking member's own plan;
 *   - a Workspace member no longer inherits the owner's plan (audit M4);
 *   - the last draft / OCR page of an allowance is no longer refused
 *     because the route's own usage row was already counted.
 *
 *   node tests/tariff-ocr-workspace.test.js
 */

const assert = require('assert');
const Module = require('module');
const path = require('path');
const fs = require('fs');

const state = { plan: 'silver', role: 'user', used: 0 };
const fakePool = {
  query: async (sql) => {
    if (/FROM admins WHERE id/i.test(sql)) {
      return { rows: [{ tariff_plan: state.plan, tariff_starts_at: new Date(), tariff_expires_at: null,
        bepul_used: false, role: state.role, tariff_rollover: 0 }] };
    }
    if (/COUNT\(\*\)/i.test(sql)) return { rows: [{ n: state.used, used: state.used }] };
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
const { isActivePaidPlan } = require('../src/workspace/authz');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const like = (p) => new RegExp('^' + p.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
function weight(endpoint) {
  for (const [, op, pattern, value] of tiers.ENDPOINT_WEIGHT_SQL.matchAll(/WHEN endpoint (LIKE|=) '([^']+)'\s+THEN (\d+)/g)) {
    if (op === '=' ? endpoint === pattern : like(pattern).test(endpoint)) return Number(value);
  }
  return Number(/ELSE (\d+)/.exec(tiers.ENDPOINT_WEIGHT_SQL)[1]);
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

(async () => {
  console.log('D-7: OCR pages');

  await test('daily OCR pages per plan: 3 / 5 / 20 / 50 / 100', () => {
    const got = ['bepul', 'sinov', 'silver', 'gold', 'platinum'].map((k) => tiers.PLANS[k].dailyOcrPages);
    assert.deepStrictEqual(got, [3, 5, 20, 50, 100]);
  });

  await test('the last page of the allowance is allowed, the next one is not', async () => {
    state.plan = 'bepul'; state.used = 3;
    assert.strictEqual((await tiers.checkOcrQuota(7, { alreadyRecorded: true })).allowed, true);
    state.used = 4;
    const q = await tiers.checkOcrQuota(7, { alreadyRecorded: true });
    assert.strictEqual(q.allowed, false);
    assert.strictEqual(q.limit, 3);
  });

  await test('staff and master are not limited', async () => {
    state.role = 'lawyer'; state.used = 999;
    assert.strictEqual((await tiers.checkOcrQuota(7)).allowed, true);
    state.role = 'user';
  });

  await test('OCR weighs nothing in fair-use; Workspace AI weighs like chat', () => {
    assert.strictEqual(weight('/api/analyze/ocr'), 0);
    assert.strictEqual(weight('/api/workspace-ai'), 1);
  });

  await test('the OCR route is metered and fails closed', () => {
    const src = read('src/ocr/routes.js');
    assert.ok(/enforceQuota\('\/api\/analyze\/ocr', \{ failClosed: true \}\)/.test(src));
    assert.ok(/app\.post\('\/api\/analyze\/ocr-image', requireAuth, ocrQuota,/.test(src));
    assert.ok(/checkOcrQuota\(req\.session\.adminId, \{\s*alreadyRecorded:/.test(src));
  });

  console.log('Drafts: the last one of the week');

  await test('sinov (2 drafts/week) gets both drafts', async () => {
    state.plan = 'sinov'; state.used = 2;
    assert.strictEqual((await tiers.checkDraftQuota(7, { alreadyRecorded: true })).allowed, true);
    state.used = 3;
    assert.strictEqual((await tiers.checkDraftQuota(7, { alreadyRecorded: true })).allowed, false);
    assert.ok(/checkDraftQuota\(req\.session\.adminId, \{ alreadyRecorded:/.test(read('src/drafting/routes.js')));
  });

  console.log('D-7: Workspace AI and member entitlement (M4)');

  await test('a member with no plan does not inherit the owner\'s Platinum', () => {
    const row = { tariff_plan: 'platinum', tariff_expires_at: null, member_tariff_plan: null, member_tariff_expires_at: null, member_role: 'user' };
    assert.strictEqual(isActivePaidPlan(row, 'silver'), false);
  });

  await test('a member is judged on their own plan and expiry', () => {
    const base = { tariff_plan: 'platinum', tariff_expires_at: null, member_role: 'user' };
    assert.strictEqual(isActivePaidPlan({ ...base, member_tariff_plan: 'silver', member_tariff_expires_at: null }), true);
    assert.strictEqual(isActivePaidPlan({ ...base, member_tariff_plan: 'silver', member_tariff_expires_at: new Date(Date.now() - 864e5) }), false);
  });

  await test('a master member needs no plan; a plain account row still works', () => {
    assert.strictEqual(isActivePaidPlan({ tariff_plan: null, member_tariff_plan: null, member_role: 'master' }), true);
    assert.strictEqual(isActivePaidPlan({ tariff_plan: 'gold', tariff_expires_at: null }), true);
    assert.strictEqual(isActivePaidPlan({ tariff_plan: null, tariff_expires_at: null }), false);
  });

  await test('Workspace AI ask is metered, and runs that call no model are refunded', () => {
    const routes = read('src/workspace/routes.js');
    assert.ok(/enforceQuota\('\/api\/workspace-ai'\)/.test(routes));
    assert.ok(/assistant\/ask', aiLimiter \|\| \(\(req, res, next\) => next\(\)\), workspaceAiQuota,/.test(routes));
    assert.ok(/refundUsage\(res, 'no_generation'\)/.test(routes));
    assert.ok(/verificationTokens,\s*tariffModule,\s*\}\);/.test(read('src/api/server.js')), 'server passes tariffModule');
    assert.ok(/member_account\.role AS member_role/.test(read('src/workspace/authz.js')));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
