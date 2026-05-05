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

module.exports = {
  extractArticleRefsFromText,
  getChunkArticleRefs,
  normalizeArticleRef,
};
