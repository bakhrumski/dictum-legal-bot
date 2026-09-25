'use strict';

/**
 * Text of an uploaded Workspace file, for the version's content_text (Astra
 * audit D1). Without it Workspace AI saw only "[Fayl matni indekslanmagan]"
 * for every upload. Versions are immutable, so the text is read before the
 * version row is written; a slow or unreadable file never blocks the upload,
 * it is stored without text and says so.
 *
 * Covered: PDF with a text layer, DOCX, plain text. Not yet: scans and
 * images (need paid OCR), .doc, .odt, .rtf.
 */

const MAX_CHARS = 200000;
const TIMEOUT_MS = Number(process.env.WORKSPACE_EXTRACT_TIMEOUT_MS) || 20000;

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function clean(text) {
  const t = String(text || '')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t.length > MAX_CHARS ? t.slice(0, MAX_CHARS) : t;
}

async function extractRaw(buffer, mimeType) {
  if (mimeType === 'text/plain') return buffer.toString('utf8');
  if (mimeType === 'application/pdf') {
    const pdfParse = require('pdf-parse');
    return (await pdfParse(buffer)).text;
  }
  if (mimeType === DOCX) {
    const mammoth = require('mammoth');
    return (await mammoth.extractRawText({ buffer })).value;
  }
  return null;
}

/**
 * @returns {Promise<{text: string|null, status: 'indexed'|'empty'|'unsupported'|'failed'}>}
 */
async function extractUploadText(buffer, mimeType) {
  let timer;
  try {
    const raw = await Promise.race([
      extractRaw(buffer, mimeType),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('extract timeout')), TIMEOUT_MS); }),
    ]);
    if (raw == null) return { text: null, status: 'unsupported' };
    const text = clean(raw);
    // A scanned PDF has no text layer; a few stray characters are not text.
    if (text.replace(/\s+/g, '').length < 20) return { text: null, status: 'empty' };
    return { text, status: 'indexed' };
  } catch (err) {
    console.warn('[WORKSPACE] text extraction failed:', err.message);
    return { text: null, status: 'failed' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { extractUploadText, MAX_CHARS };
