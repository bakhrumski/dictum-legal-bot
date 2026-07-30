'use strict';

const log = require('../utils/logger').createLogger('HYBRID');

/**
 * Hybrid RAG Pipeline — JuristAI (Phase 2)
 *
 * Two-model architecture per user budget decision:
 *   1. CLASSIFY (cheap, fast): gpt-5.6-luna → fallback gemini-2.5-flash
 *        Input: raw user query
 *        Output: { topic, language, intent, needs_rag, search_terms }
 *
 *   2. GENERATE (quality):    gpt-5.6-terra → gpt-5.6-luna → gemini-2.5-flash
 *        Input: query + RAG context + citation table
 *        Output: grounded answer, strict zero-hallucination prompt
 *
 * Budget guard:
 *   - Hard ceiling: $1000/month (LLM + infra combined; caller enforces infra side)
 *   - Per-request token cap (DEFAULT_MAX_OUTPUT_TOKENS)
 *   - Per-day spend cap tracked in-process via `spendTracker`
 *
 * Pricing ($/1M tokens):
 *   gpt-5.6-luna         : $1.00 in / $6.00 out   (cost-sensitive, high volume)
 *   gpt-5.6-terra        : $2.50 in / $15.00 out  (balanced)
 *   gpt-5.6-sol          : $5.00 in / $30.00 out  (frontier reasoning)
 *   gemini-2.5-flash     : $0.30 in / $2.50 out   (free-tier fallback)
 *
 * Model chains:
 *   CLASSIFY: gpt-5.6-luna → gemini-2.5-flash
 *   GENERATE: gpt-5.6-terra → gpt-5.6-luna → gemini-2.5-flash
 *
 *   Each call tries the primary model first; on error we auto-fall back to the
 *   next in the chain. Fallback chain is hard-coded per call type below.
 */

const CLASSIFY_MODEL_CHAIN = ['gpt-5.6-luna', 'gemini-2.5-flash'];
const GENERATE_MODEL_CHAIN = ['gpt-5.6-terra', 'gpt-5.6-luna', 'gemini-2.5-flash'];

const DEFAULT_MAX_OUTPUT_TOKENS = 1500;
const CLASSIFY_MAX_OUTPUT_TOKENS = 200;

