'use strict';

/**
 * Adaptive account, PR A1, on real Postgres (migration 022): signals are
 * stored as codes only, a paused profile records nothing, the profile is
 * computed and read per account, old signals go, account deletion removes
 * both. Needs TEST_DATABASE_URL (throwaway).
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/adaptive-profile.db.test.js
 */

const assert = require('assert');
if (!process.env.TEST_DATABASE_URL) {
  console.log('adaptive profile (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like production');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool } = require('../src/database/db');
const { createProfileStore, deleteAccountProfile, answerSignals } = require('../src/adaptive/profile');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const A = 910000000 + Math.floor(Math.random() * 1e6), B = A + 1, C = A + 2;

(async () => {
  console.log('adaptive profile (db)');
  const store = createProfileStore({ db: pool });
  const Q = 'Ijarachi ijara haqini to‘lamayapti, nima qilay?';
  const ANS = 'Tahlil: [Fuqarolik kodeksi, 544-modda](https://lex.uz/docs/-9990001) ...';

  await test('an answer is stored as codes; the profile is computed per account', async () => {
    for (let i = 0; i < 3; i++) await store.record(A, answerSignals({ question: Q, answer: ANS, topic: 'fuqarolik', channel: 'web' }));
    const rows = (await pool.query('SELECT kind, value, label FROM user_signals WHERE admin_id = $1', [A])).rows;
    assert.ok(rows.length >= 15);
    assert.ok(!rows.some(r => /to‘lamayapti|Ijarachi/u.test(r.value + r.label)), 'no question text stored');
    const pr = await store.recompute(A);
    assert.deepStrictEqual([pr.areas[0].code, pr.acts[0].docId, pr.script], ['fuqarolik', '9990001', 'latn']);
    const got = await store.get(A);
    assert.strictEqual(got.effective.areas[0].code, 'fuqarolik');
    assert.strictEqual((await store.get(B)).profile, null, "another account's profile is not this one");
  });

  await test('what the person set wins; a paused profile records nothing and is not used', async () => {
    await pool.query(`UPDATE user_profile SET manual = '{"script":"cyrl"}'::jsonb WHERE admin_id = $1`, [A]);
    assert.strictEqual((await store.get(A)).effective.script, 'cyrl');
    await pool.query(`INSERT INTO user_profile (admin_id, paused) VALUES ($1, true)`, [B]);
    assert.strictEqual(await store.record(B, answerSignals({ question: Q, answer: ANS, topic: 'fuqarolik' })), 0);
    assert.strictEqual((await pool.query('SELECT count(*)::int AS n FROM user_signals WHERE admin_id = $1', [B])).rows[0].n, 0);
    assert.strictEqual((await store.get(B)).effective, null);
    process.env.ADAPTIVE = 'off';
    try { assert.strictEqual(await store.record(C, [{ kind: 'area', value: 'mehnat' }]), 0, 'ADAPTIVE=off records nothing'); } finally { delete process.env.ADAPTIVE; }
  });

  await test('signals past 180 days go in the sweep; account deletion removes signals and profile', async () => {
    await store.record(C, [{ kind: 'area', value: 'mehnat' }, { kind: 'area', value: 'soliq' }]);
    await pool.query(`UPDATE user_signals SET created_at = now() - interval '200 days' WHERE admin_id = $1 AND value = 'soliq'`, [C]);
    await store.sweep();
    assert.deepStrictEqual((await pool.query('SELECT value FROM user_signals WHERE admin_id = $1', [C])).rows.map(r => r.value), ['mehnat']);
    await deleteAccountProfile(pool, A);
    assert.strictEqual((await pool.query('SELECT count(*)::int AS n FROM user_signals WHERE admin_id = $1', [A])).rows[0].n, 0);
    assert.strictEqual((await store.get(A)).profile, null);
  });

  for (const id of [A, B, C]) await deleteAccountProfile(pool, id).catch(() => {});
  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end().catch(() => {});
  process.exit(failed ? 1 : 0);
})();
