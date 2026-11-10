'use strict';

/**
 * Client portal P2 (docs/design/mijoz-portali.md §P2, src/matters/portal.js,
 * src/bot/telegram-portal.js): one conversation per matter between the
 * lawyer side and the clients. Sealed bodies; the lawyer side writes (a
 * Workspace viewer only reads), a client writes while the matter is open and
 * reads it for the closed matter's 30 days; a stranger, a removed client and
 * another matter's client get 404; length and rate limits; unread counts;
 * the other side is told (the bot: a lawyer's message with its text to the
 * clients, a client's to the lawyer side); account deletion replaces the
 * client's words. No AI.
 * The database part needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/matter-messages.db.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

(async () => {
  console.log('Client portal messages (P2)');

  await test('wiring: routes (writes same-origin), the access log for a staff reader, the bot button and the next-message mode; no AI', () => {
    const src = read('src', 'matters', 'portal.js');
    for (const r of ["app.get('/api/matters/:id/portal/messages', requireAuth", "app.post('/api/matters/:id/portal/messages', ...W", "app.get('/api/portal/:matterId/messages', requireAuth", "app.post('/api/portal/:matterId/messages', ...W"]) assert.ok(src.includes(r), r);
    assert.ok(src.includes("require('../privacy/access-log').note(pool, req, { table: 'matter_messages', owners: out.clientAuthors });"));
    assert.ok(!/callAI|callCheapAI|callOpenAI|getEmbedding/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
    const bot = read('src', 'bot', 'bot.js');
    assert.ok(bot.includes("/^mp[mdw]_[0-9a-f-]{36}$/.test(data)"));
    assert.ok(bot.includes('if (conv && conv.state === tp.MSG_STATE) {'));
    assert.ok(/tp\.MSG_STATE\) \{[\s\S]{0,400}tp\.msgWaiting\(conv\)[\s\S]{0,300}tp\.MSG_CANCEL\.test\(text\)/.test(bot), 'a stale mode is dropped; "bekor" leaves');
    assert.ok(bot.indexOf('tp.MSG_STATE) {') < bot.indexOf('// ── Autonomous agent: converse and answer without a human'), 'before the agent: never a question or an AI call');
  });

  if (!process.env.TEST_DATABASE_URL) {
    console.log('  (database part skipped: TEST_DATABASE_URL not set)');
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
  if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) { console.error('refusing to run against what looks like production'); process.exit(1); }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATA_KEYS = JSON.stringify({ t1: Buffer.alloc(32, 7).toString('base64') });
  process.env.DATA_KEY_ACTIVE = 't1';
  process.env.PORTAL_MSG_RATE = '5';
  const { pool } = require('../src/database/db');
  const { withWorkspaceTransaction } = require('../src/workspace/authz');
  const { createPortal, deleteAccountClientRows } = require('../src/matters/portal');
  const { createMatterStore } = require('../src/matters/store');
  const tp = require('../src/bot/telegram-portal');
  const told = [];
  const portal = createPortal({ db: pool, notify: (id, e) => told.push({ id, ...e }) });
  const store = createMatterStore({ db: pool });
  const rnd = () => Math.floor(Math.random() * 1e9);
  const made = [];
  const mkUser = async (name, plan = 'silver', chat = null) => {
    const id = (await pool.query(`INSERT INTO admins (username, password, full_name, role, tariff_plan, tariff_expires_at, telegram_chat_id) VALUES ($1, 'x', $2, 'user', $3, now() + interval '1 day', $4) RETURNING id`,
      [`mm_${rnd()}`, name, plan, chat])).rows[0].id;
    made.push(id); return id;
  };
  const lawyer = await mkUser('Yurist Aliyev', 'silver', 900000000 + rnd() % 1000), viewer = await mkUser('Kuzatuvchi'), client = await mkUser('Mijoz Karimov', 'free', 910000000 + rnd() % 1000), other = await mkUser('Begona', 'free');
  const ws = (await withWorkspaceTransaction(pool, lawyer, c => c.query(`INSERT INTO workspaces (name, slug, owner_id, created_by) VALUES ('Firma xabar', $1, $2, $2) RETURNING id`, [`mm-${rnd()}`, lawyer]))).rows[0].id;
  await withWorkspaceTransaction(pool, lawyer, c => c.query(`INSERT INTO workspace_members (workspace_id, user_id, role, invited_by) VALUES ($1, $2, 'viewer', $3)`, [ws, viewer, lawyer]));
  const matter = await store.create(lawyer, { title: 'Ijara nizosi', workspaceId: ws });
  const second = await store.create(lawyer, { title: 'Boshqa ish' });
  await portal.accept((await portal.invite(matter.id, lawyer, {})).token, client);

  try {
    await test('the lawyer writes, the client reads; the body is sealed in the database; the client is told', async () => {
      const m = await portal.sendMessage(matter.id, lawyer, 'lawyer', { text: '  Pasport nusxasini yuboring.  ' });
      const row = (await pool.query('SELECT body, side, source FROM matter_messages WHERE id = $1', [m.id])).rows[0];
      assert.ok(row.body.startsWith('enc:') && !row.body.includes('Pasport'), 'sealed');
      assert.deepStrictEqual([row.side, row.source], ['lawyer', 'web']);
      const conv = await portal.messages(matter.id, client, 'client');
      assert.deepStrictEqual(conv.messages.map(x => [x.side, x.mine, x.author, x.text]), [['lawyer', false, 'Yurist Aliyev', 'Pasport nusxasini yuboring.']]);
      assert.deepStrictEqual(told.map(x => [x.kind, x.side, x.text]), [['message', 'lawyer', 'Pasport nusxasini yuboring.']]);
    });
    await test('the client answers (also from the bot); unread counts for the other side; reading marks it read', async () => {
      assert.deepStrictEqual(await portal.unread(client, 'client'), {}, 'the client read it above');
      await portal.sendMessage(matter.id, client, 'client', { text: 'Yubordim.' });
      await tp.sendFromBot(pool, client, matter.id, 'Yana bitta savol', { notify: (id, e) => told.push({ id, ...e }) });
      assert.deepStrictEqual(await portal.unread(lawyer, 'lawyer', [matter.id, second.id]), { [matter.id]: 2 });
      assert.strictEqual((await portal.panel(matter.id, lawyer)).unread, 2);
      const conv = await portal.messages(matter.id, lawyer, 'lawyer');
      assert.deepStrictEqual(conv.messages.map(x => [x.side, x.source]), [['lawyer', 'web'], ['client', 'web'], ['client', 'telegram']]);
      assert.deepStrictEqual(conv.clientAuthors, [client, client], 'whose words a staff reader saw');
      assert.deepStrictEqual(await portal.unread(lawyer, 'lawyer', [matter.id]), {});
      assert.strictEqual(told.filter(x => x.side === 'client').length, 2);
    });
    await test('who may: a viewer reads but cannot write; a stranger, another matter and a removed client get 404', async () => {
      assert.ok((await portal.messages(matter.id, viewer, 'lawyer')).messages.length === 3);
      await assert.rejects(portal.sendMessage(matter.id, viewer, 'lawyer', { text: 'x' }), e => e.status === 404);
      await assert.rejects(portal.messages(matter.id, other, 'client'), e => e.status === 404);
      await assert.rejects(portal.messages(matter.id, other, 'lawyer'), e => e.status === 404);
      await assert.rejects(portal.messages(second.id, client, 'client'), e => e.status === 404);
      await assert.rejects(portal.sendMessage(matter.id, client, 'lawyer', { text: 'x' }), e => e.status === 404, 'a client is not the lawyer side');
      assert.deepStrictEqual(await tp.startMessage(pool, other, matter.id), { ok: false });
      assert.deepStrictEqual((await tp.startMessage(pool, client, matter.id)).ok, true);
    });
    await test('limits: empty, too long and too many are refused', async () => {
      await assert.rejects(portal.sendMessage(matter.id, client, 'client', { text: '   ' }), e => e.status === 400);
      await assert.rejects(portal.sendMessage(matter.id, client, 'client', { text: 'x'.repeat(4001) }), e => e.status === 413);
      for (let i = 0; i < 3; i++) await portal.sendMessage(matter.id, client, 'client', { text: 'xabar ' + i });
      await assert.rejects(portal.sendMessage(matter.id, client, 'client', { text: 'yana' }), e => e.status === 429, 'rate');
    });
    await test('a closed matter: the client reads, cannot write; the bot\'s write button is not offered', async () => {
      await store.update(matter.id, lawyer, { status: 'closed' });
      assert.ok((await portal.messages(matter.id, client, 'client')).messages.length > 0);
      process.env.PORTAL_MSG_RATE = '100'; // the rate limit is read per call: here only the closed matter refuses
      await assert.rejects(portal.sendMessage(matter.id, client, 'client', { text: 'yopilgan' }), e => e.status === 409 && e.code === 'closed');
      assert.deepStrictEqual(await tp.startMessage(pool, client, matter.id), { ok: false });
      await store.update(matter.id, lawyer, { status: 'open' });
    });
    await test('the bot mode: waiting only for 30 minutes and only with a matter id', () => {
      const now = Date.now();
      assert.strictEqual(tp.msgWaiting({ state: tp.MSG_STATE, context: { since: now - 60e3, matterId: matter.id } }, now), true);
      assert.strictEqual(tp.msgWaiting({ state: tp.MSG_STATE, context: { since: now - 31 * 60e3, matterId: matter.id } }, now), false);
      assert.strictEqual(tp.msgWaiting({ state: tp.MSG_STATE, context: { since: now, matterId: 'x' } }, now), false);
      assert.ok(tp.MSG_CANCEL.test('bekor') && tp.MSG_CANCEL.test('Отмена') && !tp.MSG_CANCEL.test('bekor qilinadimi?'));
    });
    await test('the bot card shows the last messages and the write button; account deletion replaces the client\'s words', async () => {
      const card = await tp.matterCard(pool, client, matter.id, 'uz');
      assert.ok(card.text.includes('Yozishma:'));
      assert.ok(card.keyboard.inline_keyboard.some(row => row.some(b => b.callback_data === `mpw_${matter.id}`)));
      await deleteAccountClientRows(pool, client);
      const left = (await pool.query(`SELECT body FROM matter_messages WHERE matter_id = $1 AND side = 'client'`, [matter.id])).rows;
      assert.ok(left.length && left.every(r => r.body === '[xabar o‘chirilgan]'));
      const conv = await portal.messages(matter.id, lawyer, 'lawyer');
      assert.ok(conv.messages.some(x => x.side === 'lawyer' && x.text === 'Pasport nusxasini yuboring.'), 'the lawyer side stays');
    });
  } finally {
    await pool.query('DELETE FROM matters WHERE owner_id = ANY($1::int[])', [made]).catch(() => {});
    await pool.query('DELETE FROM workspaces WHERE id = $1', [ws]).catch(() => {});
    await pool.query('DELETE FROM admins WHERE id = ANY($1::int[])', [made]).catch(() => {});
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
