'use strict';

/**
 * Lex.uz Live Search — Fallback when local RAG corpus has no answer.
 *
 * Searches lex.uz directly, fetches the top matching documents,
 * and extracts the most relevant sections to use as RAG context.
 *
 * Flow:
 *   1. GET https://lex.uz/search/nat?Query=<query>
 *   2. Parse search result HTML → extract /docs/<id> links
 *   3. Fetch top 1–2 documents via fetchLexDocument()
 *   4. Score sections by keyword overlap → return best excerpts
 */

const cheerio = require('cheerio');
const { httpGet, fetchLexDocument } = require('./fetch-lex');
const { getLawsForCategory } = require('./lex-registry');

const LEX_SEARCH_URL = 'https://lex.uz/search/nat';
const MAX_DOCS_TO_FETCH = 2;
const MAX_EXCERPT_CHARS = 4000;
const SEARCH_TIMEOUT_MS = 15000;
const TOPIC_SCORE_HINTS = Object.freeze({
  talim: "ta'lim oluvchi talaba huquqlari majburiyatlari baholash nazorat ichki tartib 47-modda 48-modda",
});

/**
 * Search lex.uz and return relevant document excerpts.
 *
 * @param {string} query - user's legal question
 * @param {object} opts
 * @param {number} opts.maxDocs - max documents to fetch (default 2)
 * @param {number} opts.maxChars - max chars per excerpt (default 4000)
 * @param {string} opts.scoreText - text used to pick WHICH sections to excerpt,
 *   when it differs from the search query. Searching by document number finds
 *   the act; the number is then useless for choosing sections inside it (it
 *   only appears in the preamble), so callers that know what they are looking
 *   for — the claims a report makes about the act — pass that here instead.
 * @returns {Promise<Array<{ title, url, content, source, metadata }>>}
 */
