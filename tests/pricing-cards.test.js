'use strict';

/**
 * Tests for the pricing cards in public/index.html.
 *
 * Pricing copy is the one place where a stale number is a commercial problem
 * rather than a cosmetic one: a card promising an allowance the server does
 * not grant is a promise the platform breaks on the user's first day. These
 * checks tie the marketing copy to PLANS in subscription-tiers.js.
 *
 *   node tests/pricing-cards.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const tiersSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'rag', 'subscription-tiers.js'), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

const uz = html.slice(html.indexOf('uz:{'), html.indexOf('ru:{'));
const ru = html.slice(html.indexOf('ru:{'));
const val = (block, key) => (block.match(new RegExp(key + ':"([^"]*)"')) || [])[1];

console.log('\npricing cards — prices match the server\n');

test('every advertised price is the price the server charges', () => {
  for (const [plan, uzs] of [['silver', '199 000'], ['gold', '399 000'], ['platinum', '999 000']]) {
    assert.ok(html.includes('>' + uzs + '<'), `card is missing the ${plan} price ${uzs}`);
    const server = (tiersSrc.match(new RegExp(plan + '[\\s\\S]{0,400}?priceUzs:\\s*(\\d+)')) || [])[1];
    assert.strictEqual(server, uzs.replace(/\s/g, ''),
      `${plan}: card says ${uzs}, server charges ${server}`);
  }
});

test('old prices are struck through, not just deleted', () => {
  for (const old of ['299 000', '599 000', '1 199 000']) {
    assert.ok(html.includes('plan-old">' + old), `${old} is not shown struck through`);
  }
  assert.ok(html.includes('plan-off'), 'no discount badge');
});

console.log('\npricing cards — advertised quotas match PLANS\n');

test('monthly opinion figures are derived from the weekly credits, not typed', () => {
  // 4.33 weeks/month. If a quota changes and the card does not, the platform
  // is advertising something it will refuse.
  const W = 52 / 12;
  for (const [plan, key] of [['silver', 'p2_f2'], ['gold', 'p3_f2'], ['platinum', 'p4_f2']]) {
    const weekly = Number((tiersSrc.match(new RegExp(plan + '[\\s\\S]{0,400}?weeklyOpinionCredits[^|]*\\|\\|\\s*(\\d+)')) || [])[1]);
    const advertised = Number((val(uz, key) || '').replace(/\D+/g, ''));
    const expected = Math.round(weekly * W);
    assert.ok(Math.abs(advertised - expected) <= 2,
      `${plan}: card advertises ~${advertised}/mo but ${weekly}/week is ~${expected}/mo`);
  }
});

test('monthly drafting figures match too', () => {
  const W = 52 / 12;
  for (const [plan, key] of [['silver', 'p2_f3'], ['gold', 'p3_f3'], ['platinum', 'p4_f3']]) {
    const weekly = Number((tiersSrc.match(new RegExp(plan + '[\\s\\S]{0,400}?weeklyDrafts[^|]*\\|\\|\\s*(\\d+)')) || [])[1]);
    const advertised = Number((val(uz, key) || '').replace(/\D+/g, ''));
    const expected = Math.round(weekly * W);
    assert.ok(Math.abs(advertised - expected) <= 3,
      `${plan}: card advertises ~${advertised} drafts/mo but ${weekly}/week is ~${expected}/mo`);
  }
});

test('the free card matches the bepul step-down', () => {
  assert.ok(/10/.test(val(uz, 'p1_f1')), 'free card should state 10/day');
  assert.ok(/3/.test(val(uz, 'p1_f2')), 'free card should state the step-down to 3/day');
  assert.ok(/dailyLimit:\s*10/.test(tiersSrc) && /dailyLimitLater:\s*3/.test(tiersSrc),
    'server does not implement 10 -> 3');
});

console.log('\npricing cards — copy quality\n');

test('every plan says who it is for', () => {
  for (const k of ['p1_for', 'p2_for', 'p3_for', 'p4_for']) {
    assert.ok(html.includes('data-i18n="' + k + '"'), `${k} missing from the markup`);
    assert.ok((val(uz, k) || '').length > 25, `${k} has no real audience line`);
    assert.ok((val(ru, k) || '').length > 25, `${k} missing in Russian`);
  }
});

test('higher tiers inherit rather than repeat', () => {
  assert.match(val(uz, 'p3_f1'), /Silver/, 'Gold should build on Silver');
  assert.match(val(uz, 'p4_f1'), /Gold/, 'Platinum should build on Gold');
});

test('the loyalty rebate is advertised', () => {
  assert.ok(html.includes('data-i18n="pr_note"'), 'rebate note missing from the markup');
  for (const [lang, block] of [['uz', uz], ['ru', ru]]) {
    const n = val(block, 'pr_note') || '';
    assert.ok(n.length > 60, `pr_note missing or too short in ${lang}`);
    assert.ok(n.includes('<b>'), `pr_note in ${lang} should lead with a bold hook`);
  }
});

test('no advertised feature contradicts the lex.uz-only restriction', () => {
  const all = [uz, ru].join(' ');
  assert.ok(!/web\s*qidiruv|веб-поиск/i.test(all),
    'a plan still advertises general web search, which the platform now forbids');
});

test('every pricing key exists in both languages', () => {
  const keys = [...new Set([...html.matchAll(/data-i18n="(p[0-9]_[a-z0-9]+|pr_[a-z]+|p_[a-z]+)"/g)].map(m => m[1]))];
  const missing = keys.filter(k => val(uz, k) === undefined || val(ru, k) === undefined);
  assert.deepStrictEqual(missing, [], 'untranslated key(s): ' + missing.join(', '));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
