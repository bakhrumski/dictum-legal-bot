'use strict';

// VoiceLab provider switch. Every network call is served by a stubbed fetch,
// so this runs offline and asserts the exact requests that would be sent.

const assert = require('assert');

const ENV_KEYS = [
  'LLM_PROVIDER', 'VOICELAB_API_KEY', 'VOICELAB_BASE_URL', 'VOICELAB_LANES', 'VOICELAB_FALLBACK',
  'VOICELAB_MODEL_CHEAP', 'VOICELAB_MODEL_STANDARD', 'VOICELAB_MODEL_PREMIUM', 'VOICELAB_MODEL_VISION',
  'VOICELAB_PRICES', 'GPT_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY',
];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const realFetch = global.fetch;

function resetEnv(overrides = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, overrides);
}

const ON = { LLM_PROVIDER: 'voicelab', VOICELAB_API_KEY: 'vlk_test_key' };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function sseResponse(frames) {
  // Split every frame across two chunks so the parser has to buffer lines.
  const enc = new TextEncoder();
  const chunks = [];
  for (const f of frames) {
    const half = Math.max(1, Math.floor(f.length / 2));
    chunks.push(enc.encode(f.slice(0, half)), enc.encode(f.slice(half)));
  }
  const body = new ReadableStream({
    start(controller) { for (const c of chunks) controller.enqueue(c); controller.close(); },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

let calls = [];
function stubFetch(handler) {
  calls = [];
  global.fetch = async (url, init = {}) => {
    const call = { url: String(url), init, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    return handler(call);
  };
}

function fresh(path) {
  delete require.cache[require.resolve(path)];
  return require(path);
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}\n      ${err.stack || err.message}`);
  }
}

(async () => {
  console.log('\nvoicelab — provider switch\n');
  const voicelab = require('../src/ai/voicelab');

  await test('off by default: nothing routes without LLM_PROVIDER and a key', () => {
    resetEnv();
    assert.strictEqual(voicelab.isEnabled(), false);
    assert.strictEqual(voicelab.routes('gpt-5.6-terra'), false);
    resetEnv({ LLM_PROVIDER: 'voicelab' });
    assert.strictEqual(voicelab.isEnabled(), false, 'a missing key keeps it off');
    resetEnv({ VOICELAB_API_KEY: 'vlk_x', LLM_PROVIDER: 'openai' });
    assert.strictEqual(voicelab.isEnabled(), false, 'any other provider value keeps it off');
  });

  await test('lanes map the current OpenAI tiers onto Comet, Orbit and Halo', () => {
    resetEnv(ON);
    assert.strictEqual(voicelab.modelFor('gpt-5.6-luna'), 'aisha-comet');
    assert.strictEqual(voicelab.modelFor('gpt-5.6-terra'), 'aisha-orbit');
    assert.strictEqual(voicelab.modelFor('gpt-5.6-sol'), 'aisha-halo');
    assert.strictEqual(voicelab.modelFor('vision'), 'aisha-halo');
    assert.strictEqual(voicelab.modelFor('some-custom-model'), 'aisha-orbit', 'unknown ids are the standard lane');
    process.env.VOICELAB_MODEL_STANDARD = 'orbit-2';
    assert.strictEqual(voicelab.modelFor('gpt-5.6-terra'), 'orbit-2');
  });

  await test('VOICELAB_LANES moves single workloads back; Gemini is never routed', () => {
    resetEnv({ ...ON, VOICELAB_LANES: 'cheap,vision' });
    assert.strictEqual(voicelab.routes('gpt-5.6-luna'), true);
    assert.strictEqual(voicelab.routes('gpt-5.6-terra'), false);
    assert.strictEqual(voicelab.routes('gpt-5.6-sol'), false);
    assert.strictEqual(voicelab.routes('vision'), true);
    resetEnv(ON);
    assert.strictEqual(voicelab.routes('gemini-2.5-flash'), false);
  });

  await test('explicit ids pick the provider regardless of the switch, for A/B', () => {
    resetEnv({ VOICELAB_API_KEY: 'vlk_x' });   // LLM_PROVIDER off
    assert.strictEqual(voicelab.routes('voicelab/comet'), true, 'voicelab/ works with only a key');
    assert.strictEqual(voicelab.modelFor('voicelab/comet'), 'comet');
    assert.strictEqual(voicelab.fallbackAllowed('voicelab/comet'), false, 'an explicit VoiceLab call never falls back');
    assert.strictEqual(voicelab.routes('gpt-5.6-luna'), false);
    resetEnv(ON);
    assert.strictEqual(voicelab.routes('openai/gpt-5.6-luna'), false, 'openai/ bypasses VoiceLab while it is on');
    assert.strictEqual(voicelab.stripProviderPrefix('openai/gpt-5.6-luna'), 'gpt-5.6-luna');
    assert.strictEqual(voicelab.stripProviderPrefix('gpt-5.6-terra'), 'gpt-5.6-terra');
    assert.strictEqual(voicelab.fallbackAllowed('gpt-5.6-luna'), true);
    resetEnv();
    assert.strictEqual(voicelab.routes('voicelab/comet'), false, 'no key, no VoiceLab');
  });

  await test('sends an OpenAI Chat Completions request with Bearer auth', async () => {
    resetEnv(ON);
    stubFetch(() => jsonResponse({
      id: 'x', choices: [{ index: 0, message: { role: 'assistant', content: 'Salom' } }],
      usage: { prompt_tokens: 12, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 4 } },
    }));
    const r = await voicelab.chatCompletion('gpt-5.6-terra', [
      { role: 'system', text: 'Siz yuristsiz.' },
      { role: 'user', text: 'Savol' },
      { role: 'model', text: 'Oldingi javob' },
    ], { temperature: 0.2, maxTokens: 500, responseFormat: { type: 'json_object' } });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://api.voicelab.uz/v1/chat/completions');
    assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer vlk_test_key');
    assert.deepStrictEqual(calls[0].body, {
      model: 'aisha-orbit',
      messages: [
        { role: 'system', content: 'Siz yuristsiz.' },
        { role: 'user', content: 'Savol' },
        { role: 'assistant', content: 'Oldingi javob' },
      ],
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });
    assert.strictEqual(r.text, 'Salom');
    assert.strictEqual(r.provider, 'voicelab/aisha-orbit');
    assert.deepStrictEqual(r.usage, { inTokens: 12, outTokens: 3, cachedTokens: 4 });
  });

  await test('image parts pass through untouched on the vision lane', async () => {
    resetEnv({ ...ON, VOICELAB_BASE_URL: 'https://example.test/' });
    stubFetch(() => jsonResponse({ choices: [{ message: { content: [{ type: 'text', text: 'Matn' }] } }] }));
    const content = [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      { type: 'text', text: 'Extract' },
    ];
    const r = await voicelab.chatCompletion('vision', [{ role: 'user', content }]);
    assert.strictEqual(calls[0].url, 'https://example.test/v1/chat/completions', 'base URL override, trailing slash trimmed');
    assert.strictEqual(calls[0].body.model, 'aisha-halo');
    assert.deepStrictEqual(calls[0].body.messages[0].content, content);
    assert.strictEqual(r.text, 'Matn', 'array content is read as text');
  });

  await test('errors carry the status; a status-only reply is not an answer', async () => {
    resetEnv(ON);
    stubFetch(() => new Response('{"error":"unauthorized"}', { status: 401 }));
    await assert.rejects(voicelab.chatCompletion('cheap', [{ role: 'user', text: 'x' }]),
      (e) => e.status === 401 && /VoiceLab aisha-comet 401/.test(e.message));
    stubFetch(() => jsonResponse({ id: 'req_1', status: 'queued' }));
    await assert.rejects(voicelab.chatCompletion('cheap', [{ role: 'user', text: 'x' }]),
      /no choices \(status: queued\)/);
    stubFetch(() => jsonResponse({ choices: [{ message: { content: '   ' } }] }));
    await assert.rejects(voicelab.chatCompletion('cheap', [{ role: 'user', text: 'x' }]), /empty response/);
  });

  await test('streams SSE deltas, reads usage, stops at [DONE]', async () => {
    resetEnv(ON);
    stubFetch(() => sseResponse([
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Assa"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lomu alaykum"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":4}}\n\n',
      'data: [DONE]\n\n',
    ]));
    const tokens = [];
    const r = await voicelab.chatCompletionStream('gpt-5.6-luna', [{ role: 'user', text: 'Salom' }], {}, (t) => tokens.push(t));
    assert.strictEqual(calls[0].body.stream, true);
    assert.strictEqual(calls[0].body.model, 'aisha-comet');
    assert.deepStrictEqual(tokens, ['Assa', 'lomu alaykum']);
    assert.strictEqual(r.text, 'Assalomu alaykum');
    assert.deepStrictEqual(r.usage, { inTokens: 9, outTokens: 4, cachedTokens: 0 });
  });

  await test('a stream that fails after tokens is marked partial', async () => {
    resetEnv(ON);
    stubFetch(() => sseResponse([
      'data: {"choices":[{"delta":{"content":"Bosh"}}]}\n\n',
      'data: {"error":{"message":"overloaded"}}\n\n',
    ]));
    await assert.rejects(
      voicelab.chatCompletionStream('cheap', [{ role: 'user', text: 'x' }], {}, () => {}),
      (e) => e.partialStream === true && /overloaded/.test(e.message));
  });

  console.log('\nvoicelab — pricing\n');

  await test('VoiceLab calls are priced from VOICELAB_PRICES, never as free', () => {
    const { calculateTokenCost } = fresh('../src/ai/model-pricing');
    resetEnv();
    assert.strictEqual(calculateTokenCost('voicelab/unknown-model', { inTokens: 1000 }), null, 'no price → unknown, not $0');
    // Built-in list prices (console, 2026-09-23): 1M in + 1M out.
    assert.ok(Math.abs(calculateTokenCost('voicelab/aisha-comet', { inTokens: 1e6, outTokens: 1e6 }) - 1.15) < 1e-9);
    assert.ok(Math.abs(calculateTokenCost('voicelab/aisha-orbit', { inTokens: 1e6, outTokens: 1e6 }) - 5.40) < 1e-9);
    assert.ok(Math.abs(calculateTokenCost('voicelab/aisha-halo', { inTokens: 1e6, outTokens: 1e6 }) - 15.90) < 1e-9);
    process.env.VOICELAB_PRICES = '{"orbit":{"in":1,"out":4}}';
    assert.ok(Math.abs(calculateTokenCost('voicelab/orbit', { inTokens: 1e6, outTokens: 5e5 }) - 3) < 1e-12);
    process.env.VOICELAB_PRICES = 'not json';
    assert.strictEqual(calculateTokenCost('voicelab/orbit', { inTokens: 1000 }), null);
    assert.ok(calculateTokenCost('gpt-5.6-terra', { inTokens: 1e6 }) === 2, 'OpenAI prices unaffected');
  });

  console.log('\nvoicelab — hybrid pipeline (classify / generate)\n');

  const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
  const VOICELAB_URL = 'https://api.voicelab.uz/v1/chat/completions';
  const classifyReply = JSON.stringify({ topic: 'mehnat', language: 'uz', intent: 'q', needs_rag: true, search_terms: ['mehnat'] });

  await test('switched off, the pipeline calls OpenAI exactly as before', async () => {
    resetEnv({ GPT_API_KEY: 'sk-test' });
    stubFetch(() => jsonResponse({ choices: [{ message: { content: classifyReply } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }));
    const pipeline = fresh('../src/rag/hybrid-pipeline');
    await pipeline.classify('Mehnat shartnomasi');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, OPENAI_URL);
    assert.strictEqual(calls[0].body.model, 'gpt-5.6-luna');
  });

  await test('switched on, classify goes to Comet and is priced as VoiceLab', async () => {
    resetEnv({ ...ON, GPT_API_KEY: 'sk-test', VOICELAB_PRICES: '{"aisha-comet":{"in":1,"out":1}}' });
    stubFetch(() => jsonResponse({ choices: [{ message: { content: classifyReply } }], usage: { prompt_tokens: 1e6, completion_tokens: 0 } }));
    const pipeline = fresh('../src/rag/hybrid-pipeline');
    const seen = [];
    pipeline.setSpendHook((e) => { seen.push(e); });
    await pipeline.classify('Mehnat shartnomasi');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, VOICELAB_URL);
    assert.strictEqual(calls[0].body.model, 'aisha-comet');
    assert.deepStrictEqual(calls[0].body.response_format, { type: 'json_object' });
    assert.strictEqual(seen[0].model, 'voicelab/aisha-comet');
    assert.ok(Math.abs(seen[0].costUsd - 1) < 1e-9, 'cost from VOICELAB_PRICES, not the Luna rate');
  });

  await test('a VoiceLab failure falls back to the previous provider', async () => {
    resetEnv({ ...ON, GPT_API_KEY: 'sk-test' });
    stubFetch((c) => (c.url === VOICELAB_URL
      ? new Response('upstream down', { status: 503 })
      : jsonResponse({ choices: [{ message: { content: 'OpenAI javobi' } }], usage: { prompt_tokens: 5, completion_tokens: 5 } })));
    const pipeline = fresh('../src/rag/hybrid-pipeline');
    const r = await pipeline.generate({ query: 'Savol', systemPrompt: 'Tizim' });
    assert.deepStrictEqual(calls.map((c) => c.url), [VOICELAB_URL, OPENAI_URL]);
    assert.strictEqual(calls[0].body.model, 'aisha-orbit');
    assert.strictEqual(calls[1].body.model, 'gpt-5.6-terra');
    assert.strictEqual(r.text, 'OpenAI javobi');
  });

  await test('VOICELAB_FALLBACK=false keeps OpenAI out of it', async () => {
    resetEnv({ ...ON, GPT_API_KEY: 'sk-test', VOICELAB_FALLBACK: 'false' });
    stubFetch((c) => (c.url === VOICELAB_URL
      ? new Response('upstream down', { status: 503 })
      : jsonResponse({ choices: [{ message: { content: 'should not be used' } }] })));
    const pipeline = fresh('../src/rag/hybrid-pipeline');
    await assert.rejects(pipeline.generate({ query: 'Savol', systemPrompt: 'Tizim' }), /All models in chain failed/);
    assert.ok(calls.every((c) => c.url !== OPENAI_URL), 'no OpenAI request was made');
  });

  global.fetch = realFetch;
  resetEnv(savedEnv);
  for (const [k, v] of Object.entries(savedEnv)) if (v === undefined) delete process.env[k];

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
})();
