'use strict';

const SUPER_DIGITS = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};

function unique(items = []) {
  return Array.from(new Set(items.filter(Boolean)));
}

function toSuperscriptDigits(value = '') {
  return String(value || '')
    .split('')
    .map((digit) => SUPER_DIGITS[digit] || digit)
    .join('');
}

function normalizeArticleRef(value = '') {
  if (!value) return '';
  return String(value)
    .replace(/\s+/g, ' ')
    .replace(/-modda\b/giu, '')
    .replace(/^modda\s+/giu, '')
    .trim();
}

function extractArticleRefsFromText(text = '') {
  const refs = [];
  if (!text) return refs;

  const patterns = [
    /^(\d+)([⁰¹²³⁴⁵⁶⁷⁸⁹]+)?[\s-]*(?:-?\s*)?modda\b/gimu,
    /^modda\s+(\d+)(?:\s+prim\s+(\d+))?\b/gimu,
    /^статья\s+(\d+)([⁰¹²³⁴⁵⁶⁷⁸⁹]+)?\b/gimu,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (pattern.source.startsWith('^modda')) {
        refs.push(`${match[1]}${match[2] ? toSuperscriptDigits(match[2]) : ''}`);
      } else {
        refs.push(`${match[1]}${match[2] || ''}`);
      }
    }
  }

  return unique(refs.map(normalizeArticleRef));
}

function getChunkArticleRefs(chunk = {}) {
  const refs = [];

  if (Array.isArray(chunk.article_numbers)) {
    refs.push(...chunk.article_numbers);
  }

  refs.push(
    chunk.article_number_display,
    chunk.articleNumber,
    ...(extractArticleRefsFromText(chunk.chunk_text || '')),
    ...(extractArticleRefsFromText(chunk.parentText || '')),
    ...(extractArticleRefsFromText(chunk.childText || ''))
  );

  return unique(refs.map(normalizeArticleRef));
}

