'use strict';

/**
 * X6 of the 2026-11-10 audit (C1): the long-document digest kept in the database (migration 050),
 * so the same person's next service on the same document - analysis, then an explanation or an
 * opinion, a chat question a day later, or the same request after a deploy - does not pay for
 * the digest's 5-13 AI calls again. Until now it lived in this process's memory for an hour.
 *
 *   - keyed by the account and the sha256 of the exact text the digest was made from, and by
 *     VERSION (bump it when the digest's prompt or shape changes: older rows are then ignored);
 *   - sealed (AAD doc_digests.digest:<admin>:<sha>:<version>); another account never reads it;
 *   - only the caller decides what is worth storing (a digest with a failed or cut part is not);
 *   - DOC_DIGEST_DAYS (14); removed with the library document (scan-store deleteDoc) and the
 *     account (account-deletion); DOC_DIGEST_STORE=off -> nothing is read or written.
 * Every failure here is a cache miss, never an error for the person. No AI.
 */

const crypto = require('crypto');
const privacy = require('../privacy/crypto');

const VERSION = 'd1';
const DAYS = () => Math.min(90, Math.max(1, Number(process.env.DOC_DIGEST_DAYS) || 14));
const off = () => String(process.env.DOC_DIGEST_STORE || '').toLowerCase() === 'off';
const shaOf = text => crypto.createHash('sha256').update(String(text == null ? '' : text)).digest('hex');
const aad = (adminId, sha) => `doc_digests.digest:${adminId}:${sha}:${VERSION}`;
const missing = e => e && (e.code === '42P01' || e.code === '42703');

/** The stored digest for this account and exact text, or null. */
async function get(db, { adminId, text }) {
  if (off() || !adminId) return null;
  const sha = shaOf(text);
  try {
    const r = await db.query(
      `UPDATE doc_digests SET used_at = now(), uses = uses + 1
        WHERE admin_id = $1 AND text_sha256 = $2 AND version = $3 AND expires_at > now() RETURNING digest`, [adminId, sha, VERSION]);
    if (!r.rows[0]) return null;
    const d = privacy.openJson(r.rows[0].digest, aad(adminId, sha));
    return d && typeof d === 'object' && typeof d.text === 'string' ? d : null;
  } catch (e) {
    if (!missing(e)) console.warn('[DIGEST-STORE] read failed:', e.message);
    return null;
  }
}

/** Keep a digest (the caller stores only one read whole). */
async function put(db, { adminId, text, digest }) {
  if (off() || !adminId || !digest || typeof digest.text !== 'string') return false;
  const sha = shaOf(text);
  try {
    await db.query(
      `INSERT INTO doc_digests (admin_id, text_sha256, version, digest, chars, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' days')::interval)
       ON CONFLICT (admin_id, text_sha256, version) DO UPDATE SET digest = EXCLUDED.digest, chars = EXCLUDED.chars, created_at = now(), expires_at = EXCLUDED.expires_at`,
      [adminId, sha, VERSION, JSON.stringify(privacy.sealJson(digest, aad(adminId, sha))), String(text).length, String(DAYS())]);
    // old rows go on the way (cheap: an index on expires_at)
    db.query('DELETE FROM doc_digests WHERE expires_at <= now()').catch(() => {});
    return true;
  } catch (e) {
    if (!missing(e)) console.warn('[DIGEST-STORE] write failed:', e.message);
    return false;
  }
}

/** The document is deleted for good: its digest goes with it. */
async function removeForText(db, { adminId, text }) {
  if (!adminId || !text) return;
  await db.query('DELETE FROM doc_digests WHERE admin_id = $1 AND text_sha256 = $2', [adminId, shaOf(text)]).catch(e => { if (!missing(e)) console.warn('[DIGEST-STORE] delete failed:', e.message); });
}

async function removeForAccount(db, adminId) {
  await db.query('DELETE FROM doc_digests WHERE admin_id = $1', [adminId]).catch(() => {});
}

module.exports = { get, put, removeForText, removeForAccount, shaOf, VERSION, DAYS };
