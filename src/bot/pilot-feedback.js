'use strict';

/**
 * Pilot feedback in the bot (2026-10-28, CustDev stage 3; the work is in
 * src/sales/pilot-workspace.js). An active pilot client presses "💬 Fikr
 * bildirish" or sends /fikr; only the NEXT message (text, or a voice note
 * after STT) within FEEDBACK_TTL_MIN is feedback - an ordinary legal question
 * never reaches the Workspace. The agent's confirmed reply comes back with a
 * button to turn such replies off.
 */

const STATE = 'pilot_feedback';
const FEEDBACK_TTL_MIN = 15;
const CANCEL_RE = /^(?:bekor|bekor qil|bekor qilish|отмена|cancel)[.!]?$/iu;

const feedbackButton = () => ({ inline_keyboard: [[{ text: '💬 Fikr bildirish', callback_data: 'pfb_start' }]] });
const replyOffButton = () => ({ inline_keyboard: [[{ text: '🔕 Bunday javoblar kerak emas', callback_data: 'pfo_off' }]] });

const TEXTS = Object.freeze({
  start: "💬 Fikringizni yozing yoki ovozli xabar yuboring — keyingi bitta xabaringiz JuristAI jamoasiga fikr sifatida boradi (savol sifatida emas).\n\nNima yoqmadi, nima chalkash, nima yetishmayapti, narx haqida nima deysiz — hammasi foydali. Bekor qilish: «bekor».",
  accepted: "✅ Fikringiz qabul qilindi. Rahmat! Jamoa ko'rib chiqadi; javob bo'lsa, shu yerga yozamiz.",
  duplicate: "✅ Bu fikr avval qabul qilingan.",
  cancelled: "Bekor qilindi. Savolingizni odatdagidek yozishingiz mumkin.",
  notPilot: "Fikr bildirish faol pilot qatnashchilari uchun. Savolingiz bo'lsa, shu yerga yozing.",
  notLinked: "Fikr bildirish uchun Telegram JuristAI akkauntingizga ulangan bo'lishi kerak.",
  failed: "Fikrni hozir qabul qilib bo'lmadi. Birozdan keyin /fikr bilan qayta urinib ko'ring.",
  repliesOff: "🔕 Yaxshi, fikrlaringizga javoblarni endi yubormaymiz.",
});

const replyText = t => `📬 Fikringiz bo'yicha JuristAI jamoasidan javob:\n\n${t}`;

/** Is this conversation waiting for a feedback message (and not too old)? */
function waiting(conv, now = Date.now()) {
  if (!conv || conv.state !== STATE) return false;
  const since = Number(conv.context && conv.context.since);
  return Number.isFinite(since) && now - since <= FEEDBACK_TTL_MIN * 60e3;
}

module.exports = { STATE, FEEDBACK_TTL_MIN, CANCEL_RE, TEXTS, feedbackButton, replyOffButton, replyText, waiting };
