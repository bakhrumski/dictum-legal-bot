'use strict';

/**
 * Corrective RAG — LLM grading of retrieved chunks.
 *
 * Оценивает релевантность каждого чанка к вопросу через Claude.
 * Фильтрует нерелевантные результаты перед генерацией ответа.
 *
 * Порог: RELEVANCE_THRESHOLD = 0.5
 * Web search fallback: если < 2 хороших чанков или лучший score ≤ 0.75
 */

const RELEVANCE_THRESHOLD = 0.5;

/**
 * Grade chunks using Claude (single batch call).
 *
 * @param {string} query
 * @param {Array} chunks — массив объектов с полем chunk_text
 * @param {Function} callAI — функция callAI(messages, opts) из server.js
 * @returns {Promise<Array>} — чанки с полем relevance (0..1), отсортированные
 */
async function gradeChunks(query, chunks, callAI) {
  if (!chunks || chunks.length === 0) return [];

  // Build batch grading prompt
  let chunksText = '';
  for (let i = 0; i < chunks.length; i++) {
    const snippet = (chunks[i].chunk_text || '').substring(0, 300).replace(/\n/g, ' ');
    chunksText += `[${i}] ${snippet}\n`;
  }

  const gradingPrompt = `Оцени релевантность каждого фрагмента к вопросу.
Для каждого фрагмента ответь ОДНИМ числом от 0.0 до 1.0:
- 1.0 = точно отвечает на вопрос
- 0.7 = полезен для ответа
- 0.3 = косвенно связан
- 0.0 = не относится к вопросу

Вопрос: ${query}

Фрагменты:
${chunksText}
Ответь ТОЛЬКО в формате (по одной строке):
[0] 0.8
[1] 0.2
...`;

  try {
    const result = await callAI(
      [{ role: 'user', text: gradingPrompt }],
      { maxTokens: 256, temperature: 0 }
    );

    const scoresText = result.text || '';
    const scores = {};
    for (const m of scoresText.matchAll(/\[(\d+)\]\s*([\d.]+)/g)) {
      const idx = parseInt(m[1]);
      const score = Math.min(1.0, Math.max(0.0, parseFloat(m[2])));
      scores[idx] = score;
    }

    const graded = chunks.map((chunk, i) => ({
      ...chunk,
      relevance: scores[i] ?? 0.3,
    }));

    graded.sort((a, b) => b.relevance - a.relevance);
    console.log(`[CORRECTIVE] Grades: ${graded.slice(0, 5).map(c => c.relevance.toFixed(2)).join(', ')}`);
    return graded;

  } catch (err) {
    console.warn(`[CORRECTIVE] LLM grading failed (${err.message}), using keyword fallback`);
    return gradeByKeywords(query, chunks);
  }
}

/**
 * Keyword-based fallback grading (no LLM needed).
 */
function gradeByKeywords(query, chunks) {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  return chunks
    .map(chunk => {
      const content = (chunk.chunk_text || '').toLowerCase();
      const matches = queryWords.length
        ? queryWords.filter(w => content.includes(w)).length / queryWords.length
        : 0.3;
      return { ...chunk, relevance: matches };
    })
    .sort((a, b) => b.relevance - a.relevance);
}

/**
 * Full corrective pipeline:
 * 1. Grade chunks
 * 2. Filter by threshold
 * 3. Return { good, needsWebSearch }
 *
 * @returns {{ good: Array, needsWebSearch: boolean }}
 */
async function correctiveFilter(query, chunks, callAI) {
  const graded = await gradeChunks(query, chunks, callAI);
  const good = graded.filter(c => c.relevance >= RELEVANCE_THRESHOLD);
  const bestScore = good.length > 0 ? good[0].relevance : 0;

  const needsWebSearch = good.length < 2 || bestScore <= 0.75;

  console.log(`[CORRECTIVE] ${good.length}/${chunks.length} relevant (best=${bestScore.toFixed(2)}, webSearch=${needsWebSearch})`);
  return { good, needsWebSearch };
}

module.exports = { gradeChunks, correctiveFilter, gradeByKeywords, RELEVANCE_THRESHOLD };
