'use strict';

/**
 * Agent workflows over HTTP (2026-10-21). One route per workflow; the first
 * is the claim draft (src/agents/workflows/claim-draft.js).
 *
 *   POST /api/agent/claim-draft   { court, plaintiff: { name, details }, defendant: { name, details },
 *                                   circumstances, demands, amount, evidence, lang }
 *
 * Missing facts are answered 422 with the questions to ask, before anything
 * is charged or any AI is called. Otherwise one 'draft' unit is reserved
 * (the plan's, else one bought one at a time), the workflow runs, and the
 * unit is committed only when a draft came out; any other end releases it.
 * The reply carries the step trace (labels, status, times, short notes) -
 * never prompts or raw model text.
 *
 * Runs (2026-10-28, PR-B, docs/design/matter-va-agent-runs.md 3.6): each
 * workflow is a service of three parts - `prepare` (no AI: input, sources,
 * the reservation), `run` (the harness) and `settle` (commit what was
 * delivered, release the rest; the reply). With a run store (`runs`) the
 * route queues the prepared work as an agent run (migration 020) and the
 * worker in the same process runs it, so it survives a deploy; the route
 * waits for it and answers in the same shape as before (plus `runId`), or
 * at once with 202 { runId } when the body says `async: true` or the wait
 * runs out. The reservation is held for the run (`meta.holdUntil`). Without
 * a run store, with `AGENT_RUNS=off`, or when the table is missing, the
 * work runs inside the request as before.
 */

const crypto = require('crypto');
const { runWorkflow } = require('./harness');
const { createClaimDraftWorkflow, readIntake } = require('./workflows/claim-draft');
const tabular = require('./workflows/tabular-review');
const tabularExport = require('./workflows/tabular-export');
const playbook = require('./workflows/playbook-review');

const HOLD_MIN = Math.max(20, Number(process.env.AGENT_RUN_HOLD_MIN) || 45);
const runsOff = () => String(process.env.AGENT_RUNS || '').toLowerCase() === 'off';
const fail = (httpStatus, body) => ({ error: { httpStatus, body } });
const failedOut = (status = 'failed') => ({ status, trace: [], state: { steps: {} } });

/** The claim draft as a service (src/agents/workflows/claim-draft.js). */
function claimService({ callAI, callCheapAI, retrieve, generateDraftHtml, ledger, budget = {} }) {
  const workflow = createClaimDraftWorkflow();
  const maxMs = Number(process.env.AGENT_MAX_MS) || 150000;
  return {
    id: 'claim_draft', maxMs,
    async prepare(req, { requestId, holdUntil } = {}) {
      const input = { ...(req.body || {}) };
      delete input.async;
      const intake = readIntake(input);
      if (intake.missing.length) {
        return fail(422, { error: 'needs_input', message: "Da'vo arizasi uchun ma'lumot yetarli emas", missing: intake.missing });
      }
      let job;
      try {
        job = await ledger.reserve({ adminId: req.session.adminId, service: 'draft', units: 1, endpoint: '/api/agent/claim-draft', channel: 'web',
          ...(holdUntil ? { meta: { holdUntil } } : {}), ...(requestId ? { requestId } : {}) });
      } catch (e) {
        console.error('[AGENT] reserve failed:', e.message);
        return fail(503, { error: 'quota_unavailable', message: "Limitni hozir tekshirib bo'lmadi" });
      }
      if (!job.allowed) {
        return fail(402, { error: 'no_units', message: "Hujjat tayyorlash birligi qolmagan. Tarif yoki bir martalik xizmat kerak.", plan: job.plan || null });
      }
      return { input, ctx: { unlimited: !!job.unlimited }, jobs: job.jobKey ? [{ jobKey: job.jobKey, service: 'draft' }] : [] };
    },
    async run(prep, opts = {}) {
      try {
        return await runWorkflow(workflow, prep.input, {
          deps: { callAI, callCheapAI: callCheapAI || callAI, retrieve, generateDraftHtml },
          budget: { maxSteps: 8, maxMs, ...budget }, ...opts,
        });
      } catch (e) {
        if (e && e.checkpointFailed) throw e;
        return { ...failedOut(), error: e.message };
      }
    },
    async settle(prep, out) {
      const steps = (out.state && out.state.steps) || {};
      const delivered = out.status === 'done' && steps.draft && steps.draft.html;
      for (const j of prep.jobs || []) {
        if (delivered) await ledger.commit(j.jobKey).catch((e) => console.error('[AGENT] commit failed:', e.message));
        else await ledger.release(j.jobKey, `agent_${out.status}`).catch(() => {});
      }
      const sources = ((steps.research && steps.research.sources) || []).map(s => ({ id: s.id, act: s.act, article: s.article, url: s.url }));
      return {
        httpStatus: delivered ? 200 : 502,
        body: {
          status: out.status,
          ...(delivered ? {} : { message: "Loyihani tayyorlab bo'lmadi; birlik qaytarildi.", stoppedAt: out.stoppedAt || null }),
          draftHtml: delivered ? steps.draft.html : null,
          caseType: steps.issues ? steps.issues.caseType : null,
          basis: (steps.basis && steps.basis.basis) || [],
          droppedQuotes: (steps.basis && steps.basis.dropped) || 0,
          sources,
          warnings: (steps.verify && steps.verify.warnings) || [],
          trace: out.trace,
          ms: out.ms,
          charged: !!delivered && !prep.ctx.unlimited,
        },
      };
    },
  };
}

