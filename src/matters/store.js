'use strict';

/**
 * Matters (2026-10-28, docs/design/matter-va-agent-runs.md, section 2): one
 * legal matter of one account and the links to what was done for it. No AI
 * call, no tariff unit.
 *
 * Access. A matter is its owner's. When it is attached to a Workspace, that
 * Workspace's members reach it through their membership: owner and member
 * write, viewer reads. Anyone else gets `null` - the route answers 404, so
 * another person's matter cannot even be told to exist.
 *
 * Links. An item points at its source (a chat, a scan, from PR-B an agent
 * run); the source is checked to be the caller's own when it is added, and
 * every read shows a source that is gone or no longer the owner's as
 * missing rather than failing.
 *
 * Scans. A scan is kept 7 days (document_scans.expires_at). Added to a
 * matter it is held while any open matter holds it (`SCAN_HELD`); when the
 * last such matter is closed or deleted, or the item removed, it gets
 * `SCAN_AFTER_CLOSE_DAYS` more (owner, 2026-10-28: "ish yopilguncha va yana
 * 30 kun").
 *
 * Limits: an account on a paid plan (or a test entitlement, or staff) keeps
 * `MATTER_MAX_OPEN` open matters, a Sinov or unknown one 1; a matter holds
 * `MATTER_MAX_ITEMS` items.
 */

const MAX_OPEN = Math.max(1, Number(process.env.MATTER_MAX_OPEN) || 200);
const MAX_OPEN_TRIAL = 1;
const MAX_ITEMS = Math.max(1, Number(process.env.MATTER_MAX_ITEMS) || 500);
const SCAN_HELD = "interval '10 years'";
const SCAN_AFTER_CLOSE_DAYS = 30;
const KINDS = Object.freeze(['chat', 'scan', 'agent_run', 'note']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

class MatterError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/gu, ' ').trim().slice(0, max);
const isUuid = v => typeof v === 'string' && UUID.test(v);

/** 'write' | 'read' | null for this account on this matter row. */
async function accessOf(db, row, adminId) {
  if (!row || row.deleted_at) return null;
  if (Number(row.owner_id) === Number(adminId)) return 'write';
  if (!row.workspace_id) return null;
  const m = await db.query(
    `SELECT wm.role FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.workspace_id = $1 AND wm.user_id = $2 AND w.deleted_at IS NULL`, [row.workspace_id, adminId]);
  const role = m.rows[0] && m.rows[0].role;
  if (role === 'owner' || role === 'member') return 'write';
  if (role === 'viewer') return 'read';
  return null;
}

