'use strict';

/**
 * Advanced Legal Corpus — Parent-Child pgvector Storage & Retrieval
 *
 * Extends the existing legal_chunks table with:
 *   - chunk_type: 'parent' (full article) | 'child' (part/clause)
 *   - parent_chunk_id: FK to parent article chunk
 *   - article_number_display: human-readable with prim (e.g. "4¹")
 *   - part_number: specific part/clause number within article
 *   - part_type: 'article' | 'clause' | 'preamble' | 'band'
 *   - references: cross-referenced article numbers (TEXT[])
 *   - chunk_id: unique identifier for parent-child linking
 *
 * Retrieval strategy:
 *   1. Pre-filter by category (metadata filter) — NO vector scan on irrelevant categories
 *   2. Vector similarity on CHILD chunks only (precise matching)
 *   3. For each matched child, fetch its PARENT (full article context)
 *   4. Deduplicate by article — one article appears once even if multiple parts match
 *   5. Corrective grading on expanded context
 *
 * This approach gives the LLM both:
 *   - Precise citation (from child: "4¹-modda, 2-qism")
 *   - Full context (from parent: entire article text)
 */

const { pool } = require('../database/db');
const { getEmbedding, getEmbeddingsBatch, getEmbedDims, detectProvider } = require('./embeddings');

let _v2Initialized = false;

// ========== SCHEMA MIGRATION ==========

/**
 * Add v2 columns to existing legal_chunks table.
 * Fully idempotent — safe to call repeatedly.
 */
async function initAdvancedCorpus() {
  if (_v2Initialized) return;

  try {
    // Ensure base table exists (delegates to legal-corpus.js)
    const { initLegalCorpus } = require('./legal-corpus');
    await initLegalCorpus();

    // ── New columns for parent-child model ──
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS chunk_type VARCHAR(10) DEFAULT 'parent'`);
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS chunk_id VARCHAR(200)`);
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS parent_chunk_id VARCHAR(200)`);
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS article_number_display VARCHAR(50)`);
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS part_number VARCHAR(20)`);
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS part_type VARCHAR(20) DEFAULT 'article'`);
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS cross_references TEXT[]`);

    // ── Index for parent-child lookups ──
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_legal_chunks_chunk_id ON legal_chunks(chunk_id) WHERE chunk_id IS NOT NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_legal_chunks_parent_id ON legal_chunks(parent_chunk_id) WHERE parent_chunk_id IS NOT NULL`);

    // ── Composite index: category + chunk_type for filtered vector search ──
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_legal_chunks_cat_type ON legal_chunks(category, chunk_type) WHERE is_valid = TRUE`);

    // ── QA Bank table (dedicated, separate from legal_chunks) ──
    await pool.query(`
      CREATE TABLE IF NOT EXISTS qa_bank (
        id           SERIAL PRIMARY KEY,
        question     TEXT NOT NULL,
        answer       TEXT NOT NULL,
        category     VARCHAR(100),
        topic        VARCHAR(100),
        source_url   TEXT,
        article_refs TEXT[],
        rating       INTEGER DEFAULT 0,
        thumbs_up    INTEGER DEFAULT 0,
        thumbs_down  INTEGER DEFAULT 0,
        edited_by    INTEGER,
        edited_by_name TEXT,
        original_ai_answer TEXT,
        embedding    vector(${getEmbedDims()}),
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_qa_bank_category ON qa_bank(category)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_qa_bank_rating ON qa_bank(rating DESC)`);

    // Vector index for QA bank similarity search
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_qa_bank_embedding
      ON qa_bank USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10)
    `).catch(() => {
      // IVFFlat needs rows to build — will create after first insert
      console.log('[ADV CORPUS] QA bank vector index deferred (empty table)');
    });

    _v2Initialized = true;
    console.log('[ADV CORPUS] v2 schema ready (parent-child + qa_bank)');
  } catch (err) {
    console.error('[ADV CORPUS] Init error:', err.message);
  }
}

// ========== INSERT STRUCTURED CHUNKS ==========

/**
 * Insert parent + child chunks from the structural chunker.
 *
 * @param {import('./structural-chunker').LegalChunk[]} chunks
 * @returns {Promise<{ parents: number, children: number }>}
 */