/** Tabular review as a service (src/agents/workflows/tabular-review.js). */
function tabularService({ callAI, ledger, pool = null, budget = {} }) {
  const maxMs = Number(process.env.AGENT_TABLE_MAX_MS) || 180000;
  // a large table (stage 2, up to 100 documents): its time and its AI limits
  // grow with the documents - 15 s and one call each, $0.05 each, never past
  // 20 minutes; the run carries them (agent_runs.budget.ai)
  const sizeOf = (docs) => {
    const ms = Math.min(20 * 60e3, Math.max(maxMs, docs * 15e3));
    const usd = Number(process.env.TABULAR_RUN_USD_PER_DOC) || 0.05;
    return { maxMs: ms, ai: { maxCalls: docs + 8, maxMs: ms + 60e3, maxCostUsd: Number(Math.max(1, docs * usd).toFixed(2)) } };
  };
  const workflowOf = docCount => tabular.createTabularReviewWorkflow({ docCount });
  return {
    id: 'tabular_review', maxMs,
    async prepare(req, { requestId, holdUntil } = {}) {
      const input = { ...(req.body || {}) };
      delete input.async;
      // a scanned document comes as its scanId: the text read by the OCR step
      // (POST /api/analyze/ocr-image, its pages paid there), this account's only
      if (Array.isArray(input.documents) && input.documents.some(d => d && d.scanId)) {
        const r = await scanDocuments(pool, req.session.adminId, input.documents, tabular.LIMITS.docs);
        if (r.error) return fail(r.status, r.error);
        input.documents = r.documents;
      }
      const first = tabular.readInput(input);
      if (first.missing.length) return fail(422, { error: 'needs_input', message: "Jadval uchun ma'lumot yetarli emas", missing: first.missing });
      // the run keeps the columns and each document's excerpt, not whole documents
      const { prepared } = tabular.prepareInput(input);
      const size = sizeOf(first.docs.length);
      let jobs;
      try {
        jobs = await ledger.reserveMany({ adminId: req.session.adminId, channel: 'web', ...(requestId ? { requestId } : {}),
          jobs: first.docs.map(d => ({ service: 'chat', units: 1, endpoint: '/api/agent/tabular-review', meta: { row: d.id, ...(holdUntil ? { holdUntil } : {}) } })) });
      } catch (e) {
        console.error('[AGENT] tabular reserve failed:', e.message);
        return fail(503, { error: 'quota_unavailable', message: "Limitni hozir tekshirib bo'lmadi" });
      }
      if (!jobs.allowed) {
        return fail(402, { error: 'no_units', message: `Har bir hujjat uchun 1 ta savol birligi kerak (${first.docs.length} ta), limit yetarli emas.`, needed: first.docs.length, remaining: jobs.remaining == null ? null : jobs.remaining });
      }
      return {
        input: { prepared },
        ctx: { staff: jobs.kind === 'staff', docCount: first.docs.length },
        maxMs: size.maxMs, budget: { ai: size.ai },
        jobs: first.docs.map((d, i) => ({ docId: d.id, jobKey: (jobs.jobs[i] && jobs.jobs[i].jobKey) || null })).filter(j => j.jobKey),
      };
    },
    async run(prep, opts = {}) {
      try {
        const docCount = (prep.ctx && prep.ctx.docCount) || 0;
        const wf = workflowOf(docCount);
        return await runWorkflow(wf, prep.input, { deps: { callAI }, budget: { maxSteps: wf.steps.length, maxMs: sizeOf(docCount).maxMs, ...budget }, ...opts });
      } catch (e) {
        if (e && e.checkpointFailed) throw e;
        return failedOut();
      }
    },
    async settle(prep, out) {
      const steps = (out.state && out.state.steps) || {};
      // a run stopped by its limits or a cancel still shows (and charges) the rows it read
      const checked = steps.verify || (out.status !== 'done' ? tabular.verifyRows(out.state) : null) || { rows: [], verified: 0, unverified: 0 };
      const rows = checked.rows;
      const ok = new Set(rows.filter(r => r.status === 'ok').map(r => r.docId));
      const delivered = ok.size > 0 && (out.status === 'done' || out.status === 'budget' || out.status === 'cancelled');
      let charged = 0;
      for (const { docId, jobKey } of prep.jobs || []) {
        if (delivered && ok.has(docId)) { await ledger.commit(jobKey).catch(() => {}); charged++; }
        else await ledger.release(jobKey, out.status === 'done' ? 'tabular_row_failed' : `tabular_${out.status}`).catch(() => {});
      }
      const total = (prep.ctx && prep.ctx.docCount) || (prep.jobs || []).length;
      const partial = delivered && out.status !== 'done';
      return {
        httpStatus: delivered ? 200 : 502,
        body: {
          status: out.status,
          ...(delivered ? {} : { message: "Jadvalni tayyorlab bo'lmadi; birliklar qaytarildi.", stoppedAt: out.stoppedAt || null }),
          ...(partial ? { partial: true, message: `Jadval to'liq emas: ${total} hujjatdan ${ok.size} tasi o'qildi${out.status === 'cancelled' ? ' (bekor qilindi)' : ' (vaqt yoki AI chegarasi tugadi)'}. Qolganlari uchun birliklar qaytarildi.` } : {}),
          columns: steps.validate ? steps.validate.columns : [],
          rows: delivered ? rows : [],
          droppedDocs: steps.validate ? steps.validate.droppedDocs : 0,
          verified: delivered ? checked.verified : 0,
          unverified: delivered ? checked.unverified : 0,
          trace: out.trace, ms: out.ms,
          charged: prep.ctx.staff ? 0 : charged,
        },
      };
    },
  };
}

