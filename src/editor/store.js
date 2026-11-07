'use strict';

/**
 * The document editor's storage (D1, migration 036). The HTML is sealed at
 * rest with its place as AAD (a value copied to another document does not
 * open); it is cleaned (src/editor/sanitize.js) before every write. Only the
 * owner reads or writes (sharing is D3); another account's id is "not found".
 *
 * A save names the revision it started from: a stale one is refused with the
 * current revision (409 on the route) - two tabs never overwrite each other
 * unseen. An automatic version is kept at most every AUTO_VERSION_MS; named
 * versions on request; the current text is kept as a version before a restore.
 */

const privacy = require('../privacy/crypto');
const { cleanHtml, textOf } = require('./sanitize');
const access = require('./access');

const ID_RE = /^[0-9a-f-]{36}$/iu;
const MAX_HTML = 2 * 1024 * 1024;
const AUTO_VERSION_MS = 10 * 60 * 1000;
const MAX_AUTO_VERSIONS = 100;
const MAX_DOCS = () => Math.max(1, Number(process.env.EDITOR_MAX_DOCS) || 300);

const docAad = id => `doc_editor_documents.html:${id}`;
const verAad = (docId, n) => `doc_editor_versions.html:${docId}:${n}`;
const yAad = id => `doc_editor_documents.ystate:${id}`;
const title = t => String(t || '').replace(/\s+/gu, ' ').trim().slice(0, 200) || 'Nomsiz hujjat';

function err(status, code, message) { const e = new Error(message || code); e.status = status; e.code = code; return e; }

