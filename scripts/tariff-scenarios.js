#!/usr/bin/env node
'use strict';

/**
 * Financial scenarios for tariffs v2 from the one catalogue and the owner's
 * planning budgets (src/rag/tariff-ledger.js). Every number here is a
 * PLANNING estimate at 100% use of each quota, not measured cost and not a
 * billing figure; it is regenerated from the code, so the report cannot
 * drift from the limits the backend enforces.
 *
 *   node scripts/tariff-scenarios.js            # markdown tables
 *   node scripts/tariff-scenarios.js --json
 *
 * Inputs that are assumptions are named and can be changed with flags:
 *   --hit-cost-share=0.2   cost of a lawyer-approved answer served from the
 *                          bank, as a share of a generated chat answer
 *                          (retrieval, matching and infrastructure are not 0)
 */

// OCR (2026-10-06) is costed at the per-page estimate of src/ocr/scan-limits.js,
// which holds only on the Gemini path. This offline report assumes that path
// (GEMINI_API_KEY set, OCR_FALLBACK off); in a deployment without it the cost
// model marks OCR unknown and makes no discount offer.
if (!process.env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = 'assumed-for-this-report';
delete process.env.OCR_FALLBACK;
const ledger = require('../src/rag/tariff-ledger');
const scanLimits = require('../src/ocr/scan-limits');

const arg = (name, d) => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : d;
};
const HIT_COST_SHARE = arg('hit-cost-share', 0.2);

const P = ledger.PLANNING;
const C = ledger.PLAN_CATALOG;

function aiUsd(plan, unitUsd = P.unitUsd) {
  const q = C[plan].quotas;
  return Object.entries(unitUsd).reduce((s, [k, usd]) => s + (q[k] || 0) * usd, 0);
}
// OCR at 100%: analysis + opinion units on different scans (10 pages a unit) + the chat-scan pool
const ocrPageUsd = scanLimits.ocrPageUsd();
const ocrUsd = (plan, mult = 1) => ledger.maxOcrPages(plan) * ocrPageUsd * mult;
function serviceUzs(plan, { unitUsd = P.unitUsd, rate = P.uzsPerUsd, opsMult = 1, ocrMult = 1 } = {}) {
  return Math.round((aiUsd(plan, unitUsd) + ocrUsd(plan, ocrMult)) * rate) + Math.round((P.opsUzs[plan] || 0) * opsMult);
}
const trialUzs = (unitUsd = P.unitUsd, rate = P.uzsPerUsd, ocrMult = 1) => Math.round((aiUsd('sinov', unitUsd) + ocrUsd('sinov', ocrMult)) * rate);
const fmt = n => Math.round(n).toLocaleString('ru-RU').replace(/ /gu, ' ');
const mln = n => (n / 1e6).toFixed(2);

function scenario(name, { trials = 0, plans = {}, unitUsd, rate, opsMult } = {}) {
  let revenue = 0, service = 0;
  for (const [plan, n] of Object.entries(plans)) {
    revenue += n * C[plan].priceUzs;
    service += n * serviceUzs(plan, { unitUsd, rate, opsMult });
  }
  const trialCost = trials * trialUzs(unitUsd, rate);
  return { name, revenue, paidService: service, trialCost, result: revenue - service - trialCost };
}

const scenarios = [
  scenario('1. 1 000 yangi Sinov + 100 Silver (hammasi 100%)', { trials: 1000, plans: { silver: 100 } }),
  scenario('2. 100 yangi Sinov + 100 Silver', { trials: 100, plans: { silver: 100 } }),
  scenario('3. 100 Silver renewal, yangi Sinovsiz', { plans: { silver: 100 } }),
  scenario('4. 100 Gold + 100 Platinum', { plans: { gold: 100, platinum: 100 } }),
  scenario('5. 1 Platinum + 4 Silver (bitta Workspace)', { plans: { platinum: 1, silver: 4 } }),
];
const silverLeft = C.silver.priceUzs - serviceUzs('silver');
const breakEvenSilver = Math.ceil(1000 * trialUzs() / silverLeft);

