'use strict';

/**
 * A citation is written in the answer's language (2026-10-01, owner: a
 * Russian answer cited "(O'RQ-310), 20-модда, биринчи қисм", unlinked).
 *
 *   node tests/citation-language.test.js
 */

const assert = require('assert');
const { normalizeLegalAnswerCitations, buildLexDeepLink, citationLanguageForText } = require('../src/rag/citation-utils');
const { ruPartNumber, ruPartOrdinal, ruIdentifier, ruTitle } = require('../src/rag/citation-ru');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

const MK = { law_name: "O'zbekiston Respublikasining Mehnat kodeksi", source_url: 'https://lex.uz/uz/docs/6257288', document_number: "O'RQ-798", article_numbers: ['561'], chunk_text: '561-modda. Ishga tiklash.', source_type: 'law_text' };
const LLC = { law_name: "Mas'uliyati cheklangan jamiyatlar to'g'risida", source_url: 'https://lex.uz/docs/-8151376', document_number: "O'RQ-1137", article_numbers: ['20'], chunk_text: "20-modda. Ulushni o'tkazish.", source_type: 'law_text' };
const link = (s) => (s.match(/\[\*\*[^\]]+\*\*\]\([^)]+\)/gu) || []);

console.log('citation language');

test('the question decides the language', () => {
  assert.strictEqual(citationLanguageForText('Возможно ли провести отчуждение доли?'), 'ru');
  assert.strictEqual(citationLanguageForText("Ishdan bo'shatishdi"), 'uz');
  assert.strictEqual(citationLanguageForText('Ишдан бўшатишди, нима қилай?'), 'uz');
});

test('a Russian citation (act, статья, часть первая) becomes one link to the Russian text', () => {
  const out = normalizeLegalAnswerCitations('- **Трудовой кодекс Республики Узбекистан (ЗРУ-798), статья 561, часть первая**', [MK], 'ru');
  const links = link(out);
  assert.strictEqual(links.length, 1, out);
  assert.match(links[0], /^\[\*\*Трудовой кодекс Республики Узбекистан \(ЗРУ-798\), статья 561, часть первая\*\*\]\(https:\/\/lex\.uz\/ru\/docs\/6257288#:~:text=/u);
  assert.ok(decodeURIComponent(links[0]).includes('#:~:text=Статья 561'));
});

test('a declined title keeps the sentence grammatical', () => {
  const out = normalizeLegalAnswerCitations('Согласно Трудовому кодексу, статья 561, суд восстанавливает работника.', [MK], 'ru');
  assert.match(out, /^Согласно \[\*\*Трудовому кодексу, статья 561\*\*\]\(https:\/\/lex\.uz\/ru\/docs\/6257288/u);
});

test('a quoted law title with its identifier and part in words', () => {
  const out = normalizeLegalAnswerCitations('Закон «Об обществах с ограниченной ответственностью» (ЗРУ-1137), статья 20, часть третья требует уведомления.', [LLC], 'ru');
  assert.match(out, /^\[\*\*Закон «Об обществах с ограниченной ответственностью» \(ЗРУ-1137\), статья 20, часть третья\*\*\]\(https:\/\/lex\.uz\/ru\/docs\/8151376/u);
  assert.ok(!/\]\([^)]*\)[^\[]*\]\(/u.test(out.split('требует')[0]), 'no stray link fragments');
});

test('an act named without an article links to its Russian page, as written', () => {
  const out = normalizeLegalAnswerCitations('Об этом говорит и Трудовой кодекс.', [MK], 'ru');
  assert.strictEqual(out, 'Об этом говорит и [**Трудовой кодекс**](https://lex.uz/ru/docs/6257288).');
});

test('the repealed 2001 law is not linked to the current one by its similar title', () => {
  const out = normalizeLegalAnswerCitations('Закон «Об обществах с ограниченной и дополнительной ответственностью» (ЗРУ-310), статья 20', [LLC], 'ru');
  assert.strictEqual(link(out).length, 0, out);
});

test('Uzbek answers are unchanged: Latin page, Uzbek label', () => {
  const out = normalizeLegalAnswerCitations("Mehnat kodeksi (O'RQ-798), 561-modda, 1-qism bo'yicha.", [MK], 'uz');
  assert.match(out, /^\[\*\*Mehnat kodeksi \(O'RQ-798\), 561-modda, 1-qism\*\*\]\(https:\/\/lex\.uz\/docs\/-6257288/u);
});

test('an Uzbek-format citation in a Russian answer is relabelled in Russian', () => {
  const out = normalizeLegalAnswerCitations("Mehnat kodeksi (O'RQ-798), 561-modda", [MK], 'ru');
  assert.match(out, /\[\*\*Трудовой кодекс Республики Узбекистан \(ЗРУ-798\), статья 561\*\*\]/u);
});

test('Russian helpers: ordinals, identifiers, titles, deep link', () => {
  assert.deepStrictEqual(['первая', 'второй', 'третью', '4', 'пятая'].map(ruPartNumber), ['1', '2', '3', '4', '5']);
  assert.strictEqual(ruPartOrdinal(1), 'первая');
  assert.strictEqual(ruPartOrdinal(22), '22');
  assert.deepStrictEqual(["O'RQ-310", 'PQ-1', 'PF-2', 'VMQ-3', '349-I'].map(ruIdentifier), ['ЗРУ-310', 'ПП-1', 'УП-2', 'ПКМ-3', '349-I']);
  assert.strictEqual(ruTitle('fuqarolik kodeksi 1 qism'), 'Гражданский кодекс Республики Узбекистан (часть первая)');
  assert.strictEqual(buildLexDeepLink({ source_url: 'https://lex.uz/docs/-6257288', lex_element_id: '-6263814' }, { lang: 'ru', articleRef: '561' }),
    `https://lex.uz/ru/docs/6257288#:~:text=${encodeURIComponent('Статья 561')}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
