'use strict';

/**
 * Landing promises made true (2026-10-20): account deletion on request,
 * PDF/DOCX AI analysis and the bot's history on the site, Workspace updates in
 * Telegram, a voice summary to Telegram, and the landing copy that no longer
 * promises what the code does not do. Fake database, bot and analyzer - no
 * network, no AI.
 *
 *   node tests/landing-promises.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

/** A fake pg pool: each handler is [regex, (params, sql) => rows]; every call is logged. */
function fakeDb(handlers) {
  const log = [];
  return {
    log,
    async query(sql, params = []) {
      log.push({ sql, params });
      for (const [rx, fn] of handlers) if (rx.test(sql)) return { rows: (await fn(params, sql)) || [] };
      return { rows: [] };
    },
  };
}

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

(async () => {
  const tools = require('../src/agents/account-tools');

  await test('"Akkauntni o\'chir" (typed or spoken, uz/ru) is the delete_account tool, never a legal question', async () => {
    for (const q of ["Akkauntni o'chir", "akkauntimni o'chirib tashlang", "Ma'lumotlarimni o'chiring", 'Удалите мой аккаунт', 'аккаунт удалить', 'delete my account']) {
      assert.strictEqual(tools.detectAccountAction(q), 'delete_account', q);
    }
    const out = await tools.runAccountTool('delete_account', { chatId: 1, who: {}, lang: 'uz' });
    assert.strictEqual(out.action, 'tool_delete_account_confirm');
    assert.match(out.reply, /tasdiqlang/u);
    assert.strictEqual(tools.toolFromIntent({ action: 'delete_account' }), 'delete_account');
  });

  await test('bot: the confirmation is a button, a request is filed only on "yes", in a private chat', () => {
    const bot = read('src/bot/bot.js');
    assert.match(bot, /tool_delete_account_confirm/u);
    assert.match(bot, /acc_del_yes/u);
    assert.match(bot, /acc_del_no/u);
    assert.match(bot, /createRequest\(pool/u);
  });

  const del = require('../src/services/account-deletion');

  await test('deletion request: one pending request per Telegram user', async () => {
    const reqs = [];
    const db = fakeDb([
      [/SELECT id, created_at FROM account_deletion_requests/u, ([tg]) => reqs.filter(r => r.telegram_user_id === tg && r.status === 'pending')],
      [/INSERT INTO account_deletion_requests/u, ([tg, chat, admin]) => { const r = { id: reqs.length + 1, telegram_user_id: tg, chat_id: chat, admin_id: admin, status: 'pending' }; reqs.push(r); return [r]; }],
    ]);
    const a = await del.createRequest(db, { telegramUserId: 77, chatId: 77, adminId: 5 });
    const b = await del.createRequest(db, { telegramUserId: 77, chatId: 77, adminId: 5 });
    assert.deepStrictEqual(a, { id: 1, duplicate: false });
    assert.deepStrictEqual(b, { id: 1, duplicate: true });
    assert.strictEqual(reqs.length, 1);
  });

  await test('deletion: personal data scrubbed, chats deleted, sessions revoked, accounting rows untouched', async () => {
    const revoked = [];
    const db = fakeDb([
      [/SELECT \* FROM account_deletion_requests/u, () => [{ id: 3, telegram_user_id: 77, chat_id: 77, admin_id: 5, status: 'pending' }]],
      [/SELECT id, role FROM admins/u, () => [{ id: 5, role: 'user' }]],
      [/information_schema\.columns/u, () => ['email', 'phone', 'telegram_user_id', 'telegram_chat_id', 'is_active'].map(c => ({ column_name: c }))],
      [/SELECT id FROM users WHERE telegram_id/u, () => [{ id: 9 }]],
    ]);
    const r = await del.complete(db, 3, { handledBy: 1, revoke: async (id) => revoked.push(id) });
    assert.strictEqual(r.ok, true);
    const sqls = db.log.map(x => x.sql).join('\n');
    const upd = db.log.find(x => /UPDATE admins SET/u.test(x.sql));
    assert.match(upd.sql, /email = NULL/u);
    assert.match(upd.sql, /telegram_user_id = NULL/u);
    assert.match(upd.sql, /is_active = FALSE/u);
    assert.match(upd.sql, /role = 'user'/u);
    assert.doesNotMatch(upd.sql, /google_id/u, 'a column the database lacks is skipped');
    assert.match(upd.params[1], /^deleted_5_/u);
    assert.match(sqls, /DELETE FROM ai_chat_sessions WHERE admin_id/u);
    assert.match(sqls, /UPDATE requests SET request_text/u);
    assert.match(sqls, /DELETE FROM tg_conversations/u);
    assert.doesNotMatch(sqls, /tariff_usage|tariff_periods|payments|llm_spend_log/u, 'accounting rows are kept');
    assert.deepStrictEqual(revoked, [5]);
    assert.match(sqls, /SET status = 'done'/u);
  });

  await test('deletion: a staff account is refused and nothing is changed', async () => {
    const db = fakeDb([
      [/SELECT \* FROM account_deletion_requests/u, () => [{ id: 4, telegram_user_id: 1, admin_id: 2, status: 'pending' }]],
      [/SELECT id, role FROM admins/u, () => [{ id: 2, role: 'master' }]],
    ]);
    const r = await del.complete(db, 4, { handledBy: 1 });
    assert.deepStrictEqual(r, { ok: false, error: 'staff_account' });
    assert.ok(!db.log.some(x => /^\s*(UPDATE|DELETE)/u.test(x.sql)));
  });

  await test('deletion: a handled request is not carried out twice; master endpoints exist', async () => {
    const db = fakeDb([[/SELECT \* FROM account_deletion_requests/u, () => [{ id: 5, status: 'done' }]]]);
    assert.deepStrictEqual(await del.complete(db, 5, {}), { ok: false, error: 'not_pending' });
    const server = read('src/api/server.js');
    assert.match(server, /app\.get\('\/api\/admin\/account-deletions', requireMasterAdmin/u);
    assert.match(server, /account-deletions\/:id\/complete', require\('\.\.\/auth\/same-origin'\)\.requireSameOrigin, requireMasterAdmin/u);
    assert.match(read('public/app/admin.js'), /account-deletions/u);
  });

  const docs = require('../src/bot/telegram-documents');

  function docFlow({ allowed = true, analysis = { summary: 'Qisqa', riskItems: [{ level: 'high', clause: '3.1', issue: 'Muammo' }] }, extract } = {}) {
    const sent = [], ledger = { calls: [] };
    Object.assign(ledger, {
      docUnits: ({ pages, chars }) => ({ units: Math.max(1, Math.ceil(Math.max(pages / 10, chars / 40000))), pages }),
      reserve: async (o) => { ledger.calls.push(['reserve', o]); return allowed ? { allowed: true, jobKey: 'k1' } : { allowed: false }; },
      commit: async (k) => ledger.calls.push(['commit', k]),
      release: async (k, why) => ledger.calls.push(['release', k, why]),
    });
    const bot = {
      getFileLink: async () => 'https://files/x',
      sendMessage: async (chat, text, opts) => sent.push({ chat, text, opts }),
      answerCallbackQuery: async () => {},
      sendChatAction: async () => {},
    };
    const held = [];
    const flow = docs.createDocumentFlow({
      bot, ledger,
      fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
      extract: extract || (async () => ({ kind: 'pdf', text: 'Shartnoma matni', pages: 4, chars: 15000 })),
      getAnalyzer: () => async () => (analysis ? { analysis } : { raw: 'x', parseError: true }),
      identityOf: async () => ({ telegramUserId: 77, adminId: 5 }),
      holdForLawyer: async (chat, file) => held.push(file),
    });
    return { flow, sent, ledger, held };
  }
  const docMsg = { chat: { id: 77 }, from: { id: 77 }, document: { file_id: 'f', file_name: 'shartnoma.pdf', mime_type: 'application/pdf', file_size: 1000 } };
  const press = (data) => ({ id: 'q', data, from: { id: 77 }, message: { chat: { id: 77 } } });

  await test('Telegram document: a PDF is offered for AI analysis with its unit count, or the lawyer queue', async () => {
    const { flow, sent } = docFlow();
    assert.strictEqual(await flow.offer(docMsg), true);
    assert.match(sent[0].text, /4 bet/u);
    const kb = sent[0].opts.reply_markup.inline_keyboard[0].map(b => b.callback_data);
    assert.deepStrictEqual(kb, ['tgdoc_ai', 'tgdoc_lawyer']);
  });

  await test('Telegram document: AI analysis reserves analysis units, delivers, then commits', async () => {
    const { flow, sent, ledger } = docFlow();
    await flow.offer(docMsg);
    assert.strictEqual(await flow.onCallback(press('tgdoc_ai')), true);
    assert.strictEqual(ledger.calls[0][0], 'reserve');
    assert.strictEqual(ledger.calls[0][1].service, 'analysis');
    assert.strictEqual(ledger.calls[0][1].channel, 'telegram');
    assert.deepStrictEqual(ledger.calls[1], ['commit', 'k1']);
    assert.ok(sent.some(m => /AI tahlili/u.test(m.text) && /3\.1/u.test(m.text) && /lex\.uz matni bilan avtomatik tekshirilmagan/u.test(m.text)));
  });

  await test('Telegram document: a failed analysis releases the units; no units -> lawyer option stays', async () => {
    const a = docFlow({ analysis: null });
    await a.flow.offer(docMsg);
    await a.flow.onCallback(press('tgdoc_ai'));
    assert.deepStrictEqual(a.ledger.calls.map(c => c[0]), ['reserve', 'release']);
    assert.ok(a.sent.some(m => /limitingiz qaytarildi/u.test(m.text)));

    const b = docFlow({ allowed: false });
    await b.flow.offer(docMsg);
    await b.flow.onCallback(press('tgdoc_ai'));
    assert.ok(b.sent.some(m => /yetarli emas/u.test(m.text)));
    await b.flow.onCallback(press('tgdoc_lawyer'));
    assert.strictEqual(b.held.length, 1);
  });

  await test('Telegram document: scans and unsupported files go to the lawyer queue as before', async () => {
    const { flow } = docFlow({ extract: async () => ({ kind: 'pdf', text: '', pages: 3, chars: 0, scanned: true }) });
    assert.strictEqual(await flow.offer(docMsg), false);
    assert.strictEqual(await docFlow().flow.offer({ ...docMsg, document: { file_id: 'f', file_name: 'rasm.jpg', mime_type: 'image/jpeg' } }), false);
    assert.strictEqual(docs.splitPlain('a\n'.repeat(5000), 3900).every(p => p.length <= 3900), true);
  });

  const { appendTelegramTurn, tashkentDay } = require('../src/services/telegram-history');

  await test('history: a linked account\'s bot Q&A lands in one web chat per Tashkent day', async () => {
    const db = fakeDb([[/SELECT id FROM ai_chat_sessions/u, () => []], [/INSERT INTO ai_chat_sessions/u, () => [{ id: 42 }]]]);
    const id = await appendTelegramTurn(db, { adminId: 5, question: 'Savol?', answer: 'Javob.', now: new Date('2026-10-20T20:30:00Z') });
    assert.strictEqual(id, 42);
    const ins = db.log.find(x => /INSERT/u.test(x.sql));
    assert.strictEqual(ins.params[1], 'Telegram · 21.10.2026', 'Tashkent day, not UTC');
    assert.deepStrictEqual(JSON.parse(ins.params[3]).map(m => m.role), ['user', 'model']);
    assert.strictEqual(await appendTelegramTurn(db, { adminId: null, question: 'a', answer: 'b' }), null);
    assert.strictEqual(tashkentDay(new Date('2026-01-01T00:00:00Z')), '01.01.2026');
  });

  const { createWorkspaceTelegramNotifier } = require('../src/workspace/telegram-notify');

  await test('Workspace: a status change messages assignees, watchers and creator, never the person who changed it', async () => {
    const sent = [];
    const db = fakeDb([
      [/FROM workspace_tasks t JOIN workspaces/u, () => [{ title: 'Da’vo arizasi', created_by: 1, workspace: 'Firma' }]],
      [/workspace_task_assignees WHERE/u, () => [{ user_id: 2 }, { user_id: 3 }]],
      [/FROM admins WHERE id = ANY/u, ([ids]) => ids.map(id => ({ id, chat: id === 3 ? null : 1000 + id }))],
    ]);
    const n = createWorkspaceTelegramNotifier({ pool: db, send: async (chat, text) => sent.push({ chat, text }) });
    const count = await n.taskStatusChanged({ workspaceId: 'w', taskId: 't', oldStatus: 'in_progress', newStatus: 'done', actorId: 2 });
    assert.strictEqual(count, 1);
    assert.deepStrictEqual(sent.map(m => m.chat), [1001], 'creator only: the actor is skipped, an unlinked member gets nothing');
    assert.match(sent[0].text, /Jarayonda → Bajarildi/u);
    assert.strictEqual(await n.taskStatusChanged({ workspaceId: 'w', taskId: 't', oldStatus: 'done', newStatus: 'done', actorId: 2 }), 0);
  });

  await test('Workspace: a deadline reminder goes once per task, person and due date', async () => {
    const sent = [], claimed = new Set();
    const db = fakeDb([
      [/CREATE TABLE IF NOT EXISTS workspace_telegram_reminders/u, () => []],
      [/FROM workspace_tasks t\s+JOIN workspaces/u, () => [{ id: 't1', title: 'Uchrashuv', due: '2026-10-21', created_by: 1, workspace: 'Firma', assignees: [2] }]],
      [/FROM admins WHERE id = ANY/u, ([ids]) => ids.map(id => ({ id, chat: 2000 + id }))],
      [/INSERT INTO workspace_telegram_reminders/u, ([task, user, due]) => { const k = `${task}:${user}:${due}`; if (claimed.has(k)) return []; claimed.add(k); return [{ task_id: task }]; }],
    ]);
    const n = createWorkspaceTelegramNotifier({ pool: db, send: async (chat, text) => sent.push({ chat, text }) });
    const now = new Date('2026-10-20T06:00:00Z');
    assert.strictEqual(await n.sendDueReminders(now), 1);
    assert.strictEqual(await n.sendDueReminders(now), 0, 'not twice');
    assert.strictEqual(sent[0].chat, 2002);
    assert.match(sent[0].text, /Muddat ertaga \(21\.10\.2026\): Uchrashuv/u);
    process.env.WS_TELEGRAM_NOTIFY = 'off';
    assert.strictEqual(await n.sendDueReminders(now), 0);
    delete process.env.WS_TELEGRAM_NOTIFY;
    assert.match(read('src/workspace/routes.js'), /telegramNotifier\.taskStatusChanged/u);
  });

  await test('voice: analyze, balance and send-to-Telegram endpoints exist; the page has the Telegram button and no "X" minutes', () => {
    const server = read('src/api/server.js');
    assert.match(server, /app\.post\('\/api\/voice\/analyze'/u);
    assert.match(server, /app\.get\('\/api\/voice\/balance', requireAuth/u);
    assert.match(server, /app\.post\('\/api\/voice\/send-telegram', require\('\.\.\/auth\/same-origin'\)\.requireSameOrigin, requireAuth/u);
    const voice = read('public/app/voice.js');
    assert.match(voice, /\/api\/voice\/send-telegram/u);
    assert.match(voice, /silver: null, gold: null, platinum: null/u);
    assert.doesNotMatch(read('public/app/i18n.js'), /"X (so‘m|сум|UZS)"/u);
  });

  await test('landing copy: no promise the code does not keep (servers in Uzbekistan, API, daily updates, X minutes, team-scope skills)', () => {
    const ctx = { window: {} };
    vm.runInNewContext(read('public/js/i18n.js'), ctx);
    for (const lang of ['uz', 'ru', 'en']) {
      const all = JSON.stringify(ctx.window.I18N[lang]);
      assert.doesNotMatch(all, /O‘zbekistondagi server|Serverlar O‘zbekiston|серверах в Узбекистане|Серверы в Узбекистане|servers in Uzbekistan|Servers in Uzbekistan/u, lang);
      assert.doesNotMatch(all, /Workspace, API|Workspace, API/u, lang);
      assert.doesNotMatch(all, /\bX (daqiqa|минут|minutes)\b|X so‘m/u, lang);
      assert.doesNotMatch(all, /Kunlik yangilanish|Ежедневное обновление|Updated daily|har kuni yangilanadi|обновляется ежедневно/u, lang);
      assert.doesNotMatch(all, /chat o‘zi tanlaydi|Чат сам выбирает|The chat picks/u, lang);
      assert.doesNotMatch(all, /DOCX va DOC|DOCX и DOC|DOCX and DOC/u, lang);
      assert.ok(ctx.window.I18N[lang]['sk.lib'].length === 8, `${lang}: the 8 built-in skills`);
    }
    for (const page of ['index.html', 'tariflar.html', 'ru/index.html', 'en/index.html']) {
      assert.doesNotMatch(read(`public/${page}`), /O‘zbekistondagi serverlarda|серверах в Узбекистане|servers in Uzbekistan/u, page);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
