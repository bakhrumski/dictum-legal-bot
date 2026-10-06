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

// OCR (2026-10-06) is costed at the per-page budget of src/ocr/scan-limits.js,
// which holds only on the Gemini-only route. This offline report assumes that
// route (GEMINI_API_KEY, OCR_IMAGE_PROVIDER=gemini, OCR_FALLBACK=off); on any
// other route the cost model marks OCR unknown and makes no discount offer.
if (!process.env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = 'assumed-for-this-report';
process.env.OCR_IMAGE_PROVIDER = 'gemini';
process.env.OCR_FALLBACK = 'off';
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

// 9. chat OCR, A/B (review of #411): where do the 10/80/240/400 chat-scan
//    pages come from, and what do they cost? They are the tariffs v2 rule
//    "10 pages per analysis unit" (PLAN_CATALOG: ocr = analysis x 10), sized
//    on the analysis quota - not on any measured chat-scan demand.
//    A: OCR only inside analysis / opinion; B: A + the chat-scan pages.
const ocrUzs = pages => Math.ceil(pages * ocrPageUsd * P.uzsPerUsd);
const ocrAB = ['sinov', 'silver', 'gold', 'platinum'].map(plan => {
  const q = C[plan].quotas;
  const docPages = ((q.analysis || 0) + (q.opinion || 0)) * ledger.OCR_PAGES_PER_ANALYSIS_UNIT;
  const chatPages = q.ocr || 0;
  // the same AI figure the discount floors use (integer, rounded up); Sinov has no floor
  const base = plan === 'sinov' ? Math.round(aiUsd('sinov') * P.uzsPerUsd) : pricing.plannedAiUzs(plan);
  const ops = P.opsUzs[plan] || 0;
  const row = { plan, docPages, chatPages, docOcrUzs: ocrUzs(docPages), chatOcrUzs: ocrUzs(chatPages), analysisPerUnit: ledger.OCR_PAGES_PER_ANALYSIS_UNIT };
  for (const [k, pages] of [['A', docPages], ['B', docPages + chatPages]]) {
    const cost = base + ocrUzs(pages) + ops;
    const price = C[plan].priceUzs || 0;
    row[k] = { pages, ocrUzs: ocrUzs(pages), costUzs: cost,
      share: price ? cost / price : null,
      minUzs: price ? pricing.minimumPrice(cost, pricing.costModel().paymentFeeBp || 0) : null,
      maxDiscountUzs: price ? Math.max(0, price - pricing.minimumPrice(cost, pricing.costModel().paymentFeeBp || 0)) : null };
  }
  return row;
});
const sinovAB = { A: ocrAB[0].A.costUzs, B: ocrAB[0].B.costUzs };
const silverAB = ocrAB[1];
const scenario1AB = Object.fromEntries(['A', 'B'].map(k => {
  const revenue = 100 * C.silver.priceUzs;
  const result = revenue - 100 * silverAB[k].costUzs - 1000 * sinovAB[k];
  return [k, { revenue, result, breakEvenSilver: Math.ceil(1000 * sinovAB[k] / (C.silver.priceUzs - silverAB[k].costUzs)) }];
}));

const out = {
  basis: 'planning budgets at 100% use, not measured cost (src/rag/tariff-ledger.js PLANNING)',
  planning: P, trialUzs: trialUzs(), trialUsd: aiUsd('sinov') + ocrUsd('sinov'), trialUzsWithoutOcr: Math.round(aiUsd('sinov') * P.uzsPerUsd),
  ocrAB, scenario1AB,
  ocr: { usdPerPage: ocrPageUsd, budget: scanLimits.ocrPageBudget(), pages: Object.fromEntries(['sinov', 'silver', 'gold', 'platinum'].map(p => [p, ledger.maxOcrPages(p)])) },
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
  const B_ = out.ocr.budget;
  L.push('', `OCR: sahifa uchun $${ocrPageUsd.toFixed(6)} — konservativ yuqori budjet, kutilgan narx emas (o'lchanmagan). ${B_.model}, ${B_.api}; narx $${B_.inPerM} / $${B_.outPerM} per 1M (${B_.priceSource}).`,
    `  = ((${B_.parts.imageInputTokens.tokens} rasm + ${B_.parts.promptTokens.tokens} prompt) × $${B_.inPerM} + (${B_.parts.outputTokens.tokens} chiqish + ${B_.parts.thinkingTokens.tokens} thinking) × $${B_.outPerM}) / 1M × ${B_.attempts} urinish × ${B_.reserveFactor} zaxira = $${B_.usdPerAttempt.toFixed(7)} × ${B_.attempts}.`,
    `  100% da sahifalar: Sinov ${out.ocr.pages.sinov}, Silver ${out.ocr.pages.silver}, Gold ${out.ocr.pages.gold}, Platinum ${out.ocr.pages.platinum}. Faqat Gemini-only yo'nalishida amal qiladi (OCR_IMAGE_PROVIDER=gemini, OCR_FALLBACK=off).`);
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
  L.push('', "Chatdagi OCR, A/B (100% foydalanish). A — OCR faqat tahlil/xulosa ichida; B — A + chatdagi skan sahifalari (hozirgi taklif). Chat sahifalari = tahlil birligi × 10 (tariflar v2 qoidasi), o'lchangan talab emas.", '',
    '| Tarif | Tahlil+xulosa OCR (sahifa / so\'m) | Chat OCR (sahifa / so\'m) | A: xizmat xarajati (ulush) | B: xizmat xarajati (ulush) | A: minimal narx / eng katta chegirma | B: minimal narx / eng katta chegirma |',
    '|---|---:|---:|---:|---:|---:|---:|');
  for (const r of out.ocrAB) {
    const sh = x => x.share == null ? '—' : `${(x.share * 100).toFixed(1)}%`;
    const mn = x => x.minUzs == null ? '—' : `${fmt(x.minUzs)} / ${fmt(x.maxDiscountUzs)}`;
    L.push(`| ${C[r.plan].label} | ${r.docPages} / ${fmt(r.docOcrUzs)} | ${r.chatPages} / ${fmt(r.chatOcrUzs)} | ${fmt(r.A.costUzs)} (${sh(r.A)}) | ${fmt(r.B.costUzs)} (${sh(r.B)}) | ${mn(r.A)} | ${mn(r.B)} |`);
  }
  L.push('', `1 000 Sinov + 100 Silver: A — natija ${mln(out.scenario1AB.A.result)} mln, qoplash uchun ${out.scenario1AB.A.breakEvenSilver} Silver; B — natija ${mln(out.scenario1AB.B.result)} mln, qoplash uchun ${out.scenario1AB.B.breakEvenSilver} Silver.`);
  console.log(L.join('\n'));
}
