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
    const lawAliases = getLawNameAliases(lawName);
    if (lawAliases.length === 0) continue;
    const identifier = getChunkDocumentIdentifier(chunk);
    const aliases = unique([
      ...lawAliases,
      ...documentIdentifierVariants(identifier).map(normalizeLawName),
    ]).sort((a, b) => b.length - a.length);
    records.push({
      chunk,
      lawName,
      lawKey: lawAliases[lawAliases.length - 1],
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

/** Canonical key used only to match the same Lex document across /docs and /uz/docs URLs. */
function lexDocumentIdentity(value = '') {
  return stripFragment(value)
    .split('?')[0]
    .replace(/https:\/\/(?:www\.)?lex\.uz\/(?:uz\/|ru\/)?docs\//iu, 'https://lex.uz/docs/')
    .trim();
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
  const articleRef = normalizeArticleRef(opts.articleRef);
  const resolvedAnchors = chunk.lex_anchor_ids || chunk.lexAnchorIds || {};
  const resolvedId = requestedPart
    ? resolvedAnchors[`${articleRef}:${requestedPart}`]
    : resolvedAnchors[articleRef];
  if (/^-?\d+$/u.test(String(resolvedId || ''))) {
    return `${baseUrl}#${resolvedId}`;
  }
  const elementId = String(
    chunk.lex_element_id || chunk.lexElementId ||
    (chunk.metadata && (chunk.metadata.lexElementId || chunk.metadata.lex_element_id)) || ''
  ).trim();

  // A child anchor is exact only when it represents the requested qism. An
  // article may contain several qism references in one answer.
  if (/^-?\d+$/u.test(elementId) && (!requestedPart || (chunkPart && requestedPart === chunkPart))) {
    return `${baseUrl}#${elementId}`;
  }

  let excerpt = '';
  if (requestedPart && chunk.parentText) {
    excerpt = excerptFromLines(chunk.parentText, requestedPart);
  }
  if (!excerpt) {
    excerpt = excerptFromLines(chunk.childText || chunk.chunk_text || chunk.parentText || '', '');
  }
  if (!excerpt && articleRef) excerpt = `${articleRef}-modda`;
  return excerpt ? `${baseUrl}#:~:text=${encodeURIComponent(excerpt)}` : baseUrl;
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
    // the law name, public act identifier, article and qism in one canonical
    // label. A current canonical root link is also valid when no individual
    // provision was asserted, so preserve it instead of relinking its title
    // and identifier as two separate mentions.
    .replace(
      /\[([^\]]+)\]\((?:https?:\/\/(?:www\.)?lex\.uz\/(?:uz\/)?docs\/-?\d+[^)]*|\/api\/lex-anchor\?[^)]*)\)/giu,
      (whole, label) => {
        // Current cached answers already carry a verified exact deep link.
        // Preserve that canonical link when the cache row no longer includes
        // the original RAG chunks needed to reconstruct it.
        const plain = String(label || '').replace(/[*_]/gu, '').trim();
        const canonicalProvision = /\p{L}[\s\S]*\d+\s*[-–—]\s*(?:modda|band)\s*,\s*(?:\d+\s*[-–—]\s*qism|tegishli\s+(?:qism|band))/iu.test(plain);
        const canonicalAct = /\p{L}[\s\S]*\((?:O['\u02bb\u02bc\u2018\u2019`]?RQ|PQ|PF|VMQ)-\d+(?:-[IVXLCDM]+)?\)/iu.test(plain);
        return canonicalProvision || canonicalAct ? whole : label;
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

const OFFICIAL_ACT_PREFIXES = Object.freeze({
  pq: 'PQ', 'пқ': 'PQ', 'пп': 'PQ',
  pf: 'PF', 'пф': 'PF', 'уп': 'PF',
  vmq: 'VMQ', vm: 'VMQ', 'вмқ': 'VMQ', 'вм': 'VMQ', 'пкм': 'VMQ',
  orq: "O'RQ", 'ўрқ': "O'RQ", 'зру': "O'RQ",
});

function canonicalOfficialPrefix(value = '') {
  const key = String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('uz')
    .replace(/[\u02bb\u02bc\u2018\u2019`']/gu, '')
    .replace(/\s+/gu, '');
  return OFFICIAL_ACT_PREFIXES[key] || '';
}

function explicitOfficialDocumentIdentifier(value = '') {
  const match = String(value || '').match(
    /(?<![\p{L}\p{N}])(PQ|PF|VMQ|VM|O['`\u2018\u2019\u02bb]?RQ|ПҚ|ПП|ПФ|УП|ВМҚ|ВМ|ПКМ|ЎРҚ|ЗРУ)\s*[-\u2013\u2014]?\s*(\d{1,6}(?:-[IVXLCDM]+)?)/iu
  );
  if (!match) return '';
  const prefix = canonicalOfficialPrefix(match[1]);
  return prefix ? `${prefix}-${match[2].toUpperCase()}` : '';
}

function inferOfficialPrefix(context = '') {
  const text = String(context || '');
  if (/(?:Vazirlar\s+Mahkamasi|Вазирлар\s+Маҳкамаси|Кабинета\s+Министров).*?(?:qaror|қарор|постановлен)/iu.test(text)) return 'VMQ';
  if (/(?:Prezident|Президент).*?(?:farmon|фармон|указ)/iu.test(text)) return 'PF';
  if (/(?:Prezident|Президент).*?(?:qaror|қарор|постановлен)/iu.test(text)) return 'PQ';
  if (/(?:O['`\u2018\u2019\u02bb]?zbekiston\s+Respublikasining\s+Qonuni|Ўзбекистон\s+Республикасининг\s+Қонуни|Закон\s+Республики\s+Узбекистан)/iu.test(text)) return "O'RQ";
  return '';
}

/** Normalize official identifiers to the public Uzbek-Latin citation form. */
function normalizeOfficialDocumentIdentifier(value = '', context = '') {
  if (value && typeof value === 'object') {
    const prefix = canonicalOfficialPrefix(value.prefix);
    const number = String(value.number || '').match(/\d{1,6}(?:-[IVXLCDM]+)?/iu);
    if (prefix && number) return `${prefix}-${number[0].toUpperCase()}`;
  }

  const explicit = explicitOfficialDocumentIdentifier(value) || explicitOfficialDocumentIdentifier(context);
  if (explicit) return explicit;

  const raw = String(value || '').trim().replace(/^(?:№|N)\s*/iu, '').replace(/-son$/iu, '');
  const number = raw.match(/^\d{1,6}(?:-[IVXLCDM]+)?$/iu);
  if (!number) return raw;
  // Historical law numbers such as 349-I are official as written; adding a
  // modern O'RQ prefix would be inaccurate.
  if (/-[IVXLCDM]+$/iu.test(number[0])) return number[0].toUpperCase();
  const inferredPrefix = inferOfficialPrefix(context);
  return inferredPrefix ? `${inferredPrefix}-${number[0]}` : number[0];
}

function getChunkDocumentIdentifier(chunk = {}) {
  const metadata = chunk.metadata || {};
  const context = [
    chunk.law_name || chunk.lawName,
    chunk.act_form || chunk.actForm,
    metadata.act_form || metadata.actForm,
    metadata.publication,
  ].filter(Boolean).join(' ');
  const own = chunk.ownDocumentNumber || chunk.own_document_number || metadata.ownDocumentNumber;
  if (own) {
    const normalizedOwn = normalizeOfficialDocumentIdentifier(own, context);
    if (normalizedOwn) return normalizedOwn;
  }
  return normalizeOfficialDocumentIdentifier(
    chunk.document_number || chunk.documentNumber || metadata.document_number || metadata.documentNumber || '',
    context
  );
}

function canonicalCitationActLabel(lawName = '', chunk = {}) {
  const display = canonicalLawLabel(lawName);
  const identifier = getChunkDocumentIdentifier(chunk);
  if (!identifier || normalizeLawName(display).includes(normalizeLawName(identifier))) return display;
  return `${display} (${identifier})`;
}

function documentIdentifierVariants(identifier = '') {
  const normalized = normalizeOfficialDocumentIdentifier(identifier);
  if (!normalized) return [];
  const match = normalized.match(/^(.+?)-(\d{1,6}(?:-[IVXLCDM]+)?)$/u);
  if (!match) return [normalized];
  const [, prefix, number] = match;
  const type = prefix === 'PF' ? 'farmon' : (prefix === "O'RQ" ? 'qonun' : 'qaror');
  return unique([normalized, `${normalized}-son`, `${normalized}-son ${type}`, `${number}-son ${type}`]);
}

function lawNameVariants(value = '', documentIdentifier = '') {
  const display = canonicalLawLabel(value);
  const variants = unique([
    String(value || '').trim(),
    display,
    ...documentIdentifierVariants(documentIdentifier),
  ]);
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
    const lawPattern = lawNameVariants(lawName, getChunkDocumentIdentifier(items[0].record.chunk))
      .map(flexibleLawPattern).join('|');
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
        const url = buildLexDeepLink(record.chunk, { lang, articleRef: ref });
        if (!url) return '';
        const partLabel = type === 'band' ? 'tegishli band' : 'tegishli qism';
        return `[**${canonicalCitationActLabel(record.lawName, record.chunk)}, ${ref}-${type}, ${partLabel}**](${url})`;
      });
      if (links.some(link => !link)) return match;
      return prefix + joinUzbekMarkdownLinks(links);
    });
  }
  return output;
}

function grammaticalCitationTail(value = '') {
  const normalized = String(value || '').replace(/[*_]/gu, '');
  const matches = Array.from(normalized.matchAll(/(?:modda(?:si)?|band(?:i)?|qism(?:i)?)(ning|dan|ga|da)\b/giu));
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
      const lawPattern = lawNameVariants(record.lawName, getChunkDocumentIdentifier(record.chunk))
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
        });
        if (!url) return match;
        const type = String(locatorType || 'modda').toLocaleLowerCase('uz');
        const partLabel = partNumber
          ? `${partNumber}-qism`
          : (type === 'band' ? 'tegishli band' : 'tegishli qism');
        const label = `${canonicalCitationActLabel(record.lawName, record.chunk)}, ${ref}-${type}, ${partLabel}`;
        const tail = grammaticalCitationTail(citation);
        return `${prefix}[**${label}**](${url})${tail}`;
      });
    }
    return linkGroupedCitationLists(output, records, lang);
  }).join('');
}

