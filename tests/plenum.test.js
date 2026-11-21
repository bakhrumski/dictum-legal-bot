'use strict';

/**
 * Court practice S1 (docs/design/sud-amaliyoti.md, src/plenum/): a Plenum
 * decision read from its lex.uz page with no AI - header, bands, the
 * abbreviations it defines, the articles each band names (an unknown act is
 * null, never guessed), the three editions; the list pages by the site's
 * post-back; a sync run writes nothing in dry mode, skips an unchanged
 * decision and names what it could not read.
 *
 *   node tests/plenum.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const P = require('../src/plenum/parse');
const S = require('../src/plenum/source');
const { createPlenumSync, readEdition } = require('../src/plenum/sync');

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n   ', e.message); } }

// a lex.uz page as the site renders it (the parts the reader uses), one edition
function page({ header, title, lines, links = '' }) {
  const el = (cls, text, i) => `<div class="lx_elem ${cls}"><a id="e${i}">${text}</a></div>`;
  return `<html><body><div class="header">${header}</div>${links}<div id="divCont">${el('ACT_TITLE', title, 0)}` +
    lines.map((l, i) => el('ACT_TEXT', l, i + 1)).join('') + `</div>${' '.repeat(600)}</body></html>`;
}
const UZ = page({
  header: 'Ўзбекистон Республикаси Олий суди пленумининг қарори, 03.07.2026 йилдаги 19-сон',
  title: 'Даъвони таъминлаш чораларини кўришнинг айрим масалалари тўғрисида',
  links: `<div onclick="openUrl('/uz/docs/8346846')" title="На русском">Рус</div><div onclick="openUrl('/uz/docs/-8346794')" title="O'zbekcha">O’zb</div>`,
  lines: [
    'Қонунчилик ҳужжатларининг тўғри қўлланилишини таъминлаш мақсадида «Судлар тўғрисида»ги Ўзбекистон Республикаси Қонунининг 22-моддасига асосланиб, Олий суди Пленуми қарор қилади:',
    '1. Судларнинг эътибори Ўзбекистон Республикаси Фуқаролик процессуал кодекси (бундан буён матнда ФПК деб юритилади) ва Иқтисодий процессуал кодекси (бундан буён матнда ИПК деб юритилади) талабларига қаратилсин.',
    '2. ФПКнинг 101 ва 102-моддаларига кўра даъвони таъминлаш аризаси ўша куниёқ кўрилади. ИПКнинг 89¹-модда (89-модда прим 1)сида ҳам шундай.',
    '1) ариза ёзма бўлади;',
    '3. Конституциясига кўра (19-моддасининг биринчи қисми) ҳуқуқлар кафолатланади; “66, 67-моддаларида” деган сўзлар.',
  ],
});

(async () => {
  console.log('plenum S1');
  await test('header: court, date and number in the three scripts', () => {
    assert.deepStrictEqual(P.parseHeader('Ўзбекистон Республикаси Олий суди пленумининг қарори, 03.07.2026 йилдаги 19-сон'), { court: 'oliy', date: '2026-07-03', number: '19' });
    assert.deepStrictEqual(P.parseHeader('Oʻzbekiston Respublikasi Oliy xoʻjalik sudi plenumining qarori, 28.11.2014 yildagi 269-son'), { court: 'xojalik', date: '2014-11-28', number: '269' });
    assert.deepStrictEqual(P.parseHeader('Постановление Пленума Верховного суда Республики Узбекистан от 03.07.2026 г. № 19'), { court: 'oliy', date: '2026-07-03', number: '19' });
    assert.strictEqual(P.courtOf('Oliy sudi Plenumi va Oliy xoʻjalik sudi Plenumining qoʻshma qarori'), 'qoshma');
    assert.strictEqual(P.parseHeader('boshqa matn'), null);
  });
  await test('bands: the preamble is 0, a list inside a band stays in it', () => {
    const b = P.splitBands('Muqaddima.\n1. Birinchi.\n1) ichki;\n2) ichki;\n2. Ikkinchi.\n5. Raqam sakradi - band emas.\n3. Uchinchi.');
    assert.deepStrictEqual(b.map(x => x.n), [0, 1, 2, 3]);
    assert.ok(b[1].text.includes('1) ichki') && b[2].text.includes('5. Raqam sakradi'));
  });
  await test('abbreviations the decision defines', () => {
    assert.deepStrictEqual(P.abbreviations('Fuqarolik protsessual kodeksi (bundan buyon matnda FPK deb yuritiladi), Iqtisodiy protsessual kodeksi (bundan buyon IPK)'),
      { FPK: 'Fuqarolik protsessual kodeksi', IPK: 'Iqtisodiy protsessual kodeksi' });
    assert.deepStrictEqual(P.abbreviations('Гражданским процессуальным кодексом (далее — ГПК)'), { ГПК: 'Гражданским процессуальным кодексом' });
  });
  await test('article refs: abbreviation, code words, named law, ranges, primes, "va", the Constitution; unknown stays null', () => {
    const r = s => P.articleRefs(s, { ФПК: 'x', FPK: 'x' });
    assert.deepStrictEqual(r('ФПКнинг 101 ва 102-моддалари'), [{ n: '101', act: 'ФПК' }, { n: '102', act: 'ФПК' }]);
    assert.deepStrictEqual(r('Oila kodeksining 89-moddasi'), [{ n: '89', act: 'Oila kodeks' }]);
    assert.deepStrictEqual(r('«Судлар тўғрисида»ги Ўзбекистон Республикаси Қонунининг 22-моддасига'), [{ n: '22', act: '«Судлар тўғрисида» қонуни' }]);
    assert.deepStrictEqual(r('“Sudlar toʻgʻrisida”gi Qonunning 22-moddasi'), [{ n: '22', act: '«Sudlar toʻgʻrisida» qonuni' }]);
    assert.deepStrictEqual(r('sudlar JK 44 — 50-moddalarida'), [{ n: '44–50', act: 'JK' }]);
    assert.deepStrictEqual(r('JPK 497²⁶, 509⁹-modda (509-modda prim 9)lari'), [{ n: '497²⁶', act: 'JPK' }, { n: '509⁹', act: 'JPK' }]);
    assert.deepStrictEqual(r('JKning 57²-modda va 45-moddasini'), [{ n: '57²', act: 'JK' }, { n: '45', act: 'JK' }]);
    assert.deepStrictEqual(r('Konstitutsiyasiga koʻra (19-moddasining birinchi qismi)'), [{ n: '19', act: 'Konstitutsiya' }]);
    assert.deepStrictEqual(r('“66, 67-moddalarida” degan soʻzlar'), [{ n: '66', act: null }, { n: '67', act: null }]);
    assert.deepStrictEqual(P.articleRefs('статьи 195 ГПК и статьей 22 Закона «О судах», статьи 89 Семейного кодекса', {}),
      [{ n: '195', act: 'ГПК' }, { n: '22', act: 'Закона «О судах»' }, { n: '89', act: 'Семейного кодекса' }]);
  });
  await test('editions from the language links; amendments are recognised', () => {
    assert.deepStrictEqual(P.editions(UZ, 8346794), { ru: 8346846, lat: -8346794, uz: 8346794 });
    assert.ok(P.isAmendment('Oʻzbekiston Respublikasi Oliy sudi Plenumining ayrim qarorlariga oʻzgartirish va qoʻshimchalar kiritish toʻgʻrisida'));
    assert.ok(P.isAmendment('О внесении изменений и дополнений в некоторые постановления Пленума'));
    assert.ok(!P.isAmendment('Sudlar tomonidan daʼvoni taʼminlash choralarini koʻrishning ayrim masalalari toʻgʻrisida'));
  });
  await test('one page read: header, bands with refs, sha', () => {
    const e = readEdition(UZ);
    assert.ok(!e.error, e.error);
    assert.deepStrictEqual(e.header, { court: 'oliy', date: '2026-07-03', number: '19' });
    assert.deepStrictEqual(e.bands.map(b => b.n), [0, 1, 2, 3]);
    assert.deepStrictEqual(e.bands[2].refs, [{ n: '101', act: 'ФПК' }, { n: '102', act: 'ФПК' }, { n: '89¹', act: 'ИПК' }]);
    assert.ok(e.bands[2].text.includes('1) ариза'), 'the list item stays in band 2');
    assert.strictEqual(e.sha.length, 64);
    assert.ok(readEdition('<html></html>').error);
    const noRu = page({ header: '', title: 'О внесении изменений', lines: [] }).replace('</body>', '<div class="COMMENT_FOR_WARNING">Текст акта приводится на <a href="/uz/docs/1">узбекском языке</a>.</div></body>');
    assert.strictEqual(readEdition(noRu).error, 'lex.uz has no text in this language');
  });
  await test('the list: items, post-back fields, the "Keyingisi" link', () => {
    const h = `<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="a&amp;b" /><a href="/uz/docs/-123?query=plenumining#sr-1" target="_blank">Birinchi  qaror</a>` +
      `<a href="/uz/docs/-123?type=doc">Word</a><a id="ucFoundActsControl_LinkButton1" href="javascript:__doPostBack(&#39;x&#39;,&#39;&#39;)">Keyingisi</a>`;
    assert.deepStrictEqual(S.listItems(h), [{ id: -123, title: 'Birinchi qaror' }]);
    assert.deepStrictEqual(S.hiddenFields(h), { __VIEWSTATE: 'a&b' });
    assert.ok(S.hasNext(h) && !S.hasNext('<a id="ucFoundActsControl_LinkButton1">Keyingisi</a>'));
    assert.ok(S.listUrl(2328).includes('status=Y&query=plenumining&body_id=2328'));
  });
  await test('list paging: follows "Keyingisi", stops when a page brings nothing new, names a failed page', async () => {
    const p1 = `<a href="/uz/docs/-1?query=p">A</a><a id="ucFoundActsControl_LinkButton1" href="javascript:__doPostBack(">K</a>`;
    const p2 = `<a href="/uz/docs/-2?query=p">B</a>`;
    const posts = [];
    const l = await S.listDecisions('oliy', { get: async () => p1, post: async (u, f) => { posts.push(f.__EVENTTARGET); return p2; }, pause: 0 });
    assert.deepStrictEqual(l.items.map(x => x.id), [-1, -2]); assert.deepStrictEqual(posts, ['ucFoundActsControl$LinkButton1']); assert.strictEqual(l.partial, null);
    const bad = await S.listDecisions('oliy', { get: async () => p1, post: async () => { throw new Error('reset'); }, pause: 0 });
    assert.strictEqual(bad.items.length, 1); assert.ok(/page 2: reset/.test(bad.partial));
  });
  await test('sync: dry writes only its report; apply writes, then an unchanged decision is one page', async () => {
    const pages = { 8346794: UZ, '-8346794': UZ.replace(/Ўзбекистон Республикаси Олий суди пленумининг қарори/, 'Oʻzbekiston Respublikasi Oliy sudi plenumining qarori'), 8346846: UZ };
    const fetched = [];
    const source = { BODIES: { oliy: 2328 }, listDecisions: async () => ({ items: [{ id: -8346794, title: 'Daʼvoni taʼminlash', body: 'oliy' }, { id: -999, title: 'Oʻqilmaydi', body: 'oliy' }], pages: 1, partial: null }),
      fetchEdition: async (id) => { fetched.push(id); if (!pages[id]) throw new Error('404'); return pages[id]; } };
    const rows = new Map(), bands = [], runs = [], sqls = [];
    const q = async (sql, args) => {
      sqls.push(sql);
      if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ ok: true }] };
      if (/INSERT INTO plenum_sync_runs/.test(sql)) { runs.push({ mode: args[0] }); return { rows: [{ id: runs.length }] }; }
      if (/SELECT lex_id, sha_uz, in_force FROM plenum_decisions/.test(sql)) return { rows: [...rows.values()] };
      if (/INSERT INTO plenum_decisions/.test(sql)) { rows.set(args[0], { lex_id: args[0], sha_uz: args[13], in_force: true, court: args[3], number: args[4] }); return { rows: [] }; }
      if (/INSERT INTO plenum_bands/.test(sql)) { bands.push(args); return { rows: [] }; }
      if (/UPDATE plenum_sync_runs/.test(sql)) { runs[args[0] - 1].report = JSON.parse(args[1]); return { rows: [] }; }
      return { rows: [], rowCount: 0 };
    };
    const db = { query: q, connect: async () => ({ query: q, release() {} }) };
    const sync = createPlenumSync({ db, source });
    const dry = await sync.run({ mode: 'dry' });
    assert.strictEqual(dry.listed, 2); assert.strictEqual(dry.new, 1); assert.strictEqual(dry.failed.length, 1); assert.ok(/uz page: 404/.test(dry.failed[0].why));
    assert.strictEqual(rows.size, 0, 'dry writes no decision'); assert.ok(!sqls.some(s => /INSERT INTO plenum_bands/.test(s)));
    const ap = await sync.run({ mode: 'apply' });
    assert.strictEqual(ap.new, 1); assert.strictEqual(rows.get(8346794).number, '19'); assert.strictEqual(rows.get(8346794).court, 'oliy');
    assert.deepStrictEqual([...new Set(bands.map(b => b[1]))].sort(), ['lat', 'ru', 'uz'], 'all three editions are kept');
    fetched.length = 0;
    const again = await sync.run({ mode: 'apply' });
    assert.strictEqual(again.unchanged, 1); assert.deepStrictEqual(fetched.filter(id => id !== 999), [8346794], 'an unchanged decision costs one page');
    assert.strictEqual(sync.isRunning(), false);
  });
  await test('wiring: master only with the role read again, no AI anywhere, kept apart from the answer corpus', () => {
    const r = fs.readFileSync(path.join(__dirname, '../src/plenum/routes.js'), 'utf8');
    assert.ok(/SELECT role FROM admins WHERE id = \$1/.test(r) && /'\/api\/admin\/plenum\/sync', requireSameOrigin, requireMasterAdmin, master/.test(r));
    for (const f of ['parse.js', 'source.js', 'sync.js', 'routes.js']) {
      const src = fs.readFileSync(path.join(__dirname, '../src/plenum', f), 'utf8');
      assert.ok(!/callAI|callCheapAI|embedding|legal_chunks/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), `${f} uses no AI and no answer corpus`);
    }
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.ok(server.includes("require('../plenum/routes').mountPlenumRoutes(app"));
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
