'use strict';

/**
 * Per-request AI usage ledger (2026-10-03).
 *
 * Every user request (a Telegram message, a web chat answer, a Workspace run)
 * gets one request_id; every AI call made for it - intent, embeddings,
 * retrieval helpers, the answer, cross-check, claim check, retries and
 * fallbacks, STT and TTS - is one row in llm_spend_log with its own call_id,
 * the stage, provider, the model asked for and the model the provider said it
 * used, the usage it reported, latency, status, and the cost with where that
 * cost came from. Failed and timed-out calls are rows too: their cost is
 * unknown unless the provider reported usage, never a silent $0.
 *
 * llm_spend_log was already the spend ledger (budget breaker, spend and
 * margin reports); this fills in what it lacked instead of adding another.
 *
 * The request is carried with AsyncLocalStorage, so calls made in parallel
 * for one request land on it; a call made outside any request (ingest, a
 * scheduled job) is recorded with no request_id.
 */

const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { costForUsage } = require('./model-pricing');
const health = require('./provider-health');

const als = new AsyncLocalStorage();

let writer = null;          // async (row) => void; set by llm-spend-log at boot
let requestWriter = null;   // async (requestRow) => void
let costListener = null;    // (usd) => void; the daily budget breaker
const stats = { writeFailures: 0, rowsWritten: 0 };

function configure({ write, writeRequest, onCost } = {}) {
  if (write) writer = write;
  if (writeRequest) requestWriter = writeRequest;
  if (onCost) costListener = onCost;
}

function uuid() {
  return crypto.randomUUID();
}

// ── Request scope ──────────────────────────────────────────────────────────
function newRequest(meta = {}) {
  return {
    requestId: meta.requestId || uuid(),
    service: meta.service || 'other',
    kind: meta.kind || null,
    chatId: meta.chatId == null ? null : meta.chatId,
    userIdOf: typeof meta.userIdOf === 'function' ? meta.userIdOf : () => (meta.userId == null ? null : meta.userId),
    startedAt: Date.now(),
    seq: { n: 0 },
    stage: null,
    chain: null,
    // shared by every nested scope (withStage / withChain copy the store)
    shared: { calls: 0, providerCalls: 0, knownCostUsd: 0, unknownCostCalls: 0, telemetryErrors: 0, annotations: {}, opened: false, degraded: new Set(),
      // per-call reservations under a strict pool (pilot budget)
      inflightUsd: 0, reservedUnknownUsd: 0, boundExceeded: 0, estimatedRiskCalls: 0, estimatedRiskUsd: 0 },
    budget: requestBudget(meta.budget),
  };
}

/**
 * Per-request limits (2026-10-04: one Telegram question made 53 calls over
 * 114 s). Calls and time are enforced even when prices are unknown; known
 * cost is enforced on top. Answer, cross-check and claim-check calls get a
 * small reserve above the call limit so helpers cannot starve the answer.
 */
function requestBudget(override = {}) {
  const n = (v, d) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : d; };
  return {
    maxCalls: n(override.maxCalls, n(process.env.AI_REQUEST_MAX_CALLS, 30)),
    essentialReserve: n(override.essentialReserve, n(process.env.AI_REQUEST_ESSENTIAL_RESERVE, 6)),
    maxMs: n(override.maxMs, n(process.env.AI_REQUEST_MAX_MS, 120000)),
    maxCostUsd: n(override.maxCostUsd, n(process.env.AI_REQUEST_MAX_COST_USD, 0.25)),
  };
}

const ESSENTIAL_STAGES = new Set(['answer', 'answer_fallback', 'cross_check', 'claim_check', 'stt', 'tts', 'document', 'ocr']);

/** Why a new call may not start for this request, or null. */
function budgetBlock(store, stage) {
  if (!store || !store.budget) return null;
  const b = store.budget;
  if (Date.now() - store.startedAt > b.maxMs) return `time limit ${b.maxMs} ms reached`;
  if (store.shared.knownCostUsd >= b.maxCostUsd) return `known cost limit $${b.maxCostUsd} reached`;
  const limit = b.maxCalls + (ESSENTIAL_STAGES.has(stage) ? b.essentialReserve : 0);
  if (store.shared.providerCalls >= limit) return `call limit ${limit} reached`;
  const pool = b.sharedPool;
  if (pool) {
    const committed = sharedPoolCommitted(store);
    if (committed >= pool.limitUsd) return `${pool.label} budget $${pool.limitUsd} reached ($${committed.toFixed(4)} committed)`;
  }
  return null;
}

