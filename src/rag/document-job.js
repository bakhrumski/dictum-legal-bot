'use strict';

/**
 * What a chat with a document really is (tariffs v2, 2026-10-05).
 *
 * An attached file does not make a request a document analysis, and a chat
 * unit must not buy one: the service is decided by the work asked for.
 *
 *   - A question ABOUT the document ("is clause 5 lawful?") is a chat
 *     answer. The model gets the parts of the document that bear on the
 *     question - the matching clauses, the definitions of the terms they
 *     use, the clauses they refer to and the exceptions that refer back to
 *     them - at most CHAT_DOCUMENT_CONTEXT_CHARS, and is told it saw
 *     excerpts. When the excerpts do not hold enough to answer (nothing
 *     matched, or a clause they rely on did not fit), the model is told to
 *     say so and not to conclude, and the user is offered the full service.
 *   - A request to analyse / review the whole document is a document
 *     analysis (analysis quota); a request for a legal opinion on it is an
 *     AI legal opinion (opinion quota). Each is sized in units from the
 *     whole document, shown before it runs, and charged as that service
 *     only - never also as a chat. A request for both is two jobs, each from
 *     its own quota, each shown first.
 *
 * The same rule serves the web chat and Workspace (its document context uses
 * selectExcerpt, src/workspace/ai-service.js). Telegram does not run AI on
 * files at all: a file goes to the lawyer queue (src/bot/tariff-texts.js).
 */

// Half of one analysis unit (40 000 characters): enough for the clauses a
// question is about, not enough to stand in for an analysis.
const CHAT_DOCUMENT_CONTEXT_CHARS = 20000;
// The opening of a document (title, parties, date) is kept in every excerpt;
// it is a small fixed part, never the way the budget is spent.
const HEAD_CHARS = 700;

const APO = "['ʻʼ‘’`]?";
const FULL_WORK = new RegExp([
  // Uzbek (Latin): "hujjatni tahlil qiling", "shartnomani tekshirib bering", "to'liq ko'rib chiqing"
  `(hujjat|shartnoma|fayl|ilova|matn|kelishuv|bitim)\\p{L}*[^.?!\\n]{0,60}?(tahlil|tekshir|ko${APO}rib\\s+chiq|xulosa|baho|xavf|risk)`,
  `(tahlil|xulosa)\\p{L}*\\s+(qil|ber|yoz|tayyorla|chiqar)`,
  `to${APO}liq\\s+(tahlil|ko${APO}rib|tekshir)`,
  `(yuridik|huquqiy)\\s+xulosa`,
  // Uzbek (Cyrillic)
  `(ҳужжат|шартнома|файл)\\p{L}*[^.?!\\n]{0,60}?(таҳлил|текшир|кўриб\\s+чиқ|хулоса)`,
  `(таҳлил|хулоса)\\p{L}*\\s+(қил|бер|ёз|тайёрла)`,
  `(юридик|ҳуқуқий)\\p{L}*\\s+хулоса`,
  // Russian
  `проанализ\\p{L}*`,
  `анализ\\p{L}*\\s+(документ|договор|контракт|файл)`,
  `(провер|изуч)\\p{L}*\\s+(документ|договор|контракт|файл)`,
  `заключени\\p{L}*\\s+(по|на)\\s+(документ|договор|контракт)`,
  `юридическ\\p{L}*\\s+заключени`,
].join('|'), 'iu');

