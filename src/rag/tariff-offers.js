'use strict';

/**
 * Individual discount offers (2026-10-05, docs/tariffs-v2.md §9).
 *
 * A master offers one ordinary user one paid plan for one 30-day period at a
 * discount, with a reason and an expiry. Creating an offer activates
 * nothing: the period starts only when a confirmed payment is granted with
 * the offer (ledger.grantPaidPeriod, offerId), which redeems it once. The
 * offer stores the quote it was made with - list price, discount, final
 * price, minimum price, cost estimate, cost model and quota versions - so
 * the price can never be replaced by one a client sends.
 *
 *   status: draft | active | redeemed | expired | revoked
 * Revoking an offer does not touch a period it already paid for.
 */

const { pool } = require('../database/db');
const ledger = require('./tariff-ledger');
const pricing = require('./tariff-pricing');

async function isMaster(db, adminId) {
  const r = await db.query('SELECT role FROM admins WHERE id = $1', [adminId]);
  return !!(r.rows[0] && r.rows[0].role === 'master');
}

async function ordinaryUser(db, userId) {
  const r = await db.query('SELECT id, role, username, full_name FROM admins WHERE id = $1', [userId]);
  const u = r.rows[0];
  if (!u) return { error: 'unknown_user' };
  if (u.role !== 'user') return { error: 'not_an_ordinary_user' };
  return { user: u };
}

/**
 * The server's quote for an offer (read-only). Measured service cost, when
 * the ledger has it, can only raise the cost estimate.
 */
async function quoteOffer({ userId, plan, discountPercent = null, discountUzs = null, db = pool }) {
  const u = await ordinaryUser(db, userId);
  if (u.error) return { ok: false, reason: u.error };
  let measured = null;
  try { measured = await ledger.measuredServiceCost({ days: 30, db }); } catch (_) { measured = null; }
  const q = pricing.quoteDiscount({ plan, discountPercent, discountUzs, measured });
  let change = null;
  if (q.ok) {
    try { change = await ledger.quotePlanChange(userId, plan, { db, priceUzs: q.finalPriceUzs }); } catch (_) { change = null; }
  }
  return { ...q, user: u.user, change };
}

/**
 * Create an offer. Only a master (checked in the database, not only by the
 * route); the quote is recomputed here and must be within the floor.
 */
async function createOffer({ createdBy, userId, plan, discountPercent = null, discountUzs = null, reason = '', validDays = 7, draft = false, db = pool, now = new Date() }) {
  if (!(await isMaster(db, createdBy))) return { ok: false, reason: 'master_only' };
  const why = String(reason || '').trim();
  if (why.length < 3 || why.length > 500) return { ok: false, reason: 'reason_required' };
  const days = Number(validDays);
  if (!Number.isInteger(days) || days < 1 || days > 30) return { ok: false, reason: 'invalid_validity' };
  const q = await quoteOffer({ userId, plan, discountPercent, discountUzs, db });
  if (!q.ok) return { ok: false, reason: q.reason, quote: q };
  const expiresAt = new Date(now.getTime() + days * 86400000);
  const r = await db.query(
    `INSERT INTO tariff_offers (user_id, plan, quota_version, quotas, list_price_uzs, discount_uzs, final_price_uzs, min_price_uzs,
                                cost_estimate, cost_model_version, reason, created_by, created_at, expires_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
    [userId, plan, q.quotaVersion, JSON.stringify(q.quotas), q.listPriceUzs, q.discountUzs, q.finalPriceUzs, q.minPriceUzs,
      JSON.stringify({ components: q.cost.components, fixedUzs: q.cost.fixedUzs, paymentFeeBp: q.paymentFeeBp, paymentFeeUzs: q.paymentFeeUzs,
        totalCostUzs: q.totalCostUzs, leftUzs: q.leftUzs, serviceMarginBp: q.serviceMarginBp, confidence: q.confidence, label: q.costModelLabel }),
      q.costModelVersion, why, createdBy, now, expiresAt, draft ? 'draft' : 'active']);
  return { ok: true, offer: r.rows[0], quote: q };
}

/** Offers, newest first; an active one past its expiry is reported (and stored) as expired. */
async function listOffers({ userId = null, status = null, limit = 100, db = pool, now = new Date() } = {}) {
  await db.query(`UPDATE tariff_offers SET status = 'expired' WHERE status = 'active' AND expires_at <= $1`, [now]);
  const r = await db.query(
    `SELECT o.*, a.username, a.full_name, c.username AS created_by_username
       FROM tariff_offers o
       LEFT JOIN admins a ON a.id = o.user_id
       LEFT JOIN admins c ON c.id = o.created_by
      WHERE ($1::int IS NULL OR o.user_id = $1) AND ($2::text IS NULL OR o.status = $2)
      ORDER BY o.created_at DESC LIMIT $3`,
    [userId, status, Math.min(500, Math.max(1, Number(limit) || 100))]);
  return r.rows;
}

/** Revoke an active or draft offer; a redeemed one keeps its period. */
async function revokeOffer({ offerId, revokedBy, reason = '', db = pool, now = new Date() }) {
  if (!(await isMaster(db, revokedBy))) return { ok: false, reason: 'master_only' };
  const r = await db.query(
    `UPDATE tariff_offers SET status = 'revoked', revoked_at = $2, revoked_by = $3, revoke_reason = $4
      WHERE id = $1 AND status IN ('active', 'draft') RETURNING *`,
    [offerId, now, revokedBy, String(reason || '').slice(0, 500) || null]);
  if (!r.rows[0]) {
    const cur = await db.query('SELECT status FROM tariff_offers WHERE id = $1', [offerId]);
    return { ok: false, reason: cur.rows[0] ? `offer_${cur.rows[0].status}` : 'offer_not_found' };
  }
  return { ok: true, offer: r.rows[0] };
}

/**
 * Before a payment starts (a provider checkout, or a master about to take a
 * payment): is the offer still active and its price still above the floor
 * under the current cost model? A stale offer is reported, not repriced;
 * once a payment is accepted the offer's price is honoured.
 */
async function checkOffer({ offerId, db = pool, now = new Date() }) {
  const r = await db.query('SELECT * FROM tariff_offers WHERE id = $1', [offerId]);
  const o = r.rows[0];
  if (!o) return { ok: false, reason: 'offer_not_found' };
  if (o.status === 'active' && new Date(o.expires_at) <= now) return { ok: false, reason: 'offer_expired', offer: o };
  if (o.status !== 'active') return { ok: false, reason: `offer_${o.status}`, offer: o };
  let measured = null;
  try { measured = await ledger.measuredServiceCost({ days: 30, db }); } catch (_) { measured = null; }
  const model = pricing.costModel();
  const cost = pricing.conservativeCost(o.plan, { model, measured });
  if (!cost.ok) return { ok: false, reason: cost.reason, offer: o };
  const min = pricing.minimumPrice(cost.fixedUzs, model.paymentFeeBp || 0);
  const stale = model.version !== o.cost_model_version || min > o.final_price_uzs;
  return { ok: !(min > o.final_price_uzs), stale, currentMinPriceUzs: min, costModelVersion: model.version, offer: o,
    reason: min > o.final_price_uzs ? 'offer_below_current_minimum' : null };
}

module.exports = { quoteOffer, createOffer, listOffers, revokeOffer, checkOffer };
