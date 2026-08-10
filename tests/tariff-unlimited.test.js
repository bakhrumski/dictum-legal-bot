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
const state = { usedToday: 0, plan: 'silver', role: 'user', startsAt: new Date('2026-01-01'), lastUpdateParams: null };
const fakePool = {
  query: async (sql, params = []) => {
    if (/FROM admins WHERE id/i.test(sql)) {
      return { rows: [{
        tariff_plan: state.plan, tariff_starts_at: state.startsAt,
        tariff_expires_at: new Date(Date.now() + 30 * 864e5),
        bepul_used: false, role: state.role, tariff_rollover: 0,
      }] };
    }
    // Matches both the trial's COUNT(*) and the paid tiers' weighted SUM(CASE...).
    if (/COUNT\(\*\)|SUM\(/i.test(sql)) return { rows: [{ used: state.usedToday, n: state.usedToday }] };
    if (/UPDATE admins\s+SET tariff_plan/i.test(sql)) {
      state.lastUpdateParams = params;
      return { rows: [] };
    }
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

  await test('WORST case — 100% of every quota — stays in the 5-10% band', () => {
    // The whole plan set is solved against this. If a price, a quota, a
    // ceiling or a unit cost moves and the worst case leaves the band, that is
    // a pricing decision that must be made deliberately, not discovered later
    // from an invoice.
    const RATE = 11980, W = 52 / 12;
    const CHAT = 4000 * 1 / 1e6 + 300 * 6 / 1e6;   // Luna
    const DRAFT = 5000 * 2.5 / 1e6 + 2000 * 15 / 1e6;  // Terra
    const CREDIT = 0.22;
    for (const p of ['silver', 'gold', 'platinum']) {
      const c = tiers.PLANS[p];
      const revenue = c.priceUzs / RATE;
      const cost = c.weeklyOpinionCredits * W * CREDIT
                 + c.weeklyDrafts * W * DRAFT
                 + c.fairUseDaily * 30 * CHAT;
      const margin = (revenue - cost) / revenue;
      assert.ok(margin >= 0.04 && margin <= 0.12,
        `${p}: worst-case margin ${(margin * 100).toFixed(1)}% is outside the 5-10% band`);
    }
  });

  await test('MEDIUM case — 35% usage — lands in the 40-60%+ band', () => {
    const RATE = 11980, W = 52 / 12;
    const CHAT = 4000 * 1 / 1e6 + 300 * 6 / 1e6;
    const DRAFT = 5000 * 2.5 / 1e6 + 2000 * 15 / 1e6;
    const CREDIT = 0.22, Q = 0.35;
    for (const p of ['silver', 'gold', 'platinum']) {
      const c = tiers.PLANS[p];
      const revenue = c.priceUzs / RATE;
      const cost = c.weeklyOpinionCredits * W * Q * CREDIT
                 + c.weeklyDrafts * W * Q * DRAFT + 15 * 30 * CHAT;
      const margin = (revenue - cost) / revenue;
      assert.ok(margin >= 0.40, `${p}: medium margin ${(margin * 100).toFixed(0)}% below 40%`);
    }
  });

  await test('opinion credits scale with document size', () => {
    // Flat counting made the worst case a lottery: opinions cost $0.15-$0.65.
    assert.strictEqual(tiers.opinionCreditsFor(10000), 1);
    assert.strictEqual(tiers.opinionCreditsFor(40000), 1);
    assert.strictEqual(tiers.opinionCreditsFor(40001), 2);
    assert.strictEqual(tiers.opinionCreditsFor(90000), 2);
    assert.strictEqual(tiers.opinionCreditsFor(120000), 3);
    assert.strictEqual(tiers.opinionCreditsFor(0), 1, 'unknown length must not be free');
  });

  await test('the free tier steps down instead of running 10/day forever', () => {
    const b = tiers.PLANS.bepul;
    assert.strictEqual(b.priceUzs, 0);
    assert.strictEqual(b.dailyLimit, 10);
    assert.ok(b.dailyLimitLater < b.dailyLimit,
      'an un-stepped free tier is the platform\'s largest unbounded cost');
    assert.strictEqual(b.durationDays, null, 'the free tier must not expire');
  });

  await test('the permanent free plan is stored without an expiry date', async () => {
    state.lastUpdateParams = null;
    const selected = await tiers.selectPlan(1, 'bepul');
    assert.strictEqual(selected.expiresAt, null);
    assert.ok(state.lastUpdateParams, 'plan update was not written');
    assert.strictEqual(state.lastUpdateParams[2], null, 'database expiry must be NULL');
  });

  await test('the trial keeps a real 3/day quota', () => {
    assert.strictEqual(tiers.PLANS.sinov.dailyLimit, 3);
    assert.strictEqual(tiers.PLANS.sinov.fairUseDaily, null);
  });

  console.log('\ntariff — cost weighting\n');

  await test('the ceiling holds whatever mix of features is used', () => {
    // Chat runs on Luna (~$0.006); generating a document runs on Terra with a
    // much bigger output (~$0.0425) — 7x. Counting both as "1 request" once let
    // a subscriber spend the whole ceiling on documents at a -321% margin.
    const RATE = 11980, W = 52 / 12;
    const CHAT = 4000 * 1 / 1e6 + 300 * 6 / 1e6;
    const DOC = 5000 * 2.5 / 1e6 + 2000 * 15 / 1e6;
    const CREDIT = 0.22, DOC_WEIGHT = 7;

    assert.ok(DOC / CHAT <= DOC_WEIGHT + 1,
      `a document costs ${(DOC / CHAT).toFixed(1)}x a chat message — weight ${DOC_WEIGHT} is too low`);

    for (const p of ['silver', 'gold', 'platinum']) {
      const c = tiers.PLANS[p];
      const rev = c.priceUzs / RATE;
      const quota = c.weeklyOpinionCredits * W * CREDIT + c.weeklyDrafts * W * DOC;
      // Both extremes of the SAME ceiling must stay profitable on top of a
      // fully-spent quota.
      const allChat = quota + c.fairUseDaily * 30 * CHAT;
      const allDocs = quota + (c.fairUseDaily / DOC_WEIGHT) * 30 * DOC;
      assert.ok(allChat < rev, `${p}: all-chat at the ceiling loses money`);
      assert.ok(allDocs < rev, `${p}: all-documents at the ceiling loses money`);
    }
  });

  console.log('\ntariff — quota checks\n');

  await test('a paid user well under the ceiling is unlimited', async () => {
    state.plan = 'silver'; state.usedToday = 8;   // ceiling is 15/day
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
    state.plan = 'silver'; state.usedToday = 10;  // still under the 15/day ceiling
    const q = await tiers.checkQuota(1);
    assert.strictEqual(q.allowed, true);
    assert.strictEqual(q.period, 'unlimited');

    const oldMonthlyCap = 200;
    const newMonthlyEquivalent = tiers.PLANS.silver.fairUseDaily * 30;
    assert.ok(newMonthlyEquivalent > oldMonthlyCap,
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
