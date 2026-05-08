'use strict';

const { pool } = require('../database/db');
const { runAgent } = require('./runner');
const { CLASSIFIER_PROMPT, LEGAL_FIELD_MAP } = require('./prompts');

/**
 * Legal Field Classifier Agent
 *
 * Detects the precise legal domain of a user question using GPT.
 * Returns exactly one field from the canonical list.
 * Stores the result in requests.detected_legal_field.
 */

/**
 * Classify the legal field of a user question.
 *
 * @param {string} userQuestion - The user's legal question text
 * @param {number|null} requestId - Optional request ID to store result in DB
 * @returns {Promise<{ legal_field: string, confidence: number, reasoning: string }>}
 */
async function classifyLegalField(userQuestion, requestId = null) {
  if (!userQuestion || userQuestion.trim().length < 5) {
    return { legal_field: 'Boshqa', confidence: 0, reasoning: 'Savol juda qisqa' };
  }

  const userMessage = `Foydalanuvchi savoli:\n\n${userQuestion.substring(0, 2000)}`;

  const { output, error } = await runAgent('classifier', requestId, {
    messages: [
      { role: 'user', text: CLASSIFIER_PROMPT + '\n\n' + userMessage }
    ],
    options: { temperature: 0.1, maxTokens: 256 }
  }, {
    inputSummary: userQuestion.substring(0, 200)
  });

  if (error || !output || output.error) {
    console.error(`[CLASSIFIER] Failed:`, error || output?.error);
    return { legal_field: 'Boshqa', confidence: 0, reasoning: 'Klassifikatsiya xatoligi' };
  }

  // Validate against canonical list
  const validFields = Object.keys(LEGAL_FIELD_MAP);
  const detectedField = validFields.find(f =>
    f === output.legal_field ||
    f.toLowerCase() === (output.legal_field || '').toLowerCase()
  ) || 'Boshqa';

  const result = {
    legal_field: detectedField,
    confidence: Math.min(Math.max(Number(output.confidence) || 0, 0), 100),
    reasoning: (output.reasoning || '').substring(0, 500)
  };

  // Store in DB if requestId provided
  if (requestId) {
    try {
      await pool.query(
        `UPDATE requests SET detected_legal_field = $1 WHERE id = $2`,
        [result.legal_field, requestId]
      );
    } catch (e) {
      console.error('[CLASSIFIER] DB update error:', e.message);
    }
  }

  console.log(`[CLASSIFIER] "${userQuestion.substring(0, 60)}..." => ${result.legal_field} (${result.confidence}%)`);
  return result;
}

/**
 * Get the legislation priority map for a detected legal field.
 * Returns the primary codes/laws to prioritize in search and retrieval.
 */
function getLegislationPriority(legalField) {
  return LEGAL_FIELD_MAP[legalField] || LEGAL_FIELD_MAP['Boshqa'];
}

/**
 * Format the classification result as a prompt block for AI analysis.
 */
function formatClassificationForPrompt(classification) {
  if (!classification || !classification.legal_field || classification.legal_field === 'Boshqa') {
    return '';
  }

  const priority = getLegislationPriority(classification.legal_field);

  return `ANIQLANGAN HUQUQIY SOHA: ${classification.legal_field}
Ishonchlilik: ${classification.confidence}%

USTUVOR QONUNCHILIK (shu soha uchun):
${priority.primary.map(p => `- ${p}`).join('\n')}

${priority.secondary.length > 0 ? `Qo'shimcha manbalar:\n${priority.secondary.map(s => `- ${s}`).join('\n')}` : ''}

MUHIM: Yuqoridagi qonunchilikni birinchi navbatda web search orqali tekshiring.
Boshqa sohalar normalarini ham ko'rib chiqing agar tegishli bo'lsa.`;
}

module.exports = {
  classifyLegalField,
  getLegislationPriority,
  formatClassificationForPrompt
};
