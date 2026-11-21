'use strict';

/**
 * The legal answer's evaluation set (2026-11-10, audit X7): the case file
 * holds together and guesses no article, the scorer passes and fails what it
 * should, the runner asks the server as the app does (a stub server here),
 * the command line stays dry unless live is set, approved and given a
 * session, two reports are compared, and the lawyer's sheet goes out and
 * comes back without changing a case it did not touch. No network beyond
 * localhost, no AI.
 *
 *   node tests/answer-eval.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const express = require('express');
const XLSX = require('xlsx');
const runner = require('../scripts/answer-eval');
const sheet = require('../scripts/eval-review-sheet');
const { scoreRun, summarize, compare, langOf, articleRe } = require('../scripts/lib/answer-eval-score');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const CASES = path.join(__dirname, '../docs/quality/answer-eval/cases.json');
const CASE = { id: 'Z99', topic: 'qarz', lang: 'uz', question: "Qarzdor tilxat bo'yicha qarzni qaytarmayapti, nima qilay?", reviewed: true, reviewer: 'Sinov Yurist', reviewedAt: '2026-11-10', gold: 'Talabnoma, keyin sud.',
  expect: { acts: [{ label: 'Fuqarolik kodeksi', match: ['fuqarolik kodeksi'], docIds: ['180552'] }], articles: ['732'], mustSay: ["talabnoma|da'vo"], mustNotSay: ["undirib bo'lmaydi"] } };
const REPLY = "**Tahlil**\n\nFuqarolik kodeksining 732-moddasiga ko‘ra qarz oluvchi qarzni qaytarishi shart.\n\n**Xulosa**\n\nAvval talabnoma yuboring, keyin da'vo bilan sudga murojaat qiling.";
const GOOD = { http: 200, ms: 21000, error: null, body: { reply: REPLY, cached: false, notSubstantive: false, citator: [{ lexId: '-180552', title: "O'zbekiston Respublikasining Fuqarolik kodeksi (2-qism)", url: 'https://lex.uz/docs/-180552' }],
  rag: { claimGuard: { status: 'verified' }, quotes: { kept: 1, removed: 0 }, lexLive: { status: 'ok' }, sources: [] } } };
const by = s => Object.fromEntries(s.checks.map(c => [c.id, c.result]));

(async () => {
  console.log('answer eval');

  await test('the case file: 60+ questions over the main topics, three scripts, none reviewed, no article guessed', () => {
    const cases = runner.loadCases(CASES);
    assert.ok(cases.length >= 60, String(cases.length));
    const topics = new Set(cases.map(c => c.topic));
    for (const t of ['mehnat', 'oila', 'qarz', 'meros', 'istemolchi', 'soliq', 'mamuriy', 'uy-joy']) assert.ok(topics.has(t), t);
    assert.ok(cases.some(c => c.lang === 'ru') && cases.some(c => c.lang === 'cyr'));
    assert.ok(cases.every(c => c.reviewed === false && c.gold === ''), 'a lawyer has not reviewed them yet - the report says so');
    assert.ok(cases.every(c => c.expect.articles.length === 0), 'article numbers come from the lawyer only');
    assert.ok(cases.every(c => !/\d+\s*-?\s*(modda|band)/iu.test(JSON.stringify([c.expect.mustSay, c.expect.mustNotSay]))), 'no article hidden in a phrase');
  });

  await test('a reviewed case must name its lawyer, date and the right answer', () => {
    assert.throws(() => runner.checkCases([{ ...CASE, reviewer: '' }]), /reviewed needs/u);
    assert.throws(() => runner.checkCases([{ ...CASE, gold: ' ' }]), /reviewed needs/u);
    assert.throws(() => runner.checkCases([{ ...CASE, lang: 'en' }]), /lang/u);
    assert.strictEqual(runner.checkCases([CASE]).length, 1);
  });

  await test('scorer: a good answer passes; a missing act or article, a forbidden phrase, the wrong language, an unverified answer are named', () => {
    const ok = scoreRun(CASE, GOOD);
    assert.strictEqual(ok.failed, 0, JSON.stringify(ok.checks));
    assert.strictEqual(ok.warned, 0);
    assert.strictEqual(ok.passed, 10);
    const bad = by(scoreRun(CASE, { ...GOOD, body: { ...GOOD.body, reply: "**Tahlil**\n\nMehnat kodeksining 73-moddasi. Qarzni undirib bo'lmaydi, shuning uchun hech narsa qilolmaysiz.\n\n**Xulosa**\n\nYo'q.", citator: [],
      rag: { claimGuard: { status: 'unverified' }, quotes: { removed: 2 }, lexLive: { status: 'unreachable' } } } }));
    assert.deepStrictEqual([bad.acts, bad.articles, bad.must_say, bad.must_not_say, bad.guard, bad.quotes, bad.lex], ['fail', 'fail', 'fail', 'fail', 'fail', 'warn', 'warn']);
    assert.strictEqual(by(scoreRun(CASE, { ...GOOD, body: { ...GOOD.body, reply: 'Анализ. Должник обязан вернуть долг по расписке в установленный договором срок. Вывод: направьте претензию.' } })).language, 'fail');
    assert.strictEqual(by(scoreRun({ ...CASE, lang: 'cyr' }, { ...GOOD, body: { ...GOOD.body, reply: 'Таҳлил. Қарздор қарзни қайтариши шарт, ҳуқуқингиз бор. Хулоса: талабнома юборинг ва судга мурожаат қилинг.' } })).language, 'pass');
    const hollow = by(scoreRun(CASE, { ...GOOD, body: { ...GOOD.body, notSubstantive: true } }));
    assert.strictEqual(hollow.delivered, 'fail');
    const none = by(scoreRun(CASE, { http: 500, ms: 10, error: 'x', body: null }));
    assert.deepStrictEqual([none.delivered, none.structure, none.guard], ['fail', 'fail', 'n/a']);
    assert.strictEqual(by(scoreRun(CASE, { ...GOOD, body: { ...GOOD.body, cached: true, rag: null } })).guard, 'n/a', 'a cached answer without its check is not counted as failed');
  });

  await test('an act is found by its link id or the citator even when the answer names it another way; the 2026 alphabet is folded', () => {
    const viaLink = { ...GOOD, body: { ...GOOD.body, citator: [], reply: REPLY.replace('Fuqarolik kodeksining', '[FK](https://lex.uz/docs/-180552#-1)') } };
    assert.strictEqual(by(scoreRun(CASE, viaLink)).acts, 'pass');
    const c2 = { ...CASE, expect: { ...CASE.expect, acts: [{ label: 'Ist', match: ["iste'molchi"] }], articles: [], mustSay: ["qo'shimcha"] } };
    assert.deepStrictEqual([by(scoreRun(c2, { ...GOOD, body: { ...GOOD.body, reply: REPLY + ' Isteʼmolchilarning huquqlari. Qöşimça haq.' } })).acts, by(scoreRun(c2, { ...GOOD, body: { ...GOOD.body, reply: REPLY + ' Qöşimça haq.' } })).must_say], ['pass', 'pass']);
    assert.ok(articleRe('732').test('732-modda') && !articleRe('73').test('732-modda') && articleRe('17').test('17-band') && articleRe('81').test('статья 81') && !articleRe('8').test('статья 81'));
    assert.strictEqual(langOf('qisqa'), null);
  });

  await test('summary keeps reviewed and unreviewed apart; compare names what got worse and better', () => {
    const rows = [{ id: 'Z99', topic: 'qarz', reviewed: true, run: GOOD, score: scoreRun(CASE, GOOD) }, { id: 'Z98', topic: 'oila', reviewed: false, run: { http: 500 }, score: scoreRun(CASE, { http: 500 }) }];
    const s = summarize(rows);
    assert.deepStrictEqual([s.reviewed.cases, s.reviewed.allPassed, s.unreviewed.cases, s.unreviewed.allPassed, s.reviewed.medianMs, s.reviewed.byTopic.qarz.allPassed], [1, 1, 1, 0, 21000, 1]);
    const after = [{ ...rows[0], score: scoreRun(CASE, { ...GOOD, body: { ...GOOD.body, rag: { ...GOOD.body.rag, claimGuard: { status: 'partial' } } } }) }, { ...rows[1], score: scoreRun(CASE, GOOD) }];
    const d = compare(rows, after);
    assert.deepStrictEqual(d.worse, [{ id: 'Z99', reviewed: true, check: 'guard', from: 'pass', to: 'warn' }]);
    assert.ok(d.better.some(x => x.id === 'Z98' && x.check === 'delivered'));
    assert.match(runner.compareText(d), /Yomonlashgan: 1[\s\S]*Z99 guard: pass -> warn/u);
    assert.match(runner.markdown(rows, s), /Faqat yurist ko'rib chiqqan savollar sifat haqida gapiradi/u);
  });

  await test('the runner asks as the app does (session, this origin, no stream, no history), waits out one 429 and passes the redaction header only when asked', async () => {
    const app = express();
    app.use(express.json());
    const seen = []; let n = 0;
    app.post('/api/legal-chat', (q, r) => {
      seen.push({ cookie: q.headers.cookie, origin: q.headers.origin, redact: q.headers['x-jai-redact'] || null, body: q.body });
      if (++n === 1) return r.status(429).json({ error: 'limit' });
      r.json({ reply: REPLY, provider: 'x', rag: { ...GOOD.body.rag, timings: { total: 1 } }, citator: GOOD.body.citator, followUpQuestions: ['a'] });
    });
    app.post('/down', (q, r) => r.status(500).json({ error: 'ichki xato' }));
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const run = await runner.runCase(CASE, { base, cookie: 'jai.sid=abc', retryWaitMs: 5 });
      assert.strictEqual(run.http, 200);
      assert.strictEqual(scoreRun(CASE, run).failed, 0);
      assert.strictEqual(seen.length, 2, 'one retry after 429');
      assert.deepStrictEqual([seen[1].cookie, seen[1].origin, seen[1].redact], ['jai.sid=abc', base, null]);
      assert.deepStrictEqual([seen[1].body.message, seen[1].body.history, seen[1].body.stream, seen[1].body.autoDetect, seen[1].body.databases], [CASE.question, [], false, true, ['lex.uz']]);
      assert.ok(!('timings' in run.body.rag) && !('followUpQuestions' in run.body), 'only what the scorer and the reader need is kept');
      await runner.runCase(CASE, { base, cookie: 'x', redact: 'off', retryWaitMs: 5 });
      assert.strictEqual(seen[2].redact, 'off');
      const dead = await runner.runCase(CASE, { base: 'http://127.0.0.1:1', cookie: 'x' });
      assert.deepStrictEqual([dead.http, dead.body], [0, null]);
    } finally { server.close(); }
  });

  await test('the command line: dry by default; live refused without its switch, its approval and a session; --compare exits 3 when a reviewed case got worse', () => {
    const script = path.join(__dirname, '../scripts/answer-eval.js');
    const env = { ...process.env, ANSWER_EVAL_LIVE: '', ANSWER_EVAL_COOKIE: '', AI_REQUEST_MAX_COST_USD: '' };
    const dry = spawnSync(process.execPath, [script, '--only', 'M01,F03'], { env, encoding: 'utf8' });
    assert.strictEqual(dry.status, 0, dry.stderr);
    const out = JSON.parse(dry.stdout);
    assert.deepStrictEqual([out.mode, out.cases, out.maxUsd, out.reviewed], ['dry', 2, 0.5, 0]);
    assert.match(out.runSha, /^[0-9a-f]{16}$/u);
    const other = JSON.parse(spawnSync(process.execPath, [script, '--only', 'M01,F03', '--redact', 'off'], { env, encoding: 'utf8' }).stdout).runSha;
    assert.notStrictEqual(other, out.runSha, 'an approval holds for the options too');
    assert.strictEqual(JSON.parse(spawnSync(process.execPath, [script, '--topic', 'mehnat', '--reviewed'], { env, encoding: 'utf8' }).stdout).cases, 0);
    const noSwitch = spawnSync(process.execPath, [script, '--live', '--only', 'M01,F03', '--approve', out.runSha], { env, encoding: 'utf8' });
    assert.strictEqual(noSwitch.status, 2); assert.match(noSwitch.stderr, /ANSWER_EVAL_LIVE=yes/u);
    const wrongSha = spawnSync(process.execPath, [script, '--live', '--only', 'M01', '--approve', 'deadbeef'], { env: { ...env, ANSWER_EVAL_LIVE: 'yes' }, encoding: 'utf8' });
    assert.strictEqual(wrongSha.status, 2); assert.match(wrongSha.stderr, /--approve must be this run's sha/u);
    const noCookie = spawnSync(process.execPath, [script, '--live', '--only', 'M01,F03', '--approve', out.runSha], { env: { ...env, ANSWER_EVAL_LIVE: 'yes' }, encoding: 'utf8' });
    assert.strictEqual(noCookie.status, 2); assert.match(noCookie.stderr, /ANSWER_EVAL_COOKIE/u);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-'));
    const row = (score) => ({ rows: [{ id: 'Z99', topic: 'qarz', reviewed: true, run: GOOD, score }] });
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify(row(scoreRun(CASE, GOOD))));
    fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify(row(scoreRun(CASE, { http: 500 }))));
    const cmp = spawnSync(process.execPath, [script, '--compare', path.join(dir, 'a.json'), path.join(dir, 'b.json')], { env, encoding: 'utf8' });
    assert.strictEqual(cmp.status, 3); assert.match(cmp.stdout, /Z99 delivered: pass -> fail/u);
    assert.strictEqual(spawnSync(process.execPath, [script, '--compare', path.join(dir, 'a.json'), path.join(dir, 'a.json')], { env, encoding: 'utf8' }).status, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test("the lawyer's sheet: out and back changes nothing; a filled row is applied; a confirmation without a name or the right answer stays unreviewed", () => {
    for (const set of ['answer', 'agent']) {
      const wb = sheet.toSheet(set);
      const rows = XLSX.utils.sheet_to_json(wb.Sheets.Savollar, { header: 1, raw: false, defval: '' });
      assert.deepStrictEqual(rows[0], sheet.COLS);
      const back = sheet.applyRows(set, rows);
      assert.deepStrictEqual([back.changes, back.errors], [[], []], set);
      assert.deepStrictEqual(back.data, JSON.parse(fs.readFileSync(sheet.SETS[set].file, 'utf8')), set);
    }
    const rows = XLSX.utils.sheet_to_json(sheet.toSheet('answer').Sheets.Savollar, { header: 1, raw: false, defval: '' });
    const i = rows.findIndex(r => r[0] === 'M01'), j = rows.findIndex(r => r[0] === 'O01'), k = rows.findIndex(r => r[0] === 'F01');
    rows[i][3] = 'Mehnat kodeksi\nYangi nizom'; rows[i][4] = '161, 164-modda'; rows[i][5] = 'sud\nmehnat inspeksiya'; rows[i][7] = 'Buyruq nusxasi talab qilinadi, keyin sud.'; rows[i][8] = 'Ha'; rows[i][9] = 'A. Yurist'; rows[i][10] = '2026-11-12';
    rows[j][8] = 'ha'; rows[j][7] = 'Sud orqali.';                 // no name
    rows[k][8] = 'ha'; rows[k][9] = 'A. Yurist';                    // no right answer
    rows.push(['Q01', 'bojxona', 'Chegarada tovarim ushlab qolindi, qanday qaytarib olaman?', 'Bojxona kodeksi', '', '', '', '', '', '', '', '']);
    rows.push(['bad', '', 'x', '', '', '', '', '', '', '', '', '']);
    const r = sheet.applyRows('answer', rows, '2026-11-13');
    const m = r.data.cases.find(c => c.id === 'M01');
    assert.deepStrictEqual([m.reviewed, m.reviewer, m.reviewedAt, m.expect.articles, m.expect.mustSay, m.gold], [true, 'A. Yurist', '2026-11-12', ['161', '164'], ['sud', 'mehnat inspeksiya'], 'Buyruq nusxasi talab qilinadi, keyin sud.']);
    assert.deepStrictEqual(m.expect.acts.map(a => [a.label, a.match.length > 1]), [['Mehnat kodeksi', true], ['Yangi nizom', false]], 'a known act keeps its match words, a new one is matched by its name');
    assert.deepStrictEqual([r.data.cases.find(c => c.id === 'O01').reviewed, r.data.cases.find(c => c.id === 'F01').reviewed], [false, false]);
    assert.strictEqual(r.errors.length, 3, JSON.stringify(r.errors));
    const q = r.data.cases.find(c => c.id === 'Q01');
    assert.deepStrictEqual([q.lang, q.reviewed, q.expect.acts[0].label], ['uz', false, 'Bojxona kodeksi']);
    assert.strictEqual(runner.checkCases(r.data.cases).length, 68, 'what comes back is still a file the runner accepts');
    assert.strictEqual(JSON.parse(fs.readFileSync(CASES, 'utf8')).cases.length, 67, 'nothing is written without --write');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
