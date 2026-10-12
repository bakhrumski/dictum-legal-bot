'use strict';

/**
 * GLM (Z.AI) as an opt-in provider (src/ai/zai.js) and the legal opinion's
 * second model - stub providers only, no network, no cost.
 *
 *   node tests/zai.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zai = require('../src/ai/zai');
const modelPricing = require('../src/ai/model-pricing');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const KEY = 'zai-test-key-not-real-123456';
const msgs = [{ role: 'system', text: 'Tizim.' }, { role: 'user', text: 'Savol.' }];
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const okBody = (extra = {}) => ({ id: 'x', model: 'glm-5.3-flash', choices: [{ message: { content: 'Javob.', reasoning_content: 'ichki fikr' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 200 } }, ...extra });
const withKey = async (fn) => {
  const keep = process.env.ZAI_API_KEY;
  process.env.ZAI_API_KEY = KEY;
  try { return await fn(); } finally { if (keep == null) delete process.env.ZAI_API_KEY; else process.env.ZAI_API_KEY = keep; }
};
const sse = lines => ({ ok: true, status: 200, headers: { get: () => null }, body: (async function* () { for (const l of lines) yield Buffer.from(`data: ${JSON.stringify(l)}\n\n`); })() });

(async () => {
  await test('routing: only an explicit zai/ id with the key; never a lane, an OpenAI or a DeepSeek id', async () => {
    await withKey(async () => {
      assert.strictEqual(zai.routes('zai/glm-5.3-flash'), true);
      for (const id of ['cheap', 'premium', 'gpt-6-luna', 'openai/gpt-6-sol', 'deepseek/deepseek-flash', 'glm-5.3-flash']) assert.strictEqual(zai.routes(id), false, id);
    });
    const keep = process.env.ZAI_API_KEY; delete process.env.ZAI_API_KEY;
    assert.strictEqual(zai.routes('zai/glm-5.3-flash'), false, 'no key: not routed');
    if (keep != null) process.env.ZAI_API_KEY = keep;
    assert.strictEqual(zai.modelFor('zai/glm-9'), 'glm-5.3-flash', 'an unlisted id is never sent as is');
    assert.strictEqual(zai.maxTokensFor(7000), 14000);
    assert.strictEqual(zai.maxTokensFor(9000), 16000, 'capped');
  });

  await test('a call: the documented body (thinking on, reasoning_effort low), usage parsed, reasoning text never the answer', async () => {
    let sent = null;
    const r = await withKey(() => zai.chatCompletion(msgs, { maxTokens: 6000, fetchImpl: async (u, init) => { sent = { url: u, body: JSON.parse(init.body), auth: init.headers.Authorization }; return resp(200, okBody()); } }));
    assert.strictEqual(sent.url, 'https://api.z.ai/api/paas/v4/chat/completions');
    assert.deepStrictEqual([sent.body.model, sent.body.thinking, sent.body.reasoning_effort, sent.body.max_tokens], ['glm-5.3-flash', { type: 'enabled' }, 'low', 6000]);
    assert.ok(!('temperature' in sent.body));
    assert.deepStrictEqual(sent.body.messages.map(m => m.role), ['system', 'user']);
    assert.strictEqual(sent.auth, `Bearer ${KEY}`);
    assert.deepStrictEqual([r.text, r.provider, r.truncated], ['Javob.', 'zai/glm-5.3-flash', false]);
    assert.deepStrictEqual([r.usage.inTokens, r.usage.outTokens, r.usage.cachedTokens], [1000, 300, 200]);
  });

  await test('refusal (finish_reason sensitive), an empty answer and an HTTP error throw - the chain goes on; the key never appears in an error', async () => {
    await withKey(async () => {
      await assert.rejects(zai.chatCompletion(msgs, { fetchImpl: async () => resp(200, okBody({ choices: [{ message: { content: 'qisman' }, finish_reason: 'sensitive' }] })) }), e => e.code === 'REFUSED');
      await assert.rejects(zai.chatCompletion(msgs, { fetchImpl: async () => resp(200, okBody({ choices: [{ message: { content: '', reasoning_content: 'faqat fikr' }, finish_reason: 'length' }] })) }), e => e.code === 'EMPTY_RESPONSE');
      await assert.rejects(zai.chatCompletion(msgs, { fetchImpl: async () => resp(429, { error: { code: '1113', message: `balance; key ${KEY}` } }) }), e => e.status === 429 && !e.message.includes(KEY));
    });
  });

  await test('stream: content deltas only (reasoning deltas dropped), usage from the last chunk, a refusal after text is a broken stream', async () => {
    const shown = [];
    const r = await withKey(() => zai.chatCompletionStream(msgs, { fetchImpl: async () => sse([
      { model: 'glm-5.3-flash', choices: [{ delta: { reasoning_content: 'fikr' } }] },
      { choices: [{ delta: { content: 'Ja' } }] },
      { choices: [{ delta: { content: 'vob.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    ]) }, p => shown.push(p)));
    assert.deepStrictEqual([r.text, shown.join(''), r.usage.outTokens], ['Javob.', 'Javob.', 5]);
    await assert.rejects(withKey(() => zai.chatCompletionStream(msgs, { fetchImpl: async () => sse([
      { choices: [{ delta: { content: 'Qism' } }] }, { choices: [{ delta: {}, finish_reason: 'sensitive' }] },
    ]) }, () => {})), e => e.code === 'REFUSED' && e.partialStream === true);
  });

  await test('priced from the official list; the server tries GLM first only for its own ids, then DeepSeek and GPT-6', async () => {
    assert.deepStrictEqual({ ...modelPricing.MODEL_PRICING['zai/glm-5.3-flash'] }, { in: 0.15, out: 0.50, cached: 0.03 });
    assert.ok(modelPricing.callCostBound({ model: 'zai/glm-5.3-flash', inputTokensMax: 1000, outputTokensMax: 1000 }).usd > 0);
    const src = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    for (const fn of ['callOpenAI', 'callOpenAIStream']) {
      const body = src.slice(src.indexOf(`async function ${fn}(`), src.indexOf(`async function ${fn}(`) + 900);
      assert.ok(body.indexOf('tryZai(') > 0 && body.indexOf('tryZai(') < body.indexOf('tryDeepSeek('), `${fn}: GLM before DeepSeek`);
    }
    assert.ok(/if \(!zai\.routes\(requestedModel\)\) return null;/u.test(src), 'only an explicit id');
    assert.ok(/if \(\/\^\(deepseek\|zai\)\\\/\/i\.test\(m\)\) return MODELS\[options\.lane\]/u.test(src), 'a zai/ id falls back to the lane GPT-6, never sent to OpenAI as is');
  });

  await test('legal opinion: OPINION_FALLBACK_MODEL is tried after the paid model fails, before the last resort; Sinov fails over to the cheap lane, not Sol', async () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    const chain = src.slice(src.indexOf('async function callPremiumAIChain('), src.indexOf('async function callAI('));
    assert.ok(chain.indexOf('options.fallbackModel') > chain.indexOf('premiumRetries') && chain.indexOf('options.fallbackModel') < chain.indexOf('callGeminiLastResort('));
    assert.ok(/const opinionFallback = String\(process\.env\.OPINION_FALLBACK_MODEL \|\| ''\)\.trim\(\) \|\| null;/u.test(src));
    assert.ok(/if \(planKey === 'sinov'\) opinionLane = 'cheap';/u.test(src));
    assert.strictEqual((src.match(/lane: opinionLane, fallbackModel: opinionLane === 'cheap' \? null : opinionFallback/gu) || []).length, 2, 'the opinion and its citation fix');
    assert.ok(/process\.env\['OPINION_MODEL_' \+ planKey\.toUpperCase\(\)\]/u.test(src), 'OPINION_MODEL_SINOV picks the Sinov model');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
