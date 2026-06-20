'use strict';

/**
 * Document Freshness Checker
 *
 * Re-fetches every ingested document from lex.uz and marks expired ones
 * as is_active = FALSE in the database.
 *
 * This catches the case where a document was correctly ingested as active
 * but later expired on lex.uz (e.g. PQ-3126 expired 20.01.2026 after
 * being superseded by PQ-14).
 *
 * Usage:
 *   node src/rag/check-freshness.js
 *   node src/rag/check-freshness.js --dry-run     # report only, no DB writes
 *   node src/rag/check-freshness.js --doc-id pq-3126   # single document
 *   node src/rag/check-freshness.js --concurrency 3     # parallel fetches
 *
 * npm script (add to package.json):
 *   "corpus:check-freshness": "node src/rag/check-freshness.js"
 */

require('dotenv').config();
const { pool } = require('../database/db');
const { fetchLexDocument } = require('./fetch-lex');
const log = require('../utils/logger').createLogger('FRESHNESS');

const args = process.argv.slice(2);
const DRY_RUN     = args.includes('--dry-run');
const CONCURRENCY = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '2', 10);
const SINGLE_DOC  = args.find((a, i) => args[i - 1] === '--doc-id');

async function getIngestedDocuments() {
  const where = SINGLE_DOC
    ? `WHERE is_valid = TRUE AND (is_active IS NULL OR is_active = TRUE) AND doc_id = $1`
    : `WHERE is_valid = TRUE AND (is_active IS NULL OR is_active = TRUE)`;
  const params = SINGLE_DOC ? [SINGLE_DOC] : [];

  const result = await pool.query(`
    SELECT DISTINCT ON (doc_id)
      doc_id,
      law_name,
      source_url,
      is_active,
      COUNT(*) OVER (PARTITION BY doc_id) AS chunk_count
    FROM legal_chunks
    ${where}
      AND source_url IS NOT NULL
    ORDER BY doc_id, id
  `, params);

  return result.rows;
}

async function checkDocument(doc) {
  const { doc_id, law_name, source_url, chunk_count } = doc;

  if (!source_url) {
    log.warn('No source_url, skipping', { doc_id, law_name });
    return { doc_id, law_name, status: 'skipped', reason: 'no_url' };
  }

  try {
    const fetched = await fetchLexDocument(source_url);

    if (fetched.is_active === false) {
      log.warn('Document expired on lex.uz', {
        doc_id,
        law_name,
        status_label: fetched.status_label || 'kuchini yo\'qotgan',
        source_url,
        chunk_count,
      });
      return {
        doc_id,
        law_name,
        source_url,
        chunk_count,
        status: 'expired',
        status_label: fetched.status_label || "Hujjat kuchini yo'qotgan",
      };
    }

    log.debug('Document still active', { doc_id, law_name });
    return { doc_id, law_name, status: 'active' };

  } catch (err) {
    log.warn('Fetch failed', { doc_id, law_name, source_url, err: err.message });
    return { doc_id, law_name, source_url, status: 'fetch_error', reason: err.message };
  }
}

async function deactivateDocument(doc_id) {
  await pool.query(
    `UPDATE legal_chunks
     SET is_active = FALSE,
         status_label = 'Hujjat kuchini yo''qotgan (auto-checked)'
     WHERE doc_id = $1`,
    [doc_id]
  );
  log.info('Marked as inactive in DB', { doc_id });
}

async function runInChunks(items, concurrency, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    // Brief pause between batches to be polite to lex.uz
    if (i + concurrency < items.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return results;
}

async function main() {
  log.info('Starting freshness check', { dryRun: DRY_RUN, concurrency: CONCURRENCY, singleDoc: SINGLE_DOC || 'all' });

  const docs = await getIngestedDocuments();
  log.info(`Found ${docs.length} unique documents to check`);

  if (docs.length === 0) {
    log.info('Nothing to check (corpus may be empty or no source_url set)');
    await pool.end();
    return;
  }

  const results = await runInChunks(docs, CONCURRENCY, checkDocument);

  const expired    = results.filter(r => r.status === 'expired');
  const active     = results.filter(r => r.status === 'active');
  const errors     = results.filter(r => r.status === 'fetch_error');
  const skipped    = results.filter(r => r.status === 'skipped');

  // Summary
  console.log('\n══════════ FRESHNESS CHECK RESULTS ══════════');
  console.log(`Total checked : ${docs.length}`);
  console.log(`Still active  : ${active.length}`);
  console.log(`EXPIRED       : ${expired.length}`);
  console.log(`Fetch errors  : ${errors.length}`);
  console.log(`Skipped       : ${skipped.length}`);

  if (expired.length > 0) {
    console.log('\n── Expired documents ──');
    for (const r of expired) {
      console.log(`  [EXPIRED] ${r.doc_id} — "${r.law_name}" (${r.chunk_count} chunks)`);
      console.log(`            ${r.status_label}`);
      console.log(`            ${r.source_url}`);
    }
  }

  if (errors.length > 0) {
    console.log('\n── Fetch errors (check manually) ──');
    for (const r of errors) {
      console.log(`  [ERROR] ${r.doc_id} — ${r.reason}`);
    }
  }

  // Deactivate expired documents
  if (expired.length > 0 && !DRY_RUN) {
    console.log('\n── Deactivating expired documents in DB ──');
    for (const r of expired) {
      await deactivateDocument(r.doc_id);
      console.log(`  ✓ Deactivated: ${r.doc_id}`);
    }
    console.log(`\nDone. ${expired.length} document(s) marked is_active = FALSE.`);
    console.log('These will no longer appear in search results.');
  } else if (expired.length > 0 && DRY_RUN) {
    console.log('\n[DRY RUN] No DB changes made. Re-run without --dry-run to apply.');
  }

  await pool.end();
  process.exit(expired.length > 0 && !DRY_RUN ? 0 : 0);
}

main().catch(err => {
  log.error('Freshness check failed', { err: err.message });
  pool.end().finally(() => process.exit(1));
});
