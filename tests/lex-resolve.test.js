'use strict';

/**
 * Tests for src/rag/lex-resolve.js — the reference scanner and lex.uz query
 * builder. Fixtures are the ACTUAL citation strings from the outsourcing
 * report whose legal opinion came back as "KONTEKSTda tasdiqlanmadi"; if these
 * pass, that document's acts would have been looked up.
 *
 * Network-free: only scanning and query construction are exercised here.
 *
 *   node tests/lex-resolve.test.js
 */

const assert = require('assert');
const {
  scanBareReferences, mergeReferences, scanWeight, queryVariants, mapLimit,
  isDescriptiveName, matchesReference, scoringText,
} = require('../src/rag/lex-resolve');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}
async function testAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

// Verbatim-style citation forms from the real report.
const REPORT = `
Autsorsing bo'yicha hisobot.

Vazirlar Mahkamasining 306-sonli qaror, 14-modda talablariga muvofiq
xizmatlar ko'rsatiladi. Shuningdek 596-sonli qarordagi tartib qo'llaniladi.
Ijro tartibi 276-sonli ijro Nizomiga asoslanadi, 16-sonlili qaror bilan
tasdiqlangan reglament ham amal qiladi (306, 7–12-m.; 684).

O'zbekiston Respublikasi Prezidentining 27.11.2023 sanali PF-200 farmoni
hamda 18.11.2025 sanali F-59 farmoyishi ham inobatga olingan.

Turkiyaning 4734 va 4735-son qonunlari hamda Yevropa Ittifoqining 2014/24/EU
direktivasi qiyoslash uchun keltirilgan. OECD tahlillari ham mavjud.
`;

console.log('\nlex-resolve — scanning\n');

test('finds bare "<N>-sonli qaror" numbers the prefixed regex misses', () => {
  const refs = scanBareReferences(REPORT);
  const nums = refs.map(r => r.number);
  for (const n of ['306', '596', '276', '16']) {
    assert.ok(nums.includes(n), `expected reference ${n}, got [${nums.join(', ')}]`);
  }
});

test('tolerates the "16-sonlili" typo', () => {
  const refs = scanBareReferences('16-sonlili qaror bilan tasdiqlangan');
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0].number, '16');
});

test('finds prefixed PF- and F- forms', () => {
  const refs = scanBareReferences(REPORT);
  const pf = refs.find(r => r.number === '200');
  const f = refs.find(r => r.number === '59');
  assert.ok(pf, 'PF-200 not found');
  assert.strictEqual(pf.type, 'prezident_farmoni');
  assert.ok(f, 'F-59 not found');
  assert.strictEqual(f.type, 'farmoyish');
});

test('picks up a corroborated number from a parenthesised list', () => {
  // "684" appears only inside "(306, 7–12-m.; 684)" here, so it is NOT
  // corroborated and must be skipped; "306" is corroborated by "306-sonli".
  const refs = scanBareReferences(REPORT);
  assert.ok(refs.some(r => r.number === '306'), '306 missing');
  assert.ok(!refs.some(r => r.number === '684'), '684 should need corroboration');

  const withCorroboration = scanBareReferences(REPORT + '\n684-sonli qonun.\n');
  assert.ok(withCorroboration.some(r => r.number === '684'), '684 missing once corroborated');
});

test('does not mistake article locators ("7–12-m.") for document numbers', () => {
  const refs = scanBareReferences('Nizomning 7–12-m. bandlariga muvofiq.');
  assert.strictEqual(refs.length, 0, `got [${refs.map(r => r.number).join(', ')}]`);
});

test('infers act type and lex.uz prefix from surrounding words', () => {
  const refs = scanBareReferences('Vazirlar Mahkamasining 306-sonli qarori');
  assert.strictEqual(refs[0].type, 'VM_qarori');
  assert.strictEqual(refs[0].prefix, 'VMQ');
});

test('captures a nearby date', () => {
  const refs = scanBareReferences('27.11.2023 sanali PF-200 farmoni');
  assert.strictEqual(refs[0].date, '27.11.2023');
});

