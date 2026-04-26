'use strict';

/**
 * Prim Notation Normalizer
 *
 * In Uzbek/Russian legal texts, inserted articles are marked with a superscript:
 *   e.g. "7¹-modda" = "article 7 prim 1"
 *
 * Problem: different sources encode the superscript differently:
 *   - Unicode superscript digits:  "7¹-modda"           (from lex.uz fetch)
 *   - ASCII adjacent digits:       "71-modda"           (OCR / copy-paste — AMBIGUOUS!)
 *   - HTML <sup>:                  "7<sup>1</sup>-modda"
 *   - Plain "prim" word:           "7-modda prim 1"     (natural spoken form)
 *   - Hyphenated:                  "7-1-modda" / "7.1-modda"
 *
 * The RAG system must:
 *   1. Understand ALL forms when a user types a question.
 *   2. Match documents regardless of the form used in the corpus.
 *   3. Render answers in the human-readable "prim" form (per product owner request)
 *      so lawyers and end-users see "7-modda prim 1", not "7¹-modda".
 *
 * This module provides:
 *   - toPrimNotation(text): superscript / HTML <sup> → " prim N "
 *   - enrichForIngest(text): appends a "prim N" alias next to every superscript
 *     so BM25 and embedding models see both forms in the corpus.
 *   - expandQueryVariants(query): generates retrieval-friendly variants of a
 *     user query that mentions "prim N" or a plain bigram like "71".
 *   - normalizeResponseForUser(text): final post-processing for the answer
 *     shown to the user — converts every superscript to "prim N".
 */

const SUPER_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const SUPER_TO_ASCII = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
};

function supToAscii(s) {
  return s.split('').map(c => SUPER_TO_ASCII[c] || c).join('');
}

/**
 * Convert every Unicode superscript run and every <sup>…</sup> HTML tag in
 * `text` to the plain-spoken "prim N" form.
 *
 *   "7¹-modda"              → "7-modda prim 1"
 *   "12²-modda, 1-qism"     → "12-modda prim 2, 1-qism"
 *   "Статья 4¹"             → "Статья 4 prim 1"
 *   "4<sup>1</sup>-modda"   → "4-modda prim 1"
 *
 * Placement rule: the " prim N" token is inserted AFTER the word "modda"
 * (or "Статья"). If the article word cannot be located within a short
 * window, fall back to placing " prim N" right after the base digit.
 */
function toPrimNotation(text) {
  if (!text) return text;

  // Step 1: normalize HTML <sup>digit</sup> → Unicode superscript,
  //         so step 2 can handle a single form.
  text = text.replace(/<sup[^>]*>(\d+)<\/sup>/gi, (_, d) => {
    return d.split('').map(c => {
      const i = parseInt(c, 10);
      return Number.isFinite(i) ? SUPER_DIGITS[i] : c;
    }).join('');
  });

  // Step 2a: Uzbek form "<N><super>[-]?<modda|moddasi|moddasida|moddaga>"
  //   → "<N>-<articleWord> prim <M>"
  //   e.g. "7¹-modda"    → "7-modda prim 1"
  //        "4¹-moddaga"  → "4-moddaga prim 1"
  const withWordUz = new RegExp(
    `(\\d+)([${SUPER_DIGITS}]+)[\\s-]*(modda(?:si(?:da)?|ga|ning)?)`,
    'giu'
  );
  text = text.replace(withWordUz, (_m, base, sup, articleWord) => {
    return `${base}-${articleWord} prim ${supToAscii(sup)}`;
  });

  // Step 2b: any remaining "<N><super>" (Russian "Статья 7¹", bare refs)
  //   → "<N> prim <M>"
  const standalone = new RegExp(`(\\d+)([${SUPER_DIGITS}]+)`, 'gu');
  text = text.replace(standalone, (_m, base, sup) => `${base} prim ${supToAscii(sup)}`);

  return text;
}

/**
 * For corpus ingestion: keep the original text (with superscripts) AND append
 * a readable alias so both forms live in the chunk body. This guarantees that
 * a BM25 search for "7 prim 1" finds the chunk, even though the source file
 * uses "7¹".
 *
 *   "7¹-modda shartnoma…"  → "7¹-modda (7-modda prim 1) shartnoma…"
 *
 * Applied once at ingest time, on the full document body before chunking.
 */
