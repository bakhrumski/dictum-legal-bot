'use strict';

/**
 * CustDev pilot, stage 2 (2026-10-28, owner; migration 024): student lawyers
 * ("agents") bring clients to a 14-day pilot.
 *
 *   agent code   a staff account's random offer code; only a master gives or
 *                takes it (checked in the database). No new role.
 *   offer link   https://juristai.uz/?ref=<code> (a cookie, read when the
 *                account is made) and t.me/<bot>?start=ref_<code> (kept for
 *                the Telegram user until their account is made). The FIRST
 *                agent stays; an unknown code is ignored without a word.
 *   pilot        a referred client gets one pending request; a master approves
 *                it with one button - a 14-day test entitlement with the pilot
 *                quotas of docs/tariffs-v2.md §10 - or declines it.
 *   demo         a master links an ordinary account (made by the test-users
 *                flow) to an agent as the agent's demo; its spend is reported
 *                apart from the clients'.
 *
 * An agent grants nothing: every grant, code and decision goes through a
 * master check in the database. An agent sees their own clients only - name,
 * registration date, pilot status, units used - never a question or answer.
 */

const crypto = require('crypto');

// the 14-day CustDev pilot (docs/tariffs-v2.md §10); used only when a master approves
const PILOT_GRANT = Object.freeze({ hours: 336, plan: 'silver', quotas: { chat: 120, analysis: 8, opinion: 4, draft: 6, ocr: 20 }, budgetUsd: 10 });
const STAFF = Object.freeze(['student', 'lawyer']);
const CODE_RE = /^[a-z0-9]{10,16}$/;

function newCode() {
  // 12 characters from a 32-letter alphabet: 60 bits, not guessable
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const b = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += abc[b[i] % 32];
  return s;
}
const cleanCode = c => (typeof c === 'string' && CODE_RE.test(c.trim().toLowerCase()) ? c.trim().toLowerCase() : null);

async function isMaster(db, id) {
  const r = await db.query('SELECT role FROM admins WHERE id = $1', [id]);
  return !!(r.rows[0] && r.rows[0].role === 'master');
}

/** Give a staff account an offer code (a new one replaces the old). */
async function assignCode(db, { masterId, agentId }) {
  if (!(await isMaster(db, masterId))) return { ok: false, status: 403, error: 'master_only' };
  const a = (await db.query('SELECT id, role FROM admins WHERE id = $1', [agentId])).rows[0];
  if (!a) return { ok: false, status: 404, error: 'not_found' };
  if (!STAFF.includes(a.role)) return { ok: false, status: 400, error: 'not_staff', message: "Agent kodi faqat xodim (shogird yoki yurist) akkauntiga beriladi" };
  for (let i = 0; i < 5; i++) {
    try {
      const code = newCode();
      await db.query('UPDATE admins SET sales_agent_code = $2 WHERE id = $1', [agentId, code]);
      return { ok: true, code };
    } catch (e) { if (e.code !== '23505') throw e; }
  }
  return { ok: false, status: 500, error: 'code_failed' };
}

async function revokeCode(db, { masterId, agentId }) {
  if (!(await isMaster(db, masterId))) return { ok: false, status: 403, error: 'master_only' };
  await db.query('UPDATE admins SET sales_agent_code = NULL WHERE id = $1', [agentId]);
  return { ok: true };
}

/** The agent behind a code, or null (an unknown or revoked code, or not a staff account). */
async function agentByCode(db, code) {
  const c = cleanCode(code);
  if (!c) return null;
  const r = await db.query(`SELECT id FROM admins WHERE sales_agent_code = $1 AND role = ANY($2)`, [c, STAFF]);
  return r.rows[0] ? r.rows[0].id : null;
}

/**
 * The client came through this agent: written once (the first agent stays),
 * only on an ordinary account that is not a demo, and a pending pilot request
 * is opened. Returns true when this call attached it.
 */
async function attachReferral(db, { adminId, agentId, channel = 'web' }) {
  if (!adminId || !agentId) return false;
  const r = await db.query(
    `UPDATE admins SET referred_by_agent_id = $2, referred_at = now(), referral_channel = $3
      WHERE id = $1 AND role = 'user' AND referred_by_agent_id IS NULL AND demo_for_agent_id IS NULL RETURNING id`,
    [adminId, agentId, channel === 'telegram' ? 'telegram' : 'web']);
  if (!r.rows[0]) return false;
  await db.query(`INSERT INTO pilot_requests (admin_id, agent_id) VALUES ($1, $2) ON CONFLICT (admin_id) DO NOTHING`, [adminId, agentId]);
  return true;
}

