'use strict';

/**
 * Reference scanning + lex.uz resolution for the legal-opinion pipeline.
 *
 * Two problems this solves, both observed on a real 79k-char outsourcing
 * report whose opinion came back as "KONTEKSTda tasdiqlanmadi":
 *
 *  1. Uzbek reports cite acts INFORMALLY — "306-sonli qaror", "(306, 7–12-m.;
 *     684)", "16-sonlili qaror" (typo), "276-sonli ijro Nizomiga". The
 *     prefixed regex in answer-verification.js (PF/PQ/VM/O'RQ + digits) never
 *     fires on any of those, and an LLM extractor reading a *summary* of the
 *     document loses them too. scanBareReferences() reads the RAW text and
 *     catches the bare "<N>-son" family directly.
 *
 *  2. A single literal lex.uz query built as "<number> <name>" does not
 *     reliably surface the act: lex.uz is indexed primarily in Cyrillic, under
 *     prefixed forms (ВМҚ-, ПҚ-, ЎРҚ-). resolveReference() tries an ordered
 *     list of query variants — Cyrillic-prefixed first — until one hits, and
 *     reports which variant worked so failures are diagnosable from the log.
 *
 * Source restriction is unchanged: searchLexUz only ever queries
 * lex.uz/search/nat and fetches lex.uz documents.
 */

const { searchLexUz } = require('./lex-live-search');

// ─────────────────────────────────────────────────────────────────────────────
// Scanning
// ─────────────────────────────────────────────────────────────────────────────

// "306-sonli qaror", "596-son qarordagi", "16-sonlili qaror" (tolerates the
// -son / -sonli / -sonlili / -сон / -сонли tail and en/em dashes).
const BARE_NUMBER_RE =
  /(?<![\p{L}\p{N}])(\d{1,5})\s*[-–—]?\s*(?:son|сон)(?:li|lili|ли)?(?![\p{L}\p{N}])/giu;

// A list of numbers sharing one trailing "-son": "4734 va 4735-son qonunlari",
// "276, 596-son qarorlar". Only the last number carries the suffix, so the
// single-number pattern above sees just one of them.
const NUMBER_LIST_RE =
  /(?<![\p{L}\p{N}])\d{1,5}(?:\s*(?:,|va|hamda|и|и\s)\s*\d{1,5})+\s*[-–—]?\s*(?:son|сон)(?:li|lili|ли)?(?![\p{L}\p{N}])/giu;