// An opinion is asked for by name: a legal opinion, or "write / prepare a
// conclusion". A bare "xulosa bering" next to analysis words is the end of
// an analysis, not a second service.
const OPINION_EXPLICIT = new RegExp([
  `(yuridik|huquqiy)\\s+xulosa`, `xulosa\\p{L}*\\s+(yoz|tayyorla)`,
  `(юридик|ҳуқуқий)\\p{L}*\\s+хулоса`, `хулоса\\p{L}*\\s+(ёз|тайёрла)`,
  `юридическ\\p{L}*\\s+заключени`, `заключени\\p{L}*\\s+(по|на)\\s+(документ|договор|контракт)`, `(подготов|напиш|состав)\\p{L}*\\s+заключени`,
].join('|'), 'iu');
const OPINION_WORD = /xulosa|хулоса|заключени/iu;
const ANALYSIS_WORD = new RegExp(`tahlil|tekshir|ko${APO}rib\\s+chiq|baho|xavf|risk|таҳлил|текшир|кўриб\\s+чиқ|анализ|проанализ|провер|изуч|риск`, 'iu');

/** True when the request asks for work on the whole document (analysis, review, opinion). */
function isFullDocumentRequest(text = '') {
  return FULL_WORK.test(String(text || ''));
}

/**
 * The document services a request orders: [] for a question about the
 * document (a chat), else 'analysis' and/or 'opinion' - each from its own
 * quota.
 */
function requestedServices(text = '') {
  const t = String(text || '');
  if (!isFullDocumentRequest(t)) return [];
  const out = [];
  if (ANALYSIS_WORD.test(t)) out.push('analysis');
  if (OPINION_EXPLICIT.test(t) || (!out.length && OPINION_WORD.test(t))) out.push('opinion');
  return out.length ? out : ['analysis'];
}

const SERVICE_TITLE = { analysis: 'Hujjat tahlili', opinion: 'AI yuridik xulosa' };

// Workspace: a request names a document ("shartnomani tahlil qiling") or a
// legal opinion - "vaziyatni tahlil qiling" is a legal question, not a
// document service, and is answered as one.
const DOC_WORD = /(hujjat|shartnoma|fayl|ilova|kelishuv|bitim|ҳужжат|шартнома|файл|документ|договор|контракт)/iu;
function workspaceDocumentServices(text = '') {
  const t = String(text || '');
  if (!DOC_WORD.test(t) && !OPINION_EXPLICIT.test(t)) return [];
  return requestedServices(t);
}

/**
 * The answer a Workspace chat gives when a full document analysis or
 * opinion is asked for: Workspace does not run those services; they run in
 * the AI section, sized and shown before they start. No AI call is made
 * and no quota is used for this answer.
 */
function workspaceRoutingReply(services = []) {
  const names = services.map(sv => `«${SERVICE_TITLE[sv]}»`).join(' va ');
  return `${names} Workspace ichida hozircha bajarilmaydi — bu javob tahlil ham, xulosa ham emas.\n\n`
    + `Bu xizmat AI bo'limida bor: hujjatni o'sha yerga yuklang, uning hajmi va sarfi (${services.map(sv => (sv === 'analysis' ? 'tahlil' : 'xulosa')).join(' va ')} limitidan, hujjat birligida) ish boshlanishidan oldin ko'rsatiladi.\n\n`
    + "Hujjatning aniq bandi bo'yicha savol bersangiz, shu yerda parchalar asosida javob beraman (1 chat birligi).\n\n"
    + 'Bu yo\'naltirish limitingizdan hech narsa yechmadi.';
}

// ── Excerpts ───────────────────────────────────────────────────────────────

