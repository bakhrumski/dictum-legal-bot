'use strict';

const assert = require('assert');
const { MODEL_PRICING, calculateTokenCost } = require('../src/ai/model-pricing');

assert.deepStrictEqual(MODEL_PRICING['gpt-5.6-terra'], { in: 2, out: 12, cached: 0.2 });
assert.deepStrictEqual(MODEL_PRICING['gpt-5.6-luna'], { in: 0.2, out: 1.2, cached: 0.02 });
assert.deepStrictEqual(MODEL_PRICING['gemini-2.5-flash'], { in: 0.3, out: 2.5, cached: 0.03 });

const typicalFreeTextTelegram =
  calculateTokenCost('gpt-5.6-luna', { inTokens: 700, outTokens: 20 })
  + calculateTokenCost('gpt-5.6-terra', { inTokens: 900, outTokens: 10 })
  + calculateTokenCost('gpt-5.6-luna', { inTokens: 4000, outTokens: 500 });

assert.ok(Math.abs(typicalFreeTextTelegram - 0.003484) < 1e-12);
assert.strictEqual(calculateTokenCost('unknown-provider-model', { inTokens: 1000 }), null);
assert.strictEqual(calculateTokenCost('gpt-5.6-luna', { inTokens: 1000, cachedTokens: 1000 }), 0.00002);

console.log('\nmodel-pricing — 6 passed, 0 failed\n');
