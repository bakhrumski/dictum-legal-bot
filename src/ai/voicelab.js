'use strict';

/**
 * VoiceLab LLM provider (https://docs.voicelab.uz/api/llm).
 *
 * VoiceLab exposes an OpenAI-compatible Chat Completions API, so this module
 * only swaps the base URL, the key and the model ids; request and response
 * shapes are the ones the rest of the code already speaks.
 *
 * It is a switch, not a replacement. Nothing is routed here unless
 *
 *     LLM_PROVIDER=voicelab   and   VOICELAB_API_KEY=...
 *
 * are both set. Unset LLM_PROVIDER (or set it to anything else) and every call
 * site runs exactly as it did before this file existed — no deploy needed to
 * go back, only the environment variable. While switched on, a VoiceLab
 * failure falls through to the previous provider unless VOICELAB_FALLBACK is
 * 'false', so a VoiceLab outage degrades to the old behaviour, not to errors.
 *
 * Lanes. The code picks models by workload, not by name, so VoiceLab models
 * are mapped per lane and each is overridable:
 *   cheap     high-volume, low-stakes: classify, chat, digests   → Comet
 *   standard  drafting, general generation                        → Orbit
 *   premium   legal opinions                                      → Halo
 *   vision    images and scanned documents (OCR, screening)       → Halo
 * VOICELAB_LANES limits which lanes go to VoiceLab (default: all), so one
 * workload can be moved back without touching the others.
 *
 * Environment:
 *   LLM_PROVIDER             'voicelab' to switch on
 *   VOICELAB_API_KEY         Bearer key (vlk_...). Lives in Render, never in git.
 *   VOICELAB_BASE_URL        default https://api.voicelab.uz
 *   VOICELAB_MODEL_CHEAP     default comet
 *   VOICELAB_MODEL_STANDARD  default orbit
 *   VOICELAB_MODEL_PREMIUM   default halo
 *   VOICELAB_MODEL_VISION    default halo
 *   VOICELAB_LANES           comma list, default cheap,standard,premium,vision
 *   VOICELAB_FALLBACK        'false' to surface VoiceLab errors instead of
 *                            falling back to the previous provider
 *   VOICELAB_TIMEOUT_MS      default 120000
 */

const DEFAULT_BASE_URL = 'https://api.voicelab.uz';
const CHAT_PATH = '/v1/chat/completions';
const LANES = ['cheap', 'standard', 'premium', 'vision'];
const DEFAULT_MODELS = Object.freeze({
  cheap: 'comet',
  standard: 'orbit',
  premium: 'halo',
  vision: 'halo',
});

// The OpenAI ids the routers pass today, and the lane each one stands for.
// An id not listed here (a custom MODEL_* override) is treated as standard.
const LANE_BY_OPENAI_MODEL = Object.freeze({
  'gpt-5.6-luna': 'cheap',
  'gpt-5.6-terra': 'standard',
  'gpt-5.6-sol': 'premium',
  'gpt-5.6': 'premium',
});

function apiKey() {
  return String(process.env.VOICELAB_API_KEY || '').trim();
}

function isEnabled() {
  return String(process.env.LLM_PROVIDER || '').trim().toLowerCase() === 'voicelab'
    && apiKey().length > 0;
}

function enabledLanes() {
  const raw = String(process.env.VOICELAB_LANES || '').trim();
  if (!raw) return new Set(LANES);
  return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/** Lane for an OpenAI model id, or the lane name itself if one is passed. */
function laneFor(modelOrLane) {
  const key = String(modelOrLane || '').trim().toLowerCase();
  if (LANES.includes(key)) return key;
  return LANE_BY_OPENAI_MODEL[key] || 'standard';
}

/** VoiceLab model id to use for an OpenAI model id or a lane name. */
function modelFor(modelOrLane) {
  const lane = laneFor(modelOrLane);
  const override = String(process.env[`VOICELAB_MODEL_${lane.toUpperCase()}`] || '').trim();
  return override || DEFAULT_MODELS[lane];
}

/**
 * Whether a call for this model or lane should go to VoiceLab. Gemini ids are
 * never routed: they are the free fallback tier, not a paid lane.
 */
function routes(modelOrLane) {
  if (!isEnabled()) return false;
  if (/^gemini/i.test(String(modelOrLane || ''))) return false;
  return enabledLanes().has(laneFor(modelOrLane));
}

function fallbackAllowed() {
  return String(process.env.VOICELAB_FALLBACK || '').trim().toLowerCase() !== 'false';
}

function baseUrl() {
  return String(process.env.VOICELAB_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

function timeoutMs() {
  const n = Number(process.env.VOICELAB_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 120000;
}

/**
 * The code base carries messages as { role, text } with Gemini's 'model' role
 * for the assistant. Chat Completions wants { role, content }. Array content
 * (text + image parts) passes through untouched for the vision lane.
 */
function toChatMessages(messages) {
  return (messages || []).map((m) => {
    const role = m.role === 'model' ? 'assistant' : (m.role || 'user');
    const content = m.content !== undefined ? m.content : (m.text !== undefined ? m.text : '');
    return { role, content };
  });
}

/** Message content can be a string or an array of typed parts. */
function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === 'string' ? p : (p && typeof p.text === 'string' ? p.text : '')))
      .join('');
  }
  return '';
}

