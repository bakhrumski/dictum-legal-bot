'use strict';

/**
 * Providers for the provider evaluation ONLY (scripts/provider-eval.js,
 * 2026-10-11). The server never requires this file: production routing,
 * RAG, tariffs, Telegram and VoiceLab settings are untouched.
 *
 * Isolation:
 *   - each provider's URL is fixed here (no *_BASE_URL override, nothing
 *     from the config file; Alibaba's workspace domain is built only from a
 *     validated workspace id); a request goes only to its own host, with its
 *     own key (or the cloud proxy's network secret, see authFor), and never
 *     follows a redirect (`redirect: 'error'`), so a key cannot be carried
 *     to another host;
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
  // Alibaba Model Studio, Singapore (ap-southeast-1). The docs (OpenAI
  // compatibility page, 2026-10-12) give the workspace domain
  // {WorkspaceId}.ap-southeast-1.maas.aliyuncs.com and ask to migrate from
  // dashscope-intl.aliyuncs.com; they do not say the old domain stopped
  // working. With a confirmed workspaceId the workspace domain is used, else
  // the dashscope-intl one - the selected endpoint is recorded either way.
  dashscope: Object.freeze({ host: 'dashscope-intl.aliyuncs.com', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', secretEnv: 'DASHSCOPE_API_KEY', transport: 'openai-compatible',
    workspace: Object.freeze({ region: 'ap-southeast-1', hostOf: id => `${id}.ap-southeast-1.maas.aliyuncs.com` }) }),
});

const ALL_SECRET_ENVS = Object.values(PROVIDERS).map(p => p.secretEnv);
const WORKSPACE_ID = /^[a-z0-9][a-z0-9-]{2,62}$/u;

/**
 * The endpoint of one provider for one confirmation entry: { url, host,
 * selected } or { error }. The host is never free text: only the
 * provider's fixed URL, or (Alibaba) its workspace domain built from a
 * workspace id of letters, digits and dashes.
 */
function endpointFor(provider, entry = null) {
  const p = PROVIDERS[provider];
  if (!p) return { error: `unknown provider ${provider}` };
  const ws = entry && entry.workspaceId;
  if (ws != null && ws !== '') {
    if (!p.workspace) return { error: `${provider} has no workspace endpoint` };
    if (!WORKSPACE_ID.test(String(ws))) return { error: 'workspaceId must be lowercase letters, digits and dashes' };
    const host = p.workspace.hostOf(String(ws));
    return { url: `https://${host}/compatible-mode/v1/chat/completions`, host, selected: `workspace domain (${p.workspace.region})` };
  }
  return { url: p.url, host: p.host, selected: p.workspace ? `dashscope-intl (${p.workspace.region}; docs ask to migrate to the workspace domain)` : 'fixed' };
}

/** 'configured' / 'missing' - never the value. */
const secretState = name => (String(process.env[name] || '').trim() ? 'configured' : 'missing');

/**
 * How a call is authenticated:
 *   'env'            the key is in the provider's environment variable;
 *   'network_secret' the owner's confirmation entry says the cloud network
 *                    proxy adds the Authorization header for this host (the
 *                    key never reaches the process; nothing is sent from
 *                    here, no placeholder key) - a missing proxy secret
 *                    then comes back as the provider's own 401;
 *   'missing'        neither: the call is not made.
 * VoiceLab: with the key in the environment the existing adapter is used;
 * with a network secret the call goes the same OpenAI-compatible way as the
 * other providers, to the fixed VoiceLab URL (the production adapter is not
 * changed) - its billing headers are read the same way.
 */
function authFor(provider, entry = null) {
  const p = PROVIDERS[provider];
  if (!p) return { mode: 'missing', reason: `unknown provider ${provider}` };
  if (secretState(p.secretEnv) === 'configured') return { mode: 'env' };
  if (entry && entry.auth === 'network_secret') {
    return { mode: 'network_secret' };
  }
  return { mode: 'missing', reason: `${p.secretEnv} not set and no confirmed network secret` };
}

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

