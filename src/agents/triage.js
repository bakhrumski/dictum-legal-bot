'use strict';

const { pool } = require('../database/db');
const { runAgent } = require('./runner');
const { TRIAGE_PROMPT } = require('./prompts');

/**
 * Triage Agent — Automatically classifies incoming legal requests.
 *
 * Called async (fire-and-forget) after a request is created in bot.js.
 * Stores result in requests.triage_result JSONB column.
 */

/**
 * Run triage on a request.
 * @param {number} requestId
 * @param {string} requestText
 * @param {string} [requestType='text'] - text|voice|video|document|photo
 * @returns {Promise<object>} triage result
 */
async function triageRequest(requestId, requestText, requestType = 'text') {
  // Skip if no text content (voice/video without transcription)
  if (!requestText || requestText.trim().length < 5) {
    const fallback = {
      category: 'Boshqa',
      subcategory: 'Aniqlanmadi',
      urgency: 'medium',
      jurisdiction: "O'zbekiston Respublikasi",
      key_topics: [],
      suggested_assignee_specialty: 'Umumiy',
      complexity: 'low',
      needs_document: requestType !== 'text',
      summary: requestType !== 'text'
        ? `${requestType} formatidagi murojaat — matn tahlil qilib bo'lmadi`
        : 'Murojaat juda qisqa'
    };
    await pool.query(
      'UPDATE requests SET triage_result = $1 WHERE id = $2',
      [JSON.stringify(fallback), requestId]
    );
    return fallback;
  }

  const userMessage = `Murojaat matni:\n\n${requestText.substring(0, 2000)}`;

  const { output, error } = await runAgent('triage', requestId, {
    messages: [
      { role: 'user', text: TRIAGE_PROMPT + '\n\n' + userMessage }
    ],
    options: { temperature: 0.2, maxTokens: 1024 }
  }, {
    inputSummary: requestText.substring(0, 200)
  });

  if (error || !output || output.error) {
    console.error(`[TRIAGE] Failed for request #${requestId}:`, error || output?.error);
    return null;
  }

  // Validate and normalize the output
  const result = {
    category: output.category || 'Boshqa',
    subcategory: output.subcategory || '',
    urgency: ['low', 'medium', 'high', 'critical'].includes(output.urgency) ? output.urgency : 'medium',
    jurisdiction: output.jurisdiction || "O'zbekiston Respublikasi",
    key_topics: Array.isArray(output.key_topics) ? output.key_topics.slice(0, 5) : [],
    suggested_assignee_specialty: output.suggested_assignee_specialty || '',
    complexity: ['low', 'medium', 'high'].includes(output.complexity) ? output.complexity : 'medium',
    needs_document: !!output.needs_document,
    summary: (output.summary || '').substring(0, 500)
  };

  // Store in requests table
  await pool.query(
    'UPDATE requests SET triage_result = $1, category = $2 WHERE id = $3',
    [JSON.stringify(result), result.category, requestId]
  );

  console.log(`[TRIAGE] Request #${requestId}: ${result.category} / ${result.urgency} / ${result.complexity}`);
  return result;
}

module.exports = { triageRequest };
