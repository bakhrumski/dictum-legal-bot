'use strict';

/**
 * "Shartnomani to'liq tekshirish" as a service and its routes (2026-11-11,
 * audit X8 / G2; the workflow is src/agents/workflows/contract-review.js).
 *
 *   POST /api/agent/contract-review/quote   { scanId | text, builtin | playbookId | rules }
 *        -> { parts: [{ key, units }], total }           no AI, nothing reserved
 *   POST /api/agent/contract-review         the same body (+ name, async)
 *        -> the report (or 202 with a runId; the run is an agent run)
 *   POST /api/agent/contract-review/:runId/editor
 *        -> { id }  the contract as an editor document whose "AI tahlil" panel
 *           already holds this run's proposals (no AI, no unit)
 *
 * Price: what the parts cost on their own pages - analysis units by the
 * contract's size for the analysis, and the same again for the firm rules
 * when rules are chosen. The law lookup adds no unit. Each part is settled
 * by itself: a part that came out is committed, a part that failed goes
 * back; nothing came out -> 502 and everything goes back.
 *
 * The editor handoff reads the contract again from the person's own library
 * (the run keeps no text) and only when it is still the text the run read
 * (sha256).
 */

const crypto = require('crypto');
const { runWorkflow } = require('./harness');
const playbook = require('./workflows/playbook-review');
const contract = require('./workflows/contract-review');

const fail = (httpStatus, body) => ({ error: { httpStatus, body } });
const sha = text => crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
const off = () => String(process.env.CONTRACT_REVIEW || '').toLowerCase() === 'off';

function contractService({ callAI, analyze, retrieve, ledger, pool, scanDocuments, budget = {} }) {
  const workflow = contract.createContractReviewWorkflow();
  const maxMs = Number(process.env.AGENT_CONTRACT_MAX_MS) || 300000;

  /** The document and the rules of a request, sized. No AI, nothing reserved. */
  async function read(req) {
    const b = req.body || {};
    const adminId = req.session.adminId;
    const input = { text: b.text, name: b.name, rules: [] };
    let rulesKey = 'none';
    // the rules come from the caller's own playbook, a built-in one or the page (a firm playbook's rules), never another account's
    if (b.playbookId) {
      try {
        const r = await pool.query('SELECT rules FROM playbooks WHERE id = $1 AND admin_id = $2', [Number(b.playbookId) || 0, adminId]);
        if (!r.rows[0]) return fail(404, { error: 'not_found', message: 'Playbook topilmadi' });
        input.rules = r.rows[0].rules; rulesKey = 'own';
      } catch (e) { return fail(503, { error: 'unavailable', message: "Playbookni o'qib bo'lmadi" }); }
    } else if (b.builtin) {
      const p = playbook.BUILTIN[String(b.builtin)];
      if (!p) return fail(404, { error: 'not_found', message: 'Playbook topilmadi' });
      input.rules = p.rules; rulesKey = String(b.builtin);
    } else if (Array.isArray(b.rules) && b.rules.length) { input.rules = b.rules; rulesKey = 'own'; }
    let scan = null;
    if (b.scanId) {
      const r = await scanDocuments(pool, adminId, [{ scanId: b.scanId, name: b.name }]);
      if (r.error) return fail(r.status, r.error);
      scan = r.rows[0];
      input.text = scan.text;
      if (!input.name) input.name = scan.name;
    }
    const first = contract.readInput(input);
    if (first.missing.length) return fail(422, { error: 'needs_input', message: "Tekshiruv uchun shartnoma matni yetarli emas", missing: first.missing });
    const chars = first.text.replace(/^\[Sahifa \d+\]\n?|^=== PAGE \d+ ===\n?/gmu, '').length;
    const size = ledger.docUnits({ chars, pages: scan ? scan.pages : null });
    const parts = [{ key: 'analysis', units: size.units }, ...(first.rules.length ? [{ key: 'rules', units: size.units }] : [])];
    return { input: { ...input, text: first.text, name: first.name, rules: first.rules, adminId }, scan, parts, rulesKey, total: parts.reduce((n, p) => n + p.units, 0) };
  }

  return {
    id: 'contract_review', maxMs, read,
    async prepare(req, { requestId, holdUntil } = {}) {
      const r = await read(req);
      if (r.error) return r;
      const adminId = req.session.adminId;
      const jobs = [];
      let unlimited = false;
      const giveBack = async () => { for (const j of jobs) if (!j.adopted) await ledger.release(j.jobKey, 'contract_not_started').catch(() => {}); };
      for (const p of r.parts) {
        let job;
        try {
          // a scanned contract: the analysis units its OCR step held are the analysis part's
          const held = p.key === 'analysis' && r.scan && ledger.heldScanJob ? await ledger.heldScanJob({ adminId, fileHash: r.scan.file_hash, service: 'analysis' }) : null;
          job = held && Number(held.units) >= p.units
            ? { allowed: true, jobKey: held.job_key, adopted: true }
            : await ledger.reserve({ adminId, service: 'analysis', units: p.units, endpoint: '/api/agent/contract-review', channel: 'web',
              ...(holdUntil ? { meta: { holdUntil, part: p.key } } : { meta: { part: p.key } }), ...(requestId ? { requestId } : {}) });
        } catch (e) {
          console.error('[AGENT] contract reserve failed:', e.message);
          await giveBack();
          return fail(503, { error: 'quota_unavailable', message: "Limitni hozir tekshirib bo'lmadi" });
        }
        if (!job.allowed) {
          await giveBack();
          return fail(402, { error: 'no_units', message: `Bu tekshiruv uchun ${r.total} ta tahlil birligi kerak, limit yetarli emas.`, needed: r.total, parts: r.parts });
        }
        unlimited = unlimited || !!job.unlimited;
        if (job.jobKey) jobs.push({ jobKey: job.jobKey, service: 'analysis', part: p.key, units: p.units, adopted: !!job.adopted });
      }
      return {
        input: r.input, maxMs,
        ctx: { parts: r.parts, total: r.total, unlimited, playbook: r.rulesKey === 'none' || r.rulesKey === 'own' ? undefined : r.rulesKey,
          docRef: r.scan ? { scanId: r.scan.id } : null, textSha: sha(r.input.text) },
        jobs,
      };
    },
    async run(prep, opts = {}) {
      try {
        return await runWorkflow(workflow, prep.input, { deps: { callAI, analyze, retrieve }, budget: { maxSteps: 6, maxMs, ...budget }, ...opts });
      } catch (e) {
        if (e && e.checkpointFailed) throw e;
        return { status: 'failed', trace: [], state: { steps: {} }, error: e.message };
      }
    },
    async settle(prep, out) {
      const steps = (out.state && out.state.steps) || {};
      const report = out.status === 'done' && steps.report ? steps.report.report : null;
      let charged = 0;
      for (const j of prep.jobs || []) {
        if (report && report.parts[j.part] === 'ok') { await ledger.commit(j.jobKey).catch(e => console.error('[AGENT] contract commit failed:', e.message)); charged += j.units || 0; }
        else await ledger.release(j.jobKey, `contract_${j.part}_${report ? 'failed' : out.status}`).catch(() => {});
      }
      const ctx = prep.ctx || {};
      return {
        httpStatus: report ? 200 : 502,
        body: {
          status: out.status,
          ...(report ? {} : { message: "Shartnomani tekshirib bo'lmadi; birliklar qaytarildi.", stoppedAt: out.stoppedAt || null }),
          report,
          units: { parts: ctx.parts || [], total: ctx.total || 0, charged: ctx.unlimited ? 0 : charged },
          docRef: ctx.docRef || null, textSha: ctx.textSha || null,
          trace: out.trace, ms: out.ms,
        },
      };
    },
  };
}

