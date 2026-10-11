'use strict';

/**
 * Providers for the provider evaluation ONLY (scripts/provider-eval.js,
 * 2026-10-11). The server never requires this file: production routing,
 * RAG, tariffs, Telegram and VoiceLab settings are untouched.
 *
 * Isolation:
 *   - each provider's URL is fixed here (no *_BASE_URL override, nothing
 *     from the config file); a request goes only to its own host, with its
 *     own key, and never follows a redirect (`redirect: 'error'`), so a key
 *     cannot be carried to another host;
 *   - VoiceLab goes through the existing adapter (src/ai/voicelab.js) by its
 *     explicit id (`voicelab/<model>`: never falls back to another
 *     provider), and only when VOICELAB_BASE_URL is unset or the default;
 *   - guardNetwork() replaces fetch in the runner's process: a host not on
 *     the list is refused before any byte is sent; in a dry run the list is
 *     empty, so no request can leave the process at all.
 * Keys are read from the environment at call time and never logged: every
 * error text passes through redact() (the key values themselves and the
 * provider-health secret patterns).
 *
 * Usage (never double-counted): cached input is part of prompt_tokens,
 * reasoning is part of completion_tokens - a figure that contradicts that
 * (cached > prompt, reasoning > completion) or a missing prompt/completion
 * count makes the usage INCOMPLETE: no cost is made from it (never zeros
 * filled in). Whether a model bills reasoning inside completion_tokens is
 * a fact to confirm per model; until it is, a call that reports reasoning
 * has no known cost.
 */

const health = require('../../src/ai/provider-health');
const pricing = require('../../src/ai/model-pricing');
const voicelabAdapter = () => require('../../src/ai/voicelab');

