'use strict';

/**
 * Purge stale law_text chunks that have no embedding.
 *
 * Safe to run at any time: only removes rows where:
 *   - source_type = 'law_text'  (never touches verified_qa)
 *   - embedding IS NULL         (useless for vector search)
 *
 * This clears old ingest runs that crashed before embedding completed.
 * Run before a fresh ingest to avoid accumulating duplicate stale rows.
 *
 *   node src/eval/db-purge.js          # dry run (shows count, no delete)
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

  // Count what would be deleted
  const count = await pool.query(`
    SELECT COUNT(*) AS n
    FROM legal_chunks
    WHERE embedding IS NULL
      AND source_type = 'law_text'
  `);
  const n = parseInt(count.rows[0].n);

  // Show a breakdown by law so the operator knows what will be removed
  const breakdown = await pool.query(`
    SELECT law_name, category, COUNT(*) AS rows
    FROM legal_chunks
    WHERE embedding IS NULL AND source_type = 'law_text'
    GROUP BY law_name, category
    ORDER BY rows DESC
  `);

  console.log('─'.repeat(60));
  console.log(DRY_RUN ? 'DB-PURGE DRY RUN (add --confirm to actually delete)' : 'DB-PURGE CONFIRMED');
  console.log('─'.repeat(60));
  console.log(`\nRows to purge (embedding=NULL, source_type=law_text): ${n}\n`);

  for (const r of breakdown.rows) {
    console.log(`  ${(r.law_name || '').slice(0, 45).padEnd(47)} [${r.category}]  ${r.rows} rows`);
  }

  // Show how many verified_qa rows are safe
  const safe = await pool.query(`SELECT COUNT(*) AS n FROM legal_chunks WHERE source_type = 'verified_qa'`);
  console.log(`\nVerified QA rows (untouched): ${safe.rows[0].n}`);

  if (DRY_RUN) {
    console.log('\n─'.repeat(60));
    console.log('Dry run complete. Run with --confirm to delete these rows.');
    console.log('─'.repeat(60));
  } else {
    const del = await pool.query(`
      DELETE FROM legal_chunks
      WHERE embedding IS NULL
        AND source_type = 'law_text'
    `);
    console.log(`\n` + '─'.repeat(60));
    console.log(`Deleted ${del.rowCount} stale rows.`);
    console.log('─'.repeat(60));
  }

  await pool.end();
}

main().catch(err => {
  console.error('[DB-PURGE] Fatal:', err.message);
  process.exit(1);
});