/**
 * A budget shared by many requests (the Telegram test account's $5): what
 * earlier requests spent, plus this request's known cost, plus every
 * unknown-cost call counted at a conservative assumed price - unknown is
 * never $0.
 */
function sharedPoolCommitted(store) {
  const pool = store && store.budget && store.budget.sharedPool;
  if (!pool) return 0;
  // under per-call reservation an unknown-cost call counts at what was
  // reserved for it (reservedUnknownUsd), not at the assumed rate
  const unknown = pool.perCall ? store.shared.reservedUnknownUsd : store.shared.unknownCostCalls * pool.unknownCallUsd;
  return pool.spentUsd + store.shared.knownCostUsd + unknown;
}

/** Put the current request under a shared budget: { label, limitUsd, spentUsd, unknownCallUsd }. */
function useSharedBudget(pool) {
  const store = current();
  if (!store || !pool) return false;
  store.budget.sharedPool = {
    label: String(pool.label || 'shared').slice(0, 40),
    limitUsd: Number(pool.limitUsd),
    spentUsd: Math.max(0, Number(pool.spentUsd) || 0),
    unknownCallUsd: Math.max(0, Number(pool.unknownCallUsd) || 0),
  };
  return true;
}

/**
 * An admission step before the request's first AI call (the test budget,
 * src/ai/test-budget.js): { admit(store) -> { ok, reason, pool, maxCostUsd },
 * release(store, committedUsd), unknownCallUsd }. admit runs once, at the
 * first call; refused -> no call is made (one 'skipped' row). release runs
 * when the request finishes, with what it committed.
 */
function useAdmission(admission) {
  const store = current();
  if (!store || !admission || typeof admission.admit !== 'function') return false;
  store.admission = { ...admission, promise: null, state: null, released: false };
  return true;
}

async function admitOnce(store) {
  const a = store && store.admission;
  if (!a) return null;
  if (!a.promise) {
    a.promise = Promise.resolve()
      .then(() => a.admit(store))
      .catch(e => ({ ok: false, reason: `admission check failed: ${safeMessage(e)}` }))
      .then(state => {
        a.state = state;
        if (state && state.ok) {
          if (state.pool) store.budget.sharedPool = state.pool;
          if (state.maxCostUsd != null) store.budget.maxCostUsd = state.maxCostUsd;
        }
        return state;
      });
  }
  return a.promise;
}

async function releaseAdmission(store) {
  const a = store && store.admission;
  if (!a || a.released || !a.state || !a.state.ok || typeof a.release !== 'function') return;
  a.released = true;
  const committed = store.shared.knownCostUsd + store.shared.unknownCostCalls * (Number(a.unknownCallUsd) || 0);
  try { await a.release(store, committed); } catch (error) { console.warn('[USAGE] admission release failed:', safeMessage(error)); }
}

/** Mark the request as served in a reduced mode (e.g. no reranker). */
function degrade(reason) {
  const store = current();
  if (store) store.shared.degraded.add(String(reason).slice(0, 60));
}

/** Run fn inside a new request scope; returns fn's result. */
function runWithRequest(meta, fn) {
  const store = newRequest(meta);
  return als.run(store, () => fn(store));
}

function current() {
  return als.getStore() || null;
}

/** Run fn with a stage label for the AI calls it makes (nested scopes keep the request). */
function withStage(stage, fn) {
  const parent = current();
  if (!parent) return fn();
  return als.run({ ...parent, stage, chain: parent.chain }, fn);
}

/**
 * A router (callAI, callCheapAI, VoiceLab -> OpenAI) runs its attempts in one
 * chain, so a later attempt knows which model failed before it. A nested
 * router reuses the outer chain.
 */
function withChain(fn) {
  const parent = current();
  if (!parent || parent.chain) return fn();
  return als.run({ ...parent, chain: { lastFailed: null, attempts: 0 } }, fn);
}

