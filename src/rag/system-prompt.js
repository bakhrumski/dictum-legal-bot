'use strict';

const { getChunkArticleRefs, canonicalCitationActLabel } = require('./citation-utils');
const { getDefinitionPromptAddendum, getTermExplanationRule } = require('./query-intent');
const {
  buildQuestionResearchDirective,
} = require('./legal-research-playbook');
const { buildLegalResearchPolicyPrefix } = require('./legal-prompt-policy');

/**
 * Advanced System Prompt Builder for JuristAI
 *
 * Generates the capability-specific legal-consultation prompt beneath the
 * shared constitution and research playbook. It enforces a 3-part response:
 *
 *   1. HUQUQIY ASOS (Applicable law)
 *   2. TAHLIL (Application to the user's facts)
 *   3. XULOSA (Direct conclusion)
 *
 * Design principles:
 *   - EVERY claim must have a source from chunk metadata (article + part)
 *   - Citations use markdown links to lex.uz
 *   - Prim notation enforced in superscript form ("4¹-modda", not "4-modda prim 1" or 41)
 *   - Hallucination guardrails: explicit "I don't know" triggers
 *   - Few-shot examples injected from QA bank when available
 */

/**
 * Build the strict 3-part legal-consultation system prompt.
 *
 * @param {Object} opts
 * @param {string} opts.topic - legal category key (e.g. 'mehnat')
 * @param {string} opts.topicLabel - display name (e.g. 'Mehnat huquqi')
 * @param {string} opts.ragContext - formatted RAG chunks with metadata
 * @param {string} opts.fewShotBlock - formatted QA bank examples
 * @param {Object[]} opts.retrievedChunks - raw chunk objects for citation metadata
 * @param {string} opts.userQuestion - raw user question for intent-aware prompt rules
 * @returns {string}
 */