// 6. lawyer-approved answer hit rate: chat answers served from the bank cost
//    HIT_COST_SHARE of a generated one (an assumption until measured)
const hitRates = [0, 0.25, 0.5, 0.75].map(h => {
  const unitUsd = { ...P.unitUsd, chat: P.unitUsd.chat * (1 - h * (1 - HIT_COST_SHARE)) };
  return { hitRate: h, rows: ['silver', 'gold', 'platinum'].map(plan => {
    const s = serviceUzs(plan, { unitUsd });
    return { plan, serviceUzs: s, share: s / C[plan].priceUzs };
  }) };
});

// 7. stress: provider prices / exchange rate +20%, document cost +50%, storage (ops) +50%
const stress = [
  ['provider narxi yoki kurs +20%', { unitUsd: Object.fromEntries(Object.entries(P.unitUsd).map(([k, v]) => [k, v * 1.2])) }],
  ['hujjat tannarxi +50% (tahlil va xulosa $0.45)', { unitUsd: { ...P.unitUsd, analysis: 0.45, opinion: 0.45 } }],
  ['storage/ops +50%', { opsMult: 1.5 }],
  ['OCR sahifa narxi +50%', { ocrMult: 1.5 }],
  ['hammasi birga', { unitUsd: { chat: P.unitUsd.chat * 1.2, analysis: 0.45 * 1.2, opinion: 0.45 * 1.2, draft: P.unitUsd.draft * 1.2 }, opsMult: 1.5, ocrMult: 1.5 }],
].map(([name, o]) => ({ name, rows: ['silver', 'gold', 'platinum'].map(plan => {
  const s = serviceUzs(plan, o);
  return { plan, serviceUzs: s, share: s / C[plan].priceUzs, within80: s <= C[plan].priceUzs * P.costCeilingShare };
}) }));

// 8. individual discounts at the price floor (finalPrice >= conservative cost / 0.80)
const pricing = require('../src/rag/tariff-pricing');
const floors = ['silver', 'gold', 'platinum'].map(plan => {
  const c = pricing.conservativeCost(plan);
  const min = pricing.minimumPrice(c.fixedUzs, pricing.costModel().paymentFeeBp || 0);
  return { plan, listUzs: C[plan].priceUzs, costUzs: c.fixedUzs, minUzs: min, maxDiscountUzs: C[plan].priceUzs - min,
    maxDiscountPct: Math.floor((C[plan].priceUzs - min) * 10000 / C[plan].priceUzs) / 100, costShareAtMin: c.fixedUzs / min };
});
const discountScenario = (() => {
  // 100 Silver customers: 70 at list, 30 at the floor price, all using 100%
  const list = C.silver.priceUzs; const min = floors[0].minUzs; const cost = floors[0].costUzs;
  const revenue = 70 * list + 30 * min; const service = 100 * cost;
  return { name: '100 Silver: 70 katalog narxida, 30 minimal narxda (hammasi 100%)', revenue, service, result: revenue - service,
    catalogRevenue: 100 * list, discountsUzs: 30 * (list - min) };
})();