/** Facts about the request for its summary row (legal check, outcome). */
function annotate(fields = {}) {
  const store = current();
  if (store) Object.assign(store.shared.annotations, fields);
}

// Endpoint labels map to stages; an explicit stage (withStage) wins.
const STAGE_BY_ENDPOINT = [
  [/intent/u, 'intent'],
  [/claim-check/u, 'claim_check'],
  [/cross-check/u, 'cross_check'],
  [/query-plan|lex-plan/u, 'retrieval_plan'],
  [/query-rewrite/u, 'query_rewrite'],
  [/corrective/u, 'retrieval_grade'],
  [/classify-topic/u, 'topic'],
  [/source-suggest/u, 'source_suggestion'],
  [/fallback/u, 'answer_fallback'],
  [/doc-digest|explain-document|legal-opinion|draft/u, 'document'],
  [/legal-verify/u, 'verification'],
  [/screening/u, 'screening'],
  [/ocr|vision/u, 'ocr'],
  [/rag-eval|model-ab/u, 'admin_test'],
  [/tg-agent\/answer|legal-chat|assistant|ai-compact-answer/u, 'answer'],
];

function stageFor(endpoint, explicit) {
  if (explicit) return explicit;
  const store = current();
  if (store && store.stage) return store.stage;
  for (const [re, stage] of STAGE_BY_ENDPOINT) if (re.test(String(endpoint || ''))) return stage;
  return 'other';
}

// ── Recording ──────────────────────────────────────────────────────────────
const SECRET = /(sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|key=[^&\s]+|AIza[0-9A-Za-z_-]{10,})/gu;

function errorCodeOf(error) {
  return error ? health.classifyError(error).code : null;
}

function safeMessage(error) {
  return String((error && error.message) || error || '').replace(SECRET, '[redacted]').slice(0, 160);
}

async function write(row, store) {
  if (!writer) { stats.writeFailures++; if (store) store.shared.telemetryErrors++; return false; }
  try {
    if (store && !store.shared.opened && requestWriter) {
      store.shared.opened = true;
      await requestWriter({ requestId: store.requestId, service: store.service, kind: store.kind, userId: store.userIdOf(), chatId: store.chatId, startedAt: new Date(store.startedAt) });
    }
    await writer(row);
    stats.rowsWritten++;
    return true;
  } catch (error) {
    stats.writeFailures++;
    if (store) store.shared.telemetryErrors++;
    console.warn('[USAGE] ledger write failed:', safeMessage(error));
    return false;
  }
}

/**
 * Record one AI call. event: { callId?, provider, model, modelReturned?,
 * endpoint?, stage?, status, errorCode?, error?, startedAt, finishedAt,
 * usage: { inTokens, outTokens, cachedTokens, reasoningTokens, audioMs,
 * characters, credits, providerCostUsd, estimated }, attempt?, retryReason?,
 * fallbackFrom?, userId? }. Never throws; resolves to the row written.
 */
async function record(event = {}) {
  const store = current();
  const usage = event.usage || {};
  // A call routed to another provider (VoiceLab serving an OpenAI lane) is
  // priced at the model that served it, not the one asked for.
  const priced = costForUsage(usage.billedModel || event.model, usage, { status: event.status });
  const startedAt = event.startedAt ? new Date(event.startedAt) : new Date();
  const finishedAt = event.finishedAt ? new Date(event.finishedAt) : new Date();
  const row = {
    callId: event.callId || uuid(),
    requestId: store ? store.requestId : null,
    seq: store ? ++store.seq.n : null,
    service: store ? store.service : (event.service || 'background'),
    stage: stageFor(event.endpoint, event.stage),
    provider: usage.provider || event.provider || null,
    modelRequested: event.model || null,
    modelReturned: event.modelReturned || null,
    status: event.status || 'success',
    errorCode: event.errorCode || null,
    errorKind: event.errorKind || null,
    errorMessage: event.errorReason ? health.safeReason(event.errorReason) : (event.error ? safeMessage(event.error) : null),
    attempt: event.attempt || 1,
    stageRunId: event.stageRunId || null,
    parentCallId: event.parentCallId || null,
    batchId: event.batchId || null,
    retryReason: event.retryReason || null,
    fallbackFrom: event.fallbackFrom || null,
    startedAt,
    finishedAt,
    latencyMs: Math.max(0, finishedAt - startedAt),
    inTokens: usage.inTokens == null ? null : Number(usage.inTokens),
    outTokens: usage.outTokens == null ? null : Number(usage.outTokens),
    cachedTokens: usage.cachedTokens == null ? null : Number(usage.cachedTokens),
    reasoningTokens: usage.reasoningTokens == null ? null : Number(usage.reasoningTokens),
    audioMs: usage.audioMs == null ? null : Number(usage.audioMs),
    characters: usage.characters == null ? null : Number(usage.characters),
    credits: usage.credits == null ? null : Number(usage.credits),
    costUsd: priced.costUsd,
    costSource: priced.costSource,
    pricing: priced.snapshot,
    userId: event.userId != null ? event.userId : (store ? store.userIdOf() : null),
    chatId: store ? store.chatId : null,
    endpoint: event.endpoint || null,
  };
  if (store) {
    store.shared.calls++;
    if (row.status !== 'skipped') store.shared.providerCalls++;
    if (priced.costUsd) store.shared.knownCostUsd += priced.costUsd;
    if (priced.costUsd == null && row.status !== 'skipped') store.shared.unknownCostCalls++;
  }
  if (priced.costUsd && costListener) {
    try { costListener(priced.costUsd); } catch (_) { /* the breaker must not break a call */ }
  }
  await write(row, store);
  return row;
}

