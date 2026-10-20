'use strict';

/**
 * Model-written document HTML (legal opinion, AI drafts) keeps its layout and
 * loses everything that can run code (src/rag/safe-html.js; 2026-10-20
 * security review). Same allowlist as the dashboard's sanitizeDocHtml and the
 * app's J.cleanHtml. No network.
 *
 *   node tests/safe-html.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { sanitizeDocHtml: clean } = require('../src/rag/safe-html');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

test('code is removed: handlers in any quoting, svg, iframe srcdoc, img, javascript: links, comments', () => {
  for (const [input, out] of [
    ['<img src=x onerror=alert(1)>', ''],
    ["<p onclick='x()'>a</p>", '<p>a</p>'],
    ['<p onmouseover=x()>a</p>', '<p>a</p>'],
    ['<svg/onload=alert(1)>t</svg>', ''],
    ['<iframe srcdoc="<script>1</script>"></iframe>', ''],
    ['<script>alert(1)</script><style>p{}</style>', ''],
    ['<details open ontoggle=x()>d</details>', 'd'],
    ['<!-- x --><p>a</p>', '<p>a</p>'],
  ]) assert.strictEqual(clean(input), out, input);
  assert.strictEqual(clean('<a href="javascript:alert(1)">l</a>'), '<a target="_blank" rel="noopener">l</a>');
  assert.strictEqual(clean('<a href=" JaVaScRiPt:alert(1)">l</a>'), '<a target="_blank" rel="noopener">l</a>');
  assert.strictEqual(clean('<a href="//evil.example/x">l</a>'), '<a target="_blank" rel="noopener">l</a>', 'protocol-relative is not this site');
});

test('layout stays: headings, bold, lists, tables, alignment, lex.uz links, escaped text', () => {
  assert.strictEqual(clean('<h2>Xulosa</h2><p style="text-align:center;background:url(x)">Matn <b>qalin</b></p>'), '<h2>Xulosa</h2><p style="text-align:center">Matn <b>qalin</b></p>');
  assert.strictEqual(clean('<table><tr><td colspan=2>1</td></tr></table>'), '<table><tr><td colspan="2">1</td></tr></table>');
  assert.strictEqual(clean('<ol><li>a</li></ol><a href="https://lex.uz/docs/-1">ok</a>'), '<ol><li>a</li></ol><a href="https://lex.uz/docs/-1" target="_blank" rel="noopener">ok</a>');
  assert.strictEqual(clean('<p>a &amp; b &lt;img onerror=x&gt;</p>'), '<p>a &amp; b &lt;img onerror=x&gt;</p>');
  assert.strictEqual(clean('<section><header>t</header><p>a</p></section>'), 't<p>a</p>', 'unknown tags unwrapped, text kept');
  assert.strictEqual(clean(''), '');
  assert.strictEqual(clean(null), '');
});

test('wired: the legal opinion (and its citation fix) and the AI draft are cleaned on the server; the app cleans before rendering', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
  assert.ok(/html = sanitizeDocHtml\(tidyDocumentHtml\(html\)\);/u.test(server));
  assert.ok(/const fixed = sanitizeDocHtml\(tidyDocumentHtml\(/u.test(server));
  const drafting = fs.readFileSync(path.join(__dirname, '../src/drafting/routes.js'), 'utf8');
  assert.ok(/html = require\('\.\.\/rag\/safe-html'\)\.sanitizeDocHtml\(html\);\n\s*res\.json\(\{ html, provider: result\.provider \}\);/u.test(drafting));
  const views = fs.readFileSync(path.join(__dirname, '../public/app/views.js'), 'utf8');
  assert.ok(views.includes("var clean = J.cleanHtml(d.html || '');") && views.includes('var clean = J.cleanHtml(html);'));
  assert.ok(!/replace\(\/<script\[\\s\\S\]\*\?<\\\/script>\/gi, ''\)/u.test(views), 'the two-regex filter is gone');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
