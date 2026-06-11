'use strict';

/**
 * Row-level diagnostic — dumps the columns that decide whether citations work.
 *
 * db-check says `article_number_display` is NULL everywhere even though the
 * structured ingest reports success. This shows, per row, whether the article
 * number survived as far as the stored chunk_id vs the display column, which
 * isolates a parser failure (empty chunk_id suffix) from a writer failure
 * (chunk_id has the number but article_number_display is NULL).
 *
 *   node src/eval/db-sample.js [doc_id]
 */

require('dotenv').config();
const { pool } = require('../database/db');

async function main() {
  const docId = process.argv[2] || null;

  // How many rows actually carry an article number in EITHER column.
  const coverage = await pool.query(`
    SELECT
      COUNT(*)                                                          AS rows,
      COUNT(*) FILTER (WHERE article_number_display IS NOT NULL)        AS has_display,
      COUNT(*) FILTER (WHERE article_numbers IS NOT NULL)              AS has_array,
      COUNT(*) FILTER (WHERE chunk_id ~ '_art_[^_]')                   AS chunkid_has_num,
      COUNT(*) FILTER (WHERE chunk_id LIKE '%\\_art\\_')               AS chunkid_empty_suffix
    FROM legal_chunks
    ${docId ? 'WHERE doc_id = $1' : ''}
  `, docId ? [docId] : []);
  const c = coverage.rows[0];

  console.log('─'.repeat(60));
  console.log(`COVERAGE${docId ? ` for doc_id=${docId}` : ' (whole corpus)'}`);
  console.log('─'.repeat(60));
  console.log(`  rows:                       ${c.rows}`);
  console.log(`  article_number_display set: ${c.has_display}`);
  console.log(`  article_numbers[] set:      ${c.has_array}`);
  console.log(`  chunk_id has a number:      ${c.chunkid_has_num}`);
  console.log(`  chunk_id ends in "_art_":   ${c.chunkid_empty_suffix}`);

  // Distinct doc_ids actually present (priority uses ids like fuqarolik-kodeks-1)
  const docs = await pool.query(`
    SELECT doc_id, COUNT(*) AS rows,
           COUNT(*) FILTER (WHERE article_number_display IS NOT NULL) AS disp
    FROM legal_chunks
    GROUP BY doc_id
    ORDER BY rows DESC
    LIMIT 20
  `);
  console.log('\n' + '─'.repeat(60));
  console.log('TOP doc_ids (id — rows — with display)');
  console.log('─'.repeat(60));
  for (const r of docs.rows) {
    console.log(`  ${String(r.doc_id || '(null)').padEnd(34)} rows=${String(r.rows).padStart(5)}  disp=${r.disp}`);
  }

  // Raw sample of the decisive columns.
  const sample = await pool.query(`
    SELECT chunk_id, chunk_type, article_number_display, article_numbers,
           (embedding IS NOT NULL) AS embedded
    FROM legal_chunks
    ${docId ? 'WHERE doc_id = $1' : ''}
    ORDER BY chunk_index
    LIMIT 12
  `, docId ? [docId] : []);
  console.log('\n' + '─'.repeat(60));
  console.log('SAMPLE ROWS');
  console.log('─'.repeat(60));
  for (const r of sample.rows) {
    console.log(`  id=${String(r.chunk_id || '(null)').padEnd(36)} type=${String(r.chunk_type || '?').padEnd(6)} disp=${JSON.stringify(r.article_number_display)} arr=${JSON.stringify(r.article_numbers)} emb=${r.embedded}`);
  }
  console.log('─'.repeat(60));

  await pool.end();
}

main().catch(err => {
  console.error('[DB-SAMPLE] Fatal:', err.message);
  process.exit(1);
});
