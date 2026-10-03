'use strict';

/**
 * Suggested sources: every answer's live lex.uz check feeds the dashboard's
 * list, and up to ten are ingested in one go (owner, 2026-10-03).
 *
 *   node tests/source-suggestions.test.js
 *   TEST_DATABASE_URL=postgresql://… node tests/source-suggestions.test.js   (also the database part)
 */

const assert = require('assert');
const { lexIdOf, preferLatinUrl, liveSuggestionRows, suggestionForce, parseBatchItems,
  createSuggestionRecorder, mountSuggestionBatchRoutes } = require('../src/rag/source-suggestions');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

const LIVE = [
  { url: 'https://lex.uz/docs/-5049511', title: "Nogironligi bo'lgan shaxslarning huquqlari to'g'risida", metadata: { is_active: true } },
  { url: 'https://lex.uz/uz/docs/6257288', title: 'Mehnat kodeksi', metadata: {} },
  { url: 'https://lex.uz/docs/-7000001', title: "Mehnat kodeksiga o'zgartirish kiritish haqida", metadata: {} },
  { url: 'https://lex.uz/docs/-7000002', title: 'Eski qaror', metadata: { is_active: false } },
  { url: 'https://lex.uz/uz/docs/7000003#-7000010', title: "Ish haqi to'g'risida nizom", metadata: {} },
  { url: 'https://lex.uz/docs/-7000003', title: 'duplicate', metadata: {} },
];

// The suggested_sources table as server.js creates it at boot.
const DDL = `CREATE TABLE IF NOT EXISTS suggested_sources (
  id SERIAL PRIMARY KEY, lex_doc_id VARCHAR(60) UNIQUE, lex_url TEXT NOT NULL, title TEXT,
  is_active BOOLEAN, status_label VARCHAR(160), sample_query TEXT, topic VARCHAR(50),
  times_suggested INTEGER NOT NULL DEFAULT 1, status VARCHAR(20) NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(),
  last_suggested_at TIMESTAMPTZ DEFAULT NOW());
  ALTER TABLE suggested_sources ADD COLUMN IF NOT EXISTS sample_answer TEXT;
  ALTER TABLE suggested_sources ADD COLUMN IF NOT EXISTS last_error TEXT;`;

