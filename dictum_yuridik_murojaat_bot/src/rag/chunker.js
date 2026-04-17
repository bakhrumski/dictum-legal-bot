'use strict';

/**
 * Semantic Legal Document Chunker
 *
 * Splits legal documents into meaningful chunks that preserve:
 * - Article boundaries (never split mid-article)
 * - Section context (chapter/section headers travel with chunks)
 * - Cross-reference integrity
 *
 * Supports both Uzbek and Russian patterns since lex.uz serves
 * documents in Russian by default:
 *   Uzbek: Bob (Chapter), Modda (Article)
 *   Russian: Глава (Chapter), Статья (Article), Раздел (Section)
 */

const CHUNK_TARGET = 800;   // target tokens (~3200 chars)
const CHUNK_MAX = 1200;     // hard max tokens (~4800 chars)
const CHUNK_OVERLAP = 100;  // overlap tokens for context continuity
const CHARS_PER_TOKEN = 4;  // rough estimate for Uzbek/Russian legal text

// ========== PATTERNS FOR LEGAL DOCUMENTS (UZBEK + RUSSIAN) ==========

// Uzbek article: "123-modda." or "Modda 123."
// Russian article: "Статья 123." or "Статья 123<sup>1</sup>."
const SUPERSCRIPT_CLASS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const SUPER_DIGITS = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
};
const ARTICLE_PATTERN = new RegExp(
  `^(\\d+(?:[${SUPERSCRIPT_CLASS}]+)?[\\s-]*(?:-\\s*)?modda(?:\\s+prim\\s+\\d+)?[\\s.:]|modda\\s+\\d+(?:\\s+prim\\s+\\d+)?[\\s.:]|Статья\\s+\\d+(?:[${SUPERSCRIPT_CLASS}]+)?)`,
  'im'
);

// Uzbek chapter: "1-bob." or "I bob." or "BOB 1."
// Russian chapter: "ГЛАВА I." or "ГЛАВА 1." or "Глава I."
const CHAPTER_PATTERN = /^(\d+[\s-]*(?:-\s*)?bob[\s.:]|[IVXLC]+[\s-]*bob[\s.:]|bob\s+\d+[\s.:]|ГЛАВА\s+[IVXLC\d]+)/im;

// Uzbek section: "1-bo'lim"
// Russian section: "РАЗДЕЛ I" or "ЧАСТЬ 1" (Part)
const SECTION_PATTERN = /^(\d+[\s-]*(?:-\s*)?bo['']lim[\s.:]|bo['']lim\s+\d+[\s.:]|РАЗДЕЛ\s+[IVXLC\d]+|ЧАСТЬ\s+[IVXLC\d]+|ОБЩАЯ\s+ЧАСТЬ|ОСОБЕННАЯ\s+ЧАСТЬ)/im;

// Match paragraph numbering within articles
const PARAGRAPH_PATTERN = /^\d+\)\s/m;

function toSuperscriptDigits(value = '') {
  return String(value || '')
    .split('')
    .map((digit) => SUPER_DIGITS[digit] || digit)
    .join('');
}

function extractArticleNumber(text = '') {
  const uzPrimMatch = text.match(/^(\d+)[\s-]*(?:-\s*)?modda\s+prim\s+(\d+)/i);
  if (uzPrimMatch) {
    return `${uzPrimMatch[1]}${toSuperscriptDigits(uzPrimMatch[2])}`;
  }

  const uzSupMatch = text.match(new RegExp(`^(\\d+)([${SUPERSCRIPT_CLASS}]+)?[\\s-]*(?:-\\s*)?modda`, 'i'));
  if (uzSupMatch) {
    return `${uzSupMatch[1]}${uzSupMatch[2] || ''}`;
  }

  const moddaFirstMatch = text.match(/^modda\s+(\d+)(?:\s+prim\s+(\d+))?/i);
  if (moddaFirstMatch) {
    return `${moddaFirstMatch[1]}${moddaFirstMatch[2] ? toSuperscriptDigits(moddaFirstMatch[2]) : ''}`;
  }

  const ruMatch = text.match(new RegExp(`^Статья\\s+(\\d+)([${SUPERSCRIPT_CLASS}]+)?`, 'i'));
  if (ruMatch) {
    return `${ruMatch[1]}${ruMatch[2] || ''}`;
  }

  const fallback = text.match(/(\d+)/);
  return fallback ? fallback[1] : null;
}

/**
 * Parse a legal document into structured sections.
 * Returns an array of { type, number, title, body } objects.
 */
