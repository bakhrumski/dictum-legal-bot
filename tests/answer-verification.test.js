#!/usr/bin/env node
/**
 * answer-verification.js — unit tests (no DB, no network)
 *
 * Tests the pure / synchronous parts only:
 *   - extractDocReferences()  — Latin + Cyrillic extraction, no false positives
 *   - normalizeDecreeNumber() — prefix mapping
 *   - normalizeCorpusNumber() — Cyrillic raw string → canonical key
 *   - applyVerificationNotice() — warning block shape for each status type
 *   - verifyAnswer()           — corpus lookup paths with a fake pool/index
 *
 * Run:  node tests/answer-verification.test.js
 */

'use strict';

process.env.ANSWER_VERIFICATION_LIVE_FETCH = 'false';
process.env.LOG_LEVEL = 'error'; // silence structured logger during tests

const {
  extractDocReferences,
  normalizeDecreeNumber,
  normalizeCorpusNumber,
  applyVerificationNotice,
  verifyAnswer,
  invalidateCorpusIndex,
} = require('../src/rag/answer-verification');

// ─── Harness ─────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
  }
}

function section(label) {
  console.log(`\n━━━ ${label} ━━━`);
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEq'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'expected truthy');
}

function assertMatch(text, pattern, msg) {
  if (!pattern.test(text)) {
    throw new Error(`${msg || 'assertMatch'}: pattern ${pattern} did not match "${text}"`);
  }
}

function assertNoMatch(text, pattern, msg) {
  if (pattern.test(text)) {
    throw new Error(`${msg || 'assertNoMatch'}: pattern ${pattern} should NOT match "${text}"`);
  }
}

// ─── 1. normalizeDecreeNumber ─────────────────────────────────────────────────
section('1. normalizeDecreeNumber');

test('Latin PQ prefix', () => {
  assertEq(normalizeDecreeNumber('PQ', '3126'), 'PQ-3126');
});

test('Latin PF prefix', () => {
  assertEq(normalizeDecreeNumber('PF', '2230'), 'PF-2230');
});

test('Latin VM prefix', () => {
  assertEq(normalizeDecreeNumber('VM', '758'), 'VM-758');
});

test('Cyrillic ПҚ → PQ', () => {
  assertEq(normalizeDecreeNumber('ПҚ', '3126'), 'PQ-3126');
});

test('Cyrillic ПФ → PF', () => {
  assertEq(normalizeDecreeNumber('ПФ', '100'), 'PF-100');
});

test('Cyrillic ВМ → VM', () => {
  assertEq(normalizeDecreeNumber('ВМ', '200'), 'VM-200');
});

// ─── 2. normalizeCorpusNumber ─────────────────────────────────────────────────
section('2. normalizeCorpusNumber');

test('Cyrillic full form ПҚ-3126-сон → PQ-3126', () => {
  assertEq(normalizeCorpusNumber('ПҚ-3126-сон'), 'PQ-3126');
});

test('Latin with spaces PQ 3126 son → PQ-3126', () => {
  assertEq(normalizeCorpusNumber('PQ 3126 son'), 'PQ-3126');
});

test('Latin compact PQ-3126 → PQ-3126', () => {
  assertEq(normalizeCorpusNumber('PQ-3126'), 'PQ-3126');
});

test('VM-758 stable', () => {
  assertEq(normalizeCorpusNumber('VM-758'), 'VM-758');
});

test('ВМ-758-сон → VM-758', () => {
  assertEq(normalizeCorpusNumber('ВМ-758-сон'), 'VM-758');
});

test('null/empty → empty string', () => {
  assertEq(normalizeCorpusNumber(null), '');
  assertEq(normalizeCorpusNumber(''), '');
});

// ─── 3. extractDocReferences — happy path ────────────────────────────────────
section('3. extractDocReferences — extraction');

test('Latin PQ number extracted', () => {
  const refs = extractDocReferences('PQ-3126 ga ko\'ra ...');
  assertEq(refs.length, 1, 'one ref');
  assertEq(refs[0].kind, 'number');
  assertEq(refs[0].key, 'PQ-3126');
});

test('Cyrillic ПҚ number extracted', () => {
  const refs = extractDocReferences('ПҚ-3126-сон asosida ...');
  assertEq(refs.length, 1, 'one ref');
  assertEq(refs[0].key, 'PQ-3126');
});

