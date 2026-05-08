'use strict';

/**
 * Cross-Encoder Re-Ranker — Stage 3 of the Enhanced RAG Pipeline
 *
 * After Stage 2 (hybrid search) returns ~15 candidate chunks, this module
 * re-ranks them using a cross-encoder model to select the top 3 most
 * relevant chunks for the final generation prompt.
 *
 * Cross-encoders jointly encode (query, passage) pairs and produce a
 * single relevance score, which is more accurate than bi-encoder cosine
 * similarity (used in Stage 2) but too expensive for the full corpus.
 *
 * Provider: HuggingFace Inference API
 *   - Model: BAAI/bge-reranker-v2-m3 (multilingual, good for UZ/RU legal text)
 *   - Endpoint: text-classification pipeline
 *   - Auth: HF_TOKEN (same key used for embeddings)
 *
 * Fallback: if HF API is unavailable, falls back to a simple keyword-overlap
 * scoring that still improves over raw hybrid-search ordering.
 *
 * Usage:
 *   const { rerankChunks } = require('./reranker');
 *   const top3 = await rerankChunks(query, candidateChunks, { topK: 3 });
 */

const { httpsPostJson } = require('./embeddings');

const DEFAULT_RERANKER_MODEL = process.env.RERANKER_MODEL || 'BAAI/bge-reranker-v2-m3';
const RERANKER_TIMEOUT_MS = 8000;

/**
 * Re-rank candidate chunks using a HuggingFace cross-encoder model.
 *
 * @param {string} query - user's question
 * @param {Array} chunks - candidate chunks from hybrid search (each must have chunk_text)
 * @param {Object} opts
 * @param {number} opts.topK - how many to keep (default 3)
 * @param {string} opts.model - override reranker model
 * @returns {Promise<Array>} - top-K chunks sorted by cross-encoder relevance
 */
async function rerankChunks(query, chunks, opts = {}) {
  const { topK = 3, model = DEFAULT_RERANKER_MODEL } = opts;

  if (!chunks || chunks.length === 0) return [];
  if (chunks.length <= topK) return chunks;

  const apiKey = process.env.HF_TOKEN;
  if (!apiKey) {
    console.log('[RERANKER] No HF_TOKEN — using keyword fallback');
    return keywordFallbackRerank(query, chunks, topK);
  }

  try {
    const scored = await crossEncoderRerank(query, chunks, model, apiKey);
    // Sort descending by reranker score
    scored.sort((a, b) => b._rerankerScore - a._rerankerScore);
    const topChunks = scored.slice(0, topK);

    console.log(`[RERANKER] ${model}: ${chunks.length} → ${topChunks.length} (scores: ${topChunks.map(c => c._rerankerScore.toFixed(3)).join(', ')})`);

    // Clean up internal score field
    topChunks.forEach(c => delete c._rerankerScore);
    return topChunks;
  } catch (err) {
    console.warn(`[RERANKER] Cross-encoder failed (${err.message}), using keyword fallback`);
    return keywordFallbackRerank(query, chunks, topK);
  }
}

/**
 * Call the HuggingFace cross-encoder API.
 * Sends (query, passage) pairs and returns chunks annotated with _rerankerScore.
 */
async function crossEncoderRerank(query, chunks, model, apiKey) {
  // Build input pairs for the text-classification pipeline.
  // BGE reranker expects [query, passage] pairs.
  const pairs = chunks.map(c => {
    const text = c.chunk_text || c.text || '';
    return [query, text.substring(0, 512)]; // truncate to avoid token limits
  });

  const url = `https://router.huggingface.co/hf-inference/models/${model}`;

  // Try batch: send all pairs at once (some models support this)
  const results = await Promise.all(
    pairs.map(async (pair, i) => {
      try {
        const resp = await httpsPostJson(
          url,
          { inputs: pair },
          { 'Authorization': `Bearer ${apiKey}` }
        );

        if (resp.status === 503) {
          // Model loading — retry once after delay
          await new Promise(r => setTimeout(r, 5000));
          const retry = await httpsPostJson(
            url,
            { inputs: pair },
            { 'Authorization': `Bearer ${apiKey}` }
          );
          if (retry.status !== 200) throw new Error(`HF ${retry.status} on retry`);
          return { index: i, score: extractScore(retry.body) };
        }

        if (resp.status !== 200) {
          throw new Error(`HF ${resp.status}: ${(resp.text || '').substring(0, 200)}`);
        }

        return { index: i, score: extractScore(resp.body) };
      } catch (err) {
        // Individual pair failure — assign 0 so it sorts to bottom
        console.warn(`[RERANKER] Pair ${i} failed: ${err.message}`);
        return { index: i, score: 0 };
      }
    })
  );

  // Annotate chunks with scores
  return chunks.map((chunk, i) => {
    const result = results.find(r => r.index === i);
    return { ...chunk, _rerankerScore: result ? result.score : 0 };
  });
}

/**
 * Extract a relevance score from the HF text-classification response.
 * Handles various response formats from different models.
 */
function extractScore(body) {
  if (body == null) return 0;

  // Format 1: [[{label, score}]] (text-classification pipeline)
  if (Array.isArray(body) && Array.isArray(body[0])) {
    // For rerankers, higher score = more relevant. Some models use
    // LABEL_0 for "not relevant" and LABEL_1 for "relevant".
    const labels = body[0];
    const relevant = labels.find(l => l.label === 'LABEL_1');
    if (relevant) return relevant.score;
    // Single-label: return the score directly
    if (labels.length === 1) return labels[0].score;
    return labels[0].score;
  }

  // Format 2: [{label, score}] (single-pair response)
  if (Array.isArray(body) && body.length > 0 && body[0].score != null) {
    const relevant = body.find(l => l.label === 'LABEL_1');
    if (relevant) return relevant.score;
    return body[0].score;
  }

  // Format 3: scalar number (sentence-similarity or direct score)
  if (typeof body === 'number') return body;
  if (Array.isArray(body) && typeof body[0] === 'number') return body[0];

  // Format 4: {score: number} (simple wrapper)
  if (body.score != null) return body.score;

  return 0;
}

/**
 * Keyword-overlap fallback when HuggingFace API is unavailable.
 * Simple but effective: counts matching keywords between query and chunk.
 * Keeps verified_qa boost from the original scoring.
 */
function keywordFallbackRerank(query, chunks, topK) {
  const queryTerms = extractKeywords(query);
  if (queryTerms.length === 0) return chunks.slice(0, topK);

  const scored = chunks.map(chunk => {
    const text = (chunk.chunk_text || chunk.text || '').toLowerCase();
    let matches = 0;
    for (const term of queryTerms) {
      if (text.includes(term)) matches++;
    }
    const overlap = matches / queryTerms.length;
    // Blend: 60% original score + 40% keyword overlap
    const origScore = typeof chunk.score === 'number' ? chunk.score : 0;
    const blended = origScore * 0.6 + overlap * 0.4;
    // Verified QA boost
    const boost = chunk.source_type === 'verified_qa' ? 0.15 : 0;
    return { ...chunk, _fallbackScore: blended + boost };
  });

  scored.sort((a, b) => b._fallbackScore - a._fallbackScore);
  const result = scored.slice(0, topK);
  result.forEach(c => delete c._fallbackScore);

  console.log(`[RERANKER] Keyword fallback: ${chunks.length} → ${result.length}`);
  return result;
}

function extractKeywords(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .filter((w, i, arr) => arr.indexOf(w) === i); // unique
}

module.exports = {
  rerankChunks,
  keywordFallbackRerank,
};
