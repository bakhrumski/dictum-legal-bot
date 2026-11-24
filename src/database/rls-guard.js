'use strict';

// Row Level Security on every table in `public` (Supabase security advisor,
// 2026-11-22: rls_disabled_in_public, sensitive_columns_exposed).
//
// Supabase serves `public` through its REST API (PostgREST) to the `anon` and
// `authenticated` roles. A table without RLS there can be read, changed and
// emptied by anyone who has the project URL and the public anon key - the key
// the Workspace page is given for Realtime. The server itself never goes
// through that API: it connects as the role that owns the tables, and an
// owner is not held by RLS unless FORCE is set (it never is here). So turning
// RLS on with no policy closes the API and changes nothing for the server.
// Tables that already have RLS (Workspace, with its own policies) are left
// exactly as they are.
//
// Many tables are still created by the server at boot or lazily
// (CREATE TABLE IF NOT EXISTS), so this runs after the boot migrations and
// then on a timer, not once. Only tables owned by the server's role are
// changed; another owner's table is named in the log (names only, no data).
// RLS_GUARD=off stops it.

const LIST_SQL = `
  SELECT c.relname AS name,
         pg_get_userbyid(c.relowner) AS owner,
         pg_get_userbyid(c.relowner) = current_user AS mine
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND NOT c.relrowsecurity
   ORDER BY c.relname`;

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

async function enableRlsEverywhere(pool, { log = console } = {}) {
  if (process.env.RLS_GUARD === 'off') return { enabled: [], foreign: [], skipped: 'off' };
  const { rows } = await pool.query(LIST_SQL);
  const enabled = [];
  const foreign = [];
  const failed = [];
  for (const row of rows) {
    if (!row.mine) { foreign.push(`${row.name} (${row.owner})`); continue; }
    try {
      await pool.query(`ALTER TABLE public.${quoteIdent(row.name)} ENABLE ROW LEVEL SECURITY`);
      enabled.push(row.name);
    } catch (error) {
      failed.push(row.name);
      log.warn(`[RLS] Could not enable on public.${row.name}: ${error.message}`);
    }
  }
  if (enabled.length) log.log(`[RLS] Enabled on ${enabled.length} table(s): ${enabled.join(', ')}`);
  if (foreign.length) log.warn(`[RLS] Not owned by the server's role, left as is: ${foreign.join(', ')}`);
  return { enabled, foreign, failed };
}

function startRlsGuard(pool, { intervalMs = 60 * 60 * 1000, log = console } = {}) {
  if (process.env.RLS_GUARD === 'off') {
    log.warn('[RLS] Guard disabled by RLS_GUARD=off');
    return null;
  }
  const run = () => enableRlsEverywhere(pool, { log })
    .catch((error) => log.warn(`[RLS] Guard run failed: ${error.message}`));
  run();
  const timer = setInterval(run, intervalMs);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { enableRlsEverywhere, startRlsGuard, LIST_SQL, quoteIdent };
