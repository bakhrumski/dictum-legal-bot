'use strict';

/**
 * Tests for unlimited chat on paid plans.
 *
 * Chat moved to the cheap tier (~$0.006/answer), which puts Silver's
 * break-even past ~125 messages a day — beyond what anyone asks in real legal
 * work. So chat is unlimited and only legal opinions are metered.
 *
 * What must hold:
 *   - a paid subscriber is never told they are "out" of messages
 *   - the fair-use ceiling still catches a shared login or a script
 *   - the trial's 3/day is a REAL quota and is unaffected
 *
 *   node tests/tariff-unlimited.test.js
 */

const assert = require('assert');
const Module = require('module');
const path = require('path');
const fs = require('fs');

// ── Load the module with ../database/db stubbed ─────────────────────────────
const state = { usedToday: 0, plan: 'silver', role: 'user', startsAt: new Date('2026-01-01') };
const fakePool = {
  query: async (sql) => {
    if (/FROM admins WHERE id/i.test(sql)) {
      return { rows: [{
        tariff_plan: state.plan, tariff_starts_at: state.startsAt,
        tariff_expires_at: new Date(Date.now() + 30 * 864e5),
        bepul_used: false, role: state.role, tariff_rollover: 0,
      }] };
    }
    // Matches both the trial's COUNT(*) and the paid tiers' weighted SUM(CASE...).
    if (/COUNT\(\*\)|SUM\(/i.test(sql)) return { rows: [{ used: state.usedToday, n: state.usedToday }] };
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

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

(async () => {
  console.log('\ntariff — plan shape\n');

  await test('paid plans carry no chat limit', () => {
    for (const p of ['silver', 'gold', 'platinum']) {
      assert.strictEqual(tiers.PLANS[p].monthlyLimit, null, `${p} still has a monthly limit`);
      assert.strictEqual(tiers.PLANS[p].dailyLimit, null, `${p} still has a daily limit`);
      assert.ok(tiers.PLANS[p].fairUseDaily > 0, `${p} has no fair-use ceiling`);
    }
  });

  await test('the fair-use ceiling sits below break-even for every plan', () => {
    // Chat on the cheap tier: ~4k in / ~0.3k out at $1/$6 per 1M.
    const CHAT = 4000 * 1 / 1e6 + 300 * 6 / 1e6;
    const RATE = 13000;
    const OPIN = 0.437;
    const opinions = { silver: 3, gold: 10, platinum: 30 };
    for (const p of ['silver', 'gold', 'platinum']) {
      const revenue = tiers.PLANS[p].priceUzs / RATE;
      const chatBudget = revenue - opinions[p] * OPIN;
      const breakEvenPerDay = (chatBudget / CHAT) / 30;
      assert.ok(tiers.PLANS[p].fairUseDaily < breakEvenPerDay,
        `${p}: ceiling ${tiers.PLANS[p].fairUseDaily}/day exceeds break-even ${breakEvenPerDay.toFixed(0)}/day`);
    }
  });

  await test('the trial keeps a real 3/day quota', () => {
    assert.strictEqual(tiers.PLANS.sinov.dailyLimit, 3);
    assert.strictEqual(tiers.PLANS.sinov.fairUseDaily, null);
  });

  console.log('\ntariff — cost weighting\n');

  await test('the ceiling holds whatever mix of features is used', () => {
    // The hole this closes: chat runs on Luna (~$0.006) but generating a legal
    // document runs on Terra with a much bigger output (~$0.0425). Counting
    // both as "1 request" let a Silver subscriber spend 75/day on documents —
    // ~$97/month against $23 of revenue.
    const RATE = 13000, OPIN = 0.437;
    const CHAT = 4000 * 1 / 1e6 + 300 * 6 / 1e6;
    const DOC = 5000 * 2.5 / 1e6 + 2000 * 15 / 1e6;
    const DOC_WEIGHT = 7;
    const opinions = { silver: 3, gold: 10, platinum: 30 };

    assert.ok(DOC / CHAT <= DOC_WEIGHT + 1,
      `a document costs ${(DOC / CHAT).toFixed(1)}x a chat message — weight ${DOC_WEIGHT} is too low`);

    for (const p of ['silver', 'gold', 'platinum']) {
      const rev = tiers.PLANS[p].priceUzs / RATE;
      const ceiling = tiers.PLANS[p].fairUseDaily;
      const opinionCost = opinions[p] * OPIN;
      // Two extremes of the same ceiling; both must stay profitable.
      const allChat = ceiling * 30 * CHAT + opinionCost;
      const allDocs = (ceiling / DOC_WEIGHT) * 30 * DOC + opinionCost;
      assert.ok(allChat < rev, `${p}: all-chat at the ceiling loses money`);
      assert.ok(allDocs < rev, `${p}: all-documents at the ceiling loses money ($${allDocs.toFixed(2)} vs $${rev.toFixed(2)})`);
    }
  });

  console.log('\ntariff — quota checks\n');

  await test('a paid user well under the ceiling is unlimited', async () => {
    state.plan = 'silver'; state.usedToday = 40;
    const q = await tiers.checkQuota(1);
    assert.strictEqual(q.allowed, true);
    assert.strictEqual(q.unlimited, true);
    assert.strictEqual(q.limit, null, 'an unlimited plan must not report a limit');
    assert.strictEqual(q.remaining, Infinity);
  });

  await test('the monthly cap is gone — counting is daily now', async () => {
    // Under the old rules Silver stopped at 200 messages PER MONTH (~7/day).
    // The ceiling is now per-day, so the same subscriber can sustain
    // fairUseDaily every day — roughly 15x the old monthly allowance — and
    // the monthly total is never consulted at all.
    state.plan = 'silver'; state.usedToday = 50;   // 7x the old ~7/day pace
    const q = await tiers.checkQuota(1);
    assert.strictEqual(q.allowed, true);
    assert.strictEqual(q.period, 'unlimited');

    const oldMonthlyCap = 200;
    const newMonthlyEquivalent = tiers.PLANS.silver.fairUseDaily * 30;
    assert.ok(newMonthlyEquivalent > oldMonthlyCap * 10,
      `expected a large increase, got ${newMonthlyEquivalent} vs ${oldMonthlyCap}`);
  });

  await test('the fair-use ceiling engages, flagged as rate-limiting not exhaustion', async () => {
    state.plan = 'silver'; state.usedToday = tiers.PLANS.silver.fairUseDaily;
    const q = await tiers.checkQuota(1);
    assert.strictEqual(q.allowed, false);
    assert.strictEqual(q.fairUseHit, true, 'must be marked as fair-use, not a spent quota');
    assert.strictEqual(q.unlimited, true, 'the plan is still unlimited');
  });

  await test('higher tiers absorb more before the ceiling', async () => {
    state.usedToday = tiers.PLANS.silver.fairUseDaily + 1;
    state.plan = 'gold';
    assert.strictEqual((await tiers.checkQuota(1)).allowed, true, 'gold blocked at silver ceiling');
    state.plan = 'platinum';
    assert.strictEqual((await tiers.checkQuota(1)).allowed, true, 'platinum blocked at silver ceiling');
  });

  await test('the trial still blocks on its 4th request of the day', async () => {
    state.plan = 'sinov'; state.usedToday = 3;
    const q = await tiers.checkQuota(1);
    assert.strictEqual(q.allowed, false);
    assert.strictEqual(q.limit, 3);
    assert.ok(!q.fairUseHit, 'the trial is a real quota, not fair use');
  });

  await test('staff and master bypass entirely', async () => {
    state.role = 'lawyer'; state.usedToday = 99999;
    assert.strictEqual((await tiers.checkQuota(1)).allowed, true);
    state.role = 'master';
    assert.strictEqual((await tiers.checkQuota(1)).allowed, true);
    state.role = 'user';
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
