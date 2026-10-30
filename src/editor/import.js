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

/** What a .docx holds that the editor does not keep (codes). */
async function docxNotes(buf) {
  const notes = [];
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
    const r = await mammoth.convertToHtml({ buffer: buf }, {
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"],
      ignoreEmptyParagraphs: false,
      convertImage: mammoth.images.imgElement(() => ({ src: '' })), // pictures are not kept (named below)
      transformDocument: markAlignment,
    });
    const html = cleanHtml(applyAlignment(r.value));
    if (!html.replace(/<[^>]+>/gu, '').trim()) return { error: 'scanned' };
    return { kind: 'docx', html, notes: await docxNotes(buf) };
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

module.exports = { importFile, docxNotes, DOCX_MIME };
