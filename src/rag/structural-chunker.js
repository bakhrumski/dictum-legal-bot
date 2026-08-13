'use strict';

/**
 * Structural Legal Document Chunker v2
 *
 * Unlike the original chunker.js (which splits plain text by regex),
 * this module works on the PARSED structure from fetch-lex.js HTML.
 *
 * Architecture:
 *   HTML → parseLexStructured() → Article[] → chunkByArticle() → LegalChunk[]
 *
 * Each chunk preserves:
 *   - Exact article number (including prim: 4¹, 12²)
 *   - Part/clause breakdown (qism/band)
 *   - Parent document context (chapter, section)
 *   - List items from <ul>/<ol> as structured text
 *   - Cross-reference metadata
 *
 * Parent-Child Model:
 *   PARENT = full article text (stored for context retrieval)
 *   CHILD  = individual parts/clauses (stored for precise matching)
 *   When a child matches, we retrieve both child + parent for LLM context
 */

const cheerio = require('cheerio');

// ========== CONSTANTS ==========

/** Max chars for a child chunk (one part/clause). ~200 tokens */
const CHILD_MAX_CHARS = 800;

/** Max chars for a parent chunk (full article). ~800 tokens */
const PARENT_MAX_CHARS = 3200;

/** Superscript digit mapping */
const SUPER_DIGITS = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹'
};

// ========== ARTICLE PATTERN (Uzbek + Russian, with prim support) ==========

/**
 * Matches article headers like:
 *   "4-modda."  "4¹-modda."  "12²-modda."  "Статья 4."  "Статья 4¹."
 *
 * Captures:
 *   group 1: base number (e.g. "4")
 *   group 2: prim/superscript (e.g. "¹" or "1" from <sup>)
 *   group 3: suffix text after "modda" or "Статья N"
 */
// lex.uz /uz/docs/ pages serve Uzbek in CYRILLIC script ("модда", not
// "modda") — both scripts must be accepted or every article number comes
// out empty and citations break corpus-wide.
const ARTICLE_HEADER_RX = /^(\d+)([⁰¹²³⁴⁵⁶⁷⁸⁹]+)?[\s-]*(?:-?\s*)?(?:modda|модда)[\s.:]/im;
const ARTICLE_HEADER_RU = /^Статья\s+(\d+)([⁰¹²³⁴⁵⁶⁷⁸⁹]+)?/im;

/** Part/clause patterns within an article body */
const PART_PATTERN = /^(\d+)[\s-]*(?:-?\s*)?(?:qism|қисм|часть)/im;
const CLAUSE_PATTERN = /^(\d+)\)\s/m;
const BAND_PATTERN = /^([a-z\u0430-\u044F])\)\s/m;

/** Chapter/section patterns */
const CHAPTER_RX = /^(\d+|[IVXLC]+)[\s-]*(?:-?\s*)?(?:bob|боб)[\s.:]/im;
const CHAPTER_RU = /^ГЛАВА\s+([IVXLC\d]+)/im;
const SECTION_RX = /^(\d+|[IVXLC]+)[\s-]*(?:-?\s*)?(?:bo['']lim|бўлим)[\s.:]/im;
const SECTION_RU = /^(?:РАЗДЕЛ|ЧАСТЬ)\s+([IVXLC\d]+)/im;

// ========== HTML → STRUCTURED PARSE ==========

/**
 * @typedef {Object} ParsedArticle
 * @property {string} articleNumber    - e.g. "4¹" or "12"
 * @property {string} articleTitle     - full header text
 * @property {string} fullText         - complete article text (parent)
 * @property {ParsedPart[]} parts      - individual parts/clauses (children)
 * @property {string} chapter          - parent chapter name
 * @property {string} section          - parent section name
 * @property {string[]} references     - cross-referenced article numbers
 * @property {string} lexElementId     - stable Lex.uz DOM anchor for the article
 */

/**
 * @typedef {Object} ParsedPart
 * @property {string} partNumber       - e.g. "1", "2", "a)"
 * @property {string} partType         - "qism" | "band" | "clause" | "paragraph"
 * @property {string} text             - part text content
 * @property {string[]} listItems      - items from <ul>/<ol> if present
 * @property {string} lexElementId     - stable Lex.uz DOM anchor for this part
 */

