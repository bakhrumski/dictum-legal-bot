'use strict';

/**
 * Minimal structured JSON logger.
 *
 * Usage:
 *   const log = require('../utils/logger').createLogger('HYBRID');
 *   log.info('callWithFallback ok', { model, cost });
 *   log.warn('provider failed', { model, err: err.message });
 *
 * Output format (one JSON object per line on stdout/stderr):
 *   {"ts":"2026-06-20T10:00:00.000Z","level":"info","module":"HYBRID","msg":"...","model":"..."}
 *
 * Control verbosity with LOG_LEVEL env var (debug|info|warn|error). Default: info.
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const _currentLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function _write(level, module, msg, extra) {
  if ((LEVELS[level] ?? 0) < _currentLevel) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    module,
    msg,
    ...extra,
  };
  const dest = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  dest.write(JSON.stringify(entry) + '\n');
}

function createLogger(module) {
  return {
    debug: (msg, extra = {}) => _write('debug', module, msg, extra),
    info:  (msg, extra = {}) => _write('info',  module, msg, extra),
    warn:  (msg, extra = {}) => _write('warn',  module, msg, extra),
    error: (msg, extra = {}) => _write('error', module, msg, extra),
  };
}

module.exports = { createLogger };
