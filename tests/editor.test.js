'use strict';

/**
 * The document editor, D1 (docs/design/hujjat-muharriri.md): only the
 * editor's own markup is stored (scripts, event attributes, images and
 * unknown styles go, the text stays); a Word file opens with its headings,
 * bold, lists and tables, and what it could not keep is named; a text PDF
 * and a library document come in as paragraphs; the Word export keeps the
 * editor's colour, highlight, font and size; the page wiring stays.
 *
 *   node tests/editor.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { cleanHtml, textOf, textToHtml } = require('../src/editor/sanitize');
const { importFile, docxNotes } = require('../src/editor/import');
const { htmlToDocx } = require('../src/drafting/html-to-docx');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

(async () => {
  console.log('document editor (D1)');

  await test('only the editor\'s markup is kept: no script, event, image, frame or foreign style; the text stays', () => {
    const dirty = '<p onclick="x()" style="text-align: center; position: fixed; color: #c00000">Ijara <script>alert(1)</script><img src=x onerror=alert(1)>'
      + '<span style="font-family: Times New Roman; font-size: 14pt; background-color: rgb(255, 235, 59); behavior: url(x)">haqi</span> <a href="javascript:alert(1)">bu</a> <a href="https://lex.uz/docs/1">lex</a></p>'
      + '<iframe src="https://evil"></iframe><div>blok</div><h6>kichik</h6><table><tr><td colspan="2" onmouseover="x">A</td></tr></table><mark data-color="#c8e6c9">belgi</mark>';
    const out = cleanHtml(dirty);
    assert.ok(!/script|onerror|onclick|onmouseover|iframe|<img|javascript:|position|behavior/iu.test(out), out);
    assert.match(out, /<p style="text-align: center; color: #c00000">Ijara /u);
    assert.match(out, /font-family: Times New Roman; font-size: 14pt; background-color: rgb\(255, 235, 59\)/u);
    assert.match(out, /<a>bu<\/a>/u, 'a javascript link loses its href');
    assert.match(out, /<a href="https:\/\/lex\.uz\/docs\/1" rel="noopener noreferrer" target="_blank">lex<\/a>/u);
    assert.match(out, /<p>blok<\/p><h4>kichik<\/h4>/u);
    assert.match(out, /<td colspan="2">A<\/td>/u);
    assert.match(out, /<mark data-color="#c8e6c9">belgi<\/mark>/u);
    const evil = cleanHtml('<p><a href="https://a.uz/x&quot; onclick=&quot;alert(1)">x</a><a href=\'https://a.uz/" onclick="alert(1)\'>y</a><span style=\'font-family: x&quot; onmouseover &quot;\'>z</span></p>');
    assert.strictEqual(evil, '<p><a>x</a><a>y</a><span>z</span></p>', 'a quote or space in an href or a font name drops it - attributes are written raw');
    assert.strictEqual(textOf('<h1>ТАРТИБ</h1><p>1. Ijara</p><ul><li>a</li><li>b</li></ul>'), 'ТАРТИБ\n1. Ijara\na\nb');
  });

  await test('plain text (a library document, a text PDF) becomes paragraphs; our readers\' page and table marks go', () => {
    const html = textToHtml('=== PAGE 1 ===\n[Sahifa 1] IJARA SHARTNOMASI\n\n1. Ijarachi to‘laydi;\n2. Muddat 12 oy.\n⟦Jadval 1 · 1-qator⟧ <b>x</b>');
    assert.ok(!/PAGE|Sahifa|⟦/u.test(html), html);
    assert.match(html, /<p>IJARA SHARTNOMASI<\/p><p>1\. Ijarachi to‘laydi;<\/p><p>2\. Muddat 12 oy\.<\/p>/u);
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/u, 'text is text, never markup');
  });

  await test('a Word file opens with its headings, bold, lists and tables; what it cannot keep is named; a scan or a .doc is refused', async () => {
    const src = '<h1 style="text-align: center">ТАРТИБ</h1><p style="text-align: justify">Oddiy <strong>qalin</strong> matn</p><ol><li>birinchi</li><li>ikkinchi</li></ol><table><tr><td>A</td><td>B</td></tr></table>';
    const buf = await htmlToDocx(src, { title: 'Sinov' });
    const r = await importFile(buf, { fileName: 'tartib.docx' });
    assert.ok(!r.error, r.error);
    assert.match(r.html, /<h1 style="text-align: center">ТАРТИБ<\/h1>/u, 'alignment kept');
    assert.match(r.html, /<p style="text-align: justify">Oddiy <strong>qalin<\/strong> matn<\/p>/u);
    assert.ok(!r.html.includes('\u2063'), 'no marker left');
    assert.match(r.html, /<strong>qalin<\/strong>/u);
    assert.match(r.html, /<ol><li><p>birinchi<\/p><\/li><li><p>ikkinchi<\/p><\/li><\/ol>|<ol><li>birinchi<\/li><li>ikkinchi<\/li><\/ol>/u);
    assert.match(r.html, /<table>[\s\S]*A[\s\S]*B[\s\S]*<\/table>/u);
    assert.deepStrictEqual(r.notes, []);
    // a Word file with a header, a comment and a tracked change: each named
    const zip = await JSZip.loadAsync(buf);
    const doc = await zip.file('word/document.xml').async('string');
    zip.file('word/document.xml', doc.replace('<w:body>', '<w:body><w:p><w:commentReference w:id="0"/><w:ins w:id="1"><w:r><w:t>yangi</w:t></w:r></w:ins></w:p>'));
    zip.file('word/header1.xml', '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>');
    assert.deepStrictEqual(await docxNotes(await zip.generateAsync({ type: 'nodebuffer' })), ['header_footer', 'comments', 'tracked_changes']);
    assert.strictEqual((await importFile(Buffer.from('not a zip'), { fileName: 'x.docx' })).error, 'corrupt');
    assert.strictEqual((await importFile(Buffer.from('x'), { fileName: 'x.doc' })).error, 'type');
    const scanned = await importFile(Buffer.from('%PDF'), { fileName: 'x.pdf', extractFileText: async () => ({ scanned: true }) });
    assert.strictEqual(scanned.error, 'scanned');
    const pdf = await importFile(Buffer.from('%PDF'), { fileName: 'x.pdf', extractFileText: async () => ({ text: '[Sahifa 1] Matn bor.', pages: 1 }) });
    assert.deepStrictEqual([pdf.html, pdf.notes], ['<p>Matn bor.</p>', ['pdf_layout']]);
  });

  await test('the Word export keeps the editor\'s colour, highlight, font and size', async () => {
    const buf = await htmlToDocx('<p><span style="color: #c00000; font-family: Times New Roman; font-size: 14pt">qizil</span> <mark data-color="#c8e6c9">belgi</mark> <span style="background-color: rgb(255, 235, 59)">fon</span></p>');
    const x = await (await JSZip.loadAsync(buf)).file('word/document.xml').async('string');
    assert.match(x, /<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"\/><w:color w:val="C00000"\/><w:sz w:val="28"\/>/u);
    assert.match(x, /<w:shd w:val="clear" w:color="auto" w:fill="C8E6C9"\/>/u);
    assert.match(x, /<w:shd w:val="clear" w:color="auto" w:fill="FFEB3B"\/>/u);
  });

  await test('wiring: routes, the editor bundle (MIT, versioned), entry points from drafts and Hujjatlarim, PDF by print', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../src/editor/routes.js'), 'utf8');
    for (const r of ["'/api/editor/docs'", "'/api/editor/import'", "'/api/editor/docs/:id/export.docx'", "'/api/editor/docs/:id/versions/:n/restore'"]) assert.ok(routes.includes(r), r);
    assert.match(fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8'), /require\('\.\.\/editor\/routes'\)\.mountEditorRoutes/u);
    assert.match(fs.readFileSync(path.join(__dirname, '../src/services/account-deletion.js'), 'utf8'), /editor\/store'\)\.deleteAccountDocuments/u);
    const lic = fs.readFileSync(path.join(__dirname, '../public/vendor/editor/LICENSES.txt'), 'utf8').trim().split('\n');
    assert.ok(lic.length > 20 && lic.every(l => / MIT$/u.test(l)), 'every bundled package is MIT');
    const page = fs.readFileSync(path.join(__dirname, '../public/app/editor.js'), 'utf8');
    assert.match(page, /\/vendor\/editor\/editor-3\.31\.4\.js/u);
    assert.match(page, /G\.print\(\)/u);
    assert.match(page, /x\.status === 409/u, 'a stale save stops and says so');
    assert.match(fs.readFileSync(path.join(__dirname, '../public/app/views.js'), 'utf8'), /J\.openInEditor\(title, \$\('\.doc', body\)\.innerHTML\)/u);
    assert.match(fs.readFileSync(path.join(__dirname, '../public/app/library.js'), 'utf8'), /J\.editorDocsBlock\(\$\('\.lib-ed', v\)\)/u);
    assert.match(fs.readFileSync(path.join(__dirname, '../public/app/index.html'), 'utf8'), /<script src="\/app\/editor\.js\?v=\d+"><\/script>/u);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