/**
 * @typedef {Object} LegalChunk
 * @property {string} text             - chunk text content
 * @property {string} chunkType        - "parent" | "child"
 * @property {string|null} parentId    - null for parent, parent's articleNumber for child
 * @property {Object} metadata
 * @property {string} metadata.articleNumber
 * @property {string} metadata.articleTitle
 * @property {string} metadata.partNumber
 * @property {string} metadata.partType
 * @property {string} metadata.chapter
 * @property {string} metadata.section
 * @property {string[]} metadata.references
 * @property {string} metadata.law_name
 * @property {string} metadata.doc_id
 * @property {string} metadata.source_url
 * @property {string} metadata.category
 */

/**
 * Convert <sup> tags to Unicode superscript digits in a cheerio element.
 * Must be called BEFORE .text() extraction.
 */
function convertSuperscripts($, el) {
  $(el).find('sup').each((_, sup) => {
    const supText = $(sup).text().trim();
    const converted = supText.split('').map(c => SUPER_DIGITS[c] || c).join('');
    $(sup).replaceWith(converted);
  });
}

/**
 * Extract structured list items from <ul> and <ol> elements.
 * Returns array of strings preserving list numbering.
 */
function extractListItems($, el) {
  const items = [];
  $(el).find('ul > li, ol > li').each((i, li) => {
    const text = cleanText($(li).text());
    if (text) {
      // Check if parent is <ol> (numbered) or <ul> (bulleted)
      const parentTag = $(li).parent().get(0).tagName;
      const prefix = parentTag === 'ol' ? `${i + 1}) ` : '- ';
      items.push(prefix + text);
    }
  });
  return items;
}

/**
 * Parse lex.uz HTML into structured articles.
 *
 * @param {string} html - raw HTML from lex.uz
 * @param {string} sourceUrl - document URL
 * @returns {{ title: string, articles: ParsedArticle[], metadata: Object }}
 */
