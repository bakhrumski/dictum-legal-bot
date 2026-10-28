'use strict';

/**
 * The planner agent over HTTP (2026-10-28, roadmap PR-D,
 * docs/design/matter-va-agent-runs.md 4.2 and 4.4).
 *
 *   POST /api/agent/plan                 { task, matterId? } -> 201 { runId, plan, price, source, errors }
 *   POST /api/agent/runs/:id/approve     the owner approves: the price is reserved, the run is queued
 *   POST /api/agent/runs/:id/input       { answer }: the run asked (ask_user, needs_input); reserved again, queued again
 *
 * A plan is made (one cheap call, not charged), checked by the server and
 * kept as an agent run waiting for approval; nothing is reserved and no
 * legal text is written until the person approves the steps and the price.
 * Approval reserves the price (held for the run) and queues it; the worker
 * runs the steps in their order with the run's checkpoints and limits, and
 * the units are committed only when the verified answer came out. Cancel
 * (POST /api/agent/runs/:id/cancel) ends a waiting plan at once; a plan
 * nobody approves ends after 24 hours. With a matter, the run is linked to
 * it at once.
 *
 * Who may use it: `AGENT_PLANNER` = master (default: a database master
 * only), gold (Gold, Platinum, test entitlements and staff too), all, off.
 */

const { createToolRegistry } = require('./tools');
const { makePlan } = require('./planner');
const { runWorkflow } = require('./harness');

const HOLD_MIN = Math.max(20, Number(process.env.AGENT_RUN_HOLD_MIN) || 45);
const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/gu, ' ').trim().slice(0, max);

/** Who may plan: master (default), gold, all, off. */
function createPlannerGate({ pool, ledger }) {
  return async (adminId) => {
    const mode = String(process.env.AGENT_PLANNER || 'master').toLowerCase();
    if (mode === 'off' || !adminId) return false;
    const r = await pool.query('SELECT role FROM admins WHERE id = $1', [adminId]);
    const role = r.rows[0] && r.rows[0].role;
    if (role === 'master') return true;
    if (mode === 'all') return true;
    if (mode === 'gold') {
      if (role && role !== 'user') return true;
      const ent = await ledger.resolveEntitlement(pool, { adminId }, { createTrial: false }).catch(() => null);
      return !!ent && (ent.kind === 'test' || (ent.kind === 'paid' && ['gold', 'platinum'].includes(ent.plan)));
    }
    return false;
  };
}

