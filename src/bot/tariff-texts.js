'use strict';

/**
 * Telegram texts about plans and limits, built from the one plan catalogue
 * (src/rag/tariff-ledger.js) so the bot never shows a number the backend
 * does not enforce (tariffs v2, 2026-10-04).
 */

const ledger = require('../rag/tariff-ledger');

const SERVICE_NAMES = {
  chat: 'huquqiy savol', analysis: 'hujjat tahlili (birlik)', opinion: 'AI yuridik xulosa (birlik)', draft: 'hujjat yaratish', ocr: "rasm/skan o'qish (sahifa)",
};

function money(n) {
  return `${Number(n).toLocaleString('ru-RU').replace(/ /gu, ' ')} so'm`;
}

function tashkentDay(d) {
  if (!d) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric' })
    .formatToParts(new Date(d)).map(x => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year}`;
}

/** "Sinov: 5 savol + 1 tahlil + 1 xulosa, bir martalik" and the paid plans. */
function planLines() {
  const c = ledger.PLAN_CATALOG;
  const paid = ledger.PAID_PLAN_ORDER.map(k => {
    const q = c[k].quotas;
    return `• ${c[k].label} — ${money(c[k].priceUzs)} / 30 kun: ${q.chat} savol, ${q.analysis} tahlil, ${q.opinion} xulosa, ${q.draft} hujjat${c[k].workspace.create ? ', Workspace yaratish' : ''}`;
  });
  const s = c.sinov.quotas;
  return [
    `• Sinov — bepul, bir martalik: ${s.chat} huquqiy savol + ${s.analysis} hujjat tahlili + ${s.opinion} yuridik xulosa (yangilanmaydi)`,
    ...paid,
  ];
}

const START_LIMIT_TEXT = () => [
  `Sinov tarifida ${ledger.PLAN_CATALOG.sinov.quotas.chat} ta huquqiy savol, 1 ta hujjat tahlili va 1 ta yuridik xulosa bepul — bir marta beriladi va yangilanmaydi.`,
  "Keyin Silver, Gold yoki Platinum tarifini tanlaysiz (30 kunlik davr); avtomatik to'lov olinmaydi.",
  "Salomlashuv, menyu, /balance va yordam buyruqlari limit sarflamaydi.",
].join(' ');

/**
 * /balance: the plan, what is left for each service, the period's end,
 * Stars answer credits bought earlier (a separate balance), the test mode.
 */
function balanceText({ balance: b, paidCredits = 0, pending = false, testAccountText = '' } = {}) {
  const lines = [];
  if (testAccountText) lines.push(testAccountText, '');
  if (!b || b.kind === 'staff') {
    lines.push('Hisobingiz xodim hisobi: tarif limitlari qo\'llanmaydi.');
  } else if (b.kind === 'none') {
    const q = ledger.PLAN_CATALOG.sinov.quotas;
    lines.push(b.trialAvailable
      ? `Tarif: Sinov hali boshlanmagan. Birinchi huquqiy savolingizdan boshlanadi: ${q.chat} savol, ${q.analysis} tahlil, ${q.opinion} xulosa (bir martalik).`
      : 'Tarif tanlanmagan.');
  } else if (b.legacy) {
    lines.push(`Tarif: ${(ledger.PLAN_CATALOG[b.plan] || {}).label || b.plan} (oldin sotib olingan shartlar bilan).`,
      `Amal qiladi: ${tashkentDay(b.endsAt)} gacha. Shu davr tugaguncha oldingi shartlaringiz o'zgarmaydi.`);
  } else {
    const label = (ledger.PLAN_CATALOG[b.plan] || {}).label || b.plan;
    lines.push(b.kind === 'trial'
      ? `Tarif: ${label} (bir martalik, yangilanmaydi).`
      : `Tarif: ${label}, davr ${tashkentDay(b.startsAt)} — ${tashkentDay(b.endsAt)}.`);
    for (const [k, v] of Object.entries(b.services || {})) {
      if (!v.limit) continue;
      lines.push(`• ${SERVICE_NAMES[k] || k}: ${v.remaining} / ${v.limit} qoldi`);
    }
    if (b.kind === 'trial') lines.push("Sinov tugagach tarif tanlanadi; avtomatik to'lov olinmaydi.");
    else lines.push("Yangi davr to'lov bilan boshlanadi; ishlatilmagan limit keyingi davrga o'tmaydi va avtomatik qayta sotib olinmaydi.");
  }
  if (paidCredits > 0) lines.push('', `Oldin Telegram Stars bilan sotib olingan javob kreditlari: ${paidCredits} (alohida hisob, muddati tugamaydi).`);
  if (pending) lines.push('', 'Hozir bitta huquqiy javob tayyorlanmoqda.');
  return lines.join('\n');
}

module.exports = { planLines, START_LIMIT_TEXT, balanceText, money, tashkentDay };
