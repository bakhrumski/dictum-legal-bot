// bot.js can be run standalone or imported by server.js
if (!process.env.TELEGRAM_BOT_TOKEN) {
  require('dotenv').config();
}
const TelegramBot = require('node-telegram-bot-api');
const bcrypt = require('bcryptjs');
const { pool } = require('../database/db');
const fs = require('fs');
const https = require('https');
const path = require('path');
const crypto = require('crypto');
const telegramEconomy = require('../services/telegram-economy');
const { isStaffRole, isMasterRole, roleLabel, getLinkedAccount, privateSenderId, chatRoute, dashboardUrl } = require('./telegram-roles');
const usageLedger = require('../ai/usage-ledger');
const testAccounts = require('./test-account');
const tariffTexts = require('./tariff-texts');

/**
 * The Telegram test account for this update (src/bot/test-account.js), or
 * null. When it is one, this request's AI calls are also held to the test
 * account's total budget by the usage ledger.
 */
/**
 * Who pays for a Telegram answer (tariffs v2): the sender, and the ordinary
 * account linked to them, if any - linked Telegram and web accounts share one
 * allowance. A staff account (even a master in /testmode) is not a payer
 * here: its chat is treated as an ordinary Telegram user.
 */
async function telegramIdentity(msgOrQuery) {
  const chat = (msgOrQuery.message && msgOrQuery.message.chat) || msgOrQuery.chat || {};
  const fromId = msgOrQuery.from && msgOrQuery.from.id != null ? msgOrQuery.from.id : null;
  let adminId = null;
  try {
    const account = await getLinkedAccount(pool, chat.id, privateSenderId(msgOrQuery));
    if (account && account.role === 'user') adminId = account.id;
  } catch (e) {
    console.warn('[BOT] linked account lookup failed:', e.message);
  }
  return { telegramUserId: fromId, adminId };
}

// Voice notes become typed questions when an STT engine is on (src/ai/stt.js:
// VoiceLab by default, Gemini 3.5 Transcribe with STT_PROVIDER=gemini).
function voiceToTextEnabled() {
  try { return require('../ai/stt').sttEnabled(); } catch (_) { return false; }
}

async function testAccountFor(msgOrQuery) {
  const chat = (msgOrQuery.message && msgOrQuery.message.chat) || msgOrQuery.chat || {};
  let account = await testAccounts.resolveTestAccount(pool, {
    chatId: chat.id, chatType: chat.type, fromUserId: msgOrQuery.from && msgOrQuery.from.id,
  });
  // a master in /testmode: no Sinov, limit or credit, its own budget
  // (src/bot/test-account.js resolveMasterTestMode); the role is read from
  // the database on every message
  if (!account && inAdminTestMode(chat.id)) {
    try {
      const linked = await getLinkedAccount(pool, chat.id, privateSenderId(msgOrQuery));
      const expiresAt = adminTestMode.get(chat.id);
      account = await testAccounts.resolveMasterTestMode(pool, {
        chatId: chat.id, chatType: chat.type, fromUserId: msgOrQuery.from && msgOrQuery.from.id,
        isMaster: !!(linked && isMasterRole(linked.role)), startedAt: expiresAt - TEST_MODE_TTL_MS, expiresAt,
      });
    } catch (e) {
      console.warn('[TG-TEST] master test mode lookup failed; ordinary limits apply:', e.message);
      account = null;
    }
  }
  if (account) {
    usageLedger.useSharedBudget(testAccounts.ledgerPool(account));
    usageLedger.annotate({ testMode: true });
  }
  // a test entitlement (pilot) of the linked account: the same total AI
  // budget as on the web (src/ai/test-budget.js)
  try {
    const testBudget = require('../ai/test-budget');
    // no live test entitlement anywhere (the usual case): no lookup at all
    if ((await testBudget.accountsWithTest()).size) {
      const ident = await telegramIdentity(msgOrQuery);
      if (ident.adminId && await testBudget.attach(ident.adminId)) usageLedger.annotate({ testEntitlement: true });
    }
  } catch (e) {
    console.warn('[TEST-BUDGET] Telegram attach failed:', e.message);
  }
  return account;
}

const { verificationTokens, regSessions, loginSessions } = require('../verification-store');
const {
  serviceKeyboard,
  attorneyFieldKeyboard,
  attorneyRegionKeyboard,
  documentTypeKeyboard,
  resolveIntakeCallback,
} = require('./intake-menus');

// Auto-answering used to run through `askJustify`, an external service whose
// URL defaults to http://localhost:8000. In production that host does not
// exist, so the availability probe always failed and EVERY question — however
// simple — fell through to the human queue. Answers now come from the
// platform's own retrieval + citation-verification stack via
// src/agents/telegram-agent.js. justify-client.js is left in place for the
// separate Justify integration; the bot no longer depends on it.

const token = process.env.TELEGRAM_BOT_TOKEN;
const { LEGAL_BOT_USERNAME, AUTH_BOT_USERNAME } = require('../config/bot-usernames');
const LEGAL_BOT_AUTH_FALLBACK_ENABLED = false;
const PAID_ANSWER_STARS = Math.max(1, Number.parseInt(process.env.TG_PAID_ANSWER_STARS || '1', 10) || 1);
const PAID_ANSWER_CREDITS = Math.max(1, Number.parseInt(process.env.TG_PAID_ANSWER_CREDITS || '4', 10) || 4);
const starsInvoice = require('./stars-invoice');
// The offer is carried in the invoice payload (D-12); these are the prices
// for new invoices and for v1 invoices issued before that change.
const LEGACY_ANSWER_OFFER = { stars: PAID_ANSWER_STARS, credits: PAID_ANSWER_CREDITS };
function readAnswerOffer(payload, telegramUserId) {
  return starsInvoice.parseAnswerInvoicePayload(payload, telegramUserId, {
    secret: token, legacy: LEGACY_ANSWER_OFFER,
  });
}

// Give the Stars back when a valid payment cannot be credited. Not wrapped
// by node-telegram-bot-api 0.67, so it goes through the raw Bot API call.
async function refundStars(telegramUserId, chargeId) {
  try {
    await bot._request('refundStarPayment', { form: { user_id: telegramUserId, telegram_payment_charge_id: chargeId } });
    console.warn(`[BOT] Stars refunded: charge ${chargeId}`);
    return true;
  } catch (error) {
    console.error('[BOT] Stars refund failed:', error.message);
    return false;
  }
}
const TELEGRAM_TOPIC_CATEGORIES = Object.freeze({
  konstitutsiya: 'Konstitutsiyaviy tuzum',
  'davlat-boshqaruvi': 'Davlat boshqaruvi',
  fuqarolik: 'Fuqarolik qonunchiligi',
  oila: 'Oila qonunchiligi',
  mehnat: 'Mehnat va aholining bandligi',
  ijtimoiy: "Ijtimoiy ta'minot va ijtimoiy himoya",
  moliya: 'Moliya va kredit',
  soliq: 'Soliq qonunchiligi',
  bank: 'Bank faoliyati',
  'uy-joy': "Uy-joy qonunchiligi. Kommunal xo'jalik",
  tadbirkorlik: "Tadbirkorlik va xo'jalik faoliyati",
  'tashqi-iqtisod': 'Tashqi iqtisodiy faoliyat. Bojxona ishi',
  ekologiya: 'Atrof tabiiy muhit va tabiiy resurslar',
  axborot: 'Axborot va axborotlashtirish',
  talim: "Ta'lim. Fan. Madaniyat",
  soglik: "Sog'liqni saqlash. Sport. Turizm",
  mudofaa: 'Mudofaa',
  jinoyat: 'Jinoyat qonunchiligi',
  mamuriy: "Ma'muriy javobgarlik",
  'yol-harakati': "Ma'muriy javobgarlik",
  sudlov: 'Odil sudlov',
  adliya: 'Prokuratura. Advokatura. Notariat. Adliya organlari',
  xalqaro: 'Xalqaro munosabatlar. Xalqaro huquq',
  shaxsiy: 'Shaxsiy tusdagi hujjatlar',
});

function categoryFromAgentMeta(meta = {}) {
  const explicit = String(meta.category || '').trim();
  if (explicit) return explicit.slice(0, 255);
  const topic = String(meta.topic || '').trim();
  return TELEGRAM_TOPIC_CATEGORIES[topic] || 'Boshqa';
}

function normalizeInstagramUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value).trim());
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'instagram.com' || host.endsWith('.instagram.com'))
      ? url.toString()
      : '';
  } catch (_) {
    return '';
  }
}
const INSTAGRAM_URL = normalizeInstagramUrl(
  process.env.INSTAGRAM_URL || 'https://www.instagram.com/bakhrom_abdimuminov/'
);

// NEVER start polling in constructor — polling is started explicitly when needed
const bot = new TelegramBot(token, { polling: false });
// the 2026 alphabet (OʻRQ-1184: ö ğ ş ç) by default, the old one on the chat's choice (src/bot/alphabet.js)
const alphabetPrefs = require('./alphabet').createAlphabetPrefs({ db: pool });
require('./alphabet').wrapBot(bot, alphabetPrefs);

// agent tasks given in the bot report their steps and end here (src/bot/agent-runs.js, PR-F)
require('../agents/runs/notify').setTelegramNotifier(require('./agent-runs').createTelegramRunNotifier({
  bot, pool,
  setConversationState: (...a) => require('../agents/telegram-agent').setConversationState(...a),
  splitForTelegram: (text) => require('../agents/telegram-agent').splitForTelegram(text),
  registry: { get: (id) => { const s = require('../agents/planner-routes').plannerService(); return s ? s.registry.get(id) : null; } },
}));
bot.getMe().then((info) => {
  if (!info || String(info.username).toLowerCase() !== LEGAL_BOT_USERNAME.toLowerCase()) {
    console.error(`[BOT] TELEGRAM_BOT_TOKEN must belong to @${LEGAL_BOT_USERNAME}; received @${info && info.username ? info.username : 'unknown'}`);
  }
}).catch((err) => console.error('[BOT] Unable to verify legal bot identity:', err.message));
bot.setMyCommands([
  { command: 'start', description: 'Bosh menyuni ochish' },
  { command: 'stats', description: 'Kunlik va oylik faol foydalanuvchilar' },
  { command: 'balance', description: 'Huquqiy javob kreditlari' },
  { command: 'terms', description: "To'lov shartlari" },
  { command: 'paysupport', description: "To'lov bo'yicha yordam" },
  { command: 'help', description: 'Botdan foydalanish bo\'yicha yordam' },
]).catch(error => console.warn('[BOT] command menu could not be updated:', error.message));

// If run directly (node bot.js) — start polling for local dev
if (require.main === module) {
  bot.startPolling();
  bot.on('polling_error', (error) => {
    console.error('Bot polling error:', error.code, error.message);
  });
  console.log('[BOT] Standalone polling mode');
}

// Store pending requests temporarily
let pendingRequests = {};

// Store pending admin responses: chatId -> { requestId, adminId, role, fullName }
const pendingResponses = new Map();
const pendingPaymentSupport = new Map();

// Files sent WITHOUT a written description are held here until the user sends
// the describing text, then the two are combined into one request.
// chatId -> { request_type, file_id, file_size, file_name, at }
const pendingFiles = new Map();
const PENDING_FILE_TTL = 60 * 60 * 1000; // 1 hour
const MIN_FILE_DESC = 200; // min chars of description required with a file

// One-time services for Telegram Stars (2026-10-21, src/bot/one-time-sales.js):
// a question pack, an AI draft, an analysis or an opinion bought one at a time.
const oneTimeSales = require('./one-time-sales').createOneTimeSales({
  bot, ledger: require('../rag/tariff-ledger'), identityOf: (m) => telegramIdentity(m), secret: token, refundStars,
});
const appBase = () => String(process.env.APP_URL || 'https://juristai.uz').replace(/\/+$/u, '');

/** Units of a service this person can use now: the plan's plus any bought one at a time (staff: unlimited). */
async function serviceUnitsLeft(who, service) {
  const b = await require('../rag/tariff-ledger').balance({ adminId: who.adminId || null, telegramUserId: who.telegramUserId });
  if (b.kind === 'staff' || b.legacy) return Infinity;
  const plan = b.services ? b.services[service].remaining : (b.trialAvailable ? Number(b.trialQuotas[service] || 0) : 0);
  return plan + Number((b.oneTime && b.oneTime[service]) || 0);
}

// A master in /testmode tries the AI draft (and the claim agent) with no
// unit and no Stars: its AI calls run under the test mode's own budget (the
// callback and message handlers attach it: testAccountFor), nothing is
// reserved or committed (owner, 2026-10-22). null when that does not apply.
async function masterDraftTest(chatId, from) {
  if (!from || !inAdminTestMode(chatId)) return null;
  try {
    const linked = await getLinkedAccount(pool, chatId, from.id);
    const expiresAt = adminTestMode.get(chatId);
    const account = await testAccounts.resolveMasterTestMode(pool, {
      chatId, chatType: 'private', fromUserId: from.id,
      isMaster: !!(linked && isMasterRole(linked.role)), startedAt: expiresAt - TEST_MODE_TTL_MS, expiresAt,
    });
    return account && !account.exhausted ? account : null;
  } catch (e) {
    console.warn('[TG-DRAFT] master test mode check failed; ordinary rules apply:', e.message);
    return null;
  }
}

/** "AI loyiha" when the person has a draft unit; else the one-time purchase, which then drafts at once. */
function draftPurchaseMarkup(chatId, from) {
  oneTimeSales.setResume(chatId, 'draft', () => startAiDraft(chatId, from));
  return { inline_keyboard: [[oneTimeSales.button('draft', 1, `🤖 AI loyiha — ${require('../rag/one-time-products').starsLabel('draft')}`)]] };
}