async function insertStructuredChunks(chunks) {
  if (!chunks || chunks.length === 0) return { parents: 0, children: 0 };
  await initAdvancedCorpus();

  const client = await pool.connect();
  // Suppress unhandled 'error' events on checked-out clients. When the
  // Supabase pooler drops the connection mid-transaction, pg emits an
  // error event on the client directly (not through pool.on('error')).
  // Without this listener Node crashes the process. The actual error is
  // still surfaced via the rejected promise on the awaited client.query().
  client.on('error', (err) => {
    console.error('[ADV CORPUS] Client connection dropped:', err.message);
  });

  let parents = 0;
  let children = 0;
  let txErr = null;

  try {
    await client.query('BEGIN');

    for (const chunk of chunks) {
      const m = chunk.metadata || {};
      const articleNums = m.articleNumber
        ? [m.articleNumber]
        : (m.articles || []).map((article) => article.number).filter(Boolean);

      // Defense in depth: never persist a law chunk without a vector. A NULL
      // embedding is invisible to search but still bloats the corpus and looks
      // healthy in row counts — exactly how we ended up with thousands of
      // unsearchable rows. Fail loudly here so the caller's transaction rolls
      // back instead of silently storing dead rows.
      if (!Array.isArray(chunk.embedding) || chunk.embedding.length === 0) {
        throw new Error(
          `Refusing to insert chunk without embedding ` +
          `(law="${m.law_name || ''}", article="${m.articleNumber || ''}", type="${chunk.chunkType || '?'}").`
        );
      }
      const embStr = `[${chunk.embedding.join(',')}]`;

      await client.query(`
        INSERT INTO legal_chunks (
          law_name, doc_id, source_url, category,
          chunk_text, chunk_index,
          article_numbers, chapter,
          chunk_type, chunk_id, parent_chunk_id,
          article_number_display, part_number, part_type,
          cross_references,
          enforcement_date, is_valid,
          is_active, status_label, adoption_date, document_number,
          language, source_type, quality_score, verified_by,
          embedding
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6,
          $7, $8,
          $9, $10, $11,
          $12, $13, $14,
          $15,
          $16, TRUE,
          $17, $18, $19, $20,
          $21, $22, $23, $24,
          $25::vector
        )
      `, [
        m.law_name || '',
        m.doc_id || null,
        m.source_url || null,
        m.category || 'boshqa',
        chunk.text,
        chunk.chunkIndex || 0,
        articleNums.length > 0 ? articleNums : null,
        m.chapter || null,
        chunk.chunkType || 'parent',
        m.chunkId || null,
        chunk.parentId || null,
        m.articleNumber || articleNums[0] || null,
        m.partNumber || null,
        m.partType || 'article',
        m.references && m.references.length > 0 ? m.references : null,
        m.enforcement_date || null,
        m.is_active !== false,
        m.status_label || null,
        m.adoption_date || null,
        m.document_number || null,
        m.language || 'ru',
        m.source_type || 'law_text',
        m.quality_score == null ? 0.5 : m.quality_score,
        m.verified_by || null,
        embStr,
      ]);

      if (chunk.chunkType === 'parent') parents++;
      else children++;
    }

    await client.query('COMMIT');
    console.log(`[ADV CORPUS] Inserted ${parents} parents + ${children} children = ${parents + children} total`);
  } catch (err) {
    txErr = err;
    // ROLLBACK may also fail if the connection is already dead — swallow it.
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('[ADV CORPUS] Insert error:', err.message);
    throw err;
  } finally {
    // Pass the error so the pool destroys the broken connection instead of
    // recycling it back to the ready queue.
    client.release(txErr);
  }

  return { parents, children };
}

// ========== PARENT-CHILD RETRIEVAL ==========

/**
 * Advanced retrieval with metadata filtering + parent-child expansion.
 *
 * Algorithm:
 *   1. Filter legal_chunks by category (pre-filter, no vector scan on irrelevant docs)
 *   2. Vector search on CHILD chunks within that category
 *   3. For each matched child, look up its PARENT chunk
 *   4. Combine: child (precise citation) + parent (full context)
 *   5. Deduplicate by article number
 *
 * Falls back to searching parents directly if no children exist (legacy data).
 *
 * @param {string} query
 * @param {Object} opts
 * @param {string} opts.category - REQUIRED for metadata filtering
 * @param {number} opts.limit - max articles to return (default 5)
 * @param {string} opts.apiKey - embedding API key
 * @returns {Promise<Array<{
 *   articleNumber: string,
 *   articleTitle: string,
 *   childText: string,
 *   parentText: string,
 *   partNumber: string,
 *   chapter: string,
 *   sourceUrl: string,
 *   lawName: string,
 *   score: number,
 *   references: string[]
 * }>>}
 */
