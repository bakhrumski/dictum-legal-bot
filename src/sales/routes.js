'use strict';

/**
 * CustDev pilot agents over HTTP (2026-10-28, src/sales/agents.js).
 *
 * Master (session master, and the role checked again in the database):
 *   GET  /api/admin/sales/agents                       staff accounts, codes, demo, clients registered / piloted / paid
 *   POST /api/admin/sales/agents/:id/code              give (or renew) an offer code
 *   POST /api/admin/sales/agents/:id/code/revoke       take it back
 *   POST /api/admin/sales/agents/:id/demo  { userId }  link a master-made test account as the agent's demo + 14-day pilot entitlement
 *   GET  /api/admin/sales/pilot-requests?status=       pending / approved / declined
 *   POST /api/admin/sales/pilot-requests/:id/approve   the 14-day pilot entitlement (docs/tariffs-v2.md §10)
 *   POST /api/admin/sales/pilot-requests/:id/decline   { note }
 *   POST /api/admin/sales/clients/:id/type  { type }   correct a client's type (then the standing rule is tried)
 * Agent (a staff account with a code):
 *   GET  /api/sales/me                                 own code, links, demo, own clients (no question or answer text)
 *   POST /api/sales/clients/:id/type        { type }   correct the type of a client who came through this agent
 * Stage 3 (src/sales/pilot-workspace.js; the client's agent or a master, staff only):
 *   GET  /api/admin/sales/workspace / POST { name }    the pilot's internal Workspace (master opens it once)
 *   POST /api/sales/clients/:id/task                   open the client's task by hand
 *   GET  /api/sales/feedback                           feedback of own clients (master: all)
 *   POST /api/sales/feedback/:id/tag      { tag }      xato / chalkash / yangi_imkoniyat / narx
 *   POST /api/sales/feedback/:id/reply    { text, confirmed: true }   once the sub-task is done; sent once
 *   GET  /api/sales/feedback/weekly?days=7             by tag: feedback and distinct clients
 * Anyone signed in (an ordinary account):
 *   PUT  /api/client-type                   { type }   what I do: lawyer / accountant / hr / business / user
 *
 * Also: a GET with ?ref=<code> keeps the code in the jai_ref cookie (30 days,
 * httpOnly) for the registration to read; its validity is checked only then.
 */

const sales = require('./agents');
const pilotWs = require('./pilot-workspace');

const REF_COOKIE = 'jai_ref';
const PILOT_OPEN = "✅ 14 kunlik JuristAI pilotingiz boshlandi. Savollaringizni shu botga yoki saytga yozing; limitingizni «limitim qancha?» deb bilasiz.";

function refFromCookie(req) {
  const m = String((req.headers && req.headers.cookie) || '').match(/(?:^|;\s*)jai_ref=([a-z0-9]{10,16})(?:;|$)/u);
  return m ? m[1] : null;
}

function refCookieMiddleware(req, res, next) {
  if (req.method === 'GET' && req.query && typeof req.query.ref === 'string') {
    const c = sales.cleanCode(req.query.ref);
    // the first link opened stays: an existing cookie is not replaced
    if (c && !refFromCookie(req)) res.cookie(REF_COOKIE, c, { maxAge: 30 * 86400e3, httpOnly: true, sameSite: 'lax', secure: req.secure });
  }
  next();
}