test('splits a list sharing one "-son" suffix ("276, 596-son qarorlar")', () => {
  const refs = scanBareReferences('Hisobot 276, 596-son qarorlarga tayangan.');
  const nums = refs.map(r => r.number).sort();
  assert.deepStrictEqual(nums, ['276', '596'], `got [${nums.join(', ')}]`);
});

test('a listed number is not double-counted by the single-number pass', () => {
  const refs = scanBareReferences('4734 va 4735-son qonunlari');
  const last = refs.find(r => r.number === '4735');
  assert.strictEqual(last.hits, 1, `hits=${last.hits}`);
});

test('counts repeat citations rather than duplicating the reference', () => {
  const refs = scanBareReferences('306-sonli qaror ... yana 306-sonli qaror ... va 306-sonli qaror');
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0].hits, 3);
});

console.log('\nlex-resolve — merging\n');

test('merge attaches LLM claims to a scanned reference', () => {
  const scanned = scanBareReferences('306-sonli qarori');
  const llm = [{ type: 'VM_qarori', name: 'Autsorsing nizomi', number: '306-son', date: '', claims: ['14-modda xizmatni ruxsat etadi'] }];
  const merged = mergeReferences(llm, scanned);
  const r = merged.find(x => x.number === '306');
  assert.ok(r, '306 lost in merge');
  assert.deepStrictEqual(r.claims, ['14-modda xizmatni ruxsat etadi']);
  assert.strictEqual(r.name, 'Autsorsing nizomi');
  assert.strictEqual(merged.filter(x => x.number === '306').length, 1, 'duplicated');
});

test('merge keeps LLM-only numbered references the scanner missed', () => {
  const merged = mergeReferences(
    [{ type: 'qonun', name: 'Mehnat kodeksi', number: '4624', claims: ['a'] }],
    scanBareReferences('306-sonli qarori')
  );
  assert.ok(merged.some(r => r.number === '4624'));
});

test('an LLM-extracted EU directive is flagged foreign at merge time', () => {
  // "2014/24/EU direktivasi" arrives from the LLM extractor, so clause-local
  // scanning never sees it; without a merge-time check its year resolves
  // against lex.uz and matches some Uzbek act adopted in 2014.
  const merged = mergeReferences(
    [{ type: 'boshqa', name: '2014/24/EU direktivasi', number: '2014/24', claims: ['ochiq tanlov'] }], []);
  const r = merged.find(x => /2014/.test(x.number) || /2014/.test(x.name));
  assert.ok(r, 'directive lost in merge');
  assert.strictEqual(r.foreign, 'Yevropa Ittifoqi');
  assert.deepStrictEqual(queryVariants(r), []);
});

test('a prefixless year-like number is not queried as "<year>-сон"', () => {
  const v = queryVariants({ number: '2014', prefix: '', name: '', date: '', claims: [] });
  assert.ok(!v.some(q => /^2014-сон/.test(q)), `got [${v.join(' | ')}]`);
});

test('a name query is tried in Cyrillic — the script lex.uz indexes', () => {
  const v = queryVariants({ number: '', prefix: '', name: 'Davlat xaridlari to‘g‘risida', date: '' });
  assert.ok(v.some(q => /давлат харидлари тўғрисида/.test(q)), `got [${v.join(' | ')}]`);
});

test('transliteration keeps t+s intact ("autsorsing" is not "ауцорсинг")', () => {
  // Run 5 queried "ауцорсинг тендерларини..." and found nothing — the ts→ц
  // digraph corrupted a loanword where t and s straddle a morpheme boundary.
  const { translitToCyr } = require('../src/rag/lex-resolve');
  assert.strictEqual(translitToCyr('autsorsing'), 'аутсорсинг');
  assert.strictEqual(translitToCyr('Davlat xaridlari to‘g‘risida'), 'давлат харидлари тўғрисида');
});

test('merge keeps name-only references', () => {
  const merged = mergeReferences([{ type: 'kodeks', name: 'Fuqarolik kodeksi', number: '', claims: ['8-modda'] }], []);
  assert.ok(merged.some(r => r.name === 'Fuqarolik kodeksi'));
});

