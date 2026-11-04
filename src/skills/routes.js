'use strict';

/**
 * A person's own chat skills on the server (K1a, docs/design/firma-bilim-bazasi.md).
 * A skill is a name and its instructions ("Javobga talablar: …"), added to a
 * question when the person picks it. They lived in one browser's
 * localStorage; here they follow the account to every device. No AI, no unit.
 *
 *   GET    /api/skills               own skills, newest first
 *   POST   /api/skills               { name, ins }            -> 201 the skill
 *   POST   /api/skills/import        { skills: [{ id, name, ins }] } - the browser's
 *                                    list moved up once; the browser id is kept
 *                                    (client_id), so a second import adds nothing
 *   PUT    /api/skills/:id           { name, ins }
 *   DELETE /api/skills/:id
 *
 * Another account's skill is 404. At most SKILLS_MAX (40) a person - the same
 * limit the browser had. The instructions are sealed (AAD user_skills.ins:<id>).
 * Writes need this site's Origin. SKILLS=off -> 503 (the page keeps the browser list).
 */

const crypto = require('crypto');
const privacy = require('../privacy/crypto');

const MAX = () => Math.max(1, Math.min(200, Number(process.env.SKILLS_MAX) || 40));
const NAME_MAX = 60;
const INS_MAX = 600;
const off = () => String(process.env.SKILLS || '').toLowerCase() === 'off';
const aad = id => `user_skills.ins:${id}`;
const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(String(v || ''));
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '').trim().slice(0, max);

function fail(status, message) { const e = new Error(message); e.status = status; return e; }

/** { name, ins } from a body, or a 400. */
function readSkill(body = {}) {
  const name = clean(body.name, NAME_MAX);
  const ins = clean(body.ins, INS_MAX);
  if (!name) throw fail(400, 'Ko‘nikma nomi kerak.');
  if (!ins) throw fail(400, 'Ko‘nikma matni kerak.');
  return { name, ins };
}

function createSkillStore(db) {
  const open = r => ({ id: r.id, name: r.name, ins: privacy.open(r.ins, aad(r.id)), clientId: r.client_id || null, updatedAt: r.updated_at });

  async function list(adminId) {
    const r = await db.query('SELECT id, client_id, name, ins, updated_at FROM user_skills WHERE admin_id = $1 ORDER BY updated_at DESC LIMIT 200', [adminId]);
    return r.rows.map(open);
  }
  async function count(adminId, client = db) {
    return (await client.query('SELECT count(*)::int AS n FROM user_skills WHERE admin_id = $1', [adminId])).rows[0].n;
  }
  /** Inserts one skill (sealed under its own id). Returns the row or null when the client id is already there. */
  async function insert(client, adminId, { name, ins, clientId = null }) {
    const id = crypto.randomUUID();
    const r = await client.query(
      `INSERT INTO user_skills (id, admin_id, client_id, name, ins) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (admin_id, client_id) WHERE client_id IS NOT NULL DO NOTHING
       RETURNING id, client_id, name, ins, updated_at`,
      [id, adminId, clientId, name, privacy.seal(ins, aad(id))]);
    return r.rows[0] ? open(r.rows[0]) : null;
  }
  /** Runs fn inside one transaction holding the person's lock, so the limit holds under parallel requests. */
  async function locked(adminId, fn) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(74120232, $1)', [adminId]);
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  }

  async function create(adminId, body) {
    const s = readSkill(body);
    return locked(adminId, async (client) => {
      if (await count(adminId, client) >= MAX()) throw fail(409, `Ko‘nikmalar soni ${MAX()} tadan oshmaydi.`);
      return insert(client, adminId, s);
    });
  }
  /** The browser's list: each valid skill not yet moved, up to the limit. { added, skipped, full }. */
  async function importList(adminId, skills = []) {
    const items = (Array.isArray(skills) ? skills : []).slice(0, 200);
    return locked(adminId, async (client) => {
      const out = { added: 0, skipped: 0, full: 0 };
      let n = await count(adminId, client);
      for (const raw of items) {
        let s;
        try { s = readSkill(raw || {}); } catch (e) { out.skipped += 1; continue; }
        const clientId = clean(raw && raw.id, 40) || null;
        if (n >= MAX()) { out.full += 1; continue; }
        const row = await insert(client, adminId, { ...s, clientId });
        if (row) { out.added += 1; n += 1; } else out.skipped += 1;
      }
      return out;
    });
  }
  async function update(adminId, id, body) {
    if (!isUuid(id)) throw fail(404, 'not_found');
    const s = readSkill(body);
    const r = await db.query(
      `UPDATE user_skills SET name = $3, ins = $4, updated_at = now() WHERE id = $1 AND admin_id = $2
       RETURNING id, client_id, name, ins, updated_at`, [id, adminId, s.name, privacy.seal(s.ins, aad(id))]);
    if (!r.rows[0]) throw fail(404, 'not_found');
    return open(r.rows[0]);
  }
  async function remove(adminId, id) {
    if (!isUuid(id)) throw fail(404, 'not_found');
    const r = await db.query('DELETE FROM user_skills WHERE id = $1 AND admin_id = $2', [id, adminId]);
    if (!r.rowCount) throw fail(404, 'not_found');
    return { deleted: true };
  }
  return { list, create, importList, update, remove };
}

function mountSkillRoutes(app, { db, requireAuth, requireSameOrigin }) {
  const store = createSkillStore(db);
  const handle = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (off()) return res.status(503).json({ error: 'unavailable', message: 'SKILLS=off' });
    try { await fn(req, res); } catch (e) {
      if (/does not exist/u.test(String(e && e.message))) return res.status(503).json({ error: 'unavailable', message: 'Jadval hali yaratilmagan (migratsiya 044).' });
      if (!e.status) console.warn('[SKILLS]', req.method, req.path, e.message);
      res.status(e.status || 500).json({ error: e.status === 404 ? 'not_found' : 'failed', message: e.status ? e.message : 'Saqlab bo‘lmadi.' });
    }
  };
  const me = req => req.session.adminId;
  app.get('/api/skills', requireAuth, handle(async (req, res) => res.json({ skills: await store.list(me(req)), max: MAX() })));
  app.post('/api/skills', requireSameOrigin, requireAuth, handle(async (req, res) => res.status(201).json(await store.create(me(req), req.body || {}))));
  app.post('/api/skills/import', requireSameOrigin, requireAuth, handle(async (req, res) => {
    const out = await store.importList(me(req), (req.body || {}).skills);
    res.json({ ...out, skills: await store.list(me(req)) });
  }));
  app.put('/api/skills/:id', requireSameOrigin, requireAuth, handle(async (req, res) => res.json(await store.update(me(req), req.params.id, req.body || {}))));
  app.delete('/api/skills/:id', requireSameOrigin, requireAuth, handle(async (req, res) => res.json(await store.remove(me(req), req.params.id))));
  return store;
}

module.exports = { mountSkillRoutes, createSkillStore, readSkill };
