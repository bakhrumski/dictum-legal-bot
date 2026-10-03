'use strict';

/**
 * Telegram bot routing by role (2026-10-03). A customer account (role
 * 'user') linked to Telegram was told "siz admin sifatida ulangansiz" and
 * its legal questions were dropped: the message handler treated any admins
 * row with this telegram_chat_id as staff, while /me read the role
 * correctly. Staff routing now needs a staff role (master, lawyer, student).
 *
 * The bot module is loaded with a fake Telegram client, database, economy
 * and agent, so each handler is driven as Telegram would drive it.
 *
 *   node tests/telegram-roles.test.js
 */

const assert = require('assert');
const path = require('path');
const roles = require('../src/bot/telegram-roles');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

// ── Fakes ──────────────────────────────────────────────────────────────────
const sent = [];        // { chatId, text, opts }
const callbacks = [];   // { id, opts }
const agentCalls = [];  // handleUserMessage args
let agentReply = { handled: true, reply: 'Huquqiy javob', action: 'greeting' };

class FakeBot {
  constructor() { this.handlers = []; this.textHandlers = []; }
  on(event, fn) { this.handlers.push({ event, fn }); }
  onText(re, fn) { this.textHandlers.push({ re, fn }); }
  setMyCommands() { return Promise.resolve(); }
  getMe() { return Promise.resolve({ username: 'yuristga_savolbot' }); }
  sendMessage(chatId, text, opts) { sent.push({ chatId, text, opts }); return Promise.resolve({}); }
  answerCallbackQuery(id, opts) { callbacks.push({ id, opts }); return Promise.resolve(); }
  sendChatAction() { return Promise.resolve(); }
  getFileLink() { return Promise.resolve('https://files.example/voice.ogg'); }
  startPolling() {}
}

