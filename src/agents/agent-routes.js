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
const playbook = require('./workflows/playbook-review');

function mountAgentRoutes(app, { requireAuth, requireSameOrigin, callAI, callCheapAI, retrieve, generateDraftHtml, ledger, pool, budget = {} }) {
  const workflow = createClaimDraftWorkflow();
  mountTabularRoute(app, { requireAuth, requireSameOrigin, callAI, ledger });
  if (pool) mountPlaybookRoutes(app, { requireAuth, requireSameOrigin, callAI, ledger, pool });

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

module.exports = { mountAgentRoutes, mountTabularRoute, mountPlaybookRoutes };

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
function mountPlaybookRoutes(app, { requireAuth, requireSameOrigin, callAI, ledger, pool, budget = {} }) {
  const workflow = playbook.createPlaybookReviewWorkflow();
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

  app.post('/api/agent/playbook-review', requireSameOrigin, requireAuth, async (req, res) => {
    const input = { text: req.body && req.body.text, name: req.body && req.body.name, rules: req.body && req.body.rules };
    // the rules come from the caller's own playbook or a built-in one, never another account's
    if (req.body && req.body.playbookId) {
      try {
        const r = await pool.query('SELECT rules FROM playbooks WHERE id = $1 AND admin_id = $2', [Number(req.body.playbookId) || 0, req.session.adminId]);
        if (!r.rows[0]) return res.status(404).json({ error: 'not_found', message: 'Playbook topilmadi' });
        input.rules = r.rows[0].rules;
      } catch (e) { return res.status(503).json({ error: 'unavailable', message: "Playbookni o'qib bo'lmadi" }); }
    } else if (req.body && req.body.builtin) {
      const b = playbook.BUILTIN[String(req.body.builtin)];
      if (!b) return res.status(404).json({ error: 'not_found', message: 'Playbook topilmadi' });
      input.rules = b.rules;
    }
    const first = playbook.readInput(input);
    if (first.missing.length) return res.status(422).json({ error: 'needs_input', message: "Tekshiruv uchun ma'lumot yetarli emas", missing: first.missing });
    const chars = first.text.replace(/^\[Sahifa \d+\]\n?/gmu, '').length;
    const size = ledger.docUnits({ chars });
    let job;
    try {
      job = await ledger.reserve({ adminId: req.session.adminId, service: 'analysis', units: size.units, endpoint: '/api/agent/playbook-review', channel: 'web' });
    } catch (e) {
      console.error('[AGENT] playbook reserve failed:', e.message);
      return res.status(503).json({ error: 'quota_unavailable', message: "Limitni hozir tekshirib bo'lmadi" });
    }
    if (!job.allowed) return res.status(402).json({ error: 'no_units', message: `Bu shartnoma uchun ${size.units} ta tahlil birligi kerak, limit yetarli emas.`, needed: size.units });
    let out;
    try {
      out = await runWorkflow(workflow, input, { deps: { callAI }, budget: { maxSteps: 6, maxMs: Number(process.env.AGENT_PLAYBOOK_MAX_MS) || 150000, ...budget } });
    } catch (e) {
      out = { status: 'failed', trace: [], state: { steps: {} } };
    }
    const steps = (out.state && out.state.steps) || {};
    const done = out.status === 'done' && steps.verify;
    if (job.jobKey) {
      if (done) await ledger.commit(job.jobKey).catch(() => {});
      else await ledger.release(job.jobKey, `playbook_${out.status}`).catch(() => {});
    }
    res.status(done ? 200 : 502).json({
      status: out.status,
      ...(done ? {} : { message: "Solishtirib bo'lmadi; birlik qaytarildi.", stoppedAt: out.stoppedAt || null }),
      results: done ? steps.verify.results : [],
      counts: done ? steps.verify.counts : null,
      downgraded: done ? steps.verify.downgraded : 0,
      excerpt: steps.excerpt ? steps.excerpt.excerpt : false,
      units: size.units,
      trace: out.trace, ms: out.ms,
      charged: !!done && !job.unlimited,
    });
  });
}
