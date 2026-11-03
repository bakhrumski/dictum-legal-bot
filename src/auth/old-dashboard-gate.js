'use strict';

/**
 * The old dashboard is the master's only (2026-11-02, owner: "eski dashboardni,
 * boshqaruv panelni Master Admindan tashqari barcha uchun yopib qo'y").
 *
 * /dashboard.html (and /dashboard, /ai-dashboard.html, the design reference)
 * is served only to a signed-in account whose role is master in the database
 * (the session's role alone is not enough: a role changed since sign-in is
 * read again). Anyone else is sent to the new app: a signed-in person to
 * /app/ (?tab=jamoa -> /app/#/jamoa), a visitor to the sign-in page. The
 * page is never cached for a master either, so a browser cannot keep it.
 *
 * Registered before express.static, which would otherwise serve the file;
 * the session middleware is run here for these paths only.
 */

const GATED = new Set(['/dashboard.html', '/dashboard', '/ai-dashboard.html']);

function targetFor(req) {
  const tab = String((req.query && req.query.tab) || '');
  if (tab === 'jamoa') return '/app/#/jamoa';
  return '/app/';
}

function createOldDashboardGate({ getSession, verifyMaster }) {
  return function oldDashboardGate(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!GATED.has(req.path)) return next();
    const session = getSession();
    session(req, res, async (err) => {
      if (err) return next(err);
      const s = req.session || {};
      res.set('Cache-Control', 'no-store');
      if (!s.isAuthenticated) return res.redirect(302, '/login.html');
      let master = false;
      try { master = s.role === 'master' && !!s.adminId && await verifyMaster(s.adminId); } catch (_) { master = false; }
      if (!master) return res.redirect(302, targetFor(req));
      if (req.path === '/dashboard') return res.redirect(302, '/dashboard.html');
      return next();
    });
  };
}

module.exports = { createOldDashboardGate, GATED, targetFor };
