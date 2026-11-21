'use strict';

/**
 * What a lex.uz page says about the act's changes (S3, docs/design/sud-amaliyoti.md).
 * No AI, no extra request: read from the page the answer pipeline has
 * already downloaded.
 *
 *   PUBLICATION_ORIGIN  "(Qonunchilik ma'lumotlari milliy bazasi, 29.10.2022-y., …;
 *                        12.04.2023-y., …; 14.07.2026-y., …)" - the act and every
 *                        amending publication; the latest date is its last change
 *   CHANGES_ORIGINS     one note under each changed unit: "(10-modda … O'RQ-1158-sonli
 *                        … asosan … to'ldirilgan — …, 14.07.2026-y., …)"
 *
 * A note names its unit in its first words; a note whose unit cannot be read
 * is counted, never guessed. Dates are as lex.uz prints them (the publication
 * date), never the date a change entered into force - that is not on the page.
 */

const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
const ENTITY = { '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' };

const text = html => String(html || '').replace(/<[^>]+>/gu, ' ')
  .replace(/&(?:nbsp|amp|quot|#39|lt|gt);/gu, m => ENTITY[m]).replace(/\s+/gu, ' ').trim();

/** "14.07.2026" -> "2026-07-14" (null when not a real date). */
function isoDate(d) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(String(d || ''));
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const dt = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) || dt.getUTCDate() !== Number(dd) ? null : `${yyyy}-${mm}-${dd}`;
}
/** Publication dates in a note: "14.07.2026-y.", "14.07.2026 й.", "14.07.2026 г." */
function datesIn(s) {
  const out = [];
  const re = /(\d{2}\.\d{2}\.\d{4})\s*-?\s*(?:y\.|й\.|г\.)/gu;
  let m;
  while ((m = re.exec(s))) { const d = isoDate(m[1]); if (d) out.push(d); }
  return out;
}
const maxDate = list => list.reduce((a, b) => (!a || b > a ? b : a), null);

/** The unit a change note opens with: "10-modda", "5-moddaning", "17-band", "Статья 10", "пункт 17" -> { n, kind }. */
function unitOf(note) {
  const s = note.replace(/^[(\s]+/u, '');
  let m = /^(\d{1,4})([⁰¹²³⁴⁵⁶⁷⁸⁹]*)\s*-\s*(modda|band|модда|банд)/iu.exec(s);
  if (m) return { n: m[1] + (m[2] ? `-${m[2].split('').map(c => SUP[c]).join('')}` : ''), kind: /modda|модда/iu.test(m[3]) ? 'modda' : 'band' };
  m = /^(Стать[яи]|Пункт)\s+(\d{1,4})([⁰¹²³⁴⁵⁶⁷⁸⁹]*)/iu.exec(s);
  if (m) return { n: m[2] + (m[3] ? `-${m[3].split('').map(c => SUP[c]).join('')}` : ''), kind: /стать/iu.test(m[1]) ? 'modda' : 'band' };
  return null;
}
const BY = /(O[ʻ'‘’`]?RQ|PQ|PF|VMQ|ЎРҚ|ЗРУ|ПҚ|ПП|ПФ|УП|ВМҚ|ПКМ)\s*-\s*(\d{1,6})/u;

/**
 * { lastChange, published, changes, units: { "<n>": { kind, date, by, count } }, unreadNotes }
 * from one page's html. Nothing found -> lastChange null, units {}.
 */
function parseChanges(html) {
  const h = String(html || '');
  const out = { lastChange: null, published: null, changes: 0, units: {}, unreadNotes: 0 };
  const pub = /class="PUBLICATION_ORIGIN[^"]*"[^>]*>([\s\S]{0,20000}?)<\/div>/u.exec(h);
  if (pub) {
    const dates = datesIn(text(pub[1]));
    if (dates.length) { out.published = dates[0]; out.lastChange = maxDate(dates); out.changes = dates.length - 1; }
  }
  let at = 0;
  for (;;) {
    const i = h.indexOf('class="CHANGES_ORIGINS', at);
    if (i < 0) break;
    const next = h.indexOf('<div class="', i + 22);
    at = i + 22;
    const note = text(h.slice(h.indexOf('>', i) + 1, next > 0 ? Math.min(next, i + 6000) : i + 6000));
    const unit = unitOf(note);
    const date = maxDate(datesIn(note));
    if (!unit || !date) { out.unreadNotes += 1; continue; }
    const by = BY.exec(note);
    const was = out.units[unit.n];
    if (!was) out.units[unit.n] = { kind: unit.kind, date, by: by ? `${by[1]}-${by[2]}` : null, count: 1 };
    else {
      was.count += 1;
      if (date > was.date) { was.date = date; was.by = by ? `${by[1]}-${by[2]}` : was.by; }
    }
    if (!out.lastChange || date > out.lastChange) out.lastChange = date;
  }
  return out;
}

module.exports = { parseChanges, unitOf, datesIn, isoDate };