function parseLexStructured(html, sourceUrl) {
  const $ = cheerio.load(html);
  const articles = [];
  let title = '';
  const metadata = { source_url: sourceUrl };

  // Extract document title
  const titleEl = $('div.ACT_TITLE a[id]').add($('div.ACT_TITLE > div[id]')).first();
  if (titleEl.length > 0) {
    convertSuperscripts($, titleEl);
    title = cleanText(titleEl.text());
  }

  // Publication metadata
  const pubEl = $('div.PUBLICATION_ORIGIN a[id]').add($('div.PUBLICATION_ORIGIN > div[id]')).first();
  if (pubEl.length > 0) {
    metadata.publication = cleanText(pubEl.text());
  }

  // ── State machine for parsing ──
  let currentChapter = '';
  let currentSection = '';
  let currentArticle = null;
  let bodyBuffer = [];
  let bodyElements = [];

  function flushArticle() {
    if (!currentArticle) return;

    currentArticle.fullText = bodyBuffer.join('\n').trim();
    let parsedParts = splitIntoParts(currentArticle.fullText);

    // Lex.uz assigns a stable id to every ACT_TEXT paragraph. Uzbek statutes
    // commonly express qismlar as consecutive paragraphs without printing
    // "1-qism", "2-qism" in the body. Preserve that structure explicitly so
    // citations can land on the exact qism rather than merely the article.
    if (bodyElements.length > 0 && parsedParts.length <= 1) {
      parsedParts = bodyElements.map((entry, index) => ({
        partNumber: String(index + 1),
        partType: 'qism',
        text: entry.text,
        listItems: entry.listItems || [],
        lexElementId: entry.lexElementId || '',
      }));
    } else if (bodyElements.length > 0) {
      // Explicitly numbered clauses were split from the combined text. Match
      // each one back to its originating Lex.uz element id.
      for (const part of parsedParts) {
        const needle = cleanText(part.text).slice(0, 80);
        const match = bodyElements.find(entry => {
          const haystack = cleanText(entry.text);
          return needle && (haystack.includes(needle) || needle.includes(haystack.slice(0, 80)));
        });
        part.lexElementId = match ? match.lexElementId : '';
      }
    }
    currentArticle.parts = parsedParts;
    currentArticle.references = extractReferences(currentArticle.fullText);
    articles.push(currentArticle);
    bodyBuffer = [];
    bodyElements = [];
    currentArticle = null;
  }

  const contentDivs = $('#divCont > div.lx_elem');

  contentDivs.each((_, el) => {
    const $el = $(el);
    const classes = $el.attr('class') || '';

    // Skip irrelevant elements
    if (classes.includes('COMMENT') || classes.includes('INDEXES_ON_REF') ||
        classes.includes('CHANGES_ORIGINS') || classes.includes('ACT_FORM') ||
        classes.includes('PUBLICATION_ORIGIN') || classes.includes('ACT_TITLE')) {
      return;
    }

    const anchor = $el.find('> a[id]').length ? $el.find('> a[id]') : $el.find('> div[id]');
    if (anchor.length === 0) return;

    // Convert superscripts before text extraction
    convertSuperscripts($, anchor);

    // Extract list items BEFORE converting to plain text
    const listItems = extractListItems($, anchor);

    const text = cleanText(anchor.text());
    if (!text) return;

    // ── Chapter header ──
    if (classes.includes('TEXT_HEADER_DEFAULT')) {
      flushArticle();

      if (CHAPTER_RX.test(text) || CHAPTER_RU.test(text)) {
        currentChapter = text;
      } else if (SECTION_RX.test(text) || SECTION_RU.test(text)) {
        currentSection = text;
      } else {
        // Generic header — could be a chapter-level heading
        if (text.length < 200) currentChapter = text;
      }
      return;
    }

    // ── Article header (CLAUSE_DEFAULT) ──
    if (classes.includes('CLAUSE_DEFAULT')) {
      flushArticle();

      const artMatch = text.match(ARTICLE_HEADER_RX) || text.match(ARTICLE_HEADER_RU);
      const baseNum = artMatch ? artMatch[1] : '';
      const primNum = artMatch ? (artMatch[2] || '') : '';
      const articleNumber = baseNum + primNum; // e.g. "4¹"

      currentArticle = {
        articleNumber,
        articleTitle: text,
        lexElementId: String(anchor.attr('id') || ''),
        fullText: '',
        parts: [],
        chapter: currentChapter,
        section: currentSection,
        references: [],
      };
      return;
    }

    // ── Body text (ACT_TEXT) ──
    if (classes.includes('ACT_TEXT')) {
      const bodyText = listItems.length > 0 ? listItems.join('\n') : text;
      bodyElements.push({
        text: bodyText,
        listItems,
        lexElementId: String(anchor.attr('id') || ''),
      });
      if (listItems.length > 0) {
        bodyBuffer.push(bodyText);
      } else {
        bodyBuffer.push(bodyText);
      }
      return;
    }

    // ── Footnote ──
    if (classes.includes('FOOTNOTE')) {
      bodyBuffer.push(`[Izoh: ${text}]`);
      return;
    }

    // ── Separator ──
    if (classes.includes('BY_DEFAULT') && text.length > 2) {
      bodyBuffer.push(text);
    }
  });

  // Flush last article
  flushArticle();

  console.log(`[STRUCT-CHUNKER] Parsed "${title}": ${articles.length} articles`);
  return { title, articles, metadata };
}

/**
 * Split article body text into parts (qism) and clauses (band).
 *
 * Uzbek legal structure:
 *   Article (modda) → Parts (qism, numbered: 1, 2, 3...)
 *                   → Clauses within parts (band, lettered: a), b), c)...)
 *                   → Points (numbered: 1), 2), 3)...)
 *
 * @param {string} bodyText - full article body
 * @returns {ParsedPart[]}
 */
