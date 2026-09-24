'use strict';

/**
 * Quota races on a real Postgres (audit M1, H4). Needs TEST_DATABASE_URL
 * pointing at a THROWAWAY database with the app schema (CI boot-smoke, or a
 * local one after `node src/database/setup.js`); skips without it. It reads
 * its own variable, never DATABASE_URL, so a .env pointing at production
 * cannot be picked up by accident.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/tariff-race.db.test.js
 */

const assert = require('assert');

if (!process.env.TEST_DATABASE_URL) {
  console.log('tariff race (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like a hosted database');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const { pool } = require('../src/database/db');
const tiers = require('../src/rag/subscription-tiers');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

async function makeUser(plan) {
  await tiers.initSubscriptionSchema();
  const name = `race_${plan}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const r = await pool.query(
    `INSERT INTO admins (username, password, full_name, role, tariff_plan, tariff_starts_at, tariff_expires_at,
                         telegram_user_id, channel_verified_at, survey_completed_at, free_gate_since)
     VALUES ($1, 'x', 'Race Test', 'user', $2, NOW(), NOW() + INTERVAL '5 days', $3, NOW(), NOW(), NOW())
     RETURNING id`, [name, plan, 9e11 + Math.floor(Math.random() * 1e9)]);
  return r.rows[0].id;
}

function fakeRes() {
  return { statusCode: 200, locals: {}, headersSent: false,
    status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; this.headersSent = true; return this; }, on() { return this; } };
}

(async () => {
  console.log('tariff race (db)');

  await test('10 parallel chat requests on a 3/day trial: exactly 3 pass', async () => {
    const id = await makeUser('sinov');
    const mw = tiers.enforceQuota('/api/legal-chat');
    const outcomes = await Promise.all(Array.from({ length: 10 }, async () => {
      let ok = false;
      await mw({ session: { adminId: id, role: 'user' } }, fakeRes(), () => { ok = true; });
      return ok;
    }));
    const used = (await pool.query('SELECT count(*)::int AS n FROM tariff_usage WHERE admin_id = $1', [id])).rows[0].n;
    assert.strictEqual(outcomes.filter(Boolean).length, 3, `passed ${outcomes.filter(Boolean).length}`);
    assert.strictEqual(used, 3);
  });

  await test('5 parallel opinions with 1 weekly credit: exactly 1 reserved', async () => {
    const id = await makeUser('sinov');
    const results = await Promise.all(Array.from({ length: 5 }, () => tiers.reserveOpinionCredits(id, 1)));
    assert.strictEqual(results.filter(r => r.allowed).length, 1);
    const spent = (await pool.query(
      `SELECT COALESCE(SUM(credits),0)::int AS n FROM tariff_usage WHERE admin_id = $1 AND endpoint LIKE '%legal-opinion%'`, [id])).rows[0].n;
    assert.strictEqual(spent, 1);
  });

  await test('a released reservation gives the credit back', async () => {
    const id = await makeUser('sinov');
    const first = await tiers.reserveOpinionCredits(id, 1);
    assert.ok(first.allowed && first.reservationId);
    assert.strictEqual((await tiers.reserveOpinionCredits(id, 1)).allowed, false);
    assert.strictEqual(await tiers.releaseOpinionCredits(id, first.reservationId), true);
    assert.strictEqual((await tiers.reserveOpinionCredits(id, 1)).allowed, true);
  });

  await test('for comparison: the old unlocked check-then-insert lets more through', async () => {
    const id = await makeUser('sinov');
    const outcomes = await Promise.all(Array.from({ length: 10 }, async () => {
      const q = await tiers.checkQuota(id);
      if (!q.allowed) return false;
      await tiers.recordUsage(id, '/api/legal-chat');
      return true;
    }));
    const n = outcomes.filter(Boolean).length;
    console.log(`      (unlocked: ${n} of 10 passed a 3/day limit)`);
    assert.ok(n >= 3);
  });

  await pool.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
