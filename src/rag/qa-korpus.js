'use strict';

/**
 * QA Korpus — Stage 1: Semantic Cache & Ground Truth for Expert-Corrected Answers
 *
 * When a legal expert corrects an AI answer via "Tahrirlash" (Edit), the
 * corrected Q+A is stored here with its embedding. On every new user question,
 * this table is searched FIRST (before the main RAG pipeline). If the cosine
 * similarity exceeds KORPUS_VERBATIM_THRESHOLD (0.92), the corrected answer
 * is returned verbatim — no AI involved. This guarantees deterministic,
 * expert-approved answers for questions that have been reviewed.
 *
 * At a lower threshold (KORPUS_CONTEXT_THRESHOLD, 0.78), the corrected answer
 * is injected into the system prompt as "Absolute Ground Truth" so the AI
 * model defers to it.
 *
 * Deduplication: questions are normalized (lowercase, collapse whitespace,
 * strip punctuation) and hashed. Saving the same question twice UPSERTs —
 * the latest correction always wins.
 *
 * Schema:
 *   qa_korpus(
 *     id               SERIAL PRIMARY KEY,
 *     question          TEXT NOT NULL,
 *     question_hash     TEXT NOT NULL UNIQUE,
 *     corrected_answer  TEXT NOT NULL,
 *     original_ai_answer TEXT,
 *     topic             VARCHAR(100),
 *     article_refs      TEXT[],
 *     embedding         vector(N),
 *     created_by        INTEGER,
 *     created_by_name   TEXT,
 *     created_at        TIMESTAMPTZ DEFAULT NOW(),
 *     updated_at        TIMESTAMPTZ DEFAULT NOW()
 *   )
 */

const { pool } = require('../database/db');
const { getEmbedding, getEmbeddingsBatch, getEmbedDims, EMBED_MODEL } = require('./embeddings');

const KORPUS_VERBATIM_THRESHOLD = 0.92;
const KORPUS_CONTEXT_THRESHOLD = 0.78;

let _initialized = false;
let _qaEmbeddingDims = null;
let _backfillStarted = false;

function shouldMigrateEmbeddingColumn(storedDims, targetDims) {
  const stored = Number(storedDims);
  const target = Number(targetDims);
  return Number.isInteger(stored) && stored > 0
    && Number.isInteger(target) && target > 0
    && stored !== target;
}

async function getQaEmbeddingDimensions(db = pool) {
  const result = await db.query(`
    SELECT atttypmod
    FROM pg_attribute
    JOIN pg_class ON pg_class.oid = pg_attribute.attrelid
    WHERE pg_class.relname = 'qa_korpus'
      AND pg_attribute.attname = 'embedding'
      AND pg_attribute.attnum > 0
  `);
  if (!result.rows.length) return null;
  const dims = parseInt(result.rows[0].atttypmod, 10);
  return Number.isFinite(dims) && dims > 0 ? dims : null;
}

async function getLegalCorpusEmbeddingDimensions() {
  try {
    const result = await pool.query(`
      SELECT pg_attribute.atttypmod
      FROM pg_attribute
      JOIN pg_class ON pg_class.oid = pg_attribute.attrelid
      WHERE pg_class.relname = 'legal_chunks'
        AND pg_attribute.attname = 'embedding'
        AND pg_attribute.attnum > 0
      LIMIT 1
    `);
    if (!result.rows.length) return null;
    const dims = parseInt(result.rows[0].atttypmod, 10);
    return Number.isFinite(dims) && dims > 0 ? dims : null;
  } catch (_) {
    return null;
  }
}

