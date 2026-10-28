'use strict';

/**
 * Agent runs in Postgres (2026-10-28, migration 020,
 * docs/design/matter-va-agent-runs.md section 3). A run is queued by a
 * route, taken by the worker under a lease, checkpointed step by step and
 * finished with a result. Everything here is plain SQL on the `db` given;
 * no AI, no tariff (the reservations a run holds are listed in `jobs` and
 * settled by the workflow's executor).
 *
 * Privacy: `input` (documents, facts) and the steps' `output` live only
 * while the run does - `finish` empties both. The trace keeps label,
 * status, ms and a short note, as the harness gives them.
 */

const crypto = require('crypto');

const TERMINAL = Object.freeze(['done', 'failed', 'cancelled', 'budget', 'needs_input']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const isUuid = v => typeof v === 'string' && UUID.test(v);
const short = (v, max) => (v == null ? null : String(v).slice(0, max));

class RunError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function createRunStore({ db, maxActivePerUser = Number(process.env.AGENT_RUNS_ACTIVE_PER_USER) || 5 } = {}) {
  if (!db) throw new Error('db is required');

  /** A new queued run. `requestId` is the usage-ledger request its AI calls go under (and its reservations were made under). */
  async function create({ adminId, workflow, input, jobs = [], budget = {}, channel = 'web', requestId = null, matterId = null, status = 'queued', plan = null, price = null }) {
    if (!['queued', 'awaiting_approval'].includes(status)) throw new Error(`a run starts queued or awaiting approval, not ${status}`);
    const active = await db.query(
      `SELECT count(*)::int AS n FROM agent_runs WHERE admin_id = $1 AND status IN ('queued', 'running', 'awaiting_approval')`, [adminId]);
    if (active.rows[0].n >= maxActivePerUser) {
      throw new RunError(429, 'too_many_runs', `Bir vaqtda ${maxActivePerUser} tadan ortiq agent ishi bo'lmaydi. Avvalgilari tugashini kuting.`);
    }
    const r = await db.query(
      `INSERT INTO agent_runs (admin_id, matter_id, workflow, channel, input, jobs, budget, request_id, status, plan, price)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10::jsonb, $11::jsonb) RETURNING *`,
      [adminId, matterId, workflow, channel, JSON.stringify(input == null ? {} : input), JSON.stringify(jobs || []),
        JSON.stringify(budget || {}), requestId || crypto.randomUUID(), status, plan ? JSON.stringify(plan) : null, price ? JSON.stringify(price) : null]);
    return r.rows[0];
  }

  /**
   * Take the oldest run that is queued, or running with its lease run out
   * (its worker died), for `workerId`; an account with another live run
   * waits (one at a time per person). Returns the row (attempts already
   * counted), or null.
   */
  async function claim(workerId, { leaseSec = 90 } = {}) {
    const r = await db.query(
      `UPDATE agent_runs SET status = 'running', lease_owner = $1, lease_until = now() + ($2 || ' seconds')::interval,
              attempts = attempts + 1, started_at = COALESCE(started_at, now())
        WHERE id = (
          SELECT r.id FROM agent_runs r
           WHERE (r.status = 'queued' OR (r.status = 'running' AND r.lease_until < now()))
             AND NOT EXISTS (SELECT 1 FROM agent_runs o
                              WHERE o.admin_id = r.admin_id AND o.id <> r.id
                                AND o.status = 'running' AND o.lease_until >= now())
           ORDER BY r.created_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1)
        RETURNING *`, [workerId, String(leaseSec)]);
    return r.rows[0] || null;
  }

  /** Keep the lease; false when the run is no longer this worker's (it was taken over). */
  async function heartbeat(id, workerId, { leaseSec = 90 } = {}) {
    const r = await db.query(
      `UPDATE agent_runs SET lease_until = now() + ($3 || ' seconds')::interval
        WHERE id = $1 AND lease_owner = $2 AND status = 'running' RETURNING id`, [id, workerId, String(leaseSec)]);
    return r.rowCount > 0;
  }

  /** One finished step: its trace entry and, for an 'ok' step, its output (the checkpoint). */
  async function saveStep(runId, entry, output) {
    const json = output === undefined ? null : JSON.stringify(output);
    await db.query(
      `INSERT INTO agent_run_steps (run_id, step_id, label, status, output, note, error, ms, finished_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, now())
       ON CONFLICT (run_id, step_id) DO UPDATE
          SET label = EXCLUDED.label, status = EXCLUDED.status, output = EXCLUDED.output, note = EXCLUDED.note,
              error = EXCLUDED.error, ms = EXCLUDED.ms, finished_at = now()`,
      [runId, short(entry.id, 60), short(entry.label, 200) || '', entry.status, entry.status === 'ok' ? json : null,
        short(entry.note, 200), short(entry.error, 200), Number.isFinite(entry.ms) ? Math.round(entry.ms) : null]);
  }

  /** The outputs of the steps a previous attempt finished: { stepId: output }. */
  async function checkpoints(runId) {
    const r = await db.query(`SELECT step_id, output FROM agent_run_steps WHERE run_id = $1 AND status = 'ok' AND output IS NOT NULL`, [runId]);
    return Object.fromEntries(r.rows.map(x => [x.step_id, x.output]));
  }

  /**
   * End a run: its status, the result the page shows, the AI it spent. The
   * input and the steps' outputs are emptied (they held the documents).
   * Only the worker holding the lease may finish a running run; `force`
   * finishes it whoever holds it (attempts exhausted, cancelled before start).
   */
  async function finish(id, { workerId = null, status, result = null, error = null, spent = null, force = false }) {
    if (!TERMINAL.includes(status)) throw new Error(`not a final status: ${status}`);
    const r = await db.query(
      `UPDATE agent_runs SET status = $3, result = $4::jsonb, error = $5, spent = COALESCE($6::jsonb, spent),
              input = CASE WHEN $3 = 'needs_input' THEN input ELSE NULL END,
              lease_owner = NULL, lease_until = NULL, finished_at = now()
        WHERE id = $1 AND status NOT IN ('done', 'failed', 'cancelled', 'budget', 'needs_input')
          AND ($7 OR lease_owner = $2)
        RETURNING id`,
      [id, workerId, status, result == null ? null : JSON.stringify(result), short(error, 300), spent ? JSON.stringify(spent) : null, !!force]);
    // a run waiting for the person's answer keeps its input and checkpoints (it resumes)
    if (r.rowCount && status !== 'needs_input') await db.query('UPDATE agent_run_steps SET output = NULL WHERE run_id = $1', [id]);
    return r.rowCount > 0;
  }

  /**
   * The person answered the question a run stopped on (needs_input): the
   * answer goes into the run's input, the reservations made again are
   * recorded, the step that asked runs again, and the run is queued. Null if
   * the run was not waiting.
   */
  async function resume(id, adminId, { answers = {}, jobs = [] } = {}) {
    if (!isUuid(id)) return null;
    const r = await db.query(
      `UPDATE agent_runs SET status = 'queued', jobs = $4::jsonb, result = NULL, error = NULL, finished_at = NULL, attempts = 0,
              input = jsonb_set(COALESCE(input, '{}'::jsonb), '{answers}', COALESCE(input->'answers', '{}'::jsonb) || $3::jsonb)
        WHERE id = $1 AND admin_id = $2 AND status = 'needs_input' AND NOT cancel_requested RETURNING *`,
      [id, adminId, JSON.stringify(answers || {}), JSON.stringify(jobs || [])]);
    return r.rows[0] || null;
  }

  /**
   * The person asks to stop: a run waiting for approval ends now (nothing
   * was reserved), a queued run ends at the worker's next poll (its units
   * released), a running one before its next step.
   */
  async function requestCancel(id, adminId) {
    if (!isUuid(id)) return null;
    // a run waiting for an answer holds nothing reserved: it ends now
    const q = await db.query(
      `UPDATE agent_runs SET status = 'cancelled', cancel_requested = true, input = NULL
        WHERE id = $1 AND admin_id = $2 AND status = 'needs_input' RETURNING id, status`, [id, adminId]);
    if (q.rows[0]) { await db.query('UPDATE agent_run_steps SET output = NULL WHERE run_id = $1', [id]); return q.rows[0]; }
    const w = await db.query(
      `UPDATE agent_runs SET status = 'cancelled', cancel_requested = true, input = NULL, finished_at = now()
        WHERE id = $1 AND admin_id = $2 AND status = 'awaiting_approval' RETURNING id, status`, [id, adminId]);
    if (w.rows[0]) return w.rows[0];
    const r = await db.query(
      `UPDATE agent_runs SET cancel_requested = true WHERE id = $1 AND admin_id = $2 RETURNING id, status`, [id, adminId]);
    return r.rows[0] || null;
  }

  /** The person approved the plan: its reservations are recorded and the run is queued. Null if it was not waiting. */
  async function approve(id, adminId, jobs = []) {
    if (!isUuid(id)) return null;
    const r = await db.query(
      `UPDATE agent_runs SET status = 'queued', jobs = $3::jsonb
        WHERE id = $1 AND admin_id = $2 AND status = 'awaiting_approval' AND NOT cancel_requested RETURNING *`,
      [id, adminId, JSON.stringify(jobs || [])]);
    return r.rows[0] || null;
  }

  /** The chat and status message a Telegram run reports to (src/agents/runs/notify.js). */
  async function setTelegram(id, adminId, telegram) {
    if (!isUuid(id)) return false;
    const r = await db.query(
      `UPDATE agent_runs SET input = jsonb_set(COALESCE(input, '{}'::jsonb), '{telegram}', $3::jsonb)
        WHERE id = $1 AND admin_id = $2 AND input IS NOT NULL RETURNING id`, [id, adminId, JSON.stringify(telegram)]);
    return r.rowCount > 0;
  }

  /** The person's own run row, plan and price included (never to the page as is). */
  async function row(id, adminId) {
    if (!isUuid(id)) return null;
    const r = await db.query('SELECT * FROM agent_runs WHERE id = $1 AND admin_id = $2', [id, adminId]);
    return r.rows[0] || null;
  }

  async function isCancelled(id) {
    const r = await db.query('SELECT cancel_requested FROM agent_runs WHERE id = $1', [id]);
    return !!(r.rows[0] && r.rows[0].cancel_requested);
  }

  /** Queued runs whose owner asked to stop: [{ row }] for the worker to settle. */
  async function cancelledQueued() {
    const r = await db.query(`SELECT * FROM agent_runs WHERE status = 'queued' AND cancel_requested LIMIT 20`);
    return r.rows;
  }

  /** The person's own run with its trace; null for anyone else's. Never the input. */
  async function get(id, adminId) {
    if (!isUuid(id)) return null;
    const r = await db.query(
      `SELECT id, admin_id, matter_id, workflow, channel, status, result, error, attempts, cancel_requested, spent, plan, price,
              created_at, started_at, finished_at, expires_at
         FROM agent_runs WHERE id = $1 AND admin_id = $2`, [id, adminId]);
    const run = r.rows[0];
    if (!run) return null;
    const s = await db.query(
      `SELECT step_id, label, status, note, error, ms, finished_at FROM agent_run_steps WHERE run_id = $1 ORDER BY started_at, finished_at`, [id]);
    return {
      id: run.id, workflow: run.workflow, channel: run.channel, status: run.status, matterId: run.matter_id,
      attempts: run.attempts, cancelRequested: run.cancel_requested,
      createdAt: run.created_at, startedAt: run.started_at, finishedAt: run.finished_at, expiresAt: run.expires_at,
      error: run.error, result: run.result, plan: run.plan || null, price: run.price || null,
      steps: s.rows.map(x => ({ id: x.step_id, label: x.label, status: x.status, note: x.note || undefined, error: x.error || undefined, ms: x.ms })),
    };
  }

  async function list(adminId, { limit = 20 } = {}) {
    const r = await db.query(
      `SELECT id, workflow, channel, status, matter_id, created_at, finished_at FROM agent_runs
        WHERE admin_id = $1 ORDER BY created_at DESC LIMIT $2`, [adminId, Math.max(1, Math.min(100, Number(limit) || 20))]);
    return r.rows.map(x => ({ id: x.id, workflow: x.workflow, channel: x.channel, status: x.status, matterId: x.matter_id, createdAt: x.created_at, finishedAt: x.finished_at }));
  }

  /** Results past their 90 days are emptied unless an open matter links the run. */
  async function sweep() {
    // a plan nobody approved in a day ends (nothing was reserved for it)
    await db.query(`UPDATE agent_runs SET status = 'cancelled', input = NULL, finished_at = now(), error = 'approval_expired'
                     WHERE status = 'awaiting_approval' AND created_at < now() - interval '24 hours'`);
    // a question nobody answered in 7 days ends, and the documents it held go
    const gone = await db.query(`UPDATE agent_runs SET status = 'cancelled', input = NULL, error = 'answer_expired'
                     WHERE status = 'needs_input' AND finished_at < now() - interval '7 days' RETURNING id`);
    if (gone.rows.length) await db.query('UPDATE agent_run_steps SET output = NULL WHERE run_id = ANY($1)', [gone.rows.map(x => x.id)]);
    const r = await db.query(
      `UPDATE agent_runs r SET result = NULL
        WHERE r.result IS NOT NULL AND r.expires_at < now()
          AND NOT EXISTS (SELECT 1 FROM matter_items i JOIN matters m ON m.id = i.matter_id
                           WHERE i.kind = 'agent_run' AND i.ref_uuid = r.id AND m.deleted_at IS NULL)`);
    return r.rowCount;
  }

  return { create, claim, heartbeat, saveStep, checkpoints, finish, resume, requestCancel, approve, row, setTelegram, isCancelled, cancelledQueued, get, list, sweep };
}

/** Account deletion: the person's runs and their steps go. */
async function deleteAccountRuns(db, adminId) {
  await db.query('DELETE FROM agent_runs WHERE admin_id = $1', [adminId]);
}

module.exports = { createRunStore, deleteAccountRuns, RunError, TERMINAL, isUuid };
