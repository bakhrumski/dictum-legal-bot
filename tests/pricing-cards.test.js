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
const tariffHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'tariff.html'), 'utf8');
const tariff = tariffHtml;
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

test('the authenticated tariff page uses the same prices', () => {
  for (const [plan, uzs] of [['silver', '199000'], ['gold', '399000'], ['platinum', '999000']]) {
    assert.ok(tariffHtml.includes(`data-price="${uzs}"`),
      `tariff.html still has a stale ${plan} price`);
  }
});

test('the authenticated tariff page offers the permanent free plan', () => {
  assert.ok(tariffHtml.includes('data-plan="bepul"'), 'bepul action is missing');
  assert.ok(!/<button[^>]+data-plan="sinov"/.test(tariffHtml), 'obsolete sinov action is still advertised');
  assert.match(tariffHtml, /30 kun[\s\S]{0,80}kuniga 3 ta/, 'free step-down is missing');
});

test('opinion allowances are labelled as credits', () => {
  assert.match(tariffHtml, /39 ta yuridik xulosa krediti/);
  assert.match(tariffHtml, /74 ta yuridik xulosa krediti/);
  assert.match(tariffHtml, /182 ta yuridik xulosa krediti/);
  assert.match(tariffHtml, /1–3 kredit/, 'credit cost explanation is missing');
});

test('no superseded price or unanchored discount is still displayed', () => {
  // The old figures were struck through beside the new ones; that made the
  // Platinum price wrap mid-number and cluttered every card. Prices now show
  // once on both pricing surfaces.
  for (const old of ['299 000', '599 000', '1 199 000']) {
    assert.ok(!html.includes('>' + old + '<') && !html.includes('">' + old),
      `the superseded price ${old} is still on the page`);
  }
  for (const old of ['299,000', '599,000', '1,199,000']) {
    assert.ok(!tariffHtml.includes(old), `the superseded price ${old} is still on tariff.html`);
  }
  assert.ok(!html.includes('plan-old'), 'the struck-through price element is still present');
  assert.ok(!tariffHtml.includes('plan-price-old'), 'tariff.html still has struck-through prices');
  // The -33% badge went with them: a discount claim with no anchor price
  // tells a reader 33% off *what*, and cannot be answered from the card.
  assert.ok(!html.includes('plan-off'), 'the discount badge has no reference price to justify it');
  assert.ok(!tariffHtml.includes('plan-saving'), 'tariff.html still has an unanchored discount badge');
});

