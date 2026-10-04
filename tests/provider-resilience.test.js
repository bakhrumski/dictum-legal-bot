'use strict';

/**
 * Provider errors, call limits and cost accounting (2026-10-04 retest: one
 * Telegram question made 31 AI calls - 19 HF rerank pairs all HTTP 402 - and
 * another 53 calls, with every failure counted as a retry or fallback).
 *
 * Every provider here is a stub. Nothing in this file reaches a real API, and
 * no number it produces is a real provider cost.
 *
 *   node tests/provider-resilience.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const health = require('../src/ai/provider-health');
const ledger = require('../src/ai/usage-ledger');
const embeddings = require('../src/rag/embeddings');

// The reranker takes httpsPostJson from embeddings when it loads; route it
// through a stub this file controls.
let hfPost = async () => { throw new Error('no stub'); };
embeddings.httpsPostJson = (...args) => hfPost(...args);
const reranker = require('../src/rag/reranker');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const rows = [];
const requests = new Map();
ledger.configure({
  write: async (row) => { rows.push(row); },
  writeRequest: async (r) => { requests.set(r.requestId, r); },
});
const settle = () => new Promise(r => setTimeout(r, 20));
const asProviderError = (status, body, extra) => {
  const p = health.parseProviderError(JSON.stringify(body));
  return Object.assign(new Error(`HTTP ${status}`), { status, providerCode: p.code, providerMessage: p.message, ...extra });
};

const chunk = (id, text, score = 0.5) => ({ id, chunk_text: text, source_type: 'law_text', score });

(async () => {
  console.log('provider resilience and accounting');

  // ── classification ────────────────────────────────────────────────────
  await test('402 is classified from the provider message, permanent, and named', () => {
    const c = health.classifyError(asProviderError(402, { error: 'You have exceeded your monthly included credits for Inference Providers.' }));
    assert.strictEqual(c.kind, 'permanent');
    assert.strictEqual(c.code, 'HTTP_402_PAYMENT');
    assert.match(c.reason, /monthly included credits/u, 'the reason is the provider\'s own words');
  });

  await test('429: a quota/billing message is permanent; a plain rate limit is transient with Retry-After', () => {
    const quota = health.classifyError(asProviderError(429, { error: { code: 'insufficient_quota', message: 'You exceeded your current quota, please check your plan and billing details.' } }));
    assert.deepStrictEqual([quota.kind, quota.code], ['permanent', 'HTTP_429_QUOTA']);
    const rate = health.classifyError(asProviderError(429, { error: { code: 'rate_limit_exceeded', message: 'Rate limit reached for requests per min.' } }, { retryAfter: '2' }));
    assert.deepStrictEqual([rate.kind, rate.code, rate.retryAfterMs], ['transient', 'HTTP_429_RATE', 2000]);
    assert.strictEqual(health.parseRetryAfter(new Date(Date.now() + 3000).toUTCString()) > 1000, true, 'HTTP-date Retry-After');
  });

  await test('a generic ERROR gets a specific code: Orbit no choices / empty text, timeout, network', () => {
    const noChoices = health.classifyError(Object.assign(new Error('VoiceLab aisha-orbit returned no choices (status: queued)'), { code: 'NO_CHOICES', providerCode: 'queued' }));
    assert.strictEqual(noChoices.code, 'NO_CHOICES');
    assert.match(noChoices.reason, /queued/u);
    const empty = health.classifyError(Object.assign(new Error('VoiceLab aisha-orbit empty response (finish_reason: length, max_tokens: 400)'), { code: 'EMPTY_RESPONSE', providerCode: 'length' }));
    assert.strictEqual(empty.code, 'EMPTY_RESPONSE');
    assert.match(empty.reason, /finish_reason: length/u);
    assert.strictEqual(health.classifyError(Object.assign(new Error('x'), { status: 408 })).code, 'TIMEOUT');
    assert.strictEqual(health.classifyError(Object.assign(new Error('socket'), { code: 'ECONNRESET' })).code, 'NET_ECONNRESET');
    assert.strictEqual(health.classifyError(Object.assign(new Error('bad gateway'), { status: 502 })).kind, 'transient');
  });

  await test('no secret survives into a recorded reason', () => {
    const c = health.classifyError(new Error('failed for key=AIzaSyA1234567890abcdef and Bearer hf_abcdefghijklmnop and sk-proj-abcdefghijkl'));
    assert.ok(!/AIza|hf_abc|sk-proj/u.test(c.reason), c.reason);
  });

  await test('VoiceLab: no choices and empty text are thrown with their codes; reported credits are read, missing ones stay null', async () => {
    const realFetch = global.fetch;
    const env = { LLM_PROVIDER: process.env.LLM_PROVIDER, VOICELAB_API_KEY: process.env.VOICELAB_API_KEY };
    process.env.LLM_PROVIDER = 'voicelab';
    process.env.VOICELAB_API_KEY = 'vlk_test_key';
    const voicelab = require('../src/ai/voicelab');
    const reply = (body, headers = {}) => async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', ...headers } });
    try {
      global.fetch = reply({ status: 'queued' });
      await assert.rejects(voicelab.chatCompletion('standard', [{ role: 'user', text: 'x' }]), e => e.code === 'NO_CHOICES');
      global.fetch = reply({ choices: [{ message: { content: '' }, finish_reason: 'length' }] });
      await assert.rejects(voicelab.chatCompletion('standard', [{ role: 'user', text: 'x' }], { maxTokens: 400 }), e => e.code === 'EMPTY_RESPONSE' && /max_tokens: 400/u.test(e.message));
      global.fetch = reply({ choices: [{ message: { content: 'javob' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
      const unknown = await voicelab.chatCompletion('cheap', [{ role: 'user', text: 'x' }]);
      assert.strictEqual(unknown.usage.credits, null, 'no credits reported: null, never 0');
      global.fetch = reply({ choices: [{ message: { content: 'javob' }, finish_reason: 'length' }] }, { 'x-voicelab-credits-used': '120' });
      const known = await voicelab.chatCompletion('cheap', [{ role: 'user', text: 'x' }]);
      assert.strictEqual(known.usage.credits, 120);
      assert.strictEqual(known.finishReason, 'length', 'truncation is visible to the caller');
    } finally {
      global.fetch = realFetch;
      for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });

  // ── breaker ───────────────────────────────────────────────────────────
  await test('a 402 opens the breaker for the whole provider: the next call is one skipped row, the provider is not called', async () => {
    health.reset(); rows.length = 0;
    let reached = 0;
    await ledger.runWithRequest({ service: 'telegram' }, async () => {
      await assert.rejects(ledger.track({ provider: 'huggingface', model: 'm1', stage: 'rerank' }, async () => { reached++; throw asProviderError(402, { error: 'Payment Required' }); }));
      await assert.rejects(ledger.track({ provider: 'huggingface', model: 'm2', stage: 'rerank' }, async () => { reached++; }), e => e.code === 'CIRCUIT_OPEN');
    });
    await settle();
    assert.strictEqual(reached, 1);
    assert.deepStrictEqual(rows.map(r => [r.status, r.errorCode, r.errorKind]), [['error', 'HTTP_402_PAYMENT', 'permanent'], ['skipped', 'CIRCUIT_OPEN', 'skipped']]);
    assert.strictEqual(rows[1].costUsd, null);
    assert.ok(health.snapshot().some(b => b.key === 'huggingface|*'));
    health.reset();
  });

  await test('a transient error on an essential stage is retried once after Retry-After; a helper is not retried', async () => {
    health.reset(); rows.length = 0;
    let n = 0;
    await ledger.runWithRequest({ service: 'telegram' }, async () => {
      const out = await ledger.track({ provider: 'openai', model: 'gpt-6-sol', endpoint: '/tg-agent/answer' }, async (call) => {
        n++;
        if (n === 1) throw asProviderError(429, { error: { code: 'rate_limit_exceeded', message: 'Rate limit reached' } }, { retryAfter: '0' });
        call.usage({ inTokens: 10, outTokens: 10 });
        return 'ok';
      });
      assert.strictEqual(out, 'ok');
      let helper = 0;
      await assert.rejects(ledger.track({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/rag/query-rewrite' }, async () => { helper++; throw asProviderError(503, { error: 'unavailable' }); }));
      assert.strictEqual(helper, 1);
    });
    await settle();
    const answer = rows.filter(r => r.stage === 'answer');
    assert.deepStrictEqual(answer.map(r => [r.attempt, r.status]), [[1, 'error'], [2, 'success']]);
    assert.strictEqual(answer[1].retryReason, 'transient:HTTP_429_RATE');
    assert.strictEqual(answer[1].parentCallId, answer[0].callId, 'the retry points to the attempt before it');
    assert.strictEqual(answer[1].stageRunId, answer[0].stageRunId, 'both attempts are one logical call');
    health.reset();
  });

  await test('three transient errors in a row open the breaker briefly', () => {
    health.reset();
    const c = { kind: 'transient', code: 'HTTP_503', reason: 'x' };
    health.recordOutcome('voicelab', 'voicelab/aisha-orbit', c);
    health.recordOutcome('voicelab', 'voicelab/aisha-orbit', c);
    assert.strictEqual(health.openState('voicelab', 'voicelab/aisha-orbit'), null);
    health.recordOutcome('voicelab', 'voicelab/aisha-orbit', c);
    assert.ok(health.openState('voicelab', 'voicelab/aisha-orbit'));
    assert.strictEqual(health.openState('voicelab', 'voicelab/aisha-comet'), null, 'other models of the provider are not affected');
    health.reset();
  });

  // ── per-request limits ────────────────────────────────────────────────
  await test('request limits from config: helpers stop at the call limit, the answer has a reserve, time is enforced', async () => {
    health.reset(); rows.length = 0;
    const keep = { ...process.env };
    process.env.AI_REQUEST_MAX_CALLS = '3';
    process.env.AI_REQUEST_ESSENTIAL_RESERVE = '1';
    try {
      await ledger.runWithRequest({ service: 'telegram' }, async () => {
        for (let i = 0; i < 3; i++) await ledger.track({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/rag/classify-topic' }, async () => 'ok');
        await assert.rejects(ledger.track({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/rag/classify-topic' }, async () => 'ok'), e => e.code === 'REQUEST_BUDGET');
        assert.strictEqual(await ledger.track({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/tg-agent/answer' }, async () => 'ok'), 'ok', 'the answer uses the reserve');
        await assert.rejects(ledger.track({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/tg-agent/claim-check' }, async () => 'ok'), e => e.code === 'REQUEST_BUDGET');
      });
      await ledger.runWithRequest({ service: 'web', budget: { maxMs: 1 } }, async () => {
        await new Promise(r => setTimeout(r, 5));
        await assert.rejects(ledger.track({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/api/legal-chat' }, async () => 'ok'), e => e.code === 'REQUEST_BUDGET' && /time limit/u.test(e.message));
      });
    } finally {
      for (const k of ['AI_REQUEST_MAX_CALLS', 'AI_REQUEST_ESSENTIAL_RESERVE']) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; }
    }
    await settle();
    const skipped = rows.filter(r => r.status === 'skipped');
    assert.strictEqual(skipped.length, 3);
    assert.ok(skipped.every(r => r.errorCode === 'REQUEST_BUDGET' && r.costUsd === null));
  });

  // ── rerank ────────────────────────────────────────────────────────────
  const QUERY = "ish haqi to'lanmadi murojaat muddati";
  const CANDIDATES = Array.from({ length: 19 }, (_, i) => chunk(`c${i}`, `modda ${i} ${i % 3 === 0 ? 'ish haqi muddati' : 'boshqa'}`, 1 - i / 100));
  const withHF = async (fn) => {
    const keep = process.env.HF_TOKEN;
    process.env.HF_TOKEN = 'hf_test_token_value';
    try { return await fn(); } finally { if (keep === undefined) delete process.env.HF_TOKEN; else process.env.HF_TOKEN = keep; }
  };

  await test('rerank 402: the first pair is a probe; the other 18 are never sent; keyword fallback; request marked degraded', async () => {
    health.reset(); rows.length = 0; reranker._scoreCache.clear();
    let sent = 0;
    hfPost = async () => { sent++; return { status: 402, text: JSON.stringify({ error: 'You have exceeded your monthly included credits' }), body: null, headers: {} }; };
    let store;
    const top = await withHF(() => ledger.runWithRequest({ service: 'telegram' }, async (s) => { store = s; return reranker.rerankChunks(QUERY, CANDIDATES, { topK: 3 }); }));
    await settle();
    assert.strictEqual(sent, 1);
    assert.strictEqual(top.length, 3);
    assert.ok(store.shared.degraded.has('rerank_unavailable'));
    assert.deepStrictEqual(rows.map(r => [r.stage, r.status, r.errorCode, r.attempt]), [['rerank', 'error', 'HTTP_402_PAYMENT', 1]]);
    // the next question: breaker open, nothing sent, one skipped row
    rows.length = 0;
    await withHF(() => ledger.runWithRequest({ service: 'telegram' }, () => reranker.rerankChunks(QUERY, CANDIDATES, { topK: 3 })));
    await settle();
    assert.strictEqual(sent, 1);
    assert.deepStrictEqual(rows.map(r => [r.status, r.errorCode]), [['skipped', 'CIRCUIT_OPEN']]);
    health.reset();
  });

  await test('rerank pairs are one batch, not retries; candidates are capped; scores are cached', async () => {
    health.reset(); rows.length = 0; reranker._scoreCache.clear();
    let sent = 0;
    hfPost = async (url, body) => { sent++; return { status: 200, body: [[{ label: 'LABEL_1', score: /ish haqi/u.test(body.inputs[1]) ? 0.9 : 0.1 }]], headers: {} }; };
    const top = await withHF(() => ledger.runWithRequest({ service: 'telegram' }, () => reranker.rerankChunks(QUERY, CANDIDATES, { topK: 3 })));
    await settle();
    assert.strictEqual(sent, 12, 'RERANK_MAX_CANDIDATES defaults to 12');
    assert.ok(top.every(c => /ish haqi/u.test(c.chunk_text)));
    assert.strictEqual(new Set(rows.map(r => r.batchId)).size, 1, 'one batch');
    assert.ok(rows.every(r => r.attempt === 1 && !r.retryReason && !r.fallbackFrom), 'no pair is a retry or a fallback');
    assert.strictEqual(new Set(rows.map(r => r.stageRunId)).size, 12, 'each pair is its own call');
    rows.length = 0;
    await withHF(() => ledger.runWithRequest({ service: 'telegram' }, () => reranker.rerankChunks(QUERY, CANDIDATES, { topK: 3 })));
    assert.strictEqual(sent, 12, 'the same public text is not scored again');
    // a user's own document is never cached
    reranker._scoreCache.clear();
    const privateChunks = CANDIDATES.slice(0, 4).map(c => ({ ...c, source_type: 'user_document' }));
    await withHF(() => reranker.rerankChunks(QUERY, privateChunks, { topK: 2 }));
    assert.strictEqual(reranker._scoreCache.size, 0);
  });

  await test('RERANKER=off: no calls, keyword order, degraded', async () => {
    rows.length = 0;
    let sent = 0;
    hfPost = async () => { sent++; return { status: 200, body: [[{ label: 'LABEL_1', score: 1 }]] }; };
    process.env.RERANKER = 'off';
    let store;
    try {
      await withHF(() => ledger.runWithRequest({ service: 'web' }, async (s) => { store = s; return reranker.rerankChunks(QUERY, CANDIDATES, { topK: 3 }); }));
    } finally { delete process.env.RERANKER; }
    assert.strictEqual(sent, 0);
    assert.strictEqual(rows.length, 0);
    assert.ok(store.shared.degraded.has('rerank_off'));
  });

  // ── accounting ────────────────────────────────────────────────────────
  await test('unknown is never 0: a failed call without usage, and VoiceLab without credits', async () => {
    rows.length = 0;
    await ledger.runWithRequest({ service: 'telegram' }, async () => {
      await assert.rejects(ledger.track({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/rag/classify-topic' }, async () => { throw asProviderError(500, { error: 'x' }); }));
      await ledger.track({ provider: 'voicelab', model: 'voicelab/no-such-price', endpoint: '/rag/classify-topic' }, async (c) => { c.usage({ inTokens: 10, outTokens: 10, credits: null }); });
    });
    await settle();
    assert.strictEqual(rows[0].costUsd, null);
    assert.strictEqual(rows[0].costSource, 'unknown');
    assert.strictEqual(rows[1].credits, null);
    assert.strictEqual(rows[1].costUsd, null, 'no price and no credits: unknown, not $0');
  });

  await test('reported VoiceLab credits are converted at the owner\'s rate (a conversion, not a token price)', async () => {
    rows.length = 0;
    await ledger.runWithRequest({ service: 'telegram' }, async () => {
      await ledger.track({ provider: 'voicelab', model: 'voicelab/aisha-comet', endpoint: '/tg-agent/answer' }, async (c) => { c.usage({ inTokens: 1000, outTokens: 1000, credits: 400 }); });
    });
    await settle();
    assert.strictEqual(rows[0].credits, 400);
    assert.ok(Math.abs(rows[0].costUsd - 400 * 90 / 1200000) < 1e-12, String(rows[0].costUsd));
    assert.match(rows[0].pricing.basis, /credits/u);
  });

  await test('Gemini embedding usage is estimated and marked so (the API reports none)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/rag/embeddings.js'), 'utf8');
    assert.match(src, /call\.usage\(\{ inTokens: estimatedTokens, outTokens: 0, estimated: true \}\)/u);
  });

  await test('an owner-confirmed price (AI_PRICE_OVERRIDES) turns estimated embedding tokens into an estimated cost', () => {
    const { costForUsage } = require('../src/ai/model-pricing');
    const before = costForUsage('gemini-embedding-001', { inTokens: 1000, outTokens: 0, estimated: true });
    process.env.AI_PRICE_OVERRIDES = JSON.stringify({ 'gemini-embedding-001': { in: 0.15, source: 'test fixture, not a real price' } });
    try {
      const after = costForUsage('gemini-embedding-001', { inTokens: 1000, outTokens: 0, estimated: true });
      assert.ok(Math.abs(after.costUsd - 1000 * 0.15 / 1e6) < 1e-12, String(after.costUsd));
      assert.strictEqual(after.costSource, 'estimated');
      assert.ok(before.costUsd == null || before.costSource !== 'calculated', 'without a price it is not presented as calculated');
    } finally { delete process.env.AI_PRICE_OVERRIDES; }
  });

  await test('the daily report uses Tashkent days', () => {
    const { tashkentDate } = require('../src/ai/usage-report');
    assert.strictEqual(tashkentDate(new Date('2026-10-03T18:59:59Z')), '2026-10-03');
    assert.strictEqual(tashkentDate(new Date('2026-10-03T19:00:00Z')), '2026-10-04', 'midnight in Tashkent is 19:00 UTC');
  });

  await test('the report does not count skipped calls as unknown cost, or every failure as a retry', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/ai/usage-report.js'), 'utf8');
    assert.match(src, /const UNKNOWN_COST = `\(l\.cost_usd IS NULL AND \$\{CALLED\}\)`/u);
    assert.match(src, /RETRY = [^\n]*attempt[^\n]*> 1/u);
  });

  // ── routing ───────────────────────────────────────────────────────────
  await test('routing: cheap and premium chains no longer re-run the standard chain; the doc states there is no Claude adapter', () => {
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    const body = (name) => {
      const start = server.indexOf(`async function ${name}(`);
      assert.ok(start >= 0, name);
      return server.slice(start, server.indexOf('\n}\n', start));
    };
    for (const name of ['callCheapAIChain', 'callPremiumAIChain']) {
      assert.ok(!/\bcallAI\(/u.test(body(name)), `${name} calls callAI`);
      assert.match(body(name), /callGeminiLastResort\(/u);
    }
    const doc = fs.readFileSync(path.join(__dirname, '../docs/ai-routing.md'), 'utf8');
    assert.match(doc, /no Claude\s+\(Anthropic\) adapter/u);
    const adapters = fs.readdirSync(path.join(__dirname, '../src/ai')).map(f => fs.readFileSync(path.join(__dirname, '../src/ai', f), 'utf8')).join('\n');
    assert.ok(!/api\.anthropic\.com/u.test(adapters + server), 'if an adapter is added, update docs/ai-routing.md and this test');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
