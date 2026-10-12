'use strict';

/**
 * Z.AI (GLM) chat completions (https://docs.z.ai, read 2026-10-12): an
 * opt-in provider for side-by-side trials on the platform. It is NEVER a
 * default: a call goes here only when its model id names it explicitly,
 * 'zai/glm-5.3-flash' (MODEL_TELEGRAM, MODEL_CHAT, OPINION_MODEL_<PLAN>,
 * /api/admin/model-ab). A failure goes on down the normal chain (DeepSeek,
 * then the lane's GPT-6).
 *
 *   endpoint   https://api.z.ai/api/paas/v4/chat/completions (fixed)
 *   model      glm-5.3-flash; thinking cannot be switched off on it, so
 *              reasoning_effort=low (low / high / max, default max) - as in
 *              the provider evaluation (scripts/provider-eval.config.json)
 *   key        ZAI_API_KEY (Render environment; never logged)
 *   usage      prompt_tokens, completion_tokens (no reasoning_tokens field;
 *              whether max_tokens also caps reasoning is not documented -
 *              the evaluation's calls stayed within it), cached_tokens
 *   refusal    finish_reason "sensitive" is a refusal, never an answer
 *
 * reasoning_content is never used as an answer.
 */

const URL = 'https://api.z.ai/api/paas/v4/chat/completions';
const MODEL = 'glm-5.3-flash';
const MODELS = Object.freeze([MODEL]);

const apiKey = () => String(process.env.ZAI_API_KEY || '').trim();

/** Whether a call for this model id goes to Z.AI: only an explicit 'zai/<model>' with the key set. */
function routes(modelOrLane) {
  return /^zai\//iu.test(String(modelOrLane || '').trim()) && apiKey().length > 0;
}

/** The GLM model for an explicit id; an unlisted one is the default, never sent as is. */
function modelFor(id) {
  const m = /^zai\/(.+)$/iu.exec(String(id || '').trim());
  return m && MODELS.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : MODEL;
}

/**
 * The cap sent for a caller's cap: GLM reasons before it answers, so the
 * caller's cap (set for the visible answer) gets the same x2 room as
 * DeepSeek, at most ZAI_MAX_TOKENS_CAP (default 16 000).
 */
function maxTokensFor(requested) {
  const n = v => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null; };
  const base = n(requested) || 8192;
  const cap = n(process.env.ZAI_MAX_TOKENS_CAP) || 16000;
  return Math.max(16, Math.min(cap, Math.round(base * 2)));
}
const timeoutMs = () => { const n = Number(process.env.ZAI_TIMEOUT_MS); return Number.isFinite(n) && n > 0 ? n : 120000; };

function usageOf(u) {
  if (!u) return {};
  return {
    inTokens: Number(u.prompt_tokens) || 0,
    outTokens: Number(u.completion_tokens) || 0,
    cachedTokens: (u.prompt_tokens_details && Number(u.prompt_tokens_details.cached_tokens)) || 0,
    reasoningTokens: (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || null,
  };
}

function buildBody(messages, { maxTokens = 6000, model = MODEL, stream = false } = {}) {
  const body = {
    model: MODELS.includes(model) ? model : MODEL,
    messages: (messages || []).map(m => ({ role: m.role === 'model' ? 'assistant' : (m.role || 'user'), content: m.content !== undefined ? m.content : (m.text || '') })),
    thinking: { type: 'enabled' },
    reasoning_effort: 'low',
    max_tokens: Math.max(16, Number(maxTokens) || 6000),
  };
  if (stream) body.stream = true;
  return body;
}

async function post(body, fetchImpl) {
  const name = body.model;
  const key = apiKey();
  if (!key) throw Object.assign(new Error('ZAI_API_KEY sozlanmagan'), { code: 'NO_KEY' });
  let resp;
  try {
    resp = await (fetchImpl || fetch)(URL, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs()),
      headers: { 'Content-Type': 'application/json', Accept: body.stream ? 'text/event-stream' : 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw Object.assign(new Error(timedOut ? `Z.AI ${name} timed out after ${timeoutMs()}ms` : `Z.AI ${name} request failed`), { status: timedOut ? 408 : undefined });
  }
  if (!resp.ok) {
    // a provider that echoes the key back never puts it into our logs
    const raw = (await resp.text().catch(() => '')).split(key).join('[key]');
    const { parseProviderError, safeReason } = require('./provider-health');
    const parsed = parseProviderError(raw);
    throw Object.assign(new Error(`Z.AI ${name} ${resp.status}: ${safeReason([parsed.code, parsed.message].filter(Boolean).join(': ') || raw.slice(0, 200))}`),
      { status: resp.status, providerCode: parsed.code, providerMessage: parsed.message ? safeReason(parsed.message) : null, retryAfter: resp.headers.get('retry-after') });
  }
  return resp;
}

const refusal = (name, usage) => Object.assign(new Error(`Z.AI ${name} refused the request (finish_reason: sensitive)`), { code: 'REFUSED', usage });

async function chatCompletion(messages, { maxTokens = 6000, call = null, fetchImpl = null, model = MODEL } = {}) {
  const body = buildBody(messages, { maxTokens, model });
  const name = body.model;
  const resp = await post(body, fetchImpl);
  const data = await resp.json();
  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  const text = choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content : '';
  const finishReason = (choice && choice.finish_reason) || null;
  const usage = usageOf(data.usage);
  if (call) call.usage({ ...usage, modelReturned: data.model || null, finishReason, truncated: finishReason === 'length' });
  if (finishReason === 'sensitive') throw refusal(name, usage);
  if (!text.trim()) throw Object.assign(new Error(`Z.AI ${name} empty response (finish_reason: ${finishReason || '?'})`), { code: 'EMPTY_RESPONSE', usage });
  return { text, provider: `zai/${data.model || name}`, truncated: finishReason === 'length', usage };
}

/** Streamed (web chat): only content deltas reach onToken; reasoning deltas are dropped. */
async function chatCompletionStream(messages, { maxTokens = 6000, call = null, fetchImpl = null, model: requested = MODEL } = {}, onToken = () => {}) {
  const body = buildBody(messages, { maxTokens, stream: true, model: requested });
  const name = body.model;
  const resp = await post(body, fetchImpl);
  if (!resp.body) throw new Error(`Z.AI ${name} stream has no body`);
  const decoder = new TextDecoder();
  let buf = '', text = '', finishReason = null, model = null, usage = {};
  const handle = (line) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let ev; try { ev = JSON.parse(payload); } catch { return; }
    if (ev.error) throw new Error(`Z.AI ${name} stream error: ${String(ev.error.message || ev.error.code || 'error').slice(0, 200)}`);
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
  if (finishReason === 'sensitive') throw Object.assign(refusal(name, usage), text ? { partialStream: true } : {});
  if (!text) throw Object.assign(new Error(`Z.AI ${name} stream returned no text`), { code: 'EMPTY_RESPONSE' });
  if (!finishReason) throw Object.assign(new Error(`Z.AI ${name} stream ended with no finish_reason`), { partialStream: true });
  return { text, provider: `zai/${model || name}`, truncated: finishReason === 'length', usage };
}

module.exports = { chatCompletion, chatCompletionStream, routes, modelFor, maxTokensFor, MODEL, MODELS, URL, _internal: { usageOf, buildBody } };
