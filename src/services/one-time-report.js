'use strict';

/**
 * One-time purchases for the master admin (2026-10-22): what was bought one
 * service at a time (service_credits, src/rag/one-time-products.js), by whom,
 * for how many Stars, and how much of each person's bought units is left.
 * Read only. A refunded purchase is listed and marked, never counted as
 * revenue. Amounts in so'm are the catalogue price at the time of the sale;
 * the Stars payout actually received is not known here.
 */

const TZ = 'Asia/Tashkent';

async function oneTimeReport(db, { days = 30, limit = 200 } = {}) {
  const exists = (await db.query(`SELECT to_regclass('public.service_credits') IS NOT NULL AS ok`)).rows[0];
  if (!exists || !exists.ok) return { available: false, purchases: [], totals: [], today: { count: 0, stars: 0 } };
  const d = Math.max(1, Math.min(365, Number(days) || 30));
  const purchases = (await db.query(
    `SELECT c.id, c.created_at, c.product, c.service, c.units, c.price_uzs, c.stars, c.provider, c.refunded_at,
            c.subject, c.admin_id, c.telegram_user_id, a.username, a.full_name, u.username AS tg_username, u.first_name AS tg_first_name
       FROM service_credits c
       LEFT JOIN admins a ON a.id = c.admin_id
       LEFT JOIN users u ON u.telegram_id = c.telegram_user_id
      WHERE c.created_at > now() - ($1 || ' days')::interval
      ORDER BY c.created_at DESC
      LIMIT $2`, [String(d), Math.max(1, Math.min(500, Number(limit) || 200))])).rows;
  const totals = (await db.query(
    `SELECT product, COUNT(*)::int AS count, SUM(units)::int AS units, COALESCE(SUM(stars), 0)::int AS stars,
            COALESCE(SUM(price_uzs), 0)::bigint AS price_uzs
       FROM service_credits
      WHERE refunded_at IS NULL AND created_at > now() - ($1 || ' days')::interval
      GROUP BY product ORDER BY product`, [String(d)])).rows;
  const today = (await db.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(stars), 0)::int AS stars
       FROM service_credits
      WHERE refunded_at IS NULL AND (created_at AT TIME ZONE '${TZ}')::date = (now() AT TIME ZONE '${TZ}')::date`)).rows[0];
  // what is left of the bought units, per person and service (released uses do not count)
  const subjects = [...new Set(purchases.map(p => p.subject))];
  let left = [];
  if (subjects.length) {
    left = (await db.query(
      `SELECT b.subject, b.service, b.bought, COALESCE(u.used, 0)::int AS used
         FROM (SELECT subject, service, SUM(units)::int AS bought FROM service_credits
                WHERE refunded_at IS NULL AND subject = ANY($1) GROUP BY subject, service) b
         LEFT JOIN (SELECT subject, service, SUM(COALESCE(credits, 1))::int AS used FROM tariff_usage
                     WHERE period_id IS NULL AND meta->>'pool' = 'one_time' AND status IS DISTINCT FROM 'released' AND subject = ANY($1)
                     GROUP BY subject, service) u ON u.subject = b.subject AND u.service = b.service`, [subjects])).rows;
  }
  const leftOf = new Map(left.map(r => [`${r.subject}|${r.service}`, Math.max(0, r.bought - r.used)]));
  return {
    available: true, days: d,
    purchases: purchases.map(p => ({ ...p, remaining: leftOf.get(`${p.subject}|${p.service}`) ?? null })),
    totals, today: today || { count: 0, stars: 0 },
  };
}

module.exports = { oneTimeReport };
