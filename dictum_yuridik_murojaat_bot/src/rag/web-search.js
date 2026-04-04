'use strict';

/**
 * Web Search — Tavily API fallback.
 *
 * Используется когда в базе нет релевантных чанков.
 * Tavily специально оптимизирован для AI-агентов (возвращает чистый текст).
 *
 * Env: TAVILY_API_KEY
 * Free tier: 1000 req/month
 */

const TAVILY_URL = 'https://api.tavily.com/search';
const MAX_RESULTS = 3;
const TIMEOUT_MS = 10_000;

/**
 * Search the web for legal information.
 *
 * @param {string} query
 * @param {object} opts
 * @param {number} opts.maxResults
 * @returns {Promise<Array<{ title, url, content, score }>>}
 */
async function webSearch(query, { maxResults = MAX_RESULTS } = {}) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.warn('[WEB SEARCH] TAVILY_API_KEY not set, skipping');
    return [];
  }

  // Focus search on Uzbek legal sources
  const enrichedQuery = `${query} законодательство Узбекистан lex.uz`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const resp = await fetch(TAVILY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: enrichedQuery,
        search_depth: 'basic',
        max_results: maxResults,
        include_answer: false,
        include_domains: ['lex.uz', 'gov.uz', 'norma.uz', 'parliament.gov.uz'],
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      console.warn(`[WEB SEARCH] Tavily ${resp.status}: ${err.substring(0, 100)}`);
      return [];
    }

    const data = await resp.json();
    const results = (data.results || []).map(r => ({
      title: r.title || '',
      url: r.url || '',
      content: (r.content || '').substring(0, 1000),
      score: r.score || 0.5,
    }));

    console.log(`[WEB SEARCH] Tavily: ${results.length} results for "${query.substring(0, 50)}"`);
    return results;

  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('[WEB SEARCH] Tavily timeout');
    } else {
      console.warn(`[WEB SEARCH] Tavily error: ${err.message}`);
    }
    return [];
  }
}

/**
 * Format web results as context block for prompt injection.
 */
function formatWebResults(results, language = 'uz') {
  if (!results || results.length === 0) return '';

  const isUz = language === 'uz';
  const header = isUz
    ? `\n\nINTERNET QIDIRUV NATIJALARI (${results.length} ta):\n`
    : `\n\nРЕЗУЛЬТАТЫ ВЕБ-ПОИСКА (${results.length}):\n`;

  const body = results.map((r, i) => [
    `[WEB-${i + 1}] ${r.title}`,
    r.content,
    r.url ? `  (${isUz ? 'Manba' : 'Источник'}: ${r.url})` : '',
  ].filter(Boolean).join('\n')).join('\n\n');

  return header + body;
}

module.exports = { webSearch, formatWebResults };
