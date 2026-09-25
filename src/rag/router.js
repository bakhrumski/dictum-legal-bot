'use strict';

/**
 * Query Router — выбирает стратегию RAG на основе типа вопроса.
 *
 * DIRECT  — конкретные цифры/сроки: "сколько дней отпуск?"
 * HYBRID  — общие правовые вопросы (по умолчанию)
 * GRAPH   — вопросы про связи между нормами: "как статья 123 связана с..."
 */

const DIRECT_PATTERNS = [
  /сколько\s+(дней|лет|месяц|раз|раз|часов)/i,
  /какой\s+срок/i,
  /размер\s+(штраф|пени|выплат)/i,
  /минимальн|максимальн/i,
  /qancha\s+(kun|yil|oy|soat)/i,
  /muddat\s+qancha/i,
  /\d+\s*%/,
  /в течение\s+\d+/i,
];

const GRAPH_PATTERNS = [
  /ссылается|связан|основан на|в соответствии с/i,
  /противоречит|конфликт между/i,
  /изменен|дополнен|отменен/i,
  /murojaat qiladi|bog['']liq|asoslanadi/i,
];

const SUPER = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const toSuper = (digits) => String(digits).split('').map(d => SUPER[Number(d)]).join('');

/**
 * Article numbers a question refers to, as stored in legal_chunks
 * (prim articles with superscripts: "358¹"). Before, only "N-modda",
 * Cyrillic "модда N" and "статья N" were read, so "modda 358", "386 modda",
 * "ст. 386", "358-moddasi" and prim forms were missed, and the expanded
 * form "7-modda prim 1-modda" produced articles 7 and 1 (Astra audit RAG6).
 */
function extractArticleRefs(text) {
  const out = [];
  const add = (n) => { if (n && !out.includes(n)) out.push(n); };
  let q = String(text || '');
  // "N prim M" and the expansion "N-modda prim M" -> N with superscript M.
  q = q.replace(/(\d{1,4})(?:\s*-?\s*(?:modda|модда)\S*)?\s*-?\s*prim\s*-?\s*(\d{1,2})(?:\s*-?\s*(?:modda|модда)\S*)?/gi,
    (_, n, m) => { add(n + toSuper(m)); return ' '; });
  const num = `(\\d{1,4}[${SUPER}]*)`;
  const word = '(?:modda|модда|моддаси|статья|статьи|статье|статью|ст\\.?)';
  const patterns = [
    new RegExp(`${num}\\s*-?\\s*(?:modda|модда)[\\p{L}'ʼ‘’]*`, 'giu'),        // 358-modda, 358 moddasi
    new RegExp(`(?:^|[^\\p{L}])${word}\\s*№?\\s*${num}`, 'giu'),               // modda 358, ст. 386
    new RegExp(`${num}\\s*-?\\s*(?:статья|статьи|статье|статью)`, 'giu'),         // 386 статья
  ];
  for (const re of patterns) {
    for (const m of q.matchAll(re)) add(m[1]);
  }
  return out;
}

/**
 * @param {string} query
 * @returns {{ strategy: 'DIRECT'|'HYBRID'|'GRAPH', entities: string[], keywords: string[] }}
 */
function routeQuery(query) {
  if (!query) return { strategy: 'HYBRID', entities: [], keywords: [] };

  const q = query.trim();

  // Extract article/law references as entities
  const entities = extractArticleRefs(q);
  const lawMatches = q.matchAll(/[Кк]одекс[а-я]*\s+\w+|[Зз]акон[а-я]*\s+["«]([^»"]+)["»]/g);
  for (const m of lawMatches) {
    if (m[1]) entities.push(m[1]);
  }

  // Extract meaningful keywords (words > 4 chars, no stopwords)
  const stopwords = new Set(['что', 'как', 'это', 'для', 'при', 'его', 'если', 'nima', 'qanday', 'uchun']);
  const keywords = q
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 4 && !stopwords.has(w) && !/^\d+$/.test(w));

  if (entities.length > 0 && GRAPH_PATTERNS.some(p => p.test(q))) {
    return { strategy: 'GRAPH', entities, keywords };
  }

  if (DIRECT_PATTERNS.some(p => p.test(q))) {
    return { strategy: 'DIRECT', entities, keywords };
  }

  return { strategy: 'HYBRID', entities, keywords };
}

module.exports = { routeQuery, extractArticleRefs };
