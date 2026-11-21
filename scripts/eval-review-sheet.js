#!/usr/bin/env node
'use strict';

/**
 * The lawyer's review of the evaluation sets as a spreadsheet, not JSON
 * (2026-11-10, audit X7 / G1, docs/quality/answer-eval.md). Never loaded by
 * the server; no network, no AI.
 *
 *   node scripts/eval-review-sheet.js --set answer|agent --out <file.xlsx>      the cases as a sheet to fill in
 *   node scripts/eval-review-sheet.js --set answer|agent --apply <file.xlsx>    what the sheet would change (nothing written)
 *   node scripts/eval-review-sheet.js --set answer|agent --apply <file.xlsx> --write
 *
 * A row becomes reviewed only with "ha" in the confirmation column and the
 * lawyer's name (the answer set also needs the short right answer); a row
 * left unconfirmed keeps its edits and stays unreviewed. An act the sheet
 * names anew is matched by its own name until someone adds better words.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const SETS = {
  answer: { file: path.join(__dirname, '../docs/quality/answer-eval/cases.json'), text: 'question', needsGold: true },
  agent: { file: path.join(__dirname, '../docs/quality/agent-eval/cases.json'), text: 'task', needsGold: false },
};
const COLS = ['ID', 'Mavzu', 'Savol', 'Kutilgan aktlar (har biri alohida qatorda)', "Moddalar (raqamlar, vergul bilan)", "Javobda bo'lishi shart (har biri alohida qatorda; a|b = a yoki b)",
  "Javobda bo'lmasligi kerak (har biri alohida qatorda)", "To'g'ri javobning qisqa mazmuni", "Tasdiqlayman (ha / yo'q)", 'Yurist (F.I.Sh.)', 'Sana (YYYY-MM-DD)', 'Izoh'];
const HELP = [
  ["Bu jadval JuristAI javoblarini o'lchash uchun savollar to'plami. Har bir qator - bitta savol."],
  ["1. Savolni o'qing; noaniq bo'lsa, matnini to'g'rilang."],
  ["2. \"Kutilgan aktlar\": to'g'ri javob tayanishi kerak bo'lgan qonun hujjatlari (nomi). Ortiqchasini o'chiring, yetishmaganini qo'shing."],
  ["3. \"Moddalar\": javobda albatta ko'rsatilishi kerak bo'lgan modda / band raqamlari (masalan: 161, 164). Ishonchingiz komil bo'lmasa bo'sh qoldiring."],
  ["4. \"Javobda bo'lishi shart\": to'g'ri javobda albatta uchraydigan so'z yoki ibora (muddat, organ, istisno). Hozirgi yozuvlar - qoralama."],
  ["5. \"Javobda bo'lmasligi kerak\": xato javobning belgisi bo'lgan ibora (masalan: \"imtiyoz yo'q\")."],
  ["6. \"To'g'ri javobning qisqa mazmuni\": 2-4 gap. Bu hisobotda javob yonida ko'rsatiladi."],
  ["7. Qatorni tasdiqlasangiz: \"ha\", ismingiz va sana. Tasdiqlanmagan qator sifat xulosasiga kirmaydi."],
  ["ID ustunini o'zgartirmang. Yangi savol qo'shish uchun yangi qator va yangi ID (bitta harf + ikki raqam, masalan M11) yozing."],
];

const lines = v => String(v == null ? '' : v).split(/\r?\n/u).map(s => s.trim()).filter(Boolean);
const yes = v => /^(ha|ҳа|да|yes|\+|1|true)$/iu.test(String(v == null ? '' : v).trim());

function toSheet(set) {
  const S = SETS[set];
  const data = JSON.parse(fs.readFileSync(S.file, 'utf8'));
  const rows = [COLS].concat(data.cases.map(c => [c.id, c.topic || '', c[S.text] || '', (c.expect.acts || []).map(a => a.label).join('\n'), (c.expect.articles || []).join(', '),
    (c.expect.mustSay || []).join('\n'), (c.expect.mustNotSay || []).join('\n'), c.gold || '', c.reviewed ? 'ha' : '', c.reviewer || '', c.reviewedAt || '', c.reviewNote || '']));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // every cell is text: a lawyer's "1." or "=..." is words, never a number or a formula
  for (const k of Object.keys(ws)) if (k[0] !== '!') { ws[k].t = 's'; ws[k].v = String(ws[k].v == null ? '' : ws[k].v); delete ws[k].f; }
  ws['!cols'] = [6, 14, 60, 34, 16, 34, 30, 60, 12, 20, 14, 30].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, 'Savollar');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(HELP), "Yo'riqnoma");
  return wb;
}

/** The sheet's rows over the set's cases. Returns { data, changes: [{ id, what: [...] }], errors: [...] }. */
function applyRows(set, rows, today = new Date().toISOString().slice(0, 10)) {
  const S = SETS[set];
  const data = JSON.parse(fs.readFileSync(S.file, 'utf8'));
  const byId = new Map(data.cases.map(c => [c.id, c]));
  const known = new Map();
  for (const c of data.cases) for (const a of c.expect.acts || []) known.set(a.label.trim().toLocaleLowerCase('uz'), a);
  const changes = [], errors = [];
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const r of rows) {
    const [id, topic, text, acts, arts, say, not, gold, ok, who, when, note] = COLS.map((_, i) => String(r[i] == null ? '' : r[i]).trim());
    if (!id || id === 'ID') continue;
    if (!/^[A-Z]\d{2}$/u.test(id)) { errors.push(`${id}: ID bitta harf va ikki raqam bo'lishi kerak`); continue; }
    let c = byId.get(id);
    const what = [];
    if (!c) {
      if (text.length < 10) { errors.push(`${id}: yangi savol matni juda qisqa`); continue; }
      c = { id, topic: topic || 'boshqa', [S.text]: text, expect: { acts: [], mustSay: [], mustNotSay: [] }, reviewed: false };
      if (set === 'answer') { c.lang = /[а-яё]/iu.test(text) ? (/[ўқғҳ]/iu.test(text) ? 'cyr' : 'ru') : 'uz'; c.expect.articles = []; c.gold = ''; }
      else c.expect.askUser = false;
      data.cases.push(c); byId.set(id, c); what.push('yangi savol');
    }
    const put = (obj, key, val, label) => { if (!eq(obj[key] == null ? (Array.isArray(val) ? [] : '') : obj[key], val)) { obj[key] = val; what.push(label); } };
    if (topic) put(c, 'topic', topic, 'mavzu');
    if (text.length >= 10) put(c, S.text, text, 'savol matni');
    // an act the case already has keeps its own match words and ids; a known label takes them from another case
    const own = new Map((c.expect.acts || []).map(x => [x.label.trim().toLocaleLowerCase('uz'), x]));
    const actList = lines(acts).map((l) => { const k = l.toLocaleLowerCase('uz'); return own.get(k) || known.get(k) || { label: l, match: [k] }; });
    put(c.expect, 'acts', actList, 'aktlar');
    if (set === 'answer') put(c.expect, 'articles', arts.split(/[,;\n]+/u).map(s => (s.match(/\d+(?:-\d+)?/u) || [''])[0]).filter(Boolean), 'moddalar');
    for (const [key, cell, label] of [['mustSay', say, "bo'lishi shart"], ['mustNotSay', not, "bo'lmasligi kerak"]]) {
      const list = lines(cell);
      const bad = list.filter((p) => { try { new RegExp(p, 'u'); return false; } catch (_) { return true; } });
      if (bad.length) { errors.push(`${id}: iborani o'qib bo'lmadi (maxsus belgi?): ${bad.join('; ')}`); continue; }
      put(c.expect, key, list, label);
    }
    if (set === 'answer' || gold) put(c, 'gold', gold, "to'g'ri javob mazmuni");
    if (note || c.reviewNote) put(c, 'reviewNote', note, 'izoh');
    const confirmed = yes(ok);
    if (confirmed && !who) errors.push(`${id}: tasdiqlangan, lekin yurist ismi yo'q - tasdiqlanmagan deb qoldirildi`);
    else if (confirmed && S.needsGold && !gold) errors.push(`${id}: tasdiqlangan, lekin to'g'ri javob mazmuni yo'q - tasdiqlanmagan deb qoldirildi`);
    const reviewed = confirmed && !!who && (!S.needsGold || !!gold);
    if (reviewed) {
      const date = /^\d{4}-\d{2}-\d{2}$/u.test(when) ? when : today;
      if (!c.reviewed || c.reviewer !== who || c.reviewedAt !== date) { c.reviewed = true; c.reviewer = who; c.reviewedAt = date; what.push('tasdiqlandi'); }
    } else if (c.reviewed) { c.reviewed = false; delete c.reviewer; delete c.reviewedAt; what.push('tasdiq olib tashlandi'); }
    if (what.length) changes.push({ id, what });
  }
  return { data, changes, errors };
}