/**
 * Link a verified act name that the model mentioned without a provision.
 * Exact provision citations are already protected Markdown links at this
 * point; this fallback never invents an article and therefore links only to
 * the official document root.
 */
function linkRemainingGroundedActMentions(value = '', chunks = [], lang = 'uz') {
  const bySource = new Map();
  for (const chunk of chunks || []) {
    const lawName = chunk && (chunk.law_name || chunk.lawName);
    const sourceUrl = normalizeLexSourceUrl(chunk && (chunk.source_url || chunk.sourceUrl), lang);
    const sourceKey = lexDocumentIdentity(sourceUrl);
    if (!lawName || !sourceUrl || !sourceKey || bySource.has(sourceKey)) continue;
    bySource.set(sourceKey, { chunk, lawName, sourceUrl });
  }
  if (bySource.size === 0) return value;

  const protectedParts = String(value || '').split(/(\[[^\]]+\]\([^)]+\))/gu);
  return protectedParts.map((part, index) => {
    if (index % 2 === 1) return part;
    let output = part;
    for (const { chunk, lawName, sourceUrl } of bySource.values()) {
      const variants = lawNameVariants(lawName, getChunkDocumentIdentifier(chunk))
        .filter(variant => normalizeLawName(variant).length >= 5)
        .map(flexibleLawPattern)
        .join('|');
      if (!variants) continue;
      const rx = new RegExp(`(^|[^\\p{L}\\p{N}])(?:\\*{0,2}|[\u00ab»“”\"']{0,1})(${variants})(?:\\*{0,2}|[\u00ab»“”\"']{0,1})(?![\\p{L}\\p{N}])`, 'giu');
      output = output.replace(rx, (match, prefix) =>
        `${prefix}[**${canonicalCitationActLabel(lawName, chunk)}**](${sourceUrl})`
      );
    }
    return output;
  }).join('');
}

