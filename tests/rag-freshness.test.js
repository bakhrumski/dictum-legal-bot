'use strict';

// The freshness job must mark a document repealed when lex.uz says so.
// It read fetched.is_active, but fetchLexDocument() puts the status in
// fetched.metadata, so nothing was ever marked and repealed law stayed in
// search.

const assert = require('assert');
const { checkDocument, lexStatus } = require('../src/rag/check-freshness');

const doc = { doc_id: 'pq-3126', law_name: 'PQ-3126', source_url: 'https://lex.uz/docs/1', chunk_count: 12 };
// The shape fetchLexDocument() actually returns (src/rag/fetch-lex.js).
const fetched = (metadata) => ({ title: 'T', body: 'B', rawHtml: '<html>', metadata });

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n      ${e.message}`); }
}

(async () => {
  console.log('\nrag — freshness check reads lex.uz status\n');

  await test('a document lex.uz marks repealed comes back expired, with its label', async () => {
    const r = await checkDocument(doc, async () => fetched({ is_active: false, status_label: "Hujjat kuchini yo'qotgan 20.01.2026" }));
    assert.strictEqual(r.status, 'expired');
    assert.strictEqual(r.status_label, "Hujjat kuchini yo'qotgan 20.01.2026");
    assert.strictEqual(r.chunk_count, 12);
  });

  await test('an in-force document stays active', async () => {
    const r = await checkDocument(doc, async () => fetched({ is_active: true }));
    assert.strictEqual(r.status, 'active');
  });

  await test('a repealed document without a label gets the default one', () => {
    assert.deepStrictEqual(lexStatus(fetched({ is_active: false })), { expired: true, label: "Hujjat kuchini yo'qotgan" });
  });

  await test('a top-level is_active (the old, wrong place) is not trusted', () => {
    assert.strictEqual(lexStatus({ is_active: false, metadata: { is_active: true } }).expired, false);
  });

  await test('a fetch failure is reported, not treated as repealed', async () => {
    const r = await checkDocument(doc, async () => { throw new Error('ETIMEDOUT'); });
    assert.strictEqual(r.status, 'fetch_error');
  });

  await test('no source URL is skipped', async () => {
    const r = await checkDocument({ ...doc, source_url: null }, async () => { throw new Error('should not fetch'); });
    assert.strictEqual(r.status, 'skipped');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
  // check-freshness opens the shared pool on import; let the process exit.
  require('../src/database/db').pool.end().catch(() => {});
})();