test('weight ranks claimed, frequently-cited references above uncorroborated ones', () => {
  const strong = { number: '306', name: 'Nizom', claims: ['a', 'b'], hits: 4, confidence: 'high' };
  const weak = { number: '684', name: '', claims: [], hits: 1, confidence: 'low' };
  assert.ok(scanWeight(strong) > scanWeight(weak));
});

console.log('\nlex-resolve — query variants\n');

test('Cyrillic-prefixed form is tried first for a VM qarori', () => {
  const v = queryVariants({ number: '306', prefix: 'VMQ', name: 'Autsorsing nizomi', date: '2026-yil' });
  assert.strictEqual(v[0], 'ВМҚ-306-сон', `got ${v[0]}`);
  assert.ok(v.includes('306-сон'), 'bare Cyrillic form missing');
  assert.ok(v.some(q => /2026/.test(q)), 'year-qualified form missing');
});

test('falls back to bare and Latin forms when the prefix is unknown', () => {
  const v = queryVariants({ number: '16', prefix: '', name: '', date: '' });
  assert.strictEqual(v[0], '16-сон');
  assert.ok(v.includes('16-son'));
});

test('a name-only reference still produces a query (Cyrillic first)', () => {
  const v = queryVariants({ number: '', prefix: '', name: 'Fuqarolik kodeksi', date: '' });
  assert.deepStrictEqual(v, ['фуқаролик кодекси', 'Fuqarolik kodeksi']);
});

test('no query is emitted for an empty reference', () => {
  assert.deepStrictEqual(queryVariants({ number: '', prefix: '', name: '', date: '' }), []);
});

console.log('\nlex-resolve — foreign instruments\n');

test('Turkish law numbers are flagged foreign, not searched on lex.uz', () => {
  const refs = scanBareReferences(REPORT);
  const t = refs.filter(r => ['4734', '4735'].includes(r.number));
  assert.strictEqual(t.length, 2, `expected 4734 and 4735, got ${t.length}`);
  for (const r of t) {
    assert.strictEqual(r.foreign, 'Turkiya', `${r.number} not flagged foreign`);
    assert.deepStrictEqual(queryVariants(r), [], `${r.number} still produces a lex.uz query`);
  }
});

test('an EU directive year is not treated as an Uzbek document number', () => {
  const refs = scanBareReferences('Yevropa Ittifoqining 2014/24/EU direktivasi');
  for (const r of refs) assert.ok(r.foreign, `"${r.number}" leaked as a domestic reference`);
});

test('jurisdiction attribution is clause-local, not window-based', () => {
  // A domestic act wrongly marked foreign is never looked up at all — the very
  // failure this pipeline exists to fix — so a comparative report that names
  // Turkey or the EU nearby must not contaminate the Uzbek acts around it.
  const cases = [
    ['Turkiyaning 4734 va 4735-son qonunlari; 306-sonli qaror; 684-sonli qonun.', { 4734: 'F', 4735: 'F', 306: '', 684: '' }],
    ['Turkiya tajribasi keltirilgan. Vazirlar Mahkamasining 306-sonli qarori.', { 306: '' }],
    ['Yevropa Ittifoqining 2014/24/EU direktivasi va 16-sonlili qaror', { 16: '' }],
    ['Turkiyaning 4734 va 4735-son qonunlari, Yevropa Ittifoqi qoidalari hamda 276-sonli ijro Nizomi.', { 4734: 'F', 4735: 'F', 276: '' }],
    ['OECD tavsiyalari va 596-sonli qaror', { 596: '' }],
    ['Angliyaning 2012-son akti', { 2012: 'F' }],
  ];
  for (const [text, expected] of cases) {
    for (const r of scanBareReferences(text)) {
      const want = expected[r.number];
      if (want === undefined) continue;
      assert.strictEqual(r.foreign ? 'F' : '', want,
        `"${text}" → ${r.number} expected ${want || 'domestic'}, got ${r.foreign || 'domestic'}`);
    }
  }
});

test('domestic references are NOT flagged foreign', () => {
  const refs = scanBareReferences(REPORT);
  const domestic = refs.find(r => r.number === '306');
  assert.strictEqual(domestic.foreign, '');
  assert.ok(queryVariants(domestic).length > 0);
});

console.log('\nlex-resolve — descriptive names\n');

