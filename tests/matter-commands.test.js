'use strict';

/**
 * Matters by voice or text (2026-10-28, src/matters/commands.js): the
 * phrases (uz / ru) and what is not a command (legal questions from the
 * test files: none may be taken for one), a matter found by its words, an
 * unknown or ambiguous name asked about, a note going to the matter last
 * worked in, closing confirmed once by its own account, and the Telegram
 * path (classifyDeterministicIntent -> ish_amal; the confirm buttons).
 * A stub matter store - no database.
 *
 *   node tests/matter-commands.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const c = require('../src/matters/commands');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

function stubStore(seed = []) {
  const matters = seed.map((m, i) => ({ id: `m${i + 1}`, status: 'open', access: 'write', items: 0, notes: [], ...m }));
  const calls = [];
  return {
    calls, matters,
    async list() { return matters.map(m => ({ id: m.id, title: m.title, status: m.status, access: m.access, items: m.notes.length })); },
    async create(adminId, { title }) { calls.push(['create', adminId, title]); const m = { id: `m${matters.length + 1}`, title, status: 'open', access: 'write', notes: [] }; matters.push(m); return { ...m }; },
    async addItem(id, adminId, { kind, note }) { calls.push(['note', id, note]); const m = matters.find(x => x.id === id); m.notes.unshift(note); return { id: 'i1', kind }; },
    async get(id) { const m = matters.find(x => x.id === id); return { ...m, summary: '', items: m.notes.map(n => ({ kind: 'note', note: n })) }; },
    async update(id, adminId, { status }) { calls.push(['update', id, adminId, status]); const m = matters.find(x => x.id === id); m.status = status; return { ...m }; },
  };
}

(async () => {
  console.log('matter commands');

  await test('phrases in Uzbek and Russian become commands; the user\'s own letters are kept for a title and a note', () => {
    const cases = [
      ['Ishlarim', { action: 'list' }],
      ["ishlarimni ko'rsat", { action: 'list' }],
      ['мои дела', { action: 'list' }],
      ['Yangi ish och: Pudratchi bilan nizo', { action: 'create', title: 'Pudratchi bilan nizo' }],
      ['новое дело: Аренда офиса', { action: 'create', title: 'Аренда офиса' }],
      ['Pudrat nizosi ishiga yozuv: Sud majlisi 12-noyabr.', { action: 'note', matter: 'pudrat nizosi', text: 'Sud majlisi 12-noyabr' }],
      ["Yozuv qo'sh: guvoh bilan gaplashildi", { action: 'note', matter: null, text: 'guvoh bilan gaplashildi' }],
      ['заметка в дело аренда: встреча в пятницу', { action: 'note', matter: 'аренда', text: 'встреча в пятницу' }],
      ['pudrat ishini yop', { action: 'close', matter: 'pudrat' }],
      ['Ishni yop', { action: 'close', matter: null }],
      ['закрой дело аренда', { action: 'close', matter: 'аренда' }],
      ['Pudrat nizosi ishini qayta och', { action: 'reopen', matter: 'pudrat nizosi' }],
      ['Yangi ish och.', { action: 'create', title: null }],
      ['Новое дело', { action: 'create', title: null }],
      ['pudrat ishi holati', { action: 'show', matter: 'pudrat' }],
    ];
    for (const [text, want] of cases) assert.deepStrictEqual(c.parseCommand(text), want, text);
  });

  await test('legal questions are not commands - none of the test files\' strings is taken for one', () => {
    for (const q of ['Pudratchi ishini bajarmadi, avansni qaytarmayapti', "Meni ishdan bo'shatishdi", "Ish beruvchi ish haqini to'lamayapti", 'Ishni yopish uchun qanday hujjat kerak?', 'x'.repeat(301)]) {
      assert.strictEqual(c.parseCommand(q), null, q.slice(0, 40));
    }
    const seen = new Set();
    for (const f of fs.readdirSync(__dirname)) {
      // the files that hold commands on purpose
      if (!f.endsWith('.js') || f === path.basename(__filename) || f === 'matters.db.test.js' || f === 'voice-glossary.db.test.js' || f === 'uz-alphabet.test.js') continue;
      for (const m of fs.readFileSync(path.join(__dirname, f), 'utf8').matchAll(/["'`]([^"'`\n]{12,300})["'`]/gu)) if (/\s/u.test(m[1])) seen.add(m[1]);
    }
    const hits = [...seen].filter(q => c.parseCommand(q));
    assert.ok(seen.size > 1000, `strings scanned: ${seen.size}`);
    assert.deepStrictEqual(hits, []);
  });

  await test('a matter is found by its words; an unknown name and two equal ones are asked about, never guessed', () => {
    const list = [{ id: 'a', title: 'Pudratchi bilan nizo', status: 'open', access: 'write' }, { id: 'b', title: 'Ijara shartnomasi', status: 'open', access: 'write' },
      { id: 'c', title: 'Pudrat avansi', status: 'open', access: 'write' }, { id: 'd', title: 'Boshqa firma ishi', status: 'open', access: 'read' }];
    assert.strictEqual(c.resolveMatter('ijara', list).matter.id, 'b');
    assert.strictEqual(c.resolveMatter('pudratchi nizo', list).matter.id, 'a');
    assert.deepStrictEqual(c.resolveMatter('pudrat', list).many.map(m => m.id).sort(), ['a', 'c']);
    assert.ok(c.resolveMatter('soliq', list).none);
    assert.ok(c.resolveMatter('boshqa firma', list).none, 'a read-only matter is not a target');
    assert.strictEqual(c.resolveMatter(null, list, { lastId: 'b' }).matter.id, 'b');
    assert.strictEqual(c.resolveMatter('oxirgi ish', list, { lastId: 'c' }).matter.id, 'c');
  });

  await test('run: create, list, a note to the matter last worked in, show; an unknown name lists the matters', async () => {
    const store = stubStore([{ title: 'Pudratchi bilan nizo' }, { title: 'Ijara shartnomasi' }]);
    const made = await c.runCommand({ action: 'create', title: 'Soliq tekshiruvi' }, { adminId: 7, store });
    assert.deepStrictEqual([made.action, made.reply], ['matter_created', '✅ Yangi ish ochildi: «Soliq tekshiruvi».']);
    const listed = await c.runCommand({ action: 'list' }, { adminId: 7, store });
    assert.match(listed.reply, /1\. Pudratchi bilan nizo[\s\S]*3\. Soliq tekshiruvi/u);
    const noted = await c.runCommand({ action: 'note', matter: null, text: 'Hujjatlar topshirildi' }, { adminId: 7, store, lastId: made.matterId });
    assert.deepStrictEqual(store.calls.pop(), ['note', made.matterId, 'Hujjatlar topshirildi']);
    assert.match(noted.reply, /Soliq tekshiruvi/u);
    const shown = await c.runCommand({ action: 'show', matter: 'soliq' }, { adminId: 7, store });
    assert.match(shown.reply, /Soliq tekshiruvi — ochiq, 1 ta element[\s\S]*Hujjatlar topshirildi/u);
    const unknown = await c.runCommand({ action: 'note', matter: 'mehnat', text: 'x' }, { adminId: 7, store });
    assert.match(unknown.reply, /«mehnat» degan ish topilmadi\. Ishlaringiz: «Pudratchi bilan nizo»/u);
    const ru = await c.runCommand({ action: 'list' }, { adminId: 7, store, lang: 'ru' });
    assert.match(ru.reply, /^Ваши открытые дела:/u);
  });

  await test('"yangi ish och" with no name asks for the name and opens nothing (2026-10-28, owner\'s screenshot)', async () => {
    const store = stubStore([]);
    const out = await c.runCommand({ action: 'create', title: null }, { adminId: 7, store });
    assert.deepStrictEqual([out.action, out.needsTitle], ['matter_needs_title', true]);
    assert.match(out.reply, /Ish nomi nima bo'lsin/u);
    assert.strictEqual(store.calls.length, 0);
    const src = fs.readFileSync(path.join(__dirname, '../src/agents/telegram-agent.js'), 'utf8');
    assert.match(src, /pendingMatterTitle\.set\(String\(chatId\), Date\.now\(\)\)/u, 'Telegram waits for the name');
    assert.match(src, /command: \{ action: 'create', title:/u, 'the next message becomes the name');
    const page = fs.readFileSync(path.join(__dirname, '../public/app/matters.js'), 'utf8');
    assert.match(page, /if \(d\.needsTitle\) \{ awaitingTitle = true;/u, 'the app takes the next words as the name');
  });

  await test('close: asked first; confirmed once, only by the same account; a cancel drops it; a stale token is refused', async () => {
    const store = stubStore([{ title: 'Pudratchi bilan nizo' }]);
    const ask = await c.runCommand({ action: 'close', matter: 'pudratchi' }, { adminId: 7, store });
    assert.strictEqual(ask.action, 'matter_confirm');
    assert.strictEqual(store.calls.length, 0, 'nothing closed yet');
    const other = await c.confirmCommand(ask.confirm.token, { adminId: 8, store });
    assert.strictEqual(other.action, 'matter_confirm_expired', "another account's confirmation does nothing");
    const ok = await c.confirmCommand(ask.confirm.token, { adminId: 7, store });
    assert.deepStrictEqual([ok.action, store.calls.pop()], ['matter_closed', ['update', 'm1', 7, 'closed']]);
    assert.strictEqual((await c.confirmCommand(ask.confirm.token, { adminId: 7, store })).action, 'matter_confirm_expired', 'used once');
    const again = await c.runCommand({ action: 'reopen', matter: 'pudratchi' }, { adminId: 7, store });
    c.cancelConfirm(again.confirm.token, 7);
    assert.strictEqual((await c.confirmCommand(again.confirm.token, { adminId: 7, store })).action, 'matter_confirm_expired');
    const late = await c.runCommand({ action: 'reopen', matter: 'pudratchi' }, { adminId: 7, store, now: 1000 });
    assert.strictEqual((await c.confirmCommand(late.confirm.token, { adminId: 7, store, now: 1000 + c.CONFIRM_TTL_MS + 1 })).action, 'matter_confirm_expired');
  });

  await test('Telegram: a command is the ish_amal intent (no AI), a legal question is not; MATTERS=off turns it off; the bot confirms with buttons', () => {
    const agent = require('../src/agents/telegram-agent');
    assert.deepStrictEqual(agent.classifyDeterministicIntent('Yangi ish och: Pudratchi bilan nizo'), { intent: 'ish_amal', command: { action: 'create', title: 'Pudratchi bilan nizo' }, missing: [] });
    assert.notStrictEqual((agent.classifyDeterministicIntent('Pudratchi ishini bajarmadi, avansni qaytarmayapti') || {}).intent, 'ish_amal');
    process.env.MATTERS = 'off';
    try { assert.strictEqual(agent.classifyDeterministicIntent('Ishlarim'), null); } finally { delete process.env.MATTERS; }
    const src = fs.readFileSync(path.join(__dirname, '../src/agents/telegram-agent.js'), 'utf8');
    assert.match(src, /intent\.intent === 'ish_amal' && intent\.command/u);
    assert.match(src, /getLinkedAccount\(pool, chatId/u, 'the linked account, whatever its role');
    const bot = fs.readFileSync(path.join(__dirname, '../src/bot/bot.js'), 'utf8');
    assert.match(bot, /callback_data: `mtc_y_\$\{agentResult\.meta\.token\}`/u);
    assert.match(bot, /data\.startsWith\('mtc_y_'\)[\s\S]{0,900}confirmCommand\(token, \{ adminId: account\.id/u);
  });

  await test('glossary: a mis-heard legal term is suggested, a known term or its suffixed form is not, a plain name is left alone', () => {
    const g = require('../src/voice/glossary');
    assert.deepStrictEqual(g.suggest("Yangi ish och: Qudratxo'ja bilan nizo"), [{ from: "Qudratxo'ja", to: 'Pudratchi' }]);
    assert.deepStrictEqual(g.suggest('Ijarachiga talabnama yuborildi'), [{ from: 'talabnama', to: 'talabnoma' }]);
    for (const t of ['Pudratchi bilan nizo', 'Pudratchidan avans qaytarilmadi', 'Karimov Aziz bilan mehnat shartnomasi', 'Abdullayev bilan uchrashuv', 'Shartnomani bekor qildik']) assert.deepStrictEqual(g.suggest(t), [], t);
    assert.strictEqual(g.apply("Qudratxo'ja bilan nizo", g.suggest("Qudratxo'ja bilan nizo")), 'Pudratchi bilan nizo');
  });

  await test('a spoken create is shown as heard and waits: as heard, as the glossary suggests, or as typed - once, by the same account', async () => {
    const g = require('../src/voice/glossary');
    const store = stubStore([]);
    const held = await c.runCommand({ action: 'create', title: "Qudratxo'ja bilan nizo" }, { adminId: 7, store, voice: true, suggest: t => g.suggest(t) });
    assert.strictEqual(held.action, 'matter_confirm');
    assert.strictEqual(store.calls.length, 0, 'nothing opened yet');
    assert.strictEqual(held.confirm.alt, 'Pudratchi bilan nizo');
    assert.match(held.reply, /Shunday eshitdim: yangi ish «Qudratxo'ja bilan nizo»[\s\S]*«Pudratchi» \(Qudratxo'ja\)/u);
    assert.strictEqual((await c.confirmCommand(held.confirm.token, { adminId: 8, store, alt: true })).action, 'matter_confirm_expired');
    const ok = await c.confirmCommand(held.confirm.token, { adminId: 7, store, alt: true });
    assert.deepStrictEqual([ok.action, store.calls.pop()], ['matter_created', ['create', 7, 'Pudratchi bilan nizo']]);
    const asHeard = await c.runCommand({ action: 'create', title: "Qudratxo'ja bilan nizo" }, { adminId: 7, store, voice: true, suggest: t => g.suggest(t) });
    await c.confirmCommand(asHeard.confirm.token, { adminId: 7, store });
    assert.deepStrictEqual(store.calls.pop(), ['create', 7, "Qudratxo'ja bilan nizo"], 'a real name stays as said when the person says so');
    const typed = await c.runCommand({ action: 'create', title: 'Pudrachi bilan nizo' }, { adminId: 7, store, voice: true, suggest: t => g.suggest(t) });
    assert.ok(c.pendingWrite(typed.confirm.token, 7));
    assert.strictEqual(await c.correctPending(typed.confirm.token, 'Alfa Qurilish bilan nizo', { adminId: 8, store }), null, "another account's correction does nothing");
    const fixed = await c.correctPending(typed.confirm.token, ' Alfa Qurilish bilan nizo. ', { adminId: 7, store });
    assert.deepStrictEqual([fixed.action, store.calls.pop()], ['matter_created', ['create', 7, 'Alfa Qurilish bilan nizo']]);
    assert.strictEqual(await c.correctPending(typed.confirm.token, 'x y', { adminId: 7, store }), null, 'used once');
    const typedCmd = await c.runCommand({ action: 'create', title: 'Soliq tekshiruvi' }, { adminId: 7, store });
    assert.strictEqual(typedCmd.action, 'matter_created', 'a typed command runs at once, as before');
  });

  await test('a spoken note waits too; confirmed it lands in that matter', async () => {
    const store = stubStore([{ title: 'Pudratchi bilan nizo' }]);
    const held = await c.runCommand({ action: 'note', matter: 'pudratchi', text: 'Sud majlisi 12-noyabr' }, { adminId: 7, store, voice: true });
    assert.deepStrictEqual([held.action, held.confirm.alt, store.calls.length], ['matter_confirm', null, 0]);
    assert.match(held.reply, /«Pudratchi bilan nizo» ishiga yozuv shunday eshitildi: «Sud majlisi 12-noyabr»/u);
    const ok = await c.confirmCommand(held.confirm.token, { adminId: 7, store });
    assert.deepStrictEqual([ok.action, store.calls.pop()], ['matter_noted', ['note', 'm1', 'Sud majlisi 12-noyabr']]);
  });

  await test('voice wiring: the bot passes the voice flag and offers "as suggested"; the app never runs a dictated command by itself; dictation returns suggestions', () => {
    const agent = fs.readFileSync(path.join(__dirname, '../src/agents/telegram-agent.js'), 'utf8');
    assert.match(agent, /voice: !!voice, suggest:/u);
    assert.match(agent, /pendingVoiceWrite\.set\(String\(chatId\)/u);
    assert.match(agent, /!\/\\\?\/u\.test\(q\)/u, 'a question is never taken for a correction');
    const bot = fs.readFileSync(path.join(__dirname, '../src/bot/bot.js'), 'utf8');
    assert.match(bot, /voice: !!requestData\.voiceTranscribed/u);
    assert.match(bot, /callback_data: `mtc_a_\$\{agentResult\.meta\.token\}`/u);
    assert.match(bot, /alt: data\.startsWith\('mtc_a_'\)/u);
    const page = fs.readFileSync(path.join(__dirname, '../public/app/matters.js'), 'utf8');
    const onstop = page.slice(page.indexOf('rec.onstop'), page.indexOf('rec.start()'));
    assert.ok(/heardCheck\(/u.test(onstop) && !/run\(input\.value\)/u.test(onstop), 'the dictated text waits in the box');
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.match(server, /userGlossary\.suggest\(req\.session\.adminId, text/u, "the caller's own glossary");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
