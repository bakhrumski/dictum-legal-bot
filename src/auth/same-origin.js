'use strict';

/**
 * CSRF guard for state-changing auth endpoints (2026-10-07).
 *
 * The session cookie is SameSite=Lax, so a browser does not send it on a
 * cross-site POST. On top of that, these endpoints accept a request only
 * when it says it comes from this site: its Origin header - or, without one,
 * its Referer - must be this host (the Host the request came to, APP_URL or
 * RENDER_EXTERNAL_HOSTNAME). A request with neither header is refused: every
 * browser sends Origin on a POST made by fetch, so only a non-browser client
 * lacks both, and such a client has no victim's cookie to abuse.
 */

function hostOf(url) {
  try { return new URL(url).host.toLowerCase(); } catch (_) { return null; }
}

function allowedHosts(req, env = process.env) {
  const out = new Set();
  const h = req.get && req.get('host');
  if (h) out.add(String(h).toLowerCase());
  for (const v of [env.APP_URL, env.RENDER_EXTERNAL_HOSTNAME && `https://${env.RENDER_EXTERNAL_HOSTNAME}`]) {
    const x = v && hostOf(v);
    if (x) { out.add(x); out.add(x.startsWith('www.') ? x.slice(4) : `www.${x}`); }
  }
  return out;
}

function requireSameOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  // a Word / Google Docs task-pane token (src/addin/word-addin.js) is sent by
  // the pane itself, never by a browser on its own, so it cannot be forged
  // cross-site; such a request comes from Word or a Google sandbox origin
  if (req.addinTokenId) return next();
  const origin = req.get('origin');
  const referer = req.get('referer');
  const from = origin && origin !== 'null' ? hostOf(origin) : (referer ? hostOf(referer) : null);
  if (from && allowedHosts(req).has(from)) return next();
  return res.status(403).json({ error: 'cross_site', message: "So'rov JuristAI saytidan kelmadi." });
}

/**
 * The same check for a WebSocket upgrade (src/editor/live.js): a raw Node
 * request, and an Origin is required - every browser sends one on a
 * WebSocket, so a cross-site page cannot open a socket with this site's cookie.
 */
function isSameOrigin(req) {
  const h = req && req.headers ? req.headers : {};
  const wrap = { get: n => h[String(n).toLowerCase()] };
  const from = h.origin && h.origin !== 'null' ? hostOf(h.origin) : null;
  return !!from && allowedHosts(wrap).has(from);
}

/**
 * X2 of the 2026-11-10 audit (S7): one guard over every state-changing /api request, on top of
 * the stricter per-route requireSameOrigin. Most write routes relied on the SameSite=Lax cookie
 * alone, which a page on a sibling subdomain (same site) is not stopped by. Here a write is
 * refused when the browser itself says it comes from somewhere else: an Origin (or, without
 * one, a Referer) that is not this site, or Origin "null". A request with neither header is
 * let through - a browser always sends Origin on a cross-origin write, so such a request is
 * a server-side client (Telegram's webhook, a script) that carries no victim's cookie.
 * allow(req): requests that are allowed from another origin by design (the Word / Google Docs
 * pane's token routes); extraOrigins: CORS_ORIGINS.
 */
function createCrossSiteGuard({ allow = null, extraOrigins = [] } = {}) {
  const extra = new Set(extraOrigins.map(o => hostOf(o)).filter(Boolean));
  return function guardCrossSite(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.get('origin'), referer = req.get('referer');
    if (!origin && !referer) return next();
    if (typeof allow === 'function' && allow(req)) return next();
    const from = origin ? (origin === 'null' ? null : hostOf(origin)) : hostOf(referer);
    if (from && (allowedHosts(req).has(from) || extra.has(from))) return next();
    return res.status(403).json({ error: 'cross_site', message: "So'rov JuristAI saytidan kelmadi." });
  };
}

module.exports = { requireSameOrigin, allowedHosts, isSameOrigin, createCrossSiteGuard };
