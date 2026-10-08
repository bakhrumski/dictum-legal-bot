'use strict';

/**
 * Relations inside a clause - who -> which act -> on what condition -> when
 * -> except what -> with what consequence - compared between the document,
 * the digest and the answer with NO AI call (2026-10-08, the #422 live run
 * kept the words of a clause but moved its period, condition or status to
 * another act). General vocabulary only (Uzbek Latin and Russian), nothing
 * of a particular document.
 *
 * MECHANICAL, warning only: every result is a reason to check by hand
 * against the source, never proof of an error and never a verdict on
 * meaning. A period is tied to the nearest act word; a negation to the act
 * word next to it; two sentences to each other by shared words or a quoted
 * name. Synonyms the vocabulary does not list are not seen; an answer that
 * says the right thing in other words may be flagged, and one that says
 * the wrong thing in the document's words may pass. A lawyer judges meaning.
 *
 * What it looks at (each on the source, a digest or an answer):
 *   bindings   - each period, date, percentage and amount with the act it
 *                is attached to and its role (a definition's threshold, a
 *                sanction, or other);
 *   polarity   - each act with whether it is denied ("o'tmagan"), done
 *                ("topshirgan"), not identified ("aniqlanmadi") or other;
 *   order      - "A oldidan B", "A dan keyin B", "A sharti bilan B": which
 *                act comes first;
 *   connectors - "A va B" / "A yoki B" between the same two words;
 *   modality   - nouns (damage, risk, loss) the document only states as
 *                possible ("mumkin", "ehtimoliy");
 *   criteria   - the criteria of a defined term ("X deganda ... tushuniladi").
 */

