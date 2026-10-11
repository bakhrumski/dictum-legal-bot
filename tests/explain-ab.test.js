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
    assert.ok(r.out.includes('MEASURED (request 504b2e59-5fe4-4727-a88e-7fd000f77b1d') && r.out.includes('ESTIMATE:') && r.out.includes('UNKNOWN:'));
    assert.ok(r.out.includes('Other request (reference, not merged): 5c3c052e-0571-4c70-a6e6-361982965679') && r.out.includes('Not an independent calibration'));
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
    // a price not confirmed by the owner counts as unknown: refused before any call
    const noPrice = run(['--live', '--budget-usd', '5', '--out', out, '--prices-confirmed', 'voicelab/aisha-comet'], { EXPLAIN_AB_LIVE: 'yes' });
    assert.strictEqual(noPrice.code, 2, noPrice.out);
    assert.ok(/needs the price of voicelab\/aisha-halo confirmed/u.test(noPrice.out), noPrice.out);
    // a budget below the reserve: nothing is called (and no provider key is needed to find that out)
    const small = run(['--live', '--budget-usd', '0.01', '--out', out, '--prices-confirmed', 'voicelab/aisha-comet,voicelab/aisha-halo'], { EXPLAIN_AB_LIVE: 'yes', VOICELAB_API_KEY: '' });
    assert.strictEqual(small.code, 3, small.out);
    assert.ok(/does not fit the budget/u.test(small.out));
    assert.deepStrictEqual(fs.readdirSync(out), [], 'nothing written');
  });

  // ── one shared budget over every call (stub provider, no AI) ──
  const ab = require('../scripts/explain-ab');
  const msgs = (n = 2000) => [{ role: 'system', text: 'Tizim.' }, { role: 'user', text: 'Excerpt 1/1:\n\n' + 'x '.repeat(n) }];
  const one = ab.bound('voicelab/aisha-comet', msgs(), ab.CAP).usd;

  await test('parallel calls cannot pass on the same money: each bound is taken in the same step as the check', async () => {
    const budget = ab.newBudget(one * 3 + one / 2);
    const log = [];
    let called = 0;
    const provider = async () => { called++; await new Promise(r => setTimeout(r, 20)); return { text: 'ok', usage: { inTokens: 10, outTokens: 10 }, finishReason: 'stop' }; };
    const caller = ab.liveCaller('voicelab/aisha-comet', budget, log, 0.2, { provider });
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => caller(msgs(), { maxTokens: ab.CAP })));
    assert.strictEqual(called, 3, 'only three bounds fit');
    assert.strictEqual(results.filter(r => r.status === 'rejected' && /not called/u.test(r.reason.message)).length, 7);
    assert.strictEqual(log.filter(l => l.status === 'not_called' && l.reason === 'budget').length, 7);
    assert.ok(budget.left >= 0 && Math.abs(budget.reservedNow) < 1e-9);
  });

  await test('a retry is another reserved attempt; with no room for it, it is not made; a call with no price bound is never started', async () => {
    const log = [];
    let n = 0;
    const cutThenOk = async () => (++n === 1 ? { text: 'kesildi', usage: { inTokens: 5, outTokens: 3000 }, finishReason: 'length' } : { text: 'ok', usage: { inTokens: 5, outTokens: 5 }, finishReason: 'stop' });
    const roomy = ab.newBudget(one * 2.5);
    const r = await ab.liveCaller('voicelab/aisha-comet', roomy, log, 0.2, { provider: cutThenOk })(msgs(), { maxTokens: ab.CAP });
    assert.deepStrictEqual([r.text, n, log.filter(l => l.status === 'answered').length], ['ok', 2, 2]);
    // budget for one attempt only: the cut answer comes back marked cut... no: the retry is refused before the provider
    n = 0;
    const tight = ab.newBudget(one * 1.2);
    await assert.rejects(ab.liveCaller('voicelab/aisha-comet', tight, [], 0.2, { provider: cutThenOk })(msgs(), { maxTokens: ab.CAP }), /not called/u);
    assert.strictEqual(n, 1, 'the retry did not reach the provider');
    // a price the owner has not confirmed -> not started
    let asked = false;
    await assert.rejects(ab.liveCaller('voicelab/aisha-halo', ab.newBudget(100), [], 0.2, { provider: async () => { asked = true; return {}; }, priceConfirmed: false })(msgs(), { maxTokens: ab.CAP }), /price not confirmed - not called/u);
    assert.strictEqual(asked, false);
    // no price -> no bound -> not started
    let touched = false;
    await assert.rejects(ab.liveCaller('voicelab/no-such-model', ab.newBudget(100), [], 0.2, { provider: async () => { touched = true; return {}; } })(msgs(), { maxTokens: ab.CAP }), /no cost bound/u);
    assert.strictEqual(touched, false);
  });

  await test('the whole service under one budget: digest parts, re-reads and the final answer all reserve from it; list-price dollars and credits are kept apart', async () => {
    const text = loadAll().find(x => x.id === 'long-service-docx').pages.join('\n\n');
    const budget = ab.newBudget(5);
    const log = [];
    let calls = 0;
    // every first reading of part 1 comes back cut: its halves are re-read
    const provider = async (model, messages) => {
      calls++;
      const user = messages[1].text;
      if (/^Excerpt 1\//u.test(user)) return { text: '- band', usage: { inTokens: 100, outTokens: 1600, credits: 7 }, finishReason: 'length' };
      return { text: /^Excerpt /u.test(user) ? '- band' : 'Izoh.', usage: { inTokens: 100, outTokens: 50, credits: 3 }, finishReason: 'stop' };
    };
    const caller = ab.liveCaller('voicelab/aisha-comet', budget, log, 0.2, { provider });
    const digest = await ex.buildDigest(text, { callAI: caller });
    await ex.explainDocument({ documentText: text, langName: 'Uzbek', callAI: caller, digest: async () => digest, inputMode: 'digest', sameHelpers: true });
    const answered = log.filter(l => l.status === 'answered');
    assert.strictEqual(answered.length, calls, 'every provider call was reserved and recorded');
    assert.ok(digest.parts.some(p => p.retried), 'the re-read halves went through the same budget');
    assert.ok(Math.abs(budget.spent - answered.reduce((t, l) => t + l.settledUsd, 0)) < 1e-9);
    assert.ok(Math.abs(budget.left + budget.spent - 5) < 1e-9 && Math.abs(budget.reservedNow) < 1e-9, JSON.stringify(budget));
    assert.ok(budget.credits > 0 && budget.listUsd > 0, 'both recorded');
    assert.ok(answered.every(l => l.settledUsd === Math.max(l.listUsd, l.creditUsd)), 'settled at the larger known cost');
  });

  await test('after a call with no usage and no cost: the reserve is not released and the cost is recorded as unknown, never as $0', async () => {
    const budget = ab.newBudget(one * 5);
    const log = [];
    const caller = ab.liveCaller('voicelab/aisha-comet', budget, log, 0.2, { provider: async () => ({ text: 'ok', finishReason: 'stop' }) });
    await caller(msgs(), { maxTokens: ab.CAP });
    const l = log.find(x => x.status === 'answered');
    assert.deepStrictEqual([l.costStatus, l.settledUsd, l.listUsd, l.credits], ['unknown', null, null, null]);
    assert.ok(Math.abs(budget.left - one * 4) < 1e-9, 'the reserve stays held');
    assert.ok(Math.abs(budget.heldUnknown - one) < 1e-9 && budget.unknownCalls === 1 && budget.spent === 0);
    // an error with no usage is the same
    const caller2 = ab.liveCaller('voicelab/aisha-comet', budget, log, 0.2, { provider: async () => { throw new Error('upstream 503'); } });
    await assert.rejects(caller2(msgs(), { maxTokens: ab.CAP }));
    assert.strictEqual(budget.unknownCalls, 1 + 1 + ab.RETRIES, 'each attempt that reached the provider keeps its reserve');
  });

  await test('a cost above its reserve halts the budget: no new call, retry or re-read starts; calls already running finish and are recorded', async () => {
    const budget = ab.newBudget(one * 20);
    const log = [];
    let started = 0;
    // the first call to finish reports far more tokens than the bound allows
    const provider = async (model, messages) => {
      started++;
      const slow = /slow/u.test(messages[1].text);
      await new Promise(r => setTimeout(r, slow ? 40 : 5));
      return slow ? { text: 'ok', usage: { inTokens: 10, outTokens: 10 }, finishReason: 'stop' } : { text: 'ok', usage: { inTokens: 50_000_000, outTokens: 0 }, finishReason: 'stop' };
    };
    const caller = ab.liveCaller('voicelab/aisha-comet', budget, log, 0.2, { provider });
    const slowMsgs = [{ role: 'system', text: 'Tizim.' }, { role: 'user', text: 'slow ' + 'x '.repeat(2000) }];
    const running = caller(slowMsgs, { maxTokens: ab.CAP }); // starts before the overrun
    await caller(msgs(), { maxTokens: ab.CAP });            // the overrun
    assert.strictEqual(budget.halted, true);
    assert.strictEqual(log.find(l => l.costStatus === 'over_reserve').model, 'voicelab/aisha-comet');
    await assert.rejects(caller(msgs(), { maxTokens: ab.CAP }), /budget halted - not called/u);
    assert.strictEqual((await running).text, 'ok', 'the call already running finished');
    assert.strictEqual(started, 2, 'nothing new reached the provider after the halt');
    assert.ok(log.some(l => l.reason === 'halted: a cost went above its reserve'));
  });

  await test('one budget over the whole service, halting mid-way: digest parts, pre-splits and re-reads share it, and after an overrun no re-read or final answer starts', async () => {
    const text = loadAll().find(x => x.id === 'long-service-docx').pages.join('\n\n');
    const budget = ab.newBudget(5);
    const log = [];
    let calls = 0;
    const provider = async (model, messages) => {
      calls++;
      const user = messages[1].text;
      // part 2 overruns its reserve; part 1 comes back cut (would be re-read)
      if (/^Excerpt 2\//u.test(user)) return { text: '- band', usage: { inTokens: 50_000_000, outTokens: 0 }, finishReason: 'stop' };
      if (/^Excerpt 1\//u.test(user)) return { text: '- band', usage: { inTokens: 100, outTokens: 1600 }, finishReason: 'length' };
      return { text: /^Excerpt /u.test(user) ? '- band' : 'Izoh.', usage: { inTokens: 100, outTokens: 50 }, finishReason: 'stop' };
    };
    const caller = ab.liveCaller('voicelab/aisha-comet', budget, log, 0.2, { provider });
    const digest = await ex.buildDigest(text, { callAI: caller });
    assert.strictEqual(budget.halted, true);
    const firstWave = digest.plan.predicted.length;
    assert.ok(calls <= firstWave, `no re-read reached the provider after the overrun (${calls} calls, ${firstWave} parts)`);
    assert.ok(!digest.parts.some(p => p.retried && p.status === 'read'));
    // the final answer is refused too
    await assert.rejects(caller([{ role: 'system', text: 'x' }, { role: 'user', text: 'yakuniy' }], { maxTokens: ab.CAP }), /halted/u);
    assert.strictEqual(log.filter(l => l.status !== 'not_called').length, calls, 'every provider call recorded');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
