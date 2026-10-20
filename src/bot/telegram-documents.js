'use strict';

/**
 * A document sent to the bot can be analysed by AI there (2026-10-20, owner:
 * the landing promises "send a document in Telegram"). Before, every file
 * went to the lawyer queue only.
 *
 *   1. A PDF or DOCX arrives: the bot reads its text (no AI), sizes the job in
 *      document units like the website (max(pages/10, chars/40 000)) and
 *      offers two buttons: "AI tahlil — N birlik" or "Yuristga yuborish".
 *   2. AI: the units are reserved from the person's plan (the same ledger as
 *      the website, channel 'telegram'); the analysis is the website's own
 *      (src/ocr/routes.js analyzeDocumentText); the result is sent as text;
 *      the units are committed when it is delivered and released on failure.
 *   3. Lawyer: the file is held as before and the person writes the
 *      description (the existing lawyer-queue flow).
 *
 * Scans and photos (no text layer) still go to the lawyer queue here; their
 * OCR is metered by pages on the website. A legacy .doc is refused with the
 * same advice as the website. The file is read in memory only and kept in
 * this process for 30 minutes, then forgotten.
 */

const OFFER_TTL_MS = 30 * 60 * 1000;
const MAX_BYTES = 5 * 1024 * 1024;

function isDocCandidate(doc = {}) {
  const n = String(doc.file_name || '').toLowerCase();
  return /\.(pdf|docx)$/u.test(n) || ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(doc.mime_type);
}

const lvl = { high: '🔴', medium: '🟠', low: '🟢' };

/** The analysis as plain text for Telegram (no Markdown: document text is not escaped for it). */
function formatAnalysis(a = {}, { fileName = '', units = null } = {}) {
  const lines = [];
  lines.push(`📄 ${fileName || 'Hujjat'} — AI tahlili`);
  if (a.docType) lines.push(`Turi: ${a.docType}`);
  if (Number.isFinite(Number(a.overallScore))) lines.push(`Umumiy baho: ${Number(a.overallScore)}/100`);
  if (a.summary) lines.push('', a.summary);
  if ((a.riskItems || []).length) {
    lines.push('', 'Xavfli bandlar:');
    for (const r of a.riskItems.slice(0, 12)) {
      lines.push(`${lvl[r.level] || '•'} ${r.clause || ''}${r.excerpt ? ` — «${String(r.excerpt).slice(0, 150)}»` : ''}`);
      if (r.issue) lines.push(`   Muammo: ${r.issue}`);
      if (r.suggestion) lines.push(`   Tavsiya: ${r.suggestion}`);
    }
  }
  if ((a.missingClauses || []).length) {
    lines.push('', "Yetishmayotgan bandlar:");
    for (const m of a.missingClauses.slice(0, 10)) lines.push(`• ${m.clause || ''}${m.description ? ` — ${m.description}` : ''}`);
  }
  if ((a.complianceIssues || []).length) {
    lines.push('', 'Qonunga muvofiqlik:');
    for (const c of a.complianceIssues.slice(0, 10)) lines.push(`• ${c.article ? c.article + ': ' : ''}${c.issue || ''}${c.suggestion ? ` → ${c.suggestion}` : ''}`);
  }
  if ((a.strengths || []).length) {
    lines.push('', 'Kuchli tomonlari:');
    for (const s of a.strengths.slice(0, 8)) lines.push(`• ${s}`);
  }
  lines.push('', "⚠️ Bu AI tahlili: keltirilgan modda raqamlari lex.uz matni bilan avtomatik tekshirilmagan. Muhim qarordan oldin yurist bilan maslahatlashing.");
  if (units) lines.push(`Sarflandi: ${units} tahlil birligi.`);
  return lines.join('\n');
}

/**
 * deps: bot, pool, ledger (tariff-ledger), extract(buf, {fileName, mimeType}),
 * getAnalyzer() -> async (text, {adminId}) => { analysis } | { raw, parseError },
 * identityOf(msgOrQuery) -> { telegramUserId, adminId }, holdForLawyer(chatId, file),
 * fetchImpl (tests).
 */