test('a price can never wrap mid-number', () => {
  // "999 000" split across two lines in production before this.
  const css = html.slice(html.indexOf('.plan-price{'), html.indexOf('}', html.indexOf('.plan-price{')));
  assert.ok(css.includes('white-space:nowrap'), '.plan-price must not wrap');
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

test('every paid tier leads with the headline benefit, not a pointer', () => {
  // These used to read "Silver'dagi hamma narsa, ustiga:" — an instruction to
  // go read another card, and a different length on every tier, which is what
  // knocked the bullet lists out of alignment.
  for (const k of ['p2_f1', 'p3_f1', 'p4_f1']) {
    assert.match(val(uz, k), /Cheksiz AI chat/, `${k} should lead with the headline benefit`);
    assert.match(val(ru, k), /Безлимитный AI-чат/, `${k} missing in Russian`);
  }
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

console.log('\npricing cards — tariff.html stays in step\n');

test('tariff.html charges the same prices as the landing page', () => {
  // Two pages advertise the same plans. They drifted before: tariff.html was
  // still on 299/599/1199 with "Oyiga 300 ta so'rov" long after the landing
  // page moved, and it is the page a user reaches to PAY.
  for (const [markup, base] of [['199,000', '199000'], ['399,000', '399000'], ['999,000', '999000']]) {
    assert.ok(tariff.includes('>' + markup + '<'), `tariff.html missing price ${markup}`);
    assert.ok(tariff.includes('data-price="' + base + '"'), `tariff.html data-price ${base} missing`);
  }
  // Multi-month controls were intentionally removed from the simplified UI;
  // there must not be a second client-side price table that can drift.
  assert.ok(!tariff.includes('BASE_PRICES'), 'tariff.html carries a duplicate client-side price table');
});

test('tariff.html advertises the same quotas', () => {
  for (const q of ['~39', '~95', '~74', '~217', '~182', '~542']) {
    assert.ok(tariff.includes(q), `tariff.html missing quota ${q}`);
  }
  assert.ok(!/Oyiga (300|750|1,?500) ta so‘?'?rov/.test(tariff),
    'tariff.html still advertises the old request counts');
});

test('both pages lead every paid tier with the same benefit', () => {
  // "Silver'dagi hamma narsa, ustiga:" was an inheritance pointer, not a
  // benefit — and it made the first bullet of each card a different length.
  for (const [name, doc] of [['index', html], ['tariff', tariff]]) {
    assert.ok(!/dagi hamma narsa/.test(doc), `${name}.html still uses an inheritance line`);
  }
  assert.strictEqual((tariff.match(/Cheksiz AI chat/g) || []).length, 3,
    'each paid tier in tariff.html should lead with "Cheksiz AI chat"');
});

test('cards reserve height so rows align across the row', () => {
  for (const [name, doc, selector] of [['index', html, '.plan-for'], ['tariff', tariff, '.plan-audience']]) {
    const forCss = doc.slice(doc.indexOf(selector), doc.indexOf(selector) + 260);
    assert.ok(/min-height:\s*\d+/.test(forCss),
      `${name}.html: ${selector} has no reserved height, so bullet lists start at different heights`);
    assert.ok(/min-height:\s*0/.test(doc),
      `${name}.html: reserved heights are never released, so stacked cards carry dead space`);
  }
});

console.log('\npricing cards — payments not yet live\n');

test('the server REFUSES paid plans, not just the UI', () => {
  // Dimming cards is cosmetic. /api/tariff/select previously activated any
  // plan "as if paid", so anyone could POST {plan:'platinum'} and get it free.
  const srv = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
  assert.ok(/const PAYMENTS_ENABLED = process\.env\.PAYMENTS_ENABLED === 'true'/.test(srv),
    'no PAYMENTS_ENABLED flag');
  const sel = srv.slice(srv.indexOf("app.post('/api/tariff/select'"), srv.indexOf("app.post('/api/tariff/select'") + 1400);
  assert.ok(/!PAYMENTS_ENABLED/.test(sel) && /priceUzs > 0/.test(sel),
    'the select endpoint does not refuse paid plans while payments are off');
  assert.ok(!/sets the plan AS IF paid/.test(sel), 'the grant-anyway path is still present');
});

test('the UI reads the flag the server enforces with', () => {
  const srv = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
  assert.ok(/paymentsEnabled: PAYMENTS_ENABLED/.test(srv),
    '/api/tariff/plans must publish the flag so the UI cannot carry its own');
  assert.ok(tariff.includes('paymentsEnabled'), 'tariff.html does not read the flag');
});

test('interest is captured instead of a dead button', () => {
  const srv = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
  assert.ok(srv.includes("app.post('/api/tariff/interest'"), 'no interest endpoint');
  assert.ok(srv.includes("app.get('/api/admin/plan-interest'"), 'no way to read the demand signal');
  assert.ok(tariff.includes('registerInterest('), 'tariff.html does not register interest');
  for (const [name, doc] of [['index', html], ['tariff', tariff]])
    assert.ok(/Xabar berish/.test(doc), `${name}.html has no "notify me" action`);
});

test('paid cards are dimmed AND labelled, never dimmed alone', () => {
  // A greyed card with no explanation reads as broken, or as "you are not
  // eligible", rather than "not yet".
  assert.strictEqual((html.match(/class="plan soon/g) || []).length, 3,
    'index.html should dim exactly the three paid tiers');
  assert.ok(/\.plan\.soon\{opacity/.test(html), 'no dimming style');
  assert.ok(html.includes('data-i18n="p_soon"'), 'no "Tez orada" badge');
  assert.ok(tariff.includes('badge-soon'), 'tariff.html has no badge');
});

test('the reason is stated once, above the cards, in both languages', () => {
  assert.ok(html.includes('data-i18n="pr_testing"'), 'index.html has no testing notice');
  for (const [lang, block] of [['uz', uz], ['ru', ru]]) {
    const n = val(block, 'pr_testing') || '';
    assert.ok(n.length > 60, `pr_testing missing or too short in ${lang}`);
  }
  assert.ok(tariff.includes('planNote'), 'tariff.html has no testing notice');
});

test('the free plan is the featured card while paid is closed', () => {
  // Gold carried the "Mashhur" tag and the only primary button — the strongest
  // pull on the page led to a dead end.
  const bepulCard = html.slice(html.indexOf('data-i18n="p1_name"') - 260, html.indexOf('data-i18n="p1_f1"'));
  assert.ok(bepulCard.includes('plan ft'), 'the free card is not featured');
  assert.ok(!/data-i18n="p3_tag"/.test(html), 'Gold still carries the "Mashhur" tag');
  assert.ok(tariff.includes('data-plan="bepul"'), 'tariff.html free card is not the bepul plan');
});

test('the free card activates the plan it advertises', () => {
  // It promised "Kuniga 10 ta savol / Doimo bepul" while activating `sinov` —
  // 3/day for 10 days. A broken promise at the first step of onboarding.
  assert.ok(tariff.includes("selectPlan('bepul')"), 'free button still selects the wrong plan');
  const tiers = fs.readFileSync(path.join(__dirname, '..', 'src', 'rag', 'subscription-tiers.js'), 'utf8');
  assert.ok(/bepul:\s*\{/.test(tiers), 'the bepul plan does not exist server-side');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