function createMatterStore({ db, resolveEntitlement = null }) {
  if (!db) throw new Error('db is required');

  async function openLimit(adminId) {
    if (!resolveEntitlement) return MAX_OPEN;
    try {
      const ent = await resolveEntitlement(db, { adminId }, { createTrial: false });
      return ['paid', 'test', 'staff', 'legacy'].includes(ent && ent.kind) ? MAX_OPEN : MAX_OPEN_TRIAL;
    } catch (_) {
      return MAX_OPEN_TRIAL;
    }
  }

  async function load(id, adminId, need = 'read') {
    if (!isUuid(id)) return null;
    const r = await db.query('SELECT * FROM matters WHERE id = $1', [id]);
    const row = r.rows[0];
    const access = await accessOf(db, row, adminId);
    if (!access || (need === 'write' && access !== 'write')) return null;
    return { ...row, access };
  }

  const view = m => ({
    id: m.id, title: m.title, summary: m.summary, status: m.status,
    workspaceId: m.workspace_id || null, access: m.access, createdAt: m.created_at, updatedAt: m.updated_at,
  });

  async function list(adminId) {
    const r = await db.query(
      `SELECT m.*, (m.owner_id = $1) AS own, wm.role,
              (SELECT count(*) FROM matter_items i WHERE i.matter_id = m.id)::int AS items
         FROM matters m
         LEFT JOIN workspace_members wm ON wm.workspace_id = m.workspace_id AND wm.user_id = $1
         LEFT JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.deleted_at IS NULL
          AND (m.owner_id = $1 OR (wm.user_id IS NOT NULL AND w.deleted_at IS NULL))
        ORDER BY m.updated_at DESC
        LIMIT 500`, [adminId]);
    return r.rows.map(m => ({
      ...view({ ...m, access: m.own || m.role === 'owner' || m.role === 'member' ? 'write' : 'read' }),
      own: !!m.own, items: m.items,
    }));
  }

  async function create(adminId, { title, summary, workspaceId } = {}) {
    const t = clean(title, 160);
    if (t.length < 2) throw new MatterError(400, 'invalid', "Ish nomi kamida 2 ta harf bo'lsin");
    if (workspaceId != null && workspaceId !== '') {
      if (!isUuid(workspaceId)) throw new MatterError(404, 'not_found', 'Workspace topilmadi');
      const w = await db.query(
        `SELECT wm.role FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id
          WHERE wm.workspace_id = $1 AND wm.user_id = $2 AND w.deleted_at IS NULL`, [workspaceId, adminId]);
      const role = w.rows[0] && w.rows[0].role;
      if (role !== 'owner' && role !== 'member') throw new MatterError(404, 'not_found', 'Workspace topilmadi');
    }
    const limit = await openLimit(adminId);
    const open = await db.query(`SELECT count(*)::int AS n FROM matters WHERE owner_id = $1 AND status = 'open' AND deleted_at IS NULL`, [adminId]);
    if (open.rows[0].n >= limit) {
      throw new MatterError(402, 'limit', limit === MAX_OPEN_TRIAL
        ? "Sinov tarifida bitta ochiq ish bo'ladi. Ko'proq ish uchun tarif kerak."
        : `Ochiq ishlar soni ${limit} tadan oshmaydi. Eskilarini yoping.`);
    }
    const r = await db.query(
      `INSERT INTO matters (owner_id, workspace_id, title, summary) VALUES ($1, $2, $3, $4) RETURNING *`,
      [adminId, workspaceId || null, t, String(summary || '').slice(0, 4000)]);
    return view({ ...r.rows[0], access: 'write' });
  }

  /** The matter and its items, each source checked; null when not reachable. */
  async function get(id, adminId) {
    const m = await load(id, adminId, 'read');
    if (!m) return null;
    const r = await db.query('SELECT * FROM matter_items WHERE matter_id = $1 ORDER BY created_at DESC LIMIT $2', [m.id, MAX_ITEMS]);
    const items = r.rows;
    // the sources belong to the matter's owner: a member sees what the owner linked
    const owner = m.owner_id;
    const chatIds = items.filter(i => i.kind === 'chat').map(i => Number(i.ref_int));
    const scanIds = items.filter(i => i.kind === 'scan').map(i => i.ref_uuid);
    const chats = new Map();
    const scans = new Map();
    if (chatIds.length) {
      const c = await db.query('SELECT id, title, updated_at FROM ai_chat_sessions WHERE id = ANY($1) AND admin_id = $2', [chatIds, owner]).catch(() => ({ rows: [] }));
      for (const row of c.rows) chats.set(Number(row.id), row);
    }
    if (scanIds.length) {
      const s = await db.query('SELECT id, pages, kind, expires_at FROM document_scans WHERE id = ANY($1) AND admin_id = $2 AND expires_at > now()', [scanIds, owner]).catch(() => ({ rows: [] }));
      for (const row of s.rows) scans.set(row.id, row);
    }
    return {
      ...view(m),
      own: Number(m.owner_id) === Number(adminId),
      items: items.map((i) => {
        const base = { id: i.id, kind: i.kind, title: i.title, createdAt: i.created_at };
        if (i.kind === 'note') return { ...base, note: i.note };
        if (i.kind === 'chat') {
          const c = chats.get(Number(i.ref_int));
          return c ? { ...base, ref: Number(i.ref_int), available: true, updatedAt: c.updated_at } : { ...base, ref: Number(i.ref_int), available: false };
        }
        if (i.kind === 'scan') {
          const s = scans.get(i.ref_uuid);
          return s ? { ...base, ref: i.ref_uuid, available: true, pages: s.pages } : { ...base, ref: i.ref_uuid, available: false };
        }
        // agent runs come with PR-B; until then a link is shown as not available
        return { ...base, ref: i.ref_uuid, available: false };
      }),
    };
  }

  async function holdScans(matterId) {
    // a scan an open matter holds stays; one no open matter holds any more gets 30 days
    await db.query(
      `UPDATE document_scans s SET expires_at = now() + interval '${SCAN_AFTER_CLOSE_DAYS} days'
        WHERE s.id IN (SELECT ref_uuid FROM matter_items WHERE matter_id = $1 AND kind = 'scan')
          AND s.expires_at > now() + interval '${SCAN_AFTER_CLOSE_DAYS} days'
          AND NOT EXISTS (SELECT 1 FROM matter_items i JOIN matters m ON m.id = i.matter_id
                           WHERE i.kind = 'scan' AND i.ref_uuid = s.id AND m.id <> $1
                             AND m.status = 'open' AND m.deleted_at IS NULL)`, [matterId]);
  }

  async function update(id, adminId, patch = {}) {
    const m = await load(id, adminId, 'write');
    if (!m) return null;
    const title = patch.title != null ? clean(patch.title, 160) : m.title;
    if (title.length < 2) throw new MatterError(400, 'invalid', "Ish nomi kamida 2 ta harf bo'lsin");
    const summary = patch.summary != null ? String(patch.summary).slice(0, 4000) : m.summary;
    let status = m.status;
    if (patch.status != null) {
      if (!['open', 'closed'].includes(patch.status)) throw new MatterError(400, 'invalid', "Holat: open yoki closed");
      status = patch.status;
    }
    if (status === 'open' && m.status === 'closed') {
      const limit = await openLimit(m.owner_id);
      const open = await db.query(`SELECT count(*)::int AS n FROM matters WHERE owner_id = $1 AND status = 'open' AND deleted_at IS NULL`, [m.owner_id]);
      if (open.rows[0].n >= limit) throw new MatterError(402, 'limit', `Ochiq ishlar soni ${limit} tadan oshmaydi.`);
    }
    const r = await db.query(
      `UPDATE matters SET title = $2, summary = $3, status = $4, updated_at = now() WHERE id = $1 RETURNING *`,
      [m.id, title, summary, status]);
    if (status === 'closed' && m.status !== 'closed') await holdScans(m.id);
    if (status === 'open' && m.status === 'closed') {
      await db.query(`UPDATE document_scans SET expires_at = now() + ${SCAN_HELD}
        WHERE id IN (SELECT ref_uuid FROM matter_items WHERE matter_id = $1 AND kind = 'scan') AND expires_at > now()`, [m.id]);
    }
    return view({ ...r.rows[0], access: m.access });
  }

  /** Only the owner deletes (soft); members of an attached Workspace do not. */
  async function remove(id, adminId) {
    const m = await load(id, adminId, 'write');
    if (!m || Number(m.owner_id) !== Number(adminId)) return false;
    await db.query(`UPDATE matters SET deleted_at = now(), status = 'closed', updated_at = now() WHERE id = $1`, [m.id]);
    await holdScans(m.id);
    return true;
  }

  async function addItem(id, adminId, { kind, ref, title, note } = {}) {
    const m = await load(id, adminId, 'write');
    if (!m) return null;
    if (!KINDS.includes(kind)) throw new MatterError(400, 'invalid', "Element turi: chat, scan yoki note");
    if (kind === 'agent_run') throw new MatterError(400, 'unsupported', "Agent natijalari keyingi bosqichda qo'shiladi");
    const count = await db.query('SELECT count(*)::int AS n FROM matter_items WHERE matter_id = $1', [m.id]);
    if (count.rows[0].n >= MAX_ITEMS) throw new MatterError(402, 'limit', `Bitta ishda ${MAX_ITEMS} tadan ortiq element bo'lmaydi.`);
    // sources are read as the matter owner's: a member adds notes, not their own chats or scans
    if (kind !== 'note' && Number(m.owner_id) !== Number(adminId)) {
      throw new MatterError(400, 'unsupported', "Chat yoki hujjatni faqat ish egasi qo'sha oladi");
    }
    let refInt = null, refUuid = null, name = clean(title, 240), text = null;
    if (kind === 'note') {
      text = String(note || '').trim().slice(0, 8000);
      if (!text) throw new MatterError(400, 'invalid', "Yozuv matni bo'sh");
      if (!name) name = clean(text, 80);
    } else if (kind === 'chat') {
      const cid = Number(ref);
      if (!Number.isSafeInteger(cid) || cid <= 0) throw new MatterError(404, 'not_found', 'Chat topilmadi');
      const c = await db.query('SELECT id, title FROM ai_chat_sessions WHERE id = $1 AND admin_id = $2', [cid, adminId]);
      if (!c.rows[0]) throw new MatterError(404, 'not_found', 'Chat topilmadi');
      refInt = cid;
      if (!name) name = clean(c.rows[0].title, 240) || 'Chat';
    } else if (kind === 'scan') {
      if (!isUuid(ref)) throw new MatterError(404, 'not_found', 'Hujjat topilmadi');
      const s = await db.query('SELECT id FROM document_scans WHERE id = $1 AND admin_id = $2 AND expires_at > now()', [ref, adminId]);
      if (!s.rows[0]) throw new MatterError(404, 'not_found', 'Hujjat topilmadi');
      refUuid = ref;
      if (!name) name = 'Hujjat';
    }
    let r;
    try {
      r = await db.query(
        `INSERT INTO matter_items (matter_id, kind, ref_int, ref_uuid, title, note, added_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, kind, title, created_at`,
        [m.id, kind, refInt, refUuid, name, text, adminId]);
    } catch (e) {
      if (e && e.code === '23505') throw new MatterError(409, 'exists', "Bu element ishda allaqachon bor");
      throw e;
    }
    if (kind === 'scan' && m.status === 'open') {
      await db.query(`UPDATE document_scans SET expires_at = now() + ${SCAN_HELD} WHERE id = $1 AND expires_at > now()`, [refUuid]);
    }
    await db.query('UPDATE matters SET updated_at = now() WHERE id = $1', [m.id]);
    const row = r.rows[0];
    return { id: row.id, kind: row.kind, title: row.title, createdAt: row.created_at };
  }

  /** Removes the link only; the chat or scan itself stays. */
  async function removeItem(id, itemId, adminId) {
    const m = await load(id, adminId, 'write');
    if (!m || !isUuid(itemId)) return false;
    const r = await db.query('DELETE FROM matter_items WHERE id = $1 AND matter_id = $2 RETURNING kind, ref_uuid', [itemId, m.id]);
    if (!r.rows[0]) return false;
    if (r.rows[0].kind === 'scan') {
      await db.query(
        `UPDATE document_scans s SET expires_at = now() + interval '${SCAN_AFTER_CLOSE_DAYS} days'
          WHERE s.id = $1 AND s.expires_at > now() + interval '${SCAN_AFTER_CLOSE_DAYS} days'
            AND NOT EXISTS (SELECT 1 FROM matter_items i JOIN matters mm ON mm.id = i.matter_id
                             WHERE i.kind = 'scan' AND i.ref_uuid = s.id AND mm.status = 'open' AND mm.deleted_at IS NULL)`, [r.rows[0].ref_uuid]);
    }
    await db.query('UPDATE matters SET updated_at = now() WHERE id = $1', [m.id]);
    return true;
  }

  return { list, create, get, update, remove, addItem, removeItem };
}

/** Account deletion: the person's matters and their links go (the sources are handled by their own rules). */
async function deleteAccountMatters(db, adminId) {
  await db.query('DELETE FROM matter_items WHERE added_by = $1', [adminId]);
  await db.query('DELETE FROM matters WHERE owner_id = $1', [adminId]);
}

module.exports = { createMatterStore, deleteAccountMatters, MatterError, KINDS, MAX_OPEN, MAX_OPEN_TRIAL, MAX_ITEMS, SCAN_AFTER_CLOSE_DAYS };