function mountContractRoutes(app, { requireAuth, requireSameOrigin, callAI, analyze, retrieve, ledger, pool, runs = null, serve, executorFor, scanDocuments, editorStore = null }) {
  const svc = contractService({ callAI, analyze, retrieve, ledger, pool, scanDocuments });
  const gate = (req, res, next) => (off() ? res.status(503).json({ error: 'unavailable' }) : next());

  app.post('/api/agent/contract-review/quote', requireSameOrigin, requireAuth, gate, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const r = await svc.read(req);
      if (r.error) return res.status(r.error.httpStatus).json(r.error.body);
      res.json({ parts: r.parts, total: r.total, service: 'analysis' });
    } catch (e) { console.error('[AGENT] contract quote:', e.message); res.status(500).json({ error: 'failed' }); }
  });

  app.post('/api/agent/contract-review', requireSameOrigin, requireAuth, gate, serve(svc, runs));

  // the contract as an editor document that already holds this run's proposals
  app.post('/api/agent/contract-review/:runId/editor', requireSameOrigin, requireAuth, gate, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!runs || !runs.store || !editorStore || String(process.env.EDITOR || '').toLowerCase() === 'off') return res.status(503).json({ error: 'unavailable', message: 'Muharrir hozir mavjud emas.' });
      const adminId = req.session.adminId;
      const run = await runs.store.get(req.params.runId, adminId);
      const body = run && run.workflow === 'contract_review' && run.result && run.result.body;
      if (!body || !body.report) return res.status(404).json({ error: 'not_found' });
      const access = require('../editor/access');
      if (body.editorDocId && await access.load(pool, body.editorDocId, adminId, 'read').catch(() => null)) return res.json({ id: body.editorDocId, existing: true });
      const row = body.docRef && body.docRef.scanId ? await require('../ocr/scan-store').getScan(pool, { adminId, scanId: body.docRef.scanId }) : null;
      if (!row) return res.status(409).json({ error: 'document_gone', message: "Hujjat Hujjatlar bo'limida topilmadi — muharrirda ochib bo'lmaydi." });
      const text = String(row.text || '').slice(0, contract.LIMITS.docChars);
      if (sha(text) !== body.textSha) return res.status(409).json({ error: 'document_changed', message: "Hujjat tekshiruvdan keyin o'zgargan — qayta tekshiring." });
      const privacy = require('../privacy/crypto');
      const { textToHtml } = require('../editor/sanitize');
      const doc = await editorStore.create(adminId, { title: body.report.name || row.name || 'Shartnoma', html: textToHtml(text), source: 'library', importNotes: ['plain_text'] });
      const result = contract.editorResult(body.report, text);
      const a = (await pool.query(
        `INSERT INTO doc_editor_analyses (document_id, created_by, units, revision, result) VALUES ($1, $2, NULL, $3, '') RETURNING id`, [doc.id, adminId, doc.revision])).rows[0];
      await pool.query('UPDATE doc_editor_analyses SET result = $2 WHERE id = $1', [a.id, privacy.seal(JSON.stringify(result), `doc_editor_analyses.result:${a.id}`)]);
      await runs.store.patchBody(run.id, adminId, 'contract_review', { editorDocId: doc.id }).catch(() => {});
      res.status(201).json({ id: doc.id, proposals: result.counts.proposals });
    } catch (e) {
      if (e && e.status) return res.status(e.status).json({ error: e.code || 'error', message: e.message });
      console.error('[AGENT] contract to editor:', e.message);
      res.status(500).json({ error: 'failed', message: "Muharrirda ochib bo'lmadi." });
    }
  });

  return { executor: executorFor(svc), service: svc };
}

module.exports = { contractService, mountContractRoutes };
