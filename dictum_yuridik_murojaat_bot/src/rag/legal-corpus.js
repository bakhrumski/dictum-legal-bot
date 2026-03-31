'use strict';

/**
 * Legal Corpus — pgvector-powered storage & hybrid retrieval
 *
 * Table: legal_chunks
 *   Stores chunked legal text with vector embeddings for semantic search
 *   and tsvector for BM25-style keyword search.
 *
 * Retrieval strategy (hybrid):
 *   1. Vector similarity (cosine distance via pgvector)
 *   2. Full-text search (ts_rank via PostgreSQL tsvector)
 *   3. Combined score with configurable weights
 *   4. Category filter for topic-scoped queries
 */

const { pool } = require('../database/db');
const { getEmbedding, getEmbedDims, detectProvider } = require('./embeddings');

// ========== TABLE SETUP ==========

let _initialized = false;

async function initLegalCorpus() {
  if (_initialized) return;

  try {
    // Enable pgvector extension
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    // Enable pg_trgm for fuzzy matching (already used in project)
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    // Create the legal_chunks table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS legal_chunks (
        id SERIAL PRIMARY KEY,

        -- Source document info
        law_name TEXT NOT NULL,
        doc_id VARCHAR(100),
        source_url TEXT,
        category VARCHAR(100) NOT NULL,

        -- Chunk content
        chunk_text TEXT NOT NULL,
        chunk_index INTEGER DEFAULT 0,

        -- Article-level metadata
        article_numbers TEXT[],
        chapter TEXT,

        -- Document validity
        enforcement_date DATE,
        is_valid BOOLEAN DEFAULT TRUE,
        last_checked_at TIMESTAMPTZ,

        -- Searchable representations
        embedding vector(${getEmbedDims()}),
        tsv tsvector,

        -- Quality tracking (for human-verified Q&A pairs)
        source_type VARCHAR(20) DEFAULT 'law_text',
        quality_score FLOAT DEFAULT 0.5,
        verified_by INTEGER,

        -- Timestamps
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Add new columns if table already exists (idempotent)
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS source_type VARCHAR(20) DEFAULT 'law_text'`);
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS quality_score FLOAT DEFAULT 0.5`);
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS verified_by INTEGER`);

    // Indexes for hybrid search
    // 1. Vector similarity index (IVFFlat — good for < 1M rows; switch to HNSW if scaling)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_legal_chunks_embedding
      ON legal_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50)
    `).catch(async (err) => {
      // IVFFlat requires at least some rows to build; skip if table empty
      if (err.message.includes('could not create ivfflat index')) {
        console.log('[LEGAL CORPUS] IVFFlat index deferred (table empty, will build after first ingest)');
      } else {
        throw err;
      }
    });

    // 2. Full-text search index
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_legal_chunks_tsv
      ON legal_chunks USING GIN (tsv)
    `);

    // 3. Category filter index
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_legal_chunks_category
      ON legal_chunks(category)
    `);

    // 4. Validity filter index
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_legal_chunks_valid
      ON legal_chunks(is_valid) WHERE is_valid = TRUE
    `);

    // 5. doc_id index for upsert/dedup
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_legal_chunks_doc_id
      ON legal_chunks(doc_id)
    `);

    // Trigger to auto-generate tsvector on insert/update
    await pool.query(`
      CREATE OR REPLACE FUNCTION legal_chunks_tsv_trigger() RETURNS trigger AS $$
      BEGIN
        NEW.tsv := to_tsvector('simple', COALESCE(NEW.chunk_text, '') || ' ' || COALESCE(NEW.law_name, ''));
        NEW.updated_at := NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS trg_legal_chunks_tsv ON legal_chunks
    `);

    await pool.query(`
      CREATE TRIGGER trg_legal_chunks_tsv
      BEFORE INSERT OR UPDATE ON legal_chunks
      FOR EACH ROW EXECUTE FUNCTION legal_chunks_tsv_trigger()
    `);

    _initialized = true;
    const provider = detectProvider();
    console.log(`[LEGAL CORPUS] Table and indexes ready (embeddings: ${provider || 'none'}, ${getEmbedDims()}d)`);
  } catch (err) {
    console.error('[LEGAL CORPUS] Init error:', err.message);
    // Don't throw — let the app start even if pgvector isn't available yet
  }
}

