'use strict';

/**
 * Re-embed the entire legal corpus with the CURRENT embedding provider.
 *
 * Use when switching embedding providers/models (e.g. HuggingFace e5-large →
 * Gemini), which changes the vector space and dimension. Steps:
 *   1. Ensure the embedding column dimension matches the new provider
 *      (the boot migration handles the column; run the server once with
 *       ALLOW_EMBED_MIGRATION=true, OR this script will error if dims mismatch).
 *   2. Embed every chunk's chunk_text (RETRIEVAL_DOCUMENT) in batches.
 *   3. Rebuild the ivfflat index.
 *
 * Resumable: only re-embeds rows WHERE embedding IS NULL, so it can be re-run
 * after an interruption (rate limit, crash) and will pick up where it left off.
 *
 *   EMBED_PROVIDER=gemini node src/rag/reembed-corpus.js
 *   EMBED_PROVIDER=gemini node src/rag/reembed-corpus.js --all   # force re-embed ALL rows
 */

require('dotenv').config();
const { pool } = require('../database/db');
const { getEmbeddingsBatch, detectProvider, getEmbedDims, PROVIDERS } = require('./embeddings');
const { rebuildVectorIndex } = require('./legal-corpus');

const BATCH = parseInt(process.env.REEMBED_BATCH || '64', 10);

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
  const provider = detectProvider();
  if (!provider) { console.error('No embedding provider configured'); process.exit(1); }
  const dims = getEmbedDims();
  console.log(`[REEMBED] Provider: ${provider} (${PROVIDERS[provider].model}, ${dims}d)`);

  // Verify the column dimension matches the provider before doing any work.
  const dimCheck = await pool.query(`
    SELECT atttypmod AS dim FROM pg_attribute
    JOIN pg_class ON pg_class.oid = pg_attribute.attrelid
    WHERE pg_class.relname = 'legal_chunks' AND pg_attribute.attname = 'embedding'`);
  const colDim = dimCheck.rows[0] ? parseInt(dimCheck.rows[0].dim, 10) : null;
  if (colDim && colDim !== dims) {
    if (!process.argv.includes('--migrate')) {
      console.error(`[REEMBED] Column is vector(${colDim}) but provider needs ${dims}.`);
      console.error(`[REEMBED] Re-run with --migrate to recreate the embedding column (drops old vectors, then re-embeds everything):`);
      console.error(`[REEMBED]   EMBED_PROVIDER=${provider} npm run corpus:reembed -- --migrate`);
      process.exit(1);
    }
    console.log(`[REEMBED] --migrate: recreating embedding column vector(${colDim}) -> vector(${dims})`);
    await pool.query('DROP INDEX IF EXISTS idx_legal_chunks_embedding');
    await pool.query('ALTER TABLE legal_chunks DROP COLUMN IF EXISTS embedding');
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN embedding vector(${dims})`);
    console.log('[REEMBED] Column recreated; all rows now need embedding.');
  }

  const all = process.argv.includes('--all');
  if (all) {
    console.log('[REEMBED] --all: clearing existing embeddings first');
    await pool.query('UPDATE legal_chunks SET embedding = NULL');
  }

  const totalRes = await pool.query('SELECT COUNT(*)::int AS n FROM legal_chunks WHERE embedding IS NULL');
  let remaining = totalRes.rows[0].n;
  console.log(`[REEMBED] ${remaining} chunk(s) to embed (batch ${BATCH})`);
  if (remaining === 0) { console.log('[REEMBED] Nothing to do.'); await finish(); return; }

  let done = 0;
  while (true) {
    const rows = (await pool.query(
      `SELECT id, chunk_text FROM legal_chunks WHERE embedding IS NULL ORDER BY id LIMIT $1`, [BATCH]
    )).rows;
    if (rows.length === 0) break;

    const texts = rows.map(r => r.chunk_text || ' ');
    let vectors;
    try {
      vectors = await getEmbeddingsBatch(texts);
    } catch (e) {
      console.error(`[REEMBED] Batch failed (${e.message}). Stopping — re-run to resume.`);
      process.exit(1);
    }

    // Persist each vector
    for (let i = 0; i < rows.length; i++) {
      const v = vectors[i];
      if (!Array.isArray(v) || v.length !== dims) {
        console.error(`[REEMBED] Bad vector for id=${rows[i].id} (len ${Array.isArray(v) ? v.length : 'n/a'}). Stopping.`);
        process.exit(1);
      }
      await pool.query('UPDATE legal_chunks SET embedding = $1 WHERE id = $2', [`[${v.join(',')}]`, rows[i].id]);
    }
    done += rows.length;
    console.log(`[REEMBED] ${done}/${remaining} (${Math.round(done / remaining * 100)}%)`);
  }

  await finish();
}

async function finish() {
  console.log('[REEMBED] Rebuilding ivfflat index...');
  try { await rebuildVectorIndex(); } catch (e) { console.warn('[REEMBED] Index rebuild skipped:', e.message); }
  const stats = await pool.query(`SELECT COUNT(*)::int AS total, COUNT(embedding)::int AS embedded FROM legal_chunks`);
  console.log(`[REEMBED] Done. ${stats.rows[0].embedded}/${stats.rows[0].total} embedded.`);
  await pool.end();
}

main().catch(e => { console.error('[REEMBED] Fatal:', e.message); process.exit(1); });
