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

const https = require('https');

const TAVILY_URL = 'https://api.tavily.com/search';
const MAX_RESULTS = 3;
const TIMEOUT_MS = 10_000;

/**
 * POST JSON to an HTTPS endpoint using Node built-in https module.
 */
function httpsPost(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        resolve({ status: res.statusCode, text });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Tavily timeout')); });
    req.write(payload);
    req.end();
  });
}

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
    const resp = await httpsPost(TAVILY_URL, {
      api_key: apiKey,
      query: enrichedQuery,
      search_depth: 'basic',
      max_results: maxResults,
      include_answer: false,
      include_domains: ['lex.uz', 'gov.uz', 'norma.uz', 'parliament.gov.uz'],
    }, TIMEOUT_MS);

    if (resp.status !== 200) {
      console.warn(`[WEB SEARCH] Tavily ${resp.status}: ${resp.text.substring(0, 100)}`);
      return [];
    }

    const data = JSON.parse(resp.text);
    const results = (data.results || []).map(r => ({
      title: r.title || '',
      url: r.url || '',
      content: (r.content || '').substring(0, 1000),
      score: r.score || 0.5,
    }));

    console.log(`[WEB SEARCH] Tavily: ${results.length} results for "${query.substring(0, 50)}"`);
    return results;

  } catch (err) {
    console.warn(`[WEB SEARCH] Tavily error: ${err.message}`);
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
