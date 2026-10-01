'use strict';

/**
 * Russian citation forms (2026-10-01, owner: an answer is cited in the
 * question's language - "ЗРУ-310, статья 20, часть первая", not "(O'RQ-310),
 * 20-модда, биринчи қисм").
 *
 * The corpus stores Uzbek titles only, so the Russian official titles of the
 * main codes and laws are listed here; an act without one keeps its Uzbek
 * title in a Russian answer, with its identifier and locator in Russian.
 */

// Normalised Uzbek title (as citation-utils.normalizeLawName gives it,
// without "O'zbekiston Respublikasining") -> Russian official title.
const RU_TITLES = {
  'mehnat kodeksi': 'Трудовой кодекс Республики Узбекистан',
  'fuqarolik kodeksi': 'Гражданский кодекс Республики Узбекистан',
  'fuqarolik kodeksi 1 qism': 'Гражданский кодекс Республики Узбекистан (часть первая)',
  'fuqarolik kodeksi 2 qism': 'Гражданский кодекс Республики Узбекистан (часть вторая)',
  'oila kodeksi': 'Семейный кодекс Республики Узбекистан',
  'jinoyat kodeksi': 'Уголовный кодекс Республики Узбекистан',
  'jinoyat protsessual kodeksi': 'Уголовно-процессуальный кодекс Республики Узбекистан',
  'jinoyat ijroiya kodeksi': 'Уголовно-исполнительный кодекс Республики Узбекистан',
  'fuqarolik protsessual kodeksi': 'Гражданский процессуальный кодекс Республики Узбекистан',
  'iqtisodiy protsessual kodeksi': 'Экономический процессуальный кодекс Республики Узбекистан',
  'soliq kodeksi': 'Налоговый кодекс Республики Узбекистан',
  'mamuriy javobgarlik togrisidagi kodeks': 'Кодекс Республики Узбекистан об административной ответственности',
  'mamuriy sud ishlarini yuritish togrisidagi kodeks': 'Кодекс Республики Узбекистан об административном судопроизводстве',
  'saylov kodeksi': 'Избирательный кодекс Республики Узбекистан',
  'uy joy kodeksi': 'Жилищный кодекс Республики Узбекистан',
  'yer kodeksi': 'Земельный кодекс Республики Узбекистан',
  'bojxona kodeksi': 'Таможенный кодекс Республики Узбекистан',
  'byudjet kodeksi': 'Бюджетный кодекс Республики Узбекистан',
  'konstitutsiyasi': 'Конституция Республики Узбекистан',
  'ozbekiston respublikasi konstitutsiyasi': 'Конституция Республики Узбекистан',
  'masuliyati cheklangan jamiyatlar togrisida': 'Закон Республики Узбекистан «Об обществах с ограниченной ответственностью»',
};

// The Russian text of an act can have its own lex.uz id: the Labour Code is
// /docs/-6257288 in Uzbek but /ru/docs/6257291 in Russian (owner,
// 2026-10-01). Only listed ids get a Russian link; any other act keeps its
// Uzbek page, which is at least the right document.
// Keyed by the Uzbek (Latin) id; values as the owner gave them.
const RU_URLS = {
  '6257288': 'https://lex.uz/ru/docs/6257291', // Mehnat kodeksi / Трудовой кодекс
  '104720': 'https://lex.uz/docs/104723',      // Oila kodeksi / Семейный кодекс
  '111453': 'https://lex.uz/docs/111457',      // Jinoyat kodeksi / Уголовный кодекс
  '4674902': 'https://lex.uz/docs/4674893',    // Soliq kodeksi / Налоговый кодекс
};

/** The Russian text's URL for a lex.uz document id, or ''. */
function ruUrlFor(docId = '') {
  return RU_URLS[String(docId || '').replace(/^-/, '')] || '';
}

const RU_PREFIX = { "O'RQ": 'ЗРУ', PQ: 'ПП', PF: 'УП', VMQ: 'ПКМ' };

/** O'RQ-310 -> ЗРУ-310 (other forms unchanged). */
function ruIdentifier(id = '') {
  const [prefix, ...rest] = String(id || '').split('-');
  return RU_PREFIX[prefix] && rest.length ? [RU_PREFIX[prefix], ...rest].join('-') : String(id || '');
}

function ruTitle(normalizedUzTitle = '') {
  const key = String(normalizedUzTitle || '').replace(/^ozbekiston\s+respublikas(?:i|ining)\s+/u, '').trim();
  return RU_TITLES[key] || RU_TITLES[normalizedUzTitle] || '';
}

const ORDINALS = ['', 'первая', 'вторая', 'третья', 'четвертая', 'пятая', 'шестая', 'седьмая', 'восьмая', 'девятая', 'десятая',
  'одиннадцатая', 'двенадцатая', 'тринадцатая', 'четырнадцатая', 'пятнадцатая'];

/** 1 -> "первая"; beyond the list the number is kept. */
function ruPartOrdinal(n) {
  const i = parseInt(n, 10);
  return ORDINALS[i] || String(n || '');
}

// "первая", "первой", "первую" -> 1 (the stems of the ordinals above).
const ORDINAL_STEMS = ['перв', 'втор', 'трет', 'четв[её]рт', 'пят', 'шест', 'седьм', 'восьм', 'девят', 'десят',
  'одиннадцат', 'двенадцат', 'тринадцат', 'четырнадцат', 'пятнадцат'];
const ORDINAL_WORD = `(?:${ORDINAL_STEMS.join('|')})\\p{L}{0,3}`;

function ruPartNumber(word = '') {
  const w = String(word || '').trim().toLowerCase();
  if (/^\d+$/u.test(w)) return w;
  const i = ORDINAL_STEMS.findIndex(stem => new RegExp(`^${stem}\\p{L}{0,3}$`, 'u').test(w));
  return i >= 0 ? String(i + 1) : '';
}

/**
 * A regex source for a Russian title in any case form: each word longer than
 * four letters keeps its stem and may change its ending ("Трудовой кодекс"
 * also matches "Трудового кодекса", "Трудовому кодексу").
 */
function ruTitlePattern(title = '') {
  const words = String(title || '').replace(/[«»"“”]/gu, ' ').split(/\s+/u).filter(Boolean);
  if (!words.length) return '';
  return words.map((word) => {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (word.length <= 4) return esc(word);
    return `${esc(word.slice(0, word.length - 2))}\\p{L}{0,4}`;
  }).join(`[\\s«»"“”]+`);
}

/** The title, without "Республики Узбекистан", and its quoted name, as regex sources. */
function ruTitlePatterns(title = '') {
  const t = String(title || '');
  if (!t) return [];
  const forms = [t, t.replace(/\s+Республики\s+Узбекистан/u, '')];
  const quoted = t.match(/«([^»]+)»/u);
  if (quoted) forms.push(quoted[1]);
  return [...new Set(forms.map(f => f.trim()).filter(f => f.length >= 6))]
    .sort((a, b) => b.length - a.length)
    .map(ruTitlePattern);
}

const ARTICLE_WORD = '(?:стать[яиеёюй]\\p{L}{0,2}|ст\\.)';
const POINT_WORD = '(?:пункт\\p{L}{0,2}|п\\.)';
const PART_WORD = '(?:част[ьиеюй]\\p{L}{0,2}|ч\\.)';

module.exports = { RU_TITLES, RU_URLS, ruUrlFor, ruIdentifier, ruTitle, ruPartOrdinal, ruPartNumber, ruTitlePattern, ruTitlePatterns, ORDINAL_WORD, ARTICLE_WORD, POINT_WORD, PART_WORD };