async function parentChildSearch(query, opts = {}) {
  await initAdvancedCorpus();

  const { category = null, limit = 5, apiKey } = opts;
  if (!apiKey) throw new Error('API key required for parent-child search');

  const queryEmbedding = await getEmbedding(query, apiKey);
  const embStr = `[${queryEmbedding.join(',')}]`;

  // ── Step 1: Check if v2 data exists (has children) ──
  const v2Check = await pool.query(
    `SELECT COUNT(*) FROM legal_chunks WHERE chunk_type = 'child' AND is_valid = TRUE ${category ? 'AND category = $1' : ''} LIMIT 1`,
    category ? [category] : []
  );
  const hasChildren = parseInt(v2Check.rows[0].count) > 0;

  if (!hasChildren) {
    // No v2 data — fall back to legacy RRF search
    console.log('[ADV CORPUS] No child chunks found, falling back to legacy search');
    const { rrfSearch } = require('./legal-corpus');
    return (await rrfSearch(query, { category, limit, apiKey })).map(r => ({
      articleNumber: r.article_numbers ? r.article_numbers[0] : '',
      articleTitle: '',
      childText: r.chunk_text,
      parentText: r.chunk_text,
      partNumber: null,
      chapter: r.chapter || '',
      sourceUrl: r.source_url || '',
      lawName: r.law_name || '',
      score: r.score || 0,
      references: [],
      legacy: true,
    }));
  }

  // ── Step 2: Vector search on CHILD chunks, filtered by category ──
  const childSql = `
    SELECT
      id, chunk_text, chunk_id, parent_chunk_id,
      article_number_display, part_number, part_type,
      chapter, source_url, law_name, category,
      cross_references,
      1 - (embedding <=> $1::vector) AS score
    FROM legal_chunks
    WHERE is_valid = TRUE AND (is_active IS NULL OR is_active = TRUE)
      AND chunk_type = 'child'
      ${category ? 'AND category = $3' : ''}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> $1::vector
    LIMIT $2
  `;

  const childParams = category
    ? [embStr, limit * 2, category]  // fetch extra to allow dedup
    : [embStr, limit * 2];

  const childResult = await pool.query(childSql, childParams);

  if (childResult.rows.length === 0) {
    // Try parent-only search
    const parentSql = `
      SELECT
        id, chunk_text, chunk_id,
        article_number_display, chapter, source_url, law_name,
        cross_references,
        1 - (embedding <=> $1::vector) AS score
      FROM legal_chunks
      WHERE is_valid = TRUE AND (is_active IS NULL OR is_active = TRUE)
        AND chunk_type = 'parent'
        ${category ? 'AND category = $3' : ''}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $2
    `;
    const parentResult = await pool.query(parentSql, category ? [embStr, limit, category] : [embStr, limit]);

    return parentResult.rows.map(r => ({
      articleNumber: r.article_number_display || '',
      articleTitle: '',
      childText: r.chunk_text,
      parentText: r.chunk_text,
      partNumber: null,
      chapter: r.chapter || '',
      sourceUrl: r.source_url || '',
      lawName: r.law_name || '',
      score: parseFloat(r.score) || 0,
      references: r.cross_references || [],
    }));
  }

  // ── Step 3: Fetch parent chunks for matched children ──
  const parentIds = [...new Set(childResult.rows.map(r => r.parent_chunk_id).filter(Boolean))];

  let parentMap = {};
  if (parentIds.length > 0) {
    const parentResult = await pool.query(
      `SELECT chunk_id, chunk_text, article_number_display, chapter, source_url, law_name
       FROM legal_chunks WHERE chunk_id = ANY($1)`,
      [parentIds]
    );
    for (const p of parentResult.rows) {
      parentMap[p.chunk_id] = p;
    }
  }

  // ── Step 4: Combine and deduplicate by article ──
  const seenArticles = new Set();
  const results = [];

  for (const child of childResult.rows) {
    const artKey = `${child.law_name}_${child.article_number_display}`;
    if (seenArticles.has(artKey)) continue;
    seenArticles.add(artKey);

    const parent = parentMap[child.parent_chunk_id];

    results.push({
      articleNumber: child.article_number_display || '',
      articleTitle: parent ? (parent.article_number_display || '') : '',
      childText: child.chunk_text,
      parentText: parent ? parent.chunk_text : child.chunk_text,
      partNumber: child.part_number,
      chapter: child.chapter || '',
      sourceUrl: child.source_url || parent?.source_url || '',
      lawName: child.law_name || parent?.law_name || '',
      score: parseFloat(child.score) || 0,
      references: child.cross_references || [],
    });

    if (results.length >= limit) break;
  }

  console.log(`[ADV CORPUS] Parent-child search: ${childResult.rows.length} children → ${results.length} articles`);
  return results;
}

