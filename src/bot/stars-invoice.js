'use strict';

/**
 * Telegram Stars invoices for paid bot answers (DECISIONS.md D-12).
 *
 * The offer (price in Stars and number of answers) is written into the
 * invoice payload when the invoice is created, and the payment is honoured
 * against that payload, not against the environment at payment time. Before,
 * changing TG_PAID_ANSWER_STARS between invoice and payment charged the user
 * and granted nothing (audit M6).
 *
 * Payload: juristai_answers_v2:<telegramUserId>:<stars>:<credits>:<nonce>:<sig>
 * sig = first 16 hex of HMAC-SHA256(secret, everything before it). Only the
 * bot can issue invoices, so the signature is a second check, not the only one.
 * Telegram limits the payload to 128 bytes; this is well under.
 */

const crypto = require('crypto');

const PREFIX_V2 = 'juristai_answers_v2';
const PREFIX_V1 = 'juristai_answers_v1';

function sign(body, secret) {
  return crypto.createHmac('sha256', String(secret || '')).update(body).digest('hex').slice(0, 16);
}

function buildAnswerInvoicePayload({ telegramUserId, stars, credits, secret, nonce }) {
  const n = nonce || crypto.randomBytes(6).toString('hex');
  const body = `${PREFIX_V2}:${telegramUserId}:${stars}:${credits}:${n}`;
  return `${body}:${sign(body, secret)}`;
}

/**
 * Read the offer back. Returns { stars, credits, version } or null when the
 * payload is not ours, belongs to another user, or fails its signature.
 * v1 payloads (issued before this change) carried no offer, so they are
 * honoured at `legacy` prices — what the old code did.
 */
function parseAnswerInvoicePayload(payload, telegramUserId, { secret, legacy } = {}) {
  const p = String(payload || '');
  const parts = p.split(':');
  if (parts[0] === PREFIX_V2 && parts.length === 6) {
    const [, uid, stars, credits, , sig] = parts;
    if (uid !== String(telegramUserId)) return null;
    const body = parts.slice(0, 5).join(':');
    const expected = sign(body, secret);
    if (sig.length !== expected.length
      || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const s = Number(stars), c = Number(credits);
    if (!Number.isInteger(s) || s < 1 || !Number.isInteger(c) || c < 1) return null;
    return { stars: s, credits: c, version: 2 };
  }
  if (parts[0] === PREFIX_V1 && parts[1] === String(telegramUserId) && legacy) {
    return { stars: legacy.stars, credits: legacy.credits, version: 1 };
  }
  return null;
}

/** Is this payment (or pre-checkout query) exactly the offer in its payload? */
function matchesOffer(offer, currency, totalAmount) {
  return !!offer && currency === 'XTR' && totalAmount === offer.stars;
}

// ── One-time services (2026-10-21, src/rag/one-time-products.js) ──────────
// Payload: jsv1:<telegramUserId>:<product>:<qty>:<starsEach>:<nonce>:<sig>.
// The price is the one written when the invoice was made; the total charged
// must be qty x starsEach.
const PREFIX_SERVICE = 'jsv1';

function buildServiceInvoicePayload({ telegramUserId, product, qty = 1, stars, secret, nonce }) {
  const n = nonce || crypto.randomBytes(6).toString('hex');
  const body = `${PREFIX_SERVICE}:${telegramUserId}:${product}:${qty}:${stars}:${n}`;
  return `${body}:${sign(body, secret)}`;
}

/** { product, qty, stars, total } or null (not ours, another user, a bad signature or numbers). */
function parseServiceInvoicePayload(payload, telegramUserId, { secret } = {}) {
  const parts = String(payload || '').split(':');
  if (parts[0] !== PREFIX_SERVICE || parts.length !== 7) return null;
  const [, uid, product, qty, stars, , sig] = parts;
  if (uid !== String(telegramUserId) || !/^[a-z0-9]{2,12}$/u.test(product)) return null;
  const expected = sign(parts.slice(0, 6).join(':'), secret);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const q = Number(qty), s = Number(stars);
  if (!Number.isInteger(q) || q < 1 || q > 10 || !Number.isInteger(s) || s < 1) return null;
  return { product, qty: q, stars: s, total: q * s };
}

function matchesServiceOffer(offer, currency, totalAmount) {
  return !!offer && currency === 'XTR' && totalAmount === offer.total;
}

module.exports = { buildAnswerInvoicePayload, parseAnswerInvoicePayload, matchesOffer, PREFIX_V1, PREFIX_V2,
  buildServiceInvoicePayload, parseServiceInvoicePayload, matchesServiceOffer, PREFIX_SERVICE };
