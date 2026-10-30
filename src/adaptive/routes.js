'use strict';

/**
 * The person's own adaptive profile over HTTP (2026-10-28, PR A2,
 * docs/design/adaptiv-akkaunt.md). Everything is the caller's own; writes
 * need this site's Origin. No AI.
 *
 *   GET    /api/adaptive/profile           profile, what they set, effective, area names
 *   PUT    /api/adaptive/profile           { manual }  answer length, script, hidden items, their side
 *   POST   /api/adaptive/profile/pause     { paused }  stop recording and use (or start again)
 *   POST   /api/adaptive/profile/clear     every signal, the profile and what they set go
 *   GET    /api/adaptive/signals?limit=    their recent signals as stored (codes)
 */

const { LENGTHS, ROLES } = require('./profile');

function mountAdaptiveRoutes(app, { requireAuth, requireSameOrigin, store, areaLabels = {} }) {
  const me = req => req.session.adminId;
  const safe = fn => async (req, res) => {
    try { res.set('Cache-Control', 'no-store'); await fn(req, res); } catch (e) {
      if (/relation "user_(signals|profile)" does not exist/u.test(String(e && e.message))) return res.status(503).json({ error: 'unavailable', message: "Moslashish hali tayyor emas" });
      console.error('[ADAPTIVE]', req.method, req.path, e.message);
      if (!res.headersSent) res.status(500).json({ error: 'failed' });
    }
  };
  const withLabels = p => ({ ...p, labels: { areas: areaLabels, lengths: LENGTHS, roles: ROLES } });

  app.get('/api/adaptive/profile', requireAuth, safe(async (req, res) => { res.json(withLabels(await store.get(me(req)))); }));
  app.put('/api/adaptive/profile', requireSameOrigin, requireAuth, safe(async (req, res) => {
    res.json(withLabels(await store.setManual(me(req), (req.body && req.body.manual) || {})));
  }));
  app.post('/api/adaptive/profile/pause', requireSameOrigin, requireAuth, safe(async (req, res) => {
    res.json(withLabels(await store.setPaused(me(req), !!(req.body && req.body.paused))));
  }));
  app.post('/api/adaptive/profile/clear', requireSameOrigin, requireAuth, safe(async (req, res) => { res.json(withLabels(await store.clear(me(req)))); }));
  app.get('/api/adaptive/signals', requireAuth, safe(async (req, res) => { res.json(await store.signals(me(req), { limit: req.query && req.query.limit })); }));
}

module.exports = { mountAdaptiveRoutes };
