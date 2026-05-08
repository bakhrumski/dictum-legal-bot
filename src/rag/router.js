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

/**
 * @param {string} query
 * @returns {{ strategy: 'DIRECT'|'HYBRID'|'GRAPH', entities: string[], keywords: string[] }}
 */
function routeQuery(query) {
  if (!query) return { strategy: 'HYBRID', entities: [], keywords: [] };

  const q = query.trim();

  // Extract article/law references as entities
  const entities = [];
  const articleMatches = q.matchAll(/[Сс]татья\s+(\d+[\-.]?\d*)|[Мм]одда\s+(\d+)|(\d+)-modda/g);
  for (const m of articleMatches) {
    entities.push(m[1] || m[2] || m[3]);
  }
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

module.exports = { routeQuery };