const lower = t => String(t || '').toLowerCase().replace(/[ʻʼ‘’`ʹ]/gu, "'");

// ── Acts that must not be merged with each other ──
// Each act is recognised by one word: a noun that names it or a verb form.
const ACTS = [
  { id: 'apply', label: 'ariza topshirish', word: /^ariza\p{L}*$|^заявк\p{L}*$|^заявлени\p{L}*$/u },
  { id: 'register', label: "ro'yxatdan o'tkazish", word: /^ro'yxat(?:i)?(?:dan|ga)$|^registratsiya\p{L}*$|^регистрац\p{L}*$|^зарегистрир\p{L}*$/u },
  { id: 'reply', label: 'javob berish', word: /^javob(?:ni|ga|i|ini)?$|^ответ\p{L}*$/u },
  { id: 'conclude', label: 'bitim tuzish', word: /^bitim\p{L}*$|^tuz(?:il|ad|ish|gan|ib|ma)\p{L}*$|^заключ\p{L}*$|^сделк\p{L}*$/u },
  { id: 'pay', label: "to'lash", word: /^to'la(?:sh|n|y|di|sa|gan|b|m|t)\p{L}*$|^to'lov\p{L}*$|^transh\p{L}*$|^оплат\p{L}*$|^выплат\p{L}*$|^уплат\p{L}*$|^транш\p{L}*$/u },
  { id: 'sign', label: 'imzolash', word: /^imzola\p{L}*$|^подпис\p{L}*$/u },
  { id: 'submit', label: 'taqdim etish', word: /^hisobot\p{L}*$|^taqdim$|^отч[её]т\p{L}*$|^представ\p{L}*$|^предостав\p{L}*$/u },
  { id: 'notify', label: 'xabardor qilish', word: /^xabardor\p{L}*$|^xabarnoma\p{L}*$|^уведом\p{L}*$/u },
  { id: 'deliver', label: 'yetkazib berish', word: /^yetkazib$|^постав(?:к|л|ит)\p{L}*$/u },
  { id: 'refund', label: 'qaytarish', word: /^qaytar\p{L}*$|^возвра\p{L}*$/u },
  { id: 'terminate', label: 'bekor qilish', word: /^bekor$|^расторж\p{L}*$|^расторг\p{L}*$/u },
  { id: 'transfer', label: 'begonalashtirish', word: /^begonalashtir\p{L}*$|^отчужд\p{L}*$/u },
  { id: 'consent', label: 'rozilik', word: /^rozilig\p{L}*$|^rozilik\p{L}*$|^согласи\p{L}*$/u },
  { id: 'pledge', label: "garovga qo'yish", word: /^garov\p{L}*$|^залог\p{L}*$/u },
];
const ACT_LABEL = Object.fromEntries(ACTS.map(a => [a.id, a.label]));
const actOf = w => { for (const a of ACTS) if (a.word.test(w)) return a.id; return null; };

/** Words and the punctuation that bounds a clause, with their positions. */
function tokens(s) {
  return [...s.matchAll(/\p{L}[\p{L}'-]*|[;,:]/gu)].map(m => ({ w: m[0], at: m.index, end: m.index + m[0].length, punct: /^[;,:]$/u.test(m[0]) }));
}

/** Sentences (and digest lines) of a text; page marks and list bullets removed. A ";" stays inside: it bounds a clause, not the matter. */
function sentencesOf(text) {
  return String(text || '').replace(/\[Sahifa \d+\]/gu, ' ')
    .split(/\n+|(?<=[\p{L})\]»"'][.!?])\s+(?=\S)/u)
    .map(x => x.replace(/^[\s>*•-]+/u, '').trim()).filter(x => x.length > 8);
}

// ── Figures with their unit: periods, percentages, amounts ──
const UNIT = "(kalendar kun\\p{L}*|ish kun\\p{L}*|bank kun\\p{L}*|kun\\p{L}*|oy(?:\\p{L}{0,4})(?!\\p{L})|yil\\p{L}*|hafta\\p{L}*|soat\\p{L}*|foiz\\p{L}*|%|so'm\\p{L}*|сум\\p{L}*|календарн\\p{L}* дн\\p{L}*|рабоч\\p{L}* дн\\p{L}*|банковск\\p{L}* дн\\p{L}*|дн\\p{L}*|месяц\\p{L}*|процент\\p{L}*)";
const FIG = new RegExp(`(\\d{1,3}(?:[  ]\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?)\\s*(mlrd|milliard|mln|million|ming|млрд|млн|тыс\\p{L}*)?\\.?\\s*${UNIT}`, 'gu');
const SCALE = { mlrd: 1e9, milliard: 1e9, 'млрд': 1e9, mln: 1e6, million: 1e6, 'млн': 1e6, ming: 1e3 };
function baseUnit(u) {
  if (/^(?:kalendar |ish |bank )?kun|дн|^календарн|^рабоч|^банковск/u.test(u)) return 'kun';
  if (/^oy|^месяц/u.test(u)) return 'oy';
  if (/^yil/u.test(u)) return 'yil';
  if (/^hafta/u.test(u)) return 'hafta';
  if (/^soat/u.test(u)) return 'soat';
  if (/^foiz|^%|^процент/u.test(u)) return 'foiz';
  return "so'm";
}
function numberOf(raw, scale) {
  let s = String(raw).replace(/[\s ]/gu, '');
  if (/^\d{1,3}([.,]\d{3})+$/u.test(s)) s = s.replace(/[.,]/gu, '');
  else s = s.replace(',', '.');
  let v = Number(s);
  if (!Number.isFinite(v)) return null;
  if (scale) v *= SCALE[scale] || (/^тыс/u.test(scale) ? 1e3 : 1);
  return v;
}

/** Periods, percentages, amounts and dates of one (lower-case) sentence. */
function figuresIn(s) {
  const out = [];
  for (const m of s.matchAll(FIG)) {
    const v = numberOf(m[1], m[2]);
    const unit = baseUnit(m[3]);
    if (v == null || (unit === 'yil' && v >= 1900 && v <= 2100)) continue; // "2026-yil" is a date
    out.push({ key: `${v}|${unit}`, kind: ['foiz', "so'm"].includes(unit) ? (unit === 'foiz' ? 'percent' : 'amount') : 'period', raw: m[0].trim(), at: m.index, end: m.index + m[0].length });
  }
  // dates: the explanation's own date reader (any form), lazily (no cycle)
  const { datesIn } = require('./document-explain');
  for (const d of datesIn(s)) {
    if (out.some(o => d.start < o.end && d.end > o.at)) continue;
    out.push({ key: `date|${d.m}-${d.d}`, year: d.y, kind: 'date', raw: s.slice(d.start, d.end), at: d.start, end: d.end });
  }
  return out;
}

// a period counted from an earlier event: "imzolanganidan keyin 5 kun",
// "olingan kundan boshlab 10 kun" - that event is not the act the period is for
const FROM = /^(?:keyin|so'ng|boshlab|после|с)$/u;
const SANCTION = /^(?:jarima\p{L}*|penya\p{L}*|neustoyka\p{L}*|sanksiya\p{L}*|undiril\p{L}*|штраф\p{L}*|пен[яиюей]\p{L}*|неустойк\p{L}*|санкци\p{L}*)$/u;
const DEFINITION = /deganda|deb hisoblanadi|deb tushuniladi|tushuniladi|понимается|признается|признаётся/u;

/**
 * The act a figure is attached to: the first act word after it in the same
 * clause (Uzbek puts the act after its period: "10 kun ichida javob
 * beradi"), else the nearest one before it, skipping the event a period is
 * counted from ("... imzolanganidan keyin 5 kun ichida").
 */
function bindAct(toks, fig) {
  let i = toks.findIndex(t => t.at >= fig.end);
  if (i >= 0) {
    for (let k = i, n = 0; k < toks.length && n < 6; k++) {
      if (toks[k].punct) break;
      n++;
      const a = actOf(toks[k].w);
      if (a) return { act: a, at: toks[k].at, end: toks[k].end };
    }
  }
  let k = (i >= 0 ? i : toks.length) - 1;
  for (let n = 0; k >= 0 && n < 10; k--, n++) {
    const t = toks[k];
    // a ";" ends the clause; "," and ":" do not ("muddat: 10 kun" in a digest line)
    if (t.w === ';') break;
    if (t.punct) continue;
    if (FROM.test(t.w)) { k -= 3; continue; } // the event the period counts from
    if (SINCE_WORD.test(t.w)) continue; // "imzolangach", "olgandan": that event too
    const a = actOf(t.w);
    if (a) return { act: a, at: t.at, end: t.end };
  }
  return null;
}
// a verb form naming the event a period counts from: "imzolangach", "imzolanganidan"
const SINCE_WORD = /\p{L}{3,}(?:gach|gandan|ganidan|ganda)$/u;

/**
 * The role of a figure: "cap" when it is a ceiling ("10 foizidan oshmaydi",
 * "ko'pi bilan", "chegarasi"), "sanction" when a sanction word is near it,
 * "definition" when the sentence defines a term, else "other".
 */
const CAP_AFTER = /^(?:\p{L}*\s*)?(?:oshmaydi|oshmasligi|oshmagan|oshmasin|ortiq emas|ko'p emas|bilan cheklan\p{L}*|cheklan\p{L}*|не превыша\p{L}*|не более|ограничен\p{L}*)/u;
const CAP_BEFORE = /(?:ko'pi bilan|eng ko'p|maksimal\p{L}*|chegara\p{L}*|limit\p{L}*|не более|предел\p{L}*|максим\p{L}*)\s+(?:[\p{L}'-]+\s+){0,3}$/u;
function roleOf(s, toks, fig) {
  if (/gacha$/u.test(fig.raw) || CAP_AFTER.test(s.slice(fig.end).trimStart()) || CAP_BEFORE.test(s.slice(Math.max(0, fig.at - 60), fig.at))) return 'cap';
  const at = toks.findIndex(t => t.at >= fig.end);
  const from = Math.max(0, (at < 0 ? toks.length : at) - 7), to = Math.min(toks.length, (at < 0 ? toks.length : at) + 4);
  if (toks.slice(from, to).some(t => SANCTION.test(t.w))) return 'sanction';
  if (DEFINITION.test(s)) return 'definition';
  return 'other';
}

// ── Polarity of an act: denied, done, not identified, or other ──
const NEG_WORD = /(?:ma(?:gan|di|ydi|sdan|slik|y)\p{L}*|mag'an\p{L}*)$|^(?:emas|yo'q|не|нет)$/u;
const NOT_FOUND_WORD = /^aniqlanma\p{L}*$|^не$|^выявлен\p{L}*$/u;
// done: "-gan" or the past "-di" ("berdi", "o'tkazildi"), not the present "-adi" / "-ydi" ("beradi")
const DONE_WORD = /(?:gan|[^aiy]di)$/u;
function polarityAt(toks, k) {
  const win = [];
  for (let j = k; j < toks.length && j <= k + 3; j++) { if (toks[j].punct) break; win.push(toks[j].w); }
  if (k > 0 && /^(?:не|нет)$/u.test(toks[k - 1].w)) return 'neg';
  if (win.some(w => /^aniqlanma/u.test(w))) return 'not_found';
  if (win.some((w, i) => NEG_WORD.test(w) && (i > 0 || /ma(?:gan|di|ydi)/u.test(w)))) return 'neg';
  if (win.some((w, i) => i > 0 && DONE_WORD.test(w)) || DONE_WORD.test(win[0] || '') && /gan$/u.test(win[0])) return 'done';
  return 'other';
}
const POLARITY_LABEL = { neg: 'inkor', done: 'bajarilgan', not_found: 'aniqlanmagan', other: 'boshqa' };

// ── Order: which act comes first ──
const BEFORE_MARK = /^(?:oldidan|oldin|avval)$/u; // "<ref> oldidan": the ref act is the LATER one
const AFTER_MARK = /^(?:keyin|so'ng)$/u; // "<ref>dan keyin": the ref act is the EARLIER one
function orderPairs(toks) {
  const out = [];
  for (let k = 1; k < toks.length; k++) {
    const t = toks[k];
    let kind = null;
    if (BEFORE_MARK.test(t.w)) kind = 'before';
    else if (AFTER_MARK.test(t.w)) kind = 'after';
    else if (t.w === 'sharti' && toks[k + 1] && toks[k + 1].w === 'bilan') kind = 'after'; // "<ref> sharti bilan": the condition comes first
    if (!kind) continue;
    // the ref act: within 3 words before the marker
    let ref = null, refAt = -1;
    for (let j = k - 1; j >= Math.max(0, k - 3); j--) { if (toks[j].punct) break; const a = actOf(toks[j].w); if (a) { ref = a; refAt = j; break; } }
    if (!ref) continue;
    // the other act: the nearest different act in the clause, either side
    let other = null, best = Infinity;
    for (let j = 0; j < toks.length; j++) {
      if (j >= refAt && j <= k) continue;
      const a = actOf(toks[j].w);
      if (!a || a === ref) continue;
      const between = toks.slice(Math.min(j, k), Math.max(j, k)).some(x => x.w === ';');
      const d = Math.abs(j - k) + (between ? 100 : 0);
      if (d < best) { best = d; other = a; }
    }
    if (!other || best >= 100) continue;
    out.push(Object.assign(kind === 'before' ? [other, ref] : [ref, other], { at: t.at, end: t.end }));
  }
  return out;
}

// ── "A va B" / "A yoki B" between the same two words ──
const AND = /^(?:va|hamda|lekin|ammo|и)$/u;
const OR = /^(?:yoki|или)$/u;
const STOP = new Set(['ushbu', 'shartnoma', 'shartnomaning', 'tomonlar', 'tomonidan', "bo'yicha", 'hamda', 'bilan', 'uchun', 'kerak', 'mumkin', 'qilib', 'qiladi', 'etiladi', "to'g'risidagi", "to'g'risida", 'boshqa', 'barcha', 'bunday', 'shuningdek', 'ichida', 'kundan', 'boshlab']);
const stem = w => (w.includes('-') ? w : w.replace(/'/gu, '').slice(0, 5));
const contentWord = w => w.length >= 4 && !STOP.has(w) && !AND.test(w) && !OR.test(w);
function connectorPairs(toks) {
  const out = [];
  for (let k = 1; k < toks.length - 1; k++) {
    const type = AND.test(toks[k].w) ? 'and' : OR.test(toks[k].w) ? 'or' : null;
    if (!type) continue;
    // "va/yoki", "va (yoki)": both at once - not one of the two
    if ((toks[k - 1] && (AND.test(toks[k - 1].w) || OR.test(toks[k - 1].w))) || (toks[k + 1] && (AND.test(toks[k + 1].w) || OR.test(toks[k + 1].w)))) continue;
    let j = k - 1;
    if (toks[j].w === ',' && j > 0) j--;
    if (toks[j].punct || !contentWord(toks[j].w)) continue;
    const left = stem(toks[j].w);
    for (const r of toks.slice(k + 1, k + 3)) {
      if (r.punct) break;
      if (!contentWord(r.w)) continue;
      const right = stem(r.w);
      if (right !== left) out.push({ key: [left, right].sort().join('+'), type, words: `${toks[j].w} ${toks[k].w} ${r.w}` });
    }
  }
  return out;
}

// ── Nouns the document may state only as possible ──
const MODAL_NOUNS = [
  { id: 'zarar', re: /(?:^|[^\p{L}'])(?:zarar\p{L}*|ziyon\p{L}*|убыт\p{L}*|ущерб\p{L}*)/u },
  { id: 'xavf', re: /(?:^|[^\p{L}'])(?:xavf\p{L}*|xatar\p{L}*|risk\p{L}*|риск\p{L}*)/u },
  { id: "yo'qotish", re: /(?:^|[^\p{L}'])(?:yo'qotish\p{L}*|потер\p{L}*)/u },
];
const MODAL = /mumkin|ehtimol|taxmin|kutil|baholan|bo'lishi mumkin|возможн|вероятн|может|могут|ожида/u;
const DEFINITE = /yetkaz\p{L}*(?:adi|gan|di)(?![\p{L}])|ko'r(?:adi|gan|di)(?![\p{L}])|keltir(?:adi|gan|di)(?![\p{L}])|bo'ladi|bo'lgan|mavjud(?! emas)|причин\p{L}*|понес\p{L}*|возник\p{L}*/u;

// ── A defined term and its criteria ──
const DEF_RE = /^(?:\d+(?:\.\d+)*\.?\s*)?(.{3,80}?)\s+deganda\s+(.+?)\s+(?:tushuniladi|nazarda tutiladi)/u;
function definitionsIn(sentences) {
  const out = [];
  for (const s of sentences) {
    const m = lower(s).match(DEF_RE);
    if (!m) continue;
    const termWords = m[1].split(/[^\p{L}'-]+/u).filter(w => w.length >= 3).slice(-4);
    if (!termWords.length) continue;
    const criteria = m[2].split(/,?\s+yoki\s+|,?\s+shuningdek\s+|;\s*|,?\s+hamda\s+/u).map(c => c.trim()).filter(c => c.length >= 6)
      .map(c => ({ text: c, figures: figuresIn(c).map(f => f.key), stems: [...new Set(tokens(c).filter(t => !t.punct && contentWord(t.w)).map(t => stem(t.w)))]
        .filter(x => !termWords.some(tw => stem(tw) === x)) }));
    if (criteria.length >= 2) out.push({ term: termWords.join(' '), termStems: termWords.map(stem), criteria, sentence: s });
  }
  return out;
}
const criterionIn = (c, s) => {
  const figs = figuresIn(s).map(f => f.key);
  if (c.figures.length) return c.figures.some(k => figs.includes(k));
  const st = new Set(tokens(s).filter(t => !t.punct).map(t => stem(t.w)));
  const hit = c.stems.filter(x => st.has(x)).length;
  return hit >= Math.min(2, c.stems.length);
};

/** Everything above for one sentence. */
function analyseSentence(s) {
  const l = lower(s);
  const toks = tokens(l);
  const figures = figuresIn(l).map(f => { const b = bindAct(toks, f); return { ...f, act: b ? b.act : null, actAt: b ? b.at : null, actEnd: b ? b.end : null, role: roleOf(l, toks, f) }; });
  const acts = [];
  toks.forEach((t, k) => { if (!t.punct) { const a = actOf(t.w); if (a) acts.push({ act: a, polarity: polarityAt(toks, k), word: t.w }); } });
  const quoted = [...l.matchAll(/«([^»]{2,60})»|"([^"]{2,60})"/gu)].map(m => (m[1] || m[2]).trim());
  return { text: s, lower: l, toks, figures, acts, order: orderPairs(toks), connectors: connectorPairs(toks), quoted,
    stems: new Set(toks.filter(t => !t.punct && contentWord(t.w) && !actOf(t.w)).map(t => stem(t.w))) };
}

/** The source analysed once (an explanation's two sections share it). */
function analyseText(text) {
  const sentences = sentencesOf(text).filter(s => s.length < 1200).map(analyseSentence);
  // a sentence that does not open a clause continues the one before it
  // ("\"X\" belgisidan foydalanadi. Ushbu belgi uchun ariza berilmagan.")
  sentences.forEach((s, i) => { if (i + 1 < sentences.length && !/^(?:\d+(?:\.\d+)*\.|[\p{Lu}\d ]{6,}$)/u.test(sentences[i + 1].text)) s.next = sentences[i + 1]; });
  return { sentences, definitions: definitionsIn(sentences.map(x => x.text)) };
}

/** Source sentences on the same matter as `a`: the same quoted name, else the most shared words. */
function matching(a, src) {
  if (a.quoted.length) {
    const byName = src.sentences.filter(s => a.quoted.some(q => s.quoted.includes(q)));
    if (byName.length) return [...new Set(byName.flatMap(s => (s.next ? [s, s.next] : [s])))];
  }
  // the best match and those close to it: a long answer sentence may speak
  // of two neighbouring source sentences
  const scored = [];
  for (const s of src.sentences) {
    let shared = 0;
    for (const w of a.stems) if (s.stems.has(w)) shared++;
    if (shared < 2 || shared / Math.max(1, a.stems.size) < 0.4) continue;
    scored.push({ s, shared });
  }
  const best = Math.max(0, ...scored.map(x => x.shared));
  return scored.filter(x => x.shared >= Math.max(2, best * 0.75)).map(x => x.s);
}

/**
 * What an answer (or any later stage) ties differently from the source:
 * [{ kind, note }]. Kinds:
 *   bog'lanish  - a period or date attached to another act than in the source;
 *   holat       - an act denied / done where the source, on the same matter,
 *                 denies or affirms another act, or the opposite;
 *   tartib      - two acts in the opposite order;
 *   va/yoki     - "or" where the source says "and" between the same words, or back;
 *   ehtimollik  - damage / risk / loss stated as certain where the source
 *                 states it only as possible;
 *   ta'rif      - a definition's threshold given as a sanction;
 *   mezon       - a defined term with only some of its criteria;
 *   chegara     - a ceiling ("oshmaydi") given as a rate, or a rate as a ceiling;
 *   istisno     - an exception the source makes, denied.
 * `denied(sentence, index, length)` (document-explain) is true when the
 * claim's own clause denies or doubts it ("... muddati emas", "... degani
 * emas"); `asserted` also leaves out the condition of an "if" ("agar X
 * bo'lsa"). A period, date, amount, act, order or connector is checked in a
 * conditional sentence too - only its denial takes it out; a status and a
 * "possible vs caused" statement are not checked inside the condition (it
 * states no status), but are in its consequence. A flag is a reason to
 * check by hand.
 */
function relationFlags(answer, src, { asserted = () => true, denied = () => false, stage = 'javob' } = {}) {
  const where = `${stage}da`;
  const out = [];
  const seen = new Set();
  const add = (kind, note) => { const k = `${kind}|${note}`; if (!seen.has(k)) { seen.add(k); out.push({ kind, note }); } };
  const srcBy = new Map();
  for (const s of src.sentences) for (const f of s.figures) { if (!srcBy.has(f.key)) srcBy.set(f.key, []); srcBy.get(f.key).push(f); }
  const srcOrder = new Set(src.sentences.flatMap(s => s.order.map(p => p.join('>'))));
  const srcConn = new Map();
  for (const s of src.sentences) for (const c of s.connectors) { if (!srcConn.has(c.key)) srcConn.set(c.key, new Set()); srcConn.get(c.key).add(c.type); }
  const modalOnly = MODAL_NOUNS.filter(n => {
    const withNoun = src.sentences.filter(s => n.re.test(s.lower));
    return withNoun.length && withNoun.every(s => MODAL.test(s.lower));
  });
  const ans = sentencesOf(answer).map(analyseSentence);
  ans.forEach((a, ai) => {
    const isAsserted = (needle) => { const i = a.lower.indexOf(needle); return i < 0 || asserted(a.lower, i, needle.length); };
    // a figure, an act or a connector is a claim in a conditional sentence
    // too ("agar bitim 10 kun ichida tuzilmasa"): only a denial of that
    // claim, in its own clause, takes it out ("... muddati emas")
    const claimDenied = (from, to) => denied(a.lower, from, Math.max(0, to - from))
      // "... bitim tuzish muddati emas": a bare "emas" right after the claim, in its clause
      || /^\s*(?:[\p{L}'-]+\s+){0,2}(?:emas|не является)(?![\p{L}'])/u.test(a.lower.slice(to).split(/[,;:]/u)[0]);
    // periods and dates on another act
    for (const f of a.figures) {
      const same = (srcBy.get(f.key) || []).filter(x => f.kind !== 'date' || x.year == null || f.year == null || x.year === f.year);
      if (f.act && f.kind !== 'percent' && f.kind !== 'amount') {
        const acts = new Set(same.map(x => x.act).filter(Boolean));
        if (acts.size && !acts.has(f.act) && !claimDenied(Math.min(f.at, f.actAt), Math.max(f.end, f.actEnd))) {
          add("bog'lanish", `«${f.raw}» ${where} «${ACT_LABEL[f.act]}» bilan, hujjatda «${[...acts].map(x => ACT_LABEL[x]).join('», «')}» bilan`);
        }
      }
      // a definition's threshold as a sanction
      if (f.role === 'sanction' && same.length && !same.some(x => x.role === 'sanction' || x.role === 'cap') && same.some(x => x.role === 'definition') && !claimDenied(f.at, f.end)) {
        add("ta'rif", `«${f.raw}» ${where} jarima/sanksiya yonida, hujjatda faqat ta'rif chegarasi sifatida`);
      }
      // a ceiling given as a rate, or a rate as a ceiling ("0,1 foiz penya,
      // jami 10 foizdan oshmaydi" -> "10 foiz penya")
      if (same.length && !claimDenied(f.at, f.end)) {
        const srcCap = same.some(x => x.role === 'cap'), srcOnlyCap = same.every(x => x.role === 'cap');
        if (f.role === 'cap' && !srcCap) add('chegara', `«${f.raw}» ${where} yuqori chegara sifatida, hujjatda chegara emas`);
        else if (f.role === 'sanction' && srcOnlyCap) add('chegara', `«${f.raw}» hujjatda faqat yuqori chegara («oshmaydi»), ${where} jarima/penya stavkasi sifatida`);
      }
    }
    // an act denied or done where the source, on the same matter, says otherwise
    const asserts = a.acts.filter(x => (x.polarity === 'neg' || x.polarity === 'done') && isAsserted(x.word));
    if (asserts.length) {
      const m = matching(a, src);
      for (const x of asserts) {
        const inSrc = m.flatMap(s => s.acts);
        if (!inSrc.length || inSrc.some(y => y.act === x.act && y.polarity === x.polarity)) continue;
        const opposite = inSrc.find(y => y.act === x.act && (y.polarity === 'neg' || y.polarity === 'done'));
        if (opposite) add('holat', `«${ACT_LABEL[x.act]}» ${where} ${POLARITY_LABEL[x.polarity]}, hujjatning shu bandida ${POLARITY_LABEL[opposite.polarity]}`);
        else {
          const other = inSrc.find(y => y.act !== x.act && y.polarity === x.polarity);
          if (other) add('holat', `${where} «${ACT_LABEL[x.act]}» ${POLARITY_LABEL[x.polarity]}; hujjatning shu bandida ${POLARITY_LABEL[other.polarity]} — «${ACT_LABEL[other.act]}»`);
        }
      }
    }
    // order of two acts
    for (const p of a.order) {
      if (srcOrder.has([p[1], p[0]].join('>')) && !srcOrder.has(p.join('>')) && !claimDenied(p.at, p.end)) {
        add('tartib', `${where} «${ACT_LABEL[p[0]]}» «${ACT_LABEL[p[1]]}»dan oldin; hujjatda teskari`);
      }
    }
    // "and" / "or"
    for (const c of a.connectors) {
      const types = srcConn.get(c.key);
      const at = a.lower.indexOf(c.words);
      if (types && !types.has(c.type) && !(at >= 0 && claimDenied(at, at + c.words.length))) add('va/yoki', `«${c.words}» — hujjatda shu so'zlar orasida «${c.type === 'or' ? 'va' : 'yoki'}»`);
    }
    // an exception the source makes, denied ("... bundan mustasno emas")
    const exDenied = a.lower.match(/(?:bundan mustasno|istisno\p{L}*)\s+(?:[\p{L}'-]+\s+)?(?:emas|qilinmaydi|не является)(?![\p{L}'])/u);
    if (exDenied && src.sentences.some(x => /bundan mustasno|istisno/u.test(x.lower)) && !src.sentences.some(x => x.lower.includes(exDenied[0]))) {
      add('istisno', `«${exDenied[0]}» — hujjatda istisno inkor qilinmagan`);
    }
    // possible stated as certain
    for (const n of modalOnly) {
      if (!n.re.test(a.lower) || MODAL.test(a.lower)) continue;
      if (!(DEFINITE.test(a.lower) || a.figures.some(f => f.kind === 'amount'))) continue;
      const i = a.lower.search(n.re);
      if (!asserted(a.lower, Math.max(0, i), 6)) continue;
      add('ehtimollik', `«${n.id}» hujjatda faqat ehtimol sifatida («mumkin», «ehtimoliy»), ${where} aniq`);
    }
  });
  // a defined term with only some of its criteria (in its sentence or the next)
  for (const d of src.definitions) {
    ans.forEach((a, i) => {
      if (!d.termStems.every(t => a.stems.has(t) || [...a.toks].some(x => stem(x.w) === t))) return;
      const near = `${a.lower} ${(ans[i + 1] || { lower: '' }).lower}`;
      const hit = d.criteria.filter(c => criterionIn(c, near));
      if (hit.length && hit.length < d.criteria.length) add('mezon', `«${d.term}»: hujjatda ${d.criteria.length} ta mezon, ${stage}ning shu joyida ${hit.length} tasi uchradi`);
    });
  }
  return out;
}

