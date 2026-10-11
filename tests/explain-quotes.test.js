'use strict';

/**
 * Key conditions tied to the document's own wording (2026-10-09), on
 * ANONYMOUS SYNTHETIC text. Stub AI, no paid call. A pass shows the server
 * quotes only the document's verified sentences, refuses ids it did not issue
 * and keeps checking the model's own explanation - not that answers are right.
 *
 *   node tests/explain-quotes.test.js
 */

const assert = require('assert');
const ex = require('../src/rag/document-explain');
const q = require('../src/rag/source-quotes');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

// a synthetic agreement: a distribution clause with its scope words, a remedy
// clause with all its consequences, and filler to make it a digest-length text
const KEY = [
  "9.1. Tugatish imtiyozi to'langanidan keyin qolgan mablag' barcha ishtirokchilar, jumladan Investor o'rtasida ularning ulushlariga mutanosib ravishda taqsimlanadi.",
  "9.2. Imtiyoz summasi investitsiya summasining bir baravari va unga Investorga e'lon qilingan, lekin to'lanmagan dividendlar qo'shiladi.",
  "13.2. Maqsadli sarf buzilsa, Investor investitsiyani qaytarishni va o'zi amalga oshirgan barcha xarajatlarni qoplashni talab qilishga haqli; bundan tashqari Jamiyat investitsiya summasining 25 foizi miqdorida jarima to'laydi, jarima zarardan tashqari alohida hisoblanadi.",
];
const filler = i => `${i}.1. Taraflar ushbu bo'lim bo'yicha ${i} ish kuni ichida o'zaro yozma xabar almashadi va hujjatlarni saqlaydi.`;
const doc = [...Array.from({ length: 60 }, (_, i) => filler(i + 20)), ...KEY].join('\n');