// ========== QA BANK ==========

/**
 * Save an edited/verified QA pair to the qa_bank table.
 * Also inserts as verified_qa into legal_chunks for RAG retrieval.
 *
 * @param {Object} opts
 * @param {string} opts.question
 * @param {string} opts.answer - the corrected/finalized answer
 * @param {string} opts.originalAiAnswer - what the AI originally said
 * @param {string} opts.category
 * @param {string} opts.topic
 * @param {string} opts.sourceUrl
 * @param {string[]} opts.articleRefs - referenced article numbers
 * @param {number} opts.editedBy - admin ID
 * @param {string} opts.editedByName - admin name
 * @returns {Promise<number>} - qa_bank.id
 */
async function saveToQaBank(opts) {
  await initAdvancedCorpus();

  const { question, answer, originalAiAnswer, category, topic, sourceUrl,
          articleRefs = [], editedBy, editedByName } = opts;

  // Generate embedding for the QA pair
  let embStr = null;
  try {
    const apiKey = process.env.HF_TOKEN || process.env.GEMINI_API_KEY || process.env.GPT_API_KEY;
    if (apiKey) {
      const embedding = await getEmbedding(`${question}\n${answer}`, apiKey);
      embStr = `[${embedding.join(',')}]`;
    }
  } catch (err) {
    console.warn(`[QA BANK] Embedding skipped: ${err.message}`);
  }

  const result = await pool.query(`
    INSERT INTO qa_bank (
      question, answer, category, topic, source_url,
      article_refs, edited_by, edited_by_name, original_ai_answer,
      rating, embedding
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10::vector)
    RETURNING id
  `, [
    question, answer, category || null, topic || null, sourceUrl || null,
    articleRefs.length > 0 ? articleRefs : null,
    editedBy || null, editedByName || null, originalAiAnswer || null,
    embStr,
  ]);

  const qaId = result.rows[0].id;

  // Also insert into legal_chunks as verified_qa (for RAG retrieval)
  const { insertVerifiedAnswer } = require('./legal-corpus');
  await insertVerifiedAnswer({
    question,
    answer,
    category: category || topic || 'boshqa',
    requestId: `qa_bank_${qaId}`,
    verifiedBy: editedBy,
    verifiedByName: editedByName || 'Admin',
  });

  console.log(`[QA BANK] Saved #${qaId}: "${question.substring(0, 50)}..." by ${editedByName}`);
  return qaId;
}

/**
 * Record a thumbs up/down vote on a QA bank entry.
 * Also propagates a quality_score update to the linked legal_chunks row so
 * retrieval ranking reflects accumulated user feedback.
 */
async function voteQaBankEntry(qaId, direction) {
  await initAdvancedCorpus();

  const col = direction === 'up' ? 'thumbs_up' : 'thumbs_down';
  const { rows } = await pool.query(
    `UPDATE qa_bank SET ${col} = ${col} + 1, rating = thumbs_up - thumbs_down, updated_at = NOW()
     WHERE id = $1
     RETURNING thumbs_up, thumbs_down, rating`,
    [qaId]
  );

  if (rows.length === 0) return;
  const { thumbs_up, thumbs_down, rating } = rows[0];
  const total = thumbs_up + thumbs_down;

  // Map rating to quality_score in [0.1, 1.0]:
  // neutral (0 votes) → 1.0, fully negative → 0.1, fully positive → 1.0
  const ratio = total > 0 ? thumbs_up / total : 1;
  const qualityScore = Math.max(0.1, Math.min(1.0, 0.1 + ratio * 0.9));

  // Update the linked legal_chunks row (doc_id pattern set by saveToQaBank / insertVerifiedAnswer)
  await pool.query(
    `UPDATE legal_chunks SET quality_score = $1, updated_at = NOW()
     WHERE doc_id = $2 AND source_type = 'verified_qa'`,
    [qualityScore, `verified_qa_qa_bank_${qaId}`]
  );
}

