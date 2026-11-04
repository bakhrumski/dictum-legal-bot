'use strict';

/**
 * Firm documents and their search (K2a, docs/design/firma-bilim-bazasi.md).
 * No AI, no embeddings, no request outside the server.
 *
 *   GET    /api/workspaces/:id/kb                     the Workspace's documents (no text)
 *   POST   /api/workspaces/:id/kb                     { from: { kind: library | editor | workspace_doc, id }, name?, tags? }
 *   DELETE /api/workspaces/:id/kb/:doc                taken out (its chunks deleted)
 *   POST   /api/workspaces/:id/kb/search              { q } -> bands holding the words, with a passage
 *   GET    /api/workspaces/:id/kb/:doc/chunks/:n      one band's whole text
 *
 * Adding copies the text as it stands then (a later change of the source is
 * not followed): a member's own Hujjatlarim document, an editor document the
 * member may read, or a document of this Workspace. The same text twice is
 * 409. The text is split into bands (`splitChunks`: by clause numbers and
 * paragraphs, ~2 000 characters each), every band sealed with the blind index
 * of its word roots beside it.
 *
 * Search hashes the query's roots the same way: bands holding every root
 * first, then - when few - bands holding at least half of them (`partial`).
 * It finds whole word roots in any form (shartnoma / shartnomaga), both Latin
 * alphabets and Cyrillic folded; it does not find part of a word, a phrase in
 * order, a misspelling or a synonym. A Cyrillic band is also indexed in Latin
 * and 4-letter word starts are indexed too. Without DATA_KEYS the text is
 * plain anyway and its roots are kept unhashed (mode `plain-index`).
 *
 * Roles: owner / member add and take out, a viewer searches and reads, anyone
 * else 404 (src/workspace/authz.js, the Workspace active). WS_KB_MAX_DOCS
 * (2 000) documents and WS_KB_MAX_BYTES (2 GB) of text a Workspace.
 * WS_KB=off stops it.
 */

const crypto = require('crypto');
const privacy = require('../privacy/crypto');
const bidx = require('../privacy/blind-index');
const { requireWorkspaceAccess, withWorkspaceTransaction } = require('./authz');

const MAX_DOCS = () => Math.max(1, Number(process.env.WS_KB_MAX_DOCS) || 2000);
const MAX_BYTES = () => Math.max(1, Number(process.env.WS_KB_MAX_BYTES) || 2 * 1024 ** 3);
const MAX_TEXT = 3 * 1024 * 1024; // one document's text
const CHUNK_CHARS = 2000;
const off = () => String(process.env.WS_KB || '').toLowerCase() === 'off';
const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(String(v || ''));
const aad = (ws, doc, n) => `workspace_kb_chunks.text:${ws}:${doc}:${n}`;
function fail(status, message, code) { const e = new Error(message); e.status = status; e.code = code || (status === 404 ? 'not_found' : 'invalid'); return e; }

const CYR = /[\u0400-\u04ff]/u;
const toLatin = t => require('../drafting/doc-layout').cyrToLat(String(t || ''));
/**
 * A band's index: the blind-index tokens of its word roots (5 letters), of
 * their 4-letter starts too (a 4-letter query word "siri" meets "sirini"),
 * and of the same words written in Latin when the band is Cyrillic (a Latin
 * query meets a Cyrillic document). Null without DATA_KEYS.
 */
function indexTokens(text) {
  const t = String(text || '');
  const variants = CYR.test(t) ? [t, toLatin(t)] : [t];
  const out = new Set();
  // without DATA_KEYS the band is plain text anyway: its roots are kept as they are (same search, nothing more shown)
  const tok = v => bidx.tokens(v) || bidx.roots(v).slice(0, 400);
  for (const v of variants) {
    tok(v).forEach(x => out.add(x));
    const four = bidx.roots(v).filter(r => r.length === 5 && !/^\d+$/u.test(r)).map(r => r.slice(0, 4)).join(' ');
    if (four) tok(four).forEach(x => out.add(x));
  }
  return [...out];
}
/** A query's tokens: written in Latin when it is Cyrillic (the index holds both); roots as they are without keys. */
const queryTokens = (q) => {
  const v = CYR.test(q) ? toLatin(q) : q;
  const t = bidx.queryTokens(v);
  if (t) return t;
  const r = bidx.roots(v);
  return r.length ? r : null;
};

