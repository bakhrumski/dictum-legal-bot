'use strict';

/**
 * Tests for the composer's "+" mode menu in public/dashboard.html.
 *
 * dashboard.html is a ~15k-line single file with inline scripts, so a broken
 * onclick is invisible until a user clicks it in production. These checks are
 * static — they parse the file rather than run a browser — but they catch the
 * failure that actually happens: a menu entry wired to a function that does
 * not exist, or was renamed.
 *
 *   node tests/composer-modes.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

const defines = (fn) => new RegExp(`function\\s+${fn}\\s*\\(`).test(html);

// The menu markup. It contains a <div class="ai-attach-sep"></div>, so
// slicing to the first '</div>' truncates it — bound it by the <textarea>
// that follows the whole attach block instead.
const menuStart = html.indexOf('id="aiAttachMenu"');
const menu = html.slice(menuStart, html.indexOf('<textarea', menuStart));

console.log('\ncomposer modes — the menu\n');

test('all five modes are present', () => {
  for (const [label, handler] of [
    ['Savol berish',           'modeChat'],
    ['Hujjat yaratish',        'openDocBuilder'],
    ['Yuridik xulosa',         'modeOpinion'],
    ['Hujjat tahlili',         'modeAnalyzer'],
    ['Shablonlar muharriri',   'modeTemplateEditor'],
  ]) {
    assert.ok(menu.includes(label), `menu is missing "${label}"`);
    assert.ok(menu.includes(handler + '()'), `"${label}" is not wired to ${handler}()`);
  }
});

test('file attachment survived the restructure', () => {
  assert.ok(/pickAttach\('file'\)/.test(menu), 'attach action lost');
});

test('every onclick in the menu resolves to a defined function', () => {
  const handlers = [...menu.matchAll(/onclick="(\w+)\(/g)].map(m => m[1]);
  assert.ok(handlers.length >= 5, `expected >=5 handlers, found ${handlers.length}`);
  const missing = [...new Set(handlers)].filter(h => !defines(h));
  assert.deepStrictEqual(missing, [], 'undefined handler(s): ' + missing.join(', '));
});

console.log('\ncomposer modes — template editor\n');

test('the template-editor flow is fully defined', () => {
  for (const fn of ['modeTemplateEditor', 'tplEditorHome', 'onTplUpload',
                    'tplReviewCard', 'tplSaveMine', 'tplDeleteMine']) {
    assert.ok(defines(fn), `${fn}() is not defined`);
  }
});

test('it calls the scoped user-template endpoints, never the master ones', () => {
  assert.ok(html.includes("'/api/templates/analyze'"), 'analyze endpoint not called');
  assert.ok(html.includes("'/api/templates/mine'"), 'mine endpoint not called');
  assert.ok(html.includes("'/api/templates/mine/' + id"), 'delete endpoint not called');
  // /api/templates/import-file is master-only; a user-facing flow calling it
  // would 403 for every ordinary user.
  const tplBlock = html.slice(html.indexOf('function tplEditorHome'), html.indexOf('function toggleAttachMenu'));
  assert.ok(!tplBlock.includes('import-file'),
    'the user flow must not call the master-only import-file endpoint');
});

test('upload goes through the two-step review, not straight to save', () => {
  const upload = html.slice(html.indexOf('async function onTplUpload'), html.indexOf('var tplPendingTemplate'));
  assert.ok(upload.includes('tplReviewCard('),
    'analyze must hand off to the review card so a misread upload can be discarded');
  assert.ok(!upload.includes("'/api/templates/mine'"),
    'onTplUpload must not save directly — the user confirms first');
});

test('every request carries the session cookie', () => {
  const tplBlock = html.slice(html.indexOf('function tplEditorHome'), html.indexOf('function toggleAttachMenu'));
  const fetches = (tplBlock.match(/fetch\(/g) || []).length;
  const creds = (tplBlock.match(/credentials: 'same-origin'/g) || []).length;
  assert.strictEqual(creds, fetches, `${fetches} fetch calls but ${creds} with credentials`);
});

console.log('\ncomposer modes — analyzer\n');

test('analyzer reuses an already-attached document instead of re-asking', () => {
  const fn = html.slice(html.indexOf('function modeAnalyzer'), html.indexOf('function onAnalyzerFile'));
  assert.ok(fn.includes('collectSessionDocs()'), 'must check for an existing document');
  assert.ok(fn.includes('explainFromAttachment()'), 'must reuse the existing explain path');
});

test('analyzer upload has a bounded wait, not an endless poll', () => {
  const fn = html.slice(html.indexOf('function onAnalyzerFile'), html.indexOf('function modeTemplateEditor'));
  assert.ok(/tries\s*>\s*\d+/.test(fn), 'polling must give up and report failure');
  assert.ok(fn.includes('clearInterval'), 'interval must be cleared');
});

console.log('\ncomposer modes — no duplicate routes to the same feature\n');

test('Yuridik xulosa is reachable only from the top-level menu', () => {
  // It used to be the primary button inside "Hujjat yaratish → AI bilan yangi
  // hujjat yaratish" as well. Two doors to one feature is confusing on its
  // own; worse, that one filed "analyse a document" under "create a document".
  // Bound to docFlowAI()'s own body — docFlowOpinion() is DEFINED just below
  // it, and a slice that runs past the closing brace matches the definition
  // rather than a button.
  const card = html.slice(html.indexOf('function docFlowAI()'), html.indexOf('var opinionDoc'));
  assert.ok(!card.includes('docFlowOpinion()'),
    'the create-a-document card still offers Yuridik xulosa');

  const menuHits = (menu.match(/modeOpinion\(\)/g) || []).length;
  assert.strictEqual(menuHits, 1, 'exactly one menu entry should open the opinion flow');
});

test('templates are USED in one place and MANAGED in another', () => {
  // The editor lists/uploads/deletes; the builder's Shablon picker is where a
  // template actually gets filled. Both offering "fill" duplicated the flow.
  const editor = html.slice(html.indexOf('async function tplEditorHome'), html.indexOf('async function onTplUpload'));
  assert.ok(!editor.includes('pickDocTemplate('),
    'the template editor should manage, not fill — that is the builder\'s job');
  assert.ok(editor.includes('tplDeleteMine('), 'the editor must still delete');
});

test('own templates are findable in the picker that fills them', () => {
  // Removing the editor shortcut only works if a user can spot their own
  // uploads in the shared list.
  const picker = html.slice(html.indexOf('async function docFlowTemplates'), html.indexOf('function docFlowAI'));
  assert.ok(picker.includes('t.isMine'), 'the picker does not distinguish own templates');
});

console.log('\ncomposer modes — hygiene\n');

test('every mode closes the menu before opening its card', () => {
  for (const fn of ['modeChat', 'modeOpinion', 'modeAnalyzer', 'modeTemplateEditor']) {
    const body = html.slice(html.indexOf(`function ${fn}(`), html.indexOf(`function ${fn}(`) + 400);
    assert.ok(body.includes('closeAttachMenu()'),
      `${fn}() leaves the menu open over the card it just opened`);
  }
});

test('inline scripts still parse', () => {
  const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length > 0);
  scripts.forEach((code, i) => {
    assert.doesNotThrow(() => new Function(code), `inline script #${i} has a syntax error`);
  });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
