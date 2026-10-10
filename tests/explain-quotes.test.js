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
    assert.ok(r.reply.includes("server parchani hujjatda belgilar bo'yicha topdi, xolos — bu yonidagi izohning to'g'riligini tasdiqlamaydi"));
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
