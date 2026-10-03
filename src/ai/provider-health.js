'use strict';

/**
 * Provider errors: what kind they are, and when to stop calling (2026-10-04).
 *
 * Two production requests made 31 and 53 AI calls: every one of 19/33 rerank
 * pairs went out after the first had already come back HTTP 402, and each of
 * a dozen helper calls tried VoiceLab Orbit, then GPT-6 Sol, then Gemini,
 * hitting the same Orbit error and the same OpenAI 429 every time.
 *
 * An error is classified from its status AND the provider's own error code
 * or message, never from the status alone: a 429 can be a rate limit (wait)
 * or an exhausted quota (stop); a 402 says "payment required" but the
 * provider's message says why.
 *
 *   permanent - auth, permission, configuration, model, quota or billing:
 *               the same call will fail again; stop calling that
 *               provider/model for a cooldown, across requests.
 *   transient - rate limit, timeout, network, 5xx: may succeed later; a few
 *               in a row open the breaker briefly.
 *   unknown   - neither (e.g. an empty response): counted like transient.
 */

const PERMANENT_COOLDOWN_MS = () => num(process.env.AI_BREAKER_PERMANENT_MS, 10 * 60 * 1000);
const TRANSIENT_COOLDOWN_MS = () => num(process.env.AI_BREAKER_TRANSIENT_MS, 30 * 1000);
const TRANSIENT_THRESHOLD = () => num(process.env.AI_BREAKER_TRANSIENT_THRESHOLD, 3);

function num(v, d) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; }