// The input side of a reserve. The UTF-8 byte count of the text is NOT a
// guaranteed token bound on its own: it holds only for a tokenizer whose
// every text token covers at least one byte, and the provider's chat
// template and special tokens are not bytes of the text at all. So the
// bound is built from a per-model basis the owner confirms (confirmation
// entry inputTokenBasis), never from a ratio measured on another model:
//   method            'tokenizer' (the model's own tokenizer and chat
//                     template, counted locally) or 'provider_documented'
//                     (a documented counting rule or count endpoint)
//   source            where the tokenizer / documentation came from
//   maxTokensPerByte  text tokens per UTF-8 byte at most (1 for byte-level BPE)
//   overheadTokensMax chat template + special tokens of the whole request,
//                     counted with that tokenizer or taken from the docs
// Without it the reserve is UNKNOWN and the job BLOCKED.
const INPUT_BOUND_METHOD = "ceil(UTF-8 bytes of the message texts x maxTokensPerByte) + overheadTokensMax, both from the model's confirmed inputTokenBasis (its tokenizer and chat template, or a documented rule); the byte count alone is not a token guarantee and no characters-per-token ratio is used";
const INPUT_BASIS_METHODS = ['tokenizer', 'provider_documented'];

/** The confirmed input basis, or the reason it is not usable. */
function inputBasisProblem(b) {
  if (!b || typeof b !== 'object') return 'input token basis (tokenizer or documented rule, with chat-template and special-token overhead) not confirmed';
  if (!INPUT_BASIS_METHODS.includes(b.method)) return `input token basis method must be one of ${INPUT_BASIS_METHODS.join(' / ')}`;
  if (!b.source || typeof b.source !== 'string') return 'input token basis has no source';
  if (!(Number(b.maxTokensPerByte) > 0)) return 'input token basis needs maxTokensPerByte > 0';
  if (!(Number.isFinite(Number(b.overheadTokensMax)) && Number(b.overheadTokensMax) >= 0) || b.overheadTokensMax === null || b.overheadTokensMax === '') return 'input token basis needs overheadTokensMax (chat template + special tokens) >= 0';
  return null;
}

/** Input tokens at most, from the text bytes and the confirmed basis; null if any part is not text. */
function inputTokensMax(messages, basis) {
  let bytes = 0;
  for (const m of messages || []) {
    const c = m && (m.text != null ? m.text : m.content);
    if (c != null && typeof c !== 'string') return null;
    bytes += Buffer.byteLength(String(c || ''), 'utf8');
  }
  return { bytes, tokensMax: Math.ceil(bytes * Number(basis.maxTokensPerByte)) + Number(basis.overheadTokensMax) };
}

/**
 * A billing fact the owner accepts: true, or 'verify_by_usage' - accepted on
 * the condition that every call's own usage is checked (provider-eval
 * usageCheck): a call whose usage is missing, or whose completion_tokens
 * pass the cap, stops that provider.
 */
const factAccepted = v => v === true || v === 'verify_by_usage';

/**
 * The most one call can cost (before it is made), or { usd: null, reason }.
 * Needs all of:
 *   - a confirmed price (priceFor; the highest listed rate is used);
 *   - facts.capCoversBilledOutput === true: the owner confirmed that the
 *     cap sent (profile.capParam) limits EVERY billed output token, visible
 *     and reasoning alike - for every model, since a thinking switch that
 *     does not work, or hidden reasoning, would bill past a visible-only cap;
 *   - facts.inputTokenBasis (INPUT_BOUND_METHOD) and a text-only input.
 * Cached input is reserved at the full input rate (no discount assumed).
 */
