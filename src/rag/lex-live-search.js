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
// One document read (a historical version followed to the current one
// included). httpGet's own socket timeout is 60 s, and the candidates of one
// search are read one after another, so without this a slow lex.uz alone
// could spend a request's whole AI_REQUEST_MAX_MS (2026-10-22: a Telegram
// answer used ~29 s of AI calls and still hit the 120 s limit before its
// claim check). The read itself is not cancelled - it may still fill the
// cache - it is only no longer waited for.
const DOC_FETCH_MAX_MS = () => Math.max(1000, Number(process.env.LEX_FETCH_MAX_MS) || 30000);
const DOCUMENT_CACHE_TTL_MS = Math.max(
  60_000,
  Number.parseInt(process.env.LEX_DOCUMENT_CACHE_TTL_MS || String(24 * 60 * 60 * 1000), 10) || 24 * 60 * 60 * 1000
);
const DOCUMENT_CACHE_LIMIT = Math.max(8, Number(process.env.LEX_DOCUMENT_CACHE_LIMIT) || 64);
// The cache also holds at most this many characters of act text (the Civil
// Code alone is 685 000): the oldest acts leave first.
const DOCUMENT_CACHE_MAX_CHARS = () => Math.max(500000, Number(process.env.LEX_DOCUMENT_CACHE_MAX_CHARS) || 8000000);
// A lex.uz page larger than this is not read (2026-10-26: an 8 MB decree page
// took the instance down; the largest code, the Tax Code, is 6 MB).
// That limit is for a code or law (found by its form, the topic registry or
// its address); any other search result is read up to LEX_PAGE_MAX_KB_OTHER
// (2 MB): the multi-MB pages a plain search brings are decrees with long
// annexes, and each one read costs ~100 MB outside the heap (measured).
const PAGE_MAX_BYTES = () => Math.max(256, Number(process.env.LEX_PAGE_MAX_KB) || 7000) * 1024;
const PAGE_MAX_BYTES_OTHER = () => Math.max(256, Number(process.env.LEX_PAGE_MAX_KB_OTHER) || 2000) * 1024;
let cachedChars = 0;
// Documents read at once, across every search of every request (2026-10-24:
// with #477's queries finding acts, one question's 22 searches read dozens of
// 0.3-1 MB pages in parallel and the process went from 57 to 515 MB - the
// Render instance has 512 MB, the answer never came). A read waits for a slot.
// one page at a time since 2026-10-26 (two large pages at once, plus the cache, went over 512 MB)
const FETCH_SLOTS = () => Math.max(1, Number(process.env.LEX_FETCH_CONCURRENCY) || 1);
let activeFetches = 0;
const fetchQueue = [];
function acquireFetchSlot() {
  if (activeFetches < FETCH_SLOTS()) { activeFetches++; return Promise.resolve(); }
  return new Promise(resolve => fetchQueue.push(resolve));
}
function releaseFetchSlot() {
  const next = fetchQueue.shift();
  if (next) next();
  else activeFetches = Math.max(0, activeFetches - 1);
}
const documentCache = new Map();
const documentInFlight = new Map();
const SEARCH_PAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const searchPageCache = new Map();
const searchPageInFlight = new Map();
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
    preferredPrefixes = [],
    maxCandidatesToInspect = 0,
    // known acts by address (a named special status), inspected first and
    // kept only when the page's own title matches
    pinnedDocs = [],
    // epoch ms: no read starts after it, and a running one is waited for only
    // until it; what was found by then is returned
    deadline = 0,
    // 'code' | 'law': only that act form (ACT_FORMS)
    actForm = '',
    // { left: n } shared by every search of one round: lex.uz pages not in
    // the cache it may still read (the cache and the slots bound memory over
    // time, this bounds one question)
    readBudget = null,
  } = opts;
  const startedAt = Date.now();
  const leftMs = () => (deadline ? deadline - Date.now() : Infinity);
  const effectiveScoreText = [scoreText || query, TOPIC_SCORE_HINTS[String(topic || '').toLowerCase()] || '']
    .filter(Boolean)
    .join(' ');

  if (!query || query.trim().length < 3) return [];

  const requestedActs = extractActIdentifiers(query);
  const searchUrl = buildLexSearchUrl(query, { actForm });
  console.log(`[LEX-LIVE] Searching lex.uz${actForm ? ` (${actForm})` : ''}: "${query.substring(0, 60)}"`);

  let html = '';
  try {
    if (leftMs() <= 0) throw new Error('time limit reached before the search');
    html = await within(fetchCachedSearchPage(searchUrl), Math.min(SEARCH_TIMEOUT_MS, leftMs()));
  } catch (err) {
    console.warn(`[LEX-LIVE] Search page fetch failed: ${err.message}`);
  }

  let searchCandidates = html ? parseSearchCandidates(html) : [];
  if (searchCandidates.length === 0 && html && !requestedActs.length) {
    for (const shorter of relaxedQueries(query)) {
      if (leftMs() <= 0) break;
      try {
        const more = parseSearchCandidates(await within(fetchCachedSearchPage(buildLexSearchUrl(shorter, { actForm })), Math.min(SEARCH_TIMEOUT_MS, leftMs())));
        if (more.length) {
          console.log(`[LEX-LIVE] Nothing for the whole query; "${shorter}" found ${more.length}`);
          searchCandidates = more;
          break;
        }
      } catch (err) {
        console.warn(`[LEX-LIVE] Search page fetch failed: ${err.message}`);
      }
    }
  }
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
  const dynamicCandidates = rankSearchCandidates(searchCandidates, effectiveScoreText, {
    preferredPrefixes,
    requestedActs,
  }).map(candidate => ({
    url: candidate.url,
    // Lex.uz exposes the canonical title and the act's OWN number in the
    // search result. Carrying the title forward prevents a recent amendment
    // that merely mentions the requested act from displacing the act itself.
    expectedTitle: candidate.title || '',
    ownDocumentNumber: candidate.documentNumber || '',
    exactIdentityMatch: candidate._exactIdentityMatch === true,
    searchRankScore: candidate._rankScore || 0,
    source: 'lex.uz-live',
  }));
  const seenCandidates = new Set();
  // Search results come first: they are question-specific and may be a Cabinet
  // resolution, annexed regulation or ministry order. The registry is a safe
  // fallback, not a reason to fill every slot with broad codes/laws before the
  // implementing act is even inspected.
  const pinnedCandidates = (Array.isArray(pinnedDocs) ? pinnedDocs : [])
    .filter(d => d && d.url && (d.expectedTitle || (d.expectedNumber && d.expectedDate)))
    .map(d => ({ url: canonicalLexUrl(d.url), expectedTitle: d.expectedTitle || '', expectedTitles: d.expectedTitles || (d.expectedTitle ? [d.expectedTitle] : []),
      expectedNumber: d.expectedNumber || null, expectedDate: d.expectedDate || null, source: 'lex.uz-pinned' }));
  const candidates = [...pinnedCandidates, ...dynamicCandidates, ...registryCandidates].filter(candidate => {
    if (!candidate.url || seenCandidates.has(candidate.url)) return false;
    seenCandidates.add(candidate.url);
    return true;
  });

  console.log(`[LEX-LIVE] ${registryCandidates.length} registry + ${searchCandidates.length} search candidates, fetching up to ${maxDocs}`);

  const results = [];
  const inspectionLimit = Number.isFinite(Number(maxCandidatesToInspect)) && Number(maxCandidatesToInspect) > 0
    ? Math.floor(Number(maxCandidatesToInspect))
    : Math.max(6, maxDocs * 4);
  let inspectedCandidates = 0;
  for (const candidate of candidates) {
    if (results.length >= maxDocs) break;
    if (inspectedCandidates >= inspectionLimit) {
      console.warn(`[LEX-LIVE] Candidate inspection capped at ${inspectionLimit}`);
      break;
    }
    if (leftMs() <= 0) {
      console.warn(`[LEX-LIVE] Time limit reached, ${results.length} documents kept`);
      break;
    }
    const docUrl = candidate.url;
    if (readBudget && !isLexDocumentCached(docUrl)) {
      if (readBudget.left <= 0) {
        console.warn(`[LEX-LIVE] Round read limit reached, ${results.length} documents kept`);
        break;
      }
      readBudget.left -= 1;
    }
    inspectedCandidates += 1;
    try {
      // the read has its own limit (fetchCachedLexDocument); here only the round's deadline
      const big = actForm || candidate.source === 'lex.uz-registry' || candidate.source === 'lex.uz-pinned' || candidate.exactIdentityMatch;
      const doc = await within(fetchCachedLexDocument(docUrl, { maxBytes: big ? PAGE_MAX_BYTES() : PAGE_MAX_BYTES_OTHER() }), leftMs());
      if (!doc.body || doc.body.trim().length === 0) continue;

      // Skip if still a historical version after the auto-follow attempt
      // (fetchLexDocument already tried to follow current_version_url)
      if (doc.metadata.current_version_url || doc.metadata.is_active === false) {
        console.warn(`[LEX-LIVE] Skipping historical version: ${docUrl}`);
        continue;
      }

      // a pinned act is the act itself, so most of its title must be there
      // (one shared word is enough for a registry entry, not for this)
      if (candidate.source === 'lex.uz-pinned' && (candidate.expectedTitles.length
        ? !candidate.expectedTitles.some(t => titleMostlyMatches(t, doc.title || ''))
        : !identityMatches(doc, candidate.expectedNumber, candidate.expectedDate))) {
        console.warn(`[LEX-LIVE] Pinned act identity mismatch, skipped: "${candidate.expectedTitle || `${candidate.expectedNumber}, ${candidate.expectedDate}`}" -> "${doc.title || ''}"`);
        continue;
      }
      if (candidate.source !== 'lex.uz-pinned' && candidate.expectedTitle && !titlesMatch(candidate.expectedTitle, doc.title || '')) {
        console.warn(`[LEX-LIVE] Registry title mismatch, skipped: "${candidate.expectedTitle}" -> "${doc.title || ''}"`);
        continue;
      }

      const excerpt = extractRelevantSections(doc.body, effectiveScoreText, maxChars, { keyLine: candidate.source === 'lex.uz-pinned' || candidate.exactIdentityMatch === true });
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
        ownDocumentNumber: candidate.ownDocumentNumber || null,
        exactIdentityMatch: candidate.exactIdentityMatch === true,
        searchRankScore: candidate.searchRankScore || 0,
        metadata: doc.metadata,
        provisionRefs: provision.refs,
        provisionType: provision.type,
      });
    } catch (err) {
      console.warn(`[LEX-LIVE] Failed to fetch ${docUrl}: ${err.message}`);
    }
  }

  console.log(`[LEX-LIVE] Returning ${results.length} documents from lex.uz (${Date.now() - startedAt} ms)`);
  return results;
}

