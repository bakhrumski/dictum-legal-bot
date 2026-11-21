'use strict';

/**
 * X2 of the 2026-11-10 audit (S6): a Content-Security-Policy for the new app's pages (/app/).
 * The app has no inline event handlers, so a policy can hold there (the old dashboard, the
 * landing and the Word pane are not covered). With it, a missed escape somewhere in a page no
 * longer runs an attacker's script with the person's session: scripts load only from this site
 * and the three places the app itself uses, and the page talks only to this site and the
 * Workspace's realtime service.
 *
 *   script-src  'self', the inline boot scripts of each page by their sha256 (read from the
 *               files at start, so an edit never needs a matching edit here), cdn.jsdelivr.net
 *               (the Workspace's realtime client, the sign-in device check), telegram.org
 *               (Telegram's sign-in button)
 *   style-src   'self' 'unsafe-inline' (the pages set inline styles; a style cannot run code)
 *   connect-src 'self', this host's WebSocket (live co-editing), SUPABASE_URL (Workspace realtime)
 *   frame-src   oauth.telegram.org (Telegram's sign-in window)
 *
 * APP_CSP=off sends nothing; APP_CSP=report sends it as Report-Only (the browser logs, blocks nothing).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** The sha256 of every inline <script> (no src, not JSON) of an HTML text, as CSP sources. */
function inlineScriptHashes(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/giu;
  let m;
  while ((m = re.exec(String(html || '')))) {
    if (/type=["']application\/(ld\+)?json["']/iu.test(m[1]) || !m[2]) continue;
    out.push(`'sha256-${crypto.createHash('sha256').update(m[2], 'utf8').digest('base64')}'`);
  }
  return out;
}

function originOf(url) { try { return new URL(String(url)).origin; } catch (_) { return null; } }

function buildPolicy({ hashes = [], host = null, supabaseUrl = null, secure = true } = {}) {
  const supa = originOf(supabaseUrl);
  const ws = [host ? `${secure ? 'wss' : 'ws'}://${host}` : null, supa ? supa.replace(/^http/u, 'ws') : null].filter(Boolean);
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')} https://cdn.jsdelivr.net https://telegram.org`.replace(/\s+/gu, ' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://telegram.org https://t.me",
    "font-src 'self' data:",
    `connect-src 'self' ${[supa, ...ws].filter(Boolean).join(' ')}`.trim(),
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    'frame-src https://oauth.telegram.org https://telegram.org',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ');
}

/** Express middleware for /app: the header on the app's HTML pages only. */
function createAppCsp({ dir = path.join(__dirname, '..', '..', 'public', 'app'), env = process.env } = {}) {
  const mode = String(env.APP_CSP || 'on').toLowerCase();
  const pages = new Map(); // "/index.html" -> hashes
  try {
    for (const f of fs.readdirSync(dir)) if (/\.html$/u.test(f)) pages.set(`/${f}`, inlineScriptHashes(fs.readFileSync(path.join(dir, f), 'utf8')));
  } catch (e) { console.warn('[CSP] app pages not read:', e.message); }
  return function appCsp(req, res, next) {
    if (mode === 'off' || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
    const page = req.path === '/' || req.path === '' ? '/index.html' : req.path;
    if (!pages.has(page)) return next();
    res.setHeader(mode === 'report' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy',
      buildPolicy({ hashes: pages.get(page), host: req.get('host'), secure: !!req.secure, supabaseUrl: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL }));
    next();
  };
}

module.exports = { createAppCsp, buildPolicy, inlineScriptHashes };
