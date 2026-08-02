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

  const put = (digits, prefix, type, date, name, confidence) => {
    const key = `${prefix || '?'}-${digits}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.hits++;
      if (!existing.date && date) existing.date = date;
      if (!existing.name && name) existing.name = name;
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
    put(m[2], prefix, type, nearbyDate(src, m.index), nearbyName(src, m.index + m[0].length), 'high');
  }

  // Bare "<N>-son(li)" — type inferred from surrounding words.
  const bareDigits = new Set();
  BARE_NUMBER_RE.lastIndex = 0;
  while ((m = BARE_NUMBER_RE.exec(src)) !== null) {
    const digits = m[1];
    bareDigits.add(digits);
    const { type, prefix } = inferType(src, m.index);
    put(digits, prefix, type, nearbyDate(src, m.index), nearbyName(src, m.index + m[0].length), 'high');
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
      put(d[1], prefix, type, '', '', 'low');
    }
  }

  return [...byKey.values()];
}

/**
 * Merge LLM-extracted references with regex-scanned ones, deduping on the
 * document number. The LLM contributes `claims` (what the document asserts
 * about the act); the scanner contributes coverage and the lex.uz prefix.
 */
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
    if (!d) {
      // Named-only reference (e.g. "Fuqarolik kodeksi") — keep as-is.
      byDigits.set(`name:${(r.name || '').toLowerCase()}`, {
        type: r.type || 'boshqa', name: r.name || '', number: '', date: r.date || '',
        claims: r.claims || [], prefix: '', key: `name:${r.name}`, confidence: 'high', hits: 1,
      });
      continue;
    }
    const existing = byDigits.get(d);
    if (existing) {
      existing.claims = [...new Set([...(existing.claims || []), ...(r.claims || [])])].slice(0, 8);
      if (r.name && isGenericName(existing.name)) existing.name = r.name;
      if (!existing.date && r.date) existing.date = r.date;
      if (existing.type === 'boshqa' && r.type) existing.type = r.type;
      existing.confidence = 'high';
    } else {
      byDigits.set(d, {
        type: r.type || 'boshqa', name: r.name || '', number: d, date: r.date || '',
        claims: r.claims || [], prefix: '', key: `?-${d}`, confidence: 'high', hits: 1,
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
function queryVariants(ref) {
  const out = [];
  const num = String(ref.number || '').trim();
  const name = String(ref.name || '').trim();
  const year = (String(ref.date || '').match(/(?:19|20)\d{2}/) || [])[0] || '';
  const cyr = CYR_PREFIX[canonPrefix(ref.prefix)] || '';

  if (num) {
    if (cyr) {
      out.push(`${cyr}-${num}-сон`);
      out.push(`${cyr}-${num}`);
    }
    out.push(`${num}-сон`);
    if (year) out.push(`${num}-сон ${year}`);
    out.push(`${num}-son`);
    if (name) out.push(`${num}-son ${name}`.slice(0, 120));
  }
  if (name && name.length >= 6) out.push(name.slice(0, 120));

  // Dedupe, drop anything too short for searchLexUz.
  return [...new Set(out)].filter(q => q.length >= 3);
}

/**
 * Resolve ONE reference against lex.uz, trying query variants in order until a
 * document comes back.
 *
 * @returns {{ref, hits: Array, query: string|null, tried: string[]}}
 */
async function resolveReference(ref, opts = {}) {
  const { maxDocs = 1, maxVariants = 4 } = opts;
  const variants = queryVariants(ref).slice(0, maxVariants);
  const tried = [];

  for (const q of variants) {
    tried.push(q);
    let hits = [];
    try {
      hits = await searchLexUz(q, { maxDocs });
    } catch (e) {
      continue;
    }
    if (hits && hits.length) return { ref, hits, query: q, tried };
  }
  return { ref, hits: [], query: null, tried };
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
      catch (e) { out[i] = { ref: items[i], hits: [], query: null, tried: [], error: e.message }; }
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
  const { concurrency = 4, maxDocs = 1, maxVariants = 4 } = opts;
  return mapLimit(refs, concurrency, (r) => resolveReference(r, { maxDocs, maxVariants }));
}

module.exports = {
  scanBareReferences,
  mergeReferences,
  scanWeight,
  queryVariants,
  resolveReference,
  resolveReferences,
  mapLimit,
};
