'use strict';

/**
 * Sharing an editor document (D3, migration 038; owner 2026-10-30: any
 * platform user by link, every plan). The owner makes a link with a role
 * (editor / commenter / viewer, commenter by default); only its sha256 is
 * kept and the link is shown once; it lasts 7 days (EDITOR_INVITE_DAYS) and
 * can be revoked. A signed-in account that opens it sees the document's
 * title, the owner's name and the role, and joins only by pressing the
 * button. Joining twice keeps the higher role; the owner can change a
 * member's role or remove them; a member can leave. 50 members a document.
 */

const crypto = require('crypto');
const access = require('./access');

const ROLES = ['editor', 'commenter', 'viewer'];
const MAX_MEMBERS = 50;
const DAYS = () => Math.min(30, Math.max(1, Number(process.env.EDITOR_INVITE_DAYS) || 7));
const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const TOKEN_RE = /^[A-Za-z0-9_-]{30,60}$/u;

function err(status, code, message) { const e = new Error(message || code); e.status = status; e.code = code; return e; }

function createSharing({ db }) {
  async function createInvite(docId, ownerId, { role = 'commenter' } = {}) {
    if (!(await access.load(db, docId, ownerId, 'manage'))) throw err(404, 'NOT_FOUND');
    const r = ROLES.includes(role) ? role : 'commenter';
    const token = crypto.randomBytes(24).toString('base64url');
    const row = (await db.query(`INSERT INTO doc_editor_invites (document_id, token_hash, role, created_by, expires_at)
      VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval) RETURNING id, role, expires_at`, [docId, hash(token), r, ownerId, String(DAYS())])).rows[0];
    return { id: row.id, role: row.role, expiresAt: row.expires_at, token };
  }

  async function invites(docId, ownerId) {
    if (!(await access.load(db, docId, ownerId, 'manage'))) throw err(404, 'NOT_FOUND');
    return (await db.query(`SELECT id, role, created_at, expires_at, joined FROM doc_editor_invites
      WHERE document_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`, [docId])).rows;
  }

  async function revokeInvite(docId, ownerId, inviteId) {
    if (!(await access.load(db, docId, ownerId, 'manage'))) throw err(404, 'NOT_FOUND');
    return (await db.query('UPDATE doc_editor_invites SET revoked_at = now() WHERE id = $1 AND document_id = $2 AND revoked_at IS NULL', [inviteId, docId])).rowCount > 0;
  }

  async function findInvite(token, client = db) {
    if (!TOKEN_RE.test(String(token || ''))) return null;
    return (await client.query(`SELECT i.*, d.title, d.owner_id, o.full_name AS owner_name FROM doc_editor_invites i
      JOIN doc_editor_documents d ON d.id = i.document_id LEFT JOIN admins o ON o.id = d.owner_id
      WHERE i.token_hash = $1 AND i.revoked_at IS NULL AND i.expires_at > now()`, [hash(token)])).rows[0] || null;
  }

  /** What the link offers, for the page before joining: { title, ownerName, role, already }. */
  async function preview(token, adminId) {
    const i = await findInvite(token);
    if (!i) return null;
    const mine = await access.load(db, i.document_id, adminId, 'read');
    return { documentId: i.document_id, title: i.title, ownerName: i.owner_name || null, role: i.role, already: mine ? mine.my_role : null };
  }

  /** Join by the link: { documentId, role }. The owner stays owner; a member keeps the higher role. */
  async function accept(token, adminId) {
    const i = await findInvite(token);
    if (!i) throw err(410, 'INVITE_GONE', "Havola eskirgan yoki bekor qilingan. Hujjat egasidan yangisini so'rang.");
    if (i.owner_id === Number(adminId)) return { documentId: i.document_id, role: 'owner' };
    const n = (await db.query('SELECT count(*)::int AS n FROM doc_editor_members WHERE document_id = $1', [i.document_id])).rows[0].n;
    const cur = (await db.query('SELECT role FROM doc_editor_members WHERE document_id = $1 AND admin_id = $2', [i.document_id, adminId])).rows[0];
    if (!cur && n >= MAX_MEMBERS) throw err(409, 'TOO_MANY', `Bitta hujjatda ko'pi bilan ${MAX_MEMBERS} kishi.`);
    const role = cur && access.ROLES.indexOf(cur.role) > access.ROLES.indexOf(i.role) ? cur.role : i.role;
    await db.query(`INSERT INTO doc_editor_members (document_id, admin_id, role, invite_id) VALUES ($1, $2, $3, $4)
      ON CONFLICT (document_id, admin_id) DO UPDATE SET role = EXCLUDED.role`, [i.document_id, adminId, role, i.id]);
    if (!cur) await db.query('UPDATE doc_editor_invites SET joined = joined + 1 WHERE id = $1', [i.id]);
    return { documentId: i.document_id, role };
  }

  /** The people on a document (every member sees who is there): owner first. */
  async function members(docId, adminId) {
    const doc = await access.load(db, docId, adminId, 'read');
    if (!doc) throw err(404, 'NOT_FOUND');
    const rows = (await db.query(`SELECT a.id, a.full_name, m.role, m.added_at FROM doc_editor_members m JOIN admins a ON a.id = m.admin_id
      WHERE m.document_id = $1 ORDER BY m.added_at`, [docId])).rows;
    const owner = (await db.query('SELECT id, full_name FROM admins WHERE id = $1', [doc.owner_id])).rows[0] || { id: doc.owner_id, full_name: null };
    return [{ id: owner.id, name: owner.full_name, role: 'owner' }, ...rows.map(r => ({ id: r.id, name: r.full_name, role: r.role, addedAt: r.added_at }))];
  }

  async function setRole(docId, ownerId, memberId, role) {
    if (!ROLES.includes(role)) throw err(400, 'ROLE');
    if (!(await access.load(db, docId, ownerId, 'manage'))) throw err(404, 'NOT_FOUND');
    return (await db.query('UPDATE doc_editor_members SET role = $3 WHERE document_id = $1 AND admin_id = $2', [docId, memberId, role])).rowCount > 0;
  }

  /** The owner removes a member, or a member leaves. */
  async function removeMember(docId, adminId, memberId) {
    const doc = await access.load(db, docId, adminId, 'read');
    if (!doc) throw err(404, 'NOT_FOUND');
    if (doc.my_role !== 'owner' && Number(memberId) !== Number(adminId)) throw err(403, 'FORBIDDEN');
    return (await db.query('DELETE FROM doc_editor_members WHERE document_id = $1 AND admin_id = $2', [docId, memberId])).rowCount > 0;
  }

  return { createInvite, invites, revokeInvite, preview, accept, members, setRole, removeMember };
}

module.exports = { createSharing, ROLES, MAX_MEMBERS, hash };
