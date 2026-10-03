'use strict';

/**
 * Google sign-in must start and finish on the same host (2026-10-03).
 *
 * The OAuth state is kept in the session (Astra audit S4), so the session
 * cookie set when /auth/google starts has to come back on the callback. The
 * callback URL is fixed - APP_URL, else the Render hostname - but a user can
 * start from another host (www.juristai.uz, the *.onrender.com address, an
 * old bookmark): Google then returns them to a host where that cookie does
 * not exist, the state check fails and every attempt ends in google_failed.
 * /auth/google now first moves the browser to the callback's host.
 */

/** Origin the Google callback is registered on, e.g. https://juristai.uz. */
function oauthBase(env = process.env) {
  const raw = env.APP_URL || (env.RENDER_EXTERNAL_HOSTNAME ? `https://${env.RENDER_EXTERNAL_HOSTNAME}` : 'http://localhost:3000');
  return String(raw).replace(/\/+$/u, '');
}

function oauthRedirectUri(env = process.env) {
  return `${oauthBase(env)}/auth/google/callback`;
}

/**
 * Where to send a browser that opened /auth/google on another host, or null
 * when it is already on the callback's host. Only the path and query of this
 * request are carried over.
 */
function canonicalAuthRedirect({ host, originalUrl }, env = process.env) {
  let target;
  try { target = new URL(oauthBase(env)); } catch (_) { return null; }
  const here = String(host || '').toLowerCase();
  if (!here || here === target.host.toLowerCase()) return null;
  const path = String(originalUrl || '/auth/google');
  if (!path.startsWith('/auth/google')) return null;
  return `${target.origin}${path}`;
}

module.exports = { oauthBase, oauthRedirectUri, canonicalAuthRedirect };
