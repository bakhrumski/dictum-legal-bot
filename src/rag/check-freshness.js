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

async function getIngestedDocuments(db = pool) {
  const where = SINGLE_DOC
    ? `WHERE is_valid = TRUE AND (is_active IS NULL OR is_active = TRUE) AND doc_id = $1`
    : `WHERE is_valid = TRUE AND (is_active IS NULL OR is_active = TRUE)`;
  const params = SINGLE_DOC ? [SINGLE_DOC] : [];

  const result = await db.query(`
    SELECT DISTINCT ON (doc_id)
      doc_id,
      law_name,
      source_url,
      is_active,
      COUNT(*) OVER (PARTITION BY doc_id) AS chunk_count
    FROM legal_chunks
    ${where}
      AND source_url IS NOT NULL
      AND source_url LIKE '%lex.uz%'
      AND (source_type IS NULL OR source_type = 'law_text')
    ORDER BY doc_id, id
  `, params);

  return result.rows;
}

/**
 * Whether lex.uz reports the fetched document as no longer in force.
 *
 * fetchLexDocument() returns { title, body, metadata, rawHtml } with the
 * status in metadata.is_active / metadata.status_label. This checked
 * fetched.is_active, which is always undefined — so the job never marked a
 * single repealed document, and repealed law stayed searchable.
 */
function lexStatus(fetched) {
  const meta = (fetched && fetched.metadata) || {};
  return {
    expired: meta.is_active === false,
    label: meta.status_label || "Hujjat kuchini yo'qotgan",
  };
}

async function checkDocument(doc, fetchDoc = fetchLexDocument) {
  const { doc_id, law_name, source_url, chunk_count } = doc;

  if (!source_url) {
    log.warn('No source_url, skipping', { doc_id, law_name });
    return { doc_id, law_name, status: 'skipped', reason: 'no_url' };
  }

  try {
    const fetched = await fetchDoc(source_url);
    const status = lexStatus(fetched);

    if (status.expired) {
      log.warn('Document expired on lex.uz', {
        doc_id,
        law_name,
        status_label: status.label,
        source_url,
        chunk_count,
      });
      return {
        doc_id,
        law_name,
        source_url,
        chunk_count,
        status: 'expired',
        status_label: status.label,
      };
    }

    // Still a date-locked old edition after the fetcher tried the current
    // one: the act is not repealed, but its current text was not reached.
    if (fetched && fetched.metadata && fetched.metadata.current_version_url) {
      return { doc_id, law_name, source_url, status: 'old_edition',
        snapshot_date: fetched.metadata.snapshot_date || null, current_version_url: fetched.metadata.current_version_url };
    }

    log.debug('Document still active', { doc_id, law_name });
    return { doc_id, law_name, status: 'active' };

  } catch (err) {
    log.warn('Fetch failed', { doc_id, law_name, source_url, err: err.message });
    return { doc_id, law_name, source_url, status: 'fetch_error', reason: err.message };
  }
}

async function deactivateDocument(doc_id, label = '', db = pool) {
  await db.query(
    `UPDATE legal_chunks
     SET is_active = FALSE,
         status_label = $2
     WHERE doc_id = $1`,
    [doc_id, `${label || "Hujjat kuchini yo'qotgan"} (auto-checked)`.slice(0, 200)]
  );
  log.info('Marked as inactive in DB', { doc_id });
}

/**
 * Every corpus document re-opened on lex.uz, one at a time (2026-10-03,
 * owner: an act that lost force after it was ingested must not keep being
 * cited). This was a CLI script nobody ran; the server now runs it daily and
 * on demand.
 *
 * Acts lex.uz marks "Hujjat kuchini yoʻqotgan" are taken out of search
 * (is_active = FALSE). As a guard against a misread banner taking a whole
 * code out at once, a run that finds more than `maxAuto` of them only
 * reports; the owner applies it with ?apply=1.
 */