function enrichForIngest(text) {
  if (!text) return text;

  // Convert <sup> → Unicode superscript first.
  text = text.replace(/<sup[^>]*>(\d+)<\/sup>/gi, (_, d) => {
    return d.split('').map(c => {
      const i = parseInt(c, 10);
      return Number.isFinite(i) ? SUPER_DIGITS[i] : c;
    }).join('');
  });

  // For every "<digit(s)><sup>-modda" / "Статья <digit><sup>" occurrence,
  // append the spoken-form alias once (non-greedy, article-word anchored).
  const pattern = new RegExp(
    `(\\d+)([${SUPER_DIGITS}]+)([\\s-]*(?:modda|статья|статьи|статью|статьей))`,
    'giu'
  );
  return text.replace(pattern, (full, base, sup, tail) => {
    const primDigits = supToAscii(sup);
    // keep the original, then append the alias in parens
    return `${full} (${base}${tail.trim()} prim ${primDigits})`;
  });
}

/**
 * For user queries: if the query mentions "prim N" or "prim-N" (free form) or
 * a superscript, generate the alternative forms so both text and vector
 * retrieval can hit documents using EITHER convention.
 *
 *   "7-modda prim 1"    → ["7-modda prim 1", "7¹-modda", "7 prim 1 modda"]
 *   "4 prim 2 qism"     → ["4 prim 2 qism", "4²-modda qism"]
 *   "7¹-modda"          → ["7¹-modda", "7-modda prim 1"]
 *
 * Returns a single augmented string joining all variants with spaces — this
 * is what gets handed to the retriever, so BM25/embedding see the whole set.
 */
function expandQueryVariants(query) {
  if (!query) return query;
  const variants = new Set([query]);

  // Pattern A: "<N> prim <M>"     → "<N><super(M)>-modda"
  const primPattern = /(\d+)[\s-]*prim[\s-]*(\d+)/gi;
  let altA = query.replace(primPattern, (_, base, prim) => {
    const sup = prim.split('').map(d => SUPER_DIGITS[parseInt(d, 10)] || d).join('');
    return `${base}${sup}-modda`;
  });
  if (altA !== query) variants.add(altA);

  // Pattern B: "<N><super>"       → "<N>-modda prim <M>"
  const supPattern = new RegExp(`(\\d+)([${SUPER_DIGITS}]+)`, 'gu');
  let altB = query.replace(supPattern, (_, base, sup) => {
    return `${base}-modda prim ${supToAscii(sup)}`;
  });
  if (altB !== query) variants.add(altB);

  return Array.from(variants).join(' ');
}

/**
 * Final post-processing for text shown to the end-user.
 * ALWAYS converts Unicode superscripts to the readable "prim N" form.
 *
 * Safe for Markdown — we only replace digit+superscript runs; links and
 * structure are untouched.
 */
function stripLeakedInstructions(text) {
  if (!text) return text;
  let cleaned = text;

  // Strip lines that are pure internal instruction headers
  cleaned = cleaned.replace(/^[\s*_>]*DEFINITSIYA\s+SAVOLI[^\n]*\n?/gim, '');
  cleaned = cleaned.replace(/^[\s*_>]*ICHKI\s+QOIDALAR[^\n]*\n?/gim, '');
  cleaned = cleaned.replace(/^[\s*_>]*JAVOB\s+(TUZILMASI|FORMATI|SIFATI)[^\n]*\n?/gim, '');
  cleaned = cleaned.replace(/^[\s*_>]*JIDDIY\s+TAQIQLAR[^\n]*\n?/gim, '');
  // Strip bracketed internal hints like "[Definitsiya rejimi: ...]" if echoed
  cleaned = cleaned.replace(/\[Definitsiya\s+rejimi:[^\]]*\]/gi, '');

  // Strip forbidden header lines while keeping the content beneath them.
  // Matches: "## Yuridik maslahat", "**Yuridik maslahat**", "Yuridik maslahat:" etc.
  const forbiddenHeaders = ['Yuridik\\s+maslahat', 'Xulosa', 'Eslatma'];
  for (const h of forbiddenHeaders) {
    cleaned = cleaned.replace(new RegExp(`^\\s*#{1,6}\\s*${h}\\s*:?\\s*$`, 'gim'), '');
    cleaned = cleaned.replace(new RegExp(`^\\s*\\*\\*${h}\\*\\*\\s*:?\\s*$`, 'gim'), '');
    cleaned = cleaned.replace(new RegExp(`^\\s*${h}\\s*:\\s*$`, 'gim'), '');
  }

  // Convert bullet characters (*, •, ·) at the start of a list item to a hyphen.
  // Markdown bullets only — inline ** for bold are untouched.
  cleaned = cleaned.replace(/^([ \t]*)[*•·](\s+)/gm, '$1-$2');

  // Collapse triple-blank-lines created by the stripping
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

function normalizeResponseForUser(text) {
  return toPrimNotation(stripLeakedInstructions(text || ''));
}

module.exports = {
  toPrimNotation,
  enrichForIngest,
  expandQueryVariants,
  normalizeResponseForUser,
  SUPER_DIGITS,
};
