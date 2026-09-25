'use strict';

/**
 * Article references in questions (Astra audit RAG6 and docs/audit/findings/rag.md):
 * Latin, Cyrillic and Russian forms, suffixes, prim articles; dates and ages
 * are not articles.
 *
 *   node tests/router-article-refs.test.js
 */

const assert = require('assert');
const { extractArticleRefs, routeQuery } = require('../src/rag/router');
const { expandQueryVariants } = require('../src/rag/prim-notation');

const cases = [
  ['Mehnat kodeksi 161-modda', ['161']],
  ["modda 358 bo'yicha", ['358']],
  ['386 modda nima deydi', ['386']],
  ['ст. 386 ГК', ['386']],
  ['статья 1109 ГК', ['1109']],
  ['Статья 12 и статьи 13', ['12', '13']],
  ['Модда 5 ва 6-модда', ['6', '5']],
  ['358¹-modda', ['358¹']],
  ['358 prim 1', ['358¹']],
  ['JK 97-moddasi va 98-moddasining', ['97', '98']],
  ["58 yoshda ishdan bo'shatildi", []],
  ['2026-yil 5-sentabr', []],
];

let passed = 0, failed = 0;
for (const [q, want] of cases) {
  try {
    assert.deepStrictEqual(extractArticleRefs(q).sort(), [...want].sort(), q);
    passed++;
  } catch (e) { console.error(`  ✗ ${q}: got ${JSON.stringify(extractArticleRefs(q))}`); failed++; }
}

try {
  // The query is expanded before routing; the expansion must not split 7¹ into 7 and 1.
  const expanded = expandQueryVariants('7¹-modda');
  assert.deepStrictEqual(routeQuery(expanded).entities, ['7¹'], expanded);
  passed++;
} catch (e) { console.error('  ✗ expanded prim:', e.message); failed++; }

console.log(`  article references: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