function splitIntoParts(bodyText) {
  if (!bodyText) return [];

  const lines = bodyText.split('\n');
  const parts = [];
  let currentPart = null;
  let buffer = [];

  function flushPart() {
    if (currentPart) {
      currentPart.text = buffer.join('\n').trim();
      if (currentPart.text) parts.push(currentPart);
    } else if (buffer.length > 0) {
      // Text before any numbered part — treat as preamble (part "0")
      const text = buffer.join('\n').trim();
      if (text) {
        parts.push({ partNumber: '0', partType: 'preamble', text, listItems: [] });
      }
    }
    buffer = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for numbered part start: "Mehnat shartnomasida quyidagilar..." or just "1. ..."
    // Uzbek legal docs use implicit parts — paragraphs starting with ordinal context
    const partMatch = trimmed.match(/^(\d+)[\.\)]\s+/);

    if (partMatch && parseInt(partMatch[1]) <= 30) {
      // Only treat as a new part if it looks like a legal clause number (1-30)
      const num = partMatch[1];

      // Heuristic: if current part was also a small number, this is likely a sibling
      if (currentPart && parseInt(currentPart.partNumber) < parseInt(num)) {
        flushPart();
        currentPart = {
          partNumber: num,
          partType: 'clause',
          text: '',
          listItems: [],
        };
        buffer.push(trimmed);
        continue;
      } else if (!currentPart) {
        flushPart();
        currentPart = {
          partNumber: num,
          partType: 'clause',
          text: '',
          listItems: [],
        };
        buffer.push(trimmed);
        continue;
      }
    }

    // Check for lettered sub-clause: "a) ...", "б) ..."
    const bandMatch = trimmed.match(/^([a-z\u0430-\u044F])\)\s/);
    if (bandMatch && currentPart) {
      // Sub-clause within current part — just append
      buffer.push(trimmed);
      currentPart.listItems.push(trimmed);
      continue;
    }

    // Check for list items (from <ul>/<ol> extraction)
    if (trimmed.startsWith('- ') || /^\d+\)\s/.test(trimmed)) {
      buffer.push(trimmed);
      if (currentPart) currentPart.listItems.push(trimmed);
      continue;
    }

    buffer.push(trimmed);
  }

  flushPart();
  return parts;
}

/**
 * Extract cross-references to other articles from text.
 * Finds patterns like "4¹-moddaga", "100-moddaning 2-qismiga"
 */
function extractReferences(text) {
  const refs = new Set();
  const patterns = [
    /(\d+[⁰¹²³⁴⁵⁶⁷⁸⁹]*)-(?:modda|модда)/gi,
    /Статья\s+(\d+[⁰¹²³⁴⁵⁶⁷⁸⁹]*)/gi,
  ];

  for (const rx of patterns) {
    let m;
    while ((m = rx.exec(text)) !== null) {
      refs.add(m[1]);
    }
  }

  return Array.from(refs);
}

// ========== STRUCTURAL CHUNKING ==========

/**
 * Generate parent + child chunks from parsed articles.
 *
 * @param {ParsedArticle[]} articles - from parseLexStructured()
 * @param {Object} docMeta - { law_name, doc_id, source_url, category }
 * @returns {LegalChunk[]}
 */
function chunkByArticle(articles, docMeta = {}) {
  const chunks = [];

  for (const article of articles) {
    const parentId = `${docMeta.doc_id || 'doc'}_art_${article.articleNumber}`;

    // ── PARENT CHUNK: full article ──
    const parentText = buildParentText(article);

    if (parentText.length > 0) {
      chunks.push({
        text: parentText.substring(0, PARENT_MAX_CHARS),
        chunkType: 'parent',
        parentId: null,
        metadata: {
          ...docMeta,
          chunkId: parentId,
          articleNumber: article.articleNumber,
          articleTitle: article.articleTitle,
          partNumber: null,
          partType: 'article',
          lexElementId: article.lexElementId || '',
          chapter: article.chapter,
          section: article.section,
          references: article.references,
        },
      });
    }

    // ── CHILD CHUNKS: individual parts/clauses ──
    if (article.parts.length > 0) {
      for (const part of article.parts) {
        if (part.partType === 'preamble' && part.text.length < 50) continue;

        const childText = buildChildText(article, part);
        if (childText.length < 20) continue;

        chunks.push({
          text: childText.substring(0, CHILD_MAX_CHARS),
          chunkType: 'child',
          parentId,
          metadata: {
            ...docMeta,
            chunkId: `${parentId}_p${part.partNumber}`,
            articleNumber: article.articleNumber,
            articleTitle: article.articleTitle,
            partNumber: part.partNumber,
            partType: part.partType,
            lexElementId: part.lexElementId || article.lexElementId || '',
            chapter: article.chapter,
            section: article.section,
            references: article.references,
          },
        });
      }
    }
    // If article has only 1 part or 0 parts, the parent chunk is sufficient
  }

  console.log(`[STRUCT-CHUNKER] ${articles.length} articles → ${chunks.length} chunks (${chunks.filter(c => c.chunkType === 'parent').length} parents, ${chunks.filter(c => c.chunkType === 'child').length} children)`);
  return chunks;
}

/**
 * Build parent chunk text with full article context.
 */
function buildParentText(article) {
  const header = [
    article.chapter ? `[${article.chapter}]` : '',
    article.articleTitle,
  ].filter(Boolean).join('\n');

  return `${header}\n${article.fullText}`;
}

/**
 * Build child chunk text with article context prefix.
 */
