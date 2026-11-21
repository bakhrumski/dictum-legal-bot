'use strict';

/**
 * Lawyer services sold through the platform (2026-10-21, owner): the lawyer
 * sets the price of a review or a document (service_orders.quoted_price_minor,
 * whole so'm as the admin pages enter it); the platform keeps a percentage of
 * every such service and the lawyer gets the rest.
 *
 * The percentage is LAWYER_COMMISSION_PCT (0-50). Until the owner sets it,
 * the split is not recorded (NULL - never a guessed 0 or default) and the
 * admin page says it is missing. The split is written with the quote, so a
 * later change of the percentage does not rewrite orders already priced.
 */

function commissionPct() {
  const raw = process.env.LAWYER_COMMISSION_PCT;
  if (raw == null || String(raw).trim() === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 50 ? v : null;
}

/** { pct, feeMinor, payoutMinor } of a price, or nulls when the percentage is not set. */
function split(priceMinor, pct = commissionPct()) {
  const price = Number(priceMinor);
  if (!Number.isSafeInteger(price) || price < 0 || pct == null) return { pct: null, feeMinor: null, payoutMinor: null };
  const feeMinor = Math.round(price * pct / 100);
  return { pct, feeMinor, payoutMinor: price - feeMinor };
}

async function ensureColumns(db) {
  await db.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS platform_fee_pct NUMERIC(5,2)`);
  await db.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS platform_fee_minor BIGINT`);
  await db.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS lawyer_payout_minor BIGINT`);
}

/** The message a customer gets when the lawyer's price is approved. */
function quoteMessage(order, { formatUzs }) {
  const kind = order.intake_data && order.intake_data.kind === 'lawyer_review' ? 'Yurist tekshiruvi' : 'Yurist xizmati';
  return [
    `👨‍⚖️ ${kind} (#${order.id}): yurist narxni belgiladi — ${formatUzs(order.quoted_price_minor)}.`,
    '',
    "To'lov hozircha administrator orqali qabul qilinadi (Click / Payme tez orada ulanadi): administrator siz bilan shu chatda bog'lanadi. Rozilik bermaguningizcha va to'lamaguningizcha ish boshlanmaydi.",
  ].join('\n');
}

module.exports = { commissionPct, split, ensureColumns, quoteMessage };
