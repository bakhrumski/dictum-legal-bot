'use strict';

/**
 * Resolve stable Lex.uz DOM anchors for citations from corpus rows that were
 * ingested before lex_element_id was stored in the database.
 *
 * Lex.uz article IDs are content IDs, not derivable from the document ID or
 * article number. The only reliable compatibility path is to read the current
 * document once, index its article/qism IDs, and cache that index.
 */

const { httpGet } = require('./fetch-lex');
const { parseLexStructured } = require('./structural-chunker');
const {
  extractAnalysisSection,
  normalizeArticleRef,
  selectRelevantSourceRefs,
} = require('./citation-utils');

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const MAX_CACHE_ENTRIES = 40;
const anchorCache = new Map();

function normalizeSourceUrl(value = '') {
  const raw = String(value || '').split('#')[0].trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || !/(^|\.)lex\.uz$/iu.test(parsed.hostname)) return '';
    return parsed.href;
  } catch (_) {
    return '';
  }
}

function buildAnchorIndexFromHtml(html, sourceUrl) {
  const parsed = parseLexStructured(html, sourceUrl);
  const index = Object.create(null);
  for (const article of parsed.articles || []) {
    const articleRef = normalizeArticleRef(article.articleNumber);
    if (!articleRef) continue;
    if (/^\d+$/u.test(String(article.lexElementId || ''))) {
      index[articleRef] = String(article.lexElementId);
    }
    for (const part of article.parts || []) {
      const partNumber = String(part.partNumber || '').match(/\d+/u)?.[0] || '';
      const elementId = String(part.lexElementId || '');
      if (partNumber && /^\d+$/u.test(elementId)) {
        index[`${articleRef}:${partNumber}`] = elementId;
      }
    }
  }
  return index;
}

function trimCache() {
  while (anchorCache.size > MAX_CACHE_ENTRIES) {
    anchorCache.delete(anchorCache.keys().next().value);
  }
}

async function fetchAnchorIndex(sourceUrl) {
  const url = normalizeSourceUrl(sourceUrl);
  if (!url) return Object.create(null);

  const cached = anchorCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const html = await httpGet(url, 5, controller.signal);
      return buildAnchorIndexFromHtml(html, url);
    } finally {
      clearTimeout(timer);
    }
  })();

  anchorCache.set(url, { expiresAt: Date.now() + CACHE_TTL_MS, promise });
  trimCache();
  try {
    return await promise;
  } catch (error) {
    // A temporary Lex outage should be retried on the next answer, not cached
    // for six hours. Citation generation still retains its text fallback.
    anchorCache.delete(url);
    throw error;
  }
}

async function resolveLexAnchorUrl(sourceUrl, articleRef, partNumber = '') {
  const baseUrl = normalizeSourceUrl(sourceUrl);
  const ref = normalizeArticleRef(articleRef);
  const part = String(partNumber || '').match(/\d+/u)?.[0] || '';
  if (!baseUrl || !ref) return '';
  const index = await fetchAnchorIndex(baseUrl);
  const id = (part && index[`${ref}:${part}`]) || index[ref] || '';
  return /^\d+$/u.test(String(id)) ? `${baseUrl}#${id}` : '';
}

/**
 * Mutates retrieved chunks by attaching an article/qism -> Lex ID map. This is
 * intentionally best-effort: failure to reach Lex.uz must never block a legal
 * answer, but successful resolution eliminates scroll/search for both web and
 * Telegram users.
 */
async function hydrateLexAnchors(chunks = [], replyText = '') {
  const analysis = extractAnalysisSection(replyText);
  const selected = selectRelevantSourceRefs(chunks, analysis);
  if (selected.length === 0) return chunks;

  const byUrl = new Map();
  for (const record of selected) {
    const sourceUrl = normalizeSourceUrl(record.chunk && (record.chunk.source_url || record.chunk.sourceUrl));
    if (!sourceUrl) continue;
    if (!byUrl.has(sourceUrl)) byUrl.set(sourceUrl, []);
    byUrl.get(sourceUrl).push(record);
  }

  await Promise.all(Array.from(byUrl.entries()).map(async ([sourceUrl, records]) => {
    try {
      const index = await fetchAnchorIndex(sourceUrl);
      for (const record of records) {
        const ref = normalizeArticleRef(record.articleRef);
        if (!ref) continue;
        const target = record.chunk;
        target.lex_anchor_ids = target.lex_anchor_ids || {};
        if (index[ref]) target.lex_anchor_ids[ref] = index[ref];
        const prefix = `${ref}:`;
        for (const [key, value] of Object.entries(index)) {
          if (key.startsWith(prefix)) target.lex_anchor_ids[key] = value;
        }
      }
    } catch (error) {
      console.warn(`[LEX-ANCHOR] Could not resolve ${sourceUrl}: ${error.message}`);
    }
  }));

  return chunks;
}

module.exports = {
  buildAnchorIndexFromHtml,
  fetchAnchorIndex,
  hydrateLexAnchors,
  normalizeSourceUrl,
  resolveLexAnchorUrl,
};
