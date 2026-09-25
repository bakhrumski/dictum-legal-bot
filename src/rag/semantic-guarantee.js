'use strict';

/**
 * Which dense-search hits retrieval guarantees into context ahead of the
 * reranker (the "semantic guarantee" in retrieveLegalContext).
 *
 * Breadth-first: the best chunk of each distinct law comes first, then at
 * most one more per law, so one or two laws cannot fill every slot.
 *
 * margin (eval run 3): a broad document - e.g. a unified permits regulation -
 * is loosely similar to every question and, as the best chunk of its law,
 * took a guaranteed slot in half the misses. With a margin, only chunks
 * scoring within it of the best law-text match are guaranteed; the rest
 * still compete through the reranker. null keeps the old behaviour.
 */
function selectSemanticGuarantee(hits, { margin = null, limit = 6 } = {}) {
  const lawText = (hits || []).filter(r => r.source_type === 'law_text');
  const best = lawText.reduce((m, r) => Math.max(m, Number(r.score) || 0), 0);
  const lawSeen = new Map();
  const primary = [];
  const extra = [];
  for (const r of lawText) {
    if (margin !== null && (Number(r.score) || 0) < best - margin) continue;
    const n = lawSeen.get(r.law_name) || 0;
    if (n === 0) { primary.push(r); lawSeen.set(r.law_name, 1); }
    else if (n < 2) { extra.push(r); lawSeen.set(r.law_name, n + 1); }
  }
  return { matches: [...primary, ...extra].slice(0, limit), laws: primary.length };
}

/** The margin from opts.semanticMargin, else RAG_SEMANTIC_MARGIN; null when unset or invalid. */
function semanticMarginFrom(opts = {}, env = process.env) {
  const raw = opts.semanticMargin !== undefined ? opts.semanticMargin : env.RAG_SEMANTIC_MARGIN;
  const n = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

module.exports = { selectSemanticGuarantee, semanticMarginFrom };
