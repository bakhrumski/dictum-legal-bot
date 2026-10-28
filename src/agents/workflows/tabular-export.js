'use strict';

/**
 * Tabular review as an Excel file (2026-10-28, roadmap stage 2), and the
 * row tags the page keeps with a run. No AI, no network, nothing stored:
 * the workbook is built from the table the person already has.
 *
 *   Jadval       one row per document: name, tags, status, one column per question
 *   Iqtiboslar   one row per answered cell: the quote, its page, whether it was found
 *   Izoh         what a found quote means (the words are there - not that the answer is right)
 *
 * Every value is written as text (`t: 's'`), so a cell that starts with
 * "=", "+", "-" or "@" is never read as a formula.
 */

const XLSX = require('xlsx');

const LIMITS = Object.freeze({ rows: 200, columns: 10, tagsPerRow: 8, tagChars: 40, cellChars: 2000 });

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/gu, ' ').trim().slice(0, max);

/** { docId: [tag, …] } with at most 8 short tags a row, repeats dropped. */
function normTags(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [docId, list] of Object.entries(input).slice(0, LIMITS.rows)) {
    if (!/^d\d{1,3}$/u.test(docId) || !Array.isArray(list)) continue;
    const tags = [...new Set(list.map(t => clean(t, LIMITS.tagChars)).filter(Boolean))].slice(0, LIMITS.tagsPerRow);
    if (tags.length) out[docId] = tags;
  }
  return out;
}

const STATUS = (row) => (row.status === 'ok' ? (row.excerpt ? "o'qildi (mos qismlar)" : "o'qildi") : 'xato');
const CHECK = (cell) => (cell.notFound ? 'javob topilmadi' : (cell.verified ? 'iqtibos hujjatda bor' : 'iqtibos topilmadi'));

const text = v => ({ t: 's', v: clean(v, LIMITS.cellChars) });

function sheetOf(aoa, widths) {
  const ws = XLSX.utils.aoa_to_sheet(aoa.map(r => r.map(text)));
  ws['!cols'] = widths.map(wch => ({ wch }));
  if (aoa.length > 1) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: aoa[0].length - 1 } }) };
  return ws;
}

/** The workbook as a Buffer. columns: [{ id, label }], rows: the route's rows, tags: { docId: [..] }. */
function buildWorkbook({ columns = [], rows = [], tags = {} } = {}) {
  const cols = (Array.isArray(columns) ? columns : []).slice(0, LIMITS.columns).filter(c => c && /^c\d{1,2}$/u.test(String(c.id)));
  const list = (Array.isArray(rows) ? rows : []).slice(0, LIMITS.rows).filter(r => r && typeof r === 'object');
  const t = normTags(tags);
  const cellOf = (r, c) => (r.cells && r.cells[c.id]) || null;

  const table = [['№', 'Hujjat', 'Teglar', 'Holat', ...cols.map(c => clean(c.label, 200))]];
  list.forEach((r, i) => table.push([String(i + 1), r.name, (t[r.docId] || []).join(', '), STATUS(r),
    ...cols.map((c) => { const cell = cellOf(r, c); return r.status === 'ok' && cell ? cell.answer : (r.error ? `xato: ${r.error}` : ''); })]));

  const quotes = [['Hujjat', 'Savol', 'Javob', 'Iqtibos (hujjat so\'zlari)', 'Sahifa', 'Tekshiruv']];
  for (const r of list) {
    if (r.status !== 'ok') continue;
    for (const c of cols) {
      const cell = cellOf(r, c);
      if (!cell || cell.notFound) continue;
      quotes.push([r.name, c.label, cell.answer, cell.quote, cell.page == null ? '' : String(cell.page), CHECK(cell)]);
    }
  }

  const note = [['Izoh'],
    ["Har bir javob hujjatning o'z matnidan olingan. \"Iqtibos hujjatda bor\" - iqtibos so'zlari hujjatda so'zma-so'z topilgani; javobning to'g'riligini bildirmaydi."],
    ["\"Iqtibos topilmadi\" - javob saqlangan, lekin uning asosi hujjatda so'zma-so'z topilmadi: qo'lda tekshiring."],
    ["\"o'qildi (mos qismlar)\" - uzun hujjatdan savollarga mos bandlar o'qildi, butun hujjat emas."],
    [`Tuzilgan: ${new Date().toISOString().slice(0, 10)} · JuristAI`]];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetOf(table, [5, 32, 22, 18, ...cols.map(() => 32)]), 'Jadval');
  XLSX.utils.book_append_sheet(wb, sheetOf(quotes, [30, 30, 30, 60, 8, 20]), 'Iqtiboslar');
  XLSX.utils.book_append_sheet(wb, sheetOf(note, [110]), 'Izoh');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
}

module.exports = { buildWorkbook, normTags, LIMITS };
