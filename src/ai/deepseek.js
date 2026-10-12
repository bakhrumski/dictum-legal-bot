'use strict';

/**
 * DeepSeek chat completions (https://api-docs.deepseek.com, read 2026-10-12):
 * the FIRST choice for every text model call of the app (owner's decision,
 * 2026-10-12) - web chat (streamed too), Telegram answers, legal opinions,
 * document analysis and explanation, digests, helper calls - in place of
 * VoiceLab comet. Not for images or scanned documents (OCR / vision keep
 * their own providers) and not for embeddings.
 *
 * routes(modelOrLane) says whether a call goes here first:
 *   - on when DEEPSEEK_API_KEY is set, off with DEEPSEEK_ROUTING=off (env,
 *     no deploy);
 *   - 'deepseek/<model>' ids always; 'openai/', 'voicelab/' and gemini ids
 *     never (an explicit id picks its provider); the 'vision' lane never.
 * A failed call falls through to the OpenAI model of the lane (GPT-6), then
 * the existing last resort; VoiceLab text lanes are skipped while DeepSeek
 * routes them.
 *
 * Answer cap: callers' max tokens were set for comet / GPT-6; DeepSeek
 * writes longer (on the evaluation document both answers stopped at 3 000),
 * so the cap sent is the caller's x DEEPSEEK_MAX_TOKENS_FACTOR (default 2),
 * at most DEEPSEEK_MAX_TOKENS_CAP (default 16 000).
 *
 *   endpoint   https://api.deepseek.com/chat/completions (fixed; no base-URL override)
 *   model      deepseek-flash (DeepSeek-V4.1-Flash), thinking disabled:
 *              {"thinking":{"type":"disabled"}} - non-thinking mode, where
 *              temperature applies and max_tokens limits the generated answer
 *   key        DEEPSEEK_API_KEY (Render environment; never logged)
 *   usage      prompt_tokens = prompt_cache_hit_tokens + prompt_cache_miss_tokens;
 *              completion_tokens_details.reasoning_tokens is part of
 *              completion_tokens - nothing is added twice
 *
 * Chosen after the provider evaluation of 2026-10-12 (docs/quality/
 * provider-eval-plan.md): on the 54 260-char agreement it kept every
 * condition of the evidence table at an answer cap of 6 000 tokens and was
 * cut at 3 000. One document, used in tuning: a screening result, not a
 * proof of legal quality.
 */

const URL = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-flash';
// the models a caller may name as 'deepseek/<model>' (listed on the account,
// priced in model-pricing.js); any other id goes to the default
const MODELS = Object.freeze(['deepseek-flash', 'deepseek-v4-pro']);

/** The DeepSeek model for a requested id: 'deepseek/deepseek-v4-pro' names it, anything else is the default. */
function modelFor(id) {
  const m = /^deepseek\/(.+)$/iu.exec(String(id || '').trim());
  return m && MODELS.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : MODEL;
}

const apiKey = () => String(process.env.DEEPSEEK_API_KEY || '').trim();

function enabled() {
  return apiKey().length > 0 && String(process.env.DEEPSEEK_ROUTING || '').trim().toLowerCase() !== 'off';
}

