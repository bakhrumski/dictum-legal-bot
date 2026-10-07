'use strict';

/**
 * The auth bot's /start <param> (2026-10-07), as a function of its input so
 * it can be tested without Telegram. Returns the text to send to the chat
 * that opened the link. Each flow reads only its own token store:
 *
 *   login_<t>   a 6-digit sign-in code to this chat (loginSessions)
 *   reg_<t>     a 6-digit registration code to this chat (regSessions)
 *   stepup_<t>  approves a credential step-up, only by the Telegram id
 *               linked to the account that asked (src/auth/credentials.js)
 *   recover_<t> password recovery for the account of THIS Telegram id:
 *               a staff account gets a single-use reset link in this chat;
 *               an ordinary account is told to sign in and use its account
 *               page. The browser that started it learns only "confirmed".
 *
 * Nothing here signs a browser in: a code must be typed in the browser that
 * started the flow.
 */

const crypto = require('crypto');
const confirm = require('../auth/telegram-confirm');

const RECOVER_TTL_MS = 10 * 60 * 1000;
const RESET_TTL_MS = 15 * 60 * 1000;

async function handleAuthStart(param, from, { pool, loginSessions, regSessions, verificationTokens, appUrl, now = Date.now() }) {
  const p = String(param || '').trim();
  if (p.startsWith('login_')) return confirm.issueCode(loginSessions, 'login', p.slice(6), from, { now }).text;
  if (p.startsWith('reg_')) return confirm.issueCode(regSessions, 'register', p.slice(4), from, { now }).text;
  if (p.startsWith('stepup_')) return (await require('../auth/credentials').approveStepupFromTelegram(pool, p.slice(7), from && from.id, now)).text;
  if (p.startsWith('recover_')) {
    const key = 'botinit_' + p.slice(8);
    const init = verificationTokens.get(key);
    if (!init || init.flow !== 'recover' || init.used || now > init.expiresAt) {
      return "⏳ Tiklash havolasi topilmadi yoki muddati o'tgan. Saytda qayta boshlang.";
    }
    init.used = true; // one recovery per link, whoever opens it
    const row = (await pool.query('SELECT id, role FROM admins WHERE telegram_user_id = $1', [String(from && from.id)])).rows[0];
    if (!row) return "❌ Bu Telegram hisobi bilan ro'yxatdan o'tilmagan. Iltimos, avval ro'yxatdan o'ting.";
    init.confirmed = true;
    if (row.role === 'user') {
      return "🔑 Parolni tiklash: saytda «Telegram bilan kirish» orqali kiring (kod shu chatga keladi), so'ng «Kirish usullari» sahifasida Telegram tasdig'i bilan yangi parol o'rnating.\n"
        + `${appUrl}/login.html`;
    }
    const resetToken = crypto.randomBytes(20).toString('hex');
    verificationTokens.set('pwreset_' + resetToken, { adminId: row.id, expiresAt: now + RESET_TTL_MS, flow: 'pwreset' });
    return `🔑 JuristAI xodim hisobi uchun parolni tiklash havolasi (15 daqiqa, bir marta):\n${appUrl}/login.html?recover=${resetToken}\n\n`
      + "Havolani hech kimga yubormang. Agar tiklashni siz boshlamagan bo'lsangiz, havolani ochmang — parolingiz o'zgarmaydi.";
  }
  return null; // not an auth link
}

/** A recovery link for the browser: the bot learns it by its token. */
function createRecoverLink(verificationTokens, { now = Date.now() } = {}) {
  const token = crypto.randomBytes(14).toString('hex');
  verificationTokens.set('botinit_' + token, { flow: 'recover', confirmed: false, used: false, expiresAt: now + RECOVER_TTL_MS });
  setTimeout(() => verificationTokens.delete('botinit_' + token), RECOVER_TTL_MS).unref?.();
  return token;
}

module.exports = { handleAuthStart, createRecoverLink, RESET_TTL_MS };