/** Waits for a lex.uz read at most ms; the read itself goes on. */
function within(promise, ms) {
  if (!Number.isFinite(ms)) return promise;
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`lex.uz time limit ${Math.round(ms)} ms`)), Math.max(0, ms)); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Parse lex.uz search results HTML and extract unique document URLs.
 */
function parseSearchResults(html) {
  return parseSearchCandidates(html).map(candidate => candidate.url);
}

/**
 * Build the official Lex.uz search URL.
 *
 * Full-text `Query=PF-60`/`PQ-4008` searches are unreliable because Lex.uz
 * treats the identifier as ordinary text and may rank recent amendments
 * first. Its advanced-search form has a dedicated `actnum` field. Once an
 * identifier is known, search by its numeric component and constrain the
 * document form: Presidential decrees are Farmon (3973), while Presidential
 * and Cabinet decisions are Qaror (3972). Issuing-body/type verification is
 * still performed against each result row's own badge.
 */
// lex.uz's own form ids (its search page's "Hujjat turi" list): a code or a
// law is found among a few acts, where the plain search lists the newest of
// hundreds (2026-10-22: "pudratchining javobgarligi" with the code filter
// returned the Civil Code, part two, alone).
const ACT_FORMS = Object.freeze({ code: '3964', law: '3968' });
// lex.uz refuses a text query over 100 characters
const MAX_QUERY_CHARS = 100;

