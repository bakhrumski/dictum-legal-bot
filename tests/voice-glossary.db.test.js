'use strict';

/**
 * Each account's own speech glossary (2026-10-28, migration 021,
 * src/voice/user-glossary.js): it learns from what the person changed or
 * kept, puts their own correction first, never shows one account's words to
 * another, keeps at most 500 rows (a learned row makes room, a hand-made one
 * stays), and goes with the account. Needs TEST_DATABASE_URL (throwaway).
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/voice-glossary.db.test.js
 */

const assert = require('assert');
if (!process.env.TEST_DATABASE_URL) {
  console.log('voice glossary (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like production');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool } = require('../src/database/db');
const { createUserGlossary, deleteAccountGlossary, MAX } = require('../src/voice/user-glossary');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const A = 900000000 + Math.floor(Math.random() * 1e6), B = A + 1;

(async () => {
  console.log('voice glossary (db)');
  const g = createUserGlossary({ db: pool });

  await test('learns the words the person changed, and offers their correction first next time - to them only', async () => {
    await g.learn(A, { heard: "Yangi ish och: Qudratxo'ja bilan nizo", final: 'Yangi ish och: Pudratchi bilan nizo', suggested: [] });
    const rows = await g.list(A);
    assert.deepStrictEqual(rows.map(r => [r.kind, r.heard, r.term, r.source]), [['fix', "Qudratxo'ja", 'Pudratchi', 'learned']]);
    assert.deepStrictEqual(await g.suggest(A, "Qudratxo'ja bilan uchrashuv"), [{ from: "Qudratxo'ja", to: 'Pudratchi', personal: true }]);
    assert.deepStrictEqual(await g.list(B), [], "another account's glossary is empty");
    await g.learn(A, { pairs: [{ from: "Qudratxo'ja", to: 'Pudratchi' }] });
    assert.strictEqual((await g.list(A))[0].uses, 2, 'the same correction again counts as a use, not a new row');
  });

  await test('a word kept against a suggestion is not suggested again; a name added by hand is never flagged', async () => {
    assert.deepStrictEqual((await g.suggest(B, 'Qudrat aka keldi')).map(x => x.to), ['Pudrat']);
    await g.learn(B, { heard: 'Qudrat aka keldi', final: 'Qudrat aka keldi', suggested: [{ from: 'Qudrat', to: 'Pudrat' }] });
    assert.deepStrictEqual(await g.suggest(B, 'Qudrat aka keldi'), []);
    const row = await g.add(B, { term: 'Qurilish' });
    assert.strictEqual(row.kind, 'word');
    assert.deepStrictEqual((await g.suggest(B, 'Alfa Qurulish bilan')).map(x => x.to), ['Qurilish'], 'a slip of their own word is suggested');
    assert.strictEqual(await g.add(B, { term: 'x' }), null, 'too short');
    assert.strictEqual(await g.add(B, { heard: 'Pudratchi', term: 'pudratchi' }), null, 'a fix must change the word');
  });

  await test('at most 500 rows: a learned row makes room, hand-made ones stay; delete is own rows only; account deletion removes all', async () => {
    const C = A + 2;
    await pool.query(`INSERT INTO voice_glossary (admin_id, kind, term, source) SELECT $1, 'word', 'soz' || g, 'manual' FROM generate_series(1, $2 - 1) g`, [C, MAX]);
    await g.learn(C, { keep: ['Eskiso'] });
    assert.strictEqual((await g.list(C)).length, MAX);
    const fresh = await g.learn(C, { keep: ['Yangiso'] });
    assert.strictEqual(fresh.length, 1, 'the learned row made room');
    const words = (await g.list(C)).map(r => r.term);
    assert.ok(words.includes('Yangiso') && !words.includes('Eskiso') && words.length === MAX);
    assert.ok(await g.add(C, { term: 'Yana bitta' }), 'the last learned row makes room for a hand-made one');
    assert.ok(!(await g.list(C)).some(r => r.source === 'learned'));
    assert.strictEqual(await g.add(C, { term: 'Yana ikkita' }), null, 'full of hand-made rows: nothing is dropped for a new one');
    const id = (await g.list(A))[0].id;
    assert.strictEqual(await g.remove(B, id), false, "another account's row");
    assert.strictEqual(await g.remove(A, id), true);
    await deleteAccountGlossary(pool, C);
    assert.strictEqual((await g.list(C)).length, 0);
  });

  await pool.query('DELETE FROM voice_glossary WHERE admin_id = ANY($1)', [[A, B, A + 2]]).catch(() => {});
  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end().catch(() => {});
  process.exit(failed ? 1 : 0);
})();
