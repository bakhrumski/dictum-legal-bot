'use strict';

/**
 * Telegram Stars (DECISIONS.md D-12, audit M6): a payment is honoured at the
 * price and credit count written into its invoice, not at whatever the
 * environment says when the payment lands; a payment that cannot be credited
 * is refunded; the broken legacy /api/subscription/* routes are gone.
 *
 *   node tests/telegram-stars-invoice.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const inv = require('../src/bot/stars-invoice');

const SECRET = 'test-bot-token';
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

console.log('Telegram Stars invoices');

test('the offer round-trips through the payload', () => {
  const p = inv.buildAnswerInvoicePayload({ telegramUserId: 42, stars: 1, credits: 4, secret: SECRET });
  assert.ok(Buffer.byteLength(p) <= 128, 'Telegram payload limit');
  assert.deepStrictEqual(inv.parseAnswerInvoicePayload(p, 42, { secret: SECRET }), { stars: 1, credits: 4, version: 2 });
});

test('a price change after the invoice does not void the payment (M6)', () => {
  // Invoice issued at 1 Star / 4 answers; env later moves to 5 Stars / 25.
  const p = inv.buildAnswerInvoicePayload({ telegramUserId: 42, stars: 1, credits: 4, secret: SECRET });
  const offer = inv.parseAnswerInvoicePayload(p, 42, { secret: SECRET, legacy: { stars: 5, credits: 25 } });
  assert.ok(inv.matchesOffer(offer, 'XTR', 1), 'paid amount matches the invoice');
  assert.strictEqual(offer.credits, 4, 'credits are what the invoice promised');
});

test('another user, a wrong amount, a wrong currency or a forged payload is refused', () => {
  const p = inv.buildAnswerInvoicePayload({ telegramUserId: 42, stars: 1, credits: 4, secret: SECRET });
  assert.strictEqual(inv.parseAnswerInvoicePayload(p, 43, { secret: SECRET }), null);
  const offer = inv.parseAnswerInvoicePayload(p, 42, { secret: SECRET });
  assert.strictEqual(inv.matchesOffer(offer, 'XTR', 2), false);
  assert.strictEqual(inv.matchesOffer(offer, 'USD', 1), false);
  const forged = p.replace(':1:4:', ':1:400:');
  assert.strictEqual(inv.parseAnswerInvoicePayload(forged, 42, { secret: SECRET }), null);
  assert.strictEqual(inv.parseAnswerInvoicePayload(p, 42, { secret: 'other' }), null);
});

test('invoices issued before the change (v1) are honoured at the legacy offer', () => {
  const v1 = 'juristai_answers_v1:42:abcdef0123456789';
  assert.deepStrictEqual(inv.parseAnswerInvoicePayload(v1, 42, { secret: SECRET, legacy: { stars: 1, credits: 4 } }),
    { stars: 1, credits: 4, version: 1 });
  assert.strictEqual(inv.parseAnswerInvoicePayload(v1, 7, { secret: SECRET, legacy: { stars: 1, credits: 4 } }), null);
});

test('the bot builds, checks and credits from the payload offer, and refunds', () => {
  const bot = read('src/bot/bot.js');
  assert.ok(/starsInvoice\.buildAnswerInvoicePayload\(/.test(bot));
  assert.ok(/pre_checkout_query[\s\S]{0,200}starsInvoice\.matchesOffer\(\s*readAnswerOffer\(query\.invoice_payload/.test(bot));
  assert.ok(/credits: offer\.credits,/.test(bot), 'grant uses the invoice credits');
  assert.ok(!/grantPaidAnswers\(\{[^}]*credits: PAID_ANSWER_CREDITS/.test(bot), 'no grant at the current env value');
  assert.ok(/_request\('refundStarPayment'/.test(bot));
  assert.ok(/paid answer credit failed[\s\S]{0,200}refundStars\(/.test(bot), 'a failed grant is refunded');
  assert.ok(/if \(granted && granted\.credited\)/.test(bot), 'receipt sent outside the refund path');
});

test('legacy /api/subscription/* routes are removed', () => {
  const routes = read('src/rag/advanced-routes.js');
  assert.ok(!/app\.(get|post)\('\/api\/subscription\//.test(routes));
  assert.ok(!/TIER_LIMITS|setTier/.test(routes));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