const PAGE_MARK = /^\s*(?:\[Sahifa\s+(\d{1,4})\]|===\s*PAGE\s+(\d{1,4})\s*===)\s*$/iu;
const CLAUSE = /^\s*((?:\d{1,3}\.){1,4}\d{0,3}|\d{1,3}[.)])\s+\S/u;

/**
 * A text -> [{ n, label, page, text }]: paragraphs gathered to ~CHUNK_CHARS,
 * a new band where a numbered clause starts once the band is half full; a
 * paragraph longer than the size is cut at sentence ends. Page marks give the
 * page a band starts on and are left out of its text.
 */
function splitChunks(text) {
  const lines = String(text || '').replace(/\r\n?/gu, '\n').split('\n');
  const paras = [];
  let page = null, cur = [];
  const flush = () => { const t = cur.join('\n').trim(); if (t) paras.push({ text: t, page }); cur = []; };
  for (const line of lines) {
    const m = PAGE_MARK.exec(line);
    // a page mark stays in the band's text (search places a hit by it) and is never shown
    if (m) { flush(); page = Number(m[1] || m[2]); paras.push({ text: `=== PAGE ${page} ===`, page, mark: true }); continue; }
    if (!line.trim()) { flush(); continue; }
    if (CLAUSE.test(line) && cur.length) flush();
    cur.push(line);
  }
  flush();
  // a paragraph over the size is cut at sentence ends
  const pieces = [];
  for (const p of paras) {
    if (p.mark || p.text.length <= CHUNK_CHARS * 1.5) { pieces.push(p); continue; }
    let rest = p.text;
    while (rest.length > CHUNK_CHARS * 1.5) {
      const cut = rest.slice(0, CHUNK_CHARS);
      const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '), cut.lastIndexOf('.\n'));
      const at = end > CHUNK_CHARS / 2 ? end + 1 : CHUNK_CHARS;
      pieces.push({ text: rest.slice(0, at).trim(), page: p.page });
      rest = rest.slice(at).trim();
    }
    if (rest) pieces.push({ text: rest, page: p.page });
  }
  const out = [];
  let band = null;
  for (const p of pieces) {
    const opensClause = p.mark ? null : CLAUSE.exec(p.text);
    const startNew = !band || band.text.length + p.text.length > CHUNK_CHARS || (opensClause && band.text.length > CHUNK_CHARS / 2);
    if (startNew) {
      band = { n: out.length + 1, label: opensClause ? opensClause[1].replace(/[.)]$/u, '') : null, page: p.page, text: p.text };
      out.push(band);
    } else band.text += `\n\n${p.text}`;
  }
  return out;
}

const MARK_LINE = /^\s*===\s*PAGE\s+\d{1,4}\s*===\s*$/gimu;
/** A band's text as a person reads it: the page marks left out. */
const shown = text => String(text || '').replace(MARK_LINE, '').replace(/\n{3,}/gu, '\n\n').trim();

/**
 * Where a query's first root stands in a band: { passage, page, label } - the
 * page mark and the numbered clause nearest above the hit (else the band's own).
 */
function locate(text, query, band = {}) {
  const raw = String(text || '');
  const fold = s => String(require('../../public/js/uz-alphabet').fold(s)).toLowerCase();
  // the line holding the most of the query's roots (the first such line), in either alphabet
  const qr = [...new Set(bidx.roots(query).concat(CYR.test(query) ? bidx.roots(toLatin(query)) : []))];
  const latinRoots = r => (CYR.test(r) ? bidx.roots(toLatin(r)) : [r]);
  let best = -1, bestAt = 0, offset = 0;
  for (const line of raw.split('\n')) {
    const words = new Set(bidx.roots(line).concat(CYR.test(line) ? bidx.roots(toLatin(line)) : []).flatMap(w => [w, w.slice(0, 4)]));
    const hits = qr.filter(r => latinRoots(r).some(x => words.has(x))).length;
    if (hits > best && hits > 0) { best = hits; bestAt = offset; }
    offset += line.length + 1;
  }
  const pos = best > 0 ? bestAt : 0;
  // the hit's own line counts: a clause number at its start is the hit's clause
  const lineEnd = raw.indexOf('\n', pos);
  const before = raw.slice(0, lineEnd < 0 ? raw.length : Math.min(lineEnd, pos + 24));
  const pages = [...before.matchAll(/===\s*PAGE\s+(\d{1,4})\s*===/giu)];
  const clauses = [...before.matchAll(/(?:^|\n)\s*((?:\d{1,3}\.){1,4}\d{0,3}|\d{1,3}[.)])\s+\S/gu)];
  return {
    passage: passage(raw, query, raw.slice(pos).replace(MARK_LINE, '').trim().slice(0, 40)),
    // before the first mark of a band that has marks: the page before it (page 1 when the band opens the document)
    page: pages.length ? Number(pages[pages.length - 1][1]) : (band.page || (/===\s*PAGE\s+(\d{1,4})/iu.test(raw) ? Math.max(1, Number(/===\s*PAGE\s+(\d{1,4})/iu.exec(raw)[1]) - 1) : null)),
    label: clauses.length ? clauses[clauses.length - 1][1].replace(/[.)]$/u, '') : (band.label || null),
  };
}