test('a described act is not searched verbatim', () => {
  assert.ok(isDescriptiveName('Davlat korxonalarida xarajatlarni kamaytirish va samaradorlikka oid prezident hujjati'));
  assert.ok(isDescriptiveName('xarid tartibiga doir qaror'));
  assert.deepStrictEqual(
    queryVariants({ number: '', name: 'Davlat korxonalarida xarajatlarni kamaytirishga oid prezident hujjati', prefix: '', date: '' }),
    []
  );
});

test('"X to‘g‘risidagi Qonun" is a real title, not a description', () => {
  // This is the canonical Uzbek act-title form. Treating it as descriptive
  // suppressed the query for the Public Procurement Law itself.
  for (const n of ['Davlat xaridlari to‘g‘risidagi qonun', 'Davlat xaridlari to‘g‘risida', 'Ijro hujjatlari haqidagi qonun']) {
    assert.ok(!isDescriptiveName(n), `"${n}" wrongly treated as descriptive`);
    assert.ok(queryVariants({ number: '', name: n, prefix: '', date: '' }).length > 0, `"${n}" produced no query`);
  }
});

console.log('\nlex-resolve — identity gate\n');

const hit = (title, document_number, adoption_date, extra = {}) =>
  ({ title, url: 'https://lex.uz/docs/1', head: extra.head || '', tail: extra.tail || '', metadata: { document_number, adoption_date, act_form: extra.act_form, publication: extra.publication } });

test('accepts a document whose OWN number matches', () => {
  const v = matchesReference({ number: '306', name: '' }, hit('Autsorsing to‘g‘risida', '306', '2026-06-12'));
  assert.strictEqual(v.ok, true, v.why);
  assert.strictEqual(v.confirmed, true);
});

test('reads the number from the act-form line when the title has none', () => {
  // A lex.uz ACT_TITLE usually states only the act's NAME. Requiring the
  // number to be in the title rejected every correct match.
  const v = matchesReference(
    { number: '596', name: '' },
    hit('Ижро этувчи ҳокимият органларида аутсорсинг', null, null,
        { act_form: 'ВАЗИРЛАР МАҲКАМАСИНИНГ ҚАРОРИ 23.09.2021 й. N 596' })
  );
  assert.strictEqual(v.ok, true, v.why);
  assert.strictEqual(v.confirmed, true);
});

test('reads the number from the document head ("596-сон")', () => {
  const v = matchesReference({ number: '596', name: '' },
    hit('Аутсорсинг тўғрисида', null, null, { head: 'Вазирлар Маҳкамасининг 596-сон қарори' }));
  assert.strictEqual(v.ok, true, v.why);
});

test('the registry path yields the ACT number, not the registration index', () => {
  // "03/21/684/0367-сон" is the national-registry form: 684 is the Public
  // Procurement Law's number, 0367 only its registration index. Capturing
  // 0367 made the gate reject the real law — the biggest miss of run 4.
  const { documentOwnNumbers } = require('../src/rag/lex-resolve');
  const own = documentOwnNumbers(hit('Давлат харидлари тўғрисида', null, null,
    { publication: 'Қонунчилик маълумотлари миллий базаси, 23.04.2021 й., 03/21/684/0367-сон' }));
  assert.ok(own.strong.has('684'), `expected 684, strong=[${[...own.strong]}]`);
  assert.ok(!own.strong.has('0367'), 'registration index leaked as a document number');
});

test('a law\'s number in the signature block (tail) is strong identity', () => {
  const v = matchesReference({ number: '684', name: '' },
    hit('Давлат харидлари тўғрисида', null, null,
      { tail: 'Ўзбекистон Республикасининг Президенти Ш. МИРЗИЁЕВ\nТошкент ш.,\n2021 йил 22 апрель,\nЎРҚ-684-сон' }));
  assert.strictEqual(v.ok, true, v.why);
  assert.strictEqual(v.confirmed, true);
});

test('an amendment decree targeting the act is kept but never confirmed', () => {
  // "...16-сон қарорига ўзгартириш киритиш тўғрисида" MENTIONS 16 in its
  // title; it amends the act, it is not the act.
  const v = matchesReference({ number: '16', name: '' },
    hit('Ҳукуматнинг 16-сон қарорига ўзгартириш ва қўшимчалар киритиш тўғрисида', null, null));
  assert.strictEqual(v.ok, true, v.why);
  assert.strictEqual(v.confirmed, false, 'amendment must not be a confirmed identity');
});

