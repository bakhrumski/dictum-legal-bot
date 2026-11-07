'use strict';

/**
 * Lex.uz reads and memory (2026-10-24): after #477's queries began finding
 * acts, one question's 22 searches read 63 pages (~60 MB of HTML) in
 * parallel; measured locally the process went from 57 to 515 MB, the Render
 * instance has 512 MB, and the answer never came (the ledger stopped after
 * retrieval_plan). Now: at most LEX_FETCH_CONCURRENCY (2; 1 since 2026-10-26,
 * when one 8 MB decree page took the instance down again) pages are read at
 * once, a page over LEX_PAGE_MAX_KB (7 MB; 2 MB for a plain search result) is
 * not read, the cache keeps the text and not the page's HTML, and one round
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
  await test('one page is read at a time by default (two with LEX_FETCH_CONCURRENCY=2), across every search running together', async () => {
    const { mod, stats } = liveSearch();
    const urls = Array.from({ length: 8 }, (_, i) => `https://lex.uz/docs/-${i + 1}`);
    const out = await Promise.all(urls.map(u => mod.searchLexUz('pudratchi avans', { pinnedDocs: [pin(u)], maxDocs: 1, scoreText: 'pudratchi avans' })));
    assert.strictEqual(stats.reads.length, 8);
    assert.strictEqual(stats.max, 1);
    assert.ok(out.every(r => r.length === 1), 'every search still gets its page');
    process.env.LEX_FETCH_CONCURRENCY = '2';
    const two = liveSearch();
    await Promise.all(urls.map(u => two.mod.searchLexUz('pudratchi avans', { pinnedDocs: [pin(u)], maxDocs: 1, scoreText: 'pudratchi avans' })));
    assert.strictEqual(two.stats.max, 2);
    delete process.env.LEX_FETCH_CONCURRENCY;
  });

  await test('a page over the size limit is not read: 7 MB for a code, law, registry or pinned act, 2 MB for any other search result', async () => {
    const seen = [];
    const fl = require.resolve('../src/rag/fetch-lex');
    const lsPath = require.resolve('../src/rag/lex-live-search');
    delete require.cache[lsPath];
    require.cache[fl] = { id: fl, filename: fl, loaded: true, exports: {
      httpGet: async () => '<table><tbody><tr><td><a href="/docs/-77">Pudrat avans qaror</a></td></tr></tbody></table>',
      fetchLexDocument: async (url, opts) => { seen.push([url, opts && opts.maxBytes]); return { title: TITLE, body: BODY, metadata: { source_url: url, is_active: true } }; },
    } };
    const mod = require(lsPath);
    await mod.searchLexUz('pudratchi avans', { pinnedDocs: [pin('https://lex.uz/docs/-1')], maxDocs: 1, scoreText: 'pudratchi avans' });
    await mod.searchLexUz('pudratchi avans', { maxDocs: 1, scoreText: 'pudratchi avans' });
    await mod.searchLexUz('pudrat avans qaror', { actForm: 'code', maxDocs: 1, scoreText: 'pudratchi avans' });
    assert.deepStrictEqual(seen.map(s => s[1]), [7000 * 1024, 2000 * 1024], 'pinned 7 MB, plain search 2 MB (the code search found the cached page)');
    mod.clearLexDocumentCache();
    await mod.searchLexUz('pudrat avans qaror', { actForm: 'code', maxDocs: 1, scoreText: 'pudratchi avans' });
    assert.strictEqual(seen[seen.length - 1][1], 7000 * 1024, 'a code search: 7 MB');
    delete require.cache[fl]; delete require.cache[lsPath];
  });

  await test('httpGet stops a page over maxBytes - by its Content-Length or while it streams; no limit when 0', async () => {
    const http = require('http');
    const big = 'x'.repeat(300 * 1024);
    const server = http.createServer((req, res) => {
      if (req.url === '/declared') { res.writeHead(200, { 'Content-Length': Buffer.byteLength(big) }); res.end(big); return; }
      res.writeHead(200); res.write(big.slice(0, 150000)); setTimeout(() => res.end(big.slice(150000)), 20);
    });
    await new Promise(r => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const { httpGet } = require('../src/rag/fetch-lex');
    await assert.rejects(httpGet(`${base}/declared`, 5, null, 100 * 1024), (e) => e.code === 'PAGE_TOO_LARGE');
    await assert.rejects(httpGet(`${base}/streamed`, 5, null, 100 * 1024), (e) => e.code === 'PAGE_TOO_LARGE');
    assert.strictEqual((await httpGet(`${base}/streamed`, 5, null, 0)).length, big.length);
    server.close();
  });

  await test('the cache holds at most LEX_DOCUMENT_CACHE_MAX_CHARS of act text; the oldest leave first', async () => {
    process.env.LEX_DOCUMENT_CACHE_MAX_CHARS = '600000';
    const fl = require.resolve('../src/rag/fetch-lex');
    const lsPath = require.resolve('../src/rag/lex-live-search');
    delete require.cache[lsPath];
    require.cache[fl] = { id: fl, filename: fl, loaded: true, exports: {
      httpGet: async () => '',
      fetchLexDocument: async (url) => ({ title: TITLE, body: 'a'.repeat(250000), metadata: {} }),
    } };
    const mod = require(lsPath);
    for (const n of [1, 2, 3]) await mod.fetchCachedLexDocument(`https://lex.uz/docs/-${n}`);
    assert.ok(!mod.isLexDocumentCached('https://lex.uz/docs/-1'), 'the oldest left');
    assert.ok(mod.isLexDocumentCached('https://lex.uz/docs/-2') && mod.isLexDocumentCached('https://lex.uz/docs/-3'));
    delete process.env.LEX_DOCUMENT_CACHE_MAX_CHARS;
    delete require.cache[fl]; delete require.cache[lsPath];
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
