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
const {
  isJustifyAvailable,
  askJustify,
} = require('../rag/justify-client');

// Cache Justify availability at startup (re-check every 5 min)
let _justifyOk = false;
isJustifyAvailable().then(ok => { _justifyOk = ok; }).catch(() => {});
setInterval(() => {
  isJustifyAvailable().then(ok => { _justifyOk = ok; }).catch(() => {});
}, 5 * 60 * 1000);

const token = process.env.TELEGRAM_BOT_TOKEN;

// NEVER start polling in constructor — polling is started explicitly when needed
const bot = new TelegramBot(token, { polling: false });

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
  if (!param) {
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

  const welcomeMessage = `
Assalomu aleykum, ${msg.from.first_name}! 👋

JuristAIga xush kelibsiz!

📝 Yuridik masalangizni yuboring:
• Matn shaklida
• Ovozli xabar
• Video xabar
• Fayl (max 5MB)

Yuristlarimiz tez orada javob berishadi.

👨‍💼 Admin bo'lsangiz: /link <username> <parol>
  `;

  bot.sendMessage(chatId, welcomeMessage);
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
  if (msg.text) {
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

  // Check pending request limit (max 3 per cycle, resets after any response)
  try {
    const userRow = await pool.query(
      'SELECT id FROM users WHERE telegram_id = $1',
      [chatId]
    );
    if (userRow.rows.length > 0) {
      const uid = userRow.rows[0].id;
      // Find the latest response time (when a lawyer/student last answered)
      const lastResponse = await pool.query(
        "SELECT MAX(answered_at) as last_answered FROM requests WHERE user_id = $1 AND status = 'answered' AND answered_at IS NOT NULL",
        [uid]
      );
      const lastAnswered = lastResponse.rows[0]?.last_answered;
      // Count requests created AFTER the last response (or all if no response yet)
      let countQuery;
      let countParams;
      if (lastAnswered) {
        countQuery = "SELECT COUNT(*) as cnt FROM requests WHERE user_id = $1 AND created_at > $2";
        countParams = [uid, lastAnswered];
      } else {
        countQuery = "SELECT COUNT(*) as cnt FROM requests WHERE user_id = $1";
        countParams = [uid];
      }
      const requestCount = await pool.query(countQuery, countParams);
      if (parseInt(requestCount.rows[0].cnt) >= 1) {
        bot.sendMessage(chatId,
          '⏳ Savolingiz yuborilgan, javob kutilmoqda.\n\n' +
          'Yangi savol yuborish uchun avvalgi savolingizga javob kelishini kuting.\n\n' +
          'Javob kelgandan so\'ng yana savol yuborishingiz mumkin.'
        );
        return;
      }
    }
  } catch (error) {
    console.error('Error checking pending limit:', error);
  }

  // ── AI-first: auto-answer text questions via Justify RAG ──
  if (requestData.request_type === 'text' && _justifyOk) {
    const question = requestData.request_text;
    const MIN_QUESTION_LENGTH = 10;
    if (question.length >= MIN_QUESTION_LENGTH) {
      // Send "thinking" indicator
      await bot.sendMessage(chatId, '⏳ Savolingiz tekshirilmoqda...').catch(() => {});
      try {
        const aiResult = await askJustify(question);
        if (aiResult && aiResult.answer) {
          // Format sources list
          let sourcesText = '';
          if (aiResult.sources && aiResult.sources.length > 0) {
            const topSources = aiResult.sources.slice(0, 3);
            sourcesText = '\n\n📎 *Manbalar:*\n' + topSources.map((s, i) => {
              const title = s.title || s.article || 'Manba';
              return s.url ? `${i + 1}. [${title}](${s.url})` : `${i + 1}. ${title}`;
            }).join('\n');
          }

          const webNote = aiResult.web_search_used ? '\n_🌐 (Internet qidiruvi ham ishlatildi)_' : '';
          const strategyNote = aiResult.strategy ? ` · _${aiResult.strategy}_` : '';

          const aiMessage = `🤖 *AI Yurist javobi*${strategyNote}\n\n${aiResult.answer}${sourcesText}${webNote}`;

          // Telegram has 4096 char limit; truncate if needed
          const maxLen = 4000;
          const finalMsg = aiMessage.length > maxLen
            ? aiMessage.substring(0, maxLen) + '...'
            : aiMessage;

          await bot.sendMessage(chatId, finalMsg, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
          }).catch(async () => {
            // If Markdown fails, send plain text
            await bot.sendMessage(chatId, aiResult.answer.substring(0, 4000)).catch(() => {});
          });
        }
      } catch (aiErr) {
        console.warn('[BOT] AI auto-answer failed:', aiErr.message);
        // Continue silently — user still gets the request-saved message below
      }
    }
  }

  // Save to database
  try {
    const result = await saveRequest(requestData);

    if (result.success) {
      const aiAnswered = requestData.request_type === 'text' && _justifyOk && requestData.request_text.length >= 10;
      const confirmation = aiAnswered
        ? `✅ Murojaat yuristlarga ham yuborildi.\n\nYurist yaxshiroq javob yoki tuzatish kiritishi mumkin — shu yerda xabardor bo'lasiz.`
        : `✅ Murojaat qabul qilindi!\n\n📋 Sizning ma'lumotlaringiz:\n👤 Username: @${username}\n📝 Turi: ${getRequestTypeLabel(requestData.request_type)}\n\nYurist tez orada murojatingizni ko'rib chiqadi va javob beradi. Rahmat!`;

      bot.sendMessage(chatId, confirmation);

      // Notify admin
      try {
        const adminNotification = `
🔔 Yangi murojaat keldi!

👤 Foydalanuvchi: ${firstName}
🆔 Username: @${username}
📝 Turi: ${getRequestTypeLabel(requestData.request_type)}

${requestData.request_type === 'text' ? `Murojaat: ${requestData.request_text}` : ''}

Dashboard: ${process.env.DASHBOARD_URL || 'http://localhost:3000'}
        `;

        await bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, adminNotification);
      } catch (error) {
        console.error('Failed to notify admin:', error);
      }

      console.log('Yangi murojaat saqlandi!');
    } else {
      const errMsg = result.error?.message || result.error || 'Unknown DB error';
      console.error('Save error:', errMsg, result.error?.detail || '');
      bot.sendMessage(chatId, `Xatolik yuz berdi. Iltimos qaytadan urinib ko'ring.\n\n(${errMsg})`);
    }
  } catch (error) {
    console.error('Error processing request:', error.message, error.stack);
    bot.sendMessage(chatId, `Xatolik yuz berdi. Iltimos qaytadan urinib ko'ring.\n\n(${error.message})`);
  }
});

// Save request to database
async function saveRequest(data) {
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

    // Insert request
    const insertResult = await client.query(
      `INSERT INTO requests
       (user_id, request_text, request_type, file_id, file_size, file_name, status, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [userId, data.request_text, data.request_type, data.file_id, data.file_size, data.file_name, 'pending', 'Boshqa']
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
module.exports = { bot, getBot: () => bot };

console.log('Bot ishlamoqda...');
