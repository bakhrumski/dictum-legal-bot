'use strict';

/**
 * DECISIONS.md D-7 and the fixes that came with it, under tariffs v2:
 *   - OCR has its own page allowance per period (10 pages per analysis unit);
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
  console.log('OCR pages (tariffs v2)');

  await test('OCR is not unlimited: 10 pages per analysis unit per period (Sinov 10, Silver 80, Gold 240, Platinum 400)', () => {
    const got = ['sinov', 'silver', 'gold', 'platinum'].map((k) => tiers.PLANS[k].quotas.ocr);
    assert.deepStrictEqual(got, [10, 80, 240, 400]);
    for (const k of ['sinov', 'silver', 'gold', 'platinum']) {
      assert.strictEqual(tiers.PLANS[k].quotas.ocr, tiers.PLANS[k].quotas.analysis * tiers.ledger.OCR_PAGES_PER_ANALYSIS_UNIT);
    }
  });

  await test('legacy (v1) subscriptions keep their daily OCR pages: 20 / 50 / 100', () => {
    assert.deepStrictEqual(['silver', 'gold', 'platinum'].map((k) => tiers.LEGACY_PLANS[k].dailyOcrPages), [20, 50, 100]);
  });

  await test('OCR weighs nothing in legacy fair-use; Workspace AI weighs like chat', () => {
    assert.strictEqual(weight('/api/analyze/ocr'), 0);
    assert.strictEqual(weight('/api/workspace-ai'), 1);
  });

  await test('OCR runs only after a quote, a confirm and a reservation of the service it is for (2026-10-06)', () => {
    const src = read('src/ocr/routes.js');
    // the per-request OCR quota is gone: a scan is a step of analysis, opinion or chat
    assert.ok(!/enforceQuota\('\/api\/analyze\/ocr'/.test(src));
    assert.ok(/app\.post\('\/api\/analyze\/scan-quote', requireAuth/.test(src));
    const route = src.slice(src.indexOf("app.post('/api/analyze/ocr-image'"), src.indexOf("app.post('/api/analyze/scans/:id/release'"));
    const at = re => { const m = re.exec(route); assert.ok(m, String(re)); return m.index; };
    const ocrCall = at(/await ocrFn\(/);
    assert.ok(at(/readScanTicket\(/) < ocrCall, 'ticket first');
    assert.ok(at(/SCAN_CONFIRM/) < ocrCall, 'confirmed first');
    assert.ok(at(/checkFreeAccess\(/) < ocrCall, 'the free-access gate first');
    assert.ok(at(/measureScan\(buf/) < ocrCall, 'pages counted again on this file first');
    assert.ok(at(/ledger\.reserve(Many)?\(/) < ocrCall, 'reserved first');
    for (const reply of route.match(/res\.json\(\{[^)]*\}\)/gu) || []) assert.ok(!/\btext\b/u.test(reply), `the OCR text is not returned: ${reply}`);
    assert.strictEqual(tiers.serviceFor('/api/analyze/ocr'), 'ocr');
  });

  console.log('Drafts');

  await test('a draft is one unit of the period\'s drafts; Sinov has none', () => {
    assert.strictEqual(tiers.serviceFor('/api/draft/ai-generate'), 'draft');
    assert.strictEqual(tiers.PLANS.sinov.quotas.draft, 0);
    assert.ok(!/checkDraftQuota/.test(read('src/drafting/routes.js')), 'the reservation is the only check');
    assert.ok(/quotaFor\('\/api\/draft\/ai-generate', \{ failClosed: true \}\)/.test(read('src/drafting/routes.js')));
    assert.strictEqual(tiers.serviceFor('/api/draft/export'), null, 'an export calls no model and is not metered');
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
    // v2: the asking member pays from their own allowance, the Workspace is recorded
    assert.strictEqual(tiers.serviceFor('/api/workspace-ai'), 'chat');
    assert.ok(/channel: workspaceId \? 'workspace' : 'web',\s*actorId: adminId, workspaceId/.test(read('src/rag/subscription-tiers.js')));
    assert.ok(/assistant\/ask', aiLimiter \|\| \(\(req, res, next\) => next\(\)\), workspaceServiceRouting, workspaceAiQuota,/.test(routes));
    assert.ok(/refundUsage\(res, 'no_generation'\)/.test(routes));
    assert.ok(/verificationTokens,\s*tariffModule,\s*\}\);/.test(read('src/api/server.js')), 'server passes tariffModule');
    assert.ok(/member_account\.role AS member_role/.test(read('src/workspace/authz.js')));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