async function searchLexUz(query, opts = {}) {
  const { maxDocs = MAX_DOCS_TO_FETCH, maxChars = MAX_EXCERPT_CHARS, scoreText = '', topic = '' } = opts;
  const effectiveScoreText = [scoreText || query, TOPIC_SCORE_HINTS[String(topic || '').toLowerCase()] || '']
    .filter(Boolean)
    .join(' ');

  if (!query || query.trim().length < 3) return [];

  const searchUrl = `${LEX_SEARCH_URL}?Query=${encodeURIComponent(query.trim())}`;
  console.log(`[LEX-LIVE] Searching lex.uz: "${query.substring(0, 60)}"`);

  let html = '';
  try {
    html = await httpGet(searchUrl);
  } catch (err) {
    console.warn(`[LEX-LIVE] Search page fetch failed: ${err.message}`);
  }

  const docUrls = html ? parseSearchResults(html) : [];
  if (docUrls.length === 0) console.log('[LEX-LIVE] No document links found in search results');

  // Search results on lex.uz are often ordered by publication date rather
  // than legal relevance. When the platform already knows the legal field,
  // try its primary official acts first, then fill any remaining slots from
  // the live search page. Every registry URL is fetched and title-checked;
  // stale/wrong registry entries therefore cannot silently become evidence.
  const registryCandidates = topic
    ? getLawsForCategory(String(topic).toLowerCase()).slice(0, Math.max(maxDocs, 2)).map(law => ({
        url: canonicalLexUrl(law.lex_url),
        expectedTitle: law.law_name,
        source: 'lex.uz-registry',
      }))
    : [];
  const dynamicCandidates = docUrls.map(url => ({ url, expectedTitle: '', source: 'lex.uz-live' }));
  const seenCandidates = new Set();
  const candidates = [...registryCandidates, ...dynamicCandidates].filter(candidate => {
    if (!candidate.url || seenCandidates.has(candidate.url)) return false;
    seenCandidates.add(candidate.url);
    return true;
  });

  console.log(`[LEX-LIVE] ${registryCandidates.length} registry + ${docUrls.length} search candidates, fetching up to ${maxDocs}`);

  const results = [];
  for (const candidate of candidates) {
    if (results.length >= maxDocs) break;
    const docUrl = candidate.url;
    try {
      const doc = await fetchLexDocument(docUrl);
      if (!doc.body || doc.body.trim().length === 0) continue;

      // Skip if still a historical version after the auto-follow attempt
      // (fetchLexDocument already tried to follow current_version_url)
      if (doc.metadata.current_version_url) {
        console.warn(`[LEX-LIVE] Skipping historical version: ${docUrl}`);
        continue;
      }

      if (candidate.expectedTitle && !titlesMatch(candidate.expectedTitle, doc.title || '')) {
        console.warn(`[LEX-LIVE] Registry title mismatch, skipped: "${candidate.expectedTitle}" -> "${doc.title || ''}"`);
        continue;
      }

      const excerpt = extractRelevantSections(doc.body, effectiveScoreText, maxChars);
      if (!candidate.expectedTitle && relevanceScore(`${doc.title || ''}\n${excerpt}`, effectiveScoreText) === 0) {
        console.warn(`[LEX-LIVE] Search result has no meaningful query overlap, skipped: ${docUrl}`);
        continue;
      }
      results.push({
        title: doc.title || 'Nomsiz hujjat',
        lawName: candidate.expectedTitle || doc.title || 'Nomsiz hujjat',
        url: canonicalLexUrl(doc.metadata.source_url || docUrl),
        content: excerpt,
        // The unexcerpted head and tail of the act, for callers that must
        // confirm the document's identity (its own number/date) rather than
        // read it. The excerpt is section-selected and may skip both. The tail
        // matters for LAWS: lex.uz puts a law's "№ ЎРҚ-684" in the signature
        // block at the END of the document, not in the header.
        head: String(doc.body || '').slice(0, 1200),
        tail: String(doc.body || '').slice(-800),
        source: candidate.source,
        metadata: doc.metadata,
      });
    } catch (err) {
      console.warn(`[LEX-LIVE] Failed to fetch ${docUrl}: ${err.message}`);
    }
  }

  console.log(`[LEX-LIVE] Returning ${results.length} documents from lex.uz`);
  return results;
}

/**
 * Parse lex.uz search results HTML and extract unique document URLs.
 */
function parseSearchResults(html) {
  const $ = cheerio.load(html);
  const byDocument = new Map();

  // Lex.uz commonly emits both /docs/123 and /docs/-123 for one result.
  // Prefer the negative form because it is the Uzbek-Latin document view.
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/\/(?:uz\/|ru\/)?docs\/(-?\d+)/);
    if (!match) return;

    const signedId = match[1];
    const key = signedId.replace(/^-/, '');
    const candidate = canonicalLexUrl(`https://lex.uz/docs/${signedId}`);
    if (!byDocument.has(key) || signedId.startsWith('-')) byDocument.set(key, candidate);
  });

  return Array.from(byDocument.values());
}

function canonicalLexUrl(value = '') {
  return String(value || '').split('#')[0].split('?')[0].trim();
}

