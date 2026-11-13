'use strict';

/**
 * One-time services (2026-10-21, owner's decision): a person who does not
 * want a plan - or whose Sinov is spent - buys one service at a time.
 *
 *   chat5     5 legal questions            15 000 so'm
 *   draft     an AI document draft (.docx) 29 000 so'm
 *   analysis  AI document analysis, 1 unit 39 000 so'm (10 pages / 40 000 chars)
 *   opinion   AI legal opinion, 1 unit     49 000 so'm
 *
 * Prices are the owner's starting point, to be changed with real demand.
 * Until Click / Payme are connected the bot sells them for Telegram Stars:
 * the Stars price is set so that the payout (about STAR_PAYOUT_USD a Star,
 * after the stores' and Telegram's share) covers the so'm price, so in Stars
 * it is dearer than it will be by card. Each price is checked against the
 * planning cost of the units (cost / 0.80, the plans' own rule).
 *
 * What a purchase buys is a credit in the tariff ledger
 * (tariff-ledger grantOneTimeCredit): used only when the plan does not cover
 * the job, never expires, shared by the bot and the website.
 */

const { PLANNING } = require('./tariff-ledger');

const PRODUCTS = Object.freeze({
  chat5: Object.freeze({ key: 'chat5', service: 'chat', units: 5, priceUzs: 15000,
    title: '5 ta huquqiy savol', titleRu: '5 правовых вопросов',
    description: "5 ta AI huquqiy javob, lex.uz manbasi bilan. Obuna emas, muddati tugamaydi." }),
  draft: Object.freeze({ key: 'draft', service: 'draft', units: 1, priceUzs: 29000,
    title: 'AI hujjat loyihasi', titleRu: 'AI-проект документа',
    description: "Ariza, talabnoma, shikoyat yoki da'vo arizasi loyihasi .docx faylda. Yuborishdan oldin o'zingiz tekshiring." }),
  analysis: Object.freeze({ key: 'analysis', service: 'analysis', units: 1, priceUzs: 39000,
    title: 'AI hujjat tahlili', titleRu: 'AI-анализ документа',
    description: "Hujjatni AI tahlili (10 betgacha): xavfli va yetishmayotgan bandlar, tavsiyalar." }),
  opinion: Object.freeze({ key: 'opinion', service: 'opinion', units: 1, priceUzs: 49000,
    title: 'AI yuridik xulosa', titleRu: 'AI-юридическое заключение',
    description: "Hujjat yoki vaziyat bo'yicha yozma AI yuridik xulosa (10 betgacha)." }),
});

// what one Star brings in after the stores' and Telegram's share (USD);
// the owner can correct it from the payouts actually received
function starPayoutUsd() {
  const v = Number(process.env.STAR_PAYOUT_USD);
  return Number.isFinite(v) && v > 0 ? v : 0.013;
}

/** Stars price of one unit of a product: ONE_TIME_STARS_<KEY> or the so'm price at the payout rate, up to the next 10. */
function starsFor(key) {
  const p = PRODUCTS[key];
  if (!p) return null;
  const env = Number.parseInt(process.env[`ONE_TIME_STARS_${key.toUpperCase()}`] || '', 10);
  if (Number.isInteger(env) && env > 0) return env;
  return Math.ceil(p.priceUzs / PLANNING.uzsPerUsd / starPayoutUsd() / 10) * 10;
}

/** The planning cost and the floor (cost / 0.80) of a product, so'm. */
function economics(key) {
  const p = PRODUCTS[key];
  if (!p) return null;
  const costUzs = Math.round(p.units * (PLANNING.unitUsd[p.service] || 0) * PLANNING.uzsPerUsd);
  const floorUzs = Math.ceil(costUzs / PLANNING.costCeilingShare / 1000) * 1000;
  const stars = starsFor(key);
  const starsPayoutUzs = Math.round(stars * starPayoutUsd() * PLANNING.uzsPerUsd);
  return { key, priceUzs: p.priceUzs, costUzs, floorUzs, aboveFloor: p.priceUzs >= floorUzs,
    stars, starsPayoutUzs, starsAboveFloor: starsPayoutUzs >= floorUzs, basis: 'planning budgets, not measured cost' };
}

/** "29 000 so'm" */
function formatUzs(n) {
  return `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/gu, ' ')} so'm`;
}

/** Button label: "📄 AI loyiha — 190 ⭐" (qty > 1: "2 × 250 ⭐"). */
function starsLabel(key, qty = 1) {
  const s = starsFor(key);
  return qty > 1 ? `${qty} × ${s} ⭐` : `${s} ⭐`;
}

module.exports = { PRODUCTS, starsFor, starPayoutUsd, economics, formatUzs, starsLabel };
