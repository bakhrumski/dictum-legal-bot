'use strict';

/**
 * Client portal P1a (2026-11-05, docs/design/mijoz-portali.md, accepted): the
 * client of one matter. No AI call, no tariff unit.
 *
 * Who manages: whoever may write the matter (its owner; owner / member of the
 * Workspace it is attached to - src/matters/store.js accessOf). A viewer reads
 * the panel but changes nothing. Who is a client: any platform account that
 * accepted a one-use invite, with no plan needed; a client is not a Workspace
 * member and sees nothing but what was marked for them:
 *   - the stage (received / in_progress / waiting_client / in_court / done)
 *     and its history;
 *   - deadlines marked client-visible;
 *   - notes written for the client (apart from the matter's own notes);
 *   - documents shared to the client: the text is copied from the sharer's
 *     own "Hujjatlarim" when shared, sealed, and never read back from the
 *     library (deleting the library copy does not remove the client's one).
 * Never: the matter's notes, chats, agent results, the firm base, the
 * Workspace or its members. Every client read checks the client row, the
 * matter (not deleted; open, or closed less than CLOSED_DAYS ago) and the
 * item's matter - anything else is 404, so a matter cannot be told to exist.
 *
 * Invites: random 24 bytes, only the sha256 kept, shown once, PORTAL_INVITE_DAYS
 * (7), used once, revocable; a person who already reaches the matter as a
 * lawyer cannot accept it as a client. PORTAL_MAX_CLIENTS (10) a matter.
 * MATTER_PORTAL=off -> 503.
 */

const crypto = require('crypto');
const privacy = require('../privacy/crypto');
const { accessOf, MatterError } = require('./store');

const STAGES = Object.freeze(['received', 'in_progress', 'waiting_client', 'in_court', 'done']);
const CLOSED_DAYS = 30;
const INVITE_DAYS = () => Math.min(30, Math.max(1, Number(process.env.PORTAL_INVITE_DAYS) || 7));
const MAX_CLIENTS = () => Math.max(1, Number(process.env.PORTAL_MAX_CLIENTS) || 10);
const MAX_OPEN_INVITES = 20;
const MAX_ITEMS = 200;
const NOTE_MAX = 8000;
const DOC_MAX = 400000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const isUuid = v => typeof v === 'string' && UUID.test(v);
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const itemAad = (matterId, id) => `matter_client_items.body:${matterId}:${id}`;
const fail = (status, code, message) => new MatterError(status, code, message);
const NOT_FOUND = () => fail(404, 'not_found', 'Ish topilmadi');
const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/gu, ' ').trim().slice(0, max);
const off = () => String(process.env.MATTER_PORTAL || '').toLowerCase() === 'off';