function stubAI(answerFor) {
  const calls = [];
  const fn = async (messages, opts) => {
    calls.push({ messages, opts });
    if (/^Excerpt /u.test(messages[1].text)) return { text: '- band', provider: 'stub' };
    return { text: answerFor(messages[1].text), provider: 'stub' };
  };
  fn.calls = calls;
  return fn;
}
const tagOf = (prompt, needle) => {
  const line = prompt.split('\n').find(l => l.includes(needle) && /\[S\d+·/u.test(l));
  return line && (line.match(/\[S\d+·[0-9a-f]{4}\]/u) || [])[0];
};
const digestOf = ai => t => ex.buildDigest(t, { callAI: ai });

(async () => {
  await test('ids are issued only for sentences found verbatim in the document, bound to its sha256 key; a digest line is never a source', () => {
    const s = q.buildSources(doc, [KEY[0], 'Dayjest: qolgan mablag\' ishtirokchilarga taqsimlanadi.', KEY[2]]);
    assert.strictEqual(s.key, q.docKey(doc));
    assert.deepStrictEqual(s.items.map(x => x && x.id), ['S1', null, 'S2']);
    assert.strictEqual(s.notInSource, 1);
    for (const it of s.items.filter(Boolean)) assert.ok(doc.includes(it.text));
  });

  await test('the server checks every id: unknown number, another document\'s key or no key -> refused and named, never quoted', () => {
    const s = q.buildSources(doc, [KEY[0]]);
    const other = q.docKey(`${doc} boshqa`);
    const p = q.placeQuotes(`A ${s.items[0].tag}. B [S7·${s.key}]. C [S1·${other}]. D [S1].`, s);
    assert.deepStrictEqual(p.quotes.map(x => x.status), ['quoted', 'unknown_id', 'other_document', 'no_key']);
    assert.ok(!/\d/u.test(p.text.replace(/[A-D]\.?/gu, '')), 'placeholders carry no figure for the checks to see');
    const out = q.renderQuotes(p.text, p.quotes);
    assert.strictEqual((out.match(/hujjat matnidan aynan parcha/gu) || []).length, 1);
    assert.ok(out.includes(`> «${KEY[0]}» — hujjat matnidan aynan parcha (S1)`));
    assert.ok(out.includes("[S7: manba ko'rsatilmadi — bu hujjatda bunday manba qatori yo'q]"));
    assert.ok(out.includes("[S1: manba ko'rsatilmadi — identifikator bu hujjatga tegishli emas]"));
    assert.ok(out.includes("[S1: manba ko'rsatilmadi — identifikator hujjat kalitisiz yozilgan]"));
  });

  await test('end to end: the key lines reach the model with ids; the quote under the answer is the document\'s sentence; one digest pass and one final call, no extra correcting call', async () => {
    const ai = stubAI(prompt => `Qolgan mablag' barcha ishtirokchilar, jumladan Investor o'rtasida ulushlarga mutanosib taqsimlanadi ${tagOf(prompt, '9.1.')}.`);
    const r = await ex.explainDocument({ documentText: doc, langName: 'Uzbek', callAI: ai, digest: digestOf(ai) });
    const final = ai.calls[ai.calls.length - 1].messages;
    assert.ok(/\[S\d+·[0-9a-f]{4}\] 9\.1\./u.test(final[1].text), final[1].text.slice(-800));
    assert.ok(final[0].text.includes('copy its id exactly as given'));
    assert.ok(r.reply.includes(`> «${KEY[0]}» — hujjat matnidan aynan parcha`), r.reply);
    assert.strictEqual(r.check.quotes.quoted.length, 1);
    assert.strictEqual(r.check.verified, false);
    // no AI call besides the digest parts and the one explanation
    const digestCalls = ai.calls.filter(c => /^Excerpt /u.test(c.messages[1].text)).length;
    assert.strictEqual(ai.calls.length, digestCalls + 1);
    assert.ok(r.reply.includes("server parchani hujjatda belgilar bo'yicha topdi, xolos — identifikator to'g'ri ochilgani yonidagi izoh aynan shu bandga tegishli ekanini ham, to'g'ri ekanini ham tasdiqlamaydi"));
    assert.ok(!/tuzatildi|tasdiqlandi|tekshiruvdan o'tdi/u.test(r.reply));
  });

  await test('a correct quote with a wrong explanation: the explanation is still flagged and nothing is called corrected', async () => {
    // the model drops "jumladan Investor" and turns "all participants" into "the other participants"; its id is right
    const ai = stubAI(prompt => `Qolgan mablag' boshqa ishtirokchilar o'rtasida taqsimlanadi ${tagOf(prompt, '9.1.')}. Maqsadli sarf buzilsa, Investor investitsiyani qaytarishni talab qiladi va Jamiyat 25 foiz jarima to'laydi ${tagOf(prompt, '13.2.')}.`);
    const r = await ex.explainDocument({ documentText: doc, langName: 'Uzbek', callAI: ai, digest: digestOf(ai) });
    // both quotes are there, word for word from the document
    assert.ok(r.reply.includes(`> «${KEY[0]}»`) && r.reply.includes(`> «${KEY[2]}»`), r.reply);
    // the scope words the explanation dropped are still named (the quote does not count as the explanation)
    for (const w of ['jumladan', 'alohida']) assert.ok(r.check.scopeWordsMissing.some(x => x.includes(w)), `${w}: ${JSON.stringify(r.check.scopeWordsMissing)}`);
    assert.strictEqual(r.check.verified, false);
    assert.ok(r.reply.includes("Qamrov so'zlari — manba bilan qo'lda tekshirish kerak"), r.reply);
    assert.ok(!/tuzatildi|tuzatilgan javob/u.test(r.reply));
  });

  await test('the same in digest mode: the digest kept "barcha ishtirokchilar, jumladan Investor", the answer quotes the right clause but explains "other participants" - the digest -> answer signal stays', async () => {
    const long = [...Array.from({ length: 160 }, (_, i) => filler(i + 20)), ...KEY].join('\n');
    assert.ok(ex.contentChars(long) > ex.EXPLAIN_FULL_TEXT_MAX);
    const line = "- Taqsimlanadigan summa | barcha ishtirokchilar, jumladan Investor → qolgan qism ulushlarga mutanosib taqsimlanadi | shart: imtiyoz to'langanidan keyin";
    const ai = async (messages) => {
      if (/^Excerpt /u.test(messages[1].text)) return { text: messages[1].text.includes('9.1.') ? line : '- band', provider: 'stub' };
      return { text: `Taqsimlanadigan summa: qolgan qism boshqa ishtirokchilar o'rtasida ulushlarga mutanosib taqsimlanadi ${tagOf(messages[1].text, '9.1.')}.`, provider: 'stub' };
    };
    const r = await ex.explainDocument({ documentText: long, langName: 'Uzbek', callAI: ai, digest: t => ex.buildDigest(t, { callAI: ai }) });
    assert.ok(r.reply.includes(`> «${KEY[0]}»`), r.reply.slice(0, 600));
    const sig = r.check.digestSignals.find(x => x.topic === 'Taqsimlanadigan summa');
    assert.ok(sig && sig.lost.some(l => l.value === 'jumladan'), JSON.stringify(r.check.digestSignals));
    assert.ok(!/tuzatildi|tuzatilgan javob/u.test(r.reply));
  });

  await test('the document\'s own "[S2]" text is left as written: never taken for a system id, never refused or quoted', async () => {
    const own = `${doc}\n30.1. Hisob-kitob [S2] ilovasi va [S3·beef] jadvali bo'yicha olib boriladi.`;
    const ai = stubAI(() => 'Hisob-kitob [S2] ilovasi va [S3·beef] jadvali bo\'yicha.');
    const r = await ex.explainDocument({ documentText: own, langName: 'Uzbek', callAI: ai, digest: digestOf(ai) });
    assert.ok(r.reply.includes("Hisob-kitob [S2] ilovasi va [S3·beef] jadvali bo'yicha."), r.reply.slice(0, 300));
    assert.deepStrictEqual([r.check.quotes.quoted, r.check.quotes.refused], [[], []]);
    assert.ok(!r.reply.includes("manba ko'rsatilmadi"));
  });

  await test('size: every quote is the whole sentence (even when the key line sent to the model was shortened), nothing is cut after the quotes, the notes stay at the end', async () => {
    const longClause = `14.1. ${"Ijrochi har bir bosqich yakunida buyurtmachiga barcha hujjatlarni, jumladan dalolatnoma, hisob-faktura va texnik hisobotni, ".repeat(3)}yozma ravishda besh ish kuni ichida topshiradi, bundan tashqari elektron nusxasini alohida yuboradi.`;
    const big = `${doc}\n${longClause}`;
    const ai = stubAI(prompt => {
      const ids = [...new Set(prompt.match(/\[S\d+·[0-9a-f]{4}\]/gu) || [])];
      return ids.map((id, i) => `${i + 1}-band izohi ${id}.`).join('\n');
    });
    const r = await ex.explainDocument({ documentText: big, langName: 'Uzbek', callAI: ai, digest: digestOf(ai) });
    const sent = ai.calls[ai.calls.length - 1].messages[1].text.split('\n').find(l => l.includes('14.1.') && /\[S\d+·/u.test(l));
    assert.ok(sent && sent.includes('…'), 'the key line was shortened for the model');
    assert.ok(r.reply.includes(`> «${longClause}»`), 'the quote is the whole sentence');
    for (const id of r.check.quotes.quoted) assert.ok(r.reply.includes(`(${id})`), id);
    assert.strictEqual(r.check.quotes.quoted.length, r.check.quotes.issued);
    assert.ok(/\n- Iqtiboslar \(AI emas\): [^\n]+\.$/u.test(r.reply), r.reply.slice(-300));
    assert.ok(r.reply.includes('**Avtomatik tekshiruv (AI emas):**'));
    assert.ok(!r.coverage.partial, 'a long answer with quotes is not marked partial for its length');
  });

  await test('an answer cut at the cap: the cut is said, the quote of a kept sentence stays whole, an id in the dropped text quotes nothing', async () => {
    let tags;
    const ai = async (messages) => {
      if (/^Excerpt /u.test(messages[1].text)) return { text: '- band', provider: 'stub' };
      tags = [tagOf(messages[1].text, '9.1.'), tagOf(messages[1].text, '13.2.')];
      return { text: `Qolgan mablag' barcha ishtirokchilar, jumladan Investor o'rtasida taqsimlanadi ${tags[0]}. Jarima alohida hisoblanadi ${tags[1]} va yana`, truncated: true, provider: 'stub' };
    };
    const r = await ex.explainDocument({ documentText: doc, langName: 'Uzbek', callAI: ai, digest: digestOf(ai) });
    assert.ok(r.coverage.partial && r.reply.includes('javob uzunlik chegarasida to\'xtadi'), r.reply.slice(0, 300));
    assert.ok(r.reply.includes(`> «${KEY[0]}»`));
    assert.ok(!r.reply.includes(`> «${KEY[2]}»`), 'the dropped sentence\'s quote is not shown');
  });

  await test('the page shows each quote as a closed block with the full sentence: the server line and the page\'s pattern agree; the full texts are in check.quotes.items for the diagnostics JSON', async () => {
    const page = require('fs').readFileSync(require('path').join(__dirname, '../public/dashboard.html'), 'utf8');
    const src = page.match(/var SOURCE_QUOTE_LINE = (\/.+\/gm);/u);
    assert.ok(src, 'the page has the quote pattern');
    const re = eval(src[1]); // the page's own regular expression literal
    const ai = stubAI(prompt => `Taqsimot ${tagOf(prompt, '9.1.')}.\nJarima ${tagOf(prompt, '13.2.')}.`);
    const r = await ex.explainDocument({ documentText: doc, langName: 'Uzbek', callAI: ai, digest: digestOf(ai) });
    const found = [...r.reply.matchAll(re)].map(m => [m[2], m[1]]);
    assert.deepStrictEqual(found.map(f => f[1]).sort(), [KEY[0], KEY[2]].sort(), 'the page reads every quote whole');
    assert.deepStrictEqual(r.check.quotes.items.map(x => x.text).sort(), [KEY[0], KEY[2]].sort());
    for (const s2 of ["Manbadan iqtibos — ochish", "Manbadan iqtibos — yopish", "— AI izohi emas", '<details class="ai-src-quote"']) assert.ok(page.includes(s2), s2);
  });

  // ── 2026-10-11: lists, ranges, system ids vs real figures, whole table rows, usage ──
  const three = ["3.1. Birinchi shart uzun matni shu yerda yoziladi.", "3.2. Ikkinchi shart uzun matni shu yerda yoziladi.", "3.3. Uchinchi shart uzun matni shu yerda yoziladi."];
  const small = three.join('\n');

  await test('a list [S1·k, S2·k] and a range [S1·k – S3·k] are opened id by id, each checked against the key and the issued list', () => {
    const s3 = q.buildSources(small, three);
    const k = s3.key;
    const p = q.placeQuotes(`A [S1·${k}, S2·${k}]. B [S1·${k} – S3·${k}]. C [S2·${k}; S3·beef].`, s3, { sourceText: small });
    assert.deepStrictEqual(p.quotes.map(x => `${x.id}:${x.status}`), ['S1:quoted', 'S2:quoted', 'S1:quoted', 'S2:quoted', 'S3:quoted', 'S2:quoted', 'S3:other_document']);
    const out = q.renderQuotes(p.text, p.quotes, p.refs);
    assert.ok(out.includes('A [S1, S2].') && out.includes('B [S1, S2, S3].'), out);
    assert.ok(out.includes("C [S2, S3: manba ko'rsatilmadi — identifikator bu hujjatga tegishli emas]."), out);
    for (const t of three) assert.strictEqual(out.split(`> «${t}»`).length - 1, 1, 'each source quoted once');
    // a key on one end of a range covers it; two different keys do not
    assert.deepStrictEqual(q.placeQuotes(`[S1 – S2·${k}]`, s3).quotes.map(x => x.status), ['quoted', 'quoted']);
    assert.deepStrictEqual(q.placeQuotes(`[S1·beef – S2·${k}]`, s3).quotes.map(x => x.status), ['other_document', 'other_document']);
  });

  await test('a range longer than the limit is named, not opened and not dropped; the limit is stated and can be set', () => {
    const many = Array.from({ length: 15 }, (_, i) => `${i + 1}.1. Shart raqami ${i + 1} uchun yetarli uzun matn.`);
    const doc15 = many.join('\n');
    const s15 = q.buildSources(doc15, many);
    const p = q.placeQuotes(`KPI [S1·${s15.key} – S15·${s15.key}].`, s15, { sourceText: doc15 });
    assert.deepStrictEqual(p.quotes.map(x => [x.id, x.status, x.span]), [['S1–S15', 'range_too_long', 15]]);
    const out = q.renderQuotes(p.text, p.quotes, p.refs);
    assert.ok(out.includes(`KPI [S1–S15: manba ko'rsatilmadi — oraliq ${q.RANGE_MAX} tadan uzun — iqtiboslar ochilmadi].`), out);
    assert.strictEqual(q.RANGE_MAX, 12);
    assert.strictEqual(q.placeQuotes(`[S1·${s15.key} – S15·${s15.key}]`, s15, { rangeMax: 15 }).quotes.filter(x => x.status === 'quoted').length, 15);
  });

  await test('system ids are taken out of the figure check, and only they: real figures, fractions and other bracketed text are still checked; a wrong id is recorded as an unrecognised reference', async () => {
    const doc2 = [...Array.from({ length: 60 }, (_, i) => filler(i + 20)), ...KEY, "40.1. Ulush 1/2 nisbatda bo'linadi [2-ilova]."].join('\n');
    const ai = stubAI(prompt => {
      const t1 = tagOf(prompt, '9.1.'), t2 = tagOf(prompt, '13.2.');
      return `Taqsimot ${t1}. Jarima ${t2.replace(']', ', S14·' + t2.slice(-5, -1) + ']')}. Ulush 13/17 nisbatda [7-ilova]. Muddat [S5 band 9 731 kun].`;
    });
    const r = await ex.explainDocument({ documentText: doc2, langName: 'Uzbek', callAI: ai, digest: digestOf(ai) });
    const flagged = JSON.stringify([r.check.numbers, r.check.derived]);
    assert.ok(!/"14"|"5"|"0{0,1}1"/u.test(JSON.stringify(r.check.derived)), flagged);
    assert.ok(!r.check.numbers.includes('14') && !r.check.numbers.includes('5'), flagged);
    // real figures stay checked, in a bracket too: 13/17 and 9 731 are not in the document
    assert.ok(/13\/17/u.test(flagged) && /9 ?731/u.test(flagged), flagged);
    assert.ok(r.check.quotes.usage.unprocessed.some(u => /S5/u.test(u.written)), JSON.stringify(r.check.quotes.usage));
    assert.ok(r.check.quotes.usage.refused.some(u => u.id === 'S14' && u.status === 'unknown_id'), JSON.stringify(r.check.quotes.usage.refused));
    assert.ok(r.reply.includes("noto'g'ri yoki tanilmagan havola"));
  });

  await test('a table row is quoted whole - table, row, section, every column header and cell, empty and merged cells kept - even when a full stop inside a cell cut its sentence', async () => {
    const row = "⟦Jadval 4 · 7-qator · Sotuv bosqichi⟧ ⟨№⟩ 7 ¦ ⟨Ish⟩ Oylik tushum. Kamida 4 500 AQSh dollari ¦ ⟨Mablag'⟩ ⟨bo'sh⟩ ¦ ⟨Muddat⟩ ⟨↑ 2027-yil, iyun⟩";
    const docT = [...Array.from({ length: 60 }, (_, i) => filler(i + 20)), ...KEY, "⟦Jadval 4 · sarlavha⟧ № ¦ Ish ¦ Mablag' ¦ Muddat", row].join('\n');
    const st = q.buildSources(docT, ['Kamida 4 500 AQSh dollari ¦ ⟨Mablag\'⟩ ⟨bo\'sh⟩ ¦ ⟨Muddat⟩ ⟨↑ 2027-yil, iyun⟩', '⟦Jadval 4 · 7-qator · Sotuv bosqichi⟧ ⟨№⟩ 7 ¦ ⟨Ish⟩ Oylik tushum.']);
    const it = st.items[0];
    assert.strictEqual(st.items[1], it, 'two pieces of one row are one source');
    assert.strictEqual(it.kind, 'table_row');
    assert.deepStrictEqual([it.row.table, it.row.row, it.row.section], [4, 7, 'Sotuv bosqichi']);
    assert.deepStrictEqual(it.row.cells.map(c => [c.header, c.value, c.empty, c.merged]), [['№', '7', false, false], ['Ish', 'Oylik tushum. Kamida 4 500 AQSh dollari', false, false], ["Mablag'", '', true, false], ['Muddat', '2027-yil, iyun', false, true]]);
    assert.strictEqual(it.text, "Jadval 4 · 7-qator · Sotuv bosqichi — №: 7 ¦ Ish: Oylik tushum. Kamida 4 500 AQSh dollari ¦ Mablag': (bo'sh) ¦ Muddat: 2027-yil, iyun (yuqoridagi katak bilan birlashtirilgan)");
    const p = q.placeQuotes(`MRR ${it.tag}.`, st, { sourceText: docT });
    const out = q.renderQuotes(p.text, p.quotes, p.refs);
    assert.ok(out.includes(`> «${it.text}» — hujjat jadvalidan aynan qator (S1)`), out);
    // the page reads the row line and shows its cells
    const page = require('fs').readFileSync(require('path').join(__dirname, '../public/dashboard.html'), 'utf8');
    const re = eval(page.match(/var SOURCE_QUOTE_LINE = (\/.+\/gm);/u)[1]);
    const m = [...out.matchAll(re)][0];
    assert.deepStrictEqual([m[1], m[2], m[3]], [it.text, 'jadvalidan aynan qator', 'S1']);
    assert.ok(page.includes("Hujjat jadvali, to\\'liq qator, ustun sarlavhalari bilan ("));
  });

  await test('usage for the diagnostics: issued, used (and how often), used again, refused, not processed and never used - and what it does not show', () => {
    const s3 = q.buildSources(small, three);
    const k = s3.key;
    const p = q.placeQuotes(`A [S1·${k}]. B [S1·${k}, S9·${k}]. C [S2]. D [S2 band 4].`, s3, { sourceText: small });
    const u = q.quoteUsage(p, s3);
    assert.deepStrictEqual(u.issued, ['S1', 'S2', 'S3']);
    assert.deepStrictEqual(u.used, { S1: 2 });
    assert.deepStrictEqual(u.repeated, ['S1']);
    assert.deepStrictEqual(u.refused.map(x => `${x.id}:${x.status}`), ['S9:unknown_id', 'S2:no_key']);
    assert.deepStrictEqual(u.unprocessed.map(x => x.written), ['S2']);
    assert.deepStrictEqual(u.unused, ['S2', 'S3']);
    assert.ok(/does not show that the explanation beside an id is about that clause or right/u.test(u.meaning));
  });

  await test('the page records which quotes were opened, bound to this request\'s trace, and puts them in the JSON', () => {
    const page = require('fs').readFileSync(require('path').join(__dirname, '../public/dashboard.html'), 'utf8');
    for (const s2 of ["document.addEventListener('toggle'", "lastExplainTrace.tag !== tag || lastExplainTrace.epoch !== diagEpoch", "el.setAttribute('data-trace-tag', traceTag)", 'quotesOpened: lastExplainTrace.opened || {}']) assert.ok(page.includes(s2), s2);
  });

  await test('no id from the model: no quote, nothing invented; ids the model made up are refused', async () => {
    const plain = await ex.explainDocument({ documentText: doc, langName: 'Uzbek', callAI: stubAI(() => 'Oddiy izoh.'), digest: digestOf(stubAI(() => '')) });
    assert.ok(!plain.reply.includes('hujjat matnidan aynan parcha'));
    assert.deepStrictEqual(plain.check.quotes.quoted, []);
    const made = await ex.explainDocument({ documentText: doc, langName: 'Uzbek', callAI: stubAI(() => 'Izoh [S99·0000].'), digest: digestOf(stubAI(() => '')) });
    assert.deepStrictEqual(made.check.quotes.refused.map(x => x.id), ['S99']);
    assert.ok(!made.reply.includes('hujjat matnidan aynan parcha'));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