/** The worker's executor for a planned run: the plan's steps through the harness, then settle. */
function plannedExecutor({ registry, deps, ledger, budget = {} }) {
  const maxMs = Number(process.env.AGENT_PLAN_MAX_MS) || 10 * 60 * 1000;
  async function settle(run, out) {
    const steps = (out.state && out.state.steps) || {};
    const verified = Object.values(steps).find(o => o && typeof o.text === 'string' && o.status !== undefined && 'withheld' in o);
    const delivered = out.status === 'done' && verified && verified.substantive;
    // the run asks the person (ask_user): the units go back now and are reserved again with the answer
    const asking = out.status === 'needs_input' ? Object.entries(steps).find(([, o]) => o && o.halt === 'needs_input') : null;
    for (const j of run.jobs || []) {
      if (delivered) await ledger.commit(j.jobKey).catch(() => {});
      else await ledger.release(j.jobKey, `planned_${out.status}`).catch(() => {});
    }
    const { chunksOf } = require('./tools');
    const sources = chunksOf(steps).slice(0, 30).map(c => ({ act: clean(c.law_name, 200), article: c.article_number_display || c.article_number || null, url: c.source_url || null }));
    if (asking) {
      return { httpStatus: 202, body: { status: 'needs_input', question: asking[1].question, stoppedAt: asking[0], plan: run.plan, trace: out.trace, ms: out.ms, charged: false } };
    }
    return {
      httpStatus: delivered ? 200 : 502,
      body: {
        status: out.status,
        ...(delivered ? {} : { message: "Topshiriqni bajarib bo'lmadi; birlik qaytarildi.", stoppedAt: out.stoppedAt || null }),
        answer: delivered ? verified.text : null,
        verification: verified ? { status: verified.status, withheld: verified.withheld, unconfirmed: verified.unconfirmed, quotes: verified.quotes } : null,
        sources,
        plan: run.plan,
        trace: out.trace, ms: out.ms,
        charged: !!delivered && (run.jobs || []).length > 0,
      },
    };
  }
  return {
    async execute(run, opts = {}) {
      const plan = run.plan || { nodes: [] };
      const matterId = run.matter_id || null;
      const base = { adminId: run.admin_id, matterId, deps };
      const answers = (run.input && run.input.answers) || {};
      const workflow = {
        id: 'planned',
        parallel: Math.max(1, Math.min(3, Number(process.env.AGENT_PLAN_PARALLEL) || 3)),
        steps: plan.nodes.map((n) => {
          const tool = registry.get(n.tool);
          return {
            id: n.id,
            label: tool ? tool.label : n.tool,
            after: Array.isArray(n.after) ? n.after : [],
            run: async (state) => {
              if (!tool) throw new Error(`noma'lum vosita ${n.tool}`);
              return tool.run(n.args || {}, { ...base, nodeId: n.id, answers, inputs: (n.after || []).map(a => state.steps[a]), all: state.steps });
            },
            note: (o) => (o && o.note) || '',
          };
        }),
      };
      let out;
      try {
        out = await runWorkflow(workflow, (run.input && run.input.task) || '', { budget: { maxSteps: 14, maxMs, ...budget }, ...opts });
      } catch (e) {
        if (e && e.checkpointFailed) throw e;
        out = { status: 'failed', trace: [], state: { steps: {} }, error: e.message };
      }
      const reply = await settle(run, out);
      return { status: out.status, httpStatus: reply.httpStatus, body: reply.body, error: out.error || null };
    },
    async abort(run, reason) {
      return settle(run, { status: reason === 'cancelled' ? 'cancelled' : 'failed', trace: [], state: { steps: {} } });
    },
  };
}