// ── The digest kept the clause's relations? (for the trace, not the answer) ──
const EXCEPTION = /bundan mustasno|bundan tashqari|istisno|за исключением|кроме случа/u;
const CONDITION_FAMILIES = [
  { id: 'oldidan', re: /oldidan|dan oldin|avval|до (?:момента|перечисления|выплаты)/u },
  { id: 'keyin', re: /dan keyin|dan so'ng|boshlab|после/u },
  { id: 'sharti bilan', re: /sharti bilan|при условии/u },
  { id: 'agar', re: /(?:^|[^\p{L}'])(?:agar|basharti)(?![\p{L}'])|если|в случае/u },
  { id: '-ganda', re: /\p{L}{3,}(?:ganda|ganida|ganidan so'ng)(?![\p{L}'])/u },
  // "oshsa", "buzilsa", "kechiksa" (if); "bajarilmaguncha" (until)
  { id: '-sa', re: /\p{L}{3,}(?:sa|masa)(?=[\s,])/u },
  { id: '-guncha', re: /\p{L}{3,}guncha(?![\p{L}'])/u },
];
// a finding's status and source: "aniqlanmadi", "tekshirilmadi", "mavjud
// emas" (a key finding on its own), and "... ma'lumotiga ko'ra", "...
// holatiga" (whose words, as of when)
const FINDING = /aniqlanma\p{L}*|tekshirilma\p{L}*|mavjud emas|ko'rib chiqilma\p{L}*|не выявлен|не провер\p{L}*|отсутству\p{L}*/u;
const SOURCE_OR_DATE = /\p{L}+ga ko'ra|ma'lumotiga ko'ra|holatiga|по данным|по состоянию на|согласно/u;
const MONEY = /qiymat|narx|summa|to'lov|(?:^|\s)haqi(?![\p{L}'])|стоимост|цен[аыу]|сумм/u;
const CONSEQUENCES = [
  { id: 'jarima', re: /jarima|penya|neustoyka|штраф|пен[яи]|неустойк/u },
  { id: 'qaytarish', re: /qaytar|возвра/u },
  { id: 'zarar', re: /zarar|ziyon|убыт|ущерб/u },
  { id: 'xarajat', re: /xarajat|расход/u },
  { id: 'bekor qilish', re: /bekor qil|расторж|прекращ/u },
];

/** The relation slots of one clause: who, acts, conditions, periods, exceptions, consequences, criteria. */
function slotsOf(sentence, parties = []) {
  const a = analyseSentence(sentence);
  return {
    who: parties.filter(p => a.lower.includes(p)),
    acts: [...new Set(a.acts.map(x => x.act))],
    // an act denied or not identified: a status the answer must not change
    status: [...new Set(a.acts.filter(x => x.polarity === 'neg' || x.polarity === 'not_found').map(x => `${x.act}:${x.polarity}`))],
    connectors: a.connectors.map(c => c.type),
    modal: MODAL_NOUNS.some(n => n.re.test(a.lower)) && MODAL.test(a.lower),
    condition: CONDITION_FAMILIES.filter(c => c.re.test(a.lower)).map(c => c.id),
    when: a.figures.filter(f => f.kind === 'period' || f.kind === 'date').map(f => f.raw),
    exception: EXCEPTION.test(a.lower) ? ['istisno'] : [],
    consequence: CONSEQUENCES.filter(c => c.re.test(a.lower)).map(c => c.id),
    figures: a.figures.map(f => f.key),
  };
}
const RICH_SLOTS = ['condition', 'when', 'exception', 'consequence'];
/** How many kinds of relation a clause carries (condition, period, exception, consequence, definition, status, possibility, "and/or"). */
// (a status counts twice: "ariza topshirilmagan" is a key finding on its own)
function relationScore(sentence) {
  const s = slotsOf(sentence);
  const l = lower(sentence);
  return RICH_SLOTS.filter(k => s[k].length).length + (DEFINITION.test(l) ? 1 : 0) + (s.acts.length && s.when.length ? 1 : 0)
    + (s.status.length || FINDING.test(l) ? 2 : 0) + (SOURCE_OR_DATE.test(l) ? 1 : 0) + (s.modal ? 1 : 0) + (s.connectors.length && s.acts.length ? 1 : 0)
    // a threshold that triggers a rule ("15 foizdan ortiq oshsa")
    + (s.condition.length && s.figures.some(f => !/^date\|/u.test(f)) && !s.when.length ? 1 : 0)
    // a price or amount the document sets
    + (s.figures.some(f => /\|so'm$/u.test(f)) && MONEY.test(l) ? 2 : 0);
}

/** The parties a document names in parentheses ("... MChJ (Jamiyat)") and common role words. */
function partiesOf(text) {
  const named = [...String(text || '').matchAll(/\(([\p{Lu}][\p{L}'ʻʼ‘’ -]{2,30})\)/gu)].map(m => lower(m[1]).trim());
  return [...new Set(named)].filter(p => !/^(?:keyingi|bundan|shu)/u.test(p)).slice(0, 12);
}

/**
 * For the document's key clauses (those with at least two kinds of relation,
 * or a definition), which of their slots each stage keeps, found word for
 * word (an act by its word, a period by its figure and unit, a condition and
 * an exception by their marker): [{ ref, clause, slots, notFound: { digest,
 * answer }, firstNotFoundAt }]. MECHANICAL: "not found" may be a synonym,
 * "found" may be on the wrong act - a lawyer compares the meaning.
 */
function relationTrace({ source, digest = null, answer, max = 40 }) {
  const parties = partiesOf(source);
  const src = sentencesOf(source).filter(s => s.length < 1200);
  const key = src.filter(s => relationScore(s) >= 2 || DEF_RE.test(lower(s)) || EXCEPTION.test(lower(s)));
  // boilerplate repeated under other numbers is one clause
  const once = new Set();
  // (only when nothing but the list number differs)
  const uniq = key.filter(s => { const k = lower(s).replace(/^\s*\d+(?:\.\d+)*\.?\s*/u, '').replace(/\s+/gu, ' ').trim(); if (once.has(k)) return false; once.add(k); return true; }).slice(0, max);
  const linesOf = t => (t == null ? null : sentencesOf(t).map(l => ({ text: l, stems: analyseSentence(l).stems })));
  const stages = { digest: linesOf(digest), answer: linesOf(answer) };
  return uniq.map(s => {
    const ref = (s.match(/^\s*(\d+(?:\.\d+)+)\.?\s/u) || [])[1] || null;
    const slots = slotsOf(s, parties);
    const defs = definitionsIn([s]);
    const notFound = {};
    let firstNotFoundAt = null;
    for (const stage of ['digest', 'answer']) {
      const lines = stages[stage];
      if (!lines) { notFound[stage] = null; continue; }
      const refRe = ref ? new RegExp(`(^|[^\\d.])${ref.replace(/\./gu, '\\.')}(?![\\d])`, 'u') : null;
      const st = analyseSentence(s).stems;
      const found = lines.filter(l => {
        if (refRe && refRe.test(l.text)) return true;
        let n = 0; for (const w of st) if (l.stems.has(w)) n++;
        return n >= 2 && n / Math.max(1, st.size) >= 0.5;
      });
      const near = lower(found.map(l => l.text).join(' \n '));
      const got = slotsOf(near, parties);
      const miss = {};
      if (!near.trim()) {
        notFound[stage] = { clause: ['band topilmadi'] };
        if (!firstNotFoundAt) firstNotFoundAt = stage;
        continue;
      }
      for (const k of ['who', 'acts', 'status', 'condition', 'exception', 'consequence']) {
        const lost = slots[k].filter(x => !got[k].includes(x));
        if (!lost.length) continue;
        miss[k] = k === 'acts' ? lost.map(x => ACT_LABEL[x])
          : k === 'status' ? lost.map(x => { const [act, pol] = x.split(':'); return `${ACT_LABEL[act]}: ${POLARITY_LABEL[pol]}`; }) : lost;
      }
      const gotFig = new Set(got.figures);
      const lostWhen = analyseSentence(s).figures.filter(f => (f.kind === 'period' || f.kind === 'date') && !gotFig.has(f.key)).map(f => f.raw);
      if (lostWhen.length) miss.when = lostWhen;
      for (const d of defs) {
        const lost = d.criteria.filter(c => !criterionIn(c, near));
        if (lost.length) miss.criteria = lost.map(c => c.text.slice(0, 60));
      }
      notFound[stage] = miss;
      if (!firstNotFoundAt && Object.keys(miss).length) firstNotFoundAt = stage;
    }
    return { ref, clause: s.length > 160 ? `${s.slice(0, 160)} …` : s, slots: { ...slots, figures: undefined, connectors: undefined, criteria: defs.length ? defs[0].criteria.length : 0 }, kind: 'relation_slots', notFound, firstNotFoundAt };
  });
}

// ── Digest -> answer: what a digest line holds that the answer, where it
// speaks of the same thing, does not hold word for word (2026-10-08, a
// production run: the digest kept "declared and unpaid", "all participants,
// including the investor", "costs" and "separately from damages", and a
// period counted from sending; the answer dropped them or counted from
// receipt). MECHANICAL: a word or a part not found is a reason to check by
// hand, never a verdict that meaning was lost; nothing is removed.
const KEEP_WORDS = [
  { label: 'jumladan', re: /shu jumladan|jumladan|в том числе|включая/u },
  { label: 'barcha', re: /(?:^|[^\p{L}'])barcha(?![\p{L}'])|(?:^|[^\p{L}])все(?!\p{L})/u },
  { label: 'faqat', re: /(?:^|[^\p{L}'])faqat(?![\p{L}'])|только/u },
  { label: "e'lon qilingan", re: /e'lon qilingan|объявленн/u },
  { label: 'alohida', re: /alohida|отдельно/u },
  { label: 'bundan tashqari', re: /bundan tashqari|...dan tashqari|tashqari alohida|помимо/u },
  { label: 'kamida', re: /kamida|не менее/u },
  { label: "ko'pi bilan / oshmaydi", re: /ko'pi bilan|oshmaydi|oshmasligi|не более|не превыша/u },
  { label: 'birinchi navbatda', re: /birinchi navbatda|в первую очередь/u },
  { label: 'solidar', re: /solidar|солидарн/u },
];
const START = /([\p{L}'-]+)\s+(?:sana|kun|payt)\p{L}*\s+(?:boshlab|dan)?/u;
const PERMIT = /mumkin|haqli|huquqiga ega|вправе|может/u;
const OBLIGE = /kerak|shart(?! bilan)|majbur|lozim|обязан|должн/u;

/** One digest line in the structured format: its topic, who, act and labelled fields. */
function parseDigestLine(line) {
  const t = String(line || '').replace(/^\s*-\s*/u, '');
  if (!t.includes('|')) return null;
  const fields = t.split(/\s+\|\s+/u).map(x => x.trim());
  const out = { raw: t, topic: fields[0] || '', who: '', act: '', fields: {} };
  for (const f of fields.slice(1)) {
    const m = f.match(/^(shart|muddat|istisno|oqibat|miqdor|natija|mablag')\s*:\s*(.+)$/u);
    if (m) out.fields[m[1]] = m[2];
    else if (f.includes('→')) { const [w, a] = f.split('→'); out.who = w.trim(); out.act = (a || '').trim(); }
  }
  return out;
}
/** The items of a list field: "A, B va C" -> [A, B, C] (a parenthesis stays with its item). */
function listItems(text) {
  return String(text || '').replace(/\([^)]*\)/gu, m => m.replace(/,| va /gu, ' ')).split(/,\s*|\s+va\s+|\s+hamda\s+|;\s*/u).map(x => x.trim()).filter(x => x.length > 3);
}
const stemsOf = t => new Set(tokens(lower(t)).filter(x => !x.punct && contentWord(x.w)).map(x => stem(x.w)));
const covered = (item, text) => { const st = [...stemsOf(item)]; if (!st.length) return true; const tt = stemsOf(text); return st.filter(x => tt.has(x)).length >= Math.min(2, st.length); };

// parts ranked by how much a loss changes the clause; the conditions of a
// line are not listed (an answer rephrases them; scope words, periods and
// exceptions inside them are checked through their own parts)
const PART_WEIGHT = { 'qamrov so\'zi': 5, 'muddat boshlanishi': 5, oqibat: 4, istisno: 4, 'boshqa qiymat': 4, subyekt: 3 };
const GENERIC_WHO = /^(?:taraflar|tomonlar|har bir taraf|taraf|стороны)$/u;
function digestAnswerSignals(digestText, answer, { max = 6 } = {}) {
  const ans = sentencesOf(answer).map(x => ({ text: x, lower: lower(x), stems: stemsOf(x) }));
  // the actors the digest names (not "the parties")
  // named actors only: a capitalised party ("Investor", "Jamiyat"), not "shaxs" or "-"
  const actors = [...new Set(String(digestText || '').split('\n').map(parseDigestLine).filter(Boolean)
    .map(d => d.who.replace(/\([^)]*\)/gu, '').trim()).filter(w => /^[«"“]?\p{Lu}/u.test(w) && !GENERIC_WHO.test(lower(w)) && w.split(/\s+/u).length <= 3))];
  const out = [];
  for (const raw of String(digestText || '').split('\n')) {
    const d = parseDigestLine(raw);
    if (!d || !(d.act || Object.keys(d.fields).length)) continue;
    const key = stemsOf(`${d.topic} ${d.who} ${d.act}`);
    if (key.size < 2) continue;
    // the answer's sentences on the same thing (and the one after each)
    let best = 0, idx = [];
    ans.forEach((a, i) => {
      let n = 0; for (const w of key) if (a.stems.has(w)) n++;
      if (n < 2 || (n / key.size < 0.3 && n / Math.max(1, a.stems.size) < 0.3)) return;
      if (n > best) { best = n; idx = [i]; } else if (n === best) idx.push(i);
    });
    if (!idx.length) continue; // the answer does not speak of it: coverage, not a change
    const near = idx.flatMap(i => [ans[i], ans[i + 1]]).filter(Boolean);
    const nl = near.map(x => x.lower).join(' ');
    const lineL = lower(d.raw);
    const lost = [];
    for (const w of KEEP_WORDS) if (w.re.test(lineL) && !w.re.test(nl)) lost.push({ part: 'qamrov so\'zi', value: w.label });
    // the same kind of figure with another value where the answer speaks of it
    const nearFigs = figuresIn(nl);
    for (const f of figuresIn(lineL)) {
      if (nearFigs.some(g => g.key === f.key)) continue;
      // only where the answer states one value of that kind (a list of values is not one claim)
      const same = nearFigs.filter(g => g.key.split('|')[1] === f.key.split('|')[1] && g.kind === f.kind);
      const other = same.length === 1 ? same[0] : null;
      if (other) lost.push({ part: 'boshqa qiymat', value: `dayjestda «${f.raw}», javobda «${other.raw}»` });
    }
    for (const k of ['oqibat', 'istisno']) for (const item of listItems(d.fields[k])) if (!covered(item, nl)) lost.push({ part: k, value: item });
    // the event a period counts from ("yuborilgan sanadan" vs "olgan sanadan")
    const ds = (lower(d.fields.muddat || '').match(START) || [])[1];
    const as = (nl.match(START) || [])[1];
    if (ds && as && stem(ds) !== stem(as)) lost.push({ part: 'muddat boshlanishi', value: `dayjestda «${ds} …dan», javobda «${as} …dan»` });
    // who acts: the answer, on this act, names another actor the digest knows
    const who = d.who.replace(/\([^)]*\)/gu, '').trim();
    const nearRaw = near.map(x => x.text).join(' ');
    if (actors.includes(who) && !nearRaw.includes(who)) {
      const otherActor = actors.find(x => x !== who && !who.includes(x) && !x.includes(who) && nearRaw.includes(x));
      if (otherActor) lost.push({ part: 'subyekt', value: `dayjestda «${who}», javobda «${otherActor}»` });
    }
    if (!lost.length) continue;
    lost.sort((x, y) => PART_WEIGHT[y.part] - PART_WEIGHT[x.part]);
    // how surely the answer's sentence is about this line, and how much is missing
    const strength = best / key.size;
    const weight = lost.reduce((t, l) => t + PART_WEIGHT[l.part], 0) * strength;
    out.push({ kind: 'dayjest_javob', topic: d.topic.slice(0, 80), weight, lost: lost.slice(0, 4) });
  }
  return out.sort((x, y) => y.weight - x.weight).slice(0, max);
}

/**
 * Permission stated as an obligation: the answer says "must" (kerak, shart,
 * majbur) where the source's sentences on the same matter only say "may"
 * (mumkin, haqli). Same source matching as the status check. A flag means
 * "check by hand".
 */
function permissionFlags(answer, src, { asserted = () => true } = {}) {
  const out = [];
  for (const a of sentencesOf(answer).map(analyseSentence)) {
    const m = a.lower.match(OBLIGE);
    if (!m || !asserted(a.lower, m.index, m[0].length)) continue;
    const srcs = matching(a, src);
    if (srcs.length && srcs.every(x => PERMIT.test(x.lower) && !OBLIGE.test(x.lower))) {
      const at = Math.max(0, m.index - 50);
      out.push({ kind: 'majburiyat', note: `javobda «…${a.text.slice(at, m.index + m[0].length).replace(/^\S*\s/u, '')}», hujjatning shu bandida faqat imkoniyat («mumkin» / «haqli»)` });
    }
  }
  return out;
}

// ── Table rows (src/ocr/docx-text.js): a value of one row stated with another ──
/** The rows of the table reader's lines: { table, label, values: [{ header, value }] }. */
function tableRows(source) {
  const rows = [];
  for (const line of String(source || '').split('\n')) {
    const m = line.match(/^⟦Jadval (\d+) · (\d+)-qator[^⟧]*⟧ (.*)$/u);
    if (!m) continue;
    const cells = m[3].split(' ¦ ').map(c => { const x = c.match(/^⟨([^⟩]*)⟩ ?(.*)$/u); return x ? { header: x[1], value: x[2].replace(/^⟨↑ |⟩$/gu, '') } : { header: '', value: c }; });
    // the row's name: its first cell with letters that is not a bare number
    const named = cells.find(c => /\p{L}{3,}/u.test(c.value) && !/^⟨/u.test(c.value));
    rows.push({ table: Number(m[1]), row: Number(m[2]), label: named ? named.value : '', cells });
  }
  return rows;
}
const valueKey = v => lower(v).replace(/[\s.,;:()'"«»-]+/gu, ' ').trim();
/**
 * A sentence of the answer (or digest) that names one table row and states
 * a value (figure, period, date) found in another row of that table but not
 * in this one: [{ kind: 'jadval', note }]. MECHANICAL: a reason to check by hand.
 */
function tableFlags(text, source, { stage = 'javob' } = {}) {
  const rows = tableRows(source).filter(r => r.label);
  if (!rows.length) return [];
  const out = [];
  const seen = new Set();
  for (const sent of sentencesOf(text)) {
    const sk = ` ${valueKey(sent)} `;
    const sSt = stemsOf(sent);
    const named = rows.filter(r => { const st = [...stemsOf(r.label)]; return st.length >= 2 && st.filter(x => sSt.has(x)).length >= Math.min(3, st.length); });
    if (!named.length) continue;
    for (const r of named) {
      const own = new Set(r.cells.map(c => valueKey(c.value)));
      for (const o of rows.filter(x => x.table === r.table && x !== r && !named.includes(x))) {
        for (const c of o.cells) {
          const v = valueKey(c.value);
          if (v.length < 4 || !/\d/u.test(v) || own.has(v) || [...own].some(w => w.includes(v))) continue;
          if (!sk.includes(` ${v} `)) continue;
          const k = `${r.label}|${v}`;
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({ kind: 'jadval', note: `${stage}da «${r.label.slice(0, 60)}» qatori bilan «${c.value.slice(0, 50)}» (${c.header || 'ustun'}) — hujjatda bu qiymat «${o.label.slice(0, 60)}» qatorida` });
        }
      }
    }
    if (out.length >= 8) break;
  }
  return out;
}

module.exports = {
  tableRows, tableFlags,
  digestAnswerSignals, parseDigestLine, permissionFlags,
  POLARITY_LABEL, ACTS, ACT_LABEL, actOf, sentencesOf, figuresIn, analyseSentence, analyseText, relationFlags, relationTrace, relationScore, slotsOf,
  definitionsIn, partiesOf, DEFINITION,
};