function normalizeLawName(value = '') {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u02bb\u02bc\u2018\u2019`']/gu, '')
    .replace(/[*_\[\](){}:;,."\u00ab\u00bb]/gu, ' ')
    .replace(/[-/]/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLawNameAliases(value = '') {
  const normalized = normalizeLawName(value);
  if (!normalized) return [];
  const aliases = [normalized];
  const short = normalized
    .replace(/^ozbekiston\s+respublikas(?:i|ining)\s+/u, '')
    .trim();
  if (short && short !== normalized) aliases.push(short);
  return unique(aliases).sort((a, b) => b.length - a.length);
}

function articleOffsets(text = '', articleRef = '') {
  const normalizedRef = normalizeArticleRef(articleRef);
  if (!normalizedRef) return [];
  const base = normalizedRef.split('-')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`\\b${base}(?!\\d)(?:[-\\s]?\\d+)?[-\\s]?(?:modda|moddasi|moddaning|модда|моддаси|статья|статьи|ст\\.)`, 'giu');
  const out = [];
  let match;
  while ((match = rx.exec(String(text || ''))) !== null) out.push(match.index);
  return out;
}

/**
 * Return the part of a structured legal answer that applies the law to the
 * user's facts. Source footers are derived from this section so that a law
 * merely mentioned in the introductory legal-basis section is not presented
 * as a relied-on source unless the analysis actually uses it.
 *
 * Older lawyer-approved answers may not contain section headings. In that
 * case the complete answer remains the safest backwards-compatible scope.
 */
function extractAnalysisSection(text = '') {
  const reply = String(text || '');
  if (!reply.trim()) return '';

  const heading = /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?(?:\*{1,2}|_{1,2})?[ \t]*tahlil[ \t]*(?:\*{1,2}|_{1,2})?[ \t]*(?:(?::|[-–—])[ \t]*|\r?\n+|$)/iu;
  const match = heading.exec(reply);
  if (!match) return reply;

  const start = match.index + match[0].length;
  const remainder = reply.slice(start);
  const nextHeading = /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?(?:\*{1,2}|_{1,2})?[ \t]*(?:xulosa|manbalar|huquqiy[ \t]+asos)[ \t]*(?:\*{1,2}|_{1,2})?[ \t]*(?:(?::|[-–—])[ \t]*|\r?\n+|$)/iu;
  const endMatch = nextHeading.exec(remainder);
  return (endMatch ? remainder.slice(0, endMatch.index) : remainder).trim();
}

/**
 * Select only source/article pairs attributed to the same legal act in the
 * answer. Matching an article number alone is unsafe because many codes share
 * common article numbers.
 */
function selectRelevantSourceRefs(chunks = [], replyText = '') {
  const reply = String(replyText || '');
  if (!reply.trim()) return [];
  const normalizedReply = normalizeLawName(reply);

  const records = [];
  for (const chunk of chunks || []) {
    const lawName = chunk && chunk.law_name;
    if (!lawName) continue;
    const aliases = getLawNameAliases(lawName);
    if (aliases.length === 0) continue;
    records.push({
      chunk,
      lawName,
      lawKey: aliases[aliases.length - 1],
      aliases,
      articleRefs: getChunkArticleRefs(chunk),
    });
  }

  const mentionedLawKeys = new Set();
  for (const record of records) {
    if (record.aliases.some(alias => normalizedReply.includes(alias))) {
      mentionedLawKeys.add(record.lawKey);
    }
  }

  const selected = [];
  const seen = new Set();
  for (const record of records) {
    if (!mentionedLawKeys.has(record.lawKey)) continue;
    for (const articleRef of record.articleRefs) {
      const offsets = articleOffsets(reply, articleRef);
      if (offsets.length === 0) continue;

      let lawArticleMatch = mentionedLawKeys.size === 1;
      if (!lawArticleMatch) {
        // Associate the article with the nearest preceding named act. This is
        // stricter than a broad proximity check when two codes occur in one
        // paragraph and happen to share an article number.
        lawArticleMatch = offsets.some(offset => {
          const start = Math.max(0, offset - 320);
          const window = normalizeLawName(reply.slice(start, offset + 50));
          let nearestKey = null;
          let nearestIndex = -1;
          for (const candidate of records) {
            if (!mentionedLawKeys.has(candidate.lawKey)) continue;
            for (const alias of candidate.aliases) {
              const index = window.lastIndexOf(alias);
              if (index > nearestIndex) {
                nearestIndex = index;
                nearestKey = candidate.lawKey;
              }
            }
          }
          return nearestKey === record.lawKey;
        });
      }
      if (!lawArticleMatch) continue;

      const normalizedArticle = normalizeArticleRef(articleRef);
      const key = `${record.lawKey}|${normalizedArticle}`;
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push({ chunk: record.chunk, lawName: record.lawName, articleRef: normalizedArticle, key });
    }
  }
  return selected;
}

function stripFragment(value = '') {
  return String(value || '').split('#')[0];
}

function normalizeLexSourceUrl(value = '', lang = 'uz') {
  let url = stripFragment(value).trim();
  if (lang === 'uz') url = url.replace('lex.uz/ru/docs/', 'lex.uz/docs/');
  return url;
}

function normalizePartNumber(value = '') {
  const match = String(value || '').match(/\d+/u);
  return match ? match[0] : '';
}

/**
 * Find the qism explicitly attached to an article citation in generated text.
 * The value is used only to choose a Lex.uz destination; it does not create a
 * citation that was not already grounded by selectRelevantSourceRefs().
 */
function findCitationPartNumber(text = '', articleRef = '') {
  const ref = normalizeArticleRef(articleRef);
  if (!ref) return '';
  const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(
    `${escaped}(?!\\d)\\s*[-\u2013\u2014]?\\s*modda[\\p{L}'\u2019]*` +
    `\\s*,?\\s*(\\d+)(?:\\s*[-\u2013\u2014]\\s*\\d+)?\\s*[-\u2013\u2014]?\\s*qism[\\p{L}'\u2019]*`,
    'iu'
  );
  const match = rx.exec(String(text || ''));
  return match ? match[1] : '';
}