test('a strong number mismatch is not overridden by a weak mention', () => {
  // The outsourcing decree (own number 596) cites 306 in its preamble; that
  // mention must not let it pass as decree 306.
  const v = matchesReference({ number: '306', name: '' },
    hit('Аутсорсинг хизматларини ташкил этиш тўғрисида', null, null,
      { act_form: 'ВАЗИРЛАР МАҲКАМАСИНИНГ ҚАРОРИ N 596', head: '306-сон қарорга мувофиқ ишлаб чиқилган' }));
  assert.strictEqual(v.ok, false);
  assert.match(v.why, /raqam mos emas/);
});

test('rejects the full-text false positive that broke production', () => {
  // lex.uz search for "306-сон" returned a burial-benefit regulation that
  // merely MENTIONS 306 somewhere in its body.
  const v = matchesReference(
    { number: '306', name: '' },
    hit('ДАФН ЭТИШГА НАФАҚА ТАЙИНЛАШ ВА ТЎЛАШ ТАРТИБИ ТЎҒРИСИДАГИ НИЗОМ', '870', '2011-12-30')
  );
  assert.strictEqual(v.ok, false);
  assert.match(v.why, /raqam mos emas/);
});

test('rejects a right number from the wrong year', () => {
  const v = matchesReference({ number: '306', date: '2026-yil' }, hit('Boshqa qaror', '306', '2011-05-04'));
  assert.strictEqual(v.ok, false);
  assert.match(v.why, /yil mos emas/);
});

test('accepts when the number is only in the title, not the metadata', () => {
  const v = matchesReference({ number: '306', name: '' }, hit('Vazirlar Mahkamasining 306-son qarori', null, null));
  assert.strictEqual(v.ok, true, v.why);
});

test('an unidentifiable but on-topic document is kept, flagged unconfirmed', () => {
  // "Does not say what it is" must not be treated like "says it is something
  // else": rejecting both outright removed all the junk AND all the grounding.
  const v = matchesReference(
    { number: '306', name: 'autsorsing xizmatlari nizomi', claims: ['autsorsing tartibi belgilanadi'] },
    hit('Autsorsing xizmatlarini tashkil etish nizomi', null, null)
  );
  assert.strictEqual(v.ok, true, v.why);
  assert.strictEqual(v.confirmed, false, 'should not claim the number was confirmed');
});

test('matches a Latin citation against a Cyrillic lex.uz title', () => {
  // lex.uz publishes predominantly in Cyrillic; reports are written in Latin.
  // Without transliteration every cross-script comparison scores zero and the
  // topical fallback can never fire on real data.
  const cases = [
    [{ number: '', name: 'Davlat xaridlari to‘g‘risida', claims: [] }, 'Давлат харидлари тўғрисида', true],
    [{ number: '306', name: 'autsorsing xizmatlari nizomi', claims: ['autsorsing tartibi'] },
      'Ижро этувчи ҳокимият органлари ва давлат корхоналарида аутсорсинг хизматларини ташкил этиш', true],
    [{ number: '306', name: 'autsorsing nizomi', claims: [] }, 'ДАФН ЭТИШГА НАФАҚА ТАЙИНЛАШ ТАРТИБИ', false],
    [{ number: '', name: 'Davlat xaridlari to‘g‘risida', claims: [] }, 'Давлат ижтимоий суғуртаси тўғрисида', false],
  ];
  for (const [ref, title, want] of cases) {
    const v = matchesReference(ref, hit(title, null, null));
    assert.strictEqual(v.ok, want, `"${title.slice(0, 40)}" → ${v.ok} (${v.why})`);
  }
});

test('rejects an unidentifiable document that is also off-topic', () => {
  const v = matchesReference(
    { number: '306', name: 'autsorsing xizmatlari nizomi', claims: [] },
    hit('Dafn etishga nafaqa tayinlash tartibi', null, null)
  );
  assert.strictEqual(v.ok, false, v.why);
});

