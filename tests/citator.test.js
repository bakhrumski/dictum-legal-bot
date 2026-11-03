'use strict';

/**
 * S3 citator (docs/design/sud-amaliyoti.md): change notes read from a lex.uz
 * page, the row written in the background, the citator under an answer and
 * its Telegram warnings. No AI, no network, no database (a fake pool).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseChanges, unitOf } = require('../src/citator/changes');
const store = require('../src/citator/store');
const A = require('../src/citator/answer');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.stack}`); }
}

// the shape lex.uz pages have (2026-11-03, Labour Code -6257288)
const PAGE = `<div id="divCont">
<div class="ACT_TITLE lx_elem">Mehnat kodeksi</div>
<div class="PUBLICATION_ORIGIN">(Qonunchilik maʼlumotlari milliy bazasi, 29.10.2022-y., 02/22/798/0972-son; 12.04.2023-y., 03/23/829/0208-son; 15.10.2026-y., 03/26/1180/0901-son)</div>
<div class="CLAUSE_DEFAULT lx_elem">10-modda. Mehnat qonunchiligi</div>
<div class="CHANGES_ORIGINS lx_no_select"><label id="s1"></label><div name="-1" id="-1">(10-modda Oʻzbekiston Respublikasining 2026-yil 13-iyuldagi OʻRQ-1158-sonli Konstitutsiyaviy <a href="/docs/-8323797?ONDATE=25.07.2026 00#-8325027">Qonuniga </a>asosan ikkinchi qismi bilan toʻldirilgan — Qonunchilik maʼlumotlari milliy bazasi, 14.07.2026-y., 03/26/1158/0727-son.</div></div>
<div class="CLAUSE_DEFAULT lx_elem">161-modda. Mehnat shartnomasini bekor qilish</div>
<div class="CHANGES_ORIGINS lx_no_select"><div>(161-moddaning ikkinchi qismi Oʻzbekiston Respublikasining 2023-yil 11-apreldagi OʻRQ-829-sonli Qonuni tahririda — Qonunchilik maʼlumotlari milliy bazasi, 12.04.2023-y., 03/23/829/0208-son)</div></div>
<div class="CHANGES_ORIGINS lx_no_select"><div>(161-modda OʻRQ-1180-sonli Qonuni tahririda — Qonunchilik maʼlumotlari milliy bazasi, 15.10.2026-y., 03/26/1180/0901-son)</div></div>
<div class="CHANGES_ORIGINS lx_no_select"><div>(Oʻzbekiston Respublikasining Qonuni tahririda — sanasiz)</div></div>
</div>`;

const row = (o = {}) => ({ lex_id: 6257288, title: "O'zbekiston Respublikasining Mehnat kodeksi", in_force: true, status_label: null, last_change: '2026-10-15',
  units: { 161: { kind: 'modda', date: '2026-10-15', by: 'OʻRQ-1180', count: 2 }, 10: { kind: 'modda', date: '2026-07-14', by: 'OʻRQ-1158', count: 1 } },
  checked_at: '2026-11-02T10:00:00Z', ...o });
function fakeDb({ rows = [row()], copies = [], plenum = [] } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, args) => {
      calls.push(sql);
      if (/FROM act_citator/.test(sql)) return { rows };
      if (/FROM legal_chunks/.test(sql)) return { rows: copies };
      if (/FROM plenum_bands/.test(sql)) return { rows: plenum };
      if (/INSERT INTO act_citator/.test(sql)) { calls.push(args); return { rows: [] }; }
      return { rows: [] };
    },
  };
}
const NOW = Date.parse('2026-11-03T12:00:00Z');
const REPLY = "Mehnat kodeksining [161-moddasi](https://lex.uz/docs/-6257288#-1) ga ko'ra ish beruvchi ogohlantirishi shart.";
const liveChunk = { id: 'lex_live_0_6257288', source_type: 'lex_live', law_name: "O'zbekiston Respublikasining Mehnat kodeksi", source_url: 'https://lex.uz/docs/-6257288', article_numbers: ['161', '162'], chunk_text: '161-modda. Mehnat shartnomasini bekor qilish' };
const corpusChunk = { ...liveChunk, id: 77, source_type: 'law_text', source_url: 'https://lex.uz/docs/-6257288' };

(async () => {
  await test('changes: the last amending publication and each article\'s latest note, with its act; an unreadable note is counted', () => {
    const c = parseChanges(PAGE);
    assert.strictEqual(c.published, '2022-10-29');
    assert.strictEqual(c.lastChange, '2026-10-15');
    assert.strictEqual(c.changes, 2);
    assert.deepStrictEqual(c.units['10'], { kind: 'modda', date: '2026-07-14', by: 'OʻRQ-1158', count: 1 });
    assert.deepStrictEqual(c.units['161'], { kind: 'modda', date: '2026-10-15', by: 'OʻRQ-1180', count: 2 }, 'the latest of two notes');
    assert.strictEqual(c.unreadNotes, 1);
    assert.deepStrictEqual(parseChanges('<html></html>'), { lastChange: null, published: null, changes: 0, units: {}, unreadNotes: 0 });
  });

  await test('changes: units in Cyrillic, Russian and with a prime', () => {
    assert.deepStrictEqual(unitOf('(17-band VMQ-100-son qarori tahririda'), { n: '17', kind: 'band' });
    assert.deepStrictEqual(unitOf('(57¹-modda …'), { n: '57-1', kind: 'modda' });
    assert.deepStrictEqual(unitOf('(161-модда …'), { n: '161', kind: 'modda' });
    assert.deepStrictEqual(unitOf('(Статья 10 дополнена частью второй …'), { n: '10', kind: 'modda' });
    assert.deepStrictEqual(unitOf('(Пункт 17 в редакции …'), { n: '17', kind: 'band' });
    assert.strictEqual(unitOf('(Qonuni tahririda'), null);
    assert.strictEqual(parseChanges('<div class="CHANGES_ORIGINS"><div>(Статья 5 изложена — Национальная база данных законодательства, 01.02.2025 г., № 03/25)</div></div>').units['5'].date, '2025-02-01');
  });

  await test('store: a current page is one row (sign dropped); a historical edition or an ONDATE link is none', () => {
    const r = store.rowOf('https://lex.uz/docs/-6257288', PAGE, { title: 'Mehnat kodeksi', metadata: { is_active: true } });
    assert.strictEqual(r.lex_id, 6257288);
    assert.strictEqual(r.in_force, true);
    assert.strictEqual(r.last_change, '2026-10-15');
    assert.strictEqual(store.rowOf('https://lex.uz/docs/-6257288?ONDATE=01.01.2025', PAGE, {}), null);
    assert.strictEqual(store.rowOf('https://lex.uz/docs/-6257288', PAGE, { metadata: { snapshot_date: '01.01.2025' } }), null);
    const lost = store.rowOf('https://lex.uz/ru/docs/123', PAGE, { metadata: { is_active: false, status_label: 'Hujjat kuchini yoʻqotgan 20.01.2026', repealed_date: '20.01.2026' } });
    assert.ok(lost.in_force === false && lost.repealed_on === '2026-01-20' && /kuchini/.test(lost.status_label));
  });

  await test('store: the recorder writes in the background once per page per 30 min, never throws; CITATOR=off records nothing', async () => {
    store._forget();
    const db = fakeDb();
    const rec = store.createRecorder(db);
    rec('https://lex.uz/docs/-6257288', PAGE, { title: 'Mehnat kodeksi', metadata: { is_active: true } });
    rec('https://lex.uz/docs/6257288', PAGE, { title: 'Mehnat kodeksi', metadata: { is_active: true } });
    await new Promise(r => setImmediate(r));
    assert.strictEqual(db.calls.filter(c => typeof c === 'string' && /INSERT INTO act_citator/.test(c)).length, 1);
    const broken = { query: async () => { throw new Error('boom'); } };
    store.createRecorder(broken, { log: () => {} })('https://lex.uz/docs/-5', PAGE, {});
    process.env.CITATOR = 'off';
    const db2 = fakeDb();
    store.createRecorder(db2)('https://lex.uz/docs/-9', PAGE, {});
    delete process.env.CITATOR;
    await new Promise(r => setImmediate(r));
    assert.strictEqual(db2.calls.length, 0);
  });

  await test('answer: a linked act gets its status, the cited article\'s change (recent = warning) and, read live, no stale copy', async () => {
    const [c] = await A.citatorFor(fakeDb(), { reply: REPLY, chunks: [liveChunk], lang: 'uz', now: NOW });
    assert.strictEqual(c.status, 'in_force');
    assert.strictEqual(c.lastChange, '2026-10-15');
    assert.deepStrictEqual(c.units.map(u => [u.n, u.changed, u.by, u.recent]), [['161', '2026-10-15', 'OʻRQ-1180', true]], 'only the article the answer names');
    assert.deepStrictEqual(c.copy, { live: true, date: null, stale: false });
    assert.deepStrictEqual(c.warn, ['recent']);
  });

  await test('answer: a corpus copy read before the article changed is stale; an act lex.uz shows repealed warns; no row is "unchecked", never "in force"', async () => {
    const [stale] = await A.citatorFor(fakeDb({ copies: [{ source_url: corpusChunk.source_url, at: '2026-09-01T00:00:00Z' }] }), { reply: REPLY, chunks: [corpusChunk], now: NOW });
    assert.deepStrictEqual(stale.copy, { live: false, date: '2026-09-01', stale: true });
    assert.ok(stale.warn.includes('stale'));
    const [fresh] = await A.citatorFor(fakeDb({ copies: [{ source_url: corpusChunk.source_url, at: '2026-10-20T00:00:00Z' }] }), { reply: REPLY, chunks: [corpusChunk], now: NOW });
    assert.strictEqual(fresh.copy.stale, false);
    const [lost] = await A.citatorFor(fakeDb({ rows: [row({ in_force: false, status_label: 'Hujjat kuchini yoʻqotgan' })] }), { reply: REPLY, chunks: [liveChunk], now: NOW });
    assert.ok(lost.status === 'not_in_force' && lost.warn[0] === 'not_in_force');
    const [none] = await A.citatorFor(fakeDb({ rows: [] }), { reply: REPLY, chunks: [liveChunk], now: NOW });
    assert.ok(none.status === 'unchecked' && none.warn.length === 0 && none.units[0].changed === null);
    const [old] = await A.citatorFor(fakeDb(), { reply: REPLY, chunks: [liveChunk], now: Date.parse('2028-01-01') });
    assert.deepStrictEqual(old.warn, [], 'a change long ago is information, not a warning');
  });

  await test('answer: Plenum decisions naming that article of that code; nothing linked or a broken database -> []', async () => {
    const plenum = [{ decision_id: 6684613, n: 24, article_refs: [{ act: 'MK', n: '161' }], lex_id: 6684613, lat_lex_id: -6684613, ru_lex_id: 1, court: 'oliy', number: '26', adopted_on: '2023-11-20' },
      { decision_id: 9, n: 3, article_refs: [{ act: 'FK', n: '161' }], lex_id: 9, lat_lex_id: -9, court: 'oliy', number: '1', adopted_on: '2020-01-01' }];
    const [c] = await A.citatorFor(fakeDb({ plenum }), { reply: REPLY, chunks: [liveChunk], now: NOW });
    assert.deepStrictEqual(c.units[0].plenum, { count: 1, top: [{ name: 'Oliy sud Plenumining 26-son qarori (20.11.2023)', url: 'https://lex.uz/docs/-6684613', bands: [24] }] }, 'another code\'s article 161 is not counted');
    assert.deepStrictEqual(await A.citatorFor(fakeDb(), { reply: 'Havola yo\'q.', chunks: [liveChunk] }), []);
    const broken = { query: async () => { throw new Error('down'); } };
    const [b] = await A.citatorFor(broken, { reply: REPLY, chunks: [liveChunk], now: NOW });
    assert.strictEqual(b.status, 'unchecked');
  });

  await test('telegram: only warnings, short; none -> ""', async () => {
    const items = await A.citatorFor(fakeDb({ copies: [{ source_url: corpusChunk.source_url, at: '2026-09-01T00:00:00Z' }] }), { reply: REPLY, chunks: [corpusChunk], now: NOW });
    const uz = A.telegramNote(items, 'uz');
    assert.ok(/bizdagi matn 01\.09\.2026 holatida/.test(uz) && /161-modda: 15\.10\.2026 da o'zgartirilgan \(OʻRQ-1180\)/.test(uz), uz);
    assert.ok(/⚠ .*161-modda/.test(uz), 'after our copy: a warning');
    assert.ok(/наш текст от 01\.09\.2026/.test(A.telegramNote(items, 'ru')));
    const live = await A.citatorFor(fakeDb(), { reply: REPLY, chunks: [liveChunk], now: NOW });
    assert.ok(/^ℹ .*161-modda: 15\.10\.2026/.test(A.telegramNote(live, 'uz')), 'read as it stands: information');
    const calm = await A.citatorFor(fakeDb(), { reply: REPLY, chunks: [liveChunk], now: Date.parse('2028-01-01') });
    assert.strictEqual(A.telegramNote(calm, 'uz'), '');
  });

  await test('cited units: uz, Cyrillic and Russian forms', () => {
    assert.deepStrictEqual([...A.citedUnits('161-modda, 57¹-moddasi, 17-band, 5-модда, статья 333, п. 4')].sort(), ['161', '17', '333', '4', '5', '57-1'].sort());
  });

  await test('wiring: pages observed in fetch-lex, the web chat and Telegram get the citator, the app shows it beside each source; no AI', () => {
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.ok(server.includes("require('../rag/fetch-lex').setPageObserver(require('../citator/store').createRecorder(pool))"));
    assert.ok(/citatorFor\(pool, \{ reply: displayReply, chunks: ragChunks, lang: citationLanguage \}\)/.test(server) && /followUpQuestions,\n\s+citator,/.test(server));
    assert.ok(/citatorNote: async/.test(server));
    const fetchLex = fs.readFileSync(path.join(__dirname, '../src/rag/fetch-lex.js'), 'utf8');
    assert.strictEqual((fetchLex.match(/observePage\(/g) || []).length, 3, 'defined once, called for the page and the followed current version');
    const agent = fs.readFileSync(path.join(__dirname, '../src/agents/telegram-agent.js'), 'utf8');
    assert.ok(/D\.citatorNote\(finalText, chunks, lang\)/.test(agent));
    const chat = fs.readFileSync(path.join(__dirname, '../public/app/chat.js'), 'utf8');
    assert.ok(/citeLine\(data\.citator, s\.url\)/.test(chat) && /citator: d\.citator \|\| \[\]/.test(chat));
    for (const f of ['changes.js', 'store.js', 'answer.js']) {
      const src = fs.readFileSync(path.join(__dirname, '../src/citator', f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      assert.ok(!/callAI|callCheapAI|callOpenAI|httpGet|fetchLexDocument|fetch\(/.test(src), `${f}: no AI, no request`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
