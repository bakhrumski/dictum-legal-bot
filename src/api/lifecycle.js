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
 * Long responses that are still open (the chat's answer stream, the staff
 * event stream): shutdown waits for them, and the ones still open at the end
 * are told why they end (onShutdown) instead of being cut silently - a cut
 * stream read "Javob uzildi" on the page with no cause (2026-11-06).
 */
const openStreams = new Map(); // res -> { onShutdown, wait }
/** opts.wait false: a stream that never ends by itself (the staff event feed) is ended at once, not waited for. */
function trackStream(res, onShutdown, { wait = true } = {}) {
  const end = () => { try { res.end(); } catch (_) { /* gone */ } };
  openStreams.set(res, { onShutdown: typeof onShutdown === 'function' ? onShutdown : end, wait: !!wait });
  const off = () => openStreams.delete(res);
  if (res && typeof res.on === 'function') { res.on('close', off); res.on('finish', off); }
  return off;
}
const waiting = () => Array.from(openStreams.values()).filter(x => x.wait).length;
const openStreamCount = () => openStreams.size;
function endStreams(filter) {
  for (const [res, x] of Array.from(openStreams)) {
    if (!filter(x)) continue;
    openStreams.delete(res);
    try { x.onShutdown(); } catch (err) { console.warn('[SHUTDOWN] stream notice failed:', err.message); }
  }
}
let stopping = false;
const isShuttingDown = () => stopping;

/** SHUTDOWN_WAIT_MS: how long a shutdown waits for open answers (5 s - 290 s, default 25 s). */
function shutdownWaitMs(env = process.env) {
  const n = Number(env.SHUTDOWN_WAIT_MS);
  if (!Number.isFinite(n) || n <= 0) return 25000;
  return Math.max(5000, Math.min(290000, Math.round(n)));
}

/**
 * SIGTERM/SIGINT: stop accepting connections, stop the polling bot so the
 * next instance does not get 409 Conflict, save what lives only in memory
 * (beforeClose: the editor's live documents), let the open answer streams
 * finish, tell the ones still open why they end, close the pool, exit.
 * Render sends SIGTERM on every deploy and kills the process after its
 * shutdown delay (30 s unless the service sets maxShutdownDelaySeconds, up
 * to 300 s); timeoutMs (SHUTDOWN_WAIT_MS) must stay below it.
 */
function installGracefulShutdown({ server, pool, stopBots = [], beforeClose = [], timeoutMs = shutdownWaitMs(), exit = process.exit, log = console, pollMs = 250 }) {
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true; stopping = true;
    const started = Date.now();
    // the last moment the open streams are told and the process ends, before the platform kills it
    const deadline = started + Math.max(1000, timeoutMs - 1500);
    log.log(`[SHUTDOWN] ${signal} received, closing (${waiting()} open answer(s), waiting up to ${Math.round(timeoutMs / 1000)} s)`);
    endStreams(x => !x.wait);
    const force = setTimeout(() => {
      log.warn('[SHUTDOWN] timed out waiting for open connections, exiting');
      exit(0);
    }, timeoutMs);
    if (force.unref) force.unref();
    for (const stop of stopBots) {
      try { await stop(); } catch (err) { log.warn('[SHUTDOWN] bot stop failed:', err.message); }
    }
    for (const fn of beforeClose) {
      try { await fn(); } catch (err) { log.warn('[SHUTDOWN] before-close step failed:', err.message); }
    }
    let closed = !server;
    if (server) {
      server.close(() => { closed = true; });
      if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    }
    // the open answers finish on their own while there is time
    while (waiting() && Date.now() < deadline) await new Promise(r => setTimeout(r, pollMs));
    if (openStreams.size) {
      log.warn(`[SHUTDOWN] ${openStreams.size} answer(s) still open, telling them the server restarts`);
      endStreams(() => true);
      await new Promise(r => setTimeout(r, Math.min(500, pollMs * 2))); // the last frames leave
    }
    // keep-alive and upgraded sockets would hold server.close() to the end
    if (server && !closed && typeof server.closeAllConnections === 'function') server.closeAllConnections();
    try { if (pool) await pool.end(); } catch (err) { log.warn('[SHUTDOWN] pool end failed:', err.message); }
    clearTimeout(force);
    log.log(`[SHUTDOWN] done in ${Math.round((Date.now() - started) / 100) / 10} s`);
    exit(0);
  }
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  return shutdown;
}

module.exports = { jsonErrorHandler, waitForDatabase, installGracefulShutdown, trackStream, openStreamCount, isShuttingDown, shutdownWaitMs, SERVER_ERROR_MESSAGE };
