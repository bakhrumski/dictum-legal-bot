'use strict';


const APOSTROPHE_RX = /['`ʼʻʹ՚ʽˈ’‘‛′´]+/gu;
const INNER_APOSTROPHE_RX = /(\p{L})['`ʼʻʹ՚ʽˈ’‘‛′´](?=\p{L})/gu;
const NON_WORD_RX = /[^\p{L}\p{N}\s]+/gu;
const MULTISPACE_RX = /\s+/g;
const NORMALIZED_APOSTROPHE_CLASS = "\\u0027`\\u02B9\\u02BB\\u02BC\\u02BD\\u02BE\\u055A\\u2018\\u2019\\u201B\\u2032\\u00B4";
const NORMALIZED_APOSTROPHE_RX = new RegExp(`[${NORMALIZED_APOSTROPHE_CLASS}]+`, 'gu');
const NORMALIZED_INNER_APOSTROPHE_RX = new RegExp(`(\\p{L})[${NORMALIZED_APOSTROPHE_CLASS}](?=\\p{L})`, 'gu');

const STOPWORDS = new Set([
  'bilan',
  'uchun',
  'haqida',
  'boyicha',
  'qanday',
  'nima',
  'qaysi',
  'qancha',
  'qachon',
  'nega',
  'qilib',
  'kerak',
  'mavjud',
  'boladi',
  'hisoblanadi',
]);

function unique(items) {
  return Array.from(new Set((items || []).filter(Boolean)));
}

function normalizeUzbekForSearch(text = '') {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(NORMALIZED_INNER_APOSTROPHE_RX, '$1')
    .replace(NORMALIZED_APOSTROPHE_RX, ' ')
    .replace(NON_WORD_RX, ' ')
    .replace(MULTISPACE_RX, ' ')
    .trim();
}

function canonicalizeUzbekToken(token = '') {
  let normalized = normalizeUzbekForSearch(token).replace(MULTISPACE_RX, '');
  if (!normalized) return '';

  const suffixRules = [
    [/larining$/u, 'lari'],
    [/larning$/u, 'lar'],
    [/laridan$/u, 'lar'],
    [/lariga$/u, 'lar'],
    [/larini$/u, 'lar'],
    [/larida$/u, 'lar'],
    [/sining$/u, 'si'],
    [/sidan$/u, 'si'],
    [/siga$/u, 'si'],
    [/sini$/u, 'si'],
    [/si$/u, ''],
    [/ning$/u, ''],
    [/dan$/u, ''],
    [/tan$/u, ''],
    [/ga$/u, ''],
    [/ka$/u, ''],
    [/qa$/u, ''],
    [/da$/u, ''],
    [/ta$/u, ''],
    [/ni$/u, ''],
  ];

  for (const [pattern, replacement] of suffixRules) {
    if (normalized.length >= 5 && pattern.test(normalized)) {
      normalized = normalized.replace(pattern, replacement);
      break;
    }
  }

  return normalized;
}

function toPrefixToken(token = '') {
  let normalized = canonicalizeUzbekToken(token);
  if (!normalized) return '';

  if (
    normalized.length >= 6 &&
    /[b-df-hj-np-tv-z]i$/u.test(normalized) &&
    !/(iy|chi|shi)$/u.test(normalized)
  ) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

function buildPrefixTsQuery(tokens, joiner = ' | ') {
  const terms = unique(tokens)
    .map((token) => String(token || '').trim())
    .filter((token) => token.length >= 2)
    .map((token) => `${token}:*`);

  return terms.join(joiner);
}

function buildKeywordArtifacts(query = '') {
  const normalizedQuery = normalizeUzbekForSearch(query);
  const rawTokens = normalizedQuery.split(' ').filter(Boolean);

  const canonicalTokens = unique(
    rawTokens
      .map(canonicalizeUzbekToken)
      .filter((token) => token.length >= 2)
  );

  const prefixTokens = unique(
    canonicalTokens
      .map(toPrefixToken)
      .filter((token) => token.length >= 2)
  );

  const searchTokens = unique(
    prefixTokens.filter((token) => token.length >= 3 && !STOPWORDS.has(token))
  );
  const phraseTokens = unique(
    canonicalTokens.filter((token) => token.length >= 3 && !STOPWORDS.has(token))
  );

  const finalSearchTokens = searchTokens.length > 0 ? searchTokens : prefixTokens;
  const finalPhraseTokens = phraseTokens.length > 0 ? phraseTokens : canonicalTokens;
  const coreTokens = finalSearchTokens.slice(0, Math.min(2, finalSearchTokens.length));
  const phrases = [];

  if (finalPhraseTokens.length >= 2) {
    for (let size = Math.min(3, finalPhraseTokens.length); size >= 2; size--) {
      for (let index = 0; index <= finalPhraseTokens.length - size && phrases.length < 6; index++) {
        phrases.push(finalPhraseTokens.slice(index, index + size).join(' '));
      }
    }
  }

  return {
    normalizedQuery,
    rawTokens,
    canonicalTokens,
    prefixTokens,
    searchTokens: finalSearchTokens,
    coreTokens,
    phrases: unique(phrases),
    tsQuery: buildPrefixTsQuery(finalSearchTokens),
    coreTsQuery: buildPrefixTsQuery(coreTokens.length > 0 ? coreTokens : finalSearchTokens.slice(0, 1), ' & '),
  };
}

function mergePrioritizedResults(prioritized = [], results = [], limit = null) {
  const merged = [];
  const seenIds = new Set();

  for (const item of [...prioritized, ...results]) {
    if (!item || item.id == null) continue;
    if (seenIds.has(item.id)) continue;
    seenIds.add(item.id);
    merged.push(item);
  }

  return typeof limit === 'number' ? merged.slice(0, limit) : merged;
}

/**
 * One article, one slot. Eval run 17: in 10 of 47 misses the same article
 * filled two of the top 3 (Mehnat kodeksi 207 twice at 0.74), and matching
 * on identical text (run 19) caught none of them: an article is stored as
 * its parent ("[bob]\n207-modda. …\nfull text") and as parts ("207-modda.
 * … — 1-qism:\npart text"), and a parent-child hit wraps both under another
 * id, so the copies differ in their headers.
 *
 * law_text chunks of the same law and the same single article collapse into
 * the first (highest-ranked) one, which keeps its place and id:
 *  - a later chunk whose body is inside the kept text is dropped;
 *  - if the kept body is inside the later chunk (a part, then its article),
 *    the kept one takes the later text;
 *  - otherwise (two different parts, or two pieces of a long article) the
 *    texts are joined while they fit in maxChars, else the later is dropped.
 * Chunks without a single article number fall back to plain containment.
 * QA answers and other source types are never touched.
 */
function collapseRepeatedChunks(chunks = [], { maxChars = 7000 } = {}) {
  const norm = (t) => String(t || '').replace(MULTISPACE_RX, ' ').trim();
  // The body without the header line ("207-modda. … — 1-qism:" or "[bob]").
  const body = (t) => {
    const s = String(t || '');
    const nl = s.indexOf('\n');
    return norm(nl > 0 && nl < s.length - 1 ? s.slice(nl + 1) : s);
  };
  const articleOf = (r) => {
    const nums = Array.isArray(r.article_numbers) ? r.article_numbers.filter(Boolean) : [];
    if (nums.length === 1) return String(nums[0]).trim().toLowerCase();
    if (nums.length === 0 && r.articleNumber) return String(r.articleNumber).trim().toLowerCase();
    return null;
  };
  const kept = [];
  for (const item of chunks) {
    if (!item) continue;
    const text = norm(item.chunk_text);
    if (!text || item.source_type !== 'law_text') { kept.push({ item }); continue; }
    const law = item.law_name || '';
    const article = articleOf(item);
    const own = body(item.chunk_text);
    const idx = kept.findIndex(k => k.law === law && (article
      ? k.article === article
      : (k.text.includes(text) || text.includes(k.text))));
    if (idx < 0) { kept.push({ item, law, article, text }); continue; }

    const k = kept[idx];
    if (k.text.includes(own)) continue;
    if (text.includes(body(k.item.chunk_text))) {
      kept[idx] = { ...k, text, item: { ...k.item, chunk_text: item.chunk_text } };
      continue;
    }
    const joined = `${k.item.chunk_text}\n\n${item.chunk_text}`;
    if (article && joined.length <= maxChars) {
      kept[idx] = { ...k, text: norm(joined), item: { ...k.item, chunk_text: joined } };
    }
  }
  return kept.map(k => k.item);
}

function isHighConfidenceKeywordMatch(row = {}) {
  const keywordScore = Number(row.keyword_score || 0);
  const termHits = Number(row.keyword_term_hits || 0);

  return Boolean(
    row.exact_phrase_match ||
    (row.core_term_match && termHits >= 2) ||
    (termHits >= 2 && keywordScore >= 0.05) ||
    (row.core_term_match && keywordScore >= 0.12)
  );
}

module.exports = {
  buildKeywordArtifacts,
  canonicalizeUzbekToken,
  collapseRepeatedChunks,
  isHighConfidenceKeywordMatch,
  mergePrioritizedResults,
  normalizeUzbekForSearch,
  toPrefixToken,
};
