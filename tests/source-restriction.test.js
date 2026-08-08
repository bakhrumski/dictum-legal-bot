'use strict';

/**
 * Tests for the lex.uz-only source restriction.
 *
 * A real answer shipped to a user citing buxgalter.uz and talimxabarlari.uz
 * beside the Administrative Liability Code. Those are commercial aggregators
 * and a news site — not authoritative, not version-tracked — and the answer
 * presented them as legal sources. The platform's whole claim is that every
 * citation traces to lex.uz.
 *
 * Defence is in three layers; this file covers the one that is pure logic:
 *   1. provider layer  — web-search tools are never attached (server.js)
 *   2. prompt layer    — the model is told lex.uz only (server.js)
 *   3. output scrubber — non-lex.uz links are mechanically removed  ← here
 *
 * The scrubber is the guarantee: whatever the model writes, the delivered
 * answer cannot contain a URL outside lex.uz.
 *
 *   node tests/source-restriction.test.js
 */

const assert = require('assert');
const { stripNonLexSources, isAllowedUrl, normalizeResponseForUser } = require('../src/rag/prim-notation');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

console.log('\nsource restriction — URL allowlist\n');

test('lex.uz and its subdomains are allowed', () => {
  for (const u of [
    'https://lex.uz/docs/97664',
    'https://lex.uz/uz/docs/97664#:~:text=abc',
    'http://lex.uz/ru/docs/1',
    'https://www.lex.uz/docs/5382974',
  ]) assert.strictEqual(isAllowedUrl(u), true, u);
});

test('everything else is rejected', () => {
  for (const u of [
    'https://buxgalter.uz/oz/doc?id=19132',
    'https://talimxabarlari.uz/30094/',
    'https://norma.uz/x',
    'https://gazeta.uz/x',
    'https://lex.uz.evil.com/docs/1',   // suffix attack
    'https://notlex.uz/docs/1',
    'javascript:alert(1)',
    'not a url',
  ]) assert.strictEqual(isAllowedUrl(u), false, u);
});

console.log('\nsource restriction — scrubbing the real answer\n');

// Verbatim fragments from the answer that shipped.
const REAL = `Ma’muriy javobgarlik to‘g‘risidagi kodeks, 135-modda, birinchi va to‘rtinchi qismlarga ko‘ra, 1 BHM jarima qo‘llanadi. ([buxgalter.uz](https://buxgalter.uz/oz/doc?id=19132_kodeksi&utm_source=openai))

Lekin YHXXning rasmiy izohiga ko‘ra, [MJTK, 135-modda](https://lex.uz/docs/-97664)dagi imtiyozdan foydalanish uchun asl nusxa kerak. ([talimxabarlari.uz](https://talimxabarlari.uz/30094/?utm_source=openai))`;

test('the aggregator and news citations are removed entirely', () => {
  const out = stripNonLexSources(REAL);
  assert.ok(!/buxgalter\.uz/.test(out), 'buxgalter.uz survived:\n' + out);
  assert.ok(!/talimxabarlari\.uz/.test(out), 'talimxabarlari.uz survived:\n' + out);
  assert.ok(!/utm_source=openai/.test(out), 'tracking URL survived');
});

test('the lex.uz citation is preserved intact', () => {
  const out = stripNonLexSources(REAL);
  assert.ok(/\[MJTK, 135-modda\]\(https:\/\/lex\.uz\/docs\/-97664\)/.test(out),
    'lex.uz link was damaged:\n' + out);
});

test('the legal text itself is untouched', () => {
  const out = stripNonLexSources(REAL);
  assert.ok(/135-modda, birinchi va to‘rtinchi qismlarga ko‘ra/.test(out));
  assert.ok(/1 BHM jarima qo‘llanadi/.test(out));
});

test('no empty parentheses are left where a citation was', () => {
  const out = stripNonLexSources(REAL);
  assert.ok(!/\(\s*\)/.test(out), 'empty parens left behind:\n' + out);
});

console.log('\nsource restriction — edge cases\n');

test('a descriptive label survives, a bare-domain label does not', () => {
  assert.strictEqual(
    stripNonLexSources('Batafsil [ushbu tahlilda](https://example.com/x) yozilgan.'),
    'Batafsil ushbu tahlilda yozilgan.');
  assert.strictEqual(
    stripNonLexSources('Manba: [norma.uz](https://norma.uz/x)'),
    'Manba:');
});

test('bare URLs are stripped, lex.uz ones kept', () => {
  assert.strictEqual(stripNonLexSources('Qarang https://buxgalter.uz/doc/1 shu yerda.'),
    'Qarang shu yerda.');
  assert.ok(/https:\/\/lex\.uz\/docs\/5/.test(stripNonLexSources('Qarang https://lex.uz/docs/5')));
});

test('a Manbalar list of external links collapses without stray bullets', () => {
  const out = stripNonLexSources(
    'Manbalar:\n\n* [buxgalter.uz](https://buxgalter.uz/a)\n* [MJTK](https://lex.uz/docs/97664)\n');
  assert.ok(!/buxgalter/.test(out), out);
  assert.ok(/\[MJTK\]\(https:\/\/lex\.uz\/docs\/97664\)/.test(out), out);
  assert.ok(!/^\s*\*\s*$/m.test(out), 'orphaned bullet left:\n' + out);
});

test('an answer with no links is returned unchanged', () => {
  const t = 'Mehnat kodeksining 100-moddasiga ko‘ra ish beruvchi buyruq chiqarishi shart.';
  assert.strictEqual(stripNonLexSources(t), t);
});

test('scrubbing runs as part of the normal answer normalizer', () => {
  // The guarantee only holds if it is wired into the path every chat answer
  // takes, not merely available as a helper.
  const out = normalizeResponseForUser('Javob. ([buxgalter.uz](https://buxgalter.uz/x))');
  assert.ok(!/buxgalter/.test(out), 'normalizeResponseForUser did not scrub:\n' + out);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