function upgradeLinkedCitationIdentifiers(value = '', chunks = [], lang = 'uz') {
  const bySource = new Map();
  for (const chunk of chunks || []) {
    const sourceUrl = normalizeLexSourceUrl(chunk && (chunk.source_url || chunk.sourceUrl), lang);
    const sourceKey = lexDocumentIdentity(sourceUrl);
    if (sourceKey && !bySource.has(sourceKey)) bySource.set(sourceKey, chunk);
  }
  if (bySource.size === 0) return value;
  return String(value || '').replace(
    /\[([^\]]+)\]\((https?:\/\/(?:www\.)?lex\.uz\/(?:uz\/)?docs\/-?\d+[^)]*)\)/giu,
    (whole, rawLabel, url) => {
      const chunk = bySource.get(lexDocumentIdentity(normalizeLexSourceUrl(url, lang)));
      if (!chunk) return whole;
      const identifier = getChunkDocumentIdentifier(chunk);
      if (!identifier || normalizeLawName(rawLabel).includes(normalizeLawName(identifier))) return whole;
      const locator = String(rawLabel).replace(/[*_]/gu, '').match(/,\s*\d+[\u2070\u00B9\u00B2\u00B3\u2074-\u2079]*\s*[-\u2013\u2014]\s*(?:modda|band)\b[\s\S]*$/iu);
      const label = canonicalCitationActLabel(chunk.law_name || chunk.lawName || '', chunk)
        + (locator ? locator[0] : '');
      return `[**${label}**](${url})`;
    }
  );
}

