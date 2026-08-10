'use strict';

/**
 * Tests for the autonomous Telegram agent (src/agents/telegram-agent.js).
 *
 * All dependencies are injected, so the whole decision tree — intent routing,
 * clarification limits, the confidence gate, escalation — is testable without
 * a database, a model, or Telegram. The DB-backed conversation store is
 * stubbed out; what is under test here is the routing logic, which is what
 * decides whether a user gets an answer or sits in a queue.
 *
 *   node tests/telegram-agent.test.js
 */

const assert = require('assert');
const Module = require('module');
const path = require('path');
const fs = require('fs');

// ── Load the agent with ../database/db stubbed (no DB in tests) ─────────────
// The conversation store is DB-backed, so the fake pool is how a test controls
// prior state (how many clarifying questions this chat has already had).
const dbState = { clarifyCount: 0, turns: [], mode: 'automatic', state: 'idle', context: {}, aiAnswers: 0 };
const fakePool = {
  query: async (sql, params = []) => {
    if (/SELECT\s+turns/i.test(sql)) {
      return { rows: [{ turns: dbState.turns, clarify_count: dbState.clarifyCount, mode: dbState.mode, state: dbState.state, language: 'uz', context: dbState.context }] };
    }
    if (/INSERT INTO\s+tg_agent_daily_usage/i.test(sql)) {
      const limit = Number(params[1]) || 0;
      if (dbState.aiAnswers >= limit) return { rows: [] };
      dbState.aiAnswers++;
      return { rows: [{ ai_answers: dbState.aiAnswers }] };
    }
    if (/UPDATE\s+tg_agent_daily_usage/i.test(sql)) {
      dbState.aiAnswers = Math.max(0, dbState.aiAnswers - 1);
      return { rows: [] };
    }
    if (/INSERT INTO\s+tg_conversations/i.test(sql) && /state\s*=\s*'idle'/i.test(sql)) {
      dbState.turns = [];
      dbState.clarifyCount = 0;
      dbState.state = 'idle';
      dbState.context = {};
      return { rows: [] };
    }
    return { rows: [] };
  },
};

const agentPath = require.resolve('../src/agents/telegram-agent');
const src = fs.readFileSync(agentPath, 'utf8');
const m = new Module(agentPath);
m.filename = agentPath;
m.paths = Module._nodeModulePaths(path.dirname(agentPath));
const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '../database/db') return { pool: fakePool };
  return origRequire.apply(this, arguments);
};
m._compile(src, agentPath);
Module.prototype.require = origRequire;
const agent = m.exports;

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

// ── Dependency factory ──────────────────────────────────────────────────────

/**
 * @param {object} o
 *   intent   — what the intent classifier should return
 *   answer   — the generated answer text
 *   chunks   — retrieved corpus chunks (empty => low confidence)
 *   unverified — article numbers the citation check flags
 *   korpus   — a lawyer-verified answer to return from qa-korpus
 */
function deps(o = {}) {
  const calls = { answer: 0, intent: 0, korpus: 0, attorneys: 0, contacts: 0, events: 0, quota: 0, release: 0 };
  return {
    calls,
    callCheapAI: async () => {
      calls.intent++;
      return { text: JSON.stringify(o.intent || { intent: 'huquqiy_savol', missing: [] }) };
    },
    callAI: async () => {
      calls.answer++;
      return { text: o.answer !== undefined ? o.answer : 'Mehnat kodeksining 100-moddasiga ko\'ra ish beruvchi buyruq chiqarishi shart.', provider: 'test-model' };
    },
    retrieveLegalContext: async () => ({
      context: o.chunks && o.chunks.length ? 'kontekst' : '',
      chunks: o.chunks !== undefined ? o.chunks : [{ law_name: 'Mehnat kodeksi', article_numbers: ['100'], source_url: 'https://lex.uz/docs/1', chunk_text: '100-modda ...' }],
    }),
    verifyCitations: () => ({ total: 1, unverified: o.unverified || [] }),
    buildTopicPrompt: () => 'SYSTEM',
    classifyLegalTopic: async () => 'mehnat',
    searchKorpus: o.korpus ? async () => { calls.korpus++; return { corrected_answer: o.korpus }; } : null,
    embeddingApiKey: o.korpus ? 'key' : null,
    findAttorneys: async () => {
      calls.attorneys++;
      return o.attorneys || [];
    },
    getAttorneyContact: async () => {
      calls.contacts++;
      return o.contact || null;
    },
    recordAgentEvent: async () => { calls.events++; },
    claimDailyAnswer: async () => {
      calls.quota++;
      return o.quota || { allowed: true, used: 1, remaining: 2, limit: 3 };
    },
    releaseDailyAnswer: async () => { calls.release++; },
  };
}

