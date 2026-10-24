'use strict';

/**
 * Lex.uz reads and memory (2026-10-24): after #477's queries began finding
 * acts, one question's 22 searches read 63 pages (~60 MB of HTML) in
 * parallel; measured locally the process went from 57 to 515 MB, the Render
 * instance has 512 MB, and the answer never came (the ledger stopped after
 * retrieval_plan). Now: at most LEX_FETCH_CONCURRENCY (2) pages are read at
 * once, the cache keeps the text and not the page's HTML, and one round
 * reads at most LEX_ROUND_MAX_READS (48) pages not cached yet. Measured on
 * the same question: 233 MB peak with --max-old-space-size=320, 16
 * documents kept. Lex.uz is stubbed - no network.
 *
 *   node tests/lex-memory.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const TITLE = 'Fuqarolik kodeksi';
const BODY = "Pudratchi avans to'lovini qaytarishi shart. Buyurtmachi shartnomani bajarishdan voz kechishga haqli.";

function liveSearch({ delayMs = 30 } = {}) {
  const stats = { now: 0, max: 0, reads: [] };
  const fl = require.resolve('../src/rag/fetch-lex');
  const ls = require.resolve('../src/rag/lex-live-search');
  delete require.cache[ls];
  require.cache[fl] = { id: fl, filename: fl, loaded: true, exports: {
    httpGet: async () => '<html><body></body></html>',
    fetchLexDocument: async (url) => {
      stats.now++; stats.max = Math.max(stats.max, stats.now); stats.reads.push(url);
      await new Promise(r => setTimeout(r, delayMs));
      stats.now--;
      return { title: TITLE, body: BODY, metadata: { source_url: url, is_active: true }, rawHtml: 'x'.repeat(1000000) };
    },
  } };
  return { mod: require(ls), stats };
}
const pin = (url) => ({ url, expectedTitle: TITLE });

(async () => {
  await test('at most two pages are read at once, across every search running together', async () => {
    const { mod, stats } = liveSearch();
    const urls = Array.from({ length: 8 }, (_, i) => `https://lex.uz/docs/-${i + 1}`);
    const out = await Promise.all(urls.map(u => mod.searchLexUz('pudratchi avans', { pinnedDocs: [pin(u)], maxDocs: 1, scoreText: 'pudratchi avans' })));
    assert.strictEqual(stats.reads.length, 8);
    assert.strictEqual(stats.max, 2);
    assert.ok(out.every(r => r.length === 1), 'every search still gets its page');
  });

  await test("the cache keeps the act's text, not its page HTML", async () => {
    const { mod } = liveSearch({ delayMs: 1 });
    const doc = await mod.fetchCachedLexDocument('https://lex.uz/docs/-9');
    assert.deepStrictEqual(Object.keys(doc).sort(), ['body', 'metadata', 'title']);
    assert.ok(mod.isLexDocumentCached('https://lex.uz/docs/-9'));
  });

  await test('one round reads at most its budget of uncached pages; cached ones are free', async () => {
    const { mod, stats } = liveSearch({ delayMs: 1 });
    await mod.fetchCachedLexDocument('https://lex.uz/docs/-1');
    const budget = { left: 2 };
    const out = await mod.searchLexUz('pudratchi avans', { pinnedDocs: ['-1', '-2', '-3', '-4'].map(n => pin(`https://lex.uz/docs/${n}`)), maxDocs: 4, scoreText: 'pudratchi avans', readBudget: budget });
    assert.deepStrictEqual(out.map(r => r.url), ['https://lex.uz/docs/-1', 'https://lex.uz/docs/-2', 'https://lex.uz/docs/-3']);
    assert.strictEqual(budget.left, 0);
    assert.strictEqual(stats.reads.length, 3, 'the cached page was not read again, the fourth not at all');
  });

  await test('the answer pipeline gives each lex.uz round one shared read budget', () => {
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.match(server, /Number\(process\.env\.LEX_ROUND_MAX_READS\) \|\| 48/u);
    assert.match(server, /const runLexSteps = \(steps, deadline = lexDeadline\(\), readBudget = roundReads\(\)\) =>/u);
    assert.match(server, /deadline,\n\s+readBudget,/u);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
  process.exit(0);
})();
