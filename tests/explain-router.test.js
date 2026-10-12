'use strict';

/**
 * The document-explanation model routing (src/ai/explain-router.js,
 * src/ai/deepseek.js) - stub providers only, no network, no cost.
 *
 *   node tests/explain-router.test.js
 */

const assert = require('assert');
const { routing, createExplainAI } = require('../src/ai/explain-router');
const deepseek = require('../src/ai/deepseek');
const modelPricing = require('../src/ai/model-pricing');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const KEY = 'sk-test-deepseek-not-real-123456';
const msgs = [{ role: 'system', text: 'Tizim.' }, { role: 'user', text: 'Hujjat matni.' }];
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const okBody = (extra = {}) => ({ id: 'x', model: 'deepseek-flash', choices: [{ message: { content: 'Izoh.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_cache_hit_tokens: 400, prompt_cache_miss_tokens: 600 }, ...extra });
const withEnv = async (env, fn) => {
  const keep = {};
  for (const k of Object.keys(env)) { keep[k] = process.env[k]; if (env[k] == null) delete process.env[k]; else process.env[k] = env[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(keep)) { if (keep[k] == null) delete process.env[k]; else process.env[k] = keep[k]; } }
};
const fakeLedger = () => {
  const tracked = [];
  return { tracked, withChain: fn => fn(), track: async (meta, fn) => { const usage = {}; tracked.push({ meta, usage }); return fn({ usage: u => Object.assign(usage, u), retry: async () => {} }); } };
};

(async () => {
  await test('routing: DeepSeek with a 6 000 cap when its key is set; GPT-6 Luna (explicit OpenAI) at 8 000 as fallback; EXPLAIN_PROVIDER=default restores the old lane', async () => {
    assert.deepStrictEqual(routing({ DEEPSEEK_API_KEY: KEY }), { provider: 'deepseek', deepseekMaxTokens: 6000, fallbackModel: 'openai/gpt-6-luna', fallbackMaxTokens: 8000 });
    assert.strictEqual(routing({}).provider, 'default', 'no key: the old route');
    assert.strictEqual(routing({ DEEPSEEK_API_KEY: KEY, EXPLAIN_PROVIDER: 'default' }).provider, 'default');
    assert.strictEqual(routing({ EXPLAIN_PROVIDER: 'deepseek' }).provider, 'default', 'asked for DeepSeek with no key: not called');
    assert.strictEqual(routing({ DEEPSEEK_API_KEY: KEY, EXPLAIN_DEEPSEEK_MAX_TOKENS: '8000' }).deepseekMaxTokens, 8000);
  });

  await test('the DeepSeek request: fixed URL, its own key, no redirect, thinking disabled, the cap sent; usage without double counting; length = truncated', async () => {
    await withEnv({ DEEPSEEK_API_KEY: KEY }, async () => {
      let seen = null;
      const usage = {};
      const r = await deepseek.chatCompletion(msgs, { maxTokens: 6000, call: { usage: u => Object.assign(usage, u) }, fetchImpl: async (u, init) => { seen = { u, init, body: JSON.parse(init.body) }; return resp(200, okBody()); } });
      assert.strictEqual(seen.u, 'https://api.deepseek.com/chat/completions');
      assert.strictEqual(seen.init.redirect, 'error');
      assert.strictEqual(seen.init.headers.Authorization, `Bearer ${KEY}`);
      assert.deepStrictEqual([seen.body.model, seen.body.thinking, seen.body.max_tokens, seen.body.temperature], ['deepseek-flash', { type: 'disabled' }, 6000, 0.2]);
      assert.deepStrictEqual(seen.body.messages.map(m => [m.role, m.content]), [['system', 'Tizim.'], ['user', 'Hujjat matni.']]);
      assert.deepStrictEqual([r.text, r.truncated, r.provider], ['Izoh.', false, 'deepseek/deepseek-flash']);
      assert.deepStrictEqual([usage.inTokens, usage.cachedTokens, usage.outTokens, usage.finishReason, usage.modelReturned], [1000, 400, 200, 'stop', 'deepseek-flash']);
      const cut = await deepseek.chatCompletion(msgs, { fetchImpl: async () => resp(200, okBody({ choices: [{ message: { content: 'yarim' }, finish_reason: 'length' }] })) });
      assert.strictEqual(cut.truncated, true);
      await assert.rejects(deepseek.chatCompletion(msgs, { fetchImpl: async () => resp(200, okBody({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] })) }), /empty response/u);
      const e = await deepseek.chatCompletion(msgs, { fetchImpl: async () => resp(402, { error: { message: `Insufficient Balance ${KEY}`, type: 'invalid_request_error' } }) }).catch(x => x);
      assert.ok(e.status === 402 && !String(e.message).includes(KEY), 'the key never in an error');
    });
    await withEnv({ DEEPSEEK_API_KEY: null }, () => assert.rejects(deepseek.chatCompletion(msgs, { fetchImpl: async () => { throw new Error('must not be called'); } }), /DEEPSEEK_API_KEY/u));
  });

  await test('the price: peak rates from the official page, cached input at its rate; a bound exists so the request budget sees the call first', () => {
    const cost = modelPricing.calculateTokenCost('deepseek/deepseek-flash', { inTokens: 1000, cachedTokens: 400, outTokens: 200 });
    assert.ok(Math.abs(cost - (600 * 0.30 + 400 * 0.006 + 200 * 1.20) / 1e6) < 1e-12);
    const b = modelPricing.callCostBound({ model: 'deepseek/deepseek-flash', inputTokensMax: modelPricing.inputTokenBound(msgs), outputTokensMax: 6000 });
    assert.ok(b.usd > 0 && b.basis.priceSource.includes('api-docs.deepseek.com'));
  });

  const deps = (over = {}) => {
    const calls = [];
    const ledger = fakeLedger();
    return { calls, ledger, router: createExplainAI({
      usageLedger: ledger, modelPricing, log: { warn: () => {} },
      deepseek: { chatCompletion: async (m, o) => { calls.push(['deepseek', o.maxTokens]); if (over.deepseek) return over.deepseek(); o.call.usage({ inTokens: 10, outTokens: 5 }); return { text: 'DS', provider: 'deepseek/deepseek-flash' }; } },
      callOpenAI: async (m, o) => { calls.push(['openai', o.model, o.maxTokens, o.lane, o.useSearch]); if (over.openai) return over.openai(); return { text: 'LUNA', provider: 'gpt-6-luna' }; },
      paidAllowed: async () => (over.paid == null ? true : over.paid),
      spendAllowed: async () => (over.spend == null ? true : over.spend),
      lastResort: async () => { calls.push(['last']); return { text: 'GEMINI', provider: 'gemini' }; },
      callDefault: async () => { calls.push(['default']); return { text: 'OLD', provider: 'cheap' }; },
    }) };
  };

  await test('the chain: DeepSeek first (one ledger row with a bound), then GPT-6 Luna, then the last resort; EXPLAIN_PROVIDER=default keeps the old lane; the daily ceiling skips the paid models', async () => {
    await withEnv({ DEEPSEEK_API_KEY: KEY, EXPLAIN_PROVIDER: null }, async () => {
      let d = deps();
      let r = await d.router(msgs, { maxTokens: 3000, endpoint: '/api/draft/explain-document', userId: 7 });
      assert.strictEqual(r.text, 'DS');
      assert.deepStrictEqual(d.calls, [['deepseek', 6000]], 'the 3 000 of the old lane is not used for DeepSeek');
      const t = d.ledger.tracked[0];
      assert.deepStrictEqual([t.meta.provider, t.meta.model, t.meta.endpoint, t.meta.userId], ['deepseek', 'deepseek/deepseek-flash', '/api/draft/explain-document', 7]);
      assert.ok(t.meta.bound && t.meta.bound.usd > 0);
      d = deps({ deepseek: () => { throw new Error('503'); } });
      r = await d.router(msgs, { maxTokens: 3000 });
      assert.strictEqual(r.text, 'LUNA');
      assert.deepStrictEqual(d.calls[1], ['openai', 'openai/gpt-6-luna', 8000, 'cheap', false]);
      d = deps({ deepseek: () => { throw new Error('503'); }, openai: () => { throw new Error('500'); } });
      assert.strictEqual((await d.router(msgs, {})).text, 'GEMINI');
      d = deps({ spend: false });
      assert.strictEqual((await d.router(msgs, {})).text, 'GEMINI');
      assert.deepStrictEqual(d.calls, [['last']], 'over the daily ceiling: no paid call');
      d = deps({ deepseek: () => { throw new Error('503'); }, paid: false });
      assert.strictEqual((await d.router(msgs, {})).text, 'GEMINI', 'no OpenAI key: no Luna call');
    });
    await withEnv({ DEEPSEEK_API_KEY: KEY, EXPLAIN_PROVIDER: 'default' }, async () => {
      const d = deps();
      assert.strictEqual((await d.router(msgs, {})).text, 'OLD');
      assert.deepStrictEqual(d.calls, [['default']]);
    });
    await withEnv({ DEEPSEEK_API_KEY: null, EXPLAIN_PROVIDER: null }, async () => {
      const d = deps();
      assert.strictEqual((await d.router(msgs, {})).text, 'OLD', 'no DeepSeek key: the route is unchanged');
    });
  });

  await test('the server wires it to the explanation only (not the digest, opinion or chat)', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../src/api/server.js'), 'utf8');
    const mount = src.slice(src.indexOf("require('../rag/document-explain-route').mountExplainDocument(app, {"));
    assert.ok(/callAI: callExplainAI, digest: digestLongDocumentDetailed/u.test(mount.slice(0, 400)));
    assert.strictEqual((src.match(/callExplainAI/gu) || []).length, 2, 'defined once, used once');
  });

  await test('DeepSeek first for every text lane: routes() on with the key, off with DEEPSEEK_ROUTING=off; explicit openai/, voicelab/ and gemini ids and the vision lane never; the cap is the caller\'s x2 up to 16 000', async () => {
    await withEnv({ DEEPSEEK_API_KEY: KEY, DEEPSEEK_ROUTING: null, DEEPSEEK_MAX_TOKENS_FACTOR: null, DEEPSEEK_MAX_TOKENS_CAP: null }, async () => {
      for (const m of ['cheap', 'standard', 'premium', 'gpt-6-luna', 'gpt-6-sol', 'deepseek/deepseek-flash']) assert.strictEqual(deepseek.routes(m), true, m);
      for (const m of ['vision', 'openai/gpt-6-luna', 'voicelab/aisha-comet', 'gemini-2.5-flash']) assert.strictEqual(deepseek.routes(m), false, m);
      assert.deepStrictEqual([deepseek.maxTokensFor(3000), deepseek.maxTokensFor(1600), deepseek.maxTokensFor(12000), deepseek.maxTokensFor(undefined)], [6000, 3200, 16000, 16000]);
      assert.strictEqual(routing().provider, 'deepseek');
    });
    await withEnv({ DEEPSEEK_API_KEY: KEY, DEEPSEEK_ROUTING: 'off' }, async () => {
      assert.strictEqual(deepseek.routes('cheap'), false);
      assert.strictEqual(routing().provider, 'default', 'off everywhere, the explanation included');
    });
    await withEnv({ DEEPSEEK_API_KEY: null }, async () => assert.strictEqual(deepseek.routes('standard'), false, 'no key: nothing changes'));
  });

  await test('the streamed DeepSeek answer (web chat): deltas to the screen, usage from the last chunk; a stream broken after tokens is marked partial (not replayed elsewhere)', async () => {
    const enc = new TextEncoder();
    const sse = (lines, br = false) => ({ ok: true, status: 200, headers: { get: () => null }, body: (async function* () { for (const l of lines) yield enc.encode(`data: ${JSON.stringify(l)}\n\n`); if (br) throw new Error('socket hang up'); yield enc.encode('data: [DONE]\n\n'); })() });
    await withEnv({ DEEPSEEK_API_KEY: KEY }, async () => {
      const shown = [];
      let body = null;
      const r = await deepseek.chatCompletionStream(msgs, { maxTokens: 6000, fetchImpl: async (u, init) => { body = JSON.parse(init.body); return sse([{ model: 'deepseek-flash', choices: [{ delta: { content: 'Salom ' } }] }, { choices: [{ delta: { content: 'dunyo' }, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 10, completion_tokens: 3 } }]); } }, p => shown.push(p));
      assert.deepStrictEqual([body.stream, body.stream_options, body.thinking], [true, { include_usage: true }, { type: 'disabled' }]);
      assert.deepStrictEqual([shown.join(''), r.text, r.usage.outTokens, r.truncated], ['Salom dunyo', 'Salom dunyo', 3, false]);
      const e = await deepseek.chatCompletionStream(msgs, { fetchImpl: async () => sse([{ choices: [{ delta: { content: 'yarim' } }] }], true) }, () => {}).catch(x => x);
      assert.ok(e.partialStream === true);
    });
  });

  await test('the server: DeepSeek before VoiceLab and OpenAI in callOpenAI and its stream; VoiceLab text lanes skipped while DeepSeek routes them; vision/OCR untouched; an explicit deepseek/ id falls back to the lane\'s GPT-6', () => {
    const fs = require('fs'), path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    const body = name => { const i = src.indexOf(`async function ${name}(`); return src.slice(i, src.indexOf('\n}\n', i)); };
    for (const fn of ['callOpenAI', 'callOpenAIStream']) {
      const b = body(fn);
      assert.ok(b.indexOf('tryDeepSeek(') > 0 && b.indexOf('tryDeepSeek(') < b.indexOf('tryVoiceLab('), `${fn}: DeepSeek first`);
      assert.ok(/openaiModelFor\(options\)/u.test(b), `${fn}: the lane's GPT-6 after it`);
    }
    assert.ok(/if \(deepseek\.routes\(model\)\) return null;/u.test(body('tryVoiceLab')));
    assert.ok(/paidModelsAllowed\(\)/u.test(body('tryDeepSeek')), 'the daily ceiling applies');
    // OCR / vision keep their providers
    const ocr = fs.readFileSync(path.join(__dirname, '../src/ocr/routes.js'), 'utf8');
    assert.ok(!/deepseek/iu.test(ocr));
    assert.ok(!/deepseek|tryDeepSeek/u.test(body('triggerAiScreening')));
    const hp = fs.readFileSync(path.join(__dirname, '../src/rag/hybrid-pipeline.js'), 'utf8');
    assert.ok(hp.indexOf('if (deepseek.routes(model))') < hp.indexOf('if (voicelab.routes(model) && !deepseek.routes(model))'));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
