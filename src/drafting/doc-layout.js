'use strict';

/**
 * A filled document reads as one orderly document (2026-11-03, owner: a
 * sample "Olib qo'yish bayonnomasi" came back with Cyrillic template text and
 * Latin values side by side, ragged lines, no paragraph indent, and every
 * "(imzo)" / "(kun, oy)" caption a line below the place it belongs to).
 * No AI here; every step is a fixed rule:
 *
 *   - one script: an Uzbek document is written in the script the person typed
 *     the values in (Latin when equal or none). A Russian document, quoted
 *     names, brand-like words (c / w, digits, short capitals) are left alone.
 *   - values: trimmed, a date written as "30 sentyabr 2026 yil" style, a
 *     space before a comma removed, words the template already says right
 *     before or after the value dropped from the value ("IMEI raqami
 *     IMEI raqami 3567…" -> "IMEI raqami 3567…").
 *   - captions: a line that is only "(imzo)", "(kun, oy)", "(hudud)" … is
 *     put in a borderless table on the line it belongs to - under its blank
 *     (date, place, "1. ____ Name"), or between a signer's role and name
 *     ("Xolislar: (imzo) Name").
 *   - body paragraphs: justified with a 1 cm first-line indent (the Word
 *     export reads `legal: true`; print CSS in LEGAL_CSS).
 */

const cheerio = require('cheerio');

/* ───────────── script ───────────── */

const UZ_CYR_ONLY = /[ЎўҚқҒғҲҳ]/u;
const CYR = /[Ѐ-ӿ]/gu;
const LAT = /[A-Za-z]/g;

const C2L = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ш: 'sh', ч: 'ch', ў: 'o‘', қ: 'q', ғ: 'g‘',
  ҳ: 'h', ы: 'i', э: 'e', ё: 'yo', ю: 'yu', я: 'ya', щ: 'sh', ъ: '’', ь: '',
};
const VOWEL_CYR = /[аеёиоуўэюяы]/iu;

function caseLike(src, out, wordIsUpper) {
  if (!out) return out;
  if (src === src.toLowerCase()) return out;
  if (wordIsUpper) return out.toUpperCase();
  return out[0].toUpperCase() + out.slice(1);
}

/** Uzbek Cyrillic -> Latin (o‘ g‘ with the turned comma, as the official alphabet). */
function cyrToLat(text) {
  // a text with no small letters ("Б А Ё Н Н О М А С И") stays in capitals, "Ё" -> "YO"
  const allCaps = !/\p{Ll}/u.test(String(text));
  return String(text).replace(/[\u0400-\u04FF]+/gu, (w) => {
    const upper = (w.length > 1 || allCaps) && w === w.toUpperCase();
    let out = '';
    for (let i = 0; i < w.length; i++) {
      const ch = w[i], lo = ch.toLowerCase(), prev = i ? w[i - 1] : '';
      let t;
      if (lo === 'е') t = (!prev || VOWEL_CYR.test(prev) || /[ъь]/iu.test(prev)) ? 'ye' : 'e';
      else if (lo === 'ц') t = (prev && VOWEL_CYR.test(prev)) ? 'ts' : 's';
      else t = C2L[lo] != null ? C2L[lo] : ch;
      out += caseLike(ch, t, upper);
    }
    return out;
  });
}

const APOS = '\'‘’ʻʼ`';
/** Uzbek Latin -> Cyrillic, word by word; a word that is not plain Uzbek stays as typed. */
function latToCyr(text) {
  return String(text).replace(new RegExp(`[A-Za-z${APOS}]+`, 'gu'), (w) => {
    const core = w.replace(new RegExp(`^[${APOS}]+|[${APOS}]+$`, 'gu'), '');
    if (!core || !/[A-Za-z]/.test(core)) return w;
    if (/[w]|c(?!h)|C(?![Hh])/.test(core)) return w;               // brand / foreign
    if (/[a-z][A-Z]/.test(core)) return w;                           // iPhone, McDonald
    if (core.length <= 4 && core === core.toUpperCase()) return w;  // IMEI, SMS, USB
    const upper = core.length > 1 && core === core.toUpperCase();
    const s = core.toLowerCase();
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const two = s.slice(i, i + 2), nx = s[i + 1] || '';
      const isAp = c => APOS.includes(c);
      let t, n = 1;
      if ((s[i] === 'o' || s[i] === 'g') && isAp(nx)) { t = s[i] === 'o' ? 'ў' : 'ғ'; n = 2; }
      else if (two === 'sh') { t = 'ш'; n = 2; }
      else if (two === 'ch') { t = 'ч'; n = 2; }
      else if (two === 'yo') { t = 'ё'; n = 2; }
      else if (two === 'yu') { t = 'ю'; n = 2; }
      else if (two === 'ya') { t = 'я'; n = 2; }
      else if (two === 'ye' && i === 0) { t = 'е'; n = 2; }
      else if (s[i] === 'e') t = i === 0 ? 'э' : 'е';
      else if (isAp(s[i])) t = 'ъ';
      else t = { a: 'а', b: 'б', d: 'д', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', q: 'қ', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', x: 'х', y: 'й', z: 'з' }[s[i]] || s[i];
      const src = core.slice(i, i + n);
      out += caseLike(src, t, upper);
      i += n - 1;
    }
    return w.replace(core, out);
  });
}

