'use strict';

/**
 * Standard API prices in USD per 1M tokens.
 *
 * Keep this module deliberately small and provider-neutral: the request
 * routers, spend log, Hermes shadow report, and tests all use one source of
 * truth instead of silently drifting apart.
 *
 * Sources checked 2026-08-11:
 * - https://developers.openai.com/api/docs/models/compare
 * - https://ai.google.dev/gemini-api/docs/pricing
 */
const MODEL_PRICING = Object.freeze({
  'gpt-5.6-sol':      Object.freeze({ in: 5.00, out: 30.00, cached: 0.50 }),
  'gpt-5.6':          Object.freeze({ in: 5.00, out: 30.00, cached: 0.50 }),
  'gpt-5.6-terra':    Object.freeze({ in: 2.00, out: 12.00, cached: 0.20 }),
  'gpt-5.6-luna':     Object.freeze({ in: 0.20, out:  1.20, cached: 0.02 }),
  'gemini-2.5-flash': Object.freeze({ in: 0.30, out:  2.50, cached: 0.03 }),
  // GPT-6, Standard processing, short-context rates (OpenAI pricing page,
  // checked 2026-09-23). Long-context requests bill at roughly double; this
  // table does not model that, so long prompts are under-reported here.
  'gpt-6-astra':      Object.freeze({ in: 10.00, out: 50.00, cached: 1.00 }),
  'gpt-6-sol':        Object.freeze({ in:  2.00, out: 10.00, cached: 0.20 }),
  'gpt-6-luna':       Object.freeze({ in:  0.10, out:  0.50, cached: 0.01 }),
  'text-embedding-3-small': Object.freeze({ in: 0.02, out: 0, cached: 0.02 }),
  // VoiceLab list prices from the VoiceLab console, checked 2026-09-23. These
  // are the undiscounted rates on purpose: a trial bought at a discount has to
  // be judged at the price the platform would pay after it.
  'voicelab/aisha-comet': Object.freeze({ in: 0.45, out:  0.70, cached: null }),
  'voicelab/aisha-orbit': Object.freeze({ in: 1.20, out:  4.20, cached: null }),
  'voicelab/aisha-halo':  Object.freeze({ in: 3.20, out: 12.70, cached: null }),
});

/**
 * VoiceLab calls are logged as 'voicelab/<model>'. The table above carries
 * the list prices; VOICELAB_PRICES (JSON, USD per 1M tokens, keyed by
 * VoiceLab model id) overrides them without a deploy when VoiceLab reprices:
 *   {"aisha-comet":{"in":0.45,"out":0.70}}
 * A model priced in neither place returns null like any unknown model, so it
 * is never silently reported as free.
 */
function voicelabPricing(model) {
  const m = /^voicelab\/(.+)$/i.exec(String(model || ''));
  if (!m) return null;
  let table;
  try { table = JSON.parse(process.env.VOICELAB_PRICES || '{}'); } catch (_) { return null; }
  const entry = table && table[m[1].toLowerCase()];
  if (!entry || !Number.isFinite(Number(entry.in)) || !Number.isFinite(Number(entry.out))) return null;
  return {
    in: Number(entry.in),
    out: Number(entry.out),
    cached: Number.isFinite(Number(entry.cached)) ? Number(entry.cached) : null,
  };
}

function normalizeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * Calculate token cost for a known model. Returns null for an unknown model
 * so an externally hosted Hermes model is never misleadingly reported as
 * free merely because its provider price is not configured here.
 */
function calculateTokenCost(model, { inTokens = 0, outTokens = 0, cachedTokens = 0 } = {}) {
  const pricing = voicelabPricing(model) || MODEL_PRICING[String(model || '').toLowerCase()] || overridePricing(model);
  if (!pricing) return null;

  const input = normalizeCount(inTokens);
  const output = normalizeCount(outTokens);
  const cached = Math.min(input, normalizeCount(cachedTokens));
  const fresh = Math.max(0, input - cached);

  return (fresh / 1e6) * pricing.in
    + (cached / 1e6) * (pricing.cached != null ? pricing.cached : pricing.in)
    + (output / 1e6) * pricing.out;
}

// ── Where each price comes from (2026-10-03) ─────────────────────────────────
// A row's cost is stored with a snapshot of the price it was computed from, so
// a later price change never rewrites an old request's cost. Prices are USD
// per 1M tokens; "confirmation" says who stands behind the number.
const PRICING_SOURCES = Object.freeze({
  openai_2026_08_11: { source: 'https://developers.openai.com/api/docs/models/compare', effectiveFrom: null, checkedAt: '2026-08-11', confirmation: 'official_list' },
  openai_2026_09_23: { source: 'OpenAI pricing page, Standard processing, short context', effectiveFrom: null, checkedAt: '2026-09-23', confirmation: 'official_list' },
  gemini_2026_08_11: { source: 'https://ai.google.dev/gemini-api/docs/pricing (paid tier; the free tier bills $0)', effectiveFrom: null, checkedAt: '2026-08-11', confirmation: 'official_list' },
  voicelab_2026_09_23: { source: 'VoiceLab console list prices', effectiveFrom: null, checkedAt: '2026-09-23', confirmation: 'provider_console' },
});

