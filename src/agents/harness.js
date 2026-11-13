'use strict';

/**
 * Agentic harness (2026-10-21, owner: "Legora darajasi" - multi-step legal
 * work instead of one question -> one answer).
 *
 * A workflow is a fixed list of steps; each step is a tool with one job
 * (read the facts, search the law, choose the basis, write, check). The
 * harness runs them in order and owns what every step must not do by itself:
 *
 *   - limits: at most `maxSteps` steps and `maxMs` of wall-clock time for the
 *     whole run; a step past the deadline is not started;
 *   - a trace: one entry per step (id, label, status, ms, short note) that
 *     the caller may show - never the prompts or the model's raw text;
 *   - failure: a failed required step stops the run with the work done so
 *     far (status 'failed', `stoppedAt`); an optional step is noted and
 *     skipped;
 *   - a step can halt the run on purpose ({ halt: 'needs_input', ... }), for
 *     example when facts are missing - nothing after it runs.
 *
 * The AI calls inside the steps go through the platform's callAI, so each is
 * a usage-ledger row of the request like any other; the per-request AI
 * budget (AI_REQUEST_*) applies to them unchanged.
 */

/*
 * Checkpoints (2026-10-28, agent runs - src/agents/runs/): `resume` gives the
 * outputs of steps a previous attempt finished; they are put back into
 * state.steps and not run again (trace status 'ok', resumed: true).
 * `onCheckpoint(entry, output)` is awaited after every step that ran, before
 * the next starts, so what is written there is what a resumed run gets back.
 * `shouldStop()` is asked before every step; a reason stops the run as
 * 'cancelled'. Without these options the harness works as before.
 */

const DEFAULT_BUDGET = Object.freeze({ maxSteps: 12, maxMs: 150000 });

