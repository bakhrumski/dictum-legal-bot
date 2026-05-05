'use strict';

/**
 * Justify Client — HTTP клиент для интеграции с Justify RAG API.
 *
 * Заменяет hybridSearch() из legal-corpus.js.
 * Justify запускается локально на порту 8000 (FastAPI).
 *
 * Эндпоинты Justify:
 *   POST /api/v1/chat          — полный RAG пайплайн (Hybrid + Corrective + Graph)
 *   POST /api/v1/search        — только поиск чанков (без LLM)
 *   POST /api/v1/scrape/single — спарсить один URL с lex.uz
 *   GET  /api/v1/stats         — статистика базы
 *   GET  /health               — проверка доступности
 */

const http = require('http');
const https = require('https');

const JUSTIFY_BASE_URL = process.env.JUSTIFY_URL || 'http://localhost:8000';
const JUSTIFY_TIMEOUT_MS = 30_000;
const JUSTIFY_TENANT = process.env.JUSTIFY_TENANT || 'global';

/**
 * Отправить HTTP запрос к Justify API.
 */
async function justifyRequest(method, path, body = null) {
  const url = new URL(JUSTIFY_BASE_URL + path);
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;

  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method,
    headers: { 'Content-Type': 'application/json' },
    timeout: JUSTIFY_TIMEOUT_MS,
  };

  return new Promise((resolve, reject) => {
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          reject(new Error(`Justify: invalid JSON response (status ${res.statusCode})`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Justify: request timeout'));
    });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Проверить доступность Justify сервера.
 * @returns {Promise<boolean>}
 */
async function isJustifyAvailable() {
  try {
    const res = await justifyRequest('GET', '/health');
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Поиск релевантных чанков из базы законодательства.
 * Аналог hybridSearch() из legal-corpus.js
 *
 * @param {string} query — вопрос пользователя
 * @param {object} opts
 * @param {number} opts.limit — кол-во результатов (default 6)
 * @param {string} opts.tenant_id — изоляция данных по клиенту
 * @returns {Promise<Array>} — массив чанков
 */
async function searchLegal(query, { limit = 6, tenant_id = JUSTIFY_TENANT } = {}) {
  const res = await justifyRequest('POST', '/api/v1/search', {
    query,
    top_k: limit,
    tenant_id,
  });

  if (res.status !== 200) {
    throw new Error(`Justify search error: HTTP ${res.status}`);
  }

  // Нормализуем результаты в формат, совместимый с hybridSearch()
  return (res.body.results || []).map(r => ({
    chunk_text: r.content,
    law_name: r.metadata?.title || r.metadata?.filename || 'Lex.uz',
    source_url: r.metadata?.url || r.metadata?.source_url || '',
    article_numbers: r.metadata?.article ? [r.metadata.article] : [],
    chapter: r.metadata?.chapter || '',
    source_type: r.metadata?.source || 'law_text',
    score: r.score,
    language: r.metadata?.language || 'ru',
  }));
}

/**
 * Полный RAG пайплайн — задать вопрос и получить ответ с источниками.
 * Использует Router → Hybrid/Graph/Corrective RAG → LLM.
 *
 * @param {string} question — вопрос юриста / пользователя
 * @param {object} opts
 * @param {string} opts.tenant_id
 * @param {string} opts.strategy — 'hybrid' | 'corrective' | 'graph' (default auto)
 * @returns {Promise<{answer: string, sources: Array, strategy: string, web_search_used: boolean}>}
 */
async function askJustify(question, { tenant_id = JUSTIFY_TENANT, strategy = null } = {}) {
  const body = { question, tenant_id };
  if (strategy) body.strategy = strategy;

  const res = await justifyRequest('POST', '/api/v1/chat', body);

  if (res.status !== 200) {
    throw new Error(`Justify chat error: HTTP ${res.status}`);
  }

  return res.body;
}

/**
 * Получить форматированный контекст для инъекции в промпт.
 * Это прямой аналог retrieveLegalContext() из server.js
 *
 * @param {string} query
 * @param {string|null} topic — юридическая область (опционально)
 * @param {string} language — язык интерфейса ('ru' | 'uz') для формата вывода
 * @returns {Promise<string>} — готовый блок текста для промпта
 */
async function retrieveLegalContextViaJustify(query, topic = null, language = 'ru') {
  let results = [];

  try {
    results = await searchLegal(query, { limit: 6 });
  } catch (err) {
    console.warn(`[JUSTIFY] Search failed: ${err.message}`);
    return '';
  }

  if (!results.length) return '';

  const isUz = language === 'uz';

  const chunks = results.map((r, i) => {
    const arts = r.article_numbers?.length ? r.article_numbers.join(', ') : '';
    const verifiedBadge = r.source_type === 'verified_qa'
      ? (isUz ? ' ✅ [Yurist tomonidan tasdiqlangan]' : ' ✅ [Проверено юристом]')
      : '';
    const scoreInfo = r.score ? ` (relevance: ${(r.score * 100).toFixed(0)}%)` : '';
    const langTag = r.language === 'uz' ? ' [UZ]' : ' [RU]';

    return [
      `[${i + 1}] ${r.law_name}${verifiedBadge}${langTag}${scoreInfo}`,
      arts ? (isUz ? `  Moddalar: ${arts}` : `  Статьи: ${arts}`) : '',
      r.chapter ? `  ${r.chapter}` : '',
      r.chunk_text,
      r.source_url ? `  (${isUz ? 'Manba' : 'Источник'}: ${r.source_url})` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  if (isUz) {
    return `\n\nQONUNCHILIK KONTEKSTI (Justify RAG orqali, ${results.length} natija):\n`
      + `Quyidagi ma'lumotlarga BIRINCHI NAVBATDA asoslaning.\n\n${chunks}\n\n`
      + `MUHIM: Yuqoridagi kontekstdagi moddalarni ANIQ keltiring.`;
  }

  return `\n\nКОНТЕКСТ ИЗ ЗАКОНОДАТЕЛЬСТВА (Justify RAG, ${results.length} результатов):\n`
    + `Основывайся ПРЕЖДЕ ВСЕГО на следующих материалах.\n\n${chunks}\n\n`
    + `ВАЖНО: Цитируй статьи ТОЧНО из контекста. Не придумывай статьи, которых нет выше.`;
}

/**
 * Спарсить URL с lex.uz и добавить в базу Justify.
 *
 * @param {string} url — https://lex.uz/ru/docs/111181
 * @param {string} tenant_id
 */
async function scrapeAndIndex(url, tenant_id = JUSTIFY_TENANT) {
  const params = new URLSearchParams({ url, tenant_id });
  const res = await justifyRequest('POST', `/api/v1/scrape/single?${params}`);

  if (res.status !== 200) {
    throw new Error(`Justify scrape error: HTTP ${res.status} — ${JSON.stringify(res.body)}`);
  }

  return res.body; // { doc_id, title, chunks, content_hash }
}

/**
 * Статистика базы Justify.
 */
async function getJustifyStats() {
  const res = await justifyRequest('GET', '/api/v1/stats');
  return res.status === 200 ? res.body : null;
}

module.exports = {
  isJustifyAvailable,
  searchLegal,
  askJustify,
  retrieveLegalContextViaJustify,
  scrapeAndIndex,
  getJustifyStats,
};
