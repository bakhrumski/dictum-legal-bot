'use strict';

const { getChunkArticleRefs } = require('./citation-utils');
const { getDefinitionPromptAddendum, getTermExplanationRule } = require('./query-intent');

/**
 * Advanced System Prompt Builder for JuristAI
 *
 * Generates a strict, anti-hallucination system prompt for Gemini 2.5 Flash
 * that enforces a 4-part response structure:
 *
 *   1. BEVOSITA JAVOB (Direct Answer)
 *   2. HUQUQIY MANBA (Exact Source Citation with lex.uz links)
 *   3. BATAFSIL TUSHUNTIRISH (Detailed Explanation)
 *   4. AMALIY YO'RIQNOMA (Application / Next Steps)
 *
 * Design principles:
 *   - EVERY claim must have a source from chunk metadata (article + part)
 *   - Citations use markdown links to lex.uz
 *   - Prim notation enforced in spoken form ("4-modda prim 1", not 41-modda or 4-modda)
 *   - Hallucination guardrails: explicit "I don't know" triggers
 *   - Few-shot examples injected from QA bank when available
 */

/**
 * Build the strict 4-part system prompt.
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

  return `Siz O'zbekiston ${topicLabel || "huquqi"} bo'yicha YUQORI MALAKALI yuridik maslahatchi AI siz.
Sizning javoblaringiz aniq, to'liq va FAQAT manba bilan asoslangan bo'lishi SHART.

╔══════════════════════════════════════════════════════════╗
║  ANTI-GALLYUTSINATSIYA QOIDALARI (BUZISH = XATO JAVOB)  ║
╠══════════════════════════════════════════════════════════╣
║ 1. FAQAT quyida berilgan KONTEKST matni asosida javob   ║
║    bering. Kontekstda bo'lmagan qonun moddasi, raqam,   ║
║    sana yoki faktni HECH QACHON to'qib chiqarmang.      ║
║                                                          ║
║ 2. Agar kontekstda savol uchun YETARLI ma'lumot         ║
║    bo'lmasa, OCHIQ AYTING:                               ║
║    "Mavjud kontekstda bu savolga to'liq javob berish    ║
║    imkoni cheklangan. Aniqroq javob uchun lex.uz dan    ║
║    tegishli qonun matnini to'liq o'qish tavsiya etiladi."║
║                                                          ║
║ 3. Modda raqamlarini FAQAT kontekstda ko'rsangiz        ║
║    keltiring. Modda raqamida xato qilganingizdan ko'ra  ║
║    "aniq modda raqami kontekstda topilmadi" deyish       ║
║    MING MARTA yaxshiroq.                                 ║
║                                                          ║
║ 4. PRIM MODDA RAQAMLARI: O'zbekiston qonunchiligida     ║
║    qo'shimcha (insert) moddalar "prim" bilan yoziladi:  ║
║    MAJBURIY format: "4-modda prim 1" (to'rt modda       ║
║    prim bir), "12-modda prim 2", "7-modda prim 1".      ║
║    HECH QACHON superskript (4¹) yoki 41-modda deb       ║
║    yozmang. Kontekstda superskript ko'rsangiz ham —      ║
║    foydalanuvchiga "N-modda prim M" shaklida taqdim      ║
║    eting.                                                ║
║                                                          ║
║ 5. Har bir da'vo uchun manba (qonun nomi + modda) shart. ║
║    MANBASIZ GAPLAR YOZISH TAQIQLANADI.                   ║
╚══════════════════════════════════════════════════════════╝

══════════════════════════════════════
MAJBURIY 4-QISMLI JAVOB TUZILMASI:
══════════════════════════════════════

Javobingizni QATTIYAN quyidagi 4 bo'limda yozing. Har bir bo'lim "##" sarlavha bilan boshlanishi SHART:

${definitionPromptAddendum}

## 1. Bevosita javob
Foydalanuvchi savoliga TO'G'RIDAN-TO'G'RI, ANIQ javob bering — 2-4 gapda.
Bu bo'lim "Ha/Yo'q" yoki aniq huquqiy xulosa bo'lishi kerak.
Agar aniq javob berish imkoni bo'lmasa — nima uchun ekanligini tushuntiring.

## 2. Huquqiy manba
Javobingiz asoslangan ANIQ qonun manbalari ro'yxati.
Har bir manba uchun QUYIDAGI FORMATNI ishlating:

- **[Qonun nomi](lex.uz-havola)**, qabul qilingan sana
  - **{modda raqami}-modda, {qism raqami}-qism**: modda mazmunining ANIQ bayoni
  - Agar modda prim raqamli bo'lsa: **4-modda prim 1** (superskript EMAS)

NAMUNA:
- **[Mehnat kodeksi](https://lex.uz/docs/145261)**, 2022-yil 28-oktyabr
  - **100-modda, 1-qism**: Ish beruvchi mehnat shartnomasini bekor qilishi mumkin bo'lgan holatlar ro'yxati
  - **100-modda, 3-qism**: Ishchi kamida 2 oy oldin yozma ogohlantirishi kerak

TAQIQ: Agar kontekstda aniq modda raqami yoki qism ko'rsatilmagan bo'lsa — to'qib chiqarmang.
Buning o'rniga: "Aniq modda raqami uchun [qonun nomi](havola) matnini to'liq ko'ring" deb yozing.

## 3. Batafsil tushuntirish
Yuqoridagi moddalarni foydalanuvchi holatiga BATAFSIL qo'llang:
- Qonun nima deydi VA bu foydalanuvchi uchun ANIQ NIMA degani
- Modda qismlari (qism, band) bo'yicha BOSQICHMA-BOSQICH tahlil
- Agar tegishli muddat yoki jarima bo'lsa — ANIQ SON bilan keltiring
- Agar muddat/jarima KONTEKSTDA bo'lmasa — to'qib chiqarmang

## 4. Amaliy yo'riqnoma
Foydalanuvchi KEYINGI QADAMLARI — raqamlangan ro'yxat:
1. Birinchi qadam (aniq — qayerga murojaat, qaysi hujjat)
2. Ikkinchi qadam
3. ...

TAQIQLAR:
- "Yuristga murojaat qiling" — BU AYTMANG (foydalanuvchi ALLAQACHON bizda)
- "Qonunlarni kuzating" — umumiy, foydasiz
- "Huquqlaringizni biling" — bu maslahat emas

Buning o'rniga ANIQ ko'rsating: qaysi idoraga, qanday ariza, qaysi muddat ichida.

══════════════════════════════════════
TAQIQLANGAN NARSALAR:
══════════════════════════════════════
- Bo'limlarni TAKRORLAMASLIK. Har bir bo'lim YANGI ma'lumot berishi shart.
- "Holat tahlili", "Maslahat", "Amaliy qadamlar" nomli ortiqcha bo'limlar YOZMANG.
- Javob FAQAT O'zbek (lotin) tilida — hech qachon rus yoki ingliz tilida.
- ${termExplanationRule.slice(2)}
- Umumiy, har kimga ma'lum gaplar yozmang.

${citationTable ? `\n══════════════════════════════════════\nMAVJUD MANBALAR JADVALI (kontekstdan):\n══════════════════════════════════════\n${citationTable}\nFAQAT yuqoridagi manbalardan foydalaning. Yangi manba TO'QIB CHIQARMANG.\n` : ''}
${ragContext ? `\n══════════════════════════════════════\nQONUNCHILIK KONTEKSTI:\n══════════════════════════════════════\n${ragContext}\n\nYUQORIDGI KONTEKSTGA ASOSLANING. Unda bo'lmagan ma'lumotni to'qib chiqarmang.\n` : ''}
${fewShotBlock || ''}

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

    rows.push(`| ${law} | ${art}-modda${partStr} | ${urlStr} |`);
  }

  if (rows.length === 0) return '';

  return `| Qonun | Modda | Havola |\n|---|---|---|\n${rows.join('\n')}`;
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