/** The passage of a band around the first query root it holds (~320 characters), page marks left out. */
function passage(text, query, from = null) {
  const t = shown(text);
  const fold = s => String(require('../../public/js/uz-alphabet').fold(s)).toLowerCase();
  const roots = bidx.roots(query);
  const ft = fold(t);
  let at = -1;
  for (const r of roots) {
    const i = ft.search(new RegExp(`(?<![\\p{L}\\p{N}])${r.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'));
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  // fold keeps lengths close but not equal (o' -> o): scale the position back
  let pos = at < 0 ? 0 : Math.round(at * (t.length / Math.max(1, ft.length)));
  // the best line (locate) when given: the passage opens with it; else a little before the hit, at a word's start
  let start;
  const i = from ? t.indexOf(from) : -1;
  if (i >= 0) start = i;
  else {
    start = Math.max(0, pos - 120);
    if (start > 0) { const sp = t.slice(start, start + 30).search(/\s/u); if (sp >= 0) start += sp + 1; }
  }
  let s = t.slice(start, start + 320).replace(/\s+/gu, ' ').trim();
  if (start > 0) s = `… ${s}`;
  if (start + 320 < t.length) s = `${s} …`;
  return s;
}

function createKnowledgeBase({ db }) {
  /** The text of a source the caller may read: { name, text } or a 404. */
  async function sourceText(ws, adminId, from = {}) {
    const kind = from.kind;
    if (kind === 'library') {
      const doc = await require('../ocr/scan-store').getScan(db, { adminId, scanId: from.id });
      if (!doc || !doc.text) throw fail(404, 'Hujjat topilmadi.');
      return { name: doc.name || 'Hujjat', text: doc.text };
    }
    if (kind === 'editor') {
      const row = await require('../editor/access').load(db, from.id, adminId, 'read').catch(() => null);
      if (!row) throw fail(404, 'Hujjat topilmadi.');
      const html = privacy.open(row.html, require('../editor/store').docAad(row.id));
      return { name: row.title || 'Hujjat', text: require('../editor/sanitize').textOf(html) };
    }
    if (kind === 'workspace_doc') {
      if (!isUuid(from.id)) throw fail(404, 'Hujjat topilmadi.');
      const sealing = require('./sealing');
      const r = (await db.query(
        `SELECT d.id, d.title, v.content_text FROM workspace_documents d
           JOIN LATERAL (SELECT content_text FROM workspace_document_versions WHERE workspace_id = d.workspace_id AND document_id = d.id ORDER BY version_number DESC LIMIT 1) v ON true
          WHERE d.workspace_id = $1 AND d.id = $2 AND d.archived_at IS NULL`, [ws, from.id])).rows[0];
      if (!r) throw fail(404, 'Hujjat topilmadi.');
      return { name: r.title || 'Hujjat', text: sealing.openText(r.content_text, sealing.aad.versionText(ws, r.id)) || '' };
    }
    throw fail(400, 'Noma‘lum manba.');
  }

  async function list(ws, adminId) {
    await requireWorkspaceAccess(db, ws, adminId, { minimumRole: 'viewer' });
    const r = await db.query(
      `SELECT d.id, d.name, d.source_kind, d.chars, d.chunks, d.tags, d.created_at, a.full_name AS added_by_name
         FROM workspace_kb_documents d LEFT JOIN admins a ON a.id = d.added_by
        WHERE d.workspace_id = $1 AND d.archived_at IS NULL ORDER BY d.created_at DESC LIMIT 2000`, [ws]);
    const t = (await db.query('SELECT count(*)::int AS n, COALESCE(sum(bytes), 0)::bigint AS bytes FROM workspace_kb_documents WHERE workspace_id = $1 AND archived_at IS NULL', [ws])).rows[0];
    return { documents: r.rows, used: { documents: t.n, bytes: Number(t.bytes) }, max: { documents: MAX_DOCS(), bytes: MAX_BYTES() }, sealed: privacy.enabled() };
  }

  async function add(ws, adminId, body = {}) {
    await requireWorkspaceAccess(db, ws, adminId, { minimumRole: 'member' });
    if (!body.from || !['library', 'editor', 'workspace_doc'].includes(body.from.kind)) throw fail(400, 'Manba kerak: Hujjatlarim, muharrir yoki Workspace hujjati.');
    const src = await sourceText(ws, adminId, body.from);
    const text = String(src.text || '').trim();
    if (text.length < 40) throw fail(422, 'Hujjatda qidiriladigan matn yo‘q (skan bo‘lsa, avval matnini o‘qing).', 'no_text');
    if (text.length > MAX_TEXT) throw fail(413, 'Hujjat matni juda katta (3 MB dan ko‘p).', 'too_large');
    const sha = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    const bytes = Buffer.byteLength(text, 'utf8');
    const chunks = splitChunks(text);
    const name = String(body.name || src.name || 'Hujjat').replace(/\s+/gu, ' ').trim().slice(0, 240) || 'Hujjat';
    const tags = (Array.isArray(body.tags) ? body.tags : []).map(t => String(t || '').replace(/\s+/gu, ' ').trim().slice(0, 40)).filter(Boolean).slice(0, 10);
    return withWorkspaceTransaction(db, adminId, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(74120234, hashtext($1))', [ws]);
      const used = (await client.query('SELECT count(*)::int AS n, COALESCE(sum(bytes), 0)::bigint AS bytes FROM workspace_kb_documents WHERE workspace_id = $1 AND archived_at IS NULL', [ws])).rows[0];
      if (used.n >= MAX_DOCS()) throw fail(409, `Firma bazasida ${MAX_DOCS()} tadan ko‘p hujjat bo‘lmaydi.`, 'too_many');
      if (Number(used.bytes) + bytes > MAX_BYTES()) throw fail(409, 'Firma bazasining hajmi to‘ldi (2 GB).', 'too_large');
      if ((await client.query('SELECT 1 FROM workspace_kb_documents WHERE workspace_id = $1 AND sha256 = $2 AND archived_at IS NULL', [ws, sha])).rows[0]) {
        throw fail(409, 'Bu hujjat firma bazasida allaqachon bor.', 'already_added');
      }
      const id = crypto.randomUUID();
      await client.query(
        `INSERT INTO workspace_kb_documents (id, workspace_id, name, source_kind, source_id, sha256, chars, bytes, chunks, tags, added_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, ws, name, body.from.kind, String(body.from.id), sha, text.length, bytes, chunks.length, tags, adminId]);
      for (const c of chunks) {
        await client.query('INSERT INTO workspace_kb_chunks (document_id, workspace_id, n, label, page, text, bidx) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [id, ws, c.n, c.label, c.page, privacy.seal(c.text, aad(ws, id, c.n)), indexTokens(c.text)]);
      }
      return { id, name, chars: text.length, chunks: chunks.length, tags };
    });
  }

  async function remove(ws, docId, adminId) {
    await requireWorkspaceAccess(db, ws, adminId, { minimumRole: 'member' });
    if (!isUuid(docId)) throw fail(404, 'Topilmadi.');
    return withWorkspaceTransaction(db, adminId, async (client) => {
      const r = await client.query('UPDATE workspace_kb_documents SET archived_at = now() WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL RETURNING id', [docId, ws]);
      if (!r.rows[0]) throw fail(404, 'Topilmadi.');
      await client.query('DELETE FROM workspace_kb_chunks WHERE document_id = $1', [docId]);
      return { removed: true };
    });
  }

  /**
   * { q } -> { results: [{ documentId, name, n, label, page, passage, partial }], words, mode }.
   * At most 3 bands a document, 30 in all.
   */
  async function search(ws, adminId, { q = '', limit = 30 } = {}) {
    await requireWorkspaceAccess(db, ws, adminId, { minimumRole: 'viewer' });
    return searchIn(ws, { q, limit });
  }

  /** The search itself, for a caller that has checked access already (the route above, Workspace AI). */
  async function searchIn(ws, { q = '', limit = 30, withText = false } = {}) {
    const query = String(q || '').trim().slice(0, 200);
    const words = bidx.roots(query);
    if (!words.length) return { results: [], words: 0, mode: 'none' };
    const max = Math.min(50, Math.max(1, Number(limit) || 30));
    const tokens = queryTokens(query);
    let rows;
    let mode;
    const base = `SELECT c.document_id, c.n, c.label, c.page, c.text, d.name, d.created_at
        FROM workspace_kb_chunks c JOIN workspace_kb_documents d ON d.id = c.document_id AND d.archived_at IS NULL
       WHERE c.workspace_id = $1`;
    if (tokens) {
      mode = privacy.enabled() ? 'index' : 'plain-index';
      rows = (await db.query(`${base} AND c.bidx @> $2::text[] ORDER BY d.created_at DESC, c.n LIMIT 400`, [ws, tokens])).rows.map(r => ({ ...r, partial: false }));
      // few whole matches: also the bands holding at least half of the words
      if (rows.length < 5 && tokens.length > 1) {
        const need = Math.ceil(tokens.length / 2);
        const more = (await db.query(
          `${base} AND c.bidx && $2::text[] AND NOT (c.bidx @> $2::text[])
             AND cardinality(ARRAY(SELECT unnest(c.bidx) INTERSECT SELECT unnest($2::text[]))) >= $3
           ORDER BY cardinality(ARRAY(SELECT unnest(c.bidx) INTERSECT SELECT unnest($2::text[]))) DESC, d.created_at DESC LIMIT 200`, [ws, tokens, need])).rows;
        rows = rows.concat(more.map(r => ({ ...r, partial: true })));
      }
    } else {
      // no keys: the text is plain - every word's root, case and alphabet as written
      mode = 'plain';
      rows = (await db.query(`${base} AND c.text ILIKE ALL($2::text[]) ORDER BY d.created_at DESC, c.n LIMIT 400`, [ws, words.map(w => `%${w}%`)])).rows.map(r => ({ ...r, partial: false }));
    }
    const perDoc = new Map();
    const results = [];
    for (const r of rows) {
      const k = perDoc.get(r.document_id) || 0;
      if (k >= 3) continue;
      perDoc.set(r.document_id, k + 1);
      const text = privacy.open(r.text, aad(ws, r.document_id, r.n));
      const where = locate(text, query, r);
      results.push({ documentId: r.document_id, name: r.name, n: r.n, label: where.label, page: where.page, passage: where.passage, partial: r.partial, ...(withText ? { text: shown(text) } : {}) });
      if (results.length >= max) break;
    }
    return { results, words: words.length, mode };
  }

  async function chunk(ws, docId, n, adminId) {
    await requireWorkspaceAccess(db, ws, adminId, { minimumRole: 'viewer' });
    if (!isUuid(docId)) throw fail(404, 'Topilmadi.');
    const r = (await db.query(
      `SELECT c.n, c.label, c.page, c.text, d.name, d.chunks FROM workspace_kb_chunks c JOIN workspace_kb_documents d ON d.id = c.document_id AND d.archived_at IS NULL
        WHERE c.document_id = $1 AND c.workspace_id = $2 AND c.n = $3`, [docId, ws, Number(n) || 0])).rows[0];
    if (!r) throw fail(404, 'Topilmadi.');
    return { documentId: docId, name: r.name, n: r.n, of: r.chunks, label: r.label, page: r.page, text: shown(privacy.open(r.text, aad(ws, docId, r.n))) };
  }

  /**
   * K3: the firm's bands for a Workspace AI question (access checked by the
   * caller): whole matches first, partial ones only when there is no whole
   * one; at most `maxBands`, `maxChars` of text in all. [] on any failure.
   */
  async function forContext(ws, question, { maxBands = 5, maxChars = 8000, switchName = 'WS_KB_AI' } = {}) {
    // WS_KB_AI stops Workspace AI's use, WS_KB_CHAT the web chat's (K4)
    if (off() || String(process.env[switchName] || '').toLowerCase() === 'off') return [];
    try {
      const { results } = await searchIn(ws, { q: question, limit: 20, withText: true });
      const whole = results.filter(r => !r.partial);
      const pick = whole.length ? whole : results;
      const out = [];
      let used = 0;
      for (const r of pick) {
        if (out.length >= maxBands || used >= maxChars) break;
        const text = r.text.length > maxChars - used ? `${r.text.slice(0, Math.max(0, maxChars - used)).replace(/\s+\S*$/u, '')} …` : r.text;
        if (text.length < 40) break;
        out.push({ documentId: r.documentId, name: r.name, n: r.n, label: r.label, page: r.page, text, partial: r.partial });
        used += text.length;
      }
      return out;
    } catch (e) {
      if (!/does not exist/u.test(String(e && e.message))) console.warn('[WS-KB] context:', e.message);
      return [];
    }
  }

  return { list, add, remove, search, searchIn, forContext, chunk };
}

