'use strict';

/**
 * DeepSeek V4.1 Flash with thinking (src/ai/deepseek.js): an explicit
 * 'deepseek/deepseek-flash-thinking' id only; the API model is deepseek-flash
 * with thinking enabled at effort high and no temperature; the cap leaves room
 * for reasoning; reasoning text is never the answer; priced as flash.
 * Stub fetch - no network, no cost.
 *
 *   node tests/deepseek-thinking.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ds = require('../src/ai/deepseek');
const pricing = require('../src/ai/model-pricing');
const tm = require('../src/ai/test-model');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const fakeFetch = (data, seen) => async (url, init) => {
  seen.push(JSON.parse(init.body));
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => data, text: async () => JSON.stringify(data) };
};

(async () => {
  const keep = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'sk-test-not-real';
  try {
    await test('body: thinking enabled at effort high, API model deepseek-flash, no temperature; plain flash unchanged', () => {
      const t = ds._internal.buildBody([{ role: 'user', content: 'x' }], { model: 'deepseek-flash-thinking', maxTokens: 20000, temperature: 0.2 });
      assert.deepStrictEqual([t.model, t.thinking.type, t.reasoning_effort, 'temperature' in t, t.max_tokens], ['deepseek-flash', 'enabled', 'high', false, 20000]);
      const p = ds._internal.buildBody([{ role: 'user', content: 'x' }], { model: 'deepseek-flash' });
      assert.deepStrictEqual([p.model, p.thinking.type, 'reasoning_effort' in p, p.temperature], ['deepseek-flash', 'disabled', false, 0.2]);
    });

    await test('id and cap: explicit id only; reasoning room on top of the answer cap, bounded', () => {
      assert.strictEqual(ds.modelFor('deepseek/deepseek-flash-thinking'), 'deepseek-flash-thinking');
      assert.strictEqual(ds.modelFor(null), 'deepseek-flash', 'never the default');
      assert.strictEqual(ds.maxTokensFor(3000), 6000);
      assert.strictEqual(ds.maxTokensFor(3000, 'deepseek-flash-thinking'), 22000);
      assert.strictEqual(ds.maxTokensFor(8192, 'deepseek-flash-thinking'), 32000, 'at most 32 000');
    });

    await test('answer: content only (reasoning_content never shown); the provider label keeps the thinking id', async () => {
      const seen = [];
      const r = await ds.chatCompletion([{ role: 'user', content: 'x' }], { model: 'deepseek-flash-thinking', maxTokens: 22000,
        fetchImpl: fakeFetch({ model: 'deepseek-flash', choices: [{ message: { content: 'Javob.', reasoning_content: 'ICHKI FIKR' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 900, completion_tokens_details: { reasoning_tokens: 850 } } }, seen) });
      assert.deepStrictEqual([r.text, r.provider, r.usage.outTokens, r.usage.reasoningTokens], ['Javob.', 'deepseek/deepseek-flash-thinking', 900, 850]);
      // reasoning only, no answer: an error (the chain falls back), never the reasoning as text
      await assert.rejects(ds.chatCompletion([{ role: 'user', content: 'x' }], { model: 'deepseek-flash-thinking',
        fetchImpl: fakeFetch({ choices: [{ message: { content: '', reasoning_content: 'ICHKI FIKR' }, finish_reason: 'length' }], usage: {} }, []) }), /empty response/u);
    });

    await test('priced as flash (reasoning billed as output); in the master test picker', () => {
      assert.deepStrictEqual(pricing.MODEL_PRICING['deepseek/deepseek-flash-thinking'], pricing.MODEL_PRICING['deepseek/deepseek-flash']);
      assert.ok(Math.abs(pricing.calculateTokenCost('deepseek/deepseek-flash-thinking', { inTokens: 1e6, outTokens: 1e6 }) - 1.5) < 1e-9);
      assert.ok(pricing.callCostBound({ model: 'deepseek/deepseek-flash-thinking', inputTokensMax: 1000, outputTokensMax: 32000 }));
      assert.ok(tm.TEST_MODELS.some(m => m.id === 'deepseek/deepseek-flash-thinking'));
    });

    await test('server and hybrid pipeline size the cap for the model they call', () => {
      const src = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
      assert.ok(/deepseek\.maxTokensFor\(options\.maxTokens \|\| 8192, dsModel\)/u.test(src));
      const hp = fs.readFileSync(path.join(__dirname, '../src/rag/hybrid-pipeline.js'), 'utf8');
      assert.ok(/deepseek\.maxTokensFor\(maxTokens, deepseek\.modelFor\(model\)\)/u.test(hp));
    });
  } finally {
    if (keep == null) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = keep;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