// Rough price table ($ per 1M tokens). Used for spend tracking.
const PRICING = {
  // GPT-5.6 family (official per-1M pricing)
  'gpt-5.6-luna':     { in: 1.00, out: 6.00 },
  'gpt-5.6-terra':    { in: 2.50, out: 15.00 },
  'gpt-5.6-sol':      { in: 5.00, out: 30.00 },
  'gpt-5.6':          { in: 5.00, out: 30.00 },   // alias -> Sol
  // Gemini free-tier fallback
  'gemini-2.5-flash': { in: 0.30, out: 2.50 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Circuit breaker — prevents hammering providers that are repeatedly failing.
// After CB_FAILURE_THRESHOLD consecutive errors within CB_WINDOW_MS, a model
// is skipped for CB_RESET_MS before being retried.
// ─────────────────────────────────────────────────────────────────────────────

const CB_FAILURE_THRESHOLD = 3;
const CB_WINDOW_MS  = 60_000;  // count failures within this window
const CB_RESET_MS   = 60_000;  // stay open for this long after threshold

const _cbState = new Map(); // model → { failures: [{ts}], openUntil: 0 }

function _cbGet(model) {
  if (!_cbState.has(model)) _cbState.set(model, { failures: [], openUntil: 0 });
  return _cbState.get(model);
}

function isCircuitOpen(model) {
  const state = _cbGet(model);
  if (Date.now() < state.openUntil) return true;
  // Prune old failures outside the window
  const cutoff = Date.now() - CB_WINDOW_MS;
  state.failures = state.failures.filter(f => f.ts > cutoff);
  return false;
}

function recordCbFailure(model) {
  const state = _cbGet(model);
  state.failures.push({ ts: Date.now() });
  const cutoff = Date.now() - CB_WINDOW_MS;
  state.failures = state.failures.filter(f => f.ts > cutoff);
  if (state.failures.length >= CB_FAILURE_THRESHOLD) {
    state.openUntil = Date.now() + CB_RESET_MS;
    log.warn('circuit opened', { model, failures: state.failures.length, resetInMs: CB_RESET_MS });
  }
}

function recordCbSuccess(model) {
  const state = _cbGet(model);
  if (state.failures.length > 0 || state.openUntil > 0) {
    log.info('circuit reset after success', { model });
    state.failures = [];
    state.openUntil = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-process spend tracker. For persistent tracking, caller should call
// recordSpend() AND mirror the value into a DB table.
// ─────────────────────────────────────────────────────────────────────────────

// Optional hook: invoked after each successful LLM call with full details.
// llm-spend-log.js registers this on boot to mirror spend into Postgres.
let _spendHook = null;
function setSpendHook(fn) { _spendHook = (typeof fn === 'function') ? fn : null; }

const spendTracker = {
  daily: new Map(),   // key: YYYY-MM-DD → USD
  monthly: new Map(), // key: YYYY-MM → USD
  monthlyCeilingUsd: Number(process.env.LLM_MONTHLY_CEILING_USD || 1000),
  dailyCeilingUsd: Number(process.env.LLM_DAILY_CEILING_USD || 50),
};

function today() {
  return new Date().toISOString().slice(0, 10);
}
function thisMonth() {
  return new Date().toISOString().slice(0, 7);
}

function recordSpend(usd) {
  if (!usd || usd < 0) return;
  const d = today();
  const m = thisMonth();
  spendTracker.daily.set(d, (spendTracker.daily.get(d) || 0) + usd);
  spendTracker.monthly.set(m, (spendTracker.monthly.get(m) || 0) + usd);
}

function checkBudget() {
  const dailySpent = spendTracker.daily.get(today()) || 0;
  const monthlySpent = spendTracker.monthly.get(thisMonth()) || 0;
  if (monthlySpent >= spendTracker.monthlyCeilingUsd) {
    throw new Error(`LLM monthly budget ceiling reached: $${monthlySpent.toFixed(2)} / $${spendTracker.monthlyCeilingUsd}`);
  }
  if (dailySpent >= spendTracker.dailyCeilingUsd) {
    throw new Error(`LLM daily budget ceiling reached: $${dailySpent.toFixed(2)} / $${spendTracker.dailyCeilingUsd}`);
  }
  return { dailySpent, monthlySpent };
}

function getSpendStats() {
  return {
    today: spendTracker.daily.get(today()) || 0,
    month: spendTracker.monthly.get(thisMonth()) || 0,
    dailyCeiling: spendTracker.dailyCeilingUsd,
    monthlyCeiling: spendTracker.monthlyCeilingUsd,
  };
}

function estimateCost(model, inTokens, outTokens) {
  const p = PRICING[model];
  if (!p) return 0;
  return (inTokens / 1e6) * p.in + (outTokens / 1e6) * p.out;
}

// Rough token estimator (avoids pulling tiktoken). ~4 chars / token for mixed Uzbek+Latin.
function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

// ─────────────────────────────────────────────────────────────────────────────
// Low-level model callers
// ─────────────────────────────────────────────────────────────────────────────

async function callOpenAIModel(model, messages, { temperature = 0.2, maxTokens = DEFAULT_MAX_OUTPUT_TOKENS, responseFormat = null } = {}) {
  const key = process.env.GPT_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('GPT_API_KEY not set');

  const body = {
    model,
    messages: messages.map(m => ({
      role: m.role === 'model' ? 'assistant' : m.role,
      content: m.text || m.content,
    })),
    temperature,
    max_tokens: maxTokens,
  };
  if (responseFormat) body.response_format = responseFormat;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    const err = new Error(`OpenAI ${model} ${resp.status}: ${errText.substring(0, 300)}`);
    err.status = resp.status;
    err.isModelNotFound = resp.status === 404 || /model_not_found|does not exist|invalid.*model/i.test(errText);
    throw err;
  }

  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw new Error(`OpenAI ${model} empty response`);

  const usage = data.usage || {};
  return {
    text,
    provider: model,
    inTokens: usage.prompt_tokens || estimateTokens(JSON.stringify(body.messages)),
    outTokens: usage.completion_tokens || estimateTokens(text),
  };
}

async function callGeminiModel(model, messages, { temperature = 0.2, maxTokens = DEFAULT_MAX_OUTPUT_TOKENS } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set');

  let systemInstruction = null;
  const contents = [];
  for (const m of messages) {
    const text = m.text || m.content;
    if (m.role === 'system') {
      systemInstruction = { parts: [{ text }] };
    } else {
      contents.push({
        role: m.role === 'model' || m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text }],
      });
    }
  }

  const body = {
    contents,
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  };
  if (systemInstruction) body.systemInstruction = systemInstruction;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    const err = new Error(`Gemini ${model} ${resp.status}: ${errText.substring(0, 300)}`);
    err.status = resp.status;
    err.isModelNotFound = resp.status === 404 || /not found|not supported|NOT_FOUND/i.test(errText);
    throw err;
  }

  const data = await resp.json();
  const cand = data.candidates?.[0];
  if (!cand) throw new Error(`Gemini ${model} no candidates`);
  if (cand.finishReason === 'SAFETY') throw new Error(`Gemini ${model} safety-filtered`);

  const parts = cand.content?.parts || [];
  const text = parts.filter(p => p.text && !p.thought).map(p => p.text).join('');
  if (!text) throw new Error(`Gemini ${model} empty response`);

  const usage = data.usageMetadata || {};
  return {
    text,
    provider: model,
    inTokens: usage.promptTokenCount || estimateTokens(JSON.stringify(contents)),
    outTokens: usage.candidatesTokenCount || estimateTokens(text),
  };
}

