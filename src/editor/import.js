'use strict';

/**
 * Opening a file in the editor (D1, docs/design/hujjat-muharriri.md §2.4):
 * a Word file keeps its headings, paragraphs, bold / italic / underline,
 * lists, tables and links (mammoth's HTML, then src/editor/sanitize.js); a
 * text PDF and a library document come in as paragraphs (a PDF has no
 * structure to keep). What could not be kept is named - never silently
 * lost: Word headers / footers, footnotes, comments, tracked changes and
 * pictures; a scan has no text layer and is refused (OCR it in Hujjatlarim
 * first). Notes are codes; the page words them.
 */

const crypto = require('crypto');
const cheerio = require('cheerio');
const JSZip = require('jszip');
const { cleanHtml, textToHtml } = require('./sanitize');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// mammoth drops a paragraph's alignment (a centred title, a justified clause): each aligned paragraph is
// marked with an invisible token on the way in and the token becomes text-align on its block on the way out
const MARK = '\u2063JAIALIGN:';
const ALIGN = { center: 'center', right: 'right', both: 'justify', distribute: 'justify', end: 'right' };
function markAlignment(doc) {
  const documents = require('mammoth/lib/documents');
  return require('mammoth').transforms.paragraph((p) => {
    const a = ALIGN[String(p.alignment || '').toLowerCase()];
    if (!a) return p;
    return { ...p, children: [documents.run([documents.text(`${MARK}${a}\u2063`)]), ...p.children] };
  })(doc);
}
function applyAlignment(html) {
  return String(html)
    .replace(/<(p|h[1-6]|li)>((?:<(?:strong|em|u|s|a)[^>]*>)*)\u2063JAIALIGN:(center|right|justify)\u2063/gu, '<$1 style="text-align: $3">$2')
    .replace(/\u2063JAIALIGN:[a-z]+\u2063/gu, '');
}