function mountKnowledgeBaseRoutes(app, { db, requireAuth, requireSameOrigin }) {
  const kb = createKnowledgeBase({ db });
  const handle = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (off()) return res.status(503).json({ error: 'unavailable', message: 'WS_KB=off' });
    try { await fn(req, res); } catch (e) {
      if (/does not exist/u.test(String(e && e.message))) return res.status(503).json({ error: 'unavailable', message: 'Jadval hali yaratilmagan (migratsiya 046).' });
      const status = e.status || e.statusCode || 500;
      if (status >= 500) console.warn('[WS-KB]', req.method, req.path, e.message);
      res.status(status).json({ error: e.code || 'failed', message: status >= 500 ? 'Bajarib bo‘lmadi.' : e.message });
    }
  };
  const me = req => req.session.adminId;
  const ws = (req) => { if (!isUuid(req.params.id)) throw fail(404, 'Workspace topilmadi'); return req.params.id; };
  app.get('/api/workspaces/:id/kb', requireAuth, handle(async (req, res) => res.json(await kb.list(ws(req), me(req)))));
  app.post('/api/workspaces/:id/kb', requireSameOrigin, requireAuth, handle(async (req, res) => res.status(201).json(await kb.add(ws(req), me(req), req.body || {}))));
  app.post('/api/workspaces/:id/kb/search', requireSameOrigin, requireAuth, handle(async (req, res) => res.json(await kb.search(ws(req), me(req), req.body || {}))));
  app.delete('/api/workspaces/:id/kb/:doc', requireSameOrigin, requireAuth, handle(async (req, res) => res.json(await kb.remove(ws(req), req.params.doc, me(req)))));
  app.get('/api/workspaces/:id/kb/:doc/chunks/:n', requireAuth, handle(async (req, res) => res.json(await kb.chunk(ws(req), req.params.doc, req.params.n, me(req)))));
  return kb;
}

