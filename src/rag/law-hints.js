'use strict';

/**
 * Law detection — maps a query (or any text) to a law_name ILIKE substring.
 *
 * Shared by retrieval (article-aware search in server.js) and the corpus
 * diagnostic so both resolve "which law" identically. Ordered
 * most-specific-first so "jinoyat-protsessual" wins over "jinoyat".
 * Matches Latin keywords against the (Latin) law_name column.
 */
// A term standing on its own: JS \b only knows ASCII letters, so Cyrillic
// abbreviations need explicit letter boundaries.
const W = (body, flags = 'iu') => new RegExp(`(?<![\\p{L}])(?:${body})(?![\\p{L}])`, flags);

// Uzbek Latin, Uzbek Cyrillic and Russian names and abbreviations. Russian
// ones were missing entirely (ГК, УК, ТК, НК, КоАП, ГПК...), as were SK/MK
// (Astra audit and docs/audit/findings/rag.md). Procedural codes come first
// so "ГПК" is not read as "ГК".
const LAW_HINTS = [
  [/jinoyat[-\s]?protsessual|\bjpk\b/i, 'jinoyat-protsessual'],
  [W('жиноят[-\\s]?процессуал\\p{L}*|жпк|упк|уголовно[-\\s]?процессуальн\\p{L}*'), 'jinoyat-protsessual'],
  [/fuqarolik[-\s]?protsessual|\bfpk\b/i, 'fuqarolik protsessual'],
  [W('фуқаролик[-\\s]?процессуал\\p{L}*|фпк|гпк|гражданск\\p{L}*[-\\s]процессуальн\\p{L}*'), 'fuqarolik protsessual'],
  [/iqtisodiy[-\s]?protsessual|\bipk\b/i, 'iqtisodiy protsessual'],
  [W('иқтисодий[-\\s]?процессуал\\p{L}*|ипк|эпк|хпк|экономическ\\p{L}*[-\\s]процессуальн\\p{L}*|хозяйственн\\p{L}*[-\\s]процессуальн\\p{L}*'), 'iqtisodiy protsessual'],
  [/ma'?muriy javobgarlik|\bmjtk\b|\bmajak\b/i, "ma'muriy javobgarlik"],
  [W("маъмурий жавобгарлик|мжтк|коап|кодекс\\p{L}*\\s+об\\s+административн\\p{L}*\\s+ответственност\\p{L}*"), "ma'muriy javobgarlik"],
  [/ma'?muriy sud|\bmsik\b|\bmsk\b/i, "ma'muriy sud"],
  [/soliq kodeks|\bsoliq\b/i, 'soliq kodeks'],
  [W('солиқ|налогов\\p{L}*\\s+кодекс\\p{L}*|нк'), 'soliq kodeks'],
  [W('SK', 'u'), 'soliq kodeks'],
  [/mehnat kodeks|\bmehnat\b/i, 'mehnat kodeks'],
  [W('меҳнат|мехнат|трудов\\p{L}*\\s+кодекс\\p{L}*|тк'), 'mehnat kodeks'],
  [W('MK', 'u'), 'mehnat kodeks'],
  [/jinoyat kodeks|\bjinoyat\b|\bjk\b/i, 'jinoyat kodeks'],
  [W('жиноят|уголовн\\p{L}*\\s+кодекс\\p{L}*|ук'), 'jinoyat kodeks'],
  [/oila kodeks|\boila\b/i, 'oila kodeks'],
  [W('оила|семейн\\p{L}*\\s+кодекс\\p{L}*|ск'), 'oila kodeks'],
  [/fuqarolik kodeks|\bfuqarolik\b|\bfk\b/i, 'fuqarolik kodeks'],
  [W('фуқаролик|гражданск\\p{L}*\\s+кодекс\\p{L}*|гк'), 'fuqarolik kodeks'],
  [/uy-?joy kodeks|uy-?joy/i, 'uy-joy kodeks'],
  [W('уй-?жой|жилищн\\p{L}*\\s+кодекс\\p{L}*|жк'), 'uy-joy kodeks'],
  [/yer kodeks/i, 'yer kodeks'],
  [W('ер кодекс\\p{L}*|земельн\\p{L}*\\s+кодекс\\p{L}*|зк'), 'yer kodeks'],
  [/bojxona kodeks|bojxona/i, 'bojxona kodeks'],
  [W('божхона|таможенн\\p{L}*\\s+кодекс\\p{L}*|тамк'), 'bojxona kodeks'],
  [/budjet kodeks|budjet/i, 'budjet kodeks'],
  [W('бюджет\\p{L}*\\s+кодекс\\p{L}*'), 'budjet kodeks'],
  [/konstitutsiya/i, 'konstitutsiya'],
  [W('конституци\\p{L}*'), 'konstitutsiya'],
];

// o‘ / oʻ / o’ / o` all spell the same Uzbek letter.
const normalizeApostrophes = (t) => String(t).replace(/[\u2018\u2019\u02BB\u02BC`\u00B4]/g, "'");

function detectLawHint(text) {
  if (!text) return null;
  const t = normalizeApostrophes(text);
  for (const [re, hint] of LAW_HINTS) {
    if (re.test(t)) return hint;
  }
  return null;
}

module.exports = { LAW_HINTS, detectLawHint };
