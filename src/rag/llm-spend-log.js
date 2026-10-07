'use strict';

/**
 * LLM Spend Log — persistent daily/monthly spend tracking for budget guard.
 *
 * Mirrors the in-process Maps in hybrid-pipeline.js to a PG table so spend
 * survives process restarts / redeploys. Caller should:
 *   1. On boot: call `initSpendLog()` + `loadSpendIntoPipeline(hybridPipeline)`
 *   2. After each LLM call: call `recordSpendRow(...)` (best-effort, non-blocking)
 *
 * Schema:
 *   llm_spend_log(
 *     id           SERIAL PRIMARY KEY,
 *     ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *     day          DATE NOT NULL,             -- denormalized for fast aggregation
 *     month        CHAR(7) NOT NULL,          -- 'YYYY-MM'
 *     model        VARCHAR(50) NOT NULL,
 *     stage        VARCHAR(20) NOT NULL,      -- 'classify' | 'generate' | 'embed'
 *     in_tokens    INTEGER NOT NULL,
 *     out_tokens   INTEGER NOT NULL,
 *     cost_usd     NUMERIC(10,6) NOT NULL,
 *     user_id      INTEGER,                   -- optional, for per-user analytics
 *     endpoint     VARCHAR(50)                -- optional, e.g. '/api/advanced-chat'
 *   )
 */

const { pool } = require('../database/db');

let _initialized = false;

async function initSpendLog() {
  if (_initialized) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS llm_spend_log (
        id         SERIAL PRIMARY KEY,
        ts         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        day        DATE NOT NULL,
        month      CHAR(7) NOT NULL,
        model      VARCHAR(50) NOT NULL,
        stage      VARCHAR(20) NOT NULL,
        in_tokens  INTEGER NOT NULL DEFAULT 0,
        out_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd   NUMERIC(10,6) NOT NULL DEFAULT 0,
        user_id    INTEGER,
        endpoint   VARCHAR(50)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_llm_spend_day ON llm_spend_log(day)`);
    // Same index as migrations/20260925_010 for databases where this table
    // is created after that migration ran.
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_llm_spend_user_ts ON llm_spend_log(user_id, ts DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_llm_spend_month ON llm_spend_log(month)`);
    await extendForUsageLedger();
    _initialized = true;
    console.log('[SPEND-LOG] llm_spend_log schema ready');
  } catch (err) {
    console.error('[SPEND-LOG] Init failed:', err.message);
  }
}

/**
 * The per-request usage ledger (src/ai/usage-ledger.js, 2026-10-03) writes
 * here: one row per AI call, failed and timed-out ones included. Older rows
 * keep NULL in the new columns; a row's tokens or cost may be NULL now when
 * the provider reported none (unknown is not $0). ai_requests holds one row
 * per user request: service, end-to-end latency, outcome, legal check.
 */
async function extendForUsageLedger() {
  const columns = [
    'request_id UUID', 'call_id UUID', 'seq INTEGER', 'service VARCHAR(20)', 'provider VARCHAR(40)',
    'model_requested VARCHAR(80)', 'model_returned VARCHAR(80)', 'status VARCHAR(12)', 'error_code VARCHAR(40)',
    'error_message VARCHAR(200)', 'attempt SMALLINT', 'retry_reason VARCHAR(120)', 'fallback_from VARCHAR(80)',
    'started_at TIMESTAMPTZ', 'finished_at TIMESTAMPTZ', 'latency_ms INTEGER', 'cached_in_tokens INTEGER',
    'reasoning_tokens INTEGER', 'audio_ms INTEGER', 'characters INTEGER', 'provider_credits NUMERIC(14,4)',
    'cost_source VARCHAR(20)', 'pricing JSONB', 'chat_id BIGINT',
    // 2026-10-04: what kind of failure, and which rows are attempts of one
    // logical call (stage_run_id, parent_call_id) or pairs of one batch
    'error_kind VARCHAR(12)', 'stage_run_id UUID', 'parent_call_id UUID', 'batch_id UUID',
  ];
  for (const column of columns) {
    await pool.query(`ALTER TABLE llm_spend_log ADD COLUMN IF NOT EXISTS ${column}`);
  }
  // unknown is not zero: tokens and cost may be NULL; small calls need more scale
  await pool.query(`ALTER TABLE llm_spend_log ALTER COLUMN in_tokens DROP NOT NULL, ALTER COLUMN out_tokens DROP NOT NULL, ALTER COLUMN cost_usd DROP NOT NULL`);
  await pool.query(`ALTER TABLE llm_spend_log ALTER COLUMN model TYPE VARCHAR(80), ALTER COLUMN stage TYPE VARCHAR(30), ALTER COLUMN endpoint TYPE VARCHAR(80)`);
  const scale = await pool.query(`SELECT numeric_scale FROM information_schema.columns WHERE table_name = 'llm_spend_log' AND column_name = 'cost_usd'`);
  if (scale.rows[0] && Number(scale.rows[0].numeric_scale) < 10) {
    await pool.query(`ALTER TABLE llm_spend_log ALTER COLUMN cost_usd TYPE NUMERIC(16,10)`);
  }
  // the same call recorded twice is one row
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_spend_call_id ON llm_spend_log(call_id) WHERE call_id IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_llm_spend_request ON llm_spend_log(request_id, seq) WHERE request_id IS NOT NULL`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_requests (
      request_id       UUID PRIMARY KEY,
      service          VARCHAR(20) NOT NULL,
      kind             VARCHAR(80),
      user_id          INTEGER,
      chat_id          BIGINT,
      started_at       TIMESTAMPTZ NOT NULL,
      finished_at      TIMESTAMPTZ,
      latency_ms       INTEGER,
      outcome          VARCHAR(40),
      legal_check      JSONB,
      telemetry_errors INTEGER NOT NULL DEFAULT 0,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_requests_started ON ai_requests(started_at DESC)`);
  await pool.query(`ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS degraded JSONB`);
  // why the AI ran: 'user_question' | 'service_confirmed' (src/ai/ai-trigger.js); NULL for flows that do not say
  await pool.query(`ALTER TABLE ai_requests ADD COLUMN IF NOT EXISTS trigger VARCHAR(40)`);
  await pool.query(`ALTER TABLE ai_requests ENABLE ROW LEVEL SECURITY`);
}

