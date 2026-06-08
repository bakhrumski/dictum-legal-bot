'use strict';

/**
 * Corpus health check — prints what's actually in the legal_chunks table.
 *
 * Run after an ingest to confirm chunks + embeddings landed before trusting
 * (or distrusting) the eval numbers.
 *
 *   node src/eval/db-check.js
 */

require('dotenv').config();
const { pool } = require('../database/db');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('[DB-CHECK] DATABASE_URL is not set.');
    process.exit(1);
  }

  // 1. Does the table exist at all?
  const tbl = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_name = 'legal_chunks'
    ) AS present
  `);
  if (!tbl.rows[0].present) {
    console.log('[DB-CHECK] Table legal_chunks does NOT exist. Ingest never ran successfully.');
    await pool.end();
    return;
  }

  // 2. Overall counts
  const totals = await pool.query(`
    SELECT
      COUNT(*)                                          AS total_rows,
      COUNT(*) FILTER (WHERE embedding IS NOT NULL)     AS with_embedding,
      COUNT(*) FILTER (WHERE article_number_display IS NOT NULL) AS with_article_display,
      COUNT(DISTINCT doc_id)                            AS distinct_docs,
      COUNT(DISTINCT law_name)                          AS distinct_laws
    FROM legal_chunks
  `);
  const t = totals.rows[0];

  console.log('─'.repeat(50));
  console.log('CORPUS TOTALS');
  console.log('─'.repeat(50));
  console.log(`  Total rows:            ${t.total_rows}`);
  console.log(`  Rows with embedding:   ${t.with_embedding}`);
  console.log(`  Rows w/ article_disp:  ${t.with_article_display}`);
  console.log(`  Distinct doc_ids:      ${t.distinct_docs}`);
  console.log(`  Distinct law_names:    ${t.distinct_laws}`);

  // 3. Embedding dimension actually stored
  const dim = await pool.query(`
    SELECT vector_dims(embedding) AS dims
    FROM legal_chunks
    WHERE embedding IS NOT NULL
    LIMIT 1
  `);
  if (dim.rows.length) {
    console.log(`  Embedding dimension:   ${dim.rows[0].dims}`);
  }

  // 4. Per-law breakdown
  const perLaw = await pool.query(`
    SELECT
      law_name,
      category,
      COUNT(*)                                       AS rows,
      COUNT(*) FILTER (WHERE embedding IS NOT NULL)  AS embedded,
      COUNT(*) FILTER (WHERE source_type = 'parent') AS parents,
      COUNT(*) FILTER (WHERE source_type = 'child')  AS children
    FROM legal_chunks
    GROUP BY law_name, category
    ORDER BY rows DESC
  `);

  console.log('\n' + '─'.repeat(50));
  console.log('PER-LAW BREAKDOWN');
  console.log('─'.repeat(50));
  if (perLaw.rows.length === 0) {
    console.log('  (no rows)');
  } else {
    for (const r of perLaw.rows) {
      console.log(`  ${(r.law_name || '(blank)').slice(0, 40).padEnd(42)} cat=${(r.category || '-').padEnd(14)} rows=${String(r.rows).padStart(4)} emb=${String(r.embedded).padStart(4)} P=${r.parents} C=${r.children}`);
    }
  }

  // 5. Sample article numbers from a couple of laws (so we can compare to gold)
  const sample = await pool.query(`
    SELECT law_name, article_number_display, source_type
    FROM legal_chunks
    WHERE article_number_display IS NOT NULL
    ORDER BY law_name, chunk_index
    LIMIT 20
  `);
  console.log('\n' + '─'.repeat(50));
  console.log('SAMPLE article_number_display VALUES');
  console.log('─'.repeat(50));
  if (sample.rows.length === 0) {
    console.log('  (none — article_number_display is empty everywhere)');
  } else {
    for (const r of sample.rows) {
      console.log(`  ${(r.law_name || '').slice(0, 30).padEnd(32)} art="${r.article_number_display}"  [${r.source_type}]`);
    }
  }

  console.log('\n' + '─'.repeat(50));
  if (Number(t.with_embedding) === 0) {
    console.log('VERDICT: No embeddings stored. Re-run `npm run ingest:fetch-all`.');
  } else if (Number(t.with_article_display) === 0) {
    console.log('VERDICT: Embeddings exist but article_number_display is empty —');
    console.log('         eval reads articleNumber from that column, hence got=[].');
  } else {
    console.log('VERDICT: Corpus looks populated. If eval still returns [], the issue');
    console.log('         is in the search/category mapping, not the data.');
  }
  console.log('─'.repeat(50));

  await pool.end();
}

main().catch(err => {
  console.error('[DB-CHECK] Fatal:', err.message);
  process.exit(1);
});
