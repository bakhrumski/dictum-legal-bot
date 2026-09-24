'use strict';

// A lawyer-verified answer must be stored with an embedding, or the vector
// lookups that serve verified answers never see it. insertVerifiedAnswer()
// called an undefined getApiKey(); the ReferenceError was caught as
// "Embedding skipped" and every new verified answer went in without a vector.

const assert = require('assert');
const path = require('path');

// Stand-ins for the database and the embedding provider, installed in the
// require cache before legal-corpus.js loads them.
const queries = [];
const fakePool = {
  async query(sql, params) {
    queries.push({ sql: String(sql), params });
    return { rows: [], rowCount: 0 };
  },
};
let provider = 'huggingface';
const embedCalls = [];
const fakeEmbeddings = {
  detectProvider: () => provider,
  getEmbedDims: () => 3,
  getEmbedding: async (text, key) => { embedCalls.push({ text, key }); return [0.1, 0.2, 0.3]; },
  getEmbeddingsBatch: async (texts) => texts.map(() => [0.1, 0.2, 0.3]),
  getEmbeddingHealth: () => ({}),
};
function stub(rel, exports) {
  const file = require.resolve(path.join(__dirname, '..', 'src', rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
stub('database/db.js', { pool: fakePool });
stub('rag/embeddings.js', fakeEmbeddings);

const corpus = require('../src/rag/legal-corpus');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); }
}
const inserts = () => queries.filter((q) => /INSERT INTO legal_chunks/.test(q.sql) && /verified_qa/.test(q.sql));

(async () => {
  console.log('\nrag — verified answers are stored with a vector\n');

  await test('with an embedding provider, the verified answer is inserted with its vector', async () => {
    queries.length = 0; embedCalls.length = 0; provider = 'huggingface';
    await corpus.insertVerifiedAnswer({ question: 'Aliment qancha?', answer: 'Oila kodeksi 99-modda...', category: 'oila', requestId: 7, verifiedBy: 1, verifiedByName: 'Yurist' });
    assert.strictEqual(embedCalls.length, 1, 'getEmbedding was not called');
    assert.match(embedCalls[0].text, /^Savol: Aliment qancha\?/);
    const ins = inserts();
    assert.strictEqual(ins.length, 1);
    assert.match(ins[0].sql, /\$5::vector/, 'inserted without the embedding column');
    assert.strictEqual(ins[0].params[4], '[0.1,0.2,0.3]');
  });

  await test('with no provider configured, it is still saved, without a vector', async () => {
    queries.length = 0; embedCalls.length = 0; provider = null;
    await corpus.insertVerifiedAnswer({ question: 'Q', answer: 'A', requestId: 8 });
    assert.strictEqual(embedCalls.length, 0);
    const ins = inserts();
    assert.strictEqual(ins.length, 1);
    assert.ok(!/::vector/.test(ins[0].sql));
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
})();
