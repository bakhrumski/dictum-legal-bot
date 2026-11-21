'use strict';

/**
 * X1 of the 2026-11-10 audit (S3): the legacy registration code (4 digits, 5
 * minutes, kept in memory by its deep-link token) had no attempt counter, so
 * a token's code could be tried until it matched. A wrong code now counts
 * against the token; after MAX_TRIES it is deleted and a new code must be
 * requested. An expired token is deleted when seen.
 */

const crypto = require('crypto');
const MAX_TRIES = 5;

const same = (a, b) => {
  const x = Buffer.from(String(a == null ? '' : a)), y = Buffer.from(String(b == null ? '' : b));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

/**
 * store: Map token -> { code, expiresAt, tries? ... }. Returns the entry when the code is
 * right (the caller deletes it when it is used up), else null.
 */
function checkCode(store, token, code, { now = Date.now(), maxTries = MAX_TRIES } = {}) {
  if (typeof token !== 'string' || !token) return null;
  const entry = store.get(token);
  if (!entry) return null;
  if (now > entry.expiresAt) { store.delete(token); return null; }
  if (same(entry.code, code)) return entry;
  entry.tries = (entry.tries || 0) + 1;
  if (entry.tries >= maxTries) store.delete(token);
  return null;
}

module.exports = { checkCode, MAX_TRIES };
