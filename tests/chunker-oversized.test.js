'use strict';

/**
 * The plain chunker never leaves a chunk far above its hard max (eval runs
 * 5-10: a regulation whose points are "1.", "2." on single lines was stored
 * as one 797,454-character chunk).
 *
 *   node tests/chunker-oversized.test.js
 */

const assert = require('assert');
const { chunkLegalDocument, splitOversized, CHUNK_MAX } = require('../src/rag/chunker');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}
const quiet = (fn) => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };
const HARD_MAX = CHUNK_MAX * 4;

console.log('chunker: oversized sections');
const points = Array.from({ length: 3000 }, (_, i) => `${i + 1}. Ariza elektron tizim orqali beriladi va hujjatlar ko'rib chiqiladi, ruxsat berish tartib-taomillari amalga oshiriladi.`).join('\n');
const regulation = `VAZIRLAR MAHKAMASINING QARORI\n${points}`;

test('a regulation with single-line "1." points is split (main: 1 chunk of 373,922 characters)', () => {
  const chunks = quiet(() => chunkLegalDocument(regulation, { law_name: 'VMQ-86' }));
  const longest = Math.max(...chunks.map(c => c.text.length));
  console.log(`      ${regulation.length} chars -> ${chunks.length} chunks, longest ${longest}`);
  assert.ok(chunks.length > 50);
  assert.ok(longest <= HARD_MAX, `longest ${longest}`);
  const all = chunks.map(c => c.text).join('\n');
  for (const p of ['1. Ariza', '1500. Ariza', '3000. Ariza']) assert.ok(all.includes(p), p);
});

test('articles are still split as before', () => {
  const law = Array.from({ length: 5 }, (_, i) => `${i + 1}-modda. Sarlavha ${i + 1}\nMatn ${i + 1}.`).join('\n');
  const chunks = quiet(() => chunkLegalDocument(law, { law_name: 'Test' }));
  assert.ok(chunks.length >= 1 && chunks.every(c => c.text.length <= HARD_MAX));
});

test('splitOversized: short text unchanged; long text split at lines, sentences, then words', () => {
  assert.deepStrictEqual(splitOversized('qisqa matn', 100), ['qisqa matn']);
  const lines = splitOversized(Array.from({ length: 50 }, (_, i) => `qator ${i}`).join('\n'), 60);
  assert.ok(lines.every(p => p.length <= 60) && lines.join('\n').includes('qator 49'));
  const sentences = splitOversized('Birinchi gap. '.repeat(40).trim(), 100);
  assert.ok(sentences.every(p => p.length <= 100));
  const words = splitOversized('so\'z '.repeat(500).trim(), 200);
  assert.ok(words.every(p => p.length <= 200));
  assert.deepStrictEqual(splitOversized('x'.repeat(10000), 3200).map(p => p.length), [3200, 3200, 3200, 400]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
