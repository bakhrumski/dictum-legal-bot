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

  // ── Strip Gemini agent-mode leakage ──
  // Some Gemini code-paths (tool-use / search-grounding) leak their internal
  // scaffolding into the response: "tool_code\nprint(...)\nthought\n<english
  // meta-reasoning>\n<actual answer>". None of this is meant for end users.

  // 1. Fenced tool_code blocks: ```tool_code … ```
  cleaned = cleaned.replace(/```\s*tool_code[\s\S]*?```/gi, '');

  // 2. Bare leading "tool_code\n<code>" up to the next "thought" / blank line
  cleaned = cleaned.replace(
    /^[\s]*tool_code\s*\n[\s\S]*?(?=\n\s*thought\s*\n|\n\s*\n|$)/i,
    ''
  );

  // 3. Bare leading "thought\n<english reasoning>" — the actual Uzbek answer
  //    starts after this block. Strip until a paragraph that begins with a
  //    typical answer opener (Uzbek noun, markdown header, or bold).
  cleaned = cleaned.replace(
    /^[\s]*thought\s*\n[\s\S]*?(?=\n\s*(?:O['ʻ`]?zbekiston|Advokat|Mehnat|Fuqarolik|Soliq|Jinoyat|Oila|Shartnoma|Korporativ|##\s|\*\*[A-ZÒOʻ]))/i,
    ''
  );

  // 4. Gemini grounding citations that bleed through: "[cite: 1, 2, WEB-1]"
  cleaned = cleaned.replace(/\[cite:\s*[^\]]+\]/gi, '');

  // 5. Stray "& Tasdiqlangan javob — <name>" inline tags from context bundling
  cleaned = cleaned.replace(/&\s*Tasdiqlangan\s+javob\s*—[^\n]*/gi, '');

  // Strip lines that are pure internal instruction headers
  cleaned = cleaned.replace(/^[\s*_>]*DEFINITSIYA\s+SAVOLI[^\n]*\n?/gim, '');
  cleaned = cleaned.replace(/^[\s*_>]*ICHKI\s+QOIDALAR[^\n]*\n?/gim, '');
  cleaned = cleaned.replace(/^[\s*_>]*JAVOB\s+(TUZILMASI|FORMATI|SIFATI)[^\n]*\n?/gim, '');
  cleaned = cleaned.replace(/^[\s*_>]*JIDDIY\s+TAQIQLAR[^\n]*\n?/gim, '');
  // Strip bracketed internal hints like "[Definitsiya rejimi: ...]" if echoed
  cleaned = cleaned.replace(/\[Definitsiya\s+rejimi:[^\]]*\]/gi, '');

  // Strip AI-enrich generated section headers (## Huquqiy asos, etc.)
  // and the Eslatma disclaimer blockquote line at the bottom.
  // Also matches plain-text headers (just the words on their own line),
  // since some saved answers leaked the headers without ## or ** wrapping.
  const forbiddenHeaders = [
    'Yuridik\\s+maslahat', 'Xulosa', 'Eslatma',
    'Huquqiy\\s+asos', 'Batafsil\\s+tushuntirish',
    'Amaliy\\s+ahamiyat(?:i)?', 'Muhim\\s+eslatmalar?',
  ];
  for (const h of forbiddenHeaders) {
    cleaned = cleaned.replace(new RegExp(`^\\s*#{1,6}\\s*${h}\\s*:?\\s*$`, 'gim'), '');
    cleaned = cleaned.replace(new RegExp(`^\\s*\\*\\*${h}\\*\\*\\s*:?\\s*$`, 'gim'), '');
    cleaned = cleaned.replace(new RegExp(`^\\s*${h}\\s*:?\\s*$`, 'gim'), '');
  }
  // Strip blockquote disclaimer lines  ("> Eslatma: Bu javob AI tahlili...")
  cleaned = cleaned.replace(/^>[ \t]*Eslatma:[^\n]*/gim, '');
  cleaned = cleaned.replace(/^>[ \t]*Bu javob AI[^\n]*/gim, '');

  // Strip the AI preamble that leaked from the enrich prompt:
  // "Siz O'zbekiston ... AI sifatida, ... taqdim etaman:" or similar.
  cleaned = cleaned.replace(/^Siz\s+O'?zbekiston[^.\n]{0,200}AI\s+sifatida[^\n]*\n?/gim, '');
  cleaned = cleaned.replace(/^[ \t]*---+[ \t]*$/gm, '');

  // Convert bullet-character lists to markdown "- " so the renderer turns them
  // into <ul><li>, which the dashboard CSS styles with an em-dash marker.
  // Matches "* text", "• text", "· text", "● text" at line start (indent preserved).
  cleaned = cleaned.replace(/^([ \t]*)[*•·●]\s+/gm, '$1- ');

  // Remove inline bullet glyphs that appear mid-sentence (artifacts from
  // pasted Word/HTML answers) — keep the surrounding text, drop the bullet.
  cleaned = cleaned.replace(/[•·●]\s+/g, '');

  // NOTE: We intentionally do NOT strip all standalone bold lines here.
  // The forbiddenHeaders loop above already removes known AI-leaked headers.
  // Stripping every **bold-on-its-own-line** would delete user-authored headings.

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
