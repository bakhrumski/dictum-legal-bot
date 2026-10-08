'use strict';

/**
 * The request budget under parallel calls (2026-10-08, #421 review): the
 * long-document digest runs up to 8 calls at once and re-reads cut parts.
 * Checked with stub providers and an in-memory ledger - no paid call:
 *   - calls started at the same moment cannot together pass the call limit
 *     (the check and the slot are one synchronous step);
 *   - a call's cost bound, or the list-price plan figure when there is no
 *     bound (VoiceLab bills credits), is reserved before it starts;
 *   - after the time limit no new call starts; calls already running finish
 *     and their usage is written, even after the request has answered;
 *   - a call that times out is a row with unknown cost (NULL), never $0.
 *
 *   node tests/digest-budget.test.js
 */

const assert = require('assert');
const usage = require('../src/ai/usage-ledger');
const ex = require('../src/rag/document-explain');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const rows = [];
usage.configure({ write: async (r) => { rows.push(r); }, writeRequest: async () => {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rowsOf = id => rows.filter(r => r.requestId === id);

// a provider call through the ledger, as the adapters make it
function stubCall({ ms = 30, planUsd = null, boundUsd = null, model = 'gpt-6-luna', truncated = false, fail = null, stage = 'document_digest' } = {}) {
  return usage.track({ provider: 'stub', model, endpoint: '/api/draft/doc-digest', stage, planUsd,
    bound: boundUsd == null ? { usd: null, reason: 'credits' } : { usd: boundUsd } }, async (call) => {
    await sleep(ms);
    if (fail) throw fail;
    call.usage({ inTokens: 3000, outTokens: 600, finishReason: truncated ? 'length' : 'stop', truncated });
    return { text: '- band', truncated, provider: 'stub' };
  });
}

(async () => {
  console.log('request budget under parallel calls (stub providers, in-memory ledger):');

  await test('8 calls started at once against a limit of 5: exactly 5 run, 3 are skipped rows', async () => {
    let id;
    await usage.runWithRequest({ service: 'web', budget: { maxCalls: 5 } }, async (store) => {
      id = store.requestId;
      // a helper stage: no essential reserve on top of the limit
      const res = await Promise.allSettled(Array.from({ length: 8 }, () => stubCall({ stage: 'intent' })));
      assert.strictEqual(res.filter(r => r.status === 'fulfilled').length, 5);
      assert.ok(res.filter(r => r.status === 'rejected').every(r => r.reason.code === 'REQUEST_BUDGET'));
      assert.strictEqual(store.shared.callsInFlight, 0, 'every slot given back');
    });
    const mine = rowsOf(id);
    assert.deepStrictEqual([mine.filter(r => r.status === 'success').length, mine.filter(r => r.status === 'skipped').length], [5, 3]);
  });

  await test('cost: the bound (or the list-price plan figure) of running calls is reserved - 8 parallel $0.005 calls under $0.02 -> 4 run', async () => {
    for (const kind of ['bound', 'plan']) {
      let id;
      await usage.runWithRequest({ service: 'web', budget: { maxCostUsd: 0.02 } }, async (store) => {
        id = store.requestId;
        const opts = kind === 'bound' ? { boundUsd: 0.005 } : { planUsd: 0.005 };
        const res = await Promise.allSettled(Array.from({ length: 8 }, () => stubCall(opts)));
        assert.strictEqual(res.filter(r => r.status === 'fulfilled').length, 4, kind);
        assert.ok(res.filter(r => r.status === 'rejected').every(r => /cost limit/u.test(r.reason.message)), kind);
        assert.ok(store.shared.costInFlightUsd < 1e-9);
      });
      assert.strictEqual(rowsOf(id).filter(r => r.status === 'skipped').length, 4);
    }
  });

  await test('a call with neither a bound nor a plan figure still takes a call slot; its cost is only known when it ends (no reservation)', async () => {
    await usage.runWithRequest({ service: 'web', budget: { maxCalls: 2, maxCostUsd: 0.000001 } }, async () => {
      const res = await Promise.allSettled(Array.from({ length: 4 }, () => stubCall({ stage: 'intent' })));
      // the cost limit cannot stop calls whose cost is unknown before they run: only the call limit does
      assert.strictEqual(res.filter(r => r.status === 'fulfilled').length, 2);
    });
  });

  await test('the long-document digest under a call limit: parts beyond it are skipped rows and count as not read; no unbounded retry', async () => {
    // 13 parts, 8 at a time; the digest stage is essential: limit = maxCalls 1 + reserve 6 = 7
    const text = 'x'.repeat(120000);
    let d, id;
    await usage.runWithRequest({ service: 'web', budget: { maxCalls: 1, essentialReserve: 6 } }, async (store) => {
      id = store.requestId;
      d = await ex.buildDigest(text, { callAI: () => stubCall({ ms: 20 }) });
    });
    assert.strictEqual(d.parts.length, 13);
    assert.strictEqual(d.readParts, 7, 'the first wave of 8 started together: only 7 got a slot');
    assert.strictEqual(d.failed.length, 6);
    assert.strictEqual(rowsOf(id).length, 13, '7 calls + 6 skipped, nothing more');
    assert.strictEqual(rowsOf(id).filter(r => r.status === 'success').length, 7);
  });

  await test('time: after the request limit no call starts; calls already running finish and are written with their cost', async () => {
    const text = 'x'.repeat(120000); // 13 parts, 8 at a time: the second wave starts after the limit
    let d, id;
    await usage.runWithRequest({ service: 'web', budget: { maxMs: 60 } }, async (store) => {
      id = store.requestId;
      d = await ex.buildDigest(text, { callAI: () => stubCall({ ms: 90 }) });
    });
    const mine = rowsOf(id);
    assert.strictEqual(d.readParts, 8, 'the first wave, already running, finished');
    assert.strictEqual(mine.filter(r => r.status === 'success').length, 8);
    assert.ok(mine.filter(r => r.status === 'success').every(r => r.costUsd > 0 && r.costSource === 'calculated'));
    assert.strictEqual(mine.filter(r => r.status === 'skipped').length, 5);
    assert.ok(mine.filter(r => r.status === 'skipped').every(r => /time limit/u.test(r.errorMessage)));
    // the final explanation would not start either: no part of a skipped wave is read, the service is partial (released)
    assert.strictEqual(ex.coverageStatus(d), 'some_excluded');
  });

  await test('the digest\'s own 75 s limit only stops re-reads from starting; a running part is not cut off', async () => {
    const d = await ex.buildDigest('x'.repeat(30000), { callAI: async () => { await sleep(30); return { text: 'x', truncated: true }; }, limits: { timeMs: 10 } });
    assert.strictEqual(d.extraCalls, 0);
    assert.ok(d.parts.every(p => p.status === 'cut'), 'the parts started before the limit came back');
  });

  await test('a call that times out is a row with unknown cost (NULL, not $0); its usage, when the provider reports it, is kept', async () => {
    let id;
    await usage.runWithRequest({ service: 'web', budget: { maxMs: 20 } }, async (store) => {
      id = store.requestId;
      // started inside the limit, it times out after the limit has passed: the transient retry is refused
      await stubCall({ ms: 30, fail: Object.assign(new Error('VoiceLab x timed out after 120000ms'), { code: 'TIMEOUT' }) }).catch(() => {});
    });
    const mine = rowsOf(id);
    const t = mine.find(r => r.status === 'timeout');
    assert.ok(t, JSON.stringify(mine.map(r => r.status)));
    assert.strictEqual(t.costUsd, null);
    assert.strictEqual(t.costSource, 'unknown');
    assert.ok(!mine.some(r => r.status === 'timeout' && r.attempt > 1), 'no retry after the time limit');
  });

  await test('a call still running when the request has answered is written when it ends, under the same request', async () => {
    let id, pending;
    await usage.runWithRequest({ service: 'web' }, async (store) => {
      id = store.requestId;
      pending = stubCall({ ms: 60 }); // the response goes out before it ends
    });
    assert.strictEqual(rowsOf(id).length, 0);
    await pending;
    await sleep(5);
    const late = rowsOf(id);
    assert.strictEqual(late.length, 1);
    assert.ok(late[0].costUsd > 0 && late[0].status === 'success');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
