'use strict';

/**
 * Two parts of a legal answer's layout (2026-10-13, owner, after a
 * competitor's answer: the rule quoted word for word, a link that opens it
 * highlighted, and suggested next questions under the answer). The sections
 * are "Tahlil / Xulosa" since 2026-10-24 (owner: a separate "Huquqiy asos"
 * repeated them); the quote sits in Tahlil where the norm is named.
 *
 * 1. A quote. The model may put the decisive words of a norm on their own
 *    line as `> «...»`, copied from KONTEKST. The server keeps a quote only
 *    when its words are in a retrieved source WORD FOR WORD (spaces, case and
 *    apostrophe forms aside; "..." may skip words between parts, each part
 *    found in order in one source); it then gets a "lex.uz ↗" link that
 *    opens that source highlighted from the quote's first word to its last.
 *    A quote not found is removed - an invented quotation reads as the law.
 *    No AI call.
 * 2. Next questions. The model ends with a `KEYINGI SAVOLLAR:` block of at
 *    most two questions; the server takes it out of the answer text and
 *    returns it apart (web chat: buttons under the answer). No AI call.
 */

const QUOTE_LINK_LABEL = 'lex.uz ↗';

const QUOTE_RULE_UZ = `- Tahlilda, hal qiluvchi normani keltirgan joyda, uning aynan so'zlarini (1-2 gap) alohida qatorda "> «...»" ko'rinishida keltiring: faqat KONTEKSTdagi matndan, harfma-harf ko'chirib, tarjima qilmasdan va qisqartirmasdan (o'rtadan tushirib qoldirsangiz "..." qo'ying). Iqtibos qatoriga havola yoki izoh yozmang; normaning nomi va moddasi iqtibosdan oldingi gapda bo'lsin. Server iqtibosni manba bilan solishtiradi: so'zma-so'z topilmagan iqtibos javobdan olib tashlanadi. Iqtibos ko'pi bilan 3 ta.`;
const QUOTE_RULE_RU = `- В анализе, там где названа решающая норма, приведите её точные слова (1-2 предложения) отдельной строкой "> «...»": только из КОНТЕКСТа, буква в букву, без перевода и сокращений (пропуск внутри обозначьте "..."). В строке цитаты нет ссылки и комментария; название акта и статья - в предложении перед цитатой. Сервер сверяет цитату с источником: цитата, не найденная дословно, удаляется. Не более 3 цитат.`;

const FOLLOWUP_RULE_UZ = `- Javob oxirida, Xulosadan keyin, "KEYINGI SAVOLLAR:" qatori va uning ostida "- " bilan foydalanuvchi keyin berishi mumkin bo'lgan 2 ta qisqa savolni yozing (shu mavzuda, foydalanuvchi tilida, "?" bilan). Bu blok javobdan alohida tugma bo'lib ko'rsatiladi.`;
const FOLLOWUP_RULE_RU = `- В конце ответа, после вывода, напишите строку "KEYINGI SAVOLLAR:" и под ней через "- " 2 коротких вопроса, которые пользователь может задать дальше (по теме, на языке пользователя, с "?"). Этот блок показывается отдельно кнопками.`;

// 2026-10-27: an IT Park answer cited the general rule (VMQ-589 band 5) and
// said no exemption exists, while band 17 grants one. An exception or a right
// in the sources decides such a question and comes first.
const EXCEPTION_RULE_UZ = `- Istisno birinchi: KONTEKSTda savoldagi talabdan istisno, ozod qilish yoki maxsus huquq bo'lsa ("...olmasdan", "...talab qilinmaydi", "ozod etiladi", "...huquqiga ega"), Tahlilni o'sha normadan boshlang va Xulosani unga asoslang; umumiy talabni undan keyin keltiring. "SAVOLGA ENG YAQIN QATOR" belgisi server so'zlar bo'yicha tanlagan qator - uni albatta o'qing, lekin matn bilan tekshirmasdan asos qilmang. "Istisno yo'q" deb faqat KONTEKSTdagi barcha manbalarni o'qib, bunday norma topilmaganda yozing.`;
const EXCEPTION_RULE_RU = `- Сначала исключение: если в КОНТЕКСТе есть исключение, освобождение или особое право относительно требования из вопроса ("...без получения", "не требуется", "освобождается", "вправе"), начните анализ с этой нормы и основывайте вывод на ней; общее требование - после. Метка "SAVOLGA ENG YAQIN QATOR" - строка, выбранная сервером по словам: прочтите её, но не делайте основанием без сверки с текстом. "Исключения нет" пишите только прочитав все источники КОНТЕКСТа.`;