async function migrateQaEmbeddingColumn(storedDims, targetDims) {
  const safeStored = parseInt(storedDims, 10);
  const safeTarget = parseInt(targetDims, 10);
  if (!shouldMigrateEmbeddingColumn(safeStored, safeTarget)) return false;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Multiple Render instances can start together. Only one may rename the
    // shared column, and every waiter re-checks the schema after taking the lock.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('qa_korpus_embedding_migration'))`);
    const currentDims = await getQaEmbeddingDimensions(client);
    if (!shouldMigrateEmbeddingColumn(currentDims, safeTarget)) {
      await client.query('COMMIT');
      return false;
    }

    let legacyName = `embedding_legacy_${safeStored}`;
    const existing = await client.query(`
      SELECT attname FROM pg_attribute
      JOIN pg_class ON pg_class.oid = pg_attribute.attrelid
      WHERE pg_class.relname = 'qa_korpus'
        AND pg_attribute.attname LIKE $1
        AND pg_attribute.attnum > 0
    `, [`${legacyName}%`]);
    const names = new Set(existing.rows.map(row => row.attname));
    let suffix = 2;
    while (names.has(legacyName)) legacyName = `embedding_legacy_${safeStored}_${suffix++}`;

    await client.query('DROP INDEX IF EXISTS idx_qa_korpus_embedding');
    await client.query(`ALTER TABLE qa_korpus RENAME COLUMN embedding TO ${legacyName}`);
    await client.query(`ALTER TABLE qa_korpus ADD COLUMN embedding vector(${safeTarget})`);
    await client.query('COMMIT');
    console.log(`[QA-KORPUS] Preserved ${safeStored}d vectors in ${legacyName}; active embedding column is now ${safeTarget}d`);
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function backfillQaEmbeddings() {
  if (_backfillStarted) return;
  _backfillStarted = true;
  let client = null;
  let lockHeld = false;
  try {
    const apiKey = process.env.HF_TOKEN || process.env.GEMINI_API_KEY
      || process.env.GPT_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey || !_qaEmbeddingDims) return;

    client = await pool.connect();
    const lock = await client.query(`SELECT pg_try_advisory_lock(hashtext('qa_korpus_embedding_backfill')) AS acquired`);
    lockHeld = lock.rows[0] && lock.rows[0].acquired === true;
    if (!lockHeld) return;

    while (true) {
      const missing = await client.query(`
        SELECT id, question
        FROM qa_korpus
        WHERE embedding IS NULL
        ORDER BY id
        LIMIT 50
      `);
      if (!missing.rows.length) break;

      const vectors = await getEmbeddingsBatch(missing.rows.map(row => row.question), apiKey);
      for (let i = 0; i < missing.rows.length; i++) {
        const vector = vectors[i];
        if (!Array.isArray(vector) || vector.length !== _qaEmbeddingDims) {
          throw new Error(`Backfill vector dimension ${vector && vector.length} does not match qa_korpus ${_qaEmbeddingDims}`);
        }
        await client.query(`
          UPDATE qa_korpus
          SET embedding = $1::vector,
              embedding_model = $2,
              embedding_dims = $3,
              updated_at = NOW()
          WHERE id = $4 AND embedding IS NULL
        `, [`[${vector.join(',')}]`, EMBED_MODEL, _qaEmbeddingDims, missing.rows[i].id]);
      }
      console.log(`[QA-KORPUS] Re-embedded ${missing.rows.length} legacy approved question(s) at ${_qaEmbeddingDims}d`);
    }
  } catch (err) {
    console.warn(`[QA-KORPUS] Background re-embedding paused: ${err.message}`);
  } finally {
    if (client && lockHeld) {
      await client.query(`SELECT pg_advisory_unlock(hashtext('qa_korpus_embedding_backfill'))`).catch(() => {});
    }
    if (client) client.release();
    _backfillStarted = false;
  }
}

/**
 * Normalize question for deduplication.
 * Lowercase, collapse whitespace, strip punctuation.
 */
