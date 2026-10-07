'use strict';

/**
 * LEGACY (tariffs v1). Since tariffs v2 (2026-10-04) these weights apply only
 * to subscriptions sold under v1, until they end (tariff_periods rules
 * 'legacy_v1'); new periods count units per service (tests/tariffs-v2.test.js).
 *
 * Fair-use weights approved by the owner (docs/audit/DECISIONS.md D-11), and
 * the promise they exist to keep: the weekly draft and opinion allowances a
 * paid plan is sold with must be reachable without tripping fair-use.
 *
 *   node tests/tariff-fair-use-weights.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ENDPOINT_WEIGHT_SQL, LEGACY_PLANS: PLANS } = require('../src/rag/subscription-tiers');

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

test('opinion and explain jobs are recorded under their own names', () => {
  // v2: sized by the document and reserved from the handler (meterDocument)
  assert.ok(/service: 'opinion', text: documentText, docTicket: req\.body\.docTicket, endpoint: '\/api\/draft\/legal-opinion'/.test(server));
  const route = require('fs').readFileSync(require('path').join(__dirname, '../src/rag/document-explain-route.js'), 'utf8');
  assert.ok(/service: 'analysis', text: documentText, docTicket: req\.body\.docTicket, endpoint: '\/api\/draft\/explain-document'/.test(route));
  assert.ok(/mountExplainDocument\(app, \{/.test(server));
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
