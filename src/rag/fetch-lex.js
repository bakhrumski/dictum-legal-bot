'use strict';

// Polyfill File for Node 18 — cheerio 1.x pulls undici which needs File at import time
if (typeof globalThis.File === 'undefined') {
  try {
    const { Blob } = require('buffer');
    globalThis.File = class File extends Blob {
      constructor(chunks, name, opts) { super(chunks, opts); this.name = name; this.lastModified = (opts && opts.lastModified) || Date.now(); }
    };
  } catch { /* buffer.Blob unavailable, cheerio will fail */ }
}

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
const https = require('https');
const http = require('http');
const { enrichForIngest } = require('./prim-notation');

const LEX_BASE = 'https://lex.uz';

/**
 * Make an HTTP(S) GET request using Node built-in modules (no global fetch needed).
 * Follows up to 5 redirects.
 */
function httpGet(url, maxRedirects = 5, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      const e = new Error('Aborted'); e.name = 'AbortError'; return reject(e);
    }
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'uz,ru;q=0.9,en;q=0.8'
      },
      timeout: 60000,
    }, (res) => {
      // Follow redirects
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location) {
        if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return httpGet(next, maxRedirects - 1, signal).then(resolve, reject);
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    // Abort the in-flight request when the caller cancels (e.g. Master-Admin
    // clicked "Bekor qilish" while a large codex was still downloading).
    if (signal) {
      signal.addEventListener('abort', () => {
        req.destroy();
        const e = new Error('Aborted'); e.name = 'AbortError'; reject(e);
      }, { once: true });
    }
  });
}

/**
 * Fetch a lex.uz document by URL or doc ID and return structured text.
 *
 * @param {string} urlOrId - full URL or numeric doc ID (e.g. "145261" or "https://lex.uz/docs/145261")
 * @returns {Promise<{ title: string, body: string, metadata: object }>}
 */
async function fetchLexDocument(urlOrId, opts = {}) {
  const { signal } = opts;
  const url = urlOrId.startsWith('http')
    ? urlOrId
    : `${LEX_BASE}/docs/${urlOrId}`;

  console.log(`[FETCH-LEX] Fetching: ${url}`);

  const html = await httpGet(url, 5, signal);
  console.log(`[FETCH-LEX] Downloaded ${(html.length / 1024).toFixed(0)} KB`);

  const parsed = parseLexHtml(html, url);

  // ── Auto-follow to current version if lex.uz is showing a date-locked snapshot ──
  // lex.uz shows "Hujjat DD.MM.YYYY sanasi holatiga" banner with
  // an "Amaldagi versiyaga o'tish" link when the fetched URL is a
  // historical version rather than the live document.
  if (parsed.metadata.current_version_url) {
    const currentUrl = parsed.metadata.current_version_url;
    console.log(`[FETCH-LEX] Historical version detected at ${url} → fetching current: ${currentUrl}`);
    try {
      const currentHtml = await httpGet(currentUrl, 5, signal);
      const currentParsed = parseLexHtml(currentHtml, currentUrl);
      return { ...currentParsed, rawHtml: currentHtml };
    } catch (err) {
      console.warn(`[FETCH-LEX] Could not fetch current version (${err.message}), using historical`);
    }
  }

  return {
    ...parsed,
    rawHtml: html,
  };
}

/**
 * Parse lex.uz HTML and extract structured legal text.
 */
