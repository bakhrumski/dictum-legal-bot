'use strict';

/**
 * DOCX text with its tables kept as tables (2026-10-08, a production run:
 * mammoth's raw text puts every table cell on its own line, so a value, a
 * criterion or a deadline lost the row and column it belonged to, and the
 * digest tied it to another row).
 *
 * A document with no table is read by mammoth exactly as before. A document
 * with tables is read from word/document.xml in body order: paragraphs as
 * lines, and each table as one line per row:
 *
 *   ⟦Jadval 2 · sarlavha⟧ № ¦ Bajariladigan ish ¦ Muddat
 *   ⟦Jadval 2 · 4-qator · Sotuv jarayoni⟧ ⟨№⟩ 5 ¦ ⟨Bajariladigan ish⟩ … ¦ ⟨Muddat⟩ 2027-yil, mart
 *
 * ⟦…⟧ (row id, with the section row above it) and ⟨…⟩ (the column's header,
 * a value merged down from the row above, an empty cell) are added by the
 * system; ` ¦ ` separates cells. They are never the customer's text: the
 * billable size is the text without them (contentChars), computed here on
 * the server and signed into the document ticket - a size the client sends
 * is never trusted. Horizontally merged cells (gridSpan) are one value under
 * the joined headers; vertically merged ones (vMerge) repeat the value above
 * as ⟨↑ …⟩; header rows (w:tblHeader, else the first row) may be several,
 * their labels joined top / bottom; an empty cell is ⟨bo'sh⟩.
 *
 * Safety net: if the text this reader gets (without the markup) is much
 * shorter than mammoth's, mammoth's text is used and the reason returned -
 * text is never lost to the table reader.
 */

const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const kids = (el, name) => Array.from(el.childNodes || []).filter(n => n.nodeType === 1 && n.localName === name && n.namespaceURI === W);
const kid = (el, name) => kids(el, name)[0] || null;
const attr = (el, name) => (el ? el.getAttributeNS(W, name) || el.getAttribute(`w:${name}`) || '' : '');

/** The text of a paragraph: w:t, tabs and breaks, in order (deleted text left out). */
function paragraphText(p) {
  let out = '';
  const walk = (n) => {
    for (const c of Array.from(n.childNodes || [])) {
      if (c.nodeType !== 1) continue;
      if (c.namespaceURI === W) {
        if (c.localName === 't') { out += c.textContent; continue; }
        if (c.localName === 'tab') { out += '\t'; continue; }
        if (c.localName === 'br' || c.localName === 'cr') { out += '\n'; continue; }
        if (c.localName === 'delText' || c.localName === 'del' || c.localName === 'instrText') continue;
      }
      walk(c);
    }
  };
  walk(p);
  return out;
}

/** A cell's text: its paragraphs (and any nested table's) joined with "; ". */
function cellText(tc) {
  const parts = [];
  const walk = (n) => {
    for (const c of Array.from(n.childNodes || [])) {
      if (c.nodeType !== 1 || c.namespaceURI !== W) { if (c.nodeType === 1) walk(c); continue; }
      if (c.localName === 'p') { const t = paragraphText(c).replace(/\s+/gu, ' ').trim(); if (t) parts.push(t); }
      else if (c.localName !== 'tcPr') walk(c);
    }
  };
  walk(tc);
  return parts.join('; ');
}

const clean = s => String(s || '').replace(/[⟦⟧⟨⟩¦]/gu, ' ').replace(/\s+/gu, ' ').trim();

/**
 * One table as a grid: rows of cells placed on grid columns, with
 * horizontal spans and vertical merges resolved. Returns
 * { rows: [{ cells: [{ text, col, span, mergedFromAbove }], header }], cols }.
 */
function tableGrid(tbl) {
  const rows = [];
  const above = []; // per grid column: the cell above (for vMerge continue)
  let cols = 0;
  for (const tr of kids(tbl, 'tr')) {
    const trPr = kid(tr, 'trPr');
    const header = !!(trPr && kid(trPr, 'tblHeader'));
    const cells = [];
    let col = 0;
    // w:gridBefore: empty grid columns at the row's start
    if (trPr && kid(trPr, 'gridBefore')) col += Number(attr(kid(trPr, 'gridBefore'), 'val')) || 0;
    for (const tc of kids(tr, 'tc')) {
      const tcPr = kid(tc, 'tcPr');
      const span = Math.max(1, Number(attr(tcPr && kid(tcPr, 'gridSpan'), 'val')) || 1);
      const vm = tcPr && kid(tcPr, 'vMerge');
      const cont = !!vm && attr(vm, 'val') !== 'restart';
      let text = clean(cellText(tc));
      let mergedFromAbove = false;
      if (cont && above[col]) { text = above[col].text; mergedFromAbove = true; }
      const cell = { text, col, span, mergedFromAbove };
      cells.push(cell);
      for (let k = 0; k < span; k++) above[col + k] = cont && above[col + k] ? above[col + k] : cell;
      col += span;
    }
    cols = Math.max(cols, col);
    rows.push({ cells, header });
  }
  return { rows, cols };
}

/**
 * The lines of one table: header rows (marked w:tblHeader; else the first
 * row of a table of 2+ rows), then one line per data row with each value
 * after its column's header. A row with a single cell over the whole width
 * is a section title: it is its own line and names the rows under it.
 */
