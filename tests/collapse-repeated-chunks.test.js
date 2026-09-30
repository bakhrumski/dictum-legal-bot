'use strict';

/**
 * One article, one slot (eval run 17: in 10 of 47 misses the same article
 * filled two of the top 3 - e.g. Mehnat kodeksi 207 twice at 0.74; run 19,
 * matching identical text only, caught none of them).
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
const TITLE = '207-modda. Ish vaqtidan tashqari ishlar';
const PART1 = 'Ish beruvchi xodimni uning roziligisiz ish vaqtidan tashqari ishlarga jalb qilishga haqli emas.';
const PART2 = 'Ish vaqtidan tashqari ishlar har bir xodim uchun yiliga bir yuz yigirma soatdan oshmasligi kerak.';
// As the structural chunker writes them (buildParentText / buildChildText).
const PARENT = `[24-bob. Ish vaqti]\n${TITLE}\n${PART1}\n${PART2}`;
const CHILD1 = `${TITLE} — 1-qism:\n${PART1}`;
const CHILD2 = `${TITLE} — 2-qism:\n${PART2}`;
const law = (id, chunk_text, extra = {}) => ({ id, law_name: MK, chunk_text, source_type: 'law_text', article_numbers: ['207'], ...extra });

console.log('collapse repeated chunks');

test('an article and its part (different headers) take one slot, as in run 19', () => {
  const out = collapseRepeatedChunks([
    law(1, PARENT, { score: 0.74 }),
    law(2, CHILD1, { score: 0.74 }),
    law(3, '9-modda. Muddatlarni hisoblash.\nMuddat kalendar kunlarda hisoblanadi.', { article_numbers: ['9'] }),
  ]);
  assert.deepStrictEqual(out.map(r => r.id), [1, 3]);
  assert.strictEqual(out[0].chunk_text, PARENT);
});

test('a part listed first keeps its rank and id and takes the full article', () => {
  const out = collapseRepeatedChunks([law(5, CHILD1), law(6, PARENT)]);
  assert.deepStrictEqual(out.map(r => [r.id, r.chunk_text]), [[5, PARENT]]);
});

test('a short article stored as parent and as its only part (same text) takes one slot', () => {
  const out = collapseRepeatedChunks([law(1, `${TITLE}\n${PART1}`), law(2, `  ${TITLE}\n${PART1}\n`)]);
  assert.deepStrictEqual(out.map(r => r.id), [1]);
});

test('a parent-child hit (pc_ id, articleNumber only) for the same article is dropped', () => {
  const pc = { id: 'pc_0_207', law_name: MK, source_type: 'law_text', articleNumber: '207', article_numbers: ['207'],
    chunk_text: `${CHILD1}\n\n[To'liq modda konteksti:]\n${PARENT}` };
  const out = collapseRepeatedChunks([law(1, PARENT), pc]);
  assert.deepStrictEqual(out.map(r => r.id), [1]);
});

test('two different parts of one article are joined into the first slot', () => {
  const out = collapseRepeatedChunks([law(1, CHILD1), law(2, CHILD2)]);
  assert.deepStrictEqual(out.map(r => r.id), [1]);
  assert.ok(out[0].chunk_text.includes(PART1) && out[0].chunk_text.includes(PART2));
});

test('a join that would exceed maxChars drops the later part instead', () => {
  const out = collapseRepeatedChunks([law(1, CHILD1), law(2, CHILD2)], { maxChars: 150 });
  assert.deepStrictEqual(out.map(r => [r.id, r.chunk_text]), [[1, CHILD1]]);
});

test('same article number in another law, QA answers and multi-article chunks are kept', () => {
  const out = collapseRepeatedChunks([
    law(1, CHILD1),
    law(2, CHILD1, { law_name: 'Boshqa qonun' }),
    { id: 3, law_name: 'QA', chunk_text: 'Savol: x?\n\nJavob: y.', source_type: 'verified_qa', article_numbers: ['207'] },
    { id: 4, law_name: 'QA', chunk_text: 'Savol: x?\n\nJavob: y.', source_type: 'verified_qa', article_numbers: ['207'] },
    law(5, '207-modda …\n208-modda …', { article_numbers: ['207', '208'] }),
    law(6, ''),
    null,
  ]);
  assert.deepStrictEqual(out.map(r => r.id), [1, 2, 3, 4, 5, 6]);
});

test('chunks without an article number still collapse on identical text', () => {
  const plain = (id, t) => ({ id, law_name: 'VMQ-1', chunk_text: t, source_type: 'law_text' });
  const out = collapseRepeatedChunks([plain(1, 'Nizom matni birinchi band.'), plain(2, 'Nizom  matni birinchi band.'), plain(3, 'Boshqa band.')]);
  assert.deepStrictEqual(out.map(r => r.id), [1, 3]);
});

test('the input objects are not changed', () => {
  const first = law(5, CHILD1);
  collapseRepeatedChunks([first, law(6, CHILD2)]);
  assert.strictEqual(first.chunk_text, CHILD1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
