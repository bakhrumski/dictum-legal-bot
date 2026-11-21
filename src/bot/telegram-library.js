'use strict';

/**
 * "Hujjatlarim" in the bot (2026-10-30, owner: the V5 link made the person
 * leave the bot; the useful version shows the documents here). A linked
 * account's library (document_scans, src/ocr/scan-store.js) is listed in the
 * chat - name, pages, date, never the text - and a document's AI analysis
 * starts from its button, the same paid flow as a file sent to the bot
 * (src/bot/telegram-documents.js runAnalysis: units named on the button,
 * reserved, committed on delivery, released on failure). A PDF / Word file
 * sent to the bot by a linked account is kept in the same library, so the
 * site and the bot show one list.
 *
 * Buttons: tglo_<id> one document's card, tgla_<id> its AI analysis. A
 * document of another account is "not found" (never shown). No AI call to
 * list; the analysis is the only paid step.
 */

const scanStore = require('../ocr/scan-store');

const LIST_MAX = 8;
const base = () => String(process.env.APP_URL || 'https://juristai.uz').replace(/\/+$/u, '');
const ID_RE = /^[0-9a-f-]{36}$/iu;

function fmtDate(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${p(x.getDate())}.${p(x.getMonth() + 1)}.${x.getFullYear()}`;
}
const short = (s, n) => { const t = String(s || '').replace(/\s+/gu, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const nameOf = (d, R) => d.name || (R ? 'Документ без названия' : 'Nomsiz hujjat');

function T(lang) {
  const R = lang === 'ru';
  return {
    R,
    empty: R ? 'В вашей библиотеке пока нет документов. Отправьте сюда PDF или Word — я прочитаю его, сохраню в «Мои документы» и предложу анализ.'
      : "Kutubxonangizda hali hujjat yo'q. PDF yoki Word faylni shu yerga yuboring — o'qib, «Hujjatlarim»ga saqlayman va tahlil qilishni taklif qilaman.",
    head: n => (R ? `📂 Ваши документы (последние ${n}). Нажмите на документ:` : `📂 Hujjatlaringiz (oxirgi ${n} tasi). Hujjatni bosing:`),
    more: n => (R ? `…и ещё ${n} на сайте.` : `…yana ${n} tasi saytda.`),
    pages: R ? 'стр.' : 'bet',
    chars: R ? 'знаков' : 'belgi',
    noLink: R ? 'Чтобы видеть свои документы здесь, привяжите аккаунт JuristAI: напишите «привязать аккаунт».'
      : "Hujjatlaringizni shu yerda ko'rish uchun JuristAI akkauntini ulang: «akkauntni ulash» deb yozing.",
    notFound: R ? 'Документ не найден — возможно, он удалён.' : "Hujjat topilmadi — o'chirilgan bo'lishi mumkin.",
    analyse: u => (R ? `🤖 AI-анализ — ${u} ед.` : `🤖 AI tahlil — ${u} birlik`),
    site: R ? '📱 Открыть на сайте' : '📱 Saytda ochish',
    all: R ? '📱 Все документы на сайте' : '📱 Barcha hujjatlar saytda',
    card: R ? 'AI-анализ: рискованные и недостающие пункты, соответствие закону, рекомендации. Единицы списываются только при готовом анализе; при ошибке возвращаются.'
      : "AI tahlil: xavfli va yetishmayotgan bandlar, qonunga muvofiqlik, tavsiyalar. Birlik faqat tahlil tayyor bo'lganda yechiladi; xatoda qaytariladi.",
    started: R ? 'Анализ начат' : 'Tahlil boshlandi',
  };
}

const listLine = (d, i, t) => `${i + 1}. ${short(nameOf(d, t.R), 60)} — ${d.pages || 1} ${t.pages} · ${fmtDate(d.last_used_at || d.created_at)}`;

/** The list for a linked account: { reply, docs: [{ id, label }], url }. No text of any document. */
async function listFor(pool, adminId, lang = 'uz') {
  const t = T(lang);
  const all = (await scanStore.listLibrary(pool, { adminId })).documents || [];
  const url = `${base()}/app/#/hujjatlarim`;
  if (!all.length) return { reply: t.empty, docs: [], url };
  const docs = all.slice(0, LIST_MAX);
  const lines = [t.head(docs.length), '', ...docs.map((d, i) => listLine(d, i, t))];
  if (all.length > docs.length) lines.push('', t.more(all.length - docs.length));
  return { reply: lines.join('\n'), docs: docs.map((d, i) => ({ id: d.id, label: `${i + 1}. ${short(nameOf(d, t.R), 40)}` })), url };
}