/** One form of the Latin apostrophes: o‘ g‘ (U+2018) and the tutuq belgisi ’ (U+2019). */
function latinApostrophes(text) {
  return String(text)
    .replace(/([OoGg])['‘’ʻʼ`](?=\p{L})/gu, '$1\u2018')
    .replace(/(\p{L})['’ʼ`](?=\p{L})/gu, '$1\u2019');
}

/** 'lat' | 'cyr' | null - the script most of the letters are in. */
function scriptOf(text) {
  const c = (String(text).match(CYR) || []).length;
  const l = (String(text).match(LAT) || []).length;
  if (!c && !l) return null;
  return c > l ? 'cyr' : 'lat';
}

/**
 * Convert one text (no markup) to the target script. Quoted names («…», "…")
 * keep their letters.
 */
function toScript(text, target) {
  const conv = target === 'cyr' ? latToCyr : (t) => latinApostrophes(cyrToLat(t));
  return String(text).split(/(«[^»]*»|"[^"]*"|“[^”]*”)/u).map((part, i) => (i % 2 ? part : conv(part))).join('');
}

/** Is this an Uzbek document (not Russian)? */
function isUzbek(bodyHtml, lang) {
  if (lang === 'ru') return UZ_CYR_ONLY.test(bodyHtml);
  return true;
}

/* ───────────── values ───────────── */

const MONTHS = {
  lat: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'],
  cyr: ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'],
};

/** "2026-09-30" -> "2026 yil 30 sentyabr" (uz) / "30.09.2026" (ru); anything else as typed. */
function formatDate(v, { script = 'lat', lang = 'uz' } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
  if (!m) return v;
  const [, y, mo, d] = m;
  if (lang === 'ru' && script === 'cyr') return `${d}.${mo}.${y}`;
  const month = MONTHS[script === 'cyr' ? 'cyr' : 'lat'][Number(mo) - 1];
  if (!month) return v;
  return script === 'cyr' ? `${y} йил ${Number(d)} ${month}` : `${y} yil ${Number(d)} ${month}`;
}

function cleanValue(v) {
  return String(v == null ? '' : v)
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .trim();
}

const fold = s => String(s).toLowerCase().replace(new RegExp(`[${APOS}]`, 'gu'), '\'');
const wordsOf = s => String(s).split(/\s+/u).filter(Boolean);

/**
 * Drop from a value the words the template already writes right before /
 * after it (two or more words, compared without case or apostrophe form).
 */
function trimOverlap(before, value, after) {
  let v = value;
  const vw = wordsOf(v);
  const bw = wordsOf(String(before).replace(/<[^>]*>/g, ' '));
  for (let k = Math.min(8, vw.length - 1, bw.length); k >= 2; k--) {
    if (fold(bw.slice(-k).join(' ')) === fold(vw.slice(0, k).join(' '))) { v = vw.slice(k).join(' '); break; }
  }
  const vw2 = wordsOf(v);
  const aw = wordsOf(String(after).replace(/<[^>]*>/g, ' '));
  for (let k = Math.min(8, vw2.length - 1, aw.length); k >= 2; k--) {
    if (fold(aw.slice(0, k).join(' ').replace(/[,.;:]$/, '')) === fold(vw2.slice(-k).join(' ').replace(/[,.;:]$/, ''))) { v = vw2.slice(0, -k).join(' '); break; }
  }
  // "yo‘q." followed by the template's "," -> "yo‘q,"
  if (/^[,.;:]/.test(String(after)) && /[\p{Ll}\u2018\u2019']{3,}\.$/u.test(v)) v = v.slice(0, -1);
  return v;
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

/**
 * Template + values -> body HTML in one script. `fields` gives the date
 * fields; `lang` is the template's language.
 */
function renderOrderly({ body, fields = [], lang = 'uz' }, values = {}) {
  const src = String(body || '');
  const types = new Map((fields || []).map(f => [f.key, f.type]));
  const typed = Object.keys(values || {}).map(k => cleanValue(values[k])).join(' ');
  const uz = isUzbek(src, lang);
  const target = uz ? (scriptOf(typed) || scriptOf(src.replace(/<[^>]*>|\{\{\w+\}\}/g, ' ')) || 'lat') : null;
  const conv = (t) => (target ? toScript(t, target) : t);

  // template text and values are converted separately: a value is never re-split
  const parts = src.split(/\{\{(\w+)\}\}/g);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) { out.push({ text: convHtml(parts[i], conv) }); continue; }
    const key = parts[i];
    let v = cleanValue((values || {})[key]);
    if (!v) { out.push({ text: '__________' }); continue; }
    if (types.get(key) === 'date') v = formatDate(v, { script: target || (lang === 'ru' ? 'cyr' : 'lat'), lang });
    else if (target) v = toScript(v, target);
    out.push({ value: v });
  }
  for (let i = 0; i < out.length; i++) {
    if (out[i].value == null) continue;
    const before = (out[i - 1] && (out[i - 1].text != null ? out[i - 1].text : out[i - 1].value)) || '';
    const after = (out[i + 1] && (out[i + 1].text != null ? out[i + 1].text : out[i + 1].value)) || '';
    out[i].text = escHtml(trimOverlap(before, out[i].value, after.replace(/^<[^>]*>/, '')));
  }
  return out.map(p => p.text).join('');
}

/** Convert the text of HTML (not tags, not entities). */
function convHtml(html, conv) {
  return String(html).split(/(<[^>]*>|&[#\w]+;)/g).map((p, i) => (i % 2 ? p : conv(p))).join('');
}

/* ───────────── layout ───────────── */

const SIGN_WORDS = /^(imzo|имзо|подпись|muhr|муҳр|мп|м\.п\.|imzo,?\s*muhr|имзо,?\s*муҳр)$/iu;

function captionText(t) {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  // "(imzo)", or a signing blank with its caption: "______ (imzo)"
  const m = /^(?:_{3,}\s*)?\(([^()]{1,30})\)$/u.exec(s);
  if (!m) return null;
  if (wordsOf(m[1]).length > 4) return null;
  if (/^_/.test(s) && !SIGN_WORDS.test(m[1].trim())) return null;
  return s;
}
const isSignCaption = c => SIGN_WORDS.test(String(c).replace(/^_+\s*/, '').replace(/^\(|\)$/g, '').trim());

function textOf($, el) { return $(el).text().replace(/\s+/g, ' ').trim(); }

/** A short line that is not a sentence (a name, a role, a blank, a value). */
function isShortLine(t) {
  if (!t || t.length > 80) return false;
  if (captionText(t)) return false;
  const w = wordsOf(t).length;
  return !(w >= 7 && /[.!?]$/.test(t));
}

const CELL_CAPTION = 'font-size:9pt;text-align:center;margin:0';
const cellP = (html, align) => `<p style="margin:0;text-align:${align}">${html}</p>`;

function unitCell(lineHtml, caption, width) {
  return `<td style="vertical-align:top;width:${width}%">${cellP(lineHtml, 'center')}<p class="jai-cap" style="${CELL_CAPTION}"><span style="font-size:9pt">${caption}</span></p></td>`;
}

const DATE_CAPTION = /\b(kun|oy|yil|sana|кун|ой|йил|сана|дата|число|день|месяц|год)\b/iu;
const DATE_LINE = /\d{4}|\d{1,2}\.\d{1,2}\.|\byil\b|\bйил\b|_{3,}/iu;

/**
 * Put caption-only lines on the line they belong to. Works on the body's
 * top-level paragraphs (and a single wrapping div); anything already in a
 * table is left as it is.
 */
function layoutCaptions(html) {
  const $ = cheerio.load(`<div id="__r">${html}</div>`, { decodeEntities: false }, false);
  let $root = $('#__r');
  const kids0 = $root.children();
  if (kids0.length === 1 && kids0[0].name === 'div' && !$root.contents().filter((_, n) => n.type === 'text' && n.data.trim()).length) $root = $(kids0[0]);

  const nodes = $root.contents().toArray().filter(n => n.type === 'tag' || (n.type === 'text' && n.data.trim()));
  const P = el => el && el.type === 'tag' && /^(p|div)$/i.test(el.name) && !$(el).find('table,p,div,ul,ol').length;
  const info = nodes.map(el => {
    const t = P(el) ? textOf($, el) : null;
    const cap = t != null ? captionText(t) : null;
    return { el, t, cap, line: t != null && !cap && isShortLine(t) };
  });
  const html0 = n => (n.type === 'text' ? n.data : $.html(n));

  const out = []; // { html, unit?: cell html, role?: true }
  let i = 0;
  while (i < info.length) {
    const it = info[i];
    if (it.line) {
      let k = 0;
      while (info[i + k] && info[i + k].line) k++;
      let m = 0;
      while (info[i + k + m] && info[i + k + m].cap) m++;
      const caps = info.slice(i + k, i + k + m);
      const run = info.slice(i, i + k);
      const sign = m && caps.every(c => isSignCaption(c.cap));
      let chosen = null;
      if (m && sign) {
        const last = run.slice(-m);
        if (k >= m && last.every(l => /_{3,}/.test(l.t))) chosen = last;
      } else if (m && k >= m) {
        if (m === 1 && DATE_CAPTION.test(caps[0].cap)) {
          const d = run.filter(l => DATE_LINE.test(l.t)).pop();
          chosen = [d || run[run.length - 1]];
        } else chosen = run.slice(-m);
      }
      if (chosen) {
        // the run's other lines stay, before the row, in their order
        run.filter(l => !chosen.includes(l)).forEach(l => out.push({ html: html0(l.el) }));
        if (chosen.length === 1) {
          out.push({ unit: [$(chosen[0].el).html(), caps[0].cap] });
        } else {
          // signing lines ("1. ____ Name") take the whole width, a date / place pair leaves a gap
          const gap = chosen.length === 2 && !sign;
          const cells = chosen.map((l, j) => unitCell($(l.el).html(), caps[j].cap, gap ? 40 : Math.floor(100 / chosen.length)));
          if (gap) cells.splice(1, 0, '<td style="width:20%"></td>');
          out.push({ html: `<table class="jai-sign" style="width:100%;border:0"><tr>${cells.join('')}</tr></table>` });
        }
        i += k + m;
        continue;
      }
      // a signature caption under a role: the lines go out as they are, (B) takes the caption
      for (let j = 0; j < k; j++) out.push({ html: html0(info[i + j].el), lineInfo: info[i + j] });
      i += k;
      continue;
    }
    // (B) [role] (imzo) name, repeated -> one table, a row a signer
    if (it.cap && isSignCaption(it.cap) && info[i + 1] && info[i + 1].line) {
      let role = '';
      const prev = out[out.length - 1];
      if (prev && prev.lineInfo && prev.lineInfo === info[i - 1] && !/_{3,}/.test(prev.lineInfo.t)) {
        role = $(prev.lineInfo.el).html();
        out.pop();
      }
      const rows = [];
      let j = i;
      while (info[j] && info[j].cap && isSignCaption(info[j].cap) && info[j + 1] && info[j + 1].line) {
        rows.push(`<tr><td style="vertical-align:top;width:45%">${cellP(role, 'left')}</td><td style="vertical-align:top;width:20%">${cellP(info[j].cap, 'center')}</td><td style="vertical-align:top;width:35%">${cellP($(info[j + 1].el).html(), 'right')}</td></tr>`);
        role = '';
        j += 2;
        // the next signer's role: a short line, then (imzo), then a name
        if (info[j] && info[j].line && !/_{3,}/.test(info[j].t)
          && info[j + 1] && info[j + 1].cap && isSignCaption(info[j + 1].cap)
          && info[j + 2] && info[j + 2].line) {
          role = $(info[j].el).html();
          j += 1;
        }
      }
      out.push({ html: `<table class="jai-sign" style="width:100%;border:0">${rows.join('')}</table>` });
      i = j;
      continue;
    }
    out.push({ html: html0(it.el) });
    i++;
  }
  // two single units next to each other share one row: the first left, the second right
  const merged = [];
  for (let j = 0; j < out.length; j++) {
    const o = out[j];
    if (!o.unit) { merged.push(o.html); continue; }
    const n = out[j + 1];
    if (n && n.unit) {
      merged.push(`<table class="jai-sign" style="width:100%;border:0"><tr>${unitCell(o.unit[0], o.unit[1], 40)}<td style="width:20%"></td>${unitCell(n.unit[0], n.unit[1], 40)}</tr></table>`);
      j++;
    } else {
      merged.push(`<table class="jai-sign" style="width:100%;border:0"><tr>${unitCell(o.unit[0], o.unit[1], 40)}<td style="width:60%"></td></tr></table>`);
    }
  }
  $root.html(merged.join(''));
  return $('#__r').html();
}

/** Print / PDF: justified body paragraphs, 1 cm first-line indent, borderless signature rows. */
const LEGAL_CSS = `
  p { text-align: justify; text-indent: 1cm; }
  p[style*="center"], p[style*="right"], td p, th p, li p, li { text-indent: 0; }
  td p, th p { text-align: inherit; }
  table.jai-sign { width: 100%; border: 0; margin: 6pt 0 10pt; }
  table.jai-sign td { border: 0; padding: 0 4pt; }
  p.jai-cap { font-size: 9pt; text-align: center; text-indent: 0; margin: 0; }
`;

module.exports = {
  cyrToLat, latToCyr, toScript, scriptOf, isUzbek, formatDate, cleanValue, trimOverlap,
  renderOrderly, layoutCaptions, captionText, LEGAL_CSS,
};
