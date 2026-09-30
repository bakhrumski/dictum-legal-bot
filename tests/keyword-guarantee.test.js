'use strict';

/**
 * Which keyword hits are forced into the context (eval run 21: an unrelated
 * law's keyword hit held third place in 7 of 43 misses, e.g. Soliq kodeksi
 * 37 for a question on partial rehabilitation).
 *
 *   node tests/keyword-guarantee.test.js
 */

const assert = require('assert');
const { isGuaranteedKeywordMatch, isHighConfidenceKeywordMatch, buildKeywordArtifacts } = require('../src/rag/search-utils');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

const q = "Qaysi holatlarda shaxs qisman reabilitatsiya qilinadi va buning natijasida qanday tovonlar to'lanadi?";
const tokens = buildKeywordArtifacts(q).searchTokens.length;

console.log(`keyword guarantee (question has ${tokens} content words)`);

test('two shared words in a long chunk: accepted before, not guaranteed now', () => {
  const row = { exact_phrase_match: false, core_term_match: true, keyword_term_hits: 2, keyword_score: 0.4, chunk_chars: 3100 };
  assert.strictEqual(isHighConfidenceKeywordMatch(row), true, 'the old rule forced it in');
  assert.strictEqual(isGuaranteedKeywordMatch(row, tokens), false);
});

test("a run of the question's words is guaranteed, at any length", () => {
  assert.strictEqual(isGuaranteedKeywordMatch({ exact_phrase_match: true, keyword_term_hits: 1, chunk_chars: 9000 }, tokens), true);
});

test('most of the question\'s words in an article-sized chunk are guaranteed', () => {
  const need = Math.max(3, Math.ceil(0.6 * tokens));
  const row = { core_term_match: true, keyword_term_hits: need, chunk_chars: 2400 };
  assert.strictEqual(isGuaranteedKeywordMatch(row, tokens), true);
  assert.strictEqual(isGuaranteedKeywordMatch({ ...row, keyword_term_hits: need - 1 }, tokens), false);
});

test('an oversized chunk (above the chunker maximum) needs a run of words', () => {
  const row = { core_term_match: true, keyword_term_hits: tokens, chunk_chars: 7980 };
  assert.strictEqual(isGuaranteedKeywordMatch(row, tokens), false);
});

test('a short question needs at least three words or a run', () => {
  assert.strictEqual(isGuaranteedKeywordMatch({ core_term_match: true, keyword_term_hits: 2, chunk_chars: 500 }, 2), false);
  assert.strictEqual(isGuaranteedKeywordMatch({ core_term_match: true, keyword_term_hits: 3, chunk_chars: 500 }, 3), true);
});

test('without chunk_chars the text length is used', () => {
  const row = { core_term_match: true, keyword_term_hits: 5, chunk_text: 'x'.repeat(6000) };
  assert.strictEqual(isGuaranteedKeywordMatch(row, 5), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