const lower = s => String(s || '').toLocaleLowerCase('uz-UZ').replace(/[‘’ʻʼ`']/gu, '');

function terms(question) {
  return [...new Set(lower(question)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(t => t.length >= 4 && !/^\d+$/u.test(t)))];
}
const stem = t => t.slice(0, Math.max(4, t.length - 2));

// A clause starts at a numbered line ("5.", "5.2.", "14.3)"), a "5-band" /
// "7-modda" line, or "Modda 5" / "Статья 5" / "Пункт 5".
const CLAUSE_START = /^\s*(?:(\d{1,3}(?:\.\d{1,3}){0,3})[.)](?=\s)|(\d{1,3}(?:\.\d{1,3}){0,3})\s*-\s*(?:band|modda|bo'lim|bo‘lim|bob)\b|(?:modda|band|статья|пункт|раздел|article|section)\s+(\d{1,3}(?:\.\d{1,3}){0,3}))/iu;

// References inside a text: "7.2-bandda", "14.3-band", "16-bo'lim", "5-modda",
// "п. 7.2", "пункт 7", "пунктом 7.2", "band 5".
const REF_PATTERNS = [
  /(\d{1,3}(?:\.\d{1,3}){0,3})\s*-\s*(?:band|modda|bo['‘ʻ]?lim|bob|qism)\p{L}*/giu,
  /(?:п\.|пункт\p{L}*|стать\p{L}*|раздел\p{L}*|band|modda)\s*(\d{1,3}(?:\.\d{1,3}){0,3})/giu,
];
function references(text) {
  const out = new Set();
  for (const re of REF_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(String(text || '')))) out.add(m[1].replace(/\.$/u, ''));
  }
  return [...out];
}

// Definitions and exceptions: what a clause means and when it does not apply.
const DEFINITION = /atamalar|tushunchalar|ta['‘ʻ]?riflar|deb\s+ataladi|deganda|degani|термин|определени|понимается|означает|definitions/iu;
const EXCEPTION = /bundan\s+mustasno|istisno|qo['‘ʻ]?llanilmaydi|qat['‘ʻ]?i\s+nazar|tatbiq\s+etilmaydi|за\s+исключением|кроме\s+случа|не\s+применя|не\s+распространя|unless|except/iu;
// Terms a definition names: «Tovar», "Ish kuni", “Muddat”.
const QUOTED = /[«"“]([^»"”\n]{2,60})[»"”]/gu;

function parseClauses(body) {
  const lines = String(body || '').split('\n');
  const clauses = [];
  let cur = { id: null, lines: [] };
  for (const line of lines) {
    const m = line.match(CLAUSE_START);
    if (m) {
      if (cur.lines.join('').trim()) clauses.push(cur);
      cur = { id: (m[1] || m[2] || m[3] || '').replace(/\.$/u, ''), lines: [line] };
    } else {
      cur.lines.push(line);
    }
  }
  if (cur.lines.join('').trim()) clauses.push(cur);
  // a document without numbering: paragraphs
  if (clauses.filter(c => c.id).length < 3) {
    return String(body || '').split(/\n\s*\n/u).map(t => t.trim()).filter(Boolean)
      .map((t, i) => ({ i, id: null, text: t }));
  }
  return clauses.map((c, i) => ({ i, id: c.id || null, text: c.lines.join('\n').trim() }));
}

// A page mark line of an extracted PDF or scan ("[Sahifa 3]").
const PAGE_LINE = /^\[Sahifa \d+\]\n?/gmu;

/**
 * Each clause carries the page it starts on: a page mark that ends the
 * clause before it (a page break between two clauses) is moved to the clause
 * it belongs to, so an excerpt never shows a clause under another clause's
 * page. Marks inside a clause stay where they are.
 */
function withPages(full, from, clauses) {
  if (!/^\[Sahifa \d+\]$/mu.test(full)) return clauses;
  const marks = [...full.matchAll(/^\[Sahifa (\d+)\]$/gmu)].map(m => ({ at: m.index, page: Number(m[1]) }));
  let cursor = from;
  return clauses.map(c => {
    const body = c.text.replace(/(\n\[Sahifa \d+\]\s*)+$/u, '').replace(/^(\[Sahifa \d+\]\s*\n)+/u, '');
    const at = full.indexOf(body.split('\n')[0], cursor);
    if (at >= 0) cursor = at;
    const before = marks.filter(m => m.at <= (at >= 0 ? at : cursor)).pop();
    return { ...c, text: before ? `[Sahifa ${before.page}]\n${body}` : body };
  });
}

/**
 * The parts of `doc` that bear on `question`, in document order, at most
 * maxChars. Returns { text, usedChars, totalChars, excerpt, matched,
 * referenced, missingReferences, definitions, exceptions, insufficient }.
 *   matched            clause ids that answer the question's words
 *   referenced         clause ids those clauses refer to (included)
 *   missingReferences  referred to, but not in the document or not fitting
 *   insufficient       nothing matched, or a clause relied on is missing:
 *                      the answer must say so and not conclude
 */
function selectExcerpt(doc = '', question = '', maxChars = CHAT_DOCUMENT_CONTEXT_CHARS) {
  const full = String(doc || '').trim();
  // the document's own size: "[Sahifa n]" marks (src/ocr/routes.js) are ours
  const ownChars = full.replace(PAGE_LINE, '').length;
  const base = { totalChars: ownChars, matched: [], referenced: [], missingReferences: [], definitions: 0, exceptions: 0, insufficient: false };
  if (ownChars <= maxChars) return { ...base, text: full, usedChars: full.length, excerpt: false };

  const firstClause = full.search(new RegExp(CLAUSE_START.source, 'imu'));
  const headEnd = Math.min(HEAD_CHARS, firstClause > 0 ? firstClause : HEAD_CHARS);
  const head = full.slice(0, headEnd).trim();
  const clauses = withPages(full, headEnd, parseClauses(full.slice(headEnd)));
  const low = clauses.map(c => lower(c.text));
  const byId = new Map();
  clauses.forEach(c => { if (c.id && !byId.has(c.id)) byId.set(c.id, c); });

  // 1. clauses that match the question: rare words weigh more (a word found
  //    in every clause, "band", "tomonlar", says little); a clause number
  //    named in the question is taken first
  const qt = terms(question);
  const weight = Object.fromEntries(qt.map(t => {
    const df = low.filter(l => l.includes(stem(t))).length;
    return [t, df ? Math.log((clauses.length + 1) / df) : 0];
  }));
  const named = new Set(references(question));
  const score = clauses.map((c, k) => (c.id && named.has(c.id) ? 100 : 0)
    + qt.reduce((n, t) => n + (low[k].includes(stem(t)) ? weight[t] : 0), 0));
  const top = Math.max(0, ...score);

  const budget = maxChars - head.length - 400;
  const chosen = new Map();
  let used = 0;
  const fits = n => used + n + 8 <= budget;
  const take = (c, why, room = budget) => {
    if (!c || chosen.has(c.i)) return !!c;
    let t = c.text;
    if (!fits(t.length)) {
      const left = Math.min(room, budget - used - 8);
      if (left < 300) return false;
      t = `${t.slice(0, left - 2)}…`;
    }
    chosen.set(c.i, { ...c, t, why });
    used += t.length + 8;
    return true;
  };

  const missing = new Set();
  const referenced = new Set();
  const matched = [];
  if (top > 0) {
    // matching clauses, best first, at most 60% of the budget, so the
    // definitions, references and exceptions they need still fit
    const order = clauses.map((c, k) => ({ c, s: score[k] })).filter(x => x.s >= top * 0.25 && x.s > 0)
      .sort((a, b) => b.s - a.s || a.c.i - b.c.i);
    for (const { c } of order) {
      if (used > budget * 0.6) break;
      if (take(c, 'match', Math.floor(budget * 0.3))) matched.push(c);
    }
    // 2. what they refer to, two steps deep ("14.3 -> 7.2 -> 1.4"); a
    //    reference to a section ("16-bo'lim") brings its sub-clauses
    const follow = (from, depthLimit) => {
      let frontier = from;
      for (let depth = 0; depth < depthLimit && frontier.length; depth++) {
        const next = [];
        for (const c of frontier) {
          for (const id of references(c.text)) {
            if (id === c.id) continue;
            referenced.add(id);
            const target = byId.get(id);
            if (!target) { missing.add(id); continue; }
            const family = [target, ...clauses.filter(x => x.id && x.id.startsWith(`${id}.`))];
            let room = 4000;
            for (const t of family) {
              if (chosen.has(t.i)) continue;
              const before = used;
              if (!take(t, 'reference', room)) { if (t === target) missing.add(id); break; }
              room -= used - before;
              next.push(t);
              if (room < 300) break;
            }
          }
        }
        frontier = next;
      }
    };
    follow(matched, 2);
    // 3. exceptions: a clause that names a chosen clause, or that shares the
    //    question's words and says when a rule does not apply; and what the
    //    exception itself refers to (the force-majeure section it invokes)
    const chosenIds = new Set([...chosen.values()].map(c => c.id).filter(Boolean));
    const exceptions = [];
    for (const c of clauses) {
      if (chosen.has(c.i)) continue;
      const refsChosen = references(c.text).some(id => chosenIds.has(id));
      const shares = qt.some(t => weight[t] > 0.5 && low[c.i].includes(stem(t)));
      if ((refsChosen || (shares && EXCEPTION.test(c.text))) && take(c, 'exception', 3000)) {
        base.exceptions++;
        exceptions.push(c);
      }
    }
    follow(exceptions, 1);
    // 4. definitions of the terms the chosen clauses use
    const chosenText = lower([...chosen.values()].map(c => c.t).join('\n'));
    for (const c of clauses) {
      if (chosen.has(c.i)) continue;
      const defined = [...c.text.matchAll(QUOTED)].map(m => lower(m[1]).trim()).filter(Boolean);
      if (!defined.length || !(DEFINITION.test(c.text) || /^\s*[«"“]/u.test(c.text.replace(CLAUSE_START, '')))) continue;
      if (defined.some(n => chosenText.includes(n)) && take(c, 'definition', 2500)) base.definitions++;
    }
  }

  const pieces = [...chosen.values()].sort((a, b) => a.i - b.i);
  const insufficient = top === 0 || missing.size > 0;
  let text;
  if (top === 0) {
    // nothing in the document matches the question: no guess from its
    // opening pages - the outline only, and the answer must say so
    const outline = clauses.filter(c => c.id).map(c => c.text.split('\n')[0].slice(0, 90)).join('\n');
    text = `${head}\n[…]\n[Savol so'zlari hujjatda topilmadi. Hujjat bandlari ro'yxati:]\n${outline}`.slice(0, maxChars);
  } else {
    text = [head, ...pieces.map(p => p.t)].join('\n[…]\n');
  }
  return {
    ...base, text, usedChars: text.length, excerpt: true,
    matched: matched.map(c => c.id).filter(Boolean),
    referenced: [...referenced],
    missingReferences: [...missing],
    insufficient,
  };
}

/** The instruction the model gets when it only sees excerpts of a document. */
function excerptInstruction(scope, lang = 'uz') {
  if (scope && scope.mode === 'document' && Array.isArray(scope.unread) && scope.unread.length) {
    return lang === 'ru'
      ? `\n\nВАЖНО: часть документа не прочитана (${scope.unread.join(', ')}). Начните ответ с этого, не делайте выводов об этих частях и не выдавайте ответ за полный анализ.`
      : `\n\nMUHIM: hujjatning bir qismi o'qilmadi (${scope.unread.join(', ')}). Javobni shu bilan boshlang, u qismlar haqida xulosa chiqarmang va javobni to'liq tahlil deb ko'rsatmang.`;
  }
  if (!scope || !scope.excerpt) return '';
  const missing = (scope.missingReferences || []).join(', ');
  if (lang === 'ru') {
    return `\n\nВАЖНО: из приложенного документа (${scope.totalChars} знаков) даны только фрагменты (${scope.usedChars} знаков): пункты по вопросу, их определения, пункты, на которые они ссылаются, и исключения. Отвечайте только по этим фрагментам и не выдавайте ответ за полный анализ документа.`
      + (scope.insufficient
        ? ` Фрагментов недостаточно для твёрдого вывода${missing ? ` (пункты ${missing} не переданы)` : ' (пункты по вопросу не найдены)'}: прямо скажите об этом, не делайте категоричного вывода и предложите полный анализ документа.`
        : ' Если для ответа нужен пункт, которого нет во фрагментах, прямо скажите об этом и не делайте категоричного вывода.');
  }
  return `\n\nMUHIM: ilova qilingan hujjatdan (${scope.totalChars} belgi) faqat parchalar (${scope.usedChars} belgi) berildi: savolga oid bandlar, ulardagi atamalarning ta'riflari, ular havola qilgan bandlar va istisnolar. Faqat shu parchalar asosida javob bering; javobni butun hujjatning to'liq tahlili deb ko'rsatmang.`
    + (scope.insufficient
      ? ` Parchalar qat'iy xulosa uchun yetarli emas${missing ? ` (${missing}-band(lar) berilmagan)` : ' (savolga oid band topilmadi)'}: buni aniq ayting, qat'iy xulosa bermang va butun hujjat tahlilini taklif qiling.`
      : " Agar javob uchun parchalarda bo'lmagan band kerak bo'lsa, buni aniq ayting va qat'iy xulosa bermang.");
}

