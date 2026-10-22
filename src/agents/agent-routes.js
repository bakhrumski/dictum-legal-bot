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
 */

const { runWorkflow } = require('./harness');
const { createClaimDraftWorkflow, readIntake } = require('./workflows/claim-draft');
const tabular = require('./workflows/tabular-review');

function mountAgentRoutes(app, { requireAuth, requireSameOrigin, callAI, callCheapAI, retrieve, generateDraftHtml, ledger, budget = {} }) {
  const workflow = createClaimDraftWorkflow();
  mountTabularRoute(app, { requireAuth, requireSameOrigin, callAI, ledger });

  app.post('/api/agent/claim-draft', requireSameOrigin, requireAuth, async (req, res) => {
    const input = req.body || {};
    const intake = readIntake(input);
    if (intake.missing.length) {
      return res.status(422).json({ error: 'needs_input', message: "Da'vo arizasi uchun ma'lumot yetarli emas", missing: intake.missing });
    }
    let job;
    try {
      job = await ledger.reserve({ adminId: req.session.adminId, service: 'draft', units: 1, endpoint: '/api/agent/claim-draft', channel: 'web' });
    } catch (e) {
      console.error('[AGENT] reserve failed:', e.message);
      return res.status(503).json({ error: 'quota_unavailable', message: "Limitni hozir tekshirib bo'lmadi" });
    }
    if (!job.allowed) {
      return res.status(402).json({ error: 'no_units', message: "Hujjat tayyorlash birligi qolmagan. Tarif yoki bir martalik xizmat kerak.", plan: job.plan || null });
    }
    let out;
    try {
      out = await runWorkflow(workflow, input, {
        deps: { callAI, callCheapAI: callCheapAI || callAI, retrieve, generateDraftHtml },
        budget: { maxSteps: 8, maxMs: Number(process.env.AGENT_MAX_MS) || 150000, ...budget },
      });
    } catch (e) {
      out = { status: 'failed', trace: [], state: { steps: {} }, error: e.message };
    }
    const steps = (out.state && out.state.steps) || {};
    const delivered = out.status === 'done' && steps.draft && steps.draft.html;
    if (job.jobKey) {
      if (delivered) await ledger.commit(job.jobKey).catch((e) => console.error('[AGENT] commit failed:', e.message));
      else await ledger.release(job.jobKey, `agent_${out.status}`).catch(() => {});
    }
    const sources = ((steps.research && steps.research.sources) || []).map(s => ({ id: s.id, act: s.act, article: s.article, url: s.url }));
    res.status(delivered ? 200 : 502).json({
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
      charged: !!delivered && !job.unlimited,
    });
  });
}

module.exports = { mountAgentRoutes, mountTabularRoute };

/**
 *   POST /api/agent/tabular-review   { documents: [{ name, text }], columns: [{ label, type }] }
 *
 * Each document is one row and costs one question unit ('chat') for up to
 * 10 questions - reserved for all rows together before any AI call (all or
 * nothing), then committed per row that was read and released per row that
 * failed. Missing input is 422 before any charge.
 */
function mountTabularRoute(app, { requireAuth, requireSameOrigin, callAI, ledger, budget = {} }) {
  const workflow = tabular.createTabularReviewWorkflow();
  app.post('/api/agent/tabular-review', requireSameOrigin, requireAuth, async (req, res) => {
    const input = req.body || {};
    const first = tabular.readInput(input);
    if (first.missing.length) return res.status(422).json({ error: 'needs_input', message: "Jadval uchun ma'lumot yetarli emas", missing: first.missing });
    let jobs;
    try {
      jobs = await ledger.reserveMany({ adminId: req.session.adminId, channel: 'web',
        jobs: first.docs.map(d => ({ service: 'chat', units: 1, endpoint: '/api/agent/tabular-review', meta: { row: d.id } })) });
    } catch (e) {
      console.error('[AGENT] tabular reserve failed:', e.message);
      return res.status(503).json({ error: 'quota_unavailable', message: "Limitni hozir tekshirib bo'lmadi" });
    }
    if (!jobs.allowed) {
      return res.status(402).json({ error: 'no_units', message: `Har bir hujjat uchun 1 ta savol birligi kerak (${first.docs.length} ta), limit yetarli emas.`, needed: first.docs.length, remaining: jobs.remaining == null ? null : jobs.remaining });
    }
    const jobOf = new Map(first.docs.map((d, i) => [d.id, jobs.jobs[i] && jobs.jobs[i].jobKey]));
    let out;
    try {
      out = await runWorkflow(workflow, input, { deps: { callAI }, budget: { maxSteps: 6, maxMs: Number(process.env.AGENT_TABLE_MAX_MS) || 180000, ...budget } });
    } catch (e) {
      out = { status: 'failed', trace: [], state: { steps: {} } };
    }
    const steps = (out.state && out.state.steps) || {};
    const rows = (steps.verify && steps.verify.rows) || [];
    const ok = new Set(rows.filter(r => r.status === 'ok').map(r => r.docId));
    let charged = 0;
    for (const [docId, key] of jobOf) {
      if (!key) continue;
      if (out.status === 'done' && ok.has(docId)) { await ledger.commit(key).catch(() => {}); charged++; }
      else await ledger.release(key, out.status === 'done' ? 'tabular_row_failed' : `tabular_${out.status}`).catch(() => {});
    }
    res.status(out.status === 'done' ? 200 : 502).json({
      status: out.status,
      ...(out.status === 'done' ? {} : { message: "Jadvalni tayyorlab bo'lmadi; birliklar qaytarildi.", stoppedAt: out.stoppedAt || null }),
      columns: steps.validate ? steps.validate.columns : [],
      rows,
      droppedDocs: steps.validate ? steps.validate.droppedDocs : 0,
      verified: steps.verify ? steps.verify.verified : 0,
      unverified: steps.verify ? steps.verify.unverified : 0,
      trace: out.trace, ms: out.ms,
      charged: jobs.kind === 'staff' ? 0 : charged,
    });
  });
}