test('Multiple distinct numbers', () => {
  const refs = extractDocReferences('PQ-3126 va PF-2230 ga ko\'ra');
  assertEq(refs.length, 2, 'two refs');
  const keys = refs.map(r => r.key);
  assertTrue(keys.includes('PQ-3126'), 'contains PQ-3126');
  assertTrue(keys.includes('PF-2230'), 'contains PF-2230');
});

test('Duplicate number deduped', () => {
  const refs = extractDocReferences('PQ-3126 va PQ-3126 qaror');
  assertEq(refs.length, 1, 'deduped to one');
});

test('lex.uz URL extracted', () => {
  const refs = extractDocReferences('https://lex.uz/docs/12345 ga qarang');
  assertEq(refs.length, 1);
  assertEq(refs[0].kind, 'url');
  assertTrue(refs[0].key.includes('lex.uz/docs/12345'));
});

test('lex.uz URL trailing punctuation stripped', () => {
  const refs = extractDocReferences('(https://lex.uz/docs/12345)');
  assertEq(refs.length, 1);
  assertTrue(!refs[0].key.includes(')'), 'no trailing paren');
});

// ─── 4. extractDocReferences — no false positives ────────────────────────────
section('4. extractDocReferences — false positives');

test('plain article number "12-modda" not extracted', () => {
  const refs = extractDocReferences('Fuqarolik kodeksining 12-moddasiga ko\'ra');
  assertEq(refs.length, 0, 'no refs for article numbers');
});

test('IP address not confused with lex.uz URL', () => {
  const refs = extractDocReferences('server: http://192.168.1.1:3000/api');
  assertEq(refs.length, 0);
});

test('plain 4-digit number not extracted', () => {
  const refs = extractDocReferences('2024-yil 1234 so\'m miqdorda');
  assertEq(refs.length, 0);
});

test('PQ-prefix inside a word not extracted (e.g. "PQ-rated")', () => {
  // "PQ-3126word" — should NOT match because number runs into a letter
  const refs = extractDocReferences('PQ-3126word');
  assertEq(refs.length, 0, 'no match when digit immediately followed by letter');
});

// ─── 5. applyVerificationNotice ──────────────────────────────────────────────
section('5. applyVerificationNotice');

test('no issues — returns answer unchanged', () => {
  const text = 'Javob matni.';
  const v = { hasIssues: false, expired: [], unverified: [] };
  assertEq(applyVerificationNotice(text, v), text);
});

test('null verification — returns answer unchanged', () => {
  const text = 'Javob matni.';
  assertEq(applyVerificationNotice(text, null), text);
});

