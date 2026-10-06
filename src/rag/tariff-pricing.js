'use strict';

/**
 * Individual discounts and the price floor (2026-10-05, docs/tariffs-v2.md §9).
 *
 * A master may offer one user one paid plan for one 30-day period at a
 * discount. The price after discount must cover a CONSERVATIVE estimate of
 * what the period can cost to serve, under the 80% cost target:
 *
 *     finalPrice >= conservativeTotalServiceCost / 0.80
 *
 * The conservative cost is the period's quotas used in full (every AI stage,
 * embeddings, checks, retries, fallbacks - the planning unit budgets cover
 * the whole job), included OCR, the payment fee, and the operations share
 * (hosting, database, storage, support; the Workspace share for Platinum).
 * It never uses a user's own low usage, an average, a p95, or an unproven
 * cache saving. A payment fee that is a share of the price is solved for:
 *
 *     fixed + price * fee <= 0.80 * price   =>   price >= fixed / (0.80 - fee)
 *
 * Money is whole so'm (integers); rates are basis points; costs round up and
 * the minimum price rounds up to 1 000 so'm. A cost component that is
 * unknown and has no reasoned reserve blocks new offers (never counted as 0).
 *
 * The starting figures are the owner's planning budgets (not measured costs):
 * Silver 120 000 -> min 150 000, Gold 360 000 -> 450 000, Platinum 600 000 ->
 * 750 000. TARIFF_COST_MODEL (JSON) replaces them; the measured cost per
 * service can only RAISE the AI component, never lower it.
 */

const ledger = require('./tariff-ledger');

const CEILING_BP = 8000;          // 80% of the price, in basis points
const ROUND_TO_UZS = 1000;
const QUOTA_VERSION = 'tariffs-v2-2026-10-04';
const som = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/gu, ' ');

function intCeilDiv(a, b) { return Math.floor((a + b - 1) / b); }

/** AI cost of a plan's full quotas at the planning unit budgets, in so'm, rounded up. */
function plannedAiUzs(plan) {
  const q = ledger.PLAN_CATALOG[plan].quotas;
  // unit budgets as integer micro-dollars: 0.025 -> 25 000
  const micro = Object.fromEntries(Object.entries(ledger.PLANNING.unitUsd).map(([k, v]) => [k, Math.round(v * 1e6)]));
  const microUsd = Object.entries(micro).reduce((s, [k, m]) => s + (q[k] || 0) * m, 0);
  return intCeilDiv(microUsd * ledger.PLANNING.uzsPerUsd, 1e6);
}

/**
 * OCR of a plan at 100%: every analysis and opinion unit on a different
 * scan (10 pages a unit) plus the chat-scan pool, at the per-page estimate
 * of src/ocr/scan-limits.js. Where that estimate does not apply (no Gemini
 * key, or the unbounded fallback switched on) the component is unknown with
 * no reserve - and no new discount offer is made (conservativeCost).
 */
function ocrComponent(plan) {
  const o = ledger.planOcr(plan);
  const label = `OCR: skan hujjatlar, ${o.pages} sahifa (tahlil + xulosa birliklari turli skanlarda, chatdagi skan chegarasi)`;
  if (o.status !== 'estimated') return { key: 'ocr', label, status: 'unknown', basis: o.reason };
  return { key: 'ocr', label, uzs: Math.ceil(o.usd * ledger.PLANNING.uzsPerUsd), status: 'estimated',
    basis: `${o.pages} pages x $${o.usdPerPage.toFixed(6)} per page - conservative upper budget, not measured (${o.estimate.model}, ${o.estimate.api}; input ${o.estimate.inputTokens} + output ${o.estimate.outputTokens} tokens, thinking 0 assumed, x${o.estimate.attempts} attempts; price: ${o.estimate.priceSource})` };
}

