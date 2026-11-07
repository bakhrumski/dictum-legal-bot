'use strict';

/**
 * Agent tasks in the Telegram bot (2026-10-28, roadmap PR-F): the "agent:"
 * phrase (and what is not one - every string in tests/), the plan and status
 * texts, and the notifier the worker calls: steps edit one status message,
 * the end sends the answer in Telegram Markdown, a question sets the chat's
 * state so the next message is the answer. Stub bot and database.
 *
 *   node tests/telegram-agent-runs.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ar = require('../src/bot/agent-runs');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const RUN = {
  id: 'r1', input: { task: 'Pudratchi avansni qaytarmayapti', telegram: { chatId: 42, messageId: 7 } },
  plan: { nodes: [{ id: 'n1', tool: 'lex_search' }, { id: 'n2', tool: 'answer' }, { id: 'n3', tool: 'verify' }] },
};
const registry = { get: id => ({ lex_search: { label: 'Qonunchilikni qidirish (lex.uz)' }, answer: { label: 'Javob yozish' }, verify: { label: 'Tekshirish' } })[id] || null };

function stubBot() {
  const log = [];
  return { log, editMessageText: async (text, o) => log.push(['edit', o.chat_id, o.message_id, text]), sendMessage: async (chatId, text, o) => { log.push(['send', chatId, text, o && o.parse_mode]); return { message_id: 9 }; } };
}
const pool = (rows) => ({ query: async () => ({ rows }) });

(async () => {
  console.log('telegram agent runs');

  await test('"agent: …" is a task in Uzbek and Russian; a question about agents is not; no string in tests/ is taken for one', () => {
    assert.strictEqual(ar.parseAgentTask('agent: Pudratchi avansni qaytarmayapti, nima qilay?'), 'Pudratchi avansni qaytarmayapti, nima qilay?');
    assert.strictEqual(ar.parseAgentTask('Agentga topshiriq: shartnomani tahlil qil va xulosa ber'), 'shartnomani tahlil qil va xulosa ber');
    assert.strictEqual(ar.parseAgentTask('агент: проверь договор аренды на риски'), 'проверь договор аренды на риски');
    for (const q of ['agent: qisqa', 'Agentlik shartnomasi qanday tuziladi?', 'Agent bilan shartnoma tuzdim, u pulni bermayapti']) assert.strictEqual(ar.parseAgentTask(q), null, q);
    const hits = [];
    for (const f of fs.readdirSync(__dirname)) {
      // the route labels of the authz matrix ("agent: claim draft") are not messages
      if (!f.endsWith('.js') || f === path.basename(__filename) || f === 'authz-matrix.test.js' || f === 'telegram-agent.test.js' || f === 'agent-planner.db.test.js') continue;
      for (const m of fs.readFileSync(path.join(__dirname, f), 'utf8').matchAll(/["'`]([^"'`\n]{12,300})["'`]/gu)) if (ar.parseAgentTask(m[1])) hits.push(m[1]);
    }
    assert.deepStrictEqual(hits, []);
  });

  await test('the plan text names the steps, the matter and the price, and says nothing is taken yet', () => {
    const text = ar.planText({ plan: { nodes: [{ label: 'Qonunchilikni qidirish (lex.uz)', args: { query: 'pudrat avans' } }, { label: 'Javob yozish', args: {} }] }, price: { chat: 1 }, matterTitle: 'Pudrat nizosi' });
    assert.match(text, /🤖 Agent rejasi:\nIsh: Pudrat nizosi\n1\. Qonunchilikni qidirish \(lex\.uz\) — pudrat avans\n2\. Javob yozish/u);
    assert.match(text, /Narx: limitdan 1 ta savol\.[\s\S]*Hali hech narsa yechilmadi/u);
    assert.match(ar.planText({ plan: { nodes: [] }, price: {} }, 'ru'), /Цена: бесплатно/u);
  });

  await test('progress edits the one status message with each step\'s mark', async () => {
    const bot = stubBot();
    const n = ar.createTelegramRunNotifier({ bot, pool: pool([{ step_id: 'n1', status: 'ok' }]), setConversationState: async () => {}, splitForTelegram: t => [t], registry });
    await n.progress(RUN);
    assert.deepStrictEqual(bot.log[0].slice(0, 3), ['edit', 42, 7]);
    assert.match(bot.log[0][3], /⏳ Agent ishlamoqda…\n✅ Qonunchilikni qidirish \(lex\.uz\)\n▫️ Javob yozish\n▫️ Tekshirish/u);
  });

  await test('done: the status message closes and the answer is sent in Telegram Markdown; a question sets the chat state for the answer', async () => {
    const bot = stubBot();
    const states = [];
    const n = ar.createTelegramRunNotifier({ bot, pool: pool([{ step_id: 'n1', status: 'ok' }, { step_id: 'n2', status: 'ok' }, { step_id: 'n3', status: 'ok' }]),
      setConversationState: async (...a) => states.push(a), splitForTelegram: t => [t.replace(/\*\*/gu, '*')], registry });
    await n.done(RUN, 'done', { body: { answer: '**Tahlil**\n\nMatn' } });
    assert.match(bot.log[0][3], /^✅ Agent tugatdi\./u);
    assert.deepStrictEqual(bot.log[1], ['send', 42, '*Tahlil*\n\nMatn', 'Markdown']);
    const bot2 = stubBot();
    const n2 = ar.createTelegramRunNotifier({ bot: bot2, pool: pool([]), setConversationState: async (...a) => states.push(a), splitForTelegram: t => [t], registry });
    await n2.done(RUN, 'needs_input', { body: { question: 'Avans qachon to\'langan?' } });
    assert.deepStrictEqual(states, [[42, 'agent_answer', { runId: 'r1' }]]);
    assert.match(bot2.log[1][2], /^Avans qachon to'langan\?\n\nKeyingi xabarda javob bering/u);
    const bot3 = stubBot();
    await ar.createTelegramRunNotifier({ bot: bot3, pool: pool([]), setConversationState: async () => {}, splitForTelegram: t => [t], registry }).done(RUN, 'failed', { body: {} });
    assert.match(bot3.log[0][3], /Topshiriqni bajarib bo'lmadi\. Birlik qaytarildi\./u);
    assert.strictEqual(bot3.log.length, 1, 'nothing else is sent on a failure');
  });

  await test('the worker reports through notify only runs that came from Telegram; a report failure never touches the run', async () => {
    const notify = require('../src/agents/runs/notify');
    const seen = [];
    notify.setTelegramNotifier({ progress: async (r) => seen.push(['p', r.id]), done: async (r, s) => { seen.push(['d', r.id, s]); throw new Error('telegram down'); } });
    await notify.progress({ id: 'web', input: { task: 'x' } });
    await notify.progress(RUN);
    await notify.progress(RUN); // within 2.5 s: not edited again
    await notify.done(RUN, 'done', {});
    assert.deepStrictEqual(seen, [['p', 'r1'], ['d', 'r1', 'done']]);
    notify.setTelegramNotifier(null);
    const worker = fs.readFileSync(path.join(__dirname, '../src/agents/runs/worker.js'), 'utf8');
    assert.match(worker, /if \(ok\) await notify\.done\(run, status, result\);/u);
    assert.match(worker, /await store\.saveStep\(run\.id, entry, output\); await notify\.progress\(run\);/u);
  });

  await test('the bot: agent_task and agent_answer reach the planner service; plan buttons approve or drop; the status message is attached before approval', () => {
    const agent = require('../src/agents/telegram-agent');
    assert.deepStrictEqual(agent.classifyDeterministicIntent('agent: Pudratchi avansni qaytarmayapti, nima qilay?'), { intent: 'agent_task', task: 'Pudratchi avansni qaytarmayapti, nima qilay?', missing: [] });
    process.env.AGENT_PLANNER = 'off';
    try { assert.notStrictEqual((agent.classifyDeterministicIntent('agent: Pudratchi avansni qaytarmayapti, nima qilay?') || {}).intent, 'agent_task'); } finally { delete process.env.AGENT_PLANNER; }
    const src = fs.readFileSync(path.join(__dirname, '../src/agents/telegram-agent.js'), 'utf8');
    assert.match(src, /state === 'agent_answer' && context && context\.runId/u);
    assert.match(src, /service\.plan\(\{ adminId: account\.id, task: intent\.task[^}]*channel: 'telegram', telegram: \{ chatId \}/u);
    const bot = fs.readFileSync(path.join(__dirname, '../src/bot/bot.js'), 'utf8');
    assert.match(bot, /callback_data: `agp_y_\$\{agentResult\.meta\.runId\}`/u);
    assert.match(bot, /attachTelegram\(runId, account\.id, \{ chatId, messageId: status\.message_id \}\);[\s\S]{0,80}service\.approve\(runId, account\.id\)/u);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