// An AI draft of an ordered document, right away in the chat (2026-10-20):
// the website's generator (setDraftGenerator), one draft unit from the plan
// (or one bought for Stars), sent back as a Word file. The lawyer order is
// kept as well, and a delivered draft can be sent to a lawyer for review.
let draftGenerator = null;
const DRAFT_OFFER_TTL_MS = 30 * 60 * 1000;
const draftOffers = new Map(); // chatId -> { docType, details, at }
const lastDrafts = new Map(); // chatId -> { docType, details, text, at } (lawyer review)
async function offerAiDraft(chatId, meta = {}, from = null) {
  if (!draftGenerator) return;
  const details = String(meta.caseSummary || '').trim();
  if (details.length < 20) return;
  // the source question and answer go with the order: the claim agent reads the story from all of it
  const story = [meta.sourceQuestion && `Savol: ${meta.sourceQuestion}`, details].filter(Boolean).join('\n\n');
  draftOffers.set(chatId, { docType: String(meta.documentTypeLabel || 'Yuridik hujjat'), details: story.slice(0, 6000), slug: String(meta.serviceSlug || ''), at: Date.now() });
  let left = 1;
  if (from) {
    try { left = await serviceUnitsLeft(await telegramIdentity({ chat: { id: chatId, type: 'private' }, from }), 'draft'); } catch (_) { left = 1; }
  }
  const agentNote = meta.serviceSlug === 'claim' && claimAgent ? "\n⚖️ Da'vo arizasini agent tayyorlaydi: lex.uz'dan asos qidiradi, iqtiboslarni manbada tekshiradi va loyihani shu asosda yozadi." : '';
  if (await masterDraftTest(chatId, from)) {
    await bot.sendMessage(chatId,
      "🤖 Kutmasdan loyiha kerakmi? AI hozir shu ma'lumotlar asosida hujjat loyihasini Word faylda tayyorlaydi.\n🧪 Test rejimi: birlik ham, Stars ham olinmaydi; xarajat test budjetidan." + agentNote,
      { reply_markup: { inline_keyboard: [[{ text: '🤖 AI loyiha — test rejimi', callback_data: 'tgdraft_ai' }]] } }).catch(() => {});
    return;
  }
  if (left > 0) {
    await bot.sendMessage(chatId,
      "🤖 Kutmasdan loyiha kerakmi? AI hozir shu ma'lumotlar asosida hujjat loyihasini Word faylda tayyorlaydi — tarifingizdagi 1 ta hujjat birligi sarflanadi. Yurist buyurtmasi ham saqlanib qoladi." + agentNote,
      { reply_markup: { inline_keyboard: [[{ text: '🤖 AI loyiha — 1 birlik', callback_data: 'tgdraft_ai' }]] } }).catch(() => {});
    return;
  }
  const p = require('../rag/one-time-products');
  await bot.sendMessage(chatId,
    `🤖 Kutmasdan loyiha kerakmi? AI hozir shu ma'lumotlar asosida hujjat loyihasini Word faylda tayyorlaydi.\nNarx: ${p.formatUzs(p.PRODUCTS.draft.priceUzs)} — hozircha Telegram Stars orqali ${p.starsFor('draft')} ⭐ (bir martalik). To'lovdan keyin loyiha darhol tayyorlanadi; xatoda birlik qaytariladi.\nYurist buyurtmasi ham saqlanib qoladi: uning narxini yurist belgilaydi.${agentNote}`,
    { reply_markup: draftPurchaseMarkup(chatId, from) }).catch(() => {});
}
async function runAiDraft(callbackQuery) {
  await bot.answerCallbackQuery(callbackQuery.id, { text: 'Loyiha tayyorlanmoqda' }).catch(() => {});
  return startAiDraft(callbackQuery.message.chat.id, callbackQuery.from);
}
async function startAiDraft(chatId, from) {
  const o = draftOffers.get(chatId);
  if (!o || Date.now() - o.at > DRAFT_OFFER_TTL_MS) {
    draftOffers.delete(chatId);
    await bot.sendMessage(chatId, "Taklif muddati o'tdi. Hujjatni qayta buyurtma qiling (sotib olingan birlik saqlanadi).").catch(() => {});
    return;
  }
  const ledger = require('../rag/tariff-ledger');
  const who = await telegramIdentity({ chat: { id: chatId, type: 'private' }, from });
  let job;
  try {
    job = await masterDraftTest(chatId, from)
      ? { allowed: true, jobKey: null, testMode: true }
      : await ledger.reserve({ adminId: who.adminId || null, telegramUserId: who.telegramUserId || from.id, service: 'draft', units: 1, channel: 'telegram', endpoint: '/tg/draft' });
  } catch (e) {
    console.warn('[TG-DRAFT] reserve failed:', e.message);
    await bot.sendMessage(chatId, "Limitni hozir tekshirib bo'lmadi. Birozdan keyin qayta urinib ko'ring.").catch(() => {});
    return;
  }
  if (!job.allowed) {
    await bot.sendMessage(chatId, `Hujjat tayyorlash birligi qolmagan (Sinov tarifida bu xizmat yo'q). Bitta loyihani alohida sotib olishingiz yoki tarif tanlashingiz mumkin: ${appBase()}/tariff.html\nYurist buyurtmangiz o'z holicha ko'rib chiqiladi.`,
      { reply_markup: draftPurchaseMarkup(chatId, from) }).catch(() => {});
    return;
  }
  draftOffers.delete(chatId);
  // a da'vo arizasi goes through the claim agent (src/agents/telegram-claim.js)
  if (o.slug === 'claim' && claimAgent) return runClaimAgent(chatId, from, o, job);
  await bot.sendChatAction(chatId, 'upload_document').catch(() => {});
  try {
    const r = await draftGenerator(o.docType, o.details);
    if (!r || !r.html) throw new Error('empty draft');
    await deliverDraft(chatId, o, r.html, job);
  } catch (e) {
    console.error('[TG-DRAFT] failed:', e.message);
    if (job.jobKey) await ledger.release(job.jobKey, 'failed').catch(() => {});
    await bot.sendMessage(chatId, "Loyihani tayyorlab bo'lmadi, birlik qaytarildi. Birozdan keyin qayta urinib ko'ring yoki saytda tayyorlang.").catch(() => {});
  }
}

/** Send the draft as .docx, commit its unit, offer the lawyer review. */
async function deliverDraft(chatId, o, html, job, { caption = null } = {}) {
  const ledger = require('../rag/tariff-ledger');
  const { htmlToDocx, DOCX_MIME } = require('../drafting/html-to-docx');
  const buf = await htmlToDocx(html, { title: o.docType, lang: /[\u0400-\u04ff]/u.test(o.details) ? 'ru' : 'uz' });
  const name = `${o.docType.replace(/[\\/:*?"<>|]+/gu, ' ').trim().slice(0, 60) || 'Hujjat'}.docx`;
  await bot.sendDocument(chatId, buf, { caption: caption || "📄 AI loyiha. [Qavs ichidagi] joylarni to'ldiring va imzolashdan oldin tekshiring; muhim hujjatni yurist bilan ko'rib chiqing." },
    { filename: name, contentType: DOCX_MIME });
  if (job && job.jobKey) await ledger.commit(job.jobKey).catch((e) => console.error('[TG-DRAFT] commit failed:', e.message));
  const text = String(html).replace(/<[^>]+>/gu, ' ').replace(/&nbsp;/gu, ' ').replace(/\s+/gu, ' ').trim();
  lastDrafts.set(chatId, { docType: o.docType, details: o.details, text: text.slice(0, 12000), at: Date.now() });
  await bot.sendMessage(chatId,
    "👨‍⚖️ Loyihani yurist tekshirib, to'g'rilab berishini xohlaysizmi? Narxni yurist belgilaydi; tasdiqlangach sizga narx yuboriladi va siz rozilik bildirgandan keyingina ish boshlanadi.",
    { reply_markup: { inline_keyboard: [[{ text: '👨‍⚖️ Yurist tekshiruvi', callback_data: 'tgdraft_review' }]] } }).catch(() => {});
}

// The claim agent (2026-10-22, src/agents/telegram-claim.js), set by the
// server (setClaimAgent). Its steps are shown in one message that updates;
// facts it still needs are asked for (the unit is released, nothing is
// charged) and the person's next message in this chat resumes it.
let claimAgent = null;
const claimAwait = new Map(); // chatId -> { o, from, at }
async function runClaimAgent(chatId, from, o, job) {
  const ledger = require('../rag/tariff-ledger');
  const done = [];
  let current = "Ma'lumotlarni tekshirish";
  let status = null, lastEdit = 0, editing = Promise.resolve();
  const view = () => ["⚖️ Da'vo arizasi agenti ishlamoqda (1–2 daqiqa):", ...done.map(l => `✅ ${l}`), current ? `⏳ ${current}` : ''].filter(Boolean).join('\n');
  try { status = await bot.sendMessage(chatId, view()); } catch (_) { status = null; }
  const onStep = (e) => {
    if (e.type !== 'step') return;
    if (e.status === 'running') current = e.label;
    else if (e.status === 'ok') { done.push(e.label); current = null; }
    const now = Date.now();
    if (status && now - lastEdit > 1200) {
      lastEdit = now;
      editing = editing.then(() => bot.editMessageText(view(), { chat_id: chatId, message_id: status.message_id }).catch(() => {}));
    }
  };
  let r;
  try {
    r = await claimAgent.run(o.details, { lang: /[\u0400-\u04ff]/u.test(o.details) ? 'ru' : 'uz', onStep });
  } catch (e) {
    r = { status: 'failed', error: e.message };
  }
  await editing;
  if (r.status === 'needs_input') {
    if (job && job.jobKey) await ledger.release(job.jobKey, 'claim_needs_input').catch(() => {});
    claimAwait.set(String(chatId), { o, from, at: Date.now() });
    await bot.sendMessage(chatId, ["Da'vo arizasi uchun yana quyidagilar kerak:", ...(r.missing || []).map((m, i) => `${i + 1}. ${m.question}`), '',
      "Javobni bitta xabarda yozib yuboring — loyiha shundan keyin tayyorlanadi. Birlik hali yechilmadi."].join('\n')).catch(() => {});
    return;
  }
  if (r.status !== 'done') {
    console.error('[TG-CLAIM] agent failed:', r.error || r.stoppedAt || r.status);
    if (job && job.jobKey) await ledger.release(job.jobKey, 'claim_failed').catch(() => {});
    await bot.sendMessage(chatId, "Da'vo arizasini tayyorlab bo'lmadi, birlik qaytarildi. Birozdan keyin qayta urinib ko'ring yoki saytda (Hujjat tayyorlash → Da'vo arizasi agenti) tayyorlang.").catch(() => {});
    return;
  }
  if (status) await bot.editMessageText(["⚖️ Da'vo arizasi agenti:", ...done.map(l => `✅ ${l}`)].join('\n'), { chat_id: chatId, message_id: status.message_id }).catch(() => {});
  try {
    await deliverDraft(chatId, o, r.html, null, { caption: "📄 Da'vo arizasi loyihasi (agent). Moddalar faqat lex.uz'da tasdiqlangan iqtiboslardan; [qavs ichidagi] joylarni to'ldiring. Bu AI loyiha, yuridik xulosa emas." });
    if (job && job.jobKey) await ledger.commit(job.jobKey).catch((e) => console.error('[TG-CLAIM] commit failed:', e.message));
    await bot.sendMessage(chatId, require('../agents/telegram-claim').resultText(r), { disable_web_page_preview: true }).catch(() => {});
  } catch (e) {
    console.error('[TG-CLAIM] delivery failed:', e.message);
    if (job && job.jobKey) await ledger.release(job.jobKey, 'claim_not_delivered').catch(() => {});
    await bot.sendMessage(chatId, "Faylni yuborib bo'lmadi, birlik qaytarildi. Qayta urinib ko'ring.").catch(() => {});
  }
}
/** The person's answer to the agent's questions: added to the order, and the agent runs again. true when handled. */
async function resumeClaimAgent(msg) {
  const key = String(msg.chat.id);
  const w = claimAwait.get(key);
  if (!w || !msg.text || msg.text.startsWith('/')) return false;
  claimAwait.delete(key);
  if (Date.now() - w.at > DRAFT_OFFER_TTL_MS) return false;
  draftOffers.set(msg.chat.id, { ...w.o, details: `${w.o.details}\n\nQo'shimcha ma'lumot: ${msg.text}`.slice(0, 7000), at: Date.now() });
  await startAiDraft(msg.chat.id, msg.from || w.from);
  return true;
}

/** A delivered AI draft goes to a lawyer for review: an order the lawyer prices (src/services/legal-marketplace.js). */
async function orderLawyerReview(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const d = lastDrafts.get(chatId);
  if (!d || Date.now() - d.at > 24 * 3600e3) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: "Loyiha topilmadi. Hujjatni qayta buyurtma qiling.", show_alert: true }).catch(() => {});
    return;
  }
  lastDrafts.delete(chatId);
  await bot.answerCallbackQuery(callbackQuery.id, { text: 'Yuristga yuborildi' }).catch(() => {});
  try {
    const order = await require('../services/legal-marketplace').createServiceOrder({
      serviceSlug: 'legal-document', telegramChatId: chatId,
      intakeData: { kind: 'lawyer_review', documentType: d.docType, caseSummary: d.details.slice(0, 4000), draftText: d.text },
    });
    await bot.sendMessage(chatId, order
      ? `✅ Yurist tekshiruvi so'rovi qabul qilindi (#${order.id}). Yurist loyihani ko'rib, narxni belgilaydi; narx shu yerga yuboriladi. Rozilik bermaguningizcha hech narsa to'lanmaydi.`
      : "So'rovni hozir qabul qilib bo'lmadi. Birozdan keyin qayta urinib ko'ring.").catch(() => {});
  } catch (e) {
    console.error('[TG-DRAFT] review order failed:', e.message);
    await bot.sendMessage(chatId, "So'rovni hozir qabul qilib bo'lmadi. Birozdan keyin qayta urinib ko'ring.").catch(() => {});
  }
}

// A PDF / DOCX can be analysed by AI in the chat (src/bot/telegram-documents.js);
// the analyzer is the website's, set by the server (setDocumentAnalyzer).
let documentAnalyzer = null;
const documentFlow = require('./telegram-documents').createDocumentFlow({
  bot,
  pool,
  ledger: require('../rag/tariff-ledger'),
  extract: (buf, o) => require('../ocr/routes').extractFileText(buf, o),
  getAnalyzer: () => documentAnalyzer,
  identityOf: (q) => telegramIdentity(q),
  sales: oneTimeSales,
  holdForLawyer: async (chatId, file) => {
    pendingFiles.set(chatId, { ...file, at: Date.now() });
    await bot.sendMessage(chatId, tariffTexts.fileHeldText({ tooShortNote: '', minChars: MIN_FILE_DESC }));
  },
  tariffUrl: `${String(process.env.APP_URL || 'https://juristai.uz').replace(/\/+$/u, '')}/tariff.html`,
});

// ========== OPTIONAL CHANNEL SUBSCRIPTION ==========
// The channel remains available as a promotional link, but ordinary Telegram
// requests must not be blocked by it. Re-enable the gate only deliberately by
// setting TELEGRAM_CHANNEL_GATE_ENABLED=true; REQUIRED_CHANNEL on its own is
// not enough to interrupt a user's legal question.
const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL !== undefined
  ? process.env.REQUIRED_CHANNEL
  : '@eng_sara_huquqiy_yangiliklar';
const TELEGRAM_CHANNEL_GATE_ENABLED = /^(?:1|true|yes|on)$/i.test(
  String(process.env.TELEGRAM_CHANNEL_GATE_ENABLED || '').trim()
);

function channelLink() {
  const c = (REQUIRED_CHANNEL || '').trim();
  if (c.startsWith('@')) return 'https://t.me/' + c.slice(1);
  return c; // already a URL, or empty
}

function freeAccessKeyboard(includeVerify) {
  const rows = [[{ text: 'Kanalga obuna bo\'lish', url: channelLink() }]];
  if (includeVerify) rows.push([{ text: 'Tekshirish', callback_data: 'check_sub' }]);
  if (INSTAGRAM_URL) rows.push([{ text: 'Instagram sahifamiz', url: INSTAGRAM_URL }]);
  return rows;
}

function startKeyboard(includeVerify = false) {
  return {
    inline_keyboard: [
      ...serviceKeyboard().inline_keyboard,
      [{ text: 'Statistika', callback_data: 'bot_stats' }],
      ...freeAccessKeyboard(includeVerify),
    ],
  };
}

// The answer pack offered now is the one-time "5 questions" (owner,
// 2026-10-21); invoices for the old 1-Star pack already issued are still
// honoured (readAnswerOffer), but it is no longer offered.
function paidAnswerKeyboard() {
  return {
    inline_keyboard: [
      [oneTimeSales.button('chat5', 1, `💬 5 ta savol — ${require('../rag/one-time-products').starsLabel('chat5')}`)],
      [{ text: '⭐ Tariflar', url: `${appBase()}/tariff.html` }],
    ],
  };
}

