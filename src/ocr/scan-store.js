'use strict';

/**
 * OCR results of scanned documents, kept per account and file (2026-10-06).
 *
 *   - The key is (account, SHA-256 of the file's bytes): the analysis and the
 *     opinion of one scan reuse its text - OCR is paid once. Never shared
 *     between accounts, whatever the file.
 *   - The text is not sent to the browser. A client refers to it by scanId;
 *     the document endpoints (analysis, explanation, opinion, chat) load it
 *     here for the session's own account - so OCR cannot be used to pull raw
 *     text out of the service without running a service.
 *   - Since 2026-10-29 ("Hujjatlarim", migration 029) every document the
 *     person uploads - a scan or a text Word/PDF - is kept until they delete
 *     it (library); older rows are the 7-day cache. The text is sealed at
 *     rest with src/privacy/crypto.js when DATA_KEYS is set.
 */

const crypto = require('crypto');
const privacy = require('../privacy/crypto');

const RETENTION_DAYS = 7;
const MAX_SCANS_PER_REQUEST = 5;
// "Hujjatlarim" (2026-10-29, migration 029): every upload is kept until the
// person deletes it; a cap keeps one account from filling the database
const LIBRARY_MAX = () => Number(process.env.DOC_LIBRARY_MAX) || 500;

