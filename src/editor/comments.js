'use strict';

/**
 * Comments on an editor document (D2, migration 037). A comment's anchor is
 * the <span data-comment="<id>"> the editor puts around the commented words
 * in the document itself; this store keeps the comment: author (an account,
 * or the name an imported Word comment carried), text and the words it was
 * made on (both sealed, AAD by the comment), replies (parent_id, one level)
 * and resolution. Until sharing (D3) only the document's owner reads and
 * writes them; another account is "not found". An imported comment is
 * written once, as the owner, with the Word author's name kept apart.
 */

const crypto = require('crypto');
const privacy = require('../privacy/crypto');
const access = require('./access');

const ID_RE = /^[0-9a-f-]{36}$/iu;
const MAX_BODY = 4000;
const MAX_QUOTE = 500;
const MAX_PER_DOC = 500;

const aad = (id, col) => `doc_editor_comments.${col}:${id}`;
const tidy = (s, n) => String(s || '').replace(/\r\n?/gu, '\n').trim().slice(0, n);
function err(status, code, message) { const e = new Error(message || code); e.status = status; e.code = code; return e; }

function createCommentStore({ db }) {
  // D3: by role (src/editor/access.js): read to list, comment to add, resolve to resolve; null -> 404, too low -> 403
  async function ownDoc(docId, adminId, need = 'read') { return !!(await access.load(db, docId, adminId, need)); }
  function shape(r) {
    return {
      id: r.id, parentId: r.parent_id, author: r.author_name || r.full_name || null, authorId: r.author_id, source: r.source,
      body: privacy.open(r.body, aad(r.id, 'body')), quote: r.quote ? privacy.open(r.quote, aad(r.id, 'quote')) : null,
      resolved: !!r.resolved_at, resolvedAt: r.resolved_at, createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  /** Threads, oldest first: [{ ...comment, replies: [...] }]. null when the document is not the caller's. */
  async function list(docId, ownerId) {
    if (!(await ownDoc(docId, ownerId))) return null;
    const rows = (await db.query(`SELECT c.*, a.full_name FROM doc_editor_comments c LEFT JOIN admins a ON a.id = c.author_id
      WHERE c.document_id = $1 ORDER BY c.created_at, c.id`, [docId])).rows.map(shape);
    const top = rows.filter(r => !r.parentId).map(r => ({ ...r, replies: [] }));
    const byId = new Map(top.map(t => [t.id, t]));
    for (const r of rows) if (r.parentId && byId.has(r.parentId)) byId.get(r.parentId).replies.push(r);
    return top;
  }

  async function insert(c, docId, { id = crypto.randomUUID(), parentId = null, authorId, authorName = null, source = 'app', body, quote = null, resolved = false, createdAt = null }) {
    await c.query(`INSERT INTO doc_editor_comments (id, document_id, parent_id, author_id, author_name, source, body, quote, resolved_at, resolved_by, created_at, updated_at)
      VALUES ($1, $2, $3, $4::int, $5, $6, $7, $8, CASE WHEN $9::boolean THEN now() END, CASE WHEN $9::boolean THEN $4::int END, COALESCE($10::timestamptz, now()), COALESCE($10::timestamptz, now()))`,
    [id, docId, parentId, authorId, authorName ? tidy(authorName, 120) : null, source, privacy.seal(body, aad(id, 'body')),
      quote ? privacy.seal(quote, aad(id, 'quote')) : null, !!resolved, createdAt]);
    return id;
  }

  /** A new comment (or a reply with parentId) -> { id }. The page then marks the words with that id. */
  async function add(docId, ownerId, { body, quote = null, parentId = null }) {
    if (!(await ownDoc(docId, ownerId, 'comment'))) throw err(404, 'NOT_FOUND');
    const b = tidy(body, MAX_BODY);
    if (!b) throw err(400, 'EMPTY', "Izoh bo'sh.");
    const n = (await db.query('SELECT count(*)::int AS n FROM doc_editor_comments WHERE document_id = $1', [docId])).rows[0].n;
    if (n >= MAX_PER_DOC) throw err(409, 'TOO_MANY', `Bitta hujjatda ko'pi bilan ${MAX_PER_DOC} ta izoh.`);
    if (parentId) {
      const p = (await db.query('SELECT parent_id FROM doc_editor_comments WHERE id = $1 AND document_id = $2', [parentId, docId])).rows[0];
      if (!p) throw err(404, 'NOT_FOUND');
      if (p.parent_id) parentId = p.parent_id; // replies stay one level deep
    }
    return { id: await insert(db, docId, { parentId, authorId: ownerId, body: b, quote: parentId ? null : tidy(quote, MAX_QUOTE) || null }) };
  }

  /** Edit the text (the author's own comment only), or resolve / reopen a thread. */
  async function update(docId, ownerId, id, { body, resolved }) {
    if (!(await ownDoc(docId, ownerId)) || !ID_RE.test(String(id || ''))) throw err(404, 'NOT_FOUND');
    const row = (await db.query('SELECT id, parent_id, author_id FROM doc_editor_comments WHERE id = $1 AND document_id = $2', [id, docId])).rows[0];
    if (!row) throw err(404, 'NOT_FOUND');
    if (body != null) {
      if (row.author_id !== Number(ownerId)) throw err(403, 'NOT_AUTHOR', "Faqat o'z izohingizni tahrirlaysiz.");
      const b = tidy(body, MAX_BODY);
      if (!b) throw err(400, 'EMPTY', "Izoh bo'sh.");
      await db.query('UPDATE doc_editor_comments SET body = $2, updated_at = now() WHERE id = $1', [id, privacy.seal(b, aad(id, 'body'))]);
    }
    if (resolved != null) {
      if (row.parent_id) throw err(400, 'REPLY', 'Javob emas, izohning o‘zi hal qilinadi.');
      await ownDoc(docId, ownerId, 'resolve');
      await db.query(`UPDATE doc_editor_comments SET resolved_at = CASE WHEN $2 THEN now() END, resolved_by = CASE WHEN $2 THEN $3::int END, updated_at = now() WHERE id = $1`,
        [id, !!resolved, ownerId]);
    }
    return { ok: true };
  }

  /** Delete a comment (a thread goes with its replies). The page removes its anchor from the text. */
  async function remove(docId, ownerId, id) {
    const doc = await access.load(db, docId, ownerId, 'read');
    if (!doc || !ID_RE.test(String(id || ''))) return false;
    // the author removes their own; the owner removes any
    const row = (await db.query('SELECT author_id, source FROM doc_editor_comments WHERE id = $1 AND document_id = $2', [id, docId])).rows[0];
    if (!row) return false;
    if (doc.my_role !== 'owner' && !(row.author_id === Number(ownerId) && row.source !== 'word')) throw err(403, 'NOT_AUTHOR', "Faqat o'z izohingizni o'chirasiz.");
    return (await db.query('DELETE FROM doc_editor_comments WHERE id = $1 AND document_id = $2', [id, docId])).rowCount > 0;
  }

  /** Comments read from a Word file at import: [{ id, author, date, text, quote, resolved, parentId }], written as the owner. */
  async function importMany(docId, ownerId, comments) {
    for (const c of (comments || []).slice(0, MAX_PER_DOC)) {
      const body = tidy(c.text, MAX_BODY);
      if (!body || !ID_RE.test(String(c.id || ''))) continue;
      const created = c.date && !Number.isNaN(new Date(c.date).getTime()) ? new Date(c.date) : null;
      await insert(db, docId, { id: c.id, parentId: c.parentId || null, authorId: ownerId, authorName: c.author || null, source: 'word',
        body, quote: tidy(c.quote, MAX_QUOTE) || null, resolved: !!c.resolved, createdAt: created });
    }
  }

  /** Open threads for the Word export: [{ id, author, date, text }] (a thread's replies follow its text). */
  async function forExport(docId, ownerId) {
    const threads = await list(docId, ownerId);
    if (!threads) return [];
    return threads.filter(t => !t.resolved).map(t => ({
      id: t.id, author: t.author || 'JuristAI', date: t.createdAt,
      text: [t.body, ...t.replies.map(r => `— ${r.author || 'JuristAI'}: ${r.body}`)].join('\n'),
    }));
  }

  return { list, add, update, remove, importMany, forExport };
}

module.exports = { createCommentStore, MAX_BODY, MAX_PER_DOC };