/** Limit spent: the question pack, the document the last answer pointed to (if any), the plans. */
async function quotaKeyboard(chatId) {
  const kb = paidAnswerKeyboard();
  try {
    const current = await require('../agents/telegram-agent').loadConversation(chatId);
    const doc = ((current.context && current.context.nextActions) || []).find(a => a && a.kind === 'document');
    if (doc) kb.inline_keyboard.splice(1, 0, [{ text: `📄 ${String(doc.label || 'Hujjat').slice(0, 56)}`, callback_data: `nxt_${String(doc.id).slice(0, 48)}` }]);
  } catch (_) { /* the pack and the plans are offered anyway */ }
  return kb;
}

function paymentTermsKeyboard() {
  return {
    inline_keyboard: [[
      { text: 'Roziman va to\'lash', callback_data: 'confirm_ai_answers_payment' },
      { text: 'Bekor qilish', callback_data: 'cancel_ai_answers_payment' },
    ]],
  };
}

function paymentTermsText() {
  const p = require('../rag/one-time-products');
  const line = (k) => `• ${p.PRODUCTS[k].title}: *${p.formatUzs(p.PRODUCTS[k].priceUzs)}* — Telegram Stars orqali *${p.starsFor(k)} ⭐*`;
  return [
    '*JuristAI bir martalik xizmatlari*',
    '',
    ...Object.keys(p.PRODUCTS).map(line),
    '',
    '• Bu obuna emas. Sotib olingan xizmat muddati tugamaydi va tarif limitingiz tugagandan keyin ishlatiladi.',
    '• Birlik faqat xizmat yetkazilganda sarflanadi; texnik xatoda avtomatik qaytariladi.',
    '• Click / Payme ulanguncha to\'lov faqat Telegram Stars orqali; Stars narxi so\'mdagi narxdan biroz yuqori.',
    '• Javob va hujjat loyihasi umumiy huquqiy yordam bo\'lib, rasmiy yuridik xulosa yoki natija kafolati emas. Yurist tekshiruvi alohida xizmat: narxini yurist belgilaydi.',
    '• To\'lov muammolari uchun /paysupport buyrug\'idan foydalaning. Telegram qo\'llab-quvvatlashi JuristAI xaridlarini ko\'rib chiqmaydi.',
    '',
    '“Roziman va to\'lash” tugmasi 5 ta savol paketini ochadi; boshqa xizmatlar o\'z tugmasi orqali sotiladi.',
  ].join('\n');
}

function formatPublicStats(stats) {
  return [
    '*JuristAI bot statistikasi*',
    '',
    `Bugun faol foydalanuvchilar: *${stats.dailyUsers}*`,
    `Shu oy faol foydalanuvchilar: *${stats.monthlyUsers}*`,
    `Jami foydalanuvchilar: *${stats.totalUsers}*`,
    '',
    '_Faqat anonim, takrorlanmagan foydalanuvchilar soni ko\'rsatiladi. Xabarlar va shaxsiy ma\'lumotlar ochilmaydi._',
  ].join('\n');
}

async function sendPublicStats(chatId) {
  const stats = await telegramEconomy.getTelegramUserStats();
  await bot.sendMessage(chatId, formatPublicStats(stats), { parse_mode: 'Markdown' });
}

function agentActionKeyboard(agentResult) {
  if (!agentResult) return null;
  if (agentResult.action === 'answered' && agentResult.meta && Array.isArray(agentResult.meta.nextActions)) {
    const rows = agentResult.meta.nextActions.slice(0, 3).map(action => ([{
      text: String(action.label || 'Keyingi qadam').slice(0, 64),
      callback_data: `nxt_${String(action.id || 'action').slice(0, 48)}`,
    }]));
    // the last Sinov question was just answered: the question pack too
    if (agentResult.meta.trialSpent) rows.push(paidAnswerKeyboard().inline_keyboard[0]);
    return { inline_keyboard: rows };
  }
  if (agentResult.action === 'quota_exceeded') return paidAnswerKeyboard();
  // account deletion is asked for, then confirmed with a button (src/services/account-deletion.js)
  if (agentResult.action === 'tool_delete_account_confirm') {
    const ru = agentResult.meta && agentResult.meta.lang === 'ru';
    return { inline_keyboard: [[
      { text: ru ? '🗑 Да, удалить' : "🗑 Ha, o'chirish", callback_data: 'acc_del_yes' },
      { text: ru ? 'Отмена' : 'Bekor qilish', callback_data: 'acc_del_no' },
    ]] };
  }
  // an agent plan made in the bot is approved or dropped with a button (src/bot/agent-runs.js)
  if (agentResult.action === 'tool_agent_plan' && agentResult.meta && agentResult.meta.runId) {
    const ru = agentResult.meta.lang === 'ru';
    return { inline_keyboard: [[
      { text: ru ? '✅ Подтвердить' : '✅ Tasdiqlash', callback_data: `agp_y_${agentResult.meta.runId}` },
      { text: ru ? 'Отмена' : 'Bekor qilish', callback_data: `agp_n_${agentResult.meta.runId}` },
    ]] };
  }
  // a matter closed or reopened by voice or text is confirmed first (src/matters/commands.js)
  if (agentResult.action === 'tool_matter_confirm' && agentResult.meta && agentResult.meta.token) {
    const ru = agentResult.meta.lang === 'ru';
    const yes = { text: ru ? '✅ Да' : '✅ Ha', callback_data: `mtc_y_${agentResult.meta.token}` };
    const no = { text: ru ? 'Отмена' : 'Bekor qilish', callback_data: `mtc_n_${agentResult.meta.token}` };
    // a spoken name with a glossary suggestion: "as heard" or "as suggested"
    if (agentResult.meta.alt) {
      const alt = String(agentResult.meta.alt);
      return { inline_keyboard: [
        [{ text: `✅ «${alt.length > 40 ? `${alt.slice(0, 39)}…` : alt}»`, callback_data: `mtc_a_${agentResult.meta.token}` }],
        [{ text: ru ? '✅ Как услышано' : '✅ Eshitilgandek', callback_data: `mtc_y_${agentResult.meta.token}` }, no],
      ] };
    }
    return { inline_keyboard: [[yes, no]] };
  }
  if (agentResult.action === 'attorney_intake_started') return attorneyFieldKeyboard();
  if (agentResult.action === 'document_intake_started') return documentTypeKeyboard();
  if (agentResult.action === 'greeting' || agentResult.action === 'intake_cancelled') return serviceKeyboard();
  if (agentResult.action !== 'menu_selection_required') return null;
  const menu = agentResult.meta && agentResult.meta.menu;
  if (menu === 'attorney_field') return attorneyFieldKeyboard();
  if (menu === 'attorney_region') return attorneyRegionKeyboard();
  if (menu === 'document_type') return documentTypeKeyboard();
  return serviceKeyboard();
}

// Returns true if the user is a member of REQUIRED_CHANNEL.
// Fails closed on API/config errors because the requirement is mandatory.
// Configuration errors are logged and access remains blocked until fixed.
async function isChannelMember(userId) {
  if (!REQUIRED_CHANNEL || !REQUIRED_CHANNEL.trim()) return true; // gate disabled
  try {
    const member = await bot.getChatMember(REQUIRED_CHANNEL, userId);
    const status = member && member.status;
    if (status === 'creator' || status === 'administrator' || status === 'member') return true;
    if (status === 'restricted') return member.is_member === true;
    return false; // 'left' or 'kicked'
  } catch (error) {
    console.error(
      `[Channel gate] Could not check membership for ${REQUIRED_CHANNEL}. ` +
      `Make sure the bot is an ADMINISTRATOR of the channel. Error: ${error.message}`
    );
    return false; // fail closed: the free-answer requirement is mandatory
  }
}

// Prompt shown to users who haven't joined yet.
function sendJoinPrompt(chatId) {
  return bot.sendMessage(
    chatId,
    '📢 Murojaat yuborishdan oldin rasmiy kanalimizga obuna bo\'ling:\n\n' +
    '👉 ' + (REQUIRED_CHANNEL || '') + '\n\n' +
    'Obuna bo\'lgach, "✅ Tekshirish" tugmasini bosing va savolingizni yuboring.',
    {
      reply_markup: { inline_keyboard: freeAccessKeyboard(true) }
    }
  );
}

// ========== ADMIN COMMANDS ==========

// /link username password - Link Telegram account to admin
const linkAttempts = new Map(); // telegram user id -> { n, at } (wrong /link passwords)
bot.onText(/\/link(?:\s+(\S+)\s+(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const username = match[1];
  const password = match[2];

  if (msg.chat.type !== 'private') {
    bot.sendMessage(chatId, "Bu buyruq faqat bot bilan shaxsiy chatda ishlaydi — parolni guruhga yozmang.");
    return;
  }
  if (!username || !password) {
    bot.sendMessage(chatId, "📋 Saytdagi akkauntni ulashning eng oson yo'li: juristai.uz/app/ ga o'z login yoki parolingiz bilan kiring va \"Telegram'ni ulash\" tugmasini bosing.\n\nYoki: /link <login> <parol>");
    return;
  }
  // wrong passwords: at most 5 tries in 15 minutes per Telegram user
  const tries = linkAttempts.get(msg.from.id) || { n: 0, at: Date.now() };
  if (Date.now() - tries.at > 15 * 60e3) { tries.n = 0; tries.at = Date.now(); }
  if (tries.n >= 5) {
    bot.sendMessage(chatId, "Juda ko'p urinish. 15 daqiqadan keyin qayta urining yoki saytda \"Telegram'ni ulash\" tugmasidan foydalaning.");
    return;
  }

  try {
    const result = await pool.query(
      'SELECT id, password, full_name, role FROM admins WHERE username = $1',
      [username]
    );

    const admin = result.rows[0];
    const isValid = admin ? await bcrypt.compare(password, admin.password) : false;

    if (!isValid) {
      // one reply for an unknown login and a wrong password
      tries.n++; linkAttempts.set(msg.from.id, tries);
      bot.sendMessage(chatId, "❌ Login yoki parol noto'g'ri.");
      return;
    }
    linkAttempts.delete(msg.from.id);

    // Check if this Telegram is already linked to another account (either column)
    const existingLink = await pool.query(
      'SELECT username FROM admins WHERE (telegram_chat_id = $1 OR telegram_user_id = $3) AND id != $2',
      [chatId, admin.id, msg.from.id]
    );
    if (existingLink.rows.length > 0) {
      bot.sendMessage(chatId, `⚠️ Bu Telegram hisob allaqachon @${existingLink.rows[0].username} ga ulangan. Avval /unlink qiling.`);
      return;
    }

    await pool.query(
      'UPDATE admins SET telegram_chat_id = $1, telegram_user_id = $3 WHERE id = $2',
      [chatId, admin.id, msg.from.id]
    );

    bot.sendMessage(chatId, isStaffRole(admin.role)
      ? `✅ Telegram hisobingiz ulandi!\n\n👤 ${admin.full_name}\n🔑 Rol: ${roleLabel(admin.role)}\n\nEndi bildirishnomalar olasiz:\n• Guruh chatda @mention\n• Murojaat tayinlanganda\n\n/unlink - Uzish`
      : `✅ Telegram hisobingiz ulandi!\n\n👤 ${admin.full_name}\n🔑 Rol: ${roleLabel(admin.role)}\n\nHuquqiy savolingizni shu yerda yozishingiz mumkin.\n\n/unlink - Uzish`);
  } catch (error) {
    console.error('Link error:', error);
    bot.sendMessage(chatId, '❌ Xatolik yuz berdi. Qaytadan urinib ko\'ring.');
  }
});

// /unlink - Unlink Telegram account
bot.onText(/\/unlink/, async (msg) => {
  const chatId = msg.chat.id;
  if (msg.chat.type !== 'private') {
    bot.sendMessage(chatId, 'Bu buyruq faqat bot bilan shaxsiy chatda ishlaydi.');
    return;
  }

  try {
    // both columns: the account is matched by either (getLinkedAccount)
    const result = await pool.query(
      `UPDATE admins SET telegram_chat_id = NULL, telegram_user_id = NULL
        WHERE telegram_chat_id = $1 OR telegram_user_id = $2 RETURNING full_name, username`,
      [chatId, msg.from.id]
    );

    if (result.rowCount > 0) {
      const names = result.rows.map(r => r.full_name || (r.username ? `@${r.username}` : 'akkaunt')).join(', ');
      bot.sendMessage(chatId, `✅ Telegram uzildi: ${names}. Endi bu chatdagi savollar o'sha akkaunt tarifidan hisoblanmaydi va bildirishnomalar kelmaydi. Qayta ulash: saytda "Telegram'ni ulash".`);
    } else {
      bot.sendMessage(chatId, 'ℹ️ Bu Telegram hech qanday JuristAI akkauntiga ulanmagan.');
    }
  } catch (error) {
    console.error('Unlink error:', error);
    bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
  }
});

// /testmode - let a master admin use the bot as an ordinary user
// A linked admin's messages are never treated as questions, so the owner had
// no way to try the bot — text or voice — from his own account. Test mode
// lifts that gate for one chat. It lives in memory and switches itself off
// after TEST_MODE_TTL_MS, so a forgotten test mode cannot outlive a restart
// or the afternoon; admin notifications keep arriving either way.
const TEST_MODE_TTL_MS = 12 * 60 * 60 * 1000;
const adminTestMode = new Map();   // chatId → expiresAt
function inAdminTestMode(chatId) {
  const until = adminTestMode.get(chatId);
  if (!until) return false;
  if (Date.now() > until) { adminTestMode.delete(chatId); return false; }
  return true;
}

bot.onText(/^\/testmode(?:@\w+)?(?:\s+(on|off))?\s*$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  try {
    const account = await getLinkedAccount(pool, chatId, privateSenderId(msg));
    if (!account || !isMasterRole(account.role)) {
      bot.sendMessage(chatId, 'ℹ️ Bu buyruq faqat bosh administrator uchun.');
      return;
    }
    const arg = (match && match[1] || '').toLowerCase();
    const turnOn = arg ? arg === 'on' : !inAdminTestMode(chatId);
    if (turnOn) {
      adminTestMode.set(chatId, Date.now() + TEST_MODE_TTL_MS);
      bot.sendMessage(chatId,
        '🧪 Test rejimi yoqildi (12 soat).\n\n' +
        'Endi bot sizni oddiy foydalanuvchi deb ko\'radi: matnli yoki ovozli savol yuboring — AI javob beradi. ' +
        (String(process.env.TG_MASTER_TESTMODE_UNLIMITED || '').toLowerCase() === 'off'
          ? 'Limitlar ham oddiy foydalanuvchinikidek hisoblanadi.\n\n'
          : `Sinov, kunlik limit va kredit hisoblanmaydi; tekshiruvlar saqlanadi. Shu sessiyaning AI budjeti: $${Number(process.env.TG_MASTER_TESTMODE_BUDGET_USD) > 0 ? Number(process.env.TG_MASTER_TESTMODE_BUDGET_USD) : 5}.\n\n`) +
        'Admin bildirishnomalari odatdagidek keladi.\n/testmode off — o\'chirish');
    } else {
      adminTestMode.delete(chatId);
      bot.sendMessage(chatId, '✅ Test rejimi o\'chirildi. Siz yana admin sifatida ulangansiz.');
    }
  } catch (error) {
    console.error('Testmode error:', error);
    bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
  }
});

// /cancel - Cancel pending response
bot.onText(/\/cancel/, (msg) => {
  const chatId = msg.chat.id;
  if (pendingResponses.has(chatId)) {
    pendingResponses.delete(chatId);
    bot.sendMessage(chatId, '❌ Javob bekor qilindi.');
  } else {
    bot.sendMessage(chatId, 'ℹ️ Hozirda kutilayotgan javob yo\'q.');
  }
});