const SECRET = /(sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|key=[^&\s"]+|AIza[0-9A-Za-z_-]{10,}|hf_[A-Za-z0-9]{10,})/gu;

/** A short, safe reason: provider code/type/message only, secrets redacted. */
function safeReason(text = '') {
  return String(text || '').replace(SECRET, '[redacted]').replace(/\s+/gu, ' ').trim().slice(0, 200);
}

/** The provider's own error code and message from a JSON error body, when there is one. */
function parseProviderError(body = '') {
  const raw = String(body || '');
  try {
    const j = JSON.parse(raw.slice(raw.indexOf('{')));
    const e = j.error && typeof j.error === 'object' ? j.error : j;
    return {
      code: e.code || e.type || null,
      message: typeof e.message === 'string' ? e.message : (typeof j.error === 'string' ? j.error : null),
    };
  } catch (_) {
    return { code: null, message: raw ? raw.slice(0, 200) : null };
  }
}

const QUOTA_WORDS = /insufficient_quota|quota|billing|credit|payment|subscribe|exceeded your (?:current|monthly)|balance|pre-?paid/iu;

/**
 * { kind, code, reason, retryAfterMs } for an error thrown by a provider
 * call. err.status, err.providerCode, err.providerMessage and err.retryAfter
 * are set by the adapters; the message is the fallback.
 */
function classifyError(err) {
  if (!err) return { kind: 'unknown', code: 'ERROR', reason: '' };
  const status = Number(err.status) || null;
  const providerCode = err.providerCode ? String(err.providerCode) : null;
  const message = String(err.providerMessage || err.message || '');
  const reason = safeReason([providerCode, err.providerMessage || err.message].filter(Boolean).join(': '));
  const retryAfterMs = parseRetryAfter(err.retryAfter);
  if (err.code === 'CIRCUIT_OPEN') return { kind: 'skipped', code: 'CIRCUIT_OPEN', reason };
  if (err.code === 'REQUEST_BUDGET') return { kind: 'skipped', code: 'REQUEST_BUDGET', reason };
  const timeout = err.code === 'TIMEOUT' || err.name === 'TimeoutError' || err.name === 'AbortError' || status === 408 || /timed out|timeout/iu.test(message);
  if (timeout) return { kind: 'transient', code: 'TIMEOUT', reason, retryAfterMs };
  if (status === 429) {
    return QUOTA_WORDS.test(`${providerCode || ''} ${message}`)
      ? { kind: 'permanent', code: 'HTTP_429_QUOTA', reason }
      : { kind: 'transient', code: 'HTTP_429_RATE', reason, retryAfterMs };
  }
  if (status === 401) return { kind: 'permanent', code: 'HTTP_401_AUTH', reason };
  if (status === 402) return { kind: 'permanent', code: 'HTTP_402_PAYMENT', reason };
  if (status === 403) return { kind: 'permanent', code: 'HTTP_403_FORBIDDEN', reason };
  if (status === 404 || err.isModelNotFound) return { kind: 'permanent', code: 'HTTP_404_MODEL', reason };
  if (status === 400 || status === 422) return { kind: 'permanent', code: `HTTP_${status}_REQUEST`, reason };
  if (status && status >= 500) return { kind: 'transient', code: `HTTP_${status}`, reason, retryAfterMs };
  if (err.code && /^[A-Z_]+$/u.test(String(err.code))) {
    const c = String(err.code);
    if (/^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR_\w+)$/u.test(c)) return { kind: 'transient', code: `NET_${c}`, reason };
    return { kind: 'unknown', code: c, reason };
  }
  if (/fetch failed|socket hang up|network/iu.test(message)) return { kind: 'transient', code: 'NET_ERROR', reason };
  return { kind: 'unknown', code: status ? `HTTP_${status}` : 'ERROR', reason };
}

function parseRetryAfter(value) {
  if (value == null || value === '') return null;
  const s = Number(value);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const at = Date.parse(String(value));
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

// ── Circuit breaker (per process; per provider + model) ─────────────────
const breakers = new Map(); // key -> { openUntil, reason, code, failures, firstFailureAt }

function keyOf(provider, model) {
  return `${String(provider || '?').toLowerCase()}|${String(model || '*').toLowerCase()}`;
}

/** Open state for provider+model, or for the whole provider ('*'), else null. */
function openState(provider, model, now = Date.now()) {
  for (const key of [keyOf(provider, model), keyOf(provider, '*')]) {
    const b = breakers.get(key);
    if (b && b.openUntil > now) return { key, until: b.openUntil, code: b.code, reason: b.reason };
  }
  return null;
}

/**
 * Record an outcome. A permanent error opens the breaker for the cooldown;
 * auth/payment errors open it for the whole provider (every model of that
 * account fails the same way). Transient errors open it after a few in a row.
 */
function recordOutcome(provider, model, classified, now = Date.now()) {
  const key = keyOf(provider, model);
  if (!classified) { breakers.delete(key); return null; }
  if (classified.kind === 'skipped') return null;
  if (classified.kind === 'permanent') {
    const accountWide = /^HTTP_(401|402|403)|QUOTA/u.test(classified.code);
    const target = accountWide ? keyOf(provider, '*') : key;
    const state = { openUntil: now + PERMANENT_COOLDOWN_MS(), code: classified.code, reason: classified.reason, failures: 1, firstFailureAt: now };
    breakers.set(target, state);
    return { key: target, ...state };
  }
  const b = breakers.get(key) || { failures: 0, firstFailureAt: now, openUntil: 0 };
  if (now - b.firstFailureAt > 60 * 1000) { b.failures = 0; b.firstFailureAt = now; }
  b.failures += 1;
  b.code = classified.code;
  b.reason = classified.reason;
  if (b.failures >= TRANSIENT_THRESHOLD()) b.openUntil = now + Math.max(TRANSIENT_COOLDOWN_MS(), classified.retryAfterMs || 0);
  breakers.set(key, b);
  return b.openUntil > now ? { key, ...b } : null;
}

function recordSuccess(provider, model) {
  breakers.delete(keyOf(provider, model));
}

/** Breakers open now, for the admin view. */
function snapshot(now = Date.now()) {
  return [...breakers.entries()]
    .filter(([, b]) => b.openUntil > now)
    .map(([key, b]) => ({ key, code: b.code, reason: b.reason, openUntil: new Date(b.openUntil).toISOString() }));
}

function reset() { breakers.clear(); }

module.exports = { classifyError, parseProviderError, parseRetryAfter, safeReason, openState, recordOutcome, recordSuccess, snapshot, reset };