/**
 * Track one provider call: fn(call) runs it; call.usage({...}) reports what
 * the provider returned, call.retry(reason, error) records a failed attempt
 * before the adapter tries again. Every attempt is a row; attempts of one
 * logical call share stage_run_id and point to the previous attempt with
 * parent_call_id. Success and failure are both recorded; the error is
 * rethrown unchanged. A call inside a router chain after a failed one carries
 * that model as fallback_from.
 *
 * Before calling: a provider/model whose breaker is open, or a request over
 * its budget, is not called at all - one "skipped" row, and an error with
 * code CIRCUIT_OPEN / REQUEST_BUDGET so the router moves on.
 * meta.retryTransient (0-2) retries a transient error, waiting Retry-After
 * (capped) or a short jittered backoff, within the request's budget.
 */
/**
 * Reserve one call attempt's maximum cost under a per-call pool (the pilot
 * budget, src/ai/test-budget.js): the request's committed cost + every
 * attempt still running + this one's bound must stay within the pool.
 * meta.bound = model-pricing callCostBound(): { usd } or { usd: null, reason }.
 * A call without a bound is refused in 'strict' mode; in 'estimated' mode it
 * runs at the pool's stated estimate and is counted as estimated risk.
 * Returns null (no pool), { refuse } or { usd, estimated, release(actualUsd) }.
 */
function reserveCall(store, meta) {
  const pool = store && store.budget && store.budget.sharedPool;
  if (!pool || !pool.perCall) return null;
  let usd = meta.bound && Number.isFinite(Number(meta.bound.usd)) && meta.bound.usd != null ? Number(meta.bound.usd) : null;
  let estimated = false;
  if (usd == null) {
    const why = (meta.bound && meta.bound.reason) || 'no cost bound given for this call';
    if (pool.perCall !== 'estimated' || !(pool.unboundedCallUsd > 0)) return { refuse: `no upper cost bound (${why})` };
    usd = pool.unboundedCallUsd;
    estimated = true;
  }
  const committed = sharedPoolCommitted(store);
  if (committed + store.shared.inflightUsd + usd > pool.limitUsd + 1e-12) {
    return { refuse: `call reservation $${usd.toFixed(4)} exceeds the request's remaining $${Math.max(0, pool.limitUsd - committed - store.shared.inflightUsd).toFixed(4)}` };
  }
  store.shared.inflightUsd += usd;
  if (estimated) { store.shared.estimatedRiskCalls++; store.shared.estimatedRiskUsd += usd; }
  let done = false;
  return {
    usd, estimated,
    release(knownBefore, unknownBefore) {
      if (done) return;
      done = true;
      store.shared.inflightUsd = Math.max(0, store.shared.inflightUsd - usd);
      const actual = store.shared.knownCostUsd - knownBefore;
      // a call whose cost came back unknown counts at its full reservation
      if (store.shared.unknownCostCalls > unknownBefore) store.shared.reservedUnknownUsd += usd * (store.shared.unknownCostCalls - unknownBefore);
      if (!estimated && actual > usd + 1e-9) {
        store.shared.boundExceeded++;
        store.shared.annotations.boundExceeded = (store.shared.annotations.boundExceeded || 0) + 1;
      }
    },
  };
}

