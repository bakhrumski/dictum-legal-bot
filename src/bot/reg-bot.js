// Authentication bot — registration, login OTP and recovery for
// @juristAI_registration_bot.
// This bot always uses long-polling (it never uses webhooks)
// so it works even when the main bot runs in webhook mode on Render.
const TelegramBot = require('node-telegram-bot-api');
const { pool } = require('../database/db');
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

    // login_, reg_, stepup_, recover_: src/bot/auth-start.js. Opening a
    // link never signs a browser in: login and registration send a code to
    // this chat, to be typed in the browser that started it.
    if (/^(login_|reg_|stepup_|recover_)/.test(param)) {
      try {
        const appUrl = process.env.APP_URL || ('https://' + (process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:3000'));
        const text = await require('./auth-start').handleAuthStart(param, msg.from, { pool, loginSessions, regSessions, verificationTokens, appUrl });
        if (text) await regBot.sendMessage(chatId, text);
      } catch (e) {
        console.error('[REG-BOT] auth link error:', e.message);
        regBot.sendMessage(chatId, '⚠️ Xatolik yuz berdi. Iltimos, keyinroq urinib ko\'ring.');
      }
      return;
    }

    // A bare /start is intentionally not matched to the newest anonymous web
    // session. Doing that could bind the wrong visitor when several people are
    // signing in at once. The signed deep link above is the one-tap approval.
    regBot.sendMessage(chatId,
      `Assalomu aleykum, ${msg.from.first_name}! 👋\n\nJuristAIga xush kelibsiz!\n\nKirish yoki ro'yxatdan o'tish uchun JuristAI saytidagi “Telegram bilan” tugmasini bosing: shu yerga 6 raqamli kod keladi, uni o'sha sahifaga kiriting. Kodni hech kimga bermang.`
    );
  });

  console.log('[REG-BOT] Registration bot polling started');
  return regBot;
}

module.exports = { startRegBot, getRegBot: () => regBot };
