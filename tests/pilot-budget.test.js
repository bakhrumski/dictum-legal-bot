'use strict';

/**
 * Pilot budget accuracy (2026-10-06), no database and no provider:
 *   - the most one call can cost (callCostBound): known price, input bound,
 *     an output cap that also caps reasoning - else null with the reason;
 *   - under a per-call pool every attempt reserves its bound before the
 *     provider is called: parallel calls, the last call, a transient retry,
 *     an adapter's own retry and a fallback each need room; a call with no
 *     bound is refused ('strict') or runs as stated risk ('estimated').
 *
 *   node tests/pilot-budget.test.js
 */

const assert = require('assert');
const pricing = require('../src/ai/model-pricing');
const usage = require('../src/ai/usage-ledger');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const strict = (limitUsd) => ({ label: 'pilot', limitUsd, spentUsd: 0, unknownCallUsd: 0.05, perCall: 'strict' });
// a priced call: gpt-6-luna input at $0.10 / 1M -> 1e5 tokens = $0.01
const priced = (tokens, onCall) => async (ctx) => { if (onCall) onCall(); ctx.usage({ inTokens: tokens, outTokens: 0 }); return { text: 'ok' }; };
const meta = (usd, extra = {}) => ({ provider: 'openai', model: 'gpt-6-luna', endpoint: '/api/legal-chat', stage: 'answer', bound: { usd }, ...extra });
const inRequest = (pool, fn) => usage.runWithRequest({ service: 'web' }, async (store) => { store.budget.sharedPool = pool; return fn(store); });

