'use strict';

/**
 * Lex.uz Document Fetcher
 *
 * Fetches legal documents from lex.uz and extracts clean structured text.
 *
 * lex.uz HTML structure (server-rendered, no JS needed):
 *   #divCont contains all document elements as <div class="CLASS lx_elem">
 *   Each element has: <div class="lx_elem2">toolbar</div> + <a id="ID">text</a>
 *
 * Element classes:
 *   ACT_TITLE          — document title
 *   TEXT_HEADER_DEFAULT — chapter/section/part headers
 *   CLAUSE_DEFAULT      — article headers (span.clausePrfx + span.clauseSuff)
 *   ACT_TEXT            — body text paragraphs
 *   FOOTNOTE            — footnotes
 *   CHANGES_ORIGINS     — amendment references (skip)
 *   COMMENT             — comments (skip, display:none)
 *   INDEXES_ON_REF      — indexes (skip, display:none)
 *   BY_DEFAULT          — separators (skip if empty)
 */

const cheerio = require('cheerio');

const LEX_BASE = 'https://lex.uz';

/**
 * Fetch a lex.uz document by URL or doc ID and return structured text.
 *
 * @param {string} urlOrId - full URL or numeric doc ID (e.g. "145261" or "https://lex.uz/docs/145261")
 * @returns {Promise<{ title: string, body: string, metadata: object }>}
 */
async function fetchLexDocument(urlOrId) {
  const url = urlOrId.startsWith('http')
    ? urlOrId
    : `${LEX_BASE}/docs/${urlOrId}`;

  console.log(`[FETCH-LEX] Fetching: ${url}`);

  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'uz,ru;q=0.9,en;q=0.8'
    }
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${resp.status}`);
  }

  const html = await resp.text();
  console.log(`[FETCH-LEX] Downloaded ${(html.length / 1024).toFixed(0)} KB`);

  return parseLexHtml(html, url);
}

/**
 * Parse lex.uz HTML and extract structured legal text.
 */
function parseLexHtml(html, sourceUrl) {
  const $ = cheerio.load(html);
  const lines = [];
  let title = '';
  const metadata = { source_url: sourceUrl };

  // Extract document title
  const titleEl = $('div.ACT_TITLE a[id]');
  if (titleEl.length > 0) {
    title = cleanText(titleEl.text());
    lines.push(title);
    lines.push('');
  }

  // Extract publication origin (for metadata)
  const pubEl = $('div.PUBLICATION_ORIGIN a[id]');
  if (pubEl.length > 0) {
    metadata.publication = cleanText(pubEl.text());
  }

  // Process all content elements in document order
  const contentDivs = $('#divCont > div.lx_elem');

  contentDivs.each((_, el) => {
    const $el = $(el);
    const classes = $el.attr('class') || '';

    // Skip hidden/irrelevant elements
    if (classes.includes('COMMENT') ||
        classes.includes('INDEXES_ON_REF') ||
        classes.includes('CHANGES_ORIGINS') ||
        classes.includes('ACT_FORM') ||
        classes.includes('PUBLICATION_ORIGIN') ||
        classes.includes('ACT_TITLE')) {
      return;
    }

    // Get the anchor element with the actual text
    const anchor = $el.find('> a[id]');
    if (anchor.length === 0) return;

    const text = cleanText(anchor.text());
    if (!text) return;

    if (classes.includes('TEXT_HEADER_DEFAULT')) {
      // Chapter/section header — add blank line before for separation
      lines.push('');
      lines.push(text);
      lines.push('');
    } else if (classes.includes('CLAUSE_DEFAULT')) {
      // Article header
      const prefix = cleanText(anchor.find('span.clausePrfx').text());
      const suffix = cleanText(anchor.find('span.clauseSuff').text());
      lines.push('');
      if (prefix && suffix) {
        lines.push(`${prefix}${suffix}`);
      } else {
        lines.push(text);
      }
    } else if (classes.includes('ACT_TEXT')) {
      // Body paragraph
      lines.push(text);
    } else if (classes.includes('FOOTNOTE')) {
      // Footnote
      lines.push(`[Izoh: ${text}]`);
    } else if (classes.includes('BY_DEFAULT')) {
      // Separator — only if non-empty
      if (text.length > 2) {
        lines.push(text);
      }
    }
  });

  const body = lines.join('\n')
    .replace(/\n{3,}/g, '\n\n')  // collapse multiple blank lines
    .trim();

  console.log(`[FETCH-LEX] Extracted: "${title}" — ${body.length} chars, ~${Math.ceil(body.length / 4)} tokens`);

  return { title, body, metadata };
}

/**
 * Clean extracted text: normalize whitespace, remove zero-width chars.
 */
function cleanText(text) {
  return (text || '')
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')  // zero-width chars
    .replace(/\s+/g, ' ')  // collapse whitespace
    .trim();
}

/**
 * Build a frontmatter + body string ready for ingestion or saving as .txt.
 *
 * @param {object} doc - { title, body, metadata }
 * @param {object} opts - { law_name, doc_id, category, enforcement_date }
 * @returns {string}
 */
function formatForIngestion(doc, opts = {}) {
  const header = [
    '---',
    `law_name: ${opts.law_name || doc.title}`,
    `doc_id: ${opts.doc_id || ''}`,
    `source_url: ${doc.metadata.source_url || ''}`,
    `category: ${opts.category || ''}`,
    opts.enforcement_date ? `enforcement_date: ${opts.enforcement_date}` : null,
    '---'
  ].filter(Boolean).join('\n');

  return `${header}\n\n${doc.body}`;
}

module.exports = { fetchLexDocument, parseLexHtml, formatForIngestion };