function createPortal({ db }) {
  if (!db) throw new Error('db is required');

  /** The matter row for a lawyer: write (or read when allowed) access, else 404. */
  async function lawyerMatter(matterId, adminId, need = 'write') {
    if (!isUuid(matterId)) throw NOT_FOUND();
    const row = (await db.query('SELECT * FROM matters WHERE id = $1', [matterId])).rows[0];
    const access = await accessOf(db, row, adminId);
    if (!access || (need === 'write' && access !== 'write')) throw NOT_FOUND();
    return { ...row, access };
  }

  /** The matter row for a client: an active client row on a matter they may still read, else 404. */
  async function clientMatter(matterId, adminId) {
    if (!isUuid(matterId)) throw NOT_FOUND();
    const r = await db.query(
      `SELECT m.* FROM matters m JOIN matter_clients c ON c.matter_id = m.id AND c.client_id = $2 AND c.removed_at IS NULL
        WHERE m.id = $1 AND m.deleted_at IS NULL
          AND (m.status = 'open' OR m.closed_at IS NULL OR m.closed_at > now() - interval '${CLOSED_DAYS} days')`, [matterId, adminId]);
    if (!r.rows[0]) throw NOT_FOUND();
    return r.rows[0];
  }

  const deadlineView = d => ({ id: d.id, title: d.title, dueOn: d.due_on instanceof Date ? d.due_on.toISOString().slice(0, 10) : String(d.due_on).slice(0, 10), clientVisible: d.client_visible });
  const itemView = (i, withBody) => ({
    id: i.id, kind: i.kind, title: i.title, pages: i.pages || null, chars: i.chars || null, createdAt: i.created_at,
    ...(withBody ? { text: privacy.open(i.body, itemAad(i.matter_id, i.id)) } : {}),
  });

  async function history(matterId) {
    return (await db.query('SELECT stage, changed_at FROM matter_stage_history WHERE matter_id = $1 ORDER BY changed_at DESC LIMIT 20', [matterId]))
      .rows.map(h => ({ stage: h.stage, at: h.changed_at }));
  }

  // ---------- the lawyer's side ----------

  /** The panel on the matter page: stage, clients, open invites, deadlines, client items. */
  async function panel(matterId, adminId) {
    const m = await lawyerMatter(matterId, adminId, 'read');
    const [clients, invites, deadlines, items] = await Promise.all([
      db.query(`SELECT c.client_id, c.joined_at, a.full_name, a.telegram_username FROM matter_clients c JOIN admins a ON a.id = c.client_id
                 WHERE c.matter_id = $1 AND c.removed_at IS NULL ORDER BY c.joined_at`, [m.id]),
      db.query(`SELECT id, note, created_at, expires_at FROM matter_client_invites
                 WHERE matter_id = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`, [m.id]),
      db.query('SELECT * FROM matter_deadlines WHERE matter_id = $1 ORDER BY due_on, created_at', [m.id]),
      db.query('SELECT id, matter_id, kind, title, pages, chars, created_at FROM matter_client_items WHERE matter_id = $1 ORDER BY created_at DESC', [m.id]),
    ]);
    return {
      matterId: m.id, access: m.access, stage: m.client_stage, stageAt: m.client_stage_at, history: await history(m.id),
      clients: clients.rows.map(c => ({ id: c.client_id, name: c.full_name || (c.telegram_username ? '@' + c.telegram_username : 'Mijoz'), joinedAt: c.joined_at })),
      invites: invites.rows.map(i => ({ id: i.id, note: i.note || null, createdAt: i.created_at, expiresAt: i.expires_at })),
      deadlines: deadlines.rows.map(deadlineView),
      items: items.rows.map(i => itemView(i, false)),
      limits: { clients: MAX_CLIENTS(), items: MAX_ITEMS },
    };
  }

  async function invite(matterId, adminId, { note } = {}) {
    const m = await lawyerMatter(matterId, adminId);
    if (m.status !== 'open') throw fail(409, 'closed', 'Yopilgan ishga mijoz taklif qilinmaydi.');
    const open = (await db.query(`SELECT count(*)::int AS n FROM matter_client_invites WHERE matter_id = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`, [m.id])).rows[0].n;
    if (open >= MAX_OPEN_INVITES) throw fail(409, 'too_many', `Bir ishda ${MAX_OPEN_INVITES} tadan ortiq ochiq taklif bo'lmaydi.`);
    const clients = (await db.query('SELECT count(*)::int AS n FROM matter_clients WHERE matter_id = $1 AND removed_at IS NULL', [m.id])).rows[0].n;
    if (clients >= MAX_CLIENTS()) throw fail(409, 'too_many', `Bir ishda ${MAX_CLIENTS()} tadan ortiq mijoz bo'lmaydi.`);
    const token = crypto.randomBytes(24).toString('base64url');
    const r = await db.query(
      `INSERT INTO matter_client_invites (matter_id, token_hash, note, created_by, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(days => $5)) RETURNING id, expires_at`,
      [m.id, hashToken(token), clean(note, 120) || null, adminId, INVITE_DAYS()]);
    // the token is shown once and never stored
    return { id: r.rows[0].id, token, path: `/app/#/portal/taklif/${token}`, expiresAt: r.rows[0].expires_at };
  }

  async function revokeInvite(matterId, inviteId, adminId) {
    const m = await lawyerMatter(matterId, adminId);
    if (!isUuid(inviteId)) throw NOT_FOUND();
    const r = await db.query('UPDATE matter_client_invites SET revoked_at = now() WHERE id = $1 AND matter_id = $2 AND used_at IS NULL AND revoked_at IS NULL', [inviteId, m.id]);
    if (!r.rowCount) throw fail(404, 'not_found', 'Taklif topilmadi');
    return { ok: true };
  }

  async function removeClient(matterId, clientId, adminId) {
    const m = await lawyerMatter(matterId, adminId);
    const r = await db.query('UPDATE matter_clients SET removed_at = now(), removed_by = $3 WHERE matter_id = $1 AND client_id = $2 AND removed_at IS NULL', [m.id, Number(clientId) || 0, adminId]);
    if (!r.rowCount) throw fail(404, 'not_found', 'Mijoz topilmadi');
    return { ok: true };
  }

  async function setStage(matterId, adminId, stage) {
    if (!STAGES.includes(stage)) throw fail(400, 'invalid', `Bosqich: ${STAGES.join(', ')}`);
    const m = await lawyerMatter(matterId, adminId);
    if (m.client_stage === stage) return { stage, stageAt: m.client_stage_at };
    const r = await db.query('UPDATE matters SET client_stage = $2, client_stage_at = now(), updated_at = now() WHERE id = $1 RETURNING client_stage_at', [m.id, stage]);
    await db.query('INSERT INTO matter_stage_history (matter_id, stage, changed_by) VALUES ($1, $2, $3)', [m.id, stage, adminId]);
    return { stage, stageAt: r.rows[0].client_stage_at };
  }

  async function addDeadline(matterId, adminId, { title, dueOn, clientVisible } = {}) {
    const m = await lawyerMatter(matterId, adminId);
    const t = clean(title, 160);
    if (t.length < 2) throw fail(400, 'invalid', "Muddat nomi kamida 2 ta harf bo'lsin");
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(dueOn || '')) || Number.isNaN(Date.parse(dueOn))) throw fail(400, 'invalid', 'Sana YYYY-MM-DD ko\'rinishida bo\'lsin');
    const n = (await db.query('SELECT count(*)::int AS n FROM matter_deadlines WHERE matter_id = $1', [m.id])).rows[0].n;
    if (n >= MAX_ITEMS) throw fail(409, 'too_many', `Bir ishda ${MAX_ITEMS} tadan ortiq muddat bo'lmaydi.`);
    const r = await db.query('INSERT INTO matter_deadlines (matter_id, title, due_on, client_visible, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [m.id, t, dueOn, clientVisible === true, adminId]);
    return deadlineView(r.rows[0]);
  }

  async function updateDeadline(matterId, deadlineId, adminId, { clientVisible } = {}) {
    const m = await lawyerMatter(matterId, adminId);
    if (!isUuid(deadlineId) || typeof clientVisible !== 'boolean') throw NOT_FOUND();
    const r = await db.query('UPDATE matter_deadlines SET client_visible = $3 WHERE id = $1 AND matter_id = $2 RETURNING *', [deadlineId, m.id, clientVisible]);
    if (!r.rows[0]) throw fail(404, 'not_found', 'Muddat topilmadi');
    return deadlineView(r.rows[0]);
  }

  async function removeDeadline(matterId, deadlineId, adminId) {
    const m = await lawyerMatter(matterId, adminId);
    if (!isUuid(deadlineId)) throw NOT_FOUND();
    const r = await db.query('DELETE FROM matter_deadlines WHERE id = $1 AND matter_id = $2', [deadlineId, m.id]);
    if (!r.rowCount) throw fail(404, 'not_found', 'Muddat topilmadi');
    return { ok: true };
  }

  /** A note for the client, or a document from the caller's OWN library (its text copied now). */
  async function addItem(matterId, adminId, { kind, text, title, scanId } = {}) {
    const m = await lawyerMatter(matterId, adminId);
    const n = (await db.query('SELECT count(*)::int AS n FROM matter_client_items WHERE matter_id = $1', [m.id])).rows[0].n;
    if (n >= MAX_ITEMS) throw fail(409, 'too_many', `Bir ishda mijozga ${MAX_ITEMS} tadan ortiq narsa ko'rsatilmaydi.`);
    const id = crypto.randomUUID();
    if (kind === 'note') {
      const body = String(text == null ? '' : text).trim().slice(0, NOTE_MAX + 1);
      if (body.length < 2) throw fail(400, 'invalid', "Izoh bo'sh bo'lmasin");
      if (body.length > NOTE_MAX) throw fail(400, 'invalid', `Izoh ${NOTE_MAX} belgidan oshmasin`);
      const t = clean(title, 240) || 'Yuristdan izoh';
      await db.query(`INSERT INTO matter_client_items (id, matter_id, kind, title, body, chars, created_by) VALUES ($1, $2, 'note', $3, $4, $5, $6)`,
        [id, m.id, t, privacy.seal(body, itemAad(m.id, id)), body.length, adminId]);
    } else if (kind === 'doc') {
      // only the sharer's own library document: another person's id reads as not found
      const scan = await require('../ocr/scan-store').getScan(db, { adminId, scanId });
      if (!scan) throw fail(404, 'not_found', 'Hujjat topilmadi');
      const body = String(scan.text || '');
      if (!body.trim()) throw fail(422, 'empty', "Hujjat matni yo'q");
      if (body.length > DOC_MAX) throw fail(413, 'too_large', 'Hujjat juda katta');
      try {
        await db.query(`INSERT INTO matter_client_items (id, matter_id, kind, title, body, pages, chars, source_scan, created_by) VALUES ($1, $2, 'doc', $3, $4, $5, $6, $7, $8)`,
          [id, m.id, clean(title, 240) || clean(scan.name, 240) || 'Hujjat', privacy.seal(body, itemAad(m.id, id)), scan.pages || null, body.length, scan.id, adminId]);
      } catch (e) {
        if (e && e.code === '23505') throw fail(409, 'already_shared', 'Bu hujjat mijozga allaqachon ko\'rsatilgan');
        throw e;
      }
    } else {
      throw fail(400, 'invalid', 'kind: note yoki doc');
    }
    const r = await db.query('SELECT id, matter_id, kind, title, pages, chars, created_at FROM matter_client_items WHERE id = $1', [id]);
    return itemView(r.rows[0], false);
  }

  async function removeItem(matterId, itemId, adminId) {
    const m = await lawyerMatter(matterId, adminId);
    if (!isUuid(itemId)) throw NOT_FOUND();
    const r = await db.query('DELETE FROM matter_client_items WHERE id = $1 AND matter_id = $2', [itemId, m.id]);
    if (!r.rowCount) throw fail(404, 'not_found', 'Topilmadi');
    return { ok: true };
  }

  // ---------- the client's side ----------

  async function inviteRow(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/u.test(token)) return null;
    const r = await db.query(
      `SELECT i.*, m.title, m.status, m.deleted_at, a.full_name AS lawyer
         FROM matter_client_invites i JOIN matters m ON m.id = i.matter_id LEFT JOIN admins a ON a.id = m.owner_id
        WHERE i.token_hash = $1`, [hashToken(token)]);
    const row = r.rows[0];
    if (!row || row.used_at || row.revoked_at || new Date(row.expires_at) <= new Date() || row.deleted_at || row.status !== 'open') return null;
    return row;
  }
  const GONE = () => fail(404, 'invite_gone', "Taklif havolasi eskirgan, ishlatilgan yoki bekor qilingan. Yuristingizdan yangisini so'rang.");

  /** What the invite page shows before joining: the matter's title and the lawyer's name. */
  async function inviteInfo(token, adminId) {
    const row = await inviteRow(token);
    if (!row) throw GONE();
    const already = (await db.query('SELECT 1 FROM matter_clients WHERE matter_id = $1 AND client_id = $2 AND removed_at IS NULL', [row.matter_id, adminId])).rows.length > 0;
    return { matterTitle: row.title, lawyerName: row.lawyer || 'Yurist', expiresAt: row.expires_at, alreadyClient: already, matterId: already ? row.matter_id : null };
  }

  async function accept(token, adminId) {
    const row = await inviteRow(token);
    if (!row) throw GONE();
    const m = (await db.query('SELECT * FROM matters WHERE id = $1', [row.matter_id])).rows[0];
    if (await accessOf(db, m, adminId)) throw fail(409, 'own_matter', 'Bu ish sizniki yoki jamoangizniki - mijoz sifatida qo\'shilish shart emas.');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const used = await client.query(
        `UPDATE matter_client_invites SET used_at = now(), used_by = $2
          WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING matter_id`, [row.id, adminId]);
      if (!used.rows[0]) { await client.query('ROLLBACK'); throw GONE(); }
      const count = (await client.query('SELECT count(*)::int AS n FROM matter_clients WHERE matter_id = $1 AND removed_at IS NULL AND client_id <> $2', [row.matter_id, adminId])).rows[0].n;
      if (count >= MAX_CLIENTS()) { await client.query('ROLLBACK'); throw fail(409, 'too_many', "Bu ishda mijozlar soni to'lgan."); }
      await client.query(
        `INSERT INTO matter_clients (matter_id, client_id, invited_by) VALUES ($1, $2, $3)
         ON CONFLICT (matter_id, client_id) DO UPDATE SET removed_at = NULL, removed_by = NULL, joined_at = now(), invited_by = EXCLUDED.invited_by`,
        [row.matter_id, adminId, row.created_by]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    return { matterId: row.matter_id };
  }

  /** The client's matters: title, stage, lawyer, status. */
  async function myMatters(adminId) {
    const r = await db.query(
      `SELECT m.id, m.title, m.status, m.client_stage, m.client_stage_at, m.closed_at, a.full_name AS lawyer
         FROM matter_clients c JOIN matters m ON m.id = c.matter_id LEFT JOIN admins a ON a.id = m.owner_id
        WHERE c.client_id = $1 AND c.removed_at IS NULL AND m.deleted_at IS NULL
          AND (m.status = 'open' OR m.closed_at IS NULL OR m.closed_at > now() - interval '${CLOSED_DAYS} days')
        ORDER BY m.client_stage_at DESC LIMIT 200`, [adminId]);
    return r.rows.map(m => ({ id: m.id, title: m.title, status: m.status, stage: m.client_stage, stageAt: m.client_stage_at, lawyerName: m.lawyer || 'Yurist', closedAt: m.closed_at }));
  }

  /** One matter as the client sees it - only what was marked for the client. */
  async function clientView(matterId, adminId) {
    const m = await clientMatter(matterId, adminId);
    const [lawyer, deadlines, items] = await Promise.all([
      db.query('SELECT full_name FROM admins WHERE id = $1', [m.owner_id]),
      db.query('SELECT * FROM matter_deadlines WHERE matter_id = $1 AND client_visible ORDER BY due_on', [m.id]),
      db.query('SELECT id, matter_id, kind, title, body, pages, chars, created_at FROM matter_client_items WHERE matter_id = $1 ORDER BY created_at DESC', [m.id]),
    ]);
    return {
      id: m.id, title: m.title, status: m.status, closedAt: m.closed_at, lawyerName: (lawyer.rows[0] && lawyer.rows[0].full_name) || 'Yurist',
      stage: m.client_stage, stageAt: m.client_stage_at, history: await history(m.id),
      deadlines: deadlines.rows.map(d => { const v = deadlineView(d); delete v.clientVisible; return v; }),
      // notes come whole; a document's text is opened on its own request
      items: items.rows.map(i => itemView(i, i.kind === 'note')),
    };
  }

  async function clientItem(matterId, itemId, adminId) {
    const m = await clientMatter(matterId, adminId);
    if (!isUuid(itemId)) throw NOT_FOUND();
    const r = await db.query('SELECT * FROM matter_client_items WHERE id = $1 AND matter_id = $2', [itemId, m.id]);
    if (!r.rows[0]) throw fail(404, 'not_found', 'Topilmadi');
    return itemView(r.rows[0], true);
  }

  async function leave(matterId, adminId) {
    const m = await clientMatter(matterId, adminId);
    await db.query('UPDATE matter_clients SET removed_at = now(), removed_by = $2 WHERE matter_id = $1 AND client_id = $2 AND removed_at IS NULL', [m.id, adminId]);
    return { ok: true };
  }

  return { panel, invite, revokeInvite, removeClient, setStage, addDeadline, updateDeadline, removeDeadline, addItem, removeItem,
    inviteInfo, accept, myMatters, clientView, clientItem, leave };
}

