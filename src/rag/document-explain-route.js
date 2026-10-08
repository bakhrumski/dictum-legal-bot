'use strict';

/**
 * POST /api/draft/explain-document - the plain-language explanation of an
 * uploaded document (web; Telegram runs no AI on files, Workspace routes
 * analysis to the AI section). Mounted from server.js; tests mount it with
 * stub AI on a real database (tests/upload-no-ai.db.test.js).
 *
 * Unchanged from before: the service runs only when confirmed
 * (requireServiceConfirm), a scan is read by its scanId (resolveScanDocs),
 * and the job is sized and reserved as an analysis by meterDocument before
 * any AI call. What changed is what the model is given and what is checked
 * on the way out (src/rag/document-explain.js), and that a document not read
 * whole releases its units (below); when no part was read whole, no
 * explanation is generated at all (422 DOCUMENT_NOT_READ, units released).
 */

const { explainDocument } = require('./document-explain');
const usageLedger = require('../ai/usage-ledger');

function mountExplainDocument(app, deps) {
  const { requireAuth, requireServiceConfirm, resolveScanDocs, tariffModule, callAI, digest, lexLangForText, logAudit } = deps;
  app.post('/api/draft/explain-document', requireAuth, requireServiceConfirm, resolveScanDocs, async (req, res) => {
    try {
      const documentText = (typeof req.body.documentText === 'string')
        ? req.body.documentText.replace(/\u0000/g, '').trim() : '';
      if (!documentText || documentText.length < 40) {
        return res.status(400).json({ error: 'Hujjat matni bo\'sh yoki juda qisqa' });
      }
      // an explanation is a document analysis: sized and reserved by units
      try {
        const m = await tariffModule.meterDocument(req, res, {
          service: 'analysis', text: documentText, docTicket: req.body.docTicket, endpoint: '/api/draft/explain-document',
        });
        if (!m.allowed) return;
      } catch (qErr) {
        console.warn('[Explain] quota check failed (refusing):', qErr.message);
        if (!res.headersSent) return res.status(503).json(tariffModule.QUOTA_UNAVAILABLE);
        return;
      }
      const lang = lexLangForText(documentText);
      const langName = lang === 'ru' ? 'Russian' : 'Uzbek (Latin script)';
      const userId = (req.session && req.session.adminId) || null;
      // full text up to 14 000 chars, the shared digest above it; one
      // explanation call; the answer is checked against the source with no AI
      const result = await explainDocument({ documentText, langName, callAI, userId, digest: t => digest(t, userId) });
      // what was read goes to the request's ledger row (ai_requests.doc_coverage)
      if (result.coverage) usageLedger.annotate({ docCoverage: result.coverage.summary || null });
      // no part of the document read whole: no explanation was generated; the
      // status releases the units (attachRefundOnFailure), the provider calls
      // already made stay in the ledger with their cost
      if (result.aborted) {
        return res.status(422).json({
          error: 'document_not_read', code: 'DOCUMENT_NOT_READ', coverage: result.coverage,
          message: "Hujjatning hech bir qismi to'liq o'qilmadi, shuning uchun tushuntirish tayyorlanmadi. Limit qaytarildi. Qayta urinib ko'ring yoki hujjatni qismlarga bo'lib yuboring.",
        });
      }
      if (!result.reply) return res.status(500).json({ error: 'Tushuntirib bo\'lmadi — qayta urinib ko\'ring' });
      if (logAudit) logAudit(req, 'document.explain', 'document', documentText.length + ' chars');
      // Settling, by the existing rules: a document that was not read whole
      // is not the service - as an OCR with a missing page (tariffs v2,
      // 2026-10-06) its units are released; the partial explanation is
      // still shown, marked partial at its top. A document read whole whose
      // answer was cut at the token cap is delivered and paid, as an answer
      // the claim guard cuts to its last full sentence.
      let refund = {};
      if (!result.coverage.documentFullyRead && typeof tariffModule.refundUsage === 'function') {
        refund = tariffModule.refundUsage(res, 'explain_partial_read');
      }
      // a master testing their own document gets what each stage held
      // (digest, the scope lines, the raw answer) to see where meaning was
      // lost; nothing is stored, and no one else ever receives it
      const trace = req.session && req.session.role === 'master' ? result.trace : undefined;
      res.json({ reply: result.reply, provider: result.provider, coverage: result.coverage, check: result.check,
        partial: result.coverage.partial, trace, ...refund });
    } catch (e) {
      console.error('[Explain Doc] error:', e.message);
      res.status(500).json({ error: 'Tushuntirish xatoligi: ' + e.message });
    }
  });
}

module.exports = { mountExplainDocument };
