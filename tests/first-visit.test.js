'use strict';

/**
 * U2 (docs/design/ux-audit-2026-11.md): the first visit asks nothing before
 * the first question. No forced plan picker while the one-time Sinov is still
 * there (the server starts it on first use - tariff-ledger resolveEntitlement,
 * no period); a person with nothing yet sees "Nimadan boshlaysiz?" with three
 * buttons instead of field chips, task cards and an empty list; the alphabet
 * bar waits for the first work and is a row in the app, not an overlay; empty
 * pages say what goes there with one button. Frontend only.
 *
 *   node tests/first-visit.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

console.log('first visit (U2)');

test('the plan picker is forced only when no Sinov is waiting; the tariff rules stay on the server', () => {
  const app = read('public', 'app', 'app.js');
  assert.ok(app.includes("if (J.needsPlan() && !editorPage && !(J.trialWaiting && J.trialWaiting())) J.openPlans({ forced: true });"));
  const start = read('public', 'app', 'start.js');
  assert.ok(start.includes("J.trialWaiting = function () { var b = J.balance(); return !J.isStaff() && b.kind === 'none' && b.trialAvailable !== false; };"));
  // the Sinov has no period and is created on first use: not starting it on a visit loses nothing
  const ledger = read('src', 'rag', 'tariff-ledger.js');
  assert.ok(/sinov: Object\.freeze\(\{\s*label: 'Sinov', priceUzs: 0, periodDays: null, oneTime: true/.test(ledger));
  assert.ok(/if \(!trials\.rows\.length && createTrial\)/.test(ledger));
  assert.ok(!/\/api\/tariff\/select/.test(start), 'nothing is selected for the person');
});

test('the usage box says what the person gets, not "no plan chosen"', () => {
  assert.ok(read('public', 'app', 'app.js').includes('box.innerHTML = J.trialUsageHtml();'));
  assert.ok(read('public', 'app', 'start.js').includes("trialN: '{n} ta bepul savol · karta kerak emas'"));
});

test('home: "Nimadan boshlaysiz?" while /api/recent is empty, in both home variants; staff and previews never', () => {
  const views = read('public', 'app', 'views.js');
  assert.strictEqual((views.match(/<div class="st-host" hidden><\/div><div class="tasks"><\/div>/g) || []).length, 2);
  assert.ok(views.includes('onItems: leanFresh') && views.includes('onItems: fullFresh'));
  assert.ok(views.includes('var leanFresh = freshHome(lean, lc, !preview);'));
  assert.ok(/var can = allowed && !J\.isStaff\(\) && J\.startBlock;/.test(views));
  assert.ok(/var fresh = Array\.isArray\(items\) && items\.length === 0;/.test(views), 'an unreadable list keeps the old page');
  assert.ok(read('public', 'app', 'find.js').includes('if (opts.onItems) opts.onItems(list);'));
  const start = read('public', 'app', 'start.js');
  for (const k of ["ask: 'Savol berish'", "check: 'Hujjatni tekshirish'", "write: 'Hujjat yozish'", "if (k === 'check') return J.go('#/tahlil');", "if (k === 'write') return J.go('#/tayyorlash');"]) assert.ok(start.includes(k), k);
});

test('the alphabet bar: after the first work, a row under the top bar in the app; the landing unchanged', () => {
  const a = read('public', 'js', 'uz-alphabet.js');
  assert.ok(a.includes("if (typeof A.offerGate === 'function' && !A.offerGate()) return;"));
  assert.ok(a.includes("bar.style.position = 'static';") && a.includes('host.parent.insertBefore(bar'));
  assert.ok(a.includes('document.body.appendChild(bar);'), 'no host (the landing): floating as before');
  const start = read('public', 'app', 'start.js');
  assert.ok(start.includes('A.offerGate = function () { return J.didWork === true; };'));
  assert.ok(start.includes("J.on('sessions', function () { if ((J.S.sessions || []).length) J.markWorked(); });"));
  assert.ok(!read('public', 'index.html').includes('offerGate'), 'the landing sets no gate');
});

test('empty pages: one sentence and one button (chats, uploaded documents, results)', () => {
  assert.ok(read('public', 'app', 'views.js').includes('<button class="pill sm" type="button" data-a="first">'));
  const lib = read('public', 'app', 'library.js');
  assert.ok(lib.includes('<a class="pill sm" href="#/tahlil">') && lib.includes('<a class="pill sm" href="#/jadval">'));
});

test('wiring: start.js loaded before find.js; light blue only for the icon tile', () => {
  assert.ok(/<script src="\/app\/start\.js\?v=\d+"><\/script>\s*<script src="\/app\/find\.js/.test(read('public', 'app', 'index.html')));
  assert.ok(read('public', 'app', 'app.css').includes('.st-ic{width:40px;height:40px;border-radius:12px;background:var(--accent-soft)'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