/** Playbook review as a service (src/agents/workflows/playbook-review.js). */
function playbookService({ callAI, ledger, pool, budget = {} }) {
  const workflow = playbook.createPlaybookReviewWorkflow();
  const maxMs = Number(process.env.AGENT_PLAYBOOK_MAX_MS) || 150000;
  return {
    id: 'playbook_review', maxMs,
    async prepare(req, { requestId, holdUntil } = {}) {
      const input = { text: req.body && req.body.text, name: req.body && req.body.name, rules: req.body && req.body.rules };
      // the rules come from the caller's own playbook or a built-in one, never another account's
      if (req.body && req.body.playbookId) {
        try {
          const r = await pool.query('SELECT rules FROM playbooks WHERE id = $1 AND admin_id = $2', [Number(req.body.playbookId) || 0, req.session.adminId]);
          if (!r.rows[0]) return fail(404, { error: 'not_found', message: 'Playbook topilmadi' });
          input.rules = r.rows[0].rules;
        } catch (e) { return fail(503, { error: 'unavailable', message: "Playbookni o'qib bo'lmadi" }); }
      } else if (req.body && req.body.builtin) {
        const b = playbook.BUILTIN[String(req.body.builtin)];
        if (!b) return fail(404, { error: 'not_found', message: 'Playbook topilmadi' });
        input.rules = b.rules;
      }
      // a scanned contract: the text its OCR step read, and the analysis units that step held for it
      let scan = null;
      if (req.body && req.body.scanId) {
        const r = await scanDocuments(pool, req.session.adminId, [{ scanId: req.body.scanId, name: req.body.name }]);
        if (r.error) return fail(r.status, r.error);
        scan = r.rows[0];
        input.text = scan.text;
      }
      const first = playbook.readInput(input);
      if (first.missing.length) return fail(422, { error: 'needs_input', message: "Tekshiruv uchun ma'lumot yetarli emas", missing: first.missing });
      const chars = first.text.replace(/^\[Sahifa \d+\]\n?|^=== PAGE \d+ ===\n?/gmu, '').length;
      const size = ledger.docUnits({ chars, pages: scan ? scan.pages : null });
      let job;
      try {
        const held = scan && ledger.heldScanJob ? await ledger.heldScanJob({ adminId: req.session.adminId, fileHash: scan.file_hash, service: 'analysis' }) : null;
        job = held && Number(held.units) >= size.units
          ? { allowed: true, jobKey: held.job_key, adopted: true }
          : await ledger.reserve({ adminId: req.session.adminId, service: 'analysis', units: size.units, endpoint: '/api/agent/playbook-review', channel: 'web',
            ...(holdUntil ? { meta: { holdUntil } } : {}), ...(requestId ? { requestId } : {}) });
      } catch (e) {
        console.error('[AGENT] playbook reserve failed:', e.message);
        return fail(503, { error: 'quota_unavailable', message: "Limitni hozir tekshirib bo'lmadi" });
      }
      if (!job.allowed) return fail(402, { error: 'no_units', message: `Bu shartnoma uchun ${size.units} ta tahlil birligi kerak, limit yetarli emas.`, needed: size.units });
      const pbKey = req.body && req.body.builtin && playbook.BUILTIN[String(req.body.builtin)] ? String(req.body.builtin) : 'own';
      return { input, ctx: { units: size.units, unlimited: !!job.unlimited, playbook: pbKey }, jobs: job.jobKey ? [{ jobKey: job.jobKey, service: 'analysis', adopted: !!job.adopted }] : [] };
    },
    async run(prep, opts = {}) {
      try {
        return await runWorkflow(workflow, prep.input, { deps: { callAI }, budget: { maxSteps: 6, maxMs, ...budget }, ...opts });
      } catch (e) {
        if (e && e.checkpointFailed) throw e;
        return failedOut();
      }
    },
    async settle(prep, out) {
      const steps = (out.state && out.state.steps) || {};
      const done = out.status === 'done' && steps.verify;
      for (const j of prep.jobs || []) {
        if (done) await ledger.commit(j.jobKey).catch(() => {});
        else await ledger.release(j.jobKey, `playbook_${out.status}`).catch(() => {});
      }
      return {
        httpStatus: done ? 200 : 502,
        body: {
          status: out.status,
          ...(done ? {} : { message: "Solishtirib bo'lmadi; birlik qaytarildi.", stoppedAt: out.stoppedAt || null }),
          results: done ? steps.verify.results : [],
          counts: done ? steps.verify.counts : null,
          downgraded: done ? steps.verify.downgraded : 0,
          excerpt: steps.excerpt ? steps.excerpt.excerpt : false,
          units: prep.ctx.units,
          trace: out.trace, ms: out.ms,
          charged: !!done && !prep.ctx.unlimited,
        },
      };
    },
  };
}