test('expired_in_corpus appends warning with law name', () => {
  const v = {
    hasIssues: true,
    expired: [{
      raw: 'PQ-3126',
      status: 'expired_in_corpus',
      law_name: 'Raqamli iqtisodiyot to\'g\'risida',
      status_label: "Hujjat kuchini yo'qotgan",
    }],
    unverified: [],
  };
  const result = applyVerificationNotice('Javob.', v);
  assertMatch(result, /PQ-3126/, 'contains reference raw');
  assertMatch(result, /Raqamli iqtisodiyot/, 'contains law name');
  assertMatch(result, /KUCHINI YO'QOTGAN/, 'contains expiry warning');
  assertMatch(result, /Hujjat holati ogohlantirishi/, 'contains section header');
});

test('expired_resolved appends link when resolvedUrl present', () => {
  const v = {
    hasIssues: true,
    expired: [{
      raw: 'PQ-3126',
      status: 'expired_resolved',
      law_name: 'Test qonun',
      resolvedUrl: 'https://lex.uz/docs/9999',
      status_label: "Kuchini yo'qotgan",
    }],
    unverified: [],
  };
  const result = applyVerificationNotice('Javob.', v);
  assertMatch(result, /lex\.uz\/docs\/9999/, 'contains resolved URL');
});

test('not_found_on_lex shows "topilmadi" warning', () => {
  const v = {
    hasIssues: true,
    expired: [],
    unverified: [{
      raw: 'PQ-9999',
      status: 'not_found_on_lex',
    }],
  };
  const result = applyVerificationNotice('Javob.', v);
  assertMatch(result, /topilmadi/, 'contains topilmadi');
  assertMatch(result, /PQ-9999/, 'contains reference raw');
});

test('unverified (fetch_failed) shows manual check notice', () => {
  const v = {
    hasIssues: true,
    expired: [],
    unverified: [{
      raw: 'PQ-1111',
      status: 'unverified',
      reason: 'fetch_failed',
    }],
  };
  const result = applyVerificationNotice('Javob.', v);
  assertMatch(result, /PQ-1111/);
  assertMatch(result, /qo'lda tekshiring/);
});

// ─── 6. verifyAnswer — corpus lookup (offline) ───────────────────────────────
section('6. verifyAnswer — with fake corpus pool');

// Fake pool that simulates a corpus with PQ-100 (active) and PF-200 (expired)
function makePool(rows) {
  return {
    query: async () => ({ rows }),
  };
}

(async () => {
  await testAsync('active doc in corpus → active_in_corpus, no hasIssues', async () => {
    invalidateCorpusIndex();
    const pool = makePool([{
      doc_id: 'pq-100', law_name: 'Test qonun', document_number: 'PQ-100',
      source_url: 'https://lex.uz/docs/100', is_active: true, status_label: null,
    }]);
    const result = await verifyAnswer('PQ-100 ga ko\'ra', { pool, liveFetch: false });
    assertEq(result.expired.length, 0, 'no expired');
    assertEq(result.references.length, 1, 'one ref');
    assertEq(result.references[0].status, 'active_in_corpus');
    assertEq(result.hasIssues, false);
  });

  await testAsync('expired doc in corpus → expired_in_corpus, hasIssues=true', async () => {
    invalidateCorpusIndex();
    const pool = makePool([{
      doc_id: 'pf-200', law_name: 'Eskirgan qonun', document_number: 'PF-200',
      source_url: 'https://lex.uz/docs/200', is_active: false, status_label: "Kuchini yo'qotgan",
    }]);
    const result = await verifyAnswer('PF-200 farmoni asosida', { pool, liveFetch: false });
    assertEq(result.expired.length, 1, 'one expired');
    assertEq(result.references[0].status, 'expired_in_corpus');
    assertEq(result.hasIssues, true);
  });

  await testAsync('unknown number, liveFetch=false → status unverified in references', async () => {
    invalidateCorpusIndex();
    const pool = makePool([]); // empty corpus
    const result = await verifyAnswer('VM-9999 asosida', { pool, liveFetch: false });
    assertEq(result.references.length, 1);
    assertEq(result.references[0].status, 'unverified');
    assertEq(result.references[0].reason, 'live_fetch_disabled');
    // live_fetch_disabled items go in references only, NOT in result.unverified
    // (result.unverified is for Tier 4 not-found / resolve-error cases)
    assertEq(result.unverified.length, 0);
  });

  await testAsync('empty answer → no refs, no issues', async () => {
    invalidateCorpusIndex();
    const pool = makePool([]);
    const result = await verifyAnswer('', { pool });
    assertEq(result.references.length, 0);
    assertEq(result.hasIssues, false);
  });

  await testAsync('answer with no decree refs → no refs', async () => {
    invalidateCorpusIndex();
    const pool = makePool([]);
    const result = await verifyAnswer('Fuqarolik kodeksining 12-moddasiga ko\'ra', { pool });
    assertEq(result.references.length, 0);
  });

  await testAsync('active + expired refs in same answer', async () => {
    invalidateCorpusIndex();
    const pool = makePool([
      { doc_id: 'pq-100', law_name: 'Aktiv qonun', document_number: 'PQ-100', source_url: null, is_active: true, status_label: null },
      { doc_id: 'pf-200', law_name: 'Eskirgan qonun', document_number: 'PF-200', source_url: null, is_active: false, status_label: "Kuchini yo'qotgan" },
    ]);
    const result = await verifyAnswer('PQ-100 va PF-200 ga ko\'ra', { pool, liveFetch: false });
    assertEq(result.references.length, 2, 'two refs');
    assertEq(result.expired.length, 1, 'one expired');
    assertEq(result.unverified.length, 0, 'no unverified');
    assertEq(result.hasIssues, true);
  });

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  if (failed === 0) {
    console.log(`  All ${passed} tests passed.`);
  } else {
    console.log(`  ${passed} passed, ${failed} failed.`);
    failures.forEach(({ name, err }) => {
      console.log(`\n  FAIL: ${name}`);
      console.log(`        ${err.stack || err.message}`);
    });
    process.exit(1);
  }
})();
