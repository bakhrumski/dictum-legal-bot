'use strict';

/**
 * Landing page settings a master admin chooses in the dashboard.
 *
 *   bg   background decoration of the light sections:
 *        '1' grid (default), '2' dots, '3' colour wash, '5' § sign, '0' none
 *
 * Stored in site_settings (key 'landing'); read by the public landing through
 * GET /api/landing-config, written only through PUT /api/admin/landing-config.
 */

const BG_OPTIONS = ['1', '2', '3', '5', '0'];
const DEFAULTS = Object.freeze({ bg: '1' });
const KEY = 'landing';

async function ensureTable(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}',
    updated_by INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

function clean(value) {
  const v = value && typeof value === 'object' ? value : {};
  const bg = String(v.bg == null ? '' : v.bg);
  return { bg: BG_OPTIONS.includes(bg) ? bg : DEFAULTS.bg };
}

let cache = null;
let cacheAt = 0;
const TTL_MS = 30 * 1000;

async function read(pool) {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  try {
    const r = await pool.query('SELECT value FROM site_settings WHERE key = $1', [KEY]);
    cache = clean(r.rows[0] && r.rows[0].value);
  } catch (e) {
    cache = { ...DEFAULTS };
  }
  cacheAt = Date.now();
  return cache;
}

/** Returns the saved settings, or null with `error` when the input is invalid. */
async function write(pool, input, adminId) {
  const bg = String(input && input.bg != null ? input.bg : '');
  if (!BG_OPTIONS.includes(bg)) return { error: 'invalid_bg' };
  const value = { bg };
  await pool.query(
    `INSERT INTO site_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [KEY, JSON.stringify(value), Number.isInteger(adminId) ? adminId : null]
  );
  cache = value;
  cacheAt = Date.now();
  return { settings: value };
}

function _resetCache() { cache = null; cacheAt = 0; }

module.exports = { BG_OPTIONS, DEFAULTS, ensureTable, clean, read, write, _resetCache };
