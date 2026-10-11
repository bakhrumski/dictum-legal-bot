'use strict';

/**
 * Key conditions tied to the document's own wording (2026-10-09; two live
 * runs dropped "declared", "including X", "all costs" and "separately" from
 * clauses the digest had kept). No AI.
 *
 * The key lines given to the final model (scope lines picked from the
 * DOCUMENT, never from the digest) carry an id bound to this document:
 * [S12·a3f9] - S12 is the line, a3f9 the first four hex digits of the
 * document's sha256. The model puts the id after its sentence on that clause;
 * the server puts the document's exact sentence under it. The server checks
 * every id: one this document did not issue (unknown number, another
 * document's key, no key) is refused and named, never quoted.
 *
 * A quote is the document's text, found in it character for character
 * (spaces aside) by the server - that is all it is. It does not check the
 * model's explanation around it: the explanation may still change a subject,
 * a condition or a consequence, and the mechanical checks run on the
 * explanation without the quotes, so a correct quote never hides it. Nothing
 * here is called verified or corrected.
 */

const crypto = require('crypto');

const flat = t => String(t || '').replace(/\s+/gu, ' ').trim();
const docKey = text => crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 4);

/**
 * A table row as the DOCX reader wrote it ("⟦Jadval 4 · 7-qator · Bo'lim⟧
 * ⟨Header⟩ value ¦ ⟨Header⟩ ⟨bo'sh⟩ ¦ ⟨Header⟩ ⟨↑ value⟩"): its table, row,
 * section and every cell with its column header, empty and merged cells kept.
 */
function parseRow(line) {
  const m = String(line || '').match(/^⟦Jadval (\d+) · (\d+)-qator(?: · ([^⟧]+))?⟧\s*(.*)$/u);
  if (!m) return null;
  const cells = m[4].split(' ¦ ').map((c) => {
    const h = c.match(/^⟨([^⟩]*)⟩\s*(.*)$/u);
    const header = h ? h[1] : '';
    let value = (h ? h[2] : c).trim();
    const empty = /^⟨bo'sh⟩$/u.test(value);
    const merged = value.match(/^⟨↑ (.*)⟩$/u);
    if (empty) value = '';
    else if (merged) value = merged[1];
    return { header, value, empty, merged: !!merged };
  });
  return { table: Number(m[1]), row: Number(m[2]), section: m[3] || null, cells };
}
/** A row for reading: "Jadval 4 · 7-qator · Bo'lim — №: 7 ¦ Muddat: (bo'sh) ¦ …". */
function rowText(r) {
  return `Jadval ${r.table} · ${r.row}-qator${r.section ? ` · ${r.section}` : ''} — ${r.cells.map(c => `${c.header || "ustun"}: ${c.empty ? "(bo'sh)" : c.value}${c.merged ? ' (yuqoridagi katak bilan birlashtirilgan)' : ''}`).join(' ¦ ')}`;
}

/**
 * Source lines for one document: each a sentence of the document found in it
 * verbatim (spaces aside). A sentence inside a table row stands for the WHOLE
 * row (2026-10-11: a row cut at a full stop inside a cell was quoted from its
 * middle, without its row id and first columns): the quote is that row, with
 * its table, row, section, column headers and every cell, empty ones too.
 * Returns { key, items: [{ id, tag, text, kind, row? }], notInSource }.
 */
function buildSources(documentText, sentences, { max = 40 } = {}) {
  const key = docKey(documentText);
  const all = flat(documentText);
  const rows = String(documentText || '').split('\n').filter(l => /^⟦Jadval \d+ · \d+-qator/u.test(l));
  const items = [];
  const seenRows = new Map();
  let notInSource = 0;
  for (const s of sentences || []) {
    if (items.filter(Boolean).length >= max) break;
    const text = flat(s);
    if (!text || !all.includes(text)) { notInSource++; items.push(null); continue; }
    const rowLine = rows.find(l => flat(l).includes(text));
    if (rowLine) {
      // one id per row, however many of its sentences were picked
      if (seenRows.has(rowLine)) { items.push(seenRows.get(rowLine)); continue; }
      const row = parseRow(rowLine);
      const id = `S${items.filter(Boolean).length + 1}`;
      const it = { id, tag: `[${id}·${key}]`, text: rowText(row), kind: 'table_row', row, raw: flat(rowLine) };
      seenRows.set(rowLine, it);
      items.push(it);
      continue;
    }
    const id = `S${items.filter(Boolean).length + 1}`;
    items.push({ id, tag: `[${id}·${key}]`, text, kind: 'text' });
  }
  return { key, items, notInSource };
}

