'use strict';

/**
 * A lex.uz round has a time limit (2026-10-22: a Telegram answer used ~29 s
 * of AI calls and still reached the 120 s request limit before its claim
 * check - 18 parallel searches each read their candidates one by one at up to
 * 60 s a page). One read is waited for at most LEX_FETCH_MAX_MS, no read
 * starts after the round's deadline, and what was found by then is returned.
 * Lex.uz is stubbed - no network.
 *
 *   node tests/lex-deadline.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const TITLE = "Fuqarolik kodeksi";
const BODY = "637-modda. Agar pudratchi ishni shartnomada belgilangan muddatda boshlamasa yoki bajarmasa, buyurtmachi shartnomani bajarishdan voz kechishga haqli. Pudratchi avans.";

// lex-live-search with a stubbed fetch-lex: a page is either served or never answers
function liveSearch(pages, { searchHangs = false } = {}) {
  const fetched = [];
  const fl = require.resolve('../src/rag/fetch-lex');
  const ls = require.resolve('../src/rag/lex-live-search');
  delete require.cache[ls];
  require.cache[fl] = { id: fl, filename: fl, loaded: true, exports: {
    httpGet: async () => (searchHangs ? new Promise(() => {}) : '<html><body></body></html>'),
    fetchLexDocument: async (url) => {
      fetched.push(url);
      const p = pages[url];
      if (p === 'hang') return new Promise(() => {});
      if (!p) throw new Error('404');
      return p;
    },
  } };
  return { mod: require(ls), fetched };
}
const page = (url) => ({ title: TITLE, body: BODY, metadata: { source_url: url, is_active: true, current_version_url: null } });
const pin = (url) => ({ url, expectedTitle: TITLE });
const QUERY = 'pudratchi ishni bajarmadi avans';

(async () => {
  await test('a page that never answers is given up after LEX_FETCH_MAX_MS; the next candidate is still read', async () => {
    process.env.LEX_FETCH_MAX_MS = '200';
    const a = 'https://lex.uz/docs/1', b = 'https://lex.uz/docs/2';
    const { mod, fetched } = liveSearch({ [a]: 'hang', [b]: page(b) });
    const t0 = Date.now();
    const out = await mod.searchLexUz(QUERY, { pinnedDocs: [pin(a), pin(b)], maxDocs: 2 });
    const ms = Date.now() - t0;
    assert.deepStrictEqual(fetched, [a, b]);
    assert.deepStrictEqual(out.map(r => r.url), [b]);
    assert.ok(ms < 1500, `took ${ms} ms`);
    delete process.env.LEX_FETCH_MAX_MS;
  });

  await test('the deadline ends the search: no read starts after it, what was found is returned', async () => {
    const a = 'https://lex.uz/docs/1', b = 'https://lex.uz/docs/2', c = 'https://lex.uz/docs/3';
    const { mod, fetched } = liveSearch({ [a]: page(a), [b]: 'hang', [c]: page(c) });
    const t0 = Date.now();
    const out = await mod.searchLexUz(QUERY, { pinnedDocs: [pin(a), pin(b), pin(c)], maxDocs: 3, deadline: Date.now() + 300 });
    const ms = Date.now() - t0;
    assert.deepStrictEqual(out.map(r => r.url), [a], 'the page read before the deadline is kept');
    assert.ok(!fetched.includes(c), 'nothing is read after the deadline');
    assert.ok(ms < 1500, `took ${ms} ms`);
  });

  await test('a search page that never answers is given up at the deadline; a passed deadline reads nothing', async () => {
    const { mod, fetched } = liveSearch({}, { searchHangs: true });
    const t0 = Date.now();
    assert.deepStrictEqual(await mod.searchLexUz(QUERY, { deadline: Date.now() + 200 }), []);
    assert.ok(Date.now() - t0 < 1500);
    const a = 'https://lex.uz/docs/1';
    const again = liveSearch({ [a]: page(a) });
    assert.deepStrictEqual(await again.mod.searchLexUz(QUERY, { pinnedDocs: [pin(a)], deadline: Date.now() - 1 }), []);
    assert.deepStrictEqual(again.fetched, []);
    assert.deepStrictEqual(fetched, []);
  });

  await test('no deadline given: the search runs as before (other callers unchanged)', async () => {
    const a = 'https://lex.uz/docs/1';
    const { mod } = liveSearch({ [a]: page(a) });
    const out = await mod.searchLexUz(QUERY, { pinnedDocs: [pin(a)], maxDocs: 1 });
    assert.deepStrictEqual(out.map(r => r.url), [a]);
  });

  await test('the answer pipeline gives every lex.uz round a deadline that keeps time for the answer and its checks', () => {
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.match(server, /process\.env\.LEX_ANSWER_RESERVE_MS\) \|\| 60000/u);
    assert.match(server, /Number\(process\.env\.LEX_LIVE_MAX_MS\) > 0 \? Number\(process\.env\.LEX_LIVE_MAX_MS\) : Infinity/u, 'no cap of its own by default');
    assert.match(server, /const runLexSteps = \(steps, deadline = lexDeadline\(\)\) =>/u);
    assert.match(server, /searchLexUz\(step\.query, \{\n\s+deadline,/u);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
  process.exit(0);
})();
