'use strict';

/**
 * Cash, carried credit and service revenue on a real Postgres (tariffs v2
 * review, 2026-10-06), with exact sums:
 *   - cash is each payment once, when it was accepted;
 *   - credit carried on upgrade is value moved between a customer's own
 *     periods: shown in and out, never cash, never revenue twice;
 *   - service revenue is price + credit in - credit out of each period,
 *     spread over the days it ran; revenue in a window + revenue deferred
 *     at its end = the cash paid.
 * Needs TEST_DATABASE_URL (throwaway).
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/tariff-revenue.db.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

if (!process.env.TEST_DATABASE_URL) {
  console.log('tariff revenue (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like a hosted database');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const { pool } = require('../src/database/db');
const tiers = require('../src/rag/subscription-tiers');
const ledger = require('../src/rag/tariff-ledger');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const made = [];
const rnd = () => Math.floor(Math.random() * 1e9);
const DAY = 86400000;
// a fixed past start, so every number below is exact
const T0 = Date.UTC(2026, 5, 1, 0, 0, 0);
const at = d => new Date(T0 + d * DAY);

async function ensureSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS admins (id serial PRIMARY KEY, username varchar(100) UNIQUE, password text, full_name text, role varchar(20) DEFAULT 'user')`);
  for (const col of ['created_at timestamptz DEFAULT now()', 'telegram_username varchar(100)', 'tariff_plan varchar(20)', 'tariff_starts_at timestamptz', 'tariff_expires_at timestamptz',
    'telegram_user_id bigint', 'telegram_chat_id bigint', 'channel_verified_at timestamptz', 'survey_completed_at timestamptz', 'free_gate_since timestamptz']) {
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS ${col}`);
  }
  await tiers.initSubscriptionSchema();
  await pool.query(fs.readFileSync(path.join(__dirname, '../migrations/20261004_013_tariff_periods.sql'), 'utf8'));
  await require('../src/rag/llm-spend-log').initSpendLog();
}
async function makeUser() {
  const r = await pool.query(`INSERT INTO admins (username, password, full_name, role) VALUES ($1, 'x', 'Revenue Test', 'user') RETURNING id`,
    [`rv_${Date.now()}_${rnd()}`]);
  made.push(r.rows[0].id);
  return r.rows[0].id;
}
const grant = (adminId, plan, day, tag) => ledger.grantPaidPeriod({ adminId, plan, paymentRef: `rv-${adminId}-${tag}`, now: at(day) });
async function row(adminId, from, to) {
  const r = await tiers.marginReport({ since: at(from), until: at(to) });
  return r.rows.find(x => x.adminId === adminId);
}

(async () => {
  console.log('tariff revenue (db)');
  await ensureSchema();

  await test('regular renewal: two payments of 199 000; revenue follows the days, the rest is deferred', async () => {
    const u = await makeUser();
    await grant(u, 'silver', 0, 'p1');
    const renewal = await grant(u, 'silver', 29, 'p2');
    assert.deepStrictEqual([renewal.change, renewal.period.starts_at.getTime()], ['renewal', at(30).getTime()], 'queued after the first');
    const r = await row(u, -1, 40);
    assert.deepStrictEqual(
      [r.cashReceivedUzs, r.creditCarriedInUzs, r.creditCarriedOutUzs, r.recognizedRevenueUzs, r.deferredRevenueUzs],
      [398000, 0, 0, 199000 + 66333, 132667]);
    assert.strictEqual(r.recognizedRevenueUzs + r.deferredRevenueUzs, r.cashReceivedUzs);
    // windows add up: [-1, 30) + [30, 40) = [-1, 40)
    const first = await row(u, -1, 30);
    const second = await row(u, 30, 40);
    assert.deepStrictEqual([first.cashReceivedUzs, first.recognizedRevenueUzs, second.cashReceivedUzs, second.recognizedRevenueUzs], [398000, 199000, 0, 66333]);
    assert.strictEqual(first.recognizedRevenueUzs + second.recognizedRevenueUzs, r.recognizedRevenueUzs);
  });

  await test('renewal bought in advance: cash when paid, revenue only when its days run', async () => {
    const u = await makeUser();
    await grant(u, 'silver', 0, 'p1');
    await grant(u, 'silver', 1, 'p2');
    const r = await row(u, -1, 15);
    assert.deepStrictEqual([r.cashReceivedUzs, r.recognizedRevenueUzs, r.deferredRevenueUzs], [398000, 99500, 298500]);
    const later = await row(u, 30, 45);
    assert.deepStrictEqual([later.cashReceivedUzs, later.recognizedRevenueUzs], [0, 99500], 'the advance renewal earns in its own days, with no new cash');
  });

  await test('upgrade chain (Silver, a renewal bought ahead, then Gold): the old payments are counted once, the credit is not cash', async () => {
    const u = await makeUser();
    const p1 = await grant(u, 'silver', 0, 'p1');
    const p2 = await grant(u, 'silver', 5, 'p2');       // queued from day 30
    const up = await grant(u, 'gold', 10, 'p3');
    // credit: 20/30 of 199 000 unused in the running period (132 666) + the
    // whole queued renewal (199 000) = 331 666, floored to 331 000
    assert.deepStrictEqual([up.change, up.creditUzs, up.cashUzs], ['upgrade', 331000, 268000]);
    assert.deepStrictEqual(up.economics.creditFrom.map(x => [x.periodId, x.uzs]), [[Number(p1.period.id), 132666], [Number(p2.period.id), 198334]]);
    const rows = (await pool.query('SELECT id, status, carried_out_uzs, superseded_at, ends_at FROM tariff_periods WHERE id = ANY($1) ORDER BY id', [[p1.period.id, p2.period.id]])).rows;
    assert.deepStrictEqual(rows.map(x => [x.status, x.carried_out_uzs, x.superseded_at.getTime()]),
      [['superseded', 132666, at(10).getTime()], ['superseded', 198334, at(10).getTime()]]);
    assert.strictEqual(rows[0].ends_at.getTime(), at(10).getTime(), 'the running period ran until the upgrade');

    const r = await row(u, -1, 25);
    assert.deepStrictEqual(
      [r.cashReceivedUzs, r.creditCarriedInUzs, r.creditCarriedOutUzs],
      [199000 + 199000 + 268000, 331000, 331000], 'cash 666 000 once; 331 000 moved, not received');
    // revenue: Silver 199 000 - 132 666 over its 10 days = 66 334; the
    // queued renewal's 666 left over when superseded; Gold 599 000 over
    // 30 days, 15 of them in the window = 299 500
    assert.strictEqual(r.recognizedRevenueUzs, 66334 + 666 + 299500);
    assert.strictEqual(r.deferredRevenueUzs, 299500);
    assert.strictEqual(r.recognizedRevenueUzs + r.deferredRevenueUzs, r.cashReceivedUzs, 'revenue + deferred = cash: nothing counted twice');
    const all = await row(u, -1, 60);
    assert.deepStrictEqual([all.recognizedRevenueUzs, all.deferredRevenueUzs], [666000, 0], 'over the whole chain, revenue = cash paid');
  });

  await test('the report keeps cash, credit and revenue apart in its totals; refunds are unknown, not 0', async () => {
    const r = await tiers.marginReport({ since: at(-1), until: at(25) });
    for (const k of ['cashReceivedUzs', 'creditCarriedInUzs', 'creditCarriedOutUzs', 'recognizedRevenueUzs', 'deferredRevenueUzs']) {
      assert.strictEqual(typeof r.totals[k], 'number', k);
    }
    assert.deepStrictEqual([r.totals.refundsUzs, r.totals.refundsStatus], [null, 'not_tracked']);
    assert.ok(!('salePriceUzs' in r.totals), 'no total that adds credit to cash');
  });

  try {
    const subjects = made.map(a => `a:${a}`);
    await pool.query(`DELETE FROM tariff_usage WHERE admin_id = ANY($1) OR subject = ANY($2)`, [made, subjects]);
    await pool.query(`UPDATE tariff_periods SET superseded_by = NULL WHERE subject = ANY($1)`, [subjects]);
    await pool.query(`DELETE FROM tariff_periods WHERE subject = ANY($1)`, [subjects]);
    await pool.query(`DELETE FROM admins WHERE id = ANY($1)`, [made]);
  } catch (e) { console.warn('cleanup:', e.message); }
  await pool.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