function mountSalesRoutes(app, { pool, requireAuth, requireMasterAdmin, requireSameOrigin, ledger, logAudit = () => {}, botUsername, appUrl, notify = null, sendReply = null }) {
  const me = req => req.session.adminId;
  const safe = fn => async (req, res) => {
    try { res.set('Cache-Control', 'no-store'); await fn(req, res); } catch (e) {
      if (/does not exist/u.test(String(e && e.message))) return res.status(503).json({ error: 'unavailable', message: "Pilot jadvallari hali tayyor emas" });
      console.error('[SALES]', req.method, req.path, e.message);
      if (!res.headersSent) res.status(500).json({ error: 'failed' });
    }
  };
  const id = v => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  const reply = (res, out) => (out.ok ? res.json(out) : res.status(out.status || 400).json({ error: out.error, message: out.message || null }));

  app.get('/api/admin/sales/agents', requireMasterAdmin, safe(async (req, res) => { res.json({ agents: await sales.agentsOverview(pool) }); }));
  app.post('/api/admin/sales/agents/:id/code', requireSameOrigin, requireMasterAdmin, safe(async (req, res) => {
    const out = await sales.assignCode(pool, { masterId: me(req), agentId: id(req.params.id) });
    if (out.ok) logAudit(req, 'sales.agent_code', 'admin', id(req.params.id));
    reply(res, out);
  }));
  app.post('/api/admin/sales/agents/:id/code/revoke', requireSameOrigin, requireMasterAdmin, safe(async (req, res) => {
    const out = await sales.revokeCode(pool, { masterId: me(req), agentId: id(req.params.id) });
    if (out.ok) logAudit(req, 'sales.agent_code_revoke', 'admin', id(req.params.id));
    reply(res, out);
  }));
  app.post('/api/admin/sales/agents/:id/demo', requireSameOrigin, requireMasterAdmin, safe(async (req, res) => {
    const out = await sales.linkDemo(pool, { masterId: me(req), agentId: id(req.params.id), userId: id(req.body && req.body.userId), ledger });
    if (out.ok) logAudit(req, 'sales.agent_demo', 'admin', id(req.body && req.body.userId));
    reply(res, out);
  }));
  app.get('/api/admin/sales/pilot-requests', requireMasterAdmin, safe(async (req, res) => {
    res.json({ requests: await sales.listRequests(pool, { status: req.query && req.query.status }) });
  }));
  app.post('/api/admin/sales/pilot-requests/:id/approve', requireSameOrigin, requireMasterAdmin, safe(async (req, res) => {
    const out = await sales.approve(pool, { masterId: me(req), requestId: id(req.params.id), ledger });
    if (out.ok) {
      logAudit(req, 'sales.pilot_approve', 'admin', out.request.admin_id);
      if (notify) notify(out.request.admin_id, PILOT_OPEN).catch(() => {});
    }
    reply(res, out);
  }));
  app.post('/api/admin/sales/pilot-requests/:id/decline', requireSameOrigin, requireMasterAdmin, safe(async (req, res) => {
    const out = await sales.decline(pool, { masterId: me(req), requestId: id(req.params.id), note: req.body && req.body.note });
    if (out.ok) logAudit(req, 'sales.pilot_decline', 'admin', out.request.admin_id);
    reply(res, out);
  }));
  // a type change may open the pilot under the standing rule (src/sales/agents.js)
  const afterType = async (adminId) => {
    const r = await sales.maybeAutoApprove(pool, { adminId, ledger });
    if (r.approved && r.reason === 'auto' && notify) notify(adminId, PILOT_OPEN).catch(() => {});
    return r;
  };
  app.post('/api/admin/sales/clients/:id/type', requireSameOrigin, requireMasterAdmin, safe(async (req, res) => {
    const out = await sales.setClientType(pool, { adminId: id(req.params.id), type: req.body && req.body.type, by: 'master', actorId: me(req) });
    if (!out.ok) return reply(res, out);
    logAudit(req, 'sales.client_type', 'admin', id(req.params.id));
    res.json({ ...out, pilot: await afterType(id(req.params.id)) });
  }));
  app.post('/api/sales/clients/:id/type', requireSameOrigin, requireAuth, safe(async (req, res) => {
    const out = await sales.setClientType(pool, { adminId: id(req.params.id), type: req.body && req.body.type, by: 'agent', actorId: me(req) });
    if (!out.ok) return reply(res, out);
    logAudit(req, 'sales.client_type', 'admin', id(req.params.id));
    res.json({ ...out, pilot: await afterType(id(req.params.id)) });
  }));
  app.put('/api/client-type', requireSameOrigin, requireAuth, safe(async (req, res) => {
    const out = await sales.setClientType(pool, { adminId: me(req), type: req.body && req.body.type, by: 'self', actorId: me(req) });
    if (!out.ok) return reply(res, out);
    const pilot = await afterType(me(req));
    res.json({ ...out, pilot: { approved: !!pilot.approved } });
  }));
  // stage 3: staff only (the role read in the database); a client gets 404
  const staffOnly = async (req, res, next) => {
    try {
      const r = await pool.query('SELECT role FROM admins WHERE id = $1', [me(req)]);
      if (r.rows[0] && ['master', 'student', 'lawyer'].includes(r.rows[0].role)) return next();
    } catch (_) { /* below */ }
    res.status(404).json({ error: 'not_found' });
  };
  app.get('/api/admin/sales/workspace', requireMasterAdmin, safe(async (req, res) => { res.json({ workspace: await pilotWs.pilotWorkspace(pool) }); }));
  app.post('/api/admin/sales/workspace', requireSameOrigin, requireMasterAdmin, safe(async (req, res) => {
    const out = await pilotWs.openWorkspace(pool, { masterId: me(req), name: req.body && req.body.name });
    if (out.ok && !out.existed) logAudit(req, 'sales.pilot_workspace', 'workspace', null);
    reply(res, out);
  }));
  app.post('/api/sales/clients/:id/task', requireSameOrigin, requireAuth, staffOnly, safe(async (req, res) => {
    reply(res, await pilotWs.ensureClientTask(pool, { adminId: id(req.params.id), actorId: me(req) }));
  }));
  app.get('/api/sales/feedback', requireAuth, staffOnly, safe(async (req, res) => {
    res.json({ feedback: await pilotWs.listFeedback(pool, { actorId: me(req) }), tags: pilotWs.TAGS });
  }));
  app.get('/api/sales/feedback/weekly', requireAuth, staffOnly, safe(async (req, res) => {
    res.json(await pilotWs.weekly(pool, { actorId: me(req), days: req.query && req.query.days }));
  }));
  app.post('/api/sales/feedback/:id/tag', requireSameOrigin, requireAuth, staffOnly, safe(async (req, res) => {
    reply(res, await pilotWs.tagFeedback(pool, { feedbackId: id(req.params.id), tag: req.body && req.body.tag, actorId: me(req) }));
  }));
  app.post('/api/sales/feedback/:id/reply', requireSameOrigin, requireAuth, staffOnly, safe(async (req, res) => {
    const out = await pilotWs.replyFeedback(pool, { feedbackId: id(req.params.id), text: req.body && req.body.text, confirmed: !!(req.body && req.body.confirmed === true), actorId: me(req), send: sendReply });
    if (out.ok) logAudit(req, 'sales.feedback_reply', 'pilot_feedback', id(req.params.id));
    reply(res, out);
  }));
  app.get('/api/sales/me', requireAuth, safe(async (req, res) => {
    const page = await sales.agentPage(pool, { agentId: me(req), botUsername, appUrl });
    if (!page) return res.status(404).json({ error: 'not_an_agent' });
    res.json(page);
  }));
}

module.exports = { mountSalesRoutes, refCookieMiddleware, refFromCookie, REF_COOKIE, PILOT_OPEN };
