'use strict';

/**
 * What a chat with a document really is (tariffs v2, 2026-10-05).
 *
 * An attached file does not make a request a document analysis, and a chat
 * unit must not buy one: the service is decided by the work asked for.
 *
 *   - A question ABOUT the document ("is clause 5 lawful?") is a chat
 *     answer. The model gets only the parts of the document that bear on the
 *     question, at most CHAT_DOCUMENT_CONTEXT_CHARS (half an analysis unit),
 *     and is told it saw excerpts, so it does not present a full review.
 *   - A request to analyse, review, or write an opinion on the document is a
 *     document job: it is sized in analysis units from the whole document,
 *     the size and units are shown before it runs, and it is charged as an
 *     analysis only - never also as a chat.
 *
 * The same rule serves the web chat, Workspace (its document context is the
 * same cap, src/workspace/ai-service.js) and Telegram (which does not run AI
 * on files at all: a file goes to the lawyer queue).
 */

// Half of one analysis unit (40 000 characters): enough for the clauses a
// question is about, not enough to stand in for an analysis.
const CHAT_DOCUMENT_CONTEXT_CHARS = 20000;
// The start of a document (title, parties, date) is kept in every excerpt.
const HEAD_CHARS = 1500;

const APO = "['ʻʼ‘’`]?";
const FULL_WORK = new RegExp([
  // Uzbek (Latin): "hujjatni tahlil qiling", "shartnomani tekshirib bering", "to'liq ko'rib chiqing"
  `(hujjat|shartnoma|fayl|ilova|matn|kelishuv|bitim)\\p{L}*[^.?!\\n]{0,60}?(tahlil|tekshir|ko${APO}rib\\s+chiq|xulosa|baho|xavf|risk)`,
  `(tahlil|xulosa)\\p{L}*\\s+(qil|ber|yoz|tayyorla|chiqar)`,
  `to${APO}liq\\s+(tahlil|ko${APO}rib|tekshir)`,
  `yuridik\\s+xulosa`,
  // Uzbek (Cyrillic)
  `(ҳужжат|шартнома|файл)\\p{L}*[^.?!\\n]{0,60}?(таҳлил|текшир|кўриб\\s+чиқ|хулоса)`,
  `(таҳлил|хулоса)\\p{L}*\\s+(қил|бер|ёз|тайёрла)`,
  // Russian
  `проанализ\\p{L}*`,
  `анализ\\p{L}*\\s+(документ|договор|контракт|файл)`,
  `(провер|изуч)\\p{L}*\\s+(документ|договор|контракт|файл)`,
  `заключени\\p{L}*\\s+(по|на)\\s+(документ|договор|контракт)`,
  `юридическ\\p{L}*\\s+заключени`,
].join('|'), 'iu');

/** True when the request asks for work on the whole document (analysis, review, opinion). */
function isFullDocumentRequest(text = '') {
  return FULL_WORK.test(String(text || ''));
}

function terms(question) {
  return [...new Set(String(question || '').toLocaleLowerCase('uz-UZ')
    .replace(/[‘’ʻʼ`']/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(t => t.length >= 4 || /^\d+$/u.test(t)))];
}

/**
 * The parts of `doc` that bear on `question`, in document order, at most
 * maxChars: the head of the document, then the paragraphs that share the
 * most terms (clause numbers included) with the question.
 * Returns { text, usedChars, totalChars, excerpt }.
 */
function selectExcerpt(doc = '', question = '', maxChars = CHAT_DOCUMENT_CONTEXT_CHARS) {
  const full = String(doc || '').trim();
  if (full.length <= maxChars) return { text: full, usedChars: full.length, totalChars: full.length, excerpt: false };
  const head = full.slice(0, HEAD_CHARS);
  const rest = full.slice(HEAD_CHARS);
  const paras = rest.split(/\n\s*\n|\n(?=\s*(?:\d+[.)]|[-•]|\p{Lu}))/u).map((t, i) => ({ t: t.trim(), i })).filter(p => p.t);
  const qt = terms(question);
  const stem = t => (/^\d+$/u.test(t) ? t : t.slice(0, Math.max(4, t.length - 2)));
  const lowered = paras.map(p => p.t.toLocaleLowerCase('uz-UZ').replace(/[\u2018\u2019\u02BB\u02BC`']/gu, ''));
  // a word found in every paragraph ("band", "modda") says little; a rare
  // one ("jarima") says where the answer is: weight by inverse frequency
  const weight = Object.fromEntries(qt.map(t => {
    const df = lowered.filter(l => l.includes(stem(t))).length;
    return [t, df ? Math.log((paras.length + 1) / df) : 0];
  }));
  const scored = paras.map((p, k) => ({ ...p, hits: qt.reduce((n, t) => n + (lowered[k].includes(stem(t)) ? weight[t] : 0), 0) }));
  const budget = maxChars - head.length - 40;
  const chosen = [];
  let used = 0;
  for (const p of [...scored].sort((a, b) => b.hits - a.hits || a.i - b.i)) {
    if (!p.hits && chosen.length) break;
    const piece = p.t.length > budget - used ? p.t.slice(0, Math.max(0, budget - used)) : p.t;
    if (!piece) break;
    chosen.push({ ...p, t: piece });
    used += piece.length + 6;
    if (used >= budget) break;
  }
  chosen.sort((a, b) => a.i - b.i);
  const text = [head, ...chosen.map(p => p.t)].join('\n[…]\n');
  return { text, usedChars: text.length, totalChars: full.length, excerpt: true };
}

/** The instruction the model gets when it only sees excerpts of a document. */
function excerptInstruction(scope, lang = 'uz') {
  if (!scope || !scope.excerpt) return '';
  return lang === 'ru'
    ? `\n\nВАЖНО: из приложенного документа (${scope.totalChars} знаков) даны только относящиеся к вопросу фрагменты (${scope.usedChars} знаков). Отвечайте только на вопрос по этим фрагментам; не выдавайте ответ за полный анализ документа.`
    : `\n\nMUHIM: ilova qilingan hujjatdan (${scope.totalChars} belgi) faqat savolga oid parchalar (${scope.usedChars} belgi) berildi. Faqat shu parchalar asosida savolga javob bering; javobni butun hujjatning to'liq tahlili deb ko'rsatmang.`;
}

/** The note the user sees under such an answer. */
function excerptNote(scope, analysisUnits = null) {
  if (!scope || !scope.excerpt) return '';
  return `ℹ️ Hujjatning savolga oid qismlari (${scope.usedChars.toLocaleString('ru-RU')} / ${scope.totalChars.toLocaleString('ru-RU')} belgi) ishlatildi. `
    + `Butun hujjatni tahlil qilish — alohida xizmat${analysisUnits ? ` (${analysisUnits} birlik)` : ''}: «Hujjat tahlili» yoki «Yuridik xulosa».`;
}

module.exports = { CHAT_DOCUMENT_CONTEXT_CHARS, isFullDocumentRequest, selectExcerpt, excerptInstruction, excerptNote };