(async () => {
  console.log('the most one call can cost');

  await test('known price + input bound + output cap (reasoning included); GPT-6 doubled for long-context billing', () => {
    const msgs = [{ role: 'user', text: 'Ish haqi kechiksa nima qilaman?' }];
    const inMax = pricing.inputTokenBound(msgs);
    assert.strictEqual(inMax, 64 + Buffer.byteLength(msgs[0].text, 'utf8') + 16, 'UTF-8 bytes bound byte-level BPE tokens');
    const b = pricing.callCostBound({ model: 'gpt-6-sol', inputTokensMax: inMax, outputTokensMax: 8192 });
    assert.ok(Math.abs(b.usd - ((inMax * 2 + 8192 * 10) / 1e6) * 2) < 1e-12);
    assert.deepStrictEqual([b.basis.multiplier, b.basis.priceSource.startsWith('OpenAI')], [2, true]);
    assert.ok(b.usd > 0.16, 'one gpt-6-sol answer call can cost $0.16+ - most of a $0.25 request limit');
    const emb = pricing.callCostBound({ model: 'text-embedding-3-small', inputTokensMax: 1000, outputTokensMax: 0, inputOnly: true });
    assert.ok(Math.abs(emb.usd - 1000 * 0.02 / 1e6) < 1e-15);
  });

  await test('no bound - and the reason - where it cannot be proven', () => {
    const cases = [
      [{ model: 'unknown-model', inputTokensMax: 10, outputTokensMax: 10 }, /no price/u],
      [{ model: 'gpt-6-luna', inputTokensMax: null, outputTokensMax: 10 }, /input size/u],
      [{ model: 'gpt-6-luna', inputTokensMax: 10, outputTokensMax: null }, /no output cap/u],
      [{ model: 'gemini-2.5-flash', thinkingUncapped: true }, /thinking tokens/u],
      [{ model: 'gpt-6-luna', inputTokensMax: 10, outputTokensMax: 10, webSearch: true }, /web search/u],
      [{ model: 'voicelab/aisha-comet', creditBilling: true }, /credits/u],
    ];
    for (const [args, re] of cases) {
      const b = pricing.callCostBound(args);
      assert.strictEqual(b.usd, null, JSON.stringify(args));
      assert.match(b.reason, re);
    }
    assert.strictEqual(pricing.inputTokenBound([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:' } }] }]), null, 'an image has no token bound');
  });

  await test('every provider call site states its bound or why it has none', () => {
    const fs = require('fs');
    const path = require('path');
    const files = ['src/api/server.js', 'src/rag/hybrid-pipeline.js', 'src/rag/embeddings.js', 'src/rag/reranker.js', 'src/ocr/routes.js', 'src/ai/voicelab-speech.js'];
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      const sites = [...src.matchAll(/usageLedger\.track\(/gu)];
      for (const m of sites) {
        const window = src.slice(m.index, m.index + 700);
        assert.match(window, /bound:/u, `${f} @${m.index}: a provider call without a bound`);
      }
    }
  });

  console.log('per-call reservation');

  await test('parallel calls: each reserves before its call; the one that does not fit is never made', async () => {
    let calls = 0;
    await inRequest(strict(0.10), async () => {
      const r = await Promise.allSettled([
        usage.track(meta(0.06), priced(1e5, () => calls++)),
        usage.track(meta(0.06), priced(1e5, () => calls++)),
      ]);
      assert.deepStrictEqual(r.map(x => x.status).sort(), ['fulfilled', 'rejected']);
      assert.match(r.find(x => x.status === 'rejected').reason.message, /not called: call reservation \$0\.0600 exceeds/u);
    });
    assert.strictEqual(calls, 1);
  });

  await test('the last call: refused when its bound does not fit, instead of overshooting (the old check allowed it)', async () => {
    let calls = 0;
    await inRequest(strict(0.10), async (store) => {
      await usage.track(meta(0.06), priced(5e5, () => calls++));        // costs $0.05
      assert.ok(Math.abs(store.shared.knownCostUsd - 0.05) < 1e-12);
      await assert.rejects(usage.track(meta(0.06), priced(5e5, () => calls++)), /call reservation/u, '$0.05 + $0.06 > $0.10');
      assert.ok(store.shared.knownCostUsd <= 0.10);
    });
    assert.strictEqual(calls, 1);
    // without per-call reservation (the earlier mechanism) the same call is made and overshoots
    let oldCalls = 0;
    await inRequest({ ...strict(0.10), perCall: undefined }, async (store) => {
      await usage.track(meta(0.06), priced(5e5, () => oldCalls++));
      await usage.track(meta(0.06), priced(9e5, () => oldCalls++));
      assert.ok(store.shared.knownCostUsd > 0.10, `overshoot shown: $${store.shared.knownCostUsd}`);
    });
    assert.strictEqual(oldCalls, 2);
  });

  await test('a transient retry reserves again; refused when the failed attempt\'s billed cost left no room', async () => {
    let attempts = 0;
    await inRequest(strict(0.10), async () => {
      await assert.rejects(usage.track(meta(0.06), async (ctx) => {
        attempts++;
        ctx.usage({ inTokens: 5e5, outTokens: 0 });                  // the failed attempt was billed $0.05
        throw Object.assign(new Error('upstream 503'), { status: 503 });
      }), /not called: call reservation/u);
    });
    assert.strictEqual(attempts, 1, 'the retry was not made: $0.05 billed + $0.06 > $0.10');
    let ok = 0;
    await inRequest(strict(0.20), async () => {
      let first = true;
      await usage.track(meta(0.06), async (ctx) => {
        ok++;
        ctx.usage({ inTokens: 5e5, outTokens: 0 });
        if (first) { first = false; throw Object.assign(new Error('upstream 503'), { status: 503 }); }
        return { text: 'ok' };
      });
    });
    assert.strictEqual(ok, 2, 'with room, the retry reserved and ran');
  });

  await test('an adapter\'s own retry (call.retry) reserves again', async () => {
    let attempts = 0;
    await inRequest(strict(0.10), async () => {
      await assert.rejects(usage.track(meta(0.06), async (ctx) => {
        attempts++;
        ctx.usage({ inTokens: 5e5, outTokens: 0 });
        await ctx.retry('drop a rejected parameter', new Error('400 unsupported parameter'));
        attempts++;                                                    // never reached: the retry was refused
        return { text: 'ok' };
      }), /call reservation/u);
    });
    assert.strictEqual(attempts, 1);
  });

  await test('a fallback is its own call and needs its own room', async () => {
    let a = 0, b = 0;
    await inRequest(strict(0.10), async () => {
      // the first provider fails for good (its own circuit opens: a different model here)
      await assert.rejects(usage.track(meta(0.06, { model: 'gpt-6-astra' }), async (ctx) => { a++; ctx.usage({ inTokens: 5e3, outTokens: 0 }); throw Object.assign(new Error('400 bad'), { status: 400 }); }));
      // astra billed $0.05 (5e3 tokens x $10/1M); the fallback's $0.06 no longer fits
      await assert.rejects(usage.track(meta(0.06), priced(1e5, () => b++)), /call reservation/u);
    });
    assert.deepStrictEqual([a, b], [1, 0]);
  });

  await test('a call with no proven bound: refused in strict mode; in estimated mode it runs and is counted as risk', async () => {
    let calls = 0;
    await inRequest(strict(1), async () => {
      await assert.rejects(usage.track({ ...meta(null), bound: { usd: null, reason: 'thinking tokens are not capped by the output limit' } }, priced(1, () => calls++)),
        /not called: no upper cost bound \(thinking tokens/u);
    });
    assert.strictEqual(calls, 0);
    await inRequest({ ...strict(1), perCall: 'estimated', unboundedCallUsd: 0.02 }, async (store) => {
      await usage.track({ ...meta(null), bound: { usd: null, reason: 'x' } }, priced(1, () => calls++));
      assert.deepStrictEqual([store.shared.estimatedRiskCalls, store.shared.estimatedRiskUsd], [1, 0.02]);
    });
    assert.strictEqual(calls, 1);
  });

  await test('a call whose cost comes back unknown counts at its full reservation; a bound that was too low is flagged', async () => {
    await inRequest(strict(0.10), async (store) => {
      await usage.track({ ...meta(0.04), model: 'no-such-price' }, async (ctx) => { ctx.usage({ inTokens: 10, outTokens: 10 }); return {}; });
      assert.ok(Math.abs(usage.sharedPoolCommitted(store) - 0.04) < 1e-12, 'unknown cost counted at $0.04, not $0');
      await usage.track(meta(0.001), priced(5e5));                       // $0.05 against a $0.001 bound
      assert.strictEqual(store.shared.boundExceeded, 1);
    });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
