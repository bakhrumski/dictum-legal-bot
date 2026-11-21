'use strict';

/**
 * Plenum lines in the legal answer (S2, docs/design/sud-amaliyoti.md; the
 * owner consented 2026-11-03). No AI, no embeddings, no extra call.
 *
 * After retrieval the answer already has its norms: the retrieved chunks name
 * an act (law_name) and articles. A Plenum band that names the SAME article of
 * the SAME code (plenum_bands.article_refs, S1) and shares a word root with
 * the question is a candidate; at most two bands, from different decisions
 * when there are two. They go to the prompt as a separate block, marked as a
 * court's explanation (not a law), and to the citation chunks - so the
 * existing word-for-word quote check, its lex.uz highlight link and the claim
 * guard treat them like any other source. A band that names no known act, or
 * an act the answer does not use, is never picked.
 *
 * PLENUM_ANSWERS=off stops it; an empty or missing table picks nothing.
 */

const { actKey, articleSet } = require('./acts');

const MAX_BANDS = 2;
const MAX_CHARS = 1500;
// A word root found in many bands ("javobgarlik", "shartnoma", "tartib", "срок")
// tells them apart from nothing. Each shared root weighs log(bands / bands with it)
// over the whole edition; a band needs one rare root and enough weight in all.
const RARE_SHARE = 0.03; // a root in at most 3 % of the edition's bands is rare
const MIN_WEIGHT = 6; // the shared roots' weight a band needs (one rare root and a little more)
const STATS_TTL_MS = 6 * 3600e3;
const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

/** "57¹" / "57-1" / "57 1" -> "57-1"; "333" -> "333". */
function artKey(n) {
  const s = String(n || '').trim();
  const m = /^(\d{1,4})\s*(?:[-\s]?(\d{1,2})|([⁰¹²³⁴⁵⁶⁷⁸⁹]+))?$/u.exec(s);
  if (!m) return null;
  const prime = m[2] || (m[3] ? m[3].split('').map(c => SUP[c]).join('') : '');
  return prime ? `${m[1]}-${prime}` : m[1];
}

// common words of questions and of decisions - they say nothing about the matter
const STOP = new Set(('qanda qacho nimag qayer qanch nimal kerak mumki bormi boyic uchun haqid tomon qaysi agar keyin oldin bilan hamda yoki lekin ammo '
  + 'qilis qilin etila etish berad beris bolad bolis olish oladi sudla sudni sudga sudi mazku shuni ushbu barch tegis '
  + 'респу узбек может можно какой какие когда после чтобы через также судам судом судов суда либо этого '
  + 'бўлса учун ҳақид мумки керак қанда').split(/\s+/u));

