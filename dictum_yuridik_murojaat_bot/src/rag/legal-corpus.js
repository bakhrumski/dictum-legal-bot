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
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS language VARCHAR(5) DEFAULT 'ru'`);

    // Handle embedding dimension migration (e.g. switching from Gemini 3072d to HF 1024d)
    // atttypmod for vector(n) equals n directly in pgvector
    const dimCheck = await pool.query(`
      SELECT atttypmod
      FROM pg_attribute
      JOIN pg_class ON pg_class.oid = pg_attribute.attrelid
      WHERE pg_class.relname = 'legal_chunks'
        AND pg_attribute.attname = 'embedding'
        AND pg_attribute.attnum > 0
    `);
    if (dimCheck.rows.length > 0) {
      const currentDim = parseInt(dimCheck.rows[0].atttypmod, 10); // always parse to int
      const targetDim = getEmbedDims();
      if (!isNaN(currentDim) && currentDim > 0 && currentDim !== targetDim) {
        console.log(`[LEGAL CORPUS] Embedding dim mismatch: table=${currentDim}d, provider=${targetDim}d. Rebuilding column...`);
        await pool.query(`DROP INDEX IF EXISTS idx_legal_chunks_embedding`);
        await pool.query(`ALTER TABLE legal_chunks DROP COLUMN embedding`);
        await pool.query(`ALTER TABLE legal_chunks ADD COLUMN embedding vector(${targetDim})`);
        console.log(`[LEGAL CORPUS] Embedding column rebuilt to ${targetDim}d. Re-ingest required.`);
      }
    }

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

    // Ingest history log
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rag_ingest_log (
        id           SERIAL PRIMARY KEY,
        source_type  VARCHAR(20)  NOT NULL DEFAULT 'url',  -- 'url' | 'file'
        source_url   TEXT,
        file_name    TEXT,
        law_name     TEXT,
        category     VARCHAR(100),
        chunks_total INTEGER      NOT NULL DEFAULT 0,
        embedded     INTEGER      NOT NULL DEFAULT 0,
        language     VARCHAR(5)   DEFAULT 'ru',
        status       VARCHAR(20)  NOT NULL DEFAULT 'ok',   -- 'ok' | 'error'
        error_msg    TEXT,
        ingest_by    INTEGER,                              -- admin id
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_rag_ingest_log_created
      ON rag_ingest_log(created_at DESC)
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

// ========== TEXT-ONLY FALLBACK SEARCH ==========

/**
 * Full-text search only — no embeddings needed.
 * Used when embedding API quota is exhausted.
 * Always prioritizes verified_qa entries.
 */
async function textOnlySearch(query, opts = {}) {
  await initLegalCorpus();
  const { category = null, limit = 5 } = opts;

  // Normalize query: strip Uzbek apostrophes, extract key words for ILIKE fallback
  const normalizedQuery = query.replace(/['ʼ''`]/g, "'");
  const keywords = normalizedQuery
    .toLowerCase()
    .replace(/[^a-zA-Zа-яА-ЯёЁ\u0027\u02BC0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 6);

  const categoryClause = category ? 'AND category = $3' : '';
  const params = category ? [normalizedQuery, limit, category] : [normalizedQuery, limit];

  // 1. Full-text search (verified QA first)
  const verifiedSql = `
    SELECT id, law_name, chunk_text, article_numbers, chapter, source_url, category,
           source_type, verified_by,
           ts_rank_cd(tsv, plainto_tsquery('simple', $1)) AS score
    FROM legal_chunks
    WHERE is_valid = TRUE
      AND source_type = 'verified_qa'
      AND tsv @@ plainto_tsquery('simple', $1)
      ${categoryClause}
    ORDER BY score DESC
    LIMIT $2
  `;
  const verifiedResult = await pool.query(verifiedSql, params);
  if (verifiedResult.rows.length > 0) {
    console.log(`[RAG] Text-only: ${verifiedResult.rows.length} verified QA matches`);
    return verifiedResult.rows;
  }

  // 2. Full-text search (all law text)
  const ftsSql = `
    SELECT id, law_name, chunk_text, article_numbers, chapter, source_url, category,
           source_type, verified_by,
           ts_rank_cd(tsv, plainto_tsquery('simple', $1)) + CASE WHEN source_type = 'verified_qa' THEN 0.25 ELSE 0 END AS score
    FROM legal_chunks
    WHERE is_valid = TRUE
      AND tsv @@ plainto_tsquery('simple', $1)
      ${categoryClause}
    ORDER BY score DESC
    LIMIT $2
  `;
  const ftsResult = await pool.query(ftsSql, params);
  if (ftsResult.rows.length > 0) {
    console.log(`[RAG] Text-only FTS: ${ftsResult.rows.length} matches`);
    return ftsResult.rows;
  }

  // 3. ILIKE keyword fallback — when FTS fails (apostrophes, short queries, etc.)
  if (keywords.length > 0) {
    console.log(`[RAG] FTS returned 0, trying ILIKE with keywords: ${keywords.join(', ')}`);
    const ilikeConds = keywords.slice(0, 4).map((_, i) => `chunk_text ILIKE $${i + 2 + (category ? 1 : 0)}`);
    const ilikeParams = category
      ? [limit, category, ...keywords.slice(0, 4).map(k => `%${k}%`)]
      : [limit, ...keywords.slice(0, 4).map(k => `%${k}%`)];

    const catFilter = category ? 'AND category = $2' : '';
    const ilikeSql = `
      SELECT id, law_name, chunk_text, article_numbers, chapter, source_url, category,
             source_type, verified_by, 0.3 AS score
      FROM legal_chunks
      WHERE is_valid = TRUE ${catFilter}
        AND (${ilikeConds.join(' OR ')})
      ORDER BY CASE WHEN source_type = 'verified_qa' THEN 0 ELSE 1 END,
               id
      LIMIT $1
    `;
    const ilikeResult = await pool.query(ilikeSql, ilikeParams);
    console.log(`[RAG] ILIKE fallback: ${ilikeResult.rows.length} matches`);
    return ilikeResult.rows;
  }

  console.log(`[RAG] Text-only search: 0 matches for "${query.substring(0, 50)}"`);
  return [];
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

// ========== RRF HYBRID SEARCH ==========

/**
 * Hybrid search with Reciprocal Rank Fusion (RRF).
 *
 * Лучше простого weighted sum:
 *   RRF(d) = Σ 1 / (k + rank_i)   где k=60 (стандарт)
 *
 * Пайплайн:
 *   1. Dense vector search  → topN результатов с рангами
 *   2. BM25 full-text search → topN результатов с рангами
 *   3. RRF fusion → единый рейтинг
 *   4. Boost verified_qa на +0.1
 *
 * @param {string} query
 * @param {object} opts
 * @param {string} opts.category  — фильтр по теме
 * @param {string} opts.language  — 'ru' | 'uz' | null (оба языка)
 * @param {number} opts.limit     — итоговое кол-во (default 8)
 * @param {string} opts.apiKey
 * @returns {Promise<Array>}
 */
async function rrfSearch(query, opts = {}) {
  await initLegalCorpus();

  const {
    category = null,
    language = null,
    limit = 8,
    topN = limit * 3,  // candidates per source
    apiKey,
    k = 60,            // RRF constant
  } = opts;

  if (!apiKey) throw new Error('API key required for RRF search');

  const queryEmbedding = await getEmbedding(query, apiKey);
  const embStr = `[${queryEmbedding.join(',')}]`;

  const filters = ['is_valid = TRUE'];
  const params = [embStr, query, topN];
  let paramIdx = 4;

  if (category) {
    filters.push(`category = $${paramIdx++}`);
    params.push(category);
  }
  if (language) {
    filters.push(`language = $${paramIdx++}`);
    params.push(language);
  }

  const whereClause = filters.join(' AND ');

  const sql = `
    WITH dense AS (
      SELECT id,
             ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank
      FROM legal_chunks
      WHERE ${whereClause} AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    ),
    bm25 AS (
      SELECT id,
             ROW_NUMBER() OVER (ORDER BY ts_rank_cd(tsv, plainto_tsquery('simple', $2)) DESC) AS rank
      FROM legal_chunks
      WHERE ${whereClause}
        AND tsv @@ plainto_tsquery('simple', $2)
      LIMIT $3
    ),
    rrf AS (
      SELECT
        COALESCE(d.id, b.id) AS id,
        COALESCE(1.0 / (${k} + d.rank), 0) +
        COALESCE(1.0 / (${k} + b.rank), 0) AS rrf_score
      FROM dense d
      FULL OUTER JOIN bm25 b ON d.id = b.id
    )
    SELECT
      lc.id, lc.law_name, lc.chunk_text, lc.article_numbers,
      lc.chapter, lc.source_url, lc.category, lc.source_type,
      lc.language, lc.verified_by,
      rrf.rrf_score + CASE WHEN lc.source_type = 'verified_qa' THEN 0.1 ELSE 0 END AS score
    FROM rrf
    JOIN legal_chunks lc ON lc.id = rrf.id
    ORDER BY score DESC
    LIMIT ${limit}
  `;

  const result = await pool.query(sql, params);
  return result.rows;
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

// ========== INGEST LOG ==========

/**
 * Write one ingest record to rag_ingest_log.
 *
 * @param {object} entry
 * @param {'url'|'file'} entry.sourceType
 * @param {string}  [entry.sourceUrl]
 * @param {string}  [entry.fileName]
 * @param {string}  entry.lawName
 * @param {string}  [entry.category]
 * @param {number}  entry.chunksTotal
 * @param {number}  [entry.embedded]
 * @param {string}  [entry.language]
 * @param {'ok'|'error'} [entry.status]
 * @param {string}  [entry.errorMsg]
 * @param {number}  [entry.ingestBy]
 */
async function logIngest(entry) {
  try {
    await pool.query(`
      INSERT INTO rag_ingest_log
        (source_type, source_url, file_name, law_name, category,
         chunks_total, embedded, language, status, error_msg, ingest_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [
      entry.sourceType || 'url',
      entry.sourceUrl  || null,
      entry.fileName   || null,
      entry.lawName    || '',
      entry.category   || null,
      entry.chunksTotal || 0,
      entry.embedded   || 0,
      entry.language   || 'ru',
      entry.status     || 'ok',
      entry.errorMsg   || null,
      entry.ingestBy   || null,
    ]);
  } catch (err) {
    // non-fatal — don't break ingestion if logging fails
    console.error('[INGEST LOG] Failed to write log:', err.message);
  }
}

/**
 * Get ingest history (newest first).
 *
 * @param {object} opts
 * @param {number} [opts.limit=50]
 * @param {string} [opts.category]   — filter by category
 * @param {string} [opts.sourceType] — 'url' | 'file'
 * @returns {Promise<Array>}
 */
async function getIngestLog({ limit = 50, category = null, sourceType = null } = {}) {
  const filters = [];
  const params = [];
  let idx = 1;

  if (category) {
    filters.push(`category = $${idx++}`);
    params.push(category);
  }
  if (sourceType) {
    filters.push(`source_type = $${idx++}`);
    params.push(sourceType);
  }

  const where = filters.length ? 'WHERE ' + filters.join(' AND ') : '';
  params.push(limit);

  const result = await pool.query(`
    SELECT id, source_type, source_url, file_name, law_name, category,
           chunks_total, embedded, language, status, error_msg, ingest_by, created_at
    FROM rag_ingest_log
    ${where}
    ORDER BY created_at DESC
    LIMIT $${idx}
  `, params);

  return result.rows;
}

/**
 * Summary stats for ingest log.
 */
async function getIngestStats() {
  const result = await pool.query(`
    SELECT
      COUNT(*)                                        AS total_ingests,
      COUNT(*) FILTER (WHERE status = 'ok')           AS successful,
      COUNT(*) FILTER (WHERE status = 'error')        AS failed,
      SUM(chunks_total)                               AS total_chunks,
      SUM(embedded)                                   AS total_embedded,
      COUNT(*) FILTER (WHERE source_type = 'url')    AS url_count,
      COUNT(*) FILTER (WHERE source_type = 'file')   AS file_count,
      MAX(created_at)                                 AS last_ingest_at
    FROM rag_ingest_log
  `);
  return result.rows[0];
}

module.exports = {
  initLegalCorpus,
  insertChunks,
  deleteByDocId,
  hybridSearch,
  rrfSearch,
  textOnlySearch,
  vectorSearch,
  getCorpusStats,
  rebuildVectorIndex,
  insertVerifiedAnswer,
  logIngest,
  getIngestLog,
  getIngestStats,
};
