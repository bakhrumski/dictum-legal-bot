'use strict';

/**
 * The firm library (K1b, docs/design/firma-bilim-bazasi.md): a Workspace's
 * shared templates, playbooks and chat skills. No AI, no unit.
 *
 *   GET    /api/library                               every item of the caller's active Workspaces
 *   GET    /api/workspaces/:id/library?kind=          one Workspace's items
 *   POST   /api/workspaces/:id/library                { from: { kind, id } } share one's own item
 *                                                     (the server reads it from its owner's table),
 *                                                     or { kind, name, data } a new one
 *   PUT    /api/workspaces/:id/library/:item          { name, data, version } -> 409 when stale
 *   DELETE /api/workspaces/:id/library/:item          archived (the versions stay)
 *   GET    /api/workspaces/:id/library/:item/versions
 *   POST   /api/workspaces/:id/library/:item/restore  { version } - the current one is kept first
 *
 * Roles: viewer reads and uses, member and owner write (src/workspace/authz.js,
 * the Workspace active - owner's paid plan, the member's own plan). Another
 * Workspace or a non-member: 404. The body is sealed, bound to its place and
 * version; every write runs as the acting account, so the activity log knows
 * who (the trigger drops `content`). WS_LIBRARY_MAX (200) items a kind.
 * WS_LIBRARY=off stops it (503).
 */

const privacy = require('../privacy/crypto');
const { requireWorkspaceAccess, withWorkspaceTransaction } = require('./authz');

const KINDS = ['template', 'playbook', 'skill'];
const MAX = () => Math.max(1, Math.min(1000, Number(process.env.WS_LIBRARY_MAX) || 200));
const KEEP_VERSIONS = 20;
const off = () => String(process.env.WS_LIBRARY || '').toLowerCase() === 'off';
const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(String(v || ''));
const aad = (ws, id, v) => `workspace_library.content:${ws}:${id}:${v}`;
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '').trim().slice(0, max);
function fail(status, message, code) { const e = new Error(message); e.status = status; e.code = code || (status === 404 ? 'not_found' : 'invalid'); return e; }

/** One kind's body, checked and trimmed: { name, data } or a 400. */
function readBody(kind, input = {}) {
  const d = input.data || {};
  if (kind === 'skill') {
    const name = clean(input.name, 60);
    const ins = clean(d.ins, 600);
    if (!name || !ins) throw fail(400, 'Ko‘nikma nomi va matni kerak.');
    return { name, data: { ins } };
  }
  if (kind === 'playbook') {
    const { normRules } = require('../agents/workflows/playbook-review');
    const name = clean(input.name, 120);
    const rules = normRules(d.rules).map(({ id, ...r }) => r);
    if (name.length < 2 || !rules.length) throw fail(400, 'Nom va kamida bitta qoida kerak.');
    return { name, data: { description: clean(d.description, 400), rules } };
  }
  if (kind === 'template') {
    const nm = d.nameI18n && typeof d.nameI18n === 'object' ? d.nameI18n : { uz: input.name, ru: input.name };
    const name = clean(input.name || nm.uz || nm.ru, 160);
    const body = String(d.body || '');
    if (!name) throw fail(400, 'Shablon nomi kerak.');
    if (body.trim().length < 30 || body.length > 400000) throw fail(400, 'Shablon matni juda qisqa yoki juda uzun.');
    const fields = Array.isArray(d.fields) ? d.fields.slice(0, 200) : [];
    const desc = d.description && typeof d.description === 'object' ? { uz: clean(d.description.uz, 600), ru: clean(d.description.ru, 600) } : { uz: '', ru: '' };
    return { name, data: { nameI18n: { uz: clean(nm.uz || name, 160), ru: clean(nm.ru || name, 160) }, description: desc, category: clean(d.category, 60) || 'boshqa', lang: d.lang === 'ru' ? 'ru' : 'uz', fields, body } };
  }
  throw fail(400, 'Noma‘lum tur.');
}

