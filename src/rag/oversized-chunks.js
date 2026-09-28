'use strict';

/**
 * Oversized corpus chunks (eval runs 5-10): the plain chunker kept a
 * paragraph whole when it had no blank line or "1)" inside it, so one
 * regulation was stored as a single 797,454-character chunk. It matched
 * almost every keyword and sat in the top 3 for 81 of 145 eval questions,
 * while its own content was unreachable (an embedding sees only the start).
 *
 * The chunker is fixed for new ingests; this re-chunks rows already stored:
 * each oversized chunk becomes article-sized pieces with the same metadata,
 * embedded, inserted, and the original deleted - in one transaction per
 * chunk, so a failure leaves the original in place.
 */

const { splitOversized } = require('./chunker');

// Only document text is re-chunked. A verified answer ("Savol: … Javob: …")
// is served whole and parsed by its format, so it is never split.
const DOCUMENT_TYPES = ['law_text', 'uploaded_doc'];
const OVERSIZED_CHARS = 8000;   // well above the chunker's 4,800-character hard max
const PIECE_CHARS = 3200;       // the chunker's target

// Columns that are recomputed or must not be copied onto the pieces.
const NOT_COPIED = new Set(['id', 'chunk_text', 'embedding', 'tsv', 'search_text', 'created_at',
  'updated_at', 'chunk_index', 'chunk_id', 'helpful_count', 'unhelpful_count', 'flagged_for_review']);

async function findOversizedChunks(pool, { minChars = OVERSIZED_CHARS, limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, law_name, doc_id, source_type, source_url, char_length(chunk_text) AS chars
       FROM legal_chunks
      WHERE char_length(chunk_text) > $1 AND is_valid IS NOT FALSE
        AND source_type = ANY($3::text[])
      ORDER BY char_length(chunk_text) DESC
      LIMIT $2`,
    [minChars, limit, DOCUMENT_TYPES]
  );
  return rows.map(r => ({ ...r, chars: Number(r.chars) }));
}

async function copyableColumns(client) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'legal_chunks' ORDER BY ordinal_position`
  );
  return rows.map(r => r.column_name).filter(c => !NOT_COPIED.has(c));
}

/**
 * Re-chunk one oversized row. embedTexts(texts) -> vectors (document-side
 * embeddings, as ingestion uses). Returns { id, pieces } or null if the row
 * is gone or no longer oversized.
 */
async function rechunkOne(pool, id, embedTexts, { minChars = OVERSIZED_CHARS, pieceChars = PIECE_CHARS } = {}) {
  const { rows } = await pool.query('SELECT id, chunk_text, chunk_index, source_type FROM legal_chunks WHERE id = $1', [id]);
  const row = rows[0];
  if (!row || String(row.chunk_text || '').length <= minChars) return null;
  if (!DOCUMENT_TYPES.includes(row.source_type)) return null;

  const pieces = splitOversized(row.chunk_text, pieceChars);
  const vectors = await embedTexts(pieces);
  if (!Array.isArray(vectors) || vectors.length !== pieces.length) {
    throw new Error(`embedding count ${vectors && vectors.length} != pieces ${pieces.length}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cols = await copyableColumns(client);
    const colList = cols.map(c => `"${c}"`).join(', ');
    for (let i = 0; i < pieces.length; i++) {
      await client.query(
        `INSERT INTO legal_chunks (${colList}, chunk_text, embedding, chunk_index)
         SELECT ${colList}, $2, $3::vector, $4 FROM legal_chunks WHERE id = $1`,
        [id, pieces[i], `[${vectors[i].join(',')}]`, (Number(row.chunk_index) || 0) * 1000 + i]
      );
    }
    await client.query('DELETE FROM legal_chunks WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { id, pieces: pieces.length };
}

/** GET /api/admin/corpus/oversized - list; ?fix=1 re-chunks them (master only). */
function mountOversizedChunkRoutes(app, { requireMasterAdmin, pool, embedTexts, log = console }) {
  let running = null;
  app.get('/api/admin/corpus/oversized', requireMasterAdmin, async (req, res) => {
    try {
      const found = await findOversizedChunks(pool);
      if (req.query.fix !== '1') return res.json({ oversized: found, howTo: 'Add ?fix=1 to re-chunk them.', running: !!running });
      if (running) return res.json({ started: false, running: true });
      running = (async () => {
        const done = [];
        for (const c of found) {
          try { const r = await rechunkOne(pool, c.id, embedTexts); if (r) done.push(r); }
          catch (err) { log.error(`[OVERSIZED] chunk ${c.id} (${c.law_name}) failed:`, err.message); }
        }
        log.log(`[OVERSIZED] re-chunked ${done.length}/${found.length}: ${done.map(d => `${d.id}→${d.pieces}`).join(', ')}`);
      })().finally(() => { running = null; });
      res.json({ started: true, chunks: found.length, howTo: 'Refresh without ?fix=1 to see what is left.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { findOversizedChunks, rechunkOne, mountOversizedChunkRoutes, OVERSIZED_CHARS, PIECE_CHARS, DOCUMENT_TYPES };