/** The exception-first rule alone, for prompts that do not take promptRules. */
function exceptionRule(lang = 'uz') {
  return lang === 'ru' ? EXCEPTION_RULE_RU : EXCEPTION_RULE_UZ;
}

function promptRules(lang = 'uz') {
  return lang === 'ru'
    ? `${QUOTE_RULE_RU}\n${EXCEPTION_RULE_RU}\n${FOLLOWUP_RULE_RU}`
    : `${QUOTE_RULE_UZ}\n${EXCEPTION_RULE_UZ}\n${FOLLOWUP_RULE_UZ}`;
}

const FOLLOWUP_HEAD = /^[ \t]*(?:#{1,6}[ \t]*)?\**[ \t]*(?:keyingi\s+savollar|следующие\s+вопросы)[ \t]*\**[ \t]*:?[ \t]*\**[ \t]*$/imu;

/** { text, questions }: the block taken out (at most 2 questions, each with "?"). */
function extractFollowUpQuestions(text = '') {
  const value = String(text || '');
  const m = FOLLOWUP_HEAD.exec(value);
  if (!m) return { text: value, questions: [] };
  const after = value.slice(m.index + m[0].length).split('\n');
  const questions = [];
  let consumed = 0;
  for (const line of after) {
    const t = line.trim();
    if (!t) { consumed++; if (questions.length) break; continue; }
    const q = /^(?:[-*•]|\d+[.)])\s+(.+)$/u.exec(t);
    if (!q) break;
    consumed++;
    const question = q[1].replace(/[*_`]/gu, '').replace(/\s+/gu, ' ').trim();
    if (question.length >= 8 && question.length <= 200 && /\?$/u.test(question) && questions.length < 2) questions.push(question);
  }
  const rest = [value.slice(0, m.index).replace(/\s+$/u, ''), after.slice(consumed).join('\n').trim()].filter(Boolean).join('\n\n');
  return { text: rest, questions };
}

const APOS = "['\\u2018\\u2019\\u02bb\\u02bc`\\u00b4]";
const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** A pattern for one quoted part: any space run, any apostrophe form, any quote form. */
function partPattern(part = '') {
  return part.trim().split(/\s+/u).map(word => word.split('').map((ch) => {
    if (/['‘’ʻʼ`´]/u.test(ch)) return APOS;
    if (/[«»"“”„]/u.test(ch)) return '[«»"“”„]';
    return escapeRx(ch);
  }).join('')).join('\\s+');
}

function sourceTexts(chunk = {}) {
  return [chunk.parentText, chunk.chunk_text, chunk.childText, chunk.content, chunk.text]
    .filter(t => typeof t === 'string' && t.trim());
}

/**
 * Where a quote is in the sources: { chunk, parts: [the source's own words
 * of each part] } or null. Parts split at "..." / "…" must each have 3+
 * words and be found in order in one source text.
 */
function findQuote(quote = '', chunks = []) {
  const parts = String(quote || '').split(/\s*(?:\.{3}|…)\s*/u).map(p => p.trim()).filter(Boolean);
  if (!parts.length || parts.some(p => p.split(/\s+/u).length < 3) || parts.join(' ').length < 20) return null;
  for (const chunk of chunks || []) {
    for (const text of sourceTexts(chunk)) {
      let from = 0;
      const own = [];
      for (const part of parts) {
        const rx = new RegExp(partPattern(part), 'iu');
        const m = rx.exec(text.slice(from));
        if (!m) { own.length = 0; break; }
        own.push(m[0]);
        from += m.index + m[0].length;
      }
      if (own.length === parts.length) return { chunk, parts: own, text, at: from };
    }
  }
  return null;
}

const QUOTE_LINE = /^[ \t]*>[ \t]*(.+)$/u;

/** The words of a quote line: the «...» inside, else the line without its link. */
function quoteWords(line = '') {
  const body = line.replace(/\s*\[[^\]]*\]\([^)\s]*\)\s*$/u, '').trim();
  const inner = /[«"“„]([\s\S]+)[»"”]/u.exec(body);
  return (inner ? inner[1] : body).replace(/[*_]/gu, '').replace(/\s+/gu, ' ').trim().replace(/^[.…]+|[;:,]$/gu, '').trim();
}

const isNotice = line => /⚠️|AI\s+tahlili|ИИ|litsenziyalangan/u.test(line);

/**
 * Takes the quote lines out before citations are linked (so nothing is
 * linked or marked inside the law's own words) and gives back a function
 * that puts each back - verified and linked, or removed.
 * linkFor(chunk, parts) builds the highlight link (citation-utils).
 */
function protectQuotes(text = '') {
  const lines = String(text || '').split('\n');
  const held = [];
  const out = lines.map((line) => {
    const m = QUOTE_LINE.exec(line);
    if (!m || isNotice(line)) return line;
    held.push(line);
    return `\u0000Q${held.length - 1}\u0000`;
  });
  return { text: out.join('\n'), held };
}

/**
 * Where a quote stands, for its link (2026-10-27, owner: an answer opened
 * with a law quote whose act and band were nowhere): the act's own number
 * (VMQ-589, PQ-4008...) or its short name, and the article or band the quote
 * sits in - the heading nearest above it in the source text, or the unit of a
 * "SAVOLGA ENG YAQIN QATOR (17-band)" line. "" when neither is known.
 */
function quoteSourceLabel(hit = {}) {
  const chunk = hit.chunk || {};
  let id = '';
  try { id = require('./citation-utils').getChunkDocumentIdentifier(chunk) || ''; } catch (_) { id = ''; }
  const name = String(chunk.law_name || chunk.lawName || '')
    .replace(/^\s*O['\u2018\u2019\u02bb]?zbekiston\s+Respublikasi(?:ning)?\s+/iu, '')
    .replace(/\s+/gu, ' ').trim();
  const act = id || (name.length > 48 ? `${name.slice(0, 46).replace(/\s+\S*$/u, '')}…` : name);
  const text = String(hit.text || '');
  const at = Number(hit.at) || 0;
  const before = text.slice(0, at);
  const lineStart = before.lastIndexOf('\n') + 1;
  const keyUnit = /^SAVOLGA ENG YAQIN QATOR \(([^)]+)\)/u.exec(text.slice(lineStart, lineStart + 80));
  let unit = keyUnit ? keyUnit[1] : '';
  if (!unit) {
    const heads = [...before.matchAll(/(?:^|\n)[ \t]*(\d{1,4})(?:[\u2070\u00B9\u00B2\u00B3\u2074-\u2079]*)[ \t]*(?:-[ \t]*(modda)|\.[ \t])/gu)];
    const last = heads[heads.length - 1];
    if (last) unit = last[2] ? `${last[1]}-modda` : `${last[1]}-band`;
  }
  return [act, unit].filter(Boolean).join(', ');
}

function restoreQuotes(text = '', held = [], chunks = [], linkFor = () => '') {
  const report = { kept: 0, removed: 0, removedQuotes: [] };
  const restored = String(text || '').replace(/\u0000Q(\d+)\u0000/gu, (whole, i) => {
    const line = held[Number(i)] || '';
    const words = quoteWords(line);
    // a quote that already carries its verified link (a cached answer) stays
    if (new RegExp(`\\[(?:[^\\]]* · )?${escapeRx(QUOTE_LINK_LABEL)}\\]\\(https?://(?:www\\.)?lex\\.uz/[^)\\s]+#:~:text=`, 'u').test(line) && !(chunks || []).length) {
      report.kept++;
      return line;
    }
    const hit = findQuote(words, chunks);
    if (!hit) {
      report.removed++;
      report.removedQuotes.push(words.slice(0, 200));
      return '\u0000DROP\u0000';
    }
    report.kept++;
    const link = linkFor(hit.chunk, hit.parts);
    // the source's own words are shown (its letters, its apostrophes)
    const own = hit.parts.map(p => p.replace(/\s+/gu, ' ').trim()).join(' ... ');
    const where = quoteSourceLabel(hit);
    return `> «${own}»${link ? ` [${where ? `${where} · ` : ''}${QUOTE_LINK_LABEL}](${link})` : ''}`;
  });
  const cleaned = restored
    .split('\n').filter(l => !l.includes('\u0000DROP\u0000')).join('\n')
    .replace(/\n{3,}/gu, '\n\n');
  return { text: cleaned, report };
}

module.exports = {
  exceptionRule,
  QUOTE_LINK_LABEL, quoteSourceLabel, promptRules, extractFollowUpQuestions, findQuote, quoteWords, protectQuotes, restoreQuotes,
};