/** Inline keyboard of a list: one button a document (two a row), then the site. */
function listKeyboard(docs, url, lang = 'uz') {
  const t = T(lang);
  const rows = [];
  for (let i = 0; i < docs.length; i += 2) rows.push(docs.slice(i, i + 2).map(d => ({ text: `📄 ${d.label}`, callback_data: `tglo_${d.id}` })));
  if (/^https:\/\//u.test(url)) rows.push([{ text: t.all, url }]);
  return { inline_keyboard: rows };
}

/**
 * deps: bot, pool, ledger (docUnits), documentFlow (runAnalysis),
 * linkedAccount(q) -> { id, role } | null, langOf(q) -> 'uz' | 'ru'.
 */
function createLibraryFlow(deps) {
  async function own(q, id) {
    const account = await deps.linkedAccount(q);
    if (!account || !ID_RE.test(id)) return { account, row: null };
    return { account, row: await scanStore.getScan(deps.pool, { adminId: account.id, scanId: id }) };
  }

  /** Button presses: true when handled here. */
  async function onCallback(q) {
    const m = /^tgl([oa])_([0-9a-f-]{36})$/iu.exec(String(q.data || ''));
    if (!m) return false;
    const chatId = q.message.chat.id;
    const t = T(deps.langOf ? deps.langOf(q) : 'uz');
    const { account, row } = await own(q, m[2]);
    if (!account) { await deps.bot.answerCallbackQuery(q.id, { text: t.noLink, show_alert: true }).catch(() => {}); return true; }
    if (!row || !row.library) { await deps.bot.answerCallbackQuery(q.id, { text: t.notFound, show_alert: true }).catch(() => {}); return true; }
    const units = deps.ledger.docUnits({ pages: row.pages, chars: row.chars != null ? row.chars : String(row.text || '').length }).units;
    if (m[1] === 'o') {
      await deps.bot.answerCallbackQuery(q.id).catch(() => {});
      const rows = [[{ text: t.analyse(units), callback_data: `tgla_${row.id}` }]];
      if (/^https:\/\//u.test(base())) rows.push([{ text: t.site, url: `${base()}/app/#/hujjatlarim` }]);
      await deps.bot.sendMessage(chatId,
        `📄 ${nameOf(row, t.R)}\n${row.pages || 1} ${t.pages} · ${Number(row.chars || 0).toLocaleString('ru-RU').replace(/,/gu, ' ')} ${t.chars} · ${fmtDate(row.created_at)}\n\n${t.card}`,
        { reply_markup: { inline_keyboard: rows } });
      return true;
    }
    await deps.bot.answerCallbackQuery(q.id, { text: t.started }).catch(() => {});
    deps.pool.query('UPDATE document_scans SET last_used_at = now() WHERE id = $1 AND admin_id = $2', [row.id, account.id]).catch(() => {});
    // the same paid analysis as a file sent here; no lawyer-queue file for a library document
    await deps.documentFlow.runAnalysis(chatId, { text: row.text, units, pages: row.pages, chars: row.chars, fileName: nameOf(row, t.R), file: null, at: Date.now() }, q);
    return true;
  }

  return { onCallback };
}

module.exports = { createLibraryFlow, listFor, listKeyboard, LIST_MAX, T };
