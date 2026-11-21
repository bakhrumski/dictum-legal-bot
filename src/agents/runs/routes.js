'use strict';

/**
 * Following an agent run (2026-10-28, docs/design/matter-va-agent-runs.md
 * 3.5). The person's own runs only; anyone else's is 404.
 *
 *   GET  /api/agent/runs                 the last runs (no result)
 *   GET  /api/agent/runs/:id             status, steps, and the result once it ended
 *   GET  /api/agent/runs/:id/events      SSE: `step` for each new or changed step, `done` with the result
 *   POST /api/agent/runs/:id/cancel      a queued run ends now, a running one before its next step
 *   PUT  /api/agent/runs/:id/tags        a finished table's row tags { tags: { d1: ['muhim'] } }
 *
 * The SSE stream reads the database (the run may be worked by another
 * process after a deploy), every `pollMs`, with a heartbeat every 25 s, and
 * closes at the end or after `maxStreamMs`.
 */

const { TERMINAL } = require('./store');
const { normTags } = require('../workflows/tabular-export');

function mountRunRoutes(app, { requireAuth, requireSameOrigin, store, pollMs = 1500, maxStreamMs = 20 * 60 * 1000, kick = null }) {
  const notFound = res => res.status(404).json({ error: 'not_found', message: 'Agent ishi topilmadi' });
  const me = req => req.session.adminId;
  const safe = fn => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e && e.code === '42P01') return res.status(503).json({ error: 'unavailable', message: "Agent ishlari hali tayyor emas" });
      console.error('[AGENT-RUN]', req.method, req.path, e.message);
      if (!res.headersSent) res.status(500).json({ error: 'failed' });
    }
  };

  app.get('/api/agent/runs', requireAuth, safe(async (req, res) => {
    res.set('Cache-Control', 'no-store').json({ runs: await store.list(me(req), { limit: req.query && req.query.limit }) });
  }));

  app.get('/api/agent/runs/:id', requireAuth, safe(async (req, res) => {
    const run = await store.get(req.params.id, me(req));
    if (!run) return notFound(res);
    res.set('Cache-Control', 'no-store').json(run);
  }));

  app.post('/api/agent/runs/:id/cancel', requireSameOrigin, requireAuth, safe(async (req, res) => {
    const r = await store.requestCancel(req.params.id, me(req));
    if (!r) return notFound(res);
    if (kick) kick();
    res.json({ id: r.id, status: r.status, cancelRequested: !TERMINAL.includes(r.status) });
  }));

  app.put('/api/agent/runs/:id/tags', requireSameOrigin, requireAuth, safe(async (req, res) => {
    if (typeof store.setTags !== 'function') return notFound(res);
    const tags = normTags(req.body && req.body.tags);
    if (!(await store.setTags(req.params.id, me(req), tags))) return notFound(res);
    res.json({ tags });
  }));

  app.get('/api/agent/runs/:id/events', requireAuth, safe(async (req, res) => {
    const first = await store.get(req.params.id, me(req));
    if (!first) return notFound(res);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) { /* gone */ } };
    const seen = new Map();
    let closed = false;
    const started = Date.now();
    const hb = setInterval(() => { try { res.write(':hb\n\n'); } catch (_) { /* gone */ } }, 25000);
    const end = () => { if (closed) return; closed = true; clearInterval(hb); try { res.end(); } catch (_) { /* gone */ } };
    req.on('close', end);
    send('status', { id: first.id, workflow: first.workflow, status: first.status });
    let run = first;
    while (!closed) {
      for (const s of run.steps) {
        const key = `${s.status}|${s.ms}`;
        if (seen.get(s.id) !== key) { seen.set(s.id, key); send('step', s); }
      }
      if (TERMINAL.includes(run.status)) { send('done', { status: run.status, result: run.result }); break; }
      if (Date.now() - started > maxStreamMs) { send('timeout', { status: run.status }); break; }
      await new Promise(r => setTimeout(r, pollMs));
      if (closed) break;
      run = await store.get(req.params.id, me(req));
      if (!run) break;
    }
    end();
  }));
}

module.exports = { mountRunRoutes };
