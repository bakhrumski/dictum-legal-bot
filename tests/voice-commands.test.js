'use strict';

/**
 * Voice commands level 2 - V1 (docs/design/ovozli-buyruqlar-2.md): one
 * catalogue with no AI. Pages open (both Latin alphabets and Russian); the
 * matter commands pass through unchanged; payments, deletion and sending are
 * blocked to "open the page"; in the chat only a spoken text is a command;
 * no string in the tests (questions, answers, documents) and no question of
 * the evaluation sets is taken for a command; a command runs only by its
 * token - once, for that account, within 10 minutes.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vc = require('../src/voice/commands');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const V = { place: 'chat', voice: true };

(async () => {
  console.log('voice commands (V1)');

  await test('pages open from uz (old and 2026 alphabet) and ru phrases', () => {
    const cases = [
      ['Hujjatlarim', 'documents', '/hujjatlarim'], ["Hujjatlarimni och.", 'documents'], ['Hujjatlarimni oç', 'documents'], ['мои документы', 'documents'],
      ['ishlarim', 'matters', '/ishlar'], ['Мои дела', 'matters'],
      ['Hujjat tahlili', 'analysis', '/tahlil'], ['hujjatni tahlil qil', 'analysis'],
      ["Da'vo arizasi tayyorla", 'draft_claim', '/tayyorlash?type=claim'], ['shartnoma tayyorla', 'draft', '/tayyorlash'], ['составь договор', 'draft'],
      ['jadvalli tahlil', 'tabular', '/jadval'], ['playbook', 'playbook', '/playbook'],
      ['Yangi suhbat', 'new_chat', '/'], ['yangi suhbat boşla', 'new_chat'], ['новый чат', 'new_chat'],
      ['oxirgi suhbatni och', 'last_chat', null], ['suhbatlarim', 'chats', '/suhbatlar'],
      ['yozuvlarim', 'recordings', '/yozuvlar'], ['yangi yozuv boshla', 'new_recording', '/yozuvlar/yangi'],
      ['jamoa', 'team', '/jamoa'], ['advokatlar ro\'yxati', 'attorneys', '/advokatlar'],
      ['limitim qancha', 'limit', '/hisob'], ['tariflar', 'plans'], ['Moslaşiş', 'adaptive', '/moslashish'], ['настройки', 'adaptive'],
    ];
    for (const [text, action, route] of cases) {
      const c = vc.parse(text, V);
      assert.ok(c && c.kind === 'open' && c.action === action, `${text} -> ${JSON.stringify(c)}`);
      if (route !== undefined) assert.strictEqual(c.route, route, text);
    }
    assert.strictEqual(vc.parse('tariflar', V).href, '/tariflar.html');
    assert.match(vc.parse('мои документы', V).label, /^Открыть/u);
  });

  await test('the matter commands pass through unchanged, with a label', () => {
    const c = vc.parse('yangi ish och: Pudratchi bilan nizo', V);
    assert.deepStrictEqual([c.kind, c.action, c.args.title], ['matter', 'create', 'Pudratchi bilan nizo']);
    assert.match(c.label, /Yangi ish: «Pudratchi bilan nizo»/u);
    assert.strictEqual(vc.parse('ijara ishini yop', V).action, 'close');
  });

  await test('payments, deletion and sending are blocked: only the page is offered', () => {
    for (const [text, action] of [["akkauntimni o'chir", 'delete_account'], ["hujjatlarimni o'chir", 'delete_documents'], ["suhbatlarni o'chir", 'delete_chats'],
      ['tarifni sotib ol', 'pay'], ['gold ula', 'pay'], ['купить тариф', 'pay'], ['telegramga yubor', 'send'], ['удалить аккаунт', 'delete_account']]) {
      const c = vc.parse(text, V);
      assert.ok(c && c.kind === 'blocked' && c.action === action, `${text} -> ${JSON.stringify(c)}`);
      assert.match(c.label, /bajarilmaydi|не выполняется/u);
    }
  });

  await test('in the chat a typed text is a question; in the command bar it is a command', () => {
    assert.strictEqual(vc.parse('hujjatlarim', { place: 'chat', voice: false }), null);
    assert.strictEqual(vc.parse('hujjatlarim', { place: 'matters' }).action, 'documents');
  });

  await test('legal questions are not commands: no string of the tests and no evaluation question is taken for one', () => {
    const own = new Set([path.basename(__filename), 'matter-commands.test.js', 'matters.db.test.js', 'voice-glossary.db.test.js', 'uz-alphabet.test.js']);
    const seen = new Set();
    for (const f of fs.readdirSync(__dirname)) {
      if (!f.endsWith('.js') || own.has(f)) continue;
      for (const m of fs.readFileSync(path.join(__dirname, f), 'utf8').matchAll(/["'`]([^"'`\n]{6,300})["'`]/gu)) if (/\s/u.test(m[1])) seen.add(m[1]);
    }
    const sets = [['docs/quality/redaction-eval/cases.json', d => d.cases.map(c => c.question)], ['docs/quality/agent-eval/cases.json', d => d.cases.map(c => c.task)]];
    for (const [f, pick] of sets) for (const q of pick(JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')))) seen.add(q);
    for (const q of ["Hujjatlarimni qanday tasdiqlatsam bo'ladi?", 'Ijara shartnomasini bekor qilish tartibi', "Yangi suhbat boshlash uchun pul to'lash kerakmi?", 'Advokatlar palatasiga qanday shikoyat qilaman?',
      "Akkauntimni o'chirsam ma'lumotlarim qoladimi?", 'Tariflar qachon oshadi', 'Мой лимит закончился, что делать?']) seen.add(q);
    // strings that ARE commands on purpose elsewhere: the bot's account action "limitim qancha?" (account-tools
    // tests), and page names used as labels - saying a page's name opens it, which is the point
    const meant = new Set(['Limitim qancha?', 'limit ', 'Hujjat tahlili', 'Jadvalli tahlil']);
    const hits = [...seen].filter(q => !meant.has(q) && (vc.parse(q, { place: 'matters' }) || vc.parse(q, { place: 'telegram' }) || vc.parse(q, { place: 'chat', voice: true })));
    assert.ok(seen.size > 1000, `strings scanned: ${seen.size}`);
    assert.deepStrictEqual(hits, []);
  });

  await test('V4: actions on the open chat - in the chat only, spoken only', () => {
    const cases = [['javobni nusxala', 'copy_answer'], ['Javobni Word’ga yukla', 'word_answer'], ['javobni yuklab ol', 'word_answer'], ['скопируй ответ', 'copy_answer'],
      ['shu suhbatni Ijara nizosi ishiga biriktir', 'attach_matter'], ["suhbatni ishga qo'sh", 'attach_matter'], ['прикрепи чат к делу аренда', 'attach_matter'],
      ['shu hujjatni tahlil qil', 'analyze_doc'], ['проанализируй этот документ', 'analyze_doc']];
    for (const [text, action] of cases) {
      const c = vc.parse(text, V);
      assert.ok(c && c.kind === 'context' && c.action === action, `${text} -> ${JSON.stringify(c)}`);
    }
    assert.strictEqual(vc.parse('shu suhbatni Ijara nizosi ishiga biriktir', V).matter, 'ijara nizosi');
    assert.strictEqual(vc.parse('hujjatni tahlil qil', V).kind, 'open', 'without "shu" it is the page');
    assert.strictEqual(vc.parse('javobni nusxala', { place: 'matters' }), null, 'not in the command bar');
    assert.strictEqual(vc.parse('javobni nusxala', { place: 'chat', voice: false }), null, 'not typed');
  });

  await test('V4: attaching the chat writes only to the named open matter; otherwise the page picks', async () => {
    const added = [];
    const store = { list: async () => [{ id: 'a', title: 'Ijara nizosi', status: 'open', access: 'write' }, { id: 'b', title: 'Pudrat avansi', status: 'open', access: 'write' }, { id: 'c', title: 'Pudrat nizosi', status: 'open', access: 'write' }],
      addItem: async (id, admin, item) => { added.push([id, admin, item]); return { id: 'i1' }; } };
    let out = await vc.run(vc.issue(vc.parse('shu suhbatni Ijara nizosi ishiga biriktir', V), 7), { adminId: 7, store, context: { chatId: 42, title: 'Ijara savoli' } });
    assert.deepStrictEqual([out.matterId, added[0]], ['a', ['a', 7, { kind: 'chat', ref: 42, title: 'Ijara savoli' }]]);
    out = await vc.run(vc.issue(vc.parse('shu suhbatni pudrat ishiga biriktir', V), 7), { adminId: 7, store, context: { chatId: 42 } });
    assert.ok(out.needsPick && out.many.length === 2, 'two matches: the page asks');
    out = await vc.run(vc.issue(vc.parse("suhbatni ishga qo'sh", V), 7), { adminId: 7, store, context: { chatId: 42 } });
    assert.ok(out.needsPick, 'no name: the page asks');
    out = await vc.run(vc.issue(vc.parse('shu suhbatni Ijara nizosi ishiga biriktir', V), 7), { adminId: 7, store, context: {} });
    assert.ok(out.needsPick, 'no saved chat yet: the page saves and asks');
    assert.strictEqual(added.length, 1);
    assert.deepStrictEqual(await vc.run(vc.issue(vc.parse('javobni nusxala', V), 7), { adminId: 7 }), { ok: true, kind: 'context', action: 'copy_answer' });
  });

  await test('a command runs only by its token: once, for that account, within 10 minutes', async () => {
    const c = vc.parse('hujjatlarim', V);
    const t = vc.issue(c, 7, 1000);
    assert.strictEqual((await vc.run(t, { adminId: 8, now: 2000 })).error, 'gone', 'another account');
    const t2 = vc.issue(c, 7, 1000);
    assert.deepStrictEqual(await vc.run(t2, { adminId: 7, now: 2000 }), { ok: true, kind: 'open', action: 'documents', route: '/hujjatlarim', href: null });
    assert.strictEqual((await vc.run(t2, { adminId: 7, now: 2000 })).error, 'gone', 'once');
    const t3 = vc.issue(c, 7, 0);
    assert.strictEqual((await vc.run(t3, { adminId: 7, now: vc.TOKEN_TTL_MS + 1 })).error, 'gone', 'expired');
  });

  await test('"the last chat" opens the account\'s newest chat, or the list when there is none', async () => {
    const db = rows => ({ query: async (sql, args) => { assert.match(sql, /admin_id = \$1/u); assert.deepStrictEqual(args, [7]); return { rows }; } });
    const c = vc.parse('oxirgi suhbat', V);
    assert.strictEqual((await vc.run(vc.issue(c, 7), { adminId: 7, db: db([{ id: 42 }]) })).route, '/c/42');
    assert.strictEqual((await vc.run(vc.issue(c, 7), { adminId: 7, db: db([]) })).route, '/suhbatlar');
  });

  await test('a spoken matter command runs as spoken: a write waits for its own confirmation', async () => {
    let created = false;
    const store = { list: async () => [], create: async () => { created = true; return { id: 'x', title: 't' }; } };
    const c = vc.parse('yangi ish och: Ijara nizosi', V);
    const out = await vc.run(vc.issue(c, 7), { adminId: 7, store });
    assert.ok(out.ok && out.kind === 'matter');
    assert.strictEqual(created, false, 'not written by speaking');
    assert.ok(out.confirm || out.token || /confirm|heard/u.test(JSON.stringify(out)), JSON.stringify(out).slice(0, 200));
  });

  const ev = require('../src/voice/command-events');
  const fakeDb = () => { const rows = []; return { rows, query: async (sql, args) => { assert.match(sql, /voice_command_events/u); rows.push(args); return { rows: [] }; } }; };

  await test('V5 events: codes only - a bad code, an unknown place or VOICE_COMMAND_EVENTS=off writes nothing', async () => {
    const db = fakeDb();
    assert.strictEqual(await ev.record(db, { place: 'chat', kind: 'open', action: 'documents', outcome: 'shown', via: 'voice', lang: 'uz' }, {}), true);
    assert.deepStrictEqual(db.rows[0], ['chat', 'open', 'documents', 'shown', 'voice', 'uz']);
    for (const bad of [{ place: 'web', kind: 'open', action: 'x', outcome: 'run' }, { place: 'chat', kind: 'open', action: 'Hujjatlarim och', outcome: 'run' },
      { place: 'chat', kind: 'open', action: 'documents', outcome: 'clicked' }, null]) assert.strictEqual(await ev.record(db, bad, {}), false);
    assert.strictEqual(await ev.record(db, { place: 'chat', kind: 'open', action: 'documents', outcome: 'run' }, { VOICE_COMMAND_EVENTS: 'off' }), false);
    assert.strictEqual(db.rows.length, 1);
    // a failing table never stops a command
    assert.strictEqual(await ev.record({ query: async () => { throw new Error('relation "voice_command_events" does not exist'); } }, { place: 'chat', kind: 'open', action: 'documents', outcome: 'run' }, {}), false);
    const src = fs.readFileSync(path.join(__dirname, '../migrations/20261030_035_voice_command_events.sql'), 'utf8');
    assert.ok(!/admin_id|text\s+TEXT|user_id|chat_id/iu.test(src.replace(/--.*$/gmu, '')), 'no account and no text in the table');
  });

  await test('V5 summary: per place and action, spoken / typed, and how often a card was a question', async () => {
    const rows = [
      { place: 'chat', kind: 'open', action: 'documents', via: 'voice', outcome: 'shown', n: 8 }, { place: 'chat', kind: 'open', action: 'documents', via: 'voice', outcome: 'run', n: 5 },
      { place: 'chat', kind: 'open', action: 'documents', via: 'voice', outcome: 'as_question', n: 2 }, { place: 'chat', kind: 'open', action: 'documents', via: 'voice', outcome: 'cancel', n: 1 },
      { place: 'telegram', kind: 'open', action: 'documents', via: 'text', outcome: 'shown', n: 3 },
    ];
    const out = await ev.summary({ query: async (sql, args) => { assert.deepStrictEqual(args, [30]); return { rows }; } }, { days: 30 });
    const chat = out.items.find(x => x.place === 'chat');
    assert.deepStrictEqual([chat.shown, chat.voice, chat.run, chat.as_question, chat.cancel, chat.questionShare], [8, 8, 5, 2, 1, 0.25]);
    assert.deepStrictEqual([out.items.find(x => x.place === 'telegram').text, out.total.shown, out.days], [3, 11, 30]);
    assert.strictEqual((await ev.summary({ query: async (s, a) => { assert.deepStrictEqual(a, [90]); return { rows: [] }; } }, { days: 999 })).days, 90);
  });

  await test('V5 tokens: peek tells the event without using the token; drop removes it for that account only', async () => {
    const c = vc.parse('hujjatlarim', V);
    const t = vc.issue(c, 7, Date.now(), { place: 'chat', via: 'voice' });
    assert.deepStrictEqual(vc.peek(t, 7), { kind: 'open', action: 'documents', lang: 'uz', place: 'chat', via: 'voice' });
    assert.strictEqual(vc.peek(t, 8), null);
    vc.drop(t, 8);
    assert.ok(vc.peek(t, 7), 'another account cannot drop it');
    vc.drop(t, 7);
    assert.strictEqual(vc.peek(t, 7), null);
    const src = fs.readFileSync(path.join(__dirname, '../src/voice/command-routes.js'), 'utf8');
    assert.match(src, /outcome: 'shown'/u); assert.match(src, /'ask' : 'run'/u); assert.match(src, /\/api\/voice\/command\/event/u); assert.match(src, /requireMasterAdmin/u);
    const page = fs.readFileSync(path.join(__dirname, '../public/app/chat.js'), 'utf8');
    assert.match(page, /told\('cancel'\)/u); assert.match(page, /told\('as_question'\)/u);
  });

  await test('V5 Telegram: an app page, typed or spoken, is answered with its link; questions, matters and account actions keep their way', () => {
    const agent = require('../src/agents/telegram-agent');
    const it = agent.classifyDeterministicIntent('Hujjatlarimni och');
    assert.deepStrictEqual([it.intent, it.page.action, vc.appPath(it.page)], ['ilova_sahifa', 'documents', '/app/#/hujjatlarim']);
    assert.strictEqual(vc.appPath(agent.classifyDeterministicIntent('jadvalli tahlil').page), '/app/#/jadval');
    assert.strictEqual(vc.appPath(agent.classifyDeterministicIntent('мои документы').page), '/app/#/hujjatlarim');
    assert.strictEqual(vc.appPath(vc.parse('oxirgi suhbat', { place: 'telegram' })), '/app/#/suhbatlar');
    assert.strictEqual(vc.appPath(vc.parse('tariflar', { place: 'telegram' })), '/tariflar.html');
    const blocked = agent.classifyDeterministicIntent("hujjatlarimni o'chir");
    assert.deepStrictEqual([blocked.intent, blocked.page.kind], ['ilova_sahifa', 'blocked']);
    assert.strictEqual(agent.classifyDeterministicIntent('Ishlarim').intent, 'ish_amal', 'matters keep their own path');
    assert.strictEqual(agent.classifyDeterministicIntent('limitim qancha?').intent, 'hisob_amal', 'account actions keep theirs');
    assert.strictEqual(agent.classifyDeterministicIntent("Hujjatlarimni qanday tasdiqlatsam bo'ladi?"), null, 'a question is a question');
    assert.strictEqual(vc.parse('javobni nusxala', { place: 'telegram' }), null, 'chat actions are not in the bot');
    process.env.VOICE_COMMANDS = 'off';
    try { assert.strictEqual(agent.classifyDeterministicIntent('Hujjatlarimni och'), null); } finally { delete process.env.VOICE_COMMANDS; }
    const bot = fs.readFileSync(path.join(__dirname, '../src/bot/bot.js'), 'utf8');
    assert.match(bot, /action === 'tool_open_page'[\s\S]{0,200}url: agentResult\.meta\.url/u, 'one link button');
    const src = fs.readFileSync(path.join(__dirname, '../src/agents/telegram-agent.js'), 'utf8');
    assert.match(src, /place: 'telegram', kind: page\.kind, action: page\.action, outcome: 'shown'/u);
    assert.match(src, /place: 'telegram', kind: 'matter'/u);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
