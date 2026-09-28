'use strict';

/**
 * Re-chunking oversized rows already in the corpus (the 797,454-character
 * regulation from eval runs 5-10), on real Postgres.
 *
 *   TEST_DATABASE_URL=postgresql://… node tests/oversized-chunks.db.test.js
 */

const assert = require('assert');

if (!process.env.TEST_DATABASE_URL) {
  console.log('oversized chunks: skipped (TEST_DATABASE_URL not set)');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('oversized chunks: refusing to run against a hosted database');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { pool } = require('../src/database/db');
const { initLegalCorpus } = require('../src/rag/legal-corpus');
const { findOversizedChunks, rechunkOne, mountOversizedChunkRoutes } = require('../src/rag/oversized-chunks');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

(async () => {
  console.log('oversized chunks');
  await initLegalCorpus();
  const dims = Number((await pool.query(
    `SELECT atttypmod AS d FROM pg_attribute WHERE attrelid = 'legal_chunks'::regclass AND attname = 'embedding'`)).rows[0].d);
  const embed = async (texts) => texts.map((t, i) => Array.from({ length: dims }, (_, j) => (j === i % dims ? 1 : 0)));
  const text = Array.from({ length: 400 }, (_, i) => `${i + 1}. Ruxsat berish tartib-taomillari elektron tizim orqali amalga oshiriladi.`).join('\n');
  const insert = async (docId) => (await pool.query(
    `INSERT INTO legal_chunks (law_name, category, chunk_text, source_type, doc_id, source_url, language, article_numbers, is_valid, document_number)
     VALUES ('TEST-OVERSIZED NIZOM', 'test-oversized', $1, 'uploaded_doc', $2, 'https://lex.uz/docs/1', 'uz', '{}', TRUE, 'VMQ-86') RETURNING id`,
    [text, docId])).rows[0].id;

  try {
    const id = await insert('oversized_ok');

    await test('the oversized row is listed', async () => {
      const found = await findOversizedChunks(pool, { minChars: 8000, limit: 500 });
      const mine = found.find(r => r.id === id);
      assert.ok(mine, 'listed');
      assert.strictEqual(mine.chars, text.length);
    });

    await test('re-chunking replaces it with article-sized pieces that keep the metadata and the text', async () => {
      const r = await rechunkOne(pool, id, embed);
      assert.ok(r.pieces >= 9, `pieces ${r.pieces}`);
      assert.strictEqual((await pool.query('SELECT 1 FROM legal_chunks WHERE id = $1', [id])).rowCount, 0, 'original gone');
      const { rows } = await pool.query(
        `SELECT chunk_text, law_name, category, source_type, source_url, language, document_number, is_valid,
                embedding IS NOT NULL AS has_emb, tsv IS NOT NULL AS has_tsv
           FROM legal_chunks WHERE doc_id = 'oversized_ok' ORDER BY chunk_index`);
      assert.strictEqual(rows.length, r.pieces);
      for (const p of rows) {
        assert.ok(p.chunk_text.length <= 3200);
        assert.deepStrictEqual([p.law_name, p.category, p.source_type, p.source_url, p.language, p.document_number, p.is_valid, p.has_emb, p.has_tsv],
          ['TEST-OVERSIZED NIZOM', 'test-oversized', 'uploaded_doc', 'https://lex.uz/docs/1', 'uz', 'VMQ-86', true, true, true]);
      }
      assert.strictEqual(rows.map(p => p.chunk_text).join('\n'), text, 'no text lost');
      assert.ok(!(await findOversizedChunks(pool, { minChars: 8000, limit: 500 })).some(f => f.law_name === 'TEST-OVERSIZED NIZOM'));
    });

    await test('an embedding failure leaves the original in place', async () => {
      const keep = await insert('oversized_fail');
      await assert.rejects(rechunkOne(pool, keep, async () => { throw new Error('embedding API down'); }));
      assert.strictEqual((await pool.query('SELECT 1 FROM legal_chunks WHERE id = $1', [keep])).rowCount, 1);
      assert.strictEqual((await pool.query(`SELECT count(*)::int n FROM legal_chunks WHERE doc_id = 'oversized_fail'`)).rows[0].n, 1);
    });

    await test('a verified answer is never listed or split, however long', async () => {
      const qa = (await pool.query(
        `INSERT INTO legal_chunks (law_name, category, chunk_text, source_type, doc_id, is_valid)
         VALUES ('Tasdiqlangan javob', 'test-oversized', $1, 'verified_qa', 'oversized_qa', TRUE) RETURNING id`,
        [`Savol: uzun savol?\n\nJavob: ${'Batafsil javob matni. '.repeat(600)}`])).rows[0].id;
      assert.ok(!(await findOversizedChunks(pool, { minChars: 8000, limit: 500 })).some(r => r.id === qa), 'not listed');
      assert.strictEqual(await rechunkOne(pool, qa, embed), null, 'refused');
      assert.strictEqual((await pool.query('SELECT 1 FROM legal_chunks WHERE id = $1', [qa])).rowCount, 1);
    });

    await test('the route is master-only and lists without ?fix=1', async () => {
      const routes = [];
      const requireMasterAdmin = function requireMasterAdmin() {};
      mountOversizedChunkRoutes({ get: (p, ...h) => routes.push({ p, h }) }, { requireMasterAdmin, pool, embedTexts: embed });
      assert.strictEqual(routes[0].p, '/api/admin/corpus/oversized');
      assert.strictEqual(routes[0].h[0], requireMasterAdmin);
      let body;
      await routes[0].h[1]({ query: {} }, { json: (b) => { body = b; }, status: () => ({ json: (b) => { body = b; } }) });
      assert.ok(Array.isArray(body.oversized) && body.oversized.some(r => r.law_name === 'TEST-OVERSIZED NIZOM'));
    });
  } finally {
    await pool.query(`DELETE FROM legal_chunks WHERE category = 'test-oversized'`);
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
