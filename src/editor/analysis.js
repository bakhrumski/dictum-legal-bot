'use strict';

/**
 * The document editor's AI analysis panel (D4, docs/design/hujjat-muharriri.md;
 * owner 2026-11-03). The document's analysis is the website's own (the same
 * prompt as POST /api/analyze, src/ocr/routes.js analyzeDocumentText, with
 * the editor's two fields: a risk's replacement wording and a missing clause's
 * text) and it costs what an analysis costs: analysis units by the document's
 * size, shown first and run only on `confirmed: true`, paid by the person who
 * runs it, given back when the run fails. The text is the one the server
 * keeps for the document (the page saves first), never one the page sends.
 *
 * Each risk's excerpt is looked for in the document word for word (spaces,
 * case, apostrophe and quote forms aside): found -> the page can select it and
 * offer its replacement; not found -> "joyi topilmadi", never a guess. Nothing
 * in the document changes here: the page replaces or inserts only when a
 * person accepts a proposal (and keeps a version first).
 *
 *   POST /api/editor/docs/:id/analysis/quote   { units, pages, chars, remainingAfter, fits, ... }
 *   POST /api/editor/docs/:id/analysis { confirmed: true }   run -> the result
 *   GET  /api/editor/docs/:id/analysis         the latest run (any member who can read)
 *
 * Running needs the commenter role or above (a viewer reads the result).
 */

const privacy = require('../privacy/crypto');
const access = require('./access');
const { textOf } = require('./sanitize');

const aad = id => `doc_editor_analyses.result:${id}`;
const LEVELS = new Set(['high', 'medium', 'low']);
const cut = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