function fileHash(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// the text is sealed at rest (data protection E2); the AAD is the row's own
// key, so a sealed text copied to another account or file does not open
const textAad = (adminId, hash) => `document_scans.text:${adminId}:${hash}`;
function opened(row) {
  if (!row) return null;
  return { ...row, text: privacy.open(row.text, textAad(row.admin_id, row.file_hash)) };
}

async function findScan(db, { adminId, fileHash: hash }) {
  const r = await db.query(
    `SELECT * FROM document_scans WHERE admin_id = $1 AND file_hash = $2 AND expires_at > now()`, [adminId, hash]);
  return opened(r.rows[0]);
}

async function getScan(db, { adminId, scanId }) {
  if (!/^[0-9a-f-]{36}$/iu.test(String(scanId || ''))) return null;
  const r = await db.query(
    `SELECT * FROM document_scans WHERE id = $1 AND admin_id = $2 AND expires_at > now()`, [scanId, adminId]);
  return opened(r.rows[0]);
}

/**
 * Save a document's text for this account. library (default): kept until the
 * person deletes it - unless the library is full, then the 7-day cache.
 * chars: the billable size when the caller measured it (Word: without the
 * table reader's markup); else the text's length.
 */
async function saveScan(db, { adminId, fileHash: hash, kind, pages, bytes, text, provider, requestId = null, name = null, chars = null, library = true }) {
  let keep = !!library;
  if (keep) {
    const n = (await db.query('SELECT count(*)::int AS n FROM document_scans WHERE admin_id = $1 AND library AND file_hash <> $2', [adminId, hash])).rows[0].n;
    if (n >= LIBRARY_MAX()) keep = false;
  }
  const r = await db.query(
    `INSERT INTO document_scans (admin_id, file_hash, kind, pages, bytes, text, chars, provider, request_id, expires_at, name, library)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $12 THEN 'infinity'::timestamptz ELSE now() + ($10 || ' days')::interval END, $11, $12)
     ON CONFLICT (admin_id, file_hash) DO UPDATE
        SET text = EXCLUDED.text, chars = EXCLUDED.chars, pages = EXCLUDED.pages, provider = COALESCE(EXCLUDED.provider, document_scans.provider),
            request_id = EXCLUDED.request_id, name = COALESCE(document_scans.name, EXCLUDED.name),
            library = document_scans.library OR EXCLUDED.library,
            -- a scan a matter holds keeps its longer life (src/matters/store.js); a library row never shortens
            expires_at = GREATEST(document_scans.expires_at, EXCLUDED.expires_at)
     RETURNING *`,
    [adminId, hash, kind, pages, bytes, privacy.seal(text, textAad(adminId, hash)), chars != null ? chars : text.length, provider || null, requestId,
      String(RETENTION_DAYS), name ? String(name).slice(0, 200) : null, keep]);
  return { ...opened(r.rows[0]), libraryFull: library && !keep };
}

async function purgeExpired(db) {
  await db.query(`DELETE FROM document_scans WHERE expires_at <= now() AND NOT library`);
}

/** The person's library, newest first (no text). */
async function listLibrary(db, { adminId }) {
  const r = await db.query(
    `SELECT id, name, kind, pages, chars, bytes, created_at, last_used_at FROM document_scans
      WHERE admin_id = $1 AND library ORDER BY COALESCE(last_used_at, created_at) DESC LIMIT 1000`, [adminId]);
  // sealed: whether texts are encrypted at rest now (the page says "encrypted" only then)
  return { documents: r.rows, max: LIBRARY_MAX(), sealed: privacy.enabled() };
}

async function renameDoc(db, { adminId, id, name }) {
  const n = String(name || '').trim().slice(0, 200);
  if (!n || !/^[0-9a-f-]{36}$/iu.test(String(id || ''))) return false;
  const r = await db.query('UPDATE document_scans SET name = $3 WHERE id = $1 AND admin_id = $2 AND library RETURNING id', [id, adminId, n]);
  return r.rowCount > 0;
}

/** Deleted for good (text and all); a matter that linked it shows it as no longer available. */
async function deleteDoc(db, { adminId, id }) {
  if (!/^[0-9a-f-]{36}$/iu.test(String(id || ''))) return false;
  const r = await db.query('DELETE FROM document_scans WHERE id = $1 AND admin_id = $2 RETURNING id', [id, adminId]);
  return r.rowCount > 0;
}

/**
 * Express middleware for the document endpoints: body.scanId (one scan) or
 * body.scanIds ([{ id, name }] or ids, at most 5) are read for the session's
 * account and put into body.documentText the way the client joins documents
 * ("【name】\ntext"); a single scan gets a page ticket so its units follow its
 * real pages. req.scans = the rows. An id that is not this account's (or
 * has expired) is refused, never silently skipped.
 */
function resolveScans({ pool, ledger }) {
  return async (req, res, next) => {
    const b = req.body || {};
    const raw = b.scanIds != null ? b.scanIds : (b.scanId != null ? [b.scanId] : null);
    if (!raw) return next();
    try {
      const list = (Array.isArray(raw) ? raw : [raw]).map(x => (typeof x === 'object' && x ? { id: x.id, name: x.name } : { id: x, name: null }));
      if (!list.length || list.length > MAX_SCANS_PER_REQUEST) return res.status(400).json({ error: 'scan_ids', message: `Bir so'rovda ko'pi bilan ${MAX_SCANS_PER_REQUEST} ta skan hujjat.` });
      const adminId = req.session && req.session.adminId;
      if (!adminId) return res.status(401).json({ error: 'Unauthorized' });
      const rows = [];
      for (const item of list) {
        const row = await getScan(pool, { adminId, scanId: item.id });
        if (!row) return res.status(404).json({ error: 'scan_not_found', code: 'SCAN_NOT_FOUND', message: "Skan hujjat topilmadi yoki muddati o'tgan — uni qayta yuklang." });
        rows.push({ ...row, displayName: item.name || 'Skan hujjat' });
      }
      const typed = typeof b.documentText === 'string' ? b.documentText.trim() : '';
      // a library document is being used: the list sorts by it
      pool.query('UPDATE document_scans SET last_used_at = now() WHERE id = ANY($1) AND admin_id = $2', [rows.map(r => r.id), adminId]).catch(() => {});
      if (rows.length === 1 && !typed) {
        b.documentText = rows[0].text;
        // a text document is billed like the upload that made it (its pages and measured size); a scan by its pages
        b.docTicket = rows[0].kind === 'text'
          ? ledger.signDocTicket({ text: rows[0].text, pages: rows[0].pages, chars: rows[0].chars })
          : ledger.signDocTicket({ text: rows[0].text, pages: rows[0].pages, scanned: true });
      } else {
        const parts = rows.map(r => `【${r.displayName}】\n${r.text}`);
        b.documentText = [typed, ...parts].filter(Boolean).join('\n\n');
        b.docTicket = null;
      }
      req.scans = rows;
      next();
    } catch (err) {
      console.error('[SCAN] resolve failed:', err.message);
      if (!res.headersSent) res.status(503).json({ error: 'scan_unavailable', message: "Skan hujjatni o'qib bo'lmadi, birozdan so'ng urinib ko'ring." });
    }
  };
}

module.exports = { RETENTION_DAYS, MAX_SCANS_PER_REQUEST, LIBRARY_MAX, textAad, fileHash, findScan, getScan, saveScan, purgeExpired, listLibrary, renameDoc, deleteDoc, resolveScans };
