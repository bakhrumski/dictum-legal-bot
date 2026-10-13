'use strict';

/**
 * A named special status pins its act by Lex.uz address, never by number
 * (2026-10-13: "VMQ-589" brought VMQ-589 of 06.11.2023, inviting foreigners,
 * instead of VMQ-589 of 15.07.2019, the IT Park technopark regulation).
 * The pinned page is used only when its own title mostly matches. Lex.uz is
 * stubbed - no network.
 *
 *   node tests/lex-pinned.test.js
 */

const assert = require('assert');
const path = require('path');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const TITLE_2019 = "Dasturiy mahsulotlar va axborot texnologiyalari texnologik parki faoliyatini tashkil etish chora-tadbirlari to'g'risida";
const TITLE_2023 = "Chet el fuqarolari va fuqaroligi bo'lmagan shaxslarni O'zbekiston Respublikasiga taklif qilish bo'yicha davlat xizmatini ko'rsatishning ma'muriy reglamentini tasdiqlash to'g'risida";
const BODY_2019 = "17. Texnopark rezidenti: O'zbekiston Respublikasi hududida mehnat faoliyatini amalga oshirish huquqi tasdiqnomalarini olmasdan turib chet ellik mutaxassislarni jalb etish;";

// lex-live-search with a stubbed fetch-lex: pages by address, an empty search page
function liveSearch(pages) {
  const fetched = [];
  const fl = require.resolve('../src/rag/fetch-lex');
  const ls = require.resolve('../src/rag/lex-live-search');
  delete require.cache[ls];
  require.cache[fl] = { id: fl, filename: fl, loaded: true, exports: {
    httpGet: async () => '<html><body></body></html>',
    fetchLexDocument: async (url) => { fetched.push(url); const p = pages[url]; if (!p) throw new Error('404'); return p; },
  } };
  const mod = require(ls);
  return { mod, fetched };
}
const page = (title, body, extra = {}) => ({ title, body, metadata: { source_url: extra.url || '', is_active: extra.is_active !== false, current_version_url: extra.current_version_url || null } });