function createDocumentFlow(deps) {
  const offers = new Map(); // chatId -> { text, units, pages, chars, fileName, file, at }
  const sweep = () => { const now = Date.now(); for (const [k, v] of offers) if (now - v.at > OFFER_TTL_MS) offers.delete(k); };

  /** A PDF/DOCX was sent: read it and offer AI analysis. true when handled here. */
  async function offer(msg) {
    const doc = msg.document;
    if (!doc || !isDocCandidate(doc) || !deps.getAnalyzer()) return false;
    const chatId = msg.chat.id;
    if (doc.file_size && doc.file_size > MAX_BYTES) return false; // the old path says "5 MB"
    let read;
    try {
      const link = await deps.bot.getFileLink(doc.file_id);
      const resp = await (deps.fetchImpl || fetch)(link, { signal: AbortSignal.timeout(60000) });
      if (!resp.ok) throw new Error(`download ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      read = await deps.extract(buf, { fileName: doc.file_name, mimeType: doc.mime_type });
    } catch (e) {
      console.warn('[TG-DOC] read failed, lawyer queue:', e.message);
      return false;
    }
    if (read.unsupported || read.scanned || !read.text) return false; // scans: the lawyer queue as before
    const size = deps.ledger.docUnits({ pages: read.pages, chars: read.chars });
    sweep();
    offers.set(chatId, { text: read.text, units: size.units, pages: size.pages, chars: read.chars, fileName: doc.file_name || 'hujjat',
      file: { request_type: 'document', file_id: doc.file_id, file_size: doc.file_size, file_name: doc.file_name || 'fayl' }, at: Date.now() });
    await deps.bot.sendMessage(chatId,
      `📄 ${doc.file_name || 'Hujjat'} qabul qilindi: ${size.pages} bet, ${read.chars.toLocaleString('ru-RU').replace(/,/gu, ' ')} belgi.\n\n`
      + `🤖 AI tahlil: xavfli bandlar, yetishmayotgan bandlar, qonunga muvofiqlik va tavsiyalar — tarifingizdagi ${size.units} ta tahlil birligi sarflanadi.\n`
      + "👨‍⚖️ Yoki faylni yurist navbatiga yuborishingiz mumkin (tarif limitidan yechilmaydi).",
      { reply_markup: { inline_keyboard: [[
        { text: `🤖 AI tahlil — ${size.units} birlik`, callback_data: 'tgdoc_ai' },
        { text: '👨‍⚖️ Yuristga yuborish', callback_data: 'tgdoc_lawyer' },
      ]] } });
    return true;
  }

  /** Button presses: true when handled here. */
  async function onCallback(q) {
    if (q.data !== 'tgdoc_ai' && q.data !== 'tgdoc_lawyer') return false;
    const chatId = q.message.chat.id;
    sweep();
    const o = offers.get(chatId);
    if (!o) {
      await deps.bot.answerCallbackQuery(q.id, { text: "Fayl muddati o'tdi — uni qayta yuboring.", show_alert: true }).catch(() => {});
      return true;
    }
    offers.delete(chatId);
    if (q.data === 'tgdoc_lawyer') {
      await deps.bot.answerCallbackQuery(q.id, { text: 'Yurist navbati' }).catch(() => {});
      await deps.holdForLawyer(chatId, o.file);
      return true;
    }
    await deps.bot.answerCallbackQuery(q.id, { text: 'Tahlil boshlandi' }).catch(() => {});
    const who = await deps.identityOf(q);
    let job;
    try {
      job = await deps.ledger.reserve({ adminId: who.adminId || null, telegramUserId: who.telegramUserId || q.from.id, service: 'analysis',
        units: o.units, channel: 'telegram', endpoint: '/tg/analyze' });
    } catch (e) {
      console.warn('[TG-DOC] reserve failed:', e.message);
      await deps.bot.sendMessage(chatId, "Limitni hozir tekshirib bo'lmadi. Birozdan keyin qayta urinib ko'ring.");
      return true;
    }
    if (!job.allowed) {
      offers.set(chatId, { ...o, at: Date.now() }); // the lawyer option stays
      await deps.bot.sendMessage(chatId,
        `Tarifingizda bu hujjat uchun tahlil birligi yetarli emas (kerak: ${o.units}). Tariflar: ${deps.tariffUrl || 'https://juristai.uz/tariff.html'}\n\nFaylni yurist navbatiga yuborishingiz mumkin:`,
        { reply_markup: { inline_keyboard: [[{ text: '👨‍⚖️ Yuristga yuborish', callback_data: 'tgdoc_lawyer' }]] } });
      return true;
    }
    await deps.bot.sendChatAction(chatId, 'typing').catch(() => {});
    const typing = setInterval(() => deps.bot.sendChatAction(chatId, 'typing').catch(() => {}), 4500);
    try {
      const r = await deps.getAnalyzer()(o.text, { adminId: who.adminId || null });
      if (!r || !r.analysis) throw new Error('analysis not parsed');
      const text = formatAnalysis(r.analysis, { fileName: o.fileName, units: job.unlimited ? null : o.units });
      for (const part of splitPlain(text)) await deps.bot.sendMessage(chatId, part, { disable_web_page_preview: true });
      if (job.jobKey) await deps.ledger.commit(job.jobKey).catch((e) => console.error('[TG-DOC] commit failed:', e.message));
    } catch (e) {
      console.error('[TG-DOC] analysis failed:', e.message);
      if (job.jobKey) await deps.ledger.release(job.jobKey, 'failed').catch(() => {});
      await deps.bot.sendMessage(chatId, "Tahlilni bajarib bo'lmadi, limitingiz qaytarildi. Birozdan keyin faylni qayta yuboring yoki saytda tahlil qiling.");
    } finally {
      clearInterval(typing);
    }
    return true;
  }

  return { offer, onCallback, _offers: offers };
}

function splitPlain(text, limit = 3900) {
  const out = [];
  let rest = String(text || '');
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit / 2) cut = limit;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/u, '');
  }
  if (rest) out.push(rest);
  return out;
}

module.exports = { createDocumentFlow, formatAnalysis, isDocCandidate, splitPlain, OFFER_TTL_MS };
