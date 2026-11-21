'use strict';

/**
 * U5a (docs/design/ux-audit-2026-11.md): the editor's Word set 1 and "a card's
 * click marks its place".
 *   - the sanitizer keeps the editor's line spacing, indent and page break
 *     and nothing else of their kind;
 *   - the Word file carries them, sub / superscript, and the page number in
 *     the footer (a PAGE field) for the editor's export only;
 *   - the bundle has the new extensions; the page has the tools, find and
 *     replace, zoom and word count; the AI and check cards mark their place
 *     by a click (J.editorSpot, light blue), no separate "show" button.
 *
 *   node tests/editor-word-set1.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { cleanHtml } = require('../src/editor/sanitize');
const { htmlToDocx } = require('../src/drafting/html-to-docx');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
async function docxXml(html, opts) {
  const z = await JSZip.loadAsync(await htmlToDocx(html, opts));
  return { z, doc: await z.file('word/document.xml').async('string') };
}

(async () => {
  console.log('editor Word set 1 (U5a)');

  await test('sanitizer: line spacing 1 / 1.15 / 1.5 / 2 and a cm indent on paragraphs and headings; a page break; nothing else', () => {
    const out = cleanHtml('<p style="line-height: 1.5; margin-left: 2.5cm; text-align: justify">a<sub>2</sub><sup>3</sup></p>' +
      '<h2 style="line-height: 2">H</h2><hr data-page-break="1" class="ed-pb" onclick="x()"><hr>' +
      '<p style="line-height: 9; margin-left: 20cm">b</p><p style="margin-left: 3px; line-height: 150%">c</p><li style="margin-left: 1cm">x</li>');
    assert.ok(out.includes('<p style="line-height: 1.5; margin-left: 2.5cm; text-align: justify">a<sub>2</sub><sup>3</sup></p>'));
    assert.ok(out.includes('<h2 style="line-height: 2">H</h2>'));
    assert.ok(out.includes('<hr data-page-break="1"><hr>'), 'the break keeps only its own attribute');
    assert.ok(out.includes('<p>b</p>') && out.includes('<p>c</p>'), 'values outside the list are dropped');
    assert.ok(out.includes('<li>x</li>'), 'not on list items');
  });

  await test('Word: line spacing, indent, a page break, sub / superscript', async () => {
    const { doc } = await docxXml('<p style="line-height: 1.5; margin-left: 2.5cm">a<sub>2</sub><sup>3</sup></p><hr data-page-break="1"><h2 style="line-height: 2">H</h2><hr><p>tail</p>');
    assert.ok(doc.includes('<w:spacing w:line="360" w:lineRule="auto"/><w:ind w:left="1418"/>'), 'spacing before ind (schema order)');
    assert.ok(doc.includes('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'));
    assert.ok(doc.includes('<w:pStyle w:val="Heading2"/><w:spacing w:line="480" w:lineRule="auto"/>'));
    assert.ok(doc.includes('<w:vertAlign w:val="subscript"/>') && doc.includes('<w:vertAlign w:val="superscript"/>'));
    assert.ok(doc.includes('<w:pBdr><w:bottom'), 'a plain rule stays a rule');
  });

  await test('Word: the page number only when asked (the editor), as a PAGE field in the footer', async () => {
    const plain = await docxXml('<p>x</p>');
    assert.ok(!plain.z.file('word/footer1.xml') && !plain.doc.includes('footerReference'), 'drafts and opinions unchanged');
    const { z, doc } = await docxXml('<p>x</p>', { pageNumbers: true });
    const footer = await z.file('word/footer1.xml').async('string');
    assert.ok(footer.includes('<w:instrText xml:space="preserve"> PAGE </w:instrText>'));
    assert.ok(doc.includes('<w:sectPr><w:footerReference w:type="default" r:id="rId4"/><w:pgSz'), 'first in sectPr');
    assert.ok((await z.file('word/_rels/document.xml.rels').async('string')).includes('Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"'));
    assert.ok((await z.file('[Content_Types].xml').async('string')).includes('PartName="/word/footer1.xml"'));
    assert.ok(read('src', 'editor', 'routes.js').includes('pageNumbers: true'));
  });

  await test('the legal layout keeps its first-line indent unless the editor set an indent', async () => {
    const legal = await docxXml('<p>a</p><p style="margin-left: 1.25cm">b</p>', { legal: true });
    assert.ok(legal.doc.includes('<w:ind w:firstLine="567"/>'));
    assert.ok(legal.doc.includes('<w:ind w:left="709"/>'));
  });

  await test('bundle: sub / superscript, paragraph format, page break and the page\'s own highlights; versioned b=4; licences listed', () => {
    const entry = read('public', 'vendor', 'editor', 'entry.js');
    for (const k of ["import Subscript from '@tiptap/extension-subscript'", "import Superscript from '@tiptap/extension-superscript'", "name: 'paragraphFormat'",
      "name: 'pageBreak'", "tag: 'hr[data-page-break]'", "name: 'jaiSpots'", 'setFindRanges', 'setSpot', 'Subscript, Superscript, ParagraphFormat, PageBreak, Spots']) assert.ok(entry.includes(k), k);
    assert.ok(/setTextSelection\(at\)/.test(entry), 'a page break never replaces the selected words');
    const bundle = read('public', 'vendor', 'editor', 'editor-3.31.4.js');
    for (const k of ['jaiSpots', 'paragraphFormat', 'data-page-break', 'superscript']) assert.ok(bundle.includes(k), 'built: ' + k);
    assert.ok(read('public', 'app', 'editor.js').includes("editor-3.31.4.js?b=4'"));
    const lic = read('public', 'vendor', 'editor', 'LICENSES.txt');
    assert.ok(lic.includes('@tiptap/extension-subscript@3.31.4 MIT') && lic.includes('@tiptap/extension-superscript@3.31.4 MIT'));
  });

  await test('page: the tools, find (Ctrl+F) and replace (Ctrl+H, editors only), zoom kept per browser, words and pages', () => {
    const ed = read('public', 'app', 'editor.js');
    for (const c of ["btn('sub'", "btn('sup'", 'data-c="line"', "btn('outdent'", "btn('indent'", "btn('pagebreak'", "btn('clear'", "btn('find'"]) assert.ok(ed.includes(c), c);
    assert.ok(/k === 'f' \|\| e\.code === 'KeyF'\) \{ e\.preventDefault\(\); FIND\.open\(false\); \}/.test(ed));
    assert.ok(/\(k === 'h' \|\| e\.code === 'KeyH'\) && canWrite/.test(ed));
    assert.ok(ed.includes("localStorage.setItem('jai-ed-zoom'"));
    assert.ok(ed.includes("s('words', {") && ed.includes("$$('hr[data-page-break]', paper)"), 'words; pages count the breaks');
    assert.ok(/if \(b\.dataset\.c === 'find'\) return;/.test(ed), 'a reader still finds');
    const find = read('public', 'app', 'editor-find.js');
    assert.ok(find.includes('ed.commands.setFindRanges(list, cur)'), 'hits are decorations, never in the text');
    assert.ok(/for \(var i = all\.length - 1; i >= 0; i--\) p\.tr\.insertText/.test(find), 'replace all: one step, from the end');
    assert.ok(/o\.canWrite \? '<div class="ed-frow ed-frep"/.test(find), 'replace only for editors');
    assert.ok(/<script src="\/app\/editor-find\.js\?v=\d+"><\/script>\s*<script src="\/app\/editor\.js/.test(read('public', 'app', 'index.html')));
  });

  await test('cards: a click marks the place in light blue (J.editorSpot), no separate "show" button', () => {
    const ed = read('public', 'app', 'editor.js');
    assert.ok(ed.includes('J.editorSpot = function (ed, range, side)'));
    assert.ok(/clearSpot\(\); \} \}\);/.test(ed), 'the spot goes when the person clicks elsewhere');
    for (const f of ['editor-ai.js', 'editor-check.js']) {
      const src = read('public', 'app', f);
      assert.ok(!src.includes('data-a="show"'), f + ': no show button');
      assert.ok(src.includes('J.editorSpot(ed, '), f);
      assert.ok(/addEventListener\('click', function \(e\) \{ if \(e\.target\.closest\('button, a/.test(src), f + ': the card, not its buttons');
    }
    const css = read('public', 'app', 'app.css');
    assert.ok(css.includes('.ed-doc .ed-spot{background:#DCE8FD'), 'light blue (owner\'s rule)');
    assert.ok(/break-after:page/.test(css), 'a page break is a new page in print');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