(async () => {
  console.log('source suggestions');

  await test('URLs: an Uzbek Cyrillic page becomes the Latin one; a Russian one is kept', () => {
    assert.strictEqual(lexIdOf('https://lex.uz/docs/-5049511'), '5049511');
    assert.strictEqual(preferLatinUrl('https://lex.uz/uz/docs/6257288#-6263814'), 'https://lex.uz/docs/-6257288');
    assert.strictEqual(preferLatinUrl('https://lex.uz/docs/-6257288'), 'https://lex.uz/docs/-6257288');
    assert.strictEqual(preferLatinUrl('https://lex.uz/docs/104723'), 'https://lex.uz/docs/104723', 'the Family Code in Russian has its own id');
    assert.strictEqual(preferLatinUrl('https://lex.uz/ru/docs/6257291'), 'https://lex.uz/ru/docs/6257291');
  });

  await test('only acts in force, not amendments, not in the corpus, once each', () => {
    const rows = liveSuggestionRows(LIVE, new Set(['6257288']));
    assert.deepStrictEqual(rows.map(r => [r.lex_doc_id, r.lex_url]), [
      ['5049511', 'https://lex.uz/docs/-5049511'],
      ['7000003', 'https://lex.uz/docs/-7000003'],
    ]);
  });

  await test('cards show the legal force read from the title', () => {
    assert.deepStrictEqual(suggestionForce({ title: 'Toshkent shahar hokimining qarori' }), { key: 'hokim', uz: 'Hokim qarori' });
    assert.strictEqual(suggestionForce({ title: 'Nimadir' }), null);
  });

  await test('a batch takes integer ids, each once, at most ten', () => {
    const items = parseBatchItems({ items: [{ id: '3', topic: ' mehnat ' }, { id: 3 }, { id: 'x' }, { id: -1 },
      ...Array.from({ length: 12 }, (_, i) => ({ id: 10 + i }))] });
    assert.strictEqual(items.length, 10);
    assert.deepStrictEqual(items[0], { id: 3, topic: 'mehnat' });
    assert.deepStrictEqual(parseBatchItems({}), []);
    assert.deepStrictEqual(parseBatchItems({ items: 'all' }), []);
  });

  await test('a failing database never breaks the answer', async () => {
    const broken = createSuggestionRecorder({ pool: { query: async () => { throw new Error('down'); } }, log: { warn() {} } });
    assert.strictEqual(await broken.record(LIVE), 0);
  });

  if (!process.env.TEST_DATABASE_URL) {
    console.log('  (database part skipped: TEST_DATABASE_URL not set)');
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
  if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
    console.error('source suggestions: refusing to run against a hosted database');
    process.exit(1);
  }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { pool } = require('../src/database/db');
  const { initLegalCorpus } = require('../src/rag/legal-corpus');
  await initLegalCorpus();
  await pool.query(DDL);
  const IDS = ['5049511', '7000003', '6257288'];
  const cleanup = async () => {
    await pool.query('DELETE FROM suggested_sources WHERE lex_doc_id = ANY($1)', [IDS]);
    await pool.query(`DELETE FROM legal_chunks WHERE doc_id = 'suggest-test-mk'`);
  };
  await cleanup();
  await pool.query(`INSERT INTO legal_chunks (law_name, category, chunk_text, source_type, doc_id, source_url)
    VALUES ('Mehnat kodeksi', 'mehnat', '1-modda.', 'law_text', 'suggest-test-mk', 'https://lex.uz/docs/-6257288')`);
  const recorder = createSuggestionRecorder({ pool });

  try {
    await test('each answer counts the acts the corpus lacked; a rejected one stays rejected', async () => {
      assert.strictEqual(await recorder.record(LIVE, { question: 'Nogironlik nafaqasi?', topic: 'ijtimoiy' }), 2);
      await recorder.record(LIVE.slice(0, 1), { question: 'boshqa savol', topic: 'mehnat' });
      const { rows } = await pool.query('SELECT * FROM suggested_sources WHERE lex_doc_id = ANY($1) ORDER BY lex_doc_id', [IDS]);
      assert.deepStrictEqual(rows.map(r => [r.lex_doc_id, r.times_suggested, r.topic, r.sample_query]), [
        ['5049511', 2, 'ijtimoiy', 'Nogironlik nafaqasi?'],
        ['7000003', 1, 'ijtimoiy', 'Nogironlik nafaqasi?'],
      ]);
      await pool.query(`UPDATE suggested_sources SET status = 'rejected' WHERE lex_doc_id = '7000003'`);
      await recorder.record(LIVE);
      const again = (await pool.query(`SELECT status, times_suggested FROM suggested_sources WHERE lex_doc_id = '7000003'`)).rows[0];
      assert.deepStrictEqual([again.status, again.times_suggested], ['rejected', 2]);
      await pool.query(`UPDATE suggested_sources SET status = 'pending' WHERE lex_doc_id = '7000003'`);
    });

    await test('the batch ingests in the chosen order, writes each outcome, and a failed one can be retried', async () => {
      const routes = {};
      const app = { get: (p, _a, h) => { routes[`GET ${p}`] = h; }, post: (p, _a, h) => { routes[`POST ${p}`] = h; } };
      const calls = [];
      mountSuggestionBatchRoutes(app, {
        requireMasterAdmin: () => {}, pool, recorder,
        ingestOne: async (args) => {
          calls.push(args);
          if (args.url.endsWith('7000003')) throw new Error('Hujjat matni topilmadi');
          return { chunks: 42 };
        },
        log: { error() {} },
      });
      const call = (key, req) => new Promise((resolve) => routes[key](req, {
        json: (body) => resolve({ code: 200, body }),
        status: (code) => ({ json: (body) => resolve({ code, body }) }),
      }));
      const ids = (await pool.query('SELECT id, lex_doc_id FROM suggested_sources WHERE lex_doc_id = ANY($1)', [IDS])).rows;
      const idOf = (lex) => ids.find(r => r.lex_doc_id === lex).id;

      const empty = await call('POST /api/admin/suggested-sources/ingest-batch', { body: { items: [] }, session: {} });
      assert.strictEqual(empty.code, 400);

      const started = await call('POST /api/admin/suggested-sources/ingest-batch', {
        body: { items: [{ id: idOf('7000003'), topic: 'mehnat' }, { id: idOf('5049511') }] }, session: { adminId: 1 } });
      assert.strictEqual(started.code, 200, JSON.stringify(started.body));
      const busy = await call('POST /api/admin/suggested-sources/ingest-batch', { body: { items: [{ id: idOf('5049511') }] }, session: {} });
      assert.strictEqual(busy.code, 409, 'one batch at a time');

      let job;
      for (let i = 0; i < 50; i++) {
        job = (await call('GET /api/admin/suggested-sources/ingest-batch', {})).body.job;
        if (!job.running) break;
        await new Promise(r => setTimeout(r, 20));
      }
      assert.deepStrictEqual(calls.map(c => [c.url, c.topic, c.adminId]), [
        ['https://lex.uz/docs/-7000003', 'mehnat', 1],
        ['https://lex.uz/docs/-5049511', 'ijtimoiy', 1],
      ], 'chosen order; a card\'s own topic when none was picked');
      assert.deepStrictEqual(job.items.map(i => i.status), ['error', 'done']);
      const rows = (await pool.query('SELECT lex_doc_id, status, last_error FROM suggested_sources WHERE lex_doc_id = ANY($1) ORDER BY lex_doc_id', [IDS])).rows;
      assert.deepStrictEqual(rows.map(r => [r.lex_doc_id, r.status, r.last_error]), [
        ['5049511', 'ingested', null],
        ['7000003', 'pending', 'Hujjat matni topilmadi'],
      ]);
      assert.strictEqual(await recorder.record(LIVE.slice(0, 1)), 0, 'an ingested act is in the corpus now');

      const done = await call('POST /api/admin/suggested-sources/ingest-batch', { body: { items: [{ id: idOf('5049511') }] }, session: {} });
      assert.strictEqual(done.code, 400, 'an ingested one is not ingested twice');
    });
  } finally {
    await cleanup();
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