function readRows(file) {
  const wb = XLSX.readFile(file, { cellFormula: false });
  const ws = wb.Sheets.Savollar || wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
}

function main(argv = process.argv.slice(2)) {
  const a = { set: null, out: null, apply: null, write: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--set') a.set = argv[++i];
    else if (argv[i] === '--out') a.out = argv[++i];
    else if (argv[i] === '--apply') a.apply = argv[++i];
    else if (argv[i] === '--write') a.write = true;
  }
  if (!SETS[a.set] || (!a.out && !a.apply)) { console.error('usage: --set answer|agent (--out <file.xlsx> | --apply <file.xlsx> [--write])'); return 2; }
  if (a.out) { XLSX.writeFile(toSheet(a.set), a.out); console.log(`written: ${a.out}`); return 0; }
  const { data, changes, errors } = applyRows(a.set, readRows(a.apply));
  // the result must still be a file the runner accepts
  const check = a.set === 'answer' ? require('./answer-eval').checkCases : null;
  try { if (check) check(data.cases); } catch (e) { errors.push(`fayl yaroqsiz bo'lib qoladi: ${e.message}`); }
  const fatal = errors.some(e => /yaroqsiz/u.test(e));
  console.log(JSON.stringify({ set: a.set, rows: changes.length, reviewed: data.cases.filter(c => c.reviewed).length, of: data.cases.length, changes, errors, written: a.write && !fatal }, null, 2));
  if (a.write && !fatal) fs.writeFileSync(SETS[a.set].file, JSON.stringify(data, null, 1) + '\n');
  return fatal ? 1 : 0;
}

if (require.main === module) process.exit(main());

module.exports = { toSheet, applyRows, readRows, COLS, SETS };