/** The note the user sees under such an answer. */
function excerptNote(scope, analysisUnits = null) {
  if (scope && scope.mode === 'document' && Array.isArray(scope.unread) && scope.unread.length) {
    return `⚠️ Qisman natija — to'liq tahlil emas: hujjatning ${scope.unread.join(', ')} o'qilmadi. Limit qaytarildi; hujjatni qayta yuborib, to'liq tahlil olishingiz mumkin.`;
  }
  if (scope && scope.mode === 'document' && Array.isArray(scope.services) && scope.services.length) {
    return `✅ ${scope.services.map(sv => `${SERVICE_TITLE[sv]}: ${scope.units} birlik ${sv === 'analysis' ? 'tahlil' : 'xulosa'} limitidan`).join('; ')}. Chat limiti yechilmadi.`;
  }
  if (!scope || !scope.excerpt) return '';
  const units = analysisUnits ? ` (${analysisUnits} birlik)` : '';
  const used = `${scope.usedChars.toLocaleString('ru-RU')} / ${scope.totalChars.toLocaleString('ru-RU')} belgi`;
  if (scope.insufficient) {
    const why = (scope.missingReferences || []).length
      ? `javob tayangan ${scope.missingReferences.join(', ')}-band(lar) parchaga kirmadi`
      : 'savolga oid band hujjatda aniq topilmadi';
    return `⚠️ Hujjatning faqat parchalari (${used}) ishlatildi va ${why}, shuning uchun qat'iy xulosa berilmadi. `
      + `Aniq javob uchun butun hujjat tahlili — alohida xizmat${units}: «Hujjat tahlili» yoki «Yuridik xulosa».`;
  }
  return `ℹ️ Hujjatning savolga oid qismlari (${used}) ishlatildi: bandlar, ta'riflar, havolalar va istisnolar. `
    + `Butun hujjatni tahlil qilish — alohida xizmat${units}: «Hujjat tahlili» yoki «Yuridik xulosa».`;
}

