'use strict';

/**
 * Purge stale / inactive law_text chunks.
 *
 * Removes two classes of useless rows (verified_qa is NEVER touched):
 *   1. embedding IS NULL    — old ingest runs that crashed before embedding
 *   2. is_active = FALSE     — repealed / superseded documents that slipped
 *                             into the corpus from earlier ingests
 *
 * Search already excludes is_active = FALSE at query time, but physically
 * removing those rows keeps the corpus clean and prevents accidental
 * resurfacing if a query path ever forgets the filter.
 *
 *   node src/eval/db-purge.js          # dry run (shows counts, no delete)
 *   node src/eval/db-purge.js --confirm   # actually deletes
 */

require('dotenv').config();
const { pool } = require('../database/db');

const DRY_RUN = !process.argv.includes('--confirm');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('[DB-PURGE] DATABASE_URL is not set.');
    process.exit(1);
  }

  // Predicate shared by count, breakdown, and delete — keep them in lockstep
  // so the dry-run preview matches exactly what --confirm removes.
  const PURGE_WHERE = `
    source_type = 'law_text'
    AND (embedding IS NULL OR is_active = FALSE)
  `;

  // Count what would be deleted
  const count = await pool.query(`SELECT COUNT(*) AS n FROM legal_chunks WHERE ${PURGE_WHERE}`);
  const n = parseInt(count.rows[0].n);

  // Split the total by reason so the operator sees why each row goes
  const reasons = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE embedding IS NULL)                       AS null_embedding,
      COUNT(*) FILTER (WHERE is_active = FALSE)                       AS inactive,
      COUNT(*) FILTER (WHERE embedding IS NULL AND is_active = FALSE) AS both
    FROM legal_chunks
    WHERE source_type = 'law_text'
      AND (embedding IS NULL OR is_active = FALSE)
  `);
  const r = reasons.rows[0];

  // Show a breakdown by law so the operator knows what will be removed
  const breakdown = await pool.query(`
    SELECT law_name, category,
           COUNT(*) AS rows,
           COUNT(*) FILTER (WHERE embedding IS NULL) AS null_emb,
           COUNT(*) FILTER (WHERE is_active = FALSE) AS inactive
    FROM legal_chunks
    WHERE ${PURGE_WHERE}
    GROUP BY law_name, category
    ORDER BY rows DESC
  `);

  console.log('─'.repeat(60));
  console.log(DRY_RUN ? 'DB-PURGE DRY RUN (add --confirm to actually delete)' : 'DB-PURGE CONFIRMED');
  console.log('─'.repeat(60));
  console.log(`\nRows to purge (source_type=law_text): ${n}`);
  console.log(`  • null embedding : ${r.null_embedding}`);
  console.log(`  • inactive (is_active=false): ${r.inactive}`);
  console.log(`  • both reasons   : ${r.both}\n`);

  for (const row of breakdown.rows) {
    const flags = [];
    if (parseInt(row.null_emb) > 0) flags.push('null-emb');
    if (parseInt(row.inactive) > 0) flags.push('inactive');
    console.log(`  ${(row.law_name || '').slice(0, 40).padEnd(42)} [${row.category}]  ${row.rows} rows (${flags.join(', ')})`);
  }

  // Show how many verified_qa rows are safe
  const safe = await pool.query(`SELECT COUNT(*) AS n FROM legal_chunks WHERE source_type = 'verified_qa'`);
  console.log(`\nVerified QA rows (untouched): ${safe.rows[0].n}`);

  if (DRY_RUN) {
    console.log('\n' + '─'.repeat(60));
    console.log('Dry run complete. Run with --confirm to delete these rows.');
    console.log('─'.repeat(60));
  } else {
    const del = await pool.query(`DELETE FROM legal_chunks WHERE ${PURGE_WHERE}`);
    console.log(`\n` + '─'.repeat(60));
    console.log(`Deleted ${del.rowCount} stale/inactive rows.`);
    console.log('─'.repeat(60));
  }

  await pool.end();
}

main().catch(err => {
  console.error('[DB-PURGE] Fatal:', err.message);
  process.exit(1);
});
