'use strict';

/**
 * U4 (docs/design/ux-audit-2026-11.md): the menu is five items for everyone
 * (Savol, Hujjatlar, Ishlar, Asboblar, Advokatlar; staff add Navbat and
 * Boshqaruv); every other section is a card on "Asboblar" - what it does, an
 * example and the price, the role view's sections first; old links still
 * open their pages. Phone: a bottom bar (Savol, Hujjatlar, Ishlar, Ko'proq).
 * Plain names and a plain usage box. Frontend only.
 *
 *   node tests/menu-tools.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'public', 'app', ...p), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

console.log('menu and tools (U4)');
const app = read('app.js'), tools = read('tools.js'), i18n = read('i18n.js');

test('five items for everyone; staff add the queue and the admin page; no role filtering of the menu', () => {
  assert.ok(app.includes("['#/', 'chat', 'nav.ask'], ['#/hujjatlarim', 'doc', 'nav.docs'], ['#/ishlar', 'folder', 'nav.matters'], ['#/asboblar', 'layers', 'nav.tools'], ['#/advokatlar', 'scale', 'nav.lawyers']"));
  assert.ok(app.includes("if (J.isStaff()) items.splice(1, 0, ['#/navbat', 'chat', 'nav.queue']);"));
  assert.ok(!/ROLE_VIEWS\[rv\]\.nav/.test(app), 'the menu itself does not change by role');
  assert.ok(app.includes("r === '#/asboblar' ? (tool || h.indexOf(r) === 0)"), '"Asboblar" is marked on any tool page');
});

test('"Asboblar": every section as a card with an example and a price; the role view orders them; old routes kept', () => {
  for (const k of ["['tahlil', '#/tahlil'", "['tayyorlash', '#/tayyorlash'", "['dava', '#/agent/dava'", "['jadval', '#/jadval'", "['playbook', '#/playbook'",
    "['firma', '#/firma'", "['konikmalar', '#/konikmalar'", "['yozuvlar', '#/yozuvlar'", "['jamoa', '#/jamoa'", "['moslashish', '#/moslashish'"]) assert.ok(tools.includes(k), k);
  assert.ok(tools.includes("J.route(/^\\/asboblar$/, function () { J.viewTools(); });"));
  assert.ok(/var rank = function \(x\) \{ var i = first\.indexOf\(x\[1\]\);/.test(tools));
  assert.ok(tools.includes("unit: '1 birlik = 10 sahifagacha'"));
  // the old pages still have their routes
  for (const [f, r] of [['tabular.js', "J.route(/^\\/jadval$/"], ['playbook.js', "J.route(/^\\/playbook$/"], ['firm-kb.js', "J.route(/^\\/firma$/"]]) assert.ok(read(f).includes(r), f);
});

test('phone: the bottom bar with four buttons; "Ko\'proq" opens the side menu; hidden in the editor', () => {
  assert.ok(tools.includes("var BOTTOM = [['#/', 'chat', 'nav.ask'], ['#/hujjatlarim', 'doc', 'nav.docs'], ['#/ishlar', 'folder', 'nav.matters']];"));
  assert.ok(tools.includes("document.body.classList.toggle('nav-open');"));
  const css = read('app.css');
  assert.ok(css.includes('body.ed-on .bnav,body.booting .bnav{display:none}'));
  assert.ok(/body:not\(\.ed-on\):not\(\.booting\) \.main\{padding-bottom:calc\(58px/.test(css), 'the content is never under the bar');
});

test('plain names; the old names still find the pages in search', () => {
  assert.ok(i18n.includes("'nav.skills':'Tayyor buyruqlar'") && i18n.includes("'cmp.skills':'Tayyor buyruq'"));
  assert.ok(read('playbook.js').includes("title: 'Firma qoidalari bilan tekshirish',"));
  assert.ok(read('tabular.js').includes("title: 'Ko‘p hujjatni solishtirish',"));
  assert.ok(read('matters.js').includes("tabular_review: 'Ko‘p hujjatni solishtirish', playbook_review: 'Firma qoidalari bilan tekshirish'"));
  const find = read('find.js');
  assert.ok(find.includes("['#/jadval', null, 'Jadvalli tahlil']") && find.includes("['#/playbook', null, 'Playbook']"));
});

test('the usage box in plain words: questions and document reviews left, what a unit is', () => {
  assert.ok(app.includes("t(b.kind === 'trial' ? 'usage.left.trial' : 'usage.left', { n: J.fmtNum(c.remaining) })"));
  assert.ok(i18n.includes("'usage.left':'Bu oy: {n} savol qoldi'") && i18n.includes("'usage.unit':'1 tahlil = 10 sahifagacha'"));
  assert.ok(!app.includes("t('vc.min.none')"), 'no "minutes are not counted yet" line');
});

test('wiring: tools.js loaded; light blue only for icon tiles', () => {
  assert.ok(/<script src="\/app\/tools\.js\?v=\d+"><\/script>/.test(read('index.html')));
  assert.ok(read('app.css').includes('.tl-ic{flex:none;width:40px;height:40px;border-radius:12px;background:var(--accent-soft)'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