function tableLines(grid, n) {
  const { rows, cols } = grid;
  if (!rows.length) return [];
  let headCount = 0;
  while (headCount < rows.length && rows[headCount].header) headCount++;
  if (!headCount && rows.length > 1) headCount = 1;
  // the label of each grid column: header rows joined top / bottom
  const labels = Array.from({ length: cols }, () => []);
  for (const r of rows.slice(0, headCount)) {
    for (const c of r.cells) for (let k = 0; k < c.span; k++) {
      const l = labels[c.col + k];
      if (c.text && l[l.length - 1] !== c.text) l.push(c.text);
    }
  }
  const labelOf = (c) => {
    const ls = [];
    for (let k = 0; k < c.span; k++) { const l = labels[c.col + k].join(' / '); if (l && !ls.includes(l)) ls.push(l); }
    return clean(ls.join(' + ')) || `${c.col + 1}-ustun`;
  };
  const out = [];
  if (headCount) {
    out.push(`⟦Jadval ${n} · sarlavha⟧ ${rows.slice(0, headCount).map(r => r.cells.map(c => c.text || '⟨bo\'sh⟩').join(' ¦ ')).join(' ⟨/⟩ ')}`);
  }
  let section = '';
  let rowNo = 0;
  for (const r of rows.slice(headCount)) {
    const filled = r.cells.filter(c => c.text);
    // a section title: one cell across the table (or the only filled one)
    if (cols > 1 && (r.cells.length === 1 && r.cells[0].span >= cols)) {
      section = r.cells[0].text;
      out.push(`⟦Jadval ${n} · bo'lim⟧ ${section}`);
      continue;
    }
    rowNo++;
    const cellsOut = r.cells.map(c => {
      const value = c.mergedFromAbove ? `⟨↑ ${c.text}⟩` : (c.text || '⟨bo\'sh⟩');
      return `⟨${labelOf(c)}⟩ ${value}`;
    });
    out.push(`⟦Jadval ${n} · ${rowNo}-qator${section ? ` · ${clean(section)}` : ''}⟧ ${cellsOut.join(' ¦ ')}`);
    if (!filled.length) out[out.length - 1] += ' ⟨qator bo\'sh⟩';
  }
  return out;
}

/** The system markup of this reader removed: what the customer's document holds. */
function withoutMarkup(text) {
  return String(text || '').replace(/⟦[^⟧\n]*⟧ ?/gu, '').replace(/⟨[^⟩\n]*⟩ ?/gu, '').replace(/ ¦ /gu, ' ');
}

/** Body children in order: paragraphs, tables, content controls (opened). */
function bodyBlocks(body) {
  const out = [];
  const walk = (el) => {
    for (const c of Array.from(el.childNodes || [])) {
      if (c.nodeType !== 1 || c.namespaceURI !== W) continue;
      if (c.localName === 'p' || c.localName === 'tbl') out.push(c);
      else if (c.localName === 'sdt') { const content = kid(c, 'sdtContent'); if (content) walk(content); }
      else if (c.localName === 'customXml' || c.localName === 'smartTag') walk(c);
    }
  };
  walk(body);
  return out;
}

/** Words of a text (letters and digits), counted - to compare two readings word by word. */
function wordCounts(text) {
  const m = new Map();
  for (const w of String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) m.set(w, (m.get(w) || 0) + 1);
  return m;
}

/**
 * The text of a DOCX buffer. Returns { text, tables, reader, structure,
 * fallbackReason?, wordCheck? }:
 *   reader 'mammoth', structure 'none'  - no table: mammoth, as before;
 *   reader 'tables',  structure 'rows'  - tables read row by row with their
 *                                         headers (mechanical: that the cells
 *                                         were read fully and correctly is not
 *                                         proven - only that no word of the
 *                                         document's own text is missing);
 *   reader 'mammoth', structure 'lost'  - the table reader missed words, so
 *                                         mammoth's text is used: the text is
 *                                         kept, the rows and columns are NOT
 *                                         (each cell is a line of its own).
 * The safety net compares words, not lengths: every word mammoth reads must
 * be in the table reader's text as often (its own markup aside).
 */
async function docxText(buffer, { mammoth = require('mammoth') } = {}) {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file('word/document.xml');
  const raw = async () => String((await mammoth.extractRawText({ buffer })).value || '').trim();
  const plain = async () => ({ text: await raw(), tables: 0, reader: 'mammoth', structure: 'none' });
  if (!file) return plain();
  const xml = await file.async('string');
  if (!/<w:tbl[\s>]/u.test(xml)) return plain();
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  if (!body) return plain();
  const lines = [];
  let n = 0;
  for (const b of bodyBlocks(body)) {
    if (b.localName === 'p') { lines.push(paragraphText(b).trim()); continue; }
    n++;
    lines.push('', ...tableLines(tableGrid(b), n), '');
  }
  const text = lines.join('\n').replace(/\n{3,}/gu, '\n\n').trim();
  // never lose text to this reader: every word mammoth reads must be here
  const mammothText = await raw();
  const ours = wordCounts(withoutMarkup(text));
  let total = 0, missing = 0;
  for (const [w, c] of wordCounts(mammothText)) { total += c; missing += Math.max(0, c - (ours.get(w) || 0)); }
  const wordCheck = { words: total, missing };
  if (missing > 0) {
    return { text: mammothText, tables: n, reader: 'mammoth', structure: 'lost', wordCheck,
      fallbackReason: `the table reader missed ${missing} of ${total} words; mammoth's text is used and the tables' rows and columns are not kept` };
  }
  return { text, tables: n, reader: 'tables', structure: 'rows', wordCheck };
}

module.exports = { docxText, tableGrid, tableLines, withoutMarkup, paragraphText, wordCounts };
