'use strict';

/**
 * Maintenance switch (2026-10-06), for a rollback with no in-between state:
 * MAINTENANCE_MODE=on (a Render environment change, which restarts the
 * service) makes the running release take no work - every API request but
 * /api/health gets 503, and the Telegram bot answers with a short notice
 * without any AI call or usage row - so the database can be put in order
 * (scripts/rollback/*.sql) before the other release starts serving.
 * docs/tariffs-v2-rollback.md has the order. Off unless set.
 */

function maintenanceOn(env = process.env) {
  return String(env.MAINTENANCE_MODE || '').toLowerCase() === 'on';
}

const MESSAGE = "Texnik ishlar olib borilmoqda. Bir necha daqiqadan so'ng qayta urinib ko'ring.";

/** Express middleware: 503 for every API request except the health check. */
function maintenanceGate(env = process.env) {
  return (req, res, next) => {
    if (!maintenanceOn(env)) return next();
    const p = String(req.path || req.url || '');
    if (!p.startsWith('/api/') || p === '/api/health') return next();
    res.set('Retry-After', '300');
    return res.status(503).json({ error: 'maintenance', code: 'MAINTENANCE', message: MESSAGE });
  };
}

module.exports = { maintenanceOn, maintenanceGate, MESSAGE };