function createEditorStore({ db }) {
  // D3: the owner or a member, by role (src/editor/access.js); anyone else -> null (404)
  const own = (id, adminId, client = db, lock = false, need = 'read') => access.load(client, id, adminId, need, { lock });
  const opened = row => (row ? { ...row, html: privacy.open(row.html, docAad(row.id)) } : null);

  async function tx(fn) {
    if (!db.connect) return fn(db);
    const c = await db.connect();
    try { await c.query('BEGIN'); const out = await fn(c); await c.query('COMMIT'); return out; }
    catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
    finally { c.release(); }
  }

  /** The account's own documents and the ones shared with it, newest first - no text. */
  async function list(adminId) {
    const r = await db.query(`SELECT d.id, d.title, d.source, d.chars, d.revision, d.created_at, d.updated_at,
        CASE WHEN d.owner_id = $1 THEN 'owner' ELSE m.role END AS role, CASE WHEN d.owner_id = $1 THEN NULL ELSE o.full_name END AS owner_name
        FROM doc_editor_documents d LEFT JOIN doc_editor_members m ON m.document_id = d.id AND m.admin_id = $1
        LEFT JOIN admins o ON o.id = d.owner_id
       WHERE d.owner_id = $1 OR m.admin_id IS NOT NULL ORDER BY d.updated_at DESC LIMIT 500`, [adminId]);
    return r.rows;
  }

  async function create(ownerId, { title: t, html = '', source = 'blank', importNotes = null }) {
    const n = (await db.query('SELECT count(*)::int AS n FROM doc_editor_documents WHERE owner_id = $1', [ownerId])).rows[0].n;
    if (n >= MAX_DOCS()) throw err(409, 'EDITOR_FULL', `Ko'pi bilan ${MAX_DOCS()} ta hujjat. Keraksizini o'chiring.`);
    if (String(html).length > MAX_HTML) throw err(413, 'TOO_LARGE', 'Hujjat juda katta (2 MB dan ortiq).');
    const clean = cleanHtml(html);
    return tx(async (c) => {
      const row = (await c.query(`INSERT INTO doc_editor_documents (owner_id, title, source, html, chars, import_notes) VALUES ($1, $2, $3, '', $4, $5) RETURNING id`,
        [ownerId, title(t), source, textOf(clean).length, importNotes ? JSON.stringify(importNotes) : null])).rows[0];
      await c.query('UPDATE doc_editor_documents SET html = $2 WHERE id = $1', [row.id, privacy.seal(clean, docAad(row.id))]);
      return { id: row.id };
    });
  }

  async function get(id, ownerId) {
    const row = opened(await own(id, ownerId));
    if (!row) return null;
    return { id: row.id, title: row.title, source: row.source, html: row.html, chars: row.chars, revision: row.revision,
      importNotes: row.import_notes || null, createdAt: row.created_at, updatedAt: row.updated_at, role: row.my_role, ownerId: row.owner_id };
  }

  async function addVersion(c, docId, html, { kind, label = null, by = null }) {
    const n = (await c.query('SELECT COALESCE(max(number), 0) + 1 AS n FROM doc_editor_versions WHERE document_id = $1', [docId])).rows[0].n;
    await c.query(`INSERT INTO doc_editor_versions (document_id, number, kind, label, html, chars, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [docId, n, kind, label ? String(label).slice(0, 120) : null, privacy.seal(html, verAad(docId, n)), textOf(html).length, by]);
    // the oldest automatic versions go; named ones and the ones kept before a restore stay
    await c.query(`DELETE FROM doc_editor_versions WHERE document_id = $1 AND kind = 'auto' AND number NOT IN
      (SELECT number FROM doc_editor_versions WHERE document_id = $1 AND kind = 'auto' ORDER BY number DESC LIMIT ${MAX_AUTO_VERSIONS})`, [docId]);
    return n;
  }

  /**
   * Save: { html?, title?, revision } -> { revision, savedAt, version? }; a stale revision -> 409 with the current one.
   * live (D3): the snapshot of a live session (src/editor/live.js keeps the true text in Yjs) - any editor in
   * the session sends it, so the revision is not compared; it still moves on, so a tab outside the session gets 409.
   */
  async function save(id, ownerId, { html, title: t, revision, live = false }, now = Date.now()) {
    if (html != null && String(html).length > MAX_HTML) throw err(413, 'TOO_LARGE', 'Hujjat juda katta (2 MB dan ortiq).');
    return tx(async (c) => {
      const row = await own(id, ownerId, c, true, 'write');
      if (!row) throw err(404, 'NOT_FOUND');
      if (!live && Number(revision) !== row.revision) throw Object.assign(err(409, 'STALE', "Hujjat boshqa oynada o'zgartirilgan."), { revision: row.revision });
      const next = row.revision + 1;
      const sets = ['revision = $3', 'updated_at = now()'];
      // a save outside a live session makes the stored html the truth: the live state starts from it next time
      if (!live && html != null) sets.push('ystate = NULL');
      const args = [id, ownerId, next];
      let version = null;
      if (html != null) {
        const clean = cleanHtml(html);
        args.push(privacy.seal(clean, docAad(id)), textOf(clean).length);
        sets.push(`html = $${args.length - 1}`, `chars = $${args.length}`);
        const last = (await c.query('SELECT created_at FROM doc_editor_versions WHERE document_id = $1 ORDER BY number DESC LIMIT 1', [id])).rows[0];
        if (!last || now - new Date(last.created_at).getTime() >= AUTO_VERSION_MS) version = await addVersion(c, id, clean, { kind: 'auto', by: ownerId });
      }
      if (t != null) { args.push(title(t)); sets.push(`title = $${args.length}`); }
      const out = (await c.query(`UPDATE doc_editor_documents SET ${sets.join(', ')} WHERE id = $1 AND $2::int IS NOT NULL RETURNING revision, updated_at`, args)).rows[0];
      return { revision: out.revision, savedAt: out.updated_at, version };
    });
  }

  async function versions(id, ownerId) {
    if (!(await own(id, ownerId))) return null;
    return (await db.query(`SELECT number, kind, label, chars, created_at FROM doc_editor_versions WHERE document_id = $1 ORDER BY number DESC LIMIT 200`, [id])).rows;
  }

  async function versionHtml(id, ownerId, number) {
    if (!(await own(id, ownerId))) return null;
    const v = (await db.query('SELECT number, html FROM doc_editor_versions WHERE document_id = $1 AND number = $2', [id, Number(number) || 0])).rows[0];
    return v ? privacy.open(v.html, verAad(id, v.number)) : null;
  }

  async function nameVersion(id, ownerId, label) {
    return tx(async (c) => {
      const row = opened(await own(id, ownerId, c, true, 'write'));
      if (!row) return null;
      return { number: await addVersion(c, id, row.html, { kind: 'named', label: String(label || '').trim() || null, by: ownerId }) };
    });
  }

  /** Restore a version: the current text is kept as a version first; the revision moves on. */
  async function restore(id, ownerId, number) {
    return tx(async (c) => {
      const row = opened(await own(id, ownerId, c, true, 'write'));
      if (!row) return null;
      const v = (await c.query('SELECT number, html FROM doc_editor_versions WHERE document_id = $1 AND number = $2', [id, Number(number) || 0])).rows[0];
      if (!v) return null;
      const html = privacy.open(v.html, verAad(id, v.number));
      await addVersion(c, id, row.html, { kind: 'restore', label: `${v.number}-versiyani tiklashdan oldin`, by: ownerId });
      // the live state is dropped: the next live session starts from the restored text (src/editor/live.js)
      const out = (await c.query(`UPDATE doc_editor_documents SET html = $2, chars = $3, ystate = NULL, revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING revision`,
        [id, privacy.seal(html, docAad(id)), textOf(html).length])).rows[0];
      return { revision: out.revision, html };
    });
  }

  async function remove(id, ownerId) {
    if (!ID_RE.test(String(id || ''))) return false;
    return (await db.query('DELETE FROM doc_editor_documents WHERE id = $1 AND owner_id = $2', [id, ownerId])).rowCount > 0;
  }

  /** D3: the live document's Yjs state (sealed, AAD by document); null = start from html. */
  async function liveState(id) {
    const r = (await db.query('SELECT ystate FROM doc_editor_documents WHERE id = $1', [id])).rows[0];
    return r && r.ystate ? privacy.openBytes(r.ystate, yAad(id)) : null;
  }
  async function saveLiveState(id, bytes) {
    await db.query('UPDATE doc_editor_documents SET ystate = $2 WHERE id = $1', [id, privacy.sealBytes(Buffer.from(bytes), yAad(id))]);
  }

  return { list, create, get, save, versions, versionHtml, nameVersion, restore, remove, liveState, saveLiveState };
}

/** Account deletion (src/services/account-deletion.js): the person's documents and their versions go. */
async function deleteAccountDocuments(db, ownerId) {
  await db.query('DELETE FROM doc_editor_documents WHERE owner_id = $1', [ownerId]);
  // and the person leaves the documents others shared with them (their comments stay, their name goes with the account's)
  await db.query('DELETE FROM doc_editor_members WHERE admin_id = $1', [ownerId]);
}

module.exports = { createEditorStore, deleteAccountDocuments, MAX_HTML, AUTO_VERSION_MS, docAad, verAad };
