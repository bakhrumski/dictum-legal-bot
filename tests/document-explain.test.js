'use strict';

/**
 * Document explanation: coverage, page/clause metadata and the checks on the
 * answer (2026-10-07). Mechanical only: the AI is a stub that records what it
 * is given, so these tests prove what reaches the model and what the server
 * does with the answer - NOT the quality of a real model's explanation. That
 * is reviewed by a lawyer on a live benchmark (docs/quality/explain-benchmark.md).
 *
 *   node tests/document-explain.test.js
 */

const assert = require('assert');
const http = require('http');
const express = require('express');
const ex = require('../src/rag/document-explain');
const ledger = require('../src/rag/tariff-ledger');
const { loadAll } = require('./fixtures/explain-eval/load');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

// a stub that records every call and answers by `answer(messages, n)`
function recorder(answer = () => ({ text: 'Bu hujjat haqida qisqa izoh.', provider: 'stub' })) {
  const calls = [];
  const fn = async (messages, opts) => { calls.push({ messages, opts }); return answer(messages, calls.length, opts); };
  fn.calls = calls;
  return fn;
}
const fixtures = loadAll();
const byId = id => fixtures.find(f => f.id === id);
const digestWith = callAI => t => ex.buildDigest(t, { callAI });

(async () => {
  console.log('document explanation (mechanical; stub AI, no paid call):');

  await test('evaluation set: synthetic, every anchor is on the page it names, all types present', () => {
    assert.ok(fixtures.length >= 6);
    const types = fixtures.map(f => f.type).join(' | ');
    for (const t of ['shartnoma', 'ekspertiza', 'sud', 'talabnoma', 'korporativ']) assert.ok(types.includes(t), t);
    for (const f of fixtures) {
      assert.strictEqual(f.synthetic, true, f.id);
      for (const k of f.keyPoints) assert.ok(f.pages[k.page - 1].includes(k.anchor), `${f.id}/${k.id} on page ${k.page}`);
      assert.ok(f.traps.length >= 2, f.id);
    }
    assert.ok(ex.markPages(byId('long-lease').pages).length > ex.EXPLAIN_FULL_TEXT_MAX, 'the long fixture takes the digest path');
  });

  await test('page marks: one per page in order, found again, never billed', () => {
    const f = byId('contract-supply');
    const t = ex.markPages(f.pages);
    assert.deepStrictEqual(ex.pagesIn(t), [1, 2, 3]);
    assert.strictEqual(ex.contentChars(t), f.pages.map(p => p.trim()).join('').length + 2 * (f.pages.length - 1));
    const long = byId('long-lease').pages;
    assert.strictEqual(ex.contentChars(ex.markPages(long)), long.map(p => p.trim()).join('\n\n').length);
    // the marks never move a document into a higher unit
    const edge = ex.markPages(Array.from({ length: 10 }, () => 'x'.repeat(3990)));
    assert.strictEqual(ledger.docUnits({ chars: ex.contentChars(edge), pages: 10 }).units, 1);
    assert.strictEqual(ledger.docUnits({ chars: edge.length, pages: 10 }).units, 2, 'counting the marks would have cost 2');
    assert.deepStrictEqual(ex.emptyPages(ex.markPages(['a', '', 'b', '  '])), [2, 4]);
  });

  await test('chunks cover the whole text, end on page boundaries, and know their pages', () => {
    const t = ex.markPages(byId('long-lease').pages);
    const plan = ex.digestChunks(t);
    assert.ok(plan.covered);
    assert.strictEqual(plan.chunks[0].start, 0);
    assert.strictEqual(plan.chunks[plan.chunks.length - 1].end, t.length);
    for (let i = 1; i < plan.chunks.length; i++) assert.ok(plan.chunks[i].start < plan.chunks[i - 1].end, 'chunks overlap - nothing between them is skipped');
    for (const c of plan.chunks) {
      assert.ok(c.text.length <= ex.CHUNK);
      assert.ok(c.pages && c.pages.from <= c.pages.to);
    }
    assert.strictEqual(plan.chunks[plan.chunks.length - 1].pages.to, byId('long-lease').pageCount);
    // 120 000 characters (one paid job) are covered whole
    const big = ex.markPages(Array.from({ length: 30 }, (_, i) => `${i + 1}-bo'lim matni. `.repeat(250).slice(0, 3990)));
    assert.ok(big.length >= 119000);
    assert.ok(ex.digestChunks(big).covered);
  });

  await test('short documents: the model gets the full text with every key clause, page marks and a coverage note', async () => {
    for (const f of fixtures.filter(x => x.id !== 'long-lease')) {
      const ai = recorder();
      const text = ex.markPages(f.pages);
      const r = await ex.explainDocument({ documentText: text, langName: 'Uzbek', callAI: ai, digest: digestWith(ai) });
      assert.strictEqual(ai.calls.length, 1, `${f.id}: one AI call`);
      const user = ai.calls[0].messages[1].text;
      for (const k of f.keyPoints) assert.ok(user.includes(k.anchor), `${f.id}/${k.id} reaches the model`);
      assert.ok(user.startsWith("QAMROV: hujjatning to'liq matni berildi"), f.id);
      assert.ok(user.includes(`[Sahifa ${f.pageCount}]`));
      assert.strictEqual(r.coverage.mode, 'full_text');
      assert.strictEqual(r.coverage.pages, f.pageCount);
    }
  });

  await test('long document: every chunk is digested, the last page\'s clause and its exception reach the model with the page', async () => {
    const f = byId('long-lease');
    const ai = recorder((messages, n) => {
      const user = messages[1].text;
      if (/^Excerpt /u.test(user)) {
        // the stub "extracts" the key lines it was given, with their page
        const pages = user.match(/· (\d+)(?:–(\d+))?-sahifa/u);
        const keep = user.split('\n').filter(l => /kompensatsiya|Kafolat puli|9 000 000|3 yil/u.test(l));
        return { text: keep.map(l => `- ${l.trim()} (${pages ? pages[2] || pages[1] : '?'}-sahifa)`).join('\n') || '- (umumiy qoidalar)', provider: 'stub' };
      }
      return { text: 'Izoh.', provider: 'stub' };
    });
    const text = ex.markPages(f.pages);
    const r = await ex.explainDocument({ documentText: text, langName: 'Uzbek', callAI: ai, digest: digestWith(ai) });
    const excerpts = ai.calls.filter(c => /^Excerpt /u.test(c.messages[1].text));
    assert.strictEqual(excerpts.length, ex.digestChunks(text).chunks.length);
    assert.strictEqual(excerpts[0].messages[0].text, ex.DIGEST_SYSTEM);
    assert.strictEqual(excerpts[0].opts.maxTokens, ex.DIGEST_MAX_TOKENS);
    const lastChunk = excerpts[excerpts.length - 1].messages[1].text;
    for (const k of f.keyPoints.filter(x => x.page === f.pageCount)) assert.ok(lastChunk.includes(k.anchor), `${k.id} in the last chunk`);
    assert.ok(new RegExp(`· \\d+–${f.pageCount}-sahifa`, 'u').test(lastChunk), 'the last chunk is labelled with its pages');
    const final = ai.calls[ai.calls.length - 1].messages[1].text;
    assert.ok(final.startsWith('QAMROV: hujjat '), 'the coverage note says it is a digest');
    assert.ok(final.includes("bu to'liq matn emas"));
    assert.ok(final.includes('6 oylik ijara haqi miqdorida kompensatsiya') && final.includes("kompensatsiya to'lanmaydi"));
    assert.ok(final.includes(`(${f.pageCount}-sahifa)`));
    assert.strictEqual(r.coverage.mode, 'digest');
    assert.deepStrictEqual(r.coverage.unread, []);
  });

  await test('a digest part that fails or is cut is named to the model, in the answer and in coverage', async () => {
    const text = ex.markPages(byId('long-lease').pages);
    const ai = recorder((messages, n) => {
      const user = messages[1].text;
      if (/^Excerpt 2\//u.test(user)) throw new Error('provider down');
      if (/^Excerpt 3\//u.test(user)) return { text: 'Birinchi band to\'liq yozilgan gap. Ikkinchi band chala', truncated: true, provider: 'stub' };
      if (/^Excerpt /u.test(user)) return { text: '- band', provider: 'stub' };
      return { text: 'Hujjat ijara haqida.', provider: 'stub' };
    });
    const r = await ex.explainDocument({ documentText: text, langName: 'Uzbek', callAI: ai, digest: digestWith(ai) });
    const final = ai.calls[ai.calls.length - 1].messages[1].text;
    assert.ok(/DIQQAT: 2-qism \(\d+–\d+-sahifa\), 3-qism \(\d+–\d+-sahifa\) qisman o'qilmadi/u.test(final), final.slice(0, 400));
    assert.ok(final.includes("BU QISM O'QILMADI"));
    assert.ok(final.includes('UZUNLIK CHEGARASIDA KESILDI'));
    assert.ok(!final.includes('Ikkinchi band chala'), 'a cut digest part ends on its last full sentence');
    assert.deepStrictEqual(r.coverage.unread.map(u => u.part), [2, 3]);
    assert.strictEqual(r.coverage.documentFullyRead, false);
    assert.strictEqual(r.coverage.partial, true);
    // the user sees it first, and it is never presented as a full analysis
    assert.ok(/^⚠️ \*\*Qisman natija — to'liq tahlil emas:\*\* hujjatning 2-qism \(\d+–\d+-sahifa\), 3-qism \(\d+–\d+-sahifa\) o'qilmadi/u.test(r.reply), r.reply.slice(0, 200));
    assert.ok(r.reply.includes('**Avtomatik tekshiruv (AI emas):**'));
  });

  await test('an answer cut at the token cap ends on a full sentence and says so', async () => {
    const ai = recorder(() => ({ text: 'Birinchi gap. Ikkinchi gap ham to\'liq. Uchinchi gap kesil', truncated: true, provider: 'stub' }));
    const r = await ex.explainDocument({ documentText: ex.markPages(byId('talabnoma').pages), langName: 'Uzbek', callAI: ai, digest: digestWith(ai) });
    assert.ok(/^⚠️ \*\*Qisman natija — to'liq tahlil emas:\*\* javob uzunlik chegarasida to'xtadi/u.test(r.reply), r.reply.slice(0, 200));
    assert.ok(r.reply.includes("\n\nBirinchi gap. Ikkinchi gap ham to'liq.\n\n**Avtomatik tekshiruv"));
    assert.ok(!r.reply.includes('kesil'));
    assert.strictEqual(r.coverage.answerTruncated, true);
    assert.strictEqual(r.coverage.documentFullyRead, true, 'the document itself was read whole');
    assert.strictEqual(r.coverage.partial, true);
  });

  await test('the check flags invented figures, pages and clauses - and not faithful ones', () => {
    const f = byId('contract-supply');
    const src = ex.markPages(f.pages);
    const faithful = 'Narx 84 500 000 so\'m (1-sahifa, 2.1-band). Yetkazish 20 ish kuni ichida (3.1-band, 2-sahifa). '
      + 'Penya 0,1 foiz, 10 foizdan oshmaydi (5.1-band). 4.1-band (10 bank kuni) va 4.3-band (15 kalendar kun) bir-biriga zid. '
      + 'Shartnoma 2026-yil 31-dekabrgacha amal qiladi (8.1-band, [Sahifa 3]). Qiymat 84,5 mln so\'m.';
    const ok = ex.verifyExplanation(faithful, src);
    assert.ok(ok.ok, JSON.stringify(ok));
    const bad = ex.verifyExplanation('Narx 85 000 000 so\'m (4-sahifa). Penya 0,5 foiz (12.3-band). Muddat 2027-yil.', src);
    assert.deepStrictEqual(bad.pages, [4]);
    assert.deepStrictEqual(bad.clauses, ['12.3-band']);
    assert.deepStrictEqual(bad.numbers.sort(), ['0,5', '2027', '85 000 000'], JSON.stringify(bad));
    const done = ex.finishExplanation({ reply: 'Narx 85 000 000 so\'m (4-sahifa).', source: src });
    assert.ok(done.reply.includes('Hujjat matnida topilmagan raqam: 85 000 000'));
    assert.ok(done.reply.includes("Hujjatda bunday sahifa belgisi yo'q: 4"));
  });

  await test('the check says what it does NOT check, under every answer - also when it finds nothing', () => {
    const src = ex.markPages(byId('talabnoma').pages);
    const clean = ex.finishExplanation({ reply: 'Talabnomani "Mehr Logistika" MChJ yuborgan.', source: src });
    assert.ok(clean.reply.endsWith("**Avtomatik tekshiruv (AI emas):** faqat raqam, sana, sahifa va band raqamlari hujjat matni bilan solishtirildi. Mazmun, kim nima degani, talqin va huquqiy to'g'rilik tekshirilmagan.\n- Mos kelmagan raqam, sana, sahifa yoki band topilmadi."));
    assert.strictEqual(clean.check.scope, 'figures_dates_pages_clauses_only');
    // a wrong attribution passes the check: it is not a semantic check
    const wrong = ex.finishExplanation({ reply: "Qarz 12 400 000 so'm ekani tasdiqlangan.", source: src });
    assert.strictEqual(wrong.check.ok, true, 'meaning is not checked - the lawyer review is');
  });

  await test('no unfounded warnings: dates in other forms, percentages, money in mln/ming, clause numbers, list numbering, page ranges', () => {
    const src = ex.markPages(byId('contract-supply').pages);
    const cases = [
      'Shartnoma 05.02.2026 da tuzilgan.', 'Shartnoma 2026-02-05 da tuzilgan.', 'Shartnoma 5-fevral 2026-yilda tuzilgan.',
      'Amal qilish: 31.12.2026 gacha.', 'Amal qilish: 31 декабря 2026 г.',
      'Penya 0,1% kuniga, 10% dan oshmaydi.', 'Penya 0.1 %.', 'Yoqilg\'i 15% dan ortiq qimmatlasa.',
      'Narx 84,5 mln so\'m.', 'Narx 84 500 ming so\'m.', 'Narx 84 500 000 so\'m.', 'Narx 84.5 mln.',
      '4.1 va 4.3-bandlar zid.', '8.2-band muddat tugagach ham amal qiladi.', '5-bo\'lim javobgarlik.', '2.3-bandda istisno bor.',
      '1. Narx\n2. Muddat\n10. Javobgarlik\n11. Nizolar\n12) Bekor qilish', '1–3-sahifalarda.', '2-3-sahifa.',
      'Shartnoma № 17/2026.',
    ];
    for (const c of cases) {
      const v = ex.verifyExplanation(c, src);
      assert.ok(v.ok && !v.derived.length, `${c} -> ${JSON.stringify(v)}`);
    }
    // a date the document does not have, in any form, is flagged
    for (const c of ['Shartnoma 06.02.2026 da tuzilgan.', 'Shartnoma 5-mart 2026-yilda tuzilgan.', 'Shartnoma 2025-02-05 da.']) {
      assert.ok(ex.verifyExplanation(c, src).dates.length === 1, c);
    }
  });

  await test('arithmetic on the document\'s amounts is named as the AI\'s calculation, not as an invented figure', () => {
    const src = ex.markPages(byId('contract-supply').pages);
    const v = ex.verifyExplanation("Oldindan to'lov (30 foiz): 25 350 000 so'm. Qolgan summa: 59 150 000 so'm. Narx 90 000 000 so'm.", src);
    assert.deepStrictEqual(v.derived, ['25 350 000', '59 150 000']);
    assert.deepStrictEqual(v.numbers, ['90 000 000']);
    const t = ex.verifyExplanation("Jami 12 400 000 = 11 000 000 + 1 400 000; 12,4 mln so'm.", ex.markPages(byId('talabnoma').pages));
    assert.ok(t.ok && !t.derived.length, JSON.stringify(t));
    const done = ex.finishExplanation({ reply: "Oldindan to'lov: 25 350 000 so'm.", source: src });
    assert.ok(done.reply.includes("Hujjatda yo'q, hujjatdagi raqamlardan hisoblanganga o'xshaydi (AI hisobi): 25 350 000"));
    assert.strictEqual(done.check.ok, true, 'a calculation is named, not counted as invented');
  });

  await test('page marks never move a threshold or a unit, and are counted in the provider input', async () => {
    // 13 990 characters of document on 12 pages: full text, not a digest, though marks push it over 14 000
    const pages = Array.from({ length: 12 }, (_, i) => `${i + 1}. ` + 'Band matni. '.repeat(Math.floor((13990 / 12 - 4) / 12)));
    const marked = ex.markPages(pages);
    assert.ok(marked.length > ex.EXPLAIN_FULL_TEXT_MAX && ex.contentChars(marked) <= ex.EXPLAIN_FULL_TEXT_MAX, `${marked.length} / ${ex.contentChars(marked)}`);
    const ai = recorder();
    const r = await ex.explainDocument({ documentText: marked, langName: 'Uzbek', callAI: ai, digest: digestWith(ai) });
    assert.strictEqual(r.coverage.mode, 'full_text');
    assert.strictEqual(r.coverage.chars, ex.contentChars(marked));
    // the provider gets (and is billed for) the marks: the cost bound counts them
    const pricing = require('../src/ai/model-pricing');
    const withMarks = pricing.inputTokenBound(ai.calls[0].messages);
    const plainMsgs = ai.calls[0].messages.map(m => ({ ...m, text: m.text.replace(/^\[Sahifa \d+\]\n/gmu, '') }));
    assert.ok(withMarks - pricing.inputTokenBound(plainMsgs) >= 12 * 11, 'marks are in the input token bound');
    // a paid job's 120 000 characters on 30 pages, marks included, is still covered whole
    const big = ex.markPages(Array.from({ length: 30 }, () => 'x'.repeat(3998)));
    assert.ok(ex.contentChars(big) <= 120000 && ex.contentChars(big) > 119900 && ex.digestChunks(big).covered);
    // paragraph breaks placed so every chunk would end early: coverage still whole
    const para = Array.from({ length: 30 }, () => `${'z'.repeat(1750)}\n\n${'z'.repeat(2240)}`);
    const early = ex.markPages(para);
    assert.ok(ex.contentChars(early) <= 120000 && ex.digestChunks(early).covered);
    assert.strictEqual(ex.digestChunks(early).chunks[0].text.length, ex.CHUNK, 'fell back to fixed cuts rather than leave the end unread');
    // chat: excerpt threshold on the document's own size
    const dj = require('../src/rag/document-job');
    const chat = ex.markPages(Array.from({ length: 10 }, () => 'y'.repeat(1995)));
    assert.ok(chat.length > 20000 - 200 && ex.contentChars(chat) <= 20000);
    assert.strictEqual(dj.selectExcerpt(chat, 'savol').excerpt, false);
  });

  await test('a text without page marks (DOCX): the model is told so, and any page number is flagged', async () => {
    const f = byId('due-diligence');
    const plain = f.pages.join('\n\n');
    const ai = recorder(() => ({ text: 'Sud ishlari haqida ma\'lumot 2-sahifada.', provider: 'stub' }));
    const r = await ex.explainDocument({ documentText: plain, langName: 'Uzbek', callAI: ai, digest: digestWith(ai) });
    assert.ok(ai.calls[0].messages[1].text.includes("Sahifa belgilari yo'q: sahifa raqamini keltirma"));
    assert.deepStrictEqual(r.check.pages, [2]);
    assert.strictEqual(r.coverage.pages, null);
  });

  await test('pages with no text are named to the model as unread', async () => {
    const ai = recorder();
    await ex.explainDocument({ documentText: ex.markPages(['Birinchi sahifa matni, yetarlicha uzun matn bilan.', '', 'Uchinchi sahifa.']), langName: 'Uzbek', callAI: ai, digest: digestWith(ai) });
    assert.ok(ai.calls[0].messages[1].text.includes("Matni yo'q (o'qilmagan, ehtimol rasm/skan) sahifalar: 2"));
  });

  await test('the production prompts are general: no evaluation names, figures or document-specific phrases', () => {
    const prompts = [ex.explainSystem('Uzbek'), ex.explainSystem('Russian'), ex.DIGEST_SYSTEM].join('\n');
    for (const f of fixtures) {
      for (const k of f.keyPoints) assert.ok(!prompts.includes(k.anchor), `${f.id}/${k.id}`);
      const names = f.pages.join(' ').match(/"[^"]{3,40}" MChJ|[A-Z]\. [A-Z][a-z']+/gu) || [];
      for (const n of names) assert.ok(!prompts.includes(n), n);
    }
    for (const s of ['MIMORAM', 'Ilhomova', 'mualliflik', 'investor']) assert.ok(!prompts.toLowerCase().includes(s.toLowerCase()), s);
    // the rules themselves are there (A-F)
    for (const s of ['Never add a person', 'Not identified" never becomes "does not exist"', 'AI izohi:', 'no fixed template', 'Never invent a page or clause number', 'contradict', 'QAMROV']) {
      assert.ok(prompts.includes(s), s);
    }
  });

  await test('extract: a text PDF comes back with one page mark per page; size, units and ticket count the document only', async () => {
    const { PDFDocument, StandardFonts } = require('pdf-lib');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const lines = ['Birinchi sahifa: 1.1-band. Narx 5 000 000 som.', 'Ikkinchi sahifa: 2.1-band. Muddat 10 kun.', 'Uchinchi sahifa: 3.1-band. Nizolar sudda.'];
    for (const l of lines) doc.addPage([400, 400]).drawText(l + ' Qo\'shimcha matn shu yerda.', { x: 20, y: 300, size: 9, font });
    const pdf = Buffer.from(await doc.save());
    const app = express();
    const calls = { ai: 0 };
    const { mountAnalyzerRoutes } = require('../src/ocr/routes');
    mountAnalyzerRoutes(app, { requireAuth: (q, s, n) => n(), callAI: async () => { calls.ai++; return { text: '{}' }; },
      tariffModule: require('../src/rag/subscription-tiers'), pool: { query: async () => ({ rows: [] }) } });
    const server = http.createServer(app).listen(0);
    try {
      const fd = new FormData();
      fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'doc.pdf');
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/analyze/extract`, { method: 'POST', body: fd });
      const d = await r.json();
      assert.strictEqual(r.status, 200, JSON.stringify(d));
      assert.deepStrictEqual(ex.pagesIn(d.text), [1, 2, 3]);
      assert.ok(/\[Sahifa 2\]\nIkkinchi sahifa: 2\.1-band/u.test(d.text), d.text);
      assert.strictEqual(d.pageCount, 3);
      assert.strictEqual(d.charCount, ex.contentChars(d.text) - 2, 'charCount is the document text (pages joined by one line break)');
      assert.strictEqual(d.scanned, false);
      assert.deepStrictEqual(ledger.readDocTicket(d.docTicket, d.text), { pages: 3, scanned: false }, 'the ticket is signed over the text the client sends back');
      assert.strictEqual(calls.ai, 0, 'extract calls no AI');
    } finally { server.close(); }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
