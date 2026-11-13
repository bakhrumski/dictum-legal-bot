'use strict';

/**
 * X2 of the 2026-11-10 audit (S11): an uploaded Word or PDF file is opened by
 * a parser in this process (512 MB on the live instance), so a small file
 * that unpacks into a huge one could take the server down.
 *
 *   - a .docx is a ZIP: before any parser opens it, the sizes its own
 *     directory declares are added up (no inflating) - more than
 *     UPLOAD_ZIP_MAX_MB (150) unpacked, more than 5 000 entries, or one entry
 *     over 100 MB is refused (413). A directory that lies about its sizes is
 *     caught by the unzipper's own size check when it inflates;
 *   - a PDF is parsed for at most UPLOAD_PDF_MAX_PAGES (1 500) pages and a
 *     longer one is refused (413) - never read in part: no service takes a
 *     document that long, and a silently cut text would break "never cut".
 */

const ZIP_MAX_BYTES = () => Math.max(10, Number(process.env.UPLOAD_ZIP_MAX_MB) || 150) * 1024 * 1024;
const ZIP_MAX_ENTRY = 100 * 1024 * 1024;
const ZIP_MAX_ENTRIES = 5000;
const PDF_MAX_PAGES = () => Math.max(50, Number(process.env.UPLOAD_PDF_MAX_PAGES) || 1500);

const tooLarge = (message, code) => Object.assign(new Error(message), { status: 413, statusCode: 413, code });

/** What a ZIP's central directory declares: { entries, bytes, maxEntry } - null when it is not a readable ZIP. */
function zipDeclared(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return null;
  // the end-of-central-directory record: within the last 64 KB + 22 bytes
  let at = -1;
  for (let i = buf.length - 22, stop = Math.max(0, buf.length - 22 - 65535); i >= stop; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { at = i; break; }
  }
  if (at < 0) return null;
  const count = buf.readUInt16LE(at + 10), dirSize = buf.readUInt32LE(at + 12), dirAt = buf.readUInt32LE(at + 16);
  if (dirAt + dirSize > buf.length) return null;
  let p = dirAt, entries = 0, bytes = 0, maxEntry = 0;
  while (p + 46 <= dirAt + dirSize && buf.readUInt32LE(p) === 0x02014b50) {
    const size = buf.readUInt32LE(p + 24);
    entries++; bytes += size; if (size > maxEntry) maxEntry = size;
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return { entries, bytes, maxEntry, declared: count };
}

/** Refuse a .docx (any ZIP) that would unpack into more than the limits. Not a ZIP: left to the parser's own error. */
function assertZipSafe(buf) {
  const z = zipDeclared(buf);
  if (!z) return;
  if (z.entries > ZIP_MAX_ENTRIES || z.declared > ZIP_MAX_ENTRIES || z.bytes > ZIP_MAX_BYTES() || z.maxEntry > ZIP_MAX_ENTRY) {
    throw tooLarge('Fayl ochilganda juda katta bo‘ladi - qabul qilinmadi.', 'ARCHIVE_TOO_LARGE');
  }
}

/** pdf-parse with the page limit: a PDF over PDF_MAX_PAGES is refused, never read in part. */
async function parsePdf(data, options = {}, { lib = 'pdf-parse/lib/pdf-parse.js' } = {}) {
  const max = PDF_MAX_PAGES();
  const parsed = await require(lib)(data, { ...options, max });
  if ((Number(parsed.numpages) || 0) > max) throw tooLarge(`PDF juda uzun (${parsed.numpages} sahifa; ko‘pi bilan ${max}).`, 'PDF_TOO_LONG');
  return parsed;
}

module.exports = { zipDeclared, assertZipSafe, parsePdf, PDF_MAX_PAGES, ZIP_MAX_BYTES, ZIP_MAX_ENTRIES };
