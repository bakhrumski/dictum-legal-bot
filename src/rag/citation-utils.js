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
  const rx = new RegExp(`\\b${base}(?!\\d)(?:[-\\s]?\\d+)?[-\\s]?(?:modda|moddasi|moddaning|band|bandi|bandining|модда|моддаси|статья|статьи|ст\\.)`, 'giu');
  const out = [];
  let match;
  while ((match = rx.exec(String(text || ''))) !== null) out.push(match.index);

  // Grouped citations are common in Uzbek drafting: "4, 18 va 24-moddalar"
  // or "283–289-moddalar". The old matcher saw only the final number, which
  // meant selectRelevantSourceRefs() could not associate the full citation
  // with its retrieved law and none of the provisions became links.
  const grouped = /(\d+(?:\s*[-–—]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–—]\s*\d+)?)*(?:\s+(?:va|hamda)\s+\d+(?:\s*[-–—]\s*\d+)?)?)\s*[-–—]?\s*(?:modda|band)lar[\p{L}'’]*/giu;
  while ((match = grouped.exec(String(text || ''))) !== null) {
    if (expandArticleExpression(match[1]).includes(normalizedRef)) out.push(match.index);
  }
  return unique(out);
}

function expandArticleExpression(value = '') {
  const refs = [];
  const rx = /(\d+)(?:\s*[-–—]\s*(\d+))?/gu;
  let match;
  while ((match = rx.exec(String(value || ''))) !== null) {
    const start = Number.parseInt(match[1], 10);
    const end = match[2] ? Number.parseInt(match[2], 10) : start;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end >= start && end - start <= 30) {
      for (let ref = start; ref <= end; ref++) refs.push(String(ref));
    } else {
      refs.push(String(start));
      if (end !== start) refs.push(String(end));
    }
  }
  return unique(refs);
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
    // Some corpus rows keep the article heading and its first qism on the
    // same line. Remove only the heading so the legal sentence remains usable
    // as an exact browser Text Fragment instead of discarding the whole row.
    .map(line => partNumber ? line : (line.replace(
      /^\d+[\u2070\u00B9\u00B2\u00B3\u2074-\u2079]*\s*[-\u2013\u2014]?\s*(?:modda|\u043C\u043E\u0434\u0434\u0430)[\p{L}'\u2019]*\s*[.:\-\u2013\u2014]?\s*/iu,
      ''
    ).trim() || line))
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
 * When exact provision text is available, combine Lex.uz's stable element id
 * with a standards-based Text Fragment. The stable id supplies a reliable
 * scroll target; Chromium-compatible browsers additionally highlight the
 * exact sentence. Existing corpus rows without an id use the same Text
 * Fragment directly, so highlighting works without a corpus rebuild.
 */
function buildLexDeepLink(chunk = {}, opts = {}) {
  const baseUrl = normalizeLexSourceUrl(chunk.source_url || chunk.sourceUrl || '', opts.lang || 'uz');
  if (!baseUrl) return '';

  const requestedPart = normalizePartNumber(opts.partNumber);
  const chunkPart = normalizePartNumber(chunk.part_number || chunk.partNumber);
  const articleRef = normalizeArticleRef(opts.articleRef);
  const locatorType = String(opts.locatorType || 'modda').toLocaleLowerCase('uz') === 'band' ? 'band' : 'modda';
  let excerpt = '';
  if (requestedPart && chunk.parentText) {
    excerpt = excerptFromLines(chunk.parentText, requestedPart);
  }
  if (!excerpt) {
    excerpt = excerptFromLines(chunk.childText || chunk.chunk_text || chunk.parentText || '', '');
  }
  if (!excerpt && articleRef) excerpt = `${articleRef}-${locatorType}`;
  const highlightedUrl = (elementId = '') => {
    const anchor = /^-?\d+$/u.test(String(elementId || '')) ? String(elementId) : '';
    if (excerpt) return `${baseUrl}#${anchor}:~:text=${encodeURIComponent(excerpt)}`;
    return anchor ? `${baseUrl}#${anchor}` : baseUrl;
  };
  const resolvedAnchors = chunk.lex_anchor_ids || chunk.lexAnchorIds || {};
  const resolvedId = requestedPart
    ? resolvedAnchors[`${articleRef}:${requestedPart}`]
    : resolvedAnchors[articleRef];
  if (/^-?\d+$/u.test(String(resolvedId || ''))) {
    return highlightedUrl(resolvedId);
  }
  const elementId = String(
    chunk.lex_element_id || chunk.lexElementId ||
    (chunk.metadata && (chunk.metadata.lexElementId || chunk.metadata.lex_element_id)) || ''
  ).trim();

  // A child anchor is exact only when it represents the requested qism. An
  // article may contain several qism references in one answer.
  if (/^-?\d+$/u.test(elementId) && (!requestedPart || (chunkPart && requestedPart === chunkPart))) {
    return highlightedUrl(elementId);
  }
  return highlightedUrl();
}

function stripGeneratedSourceSections(value = '') {
  return String(value || '')
    .replace(
      /(?:^|\n)\s*(?:---\s*\n\s*)?(?:#{1,6}\s*)?(?:\*{0,2}|_{0,2})\s*(?:📎\s*)?(?:manbalar|sources)\s*(?:\*{0,2}|_{0,2})\s*:?\s*[\s\S]*$/iu,
      ''
    )
    .trim();
}

/** Remove raw/proxy Lex URLs. A legal source must be a named provision link. */
function stripRawLexAttributions(value = '') {
  return String(value || '')
    // Cached links from the old style are unwrapped, then relinked below with
    // the law name, article and qism in one canonical label.
    .replace(
      /\[([^\]]+)\]\((?:https?:\/\/(?:www\.)?lex\.uz\/(?:uz\/)?docs\/-?\d+[^)]*|\/api\/lex-anchor\?[^)]*)\)/giu,
      (whole, label) => {
        // Current cached answers already carry a verified exact deep link.
        // Preserve that canonical link when the cache row no longer includes
        // the original RAG chunks needed to reconstruct it.
        const plain = String(label || '').replace(/[*_]/gu, '').trim();
        const canonical = /\p{L}[\s\S]*\d+\s*[-–—]\s*(?:modda|band)\s*,\s*(?:\d+\s*[-–—]\s*qism|tegishli\s+(?:qism|band))/iu.test(plain);
        return canonical ? whole : label;
      }
    )
    // Remove standalone source-attribution lines and prose parentheses such
    // as "Manba: https://..." or "(lex.uz: [https://...](...))".
    .replace(/^\s*(?:manba|lex\.uz)\s*:\s*https?:\/\/(?:www\.)?lex\.uz\/\S+\s*$/gimu, '')
    .replace(/\s*\(\s*(?:\*{0,2})?lex\.uz(?:\*{0,2})?\s*:\s*(?:\[[^\]]*\]\([^)]*\)|https?:\/\/(?:www\.)?lex\.uz\/[^)\s]+)\s*\)/giu, '')
    .replace(/\s*(?:manba|lex\.uz)\s*:\s*(?:\[[^\]]*\]\([^)]*\)|https?:\/\/(?:www\.)?lex\.uz\/\S+)/giu, '')
    .replace(/(^|\s)https?:\/\/(?:www\.)?lex\.uz\/(?:uz\/)?docs\/-?\d+\S*/gimu, '$1')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function regexEscape(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function flexibleLawPattern(value = '') {
  return regexEscape(value)
    .replace(/\\ /gu, '\\s+')
    .replace(/[\u02bb\u02bc\u2018\u2019`']/gu, "['\\u02bb\\u02bc\\u2018\\u2019`]");
}

function canonicalLawLabel(value = '') {
  return String(value || '')
    .replace(/^O['\u02bb\u02bc\u2018\u2019`]zbekiston\s+Respublikasining\s+/iu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function lawNameVariants(value = '') {
  const display = canonicalLawLabel(value);
  const variants = unique([String(value || '').trim(), display]);
  const withoutTerminalI = display.replace(/\b(kodeks|qonun|nizom)i\b/giu, '$1');
  if (withoutTerminalI !== display) variants.push(withoutTerminalI);
  if (/to['\u02bb\u02bc\u2018\u2019`]?g['\u02bb\u02bc\u2018\u2019`]?risida$/iu.test(display)) {
    variants.push(`${display}gi Qonun`);
    variants.push(`${display}gi Qonuni`);
    variants.push(`${display} Qonuni`);
  }
  const vmq = display.match(/\bVMQ\s*-?\s*(\d+)\b/iu);
  if (vmq) {
    variants.push(`VMQ-${vmq[1]}`);
    variants.push(`${vmq[1]}-son qaror`);
  }
  const normalized = normalizeLawName(display);
  const abbreviations = {
    'mehnat kodeksi': 'MK',
    'fuqarolik kodeksi': 'FK',
    'oila kodeksi': 'OK',
    'jinoyat kodeksi': 'JK',
    'soliq kodeksi': 'SK',
    'jinoyat protsessual kodeksi': 'JPK',
    'fuqarolik protsessual kodeksi': 'FPK',
    'iqtisodiy protsessual kodeksi': 'IPK',
    'mamuriy javobgarlik togrisidagi kodeks': 'MJTK',
  };
  if (abbreviations[normalized]) variants.push(abbreviations[normalized]);
  return unique(variants).sort((a, b) => b.length - a.length);
}

function joinUzbekMarkdownLinks(links = []) {
  if (links.length <= 1) return links[0] || '';
  if (links.length === 2) return `${links[0]} va ${links[1]}`;
  return `${links.slice(0, -1).join(', ')} va ${links[links.length - 1]}`;
}

function linkGroupedCitationLists(value = '', records = [], lang = 'uz') {
  const groupedByLaw = new Map();
  for (const item of records) {
    const key = normalizeLawName(item.record.lawName);
    if (!groupedByLaw.has(key)) groupedByLaw.set(key, []);
    groupedByLaw.get(key).push(item);
  }

  let output = value;
  for (const items of groupedByLaw.values()) {
    if (items.length < 2) continue;
    const lawName = items[0].record.lawName;
    const lawPattern = lawNameVariants(lawName).map(flexibleLawPattern).join('|');
    if (!lawPattern) continue;
    const rx = new RegExp(
      `(^|[^\\p{L}\\p{N}])(?:\\*{0,2})?(` + lawPattern + `)(?:\\*{0,2})?` +
      `(?:ning)?\\s*,?\\s*(?:\\*{0,2})?` +
      `(\\d+(?:\\s*[-–—]\\s*\\d+)?(?:\\s*,\\s*\\d+(?:\\s*[-–—]\\s*\\d+)?)*(?:\\s+(?:va|hamda)\\s+\\d+(?:\\s*[-–—]\\s*\\d+)?)?)` +
      `\\s*[-–—]?\\s*(modda|band)lar[\\p{L}'’]*(?:\\*{0,2})?`,
      'giu'
    );
    output = output.replace(rx, (match, prefix, _matchedLaw, expression, locatorType) => {
      const mentionedRefs = expandArticleExpression(expression);
      const byRef = new Map(items.map(item => [item.ref, item.record]));
      // Never turn a partially grounded list into an authoritative-looking
      // citation. Every provision in the written list must exist in the
      // retrieved official source before the group is linked.
      if (!mentionedRefs.length || mentionedRefs.some(ref => !byRef.has(ref))) return match;
      const type = String(locatorType || 'modda').toLocaleLowerCase('uz');
      const links = mentionedRefs.map(ref => {
        const record = byRef.get(ref);
        const url = buildLexDeepLink(record.chunk, { lang, articleRef: ref, locatorType: type });
        if (!url) return '';
        const partLabel = type === 'band' ? 'tegishli band' : 'tegishli qism';
        return `[**${canonicalLawLabel(record.lawName)}, ${ref}-${type}, ${partLabel}**](${url})`;
      });
      if (links.some(link => !link)) return match;
      return prefix + joinUzbekMarkdownLinks(links);
    });
  }
  return output;
}

function grammaticalCitationTail(value = '') {
  const normalized = String(value || '').replace(/[*_]/gu, '');
  const matches = Array.from(normalized.matchAll(/(?:(?:modda|band)(?:si)?|qism(?:i)?)(ning|dan|ga|da)\b/giu));
  return matches.length ? matches[matches.length - 1][1].toLocaleLowerCase('uz') : '';
}

/**
 * Link grounded inline article references in a Markdown answer. We process
 * only article numbers that identify one selected law in this answer; if two
 * cited acts share the same number, the ambiguous shorthand is left alone.
 */
function linkCitationsInMarkdown(replyText = '', chunks = [], lang = 'uz') {
  const reply = stripRawLexAttributions(stripGeneratedSourceSections(replyText));
  // Every grounded provision written anywhere in the answer must behave like
  // a source link. Previously only the Tahlil section was inspected, leaving
  // the same verified law plain in Huquqiy asos and Xulosa.
  const selected = selectRelevantSourceRefs(chunks, reply);
  if (!reply || selected.length === 0) return reply;

  const records = selected
    .map(record => ({ ref: normalizeArticleRef(record.articleRef), record }))
    .filter(item => item.ref)
    .sort((a, b) => b.ref.length - a.ref.length);
  if (records.length === 0) return reply;

  // Preserve unrelated Markdown links. Lex links were deliberately unwrapped
  // above so even cached old-style citations receive the canonical label.
  const protectedParts = reply.split(/(\[[^\]]+\]\([^)]+\))/gu);
  return protectedParts.map((part, index) => {
    if (index % 2 === 1) return part;
    let output = part;
    for (const { ref, record } of records) {
      const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const lawPattern = lawNameVariants(record.lawName)
        .map(flexibleLawPattern)
        .join('|');
      if (!lawPattern) continue;
      const rx = new RegExp(
        `(^|[^\\p{L}\\p{N}])(?:\\*{0,2})?(` + lawPattern + `)(?:\\*{0,2})?` +
        `(?:ning)?\\s*,?\\s*(?:\\*{0,2})?(` +
        `${escaped}(?!\\d)\\s*[-\u2013\u2014]?\\s*(modda|band)[\\p{L}'\u2019]*` +
        `(?:\\s*,?\\s*(?:\\*{0,2})?(?:(\\d+)(?:\\s*[-\u2013\u2014]\\s*\\d+)?\\s*[-\u2013\u2014]?\\s*qism[\\p{L}'\u2019]*|tegishli\\s+(?:qism|band))(?:(?:\\*{0,2}))?)?` +
        `)(?:\\*{0,2})?`,
        'giu'
      );
      output = output.replace(rx, (match, prefix, _lawName, citation, locatorType, partNumber) => {
        const url = buildLexDeepLink(record.chunk, {
          lang,
          articleRef: ref,
          partNumber: partNumber || '',
          locatorType,
        });
        if (!url) return match;
        const type = String(locatorType || 'modda').toLocaleLowerCase('uz');
        const partLabel = partNumber
          ? `${partNumber}-qism`
          : (type === 'band' ? 'tegishli band' : 'tegishli qism');
        const label = `${canonicalLawLabel(record.lawName)}, ${ref}-${type}, ${partLabel}`;
        const tail = grammaticalCitationTail(citation);
        return `${prefix}[**${label}**](${url})${tail}`;
      });
    }
    return linkGroupedCitationLists(output, records, lang);
  }).join('');
}

function normalizeLegalAnswerCitations(replyText = '', chunks = [], lang = 'uz') {
  return linkCitationsInMarkdown(
    stripRawLexAttributions(stripGeneratedSourceSections(replyText)),
    chunks,
    lang
  );
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
  stripGeneratedSourceSections,
  stripRawLexAttributions,
  linkCitationsInMarkdown,
  normalizeLegalAnswerCitations,
};
