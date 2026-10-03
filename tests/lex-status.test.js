'use strict';

/**
 * lex.uz status of an act (owner, 2026-10-03): "Hujjat kuchini yoʻqotgan
 * DD.MM.YYYY" and "Hujjat DD.MM.YYYY sanasi holatiga / Amaldagi versiyaga
 * oʻtish" must be read before an act is used, ingested or kept in the corpus.
 *
 *   node tests/lex-status.test.js
 *   TEST_DATABASE_URL=postgresql://… node tests/lex-status.test.js   (also the corpus re-check)
 */

const assert = require('assert');
// check-freshness.js opens the database pool when it loads.
if (process.env.TEST_DATABASE_URL && !/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
const { parseLexHtml } = require('../src/rag/fetch-lex');
const { reingestDocuments } = require('../src/rag/oversized-chunks');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

const page = ({ banner = '', title = 'Qonun', link = '' }) => `<html><body>
  <div class="STATUS_BANNER">${banner}${link}</div>
  <div class="ACT_TITLE"><a id="t">${title}</a></div>
  <div id="divCont"><div class="lx_elem ACT_TEXT"><a id="p1">1-modda. Matn.</a></div>
  <div class="lx_elem ACT_TEXT"><a id="p2">5-modda. Kuchini yoʻqotgan.</a></div></div>
</body></html>`;

(async () => {
  console.log('lex.uz status');

  await test('"Hujjat kuchini yoʻqotgan" with its date (Latin, curly apostrophe)', () => {
    const { metadata } = parseLexHtml(page({ banner: 'Hujjat kuchini yo‘qotgan 20.01.2026' }), 'https://lex.uz/docs/-1');
    assert.strictEqual(metadata.is_active, false);
    assert.strictEqual(metadata.repealed_date, '20.01.2026');
    assert.match(metadata.status_label, /kuchini yo‘qotgan 20\.01\.2026$/u);
  });

  await test('the Uzbek Cyrillic banner is read too', () => {
    const { metadata } = parseLexHtml(page({ banner: 'Ҳужжат кучини йўқотган 01.03.2025' }), 'https://lex.uz/uz/docs/1');
    assert.strictEqual(metadata.is_active, false);
    assert.strictEqual(metadata.repealed_date, '01.03.2025');
  });

  await test('an article repealed inside an act in force does not mark the act', () => {
    const { metadata } = parseLexHtml(page({}), 'https://lex.uz/docs/-1');
    assert.strictEqual(metadata.is_active, true);
    assert.strictEqual(metadata.repealed_date, undefined);
  });

  await test('an old edition: its date and the link to the current version (Latin and Cyrillic)', () => {
    const lat = parseLexHtml(page({ banner: 'Hujjat 12.05.2023 sanasi holatiga ', link: '<a href="/docs/-6257288">Amaldagi versiyaga o‘tish</a>' }), 'https://lex.uz/docs/-6257288?ONDATE=12.05.2023');
    assert.strictEqual(lat.metadata.snapshot_date, '12.05.2023');
    assert.strictEqual(lat.metadata.current_version_url, 'https://lex.uz/docs/-6257288');
    const cyr = parseLexHtml(page({ banner: 'Ҳужжат 12.05.2023 санаси ҳолатига ', link: '<a href="/uz/docs/6257288">Амалдаги версияга ўтиш</a>' }), 'https://lex.uz/uz/docs/6257288?ONDATE=12.05.2023');
    assert.strictEqual(cyr.metadata.snapshot_date, '12.05.2023');
    assert.strictEqual(cyr.metadata.current_version_url, 'https://lex.uz/uz/docs/6257288');
    const current = parseLexHtml(page({}), 'https://lex.uz/docs/-6257288');
    assert.strictEqual(current.metadata.current_version_url, null);
  });

  await test('the corpus re-check runs weekly, Sunday 03:00 Tashkent time', () => {
    const { msUntilNextSunday } = require('../src/rag/check-freshness');
    const at = (iso) => new Date(Date.parse(iso) + msUntilNextSunday(new Date(iso))).toISOString();
    // Friday 2026-10-02 12:00 Tashkent (07:00 UTC) -> Sunday 2026-10-04 03:00 Tashkent (Saturday 22:00 UTC)
    assert.strictEqual(at('2026-10-02T07:00:00Z'), '2026-10-03T22:00:00.000Z');
    // Sunday 02:59 Tashkent -> the same night's 03:00
    assert.strictEqual(at('2026-10-03T21:59:00Z'), '2026-10-03T22:00:00.000Z');
    // Sunday 03:00 Tashkent exactly, after a run -> next Sunday
    assert.strictEqual(at('2026-10-03T22:00:00Z'), '2026-10-10T22:00:00.000Z');
  });

  await test('re-ingest refuses an old edition whose current version was not reached', async () => {
    const report = [];
    let ingested = 0;
    await reingestDocuments([{ doc_id: 'a', law_name: 'A', category: 'mehnat', source_url: 'https://lex.uz/docs/-1' }], {
      fetchDoc: async () => ({ body: 'x', metadata: { is_active: true, current_version_url: 'https://lex.uz/docs/-1', snapshot_date: '12.05.2023' } }),
      ingest: async () => { ingested++; return 5; },
      report, pauseMs: 0,
    });
    assert.strictEqual(ingested, 0);
    assert.strictEqual(report[0].status, 'skipped');
    assert.match(report[0].reason, /old edition as of 12\.05\.2023/u);
  });

  if (!process.env.TEST_DATABASE_URL) {
    console.log('  (corpus re-check skipped: TEST_DATABASE_URL not set)');
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
  if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
    console.error('lex status: refusing to run against a hosted database');
    process.exit(1);
  }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { pool } = require('../src/database/db');
  const { initLegalCorpus } = require('../src/rag/legal-corpus');
  const { runFreshnessCheck, mountFreshnessRoutes } = require('../src/rag/check-freshness');
  await initLegalCorpus();
  const DOCS = ['fresh-a', 'fresh-b', 'fresh-c', 'fresh-d', 'fresh-e', 'fresh-old'];
  const cleanup = () => pool.query('DELETE FROM legal_chunks WHERE doc_id = ANY($1)', [DOCS]);
  await cleanup();
  for (const d of DOCS) {
    await pool.query(`INSERT INTO legal_chunks (law_name, category, chunk_text, source_type, doc_id, source_url, is_valid, is_active)
      VALUES ($1, 'test', '1-modda.', 'law_text', $2, $3, TRUE, TRUE)`, [d, d, `https://lex.uz/docs/-${900000 + DOCS.indexOf(d)}`]);
  }
  // Other corpus rows are left alone by the run: the fake fetcher answers
  // "in force" for every URL but ours.
  const status = { 'fresh-a': 'repealed', 'fresh-old': 'old' };
  const byUrl = new Map(DOCS.map((d, i) => [`https://lex.uz/docs/-${900000 + i}`, d]));
  const fetchDoc = async (url) => {
    const d = byUrl.get(url) || '';
    if (status[d] === 'repealed') return { body: 'x', metadata: { is_active: false, status_label: "Hujjat kuchini yoʻqotgan 20.01.2026" } };
    if (status[d] === 'old') return { body: 'x', metadata: { is_active: true, current_version_url: url, snapshot_date: '12.05.2023' } };
    return { body: 'x', metadata: { is_active: true } };
  };
  const active = async (d) => (await pool.query('SELECT bool_and(is_active) AS a, min(status_label) AS l FROM legal_chunks WHERE doc_id = $1', [d])).rows[0];

  try {
    await test('the corpus re-check takes a repealed act out, with its date, and reports an old edition', async () => {
      const job = await runFreshnessCheck({ db: pool, fetchDoc, pauseMs: 0 });
      assert.deepStrictEqual(job.applied, ['fresh-a']);
      const a = await active('fresh-a');
      assert.strictEqual(a.a, false);
      assert.match(a.l, /20\.01\.2026 \(auto-checked\)/u);
      assert.strictEqual((await active('fresh-b')).a, true);
      assert.deepStrictEqual(job.oldEditions.map(r => [r.doc_id, r.snapshot_date]), [['fresh-old', '12.05.2023']]);
      assert.strictEqual((await active('fresh-old')).a, true, 'an old edition is reported, not taken out');
    });

    await test('more than three at once are held for the owner, then applied with ?apply=1', async () => {
      Object.assign(status, { 'fresh-b': 'repealed', 'fresh-c': 'repealed', 'fresh-d': 'repealed', 'fresh-e': 'repealed' });
      const routes = {};
      const app = { get: (p, _a, h) => { routes[p] = h; } };
      const ctl = mountFreshnessRoutes(app, { requireMasterAdmin: () => {}, db: pool, fetchDoc, weekly: false, pauseMs: 0,
        logger: { info() {}, error() {} } });
      const call = (query) => new Promise((resolve) => routes['/api/admin/corpus/freshness']({ query }, { json: resolve, status: () => ({ json: resolve }) }));
      await call({ start: '1' });
      for (let i = 0; i < 400 && ctl.current().running; i++) await new Promise(r => setTimeout(r, 25));
      const held = await call({});
      assert.match(held.job.held || '', /4 documents read as repealed/u);
      assert.strictEqual((await active('fresh-b')).a, true, 'nothing applied yet');
      const applied = await call({ apply: '1' });
      assert.deepStrictEqual(applied.job.applied.sort(), ['fresh-b', 'fresh-c', 'fresh-d', 'fresh-e']);
      assert.strictEqual((await active('fresh-e')).a, false);
    });
  } finally {
    await cleanup();
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
