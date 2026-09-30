'use strict';

/**
 * One article, one slot (eval run 17: in 10 of 47 misses the same article
 * filled two of the top 3 - e.g. Mehnat kodeksi 207 twice at 0.74).
 *
 *   node tests/collapse-repeated-chunks.test.js
 */

const assert = require('assert');
const { collapseRepeatedChunks } = require('../src/rag/search-utils');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

const MK = "O'zbekiston Respublikasining Mehnat kodeksi";
const ART207 = '207-modda. Ish vaqtidan tashqari ishlar. Ish beruvchi xodimni uning roziligisiz ish vaqtidan tashqari ishlarga jalb qilishga haqli emas.';
const law = (id, law_name, chunk_text, extra = {}) => ({ id, law_name, chunk_text, source_type: 'law_text', ...extra });

console.log('collapse repeated chunks');

test("a short article's parent and its only part (same text) take one slot", () => {
  const out = collapseRepeatedChunks([
    law(1, MK, ART207, { chunk_type: 'parent', score: 0.74 }),
    law(2, MK, `  ${ART207.replace(/ /g, '  ')}\n`, { chunk_type: 'child', score: 0.74 }),
    law(3, MK, '9-modda. Muddatlarni hisoblash.'),
  ]);
  assert.deepStrictEqual(out.map(r => r.id), [1, 3]);
});

test('a parent-child hit wrapping the same article under another id is dropped', () => {
  const out = collapseRepeatedChunks([
    law(1, MK, ART207),
    law('pc_0_207', MK, `Ish beruvchi xodimni uning roziligisiz\n\n[To'liq modda konteksti:]\n${ART207}`),
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 1, 'the earlier, higher-ranked one keeps its place and id');
  assert.ok(out[0].chunk_text.includes("[To'liq modda konteksti:]"), 'and takes the fuller text');
});

test('a part listed before its full article keeps its rank and gets the article text', () => {
  const part = 'Ish beruvchi xodimni uning roziligisiz ish vaqtidan tashqari ishlarga jalb qilishga haqli emas.';
  const out = collapseRepeatedChunks([law(5, MK, part), law(6, MK, ART207)]);
  assert.deepStrictEqual(out.map(r => [r.id, r.chunk_text]), [[5, ART207]]);
});

test('different parts of a long article, other laws and QA answers are kept', () => {
  const out = collapseRepeatedChunks([
    law(1, MK, '207-modda. Birinchi qism matni.'),
    law(2, MK, '207-modda. Ikkinchi qism matni, boshqa matn.'),
    law(3, 'Boshqa qonun', '207-modda. Birinchi qism matni.'),
    { id: 4, law_name: 'QA', chunk_text: 'Savol: x?\n\nJavob: y.', source_type: 'verified_qa' },
    { id: 5, law_name: 'QA', chunk_text: 'Savol: x?\n\nJavob: y.', source_type: 'verified_qa' },
    law(6, MK, ''),
    null,
  ]);
  assert.deepStrictEqual(out.map(r => r.id), [1, 2, 3, 4, 5, 6]);
});

test('the input objects are not changed', () => {
  const first = law(5, MK, 'qisqa matn');
  collapseRepeatedChunks([first, law(6, MK, 'uzunroq qisqa matn bilan')]);
  assert.strictEqual(first.chunk_text, 'qisqa matn');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
