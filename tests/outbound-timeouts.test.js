'use strict';

/**
 * Every outbound fetch on the request path has a deadline (audit H3), and a
 * hung upstream really is cut off.
 *
 *   node tests/outbound-timeouts.test.js
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

const FILES = ['src/api/server.js', 'src/rag/hybrid-pipeline.js', 'src/ocr/routes.js', 'src/workspace/storage.js', 'src/bot/bot.js'];

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

(async () => {
  console.log('outbound timeouts');

  await test('every fetch( call in the request-path files passes a signal', () => {
    const missing = [];
    for (const f of FILES) {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      const re = /\bfetch\(/g;
      let m;
      while ((m = re.exec(src))) {
        const line = src.slice(0, m.index).split('\n').length;
        const lineText = src.split('\n')[line - 1];
        if (/^\s*(\/\/|\*)/.test(lineText)) continue;
        // The call's own options: up to the matching close of this fetch(.
        let depth = 0, i = m.index + 5, end = i;
        for (; i < src.length; i++) {
          if (src[i] === '(') depth++;
          else if (src[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
        }
        const call = src.slice(m.index, end + 1);
        if (!/signal\s*:/.test(call)) missing.push(`${f}:${line}`);
      }
    }
    assert.deepStrictEqual(missing, [], `fetch without a deadline: ${missing.join(', ')}`);
  });

  await test('the deadlines are configurable and streams get the longer one', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
    assert.ok(/const AI_TIMEOUT_MS = Number\(process\.env\.AI_TIMEOUT_MS\) \|\| 180000;/.test(server));
    assert.ok(/const AI_STREAM_TIMEOUT_MS = Number\(process\.env\.AI_STREAM_TIMEOUT_MS\) \|\| 300000;/.test(server));
    const streamFn = server.slice(server.indexOf('async function callOpenAIStream'), server.indexOf('async function callOpenAIStream') + 4000);
    assert.ok(/AI_STREAM_TIMEOUT_MS/.test(streamFn));
  });

  await test('AbortSignal.timeout cuts off an upstream that never answers', async () => {
    const hang = http.createServer(() => { /* never responds */ });
    await new Promise(r => hang.listen(0, r));
    const t0 = Date.now();
    await assert.rejects(fetch(`http://127.0.0.1:${hang.address().port}/`, { signal: AbortSignal.timeout(150) }), (e) => e.name === 'TimeoutError' || e.name === 'AbortError');
    assert.ok(Date.now() - t0 < 2000);
    hang.closeAllConnections(); hang.close();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
