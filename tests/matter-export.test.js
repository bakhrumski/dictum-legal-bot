'use strict';

/**
 * A matter as a deck or a workbook (2026-10-28, roadmap stage 2): the .pptx
 * is a complete package (every part well-formed, every slide related), text
 * is escaped and cut, the deck says what it is; the .xlsx writes text, never
 * formulas. No AI, no network.
 *
 *   node tests/matter-export.test.js
 */

const assert = require('assert');
const JSZip = require('jszip');
const XLSX = require('xlsx');
const { buildPptx } = require('../src/exports/pptx');
const exp = require('../src/matters/export');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const M = { title: 'Pudratchi bilan nizo <&> "Alfa"\u0001', summary: 'Avans 120 000 000 so‘m.', status: 'open', updatedAt: '2026-10-28', items: [
  { kind: 'note', note: 'Sud majlisi 12-noyabr', createdAt: '2026-10-27' },
  { kind: 'note', note: '=HYPERLINK("http://x")', createdAt: '2026-10-27' },
  { kind: 'chat', title: 'Avans', available: true, createdAt: '2026-10-26' },
  { kind: 'agent_run', ref: 'r1', title: 'Jadval', workflow: 'tabular_review' },
  { kind: 'agent_run', ref: 'r2', title: 'Playbook', workflow: 'playbook_review' },
  { kind: 'agent_run', ref: 'r9', title: 'Boshqa akkaunt natijasi', workflow: 'tabular_review' },
] };
const R = {
  r1: { workflow: 'tabular_review', body: { columns: [{ id: 'c1', label: 'Summa' }], rows: Array.from({ length: 12 }, (_, i) => ({ name: `d${i}.pdf`, status: 'ok', cells: { c1: { answer: `${i} so‘m` } } })) } },
  r2: { workflow: 'playbook_review', body: { counts: { mos: 1, farq: 1 }, results: [{ status: 'farq', rule: { title: 'Narx' }, note: 'x', quote: 'q', suggestion: 's' }, { status: 'mos', rule: { title: 'Muddat' } }] } },
};

(async () => {
  console.log('matter export');

  await test('pptx: every part is well-formed XML, every slide is listed and related, 16:9', async () => {
    const zip = await JSZip.loadAsync(await exp.matterPptx(M, R));
    const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
    for (const n of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml', 'docProps/core.xml']) assert.ok(names.includes(n), n);
    const slides = names.filter(n => /^ppt\/slides\/slide\d+\.xml$/u.test(n));
    const ct = await zip.file('[Content_Types].xml').async('string');
    const pres = await zip.file('ppt/presentation.xml').async('string');
    assert.strictEqual((pres.match(/<p:sldId /gu) || []).length, slides.length);
    assert.match(pres, /<p:sldSz cx="12192000" cy="6858000"\/>/u);
    for (const sl of slides) {
      assert.ok(ct.includes(`/${sl}"`), `content type for ${sl}`);
      assert.ok(names.includes(sl.replace('slides/', 'slides/_rels/') + '.rels'));
    }
    for (const n of names) {
      const x = await zip.file(n).async('string');
      // well-formed enough for a strict parser: balanced tags, no raw control characters or bare "<" / "&"
      assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(x), `${n}: control character`);
      assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/u.test(x), `${n}: bare &`);
      const open = (x.match(/<[A-Za-z][^>]*[^/]>|<[A-Za-z]>/gu) || []).filter(t => !t.startsWith('<?')).length;
      const close = (x.match(/<\/[^>]+>/gu) || []).length;
      assert.strictEqual(open, close, `${n}: tags balanced`);
    }
  });

  await test('deck content: cover, contents, notes, one slide per own result (an unknown run is skipped), the closing note; the table cut to 9 rows and says the rest is in Excel', async () => {
    const slides = exp.slidesOf(M, R);
    assert.deepStrictEqual(slides.map(s => s.kicker), ['Ish bo‘yicha qisqa taqdimot', 'Umumiy', 'Yozuvlar', 'Jadvalli tahlil', 'Playbook tekshiruvi', 'Chatlar', 'Eslatma']);
    const table = slides[3];
    assert.strictEqual(table.table.rows.length, 12);
    assert.match(table.note, /dastlabki 9 tasi; to‘liq jadval Excel faylida/u);
    assert.deepStrictEqual(slides[4].bullets.map(b => b.text), ['Narx — Farq qiladi'], '"mos" is counted, not listed');
    assert.match(slides[6].bullets[1], /yakuniy huquqiy xulosa emas/u);
    const zip = await JSZip.loadAsync(await buildPptx({ slides }));
    const s4 = await zip.file('ppt/slides/slide4.xml').async('string');
    assert.strictEqual((s4.match(/<a:tr /gu) || []).length, 10, 'header + 9 rows');
    const s1 = await zip.file('ppt/slides/slide1.xml').async('string');
    assert.ok(s1.includes('Pudratchi bilan nizo &lt;&amp;&gt; &quot;Alfa&quot;'), 'escaped');
  });

  await test('the legal answer slide takes the Xulosa part', () => {
    assert.strictEqual(exp.conclusion('**Tahlil**\n\nFK 333-modda.\n\n**Xulosa**\n\nAvval talabnoma yuboring.'), 'Avval talabnoma yuboring.');
  });

  await test('xlsx: the matter, its items, one sheet per table / playbook; text only, never a formula', () => {
    const wb = XLSX.read(exp.matterXlsx(M, R), { type: 'buffer' });
    assert.deepStrictEqual(wb.SheetNames, ['Ish', 'Elementlar', 'Jadval 1', 'Playbook 2']);
    const items = XLSX.utils.sheet_to_json(wb.Sheets.Elementlar, { header: 1 });
    assert.strictEqual(items.length, 7);
    const f = Object.values(wb.Sheets.Elementlar).filter(c => c && c.f);
    assert.deepStrictEqual(f, [], 'no formulas');
    assert.strictEqual(XLSX.utils.sheet_to_json(wb.Sheets['Jadval 1'], { header: 1 }).length, 13, 'the whole table');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