function cleanFragmentLine(value = '') {
  return String(value || '')
    .replace(/\[To['\u2019]liq modda konteksti:\][\s\S]*$/iu, '')
    .replace(/^[\s\-*#>]+/u, '')
    .replace(/[*_`\[\]|]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function isStructuralLine(value = '') {
  const line = cleanFragmentLine(value);
  if (!line) return true;
  if (/^\[[^\]]+\]$/u.test(line)) return true;
  if (/^\d+[\u2070\u00B9\u00B2\u00B3\u2074-\u2079]*\s*[-\u2013\u2014]?\s*(?:modda|\u043C\u043E\u0434\u0434\u0430)\b/iu.test(line)) return true;
  if (/^\d+(?:\s*[-\u2013\u2014]\s*\d+)?\s*[-\u2013\u2014]?\s*qism\s*:?$/iu.test(line)) return true;
  return false;
}

function excerptFromLines(value = '', partNumber = '') {
  const lines = String(value || '')
    .split(/\r?\n/u)
    .map(cleanFragmentLine)
    .filter(line => line && !isStructuralLine(line));
  if (lines.length === 0) return '';

  const requested = Number.parseInt(normalizePartNumber(partNumber), 10);
  const picked = Number.isFinite(requested) && requested > 0 && requested <= lines.length
    ? lines[requested - 1]
    : lines[0];
  if (picked.length <= 150) return picked;
  const shortened = picked.slice(0, 150);
  const boundary = shortened.lastIndexOf(' ');
  return (boundary > 70 ? shortened.slice(0, boundary) : shortened).trim();
}

/**
 * Create a deep Lex.uz URL for one retrieved clause.
 *
 * Newly ingested documents retain Lex.uz's stable element id and use #<id>.
 * Existing corpus rows fall back to a standards-based Text Fragment made from
 * the exact child clause, so this works immediately without a corpus rebuild.
 */
function buildLexDeepLink(chunk = {}, opts = {}) {
  const baseUrl = normalizeLexSourceUrl(chunk.source_url || chunk.sourceUrl || '', opts.lang || 'uz');
  if (!baseUrl) return '';

  const requestedPart = normalizePartNumber(opts.partNumber);
  const chunkPart = normalizePartNumber(chunk.part_number || chunk.partNumber);
  const elementId = String(
    chunk.lex_element_id || chunk.lexElementId ||
    (chunk.metadata && (chunk.metadata.lexElementId || chunk.metadata.lex_element_id)) || ''
  ).trim();

  // A child anchor is exact only when it represents the requested qism. An
  // article may contain several qism references in one answer.
  if (/^\d+$/u.test(elementId) && (!requestedPart || (chunkPart && requestedPart === chunkPart))) {
    return `${baseUrl}#${elementId}`;
  }

  let excerpt = '';
  if (requestedPart && chunk.parentText) {
    excerpt = excerptFromLines(chunk.parentText, requestedPart);
  }
  if (!excerpt) {
    excerpt = excerptFromLines(chunk.childText || chunk.chunk_text || chunk.parentText || '', '');
  }
  if (!excerpt && opts.articleRef) excerpt = `${normalizeArticleRef(opts.articleRef)}-modda`;
  return excerpt ? `${baseUrl}#:~:text=${encodeURIComponent(excerpt)}` : baseUrl;
}

/**
 * Link grounded inline article references in a Markdown answer. We process
 * only article numbers that identify one selected law in this answer; if two
 * cited acts share the same number, the ambiguous shorthand is left alone.
 */
function linkCitationsInMarkdown(replyText = '', chunks = [], lang = 'uz') {
  const reply = String(replyText || '');
  const selected = selectRelevantSourceRefs(chunks, extractAnalysisSection(reply));
  if (!reply || selected.length === 0) return reply;

  const byArticle = new Map();
  for (const record of selected) {
    const ref = normalizeArticleRef(record.articleRef);
    if (!ref) continue;
    if (!byArticle.has(ref)) byArticle.set(ref, []);
    byArticle.get(ref).push(record);
  }

  const records = Array.from(byArticle.entries())
    .filter(([, items]) => new Set(items.map(item => item.key.split('|')[0])).size === 1)
    .map(([ref, items]) => ({ ref, record: items[0] }))
    .sort((a, b) => b.ref.length - a.ref.length);
  if (records.length === 0) return reply;

  // Preserve links that are already present (including a cached response).
  const protectedParts = reply.split(/(\[[^\]]+\]\([^)]+\))/gu);
  return protectedParts.map((part, index) => {
    if (index % 2 === 1) return part;
    let output = part;
    for (const { ref, record } of records) {
      const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(
        `(^|[^\\p{L}\\p{N}])(` +
        `${escaped}(?!\\d)\\s*[-\u2013\u2014]?\\s*modda[\\p{L}'\u2019]*` +
        `(?:\\s*,?\\s*(\\d+)(?:\\s*[-\u2013\u2014]\\s*\\d+)?\\s*[-\u2013\u2014]?\\s*qism[\\p{L}'\u2019]*)?` +
        `)`,
        'giu'
      );
      output = output.replace(rx, (match, prefix, citation, partNumber) => {
        const url = buildLexDeepLink(record.chunk, {
          lang,
          articleRef: record.ref,
          partNumber: partNumber || '',
        });
        return url ? `${prefix}[${citation}](${url})` : match;
      });
    }
    return output;
  }).join('');
}

module.exports = {
  extractAnalysisSection,
  extractArticleRefsFromText,
  getChunkArticleRefs,
  normalizeArticleRef,
  normalizeLawName,
  getLawNameAliases,
  selectRelevantSourceRefs,
  findCitationPartNumber,
  buildLexDeepLink,
  linkCitationsInMarkdown,
};
