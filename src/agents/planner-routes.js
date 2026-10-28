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

class PlanError extends Error {
  constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

/**
 * The planner as a service the web routes and the Telegram bot share
 * (2026-10-28, PR-F): plan, approve, answer - each as one account.
 * `telegram` ({ chatId, messageId }) in a run's input makes the worker report
 * the run's steps and end to that chat (src/agents/runs/notify.js).
 */
function createPlannerService({ pool, ledger, runs, matters, callCheapAI }) {
  const registry = createToolRegistry();
  const allowed = createPlannerGate({ pool, ledger });

  async function plan({ adminId, task, matterId = null, channel = 'web', telegram = null }) {
    if (!(await allowed(adminId))) throw new PlanError(403, 'not_enabled', "Agent rejasi hozircha faqat sinovda (master).");
    const text = clean(task, 2000);
    if (text.length < 10) throw new PlanError(422, 'needs_input', "Topshiriqni batafsilroq yozing (kamida 10 belgi).");
    let matter = null, matterScans = [];
    if (matterId) {
      const m = matters ? await matters.get(String(matterId), adminId) : null;
      if (!m || m.access !== 'write') throw new PlanError(404, 'not_found', 'Ish topilmadi');
      const scans = m.own ? m.items.filter(i => i.kind === 'scan' && i.available) : [];
      matterScans = scans.map(i => i.ref);
      matter = { title: m.title, summary: m.summary, scans: scans.map(i => ({ id: i.ref, title: i.title })) };
    }
    const ctx = { matterId: matter ? String(matterId) : null, matter, matterScans };
    const made = await makePlan(text, registry, { callCheapAI }, ctx);
    const run = await runs.store.create({
      adminId, workflow: 'planned', status: 'awaiting_approval', input: { task: text, ...(telegram ? { telegram } : {}) },
      plan: made.plan, price: made.price, matterId: ctx.matterId, channel,
    });
    if (ctx.matterId && matters) {
      await matters.addItem(ctx.matterId, adminId, { kind: 'agent_run', ref: run.id, title: `Agent: ${text.slice(0, 80)}` }).catch(() => {});
    }
    return {
      runId: run.id, status: run.status, source: made.source, errors: made.errors,
      plan: { goal: made.plan.goal, nodes: made.plan.nodes.map(n => ({ ...n, label: (registry.get(n.tool) || {}).label || n.tool })) },
      price: made.price, matterTitle: matter ? matter.title : null,
    };
  }

  /** The plan's price reserved for the run (held for it): the jobs, [] when free, null when the units are not there. */
  async function reservePrice(run, adminId) {
    const holdUntil = new Date(Date.now() + HOLD_MIN * 60e3).toISOString();
    const want = Object.entries(run.price || {}).filter(([, u]) => u > 0)
      .map(([service, units]) => ({ service, units, endpoint: '/api/agent/plan', meta: { holdUntil, runId: run.id } }));
    if (!want.length) return [];
    const r = await ledger.reserveMany({ adminId, channel: run.channel === 'telegram' ? 'telegram' : 'web', jobs: want, requestId: run.request_id });
    if (!r.allowed) return null;
    return (r.jobs || []).filter(j => j && j.jobKey).map((j, i) => ({ jobKey: j.jobKey, service: want[i] && want[i].service }));
  }

  async function approve(runId, adminId) {
    const run = await runs.store.row(runId, adminId);
    if (!run) throw new PlanError(404, 'not_found', 'Agent ishi topilmadi');
    if (run.status !== 'awaiting_approval' || run.cancel_requested) throw new PlanError(409, 'not_waiting', "Bu reja tasdiq kutmayapti", { status: run.status });
    const jobs = await reservePrice(run, adminId);
    if (!jobs) throw new PlanError(402, 'no_units', "Bu reja uchun birlik yetarli emas. Tarif yoki bir martalik xizmat kerak.", { price: run.price });
    const queued = await runs.store.approve(run.id, adminId, jobs);
    if (!queued) {
      for (const j of jobs) await ledger.release(j.jobKey, 'approve_lost').catch(() => {});
      throw new PlanError(409, 'not_waiting', "Bu reja tasdiq kutmayapti");
    }
    if (runs.kick) runs.kick();
    return { runId: run.id, status: 'queued' };
  }

  // the person answers the question a planned run stopped on (ask_user): reserved again, queued again
  async function answer(runId, adminId, text) {
    const run = await runs.store.row(runId, adminId);
    if (!run) throw new PlanError(404, 'not_found', 'Agent ishi topilmadi');
    const asked = run.result && run.result.body && run.result.body.stoppedAt;
    if (run.status !== 'needs_input' || run.workflow !== 'planned' || !asked) throw new PlanError(409, 'not_waiting', "Bu ish javob kutmayapti", { status: run.status });
    const reply = clean(text, 2000);
    if (reply.length < 1) throw new PlanError(422, 'needs_input', "Javobni yozing");
    const jobs = await reservePrice(run, adminId);
    if (!jobs) throw new PlanError(402, 'no_units', "Davom etish uchun birlik yetarli emas.", { price: run.price });
    const queued = await runs.store.resume(run.id, adminId, { answers: { [asked]: reply }, jobs });
    if (!queued) {
      for (const j of jobs) await ledger.release(j.jobKey, 'resume_lost').catch(() => {});
      throw new PlanError(409, 'not_waiting', "Bu ish javob kutmayapti");
    }
    if (runs.kick) runs.kick();
    return { runId: run.id, status: 'queued' };
  }

  const cancel = (runId, adminId) => runs.store.requestCancel(runId, adminId);
  const attachTelegram = (runId, adminId, telegram) => runs.store.setTelegram(runId, adminId, telegram);

  return { registry, allowed, plan, approve, answer, cancel, attachTelegram };
}

let shared = null;
/** The service the bot uses (set where the routes mount). */
function plannerService() { return shared; }

function mountPlannerRoutes(app, { requireAuth, requireSameOrigin, pool, ledger, runs, matters, callCheapAI, deps }) {
  const service = createPlannerService({ pool, ledger, runs, matters, callCheapAI });
  shared = service;
  const fail = (res, e, what) => {
    if (e instanceof PlanError) return res.status(e.status).json({ error: e.code, message: e.message, ...e.extra });
    if (e && e.status === 429) return res.status(429).json({ error: e.code, message: e.message });
    if (e && e.code === '42P01') return res.status(503).json({ error: 'unavailable', message: "Agent ishlari hali tayyor emas" });
    console.error(`[AGENT-PLAN] ${what}:`, e.message);
    return res.status(500).json({ error: 'failed', message: what === 'plan' ? "Reja tuzib bo'lmadi" : (what === 'input' ? "Javobni qabul qilib bo'lmadi" : "Tasdiqlab bo'lmadi") });
  };

  app.post('/api/agent/plan', requireSameOrigin, requireAuth, async (req, res) => {
    try {
      const out = await service.plan({ adminId: req.session.adminId, task: req.body && req.body.task, matterId: req.body && req.body.matterId });
      res.status(201).json(out);
    } catch (e) { fail(res, e, 'plan'); }
  });
  app.post('/api/agent/runs/:id/input', requireSameOrigin, requireAuth, async (req, res) => {
    try { res.json(await service.answer(req.params.id, req.session.adminId, req.body && req.body.answer)); } catch (e) { fail(res, e, 'input'); }
  });
  app.post('/api/agent/runs/:id/approve', requireSameOrigin, requireAuth, async (req, res) => {
    try { res.json(await service.approve(req.params.id, req.session.adminId)); } catch (e) { fail(res, e, 'approve'); }
  });

  return { executor: plannedExecutor({ registry: service.registry, deps: { ...deps, pool, matters }, ledger }), registry: service.registry, service };
}

module.exports = { mountPlannerRoutes, plannedExecutor, createPlannerGate, createPlannerService, plannerService, PlanError };
