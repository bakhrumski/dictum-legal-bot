'use strict';

/**
 * Workspace uploads carry their text into the immutable version row, so
 * Workspace AI reads the document instead of "[Fayl matni indekslanmagan]"
 * (Astra audit D1).
 *
 *   node tests/workspace-extract-text.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { extractUploadText } = require('../src/workspace/extract-text');
const { htmlToDocx, DOCX_MIME } = require('../src/drafting/html-to-docx');

// Real PDFs printed by Chromium: one with a text layer, one with only a shape.
const FIXTURES = path.join(__dirname, 'fixtures');
const pdfFixture = (name) => fs.readFileSync(path.join(FIXTURES, name));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

(async () => {
  console.log('workspace text extraction');

  await test('plain text', async () => {
    const r = await extractUploadText(Buffer.from('Ijara shartnomasi\n\n\n\n1. Ijara haqi oyiga 5 000 000 so\'m.'), 'text/plain');
    assert.strictEqual(r.status, 'indexed');
    assert.ok(r.text.includes('Ijara haqi') && !/\n{3,}/.test(r.text));
  });

  await test('DOCX (as our own export writes it)', async () => {
    const docx = await htmlToDocx('<h2>Ijara shartnomasi</h2><p>Ijarachi har oyning 5-sanasigacha to\'laydi.</p><table><tr><td>Summa</td><td>5 000 000</td></tr></table>');
    const r = await extractUploadText(docx, DOCX_MIME);
    assert.strictEqual(r.status, 'indexed');
    assert.ok(r.text.includes('Ijarachi har oyning') && r.text.includes('5 000 000'));
  });

  await test('PDF with a text layer', async () => {
    const r = await extractUploadText(pdfFixture('text-layer.pdf'), 'application/pdf');
    assert.strictEqual(r.status, 'indexed', JSON.stringify(r));
    assert.ok(r.text.includes('Ijara shartnomasi'));
  });

  await test('a PDF with no real text (like a scan) is stored without text, marked empty', async () => {
    const r = await extractUploadText(pdfFixture('no-text.pdf'), 'application/pdf');
    assert.deepStrictEqual(r, { text: null, status: 'empty' });
  });

  await test('images and old formats are uploaded unindexed; a broken file never throws', async () => {
    assert.strictEqual((await extractUploadText(Buffer.from([0xff, 0xd8]), 'image/jpeg')).status, 'unsupported');
    assert.strictEqual((await extractUploadText(Buffer.from('not a pdf'), 'application/pdf')).status, 'failed');
  });

  await test('the upload writes the text into the version it creates', () => {
    const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'workspace', 'routes.js'), 'utf8');
    assert.ok(/const extracted = await extractUploadText\(req\.file\.buffer, req\.file\.mimetype\);/.test(routes));
    assert.ok(/\(id,workspace_id,document_id,version_number,content_text,created_by\)\s*VALUES \(\$1,\$2,\$3,1,\$4,\$5\)/.test(routes));
    assert.ok(/textIndex: extracted\.status/.test(routes));
  });

  await test('D2: every document gets a fair share, relevant ones first, relevant passages kept', () => {
    const { documentContextBlocks } = require('../src/workspace/ai-service');
    const filler = (w) => Array.from({ length: 400 }, (_, i) => `${w} band ${i}: umumiy qoidalar va tartib matni shu yerda.`).join('\n\n');
    const docs = [
      { title: 'Nizom', version_number: 1, content_text: filler('Nizom') },                       // long, unrelated, newest
      { title: 'Shartnoma', version_number: 2, content_text: filler('Shartnoma') + '\n\nIjara haqi oyiga 5 000 000 so\'m, har oyning 5-sanasigacha to\'lanadi.' },
      { title: 'Xat', version_number: 1, content_text: 'Ijarachi ijara haqini kechiktirdi.' },
    ];
    const blocks = documentContextBlocks(docs, 'Ijara haqi qancha va qachon to\'lanadi?');
    const all = blocks.join('');
    assert.strictEqual(blocks.length, 3, 'all documents present');
    assert.ok(all.length <= 30000);
    assert.ok(!blocks[0].startsWith('HUJJAT: Nizom'), 'the unrelated document is not first');
    assert.ok(all.includes('Ijara haqi oyiga 5 000 000'), 'the relevant paragraph deep in a long document is kept');
    assert.ok(all.includes('Ijarachi ijara haqini kechiktirdi'));
    const nizom = blocks.find(b => b.startsWith('HUJJAT: Nizom'));
    assert.ok(nizom.length < 8000, 'a long unrelated document no longer takes the whole context');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
