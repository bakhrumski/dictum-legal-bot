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
 *   - Kept 7 days, then deleted.
 */

const crypto = require('crypto');

const RETENTION_DAYS = 7;
const MAX_SCANS_PER_REQUEST = 5;

function fileHash(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function findScan(db, { adminId, fileHash: hash }) {
  const r = await db.query(
    `SELECT * FROM document_scans WHERE admin_id = $1 AND file_hash = $2 AND expires_at > now()`, [adminId, hash]);
  return r.rows[0] || null;
}

async function getScan(db, { adminId, scanId }) {
  if (!/^[0-9a-f-]{36}$/iu.test(String(scanId || ''))) return null;
  const r = await db.query(
    `SELECT * FROM document_scans WHERE id = $1 AND admin_id = $2 AND expires_at > now()`, [scanId, adminId]);
  return r.rows[0] || null;
}

async function saveScan(db, { adminId, fileHash: hash, kind, pages, bytes, text, provider, requestId = null }) {
  const r = await db.query(
    `INSERT INTO document_scans (admin_id, file_hash, kind, pages, bytes, text, chars, provider, request_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + ($10 || ' days')::interval)
     ON CONFLICT (admin_id, file_hash) DO UPDATE
        SET text = EXCLUDED.text, chars = EXCLUDED.chars, pages = EXCLUDED.pages, provider = EXCLUDED.provider,
            request_id = EXCLUDED.request_id, expires_at = EXCLUDED.expires_at
     RETURNING *`,
    [adminId, hash, kind, pages, bytes, text, text.length, provider || null, requestId, String(RETENTION_DAYS)]);
  return r.rows[0];
}

async function purgeExpired(db) {
  await db.query(`DELETE FROM document_scans WHERE expires_at <= now()`);
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
      if (rows.length === 1 && !typed) {
        b.documentText = rows[0].text;
        b.docTicket = ledger.signDocTicket({ text: rows[0].text, pages: rows[0].pages, scanned: true });
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

module.exports = { RETENTION_DAYS, MAX_SCANS_PER_REQUEST, fileHash, findScan, getScan, saveScan, purgeExpired, resolveScans };