function usageOf(data) {
  const u = (data && data.usage) || {};
  return {
    inTokens: Number(u.prompt_tokens || u.input_tokens || 0) || 0,
    outTokens: Number(u.completion_tokens || u.output_tokens || 0) || 0,
    cachedTokens: Number((u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0) || 0,
  };
}

function buildBody(model, messages, { temperature, maxTokens, responseFormat, stream } = {}) {
  const body = { model, messages: toChatMessages(messages) };
  if (temperature !== undefined && temperature !== null) body.temperature = temperature;
  if (maxTokens) body.max_tokens = Math.max(16, Number(maxTokens) || 0);
  if (responseFormat) body.response_format = responseFormat;
  if (stream) body.stream = true;
  return body;
}

async function post(body, signal) {
  const key = apiKey();
  if (!key) throw new Error('VOICELAB_API_KEY sozlanmagan');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  try {
    const resp = await fetch(baseUrl() + CHAT_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: body.stream ? 'text/event-stream' : 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      const err = new Error(`VoiceLab ${body.model} ${resp.status}: ${errText.substring(0, 300)}`);
      err.status = resp.status;
      err.isModelNotFound = resp.status === 404 || /model_not_found|does not exist|invalid.*model/i.test(errText);
      throw err;
    }
    return resp;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      const e = new Error(`VoiceLab ${body.model} timed out after ${timeoutMs()}ms`);
      e.status = 408;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abort);
  }
}

/**
 * One chat completion.
 * @param {string} modelOrLane  OpenAI model id the caller would have used, or a lane name
 * @returns {{ text, model, provider, usage: { inTokens, outTokens, cachedTokens }, raw }}
 */
async function chatCompletion(modelOrLane, messages, opts = {}) {
  const model = modelFor(modelOrLane);
  const body = buildBody(model, messages, opts);
  const resp = await post(body, opts.signal);
  const data = await resp.json();

  const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
  if (!choice) {
    // The API also documents a request-status endpoint; a response that
    // carries a status and no choices is an accepted-but-unfinished request,
    // which this synchronous path does not poll. Failing loudly lets the
    // caller fall back rather than returning an empty answer.
    const status = data && (data.status || data.state);
    throw new Error(`VoiceLab ${model} returned no choices${status ? ` (status: ${status})` : ''}`);
  }
  const text = contentText(choice.message && choice.message.content);
  if (!text.trim()) throw new Error(`VoiceLab ${model} empty response`);

  return { text, model, provider: `voicelab/${model}`, usage: usageOf(data), raw: data };
}

/**
 * Streaming chat completion over SSE. onToken receives each text delta.
 * Returns the same shape as chatCompletion once the stream ends.
 */
async function chatCompletionStream(modelOrLane, messages, opts = {}, onToken = () => {}) {
  const model = modelFor(modelOrLane);
  const body = buildBody(model, messages, { ...opts, stream: true });
  const resp = await post(body, opts.signal);
  if (!resp.body) throw new Error(`VoiceLab ${model} stream has no body`);

  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  let usage = { inTokens: 0, outTokens: 0, cachedTokens: 0 };
  let done = false;
  try {
  for await (const chunk of resp.body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      if (payload === '[DONE]') { done = true; continue; }
      let ev;
      try { ev = JSON.parse(payload); } catch (_) { continue; }
      if (ev.error) throw new Error(`VoiceLab ${model} stream error: ${JSON.stringify(ev.error).substring(0, 200)}`);
      if (ev.usage) usage = usageOf(ev);
      const delta = ev.choices && ev.choices[0] && ev.choices[0].delta;
      const piece = delta ? contentText(delta.content) : '';
      if (piece) {
        full += piece;
        try { onToken(piece); } catch (_) { /* consumer errors must not kill the stream */ }
      }
    }
    if (done) break;
  }
  } catch (err) {
    // Tokens already shown cannot be taken back; tell the caller so it does
    // not replay the answer from another provider on top of them.
    if (full) err.partialStream = true;
    throw err;
  }
  if (!full) throw new Error(`VoiceLab ${model} stream returned no text`);
  return { text: full, model, provider: `voicelab/${model}`, usage };
}

module.exports = {
  isEnabled,
  routes,
  fallbackAllowed,
  modelFor,
  laneFor,
  chatCompletion,
  chatCompletionStream,
  // exported for tests
  _internal: { toChatMessages, contentText, usageOf, buildBody, DEFAULT_MODELS, LANES },
};