function withTimeout(promise, ms, label) {
  if (!(ms > 0) || !Number.isFinite(ms)) return promise;
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: vaqt tugadi`)), ms); if (timer.unref) timer.unref(); }),
  ]).finally(() => clearTimeout(timer));
}

/** A step error as the trace shows it: short, no stack, no keys. */
function safeError(e) {
  return String((e && e.message) || e || 'xato').replace(/(sk|key|token)[-_a-z0-9]{8,}/giu, '[…]').slice(0, 160);
}

/**
 * Run a workflow: { id, parallel?, steps: [{ id, label, run(state, deps), when?(state),
 * optional?, timeoutMs?, note?(out), after? }] }. Returns
 * { status: 'done' | 'needs_input' | 'failed' | 'budget', state, trace, ms, stoppedAt?, reason? }.
 */
async function runWorkflow(workflow, input, { deps = {}, budget = {}, onEvent = null, clock = Date.now, resume = null, onCheckpoint = null, shouldStop = null } = {}) {
  const limits = { ...DEFAULT_BUDGET, ...budget };
  const started = clock();
  const state = { input, steps: {} };
  const done = resume && typeof resume === 'object' ? resume : {};
  // a checkpoint that cannot be written stops the run (it is not the step's failure)
  const checkpoint = async (entry, out) => {
    if (!onCheckpoint) return;
    try { await onCheckpoint(entry, out); } catch (e) { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { checkpointFailed: true }); }
  };
  const trace = [];
  const emit = (e) => { if (onEvent) { try { onEvent(e); } catch (_) { /* a listener never stops the run */ } } };
  const finish = (status, extra = {}) => ({ status, state, trace, ms: clock() - started, workflow: workflow.id, ...extra });

  let ran = 0;
  // one step, run and recorded: 'ok' | 'halt' | 'failed' | 'optional_failed'
  async function runOne(step, left) {
    ran++;
    emit({ type: 'step', id: step.id, label: step.label, status: 'running' });
    const t0 = clock();
    try {
      const out = await withTimeout(Promise.resolve().then(() => step.run(state, deps)), Math.min(left, step.timeoutMs || left), step.label || step.id);
      state.steps[step.id] = out;
      const entry = { id: step.id, label: step.label, status: 'ok', ms: clock() - t0 };
      if (step.note) { try { entry.note = String(step.note(out) || '').slice(0, 200) || undefined; } catch (_) { /* no note */ } }
      trace.push(entry);
      emit({ type: 'step', ...entry });
      // a step that halts (asks the person) is not a checkpoint: it runs again on resume
      if (out && out.halt) { await checkpoint({ ...entry, status: 'skipped' }, null); return { kind: 'halt', halt: out.halt }; }
      await checkpoint(entry, out);
      return { kind: 'ok' };
    } catch (e) {
      if (e && e.checkpointFailed) throw e;
      const entry = { id: step.id, label: step.label, status: step.optional ? 'skipped_error' : 'failed', ms: clock() - t0, error: safeError(e) };
      trace.push(entry);
      emit({ type: 'step', ...entry });
      await checkpoint(entry, null);
      return { kind: step.optional ? 'optional_failed' : 'failed' };
    }
  }
  const resumed = (step) => {
    if (!Object.prototype.hasOwnProperty.call(done, step.id) || (done[step.id] && done[step.id].halt)) return false;
    state.steps[step.id] = done[step.id];
    trace.push({ id: step.id, label: step.label, status: 'ok', resumed: true });
    return true;
  };

  // steps that name what they come after run as a graph, up to `parallel` at a time
  if (workflow.steps.some(st => Array.isArray(st.after))) return runGraph();

  for (const step of workflow.steps) {
    if (resumed(step)) continue;
    if (shouldStop) {
      const reason = await shouldStop();
      if (reason) return finish('cancelled', { stoppedAt: step.id, reason: String(reason).slice(0, 60) });
    }
    if (step.when && !step.when(state)) {
      trace.push({ id: step.id, label: step.label, status: 'skipped' });
      continue;
    }
    if (ran >= limits.maxSteps) return finish('budget', { stoppedAt: step.id, reason: 'max_steps' });
    const left = limits.maxMs - (clock() - started);
    if (left <= 0) return finish('budget', { stoppedAt: step.id, reason: 'max_time' });
    const r = await runOne(step, left);
    if (r.kind === 'halt') return finish(r.halt, { stoppedAt: step.id });
    if (r.kind === 'failed') return finish('failed', { stoppedAt: step.id });
  }
  return finish('done');

  /*
   * The graph (2026-10-28, PR-E): a step starts when every step in its
   * `after` has finished; at most `parallel` (default 3) run at once. The
   * limits, the cancel check and the checkpoints are per step as above. A
   * failed required step, a halt, a cancel or a limit starts nothing new;
   * the steps already running finish and are recorded, then the run ends
   * with that status. An optional step that failed counts as finished for
   * the steps after it.
   */
  async function runGraph() {
    const limit = Math.max(1, Math.min(Number(workflow.parallel) || 3, 6));
    const byId = new Map(workflow.steps.map(st => [st.id, st]));
    const finished = new Set();
    for (const st of workflow.steps) if (resumed(st)) finished.add(st.id);
    const pending = workflow.steps.filter(st => !finished.has(st.id));
    const running = new Map();
    let stop = null; // { status, stoppedAt, reason }
    const ready = st => (st.after || []).every(a => finished.has(a) || !byId.has(a));
    while (pending.length || running.size) {
      while (!stop && running.size < limit) {
        const i = pending.findIndex(ready);
        if (i < 0) break;
        const step = pending.splice(i, 1)[0];
        if (shouldStop) {
          const reason = await shouldStop();
          if (reason) { stop = { status: 'cancelled', stoppedAt: step.id, reason: String(reason).slice(0, 60) }; pending.unshift(step); break; }
        }
        if (step.when && !step.when(state)) { trace.push({ id: step.id, label: step.label, status: 'skipped' }); finished.add(step.id); continue; }
        if (ran >= limits.maxSteps) { stop = { status: 'budget', stoppedAt: step.id, reason: 'max_steps' }; break; }
        const left = limits.maxMs - (clock() - started);
        if (left <= 0) { stop = { status: 'budget', stoppedAt: step.id, reason: 'max_time' }; break; }
        // the step leaves `running` only when its result is read below (two can end together)
        running.set(step.id, runOne(step, left).then(r => ({ step, r })));
      }
      if (!running.size) {
        if (stop) break;
        if (pending.length) { stop = { status: 'failed', stoppedAt: pending[0].id, reason: 'unreachable' }; }
        break;
      }
      const { step, r } = await Promise.race(running.values());
      running.delete(step.id);
      if (r.kind === 'ok' || r.kind === 'optional_failed') finished.add(step.id);
      else if (!stop) stop = r.kind === 'halt' ? { status: r.halt, stoppedAt: step.id } : { status: 'failed', stoppedAt: step.id };
    }
    if (stop) return finish(stop.status, { stoppedAt: stop.stoppedAt, ...(stop.reason ? { reason: stop.reason } : {}) });
    return finish('done');
  }
}


/** Lenient JSON from a model's text: the first {...} or [...] block. */
function parseJson(text) {
  const s = String(text || '').replace(/```(?:json)?/giu, '').trim();
  try { return JSON.parse(s); } catch (_) { /* look for a block */ }
  const m = s.match(/[[{][\s\S]*[\]}]/u);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_) { return null; }
}

module.exports = { runWorkflow, parseJson, DEFAULT_BUDGET, safeError };
