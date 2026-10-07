'use strict';

/**
 * Telegram texts about plans and limits, built from the one plan catalogue
 * (src/rag/tariff-ledger.js) so the bot never shows a number the backend
 * does not enforce (tariffs v2, 2026-10-04).
 */

const ledger = require('../rag/tariff-ledger');

const SERVICE_NAMES = {
  chat: 'huquqiy savol', analysis: 'hujjat tahlili (birlik)', opinion: 'AI yuridik xulosa (birlik)', draft: 'hujjat yaratish', ocr: "chatdagi skan hujjat (sahifa, ichki chegara)",
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
      // OCR is a step of a document service, not a service of its own
      if (!v.limit || k === 'ocr') continue;
      lines.push(`• ${SERVICE_NAMES[k] || k}: ${v.remaining} / ${v.limit} qoldi`);
    }
    if (b.kind === 'trial') lines.push("Sinov tugagach tarif tanlanadi; avtomatik to'lov olinmaydi.");
    else lines.push("Yangi davr to'lov bilan boshlanadi; ishlatilmagan limit keyingi davrga o'tmaydi va avtomatik qayta sotib olinmaydi.");
  }
  if (paidCredits > 0) lines.push('', `Oldin Telegram Stars bilan sotib olingan javob kreditlari: ${paidCredits} (alohida hisob, muddati tugamaydi).`);
  if (pending) lines.push('', 'Hozir bitta huquqiy javob tayyorlanmoqda.');
  return lines.join('\n');
}

// ── Files in Telegram ─────────────────────────────────────────────────────
// Telegram does not run AI on files: a file goes to the lawyer queue. The
// user is told so plainly, that no analysis / opinion quota was used, that
// a lawyer's review is not part of the plan (nor promised free), and where
// the AI document services are (the website, priced in document units).
const FILE_TYPES = new Set(['document', 'photo', 'video', 'video_note']);

function startFileLine({ voiceToText = false } = {}) {
  return [
    "📎 Fayl (hujjat, rasm, video, 5 MB gacha) yuborsangiz, uni AI o'qimaydi — murojaat yurist navbatiga tushadi; tarif limitingizdan hech narsa yechilmaydi.",
    "Hujjatni AI bilan tahlil qilish yoki AI yuridik xulosa olish — juristai.uz saytida.",
    voiceToText ? '🎙 Ovozli savol matnga aylantiriladi va yozma savol kabi javob beriladi.' : '🎙 Ovozli xabarni ham yurist ko\'rib chiqadi.',
  ].join(' ');
}

/** Asked when a file arrives without a description (it is held). */
function fileHeldText({ tooShortNote = '', minChars = 0 } = {}) {
  return '📎 Faylingiz qabul qilindi.' + tooShortNote + '\n\n'
    + "ℹ️ Telegram'da fayllar AI bilan tahlil qilinmaydi: murojaatingiz yurist navbatiga yuboriladi va tahlil yoki xulosa limitingizdan hech narsa yechilmaydi.\n\n"
    + `✍️ Endi vaziyatingizni yozib yuboring — nima bo'lgani va qanday yordam kerakligini batafsil tushuntiring (kamida ${minChars} belgi).\n\n`
    + "⚠️ Faqat fayl yuborish yetarli emas: hujjat/rasm bilan birga izoh (savolingiz) bo'lishi shart.";
}

/** Sent when a request with a file has been put in the lawyer queue. */
function fileQueuedText({ typeLabel = 'Fayl' } = {}) {
  return [
    "✅ Murojaatingiz yurist navbatiga yuborildi.",
    `📝 Turi: ${typeLabel}`,
    '',
    "🤖 Bu AI tahlili emas: Telegram'da fayllar sun'iy intellekt bilan o'qilmaydi va tarifingizning tahlil yoki xulosa limitidan hech narsa yechilmadi.",
    "👨‍⚖️ Yurist murojaatni ko'rib chiqib, shu yerda javob beradi. Yurist ko'rigi tarif limitlariga kirmaydi; uning shartlari, agar pullik bo'lsa, yurist bilan alohida kelishiladi.",
    "💻 Hujjatni hozir AI bilan tahlil qilish yoki AI yuridik xulosa olish — saytda: hujjat birligida, sarf ish boshlanishidan oldin ko'rsatiladi.",
  ].join('\n');
}

/** The button under it: the AI document services on the website. */
function fileQueuedKeyboard(url) {
  if (!/^https?:\/\//iu.test(String(url || ''))) return null;
  return { inline_keyboard: [[{ text: '💻 Saytda AI tahlil yoki xulosa', url }]] };
}

module.exports = { planLines, START_LIMIT_TEXT, balanceText, money, tashkentDay, FILE_TYPES, startFileLine, fileHeldText, fileQueuedText, fileQueuedKeyboard };
