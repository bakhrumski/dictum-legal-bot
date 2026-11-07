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
 *   GET    /api/editor/docs/:id/export.docx         a real .docx (src/drafting/html-to-docx.js), open comments as Word comments
 *   GET    /api/editor/docs/:id/comments            threads (D2, src/editor/comments.js)
 *   POST   /api/editor/docs/:id/comments { body, quote, parentId }  -> { id } (the page marks the words with it)
 *   PATCH  /api/editor/docs/:id/comments/:cid { body?, resolved? }
 *   DELETE /api/editor/docs/:id/comments/:cid
 *   D3: GET/PATCH/DELETE .../members[/:aid], GET/POST/DELETE .../invites[/:iid] (owner),
 *       GET /api/editor/invites/:token (what the link offers), POST .../accept (join); live: src/editor/live.js
 */

const os = require('os');
const fs = require('fs');
const multer = require('multer');
const { createEditorStore } = require('./store');
const { createCommentStore } = require('./comments');
const { createSharing } = require('./sharing');
const live = require('./live');
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
  const comments = createCommentStore({ db: pool });
  const sharing = createSharing({ db: pool });
  const hub = () => live.getHub(); // D3: the live sessions (null when EDITOR_LIVE=off)
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
    // the file's own Word comments come with it, under their Word authors' names
    if (r.comments && r.comments.length) await comments.importMany(out.id, me(req), r.comments);
    res.status(201).json({ ...out, notes: r.notes, comments: (r.comments || []).length });
  }));

  app.get('/api/editor/docs/:id', requireAuth, guard(async (req, res) => {
    const d = await store.get(req.params.id, me(req));
    d ? res.json(d) : notFound(res);
  }));

  app.put('/api/editor/docs/:id', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const b = req.body || {};
    // a live snapshot is taken only from an account with an open editor socket on this document (src/editor/live.js)
    const isLive = b.live === true && !!hub() && hub().isLiveEditor(req.params.id, me(req));
    if (b.live === true && !isLive) return res.status(409).json({ error: 'NOT_LIVE', message: "Jonli aloqa uzildi — sahifani yangilang." });
    const out = await store.save(req.params.id, me(req), { html: typeof b.html === 'string' ? b.html : null, title: typeof b.title === 'string' ? b.title : null, revision: b.revision, live: isLive });
    // a one-person save while others are live: they reload from it (no hidden overwrite either way)
    if (!isLive && typeof b.html === 'string' && hub() && hub().people(req.params.id)) await hub().close(req.params.id, { code: 4000 });
    if (typeof b.title === 'string' && hub()) hub().broadcast(req.params.id, { type: 'title', title: String(b.title).slice(0, 200) });
    res.json(out);
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
    // everyone live reloads from the restored text
    if (r && hub()) await hub().close(req.params.id, { code: 4000 });
    r ? res.json(r) : notFound(res);
  }));

  app.get('/api/editor/docs/:id/comments', requireAuth, guard(async (req, res) => {
    const list = await comments.list(req.params.id, me(req));
    list ? res.json({ threads: list }) : notFound(res);
  }));
  app.post('/api/editor/docs/:id/comments', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const b = req.body || {};
    const out = await comments.add(req.params.id, me(req), { body: b.body, quote: b.quote, parentId: b.parentId || null });
    if (hub()) hub().broadcast(req.params.id, { type: 'comments' });
    res.status(201).json(out);
  }));
  app.patch('/api/editor/docs/:id/comments/:cid', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const b = req.body || {};
    const out = await comments.update(req.params.id, me(req), req.params.cid, { body: typeof b.body === 'string' ? b.body : null, resolved: typeof b.resolved === 'boolean' ? b.resolved : null });
    if (hub()) hub().broadcast(req.params.id, { type: 'comments' });
    res.json(out);
  }));
  app.delete('/api/editor/docs/:id/comments/:cid', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const ok = await comments.remove(req.params.id, me(req), req.params.cid);
    if (ok && hub()) hub().broadcast(req.params.id, { type: 'comments' });
    ok ? res.json({ ok: true }) : notFound(res);
  }));

  /* ---------- D3: sharing (src/editor/sharing.js) ---------- */
  app.get('/api/editor/docs/:id/members', requireAuth, guard(async (req, res) => { res.json({ members: await sharing.members(req.params.id, me(req)) }); }));
  app.patch('/api/editor/docs/:id/members/:aid', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const ok = await sharing.setRole(req.params.id, me(req), Number(req.params.aid), req.body && req.body.role);
    if (ok && hub()) await hub().close(req.params.id, { adminId: Number(req.params.aid), code: 4003 }); // they reconnect with the new role
    ok ? res.json({ ok: true }) : notFound(res);
  }));
  app.delete('/api/editor/docs/:id/members/:aid', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const ok = await sharing.removeMember(req.params.id, me(req), Number(req.params.aid));
    if (ok && hub()) await hub().close(req.params.id, { adminId: Number(req.params.aid), code: 4003 });
    ok ? res.json({ ok: true }) : notFound(res);
  }));
  app.get('/api/editor/docs/:id/invites', requireAuth, guard(async (req, res) => { res.json({ invites: await sharing.invites(req.params.id, me(req)) }); }));
  app.post('/api/editor/docs/:id/invites', requireSameOrigin, requireAuth, guard(async (req, res) => {
    // the link is shown once; only its sha256 is kept
    res.status(201).json(await sharing.createInvite(req.params.id, me(req), { role: req.body && req.body.role }));
  }));
  app.delete('/api/editor/docs/:id/invites/:iid', requireSameOrigin, requireAuth, guard(async (req, res) => {
    (await sharing.revokeInvite(req.params.id, me(req), req.params.iid)) ? res.json({ ok: true }) : notFound(res);
  }));
  app.get('/api/editor/invites/:token', requireAuth, guard(async (req, res) => {
    const p = await sharing.preview(req.params.token, me(req));
    p ? res.json(p) : res.status(410).json({ error: 'INVITE_GONE', message: "Havola eskirgan yoki bekor qilingan. Hujjat egasidan yangisini so'rang." });
  }));
  app.post('/api/editor/invites/:token/accept', requireSameOrigin, requireAuth, guard(async (req, res) => {
    res.json(await sharing.accept(req.params.token, me(req)));
  }));

  app.get('/api/editor/docs/:id/export.docx', requireAuth, guard(async (req, res) => {
    const d = await store.get(req.params.id, me(req));
    if (!d) return notFound(res);
    const { htmlToDocx, DOCX_MIME } = require('../drafting/html-to-docx');
    const open = await comments.forExport(d.id, me(req));
    // U5a: page numbers in the footer
    const buf = await htmlToDocx(d.html, { title: d.title, comments: open, pageNumbers: true, lang: /[Ѐ-ӿ]/u.test(d.html) && !/[A-Za-z]{4}/u.test(d.html.replace(/<[^>]+>/gu, '')) ? 'ru' : 'uz' });
    const file = `${d.title.replace(/[\\/:*?"<>|]+/gu, ' ').trim().slice(0, 120) || 'hujjat'}.docx`;
    res.set('Content-Type', DOCX_MIME);
    res.set('Content-Disposition', `attachment; filename="hujjat.docx"; filename*=UTF-8''${encodeURIComponent(file)}`);
    res.send(buf);
  }));
}

module.exports = { mountEditorRoutes, IMPORT_ERRORS };
