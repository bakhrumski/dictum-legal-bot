'use strict';

/**
 * Long articles and parts are split, not cut. The structural chunker used to
 * store substring(0, 3200) of an article and substring(0, 800) of a part, so
 * the rest of a long article never reached the model and the tail of a long
 * part was unsearchable.
 *
 *   node tests/structural-chunker-long.test.js
 */

const assert = require('assert');
const { chunkByArticle, PARENT_MAX_CHARS, CHILD_MAX_CHARS } = require('../src/rag/structural-chunker');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}
const quiet = (fn) => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };

const sentence = "Soliq to'lovchi hisobotni belgilangan muddatda taqdim etadi va to'lovni amalga oshiradi. ";
const parts = Array.from({ length: 12 }, (_, i) => ({
  partNumber: String(i + 1), partType: 'part',
  text: `${i + 1}. ${sentence.repeat(i === 5 ? 25 : 4)}OXIRGI${i + 1}`,
}));
const longArticle = {
  articleNumber: '361', articleTitle: '361-modda. Mol-mulkni sotishdan olingan daromad', chapter: '40-bob',
  fullText: parts.map(p => p.text).join('\n'), parts,
};

console.log('structural chunker: long articles');
const chunks = quiet(() => chunkByArticle([longArticle], { doc_id: 'nk', law_name: 'Soliq kodeksi' }));
const parents = chunks.filter(c => c.chunkType === 'parent');
const children = chunks.filter(c => c.chunkType === 'child');

test(`a ${longArticle.fullText.length}-character article keeps its end (main: one parent cut at ${PARENT_MAX_CHARS})`, () => {
  console.log(`      parents: ${parents.map(p => p.text.length).join(' + ')}`);
  assert.ok(parents.length >= 2);
  assert.ok(parents.every(p => p.text.length <= PARENT_MAX_CHARS));
  assert.ok(parents.some(p => p.text.includes('OXIRGI12')), 'the last part is in a parent');
  assert.strictEqual(parents[0].metadata.chunkId, 'nk_art_361', 'first piece keeps the article id');
  assert.ok(parents.every(p => p.metadata.articleNumber === '361'));
  assert.ok(parents.slice(1).every(p => p.text.startsWith('[40-bob]\n361-modda') && p.text.includes('(davomi)')));
});

test(`a long part becomes several children (main: cut at ${CHILD_MAX_CHARS})`, () => {
  const part6 = children.filter(c => c.metadata.partNumber === '6');
  assert.ok(part6.length >= 2);
  assert.ok(children.every(c => c.text.length <= CHILD_MAX_CHARS));
  assert.ok(part6.some(c => c.text.includes('OXIRGI6')), 'the tail of part 6 is searchable');
  assert.deepStrictEqual(part6.slice(0, 2).map(c => c.metadata.chunkId), ['nk_art_361_p6', 'nk_art_361_p6_s2']);
});

test('every child links to the parent piece that holds its text', () => {
  const byId = new Map(parents.map(p => [p.metadata.chunkId, p]));
  for (const c of children) {
    const parent = byId.get(c.parentId);
    assert.ok(parent, `child ${c.metadata.chunkId} links to ${c.parentId}`);
  }
  const last = children.find(c => c.text.includes('OXIRGI12'));
  assert.ok(byId.get(last.parentId).text.includes('OXIRGI12'));
});

test('a short article is unchanged: one parent with the article id', () => {
  const short = { articleNumber: '5', articleTitle: '5-modda. Qisqa', chapter: '', fullText: 'Qisqa matn.', parts: [] };
  const out = quiet(() => chunkByArticle([short], { doc_id: 'x' }));
  assert.deepStrictEqual(out.map(c => [c.chunkType, c.metadata.chunkId, c.text]), [['parent', 'x_art_5', '5-modda. Qisqa\nQisqa matn.']]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