/** The worker's view of a service: run a queued run, or settle one that cannot run. */
function executorFor(svc) {
  const prepOf = run => ({ input: (run.input && run.input.input) || {}, ctx: (run.input && run.input.ctx) || {}, jobs: run.jobs || [] });
  return {
    async execute(run, opts) {
      const prep = prepOf(run);
      const out = await svc.run(prep, opts);
      const reply = await svc.settle(prep, out);
      return { status: out.status, httpStatus: reply.httpStatus, body: reply.body, error: out.error || null };
    },
    async abort(run, reason) {
      return svc.settle(prepOf(run), failedOut(reason === 'cancelled' ? 'cancelled' : 'failed'));
    },
  };
}

/**
 * One route for one service: prepare in the request; then, with a run
 * store, queue it and wait for the worker; else run it here.
 */
function serve(svc, runs) {
  return async (req, res) => {
    const useRuns = !!(runs && runs.store) && !runsOff();
    const requestId = useRuns ? crypto.randomUUID() : undefined;
    const holdUntil = useRuns ? new Date(Date.now() + HOLD_MIN * 60e3).toISOString() : null;
    const prep = await svc.prepare(req, { requestId, holdUntil });
    if (prep.error) return res.status(prep.error.httpStatus).json(prep.error.body);

    let run = null;
    if (useRuns) {
      try {
        run = await runs.store.create({ adminId: req.session.adminId, workflow: svc.id, input: { input: prep.input, ctx: prep.ctx }, jobs: prep.jobs, requestId, channel: 'web', ...(prep.budget ? { budget: prep.budget } : {}) });
      } catch (e) {
        if (e && e.status === 429) {
          await svc.settle(prep, failedOut('failed')).catch(() => {});
          return res.status(429).json({ error: e.code, message: e.message });
        }
        // no agent_runs table yet (or the database said no): run it in this request
        console.warn('[AGENT] run not queued, running in the request:', e.message);
      }
    }
    if (!run) {
      const out = await svc.run(prep, {});
      const reply = await svc.settle(prep, out);
      return res.status(reply.httpStatus).json(reply.body);
    }
    if (runs.kick) runs.kick();
    if (req.body && req.body.async) return res.status(202).json({ runId: run.id, status: 'queued' });

    // wait for the worker; the page keeps its reply shape
    let gone = false;
    req.on('close', () => { gone = true; });
    const deadline = Date.now() + (prep.maxMs || svc.maxMs) + (Number(process.env.AGENT_SYNC_QUEUE_MS) || 120000);
    const poll = Number(runs.pollMs) || 1000;
    while (!gone && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, poll));
      const now = await runs.store.get(run.id, req.session.adminId).catch(() => null);
      if (now && now.result && ['done', 'failed', 'cancelled', 'budget', 'needs_input'].includes(now.status)) {
        return res.status(now.result.httpStatus || 200).json({ ...now.result.body, runId: run.id });
      }
    }
    if (gone) return undefined;
    return res.status(202).json({ runId: run.id, status: 'running', message: "Ish davom etmoqda; natija tayyor bo'lganda shu yerda ko'rinadi." });
  };
}