/** /start ref_<code>: kept for the Telegram user (the first agent stays); attached at once when the account exists. */
async function rememberTelegramRef(db, { telegramUserId, code }) {
  const agentId = await agentByCode(db, code);
  if (!agentId || !telegramUserId) return { known: false };
  await db.query(`INSERT INTO referral_pending (telegram_user_id, agent_id) VALUES ($1, $2) ON CONFLICT (telegram_user_id) DO NOTHING`, [String(telegramUserId), agentId]);
  const acc = (await db.query(`SELECT id FROM admins WHERE telegram_user_id::text = $1 AND role = 'user' LIMIT 1`, [String(telegramUserId)])).rows[0];
  const first = (await db.query('SELECT agent_id FROM referral_pending WHERE telegram_user_id = $1', [String(telegramUserId)])).rows[0];
  if (acc && first) await attachReferral(db, { adminId: acc.id, agentId: first.agent_id, channel: 'telegram' });
  return { known: true, hasAccount: !!acc };
}

/** At registration: the web cookie's code first, else what the Telegram user opened before. Never throws. */
async function claimAtRegistration(db, { adminId, refCode = null, telegramUserId = null }) {
  try {
    const fromWeb = await agentByCode(db, refCode);
    if (fromWeb) return attachReferral(db, { adminId, agentId: fromWeb, channel: 'web' });
    if (telegramUserId) {
      const p = (await db.query('SELECT agent_id FROM referral_pending WHERE telegram_user_id = $1', [String(telegramUserId)])).rows[0];
      if (p) return attachReferral(db, { adminId, agentId: p.agent_id, channel: 'telegram' });
    }
  } catch (e) {
    if (!/does not exist/u.test(String(e && e.message))) console.warn('[SALES] referral not recorded:', e.message);
  }
  return false;
}

/** Pilot requests for the master: pending first. */
async function listRequests(db, { status = 'pending' } = {}) {
  const st = ['pending', 'approved', 'declined'].includes(status) ? status : 'pending';
  const r = await db.query(
    `SELECT q.id, q.admin_id, q.agent_id, q.status, q.created_at, q.decided_at, q.period_id,
            c.full_name, c.username, c.created_at AS registered_at, c.referral_channel,
            g.full_name AS agent_name, g.username AS agent_username
       FROM pilot_requests q JOIN admins c ON c.id = q.admin_id LEFT JOIN admins g ON g.id = q.agent_id
      WHERE q.status = $1 ORDER BY q.created_at DESC LIMIT 200`, [st]);
  return r.rows;
}

/** One button: a 14-day test entitlement with the pilot quotas (tariff-ledger checks the master again). */
async function approve(db, { masterId, requestId, ledger }) {
  if (!(await isMaster(db, masterId))) return { ok: false, status: 403, error: 'master_only' };
  const q = (await db.query(`SELECT q.*, g.full_name AS agent_name FROM pilot_requests q LEFT JOIN admins g ON g.id = q.agent_id WHERE q.id = $1`, [requestId])).rows[0];
  if (!q) return { ok: false, status: 404, error: 'not_found' };
  if (q.status !== 'pending') return { ok: false, status: 409, error: 'already_decided', request: q };
  const g = await ledger.grantTestEntitlement({ adminId: q.admin_id, grantedBy: masterId, reason: `CustDev pilot (agent #${q.agent_id}${q.agent_name ? ` ${q.agent_name}` : ''})`, ...PILOT_GRANT });
  if (!g.ok) return { ok: false, status: 409, error: g.reason };
  const r = await db.query(`UPDATE pilot_requests SET status = 'approved', decided_by = $2, decided_at = now(), period_id = $3 WHERE id = $1 AND status = 'pending' RETURNING *`,
    [requestId, masterId, g.period.id]);
  return { ok: true, request: r.rows[0] || q, period: g.period };
}

async function decline(db, { masterId, requestId, note = '' }) {
  if (!(await isMaster(db, masterId))) return { ok: false, status: 403, error: 'master_only' };
  const r = await db.query(`UPDATE pilot_requests SET status = 'declined', decided_by = $2, decided_at = now(), note = $3 WHERE id = $1 AND status = 'pending' RETURNING *`,
    [requestId, masterId, String(note || '').slice(0, 300)]);
  return r.rows[0] ? { ok: true, request: r.rows[0] } : { ok: false, status: 409, error: 'not_pending' };
}

