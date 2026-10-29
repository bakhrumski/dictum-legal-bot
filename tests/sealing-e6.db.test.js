'use strict';

/**
 * Data protection E6 (2026-10-29, migration 033, docs/design/shifrlash-1-bosqich.md
 * §3.2, §9 answers 1 and 6): with DATA_KEYS set, a web chat's messages are
 * sealed and bound to their account, the list keeps a readable title with
 * identifiers hidden and a stored count, and a Telegram turn is appended by a
 * read-modify-write; the human queue's question and answer and the AI
 * analysis archive's question are sealed, with a blind index the staff
 * search uses - whole word roots, every word of the search, never part of a
 * word; plain rows from before still read and still match by ILIKE.
 * Needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/sealing-e6.db.test.js
 */

const assert = require('assert');
const crypto = require('crypto');
if (!process.env.TEST_DATABASE_URL) {
  console.log('sealing E6 (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like production');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATA_KEYS = JSON.stringify({ e6: crypto.randomBytes(32).toString('base64') });
const privacy = require('../src/privacy/crypto');
privacy.reload();
const { pool } = require('../src/database/db');
const bidx = require('../src/privacy/blind-index');
const rt = require('../src/privacy/request-text');
const chats = require('../src/privacy/chat-sessions');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const rnd = () => Math.floor(Math.random() * 1e9);
const SECRET = 'Aziz Karimov, pasport AA1234567';
const raw = async (sql, args) => JSON.stringify((await pool.query(sql, args)).rows);

(async () => {
  console.log('sealing E6 (db)');
  const admin = (await pool.query(`INSERT INTO admins (username, password, full_name, role) VALUES ($1, 'x', 'Sinov', 'user') RETURNING id`, [`e6_${Date.now()}_${rnd()}`])).rows[0].id;

  await test('blind index: roots meet across suffixes and both alphabets; nothing without keys', () => {
    assert.deepStrictEqual(bidx.queryTokens('shartnoma'), bidx.queryTokens('Şartnomaga'));
    const t = bidx.tokens('Ijara shartnomasini bekor qilish, 15 000 so‘m');
    for (const q of ['shartnoma', 'ijara bekor', '15']) assert.ok(bidx.queryTokens(q).every(x => t.includes(x)), q);
    assert.ok(!bidx.queryTokens('mehnat').every(x => t.includes(x)));
    assert.ok(!t.some(x => /shart|ijara/u.test(x)), 'hashes only, never the word');
    const keep = process.env.DATA_KEYS;
    delete process.env.DATA_KEYS; privacy.reload(); bidx.reset();
    assert.strictEqual(bidx.tokens('ijara'), null);
    process.env.DATA_KEYS = keep; privacy.reload(); bidx.reset();
  });

  await test('web chat: messages sealed to the account, the title readable without identifiers, the count stored', async () => {
    const msgs = [{ role: 'user', text: SECRET }, { role: 'model', text: 'Javob' }];
    const title = chats.listTitle(`Pasportim AA1234567 yo'qoldi`);
    assert.ok(!title.includes('AA1234567') && title.includes('[PASPORT_1]'), title);
    const id = (await pool.query(`INSERT INTO ai_chat_sessions (admin_id, title, databases, messages, message_count) VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
      [admin, title, ['lex.uz'], chats.sealMessages(msgs, admin), msgs.length])).rows[0].id;
    assert.ok(!(await raw('SELECT messages FROM ai_chat_sessions WHERE id = $1', [id])).includes('Karimov'));
    const row = (await pool.query('SELECT admin_id, messages FROM ai_chat_sessions WHERE id = $1', [id])).rows[0];
    assert.deepStrictEqual(chats.openRow(row).messages, msgs);
    assert.throws(() => chats.openMessages(row.messages, admin + 1), 'another account does not open it');
    // the list's own expression (server.js) on a sealed row
    const list = (await pool.query(`SELECT CASE WHEN jsonb_typeof(messages) = 'array' THEN messages->0->>'text' END AS first_message,
      COALESCE(message_count, CASE WHEN jsonb_typeof(messages) = 'array' THEN jsonb_array_length(messages) END, 0) AS message_count
      FROM ai_chat_sessions WHERE id = $1`, [id])).rows[0];
    assert.deepStrictEqual([list.first_message, list.message_count], [null, 2]);
  });

  await test('the bot\'s turn is appended to the day\'s web chat by a read-modify-write, still sealed', async () => {
    const { appendTelegramTurn } = require('../src/services/telegram-history');
    const at = new Date('2026-10-29T08:00:00Z');
    const id = await appendTelegramTurn(pool, { adminId: admin, question: SECRET, answer: 'Birinchi javob', now: at });
    const id2 = await appendTelegramTurn(pool, { adminId: admin, question: 'Ikkinchi savol', answer: 'Ikkinchi javob', now: at });
    assert.strictEqual(id, id2);
    const r = (await pool.query('SELECT admin_id, messages, message_count FROM ai_chat_sessions WHERE id = $1', [id])).rows[0];
    assert.ok(!JSON.stringify(r.messages).includes('Karimov'));
    assert.deepStrictEqual(chats.openRow(r).messages.map(m => m.text), [SECRET, 'Birinchi javob', 'Ikkinchi savol', 'Ikkinchi javob']);
    assert.strictEqual(r.message_count, 4);
  });

  let requestId;
  await test('the human queue: question and answer sealed to the request; search by the blind index', async () => {
    const user = (await pool.query(`INSERT INTO users (telegram_id, first_name) VALUES ($1, 'Mijoz') RETURNING id`, [800000000 + rnd() % 1e8])).rows[0].id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      requestId = (await client.query(`INSERT INTO requests (user_id, request_text, status) VALUES ($1, '', 'pending') RETURNING id`, [user])).rows[0].id;
      await rt.writeRequestText(client, requestId, `Ijara shartnomasi bo'yicha ${SECRET} qarz`);
      await client.query('COMMIT');
    } finally { client.release(); }
    await pool.query('UPDATE requests SET response_text = $2 WHERE id = $1', [requestId, rt.sealResponse(requestId, `Javob: ${SECRET}`)]);
    const r = await raw('SELECT request_text, response_text FROM requests WHERE id = $1', [requestId]);
    assert.ok(!r.includes('Karimov') && r.includes('enc:e6:'), r);
    const row = (await pool.query('SELECT id, request_text, response_text FROM requests WHERE id = $1', [requestId])).rows[0];
    const opened = rt.openRequest(row);
    assert.ok(opened.request_text.includes(SECRET) && opened.response_text === `Javob: ${SECRET}`);
    assert.throws(() => rt.openRequest({ ...row, id: requestId + 1 }), 'moved to another request: does not open');
    const find = async q => (await pool.query(`SELECT id FROM requests r WHERE ${rt.searchClause('r.request_text', 'r.request_bidx', '$1', '$2')} AND id = $3`,
      [`%${q}%`, bidx.queryTokens(q), requestId])).rows.length;
    assert.strictEqual(await find('shartnoma'), 1);
    assert.strictEqual(await find('ijara qarz'), 1);
    assert.strictEqual(await find('Karimov'), 1);
    assert.strictEqual(await find('mehnat'), 0);
    assert.strictEqual(await find('artnom'), 0, 'part of a word is not found');
    // a plain row from before still matches by ILIKE and reads as it is
    const plainId = (await pool.query(`INSERT INTO requests (user_id, request_text) VALUES ($1, 'eski ochiq savol mehnat') RETURNING id`, [user])).rows[0].id;
    assert.strictEqual((await pool.query(`SELECT id FROM requests r WHERE ${rt.searchClause('r.request_text', 'r.request_bidx', '$1', '$2')} AND id = $3`,
      ['%mehnat%', bidx.queryTokens('mehnat'), plainId])).rows.length, 1);
    assert.strictEqual(rt.openRequest({ id: plainId, request_text: 'eski ochiq savol mehnat' }).request_text, 'eski ochiq savol mehnat');
  });

  await test('the AI analysis archive: the question sealed to its author, found by the index', async () => {
    const text = `Mehnat shartnomasi ${SECRET}`;
    const id = (await pool.query(`INSERT INTO ai_analyses (request_id, admin_id, category, request_text, analysis_text, request_bidx) VALUES ($1, $2, 'x', $3, 'tahlil', $4) RETURNING id`,
      [requestId, admin, rt.sealAnalysis(admin, text), bidx.tokens(text)])).rows[0].id;
    const row = (await pool.query('SELECT id, admin_id, request_text FROM ai_analyses WHERE id = $1', [id])).rows[0];
    assert.ok(!row.request_text.includes('Karimov'));
    assert.strictEqual(rt.openAnalysis(row).request_text, text);
    assert.strictEqual((await pool.query(`SELECT id FROM ai_analyses aa WHERE ${rt.searchClause('aa.request_text', 'aa.request_bidx', '$1', '$2')} AND id = $3`,
      ['%mehnat%', bidx.queryTokens('mehnat shartnoma'), id])).rows.length, 1);
  });

  await test('the backfill seals plain rows of the queue and builds their index (dry run counts, --apply seals)', async () => {
    const { execFileSync } = require('child_process');
    const env = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL };
    const dry = execFileSync(process.execPath, ['scripts/seal-backfill.js', '--tables', 'requests'], { env, encoding: 'utf8' });
    assert.match(dry, /requests\.request_text: \d+ sealed, [1-9]\d* plain/u);
    execFileSync(process.execPath, ['scripts/seal-backfill.js', '--apply', '--tables', 'requests'], { env, encoding: 'utf8' });
    assert.ok(!dry.includes('ai_chat_sessions'), 'only the tables asked for');
    const plain = (await pool.query(`SELECT id, request_text, request_bidx FROM requests WHERE request_text = 'eski ochiq savol mehnat' OR request_bidx IS NOT NULL ORDER BY id DESC LIMIT 1`)).rows[0];
    assert.ok(plain.request_text.startsWith('enc:') && plain.request_bidx && plain.request_bidx.length);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})();
