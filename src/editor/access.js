'use strict';

/**
 * Who may do what with an editor document (D3, migration 038). The owner
 * does everything; a member has the role the link gave (or the owner set):
 *   editor    - reads, writes the text, comments, resolves, names / restores versions
 *   commenter - reads and comments (anchored by its words, not by a mark in the text)
 *   viewer    - reads only
 * Anyone else gets "not found" (404) - a document's existence is not told.
 * A member who may read but not do this gets 403.
 */

const ID_RE = /^[0-9a-f-]{36}$/iu;
const ROLES = ['viewer', 'commenter', 'editor', 'owner'];
const NEEDS = { read: 'viewer', comment: 'commenter', resolve: 'editor', write: 'editor', manage: 'owner' };

const can = (role, need) => ROLES.indexOf(role) >= ROLES.indexOf(NEEDS[need] || need);

function err(status, code, message) { const e = new Error(message || code); e.status = status; e.code = code; return e; }

/**
 * The document row with `my_role` for this account, or null. `need` (read /
 * comment / resolve / write / manage) throws 403 when the account may read
 * but not do that. `lock` takes the row FOR UPDATE inside a transaction.
 */
async function load(client, id, adminId, need = 'read', { lock = false } = {}) {
  if (!ID_RE.test(String(id || '')) || !adminId) return null;
  const r = await client.query(`SELECT d.*, CASE WHEN d.owner_id = $2 THEN 'owner' ELSE m.role END AS my_role
      FROM doc_editor_documents d LEFT JOIN doc_editor_members m ON m.document_id = d.id AND m.admin_id = $2
     WHERE d.id = $1 AND (d.owner_id = $2 OR m.admin_id IS NOT NULL)${lock ? ' FOR UPDATE OF d' : ''}`, [id, adminId]);
  const row = r.rows[0];
  if (!row) return null;
  if (!can(row.my_role, need)) throw err(403, 'FORBIDDEN', "Bu hujjatda bunga ruxsatingiz yo'q.");
  return row;
}

module.exports = { load, can, ROLES, NEEDS, ID_RE };
