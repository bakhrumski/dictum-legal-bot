'use strict';

// Drafting usage must be recorded under names the counters actually match.
// Every drafting route used to record the literal '/api/draft', which
// draftsUsed() ('%draft/ai-generate%') never matched — the weekly draft
// allowance was never enforced — and the fair-use weight charged a Word/PDF
// export, which calls no model, the same 7 as an AI draft.
//
// No database here, so the SQL LIKE patterns are evaluated in JS against the
// endpoint names the routes record.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ENDPOINT_WEIGHT_SQL } = require('../src/rag/subscription-tiers');

const tiersSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'rag', 'subscription-tiers.js'), 'utf8');
const routesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'drafting', 'routes.js'), 'utf8');

const like = (pattern) => new RegExp('^' + pattern.split('%').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');

// CASE WHEN endpoint LIKE '...' THEN n ... ELSE n END, first match wins.
function weight(endpoint) {
  const cases = [...ENDPOINT_WEIGHT_SQL.matchAll(/WHEN endpoint (LIKE|=) '([^']+)'\s+THEN (\d+)/g)];
  for (const [, op, pattern, value] of cases) {
    if (op === '=' ? endpoint === pattern : like(pattern).test(endpoint)) return Number(value);
  }
  return Number(/ELSE (\d+)/.exec(ENDPOINT_WEIGHT_SQL)[1]);
}

const draftCountPattern = /draftsUsed[\s\S]*?endpoint LIKE '([^']+)'/.exec(tiersSrc)[1];

// The endpoint each drafting route records: quotaFor('<name>') on its line.
function recorded(route) {
  const line = routesSrc.split('\n').find((l) => l.includes(`app.post('${route}'`));
  assert.ok(line, `route ${route} not found`);
  const m = /quotaFor\('([^']+)'(?:, \{[^}]*\})?\)/.exec(line);
  assert.ok(m, `${route} records no usage`);
  return m[1];
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n      ${e.message}`); }
}

console.log('\ntariff — drafting usage is counted under the right names\n');

test('an AI draft is counted by the weekly draft allowance', () => {
  assert.ok(like(draftCountPattern).test(recorded('/api/draft/ai-generate')),
    `draftsUsed matches '${draftCountPattern}', ai-generate records '${recorded('/api/draft/ai-generate')}'`);
});

test('exports, suggestions and template analysis are not counted as drafts', () => {
  for (const route of ['/api/draft/export', '/api/draft/export-raw', '/api/draft/suggest', '/api/templates/analyze']) {
    assert.ok(!like(draftCountPattern).test(recorded(route)), `${route} would use up a draft`);
  }
});

test('a Word/PDF export and an AI draft weigh nothing in fair-use (D-11); suggestions weigh 1', () => {
  assert.strictEqual(weight(recorded('/api/draft/export')), 0);
  assert.strictEqual(weight(recorded('/api/draft/export-raw')), 0);
  assert.strictEqual(weight(recorded('/api/draft/ai-generate')), 0);
  assert.strictEqual(weight(recorded('/api/draft/suggest')), 1);
});

test('an ordinary chat still weighs 1', () => {
  assert.strictEqual(weight('/api/legal-chat'), 1);
});

test('no drafting route records the ambiguous bare /api/draft', () => {
  assert.ok(!/enforceQuota\('\/api\/draft'\)/.test(routesSrc));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exitCode = 1;