// Prefixed forms that carry their own type: PF-200, ПФ-200, F-59, PQ-4624.
// "F-" (farmoyish) is included — answer-verification.js does not cover it.
const PREFIXED_RE =
  /(?<![\p{L}\p{N}])(PF|PQ|VM|VMQ|F|O['`’]?RQ|QR|ПФ|ПҚ|ВМ|ВМҚ|Ф|ЎРҚ|ҚР)\s*[-–—]\s*(\d{1,5})(?:\s*[-–—]?\s*(?:son|сон))?(?![\p{L}\p{N}])/giu;

// A parenthesised citation list: "(306, 7–12-m.; 684)". Numbers here are only
// accepted when the SAME number is written as "<N>-son" elsewhere in the
// document — corroboration keeps ordinary numerals out.
const PAREN_LIST_RE = /\(([^()]{0,120}?\d[^()]{0,120}?)\)/gu;

const CYR_PREFIX = {
  PF: 'ПФ', PQ: 'ПҚ', VM: 'ВМ', VMQ: 'ВМҚ', F: 'Ф', ORQ: 'ЎРҚ', QR: 'ҚР',
};
const CYR_TO_LATIN = {
  'ПФ': 'PF', 'ПҚ': 'PQ', 'ВМ': 'VM', 'ВМҚ': 'VMQ', 'Ф': 'F', 'ЎРҚ': 'ORQ', 'ҚР': 'QR',
};

function canonPrefix(raw) {
  const p = String(raw || '').toUpperCase().replace(/['`’]/g, '');
  return CYR_TO_LATIN[p] || p;
}

// Words near a bare number that reveal what kind of act it is. Checked against
// a window of surrounding text, longest/most specific pattern first.
const TYPE_HINTS = [
  [/prezident\w*\s+farmoni|президент\w*\s+фармони/iu,        { type: 'prezident_farmoni', prefix: 'PF' }],
  [/prezident\w*\s+qarori|президент\w*\s+қарори/iu,          { type: 'prezident_qarori',  prefix: 'PQ' }],
  [/prezident\w*\s+farmoyishi|президент\w*\s+фармойиши/iu,   { type: 'farmoyish',         prefix: 'F'  }],
  [/vazirlar\s+mahkamasi\w*|вазирлар\s+маҳкамаси\w*|VM\b/iu, { type: 'VM_qarori',         prefix: 'VMQ' }],
  [/qonun\w*|қонун\w*/iu,                                    { type: 'qonun',             prefix: 'ORQ' }],
  [/qaror\w*|қарор\w*/iu,                                    { type: 'VM_qarori',         prefix: 'VMQ' }],
];

// Jurisdiction markers. lex.uz indexes O'zbekiston law only, so a number cited
// next to one of these is a FOREIGN instrument: searching lex.uz for it can
// only return an unrelated Uzbek act that happens to contain the same digits.
// (Real case: "Turkiyaning 4734 va 4735-son qonunlari" and "2014/24/EU".)
const FOREIGN_HINTS = [
  [/t[uü]rkiya\w*|t[uü]rk\s+\w*qonun|туркия\w*/iu,                          'Turkiya'],
  [/yevropa\s+ittifoq\w*|\bEU\b|\bEC\b|\d{4}\s*\/\s*\d{1,3}\s*\/\s*EU/iu,  'Yevropa Ittifoqi'],
  [/\bOECD\b|\bIHTT\b|ИХТТ/iu,                                              'OECD'],
  [/angliya\w*|buyuk\s+britaniya\w*|\bUK\b/iu,                              'Angliya'],
  [/qozog['`’]?iston\w*|rossiya\s+federatsiya\w*/iu,                        'xorijiy'],
];

const DATE_RE =
  /(\d{1,2}[.\-/]\d{1,2}[.\-/](?:19|20)\d{2})|((?:19|20)\d{2})[-\s]?yil\w*\s+(\d{1,2})[-\s]?([a-zA-Zʼ’'о-я]+)/giu;

/** Pull a date written within `back` chars before the match, if any. */
function nearbyDate(text, at, back = 90) {
  const window = text.slice(Math.max(0, at - back), at);
  DATE_RE.lastIndex = 0;
  let m, last = '';
  while ((m = DATE_RE.exec(window)) !== null) last = m[0];
  return last.trim();
}

/** Infer act type + lex.uz prefix from the words around the number. */
function inferType(text, at) {
  const window = text.slice(Math.max(0, at - 120), at + 120);
  for (const [re, hint] of TYPE_HINTS) if (re.test(window)) return hint;
  return { type: 'boshqa', prefix: '' };
}

// Markers that positively identify a number as O'zbekiston law. When one of
// these sits between a foreign marker and the number, the number is domestic.
const DOMESTIC_HINTS =
  /o['`‘’]?zbekiston|ўзбекистон|o['`‘’]?zr\b|vazirlar\s+mahkamasi|вазирлар|prezidentining|президентининг|respublikasi\s+qonuni|vazirligi/iu;

/**
 * Which foreign jurisdiction (if any) this number belongs to.
 *
 * Attribution in Uzbek is prenominal and clause-local — "Turkiyaning 4734 va
 * 4735-son qonunlari", "Yevropa Ittifoqining 2014/24/EU direktivasi" — so the
 * evidence is looked for in the CURRENT clause only. Scanning a fixed ±150
 * char window instead would mark a domestic act foreign whenever a comparative
 * report mentions Turkey one sentence earlier, and a domestic act wrongly
 * marked foreign is never looked up at all — the exact failure being fixed.
 */
function inferJurisdiction(text, at) {
  // Back to the start of the clause (sentence/semicolon/newline), max 120 chars.
  const backStart = Math.max(0, at - 120);
  let back = text.slice(backStart, at);
  const cut = Math.max(back.lastIndexOf('.'), back.lastIndexOf(';'), back.lastIndexOf('\n'));
  if (cut !== -1) back = back.slice(cut + 1);

  // Forward only as far as the same clause continues, max 50 chars.
  let fwd = text.slice(at, Math.min(text.length, at + 50));
  const fcut = fwd.search(/[.;\n]/);
  if (fcut !== -1) fwd = fwd.slice(0, fcut);

  const clause = back + fwd;
  if (DOMESTIC_HINTS.test(clause)) return '';

  // Attribution is consumed by the first act it governs: in "Yevropa
  // Ittifoqining 2014/24/EU direktivasi va 16-sonlili qaror", "16" belongs to
  // the conjunct, not to the EU. So a foreign marker stops carrying once an
  // act-noun and a conjunction stand between it and the number.
  const HANDOFF =
    /(direktiva|qonun|qaror|hujjat|reglament|nizom|farmon|qoida|tartib|standart|tavsiya|amaliyot|tajriba|me['`‘’]?yor)\w*\s*(?:,|\bva\b|\bhamda\b|\bи\b)/iu;

  for (const [re, label] of FOREIGN_HINTS) {
    re.lastIndex = 0;
    const m = re.exec(clause);
    if (!m) continue;
    const gap = clause.slice(m.index + m[0].length, back.length);
    if (gap && HANDOFF.test(gap)) continue;
    return label;
  }
  return '';
}

/**
 * A short human-readable name for the act, taken from the words immediately
 * following the number ("306-sonli qaror bilan tasdiqlangan Nizom" →
 * "qaror bilan tasdiqlangan Nizom").
 */
function nearbyName(text, endAt, forward = 90) {
  const window = text.slice(endAt, endAt + forward).replace(/\s+/g, ' ').trim();
  const cut = window.split(/[.;:()\n]|\s—\s/)[0] || '';
  return cut.slice(0, 120).trim();
}

/**
 * Scan RAW document text for legal references, without an LLM.
 *
 * @returns {Array<{type,name,number,date,claims:string[],prefix:string,
 *                  key:string,confidence:'high'|'low',hits:number}>}
 */
function scanBareReferences(text) {
  const src = String(text || '');
  if (!src) return [];

  /** key → ref */
  const byKey = new Map();

  const put = (digits, prefix, type, date, name, confidence, foreign) => {
    const key = `${prefix || '?'}-${digits}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.hits++;
      if (!existing.date && date) existing.date = date;
      if (!existing.name && name) existing.name = name;
      if (!existing.foreign && foreign) existing.foreign = foreign;
      if (confidence === 'high') existing.confidence = 'high';
      return;
    }
    byKey.set(key, {
      type: type || 'boshqa',
      name: name || '',
      number: digits,
      date: date || '',
      claims: [],
      prefix: prefix || '',
      key,
      confidence,
      foreign: foreign || '',
      hits: 1,
    });
  };

  // Explicitly prefixed: the prefix IS the type, no inference needed.
  let m;
  PREFIXED_RE.lastIndex = 0;
  while ((m = PREFIXED_RE.exec(src)) !== null) {
    const prefix = canonPrefix(m[1]);
    const type =
      prefix === 'PF' ? 'prezident_farmoni' :
      prefix === 'PQ' ? 'prezident_qarori' :
      prefix === 'F'  ? 'farmoyish' :
      prefix === 'ORQ' || prefix === 'QR' ? 'qonun' :
      prefix === 'VM' || prefix === 'VMQ' ? 'VM_qarori' : 'boshqa';
    put(m[2], prefix, type, nearbyDate(src, m.index), nearbyName(src, m.index + m[0].length), 'high',
        inferJurisdiction(src, m.index));
  }

  const bareDigits = new Set();

  // Number lists first ("4734 va 4735-son qonunlari"), recording the spans they
  // consume so the single-number pass below does not double-count the last one.
  const listSpans = [];
  NUMBER_LIST_RE.lastIndex = 0;
  while ((m = NUMBER_LIST_RE.exec(src)) !== null) {
    listSpans.push([m.index, m.index + m[0].length]);
    const { type, prefix } = inferType(src, m.index);
    const date = nearbyDate(src, m.index);
    const foreign = inferJurisdiction(src, m.index);
    const name = nearbyName(src, m.index + m[0].length);
    for (const d of m[0].matchAll(/\d{1,5}/g)) {
      bareDigits.add(d[0]);
      put(d[0], prefix, type, date, name, 'high', foreign);
    }
  }
  const inList = (i) => listSpans.some(([s, e]) => i >= s && i < e);

  // Bare "<N>-son(li)" — type inferred from surrounding words.
  BARE_NUMBER_RE.lastIndex = 0;
  while ((m = BARE_NUMBER_RE.exec(src)) !== null) {
    if (inList(m.index)) continue;
    const digits = m[1];
    bareDigits.add(digits);
    const { type, prefix } = inferType(src, m.index);
    put(digits, prefix, type, nearbyDate(src, m.index), nearbyName(src, m.index + m[0].length), 'high',
        inferJurisdiction(src, m.index));
  }

  // Parenthesised citation lists — only numbers already seen as "<N>-son".
  PAREN_LIST_RE.lastIndex = 0;
  while ((m = PAREN_LIST_RE.exec(src)) !== null) {
    const inner = m[1];
    // Skip pure article references ("7–12-m.") — those are clause locators,
    // not document numbers; only take standalone numerals.
    for (const d of inner.matchAll(/(?<![\p{L}\p{N}\-–—])(\d{2,5})(?![\p{L}\p{N}]|\s*[-–—]\s*(?:m\b|modda|band|qism))/gu)) {
      if (!bareDigits.has(d[1])) continue;   // corroboration required
      const { type, prefix } = inferType(src, m.index);
      put(d[1], prefix, type, '', '', 'low', inferJurisdiction(src, m.index));
    }
  }

  return [...byKey.values()];
}

/**
 * Merge LLM-extracted references with regex-scanned ones, deduping on the
 * document number. The LLM contributes `claims` (what the document asserts
 * about the act); the scanner contributes coverage and the lex.uz prefix.
 */
/**
 * Foreign check for a reference AS EXTRACTED (by the LLM), where the evidence
 * sits in the ref's own fields rather than in surrounding document text:
 * "2014/24/EU direktivasi", "Turkiyaning 4734-son qonuni". Without this, an
 * EU directive's year resolves against lex.uz and matches some Uzbek act
 * adopted in 2014.
 */
function refLooksForeign(r) {
  const s = [r.name, r.number, r.type].filter(Boolean).join(' ');
  if (/\d{4}\s*\/\s*\d{1,4}(\s*\/\s*(EU|EC|ЕС))?/iu.test(s) && /\bEU\b|\bEC\b|direktiv/iu.test(s)) return 'Yevropa Ittifoqi';
  for (const [re, label] of FOREIGN_HINTS) if (re.test(s)) return label;
  return '';
}

function mergeReferences(llmRefs = [], scanned = []) {
  // The scanner's "name" is whatever words trail the number, so it is often
  // just the act type ("qarori", "nizomi"). A real name from the LLM beats it.
  const isGenericName = (s) =>
    !s || /^(qaror|farmon|farmoyish|nizom|qonun|kodeks|reglament|tartib|band|modda|son)\w*\.?$/i.test(String(s).trim());

  const digitsOf = (s) => {
    const mm = String(s || '').match(/(\d{1,5})/);
    return mm ? mm[1] : '';
  };

  const byDigits = new Map();
  for (const r of scanned) {
    const d = r.number;
    if (!d) continue;
    if (!byDigits.has(d)) byDigits.set(d, { ...r });
  }

  for (const r of llmRefs) {
    const d = digitsOf(r.number);
    const foreign = refLooksForeign(r);
    if (!d) {
      // Named-only reference (e.g. "Fuqarolik kodeksi") — keep as-is.
      byDigits.set(`name:${(r.name || '').toLowerCase()}`, {
        type: r.type || 'boshqa', name: r.name || '', number: '', date: r.date || '',
        claims: r.claims || [], prefix: '', key: `name:${r.name}`, confidence: 'high',
        foreign, hits: 1,
      });
      continue;
    }
    const existing = byDigits.get(d);
    if (existing) {
      existing.claims = [...new Set([...(existing.claims || []), ...(r.claims || [])])].slice(0, 8);
      if (r.name && isGenericName(existing.name)) existing.name = r.name;
      if (!existing.date && r.date) existing.date = r.date;
      if (existing.type === 'boshqa' && r.type) existing.type = r.type;
      if (!existing.foreign && foreign) existing.foreign = foreign;
      existing.confidence = 'high';
    } else {
      byDigits.set(d, {
        type: r.type || 'boshqa', name: r.name || '', number: d, date: r.date || '',
        claims: r.claims || [], prefix: '', key: `?-${d}`, confidence: 'high',
        foreign, hits: 1,
      });
    }
  }

  return [...byDigits.values()];
}

/** Load-bearing score: numbered + claimed + frequently cited ranks highest. */
function scanWeight(ref) {
  return (ref.number ? 2 : 0)
    + (ref.claims ? ref.claims.length : 0)
    + (ref.name ? 1 : 0)
    + Math.min(ref.hits || 0, 4)
    + (ref.confidence === 'low' ? -3 : 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ordered lex.uz query variants for one reference. Cyrillic-prefixed forms go
 * first because lex.uz's index is primarily Cyrillic; bare and Latin forms are
 * the fallback; the plain name is the last resort.
 */
/**
 * True when a "name" is the LLM DESCRIBING an act rather than naming it —
 * e.g. "Davlat korxonalarida xarajatlarni kamaytirish va samaradorlikka oid
 * prezident hujjati". Searching such a string verbatim can only fail, so it is
 * not worth a lex.uz round-trip.
 */
function isDescriptiveName(name) {
  const s = String(name || '').trim();
  if (!s) return true;
  if (s.length > 70) return true;
  // "... ga oid prezident hujjati", "... bo'yicha qaror" — a trailing generic
  // act-word introduced by a DESCRIPTIVE connective, with up to a few words in
  // between ("oid PREZIDENT hujjati").
  //
  // "to'g'risidagi" and "haqidagi" are deliberately NOT descriptive: they form
  // the canonical Uzbek act title ("Davlat xaridlari to'g'risidagi Qonun"), and
  // treating them as descriptions suppressed the query for real laws.
  return /(?:^|[^\p{L}])(oid|doir|bo['`‘’]?yicha)\s+(?:\p{L}+\s+){0,3}(hujjat|qaror|farmon|norma|akt)\w*\.?$/iu.test(s);
}

function queryVariants(ref) {
  // Foreign instruments are not on lex.uz — never spend a lookup on them.
  if (ref.foreign) return [];

  const out = [];
  const num = String(ref.number || '').trim();
  const name = String(ref.name || '').trim();
  const year = (String(ref.date || '').match(/(?:19|20)\d{2}/) || [])[0] || '';
  const cyr = CYR_PREFIX[canonPrefix(ref.prefix)] || '';

  // A prefixless number that reads as a year (2014, 1996) is almost never a
  // real Uzbek act number in a report — it is a directive year or a date
  // fragment, and querying "2014-сон" can only match the wrong document.
  const yearLike = !cyr && /^(?:19|20)\d{2}$/.test(num);

  if (num && !yearLike) {
    if (cyr) {
      out.push(`${cyr}-${num}-сон`);
      out.push(`${cyr}-${num}`);
    }
    out.push(`${num}-сон`);
    if (year) out.push(`${num}-сон ${year}`);
    out.push(`${num}-son`);
    if (name && !isDescriptiveName(name)) out.push(`${num}-son ${name}`.slice(0, 120));
  }
  // A name-only query is worth trying only when the name is an actual title —
  // and in Cyrillic first, since that is the script lex.uz's index speaks.
  if (name && name.length >= 6 && !isDescriptiveName(name)) {
    const cyrName = translitToCyr(name).slice(0, 120);
    out.push(cyrName);
    if (num && !yearLike) out.push(`${num}-сон ${cyrName}`.slice(0, 120));
    out.push(name.slice(0, 120));
  }

  // Dedupe, drop anything too short for searchLexUz.
  return [...new Set(out)].filter(q => q.length >= 3);
}

// ─────────────────────────────────────────────────────────────────────────────
// Identity gate
// ─────────────────────────────────────────────────────────────────────────────

/** Digits of a document number, ignoring any prefix: "ПҚ-4624" → "4624". */
function numberDigits(s) {
  const m = String(s || '').match(/(\d{1,5})(?!.*\d)/);
  return m ? m[1] : '';
}

const NAME_STOPWORDS = new Set([
  'va', 'bilan', 'uchun', 'haqida', 'haqidagi', 'togrisida', 'togrisidagi',
  'oid', 'boyicha', 'qaror', 'qarori', 'qonun', 'qonuni', 'farmon', 'farmoni',
  'nizom', 'nizomi', 'hujjat', 'hujjati', 'son', 'sonli', 'respublikasi',
]);

// Uzbek Cyrillic → Latin, so a Latin citation can be compared with a Cyrillic
// lex.uz title. lex.uz publishes predominantly in Cyrillic while reports are
// written in Latin, so without this every cross-script comparison scores zero
// and the topical fallback can never fire.
const UZ_CYR_TO_LAT = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'ғ': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
  'ж': 'j', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'қ': 'q', 'л': 'l', 'м': 'm',
  'н': 'n', 'о': 'o', 'ў': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
  'ф': 'f', 'х': 'x', 'ҳ': 'h', 'ц': 's', 'ч': 'ch', 'ш': 'sh', 'щ': 'sh',
  'ъ': '', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya', 'ы': 'i',
};

// Latin → Uzbek Cyrillic, for building lex.uz QUERIES: the search index is
// predominantly Cyrillic, so "Davlat xaridlari to'g'risida" finds nothing
// while "Давлат харидлари тўғрисида" finds the law. Digraphs first.
// NOTE: no "ts"→ц rule — in Uzbek Latin, t+s across a morpheme boundary is far
// more common than a real ц ("autsorsing" → аутсорсинг, not "ауцорсинг", which
// is exactly the corrupted query lex.uz rejected in production).
const UZ_LAT_TO_CYR_DIGRAPHS = [
  [/o['`‘’ʻ]/gi, 'ў'], [/g['`‘’ʻ]/gi, 'ғ'], [/sh/gi, 'ш'], [/ch/gi, 'ч'],
  [/yo/gi, 'ё'], [/yu/gi, 'ю'], [/ya/gi, 'я'],
];
const UZ_LAT_TO_CYR = {
  a: 'а', b: 'б', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ж',
  k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', q: 'қ', r: 'р', s: 'с',
  t: 'т', u: 'у', v: 'в', x: 'х', y: 'й', z: 'з',
};

function translitToCyr(s) {
  let t = String(s || '').toLowerCase().replace(/[’‘`´ʼ]/g, "'");
  for (const [re, cyr] of UZ_LAT_TO_CYR_DIGRAPHS) t = t.replace(re, cyr);
  let out = '';
  for (const ch of t) out += UZ_LAT_TO_CYR[ch] || ch;
  return out;
}

function translitUz(s) {
  let out = '';
  for (const ch of String(s || '')) {
    out += Object.prototype.hasOwnProperty.call(UZ_CYR_TO_LAT, ch) ? UZ_CYR_TO_LAT[ch] : ch;
  }
  return out;
}

function nameTokens(s) {
  return translitUz(String(s || '').toLowerCase())
    .replace(/['`‘’ʻʼ´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !NAME_STOPWORDS.has(w));
}

/**
 * Does this lex.uz hit actually BELONG to the reference?
 *
 * lex.uz search is FULL TEXT: querying "306-сон" returns every document whose
 * body merely contains that string. Without this check, an outsourcing report
 * citing 306-son gets grounded on a burial-benefit regulation that happens to
 * mention 306 — which is exactly what happened in production, with four
 * unrelated acts printed under "Manbalar".
 *
 * fetchLexDocument already parses the document's OWN number and adoption date
 * out of its title, so the check is a metadata comparison, not another fetch.
 *
 * @returns {{ok: boolean, why: string}}
 */
/**
 * Every number a lex.uz page states as its OWN, split by evidence strength.
 *
 * STRONG — declarations of identity: parsed metadata, the act-form line
 * ("ВАЗИРЛАР МАҲКАМАСИНИНГ ҚАРОРИ ... N 596"), the national-registry path
 * ("03/21/684/0367" — segment 3 is the act's number, the tail only a
 * registration index), "№ N" anywhere, prefixed codes (ЎРҚ-684), and the
 * signature block in the document TAIL, which is where lex.uz puts a law's
 * number.
 *
 * WEAK — bare "N-сон" occurrences in the title/head. These are usually the
 * document talking about itself, but in amendment decrees ("...306-сон
 * қарорига ўзгартириш...") and preamble citations they name OTHER documents,
 * so they can support identity but never override a strong number.
 */
function documentOwnNumbers(hit) {
  const meta = (hit && hit.metadata) || {};
  const strong = new Set();
  const weak = new Set();

  const fromMeta = numberDigits(meta.document_number);
  if (fromMeta) strong.add(fromMeta);

  const strongSurfaces = [meta.act_form, meta.publication, hit && hit.tail]
    .filter(Boolean).join('\n');
  const weakSurfaces = [hit && hit.title, hit && hit.head]
    .filter(Boolean).join('\n');

  const collect = (text, into) => {
    // Registry path first — its digits must not leak into the generic patterns.
    let t = String(text);
    for (const m of t.matchAll(/\b\d{2}\/\d{2}\/(\d{1,5})\/\d{3,5}\b/g)) into.add(m[1]);
    t = t.replace(/\b\d{2}\/\d{2}\/\d{1,5}\/\d{3,5}\b/g, ' ');
    for (const m of t.matchAll(/(?<![\p{L}\p{N}])(\d{1,5})\s*[-–—]\s*(?:son|сон)(?![\p{L}\p{N}])/giu)) into.add(m[1]);
    for (const m of t.matchAll(/(?:№|\bN\b)\s*[-–—]?\s*(\d{1,5})(?![\p{L}\p{N}])/gu)) into.add(m[1]);
    for (const m of t.matchAll(/(?<![\p{L}\p{N}])[A-ZА-ЯЎҚҒҲ]{2,4}\s*[-–—]\s*(\d{1,5})(?![\p{L}\p{N}])/gu)) into.add(m[1]);
  };
  collect(strongSurfaces, strong);
  collect(weakSurfaces, weak);

  return { strong, weak };
}

/** "...қарорига ўзгартириш(лар) киритиш..." — an act ABOUT another act. */
function isAmendmentTitle(title) {
  return /ўзгартириш|ўзгартиш|қўшимча(?:лар)?\s+киритиш|o['`‘’]?zgartirish|qo['`‘’]?shimcha(?:lar)?\s+kiritish/iu
    .test(String(title || ''));
}

/**
 * Does this lex.uz hit actually BELONG to the reference?
 *
 * Three outcomes, not two — "the document says it is something else" and "the
 * document does not say what it is" are different failures. Rejecting both
 * outright discards correct matches, which is how a run that removed all the
 * junk also removed all the grounding.
 */
function matchesReference(ref, hit) {
  const meta = (hit && hit.metadata) || {};
  const wantNum = numberDigits(ref.number);
  const title = String(hit && hit.title || '');

  if (wantNum) {
    const { strong, weak } = documentOwnNumbers(hit);

    // Acts reuse numbers across years — a matching number from the wrong year
    // is a different act.
    const wantYear = (String(ref.date || '').match(/(?:19|20)\d{2}/) || [])[0];
    const gotYear = (String(meta.adoption_date || '').match(/^(\d{4})/) || [])[1];
    const yearOk = !(wantYear && gotYear && wantYear !== gotYear);

    if (strong.has(wantNum)) {
      if (!yearOk) return { ok: false, why: `yil mos emas (kutilgan ${wantYear}, topilgan ${gotYear})` };
      return { ok: true, why: 'raqam mos', confirmed: true };
    }

    // The page firmly claims to be a DIFFERENT act. A weak mention of the
    // wanted number elsewhere on it (amendment target, preamble citation)
    // must not override that.
    if (strong.size) {
      return { ok: false, why: `raqam mos emas (kutilgan ${wantNum}, hujjatda ${[...strong].slice(0, 3).join('/')})` };
    }

    if (weak.has(wantNum)) {
      if (!yearOk) return { ok: false, why: `yil mos emas (kutilgan ${wantYear}, topilgan ${gotYear})` };
      // An amendment decree that TARGETS the wanted act is related material,
      // not the act itself — keep it, but never as a confirmed identity.
      if (isAmendmentTitle(title)) {
        return { ok: true, why: `oʻzgartirish hujjati (${wantNum}-son hujjatga)`, confirmed: false };
      }
      return { ok: true, why: 'raqam sarlavhada', confirmed: true };
    }

    // Identity indeterminate: the page never states its own number. Fall back
    // to topical agreement so a correct document is not thrown away, but mark
    // it unconfirmed so the opinion can hedge.
    return topicalMatch(ref, title, 'raqam koʻrsatilmagan');
  }

  // Name-only reference: require real overlap with the title, not one lucky word.
  return topicalMatch(ref, title, 'nom');
}

/** Raw token-overlap count between a reference's name+claims and a title. */
function topicalOverlap(ref, title) {
  const want = nameTokens([ref.name, ...(ref.claims || [])].filter(Boolean).join(' '));
  if (!want.length) return 0;
  const got = new Set(nameTokens(title));
  return want.filter(w => got.has(w)).length;
}

/** Token overlap between what the report cites and the document's title. */
function topicalMatch(ref, title, kind) {
  const want = nameTokens([ref.name, ...(ref.claims || [])].filter(Boolean).join(' '));
  if (!want.length) return { ok: false, why: 'tekshirib boʻlmaydi (raqam ham, nom ham yoʻq)' };
  const got = new Set(nameTokens(title));
  const overlap = want.filter(w => got.has(w)).length;
  const need = Math.max(2, Math.ceil(Math.min(want.length, 8) * 0.4));
  if (overlap >= need) {
    return { ok: true, why: `${kind} — mavzu mos (${overlap}/${want.length})`, confirmed: false };
  }
  return { ok: false, why: `${kind}, mavzu ham mos emas (${overlap}/${want.length} soʻz)` };
}

/**
 * Gate a batch of search hits for one reference, then rank and cap them.
 *
 * Rank: number-confirmed beats topical; on-topic beats off-topic. Then keep
 * ONE act per reference — a second hit stays only if it is itself on-topic.
 * Yearly numbering collides across issuing bodies, so a query like
 * "18-сон 2022" can pass several same-numbered acts; feeding all of them
 * cites unrelated regulations under Manbalar of a legal opinion.
 *
 * Failing hits are appended to `rejected` (mutated in place).
 */
function gateAndCapHits(ref, hits, rejected) {
  const kept = [];
  for (const h of hits) {
    const verdict = matchesReference(ref, h);
    if (verdict.ok) {
      kept.push({ ...h, confirmed: !!verdict.confirmed, matchWhy: verdict.why, overlap: topicalOverlap(ref, h.title) });
    } else {
      rejected.push({ title: h.title, url: h.url, why: verdict.why });
    }
  }
  kept.sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || b.overlap - a.overlap);
  return kept.filter((h, i) => i === 0 || h.overlap > 0).slice(0, 2);
}

/**
 * Resolve ONE reference against lex.uz, trying query variants in order until a
 * document comes back that PASSES the identity gate. A hit that fails the gate
 * is discarded and recorded in `rejected` — it never reaches the model.
 *
 * @returns {{ref, hits: Array, query: string|null, tried: string[],
 *            rejected: Array<{title,url,why}>, reason?: string}}
 */
async function resolveReference(ref, opts = {}) {
  const { maxDocs = 2, maxVariants = 4 } = opts;

  if (ref.foreign) {
    return { ref, hits: [], query: null, tried: [], rejected: [], reason: `xorijiy manba (${ref.foreign})` };
  }

  const variants = queryVariants(ref).slice(0, maxVariants);
  const tried = [];
  const rejected = [];

  for (const q of variants) {
    tried.push(q);
    let hits = [];
    try {
      hits = await searchLexUz(q, { maxDocs, scoreText: scoringText(ref) });
    } catch (e) {
      continue;
    }
    const kept = gateAndCapHits(ref, hits || [], rejected);
    if (kept.length) return { ref, hits: kept, query: q, tried, rejected };
  }
  return {
    ref, hits: [], query: null, tried, rejected,
    reason: rejected.length ? 'topilgan hujjatlar havolaga mos kelmadi' : 'lex.uz da natija yoʻq',
  };
}

/**
 * Text used to pick WHICH sections of a resolved act to excerpt. The document
 * number alone selects the title page; the claims the report makes about the
 * act ("14-modda xizmatni ruxsat etadi") select the articles that matter.
 */
function scoringText(ref) {
  return [ref.name, ...(ref.claims || [])].filter(Boolean).join(' ').slice(0, 600);
}

/** Run `fn` over `items` with bounded concurrency, preserving input order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i], i); }
      catch (e) { out[i] = { ref: items[i], hits: [], query: null, tried: [], rejected: [], error: e.message }; }
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Resolve many references in parallel (bounded, so lex.uz is not hammered).
 *
 * @returns {Promise<Array<{ref, hits, query, tried, error?}>>}
 */
async function resolveReferences(refs, opts = {}) {
  const { concurrency = 4, maxDocs = 2, maxVariants = 4 } = opts;
  return mapLimit(refs, concurrency, (r) => resolveReference(r, { maxDocs, maxVariants }));
}

module.exports = {
  scanBareReferences,
  mergeReferences,
  scanWeight,
  queryVariants,
  isDescriptiveName,
  matchesReference,
  documentOwnNumbers,
  isAmendmentTitle,
  translitToCyr,
  gateAndCapHits,
  topicalOverlap,
  scoringText,
  resolveReference,
  resolveReferences,
  mapLimit,
};
