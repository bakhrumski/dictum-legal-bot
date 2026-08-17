'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { wrapDocumentHtml, stripEmbeddedFonts } = require('../src/drafting/routes');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ ${name}\n      ${error.message}`);
    failed++;
  }
}

console.log('\ndocument export — Word fonts\n');

test('embedded font declarations are removed without losing layout styles', () => {
  const input = '<p style="font-family: SimSun; font-size: 11pt; mso-fareast-font-family: SimSun; text-align:right"><font face="SimSun">Talabnoma</font></p>';
  const output = stripEmbeddedFonts(input);
  assert.ok(!/SimSun/i.test(output), 'SimSun survived normalization');
  assert.ok(!/font-family/i.test(output), 'embedded font-family survived normalization');
  assert.ok(!/\sface=/i.test(output), 'legacy <font face> survived normalization');
  assert.ok(output.includes('font-size: 11pt'), 'font size should be preserved');
  assert.ok(output.includes('text-align:right'), 'layout style should be preserved');
});

test('Word HTML assigns Calibri to every Microsoft Word font slot', () => {
  const output = wrapDocumentHtml('Talabnoma', '<p>O‘zbekcha matn</p>', 'uz');
  for (const rule of [
    'font-family: Calibri, Arial, sans-serif !important',
    'mso-ascii-font-family: Calibri',
    'mso-fareast-font-family: Calibri',
    'mso-hansi-font-family: Calibri',
    'mso-bidi-font-family: Calibri',
    'w:Fareast="Calibri"',
    'w:CS="Calibri"',
  ]) {
    assert.ok(output.includes(rule), `missing Word font rule: ${rule}`);
  }
});

console.log('\ndocument export — browser reliability\n');

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
const exportBlock = dashboard.slice(
  dashboard.indexOf('async function docExportFetch'),
  dashboard.indexOf('// ── Composer attachments:', dashboard.indexOf('async function docExportFetch')),
);

test('transient network and gateway failures are retried up to three times', () => {
  assert.ok(exportBlock.includes('var maxAttempts = 3'), 'three-attempt retry is missing');
  assert.ok(exportBlock.includes('[502, 503, 504]'), 'gateway status retry list is missing');
  assert.ok(exportBlock.includes('catch (err)'), 'network exception retry is missing');
});

test('the full icon markup is restored after every success or failure', () => {
  assert.ok(exportBlock.includes('var originalHtml = btn.innerHTML'), 'original SVG/button markup is not preserved');
  assert.ok(exportBlock.includes('btn.innerHTML = originalHtml'), 'original SVG/button markup is not restored');
  assert.ok(exportBlock.includes('btn.removeAttribute(\'aria-busy\')'), 'busy state is not cleared');
});

test('empty or failed file responses cannot be downloaded as corrupt documents', () => {
  assert.ok(exportBlock.includes('if (!r.ok)'), 'non-success HTTP responses are not rejected');
  assert.ok(exportBlock.includes('blob.size === 0'), 'empty file response is not rejected');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