function mountAgentRoutes(app, { requireAuth, requireSameOrigin, callAI, callCheapAI, retrieve, generateDraftHtml, ledger, pool, budget = {}, runs = null }) {
  const claim = claimService({ callAI, callCheapAI, retrieve, generateDraftHtml, ledger, budget });
  const executors = { claim_draft: executorFor(claim) };
  executors.tabular_review = mountTabularRoute(app, { requireAuth, requireSameOrigin, callAI, ledger, pool, runs }).executor;
  if (pool) executors.playbook_review = mountPlaybookRoutes(app, { requireAuth, requireSameOrigin, callAI, ledger, pool, runs }).executor;
  app.post('/api/agent/claim-draft', requireSameOrigin, requireAuth, serve(claim, runs));
  return { executors };
}

module.exports = { mountAgentRoutes, mountTabularRoute, mountPlaybookRoutes, claimService, tabularService, playbookService, executorFor };

/**
 *   POST /api/agent/tabular-review          { documents: [{ name, text | scanId }], columns: [{ label, type, options? }], async? }
 *   POST /api/agent/tabular-review/export   { columns, rows, tags } -> .xlsx (no AI, nothing stored)
 *
 * Each document is one row and costs one question unit ('chat') for up to
 * 10 questions - reserved for all rows together before any AI call (all or
 * nothing), then committed per row that was read and released per row that
 * failed. Missing input is 422 before any charge.
 */
