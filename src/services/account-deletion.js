'use strict';

/**
 * Account deletion on request (2026-10-20, owner: "Akkauntni o'chir" in the
 * bot must not be answered as a legal question). There was no self-service
 * deletion; now:
 *
 *   1. the person asks in the bot (typed or by voice) and confirms with a
 *      button - one pending request per Telegram user (createRequest);
 *   2. a master sees it in /app/#/boshqaruv and carries it out (complete),
 *      or declines it with a reason (cancel); the person is told in the bot.
 *
 * Carrying it out removes the person's data, not the accounting:
 *   - the web account (if linked, role 'user' only): name, login, e-mail,
 *     phone, Google and Telegram links scrubbed, a random unusable password,
 *     every session and add-in token ended; the row stays so payment and
 *     usage records keep their reference;
 *   - web chats (ai_chat_sessions), matters (matters, matter_items),
 *     scanned documents (document_scans) and agent runs (agent_runs) deleted;
 *   - the Telegram profile (users) scrubbed, bot conversation state deleted,
 *     the text of their bot questions and answers replaced;
 *   - tariff periods, usage and payments are kept (accounting), without
 *     personal fields.
 * Staff accounts are never touched here. Columns that a database does not
 * have are skipped (older schemas).
 */

const crypto = require('crypto');

const REMOVED_TEXT = "[foydalanuvchi so'rovi bilan o'chirildi]";

async function ensureTable(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS account_deletion_requests (
    id SERIAL PRIMARY KEY,
    telegram_user_id BIGINT,
    chat_id BIGINT,
    admin_id INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    handled_at TIMESTAMPTZ,
    handled_by INTEGER
  )`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_account_deletion_pending
    ON account_deletion_requests (telegram_user_id) WHERE status = 'pending'`);
}

/** One pending request per Telegram user; a second ask returns the first. */
async function createRequest(db, { telegramUserId, chatId, adminId = null }) {
  await ensureTable(db);
  const existing = await db.query(
    `SELECT id, created_at FROM account_deletion_requests WHERE telegram_user_id = $1 AND status = 'pending' LIMIT 1`, [telegramUserId]);
  if (existing.rows.length) return { id: existing.rows[0].id, duplicate: true };
  const r = await db.query(
    `INSERT INTO account_deletion_requests (telegram_user_id, chat_id, admin_id) VALUES ($1, $2, $3) RETURNING id`,
    [telegramUserId, chatId, adminId]);
  return { id: r.rows[0].id, duplicate: false };
}

async function listRequests(db, { status = 'pending' } = {}) {
  await ensureTable(db);
  const r = await db.query(
    `SELECT d.id, d.telegram_user_id, d.chat_id, d.admin_id, d.status, d.reason, d.created_at, d.handled_at,
            a.username, a.full_name, a.role, u.username AS tg_username, u.first_name AS tg_first_name
       FROM account_deletion_requests d
       LEFT JOIN admins a ON a.id = d.admin_id
       LEFT JOIN users u ON u.telegram_id = d.telegram_user_id
      WHERE d.status = $1 ORDER BY d.created_at DESC LIMIT 200`, [status]);
  return r.rows;
}

async function columnsOf(db, table) {
  const r = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table]);
  return new Set(r.rows.map(x => x.column_name));
}

/**
 * Carry a request out. Returns { ok, request } or { ok:false, error }.
 * revoke(adminId) ends sessions and add-in tokens (server's revokeSessionsFor).
 */
async function complete(db, id, { handledBy, revoke = async () => {} } = {}) {
  await ensureTable(db);
  const req = (await db.query(`SELECT * FROM account_deletion_requests WHERE id = $1`, [id])).rows[0];
  if (!req) return { ok: false, error: 'not_found' };
  if (req.status !== 'pending') return { ok: false, error: 'not_pending' };

  // the web account linked to this Telegram user (the one recorded, or found now)
  let adminId = req.admin_id;
  if (!adminId && req.telegram_user_id) {
    const a = await db.query(`SELECT id FROM admins WHERE telegram_user_id = $1 OR telegram_chat_id = $1 LIMIT 2`, [req.telegram_user_id]).catch(() => ({ rows: [] }));
    if (a.rows.length === 1) adminId = a.rows[0].id;
  }
  if (adminId) {
    const acc = (await db.query(`SELECT id, role FROM admins WHERE id = $1`, [adminId])).rows[0];
    if (acc && acc.role !== 'user') return { ok: false, error: 'staff_account' };
    if (acc) {
      const cols = await columnsOf(db, 'admins');
      const set = [`username = $2`, `full_name = $3`, `password = $4`];
      const vals = [adminId, `deleted_${adminId}_${crypto.randomBytes(4).toString('hex')}`, "O'chirilgan foydalanuvchi", `!deleted!${crypto.randomBytes(24).toString('hex')}`];
      for (const c of ['email', 'phone', 'google_id', 'telegram_user_id', 'telegram_chat_id', 'telegram_username', 'telegram_link_code', 'device_fingerprint']) {
        if (cols.has(c)) set.push(`${c} = NULL`);
      }
      if (cols.has('is_active')) set.push('is_active = FALSE');
      await db.query(`UPDATE admins SET ${set.join(', ')} WHERE id = $1 AND role = 'user'`, vals);
      await db.query(`DELETE FROM ai_chat_sessions WHERE admin_id = $1`, [adminId]).catch(() => {});
      // matters and their links; the scans go too (a matter may hold one for years)
      await require('../matters/store').deleteAccountMatters(db, adminId).catch(() => {});
      await db.query(`DELETE FROM document_scans WHERE admin_id = $1`, [adminId]).catch(() => {});
      await require('../agents/runs/store').deleteAccountRuns(db, adminId).catch(() => {});
      await require('../voice/user-glossary').deleteAccountGlossary(db, adminId).catch(() => {});
      await require('../adaptive/profile').deleteAccountProfile(db, adminId).catch(() => {});
      await revoke(adminId);
    }
  }
  if (req.telegram_user_id) {
    const u = (await db.query(`SELECT id FROM users WHERE telegram_id = $1`, [req.telegram_user_id]).catch(() => ({ rows: [] }))).rows[0];
    if (u) {
      await db.query(`UPDATE requests SET request_text = $2, response_text = NULL WHERE user_id = $1`, [u.id, REMOVED_TEXT]).catch(() => {});
      await db.query(`UPDATE users SET username = NULL, first_name = NULL, name = NULL WHERE id = $1`, [u.id]).catch(() => {});
    }
    await db.query(`DELETE FROM tg_conversations WHERE chat_id = $1`, [req.chat_id || req.telegram_user_id]).catch(() => {});
  }
  await db.query(`UPDATE account_deletion_requests SET status = 'done', handled_at = NOW(), handled_by = $2, admin_id = COALESCE(admin_id, $3) WHERE id = $1`,
    [id, handledBy || null, adminId || null]);
  return { ok: true, request: { ...req, admin_id: adminId } };
}

async function cancel(db, id, { handledBy, reason = '' } = {}) {
  await ensureTable(db);
  const r = await db.query(`UPDATE account_deletion_requests SET status = 'cancelled', reason = $3, handled_at = NOW(), handled_by = $2
    WHERE id = $1 AND status = 'pending' RETURNING *`, [id, handledBy || null, String(reason || '').slice(0, 500)]);
  return r.rows[0] ? { ok: true, request: r.rows[0] } : { ok: false, error: 'not_pending' };
}

module.exports = { ensureTable, createRequest, listRequests, complete, cancel, REMOVED_TEXT };
