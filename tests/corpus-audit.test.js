'use strict';

/**
 * Registry URL check and corpus script report (2026-10-01: /uz/docs/<id>
 * opens the Uzbek Cyrillic text; the LLC law's registry URL was a 404).
 *
 *   node tests/corpus-audit.test.js                          (unit part)
 *   TEST_DATABASE_URL=postgresql://… node tests/corpus-audit.test.js
 */

const assert = require('assert');
const { textScript, latinLexUrl, titleMatch, checkRegistryEntry, findCandidates, needsLatinReingest } = require('../src/rag/corpus-audit');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

const LATIN = "1-modda. Mehnat to'g'risidagi qonunchilikning maqsadi. ".repeat(20);
const UZ_CYR = '1-модда. Меҳнат тўғрисидаги қонунчиликнинг мақсади. '.repeat(20);
const RU = '1-статья. Цели трудового законодательства. '.repeat(20);

(async () => {
  console.log('corpus audit');

  await test('the script of a text: Latin, Uzbek Cyrillic, Russian, mixed, empty', () => {
    assert.strictEqual(textScript(LATIN), 'latin');
    assert.strictEqual(textScript(UZ_CYR), 'uz-cyrillic');
    assert.strictEqual(textScript(RU), 'russian');
    assert.strictEqual(textScript(LATIN.slice(0, 400) + UZ_CYR.slice(0, 400)), 'mixed');
    assert.strictEqual(textScript('12-34'), 'empty');
  });

  await test('the Latin URL of an act: minus before the id, whatever the form', () => {
    assert.strictEqual(latinLexUrl('https://lex.uz/uz/docs/6257288'), 'https://lex.uz/docs/-6257288');
    assert.strictEqual(latinLexUrl('https://lex.uz/docs/111189'), 'https://lex.uz/docs/-111189');
    assert.strictEqual(latinLexUrl('https://lex.uz/docs/-111453'), 'https://lex.uz/docs/-111453');
    assert.strictEqual(latinLexUrl('https://lex.uz/ru/docs/-2304138'), 'https://lex.uz/docs/-2304138');
    assert.strictEqual(latinLexUrl('https://example.com/x'), '');
  });

  await test('the registry name is compared with the page title by its words', () => {
    assert.ok(titleMatch("Mas'uliyati cheklangan jamiyatlar to'g'risida", "O'zbekiston Respublikasining Qonuni Mas'uliyati cheklangan jamiyatlar to'g'risida") >= 0.99);
    assert.ok(titleMatch("Mas'uliyati cheklangan jamiyatlar to'g'risida", "Haydovchilarni tayyorlash tartibi to'g'risida nizom") < 0.5);
  });

  await test('a registry entry: ok, a 404, a Cyrillic page, a repealed act, a wrong page', async () => {
    const entry = (law_name, lex_url = 'https://lex.uz/docs/-1') => ({ doc_id: 'x', law_name, category: 'c', lex_url });
    const page = (title, body, meta = {}) => async () => ({ title, body, metadata: meta });
    const ok = await checkRegistryEntry(entry('Mehnat kodeksi'), page("O'zbekiston Respublikasining Mehnat kodeksi", LATIN));
    assert.strictEqual(ok.status, 'ok');
    const missing = await checkRegistryEntry(entry("Mas'uliyati cheklangan jamiyatlar"), async () => { throw new Error('HTTP 404 for https://lex.uz/uz/docs/5765406'); });
    assert.strictEqual(missing.status, 'not_found_404');
    const cyr = await checkRegistryEntry(entry('Mehnat kodeksi'), page('Меҳнат кодекси', UZ_CYR));
    assert.match(cyr.status, /script_uz-cyrillic/u);
    const repealed = await checkRegistryEntry(entry('Mehnat kodeksi'), page('Mehnat kodeksi', LATIN, { is_active: false, status_label: "Hujjat kuchini yo'qotgan" }));
    assert.match(repealed.status, /not_in_force/u);
    const wrong = await checkRegistryEntry(entry("Aksiyadorlik jamiyatlari to'g'risida"), page("Yo'l harakati qoidalari to'g'risida", LATIN));
    assert.match(wrong.status, /title_mismatch/u);
  });

  await test('only Uzbek Cyrillic documents with a lex.uz URL are re-ingested from Latin', () => {
    assert.strictEqual(needsLatinReingest({ doc_id: 'a', script: 'uz-cyrillic', source_url: 'https://lex.uz/uz/docs/35869' }), true);
    assert.strictEqual(needsLatinReingest({ doc_id: 'a', script: 'russian', source_url: 'https://lex.uz/docs/104723' }), false);
    assert.strictEqual(needsLatinReingest({ doc_id: 'a', script: 'latin', source_url: 'https://lex.uz/docs/-1' }), false);
    assert.strictEqual(needsLatinReingest({ doc_id: 'a', script: 'uz-cyrillic', source_url: '' }), false);
  });

  await test('a dead registry entry gets lex.uz candidates; the best is suggested only when its Latin page checks out', async () => {
    const entry = { doc_id: 'aksiyadorlik', law_name: "Aksiyadorlik jamiyatlari to'g'risida", lex_url: 'https://lex.uz/docs/-5765400' };
    const rows = [
      { url: 'https://lex.uz/docs/111', title: "Aksiyadorlik jamiyatlari va aksiyadorlarning huquqlarini himoya qilish to'g'risida", isActive: true, documentNumber: "O'RQ-370" },
      { url: 'https://lex.uz/docs/-222', title: "Aksiyadorlik jamiyatlari to'g'risida", isActive: true, documentNumber: "O'RQ-999" },
      { url: 'https://lex.uz/docs/-333', title: "Yo'l harakati qoidalari", isActive: true },
    ];
    const opened = [];
    const r = await findCandidates(entry, {
      searchPage: async () => '<html/>', parse: () => rows,
      fetchDoc: async (url) => { opened.push(url); return { title: "Aksiyadorlik jamiyatlari to'g'risida", body: LATIN, metadata: {} }; },
    });
    assert.strictEqual(r.candidates[0].url, 'https://lex.uz/docs/-222', 'exact title first');
    assert.strictEqual(r.candidates[1].url, 'https://lex.uz/docs/-111', 'Latin URL for a plain id');
    assert.ok(!r.candidates.some(c => /-333/.test(c.url)), 'unrelated titles are dropped');
    assert.strictEqual(r.suggested, 'https://lex.uz/docs/-222');
    assert.deepStrictEqual(opened, ['https://lex.uz/docs/-222'], 'only the best candidate is opened');

    const cyr = await findCandidates(entry, { searchPage: async () => '', parse: () => rows,
      fetchDoc: async () => ({ title: 'x', body: UZ_CYR, metadata: {} }) });
    assert.strictEqual(cyr.suggested, null, 'a page that is not Latin is not suggested');
    const repealed = await findCandidates(entry, { searchPage: async () => '', parse: () => [{ ...rows[1], isActive: false }],
      fetchDoc: async () => { throw new Error('should not open'); } });
    assert.strictEqual(repealed.suggested, null, 'a repealed act is not suggested');
  });

  await test('amending laws, bills and look-alike acts are never suggested (the 2026-10-02 run)', async () => {
    const entry = { doc_id: 'iste-molchilar-himoya-qonun', law_name: "Iste'molchilarning huquqlarini himoya qilish to'g'risida", lex_url: 'https://lex.uz/docs/-89690' };
    const rows = [
      { url: 'https://lex.uz/docs/-8284099', title: "“Isteʼmolchilarning huquqlarini himoya qilish toʻgʻrisida”gi Oʻzbekiston Respublikasi Qonunining 14-moddasiga oʻzgartirishlar va qoʻshimcha kiritish haqida”gi Oʻzbekiston Respublikasi Qonuni toʻgʻrisida", isActive: true },
      { url: 'https://lex.uz/docs/-5239421', title: "“Isteʼmolchilarning huquqlarini himoya qilish toʻgʻrisida”gi QL-449-sonli Oʻzbekiston Respublikasi qonuni loyihasi haqida", isActive: true },
      { url: 'https://lex.uz/docs/-111', title: "Isteʼmolchilarning huquqlarini himoya qilish toʻgʻrisida", isActive: true, documentNumber: "O'RQ-221" },
    ];
    const asked = [];
    const r = await findCandidates(entry, {
      searchPage: async (q, opts) => { asked.push(opts.formId || 'plain'); return 'x'; }, parse: () => rows,
      fetchDoc: async () => ({ title: "Isteʼmolchilarning huquqlarini himoya qilish toʻgʻrisida", body: LATIN, metadata: {} }),
    });
    assert.deepStrictEqual(asked, ['3968', 'plain'], 'a law is searched among laws in force first');
    assert.deepStrictEqual(r.candidates.map(c => c.url), ['https://lex.uz/docs/-111'], 'amendment and bill dropped');
    assert.strictEqual(r.suggested, 'https://lex.uz/docs/-111');

    const lookalike = await findCandidates({ doc_id: 'mudofaa-qonun', law_name: "Mudofaa to'g'risida", lex_url: 'x' }, {
      searchPage: async () => 'x', parse: () => [{ url: 'https://lex.uz/docs/-7755253', title: "Davlat mudofaa buyurtmasi toʻgʻrisida", isActive: true }],
      fetchDoc: async () => { throw new Error('should not open'); },
    });
    assert.strictEqual(lookalike.suggested, null, 'a title with other words is listed, not suggested');
    assert.strictEqual(lookalike.candidates.length, 1);
  });

  if (!process.env.TEST_DATABASE_URL) {
    console.log('  (database part skipped: TEST_DATABASE_URL not set)');
  } else if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
    console.error('corpus audit: refusing to run against a hosted database');
    process.exit(1);
  } else {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { pool } = require('../src/database/db');
    const { initLegalCorpus } = require('../src/rag/legal-corpus');
    const { mountCorpusAuditRoutes } = require('../src/rag/corpus-audit');
    await initLegalCorpus();
    const CAT = 'test-corpus-audit';
    const ids = [];
    try {
      for (const [doc, text, url] of [['audit_cyr', UZ_CYR, 'https://lex.uz/uz/docs/35869'], ['audit_lat', LATIN, 'https://lex.uz/docs/-6257288'], ['audit_ru', RU, 'https://lex.uz/docs/104723']]) {
        for (let i = 0; i < 3; i++) {
          const { rows } = await pool.query(
            `INSERT INTO legal_chunks (law_name, category, chunk_text, source_type, doc_id, source_url, is_valid)
             VALUES ($1, $2, $3, 'law_text', $4, $5, TRUE) RETURNING id`, [`TEST ${doc}`, CAT, text, doc, url]);
          ids.push(rows[0].id);
        }
      }
      const routes = {};
      const app = { get: (path, _auth, handler) => { routes[path] = handler; } };
      const reingested = [];
      mountCorpusAuditRoutes(app, {
        requireMasterAdmin: () => {}, pool,
        getAllLaws: () => [{ doc_id: 'konstitutsiya', law_name: "O'zbekiston Respublikasi Konstitutsiyasi", category: 'konstitutsiya', lex_url: 'https://lex.uz/docs/-6445145' }],
        fetchDoc: async () => ({}),
        reingest: async (docs, report) => { reingested.push(...docs); report.push({ status: 'done' }); },
      });
      const call = (path, query) => new Promise((resolve) => routes[path]({ query }, { json: resolve, status: () => ({ json: resolve }) }));

      await test('the corpus report finds the Cyrillic document and lists it first', async () => {
        const r = await call('/api/admin/corpus/script', {});
        const mine = r.documents.filter(d => d.doc_id.startsWith('audit_'));
        assert.deepStrictEqual(mine.map(d => [d.doc_id, d.script, d.chunks]), [['audit_cyr', 'uz-cyrillic', 3], ['audit_ru', 'russian', 3], ['audit_lat', 'latin', 3]]);
        assert.ok(r.pending.some(p => p.includes('audit_cyr')));
        assert.ok(!r.pending.some(p => p.includes('audit_ru')), 'a Russian text is not converted');
      });

      await test('?reingest=1 re-ingests the Cyrillic document from its Latin URL', async () => {
        await call('/api/admin/corpus/script', { reingest: '1' });
        await new Promise(r => setTimeout(r, 50));
        const target = reingested.find(d => d.doc_id === 'audit_cyr') || reingested[0];
        assert.ok(target, 'something was re-ingested');
        assert.match(target.source_url, /^https:\/\/lex\.uz\/docs\/-\d+$/u);
      });
      await test('?ingest=<doc_id> (re)ingests one registry act from its registry URL', async () => {
        reingested.length = 0;
        await new Promise(r => setTimeout(r, 20));
        const r = await call('/api/admin/corpus/script', { ingest: 'konstitutsiya' });
        await new Promise(r2 => setTimeout(r2, 50));
        assert.deepStrictEqual(reingested.map(d => [d.doc_id, d.source_url, d.category]), [['konstitutsiya', 'https://lex.uz/docs/-6445145', 'konstitutsiya']]);
        assert.ok(r.reingest && r.reingest.running !== undefined);
        const missing = await call('/api/admin/corpus/script', { ingest: 'no-such-act' });
        assert.match(missing.error || '', /no registry entry/u);
      });
    } finally {
      if (ids.length) await pool.query('DELETE FROM legal_chunks WHERE id = ANY($1::int[])', [ids]);
      await pool.end();
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