async function track(meta, fn) {
  const store = current();
  const chain = store && store.chain;
  const fallbackFrom = meta.fallbackFrom || (chain && chain.lastFailed) || null;
  const stage = stageFor(meta.endpoint, meta.stage);
  const stageRunId = uuid();
  let attempt = 1;
  let callId = uuid();
  let parentCallId = null;
  let startedAt = Date.now();
  let usage = null;
  let modelReturned = null;
  let retryReason = null;
  const base = { ...meta, stage, stageRunId, fallbackFrom };

  const skip = (code, reason) => {
    record({ ...base, callId, status: 'skipped', errorCode: code, errorKind: 'skipped', errorReason: reason, startedAt, finishedAt: Date.now(), usage: {}, attempt });
    if (chain) chain.lastFailed = meta.model || meta.provider || null;
    return Object.assign(new Error(`${meta.provider || 'provider'} ${meta.model || ''} not called: ${reason}`), { code });
  };
  if (store && store.admission) {
    const adm = await admitOnce(store);
    if (!adm || !adm.ok) throw skip('TEST_BUDGET', (adm && adm.reason) || 'test budget refused');
  }
  const open = health.openState(meta.provider, meta.model);
  if (open) throw skip('CIRCUIT_OPEN', `${open.code}: ${open.reason || 'circuit open'} (until ${new Date(open.until).toISOString()})`);
  const blocked = budgetBlock(store, stage);
  if (blocked) throw skip('REQUEST_BUDGET', blocked);

  // per-attempt reservation (strict pilot budget): every attempt - the
  // first, a transient retry, an adapter's own retry - reserves its own
  // bound before the provider is called; a fallback is its own track()
  let reservation = null;
  let knownBefore = 0;
  let unknownBefore = 0;
  const reserveAttempt = () => {
    const r = reserveCall(store, meta);
    if (r && r.refuse) throw skip('CALL_RESERVE', r.refuse);
    reservation = r;
    knownBefore = store ? store.shared.knownCostUsd : 0;
    unknownBefore = store ? store.shared.unknownCostCalls : 0;
  };
  const releaseAttempt = () => { if (reservation) reservation.release(knownBefore, unknownBefore); reservation = null; };
  reserveAttempt();

  const failAttempt = (error, { breaker = true } = {}) => {
    const c = health.classifyError(error);
    record({ ...base, callId, parentCallId, modelReturned, status: c.code === 'TIMEOUT' ? 'timeout' : 'error', errorCode: c.code, errorKind: c.kind, errorReason: c.reason, startedAt, finishedAt: Date.now(), usage: usage || {}, attempt, retryReason });
    if (breaker) health.recordOutcome(meta.provider, meta.model, c);
    return c;
  };
  const nextAttempt = (reason) => {
    parentCallId = callId;
    callId = uuid();
    attempt++;
    retryReason = String(reason || 'retry').slice(0, 120);
    startedAt = Date.now();
    usage = null;
  };
  const call = {
    usage(u = {}) { usage = { ...(usage || {}), ...u }; if (u.modelReturned) modelReturned = u.modelReturned; },
    // The adapter fixes the request and tries again (e.g. without a rejected
    // parameter): the attempt is recorded, but it does not trip the breaker.
    async retry(reason, error) {
      failAttempt(error, { breaker: false });
      releaseAttempt();
      nextAttempt(reason);
      reserveAttempt();
    },
  };

  // Essential stages get one retry on a transient error by default; helpers
  // fall through to the next provider instead. A stream sets 0 (its tokens
  // may already be on the user's screen).
  const retries = meta.retryTransient != null ? meta.retryTransient : (ESSENTIAL_STAGES.has(stage) ? 1 : 0);
  let transientLeft = Math.max(0, Math.min(2, Number(retries) || 0));
  for (;;) {
    try {
      const result = await fn(call);
      record({ ...base, callId, parentCallId, modelReturned, status: 'success', startedAt, finishedAt: Date.now(), usage: usage || {}, attempt, retryReason });
      releaseAttempt();
      health.recordSuccess(meta.provider, meta.model);
      if (chain) chain.lastFailed = null;
      return result;
    } catch (error) {
      if (error && error.code === 'CALL_RESERVE' && !reservation) throw error;   // an adapter retry was refused
      const c = failAttempt(error);
      releaseAttempt();
      if (c.kind === 'transient' && transientLeft > 0 && !budgetBlock(store, stage) && !health.openState(meta.provider, meta.model)) {
        transientLeft--;
        const wait = Math.min(4000, c.retryAfterMs != null ? c.retryAfterMs : 400 + Math.floor(Math.random() * 600));
        await new Promise(r => setTimeout(r, wait));
        nextAttempt(`transient:${c.code}`);
        reserveAttempt();
        continue;
      }
      if (chain) chain.lastFailed = meta.model || meta.provider || null;
      throw error;
    }
  }
}