// ========== INSERT CHUNKS ==========

/**
 * Insert a batch of chunks into legal_chunks.
 * Used by the ingestion pipeline.
 *
 * @param {{ text: string, embedding: number[], metadata: object }[]} chunks
 */
async function insertChunks(chunks) {
  if (!chunks || chunks.length === 0) return 0;
  await initLegalCorpus();

  const client = await pool.connect();
  let inserted = 0;

  try {
    await client.query('BEGIN');

    for (const chunk of chunks) {
      const m = chunk.metadata || {};
      const articleNums = (m.articles || []).map(a => a.number).filter(Boolean);
      const embeddingStr = chunk.embedding
        ? `[${chunk.embedding.join(',')}]`
        : null;

      await client.query(`
        INSERT INTO legal_chunks (
          law_name, doc_id, source_url, category,
          chunk_text, chunk_index,
          article_numbers, chapter,
          enforcement_date, is_valid,
          embedding
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector)
      `, [
        m.law_name || '',
        m.doc_id || null,
        m.source_url || null,
        m.category || 'boshqa',
        chunk.text,
        chunk.chunkIndex || 0,
        articleNums.length > 0 ? articleNums : null,
        m.chapter || null,
        m.enforcement_date || null,
        m.is_valid !== false,
        embeddingStr
      ]);

      inserted++;
    }

    await client.query('COMMIT');
    console.log(`[LEGAL CORPUS] Inserted ${inserted} chunks`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[LEGAL CORPUS] Insert error:', err.message);
    throw err;
  } finally {
    client.release();
  }

  return inserted;
}

// ========== DELETE BY DOC ==========

/**
 * Delete all chunks for a given doc_id (used before re-ingestion).
 */
async function deleteByDocId(docId) {
  await initLegalCorpus();
  const result = await pool.query(`DELETE FROM legal_chunks WHERE doc_id = $1`, [docId]);
  console.log(`[LEGAL CORPUS] Deleted ${result.rowCount} chunks for doc ${docId}`);
  return result.rowCount;
}

// ========== HYBRID RETRIEVAL ==========

/**
 * Hybrid search: combines vector similarity + full-text search.
 *
 * @param {string} query - user question
 * @param {object} opts
 * @param {string} opts.category - filter by legal topic (e.g. 'mehnat')
 * @param {number} opts.limit - max results (default 5)
 * @param {number} opts.vectorWeight - weight for vector score (default 0.6)
 * @param {number} opts.textWeight - weight for text score (default 0.4)
 * @param {string} opts.apiKey - OpenAI key for embedding
 * @returns {Promise<{ id, law_name, chunk_text, article_numbers, chapter, score, source_url }[]>}
 */
async function hybridSearch(query, opts = {}) {
  await initLegalCorpus();

  const {
    category = null,
    limit = 5,
    vectorWeight = 0.6,
    textWeight = 0.4,
    apiKey
  } = opts;

  if (!apiKey) throw new Error('API key required for hybrid search');

  // Generate query embedding
  const queryEmbedding = await getEmbedding(query, apiKey);
  const embStr = `[${queryEmbedding.join(',')}]`;

  // Build the hybrid query
  // Vector score: 1 - cosine_distance (higher = more similar)
  // Text score: ts_rank_cd normalized
  const categoryFilter = category
    ? `AND lc.category = $3`
    : '';
  const params = category
    ? [embStr, limit, category]
    : [embStr, limit];

  const sql = `
    WITH vector_scores AS (
      SELECT id, 1 - (embedding <=> $1::vector) AS vscore
      FROM legal_chunks
      WHERE is_valid = TRUE
        ${category ? 'AND category = $3' : ''}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $2 * 3
    ),
    text_scores AS (
      SELECT id, ts_rank_cd(tsv, plainto_tsquery('simple', $1::text)) AS tscore
      FROM legal_chunks
      WHERE is_valid = TRUE
        ${category ? 'AND category = $3' : ''}
        AND tsv @@ plainto_tsquery('simple', $1::text)
      LIMIT $2 * 3
    ),
    combined AS (
      SELECT
        COALESCE(v.id, t.id) AS id,
        COALESCE(v.vscore, 0) * ${vectorWeight} + COALESCE(t.tscore, 0) * ${textWeight} AS combined_score
      FROM vector_scores v
      FULL OUTER JOIN text_scores t ON v.id = t.id
    )
    SELECT
      lc.id,
      lc.law_name,
      lc.chunk_text,
      lc.article_numbers,
      lc.chapter,
      lc.source_url,
      lc.category,
      c.combined_score AS score
    FROM combined c
    JOIN legal_chunks lc ON lc.id = c.id
    ORDER BY c.combined_score DESC
    LIMIT $2
  `;

  // For the text search part, we need the query text, not the embedding.
  // The trick: $1 is the embedding string for vector, but plainto_tsquery expects text.
  // We need to pass the query text separately.
  // Let me restructure with proper params:

  const sqlFixed = `
    WITH vector_scores AS (
      SELECT id, 1 - (embedding <=> $1::vector) AS vscore
      FROM legal_chunks
      WHERE is_valid = TRUE
        ${category ? 'AND category = $4' : ''}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $3 * 3
    ),
    text_scores AS (
      SELECT id, ts_rank_cd(tsv, plainto_tsquery('simple', $2)) AS tscore
      FROM legal_chunks
      WHERE is_valid = TRUE
        ${category ? 'AND category = $4' : ''}
        AND tsv @@ plainto_tsquery('simple', $2)
      LIMIT $3 * 3
    ),
    combined AS (
      SELECT
        COALESCE(v.id, t.id) AS id,
        COALESCE(v.vscore, 0) * ${vectorWeight} + COALESCE(t.tscore, 0) * ${textWeight} AS combined_score
      FROM vector_scores v
      FULL OUTER JOIN text_scores t ON v.id = t.id
    )
    SELECT
      lc.id,
      lc.law_name,
      lc.chunk_text,
      lc.article_numbers,
      lc.chapter,
      lc.source_url,
      lc.category,
      lc.source_type,
      lc.verified_by,
      -- Boost verified human-approved Q&A pairs by +0.25
      c.combined_score + CASE WHEN lc.source_type = 'verified_qa' THEN 0.25 ELSE 0 END AS score
    FROM combined c
    JOIN legal_chunks lc ON lc.id = c.id
    ORDER BY score DESC
    LIMIT $3
  `;

  const fixedParams = category
    ? [embStr, query, limit, category]
    : [embStr, query, limit];

  const result = await pool.query(sqlFixed, fixedParams);
  return result.rows;
}

// ========== VERIFIED Q&A INSERT ==========

/**
 * Embed and store a human-verified Q&A pair into the corpus.
 * These chunks are ranked higher than raw law text in hybrid search.
 *
 * @param {object} opts
 * @param {string} opts.question   - the original user question
 * @param {string} opts.answer     - the lawyer-approved answer
 * @param {string} opts.category   - legal category (e.g. 'mehnat')
 * @param {number} opts.requestId  - source request ID for traceability
 * @param {number} opts.verifiedBy - admin ID of the approving lawyer
 * @param {string} opts.verifiedByName - full name of the approving lawyer
 */
async function insertVerifiedAnswer({ question, answer, category, requestId, verifiedBy, verifiedByName }) {
  await initLegalCorpus();

  const apiKey = process.env.GEMINI_API_KEY || process.env.GPT_API_KEY;
  if (!apiKey) throw new Error('Embedding uchun GEMINI_API_KEY yoki GPT_API_KEY kerak');

  // Combine Q&A for embedding so semantic search finds this when similar questions arrive
  const chunkText = `Savol: ${question}\n\nJavob: ${answer}`;
  const embedding = await getEmbedding(chunkText, apiKey);
  const embStr = `[${embedding.join(',')}]`;

  const docId = `verified_qa_${requestId || Date.now()}`;
  const lawName = verifiedByName
    ? `Tasdiqlangan javob — ${verifiedByName}`
    : 'Tasdiqlangan javob';

  // Remove old version of this QA if it exists (re-approval)
  await pool.query(`DELETE FROM legal_chunks WHERE doc_id = $1`, [docId]);

  await pool.query(`
    INSERT INTO legal_chunks (
      law_name, doc_id, category, chunk_text, chunk_index,
      is_valid, embedding, source_type, quality_score, verified_by
    ) VALUES ($1, $2, $3, $4, 0, TRUE, $5::vector, 'verified_qa', 1.0, $6)
  `, [lawName, docId, category || 'boshqa', chunkText, embStr, verifiedBy || null]);

  console.log(`[LEGAL CORPUS] Verified QA added: request #${requestId} by ${verifiedByName}`);
  return docId;
}

/**
 * Simple vector-only search (faster, for fallback).
 */
async function vectorSearch(query, opts = {}) {
  await initLegalCorpus();

  const { category = null, limit = 5, apiKey } = opts;
  if (!apiKey) throw new Error('API key required for vector search');

  const queryEmbedding = await getEmbedding(query, apiKey);
  const embStr = `[${queryEmbedding.join(',')}]`;

  const sql = `
    SELECT
      id, law_name, chunk_text, article_numbers, chapter, source_url, category,
      1 - (embedding <=> $1::vector) AS score
    FROM legal_chunks
    WHERE is_valid = TRUE
      ${category ? 'AND category = $3' : ''}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> $1::vector
    LIMIT $2
  `;

  const params = category ? [embStr, limit, category] : [embStr, limit];
  const result = await pool.query(sql, params);
  return result.rows;
}

// ========== STATS ==========

async function getCorpusStats() {
  await initLegalCorpus();

  const result = await pool.query(`
    SELECT
      category,
      COUNT(*) AS chunk_count,
      COUNT(DISTINCT doc_id) AS doc_count,
      COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS embedded_count
    FROM legal_chunks
    WHERE is_valid = TRUE
    GROUP BY category
    ORDER BY category
  `);

  const total = await pool.query(`SELECT COUNT(*) FROM legal_chunks WHERE is_valid = TRUE`);

  return {
    total: parseInt(total.rows[0].count),
    byCategory: result.rows
  };
}

/**
 * Rebuild IVFFlat index (call after bulk ingest).
 * IVFFlat needs data to build properly.
 */
async function rebuildVectorIndex() {
  console.log('[LEGAL CORPUS] Rebuilding IVFFlat index...');
  const count = await pool.query(`SELECT COUNT(*) FROM legal_chunks WHERE embedding IS NOT NULL`);
  const n = parseInt(count.rows[0].count);

  if (n === 0) {
    console.log('[LEGAL CORPUS] No embeddings yet, skipping index rebuild');
    return;
  }

  // lists should be ~sqrt(n), minimum 10
  const lists = Math.max(10, Math.min(100, Math.floor(Math.sqrt(n))));

  await pool.query(`DROP INDEX IF EXISTS idx_legal_chunks_embedding`);
  await pool.query(`
    CREATE INDEX idx_legal_chunks_embedding
    ON legal_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = ${lists})
  `);

  console.log(`[LEGAL CORPUS] IVFFlat index rebuilt with ${lists} lists (${n} vectors)`);
}

module.exports = {
  initLegalCorpus,
  insertChunks,
  deleteByDocId,
  hybridSearch,
  vectorSearch,
  getCorpusStats,
  rebuildVectorIndex,
  insertVerifiedAnswer
};