// /me - Check link status
bot.onText(/\/me/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const admin = await getLinkedAccount(pool, chatId, privateSenderId(msg));

    if (admin) {
      const route = chatRoute(admin, { testMode: inAdminTestMode(chatId) });
      const routeLine = route === 'staff'
        ? 'Savollar emas, bildirishnomalar keladi.'
        : 'Huquqiy savollaringiz oddiy foydalanuvchi sifatida ko\'rib chiqiladi.';
      bot.sendMessage(chatId, `✅ Ulangan hisob:\n\n👤 ${admin.full_name}\n🆔 @${admin.username}\n🔑 ${roleLabel(admin.role)}\n\n${routeLine}`);
    } else {
      bot.sendMessage(chatId, 'ℹ️ Bu Telegram hisob hech qanday admin hisobiga ulanmagan.\n\n/link <username> <parol> - Ulash');
    }
  } catch (error) {
    console.error('Me error:', error);
    bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
  }
});

// ========== CALLBACK QUERY HANDLER (Respond to request) ==========

bot.on('callback_query', (callbackQuery) => usageLedger.runWithRequest(
  { service: 'telegram', chatId: callbackQuery.message && callbackQuery.message.chat && callbackQuery.message.chat.id, kind: 'callback' },
  (store) => handleCallbackQuery(callbackQuery)
    .finally(() => usageLedger.finishRequest(store).catch(() => {}))));

async function handleCallbackQuery(callbackQuery) {
  if (require('../api/maintenance').maintenanceOn()) {
    bot.answerCallbackQuery(callbackQuery.id, { text: require('../api/maintenance').MESSAGE }).catch(() => {});
    return;
  }
  const chatId = callbackQuery.message.chat.id;
  const testAccount = await testAccountFor(callbackQuery);
  const data = callbackQuery.data;

  // the script the bot writes in: the new alphabet or the old one (src/bot/alphabet.js)
  if (data === 'alpha_old' || data === 'alpha_new') {
    const al = require('./alphabet');
    try {
      const v = await alphabetPrefs.set(chatId, data === 'alpha_old' ? 'old' : 'new');
      await bot.answerCallbackQuery(callbackQuery.id).catch(() => {});
      await bot.sendMessage(chatId, v === 'old' ? al.TEXT.old : al.TEXT.new).catch(() => {});
    } catch (e) {
      console.warn('[BOT] alphabet choice failed:', e.message);
      await bot.answerCallbackQuery(callbackQuery.id, { text: "Saqlab bo'lmadi", show_alert: true }).catch(() => {});
    }
    return;
  }

  // a document's AI analysis or its lawyer queue (src/bot/telegram-documents.js)
  if (await documentFlow.onCallback(callbackQuery)) return;
  // a document order waiting for its details is dropped: the next message is a new one
  if (data === 'docin_cancel') {
    await require('../agents/telegram-agent').setConversationState(chatId, 'idle', {});
    claimAwait.delete(String(chatId));
    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Bekor qilindi' }).catch(() => {});
    await bot.sendMessage(chatId, "Buyurtma bekor qilindi. Huquqiy savolingizni yozavering.").catch(() => {});
    return;
  }
  if (data === 'tgdraft_ai') { await runAiDraft(callbackQuery); return; }
  if (data === 'tgdraft_review') { await orderLawyerReview(callbackQuery); return; }
  if (await oneTimeSales.onCallback(callbackQuery)) return;

  if (data === 'bot_stats') {
    try {
      await telegramEconomy.recordTelegramActivity(chatId);
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Yangilandi' });
      await sendPublicStats(chatId);
    } catch (error) {
      console.error('[BOT] public stats failed:', error.message);
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Statistikani hozir yuklab bo\'lmadi.', show_alert: true });
    }
    return;
  }

  if (data === 'buy_ai_answers') {
    try {
      await telegramEconomy.recordTelegramActivity(chatId);
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Shartlarni ko\'rib chiqing' });
      await bot.sendMessage(chatId, paymentTermsText(), {
        parse_mode: 'Markdown',
        reply_markup: paymentTermsKeyboard(),
      });
    } catch (error) {
      console.error('[BOT] answer invoice failed:', error.message);
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'To\'lov oynasini hozir ochib bo\'lmadi.', show_alert: true });
    }
    return;
  }

  if (data === 'confirm_ai_answers_payment') {
    try {
      await telegramEconomy.recordTelegramActivity(chatId);
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'To\'lov oynasi ochildi' });
      // the 1-Star pack is retired: an old button opens the 5-question pack
      await oneTimeSales.sendInvoice(chatId, callbackQuery.from.id, 'chat5', 1);
    } catch (error) {
      console.error('[BOT] confirmed answer invoice failed:', error.message);
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'To\'lov oynasini hozir ochib bo\'lmadi.', show_alert: true });
    }
    return;
  }

  // account deletion: the confirmation of a request asked in the chat
  if (data.startsWith('agp_y_') || data.startsWith('agp_n_')) {
    const runId = data.slice(6);
    const ru = /[\u0400-\u04ff]/u.test(String(callbackQuery.message && callbackQuery.message.text || ''));
    try {
      const account = await require('./telegram-roles').getLinkedAccount(pool, chatId, require('./telegram-roles').privateSenderId(callbackQuery));
      const service = require('../agents/planner-routes').plannerService();
      if (!account || !service) throw new Error('not available');
      await bot.answerCallbackQuery(callbackQuery.id).catch(() => {});
      if (data.startsWith('agp_n_')) {
        await service.cancel(runId, account.id);
        await bot.sendMessage(chatId, ru ? 'План отменён, ничего не списано.' : "Reja bekor qilindi, hech narsa yechilmadi.").catch(() => {});
        return;
      }
      // the status message first: the worker edits it as the steps finish
      const status = await bot.sendMessage(chatId, ru ? '⏳ Агент начинает…' : '⏳ Agent boshlamoqda…');
      await service.attachTelegram(runId, account.id, { chatId, messageId: status.message_id });
      try {
        await service.approve(runId, account.id);
      } catch (e) {
        await bot.editMessageText(`⚠️ ${e.message}`, { chat_id: chatId, message_id: status.message_id }).catch(() => {});
      }
    } catch (error) {
      console.warn('[BOT] agent plan button failed:', error.message);
      await bot.answerCallbackQuery(callbackQuery.id, { text: ru ? 'Не удалось' : "Bajarib bo'lmadi", show_alert: true }).catch(() => {});
    }
    return;
  }

  if (data.startsWith('mtc_y_') || data.startsWith('mtc_n_') || data.startsWith('mtc_a_')) {
    const commands = require('../matters/commands');
    const token = data.slice(6);
    const ru = /[\u0400-\u04ff]/u.test(String(callbackQuery.message && callbackQuery.message.text || ''));
    try {
      const account = await require('./telegram-roles').getLinkedAccount(pool, chatId, require('./telegram-roles').privateSenderId(callbackQuery));
      if (!account) throw new Error('not linked');
      if (data.startsWith('mtc_n_')) {
        commands.cancelConfirm(token, account.id);
        await bot.answerCallbackQuery(callbackQuery.id, { text: ru ? 'Отменено' : 'Bekor qilindi' }).catch(() => {});
        return;
      }
      const store = require('../matters/store').createMatterStore({ db: pool, resolveEntitlement: require('../rag/tariff-ledger').resolveEntitlement });
      const out = await commands.confirmCommand(token, { adminId: account.id, store, lang: ru ? 'ru' : 'uz', alt: data.startsWith('mtc_a_') });
      // the person's own speech glossary learns from the choice (src/voice/user-glossary.js)
      if (out.learn) await require('../voice/user-glossary').createUserGlossary({ db: pool }).learn(account.id, out.learn).catch(() => {});
      await bot.answerCallbackQuery(callbackQuery.id).catch(() => {});
      await bot.sendMessage(chatId, out.reply).catch(() => {});
    } catch (error) {
      console.warn('[BOT] matter confirm failed:', error.message);
      await bot.answerCallbackQuery(callbackQuery.id, { text: ru ? 'Не удалось' : "Bajarib bo'lmadi", show_alert: true }).catch(() => {});
    }
    return;
  }

  if (data === 'acc_del_yes' || data === 'acc_del_no') {
    const ru = /[\u0400-\u04ff]/u.test(String(callbackQuery.message && callbackQuery.message.text || ''));
    if (data === 'acc_del_no') {
      await bot.answerCallbackQuery(callbackQuery.id, { text: ru ? 'Отменено' : 'Bekor qilindi' }).catch(() => {});
      await bot.sendMessage(chatId, ru ? 'Хорошо, аккаунт остаётся.' : 'Yaxshi, akkaunt saqlanib qoladi.').catch(() => {});
      return;
    }
    try {
      if (!callbackQuery.message || callbackQuery.message.chat.type !== 'private') throw new Error('private chat only');
      const ident = await telegramIdentity(callbackQuery);
      const r = await require('../services/account-deletion').createRequest(pool, { telegramUserId: callbackQuery.from.id, chatId, adminId: ident.adminId || null });
      await bot.answerCallbackQuery(callbackQuery.id, { text: ru ? 'Запрос принят' : "So'rov qabul qilindi" }).catch(() => {});
      await bot.sendMessage(chatId, r.duplicate
        ? (ru ? 'Ваш запрос на удаление уже принят и ожидает обработки. Когда аккаунт будет удалён, мы сообщим здесь.' : "O'chirish so'rovingiz avval qabul qilingan va ko'rib chiqilmoqda. Akkaunt o'chirilganda shu yerda xabar beramiz.")
        : (ru ? 'Запрос на удаление аккаунта принят. Администратор выполнит его, и мы сообщим здесь. Передумали — напишите администратору.' : "Akkauntni o'chirish so'rovi qabul qilindi. Administrator uni bajaradi va shu yerda xabar beramiz. Fikringiz o'zgarsa, administratorga yozing."));
    } catch (error) {
      console.error('[BOT] account deletion request failed:', error.message);
      await bot.answerCallbackQuery(callbackQuery.id, { text: ru ? 'Не удалось принять запрос' : "So'rovni qabul qilib bo'lmadi", show_alert: true }).catch(() => {});
    }
    return;
  }

  if (data === 'cancel_ai_answers_payment') {
    await bot.answerCallbackQuery(callbackQuery.id, { text: 'To\'lov bekor qilindi' });
    return;
  }

  // Contextual follow-up actions are attached to a completed legal answer.
  // They reuse the existing paid-document and verified-attorney workflows;
  // no extra intent-classification model call is needed.
  if (data.startsWith('nxt_')) {
    try {
      const telegramAgent = require('../agents/telegram-agent');
      const current = await telegramAgent.loadConversation(chatId);

      if (data === 'nxt_attorney_go') {
        const caseSummary = String((current.context || {}).caseSummary || '').trim();
        if (current.state !== 'attorney_problem' || !caseSummary) {
          await bot.answerCallbackQuery(callbackQuery.id, { text: 'Tanlov eskirgan. Huquqiy savolni qayta yuboring.', show_alert: true });
          return;
        }
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Mos advokatlar qidirilmoqda' });
        await bot.sendChatAction(chatId, 'typing').catch(() => {});
        const result = await telegramAgent.handleUserMessage({
          chatId,
          text: caseSummary,
          firstName: callbackQuery.from.first_name || '',
          testAccount,
          identity: await telegramIdentity(callbackQuery),
        });
        if (result && result.reply) {
          const parts = telegramAgent.splitForTelegram(result.reply);
          for (const part of parts) {
            await bot.sendMessage(chatId, part, { parse_mode: 'Markdown', disable_web_page_preview: true })
              .catch(() => bot.sendMessage(chatId, part.replace(/[*_`\[\]]/g, '')));
          }
        }
        return;
      }

      const actionId = data.slice(4);
      const actions = Array.isArray(current.context && current.context.nextActions)
        ? current.context.nextActions
        : [];
      const action = actions.find(item => item && item.id === actionId);
      if (!action) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Tanlov eskirgan. Huquqiy savolni qayta yuboring.', show_alert: true });
        return;
      }

      if (action.kind === 'document') {
        const typeCode = action.serviceSlug === 'claim'
          ? 'claim'
          : action.serviceSlug === 'demand'
            ? 'demand'
            : action.serviceSlug === 'complaint'
              ? 'complaint'
              : action.serviceSlug === 'legal-document'
                ? 'other'
                : 'application';
        const intake = resolveIntakeCallback(`doc_${typeCode}`, current.context || {});
        if (!intake) throw new Error('document action is not configured');
        const caseSummary = String((current.context || {}).nextActionQuestion || '').trim();
        const sourceLegalAnswer = String((current.context || {}).nextActionAnswer || '').trim();
        const questions = typeCode === 'demand'
          ? "Qabul qiluvchi va yuboruvchi F.I.O./tashkilotini, undiriladigan summa yoki talabni, voqea sanalarini, dalillarni va bajarish uchun beriladigan muddatni yozing."
          : "Sud yoki organ nomini (ma'lum bo'lsa), da'vogar va javobgarni, summa/talabni, muhim sanalarni hamda mavjud dalillarni yozing.";
        await telegramAgent.setConversationState(chatId, intake.state, {
          ...(intake.context || {}),
          caseSummary,
          sourceLegalAnswer,
          selectedNextAction: String(action.label || intake.context.documentTypeLabel || ''),
        });
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Hujjat turi tanlandi' });
        await bot.sendMessage(chatId, [
          `Tanlangan hujjat: *${typeCode === 'other' && action.documentType ? action.documentType : intake.context.documentTypeLabel}*`,
          `Ikki yo'l bor: 🤖 AI loyiha — darhol, Word faylda (tarifdagi 1 birlik yoki bir martalik ${require('../rag/one-time-products').formatUzs(require('../rag/one-time-products').PRODUCTS.draft.priceUzs)}); 👨‍⚖️ yurist tayyorlaydi yoki tekshiradi — narxni yurist belgilaydi, rozilik berguningizcha to'lov yo'q.`,
          caseSummary ? "Huquqiy vaziyatingiz va xulosa oldingi savol-javobdan olindi. Faqat yetishmayotgan ma'lumotlarni yozing." : '',
          '',
          questions,
          "Shaxsiy maxfiy ma'lumotlarni hozircha yubormang.",
          "Buyurtma 30 daqiqa kutadi; savol bermoqchi bo'lsangiz, ❌ Bekor qilish.",
        ].filter(Boolean).join('\n'), { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '❌ Bekor qilish', callback_data: 'docin_cancel' }]] } });
        return;
      }

      if (action.kind === 'attorney') {
        await telegramAgent.setConversationState(chatId, 'attorney_field', {
          caseSummary: String((current.context || {}).nextActionQuestion || '').trim(),
          sourceLegalAnswer: String((current.context || {}).nextActionAnswer || '').trim(),
          selectedNextAction: String(action.label || ''),
        });
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Qidiruv mezonlarini tanlang' });
        await bot.sendMessage(chatId, "Advokat qidirish uchun huquq yo'nalishini o'zingiz tanlang. Keyingi bosqichda istalgan hududni yoki “Barcha hududlar”ni tanlashingiz mumkin.", {
          reply_markup: attorneyFieldKeyboard(),
        });
        return;
      }
    } catch (error) {
      console.error('[BOT] next-action callback failed:', error.message);
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Keyingi qadamni ochib bo\'lmadi. Qayta urinib ko\'ring.', show_alert: true });
      return;
    }
  }

  // Guided intake is deterministic: menu clicks update the conversation state
  // without spending an LLM call or guessing the user's legal field.
  if (/^(intake_home|svc_|atf_|atr_|doc_)/.test(data)) {
    try {
      const { loadConversation, resetConversation, setConversationState } = require('../agents/telegram-agent');
      const current = await loadConversation(chatId);
      const action = resolveIntakeCallback(data, current.context || {});
      if (!action) {
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Tanlov eskirgan. /start ni bosing.' });
        return;
      }
      if (action.reset) await resetConversation(chatId);
      await setConversationState(chatId, action.state, action.context || {});
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Tanlandi' });
      await bot.sendMessage(chatId, action.message, action.replyMarkup ? { reply_markup: action.replyMarkup } : {});
    } catch (error) {
      console.error('[BOT] intake callback failed:', error.message);
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Xatolik yuz berdi. /start ni qayta bosing.', show_alert: true });
    }
    return;
  }

  // Handle channel-subscription re-check
  if (data === 'check_sub') {
    try {
      if (await isChannelMember(callbackQuery.from.id)) {
        bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Rahmat! Obuna tasdiqlandi.' });
        bot.sendMessage(chatId, '✅ Obuna tasdiqlandi! Kerakli xizmatni tanlang:', { reply_markup: serviceKeyboard() });
      } else {
        bot.answerCallbackQuery(callbackQuery.id, {
          text: 'Hali obuna bo\'lmadingiz. Iltimos, kanalga obuna bo\'ling.',
          show_alert: true
        });
      }
    } catch (error) {
      console.error('check_sub callback error:', error);
      bot.answerCallbackQuery(callbackQuery.id, { text: 'Xatolik yuz berdi!' });
    }
    return;
  }

  // Handle respond_REQUEST_ID
  if (data.startsWith('respond_')) {
    const requestId = parseInt(data.replace('respond_', ''));

    try {
      // Check if this chat belongs to a linked admin
      const admin = await getLinkedAccount(pool, chatId, privateSenderId(callbackQuery));

      if (!admin) {
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Avval /link buyrug\'i bilan ulaning!' });
        return;
      }
      // Only staff answer requests; a linked customer (role 'user') or an
      // unknown role cannot, whatever button they replay.
      if (!isStaffRole(admin.role)) {
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Bu amal faqat yuristlar uchun.' });
        return;
      }

      // Check request exists and is assigned to this admin
      const reqResult = await pool.query(
        'SELECT id, status, request_text, request_type FROM requests WHERE id = $1',
        [requestId]
      );

      if (reqResult.rows.length === 0) {
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Murojaat topilmadi!' });
        return;
      }

      const req = reqResult.rows[0];
      if (req.status === 'answered') {
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Bu murojaatga allaqachon javob berilgan!' });
        return;
      }

      // Set pending response
      pendingResponses.set(chatId, {
        requestId: requestId,
        adminId: admin.id,
        role: admin.role,
        fullName: admin.full_name
      });

      bot.answerCallbackQuery(callbackQuery.id, { text: 'Javobingizni yozing!' });
      bot.sendMessage(chatId, `✏️ Murojaat #${requestId} ga javobingizni yozing:\n\n(Matn shaklida yuboring. Bekor qilish: /cancel)`);

    } catch (error) {
      console.error('Callback query error:', error);
      bot.answerCallbackQuery(callbackQuery.id, { text: 'Xatolik yuz berdi!' });
    }
  }
}

