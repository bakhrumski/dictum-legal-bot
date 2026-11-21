'use strict';

/**
 * Agent run metrics (2026-11-11, audit X8 / G7): where agent runs succeed,
 * stop and what one costs - from what `agent_runs` and `agent_run_steps`
 * already record. No AI, and never a run's input, plan, result or error
 * text: statuses, counts, times and the spent figures only. A stop reason is
 * a fixed code, not the stored message.
 *
 *   GET /api/admin/agent-runs/metrics?days=7   (master)
 *
 * Success is done / (done + failed + budget): a cancelled run is the
 * person's choice and a run waiting for an answer or an approval has not
 * ended. A cost is the known part; runs with a call of unknown cost are
 * counted beside it (unknown is never $0).
 */

const median = (list, q = 0.5) => {
  const a = list.filter(Number.isFinite).sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : null;
};
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

/** Why a run did not end done, as a code. */
function reasonOf(run) {
  const e = String(run.error || '').toLowerCase();
  if (run.status === 'budget') return 'limit';
  if (run.status === 'cancelled') return 'cancelled';
  if (run.status !== 'failed') return null;
  if (/^attempts \d/u.test(e)) return 'attempts';
  if (/unknown workflow/u.test(e)) return 'unknown_workflow';
  if (/budget|limit|quota/u.test(e)) return 'limit';
  if (/timeout|timed out|deadline|maxms/u.test(e)) return 'timeout';
  return e ? 'error' : 'step_failed';
}

/**
 * runs:  [{ id, workflow, channel, status, attempts, error, spent, created_at, started_at, finished_at }]
 * steps: [{ run_id, step_id, status, ms }]
 * -> { groups: [{ workflow, channel, ... }] } newest-busiest first.
 */
function summarize(runs = [], steps = []) {
  const groups = new Map();
  const byRun = new Map();
  for (const r of runs) {
    const key = `${r.workflow}|${r.channel}`;
    let g = groups.get(key);
    if (!g) {
      g = { workflow: r.workflow, channel: r.channel, runs: 0, done: 0, failed: 0, cancelled: 0, budget: 0, needsInput: 0, awaitingApproval: 0, live: 0, resumed: 0,
        reasons: {}, stoppedAt: {}, _sec: [], _cost: [], _calls: [], unknownCostRuns: 0, _steps: new Map() };
      groups.set(key, g);
    }
    byRun.set(r.id, g);
    g.runs++;
    if (r.status === 'done') g.done++;
    else if (r.status === 'failed') g.failed++;
    else if (r.status === 'cancelled') g.cancelled++;
    else if (r.status === 'budget') g.budget++;
    else if (r.status === 'needs_input') g.needsInput++;
    else if (r.status === 'awaiting_approval') g.awaitingApproval++;
    else g.live++;
    if (Number(r.attempts) > 1) g.resumed++;
    const why = reasonOf(r);
    if (why) g.reasons[why] = (g.reasons[why] || 0) + 1;
    const ended = ['done', 'failed', 'budget'].includes(r.status);
    if (ended && r.started_at && r.finished_at) g._sec.push((new Date(r.finished_at) - new Date(r.started_at)) / 1000);
    const sp = r.spent && typeof r.spent === 'object' ? r.spent : null;
    if (ended && sp && Number.isFinite(Number(sp.calls))) {
      g._calls.push(Number(sp.calls));
      if (Number.isFinite(Number(sp.costUsd))) g._cost.push(Number(sp.costUsd));
      if (Number(sp.unknownCostCalls) > 0) g.unknownCostRuns++;
    }
  }
  const failedRuns = new Set(runs.filter(r => r.status === 'failed' || r.status === 'budget').map(r => r.id));
  for (const s of steps) {
    const g = byRun.get(s.run_id);
    if (!g) continue;
    const id = String(s.step_id || '').replace(/[-_:]?\d+$/u, '') || String(s.step_id || ''); // "extract_3" and "extract_4" are one step
    let st = g._steps.get(id);
    if (!st) { st = { id, runs: 0, failed: 0, _ms: [] }; g._steps.set(id, st); }
    st.runs++;
    if (s.status === 'failed') { st.failed++; if (failedRuns.has(s.run_id)) g.stoppedAt[id] = (g.stoppedAt[id] || 0) + 1; }
    if (s.status === 'ok' && Number.isFinite(Number(s.ms))) st._ms.push(Number(s.ms));
  }
  const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const out = [...groups.values()].map((g) => {
    const ended = g.done + g.failed + g.budget;
    const cost = avg(g._cost);
    return {
      workflow: g.workflow, channel: g.channel, runs: g.runs, done: g.done, failed: g.failed, cancelled: g.cancelled, budget: g.budget,
      needsInput: g.needsInput, awaitingApproval: g.awaitingApproval, live: g.live, resumed: g.resumed,
      successPct: pct(g.done, ended), needsInputPct: pct(g.needsInput, g.runs),
      medianSec: g._sec.length ? Math.round(median(g._sec)) : null, p90Sec: g._sec.length ? Math.round(median(g._sec, 0.9)) : null,
      avgCalls: g._calls.length ? Math.round(avg(g._calls) * 10) / 10 : null,
      avgKnownCostUsd: cost == null ? null : Number(cost.toFixed(4)), costRuns: g._cost.length, unknownCostRuns: g.unknownCostRuns,
      reasons: g.reasons, stoppedAt: g.stoppedAt,
      steps: [...g._steps.values()].map(s => ({ id: s.id, runs: s.runs, failed: s.failed, medianMs: s._ms.length ? Math.round(median(s._ms)) : null })).sort((a, b) => b.failed - a.failed || b.runs - a.runs).slice(0, 12),
    };
  }).sort((a, b) => b.runs - a.runs);
  return { groups: out };
}

function mountRunMetrics(app, { requireMasterAdmin, pool }) {
  app.get('/api/admin/agent-runs/metrics', requireMasterAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
      const runs = await pool.query(
        `SELECT id, workflow, channel, status, attempts, error, spent, created_at, started_at, finished_at
           FROM agent_runs WHERE created_at > now() - ($1 || ' days')::interval ORDER BY created_at DESC LIMIT 20000`, [days]);
      const steps = runs.rows.length ? await pool.query(
        `SELECT s.run_id, s.step_id, s.status, s.ms FROM agent_run_steps s JOIN agent_runs r ON r.id = s.run_id
          WHERE r.created_at > now() - ($1 || ' days')::interval LIMIT 200000`, [days]) : { rows: [] };
      res.json({ days, ...summarize(runs.rows, steps.rows),
        note: 'From run records only: statuses, times, spent figures. Success = done / (done + failed + limit). Cost is the known part; runs with a call of unknown cost are counted apart.' });
    } catch (e) {
      if (e && e.code === '42P01') return res.json({ days: 0, groups: [] });
      console.error('[AGENT-METRICS]', e.message);
      res.status(500).json({ error: 'failed' });
    }
  });
}

module.exports = { summarize, reasonOf, mountRunMetrics };
