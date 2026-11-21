'use strict';

/**
 * Adaptive account, PR A1 (2026-10-28, docs/design/adaptiv-akkaunt.md): a
 * signal is a code, never text; the profile comes from signals with no AI,
 * older signals count less, a weak majority is no preference, an act needs
 * two citations. The web chat records after the reply, without reading or
 * changing it. No network.
 *
 *   node tests/adaptive-profile.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const p = require('../src/adaptive/profile');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const DAY = 86400e3, NOW = Date.parse('2026-10-28T12:00:00Z');
const at = days => new Date(NOW - days * DAY).toISOString();

console.log('adaptive profile');

test('a signal is one of the allowed codes; free text is refused', () => {
  assert.deepStrictEqual(p.cleanSignal({ kind: 'area', value: 'Mehnat' }), { kind: 'area', value: 'mehnat', label: '' });
  assert.strictEqual(p.cleanSignal({ kind: 'area', value: 'Ishdan bo‘shatildim, nima qilay?' }), null);
  assert.strictEqual(p.cleanSignal({ kind: 'act', value: 'Mehnat kodeksi' }), null, 'an act is its lex.uz id');
  assert.deepStrictEqual(p.cleanSignal({ kind: 'act', value: '6257288', label: 'Mehnat kodeksi' }), { kind: 'act', value: '6257288', label: 'Mehnat kodeksi' });
  assert.strictEqual(p.cleanSignal({ kind: 'service', value: 'anything' }), null);
  assert.strictEqual(p.cleanSignal({ kind: 'question', value: 'x' }), null, 'no such kind');
});

test('an answer gives its area, its acts (id + title), the script and the language - never the question', () => {
  const sig = p.answerSignals({
    question: 'Ish beruvchi ish haqini to‘lamayapti, qayerga murojaat qilaman?',
    answer: '**Tahlil**\n\n[Mehnat kodeksi, 263-modda](https://lex.uz/docs/-6257288#-6260025) ... [Mehnat kodeksi](https://lex.uz/uz/docs/-6257288) va [VMQ-589, 17-band](https://lex.uz/docs/-5085420).',
    topic: 'mehnat', channel: 'web' });
  assert.deepStrictEqual(sig.map(s => s.kind), ['service', 'area', 'script', 'lang', 'act', 'act']);
  assert.deepStrictEqual(sig.filter(s => s.kind === 'act').map(s => [s.value, s.label]), [['6257288', 'Mehnat kodeksi'], ['5085420', 'VMQ-589']]);
  assert.ok(!JSON.stringify(sig).includes('to‘lamayapti'), 'the question text is not in any signal');
  const ru = p.answerSignals({ question: 'Работодатель не выплачивает зарплату, что делать?', answer: '', topic: 'mehnat', channel: 'telegram' });
  assert.deepStrictEqual(ru.map(s => `${s.kind}:${s.value}`), ['service:telegram', 'area:mehnat', 'script:cyrl', 'lang:ru']);
  assert.deepStrictEqual(p.answerSignals({ question: 'Иш берувчи иш ҳақини тўламаяпти', answer: '', topic: null }).filter(s => s.kind === 'lang').map(s => s.value), ['uz'], 'Uzbek in Cyrillic is still uz');
});

test('profile: areas by weight (older count less), acts cited twice, a 70 % majority for script, the last built-in playbook', () => {
  const s = [
    ...Array.from({ length: 6 }, (_, i) => ({ kind: 'area', value: 'mehnat', created_at: at(i) })),
    ...Array.from({ length: 6 }, (_, i) => ({ kind: 'area', value: 'soliq', created_at: at(170 + i) })),
    { kind: 'act', value: '6257288', label: 'Mehnat kodeksi', created_at: at(1) }, { kind: 'act', value: '6257288', label: 'Mehnat kodeksi', created_at: at(2) },
    { kind: 'act', value: '111', label: 'Bir marta', created_at: at(1) },
    ...Array.from({ length: 4 }, (_, i) => ({ kind: 'script', value: 'latn', created_at: at(i) })), { kind: 'script', value: 'cyrl', created_at: at(1) },
    { kind: 'playbook', value: 'nda', created_at: at(9) }, { kind: 'playbook', value: 'supply_buyer', created_at: at(2) }, { kind: 'playbook', value: 'own', created_at: at(0) },
  ];
  const pr = p.computeProfile(s, { now: NOW });
  assert.deepStrictEqual(pr.areas.map(a => a.code), ['mehnat', 'soliq']);
  assert.ok(pr.areas[0].weight > 0.85, `recent areas weigh more: ${pr.areas[0].weight}`);
  assert.deepStrictEqual(pr.acts.map(a => [a.docId, a.title]), [['6257288', 'Mehnat kodeksi']], 'an act cited once is not a habit');
  assert.strictEqual(pr.script, 'latn');
  assert.strictEqual(pr.playbook, 'supply_buyer', "the last built-in one; the person's own does not name one");
  const split = p.computeProfile([{ kind: 'script', value: 'latn', created_at: at(1) }, { kind: 'script', value: 'cyrl', created_at: at(1) }, { kind: 'script', value: 'latn', created_at: at(1) }], { now: NOW });
  assert.strictEqual(split.script, null, '2 of 3 is no preference');
  assert.deepStrictEqual(p.computeProfile([], { now: NOW }), { areas: [], acts: [], script: null, lang: null, services: [], playbook: null });
});

test('wiring: the web chat records after the reply and only stores the topic; the bot and the worker record; account deletion removes the profile', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
  assert.match(server, /app\.use\('\/api\/legal-chat', require\('\.\.\/adaptive\/profile'\)\.answerRecorder\(\)\);/u);
  assert.match(server, /res\.locals\.answerTopic = topic \|\| null;/u);
  const bot = fs.readFileSync(path.join(__dirname, '../src/bot/bot.js'), 'utf8');
  assert.match(bot, /p\.answerSignals\(\{ question: requestData\.request_text, answer: agentResult\.reply,/u);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/agents/runs/worker.js'), 'utf8'), /\{ kind: 'service', value: run\.workflow \}/u);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/services/account-deletion.js'), 'utf8'), /deleteAccountProfile\(db, adminId\)/u);
});

(async () => {
  // the recorder on a real Express app: a JSON reply and a stream's "done" frame, both unchanged, both recorded after
  const express = require('express');
  const seen = [];
  const store = { record: async (id, sig, o) => { seen.push([id, sig.map(x => `${x.kind}:${x.value}`), o.channel]); return sig.length; } };
  const app = express();
  app.use(express.json());
  app.use((req, _r, next) => { req.session = { adminId: 7 }; next(); });
  app.use('/api/legal-chat', p.answerRecorder({ store }));
  const ANSWER = 'Tahlil [Mehnat kodeksi](https://lex.uz/docs/-6257288).';
  app.post('/api/legal-chat', (req, res) => {
    res.locals.answerTopic = 'mehnat';
    if (!req.body.stream) return res.json({ reply: ANSWER, provider: 'x' });
    res.setHeader('Content-Type', 'text/event-stream');
    res.write('data: ' + JSON.stringify({ type: 'token', t: 'Tahlil' }) + '\n\n');
    res.write('data: ' + JSON.stringify({ type: 'done', reply: ANSWER }) + '\n\n');
    res.end();
  });
  app.post('/api/legal-chat-fail', (req, res) => res.status(429).json({ reply: 'limit' }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const j = await (await fetch(base + '/api/legal-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Ish haqi to‘lanmayapti' }) })).json();
    assert.deepStrictEqual(j, { reply: ANSWER, provider: 'x' }, 'the reply goes out unchanged');
    const sse = await (await fetch(base + '/api/legal-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Ish haqi to‘lanmayapti', stream: true }) })).text();
    assert.match(sse, /"type":"done"/u);
    await new Promise(r => setTimeout(r, 30));
    assert.strictEqual(seen.length, 2, 'one record per answer, JSON and stream');
    assert.deepStrictEqual(seen[0], [7, ['service:chat', 'area:mehnat', 'script:latn', 'lang:uz', 'act:6257288'], 'web']);
    console.log('  ✓ the recorder: a JSON reply and a stream are sent unchanged and recorded once each, in the background');
    passed++;
  } catch (e) { console.error(`  ✗ the recorder\n      ${e.stack || e.message}`); failed++; }
  finally { server.close(); }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