const PROVIDERS = Object.freeze({
  voicelab: Object.freeze({ host: 'api.voicelab.uz', url: 'https://api.voicelab.uz/v1/chat/completions', secretEnv: 'VOICELAB_API_KEY', transport: 'voicelab-adapter' }),
  deepseek: Object.freeze({ host: 'api.deepseek.com', url: 'https://api.deepseek.com/chat/completions', secretEnv: 'DEEPSEEK_API_KEY', transport: 'openai-compatible' }),
  zai: Object.freeze({ host: 'api.z.ai', url: 'https://api.z.ai/api/paas/v4/chat/completions', secretEnv: 'ZAI_API_KEY', transport: 'openai-compatible' }),
  moonshot: Object.freeze({ host: 'api.moonshot.ai', url: 'https://api.moonshot.ai/v1/chat/completions', secretEnv: 'MOONSHOT_API_KEY', transport: 'openai-compatible' }),
  dashscope: Object.freeze({ host: 'dashscope-intl.aliyuncs.com', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', secretEnv: 'DASHSCOPE_API_KEY', transport: 'openai-compatible' }),
});

const ALL_SECRET_ENVS = Object.values(PROVIDERS).map(p => p.secretEnv);

/** 'configured' / 'missing' - never the value. */
const secretState = name => (String(process.env[name] || '').trim() ? 'configured' : 'missing');

/** Removes every provider key value and the usual secret patterns. */
function redact(text) {
  let s = String(text == null ? '' : text);
  for (const name of ALL_SECRET_ENVS) {
    const v = String(process.env[name] || '').trim();
    if (v.length >= 6) s = s.split(v).join('[redacted]');
  }
  return health.safeReason(s);
}

/**
 * Replaces fetch in this process: only the listed hosts, over https, never a
 * redirect. Returns a function that restores the original.
 */
function guardNetwork(allowHosts = []) {
  const original = globalThis.fetch;
  const allowed = new Set(allowHosts);
  globalThis.fetch = (input, init = {}) => {
    let url;
    try { url = new URL(typeof input === 'string' ? input : input.url); } catch { return Promise.reject(new Error('network guard: bad URL')); }
    if (url.protocol !== 'https:' || !allowed.has(url.host)) return Promise.reject(Object.assign(new Error(`network guard: ${url.host} is not allowed in this run`), { code: 'NETWORK_GUARD' }));
    return original(input, { ...init, redirect: 'error' });
  };
  return () => { globalThis.fetch = original; };
}

/** The wire messages, as every OpenAI-compatible provider here takes them. */
function wireMessages(messages) {
  return voicelabAdapter()._internal.toChatMessages(messages);
}

/**
 * The body sent for one call: the frozen profile's parameters as written,
 * nothing added, nothing silently dropped (a parameter a model does not
 * take is left out of its profile, not stripped here).
 */
function requestBody(model, messages) {
  const body = { model: model.requestedModel, messages: wireMessages(messages) };
  for (const [k, v] of Object.entries(model.profile.params || {})) body[k] = v;
  body[model.profile.capParam] = model.profile.cap;
  return body;
}

const num = v => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

/**
 * Usage from a response body: { inTokens, outTokens, cachedTokens,
 * reasoningTokens, complete, problem }. Field names per provider (to be
 * confirmed live): DeepSeek prompt_cache_hit_tokens, Moonshot
 * usage.cached_tokens, otherwise prompt_tokens_details.cached_tokens;
 * reasoning completion_tokens_details.reasoning_tokens or
 * usage.reasoning_tokens.
 */
function usageOf(data) {
  const u = data && data.usage;
  if (!u || typeof u !== 'object') return { inTokens: null, outTokens: null, cachedTokens: null, reasoningTokens: null, complete: false, problem: 'no usage' };
  const inTokens = num(u.prompt_tokens != null ? u.prompt_tokens : u.input_tokens);
  const outTokens = num(u.completion_tokens != null ? u.completion_tokens : u.output_tokens);
  const cachedTokens = num(u.prompt_cache_hit_tokens != null ? u.prompt_cache_hit_tokens
    : u.cached_tokens != null ? u.cached_tokens
      : (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens));
  const reasoningTokens = num((u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) != null
    ? u.completion_tokens_details.reasoning_tokens : u.reasoning_tokens);
  let problem = null;
  if (inTokens == null || outTokens == null) problem = 'prompt or completion count missing';
  else if (cachedTokens != null && cachedTokens > inTokens) problem = 'cached tokens above prompt tokens';
  else if (reasoningTokens != null && reasoningTokens > outTokens) problem = 'reasoning tokens above completion tokens (not added: unknown)';
  return { inTokens, outTokens, cachedTokens, reasoningTokens, complete: !problem, problem };
}

/** A cost the provider itself returned in the body, if any (never derived). */
function providerCostOf(data) {
  const u = (data && data.usage) || {};
  const v = num(u.cost != null ? u.cost : u.total_cost);
  return v;
}

/**
 * The rates a reserve and a list-price figure use: the HIGHEST of every
 * listed rate (time of day, tier), so a discount is never assumed.
 * Returns null when any needed price is missing.
 */
function worstRates(prices) {
  const rates = prices && Array.isArray(prices.rates) ? prices.rates : [];
  if (!rates.length) return null;
  const pick = k => rates.reduce((m, r) => (num(r[k]) == null ? m : Math.max(m == null ? -Infinity : m, num(r[k]))), null);
  const r = { in: pick('in'), cachedIn: pick('cachedIn'), out: pick('out') };
  if (r.in == null || r.out == null) return null;
  return r;
}

/**
 * The price a call is reserved and costed at, with where it came from:
 *   - the owner's confirmation entry (rates, source, checkedAt), else
 *   - for VoiceLab only, the repository price table (console list price,
 *     src/ai/model-pricing.js; credits are billed apart and not bounded), else
 *   - none: { rates: null } - no reserve, live blocked.
 * A search snippet is never a price here (it is only a dry-run scenario).
 */
function priceFor(model, entry) {
  const r = entry && worstRates(entry);
  if (r) return { rates: r, status: 'owner_confirmed', source: entry.source || null, checkedAt: entry.checkedAt || null };
  if (model.provider === 'voicelab') {
    const p = pricing.pricingSnapshot(`voicelab/${model.requestedModel}`);
    if (p) return { rates: { in: p.in, cachedIn: p.cached, out: p.out }, status: p.confirmation, source: p.source, checkedAt: p.checkedAt };
  }
  return { rates: null, status: 'UNKNOWN', source: null, checkedAt: null };
}

// how the input side of a reserve is bounded (no ratio from another model)
const INPUT_BOUND_METHOD = 'UTF-8 bytes of every message + 64 per request + 16 per message (src/ai/model-pricing.js inputTokenBound): a text token covers at least one byte in byte-level BPE and SentencePiece tokenizers; no characters-per-token ratio is used';

/**
 * The most one call can cost (before it is made), or { usd: null, reason }.
 * Needs all of:
 *   - a confirmed price (priceFor; the highest listed rate is used);
 *   - facts.capCoversBilledOutput === true: the owner confirmed that the
 *     cap sent (profile.capParam) limits EVERY billed output token, visible
 *     and reasoning alike - for every model, since a thinking switch that
 *     does not work, or hidden reasoning, would bill past a visible-only cap;
 *   - a text-only input (byte bound, INPUT_BOUND_METHOD).
 * Cached input is reserved at the full input rate (no discount assumed).
 */
function callBound(model, messages, priceInfo, facts) {
  const rates = priceInfo && priceInfo.rates;
  if (!rates) return { usd: null, reason: 'no confirmed price' };
  if (!(facts && facts.capCoversBilledOutput === true)) return { usd: null, reason: `not confirmed that ${model.profile.capParam} limits every billed output token (visible + reasoning)` };
  const inMax = pricing.inputTokenBound(messages);
  if (inMax == null) return { usd: null, reason: 'input size has no upper bound' };
  const usd = (inMax * Math.max(rates.in, rates.cachedIn || 0) + model.profile.cap * rates.out) / 1e6;
  return { usd, basis: {
    input: { tokensMax: inMax, method: INPUT_BOUND_METHOD },
    output: { tokensMax: model.profile.cap, method: `${model.profile.capParam}=${model.profile.cap}, owner-confirmed to cap visible and reasoning tokens` },
    rates, priceStatus: priceInfo.status, priceSource: priceInfo.source, checkedAt: priceInfo.checkedAt,
    ...(model.provider === 'voicelab' ? { note: 'VoiceLab credits are billed apart and not bounded by the list price' } : {}),
  } };
}

/**
 * Requested vs returned model. Accepted only when the provider returns the
 * requested id itself, or an id the owner confirmed beforehand as that
 * alias's snapshot (confirmation entry acceptedReturnedModels, exact
 * strings, no patterns). No id back is not a match; anything else is a
 * substitution and is refused.
 */
function modelMatch(requested, returned, accepted = []) {
  const ret = returned == null ? '' : String(returned).trim();
  if (!ret) return { ok: false, match: 'not_reported' };
  if (ret === requested) return { ok: true, match: 'exact' };
  if (Array.isArray(accepted) && accepted.includes(ret)) return { ok: true, match: 'confirmed_snapshot' };
  return { ok: false, match: 'mismatch' };
}

/** List-price dollars from complete usage at the highest listed rates, else null. */
function listCost(model, usage, priceInfo, facts) {
  if (!usage || !usage.complete) return null;
  if (usage.reasoningTokens && !(facts && facts.reasoningBilledInCompletion === true)) return null;
  const rates = priceInfo && priceInfo.rates;
  if (!rates) return null;
  const cached = usage.cachedTokens || 0;
  return ((usage.inTokens - cached) * rates.in + cached * (rates.cachedIn != null ? rates.cachedIn : rates.in) + usage.outTokens * rates.out) / 1e6;
}

/**
 * One call. Never throws for a provider outcome; returns
 *   { outcome: 'answered' | 'http_error' | 'transport_unknown',
 *     text, finishReason, refusal, returnedModel, requestId, usage,
 *     providerCostUsd, credits, status, error }
 * transport_unknown: no HTTP answer came back (timeout, network, redirect,
 * unreadable body) - whether the provider billed it is not known.
 */
async function callProvider(model, messages, { timeoutMs = 120000, fetchImpl = null } = {}) {
  const p = PROVIDERS[model.provider];
  if (!p) return { outcome: 'not_called', error: `unknown provider ${model.provider}` };
  const key = String(process.env[p.secretEnv] || '').trim();
  if (!key) return { outcome: 'not_called', error: `${p.secretEnv} missing` };
  if (p.transport === 'voicelab-adapter') return callVoiceLab(model, messages, timeoutMs);
  const body = requestBody(model, messages);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp;
  try {
    resp = await (fetchImpl || globalThis.fetch)(p.url, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    clearTimeout(timer);
    return { outcome: 'transport_unknown', error: redact(e && e.name === 'AbortError' ? `timed out after ${timeoutMs} ms` : (e && e.message) || e), usage: usageOf(null) };
  }
  let raw = '';
  try { raw = await resp.text(); } catch (e) { clearTimeout(timer); return { outcome: 'transport_unknown', status: resp.status, error: redact(`body not read: ${e && e.message}`), usage: usageOf(null) }; }
  clearTimeout(timer);
  let data = null;
  try { data = JSON.parse(raw); } catch { /* below */ }
  const requestId = (resp.headers && typeof resp.headers.get === 'function' && (resp.headers.get('x-request-id') || resp.headers.get('request-id'))) || (data && data.id) || null;
  if (!resp.ok) {
    const parsed = health.parseProviderError(raw);
    return { outcome: 'http_error', status: resp.status, requestId, usage: usageOf(data), providerCostUsd: providerCostOf(data),
      error: redact([resp.status, parsed.code, parsed.message].filter(Boolean).join(': ')),
      kind: health.classifyError({ status: resp.status, providerCode: parsed.code, providerMessage: parsed.message, message: raw }).kind };
  }
  if (!data) return { outcome: 'transport_unknown', status: resp.status, requestId, error: 'response is not JSON', usage: usageOf(null) };
  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  const msg = (choice && choice.message) || {};
  const text = voicelabAdapter()._internal.contentText(msg.content);
  return {
    outcome: 'answered', status: resp.status, requestId, returnedModel: data.model || null,
    text, finishReason: (choice && choice.finish_reason) || null,
    refusal: typeof msg.refusal === 'string' && msg.refusal ? redact(msg.refusal) : null,
    reasoningChars: ['reasoning_content', 'reasoning'].map(k => (typeof msg[k] === 'string' ? msg[k].length : 0)).reduce((a, b) => a + b, 0),
    usage: usageOf(data), providerCostUsd: providerCostOf(data),
  };
}

/** Comet through the existing adapter: explicit id, no fallback, same outcome shape. */
async function callVoiceLab(model, messages, timeoutMs) {
  const base = String(process.env.VOICELAB_BASE_URL || '').trim().replace(/\/+$/u, '');
  if (base && base !== 'https://api.voicelab.uz') return { outcome: 'not_called', error: 'VOICELAB_BASE_URL is not the default host: refused in the evaluation' };
  const prevTimeout = process.env.VOICELAB_TIMEOUT_MS;
  process.env.VOICELAB_TIMEOUT_MS = String(timeoutMs);
  const params = model.profile.params || {};
  try {
    const r = await voicelabAdapter().chatCompletion(`voicelab/${model.requestedModel}`, messages, { temperature: params.temperature, maxTokens: model.profile.cap });
    const u = r.usage || {};
    return { outcome: 'answered', status: 200, requestId: (r.raw && r.raw.id) || null, returnedModel: (r.raw && r.raw.model) || null,
      text: r.text, finishReason: r.finishReason, refusal: null, reasoningChars: 0,
      usage: { ...u, complete: (u.inTokens || 0) + (u.outTokens || 0) > 0, problem: null }, credits: u.credits == null ? null : u.credits, providerCostUsd: null };
  } catch (e) {
    const u = e && e.usage ? { ...e.usage, complete: (e.usage.inTokens || 0) + (e.usage.outTokens || 0) > 0, problem: null } : usageOf(null);
    // an empty answer the provider billed (EMPTY_RESPONSE) came back over HTTP
    if (e && (e.code === 'EMPTY_RESPONSE' || e.code === 'NO_CHOICES')) {
      return { outcome: 'answered', status: 200, text: '', finishReason: e.providerCode || null, refusal: null, usage: u, credits: u.credits == null ? null : u.credits, providerCostUsd: null, error: redact(e.message) };
    }
    if (e && e.status && e.status !== 408) return { outcome: 'http_error', status: e.status, usage: u, credits: u.credits == null ? null : u.credits, error: redact(e.message), kind: health.classifyError(e).kind };
    return { outcome: 'transport_unknown', status: e && e.status, usage: u, error: redact(e && e.message) };
  } finally {
    if (prevTimeout === undefined) delete process.env.VOICELAB_TIMEOUT_MS; else process.env.VOICELAB_TIMEOUT_MS = prevTimeout;
  }
}

module.exports = { PROVIDERS, ALL_SECRET_ENVS, INPUT_BOUND_METHOD, secretState, redact, guardNetwork, wireMessages, requestBody, usageOf, providerCostOf, worstRates, priceFor, callBound, modelMatch, listCost, callProvider };