function buildAdvancedPrompt(opts = {}) {
  const {
    topic = '',
    topicLabel = '',
    ragContext = '',
    fewShotBlock = '',
    retrievedChunks = [],
    userQuestion = '',
  } = opts;

  // Build citation reference table from retrieved chunks
  const citationTable = buildCitationTable(retrievedChunks);
  const definitionPromptAddendum = getDefinitionPromptAddendum(userQuestion);
  const termExplanationRule = getTermExplanationRule(userQuestion);
  const researchDirective = buildQuestionResearchDirective({
    question: userQuestion,
    topic,
    language: 'uz',
  });

  return `${buildLegalResearchPolicyPrefix()}

IMKONIYAT SHARTNOMASI — HUQUQIY MASLAHAT:
Siz O'zbekiston ${topicLabel || "huquqi"} bo'yicha yuqori malakali yuridik maslahatchi AI siz.
Sizning javoblaringiz aniq, to'liq va FAQAT manba bilan asoslangan bo'lishi SHART.

══════════════════════════════════════
MAJBURIY 3-QISMLI JAVOB TUZILMASI:
══════════════════════════════════════

Javobingizni QATTIYAN quyidagi 3 bo'limda yozing. Alohida "Manbalar" yoki "Huquqiy manba" bo'limini yaratmang:

${definitionPromptAddendum}

**Huquqiy asos**
Savolga bevosita tatbiq etiladigan normalarni qisqa bayon qiling. Konstitutsiyadagi iqtibos uslubiga amal qiling; interfeys havolani keyin biriktiradi.

**Tahlil**
Normalarni foydalanuvchi holatiga BATAFSIL qo'llang:
- Qonun nima deydi VA bu foydalanuvchi uchun ANIQ NIMA degani
- Modda qismlari (qism, band) bo'yicha BOSQICHMA-BOSQICH tahlil
- Agar tegishli muddat yoki jarima bo'lsa — ANIQ SON bilan keltiring
- Agar muddat/jarima KONTEKSTDA bo'lmasa — to'qib chiqarmang

**Xulosa**
Foydalanuvchi savoliga to'g'ridan-to'g'ri natijani 1-2 gapda ayting. Keyingi amaliy variantlar alohida platforma komponenti tomonidan yaratiladi; javob matnida tasodifiy xizmatlar ro'yxatini tuzmang.

Qo'shimcha imkoniyat qoidalari:
- "Holat tahlili", "Maslahat", "Amaliy qadamlar" nomli ortiqcha bo'limlar yozmang.
- ${termExplanationRule.slice(2)}
- Umumiy, har kimga ma'lum gaplar yozmang.

${citationTable ? `\n══════════════════════════════════════\nMAVJUD MANBALAR JADVALI (kontekstdan):\n══════════════════════════════════════\n${citationTable}\nFAQAT yuqoridagi manbalardan foydalaning. Yangi manba TO'QIB CHIQARMANG.\n` : ''}
${ragContext ? `\n══════════════════════════════════════\nQONUNCHILIK KONTEKSTI:\n══════════════════════════════════════\n${ragContext}\n\nYUQORIDGI KONTEKSTGA ASOSLANING. Unda bo'lmagan ma'lumotni to'qib chiqarmang.\n` : ''}
${fewShotBlock || ''}

${researchDirective}

> ⚠️ Bu javob AI tahlili asosida. Muhim qarorlar uchun litsenziyalangan yuristga murojaat qiling.`;
}

/**
 * Build a citation reference table from retrieved chunks.
 * This gives the LLM a structured "cheat sheet" of available sources.
 */
function buildCitationTable(chunks) {
  if (!chunks || chunks.length === 0) return '';

  const rows = [];
  const seen = new Set();

  for (const chunk of chunks) {
    const art = getChunkArticleRefs(chunk)[0] || '';
    const law = chunk.lawName || chunk.law_name || '';
    const part = chunk.partNumber || chunk.part_number || '';
    const url = chunk.sourceUrl || chunk.source_url || '';

    const key = `${law}_${art}_${part}`;
    if (seen.has(key) || !art) continue;
    seen.add(key);

    const partStr = part ? `, ${part}-qism` : '';
    const urlStr = url ? ` (${url})` : '';

    rows.push(`| ${canonicalCitationActLabel(law, chunk)} | ${art}-modda${partStr} | ${urlStr} |`);
  }

  if (rows.length === 0) return '';

  return `| Hujjat nomi va rasmiy raqami | Norma | Havola |\n|---|---|---|\n${rows.join('\n')}`;
}

/**
 * Format retrieved parent-child chunks for prompt injection.
 *
 * @param {Array} searchResults - from parentChildSearch() or legacy search
 * @param {string} language - 'uz' or 'ru'
 * @returns {string}
 */
function formatAdvancedContext(searchResults, language = 'uz') {
  if (!searchResults || searchResults.length === 0) return '';

  const isUz = language === 'uz';

  return searchResults.map((r, i) => {
    const score = r.score ? ` (${(r.score * 100).toFixed(0)}%)` : '';
    const artLabel = r.articleNumber ? `${r.articleNumber}-modda` : '';
    const partLabel = r.partNumber ? `, ${r.partNumber}-qism` : '';

    const lines = [
      `[${i + 1}] ${r.lawName}${score}`,
      r.chapter ? `  Bob: ${r.chapter}` : '',
      artLabel ? `  ${isUz ? 'Modda' : 'Статья'}: ${artLabel}${partLabel}` : '',
      r.sourceUrl ? `  Havola: ${r.sourceUrl}` : '',
      `  ---`,
      // Include child (precise) text first, then parent (full context)
      r.childText !== r.parentText
        ? `  [ANIQ QISM]: ${r.childText}\n  [TO'LIQ MODDA]: ${r.parentText}`
        : `  ${r.parentText}`,
    ].filter(Boolean);

    return lines.join('\n');
  }).join('\n\n');
}

module.exports = {
  buildAdvancedPrompt,
  buildCitationTable,
  formatAdvancedContext,
};