const PRICE_SOURCE_OF = Object.freeze({
  'gpt-5.6-sol': 'openai_2026_08_11', 'gpt-5.6': 'openai_2026_08_11', 'gpt-5.6-terra': 'openai_2026_08_11', 'gpt-5.6-luna': 'openai_2026_08_11',
  'gemini-2.5-flash': 'gemini_2026_08_11',
  'gpt-6-astra': 'openai_2026_09_23', 'gpt-6-sol': 'openai_2026_09_23', 'gpt-6-luna': 'openai_2026_09_23',
  'text-embedding-3-small': 'openai_2026_08_11',
  'voicelab/aisha-comet': 'voicelab_2026_09_23', 'voicelab/aisha-orbit': 'voicelab_2026_09_23', 'voicelab/aisha-halo': 'voicelab_2026_09_23',
});

/**
 * VoiceLab credits -> USD at the owner's purchase: 1,200,000 credits for $90
 * (confirmed 2026-10-03), $0.000075 a credit. This converts credits the
 * provider REPORTS; how many credits a model, STT or TTS call uses is not
 * assumed here. VOICELAB_CREDIT_USD overrides it after a new purchase.
 */
const VOICELAB_CREDIT = Object.freeze({
  usdPerCredit: 90 / 1200000,
  source: 'owner-confirmed purchase: 1,200,000 credits = $90',
  checkedAt: '2026-10-03',
  confirmation: 'owner_confirmed',
});

function voicelabCreditUsd() {
  const override = Number(process.env.VOICELAB_CREDIT_USD);
  return Number.isFinite(override) && override > 0
    ? { ...VOICELAB_CREDIT, usdPerCredit: override, source: 'VOICELAB_CREDIT_USD', confirmation: 'env_override' }
    : VOICELAB_CREDIT;
}

/**
 * Owner-confirmed prices for models this table does not carry (2026-10-04:
 * gemini-embedding-001's price could not be checked from here), as JSON in
 * AI_PRICE_OVERRIDES, USD per 1M tokens:
 *   {"gemini-embedding-001":{"in":0.15,"out":0,"source":"ai.google.dev/pricing","checkedAt":"2026-10-04"}}
 * Without an entry the model's cost stays unknown.
 */
function overridePricing(model) {
  let table;
  try { table = JSON.parse(process.env.AI_PRICE_OVERRIDES || '{}'); } catch (_) { return null; }
  const e = table && table[String(model || '').toLowerCase()];
  if (!e || !Number.isFinite(Number(e.in))) return null;
  return {
    in: Number(e.in), out: Number.isFinite(Number(e.out)) ? Number(e.out) : 0,
    cached: Number.isFinite(Number(e.cached)) ? Number(e.cached) : null,
    source: e.source ? String(e.source).slice(0, 200) : 'AI_PRICE_OVERRIDES',
    checkedAt: e.checkedAt ? String(e.checkedAt).slice(0, 20) : null,
  };
}

/** The price a token cost is computed from, as stored with the row, or null. */
function pricingSnapshot(model) {
  const key = String(model || '').toLowerCase();
  const override = voicelabPricing(model);
  const custom = override ? null : overridePricing(model);
  const table = MODEL_PRICING[key];
  const price = override || table || custom;
  if (!price) return null;
  const meta = custom && !table
    ? { source: custom.source, effectiveFrom: null, checkedAt: custom.checkedAt, confirmation: 'owner_confirmed' }
    : override
    ? { source: 'VOICELAB_PRICES', effectiveFrom: null, checkedAt: null, confirmation: 'env_override' }
    : (PRICING_SOURCES[PRICE_SOURCE_OF[key]] || { source: null, effectiveFrom: null, checkedAt: null, confirmation: 'unknown' });
  return {
    model: key, unit: 'USD per 1M tokens', currency: 'USD',
    in: price.in, out: price.out, cached: price.cached == null ? null : price.cached,
    ...meta,
  };
}

/**
 * The cost of one recorded call and where it came from:
 *   provider_reported — the provider returned the cost;
 *   calculated        — provider-reported usage (tokens, or VoiceLab credits)
 *                       times a price with a known source;
 *   estimated         — usage itself was estimated (e.g. characters / 4);
 *   unknown           — no usage, or no price: cost_usd stays null, never $0.
 * Token rules: cached input is part of input (billed at the cached rate);
 * reasoning tokens are part of output and are not added again.
 */