// ========== START & HELP COMMANDS ==========

bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || '';
  let param = (match[1] || '').trim();
  await telegramEconomy.recordTelegramActivity(chatId);

  // CustDev offer link: /start ref_<code> (src/sales/agents.js). The first agent
  // stays; an unknown code is ignored and the start goes on as a plain /start.
  // The other prefixes (verify_, plink_, login_, reg_, stepup_ ...) never start with "ref_".
  if (/^ref_/.test(param)) {
    const code = param.slice(4);
    param = '';
    try {
      const r = await require('../sales/agents').rememberTelegramRef(pool, { telegramUserId: msg.from.id, code });
      if (r.known && msg.chat.type === 'private') {
        const appUrl = String(process.env.APP_URL || 'https://juristai.uz').replace(/\/+$/, '');
        await bot.sendMessage(chatId, r.hasAccount
          ? "Taklif havolasi qabul qilindi. 14 kunlik pilot so'rovingiz JuristAI jamoasiga yuborildi — tasdiqlanganda shu yerda xabar olasiz."
          : `Taklif havolasi qabul qilindi. 14 kunlik pilotda qatnashish uchun saytda Telegram orqali ro'yxatdan o'ting: ${appUrl}/app/kirish.html\n\nSavollaringizni shu botga hozir ham yozishingiz mumkin.`).catch(() => {});
        return;
      }
    } catch (e) {
      console.warn('[BOT] ref link not recorded:', e.message);
    }
  }
  const fromRefLink = !param && /^\/start\s+ref_/.test(String(msg.text || ''));

  // Authentication never happens in the public legal-question bot. Preserve
  // the deep-link payload and send the user to the dedicated auth bot.
  if (/^(login_|reg_|recover_|legacy_recover_|stepup_)/.test(param)) {
    const authUrl = `https://t.me/${AUTH_BOT_USERNAME}?start=${encodeURIComponent(param)}`;
    await bot.sendMessage(chatId,
      'Kirish, ro\'yxatdan o\'tish va parolni tiklash uchun maxsus JuristAI botidan foydalaning.',
      { reply_markup: { inline_keyboard: [[{ text: 'JuristAI ro\'yxatdan o\'tish boti', url: authUrl }]] } }
    );
    return;
  }

  if (param === 'advokat') {
    try {
      const { resetConversation, setConversationState } = require('../agents/telegram-agent');
      await resetConversation(chatId);
      await setConversationState(chatId, 'attorney_field', {});
    } catch (error) {
      console.warn('[BOT] attorney intake state could not be saved:', error.message);
    }
    await bot.sendMessage(chatId,
      "Sizga mos advokat topish uchun avval huquq yo'nalishini tanlang:",
      { reply_markup: attorneyFieldKeyboard() }
    );
    return;
  }

  // Deep link: /start verify_TOKEN — deliver verification code
  if (param.startsWith('verify_')) {
    const deepToken = param.replace('verify_', '');
    const pending = verificationTokens.get(deepToken);
    if (pending && Date.now() < pending.expiresAt) {
      // Save chat_id so we can notify this user on approve/reject
      pending.chatId = chatId;
      bot.sendMessage(chatId, `🔐 Dictum Dashboard tasdiqlash kodi: ${pending.code}\n\nUshbu kod 5 daqiqa amal qiladi.\nKodni ro'yxatdan o'tish formasiga kiriting.`);
      return;
    }
    bot.sendMessage(chatId, '⏳ Tasdiqlash kodi topilmadi yoki muddati o\'tgan.\nIltimos, ro\'yxatdan o\'tish sahifasida qayta "Kod yuborish" tugmasini bosing.');
    return;
  }

  // Deep link: /start plink_CODE — link a web-portal account to this Telegram
  // user and verify channel membership (free-access flow).
  if (param.startsWith('plink_')) {
    const code = param.replace('plink_', '').trim();
    try {
      const row = (await pool.query(
        'SELECT id, full_name FROM portal_users WHERE telegram_link_code = $1', [code]
      )).rows[0];
      if (!row) {
        bot.sendMessage(chatId, '⏳ Havola eskirgan yoki noto\'g\'ri. Saytda qayta urinib ko\'ring.');
        return;
      }
      const tgId = String(msg.from.id);
      // Anti-abuse: one Telegram account per portal user
      const taken = (await pool.query(
        'SELECT id FROM portal_users WHERE telegram_user_id = $1 AND id <> $2', [tgId, row.id]
      )).rows[0];
      if (taken) {
        bot.sendMessage(chatId, '⚠️ Bu Telegram hisobi allaqachon boshqa akkauntga ulangan.');
        return;
      }
      await pool.query(
        'UPDATE portal_users SET telegram_user_id = $1, telegram_username = $2, telegram_link_code = NULL WHERE id = $3',
        [tgId, msg.from.username || null, row.id]
      );
      const isMember = await isChannelMember(msg.from.id);
      if (isMember) {
        await pool.query('UPDATE portal_users SET channel_verified_at = NOW() WHERE id = $1', [row.id]);
        bot.sendMessage(chatId, '✅ Hisobingiz ulandi va kanal obunasi tasdiqlandi!\n\nEndi saytga qaytib, bepul foydalanishni davom ettiring.');
      } else {
        bot.sendMessage(chatId,
          'ℹ️ Hisobingiz ulandi. Endi rasmiy kanalga obuna bo\'ling, so\'ng saytdagi "Tekshirish" tugmasini bosing.',
          { reply_markup: { inline_keyboard: freeAccessKeyboard(false) } }
        );
      }
    } catch (e) {
      console.error('[plink]', e.message);
      bot.sendMessage(chatId, '❌ Xatolik yuz berdi. Qaytadan urinib ko\'ring.');
    }
    return;
  }

  // Deep link: /start ulink_CODE — link a dashboard (role='user') account to
  // this Telegram user and verify channel membership (free-access flow).
  if (param.startsWith('ulink_')) {
    const code = param.replace('ulink_', '').trim();
    try {
      const row = (await pool.query(
        'SELECT id FROM admins WHERE telegram_link_code = $1', [code]
      )).rows[0];
      if (!row) {
        bot.sendMessage(chatId, '⏳ Havola eskirgan yoki noto\'g\'ri. Saytda qayta urinib ko\'ring.');
        return;
      }
      const tgId = String(msg.from.id);
      // this Telegram must not stay on another account by either column
      // (a Telegram sign-in sets both); the person can free it with /unlink
      const taken = (await pool.query(
        'SELECT id FROM admins WHERE (telegram_user_id = $1 OR telegram_chat_id = $1) AND id <> $2', [tgId, row.id]
      )).rows[0];
      if (taken) {
        bot.sendMessage(chatId, "⚠️ Bu Telegram boshqa JuristAI akkauntiga ulangan (masalan, Telegram orqali kirganingizda yangi akkaunt ochilgan bo'lishi mumkin).\n\nUni shu akkauntga o'tkazish uchun: shu chatda /unlink yuboring, so'ng saytdagi \"Telegram'ni ulash\" tugmasini qayta bosing.");
        return;
      }
      // the account's previous Telegram (old chat id) is detached: one account, one Telegram
      await pool.query(
        `UPDATE admins SET telegram_user_id = $1, telegram_username = $2, telegram_link_code = NULL,
                telegram_chat_id = CASE WHEN $4 THEN $1::bigint ELSE NULL END
          WHERE id = $3`,
        [tgId, msg.from.username || null, row.id, msg.chat.type === 'private']
      );
      // a paid plan: say so plainly, nothing about the free-access channel
      let paid = null;
      try {
        const b = await require('../rag/tariff-ledger').balance({ adminId: row.id, telegramUserId: tgId });
        if (b.kind === 'paid' || b.kind === 'test') paid = b;
      } catch (_) { paid = null; }
      if (paid) {
        const label = (require('../rag/tariff-ledger').PLAN_CATALOG[paid.plan] || {}).label || paid.plan;
        bot.sendMessage(chatId, `✅ Telegram akkauntingizga ulandi. Tarif: ${label}${paid.endsAt ? ` (${new Date(paid.endsAt).toLocaleDateString('ru-RU', { timeZone: 'Asia/Tashkent' })} gacha)` : ''}.\n\nEndi savol, hujjat va ovozli xabarlar shu yerda tarifingizdan hisoblanadi; bot va sayt limiti umumiy. Qoldiq: /balance · Uzish: /unlink`);
        return;
      }
      const isMember = await isChannelMember(msg.from.id);
      if (isMember) {
        await pool.query('UPDATE admins SET channel_verified_at = NOW() WHERE id = $1', [row.id]);
        bot.sendMessage(chatId, '✅ Hisobingiz ulandi va kanal obunasi tasdiqlandi!\n\nEndi saytga qaytib, bepul foydalanishni davom ettiring.');
      } else {
        bot.sendMessage(chatId,
          'ℹ️ Hisobingiz ulandi. Endi rasmiy kanalga obuna bo\'ling, so\'ng saytdagi "Tekshirish" tugmasini bosing.',
          { reply_markup: { inline_keyboard: freeAccessKeyboard(false) } }
        );
      }
    } catch (e) {
      console.error('[ulink]', e.message);
      bot.sendMessage(chatId, '❌ Xatolik yuz berdi. Qaytadan urinib ko\'ring.');
    }
    return;
  }

  // Deep link: /start login_TOKEN — generate 4-digit OTP for login
  if (param.startsWith('login_')) {
    const token = param.replace('login_', '').trim();
    const session = loginSessions.get(token);
    if (session && !session.otp) {
      const otp = require('../auth/otp').digitCode(4);
      session.otp = otp;
      session.telegramUserId = String(msg.from.id);
      session.otpSentAt = Date.now();
      bot.sendMessage(chatId,
        `🔑 *JuristAI kirish kodi:*\n\n*${otp}*\n\nUshbu 4 raqamli kodni saytdagi maydoniga kiriting.\nKod 10 daqiqa amal qiladi.`,
        { parse_mode: 'Markdown' }
      );
    } else if (session && session.otp) {
      bot.sendMessage(chatId, `⚠️ Kirish kodi allaqachon yuborilgan. Saytga qayting va kodni kiriting.`);
    } else {
      bot.sendMessage(chatId, '⏳ Sessiya topilmadi yoki muddati o\'tgan.\nIltimos, saytda qayta urinib ko\'ring.');
    }
    return;
  }

  // Deep link: /start reg_TOKEN — generate 4-digit OTP and send to user
  if (param.startsWith('reg_')) {
    const token = param.replace('reg_', '').trim();
    const session = regSessions.get(token);
    if (session && !session.otp) {
      const otp = require('../auth/otp').digitCode(4);
      session.otp = otp;
      session.telegramUserId = String(msg.from.id);
      session.firstName = msg.from.first_name || '';
      session.lastName = msg.from.last_name || '';
      session.username = msg.from.username || '';
      session.otpSentAt = Date.now();
      bot.sendMessage(chatId,
        `🔐 *JuristAI ro'yxatdan o'tish kodi:*\n\n` +
        `*${otp}*\n\n` +
        `Ushbu 4 raqamli kodni saytdagi maydoniga kiriting.\n` +
        `Kod 10 daqiqa amal qiladi.`,
        { parse_mode: 'Markdown' }
      );
    } else if (session && session.otp) {
      bot.sendMessage(chatId, `⚠️ Kod allaqachon yuborilgan. Saytga qayting va kodni kiriting.\n\nAgar muammo bo'lsa, sahifani yangilab qayta urinib ko'ring.`);
    } else {
      bot.sendMessage(chatId, '⏳ Sessiya topilmadi yoki muddati o\'tgan.\nIltimos, saytda qayta ro\'yxatdan o\'tishni boshlang.');
    }
    return;
  }

  // Deep link: /start recover_TOKEN — anonymous recovery (identify by telegram_user_id)
  if (param.startsWith('recover_')) {
    const deepToken = param.replace('recover_', '');
    const crypto = require('crypto');
    const appUrl = process.env.APP_URL || ('https://' + (process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:3000'));

    // Look up the user by their permanent telegram_user_id (no username needed)
    const tgId = String(msg.from.id);
    try {
      const row = (await pool.query('SELECT id FROM admins WHERE telegram_user_id = $1', [tgId])).rows[0];
      if (row) {
        const resetToken = crypto.randomBytes(20).toString('hex');
        verificationTokens.set('pwreset_' + resetToken, { adminId: row.id, expiresAt: Date.now() + 15 * 60 * 1000 });
        const recoverLink = `${appUrl}/login.html?recover=${resetToken}`;
        await bot.sendMessage(chatId, `🔑 Parolni tiklash havolasi:\n${recoverLink}\n\nHavola 15 daqiqa amal qiladi.`);
        // Signal the browser poller via the shared store
        const botInitKey = 'botinit_' + deepToken;
        if (verificationTokens.has(botInitKey)) {
          const s = verificationTokens.get(botInitKey);
          s.confirmed = true;
          // the reset link went to this Telegram chat only; the browser learns "confirmed"
        }
        return;
      }
      bot.sendMessage(chatId, '❌ Bu Telegram hisobi bilan ro\'yxatdan o\'tilmagan. Iltimos, avval ro\'yxatdan o\'ting.');
      return;
    } catch(e) {
      console.error('[Bot recovery]', e.message);
      bot.sendMessage(chatId, '⚠️ Xatolik yuz berdi. Iltimos, keyinroq urinib ko\'ring.');
      return;
    }
  }

  // Legacy recover_ with old code-based flow (kept for backward compat)
  if (param.startsWith('legacy_recover_')) {
    const deepToken = param.replace('legacy_recover_', '');
    const pending = verificationTokens.get('recovery_' + deepToken);
    if (pending && Date.now() < pending.expiresAt) {
      pending.chatId = chatId;
      bot.sendMessage(chatId, `🔑 Parolni tiklash kodi: ${pending.code}\n\nUshbu kod 5 daqiqa amal qiladi.\nKodni parolni tiklash formasiga kiriting.`);
      return;
    }
    bot.sendMessage(chatId, '⏳ Tiklash kodi topilmadi yoki muddati o\'tgan.\nIltimos, qayta "Kod olish" tugmasini bosing.');
    return;
  }

  // Fallback for bare /start (Telegram sometimes strips the start parameter on
  // existing chats). Find the most recently created pending session and attach
  // this user to it, then send the OTP code as if the deep link had worked.
  if (!param && !fromRefLink && LEGAL_BOT_AUTH_FALLBACK_ENABLED) {
    const WINDOW_MS = 120000; // 2 minutes
    const now = Date.now();
    let bestReg = null, bestRegTime = 0;
    for (const [token, s] of regSessions.entries()) {
      if (!s.otp && (now - s.createdAt) < WINDOW_MS && s.createdAt > bestRegTime) {
        bestReg = { token, s }; bestRegTime = s.createdAt;
      }
    }
    let bestLogin = null, bestLoginTime = 0;
    for (const [token, s] of loginSessions.entries()) {
      if (!s.otp && (now - s.createdAt) < WINDOW_MS && s.createdAt > bestLoginTime) {
        bestLogin = { token, s }; bestLoginTime = s.createdAt;
      }
    }

    // Prefer whichever is more recent
    if (bestReg && bestRegTime >= bestLoginTime) {
      const otp = require('../auth/otp').digitCode(4);
      bestReg.s.otp = otp;
      bestReg.s.telegramUserId = String(msg.from.id);
      bestReg.s.firstName = msg.from.first_name || '';
      bestReg.s.lastName = msg.from.last_name || '';
      bestReg.s.username = msg.from.username || '';
      bestReg.s.otpSentAt = now;
      return bot.sendMessage(chatId,
        `🔐 *JuristAI ro'yxatdan o'tish kodi:*\n\n*${otp}*\n\nUshbu 4 raqamli kodni saytdagi maydoniga kiriting.\nKod 10 daqiqa amal qiladi.`,
        { parse_mode: 'Markdown' });
    }
    if (bestLogin) {
      const otp = require('../auth/otp').digitCode(4);
      bestLogin.s.otp = otp;
      bestLogin.s.telegramUserId = String(msg.from.id);
      bestLogin.s.otpSentAt = now;
      return bot.sendMessage(chatId,
        `🔑 *JuristAI kirish kodi:*\n\n*${otp}*\n\nUshbu 4 raqamli kodni saytdagi maydoniga kiriting.\nKod 10 daqiqa amal qiladi.`,
        { parse_mode: 'Markdown' });
    }

    // No pending session — also try recovery
    try {
      const tgId = String(msg.from.id);
      const row = (await pool.query('SELECT id FROM admins WHERE telegram_user_id = $1', [tgId])).rows[0];
      if (row) {
        // Existing user with no pending session — show welcome
      }
    } catch(e) { console.error('[Bot bare-start]', e.message); }
  }

  try {
    const telegramAgent = require('../agents/telegram-agent');
    // A bare /start means "begin again". Clear stale clarification/service
    // states so the next message is classified normally. The reset deliberately
    // preserves human-takeover mode when an operator is handling the chat.
    await telegramAgent.resetConversation(chatId);
  } catch (error) {
    console.warn('[BOT] conversation could not be reset on /start:', error.message);
  }
  pendingFiles.delete(chatId);
  let communityLine = '';
  try {
    const publicStats = await telegramEconomy.getTelegramUserStats();
    communityLine = `\n\n📊 Bugun ${publicStats.dailyUsers} ta, shu oy ${publicStats.monthlyUsers} ta faol foydalanuvchi.`;
  } catch (error) {
    console.warn('[BOT] welcome stats unavailable:', error.message);
  }
  const welcomeMessage = `Assalomu alaykum, ${msg.from.first_name}! 👋

JuristAIga xush kelibsiz. Men inson yurist emasman — O'zbekiston qonunchiligi bo'yicha ma'lumot beruvchi AI yordamchiman.

📝 Huquqiy vaziyatingizni matn shaklida yozing. ${tariffTexts.START_LIMIT_TEXT()}

${tariffTexts.startFileLine({ voiceToText: voiceToTextEnabled() })}${communityLine}

Javoblar umumiy huquqiy ma'lumot bo'lib, rasmiy yuridik xulosa hisoblanmaydi.`;

  bot.sendMessage(chatId, welcomeMessage, {
    reply_markup: startKeyboard(false)
  });
  pendingRequests[chatId] = { username: username || 'Noma\'lum', messages: [] };
});

