'use strict';

/**
 * Matters over HTTP (2026-10-28, docs/design/matter-va-agent-runs.md 2.3).
 * Every route needs a session; writes also need this site's Origin/Referer.
 * Another account's matter is 404, never 403.
 *
 *   GET    /api/matters                       own matters and those of the caller's Workspaces
 *   POST   /api/matters                       { title, summary?, workspaceId? }
 *   GET    /api/matters/:id                   the matter and its items (sources checked)
 *   PATCH  /api/matters/:id                   { title?, summary?, status? }
 *   DELETE /api/matters/:id                   owner only, soft
 *   POST   /api/matters/:id/items             { kind: chat|scan|note, ref?, title?, note? }
 *   DELETE /api/matters/:id/items/:itemId     the link only
 *
 * `MATTERS=off` answers 503 on all of them.
 */

const { createMatterStore, MatterError } = require('./store');

function mountMatterRoutes(app, { requireAuth, requireSameOrigin, pool, resolveEntitlement = null }) {
  const store = createMatterStore({ db: pool, resolveEntitlement });
  const off = () => String(process.env.MATTERS || '').toLowerCase() === 'off';
  const guard = (fn) => async (req, res) => {
    if (off()) return res.status(503).json({ error: 'unavailable', message: "Ishlar bo'limi vaqtincha o'chirilgan" });
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof MatterError) return res.status(e.status).json({ error: e.code, message: e.message });
      // a database without the 019 tables
      if (e && e.code === '42P01') return res.status(503).json({ error: 'unavailable', message: "Ishlar bo'limi hali tayyor emas" });
      console.error('[MATTERS]', req.method, req.path, e.message);
      res.status(500).json({ error: 'failed', message: "So'rovni bajarib bo'lmadi" });
    }
  };
  const notFound = res => res.status(404).json({ error: 'not_found', message: 'Ish topilmadi' });
  const me = req => req.session.adminId;

  app.get('/api/matters', requireAuth, guard(async (req, res) => {
    res.json({ matters: await store.list(me(req)) });
  }));
  app.post('/api/matters', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const b = req.body || {};
    res.status(201).json(await store.create(me(req), { title: b.title, summary: b.summary, workspaceId: b.workspaceId }));
  }));
  app.get('/api/matters/:id', requireAuth, guard(async (req, res) => {
    const m = await store.get(req.params.id, me(req));
    if (!m) return notFound(res);
    res.set('Cache-Control', 'no-store').json(m);
  }));
  app.patch('/api/matters/:id', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const b = req.body || {};
    const m = await store.update(req.params.id, me(req), { title: b.title, summary: b.summary, status: b.status });
    if (!m) return notFound(res);
    res.json(m);
  }));
  app.delete('/api/matters/:id', requireSameOrigin, requireAuth, guard(async (req, res) => {
    if (!(await store.remove(req.params.id, me(req)))) return notFound(res);
    res.status(204).end();
  }));
  app.post('/api/matters/:id/items', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const b = req.body || {};
    const item = await store.addItem(req.params.id, me(req), { kind: b.kind, ref: b.ref, title: b.title, note: b.note });
    if (!item) return notFound(res);
    res.status(201).json(item);
  }));
  app.delete('/api/matters/:id/items/:itemId', requireSameOrigin, requireAuth, guard(async (req, res) => {
    if (!(await store.removeItem(req.params.id, req.params.itemId, me(req)))) return notFound(res);
    res.status(204).end();
  }));

  return store;
}

module.exports = { mountMatterRoutes };