// chatId -> admins row
const accounts = new Map();
const pool = {
  async query(sql, params = []) {
    if (/FROM admins WHERE telegram_chat_id = \$1/u.test(sql) && !/id != \$2/u.test(sql)) {
      const row = accounts.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    if (/FROM requests WHERE id = \$1/u.test(sql)) return { rows: [{ id: params[0], status: 'pending', request_text: 'x', request_type: 'text' }] };
    return { rows: [], rowCount: 0 };
  },
};

const economy = {
  recordTelegramActivity: async () => {},
  getTelegramUserStats: async () => ({ dailyUsers: 1, monthlyUsers: 1 }),
  getPaidAnswerCredits: async () => 0,
  getAnswerEntitlementStatus: async () => ({ allowed: true }),
  grantPaidAnswers: async () => ({}),
};

const agent = {
  FREE_AI_LIMIT: 3,
  isReady: () => true,
  handleUserMessage: async (args) => { agentCalls.push(args); return agentReply; },
  splitForTelegram: (t) => [t],
  finalizeDailyAiAnswer: async () => true,
  releaseDailyAiAnswer: async () => true,
  loadConversation: async () => ({ state: null, context: {} }),
  resetConversation: async () => {},
  setConversationState: async () => {},
};

const speech = { sttEnabled: () => true, transcribe: async () => 'Ishdan bo\'shatishdi, nima qilay?' };

function stub(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('node-telegram-bot-api', FakeBot);
stub(path.join(__dirname, '../src/database/db'), { pool });
stub(path.join(__dirname, '../src/services/telegram-economy'), economy);
stub(path.join(__dirname, '../src/agents/telegram-agent'), agent);
stub(path.join(__dirname, '../src/ai/voicelab-speech'), speech);
global.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'test-token';
delete process.env.DASHBOARD_URL;
const { bot } = require('../src/bot/bot');

const flush = () => new Promise(r => setTimeout(r, 30));
async function message(msg) {
  const full = { chat: { id: msg.chatId }, from: { id: msg.chatId, first_name: 'Ali', username: 'ali' }, ...msg };
  delete full.chatId;
  for (const h of bot.handlers.filter(h => h.event === 'message')) await h.fn(full);
  if (full.text) {
    for (const t of bot.textHandlers) {
      const m = full.text.match(t.re);
      if (m) await t.fn(full, m);
    }
  }
  await flush();
}
async function callback(chatId, data) {
  for (const h of bot.handlers.filter(h => h.event === 'callback_query')) {
    await h.fn({ id: `cb-${chatId}-${data}`, data, from: { id: chatId }, message: { chat: { id: chatId } } });
  }
  await flush();
}
const reset = () => { sent.length = 0; callbacks.length = 0; agentCalls.length = 0; agentReply = { handled: true, reply: 'Huquqiy javob', action: 'greeting' }; };
const textsTo = (chatId) => sent.filter(s => s.chatId === chatId).map(s => s.text);
const ADMIN_NOTICE = /admin sifatida ulangansiz/u;

const USER = 101, PLAIN = 102, LAWYER = 103, STUDENT = 104, MASTER = 105, ODD = 106, EMPTY = 107;
accounts.set(USER, { id: 1, full_name: 'Mijoz', username: 'mijoz', role: 'user' });
accounts.set(LAWYER, { id: 2, full_name: 'Yurist', username: 'yurist', role: 'lawyer' });
accounts.set(STUDENT, { id: 3, full_name: 'Talaba', username: 'talaba', role: 'student' });
accounts.set(MASTER, { id: 4, full_name: 'Bosh', username: 'bosh', role: 'master' });
accounts.set(ODD, { id: 5, full_name: 'Nomalum', username: 'nomalum', role: 'superuser' });
accounts.set(EMPTY, { id: 6, full_name: 'Bosh rol', username: 'bosh_rol', role: '' });

(async () => {
  console.log('telegram roles');

  await test('roles: only master, lawyer and student are staff; unknown and empty are not', () => {
    assert.deepStrictEqual(['master', 'lawyer', 'student', ' Master '].map(roles.isStaffRole), [true, true, true, true]);
    assert.deepStrictEqual(['user', '', null, undefined, 'superuser', 'admin'].map(roles.isStaffRole), [false, false, false, false, false, false]);
    assert.strictEqual(roles.chatRoute(null), 'user');
    assert.strictEqual(roles.chatRoute({ role: 'user' }), 'user');
    assert.strictEqual(roles.chatRoute({ role: 'lawyer' }), 'staff');
    assert.strictEqual(roles.chatRoute({ role: 'lawyer' }, { testMode: true }), 'staff', 'test mode is a master tool only');
    assert.strictEqual(roles.chatRoute({ role: 'master' }, { testMode: true }), 'user');
    assert.strictEqual(roles.roleLabel('user'), 'Foydalanuvchi');
  });

  await test('dashboard link: never localhost in production', () => {
    assert.strictEqual(roles.dashboardUrl({ NODE_ENV: 'production' }), 'https://juristai.uz/dashboard.html');
    assert.strictEqual(roles.dashboardUrl({ RENDER: 'true', DASHBOARD_URL: 'http://localhost:3000' }), 'https://juristai.uz/dashboard.html');
    assert.strictEqual(roles.dashboardUrl({ NODE_ENV: 'production', DASHBOARD_URL: 'https://juristai.uz' }), 'https://juristai.uz/dashboard.html');
    assert.strictEqual(roles.dashboardUrl({ NODE_ENV: 'production', APP_URL: 'https://juristai.uz/' }), 'https://juristai.uz/dashboard.html');
    assert.strictEqual(roles.dashboardUrl({ DASHBOARD_URL: 'https://juristai.uz/dashboard.html' }), 'https://juristai.uz/dashboard.html');
    assert.strictEqual(roles.dashboardUrl({}), 'http://localhost:3000/dashboard.html', 'development keeps the local server');
  });

  await test('1. a linked customer\'s legal question goes to the agent, which owns the daily quota', async () => {
    reset();
    await message({ chatId: USER, text: 'Ishdan asossiz bo\'shatishdi, nima qilay?' });
    assert.ok(!textsTo(USER).some(t => ADMIN_NOTICE.test(t)), textsTo(USER).join(' | '));
    assert.deepStrictEqual(agentCalls.map(c => c.chatId), [USER]);
    // the agent's quota answer reaches the user with the payment button
    reset();
    agentReply = { handled: true, reply: 'Bugungi bepul limit tugadi', action: 'quota_exceeded' };
    await message({ chatId: USER, text: 'Yana bir savol' });
    const last = sent.filter(s => s.chatId === USER).pop();
    assert.match(last.text, /limit tugadi/u);
    assert.ok(last.opts && last.opts.reply_markup, 'the paid-answer keyboard is attached');
  });

  await test('2. a chat with no linked account works as before', async () => {
    reset();
    await message({ chatId: PLAIN, text: 'Aliment qancha bo\'ladi?' });
    assert.deepStrictEqual(agentCalls.map(c => c.chatId), [PLAIN]);
  });

  await test('3. lawyer, student and master keep the staff path; respond buttons still work for them', async () => {
    for (const chatId of [LAWYER, STUDENT, MASTER]) {
      reset();
      await message({ chatId, text: 'Salom' });
      assert.ok(textsTo(chatId).some(t => ADMIN_NOTICE.test(t)), `chat ${chatId}`);
      assert.strictEqual(agentCalls.length, 0);
      assert.ok(textsTo(chatId).every(t => !/localhost/u.test(t)) || process.env.NODE_ENV !== 'production');
      reset();
      await callback(chatId, 'respond_77');
      assert.strictEqual(callbacks[0].opts.text, 'Javobingizni yozing!');
      await message({ chatId, text: '/cancel' });
    }
  });

  await test('unknown or empty roles are not staff', async () => {
    for (const chatId of [ODD, EMPTY]) {
      reset();
      await message({ chatId, text: 'Savol' });
      assert.ok(!textsTo(chatId).some(t => ADMIN_NOTICE.test(t)));
      assert.deepStrictEqual(agentCalls.map(c => c.chatId), [chatId]);
    }
  });

  await test('4. master test mode: user path while on, staff path again when off', async () => {
    reset();
    await message({ chatId: MASTER, text: '/testmode on' });
    assert.ok(textsTo(MASTER).some(t => /Test rejimi yoqildi/u.test(t)));
    reset();
    await message({ chatId: MASTER, text: 'Mehnat ta\'tili necha kun?' });
    assert.deepStrictEqual(agentCalls.map(c => c.chatId), [MASTER]);
    reset();
    await message({ chatId: MASTER, text: '/testmode off' });
    await message({ chatId: MASTER, text: 'Salom' });
    assert.ok(textsTo(MASTER).some(t => ADMIN_NOTICE.test(t)));
    assert.strictEqual(agentCalls.length, 0);
  });

  await test('5. a customer cannot use /testmode, and their questions are not affected by it', async () => {
    reset();
    await message({ chatId: USER, text: '/testmode on' });
    assert.ok(textsTo(USER).some(t => /faqat bosh administrator uchun/u.test(t)));
    reset();
    await message({ chatId: LAWYER, text: '/testmode on' });
    assert.ok(textsTo(LAWYER).some(t => /faqat bosh administrator uchun/u.test(t)), 'a lawyer is not a master either');
  });

  await test('6. voice, file and callbacks: the customer is not blocked as an admin', async () => {
    reset();
    await message({ chatId: USER, voice: { file_id: 'v1', file_size: 1000, mime_type: 'audio/ogg' } });
    assert.ok(!textsTo(USER).some(t => ADMIN_NOTICE.test(t)));
    assert.deepStrictEqual(agentCalls.map(c => [c.chatId, c.text]), [[USER, 'Ishdan bo\'shatishdi, nima qilay?']], 'the transcribed note reaches the agent');
    reset();
    await message({ chatId: USER, document: { file_id: 'd1', file_size: 1000, file_name: 'shartnoma.pdf' } });
    assert.ok(!textsTo(USER).some(t => ADMIN_NOTICE.test(t)), textsTo(USER).join(' | '));
    reset();
    await callback(USER, 'bot_stats');
    assert.strictEqual(callbacks[0].opts.text, 'Yangilandi');
    reset();
    await callback(USER, 'respond_77');
    assert.strictEqual(callbacks[0].opts.text, 'Bu amal faqat yuristlar uchun.', 'a customer cannot answer requests');
  });

  await test('/me shows the role and which path the chat takes', async () => {
    reset();
    await message({ chatId: USER, text: '/me' });
    assert.ok(textsTo(USER).some(t => /🔑 Foydalanuvchi[\s\S]*oddiy foydalanuvchi sifatida/u.test(t)), textsTo(USER).join(' | '));
    reset();
    await message({ chatId: LAWYER, text: '/me' });
    assert.ok(textsTo(LAWYER).some(t => /🔑 Yurist[\s\S]*bildirishnomalar keladi/u.test(t)));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
