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
const DOCUMENT_CACHE_TTL_MS = Math.max(
  60_000,
  Number.parseInt(process.env.LEX_DOCUMENT_CACHE_TTL_MS || String(24 * 60 * 60 * 1000), 10) || 24 * 60 * 60 * 1000
);
const DOCUMENT_CACHE_LIMIT = 128;
const documentCache = new Map();
const TOPIC_SCORE_HINTS = Object.freeze({
  talim: "ta'lim oluvchi talaba huquqlari majburiyatlari baholash yakuniy nazorat chetlashtirish sababsiz qoldirish akademik qarzdor ichki tartib 47-modda 48-modda 41-band",
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
 * @param {boolean} opts.includeRegistry - include curated topic acts (default true).
 *   Parallel query expansions set this false after the first query to avoid
 *   downloading the same large registry documents more than once.
 * @returns {Promise<Array<{ title, url, content, source, metadata }>>}
 */
async function searchLexUz(query, opts = {}) {
  const {
    maxDocs = MAX_DOCS_TO_FETCH,
    maxChars = MAX_EXCERPT_CHARS,
    scoreText = '',
    topic = '',
    includeRegistry = true,
  } = opts;
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

  const searchCandidates = html ? parseSearchCandidates(html) : [];
  if (searchCandidates.length === 0) console.log('[LEX-LIVE] No document links found in search results');

  // Search results on lex.uz are often ordered by publication date rather
  // than legal relevance. When the platform already knows the legal field,
  // try its primary official acts first, then fill any remaining slots from
  // the live search page. Every registry URL is fetched and title-checked;
  // stale/wrong registry entries therefore cannot silently become evidence.
  const registryCandidates = topic && includeRegistry
    ? getLawsForCategory(String(topic).toLowerCase()).slice(0, Math.max(maxDocs, 2)).map(law => ({
        url: canonicalLexUrl(law.lex_url),
        expectedTitle: law.law_name,
        source: 'lex.uz-registry',
      }))
    : [];
  const dynamicCandidates = rankSearchCandidates(searchCandidates, query).map(candidate => ({
    url: candidate.url,
    // Lex.uz exposes the canonical title and the act's OWN number in the
    // search result. Carrying the title forward prevents a recent amendment
    // that merely mentions the requested act from displacing the act itself.
    expectedTitle: candidate.title || '',
    ownDocumentNumber: candidate.documentNumber || '',
    exactIdentityMatch: candidate._exactIdentityMatch === true,
    source: 'lex.uz-live',
  }));
  const seenCandidates = new Set();
  // Search results come first: they are question-specific and may be a Cabinet
  // resolution, annexed regulation or ministry order. The registry is a safe
  // fallback, not a reason to fill every slot with broad codes/laws before the
  // implementing act is even inspected.
  const candidates = [...dynamicCandidates, ...registryCandidates].filter(candidate => {
    if (!candidate.url || seenCandidates.has(candidate.url)) return false;
    seenCandidates.add(candidate.url);
    return true;
  });

  console.log(`[LEX-LIVE] ${registryCandidates.length} registry + ${searchCandidates.length} search candidates, fetching up to ${maxDocs}`);

  const results = [];
  for (const candidate of candidates) {
    if (results.length >= maxDocs) break;
    const docUrl = candidate.url;
    try {
      const doc = await fetchCachedLexDocument(docUrl);
      if (!doc.body || doc.body.trim().length === 0) continue;

      // Skip if still a historical version after the auto-follow attempt
      // (fetchLexDocument already tried to follow current_version_url)
      if (doc.metadata.current_version_url || doc.metadata.is_active === false) {
        console.warn(`[LEX-LIVE] Skipping historical version: ${docUrl}`);
        continue;
      }

      if (candidate.expectedTitle && !titlesMatch(candidate.expectedTitle, doc.title || '')) {
        console.warn(`[LEX-LIVE] Registry title mismatch, skipped: "${candidate.expectedTitle}" -> "${doc.title || ''}"`);
        continue;
      }

      const excerpt = extractRelevantSections(doc.body, effectiveScoreText, maxChars);
      // A search-row title is used to verify document identity, but it must
      // not automatically make an unrelated result relevant. The sole safe
      // exception is an exact match between the requested act number and the
      // act's OWN number (rather than a body reference in an amendment).
      if (candidate.source === 'lex.uz-live'
        && !candidate.exactIdentityMatch
        && relevanceScore(`${doc.title || ''}\n${excerpt}`, effectiveScoreText) === 0) {
        console.warn(`[LEX-LIVE] Search result has no meaningful query overlap, skipped: ${docUrl}`);
        continue;
      }
      const provision = inferExcerptProvision(excerpt);
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
        provisionRefs: provision.refs,
        provisionType: provision.type,
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
  return parseSearchCandidates(html).map(candidate => candidate.url);
}

function normalizeSearchText(value = '') {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('uz')
    .replace(/[\u02bb\u02bc\u2018\u2019`']/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

const ACT_PREFIX_CANON = Object.freeze({
  pq: 'PQ', 'пқ': 'PQ', 'пп': 'PQ',
  pf: 'PF', 'пф': 'PF', 'уп': 'PF',
  vmq: 'VMQ', vm: 'VMQ', 'вмқ': 'VMQ', 'пкм': 'VMQ',
  orq: 'ORQ', 'ўрқ': 'ORQ', 'зру': 'ORQ',
});

function canonicalActPrefix(value = '') {
  return ACT_PREFIX_CANON[normalizeSearchText(value).replace(/\s/gu, '')] || String(value || '').toUpperCase();
}

function extractActIdentifiers(value = '') {
  const text = String(value || '');
  const refs = [];
  const seen = new Set();
  const re = /(?<![\p{L}\p{N}])(PQ|PF|VMQ|VM|O['`\u2018\u2019\u02bb]?RQ|\u041f\u049a|\u041f\u041f|\u041f\u0424|\u0423\u041f|\u0412\u041c\u049a|\u041f\u041a\u041c|\u040e\u0420\u049a|\u0417\u0420\u0423)\s*[-\u2013\u2014]?\s*(\d{1,6})(?:\s*[-\u2013\u2014]?\s*(?:son|\u0441\u043e\u043d))?/giu;
  for (const match of text.matchAll(re)) {
    const prefix = canonicalActPrefix(match[1]);
    const number = match[2];
    const key = `${prefix}-${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ prefix, number });
  }
  return refs;
}

function parseOwnDocumentIdentifier(value = '') {
  const refs = extractActIdentifiers(value);
  return refs.length ? refs[refs.length - 1] : null;
}

/**
 * Parse search-result metadata without downloading every full Lex.uz act.
 * The result row contains the canonical title, status and the act's own
 * number. That metadata is more reliable for ranking than a body mention.
 */
function parseSearchCandidates(html) {
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
    const td = $(el).closest('td');
    const title = $(el).text().replace(/\s+/gu, ' ').trim();
    const badge = td.find('.badge').first().text().replace(/\s+/gu, ' ').trim();
    const active = td.find('.status_code_y').length > 0
      ? true
      : (td.find('.status_code_n').length > 0 ? false : null);
    const previous = byDocument.get(key) || {};
    const preferUrl = !previous.url || signedId.startsWith('-');
    byDocument.set(key, {
      url: preferUrl ? canonicalLexUrl(`https://lex.uz/docs/${signedId}`) : previous.url,
      title: title || previous.title || '',
      badge: badge || previous.badge || '',
      isActive: active == null ? previous.isActive ?? null : active,
      documentNumber: (parseOwnDocumentIdentifier(badge) || previous.documentNumber || null),
      order: previous.order == null ? byDocument.size : previous.order,
    });
  });

  return Array.from(byDocument.values());
}

function searchRoots(value = '') {
  const stop = new Set(['ozbekiston', 'respublikasi', 'togrisida', 'haqida', 'uchun', 'bilan', 'hamda', 'qanday', 'qayerda', 'nima', 'degani', 'kerak']);
  return normalizeSearchText(value)
    .split(/\s+/u)
    .filter(word => word.length > 3 && !stop.has(word))
    .map(word => word.slice(0, Math.min(6, word.length)));
}

function rankSearchCandidates(candidates = [], query = '') {
  const requestedActs = extractActIdentifiers(query);
  const queryRoots = new Set(searchRoots(query));
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate, index) => {
      const titleRoots = new Set(searchRoots(candidate.title));
      let score = 0;
      let exactIdentityMatch = false;
      for (const root of queryRoots) if (titleRoots.has(root)) score += 12;
      if (candidate.isActive === false) score -= 1000;
      if (/o['`\u2018\u2019\u02bb]?zgartirish|qo['`\u2018\u2019\u02bb]?shimcha|\u045e\u0437\u0433\u0430\u0440\u0442\u0438\u0440\u0438\u0448|\u0438\u0437\u043c\u0435\u043d\u0435\u043d/iu.test(candidate.title)) score -= 18;
      for (const requested of requestedActs) {
        const own = candidate.documentNumber;
        if (own && own.prefix === requested.prefix && own.number === requested.number) {
          score += 10_000;
          exactIdentityMatch = true;
        }
        else if (own && own.number === requested.number) score += 2_000;
      }
      return {
        ...candidate,
        _rankScore: score,
        _exactIdentityMatch: exactIdentityMatch,
        _originalOrder: candidate.order ?? index,
      };
    })
    .sort((a, b) => b._rankScore - a._rankScore || a._originalOrder - b._originalOrder);
}

async function fetchCachedLexDocument(url) {
  const key = canonicalLexUrl(url);
  const cached = documentCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.document;
  if (cached) documentCache.delete(key);

  const document = await fetchLexDocument(key);
  if (documentCache.size >= DOCUMENT_CACHE_LIMIT) {
    const oldest = documentCache.keys().next().value;
    if (oldest) documentCache.delete(oldest);
  }
  documentCache.set(key, {
    document,
    expiresAt: Date.now() + DOCUMENT_CACHE_TTL_MS,
  });
  return document;
}

function clearLexDocumentCache() {
  documentCache.clear();
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
  const wantedBands = new Set();
  const qs = String(query || '');
  for (const m of qs.matchAll(/(\d{1,4})\s*[-–—]?\s*(?:modda|статья|ст\.)/giu)) {
    wantedArticles.add(m[1]);
  }
  // "55 va 69-moddalariga": only the last number carries the word, so sweep up
  // the numbers joined to it by "va" / "и" / "," / a dash.
  for (const m of qs.matchAll(/\d{1,4}(?:\s*(?:,|va|и|[-–])\s*\d{1,4})+\s*[-–—]?\s*(?:modda|статья)/giu)) {
    for (const n of m[0].matchAll(/\d{1,4}/g)) wantedArticles.add(n[0]);
  }
  for (const m of qs.matchAll(/(\d{1,4})\s*[-–—]?\s*band[\p{L}'’]*/giu)) {
    wantedBands.add(m[1]);
  }

  if (keywords.length === 0 && wantedArticles.size === 0 && wantedBands.size === 0) return body.substring(0, maxChars);

  // Split at article boundaries AND numbered regulation paragraphs. Many
  // Cabinet resolutions put the operative rule in an annexed Nizom whose
  // units are "41.", "42." bands rather than "41-modda". Treating the whole
  // annex as one section caused the preamble to crowd the relevant band out.
  const SUPER = '\u2070\u00B9\u00B2\u00B3\u2074\u2075\u2076\u2077\u2078\u2079';
  const articleSplitRe = new RegExp(
    `\\n(?=(?:\\d+[${SUPER}]*[\\s-]*(?:-\\s*)?modda[\\s.:]|Статья\\s+\\d+|\\d{1,4}\\.\\s+))`, 'i'
  );
  const sections = body.split(articleSplitRe);

  const articleNumOf = (sec) => {
    const m = sec.match(/^\s*(?:(?:Статья\s+)?(\d{1,4})[^\n]{0,20}(?:modda|статья))/iu);
    return m ? m[1] : null;
  };
  const bandNumOf = (sec) => {
    const m = sec.match(/^\s*(\d{1,4})\.\s+/u);
    return m ? m[1] : null;
  };

  // Score each section
  const scored = sections.map((sec) => {
    const lower = sec.toLowerCase();
    let score = 0;
    // An explicitly requested article dominates the ranking.
    const artNum = articleNumOf(sec);
    if (artNum && wantedArticles.has(artNum)) score += 100;
    const bandNum = bandNumOf(sec);
    if (bandNum && wantedBands.has(bandNum)) score += 100;
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

function inferExcerptProvision(excerpt = '') {
  const text = String(excerpt || '');
  const articleRefs = Array.from(text.matchAll(/(?:^|\n)\s*(\d{1,4})(?:[⁰¹²³⁴⁵⁶⁷⁸⁹]+)?[\s-]*(?:-\s*)?modda\b/gimu), m => m[1]);
  if (articleRefs.length > 0) return { type: 'modda', refs: Array.from(new Set(articleRefs)) };
  const bandRefs = Array.from(text.matchAll(/(?:^|\n)\s*(\d{1,4})\.\s+/gmu), m => m[1]);
  return { type: bandRefs.length ? 'band' : '', refs: Array.from(new Set(bandRefs)) };
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

module.exports = {
  searchLexUz,
  formatLexSearchResults,
  parseSearchResults,
  parseSearchCandidates,
  rankSearchCandidates,
  extractActIdentifiers,
  canonicalLexUrl,
  extractRelevantSections,
  inferExcerptProvision,
  fetchCachedLexDocument,
  clearLexDocumentCache,
};