function parseLexHtml(html, sourceUrl) {
  const $ = cheerio.load(html);
  const lines = [];
  let title = '';
  const metadata = {
    source_url: sourceUrl,
    is_active: true,        // default: document is in force
    status_label: null,     // raw status text from lex.uz
    adoption_date: null,    // e.g. "1996-12-27"
    document_number: null,  // e.g. "349-I"
  };

  // ── Status detection: check ENTIRE page for "Hujjat kuchini yo'qotgan" / similar ──
  // lex.uz marks inactive documents with a header banner. We scan the full HTML
  // text + known status containers. If ANY of these match, is_active=false.
  //
  // The apostrophe class MUST cover every variant lex.uz renders, especially
  // U+2018/U+2019 curly quotes ("yo'qotgan") — an earlier version omitted these
  // and silently failed to flag repealed documents, which were then ingested as
  // if in force. Variants: ' ' ' ʻ ʼ ` ´
  const APO = "['\\u2018\\u2019\\u02BB\\u02BC\\u0060\\u00B4]";
  const fullText = $('body').text();
  const statusPatterns = [
    new RegExp(`Hujjat\\s+kuchini\\s+yo${APO}?qotgan`, 'i'),
    new RegExp(`Hujjat\\s+kuchi\\s+yo${APO}?qotgan`, 'i'),
    new RegExp(`kuchini\\s+yo${APO}?qotgan`, 'i'),
    /Документ\s+утратил\s+силу/i,
    /(?:utratil|utrativ)\s+silu/i,
    /Not\s+in\s+force/i,
  ];
  for (const pat of statusPatterns) {
    const m = fullText.match(pat);
    if (m) {
      metadata.is_active = false;
      metadata.status_label = m[0];
      break;
    }
  }
  // Also treat "Eski tahrir" (old edition) as inactive for our purposes
  if (/Eski\s+tahrir/i.test(fullText)) {
    metadata.is_active = false;
    metadata.status_label = metadata.status_label || 'Eski tahrir';
  }

  // ── Historical-version detection ──────────────────────────────────────────
  // lex.uz shows a banner "Hujjat DD.MM.YYYY sanasi holatiga" when the page
  // is a date-locked snapshot (not the current live version). The banner also
  // contains an "Amaldagi versiyaga o'tish" link to the current version.
  // We capture that link so fetchLexDocument() can re-fetch the current doc.
  metadata.current_version_url = null;
  if (/sanasi\s+holatiga/i.test(fullText)) {
    const amaldagiRx = new RegExp(`Amaldagi\\s+versiyaga\\s+o${APO}?tish`, 'i');
    $('a').each((_, el) => {
      const linkText = $(el).text().trim();
      if (amaldagiRx.test(linkText)) {
        const href = $(el).attr('href') || '';
        if (href) {
          metadata.current_version_url = href.startsWith('http')
            ? href
            : `https://lex.uz${href.startsWith('/') ? '' : '/'}${href}`;
        }
      }
    });
    // If no explicit link found, strip any date/version query params and retry base URL
    if (!metadata.current_version_url && sourceUrl) {
      try {
        const u = new URL(sourceUrl);
        u.search = '';
        u.hash = '';
        // Only use the stripped URL if it differs from the original (had params)
        if (u.href !== sourceUrl) metadata.current_version_url = u.href;
      } catch { /* invalid URL, ignore */ }
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  // Extract document title — lex.uz uses <a id="..."> or <div id="..."> for content
  const titleEl = $('div.ACT_TITLE a[id]').add($('div.ACT_TITLE > div[id]')).first();
  if (titleEl.length > 0) {
    title = cleanText(titleEl.text());
    lines.push(title);
    lines.push('');
  }

  // Extract publication origin (for metadata)
  const pubEl = $('div.PUBLICATION_ORIGIN a[id]').add($('div.PUBLICATION_ORIGIN > div[id]')).first();
  if (pubEl.length > 0) {
    metadata.publication = cleanText(pubEl.text());
  }

  // ── Extract adoption date + document number from title ──
  if (title) {
    const titleMeta = extractTitleMetadata(title);
    if (titleMeta.adoption_date)   metadata.adoption_date = titleMeta.adoption_date;
    if (titleMeta.document_number) metadata.document_number = titleMeta.document_number;
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

    // Get the content element — lex.uz uses <a id="..."> or <div id="...">
    const anchor = $el.find('> a[id]').length ? $el.find('> a[id]') : $el.find('> div[id]');
    if (anchor.length === 0) return;

    // Convert <sup> to prime notation before extracting text
    // e.g. 3<sup>1</sup>-modda → 3¹-modda (superscript digits)
    anchor.find('sup').each((_, sup) => {
      const supText = $(sup).text().trim();
      const superDigits = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹' };
      const converted = supText.split('').map(c => superDigits[c] || c).join('');
      $(sup).replaceWith(converted);
    });

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

  let body = lines.join('\n')
    .replace(/\n{3,}/g, '\n\n')  // collapse multiple blank lines
    .trim();

  // Enrich superscript article numbers ("7¹-modda") with a spoken alias
  // ("7-modda prim 1") so BM25 and embeddings match either form.
  body = enrichForIngest(body);

  console.log(`[FETCH-LEX] Extracted: "${title}" — ${body.length} chars, ~${Math.ceil(body.length / 4)} tokens, active=${metadata.is_active}${metadata.adoption_date ? `, date=${metadata.adoption_date}` : ''}${metadata.document_number ? `, #${metadata.document_number}` : ''}`);

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
 * Extract adoption_date and document_number from a law title.
 *
 * Pure function — no DOM, no I/O — shared between parseLexHtml (live ingest)
 * and backfill-doc-metadata.js (one-shot repair of historical rows). Keeping
 * this logic in one place guarantees the extractor on disk matches the
 * extractor that produced the row.
 *
 * Returned shape:
 *   { adoption_date: "YYYY-MM-DD"|null, document_number: string|null }
 *
 * Rules:
 *   - adoption_date: prefer numeric "DD.MM.YYYY", fall back to Uzbek
 *     "YYYY yil D <month>".
 *   - document_number: priority-ordered patterns so a bare digit run
 *     (date, year) can never win over the real number —
 *       1. Explicit "№" / "N " / "raqami" prefix → "№ 349-I"  → "349-I"
 *       2. Trailing "-son" suffix                 → "349-I-son" → "349-I"
 *       3. Alpha-prefixed code (PQ-4624, ПП-123)  → "PQ-4624"   → "PQ-4624"
 *     JS `\b` is ASCII-only, so the alpha-prefix pattern uses an explicit
 *     non-letter left/right boundary to stay Cyrillic-friendly.
 */
function extractTitleMetadata(title) {
  const result = { adoption_date: null, document_number: null };
  if (!title) return result;

  const months = {
    yanvar: '01', fevral: '02', mart: '03', aprel: '04', may: '05', iyun: '06',
    iyul: '07', avgust: '08', sentabr: '09', oktabr: '10', noyabr: '11', dekabr: '12',
  };
  const dateMatch = title.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (dateMatch) {
    result.adoption_date = `${dateMatch[3]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`;
  } else {
    const uzMatch = title.match(/(\d{4})\s*yil[,\s]*(\d{1,2})[\s-]*([a-zа-я'ʻ]+)/i);
    if (uzMatch) {
      const monthKey = uzMatch[3].toLowerCase().replace(/[^a-z]/g, '');
      if (months[monthKey]) {
        result.adoption_date = `${uzMatch[1]}-${months[monthKey]}-${uzMatch[2].padStart(2, '0')}`;
      }
    }
  }

  const numPatterns = [
    /(?:№\s*|\bN\s+|raqami\s+)([A-ZА-Я]{0,4}-?\d+(?:-[IVX]+)?(?:-son)?)/,
    /\b(\d+(?:-[IVX]+)?)-son\b/,
    /(?:^|[^A-ZА-Яa-zа-я0-9])([A-ZА-Я]{2,4}-\d+(?:-[IVX]+)?)(?![A-ZА-Яa-zа-я0-9])/,
  ];
  for (const pat of numPatterns) {
    const m = title.match(pat);
    if (m) {
      result.document_number = m[1].replace(/-son$/i, '');
      break;
    }
  }

  return result;
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

module.exports = { fetchLexDocument, parseLexHtml, formatForIngestion, extractTitleMetadata, httpGet };