/** Text for comparing: one space, no case, one apostrophe and one quote form. */
function fold(s) {
  return String(s || '')
    .normalize('NFC')
    .replace(/[‘’ʻʼ`´]/gu, '\'')
    .replace(/[«»“”„"]/gu, '"')
    .replace(/[–—]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

/** Is the excerpt in the text word for word (by fold)? An excerpt shortened with "..." is not. */
function locate(text, excerpt) {
  const e = fold(excerpt);
  if (e.length < 4 || /\.\.\.|…/u.test(e)) return false;
  return fold(text).includes(e);
}

/** The model's JSON -> what the page shows; anything malformed is dropped, not guessed. */
function shape(analysis, text) {
  const a = analysis || {};
  const risks = (Array.isArray(a.riskItems) ? a.riskItems : []).slice(0, 40).map((r, i) => {
    const excerpt = cut(r && r.excerpt, 400);
    const replacement = cut(r && r.replacement, 2000);
    return {
      id: `r${i + 1}`,
      level: LEVELS.has(String(r && r.level).toLowerCase()) ? String(r.level).toLowerCase() : 'low',
      clause: cut(r && r.clause, 160),
      excerpt,
      found: locate(text, excerpt),
      issue: cut(r && r.issue, 1200),
      suggestion: cut(r && r.suggestion, 1200),
      // a replacement equal to its excerpt proposes nothing
      replacement: replacement && fold(replacement) !== fold(excerpt) ? replacement : '',
    };
  }).filter(r => r.issue || r.excerpt);
  const missing = (Array.isArray(a.missingClauses) ? a.missingClauses : []).slice(0, 20).map((m, i) => ({
    id: `m${i + 1}`,
    clause: cut(m && m.clause, 160),
    importance: String(m && m.importance).toLowerCase() === 'high' ? 'high' : 'medium',
    description: cut(m && m.description, 1200),
    text: cut(m && m.text, 3000),
  })).filter(m => m.clause || m.description);
  const compliance = (Array.isArray(a.complianceIssues) ? a.complianceIssues : []).slice(0, 20).map(c => ({
    article: cut(c && c.article, 160), issue: cut(c && c.issue, 1200), suggestion: cut(c && c.suggestion, 1200),
  })).filter(c => c.issue);
  const score = Number.isFinite(Number(a.overallScore)) ? Math.max(0, Math.min(100, Math.round(Number(a.overallScore)))) : null;
  return {
    docType: cut(a.docType, 160), summary: cut(a.summary, 1500), score,
    risks, missing, compliance,
    strengths: (Array.isArray(a.strengths) ? a.strengths : []).slice(0, 10).map(x => cut(x, 300)).filter(Boolean),
    counts: { risks: risks.length, found: risks.filter(r => r.found).length, proposals: risks.filter(r => r.found && r.replacement).length + missing.filter(m => m.text).length },
  };
}

function mountEditorAnalysis(app, { pool, requireAuth, requireSameOrigin, requireServiceConfirm, tariffModule, analyze }) {
  const me = req => req.session.adminId;
  const off = () => String(process.env.EDITOR || '').toLowerCase() === 'off' || String(process.env.EDITOR_ANALYSIS || '').toLowerCase() === 'off';
  const guard = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (off()) return res.status(503).json({ error: 'unavailable' });
    try { await fn(req, res); } catch (e) {
      if (e && e.status && !res.headersSent) return res.status(e.status).json({ error: e.code || 'error', message: e.message });
      console.error('[EDITOR-ANALYSIS]', req.method, req.path, e.message);
      if (!res.headersSent) res.status(500).json({ error: 'failed', message: "Tahlil bajarilmadi — birlik qaytarildi. Qayta urinib ko'ring." });
    }
  };
  const notFound = res => res.status(404).json({ error: 'not_found' });
  // the document's text as the server keeps it (sealed at rest)
  async function docText(id, adminId, need) {
    const row = await access.load(pool, id, adminId, need);
    if (!row) return null;
    const html = privacy.open(row.html, `doc_editor_documents.html:${row.id}`);
    return { row, text: textOf(html) };
  }

  app.post('/api/editor/docs/:id/analysis/quote', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const d = await docText(req.params.id, me(req), 'comment');
    if (!d) return notFound(res);
    if (!d.text.trim()) return res.status(400).json({ error: 'EMPTY_DOCUMENT', message: "Hujjat bo'sh — tahlil qilinadigan matn yo'q." });
    res.json(await tariffModule.quoteDocument(me(req), { service: 'analysis', text: d.text }));
  }));

  app.post('/api/editor/docs/:id/analysis', requireSameOrigin, requireAuth, requireServiceConfirm, guard(async (req, res) => {
    const d = await docText(req.params.id, me(req), 'comment');
    if (!d) return notFound(res);
    if (!d.text.trim()) return res.status(400).json({ error: 'EMPTY_DOCUMENT', message: "Hujjat bo'sh — tahlil qilinadigan matn yo'q.", quotaRefunded: true });
    // sized from the whole document and reserved (tariffs v2); refunded on any 4xx / 5xx reply
    const m = await tariffModule.meterDocument(req, res, { service: 'analysis', text: d.text, endpoint: '/api/editor/analysis' });
    if (!m.allowed) return;
    const out = await analyze(d.text, { adminId: me(req), langHint: req.body && req.body.langHint });
    if (!out || !out.analysis) {
      return res.status(502).json({ error: 'ANALYSIS_UNREADABLE', message: "AI javobini o'qib bo'lmadi — birlik qaytarildi. Qayta urinib ko'ring.", quotaRefunded: true });
    }
    const result = shape(out.analysis, d.text);
    const units = (m.size && m.size.units) || null;
    const id = (await pool.query(
      `INSERT INTO doc_editor_analyses (document_id, created_by, units, revision, result) VALUES ($1, $2, $3, $4, '') RETURNING id, created_at`,
      [d.row.id, me(req), units, d.row.revision])).rows[0];
    await pool.query('UPDATE doc_editor_analyses SET result = $2 WHERE id = $1', [id.id, privacy.seal(JSON.stringify(result), aad(id.id))]);
    res.json({ id: id.id, createdAt: id.created_at, units, revision: d.row.revision, byMe: true, ...result });
  }));

  app.get('/api/editor/docs/:id/analysis', requireAuth, guard(async (req, res) => {
    const row = await access.load(pool, req.params.id, me(req), 'read');
    if (!row) return notFound(res);
    const r = (await pool.query(
      `SELECT a.id, a.created_at, a.units, a.revision, a.result, a.created_by, ad.full_name
         FROM doc_editor_analyses a LEFT JOIN admins ad ON ad.id = a.created_by
        WHERE a.document_id = $1 ORDER BY a.created_at DESC LIMIT 1`, [row.id])).rows[0];
    if (!r) return res.json({ none: true });
    let result;
    try { result = JSON.parse(privacy.open(r.result, aad(r.id))); } catch (_) { return res.json({ none: true }); }
    res.json({ id: r.id, createdAt: r.created_at, units: r.units, revision: r.revision, by: r.full_name || null, byMe: r.created_by === me(req), ...result });
  }));
}

module.exports = { mountEditorAnalysis, shape, locate, fold };