/** Whether a call for this model id or lane goes to DeepSeek first. */
function routes(modelOrLane) {
  const m = String(modelOrLane || '').trim().toLowerCase();
  if (/^deepseek\//u.test(m)) return apiKey().length > 0;
  if (!enabled()) return false;
  if (/^(openai|voicelab)\//u.test(m) || /^gemini/u.test(m) || m === 'vision') return false;
  return true;
}

/** The cap sent to DeepSeek for a caller's cap. */
function maxTokensFor(requested) {
  const n = v => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null; };
  const base = n(requested) || 8192;
  const factor = n(process.env.DEEPSEEK_MAX_TOKENS_FACTOR) || 2;
  const cap = n(process.env.DEEPSEEK_MAX_TOKENS_CAP) || 16000;
  return Math.max(16, Math.min(cap, Math.round(base * Math.max(1, factor))));
}
const timeoutMs = () => { const n = Number(process.env.DEEPSEEK_TIMEOUT_MS); return Number.isFinite(n) && n > 0 ? n : 120000; };

function usageOf(u) {
  if (!u) return {};
  return {
    inTokens: Number(u.prompt_tokens) || 0,
    outTokens: Number(u.completion_tokens) || 0,
    cachedTokens: Number(u.prompt_cache_hit_tokens != null ? u.prompt_cache_hit_tokens : (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens)) || 0,
    reasoningTokens: (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || null,
  };
}

/**
 * One call. `call` is the usage-ledger handle (usageLedger.track). Returns
 * { text, provider, truncated, usage }; throws on an HTTP error, a missing
 * key, a timeout or an empty answer (the router then falls back).
 */
function buildBody(messages, { maxTokens = 6000, temperature = 0.2, responseFormat = null, stream = false, model = MODEL } = {}) {
  const body = {
    model: MODELS.includes(model) ? model : MODEL,
    messages: (messages || []).map(m => ({ role: m.role === 'model' ? 'assistant' : (m.role || 'user'), content: m.content !== undefined ? m.content : (m.text || '') })),
    thinking: { type: 'disabled' },
    temperature: temperature == null ? 0.2 : temperature,
    max_tokens: Math.max(16, Number(maxTokens) || 6000),
  };
  if (responseFormat) body.response_format = responseFormat;
  if (stream) { body.stream = true; body.stream_options = { include_usage: true }; }
  return body;
}

async function post(body, fetchImpl) {
  const name = body.model;
  const key = apiKey();
  if (!key) throw Object.assign(new Error('DEEPSEEK_API_KEY sozlanmagan'), { code: 'NO_KEY' });
  let resp;
  try {
    resp = await (fetchImpl || fetch)(URL, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs()),
      headers: { 'Content-Type': 'application/json', Accept: body.stream ? 'text/event-stream' : 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const err = new Error(e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? `DeepSeek ${name} timed out after ${timeoutMs()}ms` : `DeepSeek ${name} request failed`);
    err.status = e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 408 : undefined;
    throw err;
  }
  if (!resp.ok) {
    const raw = await resp.text().catch(() => '');
    const { parseProviderError, safeReason } = require('./provider-health');
    const parsed = parseProviderError(raw);
    throw Object.assign(new Error(`DeepSeek ${name} ${resp.status}: ${safeReason([parsed.code, parsed.message].filter(Boolean).join(': ') || raw.slice(0, 200))}`),
      { status: resp.status, providerCode: parsed.code, providerMessage: parsed.message ? safeReason(parsed.message) : null, retryAfter: resp.headers.get('retry-after') });
  }
  return resp;
}

async function chatCompletion(messages, { maxTokens = 6000, temperature = 0.2, responseFormat = null, call = null, fetchImpl = null, model = MODEL } = {}) {
  const body = buildBody(messages, { maxTokens, temperature, responseFormat, model });
  const name = body.model;
  const resp = await post(body, fetchImpl);
  const data = await resp.json();
  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  const text = choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content : '';
  const finishReason = (choice && choice.finish_reason) || null;
  const usage = usageOf(data.usage);
  if (call) call.usage({ ...usage, modelReturned: data.model || null, finishReason, truncated: finishReason === 'length' });
  if (!text.trim()) throw Object.assign(new Error(`DeepSeek ${name} empty response (finish_reason: ${finishReason || '?'})`), { code: 'EMPTY_RESPONSE', usage });
  return { text, provider: `deepseek/${data.model || name}`, truncated: finishReason === 'length', usage };
}

/**
 * Streamed (web chat): onToken gets each text delta; usage comes in the last
 * chunk. A stream that breaks after tokens were shown is marked
 * partialStream, so the caller does not replay the answer elsewhere.
 */
async function chatCompletionStream(messages, { maxTokens = 6000, temperature = 0.2, call = null, fetchImpl = null, model: requested = MODEL } = {}, onToken = () => {}) {
  const body = buildBody(messages, { maxTokens, temperature, stream: true, model: requested });
  const name = body.model;
  const resp = await post(body, fetchImpl);
  if (!resp.body) throw new Error(`DeepSeek ${name} stream has no body`);
  const decoder = new TextDecoder();
  let buf = '', text = '', finishReason = null, model = null, usage = {};
  const handle = (line) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let ev; try { ev = JSON.parse(payload); } catch { return; }
    if (ev.error) throw new Error(`DeepSeek ${name} stream error: ${String(ev.error.message || ev.error.code || 'error').slice(0, 200)}`);
    if (ev.model) model = ev.model;
    if (ev.usage) usage = usageOf(ev.usage);
    const c = Array.isArray(ev.choices) ? ev.choices[0] : null;
    if (!c) return;
    const piece = c.delta && typeof c.delta.content === 'string' ? c.delta.content : '';
    if (piece) { text += piece; try { onToken(piece); } catch (_) { /* a consumer error must not kill the stream */ } }
    if (c.finish_reason) finishReason = c.finish_reason;
  };
  try {
    for await (const chunk of resp.body) {
      buf += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) !== -1) { handle(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
    }
    if (buf.trim()) handle(buf.trim());
  } catch (err) {
    if (text) err.partialStream = true;
    if (call) call.usage({ ...usage, modelReturned: model, finishReason, truncated: finishReason === 'length' });
    throw err;
  }
  if (call) call.usage({ ...usage, modelReturned: model, finishReason, truncated: finishReason === 'length' });
  if (!text) throw Object.assign(new Error(`DeepSeek ${name} stream returned no text`), { code: 'EMPTY_RESPONSE' });
  if (!finishReason) throw Object.assign(new Error(`DeepSeek ${name} stream ended with no finish_reason`), { partialStream: true });
  return { text, provider: `deepseek/${model || name}`, truncated: finishReason === 'length', usage };
}

module.exports = { chatCompletion, chatCompletionStream, routes, enabled, maxTokensFor, modelFor, MODEL, MODELS, URL, _internal: { usageOf, buildBody } };