// Word comments (D2): each commentRangeStart / End becomes an invisible marker run before mammoth reads the file;
// the markers then become <span data-comment="<new id>"> around every piece of text between them, and
// comments.xml (+ commentsExtended.xml: replies and "done") gives the text, author and date.
const unxml = s => String(s).replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&amp;/gu, '&');
const attr = (tag, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`, 'u').exec(tag); return m ? unxml(m[1]) : null; };

async function wordComments(zip) {
  const f = zip.file('word/comments.xml');
  if (!f) return null;
  const xmlText = await f.async('string');
  const list = [];
  for (const m of xmlText.matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/gu)) {
    const paras = [...m[2].matchAll(/<w:p\b([^>]*)>([\s\S]*?)<\/w:p>/gu)];
    const text = paras.map(p => [...p[2].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gu)].map(t => unxml(t[1])).join('')).join('\n').trim();
    const last = paras.length ? attr(paras[paras.length - 1][1], 'w14:paraId') : null;
    list.push({ wid: attr(m[1], 'w:id'), author: attr(m[1], 'w:author'), date: attr(m[1], 'w:date'), text, paraId: last, id: crypto.randomUUID() });
  }
  const ext = new Map();
  const e = zip.file('word/commentsExtended.xml');
  if (e) for (const m of (await e.async('string')).matchAll(/<w15:commentEx\b([^>]*)\/>/gu)) ext.set(attr(m[1], 'w15:paraId'), { parent: attr(m[1], 'w15:paraIdParent'), done: attr(m[1], 'w15:done') === '1' });
  const byPara = new Map(list.filter(c => c.paraId).map(c => [c.paraId, c]));
  for (const c of list) {
    const x = c.paraId ? ext.get(c.paraId) : null;
    if (x && x.parent && byPara.get(x.parent)) c.parentId = byPara.get(x.parent).id;
    c.resolved = !!(x && x.done);
  }
  return list;
}

function markCommentRanges(docXml) {
  const run = (k, id) => `<w:r><w:t xml:space="preserve">\u2063JAIC${k}:${id}\u2063</w:t></w:r>`;
  return docXml
    .replace(/<w:commentRangeStart\b[^>]*?w:id="(\d+)"[^>]*\/>/gu, (_, id) => run('S', id))
    .replace(/<w:commentRangeEnd\b[^>]*?w:id="(\d+)"[^>]*\/>/gu, (_, id) => run('E', id));
}

/** Markers -> anchors around every text piece in the range; each top-level comment gets its quote. */
function applyCommentRanges(html, comments) {
  const byWid = new Map(comments.filter(c => !c.parentId).map(c => [c.wid, c]));
  const $ = cheerio.load(`<div id="__r">${html}</div>`, { decodeEntities: false });
  const texts = [];
  (function walk(node) { for (const ch of node.children || []) { if (ch.type === 'text') texts.push(ch); else walk(ch); } })($('#__r')[0]);
  const active = [];
  for (const t of texts) {
    if (!/\u2063JAIC|\S/u.test(t.data) && !active.length) continue;
    const parts = String(t.data).split(/\u2063JAIC([SE]):(\d+)\u2063/u);
    let out = '';
    for (let i = 0; i < parts.length; i += 3) {
      const seg = parts[i];
      if (seg) {
        let piece = seg;
        for (const c of [...active].reverse()) { piece = `<span data-comment="${c.id}">${piece}</span>`; c.quote = (c.quote || '') + seg; }
        out += piece;
      }
      if (i + 1 < parts.length) {
        const c = byWid.get(parts[i + 2]);
        if (c && parts[i + 1] === 'S' && !active.includes(c)) active.push(c);
        if (c && parts[i + 1] === 'E') active.splice(active.indexOf(c) >>> 0, active.includes(c) ? 1 : 0);
      }
    }
    if (out !== t.data) $(t).replaceWith(out);
  }
  return $('#__r').html() || '';
}

/** What a .docx holds that the editor does not keep (codes). */
async function docxNotes(buf) {
  const notes = [];
  require('../ocr/upload-guard').assertZipSafe(buf);
  try {
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files);
    if (names.some(n => /^word\/(header|footer)\d*\.xml$/u.test(n))) notes.push('header_footer');
    const body = zip.file('word/document.xml') ? await zip.file('word/document.xml').async('string') : '';
    if (zip.file('word/footnotes.xml') && /<w:footnoteReference\b/u.test(body)) notes.push('footnotes');
    if (/<w:commentReference\b/u.test(body)) notes.push('comments');
    if (/<w:(ins|del)\b/u.test(body)) notes.push('tracked_changes');
    if (/<w:drawing\b|<w:pict\b/u.test(body)) notes.push('images');
  } catch (_) { notes.push('unreadable_parts'); }
  return notes;
}

/**
 * A file -> { html, notes, kind } or { error } (unsupported, scanned, corrupt).
 * extractFileText: src/ocr/routes.js (PDF text with page marks).
 */
async function importFile(buf, { fileName = '', mimeType = '', extractFileText }) {
  const name = String(fileName || '').toLowerCase();
  const isDocx = /\.docx$/u.test(name) || mimeType === DOCX_MIME;
  const isPdf = /\.pdf$/u.test(name) || mimeType === 'application/pdf';
  if (isDocx) {
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) return { error: 'corrupt' };
    const mammoth = require('mammoth');
    // the file's comments, if any, ride along as markers (wordComments / applyCommentRanges)
    require('../ocr/upload-guard').assertZipSafe(buf);
    let comments = null, input = buf;
    try {
      const zip = await JSZip.loadAsync(buf);
      comments = await wordComments(zip);
      if (comments && comments.length) {
        zip.file('word/document.xml', markCommentRanges(await zip.file('word/document.xml').async('string')));
        input = await zip.generateAsync({ type: 'nodebuffer' });
      }
    } catch (_) { comments = null; input = buf; }
    const r = await mammoth.convertToHtml({ buffer: input }, {
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"],
      ignoreEmptyParagraphs: false,
      convertImage: mammoth.images.imgElement(() => ({ src: '' })), // pictures are not kept (named below)
      transformDocument: markAlignment,
    });
    let body = applyAlignment(r.value);
    if (comments && comments.length) body = applyCommentRanges(body, comments);
    body = body.replace(/\u2063JAIC[SE]:\d+\u2063/gu, '');
    const html = cleanHtml(body);
    if (!html.replace(/<[^>]+>/gu, '').trim()) return { error: 'scanned' };
    // imported comments are kept now (D2): "comments" is named only when they could not be read
    const notes = (await docxNotes(buf)).filter(n => n !== 'comments' || !comments);
    return { kind: 'docx', html, notes, comments: (comments || []).map(c => ({ id: c.id, parentId: c.parentId || null, author: c.author, date: c.date, text: c.text, quote: c.quote || null, resolved: c.resolved })) };
  }
  if (isPdf) {
    const read = await extractFileText(buf, { fileName, mimeType });
    if (read.unsupported) return { error: read.unsupported };
    if (read.scanned) return { error: 'scanned' };
    return { kind: 'pdf', html: textToHtml(read.text), notes: ['pdf_layout'] };
  }
  if (/\.txt$/u.test(name) || mimeType === 'text/plain') return { kind: 'text', html: textToHtml(buf.toString('utf8')), notes: [] };
  return { error: 'type' };
}

module.exports = { importFile, docxNotes, wordComments, markCommentRanges, applyCommentRanges, DOCX_MIME };
