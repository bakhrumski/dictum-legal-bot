'use strict';

/**
 * Process lifecycle for the web server: waiting for the database at boot,
 * turning uncaught route errors into JSON, and shutting down cleanly on
 * SIGTERM. See docs/audit/findings/reliability.md C3 and H1.
 */

const SERVER_ERROR_MESSAGE = "Server xatoligi. Birozdan keyin qayta urinib ko'ring.";

/**
 * Express error handler (4 arguments). Express 5's default handler answers
 * with an HTML page and, because NODE_ENV is never set, a stack trace. This
 * answers JSON, logs 5xx with the stack, and never exposes internals.
 */
function jsonErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  let status = Number(err && (err.status || err.statusCode)) || 500;
  if (err && err.name === 'MulterError') status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  if (status < 400 || status > 599) status = 500;
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  if (status >= 500) {
    console.error(`[HTTP] ${req.method} ${path} failed:`, (err && err.stack) || err);
  }
  const message = status >= 500
    ? SERVER_ERROR_MESSAGE
    : (err && err.expose !== false && err.message) || "Noto'g'ri so'rov";
  return res.status(status).json({
    error: message,
    code: (err && typeof err.code === 'string' && status < 500) ? err.code : (status >= 500 ? 'server_error' : 'bad_request'),
  });
}

/**
 * Wait until the database answers before running boot migrations, so a
 * database that is still waking up does not become a half-started server.
 */
async function waitForDatabase(pool, { attempts = 6, delayMs = 5000, log = console } = {}) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1');
      if (i > 1) log.log(`[BOOT] database reachable on attempt ${i}`);
      return;
    } catch (err) {
      lastError = err;
      log.warn(`[BOOT] database not reachable (attempt ${i}/${attempts}): ${err.message}`);
      if (i < attempts) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

/**
 * SIGTERM/SIGINT: stop accepting connections, stop the polling bot so the
 * next instance does not get 409 Conflict, let in-flight requests finish,
 * close the pool, exit. Render waits 30 s after SIGTERM; open SSE streams
 * would hold server.close() forever, so the exit is forced before that.
 */
function installGracefulShutdown({ server, pool, stopBots = [], timeoutMs = 25000, exit = process.exit, log = console }) {
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.log(`[SHUTDOWN] ${signal} received, closing`);
    const force = setTimeout(() => {
      log.warn('[SHUTDOWN] timed out waiting for open connections, exiting');
      exit(0);
    }, timeoutMs);
    if (force.unref) force.unref();
    for (const stop of stopBots) {
      try { await stop(); } catch (err) { log.warn('[SHUTDOWN] bot stop failed:', err.message); }
    }
    await new Promise(resolve => {
      if (!server) return resolve();
      server.close(() => resolve());
      if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    });
    try { if (pool) await pool.end(); } catch (err) { log.warn('[SHUTDOWN] pool end failed:', err.message); }
    clearTimeout(force);
    log.log('[SHUTDOWN] done');
    exit(0);
  }
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  return shutdown;
}

module.exports = { jsonErrorHandler, waitForDatabase, installGracefulShutdown, SERVER_ERROR_MESSAGE };
