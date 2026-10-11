#!/usr/bin/env node
'use strict';

/**
 * Why a DOCX's tables were read as loose lines (structure 'lost'): run on
 * the file itself, locally, with no AI and no network. It reads the same
 * way the server does (src/ocr/docx-text.js) and prints the structures
 * around each word the table reader missed (content controls, tracked
 * changes, special hyphens, text boxes ...) and where those words stand.
 *
 *   node scripts/docx-table-check.js contract.docx           # report
 *   node scripts/docx-table-check.js contract.docx --codes   # structure codes only, no document words
 *
 * The report shows the document's own words: keep it on your machine; do
 * not paste it into an issue or the repository. A structure found around a
 * missing word is the likely cause, not a proof.
 */
const fs = require('fs');
const { docxText, missingPlaces, STRUCTURE_CODES } = require('../src/ocr/docx-text');

async function main() {
  const file = process.argv[2];
  const codesOnly = process.argv.includes('--codes');
  if (!file || !fs.existsSync(file)) {
    console.error('usage: node scripts/docx-table-check.js <file.docx> [--codes]');
    process.exit(2);
  }
  const d = await docxText(fs.readFileSync(file));
  console.log(`jadvallar: ${d.tables} · o'quvchi: ${d.reader} · tuzilish: ${d.structure}`);
  if (d.wordCheck) console.log(`so'z tekshiruvi: ${d.wordCheck.missing} / ${d.wordCheck.words} so'z jadval o'quvchisida topilmadi`);
  // words that differ only where a space or a line break falls (e.g. mammoth
  // drops a w:br: "shartnomaga<br/>1-ilova" -> "shartnomaga1-ilova"): not lost
  const sepOnly = d.separatorOnly || (d.diagnosis && d.diagnosis.separatorOnly) || [];
  if (sepOnly.length) {
    console.log(`\nfaqat ajratgich farqi (matn yo'qolishi emas): ${sepOnly.reduce((n, e) => n + e.count, 0)} ta`);
    if (!codesOnly) for (const e of sepOnly) console.log(`  ${e.side === 'mammoth_joined' ? 'mammoth' : "jadval o'quvchisi"}: «${e.word}» = ${e.parts.map(x => `«${x}»`).join(` + ${e.separator === 'line_break' ? 'qator chegarasi' : e.separator === 'tab' ? 'tab' : "bo'shliq"} + `)}${e.count > 1 ? ` (${e.count} marta)` : ''}`);
  }
  if (d.structure !== 'lost') { console.log(d.structure === 'rows' ? "Jadvallar qatorlab o'qildi (fallback yo'q)." : "Hujjatda jadval yo'q."); return; }
  console.log('\nsabablar (topilmagan so\'zlar atrofidagi tuzilmalar):');
  for (const c of d.causes) console.log(`  ${c}: ${STRUCTURE_CODES[c] || "noma'lum tuzilma"}`);
  console.log('\nbutun hujjatdagi tuzilmalar soni:', JSON.stringify(d.diagnosis.census));
  if (codesOnly) return;
  const places = missingPlaces(d.text, d.diagnosis.missingWords.map(m => m.word));
  console.log('\ntopilmagan so\'zlar (hujjat matni — kompyuteringizda saqlang):');
  for (const m of d.diagnosis.missingWords) {
    console.log(`  «${m.word}» kutilgan ${m.expected}, topilgan ${m.found}${m.inTable ? ', jadvalda' : ''} — ${m.structures.join(', ')}`);
    for (const p of places[m.word] || []) console.log(`      … ${p} …`);
  }
  if (d.diagnosis.more) console.log(`  … yana ${d.diagnosis.more} ta so'z`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
