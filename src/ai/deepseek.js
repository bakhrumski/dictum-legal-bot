'use strict';

/**
 * DeepSeek chat completions (https://api-docs.deepseek.com, read 2026-10-12)
 * for the document explanation (src/ai/explain-router.js). Nothing else in
 * the app calls it.
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

const apiKey = () => String(process.env.DEEPSEEK_API_KEY || '').trim();
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
async function chatCompletion(messages, { maxTokens = 6000, temperature = 0.2, call = null, fetchImpl = null } = {}) {
  const key = apiKey();
  if (!key) throw Object.assign(new Error('DEEPSEEK_API_KEY sozlanmagan'), { code: 'NO_KEY' });
  const body = {
    model: MODEL,
    messages: (messages || []).map(m => ({ role: m.role === 'model' ? 'assistant' : (m.role || 'user'), content: m.content !== undefined ? m.content : (m.text || '') })),
    thinking: { type: 'disabled' },
    temperature,
    max_tokens: Math.max(16, Number(maxTokens) || 6000),
  };
  let resp;
  try {
    resp = await (fetchImpl || fetch)(URL, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs()),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const err = new Error(e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? `DeepSeek ${MODEL} timed out after ${timeoutMs()}ms` : `DeepSeek ${MODEL} request failed`);
    err.status = e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 408 : undefined;
    throw err;
  }
  if (!resp.ok) {
    const raw = await resp.text().catch(() => '');
    const { parseProviderError, safeReason } = require('./provider-health');
    const parsed = parseProviderError(raw);
    throw Object.assign(new Error(`DeepSeek ${MODEL} ${resp.status}: ${safeReason([parsed.code, parsed.message].filter(Boolean).join(': ') || raw.slice(0, 200))}`),
      { status: resp.status, providerCode: parsed.code, providerMessage: parsed.message ? safeReason(parsed.message) : null, retryAfter: resp.headers.get('retry-after') });
  }
  const data = await resp.json();
  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  const text = choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content : '';
  const finishReason = (choice && choice.finish_reason) || null;
  const usage = usageOf(data.usage);
  if (call) call.usage({ ...usage, modelReturned: data.model || null, finishReason, truncated: finishReason === 'length' });
  if (!text.trim()) throw Object.assign(new Error(`DeepSeek ${MODEL} empty response (finish_reason: ${finishReason || '?'})`), { code: 'EMPTY_RESPONSE', usage });
  return { text, provider: `deepseek/${data.model || MODEL}`, truncated: finishReason === 'length', usage };
}

module.exports = { chatCompletion, MODEL, URL, _internal: { usageOf } };
