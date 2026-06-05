'use strict';

/**
 * RAG Usage Feedback Loop
 *
 * Closes the self-improvement loop: end-user 👍/👎 votes on answers that were
 * served from a verified-answer chunk are attributed back to that exact
 * `legal_chunks` row. Retrieval then stops blindly trusting verified answers
 * that users consistently mark unhelpful.
 *
 * Schema additions on legal_chunks (idempotent):
 *   helpful_count      INT  — cumulative 👍
 *   unhelpful_count    INT  — cumulative 👎
 *   flagged_for_review BOOL — set when net feedback turns negative; surfaced
 *                             to lawyers and used to suppress verbatim override
 *
 * Policy (per product decision): "flag for lawyer, keep serving" — a
 * net-negative verified answer is flagged and stops being returned verbatim
 * (drops to few-shot guidance only), but is not deleted; a lawyer reviews it.
 */

const { pool } = require('../database/db');

// Net (unhelpful − helpful) at/above which an answer is flagged & de-prioritised.
const FLAG_THRESHOLD = 3;

let _ready = false;

async function initUsageFeedback() {
  if (_ready) return;
  try {
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS helpful_count INT DEFAULT 0`);
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS unhelpful_count INT DEFAULT 0`);
    await pool.query(`ALTER TABLE legal_chunks ADD COLUMN IF NOT EXISTS flagged_for_review BOOLEAN DEFAULT FALSE`);
    _ready = true;
    console.log('[USAGE-FB] Usage feedback columns ready');
  } catch (err) {
    console.error('[USAGE-FB] init error:', err.message);
  }
}

/**
 * Record a vote against a verified-answer chunk and recompute its flag.
 * @param {number} chunkId legal_chunks.id
 * @param {boolean} helpful true = 👍, false = 👎
 * @returns {Promise<{helpful, unhelpful, flagged}|null>}
 */
async function recordChunkFeedback(chunkId, helpful) {
  if (!chunkId) return null;
  const col = helpful ? 'helpful_count' : 'unhelpful_count';
  const { rows } = await pool.query(
    `UPDATE legal_chunks
        SET ${col} = COALESCE(${col}, 0) + 1,
            flagged_for_review = (COALESCE(unhelpful_count,0) + ${helpful ? 0 : 1}
                                  - COALESCE(helpful_count,0) - ${helpful ? 1 : 0}) >= $2
      WHERE id = $1 AND source_type = 'verified_qa'
      RETURNING helpful_count, unhelpful_count, flagged_for_review`,
    [chunkId, FLAG_THRESHOLD]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return { helpful: r.helpful_count, unhelpful: r.unhelpful_count, flagged: r.flagged_for_review };
}

/** List verified answers currently flagged for lawyer review. */
async function getFlaggedAnswers(limit = 50) {
  const { rows } = await pool.query(
    `SELECT id, law_name, category, chunk_text, helpful_count, unhelpful_count, updated_at
       FROM legal_chunks
      WHERE source_type = 'verified_qa' AND flagged_for_review = TRUE AND is_valid = TRUE
      ORDER BY (COALESCE(unhelpful_count,0) - COALESCE(helpful_count,0)) DESC
      LIMIT $1`,
    [limit]
  );
  return rows.map((r) => {
    const m = (r.chunk_text || '').match(/^Savol:\s*([\s\S]*?)\n\nJavob:\s*([\s\S]+)$/);
    return {
      id: r.id,
      lawName: r.law_name,
      category: r.category,
      question: m ? m[1].trim() : '',
      answer: m ? m[2].trim() : r.chunk_text,
      helpful: r.helpful_count || 0,
      unhelpful: r.unhelpful_count || 0,
      updatedAt: r.updated_at,
    };
  });
}

/** Clear the review flag (lawyer marks it handled) without deleting the chunk. */
async function clearFlag(chunkId) {
  await pool.query(
    `UPDATE legal_chunks SET flagged_for_review = FALSE WHERE id = $1`,
    [chunkId]
  );
}

/**
 * Lawyer edits the chunk_text of a flagged verified answer, then clears the flag.
 * @param {number} chunkId
 * @param {string} question
 * @param {string} answer
 */
async function editFlaggedAnswer(chunkId, question, answer) {
  const newText = `Savol: ${question.trim()}\n\nJavob: ${answer.trim()}`;
  await pool.query(
    `UPDATE legal_chunks
        SET chunk_text = $2,
            flagged_for_review = FALSE,
            helpful_count = 0,
            unhelpful_count = 0,
            updated_at = NOW()
      WHERE id = $1 AND source_type = 'verified_qa'`,
    [chunkId, newText]
  );
}

/** Soft-delete: marks a verified answer as invalid so it stops being retrieved. */
async function deleteFlaggedAnswer(chunkId) {
  await pool.query(
    `UPDATE legal_chunks SET is_valid = FALSE, flagged_for_review = FALSE WHERE id = $1`,
    [chunkId]
  );
}

/** Mount the feedback endpoints. */
function mountUsageFeedbackRoutes(app, deps) {
  const { requireAuth, requireMasterAdmin } = deps;
  initUsageFeedback().catch((e) => console.error('[USAGE-FB] init:', e.message));

  // End-user vote on a served verified answer
  app.post('/api/legal-chat/feedback', requireAuth, async (req, res) => {
    try {
      const { qaChunkId, helpful } = req.body || {};
      const result = await recordChunkFeedback(parseInt(qaChunkId), helpful === true || helpful === 'up');
      res.json({ ok: true, ...(result || {}) });
    } catch (e) {
      console.error('[USAGE-FB] feedback error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Lawyer review: list flagged verified answers
  app.get('/api/rag/flagged-answers', requireMasterAdmin, async (req, res) => {
    try {
      res.json({ flagged: await getFlaggedAnswers() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Lawyer clears a flag after handling
  app.post('/api/rag/flagged-answers/:id/clear', requireMasterAdmin, async (req, res) => {
    try {
      await clearFlag(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Lawyer edits a flagged answer (rewrites question+answer, resets counts, clears flag)
  app.put('/api/rag/flagged-answers/:id', requireMasterAdmin, async (req, res) => {
    try {
      const { question, answer } = req.body || {};
      if (!question || !answer) return res.status(400).json({ error: 'question and answer required' });
      await editFlaggedAnswer(parseInt(req.params.id), question, answer);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Lawyer soft-deletes a flagged answer (sets is_valid=FALSE, stops retrieval)
  app.delete('/api/rag/flagged-answers/:id', requireMasterAdmin, async (req, res) => {
    try {
      await deleteFlaggedAnswer(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  console.log('[USAGE-FB] Usage feedback routes mounted');
}

module.exports = {
  initUsageFeedback,
  recordChunkFeedback,
  getFlaggedAnswers,
  clearFlag,
  editFlaggedAnswer,
  deleteFlaggedAnswer,
  mountUsageFeedbackRoutes,
  FLAG_THRESHOLD,
};
