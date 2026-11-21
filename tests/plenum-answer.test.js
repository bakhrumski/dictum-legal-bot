'use strict';

/**
 * S2 (docs/design/sud-amaliyoti.md): Plenum bands in the legal answer. No AI,
 * no database here - a fake pool returns band rows as the real query would.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { actKey, articleSet } = require('../src/plenum/acts');
const A = require('../src/plenum/answer');
const S = require('../src/rag/answer-structure');
const C = require('../src/rag/citation-utils');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.stack}`); }
}

const row = (o) => ({
  decision_id: 1, lex_id: 1, lat_lex_id: -1, ru_lex_id: 2, court: 'oliy', number: '26', adopted_on: new Date('2023-11-20T00:00:00Z'),
  n: 24, text: '24. Ish beruvchi xodimni ogohlantirish muddatini pulli kompensatsiya bilan almashtirishga haqlidir.', article_refs: [{ act: 'MK', n: '161' }], ...o,
});
// the band query gets `rows`; the edition's word count reads them among 300 bands on other matters
const filler = Array.from({ length: 300 }, (_, i) => ({ text: `${i}. Sudlar ishni ko'rishda dalillarni baholaydi va qaror chiqaradi.` }));
const fakeDb = (rows, seen = {}) => ({ query: async (sql, args) => {
  if (/SELECT b\.text FROM/.test(sql)) { seen.stats = (seen.stats || 0) + 1; return { rows: [...filler, ...rows] }; }
  seen.sql = sql; seen.args = args; return { rows };
} });
const labour = [{ law_name: "O'zbekiston Respublikasining Mehnat kodeksi", article_numbers: ['161'] }];
const Q = "Ish beruvchi xodimni ogohlantirmasdan ishdan bo'shatdi, kompensatsiya olsam bo'ladimi?";

(async () => {
  await test('acts: one key however the code is written; an abbreviation read by the edition', () => {
    assert.strictEqual(actKey("O'zbekiston Respublikasining Fuqarolik kodeksi (1-qism)"), 'fk');
    assert.strictEqual(actKey('Гражданский кодекс Республики Узбекистан', 'ru'), 'fk');
    assert.strictEqual(actKey('FK'), 'fk');
    assert.strictEqual(actKey('ЖК', 'uz'), 'jk');
    assert.strictEqual(actKey('ЖК', 'ru'), 'ujk');
    assert.strictEqual(actKey('Fuqarolik protsessual kodeksi'), 'fpk');
    assert.strictEqual(actKey('«Sudlar toʻgʻrisida» qonuni'), null, 'an act that is not a known code is never guessed');
    assert.deepStrictEqual(articleSet('44–46'), ['44', '45', '46']);
    assert.strictEqual(A.artKey('57¹'), '57-1');
    assert.strictEqual(A.artKey('57-1'), '57-1');
    assert.strictEqual(A.artKey('333'), '333');
  });

  await test('a band on the same article of the same code that shares the question\'s words is picked, with its name and link', async () => {
    const seen = {};
    const bands = await A.findPlenumBands(fakeDb([row()], seen), { chunks: labour, question: Q, language: 'uz', getRefs: C.getChunkArticleRefs });
    assert.strictEqual(bands.length, 1);
    assert.strictEqual(bands[0].name, 'Oliy sud Plenumining 26-son qarori (20.11.2023)');
    assert.strictEqual(bands[0].url, 'https://lex.uz/docs/-1');
    assert.deepStrictEqual(bands[0].pairs, ['mk:161']);
    assert.strictEqual(seen.args[0], 'lat');
    assert.ok(/in_force AND NOT d\.is_amendment/.test(seen.sql) && /b\.n > 0/.test(seen.sql), 'in force, no amending decisions, no preamble');
  });

  await test('a word found in many bands does not choose; the edition\'s counts are read once and kept', async () => {
    const seen = {};
    const db = fakeDb([row({ text: "24. Sudlar ishni ko'rishda dalillarni baholaydi, ish beruvchi esa qaror chiqaradi." })], seen);
    const q = "Sud ishni ko'rishda dalillarni qanday baholaydi?";
    assert.strictEqual((await A.findPlenumBands(db, { chunks: labour, question: q, getRefs: C.getChunkArticleRefs })).length, 0, 'only common words shared');
    await A.findPlenumBands(db, { chunks: labour, question: Q, getRefs: C.getChunkArticleRefs });
    assert.strictEqual(seen.stats, 1, 'counted once for the edition');
  });

  await test('never picked: another code, another article, an article with no shared word, a band with no act', async () => {
    const run = rows => A.findPlenumBands(fakeDb(rows), { chunks: labour, question: Q, language: 'uz', getRefs: C.getChunkArticleRefs });
    assert.strictEqual((await run([row({ article_refs: [{ act: 'FK', n: '161' }] })])).length, 0, 'another code');
    assert.strictEqual((await run([row({ article_refs: [{ act: 'MK', n: '162' }] })])).length, 0, 'another article');
    assert.strictEqual((await run([row({ article_refs: [{ act: null, n: '161' }] })])).length, 0, 'no act');
    assert.strictEqual((await run([row({ text: '24. Valyuta qimmatliklarini saqlash holatlari alohida baholanadi.' })])).length, 0, 'no shared word');
    assert.strictEqual((await A.findPlenumBands(fakeDb([row()]), { chunks: [{ law_name: '«Sudlar toʻgʻrisida» qonuni', article_numbers: ['161'] }], question: Q })).length, 0, 'the answer uses no known code');
  });

  await test('at most two bands, from different decisions; a range opens its articles', async () => {
    const rows = [
      row({ decision_id: 1, n: 3 }), row({ decision_id: 1, n: 4 }),
      row({ decision_id: 7, lex_id: 7, lat_lex_id: -7, n: 9, article_refs: [{ act: 'MK', n: '160–165' }] }),
      row({ decision_id: 8, lex_id: 8, lat_lex_id: -8, n: 2 }),
    ];
    const bands = await A.findPlenumBands(fakeDb(rows), { chunks: labour, question: Q, language: 'uz', getRefs: C.getChunkArticleRefs });
    assert.strictEqual(bands.length, 2);
    assert.notStrictEqual(bands[0].decisionId, bands[1].decisionId);
  });

  await test('a Russian answer reads the Russian edition; a Cyrillic Uzbek question the Cyrillic one', async () => {
    const seen = {};
    const ru = await A.findPlenumBands(fakeDb([row({ text: '24. Работодатель вправе заменить предупреждение денежной компенсацией работнику.', article_refs: [{ act: 'ТК', n: '161' }] })], seen),
      { chunks: [{ law_name: 'Трудовой кодекс Республики Узбекистан', article_numbers: ['161'], language: 'ru' }], question: 'Можно ли получить компенсацию вместо предупреждения?', language: 'ru' });
    assert.strictEqual(seen.args[0], 'ru');
    assert.strictEqual(ru.length, 1);
    assert.ok(ru[0].url === 'https://lex.uz/ru/docs/2' && /^Пленум ВС, постановление № 26 от 20\.11\.2023$/.test(ru[0].name), ru[0].name);
    assert.strictEqual(A.editionFor('uz', 'Иш берувчи огоҳлантирмасдан бўшатди'), 'uz');
    assert.strictEqual(A.editionFor('uz', 'Ish beruvchi'), 'lat');
  });

  await test('fails closed: PLENUM_ANSWERS=off, no table, a database error -> nothing, never a throw', async () => {
    process.env.PLENUM_ANSWERS = 'off';
    assert.deepStrictEqual(await A.findPlenumBands(fakeDb([row()]), { chunks: labour, question: Q }), []);
    delete process.env.PLENUM_ANSWERS;
    const broken = { query: async () => { throw new Error('relation "plenum_bands" does not exist'); } };
    assert.deepStrictEqual(await A.findPlenumBands(broken, { chunks: labour, question: Q, getRefs: C.getChunkArticleRefs }), []);
    assert.deepStrictEqual(await A.findPlenumBands(null, { chunks: labour, question: Q }), []);
  });

  await test('the block says "not a law", the band is capped at a sentence end, meta carries no text', async () => {
    const long = `24. ${'Ish beruvchi xodimni ogohlantirish muddatini kompensatsiya bilan almashtiradi. '.repeat(40)}`;
    const [b] = await A.findPlenumBands(fakeDb([row({ text: long })]), { chunks: labour, question: Q, getRefs: C.getChunkArticleRefs });
    assert.ok(b.text.length <= A.MAX_CHARS + 2 && /\. …$/.test(b.text), 'cut at a full sentence and marked');
    const block = A.contextBlock([b], 'uz');
    assert.ok(/SUD AMALIYOTI — PLENUM TUSHUNTIRISHI \(qonun emas/.test(block) && block.includes('[P1] Oliy sud Plenumining 26-son qarori (20.11.2023), 24-band | https://lex.uz/docs/-1'));
    assert.ok(/РАЗЪЯСНЕНИЕ ПЛЕНУМА \(не закон/.test(A.contextBlock([b], 'ru')));
    assert.strictEqual(A.contextBlock([], 'uz'), '');
    const m = A.metaOf([b]);
    assert.ok(!JSON.stringify(m).includes('ogohlantirish') && m.bands[0].decision === 1);
  });

  await test('a quote of the band passes the word-for-word check and links to the decision on lex.uz; an invented one is removed', () => {
    const chunks = A.citationChunks([{ decisionId: 1, n: 24, lang: 'lat', name: 'Oliy sud Plenumining 26-son qarori (20.11.2023)', url: 'https://lex.uz/docs/-1', text: row().text }]);
    assert.deepStrictEqual(chunks[0].article_numbers, [], '"24-band" in the answer is not linked as a law\'s article');
    const answer = [
      '**Tahlil**', 'Oliy sud Plenumining 26-son qarori (20.11.2023), 24-bandida tushuntirilishicha:',
      '> «xodimni ogohlantirish muddatini pulli kompensatsiya bilan almashtirishga haqlidir»',
      '> «ish beruvchi har doim kompensatsiya to\'lashga majbur»',
    ].join('\n');
    const { text, quotes } = C.normalizeLegalAnswerCitationsDetailed(answer, chunks, 'uz');
    assert.ok(/> «xodimni ogohlantirish muddatini pulli kompensatsiya bilan almashtirishga haqlidir» \[Oliy sud Plenumining 26-son qarori \(20\.11\.2023\), 24-band · lex\.uz ↗\]\(https:\/\/lex\.uz\/docs\/-1#:~:text=/.test(text), text);
    assert.ok(!text.includes('har doim kompensatsiya'), 'a quote not in the band is removed');
    assert.strictEqual(quotes.removed, 1);
  });

  await test('prompt: one line in Tahlil only when the band applies, never "the Plenum said nothing"', () => {
    const uz = S.promptRules('uz');
    const ru = S.promptRules('ru');
    assert.ok(uz.includes('SUD AMALIYOTI — PLENUM TUSHUNTIRISHI') && /BITTA qator/.test(uz) && /Plenum qonun emas/.test(uz) && /hech qachon yozmang/.test(uz));
    assert.ok(ru.includes('РАЗЪЯСНЕНИЕ ПЛЕНУМА') && /ОДНУ строку/.test(ru) && /не закон/.test(ru));
    assert.strictEqual(S.plenumRule('uz'), uz.split('\n').find(l => l.includes('Sud amaliyoti')));
  });

  await test('wiring: retrieveLegalContext adds the block after the law\'s text and the bands to the citation chunks; no AI in the module', () => {
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.ok(/findPlenumBands\(pool, \{\s*chunks: citationChunks, question: originalQuestion/.test(server));
    assert.ok(/citationChunks\.push\(\.\.\.plenumAnswer\.citationChunks\(bands\)\)/.test(server));
    assert.strictEqual((server.match(/chunksText \+ plenumBlock \+ webText/g) || []).length, 2, 'uz and ru context');
    for (const f of ['answer.js', 'acts.js']) {
      const src = fs.readFileSync(path.join(__dirname, '../src/plenum', f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      assert.ok(!/callAI|callCheapAI|callOpenAI|embedding|fetch\(/.test(src), `${f} makes no AI or network call`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