function capQuery(value = '') {
  const text = String(value || '').replace(/\s+/gu, ' ').trim();
  if (text.length <= MAX_QUERY_CHARS) return text;
  const cut = text.slice(0, MAX_QUERY_CHARS + 1);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut.slice(0, MAX_QUERY_CHARS)).trim();
}

/**
 * Text queries search acts in force only (status=Y: a repealed or historical
 * page is skipped after reading anyway) and, with actForm, one act form.
 */
function buildLexSearchUrl(query = '', { actForm = '' } = {}) {
  const rawQuery = String(query || '').trim();
  const exact = extractActIdentifiers(rawQuery)[0];
  if (!exact) {
    const params = new URLSearchParams({ Query: capQuery(rawQuery), status: 'Y' });
    if (ACT_FORMS[actForm]) params.set('form_id', ACT_FORMS[actForm]);
    return `${LEX_SEARCH_URL}?${params.toString()}`;
  }

  const formId = exact.prefix === 'PF'
    ? '3973'
    : (exact.prefix === 'PQ' || exact.prefix === 'VMQ' ? '3972' : (exact.prefix === 'ORQ' ? '3968' : ''));
  const params = new URLSearchParams({
    actnum: exact.number,
    lang: '4',
    status: 'Y',
  });
  if (formId) params.set('form_id', formId);
  return `${LEX_SEARCH_URL}?${params.toString()}`;
}

