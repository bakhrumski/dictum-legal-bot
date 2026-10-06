'use strict';

const usageLedger = require('../ai/usage-ledger');

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
  // RERANKER=off: no cross-encoder calls at all (e.g. while the HF account
  // cannot pay for Inference Providers); the keyword re-rank keeps order.
  if (String(process.env.RERANKER || '').toLowerCase() === 'off') {
    usageLedger.degrade('rerank_off');
    return keywordFallbackRerank(query, chunks, topK);
  }
  if (!apiKey) {
    console.log('[RERANKER] No HF_TOKEN — using keyword fallback');
    return keywordFallbackRerank(query, chunks, topK);
  }

  try {
    // Bound total latency: the cross-encoder fires one HF request per chunk
    // (each with a 60s socket timeout), so without an overall cap a slow API
    // could stall the user's request. Race against RERANKER_TIMEOUT_MS and
    // fall back to the keyword reranker if it doesn't finish in time.
    // Candidates beyond the cap keep their retrieval order after the
    // re-ranked ones; the cross-encoder is not asked to score them.
    const cap = RERANK_MAX_CANDIDATES();
    const head = chunks.slice(0, cap);
    const scored = await Promise.race([
      crossEncoderRerank(query, head, model, apiKey),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`reranker timeout after ${RERANKER_TIMEOUT_MS}ms`)), RERANKER_TIMEOUT_MS)
      ),
    ]);
    // Sort descending by reranker score
    scored.sort((a, b) => b._rerankerScore - a._rerankerScore);
    const topChunks = scored.concat(chunks.slice(cap).map(c => ({ ...c, _rerankerScore: 0 }))).slice(0, topK);

    console.log(`[RERANKER] ${model}: ${chunks.length} → ${topChunks.length} (scores: ${topChunks.map(c => c._rerankerScore.toFixed(3)).join(', ')})`);

    // Clean up internal score field
    topChunks.forEach(c => delete c._rerankerScore);
    return topChunks;
  } catch (err) {
    console.warn(`[RERANKER] Cross-encoder failed (${err.message}), using keyword fallback`);
    usageLedger.degrade('rerank_unavailable');
    return keywordFallbackRerank(query, chunks, topK);
  }
}

/**
 * Call the HuggingFace cross-encoder API, one (query, passage) pair per HTTP
 * request (the hf-inference text-classification pipeline scores one pair).
 *
 * 2026-10-04: all pairs went out at once and each HTTP 402 became a score of
 * 0, so 19-33 failed calls per question left the hybrid order truncated to
 * topK and were counted as "retries". Now:
 *   - the pairs of one rerank are one batch (batch_id), not retries;
 *   - an open breaker (a recent permanent error, e.g. 402) means no call at
 *     all: one skipped row, keyword fallback, the request marked degraded;
 *   - the first pair goes alone; a permanent error there stops the rest;
 *   - the others go a few at a time and stop launching on a permanent error;
 *   - more than half failed means the cross-encoder did not rank: throw, and
 *     rerankChunks uses the keyword fallback (which keeps the retrieval
 *     score), instead of sorting on zeros;
 *   - candidates are capped, and scores of public corpus text are cached by
 *     model, query and the chunk's id and text, so a re-run does not re-score.
 */
const RERANK_MAX_CANDIDATES = () => Math.max(2, Number(process.env.RERANK_MAX_CANDIDATES) || 12);
const RERANK_CONCURRENCY = () => Math.max(1, Number(process.env.RERANK_CONCURRENCY) || 4);
const scoreCache = new Map(); // key -> { score, at }
const SCORE_TTL_MS = 60 * 60 * 1000;
const PUBLIC_SOURCES = new Set(['law_text', 'lex_live', 'verified_qa']);

function cacheKey(model, query, chunk) {
  if (!PUBLIC_SOURCES.has(chunk.source_type)) return null; // a user's document is never cached
  const text = String(chunk.chunk_text || chunk.text || '').slice(0, 512);
  return require('crypto').createHash('sha256').update(`${model}\u0000${query}\u0000${chunk.id || ''}\u0000${text}`).digest('hex');
}

function cacheGet(key) {
  const hit = key && scoreCache.get(key);
  if (!hit || Date.now() - hit.at > SCORE_TTL_MS) return null;
  return hit.score;
}

function cachePut(key, score) {
  if (!key) return;
  if (scoreCache.size > 5000) scoreCache.delete(scoreCache.keys().next().value);
  scoreCache.set(key, { score, at: Date.now() });
}

async function crossEncoderRerank(query, chunks, model, apiKey) {
  const health = require('../ai/provider-health');
  const open = health.openState('huggingface', model);
  if (open) {
    usageLedger.record({ provider: 'huggingface', model, stage: 'rerank', status: 'skipped', errorCode: 'CIRCUIT_OPEN', errorKind: 'skipped',
      errorReason: `${open.code}: ${open.reason || 'circuit open'}` });
    usageLedger.degrade('rerank_unavailable');
    throw Object.assign(new Error(`reranker skipped: ${open.code}`), { code: 'CIRCUIT_OPEN' });
  }

  const url = `https://router.huggingface.co/hf-inference/models/${model}`;
  const batchId = require('crypto').randomUUID();
  const scores = new Array(chunks.length).fill(null);
  let failed = 0;
  let stop = null;

  const scorePair = async (i) => {
    const chunk = chunks[i];
    const key = cacheKey(model, query, chunk);
    const cached = cacheGet(key);
    if (cached != null) { scores[i] = cached; return; }
    const passage = String(chunk.chunk_text || chunk.text || '').substring(0, 512);
    try {
      scores[i] = await usageLedger.track({ provider: 'huggingface', model, stage: 'rerank', batchId, retryTransient: 1,
        bound: { usd: null, reason: 'Hugging Face inference is not priced per call here' } }, async () => {
        const resp = await httpsPostJson(url, { inputs: [query, passage] }, { 'Authorization': `Bearer ${apiKey}` });
        if (resp.status !== 200) {
          const parsed = health.parseProviderError(resp.text || '');
          throw Object.assign(new Error(`HF ${resp.status}: ${health.safeReason([parsed.code, parsed.message].filter(Boolean).join(': '))}`),
            { status: resp.status, providerCode: parsed.code, providerMessage: parsed.message, retryAfter: resp.headers && resp.headers['retry-after'] });
        }
        return extractScore(resp.body);
      });
      cachePut(key, scores[i]);
    } catch (err) {
      failed++;
      const c = health.classifyError(err);
      if (c.kind === 'permanent' || c.kind === 'skipped') stop = stop || c;
    }
  };

  // probe with the first pair; a permanent error stops the batch here
  await scorePair(0);
  let next = 1;
  const worker = async () => {
    while (!stop && next < chunks.length) await scorePair(next++);
  };
  await Promise.all(Array.from({ length: Math.min(RERANK_CONCURRENCY(), chunks.length - 1) }, worker));

  const scored = scores.filter(v => v != null).length;
  if (stop || failed > chunks.length / 2 || scored === 0) {
    usageLedger.degrade('rerank_unavailable');
    throw Object.assign(new Error(`cross-encoder unavailable: ${stop ? stop.code : `${failed}/${chunks.length} pairs failed`}`), { code: stop ? stop.code : 'RERANK_FAILED' });
  }
  return chunks.map((chunk, i) => ({ ...chunk, _rerankerScore: scores[i] == null ? 0 : scores[i] }));
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
  crossEncoderRerank,
  _scoreCache: scoreCache,
};
