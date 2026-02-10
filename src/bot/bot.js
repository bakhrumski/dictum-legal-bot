require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { pool } = require('../database/db');
const fs = require('fs');
const https = require('https');
const path = require('path');

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Handle all messages (text, voice, video, documents)
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || `user_${msg.from.id}`;
  const firstName = msg.from.first_name || 'Foydalanuvchi';

  // Handle /start command
  if (msg.text && msg.text.startsWith('/start')) {
    const welcomeMessage = `Assalomu aleykum, ${msg.from.first_name}! 👋

Dictum advokatlik firmasi murojaatlar bo'limiga xush kelibsiz!

📝 Muammoyingizni yuboring:
• Matn shaklida
• Ovozli xabar
• Video xabar
• Fayl (max 5MB)

❗️Iltimos, tezroq va sifatliroq javob berishimiz uchun murojaatingizni to'liq, bitta xabar bilan yuborishga harakat qiling.

Yuristlarimiz tez orada javob berishadi.`;
    bot.sendMessage(chatId, welcomeMessage);
    return;
  }

  // Handle /help command
  if (msg.text && msg.text.startsWith('/help')) {
    const helpMessage = `
📋 Yordam

Murojaat yuborish uchun:
1. /start buyrug'ini yuboring
2. Masalangizni ixtiyoriy formatda yuboring (matn, ovoz, video, fayl)
3. Yurist javobini kuting

Qo'shimcha savol bo'lsa: /start ni qayta bosing
    `;
    bot.sendMessage(chatId, helpMessage);
    return;
  }

  // Ignore other commands
  if (msg.text && msg.text.startsWith('/')) return;
  
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
    
    // Check file size (5MB = 5242880 bytes)
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
  
  // Save to database
  try {
    const result = await saveRequest(requestData);
    
    if (result.success) {
      const confirmation = `
✅ Murojaat qabul qilindi!

📋 Sizning ma'lumotlaringiz:
👤 Username: @${username}
📝 Turi: ${getRequestTypeLabel(requestData.request_type)}

Yurist tez orada murojatingizni ko'rib chiqadi va javob beradi. Rahmat!
      `;
      
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
      bot.sendMessage(chatId, 'Xatolik yuz berdi. Iltimos qaytadan urinib ko\'ring.');
      console.error('Save error:', result.error);
    }
  } catch (error) {
    console.error('Error processing request:', error);
    bot.sendMessage(chatId, 'Xatolik yuz berdi. Iltimos qaytadan urinib ko\'ring.');
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
  'INSERT INTO users (telegram_id, username, first_name) VALUES ($1, $2, $3) RETURNING id',
  [data.telegram_id, data.username, data.first_name]
);
      userId = insertUser.rows[0].id;
    } else {
      // Update existing user
      await client.query(
  'UPDATE users SET username = $1, first_name = $2 WHERE telegram_id = $3',
  [data.username, data.first_name, data.telegram_id]
);
      userId = userResult.rows[0].id;
    }
    
    // Insert request
    await client.query(
      `INSERT INTO requests 
       (user_id, request_text, request_type, file_id, file_size, file_name, status, category) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, data.request_text, data.request_type, data.file_id, data.file_size, data.file_name, 'pending', 'Boshqa']
    );
    
    await client.query('COMMIT');
    return { success: true };
    
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
module.exports = { bot };

console.log('Bot ishlamoqda...');
