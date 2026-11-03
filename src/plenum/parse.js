'use strict';

/**
 * A Supreme Court Plenum decision read from its lex.uz page (S1 of
 * docs/design/sud-amaliyoti.md). No AI: the header line, the bands, the
 * abbreviations the decision defines and the articles each band names.
 * Nothing is guessed - a part that cannot be read is left out and the
 * caller names it.
 */

const LANGS = ['uz', 'lat', 'ru'];

/**
 * "Ўзбекистон Республикаси Олий суди пленумининг қарори, 03.07.2026 йилдаги 19-сон"
 * / "Oliy sudi plenumining qarori, 03.07.2026 yildagi 19-son"
 * / "Постановление Пленума Верховного суда Республики Узбекистан от 03.07.2026 г. № 19"
 * -> { court: 'oliy' | 'xojalik' | 'qoshma', date: '2026-07-03', number: '19' }
 */
function parseHeader(text) {
  const t = String(text || '').replace(/\s+/gu, ' ');
  const toIso = d => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(d); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
  let m = /((?:Олий(?: хўжалик)? суди|Oliy(?: xo[ʻ‘'’`]?jalik)? sudi)[^,]{0,140}?(?:пленум|plenum)[^,]{0,60}?(?:қарори|qarori)),\s*(\d{2}\.\d{2}\.\d{4})\s*(?:йилдаги|yildagi)\s*([0-9A-Za-zА-Яа-я/-]+?)-(?:сон|son)(?!\p{L})/iu.exec(t);
  if (m) return { court: courtOf(m[1]), date: toIso(m[2]), number: m[3] };
  m = /(Постановление\s+(?:совместного\s+)?Пленум[а-я]*[^.]{0,160}?)\s+от\s+(\d{2}\.\d{2}\.\d{4})\s*г?\.?\s*№\s*([0-9A-Za-zА-Яа-я/-]+)/iu.exec(t);
  if (m) return { court: courtOf(m[1]), date: toIso(m[2]), number: m[3] };
  return null;
}

/** Which court's Plenum: the Supreme Court, the Higher Economic Court, or both together. */
function courtOf(s) {
  const t = String(s || '').toLowerCase();
  const eco = /хўжалик|xo[ʻ‘'’`]?jalik|хозяйствен/u.test(t);
  const sup = /олий суди(?! хўжалик)|oliy sudi|верховн/u.test(t);
  if (/қўшма|qo[ʻ‘'’`]?shma|совместн/u.test(t) || (eco && sup)) return 'qoshma';
  return eco ? 'xojalik' : 'oliy';
}

/** A decision that only amends other decisions ("…ayrim qarorlariga o'zgartirish…"). */
function isAmendment(title) {
  return /(қарорлари?га|qarorlari?ga|постановлени[ея]|постановлений)[^.]{0,40}(ўзгартиш|ўзгартириш|o[ʻ‘'’`]?zgartish|o[ʻ‘'’`]?zgartirish|изменени)/iu.test(String(title || ''))
    || /^(о внесении изменени|ayrim qarorlariga|айрим қарорларига)/iu.test(String(title || '').trim());
}

/**
 * The body as bands: n 0 is the text before band 1 (the preamble), then
 * "1.", "2." … A line that starts with a number lower than the band before
 * (a list inside a band) stays in that band.
 */
function splitBands(body) {
  const lines = String(body || '').replace(/\r\n?/gu, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  const bands = [{ n: 0, text: '' }];
  let last = 0;
  for (const line of lines) {
    const m = /^(\d{1,3})\.\s+(.*)$/u.exec(line);
    const n = m ? Number(m[1]) : null;
    if (n && n === last + 1) { bands.push({ n, text: line }); last = n; continue; }
    const cur = bands[bands.length - 1];
    cur.text = cur.text ? `${cur.text}\n${line}` : line;
  }
  return bands.filter(b => b.text.trim());
}

/**
 * The abbreviations a decision defines: "(бундан буён матнда ФПК деб юритилади)",
 * "(bundan buyon matnda FPK deb yuritiladi)", "(далее — ГПК)" -> { ФПК: 'Фуқаролик процессуал кодекси' }.
 * The act's name is the words just before the bracket, back to the previous comma / "ва" / colon.
 */
function abbreviations(body) {
  const out = {};
  const t = String(body || '').replace(/\s+/gu, ' ');
  const re = /([^,;:()«»]{3,160}?)\s*\((?:бундан буён(?: матнда)?|bundan buyon(?: matnda)?|далее(?: по тексту)?\s*[-–—]?)\s*([A-ZА-ЯЎҚҒҲЁ][A-Za-zА-Яа-яЎўҚқҒғҲҳЁё]{1,12})(?:\s*(?:деб юритилади|deb yuritiladi))?\)/gu;
  let m;
  while ((m = re.exec(t))) {
    const name = m[1].replace(/^(?:ва|va|и|ҳамда|hamda)\s+/iu, '').replace(/^.*\b(?:ва|va|и|ҳамда|hamda)\s+/iu, '').trim();
    if (name && !out[m[2]]) out[m[2]] = name;
  }
  return out;
}

/**
 * The articles a band names: [{ n: '101', act: 'ФПК' | '<words before>' | null }].
 * uz: "ФПКнинг 101-моддаси", "Фуқаролик кодексининг 333-моддаси", "101 va 102-moddalari";
 * ru: "статьи 101 ГПК", "статьей 22 Закона «О судах»".
 * The act is an abbreviation the decision defined, else the code / law words
 * right before the number, else null (unknown is never guessed).
 */
function articleRefs(text, abbr = {}) {
  // "509⁹-modda (509-modda prim 9)": the bracket restates the article above - not a second one
  const t = String(text || '').replace(/\s+/gu, ' ').replace(/\s*\(\d{1,4}-(?:модда|modda)\s+(?:прим|prim)\s+\d{1,3}\)/giu, '');
  const out = [], seen = new Set();
  const abbrs = Object.keys(abbr);
  const actBefore = (s) => {
    // "kodeksining (bundan buyon FK) 30-modda": the definition between them is not the act's end
    const tail = s.slice(-160).replace(/\s*\((?:бундан буён|bundan buyon|далее)[^)]{0,40}\)\s*$/u, '').replace(/[\s(]+$/u, '');
    // the Constitution, named a little before ("Konstitutsiyasiga ko'ra (19-moddasining …")
    if (/(?:Конституци|Konstitutsiya)\p{L}*[^.;]{0,30}$/u.test(tail)) return /Konstitutsiya/u.test(tail) ? 'Konstitutsiya' : 'Конституция';
    // an abbreviation the decision did not define (JK, ФК, МЖтК): capitals right before, with "-ning" / "нинг"
    const caps = /(^|[^\p{L}])(\p{Lu}{1,6}(?:\p{Ll}{1,2}\p{Lu}{1,3})?)(?:нинг|ning|ning|да|da)?\s*$/u.exec(tail);
    if (caps && caps[2].length >= 2 && !/^(?:I|II|III|IV|V|VI)$/u.test(caps[2])) return caps[2];
    // a named law: «Судлар тўғрисида»ги (Ўзбекистон Республикаси) Қонунининг -> «Судлар тўғрисида» қонуни
    const named = /[«“"]([^»”"]{3,90})[»”"](?:ги|gi)?\s+(?:Ўзбекистон Республикаси(?:нинг)?\s+|O[ʻ‘'’`]?zbekiston Respublikasi(?:ning)?\s+)?(Қонун|Qonun|қонун|qonun)\p{L}*\s*$/u.exec(tail);
    if (named) return `«${named[1]}» ${/^[Qq]/u.test(named[2]) ? 'qonuni' : 'қонуни'}`;
    for (const a of abbrs) if (new RegExp(`(^|[^\\p{L}])${a}(?:нинг|ning|да|da)?\\s*$`, 'u').test(tail)) return a;
    const m = /([\p{L}«»"“”‘’ʻ'-]+\s+(?:процессуал\s+|protsessual\s+|процессуальн\p{L}*\s+)?(?:кодекс\p{L}*|kodeks\p{L}*|Қонун\p{L}*|qonun\p{L}*|Qonun\p{L}*|закон\p{L}*|Закон\p{L}*))\s*$/u.exec(tail);
    return m ? m[1].replace(/(?:нинг|ning|ининг|ining)$/u, '').trim() : null;
  };
  // "JKning 57²-modda va 45-moddasini": only "va" / a comma between two articles -> the same act
  let lastEnd = -1, lastAct = null;
  const actAt = (index, end) => {
    let act = actBefore(t.slice(0, index));
    if (!act && lastAct && lastEnd >= 0 && /^\p{L}{0,8}\s*(?:,|ва|va|ҳамда|hamda|и)?\s*(?:\p{L}{0,12}\s+)?$/u.test(t.slice(lastEnd, index)) && t.slice(lastEnd, index).length <= 30) act = lastAct;
    if (act) lastAct = act;
    lastEnd = end;
    return act;
  };
  const push = (n, act) => { const k = `${act || ''}|${n}`; if (!seen.has(k)) { seen.add(k); out.push({ n, act }); } };
  // uz: one or more numbers before "-модда" / "-modda"
  // a range first: "44 — 50-moddalarida", "30-31-moddalari", "310 — 316-моддалари"
  const range = /(\d{1,4})\s*[—–-]\s*(\d{1,4})-(?:модда|modda)/giu;
  let m;
  const ranged = new Set();
  while ((m = range.exec(t))) {
    if (Number(m[2]) <= Number(m[1])) continue;
    push(`${m[1]}–${m[2]}`, actAt(m.index, m.index + m[0].length));
    ranged.add(m.index + m[0].length);
  }
  const uz = /((?:\d{1,4}(?:[¹²³⁴⁵⁶⁷⁸⁹⁰]+)?(?:,\s*|\s+(?:ва|va|ҳамда|hamda)\s+))*\d{1,4}(?:[¹²³⁴⁵⁶⁷⁸⁹⁰]+)?)-(?:модда|modda)/giu;
  while ((m = uz.exec(t))) {
    if (ranged.has(m.index + m[0].length)) continue;
    const act = actAt(m.index, m.index + m[0].length);
    m[1].split(/,\s*|\s+(?:ва|va|ҳамда|hamda)\s+/u).forEach(n => n && push(n.trim(), act));
  }
  // ru: "статья / статьи / статьей … N [ABBR]"
  const ru = /стать(?:я|и|ей|ю|е|ями|ях)\s+((?:\d{1,4}(?:[¹²³⁴⁵⁶⁷⁸⁹⁰]+)?(?:,\s*|\s+и\s+))*\d{1,4}(?:[¹²³⁴⁵⁶⁷⁸⁹⁰]+)?)(?:\s+((?:Закона|Кодекса)\s+(?:Республики Узбекистан\s+)?[«“"][^»”"]{3,90}[»”"])|\s+((?:[А-ЯЁ]?[а-яё]+(?:ого|его)\s+){1,2}кодекса)|\s+([A-ZА-ЯЁ][A-Za-zА-Яа-яЁё]{1,7}(?![а-яё])))?/gu;
  while ((m = ru.exec(t))) {
    let act = m[2] ? m[2].replace(/\s+Республики Узбекистан/u, '') : m[3] ? m[3] : (m[4] && m[4] !== 'Закона' && m[4] !== 'Кодекса' ? m[4] : null);
    if (!act && /Конституци\p{L}*[^.;]{0,40}$/u.test(t.slice(Math.max(0, m.index - 60), m.index))) act = 'Конституция';
    m[1].split(/,\s*|\s+и\s+/u).forEach(n => n && push(n.trim(), act));
  }
  return out;
}

/** The decision page's editions: { uz: id, lat: '-id', ru: id } from the language links. */
function editions(html, ownId) {
  const out = {};
  const re = /openUrl\('\/uz\/docs\/(-?\d+)'\)"\s+title="([^"]+)"/gu;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const title = m[2];
    if (/русском/u.test(title)) out.ru = Number(m[1]);
    else if (/O'zbekcha|Oʻzbekcha|O‘zbekcha/u.test(title)) out.lat = Number(m[1]);
    else if (/Ўзбекча/u.test(title)) out.uz = Number(m[1]);
  }
  // the page's own edition is the active one (no link)
  if (ownId != null) {
    const id = Number(ownId);
    if (id < 0 && !out.lat) out.lat = id;
    if (id > 0 && !out.uz && out.ru !== id) out.uz = id;
  }
  return out;
}

module.exports = { LANGS, parseHeader, courtOf, isAmendment, splitBands, abbreviations, articleRefs, editions };
