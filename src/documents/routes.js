'use strict';

/**
 * "Hujjatlarim" over HTTP (2026-10-29, migration 029, src/ocr/scan-store.js).
 * Every document a person uploads (a text Word/PDF or a scan) is kept until
 * they delete it; a service uses it by its id (scanId), never another
 * account's (404). The text is never sent back here - only the list.
 *
 *   GET    /api/documents            own documents, last used first (no text)
 *   PATCH  /api/documents/:id { name }
 *   DELETE /api/documents/:id        deleted for good, text and all
 */

const scanStore = require('../ocr/scan-store');

function mountDocumentRoutes(app, { pool, requireAuth, requireSameOrigin, logAudit = () => {} }) {
  const me = req => req.session.adminId;
  const guard = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await fn(req, res); } catch (e) {
      if (/does not exist|column/u.test(String(e && e.message))) return res.status(503).json({ error: 'unavailable' });
      console.error('[DOCS]', req.method, req.path, e.message);
      if (!res.headersSent) res.status(500).json({ error: 'failed' });
    }
  };
  app.get('/api/documents', requireAuth, guard(async (req, res) => {
    res.json(await scanStore.listLibrary(pool, { adminId: me(req) }));
  }));
  app.patch('/api/documents/:id', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const ok = await scanStore.renameDoc(pool, { adminId: me(req), id: req.params.id, name: req.body && req.body.name });
    ok ? res.json({ ok: true }) : res.status(404).json({ error: 'not_found' });
  }));
  app.delete('/api/documents/:id', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const ok = await scanStore.deleteDoc(pool, { adminId: me(req), id: req.params.id });
    if (ok) logAudit(req, 'document.delete', 'document', null);
    ok ? res.json({ ok: true }) : res.status(404).json({ error: 'not_found' });
  }));
}

module.exports = { mountDocumentRoutes };
