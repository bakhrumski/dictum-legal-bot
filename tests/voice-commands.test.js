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
    const hits = [...seen].filter(q => !meant.has(q) && vc.parse(q, { place: 'matters' }));
    assert.ok(seen.size > 1000, `strings scanned: ${seen.size}`);
    assert.deepStrictEqual(hits, []);
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

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
