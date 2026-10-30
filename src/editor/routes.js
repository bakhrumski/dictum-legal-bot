'use strict';

/**
 * The document editor over HTTP (D1, docs/design/hujjat-muharriri.md). Every
 * plan (owner, 2026-10-30); the owner's own documents only - another
 * account's id is 404. No AI, no unit. EDITOR=off stops it.
 *
 *   GET    /api/editor/docs                         own documents (no text)
 *   POST   /api/editor/docs { title, html, source }   blank or an AI draft
 *   POST   /api/editor/docs { libraryId }           a "Hujjatlarim" document, as paragraphs
 *   POST   /api/editor/import (multipart file)      Word (kept formatting) / text PDF / .txt
 *   GET    /api/editor/docs/:id                     { title, html, revision, importNotes }
 *   PUT    /api/editor/docs/:id { html?, title?, revision }  409 STALE with the current revision
 *   DELETE /api/editor/docs/:id
 *   GET    /api/editor/docs/:id/versions            | GET .../versions/:n  (its html)
 *   POST   /api/editor/docs/:id/versions { label }  | POST .../versions/:n/restore
 *   GET    /api/editor/docs/:id/export.docx         a real .docx (src/drafting/html-to-docx.js)
 */

const os = require('os');
const fs = require('fs');
const multer = require('multer');
const { createEditorStore } = require('./store');
const { importFile } = require('./import');
const { textToHtml } = require('./sanitize');

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(docx|pdf|txt)$/iu.test(file.originalname || '');
    cb(ok ? null : Object.assign(new Error('Word (.docx), PDF yoki .txt fayl kerak.'), { status: 415 }), ok);
  },
});

const IMPORT_ERRORS = {
  scanned: "Bu faylda matn qatlami yo'q (skan). Avval «Hujjatlarim»da OCR qiling, keyin muharrirda oching.",
  corrupt: "Faylni o'qib bo'lmadi — u buzilgan bo'lishi mumkin.",
  type: 'Word (.docx), PDF yoki .txt fayl kerak. Eski .doc faylni Word\'da .docx qilib saqlang.',
};

function mountEditorRoutes(app, { pool, requireAuth, requireSameOrigin, extractFileText, logAudit = () => {} }) {
  const store = createEditorStore({ db: pool });
  const me = req => req.session.adminId;
  const off = () => String(process.env.EDITOR || '').toLowerCase() === 'off';
  const guard = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (off()) return res.status(503).json({ error: 'unavailable' });
    try { await fn(req, res); } catch (e) {
      if (e && e.status) return res.status(e.status).json({ error: e.code || 'error', message: e.message, revision: e.revision });
      if (/does not exist/u.test(String(e && e.message))) return res.status(503).json({ error: 'unavailable' });
      console.error('[EDITOR]', req.method, req.path, e.message);
      if (!res.headersSent) res.status(500).json({ error: 'failed' });
    }
  };
  const notFound = res => res.status(404).json({ error: 'not_found' });

  app.get('/api/editor/docs', requireAuth, guard(async (req, res) => { res.json({ documents: await store.list(me(req)) }); }));

  app.post('/api/editor/docs', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const b = req.body || {};
    if (b.libraryId) {
      const row = await require('../ocr/scan-store').getScan(pool, { adminId: me(req), scanId: b.libraryId });
      if (!row) return notFound(res);
      const out = await store.create(me(req), { title: b.title || row.name || 'Hujjat', html: textToHtml(row.text), source: 'library', importNotes: ['plain_text'] });
      return res.status(201).json(out);
    }
    const source = b.source === 'draft' ? 'draft' : 'blank';
    res.status(201).json(await store.create(me(req), { title: b.title, html: typeof b.html === 'string' ? b.html : '', source }));
  }));

  app.post('/api/editor/import', requireSameOrigin, requireAuth, (req, res, next) => upload.single('file')(req, res, (e) => {
    if (e) return res.status(e.status || (e.code === 'LIMIT_FILE_SIZE' ? 413 : 400)).json({ error: 'upload', message: e.code === 'LIMIT_FILE_SIZE' ? 'Fayl 20 MB dan katta.' : e.message });
    next();
  }), guard(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file', message: 'Fayl tanlanmadi.' });
    let buf;
    try { buf = await fs.promises.readFile(req.file.path); } finally { fs.promises.unlink(req.file.path).catch(() => {}); }
    const r = await importFile(buf, { fileName: req.file.originalname, mimeType: req.file.mimetype, extractFileText });
    if (r.error) return res.status(422).json({ error: r.error, message: IMPORT_ERRORS[r.error] || IMPORT_ERRORS.type });
    const name = String(req.file.originalname || 'Hujjat').replace(/\.(docx|pdf|txt)$/iu, '');
    const out = await store.create(me(req), { title: name, html: r.html, source: 'upload', importNotes: r.notes });
    res.status(201).json({ ...out, notes: r.notes });
  }));

  app.get('/api/editor/docs/:id', requireAuth, guard(async (req, res) => {
    const d = await store.get(req.params.id, me(req));
    d ? res.json(d) : notFound(res);
  }));

  app.put('/api/editor/docs/:id', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const b = req.body || {};
    res.json(await store.save(req.params.id, me(req), { html: typeof b.html === 'string' ? b.html : null, title: typeof b.title === 'string' ? b.title : null, revision: b.revision }));
  }));

  app.delete('/api/editor/docs/:id', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const ok = await store.remove(req.params.id, me(req));
    if (ok) logAudit(req, 'editor.delete', 'editor_document', null);
    ok ? res.json({ ok: true }) : notFound(res);
  }));

  app.get('/api/editor/docs/:id/versions', requireAuth, guard(async (req, res) => {
    const v = await store.versions(req.params.id, me(req));
    v ? res.json({ versions: v }) : notFound(res);
  }));
  app.get('/api/editor/docs/:id/versions/:n', requireAuth, guard(async (req, res) => {
    const html = await store.versionHtml(req.params.id, me(req), req.params.n);
    html != null ? res.json({ html }) : notFound(res);
  }));
  app.post('/api/editor/docs/:id/versions', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const v = await store.nameVersion(req.params.id, me(req), req.body && req.body.label);
    v ? res.status(201).json(v) : notFound(res);
  }));
  app.post('/api/editor/docs/:id/versions/:n/restore', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const r = await store.restore(req.params.id, me(req), req.params.n);
    r ? res.json(r) : notFound(res);
  }));

  app.get('/api/editor/docs/:id/export.docx', requireAuth, guard(async (req, res) => {
    const d = await store.get(req.params.id, me(req));
    if (!d) return notFound(res);
    const { htmlToDocx, DOCX_MIME } = require('../drafting/html-to-docx');
    const buf = await htmlToDocx(d.html, { title: d.title, lang: /[Ѐ-ӿ]/u.test(d.html) && !/[A-Za-z]{4}/u.test(d.html.replace(/<[^>]+>/gu, '')) ? 'ru' : 'uz' });
    const file = `${d.title.replace(/[\\/:*?"<>|]+/gu, ' ').trim().slice(0, 120) || 'hujjat'}.docx`;
    res.set('Content-Type', DOCX_MIME);
    res.set('Content-Disposition', `attachment; filename="hujjat.docx"; filename*=UTF-8''${encodeURIComponent(file)}`);
    res.send(buf);
  }));
}

module.exports = { mountEditorRoutes, IMPORT_ERRORS };
