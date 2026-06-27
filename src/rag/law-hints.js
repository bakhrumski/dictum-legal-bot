'use strict';

/**
 * Law detection — maps a query (or any text) to a law_name ILIKE substring.
 *
 * Shared by retrieval (article-aware search in server.js) and the corpus
 * diagnostic so both resolve "which law" identically. Ordered
 * most-specific-first so "jinoyat-protsessual" wins over "jinoyat".
 * Matches Latin keywords against the (Latin) law_name column.
 */
const LAW_HINTS = [
  [/jinoyat[-\s]?protsessual|\bjpk\b/i, 'jinoyat-protsessual'],
  [/fuqarolik[-\s]?protsessual|\bfpk\b/i, 'fuqarolik protsessual'],
  [/iqtisodiy[-\s]?protsessual|\bipk\b/i, 'iqtisodiy protsessual'],
  [/ma'?muriy javobgarlik|\bmjtk\b|\bmajak\b/i, "ma'muriy javobgarlik"],
  [/ma'?muriy sud|\bmsik\b|\bmsk\b/i, "ma'muriy sud"],
  [/soliq kodeks|\bsoliq\b/i, 'soliq kodeks'],
  [/mehnat kodeks|\bmehnat\b/i, 'mehnat kodeks'],
  [/jinoyat kodeks|\bjinoyat\b|\bjk\b/i, 'jinoyat kodeks'],
  [/oila kodeks|\boila\b/i, 'oila kodeks'],
  [/fuqarolik kodeks|\bfuqarolik\b|\bfk\b/i, 'fuqarolik kodeks'],
  [/uy-?joy kodeks|uy-?joy/i, 'uy-joy kodeks'],
  [/yer kodeks/i, 'yer kodeks'],
  [/bojxona kodeks|bojxona/i, 'bojxona kodeks'],
  [/budjet kodeks|budjet/i, 'budjet kodeks'],
  [/konstitutsiya/i, 'konstitutsiya'],
];

function detectLawHint(text) {
  if (!text) return null;
  for (const [re, hint] of LAW_HINTS) {
    if (re.test(text)) return hint;
  }
  return null;
}

module.exports = { LAW_HINTS, detectLawHint };
