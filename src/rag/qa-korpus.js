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
const { getEmbedding, getEmbedDims } = require('./embeddings');

const KORPUS_VERBATIM_THRESHOLD = 0.92;
const KORPUS_CONTEXT_THRESHOLD = 0.78;

let _initialized = false;

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
    const dims = getEmbedDims();
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
    // Vector index for fast similarity search
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_qa_korpus_embedding
      ON qa_korpus USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10)
    `).catch(() => {
      // IVFFlat needs rows to build — deferred until first insert
      console.log('[QA-KORPUS] Vector index deferred (empty table)');
    });

    _initialized = true;
    console.log('[QA-KORPUS] qa_korpus schema ready');
  } catch (err) {
    console.error('[QA-KORPUS] Init failed:', err.message);
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
    const apiKey = process.env.HF_TOKEN || process.env.GEMINI_API_KEY || process.env.GPT_API_KEY;
    if (apiKey) {
      const embedding = await getEmbedding(question, apiKey);
      embStr = `[${embedding.join(',')}]`;
    }
  } catch (err) {
    console.warn(`[QA-KORPUS] Embedding failed: ${err.message}`);
  }

  const result = await pool.query(`
    INSERT INTO qa_korpus (
      question, question_hash, corrected_answer, original_ai_answer,
      topic, article_refs, embedding, created_by, created_by_name
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8, $9)
    ON CONFLICT (question_hash) DO UPDATE SET
      corrected_answer   = EXCLUDED.corrected_answer,
      original_ai_answer = EXCLUDED.original_ai_answer,
      topic              = COALESCE(EXCLUDED.topic, qa_korpus.topic),
      article_refs       = COALESCE(EXCLUDED.article_refs, qa_korpus.article_refs),
      embedding          = COALESCE(EXCLUDED.embedding, qa_korpus.embedding),
      created_by         = EXCLUDED.created_by,
      created_by_name    = EXCLUDED.created_by_name,
      updated_at         = NOW()
    RETURNING id, (xmax = 0) AS is_insert
  `, [
    question, hash, correctedAnswer, originalAiAnswer || null,
    topic || null,
    articleRefs && articleRefs.length > 0 ? articleRefs : null,
    embStr,
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
};
