'use strict';

/**
 * Data protection E4: the 20-question before/after runner
 * (scripts/redaction-eval.js) - the case file is valid, every listed
 * identifier is hidden and every amount, date and act code reaches the
 * provider unchanged (dry run, no network), and the answer comparison is
 * mechanical (articles, acts, placeholders left, identifiers repeated).
 */

const assert = require('assert');
const path = require('path');
const ev = require('../scripts/redaction-eval');
const redact = require('../src/privacy/redact');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

console.log('redaction eval');
const cases = ev.loadCases(path.join(__dirname, '../docs/quality/redaction-eval/cases.json'));

test('20 synthetic cases, each identifier and kept token written in its question', () => {
  assert.strictEqual(cases.length, 20);
});

test('dry run: nothing listed reaches the provider, nothing kept is changed, restoring gives the question back', () => {
  for (const c of cases) {
    const d = ev.dryCase(c);
    assert.ok(d.ok, `${c.id}: ${JSON.stringify(d)}`);
  }
});

test('a name found after "F.I.Sh." is hidden where it is written again without the marker', () => {
  const t = redact.redact('Otam Abdullayev Botir Karimovich vafot etdi (F.I.Sh.: Abdullayev Botir Karimovich).', redact.createMap());
  assert.ok(!t.includes('Abdullayev'), t);
});

test('the comparison: articles and acts, placeholders left, identifiers repeated', () => {
  const c = { id: 'R00', pii: ['AA1234567'] };
  const off = { status: 200, reply: 'Fuqarolik kodeksi 333-modda va VMQ-589 bo‘yicha AA1234567 egasi.', provider: 'x' };
  const on = { status: 200, reply: 'Fuqarolik kodeksi 333-moddasi, 334-modda. [PASPORT_1] egasi.', provider: 'x', redactHeader: 'on' };
  const r = ev.compare(c, off, on);
  assert.deepStrictEqual(r.off.articles, ['333-modda']);
  assert.deepStrictEqual(r.on.articles, ['333-modda', '334-modda']);
  assert.strictEqual(r.articlesJaccard, 0.5);
  assert.deepStrictEqual(r.off.acts, ['VMQ-589']);
  assert.strictEqual(r.placeholderLeak, true);
  assert.deepStrictEqual(r.off.repeatsPii, ['AA1234567']);
  const s = ev.summary([r]);
  assert.deepStrictEqual(s.placeholderLeaks, ['R00']);
  assert.strictEqual(s.questions, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