async function runFreshnessCheck({ db = pool, fetchDoc = fetchLexDocument, apply = true, maxAuto = 3, pauseMs = 1500, job = {} } = {}) {
  const docs = await getIngestedDocuments(db);
  job.total = docs.length;
  job.done = 0;
  job.results = [];
  for (const doc of docs) {
    job.results.push(await checkDocument(doc, fetchDoc));
    job.done++;
    if (pauseMs) await new Promise(r => setTimeout(r, pauseMs));
  }
  const expired = job.results.filter(r => r.status === 'expired');
  job.expired = expired;
  job.oldEditions = job.results.filter(r => r.status === 'old_edition');
  job.errors = job.results.filter(r => r.status === 'fetch_error');
  if (expired.length && apply && expired.length <= maxAuto) {
    await applyExpired(expired, db);
    job.applied = expired.map(r => r.doc_id);
  } else if (expired.length && apply) {
    job.held = `${expired.length} documents read as repealed (more than ${maxAuto}); review and apply with ?apply=1`;
  }
  return job;
}

async function applyExpired(expired, db = pool) {
  for (const r of expired) await deactivateDocument(r.doc_id, r.status_label, db);
  // The answer-time screen reads "in corpus and in force" from its own index.
  require('./answer-verification').invalidateCorpusIndex();
}

/**
 * GET /api/admin/corpus/freshness - the last run; ?start=1 runs it now;
 * ?apply=1 takes out the acts the last run found repealed (after a held run).
 * The run also repeats weekly, on Sunday at 03:00 Tashkent time (owner,
 * 2026-10-03); CORPUS_FRESHNESS=off turns the schedule off.
 */
function mountFreshnessRoutes(app, { requireMasterAdmin, db = pool, fetchDoc = fetchLexDocument, weekly = true, pauseMs = 1500, logger = log }) {
  let job = null;
  const start = (trigger) => {
    if (job && job.running) return false;
    const current = { running: true, trigger, startedAt: new Date().toISOString() };
    job = current;
    runFreshnessCheck({ db, fetchDoc, pauseMs, job: current })
      .catch((err) => { current.error = err.message; logger.error('Freshness run failed', { err: err.message }); })
      .finally(() => {
        current.running = false;
        current.finishedAt = new Date().toISOString();
        logger.info('Freshness run done', { checked: current.done, expired: (current.expired || []).length, applied: (current.applied || []).length, held: current.held || null });
      });
    return true;
  };

  app.get('/api/admin/corpus/freshness', requireMasterAdmin, async (req, res) => {
    try {
      if (req.query.start === '1') start('manual');
      if (req.query.apply === '1' && job && !job.running && (job.expired || []).length && !job.applied) {
        await applyExpired(job.expired, db);
        job.applied = job.expired.map(r => r.doc_id);
        job.held = null;
      }
      const summary = job && {
        running: job.running, trigger: job.trigger, startedAt: job.startedAt, finishedAt: job.finishedAt,
        done: job.done, total: job.total, error: job.error, held: job.held || null, applied: job.applied || [],
      };
      res.json({
        job: summary,
        expired: (job && job.expired) || [],
        oldEditions: (job && job.oldEditions) || [],
        errors: (job && job.errors) || [],
        howTo: 'Every corpus document is re-opened on lex.uz. Acts marked "Hujjat kuchini yoʻqotgan" are taken out of search; more than 3 at once are only reported until ?apply=1. ?start=1 runs it now (several minutes); it also runs every Sunday at 03:00 Tashkent time.',
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  let timer = null;
  const scheduleNext = () => {
    timer = setTimeout(() => { start('scheduled'); scheduleNext(); }, msUntilNextSunday(new Date()));
    timer.unref?.();
  };
  if (weekly) scheduleNext();
  return { start, current: () => job, nextRunAt: () => (timer ? new Date(Date.now() + msUntilNextSunday(new Date())) : null) };
}

// Tashkent is UTC+5 all year (no daylight saving).
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Milliseconds from `now` to the next Sunday 03:00 in Tashkent (never 0). */
function msUntilNextSunday(now = new Date(), hour = 3) {
  const local = new Date(now.getTime() + TASHKENT_OFFSET_MS); // Tashkent wall clock, read with UTC getters
  const target = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour));
  target.setUTCDate(target.getUTCDate() + ((7 - local.getUTCDay()) % 7));
  if (target <= local) target.setUTCDate(target.getUTCDate() + 7);
  return target.getTime() - local.getTime();
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
      await deactivateDocument(r.doc_id, r.status_label);
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

if (require.main === module) {
  main().catch(err => {
    log.error('Freshness check failed', { err: err.message });
    pool.end().finally(() => process.exit(1));
  });
}

module.exports = { checkDocument, lexStatus, runFreshnessCheck, mountFreshnessRoutes, msUntilNextSunday };