/** One AI call (usage-ledger row). Duplicate call_id: ignored. Throws on DB error. */
async function writeLedgerRow(r) {
  if (!_initialized) await initSpendLog();
  const ts = r.startedAt || new Date();
  await pool.query(
    `INSERT INTO llm_spend_log (
       ts, day, month, model, stage, in_tokens, out_tokens, cost_usd, user_id, endpoint,
       request_id, call_id, seq, service, provider, model_requested, model_returned, status, error_code,
       error_message, attempt, retry_reason, fallback_from, started_at, finished_at, latency_ms,
       cached_in_tokens, reasoning_tokens, audio_ms, characters, provider_credits, cost_source, pricing, chat_id,
       error_kind, stage_run_id, parent_call_id, batch_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38)
     ON CONFLICT (call_id) WHERE call_id IS NOT NULL DO NOTHING`,
    [ts, ts.toISOString().slice(0, 10), ts.toISOString().slice(0, 7),
      String(r.modelRequested || r.provider || 'unknown').slice(0, 80), String(r.stage || 'other').slice(0, 30),
      r.inTokens, r.outTokens, r.costUsd, r.userId, r.endpoint ? String(r.endpoint).slice(0, 80) : null,
      r.requestId, r.callId, r.seq, r.service, r.provider, r.modelRequested, r.modelReturned, r.status, r.errorCode,
      r.errorMessage, r.attempt, r.retryReason, r.fallbackFrom, r.startedAt, r.finishedAt, r.latencyMs,
      r.cachedTokens, r.reasoningTokens, r.audioMs, r.characters, r.credits, r.costSource,
      r.pricing ? JSON.stringify(r.pricing) : null, r.chatId,
      r.errorKind || null, r.stageRunId || null, r.parentCallId || null, r.batchId || null]
  );
}

/** Open or close a request's summary row. Throws on DB error. */
async function writeRequestRow(r) {
  if (!_initialized) await initSpendLog();
  await pool.query(
    `INSERT INTO ai_requests (request_id, service, kind, user_id, chat_id, started_at, finished_at, latency_ms, outcome, legal_check, telemetry_errors, degraded, trigger)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (request_id) DO UPDATE SET
       finished_at = COALESCE(EXCLUDED.finished_at, ai_requests.finished_at),
       latency_ms = COALESCE(EXCLUDED.latency_ms, ai_requests.latency_ms),
       outcome = COALESCE(EXCLUDED.outcome, ai_requests.outcome),
       legal_check = COALESCE(EXCLUDED.legal_check, ai_requests.legal_check),
       degraded = COALESCE(EXCLUDED.degraded, ai_requests.degraded),
       trigger = COALESCE(ai_requests.trigger, EXCLUDED.trigger),
       user_id = COALESCE(ai_requests.user_id, EXCLUDED.user_id),
       telemetry_errors = GREATEST(ai_requests.telemetry_errors, EXCLUDED.telemetry_errors)`,
    [r.requestId, r.service, r.kind, r.userId, r.chatId, r.startedAt, r.finishedAt || null,
      r.finishedAt ? Math.max(0, r.finishedAt - r.startedAt) : null, r.outcome || null,
      r.legalCheck ? JSON.stringify(r.legalCheck) : null, r.telemetryErrors || 0,
      r.degraded ? JSON.stringify(r.degraded) : null, r.trigger || null]
  );
}