/** Gemini usageMetadata -> ledger usage. Thinking tokens are billed as output
 * and are NOT inside candidatesTokenCount; cached tokens are inside the prompt. */
function usageFromGemini(meta) {
  if (!meta) return {};
  const thoughts = meta.thoughtsTokenCount || 0;
  return {
    inTokens: meta.promptTokenCount || 0,
    cachedTokens: meta.cachedContentTokenCount || 0,
    outTokens: (meta.candidatesTokenCount || 0) + thoughts,
    reasoningTokens: thoughts || null,
  };
}

/** OpenAI Responses usage -> ledger usage. Cached tokens are part of input and
 * reasoning tokens part of output; neither is added again. */
function usageFromOpenAI(u) {
  if (!u) return {};
  return {
    inTokens: u.input_tokens || u.prompt_tokens || 0,
    outTokens: u.output_tokens || u.completion_tokens || 0,
    cachedTokens: (u.input_tokens_details && u.input_tokens_details.cached_tokens)
      || (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0,
    reasoningTokens: (u.output_tokens_details && u.output_tokens_details.reasoning_tokens)
      || (u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || null,
  };
}

/** Close the request: end-to-end latency, outcome, legal check, telemetry health. */
async function finishRequest(store, fields = {}) {
  await releaseAdmission(store);
  if (!store || !requestWriter) return;
  const data = { ...store.shared.annotations, ...fields };
  if (!store.shared.opened && !store.shared.calls) return; // no AI call was made: nothing to close
  try {
    await requestWriter({
      requestId: store.requestId,
      service: store.service,
      kind: store.kind,
      userId: store.userIdOf(),
      chatId: store.chatId,
      startedAt: new Date(store.startedAt),
      finishedAt: new Date(),
      outcome: data.outcome || null,
      legalCheck: data.legalCheck || null,
      degraded: store.shared.degraded.size ? [...store.shared.degraded] : null,
      telemetryErrors: store.shared.telemetryErrors,
    });
  } catch (error) {
    stats.writeFailures++;
    console.warn('[USAGE] request summary write failed:', safeMessage(error));
  }
}

/** Express middleware: one request scope per API request; closed when the response ends. */
function expressScope(service = 'web') {
  return (req, res, next) => runWithRequest({
    service: /\/workspaces\//u.test(req.originalUrl || req.url || '') ? 'workspace' : service,
    kind: `${req.method} ${String(req.baseUrl || '') + String(req.path || '')}`.slice(0, 80),
    userIdOf: () => (req.session && (req.session.adminId || req.session.userId)) || null,
  }, (store) => {
    res.on('finish', () => { finishRequest(store, { outcome: `http_${res.statusCode}` }).catch(() => {}); });
    // a client that left before the end: the admission hold is still released
    res.on('close', () => { if (!res.writableFinished) releaseAdmission(store).catch(() => {}); });
    next();
  });
}

module.exports = {
  configure, runWithRequest, current, withStage, withChain, annotate, record, track, degrade, requestBudget, budgetBlock,
  useSharedBudget, sharedPoolCommitted, useAdmission, releaseAdmission, reserveCall,
  finishRequest, expressScope, stageFor, errorCodeOf, safeMessage, stats, usageFromGemini, usageFromOpenAI,
};