// When both services are ordered in one request, each is delivered as its
// own section under a fixed heading, so each can be settled on its own: a
// delivered analysis is paid even if the opinion then fails, and an opinion
// that never arrived is given back (subscription-tiers settleJobs).
const SECTION_HEADINGS = {
  analysis: { uz: 'Hujjat tahlili', ru: 'Анализ документа' },
  opinion: { uz: 'Yuridik xulosa', ru: 'Юридическое заключение' },
};
const SECTION_MIN_CHARS = 200;
const HEADING_LINE = /^#{1,3}[ \t]*(.+?)[ \t]*#*[ \t]*$/gmu;

/** Was `service` delivered in `text` as its own section with real content? */
function sectionDelivered(text, service) {
  const names = Object.values(SECTION_HEADINGS[service] || {}).map(n => n.toLocaleLowerCase());
  if (!names.length || typeof text !== 'string') return false;
  const heads = [...text.matchAll(HEADING_LINE)].map(m => ({ at: m.index, end: m.index + m[0].length, title: m[1].toLocaleLowerCase() }));
  const isService = h => Object.values(SECTION_HEADINGS).some(v => Object.values(v).some(n => h.title.startsWith(n.toLocaleLowerCase())));
  const i = heads.findIndex(h => names.some(n => h.title.startsWith(n)));
  if (i < 0) return false;
  const next = heads.slice(i + 1).find(isService);
  const body = text.slice(heads[i].end, next ? next.at : text.length).replace(/\s+/gu, ' ').trim();
  return body.length >= SECTION_MIN_CHARS;
}

