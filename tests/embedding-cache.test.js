'use strict';

/**
 * One chat question is embedded once, not once per retrieval stage
 * (docs/audit BACKLOG "embedding cache"). The OpenAI transport is stubbed
 * at https.request, so the count is of real upstream calls.
 *
 *   node tests/embedding-cache.test.js
 */

const assert = require('assert');
const https = require('https');
const { EventEmitter } = require('events');

for (const k of ['HF_TOKEN', 'GEMINI_API_KEY', 'EMBED_PROVIDER']) delete process.env[k];
process.env.GPT_API_KEY = 'test-key';

let upstream = 0;
let failNext = false;
https.request = (opts, onResponse) => {
  const req = new EventEmitter();
  let body = '';
  req.write = (chunk) => { body += chunk; };
  req.setTimeout = () => req;
  req.destroy = () => {};
  req.end = () => {
    upstream++;
    const fail = failNext; failNext = false;
    setTimeout(() => {
      const res = new EventEmitter();
      res.statusCode = fail ? 500 : 200;
      res.setEncoding = () => {};
      onResponse(res);
      const input = JSON.parse(body).input;
      res.emit('data', Buffer.from(fail ? '{"error":"boom"}' : JSON.stringify({ data: input.map((t, index) => ({ index, embedding: [t.length, 1, 2] })) })));
      res.emit('end');
    }, 5);
  };
  return req;
};

const { getEmbedding, getEmbeddingCacheStats } = require('../src/rag/embeddings');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

(async () => {
  console.log('embedding cache');
  const q = "Ishchi ishdan asossiz bo'shatilgan, nima qilish kerak?";

  await test('the stages of one retrieval (5 embeds of the same question) make one upstream call', async () => {
    upstream = 0;
    const v1 = await getEmbedding(q);          // semantic guarantee
    await getEmbedding(q);                     // unscoped retry
    await Promise.all([getEmbedding(q), getEmbedding(q)]); // parent-child + RRF, concurrently
    const v5 = await getEmbedding(q.replace("'", 'ʻ')); // same question, other apostrophe
    console.log(`      upstream calls: ${upstream} (was 5)`);
    assert.strictEqual(upstream, 1);
    assert.deepStrictEqual(v1, v5);
  });

  await test('a different question is embedded on its own', async () => {
    upstream = 0;
    await getEmbedding('Aliment qancha miqdorda undiriladi?');
    assert.strictEqual(upstream, 1);
  });

  await test('a failure is not cached', async () => {
    upstream = 0;
    failNext = true;
    await assert.rejects(getEmbedding('Soliq imtiyozi kimlarga beriladi?'));
    const v = await getEmbedding('Soliq imtiyozi kimlarga beriladi?');
    assert.ok(Array.isArray(v));
    assert.strictEqual(upstream, 2);
  });

  await test('long texts (ingestion chunks) bypass the cache', async () => {
    upstream = 0;
    const chunk = 'Modda matni. '.repeat(200);
    await getEmbedding(chunk);
    await getEmbedding(chunk);
    assert.strictEqual(upstream, 2);
  });

  await test('the cache is bounded', async () => {
    for (let i = 0; i < 350; i++) await getEmbedding(`savol raqami ${i}`);
    assert.ok(getEmbeddingCacheStats().size <= 300);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
