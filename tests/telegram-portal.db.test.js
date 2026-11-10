'use strict';

/**
 * Client portal P1c (src/bot/telegram-portal.js): the client's matters in the
 * bot - the list, a matter's card (only what was marked for the client), a
 * shared document as a file, the invite opened in Telegram (an account made
 * from the Telegram identity), and one merged notice per change burst that
 * never carries a note's or document's text.
 * The database part needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

(async () => {
  console.log('Client portal in the bot (P1c)');
  await test('wiring: /start mpi_, the buttons, the ishlarim button, the notifier in the routes', () => {
    const bot = fs.readFileSync(path.join(__dirname, '../src/bot/bot.js'), 'utf8');
    assert.ok(bot.includes("if (/^mpi_/.test(param)) {") && bot.includes("data === 'mpl' || data === 'mpj_y' || data === 'mpj_n' || data === 'mpu_x' || /^mp[mdwu]_[0-9a-f-]{36}$/.test(data)"));
    assert.ok(bot.includes("agentResult.meta.portalCount > 0"));
    assert.ok(fs.readFileSync(path.join(__dirname, '../src/agents/telegram-agent.js'), 'utf8').includes("intent.command.action === 'list' && !out.confirm ? await require('../bot/telegram-portal').clientCount(pool, account.id)"));
    assert.ok(fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8').includes("notify: require('../bot/telegram-portal').createNotifier({ pool, getBot: () => require('../bot/bot').bot }).notify"));
    const src = fs.readFileSync(path.join(__dirname, '../src/bot/telegram-portal.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.ok(!/callAI|callCheapAI|callOpenAI/.test(src), 'no AI');
  });

  if (!process.env.TEST_DATABASE_URL) {
    console.log('  (database part skipped: TEST_DATABASE_URL not set)');
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
  if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) { console.error('refusing to run against what looks like production'); process.exit(1); }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATA_KEYS = JSON.stringify({ t1: Buffer.alloc(32, 8).toString('base64') });
  process.env.DATA_KEY_ACTIVE = 't1';
  const { pool } = require('../src/database/db');
  const tp = require('../src/bot/telegram-portal');
  const { createPortal } = require('../src/matters/portal');
  const { createMatterStore } = require('../src/matters/store');
  const scans = require('../src/ocr/scan-store');
  const rnd = () => Math.floor(Math.random() * 1e9);
  const made = [];
  const lawyer = (await pool.query(`INSERT INTO admins (username, password, full_name, role, tariff_plan, tariff_expires_at) VALUES ($1, 'x', 'Yurist Aliyev', 'user', 'silver', now() + interval '1 day') RETURNING id`, [`tp_${rnd()}`])).rows[0].id;
  made.push(lawyer);
  const sent = [];
  const fakeBot = { sendMessage: async (chat, text, opts) => { sent.push({ chat, text, opts }); } };
  const notifier = tp.createNotifier({ pool, getBot: () => fakeBot, delayMs: 60000 });
  const portal = createPortal({ db: pool, notify: notifier.notify });
  const store = createMatterStore({ db: pool });
  const matter = await store.create(lawyer, { title: 'Ijara nizosi', summary: 'ICHKI' });
  const other = await store.create(lawyer, { title: 'Boshqa ish' });
  const tgId = 700000000 + (rnd() % 1000000);
  const from = { id: tgId, first_name: 'Karim', last_name: 'Karimov', username: `karim${rnd()}` };

  let clientId;
  await test('the invite in Telegram: what joining means, then one tap makes the account and joins', async () => {
    const inv = await portal.invite(matter.id, lawyer, {});
    assert.ok(/^https:\/\/t\.me\/[A-Za-z0-9_]+\?start=mpi_[A-Za-z0-9_-]+$/.test(inv.botUrl) && inv.botUrl.endsWith(inv.token));
    const start = await tp.inviteStart(pool, { from, token: inv.token });
    assert.ok(start.text.includes('Yurist Aliyev') && start.text.includes('Ijara nizosi') && start.keyboard.inline_keyboard[0][0].callback_data === 'mpj_y');
    assert.ok(!JSON.stringify(start.keyboard).includes(inv.token), 'the token is never in a button');
    const out = await tp.inviteJoin(pool, { from, chatId: tgId });
    assert.ok(/qo'shildingiz/.test(out.text) && out.card && out.card.text.includes('Ijara nizosi'));
    clientId = (await pool.query('SELECT id, role, telegram_chat_id FROM admins WHERE telegram_user_id = $1', [tgId])).rows[0];
    assert.ok(clientId && clientId.role === 'user' && Number(clientId.telegram_chat_id) === tgId);
    made.push(clientId.id); clientId = clientId.id;
    assert.ok(/Vaqt tugadi/.test((await tp.inviteJoin(pool, { from, chatId: tgId })).text), 'the hold is used once');
    assert.ok(/eskirgan/.test((await tp.inviteStart(pool, { from, token: inv.token })).text), 'the link is used');
  });

  await test('the card: only what was marked; a document as a .txt file; another matter or item "not found"', async () => {
    await portal.setStage(matter.id, lawyer, 'waiting_client');
    await portal.addDeadline(matter.id, lawyer, { title: 'Pasport nusxasi', dueOn: '2026-11-20', clientVisible: true });
    await portal.addDeadline(matter.id, lawyer, { title: 'Ichki muddat', dueOn: '2026-11-25' });
    await portal.addItem(matter.id, lawyer, { kind: 'note', text: 'Shartnoma aslini olib keling.' });
    const scan = await scans.saveScan(pool, { adminId: lawyer, fileHash: require('crypto').createHash('sha256').update(String(rnd())).digest('hex'), kind: 'text', pages: 1, bytes: 100, text: 'Ijara shartnomasi: oylik 5 000 000 so\'m.', provider: 'text', name: 'Ijara.docx' });
    const doc = await portal.addItem(matter.id, lawyer, { kind: 'doc', scanId: scan.id || scan });
    const list = await tp.listReply(pool, clientId);
    assert.ok(list.text.includes('Ijara nizosi') && !list.text.includes('Boshqa ish') && list.keyboard.inline_keyboard[0][0].callback_data === `mpm_${matter.id}`);
    const card = await tp.matterCard(pool, clientId, matter.id);
    assert.ok(card.text.includes('▶ Sizdan kutilmoqda') && card.text.includes('Pasport nusxasi') && card.text.includes('Shartnoma aslini'));
    assert.ok(!card.text.includes('Ichki') && !card.text.includes('ICHKI'), 'never internal');
    assert.ok(card.keyboard.inline_keyboard.some(r => r[0].callback_data === `mpd_${doc.id}`));
    const f = await tp.documentFile(pool, clientId, doc.id);
    assert.ok(f.filename === 'Ijara.txt' && f.buffer.toString('utf8').includes('5 000 000'));
    assert.ok(/Topilmadi/.test((await tp.matterCard(pool, clientId, other.id)).text));
    assert.strictEqual(await tp.documentFile(pool, lawyer + 999999, doc.id), null, 'another account');
    assert.strictEqual(await tp.clientCount(pool, clientId), 1);
  });

  await test('notices: one merged message per burst to linked clients; no note or document text', async () => {
    assert.ok(notifier.pending.has(matter.id), 'the changes above are queued, not sent one by one');
    await notifier.flush(matter.id);
    assert.strictEqual(sent.length, 1);
    const m = sent[0];
    assert.strictEqual(String(m.chat), String(tgId));
    assert.ok(m.text.includes('Ijara nizosi') && m.text.includes('bosqich: Sizdan kutilmoqda') && m.text.includes('yuristdan yangi izoh') && m.text.includes('yangi hujjat: Ijara.docx') && m.text.includes('muddat: 20.11.2026'));
    assert.ok(!m.text.includes('Shartnoma aslini') && !m.text.includes('5 000 000') && !m.text.includes('Ichki'), 'no text, nothing hidden');
    assert.strictEqual(m.opts.reply_markup.inline_keyboard[0][0].callback_data, `mpm_${matter.id}`);
    // a removed client hears nothing
    await portal.removeClient(matter.id, clientId, lawyer);
    await portal.setStage(matter.id, lawyer, 'in_court');
    await notifier.flush(matter.id);
    assert.strictEqual(sent.length, 1);
  });

  await pool.query('DELETE FROM matters WHERE owner_id = $1', [lawyer]).catch(() => {});
  await pool.query('DELETE FROM document_scans WHERE admin_id = $1', [lawyer]).catch(() => {});
  await pool.query('DELETE FROM admins WHERE id = ANY($1::int[])', [made]).catch(() => {});
  await pool.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
