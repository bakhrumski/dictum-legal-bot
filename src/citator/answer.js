'use strict';

/**
 * The citator under a legal answer (S3, docs/design/sud-amaliyoti.md). No AI,
 * no request to lex.uz: the rows the server wrote when it read the acts'
 * pages (store.js), the corpus copy's date and the Plenum tables.
 *
 * For each act the final answer links to lex.uz:
 *   - in force or not, as lex.uz showed it when the page was last read
 *     (`checkedAt`); an act with no row is "not checked", never "in force"
 *   - its last amending publication
 *   - each cited article / band: the latest change note on lex.uz (date, act)
 *   - our copy: a corpus text older than a change it cites is `stale` - the
 *     answer read the old words; a page read live is the act as it stands
 *   - Plenum: decisions in force naming that article of that code
 *
 * `warn` lists: not in force, a stale copy (both shown with ⚠), or a cited
 * article changed in the last CITATOR_RECENT_DAYS (180; shown with ℹ - the
 * answer read the text as it stands, the change is worth a look). The rest is
 * information shown only on the site.
 * Dates are lex.uz's publication dates, not the day a change took effect.
 */

const store = require('./store');
const { actKey, articleSet } = require('../plenum/acts');
const P = require('../plenum/answer');

const RECENT_DAYS = () => Math.max(1, Number(process.env.CITATOR_RECENT_DAYS) || 180);
const MAX_ACTS = 8;
const off = () => String(process.env.CITATOR || '').toLowerCase() === 'off';

const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
const unitKey = (n, prime) => (prime ? `${n}-${String(prime).split('').map(c => SUP[c] || c).join('')}` : String(n));

/** The articles / bands the answer names: Set("161", "57-1"). */
function citedUnits(reply = '') {
  const out = new Set();
  const s = String(reply || '');
  let m;
  const uz = /(?<![\p{L}\p{N}])(\d{1,4})([⁰¹²³⁴⁵⁶⁷⁸⁹]*)\s*-\s*(?:modda|band|модда|банд)/giu;
  while ((m = uz.exec(s))) out.add(unitKey(m[1], m[2]));
  const ru = /(?:стать[яиеюй]|ст\.|пункт[аеу]?|п\.)\s*(\d{1,4})([⁰¹²³⁴⁵⁶⁷⁸⁹]*)/giu;
  while ((m = ru.exec(s))) out.add(unitKey(m[1], m[2]));
  return out;
}