/** Link an ordinary master-made account to an agent as the agent's demo, and give it the 14-day pilot entitlement. */
async function linkDemo(db, { masterId, agentId, userId, ledger }) {
  if (!(await isMaster(db, masterId))) return { ok: false, status: 403, error: 'master_only' };
  const a = (await db.query('SELECT id, role, full_name FROM admins WHERE id = $1', [agentId])).rows[0];
  if (!a || !STAFF.includes(a.role)) return { ok: false, status: 400, error: 'not_staff' };
  const u = (await db.query('SELECT id, role, created_by_master_id, referred_by_agent_id FROM admins WHERE id = $1', [userId])).rows[0];
  if (!u || u.role !== 'user' || !u.created_by_master_id) return { ok: false, status: 400, error: 'not_a_test_user', message: "Demo uchun master yaratgan oddiy test akkaunti kerak (Boshqaruv → test akkaunt)" };
  if (u.referred_by_agent_id) return { ok: false, status: 400, error: 'is_a_client', message: "Bu akkaunt mijoz sifatida yozilgan" };
  await db.query('UPDATE admins SET demo_for_agent_id = $2 WHERE id = $1', [userId, agentId]);
  const g = await ledger.grantTestEntitlement({ adminId: userId, grantedBy: masterId, reason: `Demo: agent #${agentId}${a.full_name ? ` ${a.full_name}` : ''}`, ...PILOT_GRANT });
  return g.ok ? { ok: true, period: g.period, duplicate: g.duplicate } : { ok: false, status: 409, error: g.reason };
}

const USED = `(SELECT COALESCE(SUM(u.credits), 0)::int FROM tariff_usage u WHERE u.admin_id = c.id AND u.status = 'committed')`;
const PAID = `EXISTS (SELECT 1 FROM tariff_periods p WHERE p.admin_id = c.id AND p.source NOT IN ('trial', 'test') AND p.price_uzs IS NOT NULL)`;

/** The agent's own clients: name, registered, pilot status, units used - no question or answer text. */
async function clientsOf(db, agentId) {
  const r = await db.query(
    `SELECT c.id, c.full_name, c.created_at AS registered_at, c.referral_channel,
            q.status AS pilot_status, q.decided_at,
            (SELECT p.ends_at FROM tariff_periods p WHERE p.id = q.period_id) AS pilot_ends_at,
            ${USED} AS units_used, ${PAID} AS paid
       FROM admins c LEFT JOIN pilot_requests q ON q.admin_id = c.id
      WHERE c.referred_by_agent_id = $1 ORDER BY c.created_at DESC LIMIT 500`, [agentId]);
  return r.rows;
}

/** The agent's own page: their code, links and clients; null for an account with no code. */
async function agentPage(db, { agentId, botUsername, appUrl }) {
  const a = (await db.query('SELECT id, role, full_name, sales_agent_code FROM admins WHERE id = $1', [agentId])).rows[0];
  if (!a || !STAFF.includes(a.role) || !a.sales_agent_code) return null;
  const demo = (await db.query('SELECT id, username FROM admins WHERE demo_for_agent_id = $1 ORDER BY id DESC LIMIT 1', [agentId])).rows[0] || null;
  return {
    code: a.sales_agent_code,
    links: { web: `${appUrl}/?ref=${a.sales_agent_code}`, telegram: `https://t.me/${botUsername}?start=ref_${a.sales_agent_code}` },
    demo: demo ? { id: demo.id, login: demo.username } : null,
    clients: await clientsOf(db, agentId),
  };
}

/** The master's view: staff accounts with their codes, demo account and client counts. */
async function agentsOverview(db) {
  const r = await db.query(
    `SELECT g.id, g.full_name, g.username, g.role, g.sales_agent_code,
            (SELECT d.id FROM admins d WHERE d.demo_for_agent_id = g.id ORDER BY d.id DESC LIMIT 1) AS demo_id,
            (SELECT count(*)::int FROM admins c WHERE c.referred_by_agent_id = g.id) AS registered,
            (SELECT count(*)::int FROM pilot_requests q WHERE q.agent_id = g.id AND q.status = 'approved') AS piloted,
            (SELECT count(*)::int FROM admins c WHERE c.referred_by_agent_id = g.id AND ${PAID}) AS paid,
            (SELECT COALESCE(SUM(u.credits), 0)::int FROM tariff_usage u JOIN admins d ON d.id = u.admin_id WHERE d.demo_for_agent_id = g.id AND u.status = 'committed') AS demo_units
       FROM admins g WHERE g.role = ANY($1) ORDER BY g.sales_agent_code IS NULL, g.full_name`, [STAFF]);
  return r.rows;
}

module.exports = { PILOT_GRANT, STAFF, newCode, cleanCode, assignCode, revokeCode, agentByCode, attachReferral, rememberTelegramRef,
  claimAtRegistration, listRequests, approve, decline, linkDemo, clientsOf, agentPage, agentsOverview };