const out = {
  basis: 'planning budgets at 100% use, not measured cost (src/rag/tariff-ledger.js PLANNING)',
  planning: P, trialUzs: trialUzs(), trialUsd: aiUsd('sinov') + ocrUsd('sinov'), trialUzsWithoutOcr: Math.round(aiUsd('sinov') * P.uzsPerUsd),
  ocr: { usdPerPage: ocrPageUsd, estimate: scanLimits.OCR_PAGE_ESTIMATE, pages: Object.fromEntries(['sinov', 'silver', 'gold', 'platinum'].map(p => [p, ledger.maxOcrPages(p)])) },
  plans: ['silver', 'gold', 'platinum'].map(p => ledger.planEconomics(p)),
  scenarios, breakEvenSilver, hitRates, hitCostShare: HIT_COST_SHARE, stress, floors, discountScenario,
  costModelVersion: pricing.costModel().version,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out, null, 2));
} else {
  const L = [];
  L.push(`Asos: ${out.basis}. Kurs ${P.uzsPerUsd} so'm/$.`, '');
  L.push('| Tarif | Narx | AI budjeti | Operatsion | Jami xizmat | Qoladi | Xizmat marjasi | 80% chegara |', '|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const e of out.plans) L.push(`| ${C[e.plan].label} | ${fmt(e.priceUzs)} | ${fmt(e.aiUzs)} | ${fmt(e.opsUzs)} | ${fmt(e.serviceUzs)} | ${fmt(e.leftUzs)} | ${(e.serviceMargin * 100).toFixed(2)}% | ${fmt(e.ceilingUzs)} |`);
  L.push('', `OCR: sahifa uchun $${ocrPageUsd.toFixed(6)} (Gemini 2.5 Flash, taxmin; manba: ${scanLimits.OCR_PAGE_ESTIMATE.source}). 100% da sahifalar: Sinov ${out.ocr.pages.sinov}, Silver ${out.ocr.pages.silver}, Gold ${out.ocr.pages.gold}, Platinum ${out.ocr.pages.platinum}.`);
  L.push('', `Bitta Sinov AI budjeti (OCR bilan): $${out.trialUsd.toFixed(3)} ≈ ${fmt(out.trialUzs)} so'm (OCR'siz ${fmt(out.trialUzsWithoutOcr)} so'm).`, '');
  L.push('| Ssenariy | Tushum, mln | Pullik xizmat budjeti, mln | Sinov AI, mln | Natija, mln (boshqa xarajatlardan oldin) |', '|---|---:|---:|---:|---:|');
  for (const s of scenarios) L.push(`| ${s.name} | ${mln(s.revenue)} | ${mln(s.paidService)} | ${mln(s.trialCost)} | ${mln(s.result)} |`);
  L.push('', `1 000 Sinovni qoplash uchun kamida ${breakEvenSilver} ta Silver xaridi kerak (har biri ${fmt(silverLeft)} so'm qoldiradi).`, '');
  L.push(`Tasdiqlangan javob hit rate (hit narxi = generatsiyaning ${HIT_COST_SHARE * 100}% — taxmin):`, '', '| Hit rate | Silver | Gold | Platinum |', '|---|---:|---:|---:|');
  for (const h of hitRates) L.push(`| ${h.hitRate * 100}% | ${h.rows.map(r => `${fmt(r.serviceUzs)} (${(r.share * 100).toFixed(1)}%)`).join(' | ')} |`);
  L.push('', 'Stress (jami xizmat budjeti, narxga nisbatan; 80% chegara):', '', '| Holat | Silver | Gold | Platinum |', '|---|---:|---:|---:|');
  for (const s of stress) L.push(`| ${s.name} | ${s.rows.map(r => `${fmt(r.serviceUzs)} (${(r.share * 100).toFixed(1)}%${r.within80 ? '' : ' ⚠ >80%'})`).join(' | ')} |`);
  L.push('', `Individual chegirma chegarasi (xarajat modeli ${out.costModelVersion}, taxminiy):`, '',
    '| Tarif | Katalog | Konservativ xarajat | Minimal narx (xarajat / 0,80, 1 000 ga yuqoriga) | Eng katta chegirma | Minimal narxda xarajat ulushi |', '|---|---:|---:|---:|---:|---:|');
  for (const f of floors) L.push(`| ${C[f.plan].label} | ${fmt(f.listUzs)} | ${fmt(f.costUzs)} | ${fmt(f.minUzs)} | ${fmt(f.maxDiscountUzs)} (${f.maxDiscountPct}%) | ${(f.costShareAtMin * 100).toFixed(1)}% |`);
  const ds = discountScenario;
  L.push('', `${ds.name}: katalog bo'yicha ${mln(ds.catalogRevenue)} mln, haqiqiy tushum ${mln(ds.revenue)} mln (chegirma ${mln(ds.discountsUzs)} mln), xizmat budjeti ${mln(ds.service)} mln, natija ${mln(ds.result)} mln (boshqa xarajatlardan oldin).`);
  console.log(L.join('\n'));
}
