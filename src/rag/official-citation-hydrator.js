'use strict';

const { searchLexUz } = require('./lex-live-search');
const {
  getChunkDocumentIdentifier,
  normalizeOfficialDocumentIdentifier,
} = require('./citation-utils');

const OFFICIAL_ID_RE = /(?<![\p{L}\p{N}])(O['`\u2018\u2019\u02bb\u02bc]?RQ|PQ|PF|VMQ|VM|\u040e\u0420\u049a|\u041f\u049a|\u041f\u0424|\u0412\u041c\u049a|\u0412\u041c|\u0417\u0420\u0423|\u041f\u041f|\u0423\u041f)\s*[-\u2013\u2014]?\s*(\d{1,6}(?:-[IVXLCDM]+)?)(?![\p{L}\p{N}])/giu;

function normalizeWords(value = '') {
  return String(value || '')
    .toLocaleLowerCase('uz')
    .normalize('NFKC')
    .replace(/['`\u2018\u2019\u02bb\u02bc]/gu, '')
    .replace(/\]\([^)]*\)/gu, ']')
    .replace(/https?:\/\/\S+/giu, ' ')
    .replace(/[^a-z\u0430-\u044f\u04510-9\s]/giu, ' ')
    .split(/\s+/u)
    .filter((word) => word.length >= 4 && ![
      'ozbekiston', 'respublikasi', 'togrisida', 'qarori', 'farmoni',
      'qonuni', 'yildagi', 'tegishli', 'mazkur', 'ushbu',
    ].includes(word));
}

function sentenceAround(value = '', index = 0, matchLength = 0) {
  const text = String(value || '');
  const floor = Math.max(0, index - 420);
  const ceiling = Math.min(text.length, index + matchLength + 260);
  const before = text.slice(floor, index);
  const boundary = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '));
  const start = boundary >= 0 ? floor + boundary + 1 : floor;
  const after = text.slice(index + matchLength, ceiling);
  const endMatch = after.search(/(?:\n|[.!?]\s)/u);
  const end = endMatch >= 0 ? index + matchLength + endMatch + 1 : ceiling;
  return text.slice(start, end).replace(/\s+/gu, ' ').trim();
}

function extractOfficialActMentions(value = '', limit = 6) {
  const text = String(value || '');
  const mentions = [];
  const seen = new Set();
  let match;
  OFFICIAL_ID_RE.lastIndex = 0;
  while ((match = OFFICIAL_ID_RE.exec(text)) && mentions.length < limit) {
    const identifier = normalizeOfficialDocumentIdentifier(`${match[1]}-${match[2]}`);
    if (!identifier || seen.has(identifier)) continue;
    seen.add(identifier);
    mentions.push({
      identifier,
      context: sentenceAround(text, match.index, match[0].length),
      raw: match[0],
    });
  }
  return mentions;
}

function resultIdentifier(result = {}) {
  return getChunkDocumentIdentifier({
    ownDocumentNumber: result.ownDocumentNumber,
    document_number: result.metadata && result.metadata.document_number,
    law_name: result.lawName || result.title,
    metadata: result.metadata || {},
  });
}

function resultMatchesMention(result = {}, mention = {}) {
  if (!result || !result.url || resultIdentifier(result) !== mention.identifier) return false;
  if (result.metadata && result.metadata.is_active === false) return false;

  const contextYears = new Set(String(mention.context || '').match(/(?:19|20)\d{2}/gu) || []);
  const adoptionYear = String((result.metadata && result.metadata.adoption_date) || '').match(/(?:19|20)\d{2}/u);
  if (contextYears.size > 0 && (!adoptionYear || !contextYears.has(adoptionYear[0]))) return false;

  const contextWords = new Set(normalizeWords(mention.context));
  const titleWords = normalizeWords(result.title || result.lawName || '');
  const overlap = titleWords.filter((word) => contextWords.has(word)).length;
  // Decision numbers restart over time. Without either a matching year or at
  // least two title terms, linking a bare VMQ/PQ/PF number could point to an
  // entirely different act that happens to share the number.
  return contextYears.size > 0 || overlap >= Math.min(2, titleWords.length || 2);
}

function resultScore(result = {}, mention = {}) {
  const contextWords = new Set(normalizeWords(mention.context));
  const overlap = normalizeWords(result.title || result.lawName || '')
    .filter((word) => contextWords.has(word)).length;
  const year = String((result.metadata && result.metadata.adoption_date) || '').match(/(?:19|20)\d{2}/u);
  const yearMatch = year && String(mention.context || '').includes(year[0]) ? 100 : 0;
  return yearMatch + overlap * 10 + Number(result.searchRankScore || 0) / 10000;
}

function lexDocumentKey(value = '') {
  const match = String(value || '').match(/lex\.uz\/(?:uz\/|ru\/)?docs\/(-?\d+)/iu);
  return match ? match[1].replace(/^-/, '') : '';
}

function adaptResult(result, identifier, index = 0, topic = null) {
  return {
    id: `lex_mentioned_${index}_${lexDocumentKey(result.url)}`,
    chunk_text: result.content || result.head || '',
    childText: result.content || result.head || '',
    parentText: result.content || result.head || '',
    law_name: result.lawName || result.title || identifier,
    source_url: result.url,
    article_numbers: Array.isArray(result.provisionRefs) ? result.provisionRefs : [],
    provision_type: result.provisionType || 'band',
    category: topic || null,
    source_type: 'lex_live',
    language: 'uz',
    is_active: true,
    adoption_date: result.metadata && result.metadata.adoption_date,
    document_number: identifier,
    ownDocumentNumber: result.ownDocumentNumber || null,
    metadata: result.metadata || {},
  };
}

async function hydrateMentionedOfficialActChunks(answer = '', chunks = [], opts = {}) {
  const existing = Array.isArray(chunks) ? [...chunks] : [];
  const maxMentions = Math.max(0, Math.min(6, Number(opts.maxMentions || 4)));
  const mentions = extractOfficialActMentions(answer, maxMentions);
  const covered = new Set(existing.map(getChunkDocumentIdentifier).filter(Boolean));
  const sourceKeys = new Set(existing.map((chunk) => lexDocumentKey(chunk && chunk.source_url)).filter(Boolean));
  const added = [];
  const unresolved = [];
  const search = typeof opts.search === 'function' ? opts.search : searchLexUz;

  for (const mention of mentions) {
    if (covered.has(mention.identifier)) continue;
    const prefix = mention.identifier.split('-')[0];
    let results = [];
    try {
      results = await search(`${mention.identifier} ${mention.context}`.slice(0, 520), {
        maxDocs: 3,
        maxChars: 1400,
        scoreText: mention.context,
        preferredPrefixes: [prefix],
        topic: opts.topic || null,
      });
    } catch (_) {
      unresolved.push(mention.identifier);
      continue;
    }
    const candidates = (Array.isArray(results) ? results : [])
      .filter((result) => resultMatchesMention(result, mention))
      .sort((a, b) => resultScore(b, mention) - resultScore(a, mention));
    const best = candidates[0];
    const key = best && lexDocumentKey(best.url);
    if (!best || !key || sourceKeys.has(key)) {
      if (!best) unresolved.push(mention.identifier);
      continue;
    }
    const chunk = adaptResult(best, mention.identifier, added.length, opts.topic || null);
    existing.push(chunk);
    added.push(chunk);
    covered.add(mention.identifier);
    sourceKeys.add(key);
  }

  return { chunks: existing, added, unresolved };
}

module.exports = {
  extractOfficialActMentions,
  resultMatchesMention,
  hydrateMentionedOfficialActChunks,
};
