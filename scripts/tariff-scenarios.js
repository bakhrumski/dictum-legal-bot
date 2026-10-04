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

const ledger = require('../src/rag/tariff-ledger');

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
function serviceUzs(plan, { unitUsd = P.unitUsd, rate = P.uzsPerUsd, opsMult = 1 } = {}) {
  return Math.round(aiUsd(plan, unitUsd) * rate) + Math.round((P.opsUzs[plan] || 0) * opsMult);
}
const trialUzs = (unitUsd = P.unitUsd, rate = P.uzsPerUsd) => Math.round(aiUsd('sinov', unitUsd) * rate);
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
  ['hammasi birga', { unitUsd: { chat: P.unitUsd.chat * 1.2, analysis: 0.45 * 1.2, opinion: 0.45 * 1.2, draft: P.unitUsd.draft * 1.2 }, opsMult: 1.5 }],
].map(([name, o]) => ({ name, rows: ['silver', 'gold', 'platinum'].map(plan => {
  const s = serviceUzs(plan, o);
  return { plan, serviceUzs: s, share: s / C[plan].priceUzs, within80: s <= C[plan].priceUzs * P.costCeilingShare };
}) }));

const out = {
  basis: 'planning budgets at 100% use, not measured cost (src/rag/tariff-ledger.js PLANNING)',
  planning: P, trialUzs: trialUzs(), trialUsd: aiUsd('sinov'),
  plans: ['silver', 'gold', 'platinum'].map(p => ledger.planEconomics(p)),
  scenarios, breakEvenSilver, hitRates, hitCostShare: HIT_COST_SHARE, stress,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out, null, 2));
} else {
  const L = [];
  L.push(`Asos: ${out.basis}. Kurs ${P.uzsPerUsd} so'm/$.`, '');
  L.push('| Tarif | Narx | AI budjeti | Operatsion | Jami xizmat | Qoladi | Xizmat marjasi | 80% chegara |', '|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const e of out.plans) L.push(`| ${C[e.plan].label} | ${fmt(e.priceUzs)} | ${fmt(e.aiUzs)} | ${fmt(e.opsUzs)} | ${fmt(e.serviceUzs)} | ${fmt(e.leftUzs)} | ${(e.serviceMargin * 100).toFixed(2)}% | ${fmt(e.ceilingUzs)} |`);
  L.push('', `Bitta Sinov AI budjeti: $${out.trialUsd.toFixed(3)} ≈ ${fmt(out.trialUzs)} so'm.`, '');
  L.push('| Ssenariy | Tushum, mln | Pullik xizmat budjeti, mln | Sinov AI, mln | Natija, mln (boshqa xarajatlardan oldin) |', '|---|---:|---:|---:|---:|');
  for (const s of scenarios) L.push(`| ${s.name} | ${mln(s.revenue)} | ${mln(s.paidService)} | ${mln(s.trialCost)} | ${mln(s.result)} |`);
  L.push('', `1 000 Sinovni qoplash uchun kamida ${breakEvenSilver} ta Silver xaridi kerak (har biri ${fmt(silverLeft)} so'm qoldiradi).`, '');
  L.push(`Tasdiqlangan javob hit rate (hit narxi = generatsiyaning ${HIT_COST_SHARE * 100}% — taxmin):`, '', '| Hit rate | Silver | Gold | Platinum |', '|---|---:|---:|---:|');
  for (const h of hitRates) L.push(`| ${h.hitRate * 100}% | ${h.rows.map(r => `${fmt(r.serviceUzs)} (${(r.share * 100).toFixed(1)}%)`).join(' | ')} |`);
  L.push('', 'Stress (jami xizmat budjeti, narxga nisbatan; 80% chegara):', '', '| Holat | Silver | Gold | Platinum |', '|---|---:|---:|---:|');
  for (const s of stress) L.push(`| ${s.name} | ${s.rows.map(r => `${fmt(r.serviceUzs)} (${(r.share * 100).toFixed(1)}%${r.within80 ? '' : ' ⚠ >80%'})`).join(' | ')} |`);
  console.log(L.join('\n'));
}
