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
  isHighConfidenceKeywordMatch,
  mergePrioritizedResults,
  normalizeUzbekForSearch,
  toPrefixToken,
};