/** The default cost model: the owner's planning budgets, marked estimated. */
function defaultCostModel() {
  const plans = {};
  for (const plan of ledger.PAID_PLAN_ORDER) {
    plans[plan] = {
      components: [
        { key: 'ai', label: "AI: limitlarning 100% i, barcha bosqichlar (generatsiya, retrieval, embedding, tekshiruv, retry/fallback)", uzs: plannedAiUzs(plan), status: 'estimated',
          basis: 'catalogue quotas x owner planning unit budgets; no cache saving assumed' },
        ocrComponent(plan),
        { key: 'ops', label: plan === 'platinum' ? 'Operatsion ulush: hosting, DB, storage, support, Workspace' : 'Operatsion ulush: hosting, DB, storage, support', uzs: ledger.PLANNING.opsUzs[plan], status: 'estimated',
          basis: "owner's operations allotment" },
      ],
    };
  }
  return {
    // OCR joined the model (2026-10-06): offers made under v1 are quoted again
    version: require('../ocr/scan-limits').ocrCostBasis().status === 'estimated' ? 'cm-2026-10-06-planning-v2-ocr' : 'cm-2026-10-06-planning-v2-ocr-unknown',
    label: 'taxminiy (egasining planlash budjeti, o\'lchanmagan)',
    // the floors rest on planning budgets, not on measured cost
    measured: false,
    basisNote: "Minimal narxlar o'lchangan xarajatga emas, egasining o'lchanmagan planlash budjetiga va OCR sahifasi uchun manbali taxminga asoslangan.",
    // a share of the price. 0 is the scope of this model, not a measured
    // fee: no payment provider is connected and a payment is taken by hand
    // (master grant). An offer quoted under this scope is not redeemed
    // through a provider, or under another fee, until it is quoted again.
    paymentFeeBp: 0,
    feeScope: {
      providers: ['manual'],
      label: "To'lov provayderi ulanmagan: to'lov qo'lda qabul qilinadi (master grant). Komissiya 0 — faqat shu holat uchun; provayder ulanganda narx modeli qayta tekshiriladi.",
    },
    plans,
  };
}

/**
 * Why an offer must not be redeemed now, or null: it was quoted under a
 * cost model or a payment-fee scope that is no longer the one in force (a
 * provider connected, a fee changed, the model revised). It is not
 * repriced: a master checks it and makes a new offer.
 */
function offerBlockedReason(offer, { provider = 'manual', model = costModel() } = {}) {
  const est = (offer && offer.cost_estimate) || {};
  const scope = est.feeScope || { providers: ['manual'] };
  const providers = Array.isArray(scope.providers) ? scope.providers : ['manual'];
  if (!providers.includes(String(provider || 'manual'))) return 'offer_fee_scope_changed';
  if (Number(est.paymentFeeBp || 0) !== Number(model.paymentFeeBp || 0)) return 'offer_fee_scope_changed';
  if (offer.cost_model_version !== (model.version || 'unversioned')) return 'offer_cost_model_changed';
  return null;
}

let override = null;
let overrideRaw = null;
/** The cost model in force: TARIFF_COST_MODEL (JSON) or the default. */
function costModel() {
  const raw = process.env.TARIFF_COST_MODEL || '';
  if (raw && raw !== overrideRaw) {
    overrideRaw = raw;
    try { override = JSON.parse(raw); } catch (_) { override = { invalid: true }; }
  }
  if (raw && override) return override;
  return defaultCostModel();
}

/**
 * Conservative service cost of one 30-day period of `plan`, excluding the
 * payment fee (it depends on the price). measured (optional): the measured
 * cost per service from ledger.measuredServiceCost - used only to RAISE the
 * AI component when a measured unit cost exceeds its planning budget.
 * Returns { ok, fixedUzs, components, reason?, statuses }.
 */