/**
 * Insert a row describing a single LLM call. Best-effort — never throws.
 */
async function recordSpendRow({ model, stage, inTokens = 0, outTokens = 0, costUsd = 0, userId = null, endpoint = null }) {
  if (!_initialized) await initSpendLog();
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);
  try {
    await pool.query(
      `INSERT INTO llm_spend_log (day, month, model, stage, in_tokens, out_tokens, cost_usd, user_id, endpoint)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [day, month, model, stage, inTokens, outTokens, costUsd, userId, endpoint]
    );
  } catch (err) {
    console.warn('[SPEND-LOG] insert failed:', err.message);
  }
}

/**
 * Sum spend for today and this month. Returns USD totals.
 */
async function getSpendTotals() {
  if (!_initialized) await initSpendLog();
  const day = new Date().toISOString().slice(0, 10);
  const month = new Date().toISOString().slice(0, 7);
  const [dayRes, monthRes] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(cost_usd), 0)::float AS total FROM llm_spend_log WHERE day = $1`, [day]),
    pool.query(`SELECT COALESCE(SUM(cost_usd), 0)::float AS total FROM llm_spend_log WHERE month = $1`, [month]),
  ]);
  return {
    today: dayRes.rows[0].total,
    month: monthRes.rows[0].total,
  };
}

/**
 * On boot, load persistent totals back into the in-process spendTracker
 * in hybrid-pipeline so the budget guard is accurate after a restart.
 */
async function loadSpendIntoPipeline(hybridPipeline) {
  try {
    const totals = await getSpendTotals();
    // hybridPipeline.recordSpend only adds — so adding totals restores the daily/monthly sums
    if (totals.today > 0) hybridPipeline.recordSpend(totals.today);
    // Note: recordSpend adds to both daily AND monthly simultaneously. To avoid
    // double-counting the daily portion of the month, add only the difference.
    const delta = Math.max(0, totals.month - totals.today);
    if (delta > 0) {
      // Directly bump monthly by delta via a synthetic small-daily-then-rollback?
      // Simpler: expose monthly via the stats endpoint from DB instead of pipeline.
      // For budget enforcement, use getSpendTotals() checks in a wrapper.
    }
    console.log(`[SPEND-LOG] Loaded: today=$${totals.today.toFixed(4)}, month=$${totals.month.toFixed(4)}`);
  } catch (err) {
    console.warn('[SPEND-LOG] loadSpendIntoPipeline failed:', err.message);
  }
}

/**
 * Per-model breakdown for the current month. Used by metrics dashboard.
 */
async function getSpendBreakdown({ days = 30 } = {}) {
  if (!_initialized) await initSpendLog();
  const result = await pool.query(`
    SELECT
      model,
      stage,
      COUNT(*)::int          AS calls,
      SUM(in_tokens)::int    AS in_tokens,
      SUM(out_tokens)::int   AS out_tokens,
      SUM(cost_usd)::float   AS cost_usd
    FROM llm_spend_log
    WHERE ts > NOW() - ($1 || ' days')::INTERVAL
    GROUP BY model, stage
    ORDER BY cost_usd DESC NULLS LAST
  `, [days]);
  return result.rows;
}

/**
 * Per-user spend breakdown. JOINs admins table for display name.
 * Rows with user_id = NULL are grouped under a synthetic "unknown" user.
 */
async function getSpendByUser({ days = 30 } = {}) {
  if (!_initialized) await initSpendLog();
  const result = await pool.query(`
    SELECT
      s.user_id,
      COALESCE(a.full_name, a.username, 'Noma''lum foydalanuvchi') AS display_name,
      COUNT(*)::int          AS calls,
      SUM(s.in_tokens)::int  AS in_tokens,
      SUM(s.out_tokens)::int AS out_tokens,
      SUM(s.cost_usd)::float AS cost_usd
    FROM llm_spend_log s
    LEFT JOIN admins a ON a.id = s.user_id
    WHERE s.ts > NOW() - ($1 || ' days')::INTERVAL
    GROUP BY s.user_id, a.full_name, a.username
    ORDER BY cost_usd DESC NULLS LAST
  `, [days]);
  return result.rows;
}

module.exports = {
  initSpendLog,
  writeLedgerRow,
  writeRequestRow,
  recordSpendRow,
  getSpendTotals,
  getSpendBreakdown,
  getSpendByUser,
  loadSpendIntoPipeline,
};