/** Set how many clarifying questions this chat has already been asked. */
function stubMemory(clarifyCount = 0) {
  dbState.clarifyCount = clarifyCount;
  dbState.turns = [];
  dbState.mode = 'automatic';
  dbState.state = 'idle';
  dbState.context = {};
  dbState.aiAnswers = 0;
}

(async () => {
  console.log('\ntelegram-agent — social routing\n');

  await test('a greeting is answered without touching the model or the queue', async () => {
    const d = deps();
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Assalomu alaykum', firstName: 'Aslan' });
    assert.strictEqual(r.action, 'greeting');
    assert.strictEqual(r.escalate, false, 'a greeting must not create a lawyer task');
    assert.ok(/Aslan/.test(r.reply), 'should greet by name');
    assert.strictEqual(d.calls.answer, 0, 'no answer generation for a greeting');
    assert.strictEqual(d.calls.intent, 0, 'greeting matched without an LLM call');
  });

  await test('"rahmat" closes the loop instead of being answered as a question', async () => {
    const d = deps();
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Rahmat!' });
    assert.strictEqual(r.action, 'greeting');
    assert.strictEqual(d.calls.answer, 0);
  });

  await test('asking for a human escalates immediately', async () => {
    const d = deps();
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Men jonli yurist bilan gaplashmoqchiman' });
    assert.strictEqual(r.action, 'escalate');
    assert.strictEqual(r.escalate, true);
    assert.strictEqual(d.calls.answer, 0, 'do not answer someone who asked for a person');
  });

  await test('Master Admin takeover pauses automatic classification and answering', async () => {
    const d = deps();
    agent.initTelegramAgent(d);
    dbState.mode = 'human';
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Mehnat shartnomam bekor qilindi' });
    assert.strictEqual(r.action, 'human_takeover');
    assert.strictEqual(r.escalate, true);
    assert.strictEqual(r.reply, null);
    assert.strictEqual(d.calls.intent, 0);
    assert.strictEqual(d.calls.answer, 0);
    stubMemory();
  });

  await test('account questions are routed to the registration bot', async () => {
    const d = deps();
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'OTP kodim kelmadi, nima qilay?' });
    assert.strictEqual(r.action, 'account_help');
    assert.strictEqual(r.escalate, false);
    assert.ok(/@juristAI_registration_bot/.test(r.reply));
    assert.strictEqual(d.calls.answer, 0);
  });

  await test('"are you a lawyer" is product FAQ, not a sourced legal answer', async () => {
    const d = deps();
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Siz yuristmasmisiz?' });
    assert.strictEqual(r.action, 'identity');
    assert.strictEqual(r.escalate, false);
    assert.ok(/inson yurist yoki advokat emasman/i.test(r.reply));
    assert.ok(!/📎\s*Manbalar:|lex\.uz/i.test(r.reply), 'identity reply must not contain legal citations');
    assert.strictEqual(d.calls.intent, 0, 'common identity question should not cost a classifier call');
    assert.strictEqual(d.calls.answer, 0, 'identity question must not enter RAG generation');
    assert.strictEqual(d.calls.quota, 0, 'identity question must not consume a legal answer');
  });

  await test('generic help asks only for the legal situation, not the country', async () => {
    const d = deps();
    agent.initTelegramAgent(d);
    stubMemory(0);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Menga yordam kerak' });
    assert.strictEqual(r.action, 'clarify');
    assert.ok(/Qanday huquqiy muammo/i.test(r.reply));
    assert.ok(!/davlat|hudud/i.test(r.reply), 'JuristAI already knows the governing country');
    assert.strictEqual(d.calls.intent, 0);
    assert.strictEqual(d.calls.quota, 0);
  });

  await test('document drafting becomes a lawyer-approved paid service without an invented price', async () => {
    const d = deps();
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: "Menga da'vo arizasi tayyorlab bering" });
    assert.strictEqual(r.action, 'paid_service');
    assert.strictEqual(r.escalate, true);
    assert.strictEqual(r.meta.serviceSlug, 'claim');
    assert.strictEqual(r.meta.requiresLawyerApproval, true);
    assert.ok(/pullik xizmat/.test(r.reply));
    assert.ok(!/\d[\d\s,.]*\s*(so['’]?m|UZS)/i.test(r.reply), 'agent must not invent a price');
  });

  await test('an attorney request returns verified matches and does not negotiate price', async () => {
    const d = deps({ attorneys: [{
      id: 7,
      full_name: 'Aziza Karimova',
      license_number: 'LIC-7',
      license_status: 'active',
      region: 'Toshkent',
      practice_areas: [{ name_uz: 'Mehnat huquqi' }],
      match_reasons: ['soha mos keladi'],
      contact_ref: 'eadvokat:7',
      contact_phone: '+998 90 000-00-00',
      source_name: 'e-advokat.adliya.uz',
    }] });
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Menga mehnat masalasi bo\'yicha advokat kerak' });
    assert.strictEqual(r.action, 'attorney_matches');
    assert.strictEqual(r.escalate, false);
    assert.ok(/Aziza Karimova/.test(r.reply));
    assert.ok(/narxini belgilamaydi/.test(r.reply));
    assert.ok(!/\+998 90 000-00-00/.test(r.reply), 'phone must stay hidden before the user chooses');
    assert.ok(/raqamini yuboring/.test(r.reply), 'the consent step must be explicit');
    assert.deepStrictEqual(r.meta.attorneyIds, [7]);
    assert.deepStrictEqual(r.meta.attorneyRefs, ['eadvokat:7']);
  });

  await test('the selected attorney phone is revealed only after an explicit numbered choice', async () => {
    dbState.state = 'awaiting_attorney_choice';
    dbState.context = {
      attorneyOptions: [{ index: 1, ref: 'eadvokat:7', name: 'Aziza Karimova', organization: 'Adolat' }],
    };
    const d = deps({ contact: {
      full_name: 'Aziza Karimova',
      organization_name: 'Adolat',
      contact_phone: '+998 90 000-00-00',
      source_name: 'e-advokat.adliya.uz',
    } });
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: '1' });
    assert.strictEqual(r.action, 'attorney_contact_shared');
    assert.strictEqual(r.escalate, false);
    assert.ok(/\+998 90 000-00-00/.test(r.reply));
    assert.ok(/ma'lumotlaringiz.*yuborilmadi/.test(r.reply));
    assert.strictEqual(d.calls.contacts, 1);
    stubMemory();
  });

  await test('no verified attorney match creates a human follow-up request', async () => {
    const d = deps({ attorneys: [] });
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Menga jinoyat ishi bo\'yicha advokat kerak' });
    assert.strictEqual(r.action, 'attorney_request');
    assert.strictEqual(r.escalate, true);
    assert.ok(/Master Adminga yuborildi/.test(r.reply));
  });

  console.log('\ntelegram-agent — answering\n');

  await test('a clear legal question is answered with sources and a disclaimer', async () => {
    const d = deps();
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Ish beruvchi meni ishdan bo\'shatdi, buyruq bermadi. Nima qilishim kerak?' });
    assert.strictEqual(r.action, 'answered');
    assert.strictEqual(r.escalate, false, 'a confident answer must not also queue a lawyer');
    assert.ok(/Mehnat kodeksi/.test(r.reply), 'sources missing');
    assert.ok(/lex\.uz/.test(r.reply), 'source link missing');
    assert.ok(/yuridik kuchga ega emas/.test(r.reply), 'disclaimer missing');
    assert.ok(/yana 2 ta bepul AI javob/i.test(r.reply), 'remaining daily allowance missing');
    assert.strictEqual(r.meta.remainingDailyAnswers, 2);
  });

  await test('the fourth legal answer is blocked before retrieval or generation', async () => {
    const d = deps({ quota: { allowed: false, used: 3, remaining: 0, limit: 3 } });
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Mehnat ta\'tili necha kun?' });
    assert.strictEqual(r.action, 'quota_exceeded');
    assert.ok(/3 ta bepul AI huquqiy javob/i.test(r.reply));
    assert.strictEqual(d.calls.answer, 0, 'quota must block answer generation');
    assert.strictEqual(d.calls.korpus, 0, 'quota must block paid/verified answer work');
  });

  await test('the database quota reservation is atomic and releasable', async () => {
    dbState.aiAnswers = 2;
    const third = await agent.claimDailyAiAnswer(77);
    const fourth = await agent.claimDailyAiAnswer(77);
    assert.strictEqual(third.allowed, true);
    assert.strictEqual(third.remaining, 0);
    assert.strictEqual(fourth.allowed, false);
    await agent.releaseDailyAiAnswer(77);
    const retry = await agent.claimDailyAiAnswer(77);
    assert.strictEqual(retry.allowed, true, 'a failed answer reservation must be reusable');
    stubMemory();
  });

  await test('a lawyer-verified corpus answer is preferred over generation', async () => {
    const d = deps({ korpus: 'Yurist tomonidan tasdiqlangan javob matni, yetarlicha uzun.' });
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Mehnat shartnomasi qanday bekor qilinadi?' });
    assert.strictEqual(r.action, 'answered');
    assert.strictEqual(r.meta.path, 'qa-korpus');
    assert.strictEqual(d.calls.answer, 0, 'must not pay for generation when a verified answer exists');
  });

  console.log('\ntelegram-agent — the confidence gate\n');

  await test('nothing retrieved => answer is sent but flagged and escalated', async () => {
    const d = deps({ chunks: [] });
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Bu holatda qanday javobgarlik bor?' });
    assert.strictEqual(r.action, 'answered');
    assert.strictEqual(r.escalate, true, 'ungrounded answer must reach a human');
    assert.ok(/dastlabki javob/.test(r.reply), 'user must be told the answer is preliminary');
  });

  await test('an unverifiable citation downgrades confidence', async () => {
    const d = deps({ unverified: ['512'] });
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Shartnoma buzilsa nima bo\'ladi?' });
    assert.strictEqual(r.meta.confidence, 'low');
    assert.strictEqual(r.escalate, true);
  });

  console.log('\ntelegram-agent — clarification\n');

  await test('a vague question gets ONE targeted follow-up, not an answer', async () => {
    const d = deps({ intent: { intent: 'noaniq', missing: ['Shartnoma turi qanday?', 'Qachon imzolangan?'] } });
    agent.initTelegramAgent(d);
    stubMemory(0);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Bu masala bo\'yicha aniq yo\'l ko\'rsating' });
    assert.strictEqual(r.action, 'clarify');
    assert.strictEqual(r.escalate, false);
    assert.ok(/Shartnoma turi/.test(r.reply));
    assert.strictEqual(d.calls.answer, 0);
  });

  await test('clarification never loops forever — it answers after the cap', async () => {
    // The failure mode this prevents: a user who cannot phrase the missing
    // fact gets asked the same thing until they leave.
    const d = deps({ intent: { intent: 'noaniq', missing: ['Qaysi hujjat?'] } });
    agent.initTelegramAgent(d);
    stubMemory(2); // already at MAX_CLARIFY
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Bilmayman' });
    assert.strictEqual(r.action, 'answered', 'must answer with best effort after the cap');
    assert.strictEqual(d.calls.answer, 1);
  });

  console.log('\ntelegram-agent — failure handling\n');

  await test('an uninitialized agent hands the request to the human queue', async () => {
    agent.initTelegramAgent(null);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Savolim bor' });
    assert.strictEqual(r.handled, false);
    assert.strictEqual(r.escalate, true, 'unhandled must never mean the user is ignored');
  });

  await test('a model failure during generation falls back to the human queue', async () => {
    const d = deps();
    d.callAI = async () => { throw new Error('upstream 500'); };
    agent.initTelegramAgent(d);
    stubMemory(0);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Ishdan bo\'shatish tartibi qanday?' });
    assert.strictEqual(r.handled, false);
    assert.strictEqual(r.escalate, true);
    assert.strictEqual(d.calls.release, 1, 'failed generation must refund the daily answer');
  });

  await test('an intent-classifier failure still answers rather than stalling', async () => {
    const d = deps();
    d.callCheapAI = async () => { throw new Error('classifier down'); };
    agent.initTelegramAgent(d);
    stubMemory(0);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Mehnat shartnomasi haqida savol' });
    assert.strictEqual(r.action, 'answered');
  });

  console.log('\ntelegram-agent — Telegram limits\n');

  await test('a long answer is split on paragraph breaks, not mid-word', async () => {
    const para = 'Bu juda uzun huquqiy javob matni. '.repeat(200);
    const parts = agent.splitForTelegram(para + '\n\n' + para, 3900);
    assert.ok(parts.length > 1, 'should split');
    for (const p of parts) assert.ok(p.length <= 3900, `part too long: ${p.length}`);
    assert.ok(!/\S$/.test(parts[0]) || !parts[0].endsWith('matn'), 'should not cut mid-word');
  });

  await test('a short answer is not split', async () => {
    assert.deepStrictEqual(agent.splitForTelegram('qisqa javob'), ['qisqa javob']);
  });

  await test('/start reset clears a stale attorney-choice state', async () => {
    dbState.state = 'awaiting_attorney_choice';
    dbState.context = { attorneyOptions: [{ attorney_ref: 'eadvokat:1' }] };
    dbState.turns = [{ role: 'user', text: 'Menga advokat kerak' }];
    dbState.clarifyCount = 2;

    await agent.resetConversation(1);

    assert.strictEqual(dbState.state, 'idle');
    assert.deepStrictEqual(dbState.context, {});
    assert.deepStrictEqual(dbState.turns, []);
    assert.strictEqual(dbState.clarifyCount, 0);
  });

  await test('/start explains AI identity and the daily allowance', async () => {
    const botSource = fs.readFileSync(path.join(__dirname, '../src/bot/bot.js'), 'utf8');
    assert.ok(/Men inson yurist emasman/.test(botSource));
    assert.ok(/Har kuni \$\{dailyAiLimit\} ta bepul AI huquqiy javob/.test(botSource));
    assert.ok(/await telegramAgent\.resetConversation\(chatId\)/.test(botSource), 'bare /start must clear stale agent state');
    assert.ok(/'identity', 'quota_exceeded', 'quota_unavailable'/.test(botSource), 'non-legal guardrail replies must not create queue rows');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