function callBound(model, messages, priceInfo, facts) {
  const rates = priceInfo && priceInfo.rates;
  if (!rates) return { usd: null, reason: 'no confirmed price' };
  if (!(facts && factAccepted(facts.capCoversBilledOutput))) return { usd: null, reason: `not confirmed that ${model.profile.capParam} limits every billed output token (visible + reasoning)` };
  const basisProblem = inputBasisProblem(facts.inputTokenBasis);
  if (basisProblem) return { usd: null, reason: basisProblem };
  const inp = inputTokensMax(messages, facts.inputTokenBasis);
  if (!inp) return { usd: null, reason: 'input is not text only: no bound' };
  const inMax = inp.tokensMax;
  const usd = (inMax * Math.max(rates.in, rates.cachedIn || 0) + model.profile.cap * rates.out) / 1e6;
  return { usd, basis: {
    input: { tokensMax: inMax, textBytes: inp.bytes, method: INPUT_BOUND_METHOD, basis: { method: facts.inputTokenBasis.method, source: facts.inputTokenBasis.source, maxTokensPerByte: Number(facts.inputTokenBasis.maxTokensPerByte), overheadTokensMax: Number(facts.inputTokenBasis.overheadTokensMax) } },
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
  if (usage.reasoningTokens && !(facts && factAccepted(facts.reasoningBilledInCompletion))) return null;
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
async function callProvider(model, messages, { timeoutMs = 120000, fetchImpl = null, entry = null } = {}) {
  const p = PROVIDERS[model.provider];
  if (!p) return { outcome: 'not_called', error: `unknown provider ${model.provider}` };
  const auth = authFor(model.provider, entry);
  if (auth.mode === 'missing') return { outcome: 'not_called', error: auth.reason };
  if (p.transport === 'voicelab-adapter' && auth.mode === 'env') return callVoiceLab(model, messages, timeoutMs);
  const ep = endpointFor(model.provider, entry);
  if (ep.error) return { outcome: 'not_called', error: ep.error };
  const body = requestBody(model, messages);
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (auth.mode === 'env') headers.Authorization = `Bearer ${String(process.env[p.secretEnv]).trim()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp;
  try {
    resp = await (fetchImpl || globalThis.fetch)(ep.url, {
      method: 'POST', redirect: 'error', signal: controller.signal, headers,
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
  // VoiceLab (network secret): credits debited, billing status and the
  // billable request id from its headers (docs.voicelab.uz/api/llm)
  const vl = p.transport === 'voicelab-adapter' ? voicelabAdapter()._internal.billingHeaders(resp) : null;
  const requestId = (vl && vl.requestId) || (resp.headers && typeof resp.headers.get === 'function' && (resp.headers.get('x-request-id') || resp.headers.get('request-id'))) || (data && data.id) || null;
  const billing = vl ? { credits: vl.creditsCharged, billingStatus: vl.billingStatus } : {};
  if (!resp.ok) {
    const parsed = health.parseProviderError(raw);
    return { outcome: 'http_error', status: resp.status, requestId, usage: usageOf(data), providerCostUsd: providerCostOf(data), ...billing,
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
    usage: usageOf(data), providerCostUsd: providerCostOf(data), ...billing,
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
    // credits as VoiceLab debited them (X-Credits-Charged), kept apart from
    // the list-price USD made from the tokens; none on a pending billing
    const credits = r.creditsCharged != null ? r.creditsCharged : (u.credits == null ? null : u.credits);
    return { outcome: 'answered', status: 200, requestId: r.requestId || (r.raw && r.raw.id) || null, returnedModel: (r.raw && r.raw.model) || null,
      text: r.text, finishReason: r.finishReason, refusal: null, reasoningChars: 0,
      usage: { ...u, complete: (u.inTokens || 0) + (u.outTokens || 0) > 0, problem: null }, credits, billingStatus: r.billingStatus || null, providerCostUsd: null };
  } catch (e) {
    const u = e && e.usage ? { ...e.usage, complete: (e.usage.inTokens || 0) + (e.usage.outTokens || 0) > 0, problem: null } : usageOf(null);
    // an empty answer the provider billed (EMPTY_RESPONSE) came back over HTTP
    if (e && (e.code === 'EMPTY_RESPONSE' || e.code === 'NO_CHOICES')) {
      return { outcome: 'answered', status: 200, text: '', finishReason: e.providerCode || null, refusal: null, usage: u, credits: e.creditsCharged != null ? e.creditsCharged : (u.credits == null ? null : u.credits), billingStatus: e.billingStatus || null, providerCostUsd: null, error: redact(e.message) };
    }
    if (e && e.status && e.status !== 408) return { outcome: 'http_error', status: e.status, usage: u, credits: u.credits == null ? null : u.credits, error: redact(e.message), kind: health.classifyError(e).kind };
    return { outcome: 'transport_unknown', status: e && e.status, usage: u, error: redact(e && e.message) };
  } finally {
    if (prevTimeout === undefined) delete process.env.VOICELAB_TIMEOUT_MS; else process.env.VOICELAB_TIMEOUT_MS = prevTimeout;
  }
}

module.exports = { factAccepted, PROVIDERS, ALL_SECRET_ENVS, endpointFor, authFor, INPUT_BOUND_METHOD, INPUT_BASIS_METHODS, inputBasisProblem, inputTokensMax, secretState, redact, guardNetwork, wireMessages, requestBody, usageOf, providerCostOf, worstRates, priceFor, callBound, modelMatch, listCost, callProvider };