function costForUsage(model, usage = {}) {
  const u = usage || {};
  if (Number.isFinite(Number(u.providerCostUsd)) && u.providerCostUsd !== null && u.providerCostUsd !== undefined) {
    return { costUsd: Number(u.providerCostUsd), costSource: 'provider_reported', snapshot: { basis: 'provider-reported cost', currency: 'USD' } };
  }
  if (Number.isFinite(Number(u.credits)) && u.credits !== null && u.credits !== undefined) {
    const rate = voicelabCreditUsd();
    return {
      costUsd: Number(u.credits) * rate.usdPerCredit,
      costSource: 'calculated',
      snapshot: { basis: 'provider-reported VoiceLab credits x credit rate', unit: 'USD per credit', currency: 'USD', usdPerCredit: rate.usdPerCredit, source: rate.source, checkedAt: rate.checkedAt, confirmation: rate.confirmation },
    };
  }
  const hasTokens = (u.inTokens != null && Number(u.inTokens) > 0) || (u.outTokens != null && Number(u.outTokens) > 0);
  const snapshot = pricingSnapshot(model);
  if (!hasTokens || !snapshot) return { costUsd: null, costSource: 'unknown', snapshot: snapshot || null };
  const costUsd = calculateTokenCost(model, { inTokens: u.inTokens, outTokens: u.outTokens, cachedTokens: u.cachedTokens });
  return { costUsd, costSource: u.estimated ? 'estimated' : 'calculated', snapshot };
}

// ── Upper bound of one call, before it is made (pilot budget, 2026-10-06) ──
// A strict budget can reserve a call's cost only if the call cannot cost
// more. That needs: a price with a known source; a hard cap on billed
// output (reasoning included); an upper bound on input tokens; and no
// billable part the table does not carry. Where any of these is missing the
// bound is null with the reason - never a guess.
//
//   - input: a byte-level BPE token is at least one UTF-8 byte, so the UTF-8
//     byte count of the text (plus a per-message overhead) bounds the input
//     tokens; an image, file or audio part has no such bound here;
//   - output: OpenAI Responses max_output_tokens caps visible output AND
//     reasoning; Gemini 2.5's maxOutputTokens does NOT cap its thinking
//     tokens (billed as output) - unbounded unless a thinking budget is set;
//   - VoiceLab may bill in credits whose rate per token is not confirmed -
//     its list price is not a proven upper bound;
//   - GPT-6 long-context requests bill at about double (not in the table):
//     the bound doubles every GPT-6 price;
//   - web search tool calls and their result tokens are billed on top and are
//     not priced here: unbounded.
const MESSAGE_OVERHEAD_TOKENS = 16;
const REQUEST_OVERHEAD_TOKENS = 64;
const BOUND_MULTIPLIER = Object.freeze({ 'gpt-6': 2 });

/** Upper bound on input tokens for text messages, or null (a non-text part). */
function inputTokenBound(messages) {
  if (!Array.isArray(messages)) return null;
  let n = REQUEST_OVERHEAD_TOKENS;
  for (const m of messages) {
    const content = m && (m.text != null ? m.text : m.content);
    if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || (part.type && !/^(text|input_text)$/u.test(part.type))) return null;
        n += Buffer.byteLength(String(part.text || ''), 'utf8');
      }
    } else if (content != null && typeof content !== 'string') {
      return null;
    } else {
      n += Buffer.byteLength(String(content || ''), 'utf8');
    }
    n += MESSAGE_OVERHEAD_TOKENS;
  }
  return n;
}

/**
 * The most one call can cost: { usd, basis } or { usd: null, reason }.
 * model: as logged ('gpt-6-luna', 'voicelab/aisha-comet', ...).
 * inputTokensMax: from inputTokenBound; outputTokensMax: the cap sent to the
 * provider (it must cap reasoning too); thinkingUncapped / webSearch /
 * creditBilling: billable parts this table cannot bound.
 */
function callCostBound({ model, inputTokensMax = null, outputTokensMax = null, thinkingUncapped = false, webSearch = false, creditBilling = false, inputOnly = false } = {}) {
  const key = String(model || '').toLowerCase();
  if (webSearch) return { usd: null, reason: 'web search calls and result tokens are not priced' };
  if (thinkingUncapped) return { usd: null, reason: 'thinking tokens are not capped by the output limit' };
  if (creditBilling) return { usd: null, reason: 'billed in provider credits; credits per token not confirmed' };
  const snap = pricingSnapshot(key);
  if (!snap) return { usd: null, reason: 'no price with a known source' };
  if (!Number.isFinite(Number(inputTokensMax)) || inputTokensMax == null) return { usd: null, reason: 'input size has no upper bound (non-text input)' };
  // an embedding bills input only (its output price is 0)
  if (inputOnly && Number(snap.out) === 0) outputTokensMax = 0;
  else if (!Number.isFinite(Number(outputTokensMax)) || outputTokensMax == null || outputTokensMax <= 0) return { usd: null, reason: 'no output cap sent to the provider' };
  const mult = Object.entries(BOUND_MULTIPLIER).reduce((m, [prefix, k]) => (key.startsWith(prefix) ? Math.max(m, k) : m), 1);
  const usd = ((Number(inputTokensMax) * snap.in + Number(outputTokensMax) * snap.out) / 1e6) * mult;
  return { usd, basis: { model: key, inputTokensMax: Number(inputTokensMax), outputTokensMax: Number(outputTokensMax), in: snap.in, out: snap.out, multiplier: mult, priceSource: snap.source, checkedAt: snap.checkedAt } };
}

module.exports = { MODEL_PRICING, PRICING_SOURCES, VOICELAB_CREDIT, calculateTokenCost, pricingSnapshot, costForUsage, voicelabCreditUsd, inputTokenBound, callCostBound };
