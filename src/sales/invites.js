'use strict';

/**
 * Agent invite links (2026-10-29, owner: "master adminga link yaratib qo'shish
 * imkoniyatini yarat"; migration 031). The agents table lists only accounts
 * that are agents (an offer code); a master adds one with a link instead of
 * picking from every staff account.
 *
 *   create   a master (checked in the database) makes a link:
 *            t.me/<legal bot>?start=agi_<token>. Only the token's sha256 is
 *            kept; one use, INVITE_DAYS (7) days, revocable; a short note
 *            ("for whom") for the master's list.
 *   open     /start agi_<token> in a private chat: the bot says what
 *            accepting does and asks for a tap; the token is held for that
 *            Telegram user in memory for 15 minutes (never in a button).
 *   accept   the tap: the invite is used up in one UPDATE (still unused, not
 *            revoked, not expired); the Telegram's account - made from the
 *            Telegram identity when there is none - becomes a staff account
 *            (role student; a student or lawyer keeps its role; a master or
 *            a referred client is refused) with an offer code, and joins the
 *            pilot Workspace. The invite records who used it.
 *
 * An invite grants only what the master's "Kod berish" granted before: a
 * code on a staff account. No tariff, no unit, no AI.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const PREFIX = 'agi_';
const INVITE_DAYS = 7;
const HOLD_MS = 15 * 60 * 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,48}$/u;

const hashOf = token => crypto.createHash('sha256').update(String(token)).digest('hex');
const newToken = () => crypto.randomBytes(18).toString('base64url'); // 24 characters, 144 bits

async function isMaster(db, id) {
  const r = await db.query('SELECT role FROM admins WHERE id = $1', [id]);
  return !!(r.rows[0] && r.rows[0].role === 'master');
}

/** A new link; the token is returned once and never stored. */
async function createInvite(db, { masterId, note, botUsername }) {
  if (!(await isMaster(db, masterId))) return { ok: false, status: 403, error: 'master_only' };
  const token = newToken();
  const clean = String(note || '').trim().slice(0, 120) || null;
  const r = await db.query(
    `INSERT INTO agent_invites (token_hash, note, created_by, expires_at) VALUES ($1, $2, $3, now() + make_interval(days => $4))
     RETURNING id, note, created_at, expires_at`, [hashOf(token), clean, masterId, INVITE_DAYS]);
  return { ok: true, invite: r.rows[0], link: `https://t.me/${botUsername}?start=${PREFIX}${token}` };
}

async function listInvites(db) {
  const r = await db.query(
    `SELECT i.id, i.note, i.created_at, i.expires_at, i.used_at, i.revoked_at, i.used_by, u.full_name AS used_by_name, u.username AS used_by_username,
            CASE WHEN i.used_at IS NOT NULL THEN 'used' WHEN i.revoked_at IS NOT NULL THEN 'revoked' WHEN i.expires_at <= now() THEN 'expired' ELSE 'open' END AS status
       FROM agent_invites i LEFT JOIN admins u ON u.id = i.used_by ORDER BY i.created_at DESC LIMIT 100`);
  return r.rows;
}

async function revokeInvite(db, { masterId, inviteId }) {
  if (!(await isMaster(db, masterId))) return { ok: false, status: 403, error: 'master_only' };
  const r = await db.query('UPDATE agent_invites SET revoked_at = now() WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL RETURNING id', [inviteId]);
  return r.rows[0] ? { ok: true } : { ok: false, status: 404, error: 'not_open' };
}

/** Is this token an open invite (no change)? */
async function peek(db, token) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const r = await db.query('SELECT id, note FROM agent_invites WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()', [hashOf(token)]);
  return r.rows[0] || null;
}

// /start agi_<token> -> the tap: the token waits here for that Telegram user
const held = new Map();
function hold(telegramUserId, token, now = Date.now()) {
  for (const [k, v] of held) if (v.until <= now) held.delete(k);
  held.set(String(telegramUserId), { token, until: now + HOLD_MS });
}
function take(telegramUserId, now = Date.now()) {
  const v = held.get(String(telegramUserId));
  held.delete(String(telegramUserId));
  return v && v.until > now ? v.token : null;
}

/**
 * The tap. from: the Telegram user. Everything in one transaction: the
 * invite is used up only when the account became an agent.
 */