/** K3: the firm bands as a context block - a firm document is never a law. */
function contextBlock(bands = []) {
  if (!bands.length) return '';
  return bands.map(b => `FIRMA HUJJATI (qonun emas): ${b.name}${b.label ? `, ${b.label}-band` : ''}${b.page ? `, ${b.page}-bet` : ''}\n${b.text}\n\n`).join('');
}
/** K3: the bands as quote-check sources (no lex.uz link, no article numbers - "5-band" is not a law's article). */
function quoteChunks(bands = []) {
  return bands.map(b => ({
    doc_type: 'firm', source_type: 'firm', law_name: `Firma: ${b.name}${b.label ? `, ${b.label}-band` : ''}`, chunk_text: b.text,
    source_url: null, is_active: false, article_numbers: [], firm: { documentId: b.documentId, n: b.n },
  }));
}
/** K3: the prompt rule when the context holds firm documents. */
const FIRM_RULE = "\n\nFIRMA HUJJATLARI: \"FIRMA HUJJATI (qonun emas)\" bloklari - shu firmaning o'z avvalgi hujjatlaridan topilgan bandlar, ular qonun emas va huquqiy asos bo'la olmaydi. Savolga bevosita tegishli bo'lsa, ulardan foydalaning va hujjat nomi hamda bandini ayting (masalan: \"firmangizning «Yetkazib berish shartnomasi» 3.1-bandida ...\"); iqtibos keltirsangiz, harfma-harf ko'chiring. Qonun normasi bilan aralashtirmang: huquqiy asos qonundan keltiriladi. Firma hujjati qonunga zid ko'rinsa, buni ochiq ayting. Tegishli bo'lmasa, ularni tilga olmang.";

module.exports = { mountKnowledgeBaseRoutes, createKnowledgeBase, splitChunks, passage, locate, shown, contextBlock, quoteChunks, FIRM_RULE };
