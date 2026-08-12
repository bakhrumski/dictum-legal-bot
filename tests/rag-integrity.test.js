'use strict';

const assert = require('assert');
const { normalizeLawName, selectRelevantSourceRefs } = require('../src/rag/citation-utils');
const { __test: qaKorpusTest } = require('../src/rag/qa-korpus');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    throw err;
  }
}

const labor154 = {
  law_name: "O'zbekiston Respublikasining Mehnat kodeksi",
  doc_id: 'labor',
  source_url: 'https://lex.uz/uz/docs/6257288',
  article_numbers: ['154'],
  is_active: true,
};
const labor320 = { ...labor154, article_numbers: ['320'] };
const criminalProcedure260 = {
  law_name: "O'zbekiston Respublikasining Jinoyat-protsessual kodeksi",
  doc_id: 'criminal-procedure',
  source_url: 'https://lex.uz/uz/docs/111460',
  article_numbers: ['260'],
  is_active: true,
};

test('normalizes Uzbek apostrophe variants in act names', () => {
  assert.strictEqual(
    normalizeLawName("O'zbekiston Respublikasining Mehnat kodeksi"),
    'ozbekiston respublikasining mehnat kodeksi'
  );
});

test('keeps only law and article pairs actually used by the answer', () => {
  const reply = [
    'Mehnat kodeksi 154-moddasi bo‘yicha ishga tiklanish mumkin.',
    'Mehnat kodeksi 320-moddasi bo‘yicha olinmagan ish haqi qoplanadi.',
  ].join(' ');
  const refs = selectRelevantSourceRefs([labor154, criminalProcedure260, labor320], reply);
  assert.deepStrictEqual(
    refs.map(ref => `${ref.lawName}|${ref.articleRef}`),
    [
      "O'zbekiston Respublikasining Mehnat kodeksi|154",
      "O'zbekiston Respublikasining Mehnat kodeksi|320",
    ]
  );
});

test('does not accept an article number from a different named code', () => {
  const reply = 'Mehnat kodeksi 260-moddasiga ko‘ra xodimga to‘lov qilinadi.';
  assert.deepStrictEqual(selectRelevantSourceRefs([criminalProcedure260], reply), []);
});

test('associates a shared article number with the nearest named act', () => {
  const labor260 = { ...labor154, article_numbers: ['260'] };
  const reply = [
    'Jinoyat-protsessual kodeksi 260-moddasi ehtiyot chorasiga tegishli.',
    'Mehnat kodeksi 260-moddasi esa xodimga oid boshqa tartibni belgilaydi.',
  ].join(' ');
  const refs = selectRelevantSourceRefs([criminalProcedure260, labor260], reply);
  assert.deepStrictEqual(
    refs.map(ref => `${ref.lawName}|${ref.articleRef}`).sort(),
    [
      "O'zbekiston Respublikasining Jinoyat-protsessual kodeksi|260",
      "O'zbekiston Respublikasining Mehnat kodeksi|260",
    ].sort()
  );
});

test('detects a legacy 1536d to active 1024d QA corpus migration', () => {
  assert.strictEqual(qaKorpusTest.shouldMigrateEmbeddingColumn(1536, 1024), true);
  assert.strictEqual(qaKorpusTest.shouldMigrateEmbeddingColumn(1024, 1024), false);
  assert.strictEqual(qaKorpusTest.shouldMigrateEmbeddingColumn(null, 1024), false);
});

console.log(`\nrag-integrity — ${passed} passed, 0 failed\n`);