/** 5-letter starts of the words (4+ letters), apostrophes dropped, common words out. */
function roots(text = '') {
  return Array.from(new Set(String(text || '').normalize('NFKC').toLocaleLowerCase('uz')
    .replace(/[ʻʼ‘’`'ʼ]/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/u)
    .filter(w => w.length >= 4 && !/^\d+$/u.test(w))
    .map(w => w.slice(0, 5))
    .filter(r => !STOP.has(r))));
}

/** The edition the answer reads: ru for a Russian answer, Cyrillic Uzbek for a Cyrillic question, else Latin. */
function editionFor(language, question = '') {
  if (language === 'ru') return 'ru';
  const cyr = (String(question).match(/[Ѐ-ӿ]/gu) || []).length;
  const lat = (String(question).match(/[A-Za-z]/gu) || []).length;
  return cyr > lat ? 'uz' : 'lat';
}

/** { act key -> Set(article keys) } from the retrieved chunks; acts that are not a known code are left out. */
function normsOf(chunks = [], getRefs) {
  const out = new Map();
  for (const c of chunks || []) {
    if (!c || c.doc_type === 'plenum') continue;
    const key = actKey(c.law_name || c.lawName || c.title || '', c.language === 'ru' ? 'ru' : 'lat');
    if (!key) continue;
    const arts = (getRefs ? getRefs(c) : (c.article_numbers || [])).map(artKey).filter(Boolean);
    if (!arts.length) continue;
    if (!out.has(key)) out.set(key, new Set());
    arts.forEach(a => out.get(key).add(a));
  }
  return out;
}

const pad = n => String(n).padStart(2, '0');
function dateText(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return `${pad(dt.getUTCDate())}.${pad(dt.getUTCMonth() + 1)}.${dt.getUTCFullYear()}`;
}
function courtName(court, lang) {
  if (lang === 'ru') return court === 'xojalik' ? 'Пленум Высшего хозяйственного суда' : court === 'qoshma' ? 'Совместный Пленум' : 'Пленум Верховного суда';
  if (lang === 'uz') return court === 'xojalik' ? 'Олий хўжалик суди Пленуми' : court === 'qoshma' ? 'Қўшма Пленум' : 'Олий суд Пленуми';
  return court === 'xojalik' ? "Oliy xo'jalik sudi Plenumi" : court === 'qoshma' ? "Qo'shma Plenum" : 'Oliy sud Plenumi';
}
/** "Oliy sud Plenumining 18-son qarori (12.07.2019)" - short, so the quote's link label keeps it whole. */
function decisionName(d, lang) {
  const court = courtName(d.court, lang);
  const date = dateText(d.adopted_on);
  const num = d.number ? String(d.number) : '';
  if (lang === 'ru') return `${court.replace('Пленум ', 'Пленум ').replace('Верховного суда', 'ВС').replace('Высшего хозяйственного суда', 'ВХС')}, постановление${num ? ` № ${num}` : ''}${date ? ` от ${date}` : ''}`;
  const gen = lang === 'uz' ? `${court}нинг` : `${court}ning`;
  return `${gen} ${num ? `${num}-${lang === 'uz' ? 'сон' : 'son'} ` : ''}${lang === 'uz' ? 'қарори' : 'qarori'}${date ? ` (${date})` : ''}`;
}
function urlOf(d, lang) {
  if (lang === 'ru') return d.ru_lex_id ? `https://lex.uz/ru/docs/${d.ru_lex_id}` : null;
  if (lang === 'uz') return `https://lex.uz/docs/${d.lex_id}`;
  return `https://lex.uz/docs/-${Math.abs(d.lat_lex_id || d.lex_id)}`;
}
/** A band's text within the cap, cut at the last full sentence. */
function capText(text) {
  const t = String(text || '').replace(/[ \t]+/gu, ' ').trim();
  if (t.length <= MAX_CHARS) return t;
  const cut = t.slice(0, MAX_CHARS);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '), cut.lastIndexOf('.\n'));
  return `${end > MAX_CHARS / 2 ? cut.slice(0, end + 1) : cut} …`;
}

/**
 * How many bands of one edition hold each root: { total, df } - read once per
 * edition and kept STATS_TTL_MS (only the counts are kept, never the text).
 */
const statsCache = new Map();
async function rootStats(db, lang) {
  const hit = statsCache.get(lang);
  if (hit && Date.now() - hit.at < STATS_TTL_MS && hit.db === db) return hit.value ? hit.value : hit.pending;
  const pending = (async () => {
    const rows = (await db.query(
      `SELECT b.text FROM plenum_bands b JOIN plenum_decisions d ON d.lex_id = b.decision_id
        WHERE b.lang = $1 AND b.n > 0 AND d.in_force AND NOT d.is_amendment`, [lang])).rows;
    const df = new Map();
    for (const r of rows) for (const x of roots(r.text)) df.set(x, (df.get(x) || 0) + 1);
    return rows.length ? { total: rows.length, df } : null;
  })();
  statsCache.set(lang, { at: Date.now(), db, pending });
  try {
    const value = await pending;
    statsCache.set(lang, { at: Date.now(), db, value });
    return value;
  } catch (e) { statsCache.delete(lang); throw e; }
}

/**
 * The Plenum bands for one answer: [{ decisionId, n, lang, name, court, number,
 * date, url, text, pairs, roots }] (best first, <= 2), or [] - never throws.
 * `chunks` are the retrieved sources, `getRefs` the corpus's article reader.
 */
async function findPlenumBands(db, { chunks = [], question = '', language = 'uz', getRefs = null } = {}) {
  if (String(process.env.PLENUM_ANSWERS || '').toLowerCase() === 'off' || !db) return [];
  const norms = normsOf(chunks, getRefs);
  if (!norms.size) return [];
  const lang = editionFor(language, question);
  const allArts = [...new Set([...norms.values()].flatMap(s => [...s]))];
  // the database narrows by the article number (any act); the act is checked here
  const nums = [...new Set(allArts.map(a => a.split('-')[0]))].slice(0, 60);
  let rows;
  try {
    rows = (await db.query(
      `SELECT b.decision_id, b.n, b.text, b.article_refs, d.lex_id, d.lat_lex_id, d.ru_lex_id, d.court, d.number, d.adopted_on
         FROM plenum_bands b JOIN plenum_decisions d ON d.lex_id = b.decision_id
        WHERE b.lang = $1 AND b.n > 0 AND d.in_force AND NOT d.is_amendment
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(b.article_refs) r
                       WHERE r->>'act' IS NOT NULL AND (substring(r->>'n' from '^[0-9]+') = ANY($2::text[]) OR r->>'n' ~ '[–—-]'))
        LIMIT 4000`, [lang, nums])).rows;
  } catch (e) {
    if (!/does not exist/u.test(String(e && e.message))) console.warn('[PLENUM] answer bands:', e.message);
    return [];
  }
  const qRoots = new Set(roots(question));
  const cands = [];
  for (const r of rows) {
    const pairs = new Set();
    for (const ref of Array.isArray(r.article_refs) ? r.article_refs : []) {
      const key = actKey(ref.act, lang);
      if (!key || !norms.has(key)) continue;
      for (const a of articleSet(ref.n)) {
        const k = artKey(a);
        if (k && norms.get(key).has(k)) pairs.add(`${key}:${k}`);
      }
    }
    if (pairs.size) cands.push({ r, pairs: [...pairs], shared: roots(r.text).filter(x => qRoots.has(x)) });
  }
  if (!cands.length) return [];
  let stats;
  try { stats = await rootStats(db, lang); } catch (e) { console.warn('[PLENUM] answer stats:', e.message); return []; }
  if (!stats) return [];
  const weight = x => Math.log(stats.total / Math.max(1, stats.df.get(x) || 1));
  const picked = [];
  for (const c of cands) {
    const rare = c.shared.filter(x => (stats.df.get(x) || 0) <= stats.total * RARE_SHARE);
    const w = c.shared.reduce((n, x) => n + weight(x), 0);
    // the article alone is not enough: a band on article 168 may be about currency, not fraud
    if (!rare.length || w < MIN_WEIGHT) continue;
    picked.push({ ...c, rare, score: c.pairs.length * 2 + w });
  }
  picked.sort((a, b) => b.score - a.score || String(b.r.adopted_on || '').localeCompare(String(a.r.adopted_on || '')));
  const out = [];
  const seen = new Set();
  for (const p of picked) {
    if (seen.has(p.r.decision_id)) continue;
    seen.add(p.r.decision_id);
    out.push(p);
    if (out.length >= MAX_BANDS) break;
  }
  return out.map(({ r, pairs, shared, rare, score }) => ({
    decisionId: r.decision_id, n: r.n, lang, court: r.court, number: r.number || null, date: dateText(r.adopted_on),
    name: decisionName(r, lang), url: urlOf(r, lang), text: capText(r.text), pairs, roots: shared.length, rare, score,
  }));
}

/** The prompt block for the bands ("" when none). The answer's language picks the words. */
function contextBlock(bands = [], language = 'uz') {
  if (!bands.length) return '';
  const ru = language === 'ru';
  const head = ru
    ? '\nСУДЕБНАЯ ПРАКТИКА — РАЗЪЯСНЕНИЕ ПЛЕНУМА (не закон; применяйте только если пункт прямо относится к вопросу):\n'
    : "\nSUD AMALIYOTI — PLENUM TUSHUNTIRISHI (qonun emas; band savolga bevosita tegishli bo'lsagina qo'llang):\n";
  return head + bands.map((b, i) => `[P${i + 1}] ${b.name}, ${b.n}-${ru ? 'пункт' : 'band'}${b.url ? ` | ${b.url}` : ''}\n${b.text}`).join('\n\n') + '\n';
}

/** Citation chunks for the bands: the quote check, its link and the claim guard read them like any source. */
function citationChunks(bands = []) {
  return bands.map(b => ({
    doc_type: 'plenum',
    source_type: 'plenum',
    law_name: b.name,
    chunk_text: b.text,
    source_url: b.url,
    is_active: !!b.url,
    language: b.lang === 'ru' ? 'ru' : 'uz',
    // no article numbers: "5-band" in the answer must not be linked to a law's article
    article_numbers: [],
    plenum: { decisionId: b.decisionId, n: b.n },
  }));
}

/** What the answer's meta records: ids and pairs only, never the text. */
function metaOf(bands = []) {
  return { bands: bands.map(b => ({ decision: b.decisionId, n: b.n, lang: b.lang, pairs: b.pairs, score: b.score })), chars: bands.reduce((n, b) => n + b.text.length, 0) };
}

module.exports = { findPlenumBands, rootStats, _clearStats: () => statsCache.clear(), contextBlock, citationChunks, metaOf, normsOf, artKey, roots, editionFor, decisionName, urlOf, MAX_BANDS, MAX_CHARS };