function parseDocument(text) {
  const lines = text.split('\n');
  const sections = [];
  let currentChapter = '';
  let currentSection = '';
  let currentArticle = null;
  let buffer = [];

  function flushArticle() {
    if (currentArticle) {
      currentArticle.body = buffer.join('\n').trim();
      currentArticle.chapter = currentChapter;
      currentArticle.section = currentSection;
      sections.push(currentArticle);
    }
    buffer = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      buffer.push('');
      continue;
    }

    // Check for chapter header
    if (CHAPTER_PATTERN.test(trimmed)) {
      flushArticle();
      currentChapter = trimmed;
      currentArticle = null;
      continue;
    }

    // Check for section header
    if (SECTION_PATTERN.test(trimmed)) {
      flushArticle();
      currentSection = trimmed;
      currentArticle = null;
      continue;
    }

    // Check for article header
    if (ARTICLE_PATTERN.test(trimmed)) {
      flushArticle();
      currentArticle = {
        type: 'article',
        number: extractArticleNumber(trimmed),
        title: trimmed,
        body: '',
        chapter: currentChapter,
        section: currentSection
      };
      continue;
    }

    buffer.push(trimmed);
  }

  // Flush last article
  flushArticle();

  // If no articles were found, treat entire text as one section
  if (sections.length === 0 && text.trim().length > 0) {
    sections.push({
      type: 'raw',
      number: null,
      title: '',
      body: text.trim(),
      chapter: '',
      section: ''
    });
  }

  return sections;
}

/**
 * Create chunks from parsed sections.
 * Each chunk contains:
 *   - text: the chunk content
 *   - metadata: article number, chapter, section, char offset
 *
 * Rules:
 * 1. A single article that fits in CHUNK_MAX → one chunk
 * 2. A long article → split at paragraph boundaries
 * 3. Short consecutive articles → merge into one chunk (up to CHUNK_TARGET)
 */
function chunkSections(sections, docMeta = {}) {
  const chunks = [];
  let mergeBuffer = [];
  let mergeLength = 0;
  let mergeArticles = [];

  function flushMerge() {
    if (mergeBuffer.length > 0) {
      const text = mergeBuffer.join('\n\n').trim();
      if (text.length > 0) {
        chunks.push({
          text,
          metadata: {
            ...docMeta,
            articles: mergeArticles.slice(),
            chapter: mergeBuffer.length > 0 ? (mergeArticles[0]?.chapter || '') : '',
          }
        });
      }
      mergeBuffer = [];
      mergeLength = 0;
      mergeArticles = [];
    }
  }

  for (const sec of sections) {
    const header = sec.title ? `${sec.title}` : '';
    const context = [sec.chapter, sec.section].filter(Boolean).join(' > ');
    const fullText = [context, header, sec.body].filter(Boolean).join('\n');
    const charLen = fullText.length;
    const tokenEst = Math.ceil(charLen / CHARS_PER_TOKEN);

    if (tokenEst > CHUNK_MAX) {
      // This article is too long — split at paragraph boundaries
      flushMerge();
      const paragraphs = sec.body.split(/\n\s*\n|\n(?=\d+\)\s)/);
      let paraBuffer = [context, header].filter(Boolean).join('\n');
      let paraLen = paraBuffer.length;

      for (const para of paragraphs) {
        const trimPara = para.trim();
        if (!trimPara) continue;

        if (paraLen + trimPara.length > CHUNK_TARGET * CHARS_PER_TOKEN && paraBuffer.length > 0) {
          // Flush current paragraph buffer as a chunk
          chunks.push({
            text: paraBuffer.trim(),
            metadata: {
              ...docMeta,
              articles: [{ number: sec.number, title: sec.title, chapter: sec.chapter }],
              chapter: sec.chapter,
              partial: true
            }
          });
          // Start new buffer with context overlap
          paraBuffer = [context, header, '(davomi)'].filter(Boolean).join('\n') + '\n';
          paraLen = paraBuffer.length;
        }

        paraBuffer += '\n' + trimPara;
        paraLen += trimPara.length;
      }

      // Flush remaining
      if (paraBuffer.trim().length > 0) {
        chunks.push({
          text: paraBuffer.trim(),
          metadata: {
            ...docMeta,
            articles: [{ number: sec.number, title: sec.title, chapter: sec.chapter }],
            chapter: sec.chapter,
            partial: true
          }
        });
      }
      continue;
    }

    // Article fits — try to merge with previous short articles
    if (mergeLength + charLen > CHUNK_TARGET * CHARS_PER_TOKEN) {
      flushMerge();
    }

    mergeBuffer.push(fullText);
    mergeLength += charLen;
    mergeArticles.push({ number: sec.number, title: sec.title, chapter: sec.chapter });
  }

  flushMerge();
  return chunks;
}

/**
 * Main entry point: take raw document text + metadata, return chunks.
 *
 * @param {string} text - full document text
 * @param {object} docMeta - { law_name, doc_id, source_url, category, ... }
 * @returns {{ text: string, metadata: object }[]}
 */
function chunkLegalDocument(text, docMeta = {}) {
  if (!text || text.trim().length === 0) return [];

  const sections = parseDocument(text);
  const chunks = chunkSections(sections, docMeta);

  console.log(`[CHUNKER] "${docMeta.law_name || 'unknown'}" → ${sections.length} sections → ${chunks.length} chunks`);
  return chunks;
}

module.exports = { chunkLegalDocument, parseDocument, CHUNK_TARGET, CHUNK_MAX };
