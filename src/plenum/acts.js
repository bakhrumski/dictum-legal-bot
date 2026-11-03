'use strict';

/**
 * One key for a code however it is written (S2, docs/design/sud-amaliyoti.md):
 * the corpus names it in full ("O'zbekiston Respublikasining Fuqarolik
 * kodeksi (1-qism)"), a Plenum band by an abbreviation (FK, ФК, ГК) or by
 * its words ("Fuqarolik kodeksining", "Гражданского кодекса"). No AI; an act
 * that matches nothing is null - never guessed. An abbreviation is read by
 * the band's language: in Uzbek Cyrillic ЖК is the Criminal Code, in Russian
 * the Housing Code.
 */

// [key, phrase pattern (any script, any case ending)] - more specific first
const PHRASES = [
  ['konst', /konstitutsiya|конституци/iu],
  ['fpk', /fuqarolik\s+protsessual|фуқаролик\s+процессуал|гражданск\p{L}*\s+процессуальн/iu],
  ['ipk', /iqtisodiy\s+protsessual|иқтисодий\s+процессуал|экономическ\p{L}*\s+процессуальн|xo[ʻ‘'’`]?jalik\s+protsessual|хўжалик\s+процессуал|хозяйственн\p{L}*\s+процессуальн/iu],
  ['jik', /jinoyat[-\s]+ijroiya|жиноят[-\s]+ижроия|уголовно[-\s]+исполнительн/iu],
  ['jpk', /jinoyat[-\s]+protsessual|жиноят[-\s]+процессуал|уголовно[-\s]+процессуальн/iu],
  ['msiyutk', /ma[ʼʻ‘'’`]?muriy\s+sud\s+ishlarini|маъмурий\s+суд\s+ишларини|административн\p{L}*\s+судопроизводств/iu],
  ['mjtk', /ma[ʼʻ‘'’`]?muriy\s+javobgarlik|маъмурий\s+жавобгарлик|административн\p{L}*\s+ответственност/iu],
  ['fk', /fuqarolik\s+kodeks|фуқаролик\s+кодекс|гражданск\p{L}*\s+кодекс/iu],
  ['jk', /jinoyat\s+kodeks|жиноят\s+кодекс|уголовн\p{L}*\s+кодекс/iu],
  ['mk', /mehnat\s+kodeks|меҳнат\s+кодекс|трудов\p{L}*\s+кодекс/iu],
  ['ok', /oila\s+kodeks|оила\s+кодекс|семейн\p{L}*\s+кодекс/iu],
  ['sk', /soliq\s+kodeks|солиқ\s+кодекс|налогов\p{L}*\s+кодекс/iu],
  ['ujk', /uy-joy\s+kodeks|уй-жой\s+кодекс|жилищн\p{L}*\s+кодекс/iu],
  ['yk', /yer\s+kodeks|ер\s+кодекс|земельн\p{L}*\s+кодекс/iu],
  ['bk', /bojxona\s+kodeks|божхона\s+кодекс|таможенн\p{L}*\s+кодекс/iu],
];

// abbreviations by script: Latin Uzbek, Cyrillic Uzbek, Russian
const ABBR = {
  lat: { FK: 'fk', FPK: 'fpk', IPK: 'ipk', XPK: 'ipk', JK: 'jk', JPK: 'jpk', JIK: 'jik', MJtK: 'mjtk', MJTK: 'mjtk', MSIYUtK: 'msiyutk', MSIYUTK: 'msiyutk', MK: 'mk', OK: 'ok', SK: 'sk', UJK: 'ujk', YeK: 'yk', YerK: 'yk', BK: 'bk' },
  uz: { ФК: 'fk', ФПК: 'fpk', ИПК: 'ipk', ХПК: 'ipk', ЖК: 'jk', ЖПК: 'jpk', ЖИК: 'jik', МЖтК: 'mjtk', МЖТК: 'mjtk', МСИЮтК: 'msiyutk', МСИЮТК: 'msiyutk', МК: 'mk', ОК: 'ok', СК: 'sk', УЖК: 'ujk', ЕК: 'yk', БК: 'bk' },
  ru: { ГК: 'fk', ГПК: 'fpk', ЭПК: 'ipk', ХПК: 'ipk', УК: 'jk', УПК: 'jpk', УИК: 'jik', КоАО: 'mjtk', КОАО: 'mjtk', КоАС: 'msiyutk', ТК: 'mk', СК: 'ok', НК: 'sk', ЖК: 'ujk', ЗК: 'yk', ТамК: 'bk' },
};

/** The key of an act's name or abbreviation, or null. `lang` is the text's edition: lat | uz | ru. */
function actKey(name, lang = 'lat') {
  const s = String(name || '').trim();
  if (!s) return null;
  const table = ABBR[lang] || ABBR.lat;
  if (table[s]) return table[s];
  for (const l of ['lat', 'uz', 'ru']) if (l !== lang && ABBR[l][s] && /[A-Za-z]/.test(s) === (l === 'lat')) return ABBR[l][s];
  for (const [key, rx] of PHRASES) if (rx.test(s)) return key;
  return null;
}

/** The article's number for comparing: "333", "57²", "44–50" -> ['44', …, '50'] (a range opens up to 30 articles). */
function articleSet(n) {
  const s = String(n || '').trim();
  const m = /^(\d{1,4})[–—-](\d{1,4})$/u.exec(s);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (b > a && b - a <= 30) return Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
    return [String(a), String(b)];
  }
  return [s.replace(/\s+/gu, '')];
}

module.exports = { actKey, articleSet, PHRASES, ABBR };