function comparableWords(value = '') {
  const stop = new Set(['ozbekiston', 'respublikasi', 'togrisida', 'haqida', 'uchun', 'bilan', 'hamda', 'ning']);
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('uz')
    .replace(/[\u02bb\u02bc\u2018\u2019`']/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/u)
    .filter(word => word.length > 3 && !stop.has(word));
}

function titlesMatch(expected = '', actual = '') {
  const expectedWords = comparableWords(expected);
  const actualSet = new Set(comparableWords(actual));
  return expectedWords.length > 0 && expectedWords.some(word => actualSet.has(word));
}

function relevanceScore(value = '', query = '') {
  const haystack = new Set(comparableWords(value));
  return comparableWords(query).reduce((score, word) => score + (haystack.has(word) ? 1 : 0), 0);
}

/**
 * Extract the most relevant sections from a document body given a query.
 * Splits by article boundaries, scores by keyword overlap, returns best sections.
 */
function extractRelevantSections(body, query, maxChars) {
  const keywords = (query || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);

  // Articles named explicitly in the query ("14-modda", "55 va 69-moddalariga
  // koʻra", "статья 14"). When the caller says which article it needs, that
  // section outranks any keyword overlap — otherwise a long act returns its
  // preamble and the cited article never reaches the model.
  const wantedArticles = new Set();
  const qs = String(query || '');
  for (const m of qs.matchAll(/(\d{1,4})\s*[-–—]?\s*(?:modda|статья|ст\.)/giu)) {
    wantedArticles.add(m[1]);
  }
  // "55 va 69-moddalariga": only the last number carries the word, so sweep up
  // the numbers joined to it by "va" / "и" / "," / a dash.
  for (const m of qs.matchAll(/\d{1,4}(?:\s*(?:,|va|и|[-–])\s*\d{1,4})+\s*[-–—]?\s*(?:modda|статья)/giu)) {
    for (const n of m[0].matchAll(/\d{1,4}/g)) wantedArticles.add(n[0]);
  }

  if (keywords.length === 0 && wantedArticles.size === 0) return body.substring(0, maxChars);

  // Split at article boundaries (Uzbek + Russian patterns)
  const SUPER = '\u2070\u00B9\u00B2\u00B3\u2074\u2075\u2076\u2077\u2078\u2079';
  const articleSplitRe = new RegExp(
    `\\n(?=\\d+[${SUPER}]*[\\s-]*(?:-\\s*)?modda[\\s.:]|Статья\\s+\\d+)`, 'i'
  );
  const sections = body.split(articleSplitRe);

  const articleNumOf = (sec) => {
    const m = sec.match(/^\s*(?:Статья\s+)?(\d{1,4})/);
    return m ? m[1] : null;
  };

  // Score each section
  const scored = sections.map((sec) => {
    const lower = sec.toLowerCase();
    let score = 0;
    // An explicitly requested article dominates the ranking.
    const artNum = articleNumOf(sec);
    if (artNum && wantedArticles.has(artNum)) score += 100;
    for (const kw of keywords) {
      const idx = lower.indexOf(kw);
      if (idx !== -1) {
        score += 1;
        // Bonus for keyword appearing in the first 200 chars (likely in title/header)
        if (idx < 200) score += 0.5;
      }
    }
    return { text: sec.trim(), score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Assemble top sections up to maxChars
  let result = '';
  for (const { text, score } of scored) {
    if (score === 0 && result.length > 0) break;
    if (!text) continue;
    if (result.length + text.length + 2 > maxChars) {
      if (result.length === 0) {
        result = text.substring(0, maxChars);
      }
      break;
    }
    result += (result ? '\n\n' : '') + text;
  }

  return result || body.substring(0, maxChars);
}

/**
 * Format lex.uz live search results as context block for the LLM prompt.
 */
function formatLexSearchResults(results, language = 'uz') {
  if (!results || results.length === 0) return '';

  const isUz = language === 'uz';
  const header = isUz
    ? `\n\nLEX.UZ DAN TOPILGAN QO'SHIMCHA MA'LUMOTLAR (${results.length} ta hujjat):\n`
    : `\n\nДОПОЛНИТЕЛЬНЫЕ ДАННЫЕ С LEX.UZ (${results.length} документов):\n`;

  const body = results.map((r, i) => [
    `[LEX-${i + 1}] ${r.title}`,
    r.content,
    r.url ? `  (${isUz ? 'Manba' : 'Источник'}: ${r.url})` : '',
  ].filter(Boolean).join('\n')).join('\n\n');

  return header + body;
}

module.exports = { searchLexUz, formatLexSearchResults, parseSearchResults, canonicalLexUrl };