bot.onText(/^\/alifbo(?:@\w+)?$/, (msg) => {
  const al = require('./alphabet');
  bot.sendMessage(msg.chat.id, al.TEXT.ask, { reply_markup: al.keyboard }).catch(() => {});
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;

  const helpMessage = `📋 Yordam

1. /start orqali xizmat turini tanlang.
2. Huquqiy vaziyatingizni matn shaklida yozing.
3. Tariflar:
${tariffTexts.planLines().join('\n')}
4. Salomlashuv, menyu, /balance va yordam buyruqlari limit sarflamaydi. Telegram va veb hisoblaringiz ulangan bo'lsa, limit umumiy.

/stats — faol foydalanuvchilar soni
/balance — tarif va limit qoldig'i
/terms — to'lov shartlari
/paysupport — to'lov muammosi bo'yicha yordam

👨‍💼 Admin buyruqlari:
/link <username> <parol> - Telegram hisobni ulash
/unlink - Ulangan hisobni uzish
/me - Hisob holatini ko'rish
/cancel - Javob berishni bekor qilish

Qo'shimcha savol bo'lsa: /start ni qayta bosing`;

  bot.sendMessage(chatId, helpMessage);
});

bot.onText(/\/stats/, async (msg) => {
  try {
    await telegramEconomy.recordTelegramActivity(msg.chat.id);
    await sendPublicStats(msg.chat.id);
  } catch (error) {
    console.error('[BOT] /stats failed:', error.message);
    await bot.sendMessage(msg.chat.id, 'Statistikani hozir yuklab bo\'lmadi. Keyinroq qayta urinib ko\'ring.');
  }
});

bot.onText(/\/balance/, async (msg) => {
  try {
    await telegramEconomy.recordTelegramActivity(msg.chat.id);
    // tariffs v2: the plan and what is left, from the same ledger that
    // meters the answers (linked Telegram and web accounts share it)
    const identity = await telegramIdentity(msg);
    const status = await telegramEconomy.getTelegramAnswerStatus(msg.chat.id, identity);
    const balance = await require('../rag/tariff-ledger').balance(identity);
    // the test account (src/bot/test-account.js): its mode, end time and budget
    const testAccount = await testAccounts.resolveTestAccount(pool, {
      chatId: msg.chat.id, chatType: msg.chat.type, fromUserId: msg.from && msg.from.id,
    });
    await bot.sendMessage(msg.chat.id, tariffTexts.balanceText({
      balance, paidCredits: status.paidCredits || 0, pending: status.pending,
      testAccountText: testAccount ? `${testAccounts.balanceText(testAccount)}\n\nTest rejimi davomida quyidagi limit ishlatilmaydi.` : '',
    }));
  } catch (error) {
    console.error('[BOT] /balance failed:', error.message);
    await bot.sendMessage(msg.chat.id, 'Kredit qoldig\'ini hozir tekshirib bo\'lmadi.');
  }
});

bot.onText(/\/paysupport/, async (msg) => {
  await telegramEconomy.recordTelegramActivity(msg.chat.id);
  pendingPaymentSupport.set(msg.chat.id, Date.now());
  await bot.sendMessage(msg.chat.id,
    'To\'lov bo\'yicha muammoni bitta xabarda yozing. Imkon bo\'lsa Telegram to\'lov cheki yoki tranzaksiya raqamini ham kiriting. Xabaringiz Master Adminga yuboriladi.\n\nTelegram qo\'llab-quvvatlashi JuristAI ichidagi xaridlarni ko\'rib chiqmaydi.'
  );
});

bot.onText(/\/terms/, async (msg) => {
  await telegramEconomy.recordTelegramActivity(msg.chat.id);
  await bot.sendMessage(msg.chat.id, paymentTermsText(), { parse_mode: 'Markdown' });
});

bot.on('pre_checkout_query', async (query) => {
  // a one-time service (src/bot/one-time-sales.js), else the legacy answer pack
  const service = oneTimeSales.checkPreCheckout(query);
  const valid = service !== null ? service : starsInvoice.matchesOffer(
    readAnswerOffer(query.invoice_payload, query.from.id), query.currency, query.total_amount);
  await bot.answerPreCheckoutQuery(query.id, valid, valid ? {} : {
    error_message: 'To\'lov ma\'lumotlari eskirgan. Botdagi tugma orqali yangi hisob oching.',
  }).catch(error => console.error('[BOT] pre-checkout reply failed:', error.message));
});

// ========== MAIN MESSAGE HANDLER ==========

// Speak an answer back as a Telegram voice note (VoiceLab TTS). OGG/Opus shows
// as a voice bubble; if transcoding was unavailable the WAV goes as audio.
async function sendVoiceReply(chatId, text) {
  const speech = require('../ai/voicelab-speech');
  if (!speech.ttsEnabled()) return;
  await bot.sendChatAction(chatId, 'record_voice').catch(() => {});
  const spoken = await speech.synthesize(text);
  if (!spoken) return;
  if (spoken.format === 'ogg') {
    await bot.sendVoice(chatId, spoken.audio, {}, { filename: 'javob.ogg', contentType: 'audio/ogg' });
  } else {
    await bot.sendAudio(chatId, spoken.audio, { title: 'JuristAI javobi' }, { filename: 'javob.wav', contentType: 'audio/wav' });
  }
}

// Each Telegram message is one usage-ledger request: every AI call it makes
// (intent, retrieval, answer, checks, STT, TTS) shares its request_id.
bot.on('message', (msg) => usageLedger.runWithRequest(
  { service: 'telegram', chatId: msg.chat && msg.chat.id, kind: telegramMessageKind(msg) },
  (store) => handleTelegramMessage(msg)
    .finally(() => usageLedger.finishRequest(store).catch(() => {}))));

function telegramMessageKind(msg = {}) {
  if (msg.voice) return 'voice';
  if (msg.document || msg.photo || msg.video || msg.video_note) return 'file';
  if (msg.successful_payment) return 'payment';
  return 'text';
}

