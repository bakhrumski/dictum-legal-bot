#!/usr/bin/env node
'use strict';

/**
 * Data protection E2: seal the rows written before encryption at rest was on
 * (docs/design/shifrlash-1-bosqich.md §3.1). Dry run by default: counts the
 * plain and sealed values per column and changes nothing.
 *
 *   DATABASE_URL=... DATA_KEYS=... node scripts/seal-backfill.js           # count only
 *   DATABASE_URL=... DATA_KEYS=... node scripts/seal-backfill.js --apply   # seal the plain ones
 *
 * The live database is written only by the owner (CLAUDE.md): run --apply
 * yourself, after DATA_KEYS is in Render and its offline copy is kept.
 * Each row is sealed in its own UPDATE that only touches a still-plain value,
 * so a run can be stopped and started again.
 */

const privacy = require('../src/privacy/crypto');
const { textAad } = require('../src/ocr/scan-store');

const COLUMNS = [
  { table: 'document_scans', col: 'text', key: 'id', aad: r => textAad(r.admin_id, r.file_hash), extra: 'admin_id, file_hash' },
  { table: 'interview_transcripts', col: 'body', key: ['recording_id', 'version'], aad: r => `interview_transcripts.body:${r.recording_id}:${r.version}` },
  { table: 'interview_recordings', col: 'consent_by', key: 'id', aad: r => `interview_recordings.consent_by:${r.id}` },
  { table: 'interview_recordings', col: 'consent_note', key: 'id', aad: r => `interview_recordings.consent_note:${r.id}` },
  { table: 'interview_recordings', col: 'summary', key: 'id', json: true, aad: r => `interview_recordings.summary:${r.id}` },
  { table: 'interview_audio', col: 'data', key: 'recording_id', bytes: true, aad: r => `interview_audio.data:${r.recording_id}` },
];

async function main() {
  const apply = process.argv.includes('--apply');
  const ring = privacy.reload();
  if (apply && !ring.active) { console.error('DATA_KEYS is not set: nothing can be sealed'); process.exit(1); }
  const { pool } = require('../src/database/db');
  try {
    for (const c of COLUMNS) {
      const keys = Array.isArray(c.key) ? c.key : [c.key];
      const sel = [...new Set([...keys, c.col, ...(c.extra ? c.extra.split(/,\s*/u) : [])])].join(', ');
      let plain = 0, sealed = 0, done = 0;
      const rows = (await pool.query(`SELECT ${sel} FROM ${c.table} WHERE ${c.col} IS NOT NULL`)).rows;
      for (const r of rows) {
        const v = r[c.col];
        const isSealed = c.bytes ? privacy.isSealedBytes(v) : c.json ? privacy.isSealedJson(v) : privacy.isSealed(v);
        if (isSealed) { sealed++; continue; }
        plain++;
        if (!apply) continue;
        const next = c.bytes ? privacy.sealBytes(v, c.aad(r)) : c.json ? JSON.stringify(privacy.sealJson(v, c.aad(r))) : privacy.seal(v, c.aad(r));
        const where = keys.map((k, i) => `${k} = $${i + 2}`).join(' AND ');
        // only a value still as it was: a row changed meanwhile is left for the next run
        const u = await pool.query(`UPDATE ${c.table} SET ${c.col} = $1 WHERE ${where} AND ${c.col} = $${keys.length + 2}`,
          [next, ...keys.map(k => r[k]), c.json ? JSON.stringify(v) : v]);
        done += u.rowCount;
      }
      console.log(`${c.table}.${c.col}: ${sealed} sealed, ${plain} plain${apply ? `, ${done} sealed now` : ''}`);
    }
    if (!apply) console.log('dry run: nothing changed (add --apply to seal the plain values)');
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