async function accept(pool, { from, chatId, token }) {
  if (!from || !from.id || !TOKEN_RE.test(String(token || ''))) return { ok: false, error: 'invalid' };
  const tgId = String(from.id);
  const sales = require('./agents');
  const client = await pool.connect();
  let out;
  try {
    await client.query('BEGIN');
    const inv = (await client.query(
      `UPDATE agent_invites SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING id, created_by`,
      [hashOf(token)])).rows[0];
    if (!inv) { await client.query('ROLLBACK'); return { ok: false, error: 'expired' }; }
    let acc = (await client.query(
      `SELECT id, role, sales_agent_code, referred_by_agent_id, demo_for_agent_id FROM admins WHERE telegram_user_id::text = $1 OR ($2::bigint IS NOT NULL AND telegram_chat_id = $2::bigint)
        ORDER BY (telegram_user_id::text = $1) DESC, id LIMIT 1 FOR UPDATE`, [tgId, chatId != null ? String(chatId) : null])).rows[0];
    if (acc && !['user', ...sales.STAFF].includes(acc.role)) { await client.query('ROLLBACK'); return { ok: false, error: 'master' }; }
    if (acc && acc.role === 'user' && (acc.referred_by_agent_id || acc.demo_for_agent_id)) { await client.query('ROLLBACK'); return { ok: false, error: 'client' }; }
    let created = false;
    if (!acc) {
      const base = String(from.username || `tg${tgId}`).replace(/[^a-z0-9._-]/giu, '').toLowerCase() || `tg${tgId}`;
      let username = base;
      for (let i = 1; i <= 200; i++) {
        if (!(await client.query('SELECT 1 FROM admins WHERE LOWER(username) = $1', [username])).rows[0]) break;
        username = `${base}${i}`;
      }
      const fullName = `${from.first_name || ''} ${from.last_name || ''}`.trim() || base;
      const pwd = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
      acc = (await client.query(
        `INSERT INTO admins (username, password, full_name, role, telegram_username, telegram_chat_id, telegram_user_id)
         VALUES ($1, $2, $3, 'student', $4, $5, $6) RETURNING id, role, sales_agent_code`,
        [username, pwd, fullName, from.username || null, chatId != null ? Number(chatId) : null, BigInt(tgId)])).rows[0];
      created = true;
    } else if (acc.role === 'user') {
      await client.query(`UPDATE admins SET role = 'student' WHERE id = $1 AND role = 'user'`, [acc.id]);
      acc.role = 'student';
    }
    let code = acc.sales_agent_code;
    for (let i = 0; !code && i < 5; i++) {
      const c = sales.newCode();
      await client.query('SAVEPOINT code');
      try { await client.query('UPDATE admins SET sales_agent_code = $2 WHERE id = $1', [acc.id, c]); code = c; }
      catch (e) { await client.query('ROLLBACK TO SAVEPOINT code'); if (e.code !== '23505') throw e; }
    }
    if (!code) throw new Error('code_failed');
    await client.query('UPDATE agent_invites SET used_by = $2 WHERE id = $1', [inv.id, acc.id]);
    await client.query('COMMIT');
    out = { ok: true, adminId: acc.id, created, role: acc.role, code, inviteId: inv.id, invitedBy: inv.created_by };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  // an agent works in the pilot Workspace (when a master has opened it); never undoes the invite
  try {
    const pw = require('./pilot-workspace');
    await pw.ensureMember(pool, await pw.pilotWorkspace(pool), out.adminId);
  } catch (e) { if (!/does not exist/u.test(String(e && e.message))) console.warn('[SALES] agent not added to the pilot Workspace:', e.message); }
  return out;
}

const TEXTS = Object.freeze({
  ask: note => "Sizni JuristAI CustDev pilotiga agent sifatida taklif qilishdi" + (note ? ` (${note})` : '') + ".\n\n" +
    "Qabul qilsangiz:\n• shu Telegram'ning akkaunti xodim (shogird) akkaunti bo'ladi — bu botdagi xabarlaringiz huquqiy savol sifatida qabul qilinmaydi;\n" +
    "• sizga shaxsiy taklif havolasi beriladi: u orqali kelgan mijozlar ro'yxatini (savol-javob matnisiz) saytda ko'rasiz;\n" +
    "• tarif, chegirma yoki pilotni siz bermaysiz — ularni JuristAI jamoasi beradi.\n\nHavola bir marta ishlaydi.",
  bad: "Bu taklif havolasi eskirgan, ishlatilgan yoki bekor qilingan. Yangisini so'rang.",
  master: "Bu Telegram master akkauntiga ulangan — agent qilib bo'lmaydi.",
  client: "Bu Telegram pilot mijozi akkauntiga ulangan — agent qilib bo'lmaydi. Boshqa Telegram akkauntdan oching.",
  again: "Taklif kutish vaqti tugadi — havolani qayta oching.",
  done: (r, links, appUrl) => "✅ Siz endi JuristAI agentisiz.\n\nTaklif havolalaringiz:\n" + links.web + "\n" + links.telegram +
    `\n\nMijozlaringiz: ${appUrl}/app/#/mijozlarim (saytga «Telegram orqali kirish» bilan kiring).`,
});

const keyboard = () => ({ inline_keyboard: [[{ text: "✅ Agent bo'laman", callback_data: `${PREFIX}y` }, { text: '❌ Yo‘q', callback_data: `${PREFIX}n` }]] });

module.exports = { PREFIX, INVITE_DAYS, TOKEN_RE, hashOf, createInvite, listInvites, revokeInvite, peek, hold, take, accept, TEXTS, keyboard, _held: held };
