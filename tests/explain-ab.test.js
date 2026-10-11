'use strict';

/**
 * The A/B screening script (scripts/explain-ab.js) - NO AI CALL. A dry run on
 * anonymous synthetic fixtures builds the four variants' prompts; the live
 * mode refuses to start without every guard. A pass says the plan is built
 * as described, nothing about answer quality.
 *
 *   node tests/explain-ab.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ex = require('../src/rag/document-explain');
const { loadAll } = require('./fixtures/explain-eval/load');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const script = path.join(__dirname, '../scripts/explain-ab.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-'));
const files = ['long-service-docx', 'investment-agreement', 'relations-memorandum'].map((id) => {
  const f = path.join(dir, `${id}.txt`);
  fs.writeFileSync(f, loadAll().find(x => x.id === id).pages.join('\n\n'));
  return f;
});
const run = (extra = [], env = {}) => {
  try { return { code: 0, out: execFileSync(process.execPath, [script, '--docs', files.join(','), ...extra], { encoding: 'utf8', env: { ...process.env, ...env } }) }; }
  catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; }
};

(async () => {
  await test('dry run (default): 3 documents x 4 variants, one digest per document, the same helpers in every variant, costs split into estimate and reserve', () => {
    const r = run(['--json']);
    assert.strictEqual(r.code, 0, r.out);
    const j = JSON.parse(r.out.slice(r.out.indexOf('{')));
    assert.strictEqual(j.plan.length, 3);
    for (const d of j.plan) {
      assert.deepStrictEqual(d.variants.map(v => `${v.id}:${v.input}`), ['A:digest', 'B:digest', 'C:full_text', 'D:full_text']);
      assert.deepStrictEqual(d.variants.map(v => v.model), [j.base, j.strong, j.base, j.strong]);
      // A and B: the very same prompt; C and D: the very same prompt
      assert.strictEqual(d.variants[0].promptSha, d.variants[1].promptSha);
      assert.strictEqual(d.variants[2].promptSha, d.variants[3].promptSha);
      // the same key lines (ids) whatever the input form
      assert.ok(d.variants.every(v => v.ids === d.variants[0].ids), JSON.stringify(d.variants.map(v => v.ids)));
      assert.ok(d.digest.calls >= 1);
    }
    assert.ok(j.est > 0 && j.reserve > j.estCap && j.estCap > j.est);
    assert.strictEqual(j.cap, ex.EXPLAIN_MAX_TOKENS);
  });

  await test('the printed plan names what is measured, estimated and unknown, and never calls a reserve a guaranteed maximum', () => {
    const r = run();
    assert.ok(r.out.includes('NO AI CALL'));
    assert.ok(r.out.includes('MEASURED:') && r.out.includes('ESTIMATE:') && r.out.includes('UNKNOWN:'));
    assert.ok(r.out.includes('not a guaranteed maximum'));
    assert.ok(r.out.includes("~noma'lum"), 'the stronger model\'s time is unknown');
  });

  await test('live refuses without every guard; outputs never go inside the repository', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-out-'));
    assert.strictEqual(run(['--live', '--budget-usd', '5', '--out', out]).code, 2, 'no EXPLAIN_AB_LIVE=yes');
    assert.strictEqual(run(['--live', '--out', out], { EXPLAIN_AB_LIVE: 'yes' }).code, 2, 'no budget');
    assert.strictEqual(run(['--live', '--budget-usd', '5'], { EXPLAIN_AB_LIVE: 'yes' }).code, 2, 'no --out');
    assert.strictEqual(run(['--live', '--budget-usd', '5', '--out', out, '--strong', 'openai/gpt-6-sol'], { EXPLAIN_AB_LIVE: 'yes' }).code, 2, 'not a VoiceLab model');
    assert.strictEqual(run(['--out', path.join(__dirname, 'ab-out')]).code, 2, 'inside the repository');
    // a budget below the reserve: nothing is called (and no provider key is needed to find that out)
    const small = run(['--live', '--budget-usd', '0.01', '--out', out], { EXPLAIN_AB_LIVE: 'yes', VOICELAB_API_KEY: '' });
    assert.strictEqual(small.code, 3, small.out);
    assert.ok(/does not fit the budget/u.test(small.out));
    assert.deepStrictEqual(fs.readdirSync(out), [], 'nothing written');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