test('name-only reference needs real title overlap, not one lucky word', () => {
  const ref = { number: '', name: 'Davlat xaridlari to‘g‘risida' };
  assert.strictEqual(matchesReference(ref, hit('Davlat xaridlari to‘g‘risidagi Qonun', null, null)).ok, true);
  assert.strictEqual(matchesReference(ref, hit('Davlat ijtimoiy sug‘urtasi to‘g‘risida', null, null)).ok, false);
});

console.log('\nlex-resolve — hit ranking and cap\n');

test('one act per reference; off-topic runner-ups are dropped', () => {
  // Run 5: "18-сон 2022" passed BOTH a sanitary-permit regulation and a
  // telecom-licensing amendment — two same-numbered acts of different bodies.
  // Both ended up under Manbalar of an outsourcing opinion.
  const { gateAndCapHits } = require('../src/rag/lex-resolve');
  const ref = { number: '18', name: 'elektron tender platformasiga oid qaror', claims: ['elektron tender platformasi orqali xarid'], date: '' };
  const rejected = [];
  const kept = gateAndCapHits(ref, [
    hit('Санитария-эпидемиология хизмати рухсат тартиб-таомиллари тўғрисида', '18', '2022-01-05'),
    hit('ТЕЛЕКОММУНИКАЦИЯЛАР СОҲАСИДА ЛИЦЕНЗИЯЛАШ НИЗОМИГА ЎЗГАРТИРИШ', '18', '2022-03-01'),
  ], rejected);
  assert.strictEqual(kept.length, 1, `kept ${kept.length}, expected 1`);
});

test('an on-topic runner-up survives the cap', () => {
  const { gateAndCapHits } = require('../src/rag/lex-resolve');
  const ref = { number: '306', name: 'autsorsing xizmatlari', claims: ['autsorsing xizmatlarini tashkil etish'], date: '' };
  const kept = gateAndCapHits(ref, [
    hit('Аутсорсинг хизматларини ташкил этиш тўғрисида', '306', '2026-06-12'),
    hit('Аутсорсинг хизматлари механизмларини такомиллаштириш', '306', '2026-06-12'),
  ], []);
  assert.strictEqual(kept.length, 2);
});

test('the on-topic confirmed hit outranks the off-topic one', () => {
  const { gateAndCapHits } = require('../src/rag/lex-resolve');
  const ref = { number: '16', name: 'sogʻliqni saqlash xizmatlari', claims: ['sogʻliqni saqlashda xizmatlar roʻyxati'], date: '' };
  const kept = gateAndCapHits(ref, [
    hit('ОИЛАЛАРНИНГ ИЖТИМОИЙ-МАИШИЙ ШАРОИТЛАРИНИ ЯХШИЛАШ ТЎҒРИСИДА', '16', '2020-01-10'),
    hit('Соғлиқни сақлаш хизматлари рўйхатини тасдиқлаш тўғрисида', '16', '2020-01-10'),
  ], []);
  assert.ok(/сақлаш/i.test(kept[0].title), `wrong winner: ${kept[0].title}`);
});

console.log('\nlex-resolve — excerpt targeting\n');

test('scoringText uses the claims, not the document number', () => {
  const s = scoringText({ number: '684', name: 'Davlat xaridlari to‘g‘risida', claims: ['55 va 69-moddalariga ko‘ra yagona taklif'] });
  assert.ok(/55 va 69-moddalariga/.test(s), s);
  assert.ok(/Davlat xaridlari/.test(s), s);
});

console.log('\nlex-resolve — concurrency\n');

(async () => {
  await testAsync('mapLimit preserves order and respects the cap', async () => {
    let inFlight = 0, peak = 0;
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = await mapLimit(items, 3, async (n) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    });
    assert.deepStrictEqual(out, [2, 4, 6, 8, 10, 12, 14, 16]);
    assert.ok(peak <= 3, `peak concurrency ${peak} exceeded 3`);
  });

  await testAsync('mapLimit isolates a thrown task instead of failing the batch', async () => {
    const out = await mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    });
    assert.strictEqual(out[0], 1);
    assert.strictEqual(out[2], 3);
    assert.strictEqual(out[1].error, 'boom');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
