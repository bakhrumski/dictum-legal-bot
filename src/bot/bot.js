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

const { verificationTokens, regSessions, loginSessions } = require('../verification-store');

// Auto-answering used to run through `askJustify`, an external service whose
// URL defaults to http://localhost:8000. In production that host does not
// exist, so the availability probe always failed and EVERY question — however
// simple — fell through to the human queue. Answers now come from the
// platform's own retrieval + citation-verification stack via
// src/agents/telegram-agent.js. justify-client.js is left in place for the
// separate Justify integration; the bot no longer depends on it.

const token = process.env.TELEGRAM_BOT_TOKEN;
const LEGAL_BOT_USERNAME = 'yuristga_savolbot';
const AUTH_BOT_USERNAME = 'juristAI_registration_bot';
const LEGAL_BOT_AUTH_FALLBACK_ENABLED = false;

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
bot.getMe().then((info) => {
  if (!info || String(info.username).toLowerCase() !== LEGAL_BOT_USERNAME.toLowerCase()) {
    console.error(`[BOT] TELEGRAM_BOT_TOKEN must belong to @${LEGAL_BOT_USERNAME}; received @${info && info.username ? info.username : 'unknown'}`);
  }
}).catch((err) => console.error('[BOT] Unable to verify legal bot identity:', err.message));

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

// Files sent WITHOUT a written description are held here until the user sends
// the describing text, then the two are combined into one request.
// chatId -> { request_type, file_id, file_size, file_name, at }
const pendingFiles = new Map();
const PENDING_FILE_TTL = 60 * 60 * 1000; // 1 hour
const MIN_FILE_DESC = 200; // min chars of description required with a file

// ========== REQUIRED CHANNEL SUBSCRIPTION ==========
// Users must join this channel before they can send a legal request.
// Set REQUIRED_CHANNEL='' to disable the gate. The bot MUST be an
// administrator of the channel for membership checks to work.
const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL !== undefined
  ? process.env.REQUIRED_CHANNEL
  : '@eng_sara_huquqiy_yangiliklar';

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
bot.onText(/\/link(?:\s+(\S+)\s+(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const username = match[1];
  const password = match[2];

  if (!username || !password) {
    bot.sendMessage(chatId, '📋 Foydalanish:\n/link <username> <parol>\n\nMisol: /link admin admin123');
    return;
  }

  try {
    const result = await pool.query(
      'SELECT id, password, full_name, role FROM admins WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      bot.sendMessage(chatId, '❌ Username topilmadi.');
      return;
    }

    const admin = result.rows[0];
    const isValid = await bcrypt.compare(password, admin.password);

    if (!isValid) {
      bot.sendMessage(chatId, '❌ Parol noto\'g\'ri.');
      return;
    }

    // Check if this chat is already linked to another admin
    const existingLink = await pool.query(
      'SELECT username FROM admins WHERE telegram_chat_id = $1 AND id != $2',
      [chatId, admin.id]
    );
    if (existingLink.rows.length > 0) {
      bot.sendMessage(chatId, `⚠️ Bu Telegram hisob allaqachon @${existingLink.rows[0].username} ga ulangan. Avval /unlink qiling.`);
      return;
    }

    await pool.query(
      'UPDATE admins SET telegram_chat_id = $1 WHERE id = $2',
      [chatId, admin.id]
    );

    const roleLabels = { master: 'Admin', lawyer: 'Yurist', student: 'Student' };
    bot.sendMessage(chatId, `✅ Telegram hisobingiz ulandi!\n\n👤 ${admin.full_name}\n🔑 Rol: ${roleLabels[admin.role] || admin.role}\n\nEndi bildirishnomalar olasiz:\n• Guruh chatda @mention\n• Murojaat tayinlanganda\n\n/unlink - Uzish`);
  } catch (error) {
    console.error('Link error:', error);
    bot.sendMessage(chatId, '❌ Xatolik yuz berdi. Qaytadan urinib ko\'ring.');
  }
});

// /unlink - Unlink Telegram account
bot.onText(/\/unlink/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const result = await pool.query(
      'UPDATE admins SET telegram_chat_id = NULL WHERE telegram_chat_id = $1 RETURNING full_name',
      [chatId]
    );

    if (result.rowCount > 0) {
      bot.sendMessage(chatId, `✅ Telegram hisobingiz uzildi, ${result.rows[0].full_name}. Endi bildirishnomalar olmaysiz.`);
    } else {
      bot.sendMessage(chatId, 'ℹ️ Bu Telegram hisob hech qanday admin hisobiga ulanmagan.');
    }
  } catch (error) {
    console.error('Unlink error:', error);
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
    const result = await pool.query(
      'SELECT full_name, username, role FROM admins WHERE telegram_chat_id = $1',
      [chatId]
    );

    if (result.rows.length > 0) {
      const admin = result.rows[0];
      const roleLabels = { master: 'Admin', lawyer: 'Yurist', student: 'Student' };
      bot.sendMessage(chatId, `✅ Ulangan hisob:\n\n👤 ${admin.full_name}\n🆔 @${admin.username}\n🔑 ${roleLabels[admin.role] || admin.role}`);
    } else {
      bot.sendMessage(chatId, 'ℹ️ Bu Telegram hisob hech qanday admin hisobiga ulanmagan.\n\n/link <username> <parol> - Ulash');
    }
  } catch (error) {
    console.error('Me error:', error);
    bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
  }
});

