#!/usr/bin/env node
'use strict';

/**
 * The Plenum corpus from lex.uz (S1, docs/design/sud-amaliyoti.md), by hand.
 * Boshqaruv -> "Sud amaliyoti" runs the same thing from the site.
 *
 *   node scripts/plenum-ingest.js            dry: reads, writes nothing but the report
 *   node scripts/plenum-ingest.js --limit 5  dry, the first 5 decisions only
 *   node scripts/plenum-ingest.js --apply    writes (the owner's step on the live database)
 *
 * Needs DATABASE_URL (the run's report is written in plenum_sync_runs).
 */

require('dotenv').config();
const { Pool } = require('pg');
const { createPlenumSync } = require('../src/plenum/sync');

(async () => {
  const args = process.argv.slice(2);
  const mode = args.includes('--apply') ? 'apply' : 'dry';
  const li = args.indexOf('--limit');
  const limit = li > -1 ? Number(args[li + 1]) || null : null;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } });
  try {
    const r = await createPlenumSync({ db: pool, log: m => console.log(m) }).run({ mode, limit });
    const { failed, partialEditions, ...rest } = r;
    console.log(JSON.stringify(rest, null, 2));
    if (failed.length) { console.log(`Failed (${failed.length}):`); failed.forEach(f => console.log(`  ${f.id}  ${f.why}  ${f.title}`)); }
    if (partialEditions.length) console.log(`Editions missing: ${partialEditions.length}`);
  } catch (e) { console.error('Error:', e.message); process.exitCode = 1; } finally { await pool.end(); }
})();
