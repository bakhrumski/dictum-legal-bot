'use strict';

/**
 * Corpus demand (owner, 2026-10-03): acts answers needed from lex.uz that the
 * corpus lacks are counted, listed most needed first and ingested up to ten
 * at a time.
 *
 *   TEST_DATABASE_URL=postgresql://… node tests/corpus-demand.db.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { lexIdOf, demandRows, parseIngestParam } = require('../src/rag/corpus-demand');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

const LIVE = [
  { url: 'https://lex.uz/docs/-5049511', title: "Nogironligi bo'lgan shaxslarning huquqlari to'g'risida", ownDocumentNumber: "O'RQ-641", metadata: { is_active: true } },
  { url: 'https://lex.uz/uz/docs/6257288', title: 'Mehnat kodeksi', metadata: {} },
  { url: 'https://lex.uz/docs/-7000001', title: "Mehnat kodeksiga o'zgartirish kiritish haqida", metadata: {} },
  { url: 'https://lex.uz/docs/-7000002', title: 'Eski qaror', metadata: { is_active: false } },
  { url: 'https://lex.uz/docs/-7000003', title: "Ish haqi to'g'risida nizom", ownDocumentNumber: 'VMQ-824', metadata: {} },
  { url: 'https://lex.uz/docs/-7000003', title: 'duplicate', metadata: {} },
];

(async () => {
  console.log('corpus demand');

  await test('ids, ingest parameter', () => {
    assert.strictEqual(lexIdOf('https://lex.uz/docs/-5049511'), '5049511');
    assert.strictEqual(lexIdOf('https://lex.uz/uz/docs/6257288#-6263814'), '6257288');
    assert.deepStrictEqual(parseIngestParam('top10'), { top: 10 });
    assert.deepStrictEqual(parseIngestParam('top50'), { top: 10 }, 'never more than ten');
    assert.deepStrictEqual(parseIngestParam('<-5049511>, 7000003'), { ids: ['5049511', '7000003'] });
    assert.deepStrictEqual(parseIngestParam('https://lex.uz/docs/-5049511'), { ids: ['5049511'] });
    assert.strictEqual(parseIngestParam('mchj'), null);
  });

  await test('only acts in force, not amendments, not already in the corpus, once each', () => {
    const rows = demandRows(LIVE, new Set(['6257288']), { topic: 'mehnat' });
    assert.deepStrictEqual(rows.map(r => r.lex_id), ['5049511', '7000003']);
    assert.strictEqual(rows[0].url, 'https://lex.uz/docs/-5049511');
    assert.strictEqual(rows[0].legal_force, 'qonun');
    assert.strictEqual(rows[1].legal_force, 'vazirlar-mahkamasi');
    assert.strictEqual(rows[1].topic, 'mehnat');
  });

  if (!process.env.TEST_DATABASE_URL) {
    console.log('  (database part skipped: TEST_DATABASE_URL not set)');
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
  if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
    console.error('corpus demand: refusing to run against a hosted database');
    process.exit(1);
  }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { pool } = require('../src/database/db');
  const { initLegalCorpus } = require('../src/rag/legal-corpus');
  const { createCorpusDemand } = require('../src/rag/corpus-demand');
  await initLegalCorpus();
  await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '20261003_013_corpus_demand.sql'), 'utf8'));
  await pool.query(`DELETE FROM corpus_demand WHERE lex_id IN ('5049511', '7000003', '6257288')`);
  await pool.query(`DELETE FROM legal_chunks WHERE doc_id = 'demand-test-mk'`);
  await pool.query(`INSERT INTO legal_chunks (law_name, category, chunk_text, source_type, doc_id, source_url)
    VALUES ('Mehnat kodeksi', 'mehnat', '1-modda.', 'law_text', 'demand-test-mk', 'https://lex.uz/docs/-6257288')`);
  const demand = createCorpusDemand({ pool, validCategories: ['mehnat', 'ijtimoiy'] });

  try {
    await test('users and eval runs are counted apart; no question text is stored', async () => {
      assert.strictEqual(await demand.record(LIVE, { topic: 'ijtimoiy' }), 2);
      await demand.record(LIVE.slice(0, 1), { topic: 'ijtimoiy' });
      await demand.record(LIVE, { topic: 'mehnat', source: 'eval' });
      const rows = await demand.list();
      const law = rows.find(r => r.lex_id === '5049511');
      assert.strictEqual(law.user_hits, 2);
      assert.strictEqual(law.eval_hits, 1);
      assert.strictEqual(rows.find(r => r.lex_id === '7000003').user_hits, 1);
      assert.ok(!rows.some(r => r.lex_id === '6257288'), 'the corpus has the Labour Code');
      assert.strictEqual(rows[0].lex_id, '5049511', 'most needed first');
      const cols = Object.keys(rows[0]);
      assert.ok(!cols.some(c => /question|query|text/u.test(c)), cols.join(','));
    });

    await test('a failing database does not break the answer', async () => {
      const broken = createCorpusDemand({ pool: { query: async () => { throw new Error('down'); } }, log: { warn() {} } });
      assert.strictEqual(await broken.record(LIVE), 0);
    });

    await test('top N ingests the most needed, writes each status, and skips them next time', async () => {
      const rows = await demand.pick({ top: 10 });
      assert.deepStrictEqual(rows.map(r => r.lex_id), ['5049511', '7000003']);
      const calls = [];
      const reingest = async (docs, report) => {
        for (const d of docs) {
          calls.push(d);
          report.push(d.source_url.endsWith('7000003') ? { status: 'error', reason: 'HTTP 500' } : { status: 'done', chunks: 42 });
        }
      };
      const report = [];
      await demand.ingestBatch(rows, { reingest, report });
      assert.deepStrictEqual(calls[0], { doc_id: 'lex-5049511', law_name: "Nogironligi bo'lgan shaxslarning huquqlari to'g'risida",
        category: 'ijtimoiy', source_url: 'https://lex.uz/docs/-5049511' });
      const after = await demand.list();
      const law = after.find(r => r.lex_id === '5049511');
      assert.strictEqual(law.status, 'ingested');
      assert.strictEqual(law.note, '42 chunks');
      assert.strictEqual(after.find(r => r.lex_id === '7000003').status, 'error');
      assert.deepStrictEqual((await demand.pick({ top: 10 })).map(r => r.lex_id), [], 'done and failed ones are not picked again by top');
      assert.deepStrictEqual((await demand.pick({ ids: ['7000003', '5049511'] })).map(r => r.lex_id), ['7000003'], 'a failed one can be retried by id');
      assert.strictEqual(await demand.record(LIVE.slice(0, 1)), 0, 'an ingested act is in the corpus now');
    });

    await test('an unknown topic falls back to a valid category', () => {
      assert.strictEqual(demand.categoryFor({ topic: 'nimadir' }), 'davlat-boshqaruvi');
      assert.strictEqual(demand.categoryFor({ topic: 'mehnat' }), 'mehnat');
    });
  } finally {
    await pool.query(`DELETE FROM corpus_demand WHERE lex_id IN ('5049511', '7000003', '6257288')`);
    await pool.query(`DELETE FROM legal_chunks WHERE doc_id = 'demand-test-mk'`);
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
