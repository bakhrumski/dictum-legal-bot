'use strict';

/**
 * Per-request AI usage and cost (2026-10-03). Every AI call of a user request
 * is one ledger row with the request's id; cost is provider_reported,
 * calculated, estimated or unknown - never a silent $0.
 *
 * The provider calls here are stubs: these tests check the ledger's own
 * bookkeeping, not any real API bill.
 *
 *   node tests/usage-ledger.test.js
 *   TEST_DATABASE_URL=postgresql://… node tests/usage-ledger.test.js   (also the database and report part)
 */

const assert = require('assert');
if (process.env.TEST_DATABASE_URL && !/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
const ledger = require('../src/ai/usage-ledger');
const pricing = require('../src/ai/model-pricing');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

// in-memory writers for the logic part
const rows = [];
const requests = new Map();
let failWrites = false;
ledger.configure({
  write: async (row) => { if (failWrites) throw new Error('db down'); rows.push(row); },
  writeRequest: async (r) => { requests.set(r.requestId, { ...(requests.get(r.requestId) || {}), ...r }); },
});
const settle = () => new Promise(r => setTimeout(r, 20));
const close = (a, b) => Math.abs(a - b) < 1e-12;

(async () => {
  console.log('usage ledger');

  await test('a single call: usage, cost, price snapshot, request id', async () => {
    rows.length = 0;
    await ledger.runWithRequest({ service: 'telegram', chatId: 7 }, async () => {
      await ledger.track({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/tg-agent/answer' }, async (call) => {
        call.usage({ inTokens: 1000, cachedTokens: 200, outTokens: 500, reasoningTokens: 100, modelReturned: 'gpt-6-luna-2026-09-01' });
        return 'ok';
      });
    });
    await settle();
    assert.strictEqual(rows.length, 1);
    const r = rows[0];
    assert.ok(/^[0-9a-f-]{36}$/u.test(r.requestId) && /^[0-9a-f-]{36}$/u.test(r.callId));
    assert.strictEqual(r.stage, 'answer');
    assert.strictEqual(r.modelReturned, 'gpt-6-luna-2026-09-01');
    // 800 fresh x 0.10 + 200 cached x 0.01 + 500 out x 0.50, per 1M; reasoning is inside output
    assert.ok(close(r.costUsd, (800 * 0.10 + 200 * 0.01 + 500 * 0.50) / 1e6), String(r.costUsd));
    assert.strictEqual(r.costSource, 'calculated');
    assert.strictEqual(r.pricing.checkedAt, '2026-09-23');
    assert.strictEqual(r.chatId, 7);
  });

  await test('answer + cross-check: one request, both calls, in order', async () => {
    rows.length = 0;
    await ledger.runWithRequest({ service: 'web' }, async () => {
      await ledger.track({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/api/legal-chat' }, async (c) => { c.usage({ inTokens: 100, outTokens: 100 }); });
      await ledger.track({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/api/legal-chat/lex-cross-check' }, async (c) => { c.usage({ inTokens: 300, outTokens: 50 }); });
    });
    await settle();
    assert.strictEqual(new Set(rows.map(r => r.requestId)).size, 1);
    assert.deepStrictEqual(rows.map(r => [r.seq, r.stage]), [[1, 'answer'], [2, 'cross_check']]);
  });

  await test('retry and fallback: every attempt is a row, with its reason', async () => {
    rows.length = 0;
    await ledger.runWithRequest({ service: 'web' }, () => ledger.withChain(async () => {
      // a VoiceLab attempt that fails, then OpenAI with one parameter retry
      await ledger.track({ provider: 'voicelab', model: 'voicelab/aisha-comet' }, async () => { throw Object.assign(new Error('VoiceLab 502'), { status: 502 }); }).catch(() => {});
      await ledger.track({ provider: 'openai', model: 'gpt-6-luna' }, async (call) => {
        await call.retry('param_rejected', { status: 400, message: 'temperature' });
        call.usage({ inTokens: 10, outTokens: 10 });
      });
    }));
    await settle();
    assert.deepStrictEqual(rows.map(r => [r.provider, r.status, r.errorCode, r.attempt, r.retryReason, r.fallbackFrom]), [
      ['voicelab', 'error', 'HTTP_502', 1, null, null],
      ['openai', 'error', 'HTTP_400_REQUEST', 1, null, 'voicelab/aisha-comet'],
      ['openai', 'success', null, 2, 'param_rejected', 'voicelab/aisha-comet'],
    ]);
  });

  await test('a timeout without usage is not $0: cost unknown', async () => {
    rows.length = 0;
    await ledger.runWithRequest({ service: 'web' }, () =>
      ledger.track({ provider: 'openai', model: 'gpt-6-sol' }, async () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; }).catch(() => {}));
    await settle();
    assert.strictEqual(rows[0].status, 'timeout');
    assert.strictEqual(rows[0].costUsd, null);
    assert.strictEqual(rows[0].costSource, 'unknown');
  });

  await test('an unknown model is unknown, not free; estimated usage is marked estimated', () => {
    assert.deepStrictEqual(pricing.costForUsage('some-new-model', { inTokens: 100, outTokens: 10 }), { costUsd: null, costSource: 'unknown', snapshot: null });
    assert.strictEqual(pricing.costForUsage('gpt-6-luna', { inTokens: 100, outTokens: 10, estimated: true }).costSource, 'estimated');
    assert.strictEqual(pricing.costForUsage('gpt-6-luna', { providerCostUsd: 0.0123 }).costSource, 'provider_reported');
  });

  await test('VoiceLab credits convert at $90 / 1,200,000 = $0.000075 a credit', () => {
    assert.ok(close(pricing.VOICELAB_CREDIT.usdPerCredit, 0.000075));
    const c = pricing.costForUsage('voicelab/tts', { credits: 1200000 });
    assert.ok(close(c.costUsd, 90));
    assert.strictEqual(c.snapshot.confirmation, 'owner_confirmed');
  });

  await test('STT and TTS in their own units: audio seconds, characters, credits', async () => {
    rows.length = 0;
    await ledger.runWithRequest({ service: 'telegram', chatId: 9 }, async () => {
      await ledger.track({ provider: 'voicelab', model: 'voicelab/stt', stage: 'stt' }, async (c) => { c.usage({ audioMs: 7300 }); return 'transcript'; });
      await ledger.track({ provider: 'voicelab', model: 'voicelab/tts', stage: 'tts' }, async (c) => { c.usage({ characters: 420, credits: 12, audioMs: 21000 }); });
    });
    await settle();
    const [stt, tts] = rows;
    assert.deepStrictEqual([stt.stage, stt.audioMs, stt.costUsd, stt.costSource], ['stt', 7300, null, 'unknown'], 'STT returns no credits: its cost is unknown, not assumed');
    assert.deepStrictEqual([tts.stage, tts.characters, tts.credits, tts.costSource], ['tts', 420, 12, 'calculated']);
    assert.ok(close(tts.costUsd, 12 * 0.000075));
  });

  await test('Gemini thinking tokens are billed as output; OpenAI cached/reasoning are not added twice', () => {
    assert.deepStrictEqual(ledger.usageFromGemini({ promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 30, thoughtsTokenCount: 20 }),
      { inTokens: 100, cachedTokens: 40, outTokens: 50, reasoningTokens: 20 });
    assert.deepStrictEqual(ledger.usageFromOpenAI({ input_tokens: 100, output_tokens: 50, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 30 } }),
      { inTokens: 100, outTokens: 50, cachedTokens: 40, reasoningTokens: 30 });
  });

  await test('parallel calls land on their own request', async () => {
    rows.length = 0;
    const one = (svc, n) => ledger.runWithRequest({ service: svc }, () => Promise.all(Array.from({ length: n }, (_, i) =>
      ledger.track({ provider: 'openai', model: 'gpt-6-luna' }, async (c) => { await new Promise(r => setTimeout(r, 5 * (n - i))); c.usage({ inTokens: 1, outTokens: 1 }); }))));
    await Promise.all([one('telegram', 3), one('web', 2)]);
    await settle();
    const byReq = new Map();
    for (const r of rows) byReq.set(r.requestId, [...(byReq.get(r.requestId) || []), r]);
    assert.deepStrictEqual([...byReq.values()].map(list => [list[0].service, list.length, new Set(list.map(r => r.seq)).size]).sort(), [['telegram', 3, 3], ['web', 2, 2]]);
  });

  await test('a ledger that cannot write never costs the user the answer, and the request is not "complete"', async () => {
    rows.length = 0;
    failWrites = true;
    let store;
    const result = await ledger.runWithRequest({ service: 'telegram' }, async (s) => {
      store = s;
      return ledger.track({ provider: 'openai', model: 'gpt-6-luna' }, async (c) => { c.usage({ inTokens: 1, outTokens: 1 }); return 'the answer'; });
    });
    await settle();
    failWrites = false;
    assert.strictEqual(result, 'the answer');
    assert.strictEqual(store.shared.telemetryErrors, 1);
    await ledger.finishRequest(store, { outcome: 'answered' });
    assert.strictEqual(requests.get(store.requestId).telemetryErrors, 1);
    const { completeness } = require('../src/ai/usage-report');
    assert.strictEqual(completeness({ unknown_cost_calls: 0, telemetry_errors: 1 }).complete, false);
  });

  await test('no secrets in a recorded error', async () => {
    rows.length = 0;
    await ledger.runWithRequest({ service: 'web' }, () => ledger.track({ provider: 'openai', model: 'gpt-6-luna' },
      async () => { throw new Error('401 Bearer sk-abcdefghijklmnop key=AIzaSyXXXXXXXXXXXX'); }).catch(() => {}));
    await settle();
    assert.ok(!/sk-abc|AIzaSy|Bearer sk/u.test(rows[0].errorMessage), rows[0].errorMessage);
  });

  await test('admin routes sit behind the master guard', async () => {
    const routes = [];
    const app = { get: (path, ...handlers) => routes.push({ path, handlers }) };
    const guard = (req, res) => res.status(403).json({ error: 'master only' });
    require('../src/ai/usage-report').mountUsageReportRoutes(app, { requireMasterAdmin: guard, pool: { query: async () => { throw new Error('must not run'); } } });
    assert.strictEqual(routes.length, 3);
    for (const r of routes) {
      assert.strictEqual(r.handlers[0], guard, r.path);
      let code = 200;
      r.handlers[0]({ session: { role: 'user' } }, { status: (c) => { code = c; return { json: () => {} }; } });
      assert.strictEqual(code, 403);
    }
  });

  // ── database ───────────────────────────────────────────────────────────
  if (!process.env.TEST_DATABASE_URL) {
    console.log('  (database part skipped: TEST_DATABASE_URL not set)');
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
  if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
    console.error('usage ledger: refusing to run against a hosted database');
    process.exit(1);
  }
  const { pool } = require('../src/database/db');
  const spendLog = require('../src/rag/llm-spend-log');
  await spendLog.initSpendLog();
  ledger.configure({ write: spendLog.writeLedgerRow, writeRequest: spendLog.writeRequestRow });
  const made = [];
  const cleanup = async () => {
    if (!made.length) return;
    await pool.query('DELETE FROM llm_spend_log WHERE request_id = ANY($1::uuid[])', [made]);
    await pool.query('DELETE FROM ai_requests WHERE request_id = ANY($1::uuid[])', [made]);
  };

  try {
    await test('database: a repeated event is one row; the stored cost keeps the price it was computed at', async () => {
      const callId = '11111111-1111-4111-8111-111111111111';
      let reqId;
      process.env.VOICELAB_PRICES = JSON.stringify({ 'aisha-comet': { in: 1, out: 1 } });
      await ledger.runWithRequest({ service: 'web' }, async (s) => {
        reqId = s.requestId; made.push(reqId);
        await ledger.record({ callId, provider: 'voicelab', model: 'voicelab/aisha-comet', status: 'success', usage: { inTokens: 1e6, outTokens: 0 } });
        await ledger.record({ callId, provider: 'voicelab', model: 'voicelab/aisha-comet', status: 'success', usage: { inTokens: 1e6, outTokens: 0 } });
        await ledger.finishRequest(s, { outcome: 'answered' });
      });
      process.env.VOICELAB_PRICES = JSON.stringify({ 'aisha-comet': { in: 5, out: 5 } });
      const { rows: stored } = await pool.query('SELECT cost_usd::float AS c, pricing FROM llm_spend_log WHERE call_id = $1', [callId]);
      delete process.env.VOICELAB_PRICES;
      assert.strictEqual(stored.length, 1);
      assert.strictEqual(stored[0].c, 1, 'the cost is the one computed at the old price');
      assert.strictEqual(stored[0].pricing.in, 1);
    });

    await test('database: per-request view and the daily report (known part, unknown count, average over complete requests only)', async () => {
      let complete, incomplete;
      await ledger.runWithRequest({ service: 'telegram', chatId: 5 }, async (s) => {
        complete = s.requestId; made.push(complete);
        await ledger.track({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/tg-agent/intent' }, async (c) => { c.usage({ inTokens: 1000, outTokens: 0 }); });
        await ledger.track({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/tg-agent/answer' }, async (c) => { c.usage({ inTokens: 1000, outTokens: 1000 }); });
        await settle();
        await ledger.finishRequest(s, { outcome: 'answered', legalCheck: { claimGuard: 'verified' } });
      });
      await ledger.runWithRequest({ service: 'telegram', chatId: 6 }, async (s) => {
        incomplete = s.requestId; made.push(incomplete);
        await ledger.track({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/tg-agent/answer' }, async (c) => { c.usage({ inTokens: 1000, outTokens: 0 }); });
        await ledger.track({ provider: 'voicelab', model: 'voicelab/stt', stage: 'stt' }, async (c) => { c.usage({ audioMs: 5000 }); });
        await settle();
        await ledger.finishRequest(s, { outcome: 'answered' });
      });
      const routes = {};
      require('../src/ai/usage-report').mountUsageReportRoutes({ get: (p, g, h) => { routes[p] = h; } }, { requireMasterAdmin: null, pool, ledger });
      const call = (path, req) => new Promise((resolve) => routes[path]({ query: {}, params: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }));

      const one = await call('/api/admin/ai-usage/requests/:id', { params: { id: complete } });
      assert.deepStrictEqual(one.summary.model_sequence.map(m => m.stage), ['intent', 'answer']);
      assert.strictEqual(one.summary.complete, true);
      assert.ok(close(one.summary.known_cost_usd, (1000 * 0.1 + 1000 * 0.1 + 1000 * 0.5) / 1e6));
      assert.strictEqual(one.request.legal_check.claimGuard, 'verified');
      assert.ok(one.request.latency_ms >= 0);

      const two = await call('/api/admin/ai-usage/requests/:id', { params: { id: incomplete } });
      assert.strictEqual(two.summary.complete, false);
      assert.strictEqual(two.summary.unknown_cost_calls, 1);

      const list = await call('/api/admin/ai-usage/requests', { query: { service: 'telegram' } });
      const mine = list.requests.filter(r => [complete, incomplete].includes(r.request_id));
      assert.strictEqual(mine.length, 2);
      assert.deepStrictEqual(mine.find(r => r.request_id === complete).models, ['gpt-6-luna', 'gpt-6-luna']);

      // report days are Tashkent's (UTC+5), not UTC
      const today = require('../src/ai/usage-report').tashkentDate();
      const report = await call('/api/admin/ai-usage/report', { query: { period: 'day', from: today, to: today } });
      const p = report.periods.find(x => x.period === today);
      assert.ok(p.unknown_cost_calls >= 1);
      assert.strictEqual(p.cost_complete, false, 'a day with an unknown-cost call is not shown as complete');
      assert.ok(p.average_basis.included_request_ids.includes(complete));
      assert.ok(!p.average_basis.included_request_ids.includes(incomplete), 'an incomplete request is not averaged as if its cost were known');
      assert.ok(p.average_basis.excluded_incomplete_requests >= 1);
      assert.ok(p.by_model.length >= 1 && p.by_service.length >= 1);
    });

    await test('database: Tashkent day boundary; skipped calls are not unknown cost; retries, fallbacks and failures counted apart', async () => {
      // 19:30 UTC on 1 Jan is already 2 Jan in Tashkent (a date far from real rows)
      const at = new Date('2031-01-01T19:30:00Z');
      const later = new Date('2031-01-01T19:30:01Z');
      let reqId;
      await ledger.runWithRequest({ service: 'telegram' }, async (s) => {
        reqId = s.requestId; made.push(reqId);
        const base = { provider: 'openai', model: 'gpt-6-luna', endpoint: '/tg-agent/answer', startedAt: at, finishedAt: later };
        const run = '22222222-2222-4222-8222-222222222222';
        await ledger.record({ ...base, callId: '22222222-2222-4222-8222-000000000001', stageRunId: run, status: 'error', errorCode: 'HTTP_429_RATE', errorKind: 'transient', usage: {} });
        await ledger.record({ ...base, callId: '22222222-2222-4222-8222-000000000002', stageRunId: run, parentCallId: '22222222-2222-4222-8222-000000000001', attempt: 2, retryReason: 'transient:HTTP_429_RATE', status: 'success', usage: { inTokens: 100, outTokens: 100 } });
        await ledger.record({ ...base, callId: '22222222-2222-4222-8222-000000000003', provider: 'huggingface', model: 'BAAI/bge-reranker-v2-m3', stage: 'rerank', status: 'skipped', errorCode: 'CIRCUIT_OPEN', errorKind: 'skipped', usage: {} });
        await ledger.record({ ...base, callId: '22222222-2222-4222-8222-000000000004', provider: 'google', model: 'gemini-2.5-flash', fallbackFrom: 'gpt-6-sol', status: 'success', usage: { inTokens: 100, outTokens: 100 } });
        await ledger.finishRequest(s, { outcome: 'answered' });
      });
      const routes = {};
      require('../src/ai/usage-report').mountUsageReportRoutes({ get: (p, g, h) => { routes[p] = h; } }, { requireMasterAdmin: null, pool, ledger });
      const call = (p, req) => new Promise((resolve) => routes[p]({ query: {}, params: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }));
      const utcDay = await call('/api/admin/ai-usage/report', { query: { period: 'day', from: '2031-01-01', to: '2031-01-01' } });
      assert.strictEqual(utcDay.periods.length, 0, 'not on the UTC day');
      const day = await call('/api/admin/ai-usage/report', { query: { period: 'day', from: '2031-01-02', to: '2031-01-02' } });
      assert.strictEqual(day.timezone, 'Asia/Tashkent');
      const p = day.periods[0];
      assert.strictEqual(p.period, '2031-01-02');
      assert.deepStrictEqual(
        [p.calls, p.skipped_calls, p.failed_calls, p.retry_calls, p.fallback_calls],
        [3, 1, 1, 1, 1]);
      assert.strictEqual(p.unknown_cost_calls, 1, 'the failed attempt; the skipped call has no cost to know');
      const one = await call('/api/admin/ai-usage/requests/:id', { params: { id: reqId } });
      assert.ok(one.calls.some(c => c.error_kind === 'transient' && c.stage_run_id === '22222222-2222-4222-8222-222222222222'));
    });
  } finally {
    await cleanup();
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
