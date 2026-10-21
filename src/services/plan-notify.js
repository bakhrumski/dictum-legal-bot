'use strict';

/**
 * Plan messages in Telegram for a linked account (2026-10-21, audit: a paid
 * user was never told in the bot that a plan started or is about to end).
 *
 *   granted   when a master grants a paid period: plan, dates, what it gives
 *   expiring  3 days and 1 day before a paid period ends, when no later
 *             period follows it: one message each, deduplicated in
 *             tariff_expiry_notices (period, days)
 *
 * Only the plan's name, dates and the tariff link are sent. Nothing renews
 * or is charged by itself; the message says so. PLAN_NOTIFY=off stops both.
 */

const DAY_MS = 86400000;
const enabled = () => String(process.env.PLAN_NOTIFY || 'on').toLowerCase() !== 'off';
const appBase = () => String(process.env.APP_URL || 'https://juristai.uz').replace(/\/+$/u, '');
const day = (d) => new Date(d).toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent' });

async function chatOf(db, adminId) {
  const r = await db.query(`SELECT COALESCE(telegram_chat_id, telegram_user_id) AS chat FROM admins WHERE id = $1 AND role = 'user'`, [adminId]);
  return r.rows[0] && r.rows[0].chat ? r.rows[0].chat : null;
}

function grantedText({ plan, startsAt, endsAt, catalog }) {
  const c = catalog[plan] || {};
  const q = c.quotas || {};
  return [
    `✅ ${c.label || plan} tarifi faollashtirildi: ${day(startsAt)} — ${day(endsAt)}.`,
    `Davr uchun: ${q.chat} ta savol, ${q.analysis} ta tahlil, ${q.opinion} ta xulosa, ${q.draft} ta hujjat. Bot va sayt limiti umumiy.`,
    'Qoldiq: /balance',
  ].join('\n');
}

function expiringText({ plan, endsAt, days, catalog }) {
  const label = (catalog[plan] || {}).label || plan;
  return `⏰ ${label} tarifingiz ${days === 1 ? 'ertaga' : `${days} kundan keyin`} (${day(endsAt)}) tugaydi. Avtomatik to'lov olinmaydi — davom ettirish uchun: ${appBase()}/tariff.html`;
}

/** deps: db (pool), send(chat, text), catalog (PLAN_CATALOG). */
function createPlanNotifier({ db, send, catalog }) {
  async function granted({ adminId, plan, startsAt, endsAt }) {
    if (!enabled() || !send) return false;
    const chat = await chatOf(db, adminId);
    if (!chat) return false;
    await send(chat, grantedText({ plan, startsAt, endsAt, catalog }));
    return true;
  }

  async function sweep(now = new Date()) {
    if (!enabled() || !send) return 0;
    await db.query(`CREATE TABLE IF NOT EXISTS tariff_expiry_notices (
      period_id bigint NOT NULL, days integer NOT NULL, sent_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (period_id, days))`);
    const { rows } = await db.query(
      `SELECT p.id, p.admin_id, p.plan, p.ends_at FROM tariff_periods p
        WHERE p.status = 'active' AND p.source NOT IN ('trial', 'test') AND p.admin_id IS NOT NULL
          AND p.ends_at > $1 AND p.ends_at <= $1::timestamptz + interval '3 days'
          AND NOT EXISTS (SELECT 1 FROM tariff_periods n WHERE n.subject = p.subject AND n.status = 'active'
                           AND n.source NOT IN ('trial', 'test') AND n.id <> p.id AND n.ends_at > p.ends_at)
        LIMIT 500`, [now]);
    let sent = 0;
    for (const p of rows) {
      const left = (new Date(p.ends_at).getTime() - now.getTime()) / DAY_MS;
      const days = left <= 1 ? 1 : 3;
      const chat = await chatOf(db, p.admin_id);
      if (!chat) continue;
      const claim = await db.query(`INSERT INTO tariff_expiry_notices (period_id, days) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING period_id`, [p.id, days]);
      if (!claim.rows.length) continue;
      try { await send(chat, expiringText({ plan: p.plan, endsAt: p.ends_at, days, catalog })); sent++; } catch (e) {
        console.warn('[PLAN-NOTIFY] reminder failed:', e.message);
        await db.query('DELETE FROM tariff_expiry_notices WHERE period_id = $1 AND days = $2', [p.id, days]).catch(() => {});
      }
    }
    return sent;
  }

  function start() {
    if (!enabled()) return null;
    const run = () => sweep().catch(e => console.warn('[PLAN-NOTIFY] sweep failed:', e.message));
    const first = setTimeout(run, 90 * 1000); if (first.unref) first.unref();
    const t = setInterval(run, 3600 * 1000); if (t.unref) t.unref();
    return t;
  }

  return { granted, sweep, start };
}

module.exports = { createPlanNotifier, grantedText, expiringText };
