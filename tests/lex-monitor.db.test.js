'use strict';

/**
 * S4 monitoring (docs/design/sud-amaliyoti.md, src/monitor/): the acts an
 * open matter's chats link are watched; the first sight is no news; a newer
 * change note of a cited article, an act lex.uz shows repealed or a new Plenum
 * decision on that article is one Telegram digest a person a day, without the
 * matter's text, with a "🔕" button; the baseline moves only after a sent
 * message; a person's own switch stops it and turning it back on starts with
 * no backlog; lex.uz reads are bounded. No AI, no network (a fake page).
 * Needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/lex-monitor.db.test.js
 */

const assert = require('assert');
if (!process.env.TEST_DATABASE_URL) {
  console.log('lex monitor (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like production');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.LEX_MONITOR_PAUSE_MS = '0';
const { pool } = require('../src/database/db');
const { createMonitor, actsFromValues } = require('../src/monitor');
const citator = require('../src/citator/store');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const rnd = () => Math.floor(Math.random() * 1e9);
const LAW = 990000000 + (rnd() % 9000000);
const LAW2 = LAW + 1;
const PLENUM = LAW + 2;
const page = (date161, { repealed = false } = {}) => `<div id="divCont">
${repealed ? '<div class="ACT_TEXT lx_elem">Hujjat kuchini yoʻqotgan 01.11.2026</div>' : ''}
<div class="PUBLICATION_ORIGIN">(Qonunchilik maʼlumotlari milliy bazasi, 29.10.2022-y., 02/22/798/0972-son; ${date161}-y., 03/26/1180/0901-son)</div>
<div class="CLAUSE_DEFAULT lx_elem">161-modda. Mehnat shartnomasini bekor qilish</div>
<div class="CHANGES_ORIGINS lx_no_select"><div>(161-modda OʻRQ-1180-sonli Qonuni tahririda — Qonunchilik maʼlumotlari milliy bazasi, ${date161}-y., 03/26/1180/0901-son)</div></div>
</div>`;
const SECRET = 'Maxfiy: mijoz Karimovning ish beruvchisi bilan nizosi';
const DAY = 864e5;
const T0 = Date.parse('2026-11-03T06:00:00Z'); // 11:00 Tashkent

async function setCitator(id, date161, opts = {}) {
  const row = citator.rowOf(`https://lex.uz/docs/-${id}`, page(date161, opts), { title: "O'zbekiston Respublikasining Mehnat kodeksi", metadata: { is_active: !opts.repealed } });
  await citator.writeRow(pool, row);
}

(async () => {
  console.log('Lex monitoring (S4)');
  const owner = (await pool.query(`INSERT INTO admins (username, password, full_name, role, telegram_user_id) VALUES ($1, 'x', 'Sinov', 'user', $2) RETURNING id`, [`lm_${rnd()}`, 700000000 + (rnd() % 1e8)])).rows[0].id;
  const noTg = (await pool.query(`INSERT INTO admins (username, password, full_name, role) VALUES ($1, 'x', 'Sinov', 'user') RETURNING id`, [`lm_${rnd()}`])).rows[0].id;
  const matter = (await pool.query(`INSERT INTO matters (owner_id, title, summary) VALUES ($1, 'Ishdan bo''shatish nizosi', $2) RETURNING id`, [owner, SECRET])).rows[0].id;
  const closed = (await pool.query(`INSERT INTO matters (owner_id, title, status) VALUES ($1, 'Yopilgan ish', 'closed') RETURNING id`, [owner])).rows[0].id;
  const messages = [
    { role: 'user', text: SECRET },
    { role: 'model', text: `Mehnat kodeksining [161-moddasi](https://lex.uz/docs/-${LAW}#x) ...`, citator: [{ lexId: LAW, units: [{ n: '161' }] }] },
  ];
  const chat = (await pool.query(`INSERT INTO ai_chat_sessions (admin_id, title, messages, message_count) VALUES ($1, 'Suhbat', $2::jsonb, 2) RETURNING id`, [owner, JSON.stringify(messages)])).rows[0].id;
  for (const m of [matter, closed]) await pool.query(`INSERT INTO matter_items (matter_id, kind, ref_int, title, added_by) VALUES ($1, 'chat', $2, 'Suhbat', $3)`, [m, chat, owner]);
  const noTgMatter = (await pool.query(`INSERT INTO matters (owner_id, title) VALUES ($1, 'Telegramsiz ish') RETURNING id`, [noTg])).rows[0].id;
  await pool.query(`INSERT INTO matter_items (matter_id, kind, ref_int, title, added_by) VALUES ($1, 'chat', $2, 'Suhbat', $3)`, [noTgMatter, chat, noTg]);

  const sent = [];
  let pageDate = '15.10.2026';
  let reads = 0;
  const mon = createMonitor({ db: pool, send: async (chatId, text, opts) => { sent.push({ chatId, text, opts }); }, log: () => {},
    fetchDoc: async (url) => { reads += 1; return { title: "O'zbekiston Respublikasining Mehnat kodeksi", metadata: { is_active: true }, rawHtml: page(pageDate) }; } });
  const mine = () => sent.filter(s => String(s.chatId) !== '');

  await test('collect: the acts and articles linked in a chat\'s answers (citator and lex.uz links), never the question', () => {
    const acts = actsFromValues({ chats: [messages], results: [{ basis: [{ url: `https://lex.uz/docs/-${LAW2}` }] }] });
    assert.deepStrictEqual([...acts.get(LAW)], ['161']);
    assert.ok(acts.has(LAW2), 'an agent result\'s link');
    assert.strictEqual(acts.size, 2);
  });

  await test('first run: the act is read from lex.uz and becomes the baseline - no message; a closed matter and one without Telegram are not watched', async () => {
    const r = await mon.run({ now: T0 });
    assert.strictEqual(r.refresh.read, 1);
    assert.strictEqual(sent.length, 0);
    const w = (await pool.query('SELECT * FROM lex_monitor_watch WHERE lex_id = $1', [LAW])).rows;
    assert.strictEqual(w.length, 1);
    assert.strictEqual(w[0].matter_id, matter);
    assert.deepStrictEqual(w[0].units, ['161']);
    assert.deepStrictEqual(w[0].seen_units, { 161: '2026-10-15' });
  });

  await test('a newer change note of the cited article: one digest with the matter\'s title, the act, the date and the link - no text of the matter or chat', async () => {
    await setCitator(LAW, '02.11.2026');
    const r = await mon.run({ now: T0 + DAY });
    assert.strictEqual(r.refresh.read, 0, 'read less than 20 h ago: not read again');
    assert.strictEqual(r.sent, 1);
    const m = sent[0];
    assert.ok(/«Ishdan bo'shatish nizosi» ishi:/.test(m.text) && /Mehnat kodeksi, 161-modda: 02\.11\.2026 da o'zgartirilgan \(OʻRQ-1180\)/.test(m.text), m.text);
    assert.ok(m.text.includes(`https://lex.uz/docs/-${LAW}`));
    assert.ok(!m.text.includes('Karimov') && !m.text.includes('Maxfiy'), 'no matter or chat text');
    assert.ok(!m.text.includes('Yopilgan ish') && !m.text.includes('Telegramsiz'));
    assert.deepStrictEqual(m.opts.reply_markup.inline_keyboard[1][0].callback_data, 'lxm_off');
    assert.ok(/#\/ishlar\//.test(m.opts.reply_markup.inline_keyboard[0][0].url));
    const w = (await pool.query('SELECT seen_units FROM lex_monitor_watch WHERE matter_id = $1 AND lex_id = $2', [matter, LAW])).rows[0];
    assert.deepStrictEqual(w.seen_units, { 161: '2026-11-02' }, 'the baseline moved after the message');
  });

  await test('one digest a day: news later the same day waits for tomorrow, then comes once', async () => {
    await setCitator(LAW, '03.11.2026');
    const same = await mon.run({ now: T0 + DAY + 3600e3 });
    assert.strictEqual(same.sent, 0);
    assert.strictEqual(same.skippedToday, 1);
    const next = await mon.run({ now: T0 + 2 * DAY });
    assert.strictEqual(next.sent, 1);
    assert.ok(/03\.11\.2026 da o'zgartirilgan/.test(sent[sent.length - 1].text));
    const again = await mon.run({ now: T0 + 3 * DAY });
    assert.strictEqual(again.sent, 0, 'nothing new, nothing sent');
  });

  await test('a new Plenum decision on the watched article; lex.uz showing the act repealed', async () => {
    await pool.query(`INSERT INTO plenum_decisions (lex_id, lat_lex_id, court, number, adopted_on, title_lat, bands, fetched_at) VALUES ($1, $2, 'oliy', '99', '2026-11-01', 'Sinov qarori', 1, now() + interval '3 days')`, [PLENUM, -PLENUM]);
    await pool.query(`INSERT INTO plenum_bands (decision_id, lang, n, text, article_refs) VALUES ($1, 'lat', 4, '4. MK 161-moddasi qo''llanilishi', '[{"act":"MK","n":"161"}]'::jsonb)`, [PLENUM]);
    await setCitator(LAW, '03.11.2026', { repealed: true });
    const r = await mon.run({ now: Date.now() + 4 * DAY });
    assert.strictEqual(r.sent, 1);
    const text = sent[sent.length - 1].text;
    assert.ok(/kuchini yo'qotgan deb ko'rsatildi/.test(text), text);
    assert.ok(/yangi Plenum tushuntirishi — Oliy sud Plenumining 99-son qarori \(01\.11\.2026\), 4-band/.test(text), text);
  });

  await test('the person\'s switch: off -> nothing; on again -> the acts as they stand, no backlog; a failed send is retried the next run', async () => {
    await mon.setOff(owner, true);
    assert.strictEqual(await mon.isOff(owner), true);
    await setCitator(LAW, '10.11.2026', { repealed: true });
    const n = sent.length;
    const r = await mon.run({ now: Date.now() + 5 * DAY });
    assert.strictEqual(r.matters, 0);
    assert.strictEqual(sent.length, n);
    await mon.setOff(owner, false);
    const back = await mon.run({ now: Date.now() + 6 * DAY });
    assert.strictEqual(back.sent, 0, 'turning on again is a new baseline');
    await setCitator(LAW, '12.11.2026', { repealed: true });
    let fail = true;
    const flaky = createMonitor({ db: pool, log: () => {}, fetchDoc: async () => ({ metadata: {}, rawHtml: '' }),
      send: async (c, t) => { if (fail) throw new Error('telegram down'); sent.push({ chatId: c, text: t }); } });
    const f = await flaky.run({ now: Date.now() + 7 * DAY });
    assert.strictEqual(f.failed, 1);
    fail = false;
    const ok = await flaky.run({ now: Date.now() + 7 * DAY + 60e3 });
    assert.strictEqual(ok.sent, 1, 'the day is freed and the news kept');
  });

  await test('lex.uz reads are bounded (LEX_MONITOR_MAX_READS); LEX_MONITOR=off runs nothing', async () => {
    await pool.query('DELETE FROM act_citator WHERE lex_id = ANY($1::int[])', [[LAW, LAW2]]);
    const runRow = (await pool.query(`INSERT INTO agent_runs (admin_id, workflow, status, request_id, result) VALUES ($1, 'claim_draft', 'done', $3, $2::jsonb) RETURNING id`,
      [owner, JSON.stringify({ basis: [{ url: `https://lex.uz/docs/-${LAW2}` }] }), require("crypto").randomUUID()])).rows[0];
    await pool.query(`INSERT INTO matter_items (matter_id, kind, ref_uuid, title, added_by) VALUES ($1, 'agent_run', $2, 'Da''vo', $3)`, [matter, runRow.id, owner]);
    process.env.LEX_MONITOR_MAX_READS = '1';
    reads = 0;
    const r = await mon.run({ now: Date.now() + 8 * DAY });
    delete process.env.LEX_MONITOR_MAX_READS;
    assert.deepStrictEqual([r.refresh.read, r.refresh.skipped], [1, 1], 'two acts due, one read');
    process.env.LEX_MONITOR = 'off';
    const o = await mon.run({ now: Date.now() + 9 * DAY });
    delete process.env.LEX_MONITOR;
    assert.strictEqual(o.off, true);
  });

  // clean up
  await pool.query('DELETE FROM plenum_decisions WHERE lex_id = $1', [PLENUM]).catch(() => {});
  await pool.query('DELETE FROM act_citator WHERE lex_id = ANY($1::int[])', [[LAW, LAW2]]).catch(() => {});
  await pool.query('DELETE FROM agent_runs WHERE admin_id = $1', [owner]).catch(() => {});
  await pool.query('DELETE FROM matters WHERE owner_id = ANY($1::int[])', [[owner, noTg]]).catch(() => {});
  await pool.query('DELETE FROM ai_chat_sessions WHERE id = $1', [chat]).catch(() => {});
  await pool.query('DELETE FROM admins WHERE id = ANY($1::int[])', [[owner, noTg]]).catch(() => {});
  await pool.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
