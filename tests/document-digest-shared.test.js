'use strict';

/**
 * The digest and the page marks are shared: the legal opinion and the chat's
 * document analysis read the same digest as the explanation, and the chat's
 * clause excerpts read the same page-marked text (2026-10-07, #419). These
 * are their regression checks - mechanical, stub AI, no paid call; they do
 * not judge the quality of an opinion or an answer.
 *
 *   node tests/document-digest-shared.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ex = require('../src/rag/document-explain');
const dj = require('../src/rag/document-job');
const { scanBareReferences } = require('../src/rag/lex-resolve');
const { loadAll } = require('./fixtures/explain-eval/load');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
const opinion = server.slice(server.indexOf("app.post('/api/draft/legal-opinion', requireAuth"), server.indexOf("app.post('/api/draft/legal-opinion/rate'"));
const chat = server.slice(server.indexOf('const rawDoc = (typeof req.body.documentText'), server.indexOf('const hasDocument = docContext.length > 0;'));

// a contract of numbered clauses over 12 pages; clause 40 holds the answer
function contract() {
  const pages = [];
  for (let p = 0; p < 12; p++) {
    let t = '';
    for (let k = 1; k <= 6; k++) {
      const n = p * 6 + k;
      t += `${n}. Band ${n} matni. ${'Tomonlar majburiyatlari haqida umumiy qoida. '.repeat(8)}`
        + (n === 40 ? "Ijarachi 41-bandda nazarda tutilgan hollardan tashqari kompensatsiya to'laydi." : '')
        + (n === 41 ? "Fors-major holatida kompensatsiya qo'llanilmaydi." : '') + '\n';
    }
    pages.push(t);
  }
  return pages;
}

(async () => {
  console.log('shared digest and page marks: legal opinion and chat (mechanical):');

  await test('opinion: the bare references found in the raw text are the same with and without page marks', () => {
    const pages = [
      "Vazirlar Mahkamasining 2019-yil 12-apreldagi 306-sonli qarori bilan tasdiqlangan Nizomga ko'ra (306, 7–12-m.; 684), tender o'tkaziladi.",
      "O'zbekiston Respublikasi Fuqarolik kodeksining 333-moddasi va Prezidentning PQ-4611-son qarori asosida. 16-sonlili buyruq.",
    ];
    const plain = pages.join('\n\n');
    const marked = ex.markPages(pages);
    const key = refs => refs.map(r => `${r.number || ''}|${r.name || ''}`).sort();
    assert.deepStrictEqual(key(scanBareReferences(marked)), key(scanBareReferences(plain)));
    assert.ok(scanBareReferences(marked).length >= 2);
  });

  await test('opinion: the shared digest keeps its law references, names its parts with pages, and names a part not read', async () => {
    assert.ok(/qonun, kodeks, VM qarori, farmon/u.test(ex.DIGEST_SYSTEM), 'the opinion still gets every reference to an act');
    const text = ex.markPages(loadAll().find(f => f.id === 'long-lease').pages);
    const d = await ex.buildDigest(text, { callAI: async (m) => {
      if (/^Excerpt 3\//u.test(m[1].text)) throw new Error('down');
      return { text: '- band (2-sahifa)', provider: 'stub' };
    } });
    assert.ok(d.text.startsWith('HUJJAT DAYJESTI'));
    assert.ok(/\[Qism 1\/\d+ · 1–\d+-sahifa\]/u.test(d.text));
    assert.ok(/\[Qism 3\/\d+ · \d+–\d+-sahifa\]\n\(BU QISM O'QILMADI/u.test(d.text));
    assert.deepStrictEqual(ex.unreadParts(d).length, 1);
    assert.ok(/^3-qism \(\d+–\d+-sahifa\)$/u.test(ex.unreadParts(d)[0]));
    assert.deepStrictEqual(ex.unreadParts(null), []);
  });

  await test('opinion route: a digest with parts not read releases the units, tells the model, and opens the opinion with it', () => {
    assert.ok(opinion.includes('const docDigest = await digestLongDocumentDetailed(documentText, req.session?.adminId || null);'));
    assert.ok(/if \(unreadParts\.length\) \{[\s\S]{0,200}tariffModule\.refundUsage\(res, 'digest_partial_read'\)/u.test(opinion));
    assert.ok(opinion.includes("O'QILMAGAN QISMLAR: ${unreadParts.join(', ')}"));
    assert.ok(opinion.includes("<strong>⚠️ Qisman xulosa — to'liq emas:</strong>"));
    assert.ok(opinion.includes('partial: unreadParts.length > 0, unreadParts,'));
    assert.ok(!opinion.includes("(yoki uning to'liq dayjesti)"), 'a digest is not called the full document');
    // references are still read from the raw text before the digest, and
    // the corpus query uses the document's own words, not the page marks
    assert.ok(opinion.indexOf('scanBareReferences(documentText)') < opinion.indexOf('digestLongDocumentDetailed('));
    assert.ok(opinion.includes("docHead.slice(0, 220)") && opinion.includes("docHead.slice(0, 300)"));
    assert.ok(!/documentText\.slice\(0, (220|300)\)/u.test(opinion));
  });

  await test('chat document analysis: same rule - parts not read release the units and the note says partial', () => {
    assert.ok(chat.includes('contentChars(rawDoc) > 30000 ? await digestLongDocumentDetailed(rawDoc'));
    assert.ok(/if \(unread\.length && typeof tariffModule\.refundUsage === 'function'\) tariffModule\.refundUsage\(res, 'digest_partial_read'\);/u.test(chat));
    const scope = { mode: 'document', services: ['analysis'], units: 2, excerpt: false, unread: ['2-qism (5–8-sahifa)'] };
    assert.ok(dj.excerptNote(scope).startsWith("⚠️ Qisman natija — to'liq tahlil emas: hujjatning 2-qism (5–8-sahifa) o'qilmadi. Limit qaytarildi"));
    assert.ok(dj.excerptInstruction(scope).includes("hujjatning bir qismi o'qilmadi (2-qism (5–8-sahifa))"));
    assert.ok(dj.excerptInstruction(scope, 'ru').includes('часть документа не прочитана'));
    // a full reading keeps the old note
    assert.ok(dj.excerptNote({ ...scope, unread: [] }).startsWith('✅ Hujjat tahlili: 2 birlik'));
    const page = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf8');
    assert.ok(page.includes("(data.documentScope.insufficient || (data.documentScope.unread && data.documentScope.unread.length)) ? ' doc-scope-warn'"));
  });

  await test('chat excerpts: the same clauses with or without page marks, each under the page it starts on', () => {
    const pages = contract();
    const marked = ex.markPages(pages);
    const plain = pages.map(p => p.trim()).join('\n\n');
    const q = "kompensatsiya qachon to'lanadi";
    const a = dj.selectExcerpt(marked, q), b = dj.selectExcerpt(plain, q);
    assert.ok(a.excerpt && b.excerpt);
    assert.deepStrictEqual([a.matched, a.referenced, a.missingReferences, a.insufficient], [b.matched, b.referenced, b.missingReferences, b.insufficient]);
    assert.strictEqual(a.totalChars, b.totalChars, 'the size is the document\'s own');
    const pieces = a.text.split('\n[…]\n').slice(1);
    const c40 = pieces.find(p => /\n40\. Band 40/u.test(p) || /^\[Sahifa \d+\]\n40\./u.test(p));
    assert.ok(c40 && c40.startsWith('[Sahifa 7]\n40.'), String(c40).slice(0, 40));
    const c41 = pieces.find(p => /41\. Band 41/u.test(p));
    assert.ok(c41 && c41.startsWith('[Sahifa 7]\n41.'), 'the exception clause it refers to comes with its page');
    // clause 37 starts page 7: the mark that closed clause 36 moved to it
    const all = dj.selectExcerpt(marked, 'Band 37 matni');
    const c37 = all.text.split('\n[…]\n').find(p => /37\. Band 37/u.test(p));
    if (c37) assert.ok(c37.startsWith('[Sahifa 7]\n37.'), c37.slice(0, 30));
    for (const p of pieces) assert.ok(!/\n\[Sahifa \d+\]\s*$/u.test(p), 'no clause ends with the next page\'s mark');
  });

  await test('chat excerpts: a document under the context limit is passed whole, marks and all', () => {
    const text = ex.markPages(loadAll().find(f => f.id === 'contract-supply').pages);
    const r = dj.selectExcerpt(text, 'narx');
    assert.deepStrictEqual([r.excerpt, r.text], [false, text]);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
