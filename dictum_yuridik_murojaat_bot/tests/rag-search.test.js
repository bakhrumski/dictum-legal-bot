#!/usr/bin/env node
'use strict';

const {
  buildKeywordArtifacts,
  isHighConfidenceKeywordMatch,
  mergePrioritizedResults,
  normalizeUzbekForSearch,
} = require('../src/rag/search-utils');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok ${name}`);
  } catch (err) {
    failed++;
    console.log(`  not ok ${name}`);
    console.log(`     ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'assertion failed');
  }
}

console.log('\nRAG keyword search regression tests');

test('normalizeUzbekForSearch strips Uzbek apostrophe variants inside words', () => {
  const normalized = normalizeUzbekForSearch("Ma\u02BBmuriy yo\u2019qotgan");
  assert(normalized === 'mamuriy yoqotgan', `unexpected normalized value: ${normalized}`);
});

test('buildKeywordArtifacts keeps a canonical phrase for advokat stajyorining', () => {
  const artifacts = buildKeywordArtifacts('Advokat stajyorining huquqiy maqomi?');
  assert(
    artifacts.phrases.includes('advokat stajyori'),
    `expected phrase list to contain "advokat stajyori", got: ${artifacts.phrases.join(', ')}`
  );
});

test('buildKeywordArtifacts emits prefix tsquery terms for Uzbek inflections', () => {
  const artifacts = buildKeywordArtifacts('Advokat stajyorining huquqiy maqomi?');
  assert(artifacts.tsQuery.includes('advokat:*'), `missing advokat:* in ${artifacts.tsQuery}`);
  assert(artifacts.tsQuery.includes('stajyor:*'), `missing stajyor:* in ${artifacts.tsQuery}`);
});

test('isHighConfidenceKeywordMatch accepts strong core-term hits', () => {
  assert(
    isHighConfidenceKeywordMatch({
      exact_phrase_match: false,
      core_term_match: true,
      keyword_term_hits: 2,
      keyword_score: 0.03,
    }) === true,
    'expected high-confidence keyword match for core-term hit'
  );
});

test('mergePrioritizedResults keeps guaranteed keyword matches inside top 3', () => {
  const prioritized = [
    { id: 99, score: 0.9, keyword_score: 0.4 },
  ];
  const ranked = [
    { id: 1, score: 0.8 },
    { id: 2, score: 0.7 },
    { id: 99, score: 0.3 },
    { id: 3, score: 0.6 },
  ];
  const merged = mergePrioritizedResults(prioritized, ranked, 3);

  assert(merged.length === 3, `expected 3 rows, got ${merged.length}`);
  assert(merged[0].id === 99, `expected guaranteed keyword row first, got ${merged[0].id}`);
  assert(merged.slice(0, 3).some((row) => row.id === 99), 'keyword row missing from top 3');
});

console.log(`\nPassed: ${passed}`);
if (failed > 0) {
  console.log(`Failed: ${failed}`);
  process.exit(1);
}
