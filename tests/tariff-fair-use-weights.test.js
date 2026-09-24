'use strict';

/**
 * Fair-use weights approved by the owner (docs/audit/DECISIONS.md D-11), and
 * the promise they exist to keep: the weekly draft and opinion allowances a
 * paid plan is sold with must be reachable without tripping fair-use.
 *
 *   node tests/tariff-fair-use-weights.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ENDPOINT_WEIGHT_SQL, PLANS } = require('../src/rag/subscription-tiers');

const like = (p) => new RegExp('^' + p.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
function weight(endpoint) {
  for (const [, op, pattern, value] of ENDPOINT_WEIGHT_SQL.matchAll(/WHEN endpoint (LIKE|=) '([^']+)'\s+THEN (\d+)/g)) {
    if (op === '=' ? endpoint === pattern : like(pattern).test(endpoint)) return Number(value);
  }
  return Number(/ELSE (\d+)/.exec(ENDPOINT_WEIGHT_SQL)[1]);
}
const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
const tiers = fs.readFileSync(path.join(__dirname, '..', 'src', 'rag', 'subscription-tiers.js'), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

console.log('tariff — fair-use weights (D-11)');

test('the approved table', () => {
  const table = {
    '/api/legal-chat': 1,
    '/api/enterprise-chat': 1,
    '/api/draft/suggest': 1,
    '/api/templates/analyze': 1,
    '/api/draft/export': 0,
    '/api/draft/export-raw': 0,
    '/api/draft/ai-generate': 0,
    '/api/draft/legal-opinion': 0,
    '/api/opinion-request': 0,
    '/api/analyze/ocr': 0,
    '/api/draft/explain-document': 3,
    '/api/analyze': 3,
  };
  for (const [endpoint, w] of Object.entries(table)) assert.strictEqual(weight(endpoint), w, endpoint);
});

test('opinion and explain requests are recorded under their own names', () => {
  assert.ok(/'\/api\/draft\/legal-opinion', requireAuth, tariffModule\.enforceQuota\('\/api\/opinion-request'/.test(server));
  assert.ok(/'\/api\/draft\/explain-document', requireAuth, tariffModule\.enforceQuota\('\/api\/draft\/explain-document'/.test(server));
});

test("an opinion request row is not counted as a spent credit", () => {
  const pattern = /opinionCreditsUsed[\s\S]*?endpoint LIKE '([^']+)'/.exec(tiers)[1];
  assert.ok(!like(pattern).test('/api/opinion-request'));
  assert.ok(like(pattern).test('/api/draft/legal-opinion'));
});

test('free and trial daily limits count only rows that weigh something', () => {
  assert.ok(/COUNT\(\*\) FILTER \(WHERE \(\$\{ENDPOINT_WEIGHT_SQL\}\) > 0\)/.test(tiers));
  assert.ok(!/COUNT\(\*\)::int AS used FROM tariff_usage WHERE admin_id = \$1 AND ts >= \$2/.test(tiers),
    'no raw COUNT(*) left in the daily limits');
});

test('every paid plan can use its whole weekly draft allowance within fair-use', () => {
  for (const key of ['silver', 'gold', 'platinum']) {
    const cfg = PLANS[key];
    const perDay = Math.ceil((cfg.weeklyDrafts || 0) / 7);
    // A day of drafting: the AI draft plus its Word export, both weightless.
    const used = perDay * (weight('/api/draft/ai-generate') + weight('/api/draft/export'));
    assert.ok(used < cfg.fairUseDaily, `${key}: ${perDay} drafts/day weigh ${used} of ${cfg.fairUseDaily}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
