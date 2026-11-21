'use strict';

/**
 * The agent evaluation (2026-10-28, roadmap PR-G): the case file holds
 * together, the scorer passes and fails what it should, the runner drives a
 * run through the server's API (a stub server here) and answers a question
 * once, and the command line stays dry unless live is set, approved and
 * given a session. No network beyond localhost, no AI.
 *
 *   node tests/agent-eval.test.js
 */

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const express = require('express');
const runner = require('../scripts/agent-eval');
const { scoreRun, summarize, docIdOf } = require('../scripts/lib/agent-eval-score');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const CASES = path.join(__dirname, '../docs/quality/agent-eval/cases.json');
const CASE = { id: 'A99', task: 'Pudratchi avansni qaytarmayapti, nima qilay?', reviewed: true,
  expect: { acts: [{ label: 'Fuqarolik kodeksi', match: ['fuqarolik kodeksi'], docIds: ['180552'] }], mustSay: ["talabnoma|da'vo"], mustNotSay: ['istisno yo\'q'], askUser: false } };
const GOOD = { status: 'done', asked: false, body: {
  answer: "**Tahlil**\n\nPudratchi ishni boshlamasa, buyurtmachi voz kechadi.\n\n**Xulosa**\n\nAvval talabnoma yuboring, keyin da'vo bilan sudga boring.",
  sources: [{ act: "O'zbekiston Respublikasining Fuqarolik kodeksi", article: '642', url: 'https://lex.uz/docs/-180552#-642' }],
  verification: { status: 'verified' } } };

(async () => {
  console.log('agent eval');

  await test('the case file: 24 cases, unique ids, answers for the cases that expect a question, none reviewed yet', () => {
    const cases = runner.loadCases(CASES);
    assert.strictEqual(cases.length, 24);
    assert.ok(cases.some(c => c.expect.askUser), 'some cases expect the agent to ask');
    assert.ok(cases.every(c => c.reviewed === false), 'a lawyer has not reviewed them yet - the report says so');
    assert.ok(cases.every(c => (c.expect.acts || []).every(a => a.label && Array.isArray(a.match) && a.match.length)), 'every expected act can be matched');
  });

  await test('scorer: a good run passes every check; an act missing, a forbidden phrase, a wrong question and a partial check are named', () => {
    const ok = scoreRun(CASE, GOOD);
    assert.strictEqual(ok.failed, 0, JSON.stringify(ok.checks));
    assert.strictEqual(ok.passed, 7);
    const bad = scoreRun(CASE, { ...GOOD, asked: true, body: { ...GOOD.body, answer: GOOD.body.answer + ' Istisno yo\'q.', sources: [{ act: 'Mehnat kodeksi', url: 'https://lex.uz/docs/-6257288' }], verification: { status: 'partial' } } });
    const by = Object.fromEntries(bad.checks.map(c => [c.id, c.result]));
    assert.deepStrictEqual([by.acts, by.must_not_say, by.asked, by.verification], ['fail', 'fail', 'fail', 'warn']);
    assert.match(bad.checks.find(c => c.id === 'acts').note, /Fuqarolik kodeksi/u);
    const none = scoreRun(CASE, { status: 'failed', asked: false });
    assert.deepStrictEqual(['delivered', 'structure', 'verification'].map(id => none.checks.find(c => c.id === id).result), ['fail', 'fail', 'fail']);
    assert.strictEqual(docIdOf('https://lex.uz/uz/docs/-4422250#-4423017'), '4422250');
  });

  await test('summary keeps reviewed and unreviewed cases apart', () => {
    const s = summarize([{ reviewed: true, score: scoreRun(CASE, GOOD) }, { reviewed: false, score: scoreRun(CASE, { status: 'failed' }) }]);
    assert.deepStrictEqual([s.reviewed.cases, s.reviewed.allPassed, s.unreviewed.cases, s.unreviewed.allPassed], [1, 1, 1, 0]);
  });

  await test('the runner drives a run through the server API and answers its question once', async () => {
    const app = express();
    app.use(express.json());
    const seen = [];
    let polls = 0, answered = false;
    app.use((req, _r, next) => { seen.push([req.method, req.path, req.headers.cookie, req.headers.origin, req.body && req.body.answer]); next(); });
    app.post('/api/agent/plan', (q, r) => r.status(201).json({ runId: 'r1', plan: { nodes: [] } }));
    app.post('/api/agent/runs/r1/approve', (q, r) => r.json({ status: 'queued' }));
    app.post('/api/agent/runs/r1/input', (q, r) => { answered = true; r.json({ status: 'queued' }); });
    app.get('/api/agent/runs/r1', (q, r) => {
      polls++;
      if (!answered) return r.json({ status: 'needs_input', result: { body: { question: 'Qachon?' } } });
      return r.json({ status: 'done', result: { body: GOOD.body }, spent: { calls: 3 } });
    });
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const run = await runner.runCase({ ...CASE, answer: '2026-yil mart' }, { base, cookie: 'jai.sid=abc', pollMs: 5 });
      assert.deepStrictEqual([run.status, run.asked], ['done', true]);
      assert.strictEqual(scoreRun({ ...CASE, expect: { ...CASE.expect, askUser: true } }, run).failed, 0);
      const input = seen.find(x => x[1] === '/api/agent/runs/r1/input');
      assert.deepStrictEqual(input.slice(2), ['jai.sid=abc', base, '2026-yil mart'], 'the session and this origin are sent; the case answer is the input');
      const noAnswer = await runner.runCase({ ...CASE, answer: undefined }, { base, cookie: 'x', pollMs: 5 });
      assert.ok(noAnswer.status === 'done' || noAnswer.status === 'needs_input');
    } finally { server.close(); }
  });

  await test('the command line: dry by default (a run sha and the most it may cost); live refused without its switch, its approval and a session', () => {
    const script = path.join(__dirname, '../scripts/agent-eval.js');
    const env = { ...process.env, AGENT_EVAL_LIVE: '', AGENT_EVAL_COOKIE: '' };
    const dry = spawnSync(process.execPath, [script, '--only', 'A01,A05'], { env, encoding: 'utf8' });
    assert.strictEqual(dry.status, 0, dry.stderr);
    const out = JSON.parse(dry.stdout);
    assert.deepStrictEqual([out.mode, out.cases, out.maxUsd], ['dry', 2, 4]);
    assert.match(out.runSha, /^[0-9a-f]{16}$/u);
    const noSwitch = spawnSync(process.execPath, [script, '--live', '--only', 'A01', '--approve', out.runSha], { env, encoding: 'utf8' });
    assert.strictEqual(noSwitch.status, 2);
    assert.match(noSwitch.stderr, /AGENT_EVAL_LIVE=yes/u);
    const wrongSha = spawnSync(process.execPath, [script, '--live', '--only', 'A01', '--approve', 'deadbeef'], { env: { ...env, AGENT_EVAL_LIVE: 'yes' }, encoding: 'utf8' });
    assert.strictEqual(wrongSha.status, 2);
    assert.match(wrongSha.stderr, /--approve must be this run's sha/u);
    const one = JSON.parse(spawnSync(process.execPath, [script, '--only', 'A01'], { env, encoding: 'utf8' }).stdout).runSha;
    const noCookie = spawnSync(process.execPath, [script, '--live', '--only', 'A01', '--approve', one], { env: { ...env, AGENT_EVAL_LIVE: 'yes' }, encoding: 'utf8' });
    assert.strictEqual(noCookie.status, 2);
    assert.match(noCookie.stderr, /AGENT_EVAL_COOKIE/u);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
