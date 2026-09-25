'use strict';

/**
 * Word export is a real .docx (Astra audit D4), and what a legal document
 * uses survives the round trip. Read back with mammoth (already a
 * dependency) and by inspecting the package parts.
 *
 *   node tests/docx-export.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const mammoth = require('mammoth');
const { htmlToDocx, DOCX_MIME } = require('../src/drafting/html-to-docx');

const SAMPLE = `<h2 style="text-align:center">DA'VO ARIZASI</h2>
<p style="text-align:right">Toshkent sh., 25.09.2026</p>
<p>Da'vogar: <b>Aliyev A.</b> &amp; <i>sherigi</i>. Modda 358<sup>1</sup>.<br>Ikkinchi qator</p>
<ol><li>Birinchi talab</li><li>Ikkinchi talab<ul><li>ichki band</li></ul></li></ol>
<ol><li>Yangi ro'yxat</li></ol>
<table><tr><th>No</th><th>Summa</th><th>Izoh</th></tr><tr><td>1</td><td colspan="2">1 000 000 so'm</td></tr></table>
<p>Imzo: ________</p><script>alert(1)</script>`;

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

(async () => {
  console.log('docx export');
  const buf = await htmlToDocx(SAMPLE, { title: 'Da\'vo <arizasi>', lang: 'uz' });
  const zip = await JSZip.loadAsync(buf);
  const doc = await zip.file('word/document.xml').async('string');
  const numbering = await zip.file('word/numbering.xml').async('string');

  await test('it is an OOXML package with the Word parts', async () => {
    assert.strictEqual(buf.slice(0, 2).toString(), 'PK');
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels']) {
      assert.ok(zip.file(part), part);
    }
    assert.strictEqual(DOCX_MIME, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  await test('headings, alignment, bold, italic, superscript and line breaks are kept', () => {
    assert.ok(/<w:pStyle w:val="Heading2"\/>/.test(doc));
    assert.ok(/<w:jc w:val="center"\/>/.test(doc) && /<w:jc w:val="right"\/>/.test(doc));
    assert.ok(/<w:b\/>.*Aliyev A\./.test(doc));
    assert.ok(/<w:i\/>.*sherigi/.test(doc));
    assert.ok(/<w:vertAlign w:val="superscript"\/><\/w:rPr><w:t xml:space="preserve">1<\/w:t>/.test(doc), 'prim article stays superscript');
    assert.ok(/<w:br\/>/.test(doc));
  });

  await test('numbered lists restart per list; bullets nest', () => {
    assert.strictEqual((doc.match(/<w:numId w:val="1"\/>/g) || []).length, 2, 'first ol has two items');
    assert.ok(/<w:numId w:val="3"\/>/.test(doc), 'second ol gets its own numbering');
    assert.ok(/<w:ilvl w:val="1"\/><w:numId w:val="2"\/>/.test(doc), 'nested ul one level in');
    assert.ok(/<w:num w:numId="3"><w:abstractNumId w:val="2"\/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"\/>/.test(numbering));
  });

  await test('tables keep their columns, header bold and column spans', () => {
    assert.strictEqual((doc.match(/<w:gridCol /g) || []).length, 3);
    assert.ok(/<w:gridSpan w:val="2"\/>/.test(doc));
    assert.ok(/<w:tc>.*?<w:b\/>.*?No/.test(doc));
  });

  await test('script content is dropped and the title is escaped', async () => {
    assert.ok(!/alert/.test(doc));
    const core = await zip.file('docProps/core.xml').async('string');
    assert.ok(core.includes('Da&apos;vo &lt;arizasi&gt;') || core.includes("Da'vo &lt;arizasi&gt;"));
  });

  await test('mammoth reads it back with the same structure', async () => {
    const { value, messages } = await mammoth.convertToHtml({ buffer: buf });
    assert.strictEqual(messages.filter(m => m.type === 'error').length, 0);
    assert.ok(value.includes("<h2>DA'VO ARIZASI</h2>"));
    assert.ok(value.includes('<strong>Aliyev A.</strong>') && value.includes('358<sup>1</sup>'));
    assert.ok(/<ol><li>Birinchi talab<\/li><li>Ikkinchi talab<ul><li>ichki band<\/li><\/ul><\/li>/.test(value));
    assert.ok(value.includes('<table>') && value.includes("1 000 000 so'm"));
  });

  await test('the export routes send .docx, not HTML as .doc', () => {
    const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'drafting', 'routes.js'), 'utf8');
    assert.ok(/const docx = await htmlToDocx\(stripEmbeddedFonts\(body\), \{ title, lang \}\);/.test(routes));
    assert.ok(/filename="\$\{baseName\}\.docx"/.test(routes));
    const sender = routes.slice(routes.indexOf('async function sendExport'), routes.indexOf('async function sendExport') + 1500);
    assert.ok(!/application\/msword/.test(sender), 'the export sender no longer sends HTML as msword');
    assert.ok(/<title>\$\{String\(title\)\.replace\(/.test(routes), 'print page title escaped');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
