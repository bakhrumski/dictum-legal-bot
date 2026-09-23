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
  'text-embedding-3-small': Object.freeze({ in: 0.02, out: 0, cached: 0.02 }),
});

/**
 * VoiceLab prices are read from the environment rather than written here,
 * because they are billed in their own contract terms and change without a
 * public price page this file could cite. VOICELAB_PRICES is JSON in USD per
 * 1M tokens, keyed by VoiceLab model id:
 *   {"comet":{"in":0.1,"out":0.4},"orbit":{"in":1,"out":4},"halo":{"in":2,"out":8}}
 * Calls are logged as 'voicelab/<model>'. A model with no price here returns
 * null like any unknown model, so it is never silently reported as free.
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
  const pricing = MODEL_PRICING[String(model || '').toLowerCase()] || voicelabPricing(model);
  if (!pricing) return null;

  const input = normalizeCount(inTokens);
  const output = normalizeCount(outTokens);
  const cached = Math.min(input, normalizeCount(cachedTokens));
  const fresh = Math.max(0, input - cached);

  return (fresh / 1e6) * pricing.in
    + (cached / 1e6) * (pricing.cached != null ? pricing.cached : pricing.in)
    + (output / 1e6) * pricing.out;
}

module.exports = { MODEL_PRICING, calculateTokenCost };
