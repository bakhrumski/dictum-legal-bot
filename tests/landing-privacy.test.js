'use strict';

/**
 * E7 (docs/design/shifrlash-1-bosqich.md §10): the landing's "how your data is
 * protected" section is hidden by default and opens only when the server says
 * sealing at rest and redaction before AI are on (GET /api/landing-config ->
 * privacy); its footnote names the services the redaction covers (chat only
 * with REDACT_LEGAL_CHAT=on); every language has its text; the section adds
 * no keyframes of its own (ANIMATIONS.md: no new animations).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
console.log('landing privacy (E7)');

test('hidden in every language\'s page until the server says so', () => {
  for (const f of ['public/index.html', 'public/ru/index.html', 'public/en/index.html']) {
    assert.match(read(f), /<div class="enc" id="shifrlash" hidden>/u, f);
  }
  const js = read('public/js/main.js');
  assert.match(js, /if \(!p \|\| !p\.encryptionAtRest \|\| !p\.redactAi\) return;\s*box\.hidden = false;/u);
  assert.match(js, /T\(chatToo \? 'enc\.footAll' : 'enc\.footDocs'\)/u);
});

test('the server reports flags only: sealing (DATA_KEYS), redaction, chat redaction', () => {
  const s = read('src/api/server.js');
  assert.match(s, /res\.json\(\{ \.\.\.\(await landingConfig\.read\(pool\)\), privacy: privacyStatus\(\) \}\);/u);
  assert.match(s, /encryptionAtRest: require\('\.\.\/privacy\/crypto'\)\.enabled\(\)/u);
  assert.match(s, /redactChat: on\(env\.REDACT_AI, 'on'\) && on\(env\.REDACT_LEGAL_CHAT, 'off'\)/u);
});

test('every language has the texts', () => {
  const w = {};
  new Function('window', read('public/js/i18n.js'))(w);
  for (const l of ['uz', 'ru', 'en']) {
    for (const k of ['enc.title', 'enc.s1', 'enc.s2', 'enc.s3', 'enc.s4', 'enc.sample', 'enc.toAi', 'enc.stored', 'enc.reply', 'enc.footDocs', 'enc.footAll', 'enc.link']) {
      assert.ok(String(w.I18N[l][k] || '').trim(), `${l} ${k}`);
    }
    assert.match(w.I18N[l]['enc.sample'], /\{n:[^}]+\}.*\{p:[^}]+\}/u, `${l}: a name and a passport to hide`);
    assert.ok(!/chat|чат/iu.test(w.I18N[l]['enc.footDocs'].split('.')[0]), `${l}: footDocs does not promise the chat`);
  }
});

test('the section adds no keyframes of its own', () => {
  const css = read('public/css/style.css');
  const block = css.slice(css.indexOf('/* E7:'));
  assert.ok(block.length > 100);
  assert.ok(!/@keyframes/u.test(block), 'reuses beam, slot flip, stamp, barin, mdot, caret');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