function createLibrary({ db }) {
  const openRow = (r) => {
    let data = {};
    try { data = JSON.parse(privacy.open(r.content, aad(r.workspace_id, r.id, r.version)) || '{}'); } catch (e) { data = {}; }
    return { id: r.id, workspaceId: r.workspace_id, kind: r.kind, name: r.name, data, version: r.version, sourceKind: r.source_kind || null,
      createdBy: r.created_by, updatedBy: r.updated_by, updatedByName: r.updated_by_name || null, updatedAt: r.updated_at };
  };
  const seal = (ws, id, v, data) => privacy.seal(JSON.stringify(data), aad(ws, id, v));

  /** The caller's own item of a kind, read from its owner table (another's: 404). */
  async function ownSource(adminId, from = {}) {
    const kind = from.kind;
    if (kind === 'skill') {
      if (!isUuid(from.id)) throw fail(404, 'Ko‘nikma topilmadi.');
      const r = (await db.query('SELECT id, name, ins FROM user_skills WHERE id = $1 AND admin_id = $2', [from.id, adminId])).rows[0];
      if (!r) throw fail(404, 'Ko‘nikma topilmadi.');
      return { kind, input: { name: r.name, data: { ins: privacy.open(r.ins, `user_skills.ins:${r.id}`) } } };
    }
    if (kind === 'playbook') {
      const r = (await db.query('SELECT name, description, rules FROM playbooks WHERE id = $1 AND admin_id = $2', [Number(from.id) || 0, adminId])).rows[0];
      if (!r) throw fail(404, 'Playbook topilmadi.');
      return { kind, input: { name: r.name, data: { description: r.description, rules: r.rules } } };
    }
    if (kind === 'template') {
      const r = (await db.query('SELECT name, description, category, lang, fields, body FROM document_templates WHERE id = $1 AND owner_id = $2', [Number(from.id) || 0, adminId])).rows[0];
      if (!r) throw fail(404, 'Shablon topilmadi.');
      const nm = r.name || {};
      return { kind, input: { name: nm.uz || nm.ru, data: { nameI18n: nm, description: r.description, category: r.category, lang: r.lang, fields: r.fields, body: r.body } } };
    }
    throw fail(400, 'Noma‘lum tur.');
  }

  async function list(ws, adminId, kind = null) {
    await requireWorkspaceAccess(db, ws, adminId, { minimumRole: 'viewer' });
    const args = [ws];
    if (kind && KINDS.includes(kind)) args.push(kind);
    const r = await db.query(
      `SELECT i.*, a.full_name AS updated_by_name FROM workspace_library_items i LEFT JOIN admins a ON a.id = i.updated_by
        WHERE i.workspace_id = $1 AND i.archived_at IS NULL ${args.length > 1 ? 'AND i.kind = $2' : ''}
        ORDER BY i.updated_at DESC LIMIT 1000`, args);
    return r.rows.map(openRow);
  }

  /** Every item of every Workspace the caller may use now (inactive ones are left out). */
  async function listAll(adminId) {
    const r = await db.query(
      `SELECT i.*, w.name AS workspace_name, wm.role, a.full_name AS updated_by_name
         FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id AND w.deleted_at IS NULL
         JOIN workspace_library_items i ON i.workspace_id = w.id AND i.archived_at IS NULL
         LEFT JOIN admins a ON a.id = i.updated_by
        WHERE wm.user_id = $1 ORDER BY i.updated_at DESC LIMIT 2000`, [adminId]);
    const active = new Map();
    const out = [];
    for (const row of r.rows) {
      if (!active.has(row.workspace_id)) {
        try { await requireWorkspaceAccess(db, row.workspace_id, adminId, { minimumRole: 'viewer' }); active.set(row.workspace_id, true); }
        catch (e) { active.set(row.workspace_id, false); }
      }
      if (active.get(row.workspace_id)) out.push({ ...openRow(row), workspaceName: row.workspace_name, role: row.role });
    }
    return out;
  }

  async function create(ws, adminId, body = {}) {
    await requireWorkspaceAccess(db, ws, adminId, { minimumRole: 'member' });
    let kind = body.kind, input = body, sourceKind = null, sourceId = null;
    if (body.from) { const src = await ownSource(adminId, body.from); kind = src.kind; input = src.input; sourceKind = src.kind; sourceId = String(body.from.id); }
    if (!KINDS.includes(kind)) throw fail(400, 'Noma‘lum tur.');
    const b = readBody(kind, input);
    return withWorkspaceTransaction(db, adminId, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(74120233, hashtext($1))', [`${ws}:${kind}`]);
      const n = (await client.query('SELECT count(*)::int AS n FROM workspace_library_items WHERE workspace_id = $1 AND kind = $2 AND archived_at IS NULL', [ws, kind])).rows[0].n;
      if (n >= MAX()) throw fail(409, `Firma kutubxonasida bu turdan ${MAX()} tadan ko‘p bo‘lmaydi.`, 'too_many');
      // one item is shared to a Workspace once: the firm copy is then changed in place
      if (sourceId && (await client.query('SELECT 1 FROM workspace_library_items WHERE workspace_id = $1 AND source_kind = $2 AND source_id = $3 AND archived_at IS NULL', [ws, sourceKind, sourceId])).rows[0]) {
        throw fail(409, 'Bu element firmaga allaqachon ulashilgan — firmadagi nusxasini tahrirlang.', 'already_shared');
      }
      const id = require('crypto').randomUUID();
      const r = await client.query(
        `INSERT INTO workspace_library_items (id, workspace_id, kind, name, content, version, source_kind, source_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $8) RETURNING *`,
        [id, ws, kind, b.name, seal(ws, id, 1, b.data), sourceKind, sourceId, adminId]);
      return openRow(r.rows[0]);
    });
  }

  async function current(client, ws, itemId, lock = false) {
    if (!isUuid(itemId)) throw fail(404, 'Topilmadi.');
    const r = (await client.query(`SELECT * FROM workspace_library_items WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [itemId, ws])).rows[0];
    if (!r) throw fail(404, 'Topilmadi.');
    return r;
  }
  /** Writes a new version (the current one goes to the history first). */
  async function writeVersion(client, row, adminId, name, data) {
    await client.query('INSERT INTO workspace_library_versions (item_id, version, name, content, updated_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
      [row.id, row.version, row.name, privacy.seal(JSON.stringify(openRow(row).data), aad(row.workspace_id, row.id, `h${row.version}`)), row.updated_by]);
    await client.query('DELETE FROM workspace_library_versions WHERE item_id = $1 AND version <= $2', [row.id, row.version - KEEP_VERSIONS]);
    const v = row.version + 1;
    const r = await client.query('UPDATE workspace_library_items SET name = $2, content = $3, version = $4, updated_by = $5, updated_at = now() WHERE id = $1 RETURNING *',
      [row.id, name, seal(row.workspace_id, row.id, v, data), v, adminId]);
    return openRow(r.rows[0]);
  }

  async function update(ws, itemId, adminId, body = {}) {
    await requireWorkspaceAccess(db, ws, adminId, { minimumRole: 'member' });
    return withWorkspaceTransaction(db, adminId, async (client) => {
      const row = await current(client, ws, itemId, true);
      if (body.version != null && Number(body.version) !== row.version) throw fail(409, 'Bu element boshqa joyda o‘zgartirilgan. Sahifani yangilang.', 'stale');
      const b = readBody(row.kind, body);
      return writeVersion(client, row, adminId, b.name, b.data);
    });
  }

  async function archive(ws, itemId, adminId) {
    await requireWorkspaceAccess(db, ws, adminId, { minimumRole: 'member' });
    return withWorkspaceTransaction(db, adminId, async (client) => {
      const row = await current(client, ws, itemId, true);
      await client.query('UPDATE workspace_library_items SET archived_at = now(), updated_by = $2 WHERE id = $1', [row.id, adminId]);
      return { archived: true };
    });
  }

  async function versions(ws, itemId, adminId) {
    await requireWorkspaceAccess(db, ws, adminId, { minimumRole: 'viewer' });
    const row = await current(db, ws, itemId);
    const r = await db.query(`SELECT v.version, v.name, v.created_at, a.full_name AS by FROM workspace_library_versions v
      LEFT JOIN admins a ON a.id = v.updated_by WHERE v.item_id = $1 ORDER BY v.version DESC`, [row.id]);
    return { current: row.version, versions: r.rows };
  }

  async function restore(ws, itemId, adminId, version) {
    await requireWorkspaceAccess(db, ws, adminId, { minimumRole: 'member' });
    return withWorkspaceTransaction(db, adminId, async (client) => {
      const row = await current(client, ws, itemId, true);
      const old = (await client.query('SELECT * FROM workspace_library_versions WHERE item_id = $1 AND version = $2', [row.id, Number(version) || 0])).rows[0];
      if (!old) throw fail(404, 'Bunday versiya yo‘q.');
      const data = JSON.parse(privacy.open(old.content, aad(row.workspace_id, row.id, `h${old.version}`)) || '{}');
      return writeVersion(client, row, adminId, old.name, data);
    });
  }

  /** A firm template by "ws:<item id>" for one account, shaped like a stored template; null when not theirs. */
  async function templateFor(ref, adminId) {
    const m = /^ws:([0-9a-f-]{36})$/iu.exec(String(ref || ''));
    if (!m) return null;
    const r = (await db.query(`SELECT * FROM workspace_library_items WHERE id = $1 AND kind = 'template' AND archived_at IS NULL`, [m[1]])).rows[0];
    if (!r) return null;
    try { await requireWorkspaceAccess(db, r.workspace_id, adminId, { minimumRole: 'viewer' }); } catch (e) { return null; }
    const it = openRow(r);
    // no slug: the page sends `slug || id`, and the id is what opens it again
    return { id: `ws:${it.id}`, slug: null, name: it.data.nameI18n || { uz: it.name, ru: it.name }, description: it.data.description || {},
      category: it.data.category, lang: it.data.lang, fields: it.data.fields || [], body: it.data.body, isMine: false, firm: { workspaceId: r.workspace_id } };
  }

  return { list, listAll, create, update, archive, versions, restore, templateFor, readBody };
}

function mountLibraryRoutes(app, { db, requireAuth, requireSameOrigin }) {
  const lib = createLibrary({ db });
  const handle = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (off()) return res.status(503).json({ error: 'unavailable', message: 'WS_LIBRARY=off' });
    try { await fn(req, res); } catch (e) {
      if (/does not exist/u.test(String(e && e.message))) return res.status(503).json({ error: 'unavailable', message: 'Jadval hali yaratilmagan (migratsiya 045).' });
      const status = e.status || e.statusCode || 500;
      if (status >= 500) console.warn('[WS-LIBRARY]', req.method, req.path, e.message);
      res.status(status).json({ error: e.code || 'failed', message: status >= 500 ? 'Bajarib bo‘lmadi.' : e.message });
    }
  };
  const me = req => req.session.adminId;
  const ws = (req) => { if (!isUuid(req.params.id)) throw fail(404, 'Workspace topilmadi'); return req.params.id; };
  app.get('/api/library', requireAuth, handle(async (req, res) => res.json({ items: await lib.listAll(me(req)) })));
  app.get('/api/workspaces/:id/library', requireAuth, handle(async (req, res) => res.json({ items: await lib.list(ws(req), me(req), req.query.kind || null) })));
  app.post('/api/workspaces/:id/library', requireSameOrigin, requireAuth, handle(async (req, res) => res.status(201).json(await lib.create(ws(req), me(req), req.body || {}))));
  app.put('/api/workspaces/:id/library/:item', requireSameOrigin, requireAuth, handle(async (req, res) => res.json(await lib.update(ws(req), req.params.item, me(req), req.body || {}))));
  app.delete('/api/workspaces/:id/library/:item', requireSameOrigin, requireAuth, handle(async (req, res) => res.json(await lib.archive(ws(req), req.params.item, me(req)))));
  app.get('/api/workspaces/:id/library/:item/versions', requireAuth, handle(async (req, res) => res.json(await lib.versions(ws(req), req.params.item, me(req)))));
  app.post('/api/workspaces/:id/library/:item/restore', requireSameOrigin, requireAuth, handle(async (req, res) => res.json(await lib.restore(ws(req), req.params.item, me(req), (req.body || {}).version))));
  return lib;
}

module.exports = { mountLibraryRoutes, createLibrary, readBody, KINDS };
