'use strict';

/**
 * Selling one-time services in the bot for Telegram Stars (2026-10-21,
 * src/rag/one-time-products.js).
 *
 *   button ots_<product>_<qty>  -> a Stars invoice whose payload carries the
 *                                  product, quantity and price (signed)
 *   pre_checkout_query          -> accepted only for exactly that price
 *   successful_payment          -> the units are added to the payer's
 *                                  one-time credit (idempotent by Telegram's
 *                                  charge id); if that fails, the Stars go back
 *   then                        -> the job the person was buying (the draft or
 *                                  the analysis it was offered for) runs at
 *                                  once; otherwise the units wait, unexpired
 *
 * Nothing is charged by a button: Telegram's own payment sheet shows the
 * price and the person confirms it there.
 */

const starsInvoice = require('./stars-invoice');
const products = require('../rag/one-time-products');

const RESUME_TTL_MS = 30 * 60 * 1000;

/**
 * deps: bot, ledger (tariff-ledger), identityOf(msgOrQuery) -> { telegramUserId, adminId },
 * secret (the bot token), refundStars(telegramUserId, chargeId) -> bool.
 */
function createOneTimeSales(deps) {
  const resumes = new Map(); // chatId -> { product, run, at }

  function button(product, qty = 1, label = null) {
    const p = products.PRODUCTS[product];
    if (!p) return null;
    return { text: label || `${p.title} — ${products.starsLabel(product, qty)}`, callback_data: `ots_${product}_${qty}` };
  }

  /** What to do once this product is paid in this chat (the draft or analysis it was offered for). */
  function setResume(chatId, product, run) {
    resumes.set(String(chatId), { product, run, at: Date.now() });
  }

  async function sendInvoice(chatId, telegramUserId, product, qty = 1) {
    const p = products.PRODUCTS[product];
    const stars = products.starsFor(product);
    const payload = starsInvoice.buildServiceInvoicePayload({ telegramUserId, product, qty, stars, secret: deps.secret });
    const title = qty > 1 ? `${p.title} × ${qty}` : p.title;
    return deps.bot.sendInvoice(chatId, title.slice(0, 32),
      `${p.description} Narx: ${products.formatUzs(p.priceUzs * qty)}; Stars orqali ${stars * qty} ⭐. Texnik xatoda birlik qaytariladi. To'lov masalalari: /paysupport`.slice(0, 255),
      payload, '', 'XTR', [{ label: title.slice(0, 32), amount: stars * qty }]);
  }

  /** ots_ buttons. true when handled here. */
  async function onCallback(q) {
    const m = /^ots_([a-z0-9]{2,12})_(\d{1,2})$/u.exec(String(q.data || ''));
    if (!m) return false;
    const [, product, qtyRaw] = m;
    const qty = Math.min(10, Math.max(1, Number(qtyRaw)));
    if (!products.PRODUCTS[product]) {
      await deps.bot.answerCallbackQuery(q.id, { text: 'Bu xizmat endi mavjud emas.', show_alert: true }).catch(() => {});
      return true;
    }
    try {
      await deps.bot.answerCallbackQuery(q.id, { text: "To'lov oynasi ochildi" }).catch(() => {});
      await sendInvoice(q.message.chat.id, q.from.id, product, qty);
    } catch (e) {
      console.error('[OTS] invoice failed:', e.message);
      await deps.bot.sendMessage(q.message.chat.id, "To'lov oynasini hozir ochib bo'lmadi. Birozdan keyin qayta urinib ko'ring.").catch(() => {});
    }
    return true;
  }

  /** null when the payload is not a one-time service; else whether it is valid. */
  function checkPreCheckout(query) {
    if (!String(query.invoice_payload || '').startsWith(`${starsInvoice.PREFIX_SERVICE}:`)) return null;
    const offer = starsInvoice.parseServiceInvoicePayload(query.invoice_payload, query.from.id, { secret: deps.secret });
    return !!offer && !!products.PRODUCTS[offer.product] && starsInvoice.matchesServiceOffer(offer, query.currency, query.total_amount);
  }

  /** A successful payment message: true when it was a one-time service (handled here). */
  async function onPayment(msg) {
    const payment = msg.successful_payment;
    if (!payment || !String(payment.invoice_payload || '').startsWith(`${starsInvoice.PREFIX_SERVICE}:`)) return false;
    const chatId = msg.chat.id;
    const charge = payment.telegram_payment_charge_id;
    const offer = starsInvoice.parseServiceInvoicePayload(payment.invoice_payload, msg.from.id, { secret: deps.secret });
    const p = offer && products.PRODUCTS[offer.product];
    if (!p || !starsInvoice.matchesServiceOffer(offer, payment.currency, payment.total_amount)) {
      console.error('[OTS] unexpected payment payload');
      const refunded = payment.currency === 'XTR' && await deps.refundStars(msg.from.id, charge);
      await deps.bot.sendMessage(chatId, refunded
        ? "To'lovni tasdiqlab bo'lmadi, Stars hisobingizga qaytarildi."
        : `To'lovni tasdiqlab bo'lmadi. /paysupport ga yozing. Tranzaksiya: ${charge}`).catch(() => {});
      return true;
    }
    let granted;
    try {
      const who = await deps.identityOf(msg);
      granted = await deps.ledger.grantOneTimeCredit({
        adminId: who.adminId || null, telegramUserId: msg.from.id, service: p.service, units: p.units * offer.qty,
        product: p.key, priceUzs: p.priceUzs * offer.qty, stars: offer.total, provider: 'telegram_stars', paymentRef: `tg:${charge}`,
      });
    } catch (e) {
      console.error('[OTS] credit failed:', e.message);
      const refunded = await deps.refundStars(msg.from.id, charge);
      await deps.bot.sendMessage(chatId, refunded
        ? "Xizmatni qo'shishda xatolik bo'ldi, Stars hisobingizga qaytarildi. Birozdan keyin qayta urinib ko'ring."
        : `To'lov qabul qilindi, ammo xizmatni qo'shishda xatolik bo'ldi. /paysupport ga yozing. Tranzaksiya: ${charge}`).catch(() => {});
      return true;
    }
    if (granted.duplicate) return true; // the same payment notice again: added once already
    const r = resumes.get(String(chatId));
    resumes.delete(String(chatId));
    const fresh = r && r.product === p.key && Date.now() - r.at <= RESUME_TTL_MS;
    await deps.bot.sendMessage(chatId, fresh
      ? `✅ To'lov qabul qilindi: ${p.title}. Hozir bajaraman.`
      : `✅ To'lov qabul qilindi: ${p.title}${offer.qty > 1 ? ` × ${offer.qty}` : ''}. Xizmat hisobingizga qo'shildi, muddati tugamaydi.`
        + (p.service === 'chat' ? '\n\nHuquqiy savolingizni yozing.' : '')).catch(() => {});
    if (fresh) {
      try { await r.run(); } catch (e) { console.error('[OTS] resume failed:', e.message); }
    }
    return true;
  }

  return { button, setResume, sendInvoice, onCallback, checkPreCheckout, onPayment, _resumes: resumes };
}

module.exports = { createOneTimeSales, RESUME_TTL_MS };
