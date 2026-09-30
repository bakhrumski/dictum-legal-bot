'use strict';

/**
 * The exact-match failsafe matches the question's word pairs, not single
 * words (eval run 20: a 7,573-character vehicle regulation came first, at a
 * fixed 0.80, for questions on fines, cassation and legal capacity - it was
 * the longest chunk holding one of "мне", "куда", "могу").
 *
 *   TEST_DATABASE_URL=postgresql://… node tests/exact-match-phrases.db.test.js
 */

const assert = require('assert');

if (!process.env.TEST_DATABASE_URL) {
  console.log('exact match phrases: skipped (TEST_DATABASE_URL not set)');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('exact match phrases: refusing to run against a hosted database');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool } = require('../src/database/db');
const { initLegalCorpus, exactMatchSearch } = require('../src/rag/legal-corpus');
const { initAdvancedCorpus } = require('../src/rag/advanced-corpus');
const { normalizeUzbekForSearch } = require('../src/rag/search-utils');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

const CATEGORY = 'test-exact-phrases';
// A long regulation that holds the question's common words one by one.
const HUB = ('Технический регламент. По мнению органа, куда бы ни было подано заявление, могу отметить, ' +
  'что только часть требований применяется к транспортным средствам. ').repeat(60);
const ANSWER = "332¹-modda. Jarimaning bir qismini to'lash. Jarimaning yarmini o'n besh kun ichida " +
  "to'lagan shaxs jarimaning qolgan qismini to'lashdan ozod qilinadi. Оплатить только часть штрафа можно в течение 15 дней.";
const OTHER = 'Boshqa modda. Mahalliy kengash majlisi.';

(async () => {
  console.log('exact match phrases');
  await initLegalCorpus();
  await initAdvancedCorpus(); // the columns production has (article_number_display, …)
  const ids = [];
  try {
    for (const [law, text] of [['TEST-HUB REGLAMENT', HUB], ['TEST MJtK', ANSWER], ['TEST Other', OTHER]]) {
      const { rows } = await pool.query(
        `INSERT INTO legal_chunks (law_name, category, chunk_text, search_text, source_type, doc_id, is_valid)
         VALUES ($1, $2, $3, $4, 'law_text', $5, TRUE) RETURNING id`,
        [law, CATEGORY, text, normalizeUzbekForSearch(text), `exact_${law}`]);
      ids.push(rows[0].id);
    }
    const q = 'Могу ли я оплатить только часть штрафа, чтобы остаток мне простили, и в какие сроки это нужно сделать?';

    await test('a chunk holding only single words of the question does not match', async () => {
      const rows = await exactMatchSearch(q, { category: CATEGORY, limit: 5 });
      console.log(`      matched: ${rows.map(r => `${r.law_name} (${r.exact_patterns})`).join(', ') || '—'}`);
      assert.ok(!rows.some(r => r.law_name === 'TEST-HUB REGLAMENT'), 'the long regulation is not an exact match');
      assert.strictEqual(rows[0] && rows[0].law_name, 'TEST MJtK');
    });

    await test('the last-resort fallback (allowTokens) still matches single words, most patterns first', async () => {
      const rows = await exactMatchSearch(q, { category: CATEGORY, limit: 5, allowTokens: true });
      assert.ok(rows.some(r => r.law_name === 'TEST-HUB REGLAMENT'));
      assert.strictEqual(rows[0].law_name, 'TEST MJtK', 'the chunk matching more patterns comes first, not the longest');
      assert.ok(rows[0].exact_patterns > rows.find(r => r.law_name === 'TEST-HUB REGLAMENT').exact_patterns);
    });

    await test('a one-word question still uses its word', async () => {
      const rows = await exactMatchSearch('Mahalliy?', { category: CATEGORY, limit: 5 });
      assert.deepStrictEqual(rows.map(r => r.law_name), ['TEST Other']);
    });
  } finally {
    if (ids.length) await pool.query('DELETE FROM legal_chunks WHERE id = ANY($1::int[])', [ids]);
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
