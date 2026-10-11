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
      // a chunk may run on to the end of its line (at most 5% more), never cutting a clause for nothing
      assert.ok(c.text.length <= Math.floor(ex.CHUNK * 1.05) + 1, String(c.text.length));
      assert.ok(!c.splitAtEnd, 'no line cut in two');
      assert.ok(c.pages && c.pages.from <= c.pages.to);
    }
    assert.strictEqual(plan.chunks[plan.chunks.length - 1].pages.to, byId('long-lease').pageCount);
    // 120 000 characters (one paid job) are covered whole
    const big = ex.markPages(Array.from({ length: 30 }, (_, i) => `${i + 1}-bo'lim matni. `.repeat(250).slice(0, 3990)));
    assert.ok(big.length >= 119000);
    assert.ok(ex.digestChunks(big).covered);
  });

  await test('short documents: the model gets the full text with every key clause, page marks and a coverage note', async () => {
    for (const f of fixtures.filter(x => ex.contentChars(ex.markPages(x.pages)) <= ex.EXPLAIN_FULL_TEXT_MAX)) {
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

  await test('a part cut at the cap is re-read once as two halves; a failed part is not; a part still cut is not used at all - not even its fragment', async () => {
    const text = ex.markPages(byId('long-lease').pages);
    const ai = recorder((messages) => {
      const user = messages[1].text;
      if (/^Excerpt 2\//u.test(user)) throw new Error('provider down');
      if (/^Excerpt 3\//u.test(user)) return { text: "Birinchi band to'liq yozilgan gap. Ikkinchi band chala", truncated: true, provider: 'stub' };
      if (/^Excerpt 4[ab]\//u.test(user)) return { text: 'Yarim qism kesilgan FRAGMENT', truncated: true, provider: 'stub' };
      if (/^Excerpt 4\//u.test(user)) return { text: 'Kesilgan FRAGMENT', truncated: true, provider: 'stub' };
      if (/^Excerpt /u.test(user)) return { text: '- band', provider: 'stub' };
      return { text: 'Hujjat ijara haqida.', provider: 'stub' };
    });
    const r = await ex.explainDocument({ documentText: text, langName: 'Uzbek', callAI: ai, digest: digestWith(ai) });
    const excerpts = ai.calls.filter(c => /^Excerpt /u.test(c.messages[1].text)).map(c => c.messages[1].text.match(/^Excerpt (\S+)\//u)[1]);
    const n = ex.digestChunks(text).chunks.length;
    // each part once; parts 3 and 4 (cut) once more as halves; part 2 (failed) not again
    assert.deepStrictEqual(excerpts.filter(x => /^\d+$/u.test(x)).length, n);
    assert.deepStrictEqual(excerpts.filter(x => /[ab]$/u.test(x)).sort(), ['3a', '3b', '4a', '4b']);
    assert.ok(!excerpts.includes('2a'));
    const parts = Object.fromEntries(r.coverage.parts.map(p => [p.part, p.status]));
    assert.deepStrictEqual([parts['2'], parts['3a'], parts['3b'], parts['4a'], parts['4b']], ['failed', 'read', 'read', 'cut', 'cut']);
    const final = ai.calls[ai.calls.length - 1].messages[1].text;
    assert.ok(!/FRAGMENT|Ikkinchi band chala/u.test(final), 'a cut fragment is never given to the model');
    assert.ok(/DIQQAT: 2-qism \(\d+–\d+-sahifa\), 4a-qism \(\d+–\d+-sahifa\), 4b-qism \(\d+–\d+-sahifa\) o'qilmadi yoki uzunlik chegarasida kesildi — bu qismlar senga umuman berilmadi \(kesilgan parcha ham ishlatilmadi\)/u.test(final), final.slice(0, 400));
    assert.ok(final.includes("BU QISM O'QILMADI — dayjest uzunlik chegarasida kesildi, kesilgan parcha ishlatilmadi"));
    assert.deepStrictEqual([r.coverage.documentFullyRead, r.coverage.partial, r.coverage.finalRun], [false, true, true]);
    assert.ok(/^⚠️ \*\*Qisman natija — to'liq tahlil emas:\*\* hujjatning 2-qism \(\d+–\d+-sahifa\), 4a-qism/u.test(r.reply), r.reply.slice(0, 200));
    // the ledger is told which part each call read
    const d = ai.calls.find(c => /^Excerpt 3a\//u.test(c.messages[1].text)).opts.detail;
    assert.deepStrictEqual([d.phase, d.part, d.of], ['digest', '3a', n]);
    assert.deepStrictEqual(ai.calls[ai.calls.length - 1].opts.detail, { phase: 'final', mode: 'digest' });
  });

  await test('a long DOCX (no page marks, ~50 000 chars, annex table at the end): parts sized by predicted digest (each under the target), every key clause reaches a part, no page numbers asked for, a substituted status flagged', async () => {
    const f = byId('long-service-docx');
    const text = f.pages.join('\n\n');
    assert.ok(text.length > 50000 && ex.pagesIn(text).length === 0);
    const ai = recorder((m) => /^Excerpt /u.test(m[1].text) ? { text: '- band', provider: 'stub' } : { text: 'Izoh.', provider: 'stub' });
    const r = await ex.explainDocument({ documentText: text, langName: 'Uzbek', callAI: ai, digest: digestWith(ai) });
    const parts = ai.calls.filter(c => /^Excerpt /u.test(c.messages[1].text));
    const plan = ex.digestChunks(text);
    assert.strictEqual(parts.length, plan.chunks.length);
    assert.strictEqual(plan.density.fit, 'fits');
    assert.ok(plan.chunks.every(c => ex.predictDigestTokens(c.text) <= Math.round(ex.DIGEST_TARGET * ex.DIGEST_MAX_TOKENS) * 1.06), JSON.stringify(plan.density));
    assert.ok(parts.every(c => c.messages[1].text.length < 8200 && c.opts.maxTokens === 1600));
    const all = parts.map(c => c.messages[1].text).join('\n');
    for (const k of f.keyPoints) assert.ok(all.includes(k.anchor), `${k.id} reaches a digest part`);
    assert.ok(parts[parts.length - 1].messages[1].text.includes('Jami: 48 000 000'), 'the annex table is in the last part');
    assert.ok(ai.calls[ai.calls.length - 1].messages[1].text.includes("Sahifa belgilari yo'q: sahifa raqamini keltirma"));
    assert.deepStrictEqual([r.coverage.mode, r.coverage.chunks, r.coverage.documentFullyRead], ['digest', plan.chunks.length, true]);
    assert.strictEqual(r.coverage.summary.density.fit, 'fits');
    // "application filed" is not "registered": a substitution is flagged for a manual check
    const sub = ex.finishExplanation({ reply: "Tovar belgisi ro'yxatdan o'tmagan.", source: text });
    assert.deepStrictEqual(sub.check.phrases.map(p => p.phrase), ["ro'yxatdan o'tmagan"]);
    const faithful = ex.finishExplanation({ reply: "Tovar belgisi uchun ariza topshirilgan, ro'yxatdan o'tkazish yakunlanmagan (8.1-band). Jami javobgarlik 20 foiz bilan cheklangan (7.3-band). 3.2 va 7.4-bandlar zid: 10 va 20 kun.", source: text });
    assert.strictEqual(faithful.check.flagged, 0, JSON.stringify(faithful.check));
  });

  await test('re-reads are bounded: at most the extra-call limit, none after the time limit; every part cut -> no final call at all', async () => {
    const text = ex.markPages(byId('long-lease').pages);
    const allCut = recorder(() => ({ text: '- band, kesilgan', truncated: true, provider: 'stub' }));
    const r = await ex.explainDocument({ documentText: text, langName: 'Uzbek', callAI: allCut, digest: digestWith(allCut) });
    const n = ex.digestChunks(text).chunks.length;
    assert.strictEqual(r.aborted, true);
    assert.strictEqual(r.reply, '');
    assert.strictEqual(allCut.calls.length, n + ex.DIGEST_LIMITS.maxExtraCalls, `${n} parts + ${ex.DIGEST_LIMITS.maxExtraCalls} re-read calls, and no final call`);
    assert.ok(allCut.calls.every(c => /^Excerpt /u.test(c.messages[1].text)), 'no explanation call');
    assert.deepStrictEqual([r.coverage.finalRun, r.coverage.documentFullyRead, r.coverage.summary.read, r.coverage.summary.finalRun], [false, false, 0, false]);
    // no re-read once the time limit has passed
    const slow = recorder(() => ({ text: 'x', truncated: true, provider: 'stub' }));
    const d = await ex.buildDigest(text, { callAI: slow, limits: { timeMs: 0 } });
    assert.strictEqual(slow.calls.length, n);
    assert.strictEqual(d.extraCalls, 0);
    // an empty answer at the cap (hidden reasoning used it) counts as cut, a provider error as failed
    const empty = recorder((m) => { if (/^Excerpt 1\//u.test(m[1].text)) throw Object.assign(new Error('VoiceLab x empty response (finish_reason: length)'), { code: 'EMPTY_RESPONSE', providerCode: 'length' }); throw new Error('upstream 503'); });
    const e = await ex.buildDigest(text, { callAI: empty, limits: { maxExtraCalls: 0 } });
    assert.deepStrictEqual(e.parts.slice(0, 2).map(p => p.status), ['cut', 'failed']);
    assert.ok(ex.digestUnusable(e));
  });

  await test('chunks are 8 000 characters (larger only so 13 cover a 120 000-character job); the digest prompt is compact and keeps the general rules', () => {
    assert.deepStrictEqual([ex.CHUNK, ex.OVERLAP, ex.MAX_CHUNKS, ex.DIGEST_MAX_TOKENS], [8000, 300, 13, 1600], 'the output cap is not raised');
    assert.strictEqual(ex.digestChunks('x'.repeat(51398)).chunks.length, 7);
    assert.ok(ex.digestChunks('x'.repeat(51398)).chunks.every(c => c.text.length <= 8000));
    const big = ex.digestChunks('x'.repeat(120400));
    assert.ok(big.covered && big.chunks.length <= 13);
    for (const rule of ['COMPACT', 'one line per item', 'payment terms', 'cumulative or aggregate liability cap', 'contradict each other',
      'annexes and tables', "TO'LDIRILMAGAN", 'filing an application is not registration', 'a complete condition wins over a short line', 'conditions precedent', 'never the criteria of a defined term', 'in addition to each other or instead of each other', 'jumladan']) {
      assert.ok(ex.DIGEST_SYSTEM.includes(rule), rule);
    }
    const p = ex.explainSystem('Uzbek');
    for (const rule of ['payment terms', 'cumulative or aggregate liability cap', 'contradict each other', 'what annexes and tables list', 'an unfilled field is not an agreed term']) {
      assert.ok(p.includes(rule), rule);
    }
  });

  await test('templates: unfilled fields are counted with no AI and named to the model', async () => {
    const tpl = ex.markPages(["SHARTNOMA № ____\nToshkent sh., «____» ________ 20__ y.\n1.1. Ijara haqi [summa] so'm, har oyning ____ sanasigacha to'lanadi.\n1.2. Tomonlar: __________ (Ijarachi)."]);
    const found = ex.placeholdersIn(tpl);
    assert.ok(found.count >= 4, JSON.stringify(found));
    const ai = recorder();
    await ex.explainDocument({ documentText: tpl, langName: 'Uzbek', callAI: ai, digest: digestWith(ai) });
    assert.ok(/Hujjatda to'ldirilmagan joylar bor \(\d+ ta, masalan «____»/u.test(ai.calls[0].messages[1].text), ai.calls[0].messages[1].text.slice(0, 300));
    assert.strictEqual(ex.placeholdersIn(ex.markPages(byId('contract-supply').pages)).count, 0, 'a filled contract has none');
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
    assert.ok(done.reply.includes("- Asosiy matn — manba bilan qo'lda tekshirish kerak: hujjat matnida uchramagan raqam 85 000 000; hujjatda bunday belgisi yo'q sahifa 4."), done.reply);
    assert.ok(done.reply.includes("Narx 85 000 000 so'm (4-sahifa)."), 'named, not removed');
  });

  await test('the check says what it does NOT check, under every answer - also when it finds nothing', () => {
    const src = ex.markPages(byId('talabnoma').pages);
    const clean = ex.finishExplanation({ reply: 'Talabnomani "Mehr Logistika" MChJ yuborgan.', source: src });
    assert.ok(clean.reply.endsWith("**Avtomatik tekshiruv (AI emas):** faqat raqam, sana, sahifa, band raqamlari, holat, oqibat, ustuvorlik va vaqt iboralari hamda muddat/sana qaysi harakatga bog'langani, inkor, tartib, «va/yoki», ehtimollik, ta'rif chegarasi, mezonlar, jadval qatori va «mumkin/kerak» hujjat matni bilan, dayjestda bor qism esa javob bilan mexanik (so'z bo'yicha) solishtirildi — javobning barcha bo'limlarida bir xil. Belgilangan joy da'vo noto'g'ri degani emas: uni manba bilan qo'lda tekshirish kerak. Hech bir bo'lim, belgilanmaganlari ham, mazmunan yoki huquqiy jihatdan tasdiqlangan emas.\n- Mexanik solishtirishda belgilanadigan joy topilmadi. Bu mazmun yoki huquqiy to'g'rilik tasdig'i emas."), clean.reply);
    assert.deepStrictEqual([clean.check.scope, clean.check.mode, clean.check.verified, clean.check.flagged], ['figures_dates_pages_clauses_only', 'flag_for_manual_review', false, 0]);
    assert.ok(!('ok' in clean.check), 'no field that could read as "verified"');
    // a wrong attribution in words outside the vocabulary passes: it is not a semantic check
    const wrong = ex.finishExplanation({ reply: "Qarzni Yashil Vodiy o'zi hisoblab chiqqan.", source: src });
    assert.strictEqual(wrong.check.flagged, 0, 'meaning is not checked - the lawyer review is');
    assert.strictEqual(wrong.check.verified, false);
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
    assert.ok(done.reply.includes("Asosiy matn — manba bilan qo'lda tekshirish kerak: hujjatdagi raqamlardan hisoblanganga o'xshagan 25 350 000 (hisobni tekshiring)."), done.reply);
    assert.strictEqual(done.check.flagged, 0, 'a calculation is named, not counted as invented');
    // in the AI note the same: shown, named, nothing removed
    const inNote = ex.finishExplanation({ reply: "Matn.\n\n**AI izohi:** Oldindan to'lov 30 foiz, ya'ni 25 350 000 so'm bo'ladi.", source: src });
    assert.ok(inNote.reply.includes("**AI izohi:** Oldindan to'lov 30 foiz, ya'ni 25 350 000 so'm bo'ladi."));
    assert.deepStrictEqual(inNote.check.sections.aiNote.derived, ['25 350 000']);
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
    const first = ex.digestChunks(early).chunks[0].text.length;
    assert.ok(first >= ex.chunkSizeFor(early.length) && first <= ex.chunkSizeFor(early.length) * 1.05 + 1, `did not end early, at most ran on to its line end: ${first}`);
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
      assert.deepStrictEqual(ledger.readDocTicket(d.docTicket, d.text), { pages: 3, scanned: false, chars: d.charCount }, 'the ticket is signed over the text the client sends back');
      assert.strictEqual(calls.ai, 0, 'extract calls no AI');
    } finally { server.close(); }
  });

  await test('AI izohi: every evaluation case, in three label styles - nothing removed for a word; unsupported phrases named for a manual check; grounded notes unflagged; only a placeholder left out', () => {
    const styles = {
      inline: n => `**AI izohi:** ${n}`,
      heading: n => `**AI izohi**\n${n}`,
      list: n => `- AI izohi: ${n}`,
    };
    let n = 0;
    for (const f of fixtures) {
      assert.ok((f.aiNoteCases || []).length >= 2, `${f.id} has AI-note cases`);
      const src = ex.markPages(f.pages);
      for (const c of f.aiNoteCases) {
        for (const [style, wrap] of Object.entries(styles)) {
          const answer = `**Hujjat nima haqida**\nHujjat ${f.type} haqida.\n\n${wrap(c.note)}\n\n**Keyingi qadam**\nAsl hujjatni o'qing.`;
          const done = ex.finishExplanation({ reply: answer, source: src });
          const ai = done.check.sections.aiNote;
          const where = `${f.id} / ${style} / ${c.note}`;
          assert.ok(done.reply.includes('Hujjat ' + f.type + ' haqida.') && done.reply.includes("Asl hujjatni o'qing."), `${where}: the rest of the answer stays`);
          assert.strictEqual(done.check.verified, false, where);
          if (c.expect === 'removed') {
            assert.ok(!/AI izohi:|AI izohi\*\*/u.test(done.reply.split('**Avtomatik tekshiruv')[0]), `${where}: a placeholder is not shown`);
            assert.strictEqual(done.check.aiNote.removed, 1, where);
          } else {
            assert.ok(done.reply.includes(c.note), `${where}: shown as written - nothing removed for a word`);
            const flags = ai.phrases.length + ai.numbers.length + ai.dates.length + ai.pages.length + ai.clauses.length + ai.relations.length;
            if (c.expect === 'flagged') {
              assert.ok(flags >= 1, `${where}: named for a manual check`);
              assert.ok(done.reply.includes("- AI izohi — manba bilan qo'lda tekshirish kerak:"), where);
              assert.ok(!/noto'g'ri\b(?! degani)|asossiz|olib tashlandi/u.test(done.notes.join(' ')), `${where}: never called wrong`);
            } else {
              assert.strictEqual(flags, 0, `${where}: grounded -> ${JSON.stringify(ai)}`);
            }
          }
          n++;
        }
      }
    }
    assert.ok(n >= 60, `${n} checks`);
  });

  await test('the same criteria in the main text and the AI note: the same sentence gets the same flags in either', () => {
    for (const f of fixtures) {
      const src = ex.markPages(f.pages);
      for (const c of f.aiNoteCases.filter(x => x.expect !== 'removed')) {
        const inBody = ex.finishExplanation({ reply: `**Izoh**\n${c.note}`, source: src }).check.sections.body;
        const inNote = ex.finishExplanation({ reply: `Matn.\n\n**AI izohi:** ${c.note}`, source: src }).check.sections.aiNote;
        assert.deepStrictEqual(inBody, inNote, `${f.id}: ${c.note}`);
      }
    }
  });

  await test('no removal and no flag for a denied, doubted, quoted, conditional or synonymous phrase - a correct note is not taken for a wrong one', () => {
    const dd = ex.markPages(byId('due-diligence').pages);
    const silent = [
      // negation: the note says the conclusion cannot be drawn
      "Belgi ro'yxatdan o'tmagan deb xulosa chiqarib bo'lmaydi: hujjat faqat ariza berilmaganini aytadi.",
      "Ariza berilmagani belgi ro'yxatdan o'tmagan degani emas.",
      "Hujjatda belgi ro'yxatdan o'tmagan deyilmagan.",
      "Litsenziya yo'qligi faoliyat noqonuniy ekanini anglatmaydi.",
      "Qaysi xatar eng katta ekanini hujjat aytmaydi.",
      'Hozirgi holat noma\'lum: xulosa 12-avgust holatiga tuzilgan.',
      // quotation of the document itself
      '«Ochiq manbalarda Jamiyatning soliq qarzi va majburiy ijro bo\'yicha ish yuritishlari aniqlanmadi».',
      // conditional
      "Agar belgi ro'yxatdan o'tmagan bo'lsa, boshqalar undan foydalanishi mumkin.",
      "Litsenziya talab qilinadigan bo'lsa, uni olish kerak bo'ladi.",
    ];
    for (const sn of silent) {
      for (const wrap of [x => x, x => `Matn.\n\n**AI izohi:** ${x}`]) {
        const done = ex.finishExplanation({ reply: wrap(sn), source: dd });
        assert.ok(done.reply.includes(sn), `shown: ${sn}`);
        assert.deepStrictEqual(done.check.phrases, [], `${sn} -> ${JSON.stringify(done.check.phrases)}`);
      }
    }
    // synonyms: the document's word or its synonym is support
    const lic = ex.markPages(["Jamiyatning tovar belgisi ro'yxatga olinmagan. Ma'muriy jarima to'langan."]);
    for (const sn of ["Belgi ro'yxatdan o'tmagan.", "Belgi ro'yxatdan o'tkazilmagan.", 'Товарный знак не зарегистрирован.', 'Был уплачен штраф.']) {
      assert.deepStrictEqual(ex.finishExplanation({ reply: `**AI izohi:** ${sn}`, source: lic }).check.phrases, [], sn);
    }
    // a denied phrase does not hide an asserted one in the same sentence
    const both = ex.finishExplanation({ reply: "**AI izohi:** Belgi noqonuniy degani emas, lekin u ro'yxatdan o'tmagan.", source: dd });
    assert.deepStrictEqual(both.check.phrases.map(p => p.phrase), ["ro'yxatdan o'tmagan"]);
    // a quotation that is not the document's own words is still checked
    const misquote = ex.finishExplanation({ reply: "**AI izohi:** Hujjatda «belgi ro'yxatdan o'tmagan» deb yozilgan.", source: dd });
    assert.strictEqual(misquote.check.phrases.length, 1);
  });

  await test('arithmetic: sums, differences and percentages of the document\'s figures are named as a calculation in either section, never as invented', () => {
    const cp = ex.markPages(byId('corporate-protocol').pages);
    for (const sn of ["Qatnashganlar jami 70 foiz.", "Yetishmagan ulush 5 foiz (75 - 70).", "Kapital 300 000 000 so'mga oshadi."]) {
      for (const reply of [sn, `Matn.\n\n**AI izohi:** ${sn}`]) {
        const done = ex.finishExplanation({ reply, source: cp });
        assert.ok(done.reply.includes(sn));
        const sec = /AI izohi/u.test(reply) ? done.check.sections.aiNote : done.check.sections.body;
        assert.deepStrictEqual(sec.numbers, [], `${sn}: not "not in the document" -> ${JSON.stringify(sec)}`);
      }
    }
  });

  await test('a placeholder AI note is left out (the prompt asks for none); a figure or page the document lacks is named, not removed; Russian label too', () => {
    const src = ex.markPages(byId('contract-supply').pages);
    for (const ph of ["**AI izohi:** Yo'q.", '**AI izohi:** —', "**AI izohi:** Qo'shimcha izoh yo'q.", '**AI izohi**\n\n**Xulosa**']) {
      const done = ex.finishExplanation({ reply: `Matn.\n\n${ph}`, source: src });
      assert.ok(!/AI izohi:\*\*|AI izohi\*\*\n/u.test(done.reply.split('**Avtomatik')[0]), ph);
      assert.ok(done.reply.includes("«AI izohi» bo'sh yoki to'ldiruvchi edi — ko'rsatilmadi."), ph);
    }
    const r = ex.finishExplanation({ reply: "Matn.\n\n**AI izohi:** Narx 90 000 000 so'm bo'lishi kerak edi (7-sahifa).", source: src });
    assert.ok(r.reply.includes("**AI izohi:** Narx 90 000 000 so'm bo'lishi kerak edi (7-sahifa)."));
    assert.ok(r.reply.includes("- AI izohi — manba bilan qo'lda tekshirish kerak: hujjat matnida uchramagan raqam 90 000 000; hujjatda bunday belgisi yo'q sahifa 7."), r.reply);
    const ru = ex.finishExplanation({ reply: 'Текст.\n\n**Комментарий ИИ:** Главный риск — штраф за просрочку.', source: src });
    assert.ok(ru.reply.includes('Главный риск — штраф за просрочку.'));
    assert.deepStrictEqual(ru.check.sections.aiNote.phrases.map(p => p.kind).sort(), ['oqibat', 'ustuvorlik']);
  });

  await test('the main text: an unsupported status, consequence or ranking is named for a manual check, not removed and not called wrong', () => {
    const src = ex.markPages(byId('due-diligence').pages);
    const done = ex.finishExplanation({ reply: "**Intellektual mulk**\nBelgi ro'yxatdan o'tmagan. Bu eng katta xatar.", source: src });
    assert.ok(done.reply.includes("Belgi ro'yxatdan o'tmagan. Bu eng katta xatar."), 'not removed');
    assert.ok(done.reply.includes("- Asosiy matn — manba bilan qo'lda tekshirish kerak: «ro'yxatdan o'tmagan» (holat), «eng katta» (ustuvorlik) — hujjat matnida bu ibora yoki uning sinonimi uchramadi"), done.reply);
    // the act itself now counts toward matching the clause (2026-10-09): the
    // document denies the filing, the answer the registration - named too
    assert.ok(done.reply.includes("javobda «ro'yxatdan o'tkazish» inkor; hujjatning shu bandida inkor — «ariza topshirish» (holat)"), done.reply);
    const ok = ex.finishExplanation({ reply: "Ariza berilmagan. Reklama faoliyati uchun litsenziya mavjud emas. Qarz va majburiy ijro aniqlanmadi (2026-yil 12-avgust holatiga).", source: src });
    assert.deepStrictEqual(ok.check.phrases, []);
    assert.ok(ok.reply.includes("Mexanik solishtirishda belgilanadigan joy topilmadi. Bu mazmun yoki huquqiy to'g'rilik tasdig'i emas."), ok.reply);
  });

  await test('the prompt applies every rule to the AI izohi and makes it optional - in general words, no evaluation names', () => {
    const p = ex.explainSystem('Uzbek');
    for (const s2 of ['Every rule here applies to every part of the answer, the "AI izohi" included',
      'never attribute to the document something it does not say', 'an application not filed is not "not registered"',
      'never rank anything as the main, biggest or most important risk or issue unless the document itself ranks it',
      'keep the document\'s time limits', 'The "AI izohi" is optional', 'leave it out entirely - no heading, no placeholder']) {
      assert.ok(p.includes(s2), s2);
    }
    for (const f of fixtures) for (const c of f.aiNoteCases) assert.ok(!p.includes(c.note), c.note);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
