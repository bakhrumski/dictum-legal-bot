#!/usr/bin/env node
'use strict';

/**
 * One-shot backfill for legal_chunks.adoption_date + document_number.
 *
 * Background:
 *   The phase-1 ingestion had a bug in the document_number regex — the
 *   `№`/`N`/`raqami` prefix was optional, so the leftmost digit run in
 *   the title (day or year) won over the real document number. Every row
 *   ingested before commit 09470d9 can have a bogus document_number
 *   (typically a year like "2022" or a day like "27"). The fix only
 *   affects newly-ingested documents, so historical rows need a repair.
 *
 *   This script walks every distinct (law_name, adoption_date,
 *   document_number) group already in legal_chunks, re-runs the now-
 *   correct extractTitleMetadata() on the law_name string, and UPDATEs
 *   the rows whose stored metadata disagrees.
 *
 * Usage:
 *   node src/rag/backfill-doc-metadata.js            # write changes
 *   node src/rag/backfill-doc-metadata.js --dry-run  # preview only
 *   node src/rag/backfill-doc-metadata.js --verbose  # also log unchanged groups
 *   node src/rag/backfill-doc-metadata.js --limit 50 # cap groups processed
 *
 * Railway:
 *   railway run node src/rag/backfill-doc-metadata.js --dry-run
 *   railway run node src/rag/backfill-doc-metadata.js
 *
 * Safety rules (both columns are repaired by the same script):
 *   - document_number is OVERWRITTEN when the new extractor produces a
 *     value that differs from the stored one. If the new extractor
 *     returns null but the stored value is a date-fragment (4-digit year
 *     19xx/20xx, or a day-of-month 1-31), the stored value is cleared —
 *     it was almost certainly wrong. If the stored value looks like a
 *     real document number (has a hyphen, Roman suffix, or alpha prefix)
 *     and the new extractor can't improve on it, the row is LEFT ALONE
 *     so we never delete potentially-correct data.
 *   - adoption_date is overwritten only when the new extractor finds a
 *     real date that differs from the stored one. A null-from-extractor
 *     never clobbers an existing date.
 *
 * Idempotent: running twice yields no changes on the second run.
 */

require('dotenv').config();
const { pool } = require('../database/db');
const { extractTitleMetadata } = require('./fetch-lex');

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  if (i === -1) return null;
  const n = parseInt(process.argv[i + 1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
})();

/** Does this string look like it was accidentally captured from a date? */
function looksLikeDateFragment(val) {
  if (!val) return false;
  if (/^(19|20)\d{2}$/.test(val)) return true;          // 1900-2099 year
  if (/^(0?[1-9]|[12]\d|3[01])$/.test(val)) return true; // 1-31 day
  return false;
}

function shouldUpdateDocNum(newVal, oldVal) {
  if (newVal === oldVal) return false;
  if (newVal != null && newVal !== '') return true; // extractor is confident
  return looksLikeDateFragment(oldVal);              // extractor null → clear only date fragments
}

function shouldUpdateAdoptionDate(newVal, oldVal) {
  if (newVal === oldVal) return false;
  return newVal != null && newVal !== ''; // never clobber existing date with null
}

/** Postgres returns DATE as a JS Date; normalize to an ISO yyyy-mm-dd string. */
function toIsoDate(val) {
  if (val == null) return null;
  if (typeof val === 'string') return val.slice(0, 10);
  if (val instanceof Date) {
    // Use UTC components to avoid timezone drift on dates stored without tz.
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(val);
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

async function main() {
  const mode = DRY_RUN ? 'DRY-RUN (no writes)' : 'WRITE';
  console.log(`[BACKFILL] doc-metadata one-shot · ${mode}${LIMIT ? ` · limit=${LIMIT}` : ''}`);

  // Group by the three metadata columns so we can issue one UPDATE per group
  // and report per-group deltas. A 10K-row table with ~100 distinct laws
  // collapses to ~100 groups, each covering all rows of that law.
  const { rows } = await pool.query(`
    SELECT
      law_name,
      adoption_date,
      document_number,
      COUNT(*)::int AS row_count
    FROM legal_chunks
    WHERE law_name IS NOT NULL
      AND law_name <> ''
    GROUP BY law_name, adoption_date, document_number
    ORDER BY law_name
    ${LIMIT ? `LIMIT ${LIMIT}` : ''}
  `);

  console.log(`[BACKFILL] scanning ${rows.length} distinct (law_name, date, num) groups`);

  let groupsUpdated = 0;
  let groupsUnchanged = 0;
  let docNumChanged = 0;
  let dateChanged = 0;
  let rowsAffected = 0;

  for (const row of rows) {
    const lawName = row.law_name;
    const oldDate = toIsoDate(row.adoption_date);
    const oldNum = row.document_number;
    const rowCount = row.row_count;

    const extracted = extractTitleMetadata(lawName);
    const newDate = extracted.adoption_date; // ISO string or null
    const newNum = extracted.document_number; // string or null

    const updateNum = shouldUpdateDocNum(newNum, oldNum);
    const updateDate = shouldUpdateAdoptionDate(newDate, oldDate);

    if (!updateNum && !updateDate) {
      groupsUnchanged++;
      if (VERBOSE) {
        console.log(`  =  ${truncate(lawName, 80)}  [${rowCount} rows]`);
      }
      continue;
    }

    groupsUpdated++;
    rowsAffected += rowCount;
    if (updateNum) docNumChanged++;
    if (updateDate) dateChanged++;

    const nextNum = updateNum ? newNum : oldNum;
    const nextDate = updateDate ? newDate : oldDate;

    const marker = DRY_RUN ? '✎' : '✔';
    console.log(`  ${marker}  ${truncate(lawName, 80)}  [${rowCount} rows]`);
    if (updateNum) {
      console.log(`       document_number: ${JSON.stringify(oldNum)} → ${JSON.stringify(newNum)}`);
    }
    if (updateDate) {
      console.log(`       adoption_date:   ${JSON.stringify(oldDate)} → ${JSON.stringify(newDate)}`);
    }

    if (!DRY_RUN) {
      // IS NOT DISTINCT FROM handles NULL comparisons symmetrically, so
      // re-runs hit the same group exactly once and stop (idempotent).
      const res = await pool.query(
        `UPDATE legal_chunks
           SET document_number = $1,
               adoption_date   = $2
         WHERE law_name = $3
           AND document_number IS NOT DISTINCT FROM $4
           AND adoption_date   IS NOT DISTINCT FROM $5`,
        [nextNum, nextDate, lawName, oldNum, oldDate]
      );
      if (res.rowCount !== rowCount) {
        console.log(`       ⚠  expected ${rowCount} rows, updated ${res.rowCount}`);
      }
    }
  }

  console.log('');
  console.log('[BACKFILL] summary');
  console.log(`  groups scanned:         ${rows.length}`);
  console.log(`  groups updated:         ${groupsUpdated}`);
  console.log(`  groups unchanged:       ${groupsUnchanged}`);
  console.log(`  document_number fixes:  ${docNumChanged}`);
  console.log(`  adoption_date fixes:    ${dateChanged}`);
  console.log(`  rows affected:          ${rowsAffected}${DRY_RUN ? '  (NOT written — dry-run)' : ''}`);

  await pool.end();
}

main().catch((err) => {
  console.error('[BACKFILL] FAILED:', err);
  pool.end().catch(() => {});
  process.exit(1);
});