/**
 * Find similar QA pairs from the bank for few-shot injection.
 * Returns top-rated, similar questions.
 *
 * @param {string} query - user's question
 * @param {string} category - legal category filter
 * @param {number} limit - max examples (default 3)
 * @returns {Promise<Array<{question: string, answer: string, rating: number}>>}
 */
async function findSimilarQA(query, category = null, limit = 3) {
  await initAdvancedCorpus();

  const apiKey = process.env.HF_TOKEN || process.env.GEMINI_API_KEY || process.env.GPT_API_KEY;

  // Try vector similarity first
  if (apiKey) {
    try {
      const embedding = await getEmbedding(query, apiKey);
      const embStr = `[${embedding.join(',')}]`;

      const sql = `
        SELECT question, answer, rating, article_refs, category
        FROM qa_bank
        WHERE rating >= 0
          ${category ? 'AND category = $3' : ''}
          AND embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT $2
      `;

      const params = category ? [embStr, limit, category] : [embStr, limit];
      const result = await pool.query(sql, params);

      if (result.rows.length > 0) {
        return result.rows;
      }
    } catch (err) {
      console.warn(`[QA BANK] Vector search failed: ${err.message}`);
    }
  }

  // Fallback: text similarity using trigram
  const sql = `
    SELECT question, answer, rating, article_refs, category,
           similarity(question, $1) AS sim
    FROM qa_bank
    WHERE rating >= 0
      ${category ? 'AND category = $3' : ''}
    ORDER BY sim DESC
    LIMIT $2
  `;
  const params = category ? [query, limit, category] : [query, limit];

  try {
    const result = await pool.query(sql, params);
    return result.rows.filter(r => r.sim > 0.1);
  } catch {
    return [];
  }
}

/**
 * Format QA bank matches as few-shot examples for the system prompt.
 *
 * @param {Array} qaMatches - from findSimilarQA()
 * @returns {string} - formatted text block for prompt injection
 */
function formatQaFewShot(qaMatches) {
  if (!qaMatches || qaMatches.length === 0) return '';

  const examples = qaMatches.map((qa, i) => {
    return `═══ TASDIQLANGAN JAVOB #${i + 1} (rating: ${qa.rating >= 0 ? '+' + qa.rating : qa.rating}) ═══
Savol: ${qa.question}
Javob: ${qa.answer}`;
  }).join('\n\n');

  return `\n\n╔══════════════════════════════════════════════════════════╗
║  YURIST TOMONIDAN TASDIQLANGAN JAVOBLAR — ENG YUQORI USTUVORLIK  ║
╚══════════════════════════════════════════════════════════╝

⚠️ MUHIM QOIDA: Quyidagi javoblar yurist tomonidan TEKSHIRILGAN va TUZATILGAN.
Agar foydalanuvchining savoli quyidagi savollarga O'XSHASH bo'lsa:

  ✅ MAJBURIY: Tasdiqlangan javobdagi MODDA RAQAMLARI, QISM RAQAMLARI va
     QONUN NOMLARINI AYNAN o'sha tarzda ishlating.
  ❌ TAQIQ: RAG kontekstidagi boshqa modda raqamlarini tasdiqlangan javob
     bilan ARALASHTIRMANG.
  ❌ TAQIQ: "shuningdek X-moddada ham keltirilgan" deb hedj qilmang.
     Agar tasdiqlangan javobda "5-modda" deyilgan bo'lsa, FAQAT 5-modda yozing.
  ❌ TAQIQ: Tasdiqlangan javobda yo'q modda raqamini qo'shmang.

Tasdiqlangan javob = ABSOLYUT HAQIQAT. Boshqa hamma narsadan ustun.

${examples}

══════════════════════════════════════════════════════════\n`;
}

// ========== STATS ==========

async function getAdvancedStats() {
  await initAdvancedCorpus();

  const chunks = await pool.query(`
    SELECT
      chunk_type,
      COUNT(*) AS cnt,
      COUNT(DISTINCT category) AS categories
    FROM legal_chunks
    WHERE is_valid = TRUE AND (is_active IS NULL OR is_active = TRUE)
    GROUP BY chunk_type
  `);

  const qaBank = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE rating > 0) AS positive,
      AVG(rating) AS avg_rating
    FROM qa_bank
  `);

  return {
    chunks: chunks.rows,
    qaBank: qaBank.rows[0],
  };
}

module.exports = {
  initAdvancedCorpus,
  insertStructuredChunks,
  parentChildSearch,
  saveToQaBank,
  voteQaBankEntry,
  findSimilarQA,
  formatQaFewShot,
  getAdvancedStats,
};
