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
const { buildKeywordArtifacts } = require('./search-utils');

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
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS search_text TEXT`);
    // Phase 1: document-level metadata for zero-hallucination grounding
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`);
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS status_label TEXT`);
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS adoption_date DATE`);
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS document_number VARCHAR(50)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_legal_chunks_active ON legal_chunks(is_active) WHERE is_active = TRUE AND is_valid = TRUE`);

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
        // DANGER: dropping the embedding column nulls EVERY vector in the corpus.
        // This used to run unconditionally, so any process whose embedding
        // provider had a different dimension (e.g. a deployed app on Gemini/OpenAI
        // vs. a local ingest on HuggingFace) would silently wipe the entire
        // corpus on boot. Only rebuild when it's safe — i.e. there are no
        // embeddings to lose — or when explicitly authorized via env flag.
        const filled = await pool.query(`SELECT COUNT(*) AS n FROM legal_chunks WHERE embedding IS NOT NULL`);
        const embeddedRows = parseInt(filled.rows[0].n, 10) || 0;
        const force = process.env.ALLOW_EMBED_MIGRATION === 'true';

        if (embeddedRows === 0 || force) {
          console.log(`[LEGAL CORPUS] Embedding dim mismatch: table=${currentDim}d, provider=${targetDim}d. Rebuilding column (${embeddedRows} embedded rows${force ? ', forced' : ''})...`);
          await pool.query(`DROP INDEX IF EXISTS idx_legal_chunks_embedding`);
          await pool.query(`ALTER TABLE legal_chunks DROP COLUMN embedding`);
          await pool.query(`ALTER TABLE legal_chunks ADD COLUMN embedding vector(${targetDim})`);
          console.log(`[LEGAL CORPUS] Embedding column rebuilt to ${targetDim}d. Re-ingest required.`);
        } else {
          console.warn(
            `[LEGAL CORPUS] ⚠ Embedding dim mismatch: table=${currentDim}d but this process's ` +
            `provider=${targetDim}d. REFUSING to drop the column — it holds ${embeddedRows} ` +
            `embedded rows that would be destroyed. This process is misconfigured for this DB. ` +
            `Align the embedding provider (HF_TOKEN/GEMINI_API_KEY/GPT_API_KEY) with the corpus, ` +
            `or set ALLOW_EMBED_MIGRATION=true to intentionally rebuild and re-ingest.`
          );
        }
      }
    }

    // Indexes for hybrid search
    // 1. Vector similarity index (IVFFlat — good for < 1M rows; switch to HNSW if scaling)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_legal_chunks_embedding
      ON legal_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50)
    `).catch(async (err) => {
      const msg = err.message || '';
      // IVFFlat requires at least some rows to build; skip if table empty
      if (msg.includes('could not create ivfflat index')) {
        console.log('[LEGAL CORPUS] IVFFlat index deferred (table empty, will build after first ingest)');
      } else if (err.code === '54000' || msg.includes('maintenance_work_mem')) {
        // The k-means build needs more memory than the server allows
        // (Supabase default maintenance_work_mem = 32MB, build wants ~40MB).
        // The corpus is small, so a sequential vector scan is fast — skip the
        // index rather than throwing on every init() call, which would break
        // all legacy rrfSearch fallbacks.
        console.warn('[LEGAL CORPUS] IVFFlat index skipped (insufficient maintenance_work_mem); using sequential scan');
        await pool.query(`DROP INDEX IF EXISTS idx_legal_chunks_embedding`).catch(() => {});
      } else {
        throw err;
      }
    });

    // 2. Full-text search index
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_legal_chunks_tsv
      ON legal_chunks USING GIN (tsv)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_legal_chunks_search_text_trgm
      ON legal_chunks USING GIN (search_text gin_trgm_ops)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_legal_chunks_text_trgm
      ON legal_chunks USING GIN (chunk_text gin_trgm_ops)
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

    await pool.query(`
      CREATE OR REPLACE FUNCTION legal_chunks_normalize_search_text(input_text TEXT) RETURNS TEXT AS $$
      DECLARE
        text_value TEXT := lower(COALESCE(input_text, ''));
      BEGIN
        -- Canonicalize Uzbek apostrophe variants before tokenization.
        text_value := replace(text_value, chr(699), '''');
        text_value := replace(text_value, chr(700), '''');
        text_value := replace(text_value, chr(701), '''');
        text_value := replace(text_value, chr(712), '''');
        text_value := replace(text_value, chr(714), '''');
        text_value := replace(text_value, chr(715), '''');
        text_value := replace(text_value, chr(8216), '''');
        text_value := replace(text_value, chr(8217), '''');
        text_value := replace(text_value, chr(96), '''');
        text_value := regexp_replace(text_value, '([[:alpha:][:digit:]])['']+([[:alpha:][:digit:]])', '\\1\\2', 'g');
        text_value := regexp_replace(text_value, '['']+', ' ', 'g');
        text_value := regexp_replace(text_value, '[^[:alnum:][:space:]]+', ' ', 'g');
        text_value := regexp_replace(text_value, '\\s+', ' ', 'g');
        RETURN btrim(text_value);
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    // Trigger to auto-generate tsvector on insert/update
    await pool.query(`
      CREATE OR REPLACE FUNCTION legal_chunks_tsv_trigger() RETURNS trigger AS $$
      BEGIN
        NEW.search_text := legal_chunks_normalize_search_text(COALESCE(NEW.chunk_text, '') || ' ' || COALESCE(NEW.law_name, ''));
        NEW.tsv := to_tsvector('simple', COALESCE(NEW.search_text, ''));
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

    // Backfill normalized search_text for older rows so Uzbek queries use the same surface everywhere.
    await pool.query(`
      UPDATE legal_chunks
      SET search_text = legal_chunks_normalize_search_text(COALESCE(chunk_text, '') || ' ' || COALESCE(law_name, ''))
      WHERE search_text IS NULL OR search_text = ''
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
    // Print the FULL error — an empty err.message (e.g. some pg/connection
    // errors) otherwise hides the real cause and surfaces as a blank "FAILED".
    console.error('[LEGAL CORPUS] Init error:', err.message || err.code || err.detail || err);
    if (err && err.stack) console.error(err.stack);
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

  let inserted = 0;
  const BATCH_SIZE = 100; // commit every 100 rows to avoid long-running transactions on Supabase

  for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
    const batch = chunks.slice(batchStart, batchStart + BATCH_SIZE);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      for (const chunk of batch) {
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
            is_active, status_label, adoption_date, document_number,
            language,
            source_type, quality_score, verified_by,
            embedding
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::vector)
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
          m.is_active !== false,
          m.status_label || null,
          m.adoption_date || null,
          m.document_number || null,
          m.language || 'ru',
          m.source_type || 'law_text',
          m.quality_score == null ? 0.5 : m.quality_score,
          m.verified_by || null,
          embeddingStr
        ]);

        inserted++;
      }

      await client.query('COMMIT');
      console.log(`[LEGAL CORPUS] Inserted ${inserted}/${chunks.length} chunks`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[LEGAL CORPUS] Insert error:', err.message);
      throw err;
    } finally {
      client.release();
    }
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

function buildRetrievalFilters({ category = null, language = null, startIndex = 1 } = {}) {
  const filters = ['is_valid = TRUE', '(is_active IS NULL OR is_active = TRUE)'];
  const params = [];
  let paramIndex = startIndex;

  if (category) {
    filters.push(`category = $${paramIndex++}`);
    params.push(category);
  }

  if (language) {
    filters.push(`language = $${paramIndex++}`);
    params.push(language);
  }

  return {
    whereClause: filters.join(' AND '),
    params,
    nextParam: paramIndex,
  };
}

async function denseSearchByEmbedding(embeddingStr, opts = {}) {
  await initLegalCorpus();

  const {
    category = null,
    language = null,
    limit = 5,
  } = opts;

  const { whereClause, params: filterParams } = buildRetrievalFilters({
    category,
    language,
    startIndex: 3,
  });

  const result = await pool.query(`
    SELECT
      id,
      law_name,
      chunk_text,
      article_numbers,
      chapter,
      source_url,
      category,
      source_type,
      language,
      verified_by,
      adoption_date,
      document_number,
      article_number_display,
      part_number,
      is_active,
      1 - (embedding <=> $1::vector) AS vector_score
    FROM legal_chunks
    WHERE ${whereClause}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> $1::vector
    LIMIT $2
  `, [embeddingStr, limit, ...filterParams]);

  return result.rows.map((row) => ({
    ...row,
    vector_score: Number(row.vector_score || 0),
    score: Number(row.vector_score || 0),
  }));
}

async function keywordSearch(query, opts = {}) {
  await initLegalCorpus();

  const {
    category = null,
    language = null,
    limit = 5,
  } = opts;

  const search = buildKeywordArtifacts(query);
  if ((!search.tsQuery || search.tsQuery.length === 0) && search.phrases.length === 0) {
    return [];
  }

  const { whereClause, params: filterParams } = buildRetrievalFilters({
    category,
    language,
    startIndex: 6,
  });

  const result = await pool.query(`
    WITH keyword_candidates AS (
      SELECT
        lc.id,
        lc.law_name,
        lc.chunk_text,
        lc.article_numbers,
        lc.chapter,
        lc.source_url,
        lc.category,
        lc.source_type,
        lc.language,
        lc.verified_by,
        lc.adoption_date,
        lc.document_number,
        lc.article_number_display,
        lc.part_number,
        lc.is_active,
        COALESCE(ts_rank_cd(lc.tsv, to_tsquery('simple', $1)), 0) AS keyword_score,
        CASE
          WHEN $2 = '' THEN FALSE
          ELSE lc.tsv @@ to_tsquery('simple', $2)
        END AS core_term_match,
        (
          SELECT COUNT(*)::int
          FROM unnest($3::text[]) AS term
          WHERE term <> ''
            AND lc.tsv @@ to_tsquery('simple', term || ':*')
        ) AS keyword_term_hits,
        EXISTS (
          SELECT 1
          FROM unnest($4::text[]) AS phrase
          WHERE phrase <> ''
            AND POSITION(' ' || phrase || ' ' IN ' ' || COALESCE(lc.search_text, '') || ' ') > 0
        ) AS exact_phrase_match
      FROM legal_chunks lc
      WHERE ${whereClause}
        AND (
          lc.tsv @@ to_tsquery('simple', $1)
          OR EXISTS (
            SELECT 1
            FROM unnest($4::text[]) AS phrase
            WHERE phrase <> ''
              AND POSITION(' ' || phrase || ' ' IN ' ' || COALESCE(lc.search_text, '') || ' ') > 0
          )
        )
    )
    SELECT
      *,
      (
        keyword_score
        + (keyword_term_hits * 0.08)
        + CASE WHEN core_term_match THEN 0.18 ELSE 0 END
        + CASE WHEN exact_phrase_match THEN 0.35 ELSE 0 END
        + CASE WHEN source_type = 'verified_qa' THEN 0.15 ELSE 0 END
      ) AS score
    FROM keyword_candidates
    ORDER BY score DESC, keyword_score DESC, id
    LIMIT $5
  `, [
    search.tsQuery,
    search.coreTsQuery || '',
    search.searchTokens,
    search.phrases,
    limit,
    ...filterParams,
  ]);

  return result.rows.map((row) => ({
    ...row,
    keyword_score: Number(row.keyword_score || 0),
    keyword_term_hits: Number(row.keyword_term_hits || 0),
    exact_phrase_match: Boolean(row.exact_phrase_match),
    core_term_match: Boolean(row.core_term_match),
    score: Number(row.score || 0),
  }));
}

function fuseWeightedResults(denseRows, keywordRows, opts = {}) {
  const {
    limit = 5,
    vectorWeight = 0.45,
    textWeight = 0.55,
    verifiedBoost = 0.1,
  } = opts;

  const merged = new Map();

  for (const row of denseRows) {
    merged.set(row.id, {
      ...row,
      score: Number(row.vector_score || 0) * vectorWeight,
      keyword_score: 0,
      keyword_term_hits: 0,
      exact_phrase_match: false,
      core_term_match: false,
    });
  }

  for (const row of keywordRows) {
    const keywordScore = Number(row.score || row.keyword_score || 0) * textWeight;
    const existing = merged.get(row.id);

    if (existing) {
      merged.set(row.id, {
        ...existing,
        ...row,
        vector_score: Number(existing.vector_score || 0),
        score: existing.score + keywordScore,
      });
      continue;
    }

    merged.set(row.id, {
      ...row,
      vector_score: 0,
      score: keywordScore,
    });
  }

  return Array.from(merged.values())
    .map((row) => ({
      ...row,
      score: row.score + (row.source_type === 'verified_qa' ? verifiedBoost : 0),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function fuseRrfResults(denseRows, keywordRows, opts = {}) {
  const {
    limit = 8,
    k = 60,
    denseWeight = 1.0,
    keywordWeight = 1.2,
    exactPhraseBoost = 0.06,
    coreTermBoost = 0.03,
    termHitBoost = 0.01,
    verifiedBoost = 0.1,
  } = opts;

  const merged = new Map();

  denseRows.forEach((row, index) => {
    const denseRank = index + 1;
    const score = denseWeight / (k + denseRank);

    merged.set(row.id, {
      ...row,
      dense_rank: denseRank,
      keyword_rank: null,
      keyword_score: 0,
      keyword_term_hits: 0,
      exact_phrase_match: false,
      core_term_match: false,
      score,
      rrf_score: score,
    });
  });

  keywordRows.forEach((row, index) => {
    const keywordRank = index + 1;
    const rrfScore = keywordWeight / (k + keywordRank);
    const bonus =
      (row.exact_phrase_match ? exactPhraseBoost : 0) +
      (row.core_term_match ? coreTermBoost : 0) +
      (Math.min(Number(row.keyword_term_hits || 0), 4) * termHitBoost);

    const existing = merged.get(row.id);

    if (existing) {
      merged.set(row.id, {
        ...existing,
        ...row,
        dense_rank: existing.dense_rank,
        keyword_rank: keywordRank,
        vector_score: Number(existing.vector_score || 0),
        score: existing.score + rrfScore + bonus,
        rrf_score: Number(existing.rrf_score || 0) + rrfScore,
      });
      return;
    }

    merged.set(row.id, {
      ...row,
      dense_rank: null,
      keyword_rank: keywordRank,
      vector_score: 0,
      score: rrfScore + bonus,
      rrf_score: rrfScore,
    });
  });

  return Array.from(merged.values())
    .map((row) => ({
      ...row,
      score: row.score + (row.source_type === 'verified_qa' ? verifiedBoost : 0),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return Number(right.keyword_score || 0) - Number(left.keyword_score || 0);
    })
    .slice(0, limit);
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
    language = null,
    limit = 5,
    vectorWeight = 0.45,
    textWeight = 0.55,
    apiKey
  } = opts;

  if (!apiKey) throw new Error('API key required for hybrid search');

  const queryEmbedding = await getEmbedding(query, apiKey);
  const embStr = `[${queryEmbedding.join(',')}]`;
  const denseRows = await denseSearchByEmbedding(embStr, {
    category,
    language,
    limit: limit * 3,
  });
  const keywordRows = await keywordSearch(query, {
    category,
    language,
    limit: limit * 3,
  });

  return fuseWeightedResults(denseRows, keywordRows, {
    limit,
    vectorWeight,
    textWeight,
  });
}

// ========== TEXT-ONLY FALLBACK SEARCH ==========

/**
 * Full-text search only — no embeddings needed.
 * Used when embedding API quota is exhausted.
 * Always prioritizes verified_qa entries.
 */
async function textOnlySearch(query, opts = {}) {
  await initLegalCorpus();
  const { category = null, language = null, limit = 5 } = opts;

  const keywordRows = await keywordSearch(query, { category, language, limit });
  if (keywordRows.length > 0) {
    console.log(`[RAG] Text-only keyword search: ${keywordRows.length} matches`);
    return keywordRows;
  }

  const search = buildKeywordArtifacts(query);
  const patterns = [
    ...search.phrases.slice(0, 2),
    ...search.searchTokens.slice(0, 4),
  ]
    .filter(Boolean)
    .map((value) => `%${value}%`);

  if (patterns.length > 0) {
    const filters = ['is_valid = TRUE', '(is_active IS NULL OR is_active = TRUE)'];
    const params = [limit];
    let paramIndex = 2;

    if (category) {
      filters.push(`category = $${paramIndex++}`);
      params.push(category);
    }

    if (language) {
      filters.push(`language = $${paramIndex++}`);
      params.push(language);
    }

    const patternStart = paramIndex;
    const ilikeConditions = patterns.map((_, index) => `search_text ILIKE $${patternStart + index}`);
    params.push(...patterns);

    const result = await pool.query(`
      SELECT
        id,
        law_name,
        chunk_text,
        article_numbers,
        chapter,
        source_url,
        category,
        source_type,
        language,
        verified_by,
        adoption_date,
        document_number,
        article_number_display,
        part_number,
        is_active,
        0.15 + CASE WHEN source_type = 'verified_qa' THEN 0.1 ELSE 0 END AS score,
        0 AS keyword_score,
        0 AS keyword_term_hits,
        FALSE AS exact_phrase_match,
        FALSE AS core_term_match
      FROM legal_chunks
      WHERE ${filters.join(' AND ')}
        AND (${ilikeConditions.join(' OR ')})
      ORDER BY score DESC, id
      LIMIT $1
    `, params);

    console.log(`[RAG] Text-only LIKE fallback: ${result.rows.length} matches`);
    return result.rows;
  }

  console.log(`[RAG] Text-only search: 0 matches for "${query.substring(0, 50)}"`);
  return [];

  if (false) {
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
           source_type, verified_by, is_active,
           ts_rank_cd(tsv, plainto_tsquery('simple', $1)) AS score
    FROM legal_chunks
    WHERE is_valid = TRUE AND (is_active IS NULL OR is_active = TRUE)
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
           source_type, verified_by, is_active,
           ts_rank_cd(tsv, plainto_tsquery('simple', $1)) + CASE WHEN source_type = 'verified_qa' THEN 0.25 ELSE 0 END AS score
    FROM legal_chunks
    WHERE is_valid = TRUE AND (is_active IS NULL OR is_active = TRUE)
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
             source_type, verified_by, is_active, 0.3 AS score
      FROM legal_chunks
      WHERE is_valid = TRUE AND (is_active IS NULL OR is_active = TRUE) ${catFilter}
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

  const chunkText = `Savol: ${question}\n\nJavob: ${answer}`;
  const docId = `verified_qa_${requestId || Date.now()}`;
  const lawName = verifiedByName
    ? `Tasdiqlangan javob — ${verifiedByName}`
    : 'Tasdiqlangan javob';

  // Remove old version of this QA if it exists (re-approval)
  await pool.query(`DELETE FROM legal_chunks WHERE doc_id = $1`, [docId]);

  // Try to generate embedding (best-effort — save without if API fails)
  let embStr = null;
  try {
    const apiKey = getApiKey();
    if (apiKey) {
      const embedding = await getEmbedding(chunkText, apiKey);
      embStr = `[${embedding.join(',')}]`;
    }
  } catch (embErr) {
    console.warn(`[LEGAL CORPUS] Embedding skipped: ${embErr.message}`);
  }

  if (embStr) {
    await pool.query(`
      INSERT INTO legal_chunks (
        law_name, doc_id, category, chunk_text, chunk_index,
        is_valid, embedding, source_type, quality_score, verified_by
      ) VALUES ($1, $2, $3, $4, 0, TRUE, $5::vector, 'verified_qa', 1.0, $6)
    `, [lawName, docId, category || 'boshqa', chunkText, embStr, verifiedBy || null]);
  } else {
    await pool.query(`
      INSERT INTO legal_chunks (
        law_name, doc_id, category, chunk_text, chunk_index,
        is_valid, source_type, quality_score, verified_by
      ) VALUES ($1, $2, $3, $4, 0, TRUE, 'verified_qa', 1.0, $5)
    `, [lawName, docId, category || 'boshqa', chunkText, verifiedBy || null]);
  }

  console.log(`[LEGAL CORPUS] Verified QA added: request #${requestId} by ${verifiedByName} (embedding: ${embStr ? 'yes' : 'no'})`);
  return docId;
}

/**
 * Simple vector-only search (faster, for fallback).
 */
async function vectorSearch(query, opts = {}) {
  await initLegalCorpus();

  const { category = null, language = null, limit = 5, apiKey } = opts;
  if (!apiKey) throw new Error('API key required for vector search');

  const queryEmbedding = await getEmbedding(query, apiKey);
  const embStr = `[${queryEmbedding.join(',')}]`;
  return denseSearchByEmbedding(embStr, { category, language, limit });
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
    WHERE is_valid = TRUE AND (is_active IS NULL OR is_active = TRUE)
    GROUP BY category
    ORDER BY category
  `);

  const total = await pool.query(`SELECT COUNT(*) FROM legal_chunks WHERE is_valid = TRUE AND (is_active IS NULL OR is_active = TRUE)`);

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
    topN = limit * 3,
    apiKey,
    k = 60,
    denseWeight = 1.0,
    keywordWeight = 1.2,
    exactPhraseBoost = 0.06,
    coreTermBoost = 0.03,
    termHitBoost = 0.01,
    verifiedBoost = 0.1,
  } = opts;

  if (!apiKey) throw new Error('API key required for RRF search');

  const queryEmbedding = await getEmbedding(query, apiKey);
  const embStr = `[${queryEmbedding.join(',')}]`;

  const denseRows = await denseSearchByEmbedding(embStr, {
    category,
    language,
    limit: topN,
  });
  const keywordRows = await keywordSearch(query, {
    category,
    language,
    limit: topN,
  });

  return fuseRrfResults(denseRows, keywordRows, {
    limit,
    k,
    denseWeight,
    keywordWeight,
    exactPhraseBoost,
    coreTermBoost,
    termHitBoost,
    verifiedBoost,
  });
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

  // Build on a dedicated connection so we can raise maintenance_work_mem just
  // for this session — Supabase's 32MB default is too small for the k-means
  // step on 1024-dim vectors. If the bump is rejected and the build still runs
  // out of memory, degrade to a sequential scan (fast at this corpus size)
  // instead of crashing the whole ingest.
  const client = await pool.connect();
  try {
    await client.query(`SET maintenance_work_mem = '128MB'`).catch(() => {});
    await client.query(`DROP INDEX IF EXISTS idx_legal_chunks_embedding`);
    await client.query(`
      CREATE INDEX idx_legal_chunks_embedding
      ON legal_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = ${lists})
    `);
    console.log(`[LEGAL CORPUS] IVFFlat index rebuilt with ${lists} lists (${n} vectors)`);
  } catch (err) {
    if (err.code === '54000' || (err.message || '').includes('maintenance_work_mem')) {
      console.warn(`[LEGAL CORPUS] IVFFlat build exceeds available memory; running without vector index (sequential scan). ${err.message}`);
      await client.query(`DROP INDEX IF EXISTS idx_legal_chunks_embedding`).catch(() => {});
    } else {
      throw err;
    }
  } finally {
    client.release();
  }
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
 * Standalone exact substring match search.
 * Used as a last-resort failsafe when keyword/vector ranking still under-ranks
 * a chunk that clearly contains the user's exact terms.
 */
async function exactMatchSearch(query, opts = {}) {
  await initLegalCorpus();

  const {
    category = null,
    language = null,
    limit = 5,
  } = opts;

  const search = buildKeywordArtifacts(query);
  const patterns = Array.from(new Set([
    ...search.phrases.slice(0, 4),
    ...search.searchTokens.slice(0, 4),
  ]))
    .filter(Boolean)
    .map((value) => `%${value}%`);

  if (patterns.length === 0) {
    return [];
  }

  const { whereClause, params: filterParams } = buildRetrievalFilters({
    category,
    language,
    startIndex: 3,
  });

  const result = await pool.query(`
    SELECT
      id,
      law_name,
      chunk_text,
      article_numbers,
      chapter,
      source_url,
      category,
      source_type,
      language,
      verified_by,
      adoption_date,
      document_number,
      article_number_display,
      part_number,
      is_active,
      0.8 + CASE WHEN source_type = 'verified_qa' THEN 0.1 ELSE 0 END AS score
    FROM legal_chunks
    WHERE ${whereClause}
      AND (
        search_text ILIKE ANY($2::text[])
        OR chunk_text ILIKE ANY($2::text[])
      )
    ORDER BY score DESC, length(chunk_text) DESC, id
    LIMIT $1
  `, [limit, patterns, ...filterParams]);

  console.log(`[RAG] Exact match: ${result.rows.length} matches for ${patterns.length} patterns`);
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
  keywordSearch,
  exactMatchSearch,
  vectorSearch,
  getCorpusStats,
  rebuildVectorIndex,
  insertVerifiedAnswer,
  logIngest,
  getIngestLog,
  getIngestStats,
};
