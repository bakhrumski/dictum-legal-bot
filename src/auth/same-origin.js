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
  const origin = req.get('origin');
  const referer = req.get('referer');
  const from = origin && origin !== 'null' ? hostOf(origin) : (referer ? hostOf(referer) : null);
  if (from && allowedHosts(req).has(from)) return next();
  return res.status(403).json({ error: 'cross_site', message: "So'rov JuristAI saytidan kelmadi." });
}

module.exports = { requireSameOrigin, allowedHosts };