async function handleTelegramMessage(msg) {
  const chatId = msg.chat.id;
  // a rollback in progress: no AI, no usage, a short notice
  const maintenance = require('../api/maintenance');
  if (maintenance.maintenanceOn()) {
    if (msg.chat && msg.chat.type === 'private') bot.sendMessage(chatId, maintenance.MESSAGE).catch(() => {});
    return;
  }
  const testAccount = await testAccountFor(msg);
  const username = msg.from.username || `user_${msg.from.id}`;
  const firstName = msg.from.first_name || 'Foydalanuvchi';

  // Telegram sends a successful payment as a service message. Credit it once
  // before normal request routing and never treat it as a legal question.
  if (msg.successful_payment) {
    await telegramEconomy.recordTelegramActivity(chatId);
    if (await oneTimeSales.onPayment(msg)) return;
    const payment = msg.successful_payment;
    const offer = readAnswerOffer(payment.invoice_payload, msg.from.id);
    if (!starsInvoice.matchesOffer(offer, payment.currency, payment.total_amount)) {
      // Pre-checkout should have stopped this; if money moved anyway, give
      // it back rather than keep it with nothing granted.
      console.error('[BOT] rejected unexpected successful payment payload');
      const refunded = payment.currency === 'XTR'
        && await refundStars(msg.from.id, payment.telegram_payment_charge_id);
      await bot.sendMessage(chatId, refunded
        ? 'To\'lovni tasdiqlab bo\'lmadi, Stars hisobingizga qaytarildi. Botdagi tugma orqali qayta urinib ko\'ring.'
        : `To'lovni tasdiqlab bo'lmadi. /paysupport ga yozing. Tranzaksiya: ${payment.telegram_payment_charge_id}`
      ).catch(() => {});
      return;
    }
    let granted;
    try {
      granted = await telegramEconomy.grantPaidAnswers({
        chatId,
        telegramUserId: msg.from.id,
        invoicePayload: payment.invoice_payload,
        currency: payment.currency,
        totalAmount: payment.total_amount,
        credits: offer.credits,
        telegramPaymentChargeId: payment.telegram_payment_charge_id,
        providerPaymentChargeId: payment.provider_payment_charge_id,
      });
    } catch (error) {
      // grantPaidAnswers runs in one transaction, so a failure granted
      // nothing: return the Stars instead of leaving the user charged.
      console.error('[BOT] paid answer credit failed:', error.message);
      const refunded = await refundStars(msg.from.id, payment.telegram_payment_charge_id);
      await bot.sendMessage(chatId, refunded
        ? 'Kreditni qo\'shishda xatolik yuz berdi, Stars hisobingizga qaytarildi. Birozdan keyin qayta urinib ko\'ring.'
        : `To'lov qabul qilindi, ammo kreditni avtomatik qo'shishda xatolik yuz berdi. /paysupport ga yozing. Tranzaksiya: ${payment.telegram_payment_charge_id}`
      ).catch(() => {});
      return;
    }
    if (granted && granted.credited) {
      await bot.sendMessage(chatId,
        `To'lov qabul qilindi. Hisobingizga ${offer.credits} ta huquqiy javob qo'shildi. Hozirgi qoldiq: ${granted.credits}.\n\nHuquqiy savolingizni yozing.`
      ).catch(error => console.error('[BOT] payment receipt failed:', error.message));
    }
    return;
  }

  await telegramEconomy.recordTelegramActivity(chatId);

  // Ignore commands after recording anonymous activity. Their dedicated
  // command handlers own the response.
  if (msg.text && msg.text.startsWith('/')) return;

  // the claim agent asked for missing facts: this message is the answer
  if (msg.chat && msg.chat.type === 'private' && await resumeClaimAgent(msg)) return;

  if (pendingPaymentSupport.has(chatId)) {
    const supportStartedAt = pendingPaymentSupport.get(chatId);
    if (Date.now() - supportStartedAt > 15 * 60 * 1000) {
      pendingPaymentSupport.delete(chatId);
    } else {
    pendingPaymentSupport.delete(chatId);
    const supportText = String(msg.text || msg.caption || '').trim();
    if (!supportText) {
      await bot.sendMessage(chatId, 'Iltimos, to\'lov muammosini matn shaklida yozing.');
      pendingPaymentSupport.set(chatId, Date.now());
      return;
    }
    try {
      const notified = new Set();
      if (process.env.ADMIN_TELEGRAM_ID) {
        await bot.sendMessage(process.env.ADMIN_TELEGRAM_ID,
          `To'lov bo'yicha yordam so'rovi\n\nFoydalanuvchi: ${firstName}\nTelegram ID: ${chatId}\nUsername: @${username}\n\n${supportText}`
        );
        notified.add(String(process.env.ADMIN_TELEGRAM_ID));
      }
      const masters = await pool.query(
        "SELECT telegram_chat_id FROM admins WHERE role = 'master' AND telegram_chat_id IS NOT NULL"
      );
      for (const master of masters.rows) {
        if (notified.has(String(master.telegram_chat_id))) continue;
        await bot.sendMessage(master.telegram_chat_id,
          `To'lov bo'yicha yordam so'rovi\n\nFoydalanuvchi: ${firstName}\nTelegram ID: ${chatId}\nUsername: @${username}\n\n${supportText}`
        ).catch(() => {});
      }
      await bot.sendMessage(chatId, 'To\'lov bo\'yicha murojaatingiz qabul qilindi. Master Admin tekshirib, shu yerda javob beradi.');
    } catch (error) {
      console.error('[BOT] payment support routing failed:', error.message);
      await bot.sendMessage(chatId, 'Murojaatni yuborib bo\'lmadi. Keyinroq /paysupport orqali qayta urinib ko\'ring.');
    }
    return;
    }
  }

  // ---- CHECK IF SENDER IS A LINKED ADMIN WITH PENDING RESPONSE ----
  if (pendingResponses.has(chatId)) {
    const pending = pendingResponses.get(chatId);

    // Only accept text responses
    if (!msg.text) {
      bot.sendMessage(chatId, '⚠️ Faqat matn shaklida javob yuboring.\n/cancel - Bekor qilish');
      return;
    }

    const responseText = msg.text.trim();
    pendingResponses.delete(chatId);

    try {
      if (pending.role === 'student') {
        // Student response: needs master approval
        await pool.query(
          `UPDATE requests SET student_response = $1, status = 'student_responded',
           student_admin_id = $2, responded_by = $3
           WHERE id = $4`,
          [responseText, pending.adminId, pending.fullName, pending.requestId]
        );

        bot.sendMessage(chatId, `✅ Javobingiz yuborildi! (Murojaat #${pending.requestId})\n\n⏳ Admin tasdiqlashini kuting.`);

        // Notify master admin(s)
        try {
          const reqInfo = await pool.query(
            `SELECT r.request_text, u.first_name, u.username
             FROM requests r JOIN users u ON r.user_id = u.id WHERE r.id = $1`,
            [pending.requestId]
          );
          const req = reqInfo.rows[0];

          const masterNotification = `📝 Student javob berdi!\n\n👨‍🎓 Student: ${pending.fullName}\n📋 Murojaat #${pending.requestId}\n👤 Murojatchi: ${req?.first_name || ''} (@${req?.username || ''})\n\n📝 Student javobi:\n${responseText.substring(0, 200)}${responseText.length > 200 ? '...' : ''}\n\nDashboard: ${dashboardUrl()}\nTasdiqlash uchun dashboardga kiring!`;

          // Notify via ADMIN_TELEGRAM_ID
          await bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, masterNotification);

          // Also notify all linked master admins
          const masters = await pool.query(
            'SELECT telegram_chat_id FROM admins WHERE role = $1 AND telegram_chat_id IS NOT NULL',
            ['master']
          );
          for (const m of masters.rows) {
            if (String(m.telegram_chat_id) !== String(process.env.ADMIN_TELEGRAM_ID)) {
              bot.sendMessage(m.telegram_chat_id, masterNotification).catch(() => {});
            }
          }
        } catch (notifErr) {
          console.error('Failed to notify master:', notifErr);
        }

      } else {
        // Master/Lawyer: direct response - send to client
        const reqResult = await pool.query(
          `SELECT r.user_id, r.request_text, u.telegram_id, u.first_name
           FROM requests r JOIN users u ON r.user_id = u.id WHERE r.id = $1`,
          [pending.requestId]
        );

        if (reqResult.rows.length === 0) {
          bot.sendMessage(chatId, '❌ Murojaat topilmadi.');
          return;
        }

        const req = reqResult.rows[0];

        await pool.query(
          `UPDATE requests SET response_text = $1, status = 'answered',
           responded_by = $2, master_approved = TRUE, answered_at = NOW()
           WHERE id = $3`,
          [responseText, pending.fullName, pending.requestId]
        );

        // Send response to the client via Telegram
        const clientMessage = `✅ Yuristdan javob keldi!\n\nHurmatli ${req.first_name},\n\n${responseText}\n\nDictum advokatlik firmasi`;
        await bot.sendMessage(req.telegram_id, clientMessage);

        bot.sendMessage(chatId, `✅ Javob yuborildi! (Murojaat #${pending.requestId})\n\nMurojatchi: ${req.first_name}\nJavob muvaffaqiyatli yetkazildi.`);
      }
    } catch (error) {
      console.error('Response processing error:', error);
      bot.sendMessage(chatId, '❌ Javob yuborishda xatolik yuz berdi. Dashboarddan urinib ko\'ring.');
    }
    return;
  }

  // ---- CHECK IF SENDER IS LINKED STAFF (without pending response) ----
  // Only a staff role (master, lawyer, student) is kept off the question
  // path. A linked customer (role 'user') or an unknown role is an ordinary
  // user, and a master in /testmode falls through to the user path too.
  try {
    const account = await getLinkedAccount(pool, chatId, privateSenderId(msg));
    if (chatRoute(account, { testMode: inAdminTestMode(chatId) }) === 'staff') {
      bot.sendMessage(chatId, `👋 ${account.full_name}, siz admin sifatida ulangansiz.\n\nBildirishnomalarni shu yerda olasiz.\n\n📋 Dashboard: ${dashboardUrl()}\n/me - Hisob holati\n/unlink - Uzish${isMasterRole(account.role) ? '\n/testmode - Botni oddiy foydalanuvchi sifatida sinash' : ''}`);
      return;
    }
  } catch (error) {
    console.error('Admin check error:', error);
  }

  // ---- REGULAR USER: Process as legal request ----

  // Check if user is blocked
  try {
    const blockCheck = await pool.query(
      'SELECT blocked, block_reason FROM users WHERE telegram_id = $1',
      [chatId]
    );

    if (blockCheck.rows.length > 0 && blockCheck.rows[0].blocked) {
      const reason = blockCheck.rows[0].block_reason || 'Qoidabuzarlik uchun';
      bot.sendMessage(chatId, `🚫 Sizning hisobingiz bloklangan!\n\nSabab: ${reason}\n\nQo'shimcha ma'lumot uchun admin bilan bog'laning.`);
      return;
    }
  } catch (error) {
    console.error('Error checking user block status:', error);
  }

  // Channel membership is an explicit opt-in gate. It is disabled by default
  // so a legal question is never discarded after the user has typed it.
  if (TELEGRAM_CHANNEL_GATE_ENABLED && !(await isChannelMember(msg.from.id))) {
    sendJoinPrompt(chatId);
    return;
  }

  // ── A file must come WITH a written description ──────────────────────────
  // If a user attaches a document/photo/video without a caption, don't create
  // the request yet: hold the file and ask them to describe the situation. The
  // next text message they send is combined with the held file below.
  const MAX_FILE_SIZE = 5242880; // 5MB
  const attachedFile =
    (msg.document && { request_type: 'document', file_id: msg.document.file_id, file_size: msg.document.file_size, file_name: msg.document.file_name || 'fayl' }) ||
    (msg.video && { request_type: 'video', file_id: msg.video.file_id, file_size: msg.video.file_size, file_name: msg.video.file_name || 'video.mp4' }) ||
    (msg.photo && (() => { const p = msg.photo[msg.photo.length - 1]; return { request_type: 'photo', file_id: p.file_id, file_size: p.file_size, file_name: 'photo.jpg' }; })()) ||
    null;
  const caption = (msg.caption || '').trim();

  // A PDF or DOCX without a full description: AI analysis is offered first
  // (or the lawyer queue); a scan, photo or video goes on below as before.
  if (attachedFile && attachedFile.request_type === 'document' && caption.length < MIN_FILE_DESC) {
    try {
      if (await documentFlow.offer(msg)) { pendingFiles.delete(chatId); return; }
    } catch (e) {
      console.warn('[TG-DOC] offer failed, lawyer queue:', e.message);
    }
  }

  // A file needs a written description of at least MIN_FILE_DESC characters.
  // If it's missing or too short, hold the file and ask for a proper one.
  if (attachedFile && caption.length < MIN_FILE_DESC) {
    if (attachedFile.file_size && attachedFile.file_size > MAX_FILE_SIZE) {
      bot.sendMessage(chatId, '❌ Fayl hajmi juda katta! Maksimal: 5MB');
      return;
    }
    const alreadyPending = pendingFiles.has(chatId);
    pendingFiles.set(chatId, { ...attachedFile, at: Date.now() });
    // Only prompt once — an album arrives as several separate photo messages.
    if (!alreadyPending) {
      const tooShortNote = caption.length > 0
        ? `\n\n⚠️ Izohingiz juda qisqa (${caption.length}/${MIN_FILE_DESC} belgi).`
        : '';
      bot.sendMessage(chatId, tariffTexts.fileHeldText({ tooShortNote, minChars: MIN_FILE_DESC }));
    }
    return;
  }
  // A file with a sufficient caption supersedes any stale held file.
  if (attachedFile) pendingFiles.delete(chatId);

  let requestData = {
    telegram_id: chatId,
    username: username,
    first_name: firstName,
    request_text: '',
    request_type: 'text',
    file_id: null,
    file_size: null,
    file_name: null
  };

  // Handle different message types
  if (msg.text && pendingFiles.has(chatId)) {
    // This text is the description for a file the user just sent → combine them.
    const pf = pendingFiles.get(chatId);
    if (Date.now() - pf.at > PENDING_FILE_TTL) {
      // Held file expired — treat the text as a normal request.
      pendingFiles.delete(chatId);
      requestData.request_text = msg.text;
      requestData.request_type = 'text';
    } else {
      const desc = msg.text.trim();
      if (desc.length < MIN_FILE_DESC) {
        // Too short — keep the file held and ask for a fuller description.
        pf.at = Date.now();
        pendingFiles.set(chatId, pf);
        bot.sendMessage(chatId,
          `⚠️ Izohingiz juda qisqa (${desc.length}/${MIN_FILE_DESC} belgi).\n\n` +
          `Iltimos, vaziyatingizni batafsilroq yozing — kamida ${MIN_FILE_DESC} belgi. Faylingiz saqlanib turibdi.`
        );
        return;
      }
      pendingFiles.delete(chatId);
      requestData.request_text = msg.text;
      requestData.request_type = pf.request_type;
      requestData.file_id = pf.file_id;
      requestData.file_size = pf.file_size;
      requestData.file_name = pf.file_name;
    }
  }
  else if (msg.text) {
    requestData.request_text = msg.text;
    requestData.request_type = 'text';
  }
  else if (msg.voice) {
    requestData.request_text = '[Ovozli xabar]';
    requestData.request_type = 'voice';
    requestData.file_id = msg.voice.file_id;
    requestData.file_size = msg.voice.file_size;
    requestData.file_name = 'voice_message.ogg';

    if (msg.voice.file_size > 5242880) {
      bot.sendMessage(chatId, '❌ Fayl hajmi juda katta! Maksimal: 5MB');
      return;
    }

    // VoiceLab STT: a transcribed voice note becomes an ordinary question for
    // the agent below — same grounding, same quota. The audio stays attached
    // for the human queue. Any failure leaves the old path untouched: the note
    // goes to the queue as '[Ovozli xabar]'.
    const speech = require('../ai/stt');
    if (speech.sttEnabled()) {
      try {
        await bot.sendChatAction(chatId, 'typing').catch(() => {});
        const link = await bot.getFileLink(msg.voice.file_id);
        const audioResp = await fetch(link, { signal: AbortSignal.timeout(60000) });
        if (!audioResp.ok) throw new Error(`voice download ${audioResp.status}`);
        const audio = Buffer.from(await audioResp.arrayBuffer());
        const transcript = await speech.transcribe(audio, {
          filename: 'voice.ogg',
          contentType: msg.voice.mime_type || 'audio/ogg',
          durationSec: msg.voice.duration,
        });
        if (transcript) {
          requestData.request_text = transcript;
          requestData.voiceTranscribed = true;
          // Show what was heard, so a misheard question is caught before the
          // answer is trusted.
          await bot.sendMessage(chatId, `🎙 Savolingiz: «${transcript}»`).catch(() => {});
        } else {
          await bot.sendMessage(chatId, '🎙 Ovozli xabarni tushunib bo\'lmadi. Iltimos, qaytadan aniqroq gapiring yoki savolni yozib yuboring.');
          return;
        }
      } catch (sttErr) {
        console.warn('[BOT] VoiceLab STT failed, voice note goes to the human queue:', sttErr.message);
      }
    }
  }
  else if (msg.video_note) {
    requestData.request_text = '[Video xabar]';
    requestData.request_type = 'video_note';
    requestData.file_id = msg.video_note.file_id;
    requestData.file_size = msg.video_note.file_size;
    requestData.file_name = 'video_note.mp4';

    if (msg.video_note.file_size > 5242880) {
      bot.sendMessage(chatId, '❌ Fayl hajmi juda katta! Maksimal: 5MB');
      return;
    }
  }
  else if (msg.video) {
    requestData.request_text = msg.caption || '[Video]';
    requestData.request_type = 'video';
    requestData.file_id = msg.video.file_id;
    requestData.file_size = msg.video.file_size;
    requestData.file_name = msg.video.file_name || 'video.mp4';

    if (msg.video.file_size > 5242880) {
      bot.sendMessage(chatId, '❌ Fayl hajmi juda katta! Maksimal: 5MB');
      return;
    }
  }
  else if (msg.document) {
    requestData.request_text = msg.caption || `[Fayl: ${msg.document.file_name}]`;
    requestData.request_type = 'document';
    requestData.file_id = msg.document.file_id;
    requestData.file_size = msg.document.file_size;
    requestData.file_name = msg.document.file_name;

    if (msg.document.file_size > 5242880) {
      bot.sendMessage(chatId, '❌ Fayl hajmi juda katta! Maksimal: 5MB');
      return;
    }
  }
  else if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1]; // Largest photo
    requestData.request_text = msg.caption || '[Rasm]';
    requestData.request_type = 'photo';
    requestData.file_id = photo.file_id;
    requestData.file_size = photo.file_size;
    requestData.file_name = 'photo.jpg';
  }
  else {
    // Unsupported message type
    bot.sendMessage(chatId, 'Iltimos, matn, ovozli xabar, video yoki fayl yuboring.');
    return;
  }

  // ── Autonomous agent: converse and answer without a human ────────────────
  // Text-only. A file or voice note still goes to the human queue: the agent
  // grounds answers on retrieved law, and it cannot read an attachment it has
  // not transcribed — answering one anyway would be exactly the confident
  // guessing this platform exists to avoid.
  let agentResult = null;
  let agentReplyDelivered = false;
  if (requestData.request_type === 'text' || requestData.voiceTranscribed) {
    try {
      const { handleUserMessage, splitForTelegram, isReady } = require('../agents/telegram-agent');
      if (isReady()) {
        await bot.sendChatAction(chatId, 'typing').catch(() => {});
        const typing = setInterval(() => bot.sendChatAction(chatId, 'typing').catch(() => {}), 4000);
        try {
          agentResult = await handleUserMessage({
            chatId,
            text: requestData.request_text,
            firstName,
            testAccount,
            identity: await telegramIdentity(msg),
            voice: !!requestData.voiceTranscribed,
          });
        } finally {
          clearInterval(typing);
        }

        if (agentResult && agentResult.handled && agentResult.reply) {
          const replyParts = splitForTelegram(agentResult.reply);
          const actionKeyboard = agentResult.action === 'quota_exceeded' ? await quotaKeyboard(chatId) : agentActionKeyboard(agentResult);
          let allReplyPartsDelivered = true;
          for (let partIndex = 0; partIndex < replyParts.length; partIndex++) {
            const part = replyParts[partIndex];
            let partDelivered = false;
            const sendOptions = {
              parse_mode: 'Markdown',
              disable_web_page_preview: true,
            };
            if (partIndex === replyParts.length - 1 && actionKeyboard) sendOptions.reply_markup = actionKeyboard;
            await bot.sendMessage(chatId, part, sendOptions).then(() => {
              partDelivered = true;
            }).catch(async () => {
              // Markdown in a legal answer breaks on stray * or _ — never let
              // a formatting failure swallow the answer itself.
              const fallbackOptions = partIndex === replyParts.length - 1 && actionKeyboard ? { reply_markup: actionKeyboard } : {};
              await bot.sendMessage(chatId, part.replace(/[*_`\[\]]/g, ''), fallbackOptions).then(() => {
                partDelivered = true;
              }).catch(() => {});
            });
            if (!partDelivered) allReplyPartsDelivered = false;
          }
          agentReplyDelivered = allReplyPartsDelivered;
          // Asked by voice → also answered by voice (VoiceLab TTS, in the
          // configured voice). Sent in the background: the text answer is
          // already delivered, and a TTS failure must not touch it or the
          // quota bookkeeping below.
          // the linked account's adaptive profile records the answer's area and acts as codes (src/adaptive/profile.js)
          if (agentReplyDelivered && agentResult.action === 'answered') {
            telegramIdentity(msg).then((ident) => {
              if (!ident || !ident.adminId) return;
              const p = require('../adaptive/profile');
              return p.profileStore().record(ident.adminId, p.answerSignals({ question: requestData.request_text, answer: agentResult.reply,
                topic: agentResult.meta && agentResult.meta.topic, channel: 'telegram' }), { channel: 'telegram' });
            }).catch(() => {});
          }
          // a legal answer also lands in the linked web account's chat history
          if (agentReplyDelivered && agentResult.action === 'answered') {
            telegramIdentity(msg).then((ident) => ident && ident.adminId
              ? require('../services/telegram-history').appendTelegramTurn(pool, { adminId: ident.adminId, question: requestData.request_text, answer: agentResult.reply })
              : null).catch((e) => console.warn('[TG-HISTORY] not saved:', e.message));
          }
          // a document ordered from a lawyer can also be drafted by AI right now
          if (agentReplyDelivered && agentResult.action === 'paid_service') {
            offerAiDraft(chatId, agentResult.meta || {}, msg.from).catch(() => {});
          }
          if (agentReplyDelivered && requestData.voiceTranscribed) {
            sendVoiceReply(chatId, agentResult.reply).catch((e) =>
              console.warn('[BOT] voice reply failed (text answer already sent):', e.message));
          }
          if (agentResult.action === 'answered') {
            const { finalizeDailyAiAnswer, releaseDailyAiAnswer } = require('../agents/telegram-agent');
            const reservation = {
              reservationId: agentResult.meta && agentResult.meta.reservationId,
              source: agentResult.meta && agentResult.meta.entitlementSource,
            };
            if (agentReplyDelivered) {
              const finalized = await finalizeDailyAiAnswer(chatId, reservation);
              if (!finalized) {
                // The user already has the answer. Never withdraw it or send a
                // payment prompt because bookkeeping could not be finalized;
                // an unfinished reservation will expire in their favour.
                console.warn(`[BOT] answer delivered but entitlement finalize failed for chat=${chatId}`);
              }
            } else {
              await releaseDailyAiAnswer(chatId, reservation);
              console.warn(`[BOT] answer delivery failed; entitlement restored for chat=${chatId}`);
              agentResult = null;
            }
          }
        }
      }
    } catch (agentErr) {
      console.error('[BOT] agent failed, falling back to human queue:', agentErr.message);
      agentResult = null;
    }
  }

  // What the request ended as, for the admin usage view (no text, no prompt).
  if (agentResult) {
    const m = agentResult.meta || {};
    usageLedger.annotate({
      outcome: agentResult.action || null,
      legalCheck: (m.confidence || m.lexCrossCheck || m.claimGuard) ? {
        confidence: m.confidence || null,
        escalate: !!agentResult.escalate,
        lexCrossCheck: m.lexCrossCheck ? m.lexCrossCheck.status : null,
        claimGuard: m.claimGuard ? m.claimGuard.status : null,
        citationCheck: m.citationCheck || null,
        delivered: agentReplyDelivered,
      } : null,
    });
  }

  // Conversational turns (greetings, clarifying questions, off-topic replies)
  // are not legal requests — they must not create dashboard rows or the queue
  // fills with "salom".
  const conversational = agentResult && agentResult.handled
    && [
      'greeting', 'clarify', 'offtopic', 'account_help',
      'identity', 'answer_pending', 'quota_exceeded', 'quota_unavailable',
      'attorney_contact_shared', 'attorney_contact_cancelled', 'attorney_choice_required',
      'attorney_intake_started', 'attorney_problem_required', 'attorney_compare',
      'document_intake_started', 'menu_selection_required', 'intake_cancelled',
    ].includes(agentResult.action);
  if (conversational) return;

  const agentDelivered = !!(agentResult && agentResult.handled && agentResult.reply && agentReplyDelivered);
  const resolvedByAgent = !!(agentResult && agentResult.handled
    && ['answered', 'attorney_matches'].includes(agentResult.action)
    && !agentResult.escalate);
  const needsHuman = !resolvedByAgent || !!(agentResult && agentResult.escalate);

  // Save to database
  try {
    if (agentResult && agentResult.action === 'paid_service' && agentResult.meta && agentResult.meta.caseSummary) {
      requestData.request_text = String(agentResult.meta.caseSummary);
    }
    const result = await saveRequest(requestData, {
      agentReply: agentDelivered ? agentResult.reply : null,
      agentMeta: agentResult ? { action: agentResult.action, ...(agentResult.meta || {}) } : null,
      status: needsHuman ? 'pending' : 'ai_answered',
    });

    if (result.success) {
      // Persist the business workflow created by the concierge. Prices are
      // intentionally absent until the Master Admin configures the catalogue.
      if (agentResult && agentResult.action === 'paid_service') {
        try {
          const { createServiceOrder } = require('../services/legal-marketplace');
          await createServiceOrder({
            requestId: result.requestId,
            telegramChatId: chatId,
            serviceSlug: agentResult.meta && agentResult.meta.serviceSlug,
            intakeData: {
              originalText: requestData.request_text,
              source: 'telegram',
              sourceQuestion: agentResult.meta && agentResult.meta.sourceQuestion,
              sourceLegalAnswer: agentResult.meta && agentResult.meta.sourceLegalAnswer,
              selectedNextAction: agentResult.meta && agentResult.meta.selectedNextAction,
            },
          });
        } catch (e) {
          console.error('[BOT] paid service order creation failed:', e.message);
        }
      }

      if (agentResult && ['attorney_matches', 'attorney_request'].includes(agentResult.action)) {
        try {
          const { createConsultationRequest } = require('../services/legal-marketplace');
          await createConsultationRequest({
            requestId: result.requestId,
            telegramChatId: chatId,
            caseSummary: requestData.request_text,
            legalField: agentResult.meta && agentResult.meta.legalField,
            attorneyIds: (agentResult.meta && (agentResult.meta.attorneyRefs || agentResult.meta.attorneyIds)) || [],
          });
        } catch (e) {
          console.error('[BOT] attorney consultation request creation failed:', e.message);
        }
      }

      if (resolvedByAgent) {
        // Fully handled — no queue message, the answer already arrived.
        if (!agentResult.meta || agentResult.meta.remainingDailyAnswers > 0) {
          const ruAnswer = agentResult.meta && agentResult.meta.lang === 'ru';
          bot.sendMessage(chatId, ruAnswer ? '💬 Если есть ещё вопросы — пишите.' : '💬 Yana savolingiz bo\'lsa — bemalol yozing.').catch(() => {});
        }
      } else if (agentDelivered && needsHuman && agentResult.action === 'answered') {
        bot.sendMessage(chatId, agentResult.meta && agentResult.meta.lang === 'ru'
          ? '👨‍⚖️ Ваше обращение также передано юристу для уточнения — подтверждение придёт сюда.'
          : '👨‍⚖️ Murojaatingiz aniqlik uchun yuristga ham yuborildi — tasdiq shu yerda keladi.').catch(() => {});
      } else if (!agentDelivered && tariffTexts.FILE_TYPES.has(requestData.request_type)) {
        // a file: the lawyer queue, not AI - said plainly, with the way to
        // the AI document services on the website
        const keyboard = tariffTexts.fileQueuedKeyboard(dashboardUrl());
        bot.sendMessage(chatId, tariffTexts.fileQueuedText({ typeLabel: getRequestTypeLabel(requestData.request_type) }),
          keyboard ? { reply_markup: keyboard } : {}).catch(() => {});
      } else if (!agentDelivered) {
        bot.sendMessage(chatId,
          `✅ Murojaat qabul qilindi!\n\n📝 Turi: ${getRequestTypeLabel(requestData.request_type)}\n\nYurist tez orada ko'rib chiqadi va javob beradi. Rahmat!`);
      }

      // Notify admins ONLY when a human is actually needed. Notifying on every
      // AI-resolved question would recreate the noise the agent removes.
      if (needsHuman) {
        try {
          const adminNotification = `
🔔 Yangi murojaat keldi!

👤 Foydalanuvchi: ${firstName}
🆔 Username: @${username}
📝 Turi: ${getRequestTypeLabel(requestData.request_type)}
${agentDelivered ? '🤖 Agent foydalanuvchiga dastlabki javob berdi' : ''}

${requestData.request_type === 'text' ? `Murojaat: ${requestData.request_text}` : ''}

Dashboard: ${dashboardUrl()}
          `;
          await bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, adminNotification);
        } catch (error) {
          console.error('Failed to notify admin:', error);
        }
      }

      console.log(`[BOT] request #${result.requestId} saved — ${needsHuman ? 'queued for human' : 'resolved by agent'}`);
    } else {
      const errMsg = result.error?.message || result.error || 'Unknown DB error';
      console.error('Save error:', errMsg, result.error?.detail || '');
      if (!agentDelivered) {
        bot.sendMessage(chatId, `Xatolik yuz berdi. Iltimos qaytadan urinib ko'ring.\n\n(${errMsg})`);
      }
    }
  } catch (error) {
    console.error('Error processing request:', error.message, error.stack);
    if (!agentDelivered) {
      bot.sendMessage(chatId, `Xatolik yuz berdi. Iltimos qaytadan urinib ko'ring.\n\n(${error.message})`);
    }
  }
}

/**
 * Save a request.
 *
 * @param {object} data
 * @param {object} [opts]
 * @param {string|null} [opts.agentReply] — the agent's answer, stored so the
 *   dashboard shows what the user was actually told (and a lawyer can correct
 *   it into the corpus).
 * @param {string} [opts.status] — 'pending' (needs a human) or 'ai_answered'.
 */
async function saveRequest(data, opts = {}) {
  const status = opts.status || 'pending';
  const agentReply = opts.agentReply || null;
  const agentMeta = opts.agentMeta || {};
  const requestCategory = categoryFromAgentMeta(agentMeta);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if user exists, create or update
    let userResult = await client.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [data.telegram_id]
    );

    let userId;

    if (userResult.rows.length === 0) {
      // Create new user
      const insertUser = await client.query(
  'INSERT INTO users (telegram_id, username, first_name, name) VALUES ($1, $2, $3, $4) RETURNING id',
  [data.telegram_id, data.username, data.first_name, data.first_name]
);
      userId = insertUser.rows[0].id;
    } else {
      // Update existing user
      await client.query(
  'UPDATE users SET username = $1, first_name = $2, name = $3, last_active = NOW() WHERE telegram_id = $4',
  [data.username, data.first_name, data.first_name, data.telegram_id]
);
      userId = userResult.rows[0].id;
    }

    // Insert request. An agent-resolved request is stored already answered —
    // response_text is what the user actually received, so the dashboard shows
    // the real conversation and a lawyer can correct it into the corpus.
    const insertResult = await client.query(
      `INSERT INTO requests
       (user_id, request_text, request_type, file_id, file_size, file_name, status, category,
        response_text, responded_by, answered_at, source_channel, agent_intent,
        agent_action, requires_lawyer_review)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'telegram', $12, $13, $14) RETURNING id`,
      [userId, data.request_text, data.request_type, data.file_id, data.file_size, data.file_name,
       status, requestCategory,
       agentReply, agentReply ? 'JuristAI Telegram agenti' : null,
       status === 'ai_answered' ? new Date() : null,
       agentMeta.intent || null, agentMeta.action || null, status !== 'ai_answered']
    );

    await client.query('COMMIT');

    const requestId = insertResult.rows[0].id;

    // Do not pay for a second classifier when the menu or legal RAG topic has
    // already supplied a deterministic category. Unclassified free text and
    // attachments still use async triage for the Master Admin queue.
    if (requestCategory === 'Boshqa' && !agentMeta.intakeClassified) {
      const { triageRequest } = require('../agents/triage');
      triageRequest(requestId, data.request_text, data.request_type).catch(err =>
        console.error('[TRIAGE] Async error:', err.message)
      );
    }

    return { success: true, requestId };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Database error:', error);
    return { success: false, error };
  } finally {
    client.release();
  }
}

// Get request type label in Uzbek
function getRequestTypeLabel(type) {
  const labels = {
    'text': 'Matn',
    'voice': 'Ovozli xabar',
    'video': 'Video',
    'video_note': 'Video xabar',
    'document': 'Fayl',
    'photo': 'Rasm'
  };
  return labels[type] || 'Noma\'lum';
}

// Export bot for use in other modules
module.exports = { bot, getBot: () => bot, setClaimAgent: (a) => { claimAgent = a && typeof a.run === 'function' ? a : null; }, setDraftGenerator: (fn) => { draftGenerator = typeof fn === 'function' ? fn : null; }, setDocumentAnalyzer: (fn) => { documentAnalyzer = typeof fn === 'function' ? fn : null; }, isChannelMember, channelLink, REQUIRED_CHANNEL, INSTAGRAM_URL };

console.log('Bot ishlamoqda...');
