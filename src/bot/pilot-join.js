'use strict';

/**
 * The one-tap pilot join in the bot (2026-10-28, owner): an agent's link
 * (/start ref_<code>) -> "what do you do?" (five buttons) -> one tap makes the
 * account from the Telegram identity, sets the client type and tries the
 * standing rule (src/sales/agents.js joinFromTelegram). No site, no code.
 * Texts only here; the work is in src/sales/agents.js.
 */

const { CLIENT_TYPES, CLIENT_TYPE_LABELS } = require('../sales/agents');

const ICONS = Object.freeze({ lawyer: '⚖️', accountant: '📊', hr: '👥', business: '💼', user: '👤' });
const PREFIX = 'pj_';

function typeKeyboard() {
  const b = t => ({ text: `${ICONS[t]} ${CLIENT_TYPE_LABELS[t]}`, callback_data: PREFIX + t });
  return { inline_keyboard: [[b('lawyer'), b('accountant')], [b('hr'), b('business')], [b('user')]] };
}

function askText(appUrl) {
  return "Taklif havolasi qabul qilindi 👋\n\n14 kunlik JuristAI pilotiga qo'shilish uchun kasbingizni tanlang — bitta bosish yetarli, akkaunt shu Telegram orqali ochiladi.\n\n" +
    `Davom etib, foydalanish shartlariga rozilik bildirasiz: ${appUrl}/shartlar.html`;
}

/** The answer after the tap; result is joinFromTelegram's. */
function joinReply(result, appUrl) {
  if (!result || !result.ok) {
    return result && result.error === 'staff'
      ? "Bu Telegram JuristAI xodimi akkauntiga ulangan — mijoz sifatida qo'shib bo'lmaydi."
      : "Hozir qo'shib bo'lmadi. Birozdan keyin havolani qayta oching.";
  }
  const site = `Saytda ham shu akkaunt bilan ishlaysiz: ${appUrl}/app/kirish.html → «Telegram orqali kirish».`;
  if (result.pilot === 'approved') {
    return "✅ 14 kunlik pilotingiz ochildi!\n\nSavolingizni shu yerga yozing yoki ovozli xabar yuboring. Limitni «limitim qancha?» deb bilasiz.\n\n" + site;
  }
  if (result.pilot === 'pending') {
    return "✅ Akkaunt ochildi. Pilot so'rovingiz JuristAI jamoasiga yuborildi — tasdiqlanganda shu yerda xabar olasiz.\n\nHozir ham bepul Sinov savollari bilan savol berishingiz mumkin.\n\n" + site;
  }
  if (result.pilot === 'not_professional') {
    return "✅ Akkaunt ochildi. Bepul Sinov savollari bilan hozir savol bering; kerak bo'lsa, bir martalik xizmatlar ham bor: «tariflar» deb yozing.\n\n" + site;
  }
  return "✅ Akkaunt ochildi. Savolingizni shu yerga yozing.\n\n" + site;
}

const typeFromData = data => (typeof data === 'string' && data.startsWith(PREFIX) && CLIENT_TYPES.includes(data.slice(PREFIX.length)) ? data.slice(PREFIX.length) : null);

module.exports = { PREFIX, ICONS, typeKeyboard, askText, joinReply, typeFromData };