// ========== CALLBACK QUERY HANDLER (Respond to request) ==========

bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  // Handle channel-subscription re-check
  if (data === 'check_sub') {
    try {
      if (await isChannelMember(callbackQuery.from.id)) {
        bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Rahmat! Obuna tasdiqlandi.' });
        bot.sendMessage(chatId, '✅ Obuna tasdiqlandi! Endi huquqiy savolingizni yuborishingiz mumkin.');
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
      const adminResult = await pool.query(
        'SELECT id, role, full_name FROM admins WHERE telegram_chat_id = $1',
        [chatId]
      );

      if (adminResult.rows.length === 0) {
        bot.answerCallbackQuery(callbackQuery.id, { text: 'Avval /link buyrug\'i bilan ulaning!' });
        return;
      }

      const admin = adminResult.rows[0];

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
});

// ========== START & HELP COMMANDS ==========

bot.onText(/\/start(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || '';
  const param = (match[1] || '').trim();

  // Authentication never happens in the public legal-question bot. Preserve
  // the deep-link payload and send the user to the dedicated auth bot.
  if (/^(login_|reg_|recover_|legacy_recover_)/.test(param)) {
    const authUrl = `https://t.me/${AUTH_BOT_USERNAME}?start=${encodeURIComponent(param)}`;
    await bot.sendMessage(chatId,
      'Kirish, ro\'yxatdan o\'tish va parolni tiklash uchun maxsus JuristAI botidan foydalaning.',
      { reply_markup: { inline_keyboard: [[{ text: 'JuristAI ro\'yxatdan o\'tish boti', url: authUrl }]] } }
    );
    return;
  }

  if (param === 'advokat') {
    try {
      await pool.query(`
        INSERT INTO tg_conversations (chat_id, state, updated_at)
        VALUES ($1, 'attorney_intake', NOW())
        ON CONFLICT (chat_id) DO UPDATE SET state = 'attorney_intake', updated_at = NOW()
      `, [chatId]);
    } catch (error) {
      console.warn('[BOT] attorney intake state could not be saved:', error.message);
    }
    await bot.sendMessage(chatId,
      'Sizga mos advokat topishim uchun vaziyatni qisqacha yozing.\n\n' +
      'Huquq sohasi, hudud va qaysi tilda maslahat kerakligini ko\'rsatsangiz, moslik aniqroq bo\'ladi. JuristAI narx belgilamaydi va xizmat narxi bo\'yicha muzokara olib bormaydi.'
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
      const taken = (await pool.query(
        'SELECT id FROM admins WHERE telegram_user_id = $1 AND id <> $2', [tgId, row.id]
      )).rows[0];
      if (taken) {
        bot.sendMessage(chatId, '⚠️ Bu Telegram hisobi allaqachon boshqa akkauntga ulangan.');
        return;
      }
      await pool.query(
        'UPDATE admins SET telegram_user_id = $1, telegram_username = $2, telegram_link_code = NULL WHERE id = $3',
        [tgId, msg.from.username || null, row.id]
      );
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
      const otp = String(Math.floor(1000 + Math.random() * 9000));
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
      const otp = String(Math.floor(1000 + Math.random() * 9000));
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
          s.resetToken = resetToken;
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
  if (!param && LEGAL_BOT_AUTH_FALLBACK_ENABLED) {
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
      const otp = String(Math.floor(1000 + Math.random() * 9000));
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
      const otp = String(Math.floor(1000 + Math.random() * 9000));
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

  let dailyAiLimit = 3;
  try {
    const telegramAgent = require('../agents/telegram-agent');
    dailyAiLimit = telegramAgent.DAILY_AI_LIMIT;
    // A bare /start means "begin again". Clear stale clarification/service
    // states so the next message is classified normally. The reset deliberately
    // preserves human-takeover mode when an operator is handling the chat.
    await telegramAgent.resetConversation(chatId);
  } catch (error) {
    console.warn('[BOT] conversation could not be reset on /start:', error.message);
  }
  pendingFiles.delete(chatId);
  const welcomeMessage = `Assalomu alaykum, ${msg.from.first_name}! 👋

JuristAIga xush kelibsiz. Men inson yurist emasman — O'zbekiston qonunchiligi bo'yicha ma'lumot beruvchi AI yordamchiman.

📝 Huquqiy vaziyatingizni matn shaklida yozing. Har kuni ${dailyAiLimit} ta bepul AI huquqiy javob olishingiz mumkin. Salomlashuv, aniqlashtirish va xizmat bo'yicha murojaatlar bu limitga kirmaydi.

📎 Ovozli xabar, video yoki 5 MB gacha fayl ham yuborishingiz mumkin; bunday murojaatlarni yurist ko'rib chiqadi.

Javoblar umumiy huquqiy ma'lumot bo'lib, rasmiy yuridik xulosa hisoblanmaydi.`;

  bot.sendMessage(chatId, welcomeMessage, {
    reply_markup: { inline_keyboard: freeAccessKeyboard(false) }
  });
  pendingRequests[chatId] = { username: username || 'Noma\'lum', messages: [] };
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;

  const helpMessage = `
📋 Yordam

Murojaat yuborish uchun:
1. /start buyrug'ini yuboring
2. Masalangizni ixtiyoriy formatda yuboring (matn, ovoz, video, fayl)
3. Yurist javobini kuting

👨‍💼 Admin buyruqlari:
/link <username> <parol> - Telegram hisobni ulash
/unlink - Ulangan hisobni uzish
/me - Hisob holatini ko'rish
/cancel - Javob berishni bekor qilish

Qo'shimcha savol bo'lsa: /start ni qayta bosing
  `;

  bot.sendMessage(chatId, helpMessage);
});

// ========== MAIN MESSAGE HANDLER ==========

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || `user_${msg.from.id}`;
  const firstName = msg.from.first_name || 'Foydalanuvchi';

  // Ignore commands
  if (msg.text && msg.text.startsWith('/')) return;

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

          const masterNotification = `📝 Student javob berdi!\n\n👨‍🎓 Student: ${pending.fullName}\n📋 Murojaat #${pending.requestId}\n👤 Murojatchi: ${req?.first_name || ''} (@${req?.username || ''})\n\n📝 Student javobi:\n${responseText.substring(0, 200)}${responseText.length > 200 ? '...' : ''}\n\nDashboard: ${process.env.DASHBOARD_URL || 'http://localhost:3000'}\nTasdiqlash uchun dashboardga kiring!`;

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

  // ---- CHECK IF SENDER IS A LINKED ADMIN (without pending response) ----
  try {
    const adminCheck = await pool.query(
      'SELECT id, full_name FROM admins WHERE telegram_chat_id = $1',
      [chatId]
    );

    if (adminCheck.rows.length > 0) {
      // This is a linked admin - don't treat as user request
      bot.sendMessage(chatId, `👋 ${adminCheck.rows[0].full_name}, siz admin sifatida ulangansiz.\n\nBildirishnomalarni shu yerda olasiz.\n\n📋 Dashboard: ${process.env.DASHBOARD_URL || 'http://localhost:3000'}\n/me - Hisob holati\n/unlink - Uzish`);
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

  // Require channel subscription before accepting a request
  if (!(await isChannelMember(msg.from.id))) {
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
      bot.sendMessage(chatId,
        '📎 Faylingiz qabul qilindi.' + tooShortNote + '\n\n' +
        `✍️ Endi vaziyatingizni yozib yuboring — nima bo'lgani va qanday yordam kerakligini batafsil tushuntiring (kamida ${MIN_FILE_DESC} belgi).\n\n` +
        '⚠️ Faqat fayl yuborish yetarli emas: hujjat/rasm bilan birga izoh (savolingiz) bo\'lishi shart.'
      );
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
  if (requestData.request_type === 'text') {
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
          });
        } finally {
          clearInterval(typing);
        }

        if (agentResult && agentResult.handled && agentResult.reply) {
          for (const part of splitForTelegram(agentResult.reply)) {
            await bot.sendMessage(chatId, part, {
              parse_mode: 'Markdown',
              disable_web_page_preview: true,
            }).catch(async () => {
              // Markdown in a legal answer breaks on stray * or _ — never let
              // a formatting failure swallow the answer itself.
              await bot.sendMessage(chatId, part.replace(/[*_`\[\]]/g, '')).catch(() => {});
            });
          }
        }
      }
    } catch (agentErr) {
      console.error('[BOT] agent failed, falling back to human queue:', agentErr.message);
      agentResult = null;
    }
  }

  // Conversational turns (greetings, clarifying questions, off-topic replies)
  // are not legal requests — they must not create dashboard rows or the queue
  // fills with "salom".
  const conversational = agentResult && agentResult.handled
    && [
      'greeting', 'clarify', 'offtopic', 'account_help',
      'identity', 'quota_exceeded', 'quota_unavailable',
      'attorney_contact_shared', 'attorney_contact_cancelled', 'attorney_choice_required',
    ].includes(agentResult.action);
  if (conversational) return;

  const agentDelivered = !!(agentResult && agentResult.handled && agentResult.reply);
  const resolvedByAgent = !!(agentResult && agentResult.handled
    && ['answered', 'attorney_matches'].includes(agentResult.action)
    && !agentResult.escalate);
  const needsHuman = !resolvedByAgent || !!(agentResult && agentResult.escalate);

  // Save to database
  try {
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
            intakeData: { originalText: requestData.request_text, source: 'telegram' },
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
          bot.sendMessage(chatId, '💬 Yana savolingiz bo\'lsa — bemalol yozing.').catch(() => {});
        }
      } else if (agentDelivered && needsHuman && agentResult.action === 'answered') {
        bot.sendMessage(chatId, '👨‍⚖️ Murojaatingiz aniqlik uchun yuristga ham yuborildi — tasdiq shu yerda keladi.').catch(() => {});
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

Dashboard: ${process.env.DASHBOARD_URL || 'http://localhost:3000'}
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
});

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
       status, 'Boshqa',
       agentReply, agentReply ? 'JuristAI Telegram agenti' : null,
       status === 'ai_answered' ? new Date() : null,
       agentMeta.intent || null, agentMeta.action || null, status !== 'ai_answered']
    );

    await client.query('COMMIT');

    const requestId = insertResult.rows[0].id;

    // Async triage — classify request without blocking the response
    const { triageRequest } = require('../agents/triage');
    triageRequest(requestId, data.request_text, data.request_type).catch(err =>
      console.error('[TRIAGE] Async error:', err.message)
    );

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
module.exports = { bot, getBot: () => bot, isChannelMember, channelLink, REQUIRED_CHANNEL, INSTAGRAM_URL };

console.log('Bot ishlamoqda...');