function buildChildText(article, part) {
  const context = [
    article.articleTitle,
    part.partNumber !== '0' ? `${part.partNumber}-qism:` : '',
  ].filter(Boolean).join(' — ');

  return `${context}\n${part.text}`;
}

// ========== MAIN ENTRY POINT ==========

/**
 * Full pipeline: HTML → structured parse → parent/child chunks.
 *
 * Drop-in replacement for chunkLegalDocument() that preserves
 * the same interface but produces richer output.
 *
 * @param {string} html - raw HTML from lex.uz (or plain text)
 * @param {Object} docMeta - { law_name, doc_id, source_url, category }
 * @param {Object} opts
 * @param {boolean} opts.isHtml - true if input is raw HTML (default: auto-detect)
 * @returns {LegalChunk[]}
 */
function chunkLegalDocumentStructured(html, docMeta = {}, opts = {}) {
  const isHtml = opts.isHtml !== undefined
    ? opts.isHtml
    : (html.includes('<div') || html.includes('<a ') || html.includes('<!DOCTYPE'));

  if (isHtml) {
    // Full structural parse from HTML
    const parsed = parseLexStructured(html, docMeta.source_url || '');

    if (parsed.articles.length === 0) {
      console.warn('[STRUCT-CHUNKER] No articles found in HTML, falling back to legacy chunker');
      const { chunkLegalDocument } = require('./chunker');
      // Prefer the caller's already-extracted clean body (fetch-lex #divCont
      // extraction) over re-deriving text from raw HTML.
      const fallbackText = (opts.fallbackText && opts.fallbackText.trim().length > 200)
        ? opts.fallbackText
        : extractPlainText(html);
      return chunkLegalDocument(fallbackText, docMeta);
    }

    // Articles were detected by CSS class, but the number comes from a regex
    // on the header text. If NONE matched, every chunk_id collapses to
    // "<doc>_art_" and every citation column is NULL — an unciteable corpus
    // that still looks like a successful ingest. Fail loudly instead.
    // (This exact failure shipped once: Cyrillic "модда" vs Latin "modda".)
    const numbered = parsed.articles.filter(a => a.articleNumber).length;
    if (numbered === 0) {
      throw new Error(
        `[STRUCT-CHUNKER] Parsed ${parsed.articles.length} articles but extracted 0 article numbers ` +
        `(doc_id="${docMeta.doc_id || '?'}"). Header format not recognized — first header: ` +
        `"${(parsed.articles[0].articleTitle || '').slice(0, 80)}". Refusing to ingest uncitable chunks.`
      );
    }
    if (numbered < parsed.articles.length) {
      console.warn(`[STRUCT-CHUNKER] WARN: ${parsed.articles.length - numbered}/${parsed.articles.length} articles have no extractable number (doc_id="${docMeta.doc_id || '?'}")`);
    }

    // Enrich docMeta with parsed title
    if (!docMeta.law_name && parsed.title) docMeta.law_name = parsed.title;

    return chunkByArticle(parsed.articles, docMeta);
  }

  // Plain text input — fall back to legacy chunker
  const { chunkLegalDocument } = require('./chunker');
  return chunkLegalDocument(html, docMeta);
}

/**
 * Extract plain text from HTML (fallback when no article structure is found).
 *
 * Scoped to lex.uz's #divCont content container when present — taking
 * $('body').text() swallows the page chrome (version-history links,
 * "Кейинги таҳрирга ҳавола", indexing widgets), which once ingested a NIZOM
 * as a single chunk of navigation junk. Chrome elements are stripped either way.
 */
function extractPlainText(html) {
  const $ = cheerio.load(html);
  $('script, style, nav, footer').remove();
  // Strip lex.uz chrome/metadata blocks wherever they appear
  $('.CHANGES_ORIGINS, .INDEXES_ON_REF, .COMMENT, .ACT_FORM, .PUBLICATION_ORIGIN').remove();
  const scope = $('#divCont').length ? $('#divCont') : $('body');
  return scope.text().replace(/\s+/g, ' ').trim();
}

/**
 * Clean text utility.
 */
function cleanText(text) {
  return (text || '')
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  parseLexStructured,
  chunkByArticle,
  chunkLegalDocumentStructured,
  splitIntoParts,
  extractReferences,
  // Constants for testing
  PARENT_MAX_CHARS,
  CHILD_MAX_CHARS,
};
