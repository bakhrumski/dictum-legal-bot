'use strict';

/**
 * U3 (docs/design/ux-audit-2026-11.md): one door for a document - "Nima qilaylik?".
 * A file read in a composer (home or chat), dropped on the home page or on
 * Hujjatlar, or a document of the Hujjatlar list gets one card: explain, full
 * review, a question, the editor, the firm's rules, compare - each with its
 * result and price. Nothing runs by itself; a paid service still shows the
 * server's price first. The existing pages stay and are opened with the
 * document (no second upload). Frontend only.
 *
 *   node tests/doc-actions.test.js
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

console.log('document actions (U3)');
const da = read('public', 'app', 'docact.js');
const chat = read('public', 'app', 'chat.js');

test('the card: six actions, each with its price; the editor only for a document kept in the library', () => {
  assert.ok(da.includes("var ORDER = ['explain', 'risk', 'ask', 'editor', 'playbook', 'compare'];"));
  assert.ok(/if \(k === 'ask'\) return s\('q1'\);\s*if \(k === 'editor'\) return s\('free'\);\s*if \(k === 'compare'\) return s\('perDoc'\);\s*return s\('units', \{ n: unitsOf\(f\) \}\);/.test(da));
  assert.ok(da.includes("if (!libId(f)) keys = keys.filter(function (k) { return k !== 'editor'; });"));
  assert.ok(/Math\.ceil\(Math\.max\(\(\(f && f\.pages\) \|\| 0\) \/ 10, \(\(f && f\.chars\) \|\| 0\) \/ 40000\)\)/.test(da), 'the same size rule as the ledger (docUnits)');
  assert.ok(da.includes('$(\'.da-f\', el).textContent = f.name'), 'the file name goes in as text');
});

test('composer: the card after a file is read, only with nothing typed and no skill; a service goes through the normal send (price confirmed by the server)', () => {
  assert.ok(chat.includes("if (!J.docActions || opts.docActions === false || st.skill || ta.value.trim() || st.files.length !== 1) return;"));
  assert.ok(chat.includes("explain: function () { closeDa(); pick('explain'); submit(); },"));
  assert.ok(chat.includes("risk: function () { closeDa(); pick('risk'); submit(); },"));
  assert.ok(chat.includes("readFile(file, J.scanConfirm).then(function (d) { Object.assign(f, d, { status: 'ready' }); drawChips(); offerDa(f); })"));
  assert.ok(chat.includes('closeDa(); ta.value = \'\'; st.skill = null;'), 'gone on send');
  assert.ok(chat.includes("closeCard(); if (ta.value.trim()) closeDa();"), 'gone when the person types');
  assert.ok(chat.includes('docId: r.data.docId || null'), 'the read file keeps its library id');
});

test('the existing pages open with the document - no second upload', () => {
  assert.ok(read('public', 'app', 'playbook.js').includes('if (J.docHandoff) { doc = J.docHandoff; J.docHandoff = null; }'));
  assert.ok(read('public', 'app', 'tabular.js').includes('if (J.docHandoff && !openRunId) { docs.push(J.docHandoff); J.docHandoff = null; }'));
  assert.ok(da.includes("editor: function (f) { if (J.openLibraryInEditor) J.openLibraryInEditor({ id: libId(f), name: f.name }); },"));
  assert.ok(chat.includes('J.chatWithDoc = function (f, skillId)'));
  assert.ok(chat.includes("else if (C.preFiles) { var pf = C.preFiles; C.preFiles = null; pf.forEach(function (f) { cmp.addReady(f); }); }"));
});

test('drop anywhere: the home page into its composer, Hujjatlar reads and opens the card; a list row has the card too', () => {
  const views = read('public', 'app', 'views.js');
  assert.strictEqual((views.match(/homeDrop\((?:lean, lc|v, cmp)\);/g) || []).length, 2);
  assert.ok(views.includes('if (!has(e) || composer.el.contains(e.target)) return;'), 'the composer keeps its own drop');
  const lib = read('public', 'app', 'library.js');
  assert.ok(lib.includes('if (J.bindDocDrop) J.bindDocDrop(v,'));
  assert.ok(lib.includes('J.docActionsModal(asFile(d))'));
  assert.ok(da.includes('var f = await J.readFile(file, J.scanConfirm);'), 'a scan still shows its OCR price first');
});

test('wiring and design: docact.js loaded; no coloured stripes, light blue only for the icon tile', () => {
  assert.ok(/<script src="\/app\/docact\.js\?v=\d+"><\/script>/.test(read('public', 'app', 'index.html')));
  const css = read('public', 'app', 'app.css');
  assert.ok(css.includes('.da-ic{flex:none;width:30px;height:30px;border-radius:8px;background:var(--accent-soft)'));
  assert.ok(!/\.da-[a-z]+\{[^}]*border-left:\s*\d/.test(css));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