function mountPlannerRoutes(app, { requireAuth, requireSameOrigin, pool, ledger, runs, matters, callCheapAI, deps }) {
  const registry = createToolRegistry();
  const allowed = createPlannerGate({ pool, ledger });

  app.post('/api/agent/plan', requireSameOrigin, requireAuth, async (req, res) => {
    const adminId = req.session.adminId;
    try {
      if (!(await allowed(adminId))) return res.status(403).json({ error: 'not_enabled', message: "Agent rejasi hozircha faqat sinovda (master)." });
      const task = clean(req.body && req.body.task, 2000);
      if (task.length < 10) return res.status(422).json({ error: 'needs_input', message: "Topshiriqni batafsilroq yozing (kamida 10 belgi)." });
      let matter = null, matterScans = [];
      const matterId = req.body && req.body.matterId ? String(req.body.matterId) : null;
      if (matterId) {
        const m = matters ? await matters.get(matterId, adminId) : null;
        if (!m || m.access !== 'write') return res.status(404).json({ error: 'not_found', message: 'Ish topilmadi' });
        const scans = m.own ? m.items.filter(i => i.kind === 'scan' && i.available) : [];
        matterScans = scans.map(i => i.ref);
        matter = { title: m.title, summary: m.summary, scans: scans.map(i => ({ id: i.ref, title: i.title })) };
      }
      const ctx = { matterId: matter ? matterId : null, matter, matterScans };
      const made = await makePlan(task, registry, { callCheapAI }, ctx);
      const run = await runs.store.create({
        adminId, workflow: 'planned', status: 'awaiting_approval', input: { task }, plan: made.plan, price: made.price,
        matterId: ctx.matterId, channel: 'web',
      });
      if (ctx.matterId && matters) {
        await matters.addItem(ctx.matterId, adminId, { kind: 'agent_run', ref: run.id, title: `Agent: ${task.slice(0, 80)}` }).catch(() => {});
      }
      res.status(201).json({
        runId: run.id, status: run.status, source: made.source, errors: made.errors,
        plan: { goal: made.plan.goal, nodes: made.plan.nodes.map(n => ({ ...n, label: (registry.get(n.tool) || {}).label || n.tool })) },
        price: made.price,
      });
    } catch (e) {
      if (e && e.status === 429) return res.status(429).json({ error: e.code, message: e.message });
      if (e && e.code === '42P01') return res.status(503).json({ error: 'unavailable', message: "Agent ishlari hali tayyor emas" });
      console.error('[AGENT-PLAN]', e.message);
      res.status(500).json({ error: 'failed', message: "Reja tuzib bo'lmadi" });
    }
  });

  /** The plan's price reserved for the run (held for it): the jobs, [] when free, null when the units are not there. */
  async function reservePrice(run, adminId) {
    const holdUntil = new Date(Date.now() + HOLD_MIN * 60e3).toISOString();
    const want = Object.entries(run.price || {}).filter(([, u]) => u > 0)
      .map(([service, units]) => ({ service, units, endpoint: '/api/agent/plan', meta: { holdUntil, runId: run.id } }));
    if (!want.length) return [];
    const r = await ledger.reserveMany({ adminId, channel: 'web', jobs: want, requestId: run.request_id });
    if (!r.allowed) return null;
    return (r.jobs || []).filter(j => j && j.jobKey).map((j, i) => ({ jobKey: j.jobKey, service: want[i] && want[i].service }));
  }

  // the person answers the question a planned run stopped on (ask_user): reserved again, queued again
  app.post('/api/agent/runs/:id/input', requireSameOrigin, requireAuth, async (req, res) => {
    const adminId = req.session.adminId;
    try {
      const run = await runs.store.row(req.params.id, adminId);
      if (!run) return res.status(404).json({ error: 'not_found', message: 'Agent ishi topilmadi' });
      const asked = run.result && run.result.body && run.result.body.stoppedAt;
      if (run.status !== 'needs_input' || run.workflow !== 'planned' || !asked) return res.status(409).json({ error: 'not_waiting', message: "Bu ish javob kutmayapti", status: run.status });
      const answer = clean(req.body && req.body.answer, 2000);
      if (answer.length < 1) return res.status(422).json({ error: 'needs_input', message: "Javobni yozing" });
      const jobs = await reservePrice(run, adminId);
      if (!jobs) return res.status(402).json({ error: 'no_units', message: "Davom etish uchun birlik yetarli emas.", price: run.price });
      const queued = await runs.store.resume(run.id, adminId, { answers: { [asked]: answer }, jobs });
      if (!queued) {
        for (const j of jobs) await ledger.release(j.jobKey, 'resume_lost').catch(() => {});
        return res.status(409).json({ error: 'not_waiting', message: "Bu ish javob kutmayapti" });
      }
      if (runs.kick) runs.kick();
      res.json({ runId: run.id, status: 'queued' });
    } catch (e) {
      console.error('[AGENT-PLAN] input:', e.message);
      res.status(500).json({ error: 'failed', message: "Javobni qabul qilib bo'lmadi" });
    }
  });

  app.post('/api/agent/runs/:id/approve', requireSameOrigin, requireAuth, async (req, res) => {
    const adminId = req.session.adminId;
    try {
      const run = await runs.store.row(req.params.id, adminId);
      if (!run) return res.status(404).json({ error: 'not_found', message: 'Agent ishi topilmadi' });
      if (run.status !== 'awaiting_approval' || run.cancel_requested) return res.status(409).json({ error: 'not_waiting', message: "Bu reja tasdiq kutmayapti", status: run.status });
      const jobs = await reservePrice(run, adminId);
      if (!jobs) return res.status(402).json({ error: 'no_units', message: "Bu reja uchun birlik yetarli emas. Tarif yoki bir martalik xizmat kerak.", price: run.price });
      const queued = await runs.store.approve(run.id, adminId, jobs);
      if (!queued) {
        for (const j of jobs) await ledger.release(j.jobKey, 'approve_lost').catch(() => {});
        return res.status(409).json({ error: 'not_waiting', message: "Bu reja tasdiq kutmayapti" });
      }
      if (runs.kick) runs.kick();
      res.json({ runId: run.id, status: 'queued' });
    } catch (e) {
      console.error('[AGENT-PLAN] approve:', e.message);
      res.status(500).json({ error: 'failed', message: "Tasdiqlab bo'lmadi" });
    }
  });

  return { executor: plannedExecutor({ registry, deps: { ...deps, pool, matters }, ledger }), registry };
}

module.exports = { mountPlannerRoutes, plannedExecutor, createPlannerGate };
