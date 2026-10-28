'use strict';

/**
 * The agent-run worker (2026-10-28, docs/design/matter-va-agent-runs.md
 * 3.3). It lives in the server process: every `pollMs` it takes runs from
 * the database (store.claim: queued, or running with a dead lease) up to
 * `concurrency` at a time, renews the lease while a run works, and hands
 * the run to its workflow's executor:
 *
 *   executors[workflow] = {
 *     execute(run, { resume, onCheckpoint, shouldStop }) -> { status, httpStatus, body },
 *     abort(run, reason)  -> { httpStatus, body }   // settles (releases) the run's units
 *   }
 *
 * The executor settles the tariff units itself (commit what was delivered,
 * release the rest) and returns the reply the route would have given; the
 * worker stores it as the run's result.
 *
 * Each run runs in its own usage-ledger request (`run.request_id`) with the
 * run's AI limits (`AGENT_RUN_MAX_CALLS` 60, `AGENT_RUN_MAX_MS` 15 min,
 * `AGENT_RUN_MAX_COST_USD` 1.00 - the owner, 2026-10-28), and a pilot test
 * entitlement's total budget applies as it does to a web request. A run
 * whose worker died is taken over after its lease (90 s); the steps it
 * finished are not run again. A run tried `maxAttempts` (3) times is
 * failed and its units released.
 *
 * `AGENT_RUNS=off` stops the worker (the routes then run in the request,
 * as before PR-B); `MAINTENANCE_MODE=on` stops it taking new runs.
 */

const crypto = require('crypto');
const usageLedger = require('../../ai/usage-ledger');

const n = (v, d) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : d; };

function runBudget() {
  return {
    maxCalls: n(process.env.AGENT_RUN_MAX_CALLS, 60),
    maxMs: n(process.env.AGENT_RUN_MAX_MS, 15 * 60 * 1000),
    maxCostUsd: n(process.env.AGENT_RUN_MAX_COST_USD, 1.0),
  };
}

const runsOff = () => String(process.env.AGENT_RUNS || '').toLowerCase() === 'off';
const maintenance = () => String(process.env.MAINTENANCE_MODE || '').toLowerCase() === 'on';

function createRunWorker({
  store, executors = {}, concurrency = n(process.env.AGENT_RUN_CONCURRENCY, 2), pollMs = 2000, leaseSec = 90,
  heartbeatMs = 30000, maxAttempts = 3, sweepMs = 3600 * 1000, attachTestBudget = null, log = console,
  workerId = `${process.pid}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
} = {}) {
  if (!store) throw new Error('store is required');
  let timer = null, sweepTimer = null, stopped = true, ticking = false;
  const live = new Map();

  async function settleAbort(run, reason, status = 'failed') {
    const ex = executors[run.workflow];
    let reply = { httpStatus: 502, body: { status, message: "Agent ishi tugamadi; birliklar qaytarildi." } };
    if (ex && typeof ex.abort === 'function') {
      try { reply = await ex.abort(run, reason); } catch (e) { log.warn('[AGENT-RUN] abort settle failed:', e.message); }
    }
    await store.finish(run.id, { status, result: { httpStatus: reply.httpStatus, body: reply.body }, error: reason, force: true });
  }

  async function execute(run) {
    const ex = executors[run.workflow];
    if (!ex) {
      await store.finish(run.id, { workerId, status: 'failed', error: `unknown workflow ${run.workflow}`, force: true });
      return;
    }
    if (run.attempts > maxAttempts) {
      await settleAbort(run, `attempts ${run.attempts - 1} of ${maxAttempts}`);
      return;
    }
    const beat = setInterval(() => {
      store.heartbeat(run.id, workerId, { leaseSec }).catch(e => log.warn('[AGENT-RUN] heartbeat failed:', e.message));
    }, heartbeatMs);
    if (beat.unref) beat.unref();
    try {
      await usageLedger.runWithRequest({
        requestId: run.request_id, service: 'agent', kind: `agent ${run.workflow}`.slice(0, 80),
        userId: run.admin_id, budget: { ...runBudget(), ...(run.budget && run.budget.ai) },
      }, async (scope) => {
        if (attachTestBudget) { try { await attachTestBudget(run.admin_id); } catch (e) { log.warn('[AGENT-RUN] test budget not attached:', e.message); } }
        let out;
        try {
          const resume = await store.checkpoints(run.id);
          out = await ex.execute(run, {
            resume,
            onCheckpoint: (entry, output) => store.saveStep(run.id, entry, output),
            shouldStop: async () => (await store.isCancelled(run.id) ? 'cancelled' : null),
          });
        } catch (e) {
          // the run broke (not a step - the harness keeps those): release, fail
          log.warn(`[AGENT-RUN] ${run.id} ${run.workflow} failed:`, e.message);
          const reply = ex.abort ? await ex.abort(run, 'error').catch(() => null) : null;
          out = { status: 'failed', httpStatus: (reply && reply.httpStatus) || 502, body: (reply && reply.body) || { status: 'failed' }, error: e.message };
        }
        const sh = scope.shared;
        const spent = { calls: sh.calls, costUsd: Number(sh.knownCostUsd.toFixed(6)), unknownCostCalls: sh.unknownCostCalls };
        const status = ['done', 'failed', 'cancelled', 'budget', 'needs_input'].includes(out.status) ? out.status : 'failed';
        const ok = await store.finish(run.id, { workerId, status, result: { httpStatus: out.httpStatus, body: out.body }, error: out.error || null, spent });
        if (!ok) log.warn(`[AGENT-RUN] ${run.id}: not finished by this worker (taken over or already ended)`);
        await usageLedger.finishRequest(scope, { outcome: `agent_${status}` }).catch(() => {});
      });
    } finally {
      clearInterval(beat);
    }
  }

  async function tick() {
    if (ticking || stopped || runsOff() || maintenance()) return;
    ticking = true;
    try {
      for (const run of await store.cancelledQueued()) await settleAbort(run, 'cancelled', 'cancelled');
      while (!stopped && live.size < concurrency) {
        const run = await store.claim(workerId, { leaseSec });
        if (!run) break;
        const p = execute(run)
          .catch(e => log.warn('[AGENT-RUN] execute crashed:', e.message))
          .finally(() => { live.delete(run.id); });
        live.set(run.id, p);
      }
    } catch (e) {
      if (!(e && e.code === '42P01')) log.warn('[AGENT-RUN] poll failed:', e.message);
    } finally {
      ticking = false;
    }
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    timer = setInterval(() => { tick(); }, pollMs);
    if (timer.unref) timer.unref();
    sweepTimer = setInterval(() => { store.sweep().catch(() => {}); }, sweepMs);
    if (sweepTimer.unref) sweepTimer.unref();
    setImmediate(() => { tick(); });
  }

  /** Stop taking runs. Running ones are not waited for: their lease ends and the next process resumes them. */
  async function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    if (sweepTimer) clearInterval(sweepTimer);
    timer = sweepTimer = null;
  }

  /** Tests: one poll now; resolves when the runs it took have finished. */
  async function drain() {
    const was = stopped;
    stopped = false;
    await tick();
    await Promise.all([...live.values()]);
    stopped = was;
  }

  return { start, stop, tick, drain, workerId, live, runBudget };
}

module.exports = { createRunWorker, runBudget };