function mountTabularRoute(app, { requireAuth, requireSameOrigin, callAI, ledger, pool = null, budget = {}, runs = null }) {
  const svc = tabularService({ callAI, ledger, pool, budget });
  app.post('/api/agent/tabular-review', requireSameOrigin, requireAuth, serve(svc, runs));
  // the table the person has, as an Excel file (no AI, nothing stored)
  app.post('/api/agent/tabular-review/export', requireSameOrigin, requireAuth, (req, res) => {
    const b = req.body || {};
    if (!Array.isArray(b.rows) || !b.rows.length || !Array.isArray(b.columns) || !b.columns.length) {
      return res.status(400).json({ error: 'invalid', message: "Eksport uchun jadval bo'sh" });
    }
    try {
      const buf = tabularExport.buildWorkbook({ columns: b.columns, rows: b.rows, tags: b.tags });
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="jadval-${new Date().toISOString().slice(0, 10)}.xlsx"`, 'Cache-Control': 'no-store' });
      res.send(buf);
    } catch (e) {
      console.error('[AGENT] tabular export failed:', e.message);
      res.status(500).json({ error: 'export_failed', message: "Excel faylni tuzib bo'lmadi" });
    }
  });
  return { executor: executorFor(svc) };
}

/**
 * Playbooks (src/agents/workflows/playbook-review.js):
 *   GET    /api/playbooks                 built-in templates and the caller's own
 *   POST   /api/playbooks                 { name, description, rules } (30 per account)
 *   PUT    /api/playbooks/:id             the caller's own only
 *   DELETE /api/playbooks/:id             the caller's own only
 *   POST   /api/agent/playbook-review     { text, name, playbookId | builtin | rules }
 *
 * A review costs analysis units by the contract's size (docUnits: 40 000
 * characters a unit, page marks not counted), reserved before the AI call,
 * committed when the comparison came out, released otherwise.
 */
function mountPlaybookRoutes(app, { requireAuth, requireSameOrigin, callAI, ledger, pool, budget = {}, runs = null }) {
  const svc = playbookService({ callAI, ledger, pool, budget });
  const MAX_OWN = 30;
  const own = async (adminId) => (await pool.query(
    'SELECT id, name, description, rules, updated_at FROM playbooks WHERE admin_id = $1 ORDER BY updated_at DESC LIMIT 100', [adminId])).rows;
  const body = (req) => {
    const name = String((req.body && req.body.name) || '').replace(/\s+/gu, ' ').trim().slice(0, 120);
    const description = String((req.body && req.body.description) || '').replace(/\s+/gu, ' ').trim().slice(0, 400);
    const rules = playbook.normRules(req.body && req.body.rules).map(({ id, ...r }) => r);
    return { name, description, rules };
  };
  const tableMissing = (e) => /relation "playbooks" does not exist/u.test(String(e && e.message));

  app.get('/api/playbooks', requireAuth, async (req, res) => {
    let mine = [];
    try { mine = await own(req.session.adminId); } catch (e) { if (!tableMissing(e)) console.error('[PLAYBOOK] list:', e.message); }
    res.json({ builtin: playbook.builtinList(), mine });
  });
  app.post('/api/playbooks', requireSameOrigin, requireAuth, async (req, res) => {
    const b = body(req);
    if (b.name.length < 2 || !b.rules.length) return res.status(400).json({ error: 'invalid', message: 'Nom va kamida bitta qoida (nomi va talab) kerak' });
    try {
      const n = (await pool.query('SELECT COUNT(*)::int AS n FROM playbooks WHERE admin_id = $1', [req.session.adminId])).rows[0].n;
      if (n >= MAX_OWN) return res.status(409).json({ error: 'too_many', message: `Ko'pi bilan ${MAX_OWN} ta playbook` });
      const r = await pool.query('INSERT INTO playbooks (admin_id, name, description, rules) VALUES ($1, $2, $3, $4::jsonb) RETURNING id, name, description, rules, updated_at',
        [req.session.adminId, b.name, b.description, JSON.stringify(b.rules)]);
      res.status(201).json(r.rows[0]);
    } catch (e) {
      console.error('[PLAYBOOK] create:', e.message);
      res.status(tableMissing(e) ? 503 : 500).json({ error: 'save_failed', message: "Saqlab bo'lmadi" });
    }
  });
  app.put('/api/playbooks/:id', requireSameOrigin, requireAuth, async (req, res) => {
    const b = body(req);
    if (b.name.length < 2 || !b.rules.length) return res.status(400).json({ error: 'invalid', message: 'Nom va kamida bitta qoida (nomi va talab) kerak' });
    try {
      const r = await pool.query(`UPDATE playbooks SET name = $3, description = $4, rules = $5::jsonb, updated_at = now()
        WHERE id = $1 AND admin_id = $2 RETURNING id, name, description, rules, updated_at`, [Number(req.params.id) || 0, req.session.adminId, b.name, b.description, JSON.stringify(b.rules)]);
      if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
      res.json(r.rows[0]);
    } catch (e) {
      console.error('[PLAYBOOK] update:', e.message);
      res.status(500).json({ error: 'save_failed', message: "Saqlab bo'lmadi" });
    }
  });
  app.delete('/api/playbooks/:id', requireSameOrigin, requireAuth, async (req, res) => {
    try {
      const r = await pool.query('DELETE FROM playbooks WHERE id = $1 AND admin_id = $2', [Number(req.params.id) || 0, req.session.adminId]);
      res.status(r.rowCount ? 204 : 404).end();
    } catch (e) {
      res.status(500).json({ error: 'delete_failed' });
    }
  });

  app.post('/api/agent/playbook-review', requireSameOrigin, requireAuth, serve(svc, runs));
  return { executor: executorFor(svc) };
}

/**
 * Scanned documents by scanId (src/ocr/scan-store.js): only this account's,
 * unexpired; the OCR text with its "=== PAGE n ===" marks.
 * Returns { documents, rows } or { status, error }.
 */
async function scanDocuments(pool, adminId, docs, limit = 20) {
  if (!pool) return { status: 503, error: { error: 'scan_unavailable', message: "Skan hujjatni o'qib bo'lmadi" } };
  const { getScan } = require('../ocr/scan-store');
  const out = [], rows = [];
  try {
    for (const d of docs.slice(0, limit)) {
      if (!d || !d.scanId) { out.push(d); continue; }
      const row = await getScan(pool, { adminId, scanId: d.scanId });
      if (!row) return { status: 404, error: { error: 'scan_not_found', code: 'SCAN_NOT_FOUND', message: "Skan hujjat topilmadi yoki muddati o'tgan — uni qayta yuklang." } };
      rows.push(row);
      out.push({ name: d.name || 'Skan hujjat', text: row.text });
    }
  } catch (e) {
    console.error('[AGENT] scan load failed:', e.message);
    return { status: 503, error: { error: 'scan_unavailable', message: "Skan hujjatni o'qib bo'lmadi" } };
  }
  return { documents: out, rows };
}
