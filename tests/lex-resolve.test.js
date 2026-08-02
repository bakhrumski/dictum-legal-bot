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

Xorijiy tajriba sifatida Turkiya va OECD hujjatlari keltirilgan.
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

test('a name-only reference still produces a query', () => {
  const v = queryVariants({ number: '', prefix: '', name: 'Fuqarolik kodeksi', date: '' });
  assert.deepStrictEqual(v, ['Fuqarolik kodeksi']);
});

test('no query is emitted for an empty reference', () => {
  assert.deepStrictEqual(queryVariants({ number: '', prefix: '', name: '', date: '' }), []);
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