function normalizeQuestion(q) {
  return (q || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function initQaKorpus() {
  if (_initialized) return;
  try {
    const providerDims = getEmbedDims();
    // The legal corpus is authoritative. qa_korpus must use the same vector
    // space or the shared query embedding cannot be compared safely.
    const dims = (await getLegalCorpusEmbeddingDimensions()) || providerDims;
    if (dims !== providerDims) {
      console.warn(
        `[QA-KORPUS] Legal corpus is ${dims}d but active provider is ${providerDims}d. ` +
        'QA semantic lookup will remain disabled until the provider matches the legal corpus.'
      );
    }
    _qaEmbeddingDims = dims;
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS qa_korpus (
        id                SERIAL PRIMARY KEY,
        question          TEXT NOT NULL,
        question_hash     TEXT NOT NULL UNIQUE,
        corrected_answer  TEXT NOT NULL,
        original_ai_answer TEXT,
        topic             VARCHAR(100),
        article_refs      TEXT[],
        embedding         vector(${dims}),
        created_by        INTEGER,
        created_by_name   TEXT,
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_qa_korpus_topic ON qa_korpus(topic)`);
    await pool.query(`ALTER TABLE qa_korpus ADD COLUMN IF NOT EXISTS embedding_model TEXT`);
    await pool.query(`ALTER TABLE qa_korpus ADD COLUMN IF NOT EXISTS embedding_dims INTEGER`);

    const storedDims = await getQaEmbeddingDimensions();
    if (shouldMigrateEmbeddingColumn(storedDims, dims)) {
      await migrateQaEmbeddingColumn(storedDims, dims);
    }
    // Vector index for fast similarity search
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_qa_korpus_embedding
      ON qa_korpus USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10)
    `).catch(() => {
      // IVFFlat needs rows to build — deferred until first insert
      console.log('[QA-KORPUS] Vector index deferred (empty table)');
    });

    _initialized = true;
    console.log(`[QA-KORPUS] qa_korpus schema ready (${_qaEmbeddingDims}d)`);
    setImmediate(() => backfillQaEmbeddings());
  } catch (err) {
    console.error('[QA-KORPUS] Init failed:', err.message);
    throw err;
  }
}

/**
 * Save or update a corrected Q&A pair.
 * UPSERT by question_hash so re-saving the same question replaces the answer.
 *
 * @param {Object} opts
 * @param {string} opts.question
 * @param {string} opts.correctedAnswer
 * @param {string} opts.originalAiAnswer
 * @param {string} opts.topic
 * @param {string[]} opts.articleRefs
 * @param {number} opts.createdBy
 * @param {string} opts.createdByName
 * @returns {Promise<{id: number, isUpdate: boolean}>}
 */
async function upsertKorpus({ question, correctedAnswer, originalAiAnswer, topic, articleRefs, createdBy, createdByName }) {
  await initQaKorpus();

  const hash = normalizeQuestion(question);
  if (!hash) throw new Error('Empty question');

  // Generate embedding for the question (not question+answer, so query-time
  // similarity is measured against the question only)
  let embStr = null;
  try {
    const apiKey = process.env.HF_TOKEN || process.env.GEMINI_API_KEY
      || process.env.GPT_API_KEY || process.env.OPENAI_API_KEY;
    if (apiKey) {
      const [embedding] = await getEmbeddingsBatch([question], apiKey);
      if (embedding.length !== _qaEmbeddingDims) {
        throw new Error(`Embedding dimension ${embedding.length} does not match qa_korpus ${_qaEmbeddingDims}`);
      }
      embStr = `[${embedding.join(',')}]`;
    }
  } catch (err) {
    console.warn(`[QA-KORPUS] Embedding failed: ${err.message}`);
  }

  const result = await pool.query(`
    INSERT INTO qa_korpus (
      question, question_hash, corrected_answer, original_ai_answer,
      topic, article_refs, embedding, embedding_model, embedding_dims,
      created_by, created_by_name
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, $9, $10, $11)
    ON CONFLICT (question_hash) DO UPDATE SET
      corrected_answer   = EXCLUDED.corrected_answer,
      original_ai_answer = EXCLUDED.original_ai_answer,
      topic              = COALESCE(EXCLUDED.topic, qa_korpus.topic),
      article_refs       = COALESCE(EXCLUDED.article_refs, qa_korpus.article_refs),
      embedding          = COALESCE(EXCLUDED.embedding, qa_korpus.embedding),
      embedding_model    = COALESCE(EXCLUDED.embedding_model, qa_korpus.embedding_model),
      embedding_dims     = COALESCE(EXCLUDED.embedding_dims, qa_korpus.embedding_dims),
      created_by         = EXCLUDED.created_by,
      created_by_name    = EXCLUDED.created_by_name,
      updated_at         = NOW()
    RETURNING id, (xmax = 0) AS is_insert
  `, [
    question, hash, correctedAnswer, originalAiAnswer || null,
    topic || null,
    articleRefs && articleRefs.length > 0 ? articleRefs : null,
    embStr,
    embStr ? EMBED_MODEL : null,
    embStr ? _qaEmbeddingDims : null,
    createdBy || null, createdByName || null,
  ]);

  const row = result.rows[0];
  const isUpdate = !row.is_insert;
  console.log(`[QA-KORPUS] ${isUpdate ? 'Updated' : 'Inserted'} #${row.id}: "${question.substring(0, 60)}..." by ${createdByName || 'unknown'}`);
  return { id: row.id, isUpdate };
}

/**
 * Search qa_korpus for a matching expert-corrected answer.
 *
 * Returns:
 *   - { match: 'verbatim', similarity, answer, question, topic } if sim >= 0.92
 *   - { match: 'context',  similarity, answer, question, topic } if sim >= 0.78
 *   - null if no match above KORPUS_CONTEXT_THRESHOLD
 *
 * @param {string} query - user's question
 * @param {Object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.topic - optional topic filter
 * @returns {Promise<Object|null>}
 */
async function searchKorpus(query, opts = {}) {
  await initQaKorpus();

  const { apiKey, topic } = opts;
  if (!apiKey) return null;

  let qEmb;
  try {
    qEmb = await getEmbedding(query, apiKey);
    if (qEmb.length !== _qaEmbeddingDims) {
      console.warn(`[QA-KORPUS] Query vector ${qEmb.length}d does not match active column ${_qaEmbeddingDims}d; skipping semantic cache`);
      return null;
    }
  } catch (err) {
    console.warn(`[QA-KORPUS] Query embedding failed: ${err.message}`);
    return null;
  }

  const embStr = `[${qEmb.join(',')}]`;

  const sql = `
    SELECT id, question, corrected_answer, topic, article_refs,
           1 - (embedding <=> $1::vector) AS similarity
    FROM qa_korpus
    WHERE embedding IS NOT NULL
      ${topic ? 'AND (topic = $3 OR topic IS NULL)' : ''}
    ORDER BY embedding <=> $1::vector
    LIMIT $2
  `;

  const params = topic ? [embStr, 3, topic] : [embStr, 3];
  const result = await pool.query(sql, params);

  if (result.rows.length === 0) return null;

  const top = result.rows[0];
  const sim = parseFloat(top.similarity);

  console.log(`[QA-KORPUS] Top match: id=${top.id} sim=${sim.toFixed(3)} topic=${top.topic}`);

  if (sim >= KORPUS_VERBATIM_THRESHOLD) {
    return {
      match: 'verbatim',
      similarity: sim,
      answer: top.corrected_answer,
      question: top.question,
      topic: top.topic,
      articleRefs: top.article_refs,
      id: top.id,
    };
  }

  if (sim >= KORPUS_CONTEXT_THRESHOLD) {
    return {
      match: 'context',
      similarity: sim,
      answer: top.corrected_answer,
      question: top.question,
      topic: top.topic,
      articleRefs: top.article_refs,
      id: top.id,
    };
  }

  return null;
}

/**
 * Format a korpus match as an absolute ground truth block for the system prompt.
 * Used when match='context' (similarity 0.78-0.92).
 */
function formatKorpusGroundTruth(korpusResult) {
  if (!korpusResult) return '';

  return `
╔══════════════════════════════════════════════════════════╗
║  ABSOLYUT HAQIQAT — YURIST TOMONIDAN TASDIQLANGAN       ║
╠══════════════════════════════════════════════════════════╣
║  Quyidagi javob yuqori malakali yurist tomonidan         ║
║  SHAXSAN tekshirilgan va TUZATILGAN.                     ║
║                                                          ║
║  Bu javob RAG kontekstidan VA modelning o'z bilimidan    ║
║  YUQORI USTUVORLIKKA EGA.                                ║
║                                                          ║
║  Agar foydalanuvchi savoli quyidagi savolga O'XSHASH     ║
║  bo'lsa — FAQAT shu javobdan foydalaning.                ║
║  HECH NARSA QO'SHMANG, HECH NARSA O'ZGARTIRMANG.        ║
╚══════════════════════════════════════════════════════════╝

TASDIQLANGAN SAVOL: ${korpusResult.question}

TASDIQLANGAN JAVOB:
${korpusResult.answer}

══════════════════════════════════════════════════════════
⚠️ YUQORIDAGI JAVOBNI AYNAN SHU KO'RINISHDA BERING.
   Modda raqamlarini O'ZGARTIRMANG. Yangi moddalar QO'SHMANG.
══════════════════════════════════════════════════════════
`;
}

module.exports = {
  initQaKorpus,
  upsertKorpus,
  searchKorpus,
  formatKorpusGroundTruth,
  normalizeQuestion,
  KORPUS_VERBATIM_THRESHOLD,
  KORPUS_CONTEXT_THRESHOLD,
  __test: {
    shouldMigrateEmbeddingColumn,
  },
};