/**
 * How each service of a two-service answer is settled: 'delivered' or
 * 'not_delivered'. When the answer has none of the service headings at all
 * (the model ignored the format) but real content, both are delivered - a
 * format slip does not make delivered work free; a short or empty answer
 * delivered neither.
 */
function settleSections(text, services = []) {
  const t = typeof text === 'string' ? text : '';
  const anyHeading = [...t.matchAll(HEADING_LINE)].some(m => Object.values(SECTION_HEADINGS)
    .some(v => Object.values(v).some(n => m[1].toLocaleLowerCase().startsWith(n.toLocaleLowerCase()))));
  const out = {};
  for (const sv of services) {
    out[sv] = anyHeading
      ? (sectionDelivered(t, sv) ? 'delivered' : 'not_delivered')
      : (t.replace(/\s+/gu, ' ').trim().length >= SECTION_MIN_CHARS * services.length ? 'delivered' : 'not_delivered');
  }
  return out;
}

/** The instruction for a chat request metered as document service(s). */
function serviceInstruction(services = [], lang = 'uz') {
  const s = new Set(services);
  if (!s.size) return '';
  const l = lang === 'ru' ? 'ru' : 'uz';
  const headings = [...s].map(sv => `## ${SECTION_HEADINGS[sv][l]}`);
  if (l === 'ru') {
    return `\n\nЗАКАЗАНО: ${s.has('analysis') ? 'анализ документа' : ''}${s.size > 1 ? ' и ' : ''}${s.has('opinion') ? 'юридическое заключение по документу' : ''}. Дайте ${s.size > 1 ? 'оба результата отдельными разделами' : 'именно этот результат'} по всему документу`
      + (s.size > 1 ? `; заголовки разделов строго: "${headings.join('" и "')}".` : '.');
  }
  const parts = [s.has('analysis') ? 'hujjat tahlili (bandlar, xavflar, kamchiliklar)' : null,
    s.has('opinion') ? 'AI yuridik xulosa (savol, huquqiy asos, xulosa)' : null].filter(Boolean);
  return `\n\nBUYURTMA: ${parts.join(' va ')}. ${s.size > 1 ? 'Ikkalasini alohida bo\'limlarda bering' : 'Aynan shu natijani bering'}, butun hujjat bo'yicha`
    + (s.size > 1 ? `; bo'lim sarlavhalari aynan: "${headings.join('" va "')}".` : '.');
}

module.exports = {
  CHAT_DOCUMENT_CONTEXT_CHARS, SERVICE_TITLE,
  isFullDocumentRequest, requestedServices, workspaceDocumentServices, workspaceRoutingReply, selectExcerpt, references, parseClauses,
  excerptInstruction, excerptNote, serviceInstruction, sectionDelivered, settleSections, SECTION_HEADINGS, SECTION_MIN_CHARS,
};
