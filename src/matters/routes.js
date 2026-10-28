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
 *   POST   /api/matters/command               { text, lastMatterId } | { confirm } | { cancel }:
 *                                             a typed or dictated command (src/matters/commands.js)
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

  // a typed or dictated command (src/matters/commands.js): { text, lastMatterId } or { confirm } / { cancel }
  app.post('/api/matters/command', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const commands = require('./commands');
    const b = req.body || {};
    const lang = b.lang === 'ru' || /[\u0400-\u04ff]/u.test(String(b.text || '')) ? 'ru' : 'uz';
    if (b.cancel) { commands.cancelConfirm(b.cancel, me(req)); return res.json({ action: 'matter_confirm_cancelled' }); }
    if (b.confirm) return res.json(await commands.confirmCommand(b.confirm, { adminId: me(req), store, lang }));
    const cmd = commands.parseCommand(b.text);
    if (!cmd) return res.status(422).json({ error: 'not_a_command', message: lang === 'ru' ? 'Команда не распознана. Примеры: «мои дела», «новое дело: …», «заметка в дело …: …».' : "Buyruq tushunilmadi. Masalan: «ishlarim», «yangi ish och: …», «… ishiga yozuv: …»." });
    const out = await commands.runCommand(cmd, { adminId: me(req), store, lang, lastId: b.lastMatterId || null });
    res.json({ command: cmd.action, ...out });
  }));

  return store;
}

module.exports = { mountMatterRoutes };