function mountPortalRoutes(app, { pool, requireAuth, requireSameOrigin }) {
  const portal = createPortal({ db: pool });
  const guard = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (off()) return res.status(503).json({ error: 'unavailable', message: "Mijoz portali vaqtincha o'chirilgan" });
    try {
      const out = await fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      if (e instanceof MatterError) return res.status(e.status).json({ error: e.code, message: e.message });
      if (e && e.code === '42P01') return res.status(503).json({ error: 'unavailable', message: 'Jadval hali yaratilmagan (migratsiya 047).' });
      console.error('[PORTAL]', req.method, req.path, e.message);
      res.status(500).json({ error: 'failed', message: "So'rovni bajarib bo'lmadi" });
    }
  };
  const me = req => req.session.adminId;
  const b = req => req.body || {};
  const W = [requireSameOrigin, requireAuth];

  // the lawyer's side, on a matter they reach
  app.get('/api/matters/:id/portal', requireAuth, guard(req => portal.panel(req.params.id, me(req))));
  app.put('/api/matters/:id/portal/stage', ...W, guard(req => portal.setStage(req.params.id, me(req), b(req).stage)));
  app.post('/api/matters/:id/portal/invites', ...W, guard(async (req, res) => { res.status(201).json(await portal.invite(req.params.id, me(req), b(req))); }));
  app.delete('/api/matters/:id/portal/invites/:inviteId', ...W, guard(req => portal.revokeInvite(req.params.id, req.params.inviteId, me(req))));
  app.delete('/api/matters/:id/portal/clients/:clientId', ...W, guard(req => portal.removeClient(req.params.id, req.params.clientId, me(req))));
  app.post('/api/matters/:id/portal/deadlines', ...W, guard(async (req, res) => { res.status(201).json(await portal.addDeadline(req.params.id, me(req), b(req))); }));
  app.patch('/api/matters/:id/portal/deadlines/:deadlineId', ...W, guard(req => portal.updateDeadline(req.params.id, req.params.deadlineId, me(req), b(req))));
  app.delete('/api/matters/:id/portal/deadlines/:deadlineId', ...W, guard(req => portal.removeDeadline(req.params.id, req.params.deadlineId, me(req))));
  app.post('/api/matters/:id/portal/items', ...W, guard(async (req, res) => { res.status(201).json(await portal.addItem(req.params.id, me(req), b(req))); }));
  app.delete('/api/matters/:id/portal/items/:itemId', ...W, guard(req => portal.removeItem(req.params.id, req.params.itemId, me(req))));

  // the client's side
  app.get('/api/portal', requireAuth, guard(async req => ({ matters: await portal.myMatters(me(req)) })));
  app.get('/api/portal/invite/:token', requireAuth, guard(req => portal.inviteInfo(req.params.token, me(req))));
  app.post('/api/portal/invite/:token/accept', ...W, guard(req => portal.accept(req.params.token, me(req))));
  app.get('/api/portal/:matterId', requireAuth, guard(req => portal.clientView(req.params.matterId, me(req))));
  app.get('/api/portal/:matterId/items/:itemId', requireAuth, guard(req => portal.clientItem(req.params.matterId, req.params.itemId, me(req))));
  app.post('/api/portal/:matterId/leave', ...W, guard(req => portal.leave(req.params.matterId, me(req))));
  return portal;
}

/** Account deletion: the person stops being a client anywhere (the matters' own records stay with their lawyers). */
async function deleteAccountClientRows(db, adminId) {
  await db.query('DELETE FROM matter_clients WHERE client_id = $1', [adminId]);
}

module.exports = { createPortal, mountPortalRoutes, deleteAccountClientRows, STAGES, CLOSED_DAYS };