/**
 * Shorter forms of a query that found nothing: lex.uz wants every word near
 * the others, so a long phrase finds no act where two of its words would
 * (2026-10-22: "avans to'lovini qaytarish majburiyati" 0, "avans to'lovini"
 * 17). The first and the last two words, at most two more searches.
 */
const CONNECTORS = new Set(["bo'yicha", 'boʻyicha', 'буйича', 'бўйича', 'tomonidan', 'томонидан', 'va', 'ва', 'uchun', 'учун', 'bilan', 'билан', 'hamda', 'ҳамда', 'yoki', 'ёки', 'haqida', 'ҳақида']);

function relaxedQueries(query = '') {
  const words = String(query || '').replace(/[,.;:!?«»"“”()]/gu, ' ').split(/\s+/u)
    .filter(w => w && !CONNECTORS.has(w.toLocaleLowerCase('uz').replace(/[ʻ‘’`]/gu, "'")));
  if (words.length < 2) return [];
  const joined = words.join(' ');
  const out = words.length === 2 ? [joined] : [words.slice(0, 2).join(' '), words.slice(-2).join(' ')];
  return Array.from(new Set(out)).filter(q => q.length >= 3 && q !== query);
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
  if (refs.length) return refs[refs.length - 1];

  // Lex.uz badges often write the issuing body and a bare "824-son"
  // instead of the UI shorthand "VMQ-824". Infer the prefix only from the
  // badge's explicit act type; never infer it from the document body.
  const text = String(value || '');
  let prefix = '';
  if (/(?:Vazirlar\s+Mahkamasi|\u0412\u0430\u0437\u0438\u0440\u043b\u0430\u0440\s+\u041c\u0430\u04b3\u043a\u0430\u043c\u0430\u0441\u0438|\u041a\u0430\u0431\u0438\u043d\u0435\u0442\u0430\s+\u041c\u0438\u043d\u0438\u0441\u0442\u0440\u043e\u0432).*?(?:qaror|\u049b\u0430\u0440\u043e\u0440|\u043f\u043e\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d)/iu.test(text)) prefix = 'VMQ';
  else if (/(?:Prezident|\u041f\u0440\u0435\u0437\u0438\u0434\u0435\u043d\u0442).*?(?:farmon|\u0444\u0430\u0440\u043c\u043e\u043d|\u0443\u043a\u0430\u0437)/iu.test(text)) prefix = 'PF';
  else if (/(?:Prezident|\u041f\u0440\u0435\u0437\u0438\u0434\u0435\u043d\u0442).*?(?:qaror|\u049b\u0430\u0440\u043e\u0440|\u043f\u043e\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d)/iu.test(text)) prefix = 'PQ';
  if (!prefix) return null;

  const numbers = Array.from(text.matchAll(/(?<!\d)(\d{1,6})\s*[-\u2013\u2014]?\s*(?:son|\u0441\u043e\u043d|\u043d\u043e\u043c\u0435\u0440)/giu), match => match[1]);
  return numbers.length ? { prefix, number: numbers[numbers.length - 1] } : null;
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

function rankSearchCandidates(candidates = [], query = '', opts = {}) {
  const requestedActs = Array.isArray(opts.requestedActs)
    ? opts.requestedActs
    : extractActIdentifiers(query);
  const preferredPrefixes = new Set(
    (Array.isArray(opts.preferredPrefixes) ? opts.preferredPrefixes : [])
      .map(canonicalActPrefix)
      .filter(Boolean)
  );
  const queryRoots = new Set(searchRoots(query));
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate, index) => {
      const titleRoots = new Set(searchRoots(candidate.title));
      let score = 0;
      let exactIdentityMatch = false;
      for (const root of queryRoots) if (titleRoots.has(root)) score += 12;
      if (candidate.isActive === false) score -= 1000;
      if (/o['`\u2018\u2019\u02bb]?zgartirish|qo['`\u2018\u2019\u02bb]?shimcha|\u045e\u0437\u0433\u0430\u0440\u0442\u0438\u0440\u0438\u0448|\u0438\u0437\u043c\u0435\u043d\u0435\u043d/iu.test(candidate.title)) score -= 18;
      if (preferredPrefixes.size > 0 && candidate.documentNumber) {
        if (preferredPrefixes.has(candidate.documentNumber.prefix)) score += 250;
        else score -= 25;
      }
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

async function fetchCachedSearchPage(searchUrl) {
  const key = String(searchUrl || '');
  const cached = searchPageCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.html;
  if (cached) searchPageCache.delete(key);
  if (searchPageInFlight.has(key)) return searchPageInFlight.get(key);

  const pending = httpGet(key).then((html) => {
    searchPageCache.set(key, { html, expiresAt: Date.now() + SEARCH_PAGE_CACHE_TTL_MS });
    return html;
  }).finally(() => {
    searchPageInFlight.delete(key);
  });
  searchPageInFlight.set(key, pending);
  return pending;
}

function isLexDocumentCached(url) {
  const key = canonicalLexUrl(url);
  const cached = documentCache.get(key);
  return !!(cached && cached.expiresAt > Date.now()) || documentInFlight.has(key);
}

async function fetchCachedLexDocument(url, { maxBytes = PAGE_MAX_BYTES() } = {}) {
  const key = canonicalLexUrl(url);
  const cached = documentCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.document;
  if (cached) { cachedChars -= String((cached.document || {}).body || '').length; documentCache.delete(key); }
  if (documentInFlight.has(key)) return documentInFlight.get(key);

  // the slot is held until the read itself ends; a read past LEX_FETCH_MAX_MS
  // (from its start, not from the wait for a slot) is cancelled, so a page
  // that never finishes cannot hold the only slot (2026-10-26)
  const pending = acquireFetchSlot().then(() => {
    const controller = new AbortController();
    let released = false;
    const release = () => { if (!released) { released = true; releaseFetchSlot(); } };
    const read = Promise.resolve().then(() => fetchLexDocument(key, { maxBytes, signal: controller.signal }));
    read.then(release, release);
    return within(read, DOC_FETCH_MAX_MS()).catch((err) => {
      controller.abort();
      release();
      throw err;
    });
  }).then((full) => {
    // the page's HTML (0.3-1 MB) is not kept: live search reads the text only;
    // ingest reads lex.uz itself (fetchLexDocument), never this cache
    const document = { title: full.title, body: full.body, metadata: full.metadata };
    const size = String(document.body || '').length;
    while (documentCache.size && (documentCache.size >= DOCUMENT_CACHE_LIMIT || cachedChars + size > DOCUMENT_CACHE_MAX_CHARS())) {
      const oldest = documentCache.keys().next().value;
      cachedChars -= String((documentCache.get(oldest).document || {}).body || '').length;
      documentCache.delete(oldest);
    }
    cachedChars += size;
    documentCache.set(key, {
      document,
      expiresAt: Date.now() + DOCUMENT_CACHE_TTL_MS,
    });
    return document;
  }).finally(() => {
    documentInFlight.delete(key);
  });
  documentInFlight.set(key, pending);
  return pending;
}

function clearLexDocumentCache() {
  documentCache.clear();
  cachedChars = 0;
  documentInFlight.clear();
  searchPageCache.clear();
  searchPageInFlight.clear();
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

/** At least 60% of the expected title's words are in the page's own title. */
/**
 * A pinned act without a confirmed title: its own number AND its date must be
 * on the page (metadata, or the head / signature block). One alone is not
 * enough - Cabinet numbers restart every year.
 */
function identityMatches(doc = {}, number = '', date = '') {
  if (!number || !date) return false;
  const meta = doc.metadata || {};
  const text = `${doc.title || ''}\n${String(doc.body || '').slice(0, 1500)}\n${String(doc.body || '').slice(-1000)}`;
  const n = String(number).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const [y, m, d] = String(date).split('-');
  const numberOk = String(meta.document_number || '').replace(/\D/gu, '') === String(number).replace(/\D/gu, '')
    || new RegExp(`(?:№|N)\\s*${n}(?!\\d)|(?<!\\d)${n}\\s*[-\u2013]\\s*(?:son|сон|сонли|sonli)`, 'iu').test(text);
  const dateOk = meta.adoption_date === date || text.includes(`${d}.${m}.${y}`);
  return numberOk && dateOk;
}

function titleMostlyMatches(expected = '', actual = '') {
  const expectedWords = comparableWords(expected);
  const actualSet = new Set(comparableWords(actual));
  if (!expectedWords.length) return false;
  return expectedWords.filter(word => actualSet.has(word)).length / expectedWords.length >= 0.6;
}

function relevanceScore(value = '', query = '') {
  const haystack = new Set(comparableWords(value));
  return comparableWords(query).reduce((score, word) => score + (haystack.has(word) ? 1 : 0), 0);
}

/**
 * Extract the most relevant sections from a document body given a query.
 * Splits by article boundaries, scores by keyword overlap, returns best sections.
 */
// keyLine: put the act's best-answering line first (findKeyLine) - only for an
// act the server identified itself (pinned for a named status, or the number
// asked): on a general question the line most like the words can mislead
// (Labour Code: "may withhold pay during a strike" for unpaid wages).
function extractRelevantSections(body, query, maxChars, { keyLine = false } = {}) {
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

  const excerpt = result || body.substring(0, maxChars);
  // the line that answers best goes first, word for word, with its unit
  const key = keyLine ? findKeyLine(body, query) : null;
  if (!key) return excerpt;
  const label = `SAVOLGA ENG YAQIN QATOR${key.unit ? ` (${key.unit})` : ''} [server so'zlar bo'yicha tanlagan - o'qing va tekshiring]: ${key.line}`;
  const rest = excerpt.length + label.length + 2 > maxChars ? excerpt.slice(0, Math.max(0, maxChars - label.length - 2)) : excerpt;
  return `${label}\n\n${rest}`;
}

// A line that grants an exception or a right ("...olmasdan turib ... jalb
// etish", "talab qilinmaydi", "ozod etiladi", "huquqiga ega") answers a
// question about a requirement more directly than the requirement itself.
const EXCEPTION_MARK = /olmasdan|olinmasdan|talab\s+qilinmaydi|talab\s+etilmaydi|qilinmaydi|ozod\s+et|ozod\s+qilin|istisno|mustasno|huquqiga\s+ega|(?:^|\s)без\s|не\s+требуется|освобожда|за\s+исключением|вправе/iu;

// words of any sentence, not of the matter ("olib", "uchun" matched a customs
// line in VMQ-589); compared by their 5-letter start
const KEY_STOP = new Set(['uchun', 'bilan', 'haqid', 'kerak', 'olib', 'qanda', 'nima', 'mumki', 'menga', 'menin',
  'bizni', 'ularn', 'bunda', 'shuni', 'amalg', 'oshir', 'tartib', 'belgi', 'boyic', 'respu', 'ozbek', 'tomon', 'etish', 'qilis',
  'mavju', 'hamda', 'yoki', 'agar', 'ammo', 'lekin', 'kelis', 'bolad', 'bolsa', 'beril', 'chun', 'для', 'когда', 'нужно', 'можно']);
const keyRoots = (text = '') => Array.from(new Set(String(text || '')
  .normalize('NFKC').toLocaleLowerCase('uz')
  .replace(/[\u02bb\u02bc\u2018\u2019`']/gu, '')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .split(/\s+/u)
  .filter(w => w.length >= 4)
  .map(w => w.slice(0, 5))
  .filter(r => !KEY_STOP.has(r))));

/**
 * The act's one line that answers the question best (2026-10-27: an IT Park
 * answer cited band 5 of VMQ-589 - the Ministry shall issue confirmations -
 * and said no exemption exists, while band 17, deep in the excerpt among the
 * tax privileges, lets a resident hire foreign specialists without one). A
 * line counts its distinct question roots (5-letter starts), and an exception
 * or a right is worth two more; at least two roots, else none. Returned with
 * its band or article number. No AI; it points, it does not judge.
 */
function findKeyLine(body = '', query = '') {
  const qRoots = new Set(keyRoots(query));
  if (qRoots.size < 2) return null;
  let best = null;
  let unit = '';
  let unitRoots = [];
  for (const raw of String(body || '').split(/\n+/u)) {
    const line = raw.trim();
    const head = line.match(/^(\d{1,4})(?:[\u2070\u00B9\u00B2\u00B3\u2074-\u2079]*)\s*[-.]\s*(modda)?/u);
    // a list item reads with its unit's opening line ("17. Texnopark rezidenti:")
    if (head) { unit = head[2] ? `${head[1]}-modda` : `${head[1]}-band`; unitRoots = keyRoots(line.slice(0, 200)); }
    if (line.length < 20 || line.length > 600) continue;
    const hits = new Set([...keyRoots(line), ...unitRoots].filter(r => qRoots.has(r))).size;
    if (hits < 2) continue;
    const score = hits + (EXCEPTION_MARK.test(line) ? 2 : 0);
    if (!best || score > best.score) best = { line, unit, score, hits };
  }
  return best;
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

  const { legalForceLabel } = require('./legal-force');
  const body = results.map((r, i) => [
    `[LEX-${i + 1}] ${r.title}`,
    legalForceLabel(r, isUz ? 'uz' : 'ru') ? `  ${legalForceLabel(r, isUz ? 'uz' : 'ru')}` : '',
    r.content,
    r.url ? `  (${isUz ? 'Manba' : 'Источник'}: ${r.url})` : '',
  ].filter(Boolean).join('\n')).join('\n\n');

  return header + body;
}

module.exports = {
  searchLexUz,
  relaxedQueries,
  ACT_FORMS,
  titleMostlyMatches,
  identityMatches,
  buildLexSearchUrl,
  formatLexSearchResults,
  parseSearchResults,
  parseSearchCandidates,
  rankSearchCandidates,
  extractActIdentifiers,
  canonicalLexUrl,
  extractRelevantSections,
  findKeyLine,
  EXCEPTION_MARK,
  inferExcerptProvision,
  fetchCachedLexDocument,
  isLexDocumentCached,
  clearLexDocumentCache,
};
