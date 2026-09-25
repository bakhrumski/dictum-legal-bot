'use strict';

/**
 * Law detection from a question: Uzbek Latin and Cyrillic, Russian names and
 * abbreviations, curly apostrophes; ordinary words are not codes.
 *
 *   node tests/law-hints.test.js
 */

const assert = require('assert');
const { detectLawHint } = require('../src/rag/law-hints');

const cases = [
  ['Ma’muriy javobgarlik to‘g‘risidagi kodeks', "ma'muriy javobgarlik"],
  ['Mehnat kodeksi 161-modda', 'mehnat kodeks'],
  ['ст. 386 ГК', 'fuqarolik kodeks'],
  ['статья 131 ГПК', 'fuqarolik protsessual'],
  ['УК РУз статья 97', 'jinoyat kodeks'],
  ['УПК', 'jinoyat-protsessual'],
  ['ТК РУз', 'mehnat kodeks'],
  ['Трудовой кодекс', 'mehnat kodeks'],
  ['НК', 'soliq kodeks'],
  ['КоАП 128', "ma'muriy javobgarlik"],
  ['Семейный кодекс', 'oila kodeks'],
  ['Меҳнат кодекси 161-модда', 'mehnat kodeks'],
  ['SK 45-modda', 'soliq kodeks'],
  ['MK 100', 'mehnat kodeks'],
  ['Жилищный кодекс', 'uy-joy kodeks'],
  ['Конституция', 'konstitutsiya'],
  ['так как', null],
  ["ok bo'ladi", null],
  ['Tuk nima', null],
];

let passed = 0, failed = 0;
for (const [q, want] of cases) {
  try { assert.strictEqual(detectLawHint(q), want); passed++; }
  catch (e) { console.error(`  ✗ ${q}: got ${detectLawHint(q)}, want ${want}`); failed++; }
}
console.log(`  law hints: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