function isOpenAIModel(model) {
  return model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3');
}

async function callModel(model, messages, opts) {
  return isOpenAIModel(model)
    ? callOpenAIModel(model, messages, opts)
    : callGeminiModel(model, messages, opts);
}

/**
 * Try each model in chain. Falls back on 404 / model-not-found, on missing API key,
 * and on transient 5xx. Bails on the first successful call.
 */
async function callWithFallback(chain, messages, opts = {}) {
  checkBudget();
  const errors = [];
  for (const model of chain) {
    if (isCircuitOpen(model)) {
      errors.push(`${model}: circuit open`);
      log.debug('skipping model (circuit open)', { model, stage: opts.stage });
      continue;
    }
    try {
      const result = await callModel(model, messages, opts);
      const cost = estimateCost(model, result.inTokens, result.outTokens);
      recordSpend(cost);
      recordCbSuccess(model);
      if (_spendHook) {
        try {
          await _spendHook({
            model,
            stage: opts.stage || 'generate',
            inTokens: result.inTokens,
            outTokens: result.outTokens,
            costUsd: cost,
            userId: opts.userId || null,
            endpoint: opts.endpoint || null,
          });
        } catch (hookErr) {
          log.warn('spend hook failed', { err: hookErr.message });
        }
      }
      log.info('model ok', { model, stage: opts.stage, inTokens: result.inTokens, outTokens: result.outTokens, costUsd: cost.toFixed(4) });
      return { ...result, estimatedCostUsd: cost };
    } catch (err) {
      recordCbFailure(model);
      log.warn('model failed', { model, stage: opts.stage, err: err.message });
      errors.push(`${model}: ${err.message}`);
      continue;
    }
  }
  throw new Error(`All models in chain failed: ${errors.join(' | ')}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: CLASSIFY
// ─────────────────────────────────────────────────────────────────────────────

const CLASSIFY_SYSTEM = `You are a legal query classifier for JuristAI (Uzbekistan legal assistant).
Given a user question, output STRICT JSON with these fields:
{
  "topic": "mehnat|jinoiy|fuqarolik|oila|soliq|maʼmuriy|advokatura|konstitutsiya|boshqa",
  "language": "uz|ru|en",
  "intent": "lookup|advice|procedure|definition|other",
  "needs_rag": true|false,
  "search_terms": ["kalit soʻz 1", "kalit soʻz 2"]
}
Rules:
- topic: best-fit legal domain; use "boshqa" if unclear
- needs_rag: false ONLY for pure greetings / meta questions ("salom", "sen kimsan")
- search_terms: 2-5 Uzbek legal search phrases extracted from the question
- Output ONLY the JSON object, no prose, no markdown fences.`;

async function classify(query) {
  const messages = [
    { role: 'system', text: CLASSIFY_SYSTEM },
    { role: 'user', text: query },
  ];
  const result = await callWithFallback(CLASSIFY_MODEL_CHAIN, messages, {
    temperature: 0.0,
    maxTokens: CLASSIFY_MAX_OUTPUT_TOKENS,
    responseFormat: { type: 'json_object' },
    stage: 'classify',
  });

  let parsed;
  try {
    // strip accidental code fences
    const cleaned = result.text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.warn('[HYBRID] classify JSON parse failed, using defaults:', err.message);
    parsed = { topic: 'boshqa', language: 'uz', intent: 'other', needs_rag: true, search_terms: [query] };
  }

  return {
    topic: parsed.topic || 'boshqa',
    language: parsed.language || 'uz',
    intent: parsed.intent || 'other',
    needs_rag: parsed.needs_rag !== false,
    search_terms: Array.isArray(parsed.search_terms) && parsed.search_terms.length > 0
      ? parsed.search_terms
      : [query],
    _provider: result.provider,
    _costUsd: result.estimatedCostUsd,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: GENERATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a grounded answer.
 *
 * @param {Object} opts
 * @param {string} opts.query       - user's original question
 * @param {string} opts.systemPrompt - pre-built system prompt (use buildAdvancedPrompt)
 * @param {Array}  opts.history     - prior [{role, text}] messages (optional)
 * @param {number} opts.maxTokens   - override (default DEFAULT_MAX_OUTPUT_TOKENS)
 */
async function generate({ query, systemPrompt, history = [], maxTokens = DEFAULT_MAX_OUTPUT_TOKENS }) {
  const messages = [
    { role: 'system', text: systemPrompt },
    ...history,
    { role: 'user', text: query },
  ];
  const result = await callWithFallback(GENERATE_MODEL_CHAIN, messages, {
    temperature: 0.15,
    maxTokens,
    stage: 'generate',
  });
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestration: full pipeline (classify → retrieve → generate)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full hybrid pipeline. Caller supplies the retrieval function — keeps this
 * module decoupled from advanced-corpus / legal-corpus.
 *
 * @param {Object} opts
 * @param {string} opts.query
 * @param {Function} opts.retrieve    - async (classifyResult) => { ragContext, chunks }
 * @param {Function} opts.buildPrompt - (classifyResult, {ragContext, chunks}) => systemPrompt
 * @param {Array}  opts.history
 */
async function runPipeline({ query, retrieve, buildPrompt, history = [] }) {
  const t0 = Date.now();

  // 1) Classify
  const classification = await classify(query);
  const tClassify = Date.now() - t0;

  // 2) Retrieve
  let retrieval = { ragContext: '', chunks: [] };
  if (classification.needs_rag) {
    retrieval = await retrieve(classification);
  }
  const tRetrieve = Date.now() - t0 - tClassify;

  // Zero-hallucination fallback: no chunks → hard-coded safe response
  if (classification.needs_rag && (!retrieval.chunks || retrieval.chunks.length === 0)) {
    return {
      text: "Ushbu savol bo'yicha lex.uz ma'lumotlar bazasida aniq ma'lumot topilmadi. Iltimos, savolingizni aniqroq qayta yozing yoki tegishli qonun matnini to'g'ridan-to'g'ri lex.uz saytidan qidiring.",
      provider: 'fallback-no-context',
      classification,
      chunks: [],
      timings: { classify: tClassify, retrieve: tRetrieve, generate: 0, total: Date.now() - t0 },
      estimatedCostUsd: classification._costUsd || 0,
    };
  }

  // 3) Generate
  const systemPrompt = buildPrompt(classification, retrieval);
  const gen = await generate({ query, systemPrompt, history });
  const tGen = Date.now() - t0 - tClassify - tRetrieve;

  return {
    text: gen.text,
    provider: gen.provider,
    classification,
    chunks: retrieval.chunks,
    timings: { classify: tClassify, retrieve: tRetrieve, generate: tGen, total: Date.now() - t0 },
    estimatedCostUsd: (classification._costUsd || 0) + (gen.estimatedCostUsd || 0),
  };
}

function getCircuitBreakerStats() {
  const stats = {};
  for (const [model, state] of _cbState.entries()) {
    stats[model] = {
      failures: state.failures.length,
      open: Date.now() < state.openUntil,
      openUntil: state.openUntil > 0 ? new Date(state.openUntil).toISOString() : null,
    };
  }
  return stats;
}

module.exports = {
  // Main entry
  runPipeline,
  classify,
  generate,
  // Budget
  checkBudget,
  recordSpend,
  getSpendStats,
  estimateCost,
  setSpendHook,
  // Circuit breaker
  getCircuitBreakerStats,
  // Configuration (exposed for tests / override)
  CLASSIFY_MODEL_CHAIN,
  GENERATE_MODEL_CHAIN,
  PRICING,
};
