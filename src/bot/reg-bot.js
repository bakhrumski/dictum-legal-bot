// Authentication bot — registration, login OTP and recovery for
// @juristAI_registration_bot.
// This bot always uses long-polling (it never uses webhooks)
// so it works even when the main bot runs in webhook mode on Render.
const TelegramBot = require('node-telegram-bot-api');
const { pool } = require('../database/db');
const crypto = require('crypto');
const { verificationTokens, regSessions, loginSessions } = require('../verification-store');

let regBot = null;
const OTP_BOT_USERNAME = 'juristAI_registration_bot';

function startRegBot() {
  const token = process.env.REG_BOT_TOKEN;
  if (!token) {
    console.warn(`[REG-BOT] REG_BOT_TOKEN not set — @${OTP_BOT_USERNAME} authentication is disabled`);
    return null;
  }

  regBot = new TelegramBot(token, { polling: true });
  regBot.getMe().then((info) => {
    if (!info || String(info.username).toLowerCase() !== OTP_BOT_USERNAME.toLowerCase()) {
      console.error(`[REG-BOT] REG_BOT_TOKEN must belong to @${OTP_BOT_USERNAME}; received @${info && info.username ? info.username : 'unknown'}`);
    }
  }).catch((err) => console.error('[REG-BOT] Unable to verify bot identity:', err.message));

  regBot.on('polling_error', (err) => {
    console.error('[REG-BOT] Polling error:', err.code, err.message);
  });
  regBot.on('error', (err) => {
    console.error('[REG-BOT] Error:', err.message);
  });

  // ── /start handler ──────────────────────────────────────────────────────────
  regBot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const param = (match[1] || '').trim();

    // /start reg_TOKEN — one-tap Telegram authorization
    if (param.startsWith('reg_')) {
      const token = param.replace('reg_', '').trim();
      const session = regSessions.get(token);
      if (session && !session.approved) {
        session.otp = 'APPROVED';
        session.approved = true;
        session.telegramUserId = String(msg.from.id);
        session.firstName = msg.from.first_name || '';
        session.lastName = msg.from.last_name || '';
        session.username = msg.from.username || '';
        session.otpSentAt = Date.now();
        regBot.sendMessage(chatId, `✅ JuristAI ro'yxatdan o'tishiga ruxsat berildi. Saytga qayting — jarayon avtomatik davom etadi.`);
      } else if (session && session.approved) {
        regBot.sendMessage(chatId, `✅ Ruxsat avval tasdiqlangan. Saytga qayting.`);
      } else {
        regBot.sendMessage(chatId, '⏳ Sessiya topilmadi yoki muddati o\'tgan.\nIltimos, saytda qayta ro\'yxatdan o\'tishni boshlang.');
      }
      return;
    }

    // /start login_TOKEN — one-tap Telegram authorization
    if (param.startsWith('login_')) {
      const token = param.replace('login_', '').trim();
      const session = loginSessions.get(token);
      if (session && !session.approved) {
        session.otp = 'APPROVED';
        session.approved = true;
        session.telegramUserId = String(msg.from.id);
        session.otpSentAt = Date.now();
        regBot.sendMessage(chatId, `✅ JuristAI hisobiga kirishga ruxsat berildi. Saytga qayting — kirish avtomatik yakunlanadi.`);
      } else if (session && session.approved) {
        regBot.sendMessage(chatId, `✅ Kirish avval tasdiqlangan. Saytga qayting.`);
      } else {
        regBot.sendMessage(chatId, '⏳ Sessiya topilmadi yoki muddati o\'tgan.\nIltimos, saytda qayta urinib ko\'ring.');
      }
      return;
    }

    // /start recover_TOKEN — password recovery
    if (param.startsWith('recover_')) {
      const deepToken = param.replace('recover_', '');
      const appUrl = process.env.APP_URL || ('https://' + (process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:3000'));
      const tgId = String(msg.from.id);
      try {
        const row = (await pool.query('SELECT id FROM admins WHERE telegram_user_id = $1', [tgId])).rows[0];
        if (row) {
          const resetToken = crypto.randomBytes(20).toString('hex');
          verificationTokens.set('pwreset_' + resetToken, { adminId: row.id, expiresAt: Date.now() + 15 * 60 * 1000 });
          const recoverLink = `${appUrl}/login.html?recover=${resetToken}`;
          await regBot.sendMessage(chatId, `🔑 Parolni tiklash havolasi:\n${recoverLink}\n\nHavola 15 daqiqa amal qiladi.`);
          const botInitKey = 'botinit_' + deepToken;
          if (verificationTokens.has(botInitKey)) {
            const s = verificationTokens.get(botInitKey);
            s.confirmed = true;
            s.resetToken = resetToken;
          }
          return;
        }
        regBot.sendMessage(chatId, '❌ Bu Telegram hisobi bilan ro\'yxatdan o\'tilmagan. Iltimos, avval ro\'yxatdan o\'ting.');
      } catch (e) {
        console.error('[REG-BOT] recovery error:', e.message);
        regBot.sendMessage(chatId, '⚠️ Xatolik yuz berdi. Iltimos, keyinroq urinib ko\'ring.');
      }
      return;
    }

    // A bare /start is intentionally not matched to the newest anonymous web
    // session. Doing that could bind the wrong visitor when several people are
    // signing in at once. The signed deep link above is the one-tap approval.
    regBot.sendMessage(chatId,
      `Assalomu aleykum, ${msg.from.first_name}! 👋\n\nJuristAIga xush kelibsiz!\n\nKirish yoki ro'yxatdan o'tish uchun JuristAI saytidagi “Telegram bilan davom eting” tugmasini bosing. Tasdiqlash avtomatik bajariladi — kod kiritish shart emas.`
    );
  });

  console.log('[REG-BOT] Registration bot polling started');
  return regBot;
}

module.exports = { startRegBot, getRegBot: () => regBot };