function conservativeCost(plan, { model = costModel(), measured = null } = {}) {
  if (model.invalid) return { ok: false, reason: 'cost_model_invalid', components: [] };
  const cfg = model.plans && model.plans[plan];
  if (!cfg || !Array.isArray(cfg.components) || !cfg.components.length) return { ok: false, reason: 'cost_model_missing_plan', components: [] };
  const components = [];
  const missing = [];
  for (const c of cfg.components) {
    let uzs = Number.isInteger(c.uzs) ? c.uzs : null;
    let status = c.status || 'unknown';
    if (status === 'unknown') {
      // an unknown cost counts only with a reasoned conservative reserve - never as 0
      if (Number.isInteger(c.reserveUzs) && c.reserveUzs > 0 && c.reserveBasis) { uzs = c.reserveUzs; status = 'reserve'; }
      else { missing.push(c.key); continue; }
    }
    if (!Number.isInteger(uzs) || uzs < 0) { missing.push(c.key); continue; }
    components.push({ key: c.key, label: c.label, uzs, status, basis: c.basis || c.reserveBasis || null });
  }
  if (measured && Array.isArray(measured)) {
    const ai = components.find(c => c.key === 'ai');
    const q = ledger.PLAN_CATALOG[plan].quotas;
    if (ai) {
      let measuredMicro = 0;
      let used = false;
      for (const [svc, budget] of Object.entries(ledger.PLANNING.unitUsd)) {
        const m = measured.find(x => x.service === svc);
        const perUnit = m && m.knownUsdPerUnit != null && m.knownUsdPerUnit > budget ? m.knownUsdPerUnit : budget;
        if (perUnit > budget) used = true;
        measuredMicro += (q[svc] || 0) * Math.round(perUnit * 1e6);
      }
      const raised = intCeilDiv(measuredMicro * ledger.PLANNING.uzsPerUsd, 1e6);
      if (used && raised > ai.uzs) { ai.uzs = raised; ai.status = 'measured_above_plan'; ai.basis = 'measured known cost per unit exceeded the planning budget'; }
    }
  }
  if (missing.length) return { ok: false, reason: 'unknown_cost_without_reserve', missing, components };
  const fixedUzs = components.reduce((s, c) => s + c.uzs, 0);
  return { ok: true, fixedUzs, components };
}

/** Lowest allowed price: fixed / (0.80 - fee), rounded UP to 1 000 so'm. */
function minimumPrice(fixedUzs, paymentFeeBp = 0) {
  const room = CEILING_BP - paymentFeeBp;
  if (room <= 0) return null;
  const raw = intCeilDiv(fixedUzs * 10000, room);
  return intCeilDiv(raw, ROUND_TO_UZS) * ROUND_TO_UZS;
}

/**
 * Parse a discount: { discountPercent } (up to 2 decimals, 0 < p < 100) or
 * { discountUzs } (whole so'm). Returns discount in so'm (percent rounds the
 * discount DOWN, so the price never drops below what was asked).
 */
function parseDiscount(listPriceUzs, { discountPercent = null, discountUzs = null } = {}) {
  if (discountPercent != null && discountPercent !== '' && discountUzs != null && discountUzs !== '') return { error: 'one_of_percent_or_amount' };
  if (discountPercent != null && discountPercent !== '') {
    const s = String(discountPercent).trim();
    if (!/^\d{1,2}(\.\d{1,2})?$/u.test(s)) return { error: 'invalid_percent' };
    const bp = Math.round(Number(s) * 100);
    if (bp <= 0 || bp >= 10000) return { error: 'invalid_percent' };
    return { discountUzs: Math.floor(listPriceUzs * bp / 10000), percentBp: bp };
  }
  if (discountUzs != null && discountUzs !== '') {
    const n = Number(discountUzs);
    if (!Number.isInteger(n) || n <= 0 || n >= listPriceUzs) return { error: 'invalid_amount' };
    return { discountUzs: n, percentBp: Math.floor(n * 10000 / listPriceUzs) };
  }
  return { error: 'discount_required' };
}

/**
 * The server's quote for a discount on `plan`. Never adjusts the discount:
 * a price under the floor is refused with the largest allowed discount.
 */
