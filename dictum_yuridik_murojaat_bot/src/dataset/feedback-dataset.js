/**
 * Lawyer Feedback Learning System
 *
 * Stores mentor corrections to AI answers and uses them
 * to improve future AI reasoning via few-shot examples.
 * Uses pg_trgm trigram similarity for fuzzy matching.
 */

const { pool } = require('../database/db');

// ========== DATABASE SETUP ==========

async function initFeedbackDataset() {
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS lawyer_feedback_dataset (
        id SERIAL PRIMARY KEY,
        request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
        question TEXT NOT NULL,
        ai_answer TEXT,
        mentor_feedback_type VARCHAR(20) NOT NULL CHECK (mentor_feedback_type IN ('correct', 'partially_correct', 'incorrect')),
        corrected_answer TEXT,
        corrected_legal_reasoning TEXT,
        corrected_law_articles TEXT,
        legal_field VARCHAR(100),
        mentor_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
        mentor_name VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_feedback_question_trgm ON lawyer_feedback_dataset USING GIN (question gin_trgm_ops)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_feedback_type ON lawyer_feedback_dataset(mentor_feedback_type)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_feedback_field ON lawyer_feedback_dataset(legal_field)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_feedback_created ON lawyer_feedback_dataset(created_at DESC)`);

    console.log('[FEEDBACK DATASET] Initialized successfully');
  } catch (err) {
    console.error('[FEEDBACK DATASET] Init error:', err.message);
  }
}

// ========== SAVE FEEDBACK ==========

/**
 * Save mentor feedback on an AI/student answer.
 */
async function saveMentorFeedback(data) {
  const {
    request_id, question, ai_answer, mentor_feedback_type,
    corrected_answer, corrected_legal_reasoning, corrected_law_articles,
    legal_field, mentor_id, mentor_name
  } = data;

  const result = await pool.query(
    `INSERT INTO lawyer_feedback_dataset
     (request_id, question, ai_answer, mentor_feedback_type, corrected_answer,
      corrected_legal_reasoning, corrected_law_articles, legal_field, mentor_id, mentor_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [request_id, question, ai_answer || '', mentor_feedback_type,
     corrected_answer || '', corrected_legal_reasoning || '', corrected_law_articles || '',
     legal_field || 'Umumiy', mentor_id, mentor_name || '']
  );

  console.log(`[FEEDBACK] Saved ${mentor_feedback_type} feedback for request #${request_id} by ${mentor_name}`);
  return result.rows[0];
}

// ========== RETRIEVE SIMILAR FEEDBACK ==========

/**
 * Search feedback dataset for 3-5 similar corrected cases.
 * Prioritizes partially_correct and incorrect feedback (most learning value).
 */
async function retrieveFeedbackExamples(userQuestion, legalField = null) {
  try {
    const params = [userQuestion];
    let fieldFilter = '';

    if (legalField && legalField !== 'Boshqa') {
      fieldFilter = `AND (legal_field ILIKE $2 OR legal_field = 'Umumiy')`;
      params.push(`%${legalField}%`);
    }

    const result = await pool.query(`
      SELECT
        id, question, ai_answer, mentor_feedback_type,
        corrected_answer, corrected_legal_reasoning, corrected_law_articles,
        legal_field, mentor_name,
        similarity(question, $1) AS relevance_score
      FROM lawyer_feedback_dataset
      WHERE mentor_feedback_type IN ('partially_correct', 'incorrect')
        AND (corrected_answer IS NOT NULL AND corrected_answer != '')
        ${fieldFilter}
      ORDER BY relevance_score DESC,
        CASE mentor_feedback_type
          WHEN 'incorrect' THEN 1
          WHEN 'partially_correct' THEN 2
          ELSE 3
        END,
        created_at DESC
      LIMIT 5
    `, params);

    const examples = result.rows.filter(r => r.relevance_score > 0.05);

    console.log(`[FEEDBACK] Found ${examples.length} correction examples (top score: ${examples[0]?.relevance_score?.toFixed(3) || 0})`);
    return examples;
  } catch (err) {
    console.error('[FEEDBACK] Search error:', err.message);
    return [];
  }
}

/**
 * Format feedback examples for prompt injection.
 */
function formatFeedbackForPrompt(examples) {
  if (!examples || examples.length === 0) return '';

  const formatted = examples.map((ex, i) => {
    let block = `
Tuzatish ${i + 1} (${ex.legal_field} — ${ex.mentor_feedback_type === 'incorrect' ? 'NOTO\'G\'RI' : 'QISMAN TO\'G\'RI'}):
Savol: ${ex.question}`;

    if (ex.ai_answer) {
      block += `\nAI javobi (xato): ${ex.ai_answer.substring(0, 300)}${ex.ai_answer.length > 300 ? '...' : ''}`;
    }
    if (ex.corrected_legal_reasoning) {
      block += `\nTo'g'ri huquqiy mushohada: ${ex.corrected_legal_reasoning}`;
    }
    if (ex.corrected_law_articles) {
      block += `\nTo'g'ri qonun moddalari: ${ex.corrected_law_articles}`;
    }
    if (ex.corrected_answer) {
      block += `\nTo'g'ri javob: ${ex.corrected_answer.substring(0, 500)}${ex.corrected_answer.length > 500 ? '...' : ''}`;
    }
    block += `\nMentor: ${ex.mentor_name || 'Anonim'}`;

    return block;
  }).join('\n---');

  return `
MENTOR YURISTLAR TUZATMALARI (Feedback Learning):
Quyidagi namunalarda AI xato javob bergan va mentor yurist tuzatgan.
Bu tuzatmalardan o'rganib, O'XSHASH xatolarni TAKRORLAMANG.
${formatted}

MUHIM: Yuqoridagi tuzatmalar asosida o'z javobingizni tekshiring.
Agar o'xshash masala bo'lsa, mentor ko'rsatgan to'g'ri yo'ldan boring.`;
}

// ========== STATS ==========

async function getFeedbackStats() {
  const result = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE mentor_feedback_type = 'correct') AS correct,
      COUNT(*) FILTER (WHERE mentor_feedback_type = 'partially_correct') AS partially_correct,
      COUNT(*) FILTER (WHERE mentor_feedback_type = 'incorrect') AS incorrect,
      COUNT(DISTINCT mentor_id) AS mentors,
      COUNT(DISTINCT legal_field) AS fields,
      MAX(created_at) AS last_feedback
    FROM lawyer_feedback_dataset
  `);
  return result.rows[0];
}

async function getAllFeedback(limit = 50, offset = 0) {
  const result = await pool.query(
    `SELECT * FROM lawyer_feedback_dataset ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  const countResult = await pool.query(`SELECT COUNT(*) FROM lawyer_feedback_dataset`);
  return { feedback: result.rows, total: parseInt(countResult.rows[0].count) };
}

module.exports = {
  initFeedbackDataset,
  saveMentorFeedback,
  retrieveFeedbackExamples,
  formatFeedbackForPrompt,
  getFeedbackStats,
  getAllFeedback,
};
