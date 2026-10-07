'use strict';

/**
 * POST /api/draft/explain-document - the plain-language explanation of an
 * uploaded document (web; Telegram runs no AI on files, Workspace routes
 * analysis to the AI section). Mounted from server.js; tests mount it with
 * stub AI on a real database (tests/document-explain.db.test.js).
 *
 * Unchanged from before: the service runs only when confirmed
 * (requireServiceConfirm), a scan is read by its scanId (resolveScanDocs),
 * and the job is sized and reserved as an analysis by meterDocument before
 * any AI call. What changed is what the model is given and what is checked
 * on the way out (src/rag/document-explain.js).
 */

const { explainDocument } = require('./document-explain');

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
      if (!result.reply) return res.status(500).json({ error: 'Tushuntirib bo\'lmadi — qayta urinib ko\'ring' });
      if (logAudit) logAudit(req, 'document.explain', 'document', documentText.length + ' chars');
      res.json({ reply: result.reply, provider: result.provider, coverage: result.coverage, check: result.check });
    } catch (e) {
      console.error('[Explain Doc] error:', e.message);
      res.status(500).json({ error: 'Tushuntirish xatoligi: ' + e.message });
    }
  });
}

module.exports = { mountExplainDocument };