function quoteDiscount({ plan, discountPercent = null, discountUzs = null, measured = null }) {
  const cfg = ledger.PLAN_CATALOG[plan];
  if (!cfg || !ledger.PAID_PLAN_ORDER.includes(plan)) return { ok: false, reason: 'not_a_paid_plan' };
  const model = costModel();
  const listPriceUzs = cfg.priceUzs;
  const cost = conservativeCost(plan, { model, measured });
  const base = {
    plan, listPriceUzs, quotas: cfg.quotas, quotaVersion: QUOTA_VERSION,
    costModelVersion: model.version || 'unversioned', costModelLabel: model.label || null,
    costMeasured: model.measured === true, basisNote: model.basisNote || null,
    paymentFeeBp: model.paymentFeeBp || 0, feeScope: model.feeScope || null, cost,
  };
  if (!cost.ok) {
    return { ...base, ok: false, reason: cost.reason, message: cost.reason === 'unknown_cost_without_reserve'
      ? `Xarajat noma'lum va asoslangan zaxira yo'q: ${cost.missing.join(', ')}. Chegirmali taklif yaratib bo'lmaydi.`
      : "Xarajat modeli yaroqsiz yoki bu tarif uchun yo'q. Chegirmali taklif yaratib bo'lmaydi." };
  }
  const minPriceUzs = minimumPrice(cost.fixedUzs, base.paymentFeeBp);
  const maxDiscountUzs = Math.max(0, listPriceUzs - minPriceUzs);
  const floor = { minPriceUzs, maxDiscountUzs, maxDiscountPercent: Math.floor(maxDiscountUzs * 10000 / listPriceUzs) / 100 };
  if (minPriceUzs == null || minPriceUzs > listPriceUzs) {
    return { ...base, ...floor, ok: false, reason: 'catalogue_price_below_floor', economicsWarning: true,
      message: `Diqqat: konservativ xarajat bo'yicha minimal narx (${minPriceUzs}) katalog narxidan (${listPriceUzs}) yuqori. Chegirma berilmaydi; tarif iqtisodiyotini qayta ko'rib chiqish kerak. Sotib olingan huquqlar o'zgarmaydi.` };
  }
  const d = parseDiscount(listPriceUzs, { discountPercent, discountUzs });
  if (d.error) return { ...base, ...floor, ok: false, reason: d.error };
  const finalPriceUzs = listPriceUzs - d.discountUzs;
  const feeUzs = intCeilDiv(finalPriceUzs * base.paymentFeeBp, 10000);
  const totalCostUzs = cost.fixedUzs + feeUzs;
  const quote = {
    ...base, ...floor, discountUzs: d.discountUzs, discountPercentBp: d.percentBp, finalPriceUzs,
    paymentFeeUzs: feeUzs, aiCostUzs: (cost.components.find(c => c.key === 'ai') || {}).uzs || 0, totalCostUzs,
    leftUzs: finalPriceUzs - totalCostUzs,
    serviceMarginBp: Math.floor((finalPriceUzs - totalCostUzs) * 10000 / finalPriceUzs),
    costShareBp: intCeilDiv(totalCostUzs * 10000, finalPriceUzs),
    confidence: cost.components.some(c => c.status === 'measured_above_plan') ? 'estimated+measured' : 'estimated',
  };
  if (finalPriceUzs < minPriceUzs) {
    return { ...quote, ok: false, reason: 'below_minimum',
      message: `Yakuniy narx ${som(finalPriceUzs)} so'm minimal ruxsat etilgan ${som(minPriceUzs)} so'mdan past. Eng katta ruxsat etilgan chegirma: ${som(maxDiscountUzs)} so'm (${floor.maxDiscountPercent}%).` };
  }
  return { ...quote, ok: true };
}

module.exports = {
  CEILING_BP, QUOTA_VERSION, defaultCostModel, costModel, conservativeCost, minimumPrice, parseDiscount, quoteDiscount, plannedAiUzs, offerBlockedReason,
};