(async () => {
  await test('the plan pins VMQ-589 of 15.07.2019 by its address (no number search left); another technopark pins nothing', () => {
    const { buildLexResearchPlan } = require('../src/rag/legal-research-playbook');
    const plan = buildLexResearchPlan('Men IT park rezidentiman. Chet ellik mutaxassis olib kelmoqchiman, tasdiqnoma kerakmi?', 'mehnat');
    const pinned = plan.filter(s => s.pinnedDocs);
    assert.strictEqual(pinned.length, 2, 'VMQ-589 and, for a foreign specialist, VMQ-86');
    assert.ok(pinned.every(p => p.kind === 'status-act-pinned'));
    assert.deepStrictEqual(pinned.map(p => [p.pinnedDocs[0].url, p.pinnedDocs[0].label]), [['https://lex.uz/docs/-4422250', 'VMQ-589, 15.07.2019'], ['https://lex.uz/docs/-5871129', 'VMQ-86, 22.02.2022']]);
    assert.deepStrictEqual([pinned[1].pinnedDocs[0].expectedNumber, pinned[1].pinnedDocs[0].expectedDate, pinned[1].pinnedDocs[0].expectedTitles], ['86', '2022-02-22', []]);
    const taxOnly = buildLexResearchPlan('IT park rezidentlari qanday soliq imtiyozlariga ega?', 'soliq').filter(s => s.pinnedDocs);
    assert.deepStrictEqual(taxOnly.map(p => p.pinnedDocs[0].label), ['VMQ-589, 15.07.2019'], 'VMQ-86 only with a foreign specialist');
    assert.ok(pinned[0].pinnedDocs[0].expectedTitles.length === 2 && /технологик парки/u.test(pinned[0].pinnedDocs[0].expectedTitles[1]), 'Latin and Cyrillic title');
    assert.ok(!plan.some(s => /589/u.test(s.query)), 'no act-number query: Cabinet numbers repeat every year');
    const other = buildLexResearchPlan('Yashnobod innovatsion texnoparki rezidentiman, chet ellik mutaxassis olsam bo\'ladimi?', 'mehnat');
    assert.ok(!other.some(s => s.pinnedDocs));
  });

  await test('search: the pinned page is fetched first and kept when its title matches (Latin or Cyrillic); another act at that address is refused', async () => {
    const url = 'https://lex.uz/docs/-4422250';
    let { mod, fetched } = liveSearch({ [url]: page(TITLE_2019, BODY_2019, { url }) });
    const pinnedDocs = [{ url, expectedTitle: TITLE_2019, expectedTitles: [TITLE_2019, require('../src/rag/legal-research-playbook').translitQueryToCyr(TITLE_2019)] }];
    let r = await mod.searchLexUz(TITLE_2019, { scoreText: 'IT park rezidenti chet ellik mutaxassis tasdiqnoma', includeRegistry: false, pinnedDocs, maxDocs: 1 });
    assert.strictEqual(fetched[0], url, 'fetched first');
    assert.deepStrictEqual(r.map(x => [x.source, x.url]), [['lex.uz-pinned', url]]);
    assert.ok(/tasdiqnomalarini olmasdan/u.test(r[0].content));
    // the same address in Cyrillic script
    ({ mod } = liveSearch({ [url]: page(pinnedDocs[0].expectedTitles[1], BODY_2019, { url }) }));
    r = await mod.searchLexUz(TITLE_2019, { scoreText: 'chet ellik mutaxassis', includeRegistry: false, pinnedDocs, maxDocs: 1 });
    assert.strictEqual(r.length, 1, 'Cyrillic page accepted');
    // another act at the address (or a stale link): refused, never cited as the pinned act
    ({ mod } = liveSearch({ [url]: page(TITLE_2023, 'Chet el fuqarolarini taklif qilish ...', { url }) }));
    r = await mod.searchLexUz(TITLE_2019, { scoreText: 'chet ellik mutaxassis', includeRegistry: false, pinnedDocs, maxDocs: 1 });
    assert.strictEqual(r.length, 0);
    // a historical (repealed) version: skipped as for every candidate
    ({ mod } = liveSearch({ [url]: page(TITLE_2019, BODY_2019, { url, is_active: false }) }));
    r = await mod.searchLexUz(TITLE_2019, { scoreText: 'chet ellik mutaxassis', includeRegistry: false, pinnedDocs, maxDocs: 1 });
    assert.strictEqual(r.length, 0);
  });

  await test('a pinned result is kept against a same-number act of another year matched by number', () => {
    const { selectLexResearchResults } = require('../src/rag/legal-research-playbook');
    const q = 'Men IT park rezidentiman. Chet ellik mutaxassis olib kelmoqchiman, tasdiqnoma kerakmi?';
    const groups = [
      { step: { kind: 'exact-act', query: 'VMQ-589', preferredPrefixes: ['VMQ'] }, results: [{ url: 'https://lex.uz/docs/-6650000', title: TITLE_2023, content: 'chet el fuqarolari taklif', exactIdentityMatch: true }] },
      { step: { kind: 'status-act-pinned', query: TITLE_2019 }, results: [{ url: 'https://lex.uz/docs/-4422250', title: TITLE_2019, content: BODY_2019, source: 'lex.uz-pinned' }] },
    ];
    const top = selectLexResearchResults(groups, q, 1);
    assert.strictEqual(top[0].url, 'https://lex.uz/docs/-4422250');
  });

  await test('titleMostlyMatches needs most of the title, not one shared word', () => {
    const { mod } = liveSearch({});
    assert.strictEqual(mod.titleMostlyMatches(TITLE_2019, TITLE_2019), true);
    assert.strictEqual(mod.titleMostlyMatches(TITLE_2019, TITLE_2023), false);
    assert.strictEqual(mod.titleMostlyMatches(TITLE_2019, "Axborot texnologiyalari to'g'risida"), false);
  });

  await test('an act pinned without a title (VMQ-86) is kept only when its own number AND date are on the page', async () => {
    const url = 'https://lex.uz/docs/-5871129';
    const pinnedDocs = [{ url, expectedTitle: '', expectedTitles: [], expectedNumber: '86', expectedDate: '2022-02-22' }];
    const body = "Vazirlar Mahkamasining qarori\nToshkent sh., 2022-yil 22-fevral, 86-son\n...chet ellik mutaxassislar ... texnologik park rezidentlari ...";
    let { mod } = liveSearch({ [url]: { title: "Ayrim davlat xizmatlarini ko'rsatishning ma'muriy reglamentlarini tasdiqlash to'g'risida", body, metadata: { source_url: url, is_active: true, adoption_date: '2022-02-22', document_number: '86' } } });
    let r = await mod.searchLexUz('tasdiqnoma', { scoreText: 'IT park chet ellik mutaxassis tasdiqnoma', includeRegistry: false, pinnedDocs, maxDocs: 1 });
    assert.strictEqual(r.length, 1);
    assert.ok(/reglamentlarini/u.test(r[0].lawName), 'the page\'s own title when none was pinned');
    // the same number of another year, or the date with another number: refused
    ({ mod } = liveSearch({ [url]: { title: 'Boshqa qaror', body: '2023-yil 14-mart, 86-son', metadata: { source_url: url, is_active: true, adoption_date: '2023-03-14', document_number: '86' } } }));
    assert.strictEqual((await mod.searchLexUz('x', { scoreText: 'mutaxassis', includeRegistry: false, pinnedDocs, maxDocs: 1 })).length, 0);
    ({ mod } = liveSearch({ [url]: { title: 'Boshqa qaror', body: '22.02.2022, 91-son', metadata: { source_url: url, is_active: true, adoption_date: '2022-02-22', document_number: '91' } } }));
    assert.strictEqual((await mod.searchLexUz('x', { scoreText: 'mutaxassis', includeRegistry: false, pinnedDocs, maxDocs: 1 })).length, 0);
    assert.strictEqual(mod.identityMatches({ title: 'X', body: '№ 86 ... 22.02.2022', metadata: {} }, '86', '2022-02-22'), true, 'from the page text');
    assert.strictEqual(mod.identityMatches({ title: 'X', body: '№ 860 ... 22.02.2022', metadata: {} }, '86', '2022-02-22'), false);
  });

  delete require.cache[require.resolve('../src/rag/fetch-lex')];
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