/** lex.uz ids linked in the answer, in order of first link. */
function linkedIds(reply = '') {
  const out = [];
  const re = /https?:\/\/(?:www\.)?lex\.uz\/(?:uz\/|ru\/|oz\/)?docs\/(-?\d+)/giu;
  let m;
  while ((m = re.exec(String(reply || '')))) {
    const id = Math.abs(Number(m[1]));
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

const isLive = c => c.source_type === 'lex_live' || /^lex_(?:live|mentioned)_/u.test(String(c.id || ''));
const day = d => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** When our corpus copy of each source url was last read from lex.uz: Map(url -> 'YYYY-MM-DD'). */
async function copyDates(db, urls) {
  const list = [...new Set(urls.filter(Boolean))].slice(0, 40);
  if (!list.length || !db) return new Map();
  try {
    const r = await db.query(
      `SELECT source_url, max(COALESCE(last_checked_at, updated_at, created_at)) AS at
         FROM legal_chunks WHERE source_url = ANY($1::text[]) GROUP BY source_url`, [list]);
    return new Map(r.rows.map(x => [x.source_url, day(x.at)]));
  } catch (e) { return new Map(); }
}

/** Plenum decisions naming each (code, article): Map("fk:333" -> { count, top: [{ name, url }] }). */
async function plenumFor(db, pairs, lang) {
  const out = new Map();
  if (!pairs.length || !db) return out;
  const edition = lang === 'ru' ? 'ru' : 'lat';
  const nums = [...new Set(pairs.map(p => p.split(':')[1].split('-')[0]))].slice(0, 40);
  let rows;
  try {
    rows = (await db.query(
      `SELECT DISTINCT ON (b.decision_id, b.n) b.decision_id, b.n, b.article_refs, d.lex_id, d.lat_lex_id, d.ru_lex_id, d.court, d.number, d.adopted_on
         FROM plenum_bands b JOIN plenum_decisions d ON d.lex_id = b.decision_id
        WHERE b.lang = $1 AND b.n > 0 AND d.in_force AND NOT d.is_amendment
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(b.article_refs) r
                       WHERE r->>'act' IS NOT NULL AND (substring(r->>'n' from '^[0-9]+') = ANY($2::text[]) OR r->>'n' ~ '[–—-]'))
        LIMIT 4000`, [edition, nums])).rows;
  } catch (e) { return out; }
  const want = new Set(pairs);
  for (const r of rows) {
    for (const ref of Array.isArray(r.article_refs) ? r.article_refs : []) {
      const key = actKey(ref.act, edition);
      if (!key) continue;
      for (const a of articleSet(ref.n)) {
        const pair = `${key}:${P.artKey(a)}`;
        if (!want.has(pair)) continue;
        const e = out.get(pair) || { decisions: new Map() };
        if (!e.decisions.has(r.decision_id)) e.decisions.set(r.decision_id, { name: P.decisionName(r, edition), url: P.urlOf(r, edition), date: r.adopted_on ? day(r.adopted_on) : '', bands: [] });
        const d = e.decisions.get(r.decision_id);
        if (!d.bands.includes(r.n)) d.bands.push(r.n);
        out.set(pair, e);
      }
    }
  }
  for (const [pair, e] of out) {
    const list = [...e.decisions.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    out.set(pair, { count: list.length, top: list.slice(0, 2).map(d => ({ name: d.name, url: d.url, bands: d.bands.sort((a, b) => a - b).slice(0, 3) })) });
  }
  return out;
}

/**
 * The citator for one answer: [{ lexId, title, url, status, inForce, statusLabel,
 * lastChange, checkedAt, units: [{ n, kind, changed, by, recent, plenum }],
 * copy: { live, date, stale }, warn: [codes] }] - [] when nothing is linked; never throws.
 */
async function citatorFor(db, { reply = '', chunks = [], lang = 'uz', now = Date.now() } = {}) {
  if (off()) return [];
  try {
    const ids = linkedIds(reply);
    if (!ids.length) return [];
    const byId = new Map();
    for (const c of chunks || []) {
      if (!c || c.doc_type === 'plenum') continue;
      const id = store.lexIdOf(c.source_url || c.sourceUrl);
      if (!id || !ids.includes(id)) continue;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(c);
    }
    const acts = ids.filter(id => byId.has(id)).slice(0, MAX_ACTS);
    if (!acts.length) return [];
    const rows = await store.rowsFor(db, acts);
    const corpusUrls = acts.flatMap(id => byId.get(id).filter(c => !isLive(c)).map(c => c.source_url));
    const copies = await copyDates(db, corpusUrls);
    const cited = citedUnits(reply);
    const recentFrom = new Date(now - RECENT_DAYS() * 864e5).toISOString().slice(0, 10);
    const { getChunkArticleRefs } = require('../rag/citation-utils');

    const items = acts.map((id) => {
      const cs = byId.get(id);
      const first = cs[0];
      const row = rows.get(id) || null;
      const own = new Set(cs.flatMap(c => getChunkArticleRefs(c)).map(a => P.artKey(a)).filter(Boolean));
      const units = [...own].filter(u => cited.has(u)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).slice(0, 6);
      const live = cs.some(isLive);
      const copyDate = live ? null : cs.map(c => copies.get(c.source_url)).filter(Boolean).sort().pop() || null;
      const unitRows = units.map((n) => {
        const u = row && row.units ? row.units[n] : null;
        return { n, kind: (u && u.kind) || (first.provision_type === 'band' ? 'band' : 'modda'), changed: u ? u.date : null, by: u ? u.by : null, recent: !!(u && u.date >= recentFrom) };
      });
      // the copy is stale when lex.uz shows a change after we read it: of a cited unit, else of the act
      const changeAfter = unitRows.length ? unitRows.map(u => u.changed).filter(Boolean).sort().pop() : (row && row.last_change ? day(row.last_change) : null);
      const stale = !!(copyDate && changeAfter && changeAfter > copyDate);
      const warn = [];
      if (row && row.in_force === false) warn.push('not_in_force');
      if (stale) warn.push('stale');
      if (unitRows.some(u => u.recent)) warn.push('recent');
      return {
        lexId: id,
        title: String((row && row.title) || first.law_name || '').replace(/\s+/gu, ' ').trim().slice(0, 160),
        url: first.source_url,
        code: actKey(first.law_name || (row && row.title) || '', lang === 'ru' ? 'ru' : 'lat'),
        status: !row ? 'unchecked' : row.in_force === false ? 'not_in_force' : row.in_force === true ? 'in_force' : 'unknown',
        statusLabel: row ? row.status_label || null : null,
        lastChange: row && row.last_change ? day(row.last_change) : null,
        checkedAt: row ? day(row.checked_at) : null,
        units: unitRows,
        copy: { live, date: copyDate, stale },
        warn,
      };
    });

    const pairs = [...new Set(items.filter(i => i.code).flatMap(i => i.units.map(u => `${i.code}:${u.n}`)))];
    const plenum = await plenumFor(db, pairs, lang);
    for (const i of items) {
      for (const u of i.units) u.plenum = (i.code && plenum.get(`${i.code}:${u.n}`)) || null;
      delete i.code;
    }
    return items;
  } catch (e) {
    console.warn('[CITATOR] answer:', e.message);
    return [];
  }
}

const fmt = d => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');

/**
 * The warnings in one short block for Telegram (Markdown-safe plain text), ""
 * when there is none. Information without a warning is not sent there.
 */
function telegramNote(items = [], lang = 'uz') {
  const ru = lang === 'ru';
  const lines = [];
  for (const i of items) {
    if (!i.warn.length) continue;
    const name = i.title.length > 70 ? `${i.title.slice(0, 68).replace(/\s+\S*$/u, '')}…` : i.title;
    if (i.warn.includes('not_in_force')) lines.push(ru ? `⚠ ${name}: на lex.uz указан как утративший силу${i.statusLabel ? ` (${i.statusLabel})` : ''}.` : `⚠ ${name}: lex.uz'da kuchini yo'qotgan deb ko'rsatilgan${i.statusLabel ? ` (${i.statusLabel})` : ''}.`);
    const changed = i.units.filter(u => u.changed && (u.recent || i.copy.stale));
    if (i.copy.stale) lines.push(ru ? `⚠ ${name}: наш текст от ${fmt(i.copy.date)}, на lex.uz позже изменён - сверьте по ссылке.` : `⚠ ${name}: bizdagi matn ${fmt(i.copy.date)} holatida, lex.uz'da keyin o'zgargan - havoladan tekshiring.`);
    // a recent change of a text read as it stands is information (ℹ); after our copy it is a warning (⚠)
    const mark = i.copy.stale ? '⚠' : 'ℹ';
    for (const u of changed.slice(0, 2)) {
      const unit = ru ? `${u.kind === 'band' ? 'пункт' : 'статья'} ${u.n}` : `${u.n}-${u.kind}`;
      lines.push(ru ? `${mark} ${name}, ${unit}: изменена ${fmt(u.changed)}${u.by ? ` (${u.by})` : ''}.` : `${mark} ${name}, ${unit}: ${fmt(u.changed)} da o'zgartirilgan${u.by ? ` (${u.by})` : ''}.`);
    }
    if (lines.length >= 4) break;
  }
  return lines.slice(0, 4).join('\n');
}

module.exports = { citatorFor, telegramNote, citedUnits, linkedIds, plenumFor, RECENT_DAYS };