// what the model may write: [S12·a3f9], a list [S12·a3f9, S13·a3f9] or a
// range [S30·a3f9 – S39·a3f9] (2026-10-11: both came back from a live run and
// were left raw). Also caught so they can be refused: [S12] (no key),
// [S12·zzzz] (another key). A bracket that starts like an id but holds other
// words is an unrecognised reference: only its id-like parts are taken out.
const REF = /S(\d{1,3})(?:\s*[·.:]\s*([0-9A-Za-z]{2,8}))?(?![\p{L}\p{N}])/gu;
const GROUP = /\[\s*S\d[^\]\n]{0,240}\]/gu;
const RANGE_SEP = /^\s*(?:–|—|-|\.\.\.?|…|dan)\s*$/u;
const LIST_SEP = /^\s*(?:,|;|va|and|\s)\s*$/u;
// how far a range is opened; a longer one is named, never cut or dropped silently
const RANGE_MAX = 12;
const TAG = GROUP;
const letters = n => { let s = ''; n += 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(97 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

/** The refs of a bracket's content, or null when it holds anything else. */
function parseGroup(inner) {
  const refs = [];
  let last = 0;
  const seps = [];
  for (const m of inner.matchAll(REF)) {
    seps.push(inner.slice(last, m.index));
    refs.push({ num: Number(m[1]), key: m[2] ? m[2].toLowerCase() : null, raw: m[0] });
    last = m.index + m[0].length;
  }
  if (!refs.length || inner.slice(last).trim() || seps[0].trim()) return null;
  const out = [];
  for (let i = 0; i < refs.length; i++) {
    const sep = seps[i + 1];
    if (i + 1 < refs.length && RANGE_SEP.test(sep)) { out.push({ range: [refs[i], refs[i + 1]] }); i++; if (i + 1 < refs.length && !LIST_SEP.test(seps[i + 1])) return null; continue; }
    if (i + 1 < refs.length && !LIST_SEP.test(sep)) return null;
    out.push({ ref: refs[i] });
  }
  return out;
}

/**
 * The answer with each id (or list, or range) replaced by a placeholder the
 * mechanical checks ignore (letters only, no figure), and what each stands
 * for. Text the document itself contains ("[S2]") is left as it is.
 * { text, quotes: [{ mark, id, written, status, text?, kind?, row? }], refs: [...] }
 * One entry per id; status:
 *   'quoted'          - an id this document issued: its source is quoted;
 *   'unknown_id'      - this document has no such line;
 *   'other_document'  - the key is not this document's;
 *   'no_key'          - written without the document key;
 *   'range_too_long'  - a range longer than RANGE_MAX: named, not opened;
 *   'unrecognised'    - an id-like part of a bracket that is not a reference list.
 */
function placeQuotes(answer, sources, { sourceText = '', rangeMax = RANGE_MAX } = {}) {
  const byId = new Map(sources.items.filter(Boolean).map(x => [x.id, x]));
  const quotes = [];
  const refs = [];
  const src = String(sourceText || '');
  const one = (num, key, written) => {
    const id = `S${num}`;
    let status;
    if (!key) status = 'no_key';
    else if (key !== sources.key) status = 'other_document';
    else if (!byId.has(id)) status = 'unknown_id';
    else status = 'quoted';
    const it = status === 'quoted' ? byId.get(id) : null;
    return { id, written, status, ...(it ? { text: it.text, kind: it.kind, ...(it.row ? { row: it.row } : {}) } : {}) };
  };
  const text = String(answer || '').replace(GROUP, (m) => {
    if (src && src.includes(m)) return m;
    const mark = `⟪iqtibos ${letters(refs.length)}⟫`;
    const inner = m.slice(1, -1);
    const parts = parseGroup(inner);
    const entries = [];
    if (!parts) {
      // not a reference list: its id-like parts are taken out (never read as
      // figures), the rest of the bracket stays for the checks
      const rest = inner.replace(REF, (r) => { entries.push({ id: r.replace(/\s+/gu, ''), written: r, status: 'unrecognised' }); return ''; }).replace(/\s{2,}/gu, ' ').trim();
      refs.push({ mark, written: m, entries });
      quotes.push(...entries.map(e => ({ ...e, mark })));
      return rest ? `${mark} [${rest}]` : mark;
    }
    for (const p of parts) {
      if (p.ref) { entries.push(one(p.ref.num, p.ref.key, p.ref.raw)); continue; }
      const [a, b] = p.range;
      const keys = [...new Set([a.key, b.key].filter(Boolean))];
      const key = keys.length === 1 ? keys[0] : keys.length ? '\u0000' : null;
      const span = b.num - a.num + 1;
      const written = `${a.raw}–${b.raw}`;
      if (span < 1 || span > rangeMax) {
        entries.push({ id: `S${a.num}–S${b.num}`, written, status: span < 1 ? 'unknown_id' : 'range_too_long', span });
        continue;
      }
      for (let n = a.num; n <= b.num; n++) entries.push({ ...one(n, key === '\u0000' ? 'mixed' : key, written), range: written });
    }
    refs.push({ mark, written: m, entries });
    quotes.push(...entries.map(e => ({ ...e, mark })));
    return mark;
  });
  return { text, quotes, refs };
}

const STATUS_NOTE = {
  unknown_id: "bu hujjatda bunday manba qatori yo'q",
  other_document: 'identifikator bu hujjatga tegishli emas',
  no_key: "identifikator hujjat kalitisiz yozilgan",
  range_too_long: `oraliq ${RANGE_MAX} tadan uzun — iqtiboslar ochilmadi`,
  unrecognised: "noto'g'ri yoki tanilmagan havola",
};

/**
 * The reply with the placeholders turned into quotes: the ids stay where the
 * model put them, each source goes on its own line under that line; a
 * refused id is named as refused. Each source is quoted once per answer.
 * A table row is quoted whole, with its headers ("hujjat jadvalidan aynan qator").
 */
function renderQuotes(reply, quotes, refs = null) {
  if (!quotes.length) return reply;
  const groups = refs || [...new Set(quotes.map(q => q.mark))].map(mark => ({ mark, entries: quotes.filter(q => q.mark === mark) }));
  const shown = new Set();
  return String(reply).split('\n').map((line) => {
    const here = groups.filter(g => line.includes(g.mark));
    if (!here.length) return line;
    let out = line;
    const blocks = [];
    for (const g of here) {
      const labels = g.entries.map(e => (e.status === 'quoted' ? e.id : `${e.id}: manba ko'rsatilmadi — ${STATUS_NOTE[e.status]}`));
      out = out.replace(g.mark, labels.length ? `[${labels.join(', ')}]` : '');
      for (const e of g.entries) {
        if (e.status !== 'quoted' || shown.has(e.id)) continue;
        shown.add(e.id);
        blocks.push(e.kind === 'table_row'
          ? `> «${e.text}» — hujjat jadvalidan aynan qator (${e.id})`
          : `> «${e.text}» — hujjat matnidan aynan parcha (${e.id})`);
      }
    }
    return blocks.length ? `${out}\n${blocks.join('\n')}` : out;
  }).join('\n');
}

/**
 * Which ids the answer used, for the diagnostics: issued, used (and how
 * often), used more than once, refused (with why), not processed (an
 * unrecognised reference) and never used. A count of what the server could
 * open - never a judgement that the explanation beside an id is right.
 */
function quoteUsage(placed, sources) {
  const issued = sources.items.filter(Boolean).map(x => x.id).filter((id, i, a) => a.indexOf(id) === i);
  const used = {};
  for (const q of placed.quotes) if (q.status === 'quoted') used[q.id] = (used[q.id] || 0) + 1;
  return {
    issued,
    used,
    repeated: Object.keys(used).filter(id => used[id] > 1),
    refused: placed.quotes.filter(q => q.status !== 'quoted' && q.status !== 'unrecognised').map(q => ({ id: q.id, status: q.status, written: q.written })),
    unprocessed: placed.quotes.filter(q => q.status === 'unrecognised').map(q => ({ written: q.written })),
    unused: issued.filter(id => !used[id]),
    rangeMax: RANGE_MAX,
    meaning: 'what the server could open; it does not show that the explanation beside an id is about that clause or right',
  };
}

/** The note under the answer: what the quotes are, and are not. */
function quotesNote(quotes, sources) {
  const quoted = new Set(quotes.filter(q => q.status === 'quoted').map(q => q.id));
  const refused = quotes.filter(q => q.status !== 'quoted');
  const parts = [];
  if (quoted.size) parts.push(`${quoted.size} ta joyda hujjatning aynan matni keltirildi: server parchani hujjatda belgilar bo'yicha topdi, xolos — identifikator to'g'ri ochilgani yonidagi izoh aynan shu bandga tegishli ekanini ham, to'g'ri ekanini ham tasdiqlamaydi (izoh boshqa bandni nazarda tutgan yoki subyekt, shart yoki oqibatni boshqacha aytgan bo'lishi mumkin; uni iqtibos bilan solishtiring)`);
  if (refused.length) parts.push(`${refused.length} ta havola ochilmadi (${refused.map(q => `${q.id}: ${STATUS_NOTE[q.status]}`).join('; ')}) — ular uchun manba ko'rsatilmadi`);
  if (sources && sources.notInSource) parts.push(`${sources.notInSource} ta kalit qator hujjatda aynan topilmadi va manba sifatida berilmadi`);
  return parts.length ? `Iqtiboslar (AI emas): ${parts.join('; ')}.` : '';
}

module.exports = { docKey, buildSources, placeQuotes, renderQuotes, quotesNote, quoteUsage, parseRow, rowText, TAG, RANGE_MAX };
