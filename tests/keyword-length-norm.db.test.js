'use strict';

/**
 * Keyword length normalisation (eval runs 5-6: one broad regulation came
 * back in the top 3 for 71-81 of 145 questions). A very long chunk contains
 * most common words, so it outranked the article that answers the question.
 *
 *   TEST_DATABASE_URL=postgresql://… node tests/keyword-length-norm.db.test.js
 */

const assert = require('assert');

if (!process.env.TEST_DATABASE_URL) {
  console.log('keyword length norm: skipped (TEST_DATABASE_URL not set)');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('keyword length norm: refusing to run against a hosted database');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
delete process.env.RAG_KEYWORD_LENGTH_NORM;
const { pool } = require('../src/database/db');
const { initLegalCorpus, keywordSearch, keywordLengthNormFrom } = require('../src/rag/legal-corpus');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

const CATEGORY = 'test-kw-length';
// A broad regulation: every procedure a citizen might ask about, once each.
const HUB = Array.from({ length: 60 }, (_, i) =>
  `${i + 1}. Ariza sudga yoki davlat organiga murojaat qilish tartibida beriladi, hujjatlar muddati, ` +
  `undirish, aliment, nafaqa, ish haqi, soliq, mulk, shartnoma va boshqa masalalar bo'yicha ruxsat ` +
  `berish tartib-taomillari elektron tizim orqali amalga oshiriladi.`).join('\n');
const ARTICLE = `136-modda. Aliment undirish uchun murojaat qilish muddati. Aliment olish huquqiga ega ` +
  `shaxs aliment undirish haqida sudga istalgan vaqtda murojaat qilishga haqli, murojaat muddati ` +
  `cheklanmaydi. O'tgan davr uchun aliment sudga murojaat qilingan kundan oldingi uch yil doirasida undiriladi.`;

(async () => {
  console.log('keyword length normalisation');
  await initLegalCorpus();
  const ids = [];
  try {
    for (const [law, text, arts] of [['TEST-HUB NIZOM', HUB, '{}'], ['TEST Oila kodeksi', ARTICLE, '{136}']]) {
      const { rows } = await pool.query(
        `INSERT INTO legal_chunks (law_name, category, chunk_text, source_type, doc_id, article_numbers, is_valid)
         VALUES ($1, $2, $3, 'law_text', $4, $5::text[], TRUE) RETURNING id`,
        [law, CATEGORY, text, `kwlen_${law}`, arts]);
      ids.push(rows[0].id);
    }
    const q = "Alimentni sud orqali undirish uchun murojaat qilishning ma'lum bir muddati bormi?";

    let before;
    await test('without it, the long regulation outranks the answering article (the production state)', async () => {
      before = await keywordSearch(q, { category: CATEGORY, limit: 5, keywordLengthNorm: false });
      console.log(`      order: ${before.map(r => `${r.law_name} (${r.chunk_chars} chars, ${r.score.toFixed(2)})`).join(' > ')}`);
      assert.strictEqual(before[0].law_name, 'TEST-HUB NIZOM');
    });

    await test('with it, the article comes first and the regulation drops below it', async () => {
      const after = await keywordSearch(q, { category: CATEGORY, limit: 5, keywordLengthNorm: true });
      console.log(`      order: ${after.map(r => `${r.law_name} (${r.chunk_chars} chars, ${r.score.toFixed(2)})`).join(' > ')}`);
      assert.strictEqual(after[0].law_name, 'TEST Oila kodeksi');
      const hub = (rows) => rows.find(r => r.law_name === 'TEST-HUB NIZOM');
      assert.ok(hub(after).score < after[0].score);
      assert.strictEqual(hub(after).keyword_score, hub(before).keyword_score, 'raw rank kept for the high-confidence test');
    });

    await test('the switch: off by default, RAG_KEYWORD_LENGTH_NORM, per-call override', () => {
      assert.strictEqual(keywordLengthNormFrom({}, {}), false);
      assert.strictEqual(keywordLengthNormFrom({}, { RAG_KEYWORD_LENGTH_NORM: '1' }), true);
      assert.strictEqual(keywordLengthNormFrom({ keywordLengthNorm: false }, { RAG_KEYWORD_LENGTH_NORM: 'true' }), false);
    });
  } finally {
    if (ids.length) await pool.query('DELETE FROM legal_chunks WHERE id = ANY($1::int[])', [ids]);
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