/**
 * Collapse two adjacent links to the same Lex.uz document when one is merely
 * the document root and the other identifies an exact article/band. Models
 * occasionally write both forms in a single citation, for example:
 *
 *   [Qaror (VMQ-428)](root)"gi [Qaror (VMQ-428), 3-band](deep)
 *
 * Keeping both is noisy and reads as though two authorities were cited. The
 * exact provision is the stronger citation, so retain only that link. A real
 * conjunction ("va", "hamda", etc.) is deliberately not treated as an
 * adjacent duplicate because it can connect two distinct propositions.
 */
function collapseDuplicateLexCitations(value = '') {
  let output = String(value || '');
  const lexLinkRx = /\[([^\]]+)\]\((https?:\/\/(?:www\.)?lex\.uz\/(?:uz\/|ru\/)?docs\/-?\d+[^)]*)\)/giu;
  const ignorableSeparator = /^\s*[\u00ab\u00bb\u201c\u201d"']?\s*(?:(?:gi|dagi|ning|ga|da|dan)\b)?\s*[,;:]?\s*$/iu;

  // A bounded loop handles a rare three-link sequence without risking an
  // accidental infinite rewrite if malformed Markdown reaches this layer.
  for (let pass = 0; pass < 4; pass++) {
    const matches = Array.from(output.matchAll(lexLinkRx));
    let replacement = null;
    for (let index = 0; index < matches.length - 1; index++) {
      const first = matches[index];
      const second = matches[index + 1];
      const firstStart = first.index;
      const firstEnd = firstStart + first[0].length;
      const secondStart = second.index;
      const secondEnd = secondStart + second[0].length;
      const separator = output.slice(firstEnd, secondStart);
      if (!ignorableSeparator.test(separator)) continue;
      if (lexDocumentIdentity(first[2]) !== lexDocumentIdentity(second[2])) continue;

      const isExact = (label, url) =>
        /(?:\d+[\u2070\u00b9\u00b2\u00b3\u2074-\u2079]*\s*[-\u2013\u2014]\s*(?:modda|band)|tegishli\s+(?:qism|band))/iu.test(
          String(label || '').replace(/[*_]/gu, '')
        ) || /(?:#|%23|:~:text=)/iu.test(String(url || ''));
      const firstExact = isExact(first[1], first[2]);
      const secondExact = isExact(second[1], second[2]);
      if (firstExact === secondExact) continue;

      replacement = {
        start: firstStart,
        end: secondEnd,
        text: firstExact ? first[0] : second[0],
      };
      break;
    }
    if (!replacement) break;
    output = output.slice(0, replacement.start) + replacement.text + output.slice(replacement.end);
  }
  return output;
}

function normalizeLegalAnswerCitations(replyText = '', chunks = [], lang = 'uz') {
  const linked = linkCitationsInMarkdown(
    stripRawLexAttributions(stripGeneratedSourceSections(replyText)),
    chunks,
    lang
  );
  return collapseDuplicateLexCitations(
    linkRemainingGroundedActMentions(
      upgradeLinkedCitationIdentifiers(linked, chunks, lang),
      chunks,
      lang
    )
  );
}

/**
 * Gate legacy/cached answer shortcuts. They may bypass the current prompt and
 * therefore are returned verbatim only when every Lex link already carries a
 * canonical public act identifier and no plain identifier/provision remains.
 */
function hasCanonicalOfficialCitations(value = '') {
  const text = String(value || '');
  const links = Array.from(text.matchAll(
    /\[([^\]]+)\]\((https?:\/\/(?:www\.)?lex\.uz\/(?:uz\/|ru\/)?docs\/-?\d+[^)]*)\)/giu
  ));
  if (links.length === 0) return false;
  const officialLabel = /\((?:O['\u02bb\u02bc\u2018\u2019`]?RQ|PQ|PF|VMQ)-\d+(?:-[IVXLCDM]+)?\)|\(\d+-[IVXLCDM]+\)/iu;
  if (links.some(match => !officialLabel.test(String(match[1] || '').replace(/[*_]/gu, '')))) return false;

  const withoutLinks = text.replace(/\[[^\]]+\]\([^)]+\)/gu, ' ');
  return !/(?:O['\u02bb\u02bc\u2018\u2019`]?RQ|PQ|PF|VMQ)\s*-\s*\d+|\b\d+\s*[-\u2013\u2014]?\s*(?:modda|band)\b/iu.test(withoutLinks);
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
  normalizeOfficialDocumentIdentifier,
  getChunkDocumentIdentifier,
  canonicalCitationActLabel,
  linkCitationsInMarkdown,
  linkRemainingGroundedActMentions,
  collapseDuplicateLexCitations,
  normalizeLegalAnswerCitations,
  hasCanonicalOfficialCitations,
};
