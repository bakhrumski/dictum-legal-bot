'use strict';

/**
 * Quota races on a real Postgres (audit M1, H4), under tariffs v2. Needs TEST_DATABASE_URL
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
  // tariffs v2: 'sinov' here means a new account, which starts on the
  // one-time Sinov (5 chat, 1 opinion) with its first request
  if (plan === 'sinov') plan = null;
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

  await test('10 parallel chat requests on the Sinov (5 chat): exactly 5 pass', async () => {
    const id = await makeUser('sinov');
    const mw = tiers.enforceQuota('/api/legal-chat');
    const outcomes = await Promise.all(Array.from({ length: 10 }, async () => {
      let ok = false;
      await mw({ session: { adminId: id, role: 'user' } }, fakeRes(), () => { ok = true; });
      return ok;
    }));
    const used = (await pool.query(`SELECT count(*)::int AS n FROM tariff_usage WHERE admin_id = $1 AND status <> 'released'`, [id])).rows[0].n;
    assert.strictEqual(outcomes.filter(Boolean).length, 5, `passed ${outcomes.filter(Boolean).length}`);
    assert.strictEqual(used, 5);
  });

  await test('5 parallel opinions with 1 Sinov opinion unit: exactly 1 reserved', async () => {
    const id = await makeUser('sinov');
    const results = await Promise.all(Array.from({ length: 5 }, () => tiers.reserveOpinionCredits(id, 1)));
    assert.strictEqual(results.filter(r => r.allowed).length, 1);
    const spent = (await pool.query(
      `SELECT COALESCE(SUM(credits),0)::int AS n FROM tariff_usage WHERE admin_id = $1 AND service = 'opinion' AND status <> 'released'`, [id])).rows[0].n;
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

  await pool.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
