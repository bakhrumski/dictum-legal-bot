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
const intakeMenus = require('../src/bot/intake-menus');

// ── Load the agent with ../database/db stubbed (no DB in tests) ─────────────
// The conversation store is DB-backed, so the fake pool is how a test controls
// prior state (how many clarifying questions this chat has already had).
const dbState = { clarifyCount: 0, turns: [], mode: 'automatic', state: 'idle', context: {}, aiAnswers: 0, paidCredits: 0, reservations: new Map() };
const fakePool = {
  query: async (sql, params = []) => {
    if (/BEGIN|COMMIT|ROLLBACK|pg_advisory_xact_lock/i.test(sql)) return { rows: [] };
    if (/CREATE TABLE|CREATE UNIQUE INDEX|ALTER TABLE/i.test(sql)) return { rows: [] };
    if (/UPDATE tg_agent_free_usage\s+usage/i.test(sql)) return { rows: [] };
    if (/UPDATE tg_answer_reservations/i.test(sql) && /created_at\s*</i.test(sql)) return { rows: [] };
    if (/SELECT reservation_id FROM tg_answer_reservations/i.test(sql)) {
      const found = Array.from(dbState.reservations.values()).find(r => r.chatId === String(params[0]) && r.status === 'pending');
      return { rows: found ? [{ reservation_id: found.id }] : [] };
    }
    if (/INSERT INTO tg_answer_reservations/i.test(sql)) {
      const reservation = { id: String(params[0]), chatId: String(params[1]), source: /'paid'/i.test(sql) ? 'paid' : 'free', usageDay: /usage_day/i.test(sql) ? '2026-08-14' : null, status: 'pending' };
      dbState.reservations.set(reservation.id, reservation);
      return { rows: [] };
    }
    if (/UPDATE tg_answer_reservations/i.test(sql) && /status = 'delivered'/i.test(sql)) {
      const reservation = dbState.reservations.get(String(params[0]));
      if (!reservation || reservation.status !== 'pending') return { rows: [] };
      reservation.status = 'delivered';
      return { rows: [{ reservation_id: reservation.id }] };
    }
    if (/UPDATE tg_answer_reservations/i.test(sql) && /RETURNING source/i.test(sql)) {
      const reservation = dbState.reservations.get(String(params[0]));
      if (!reservation || reservation.status !== 'pending') return { rows: [] };
      reservation.status = 'released';
      return { rows: [{ source: reservation.source, usage_day: reservation.usageDay }] };
    }
    if (/SELECT\s+turns/i.test(sql)) {
      return { rows: [{ turns: dbState.turns, clarify_count: dbState.clarifyCount, mode: dbState.mode, state: dbState.state, language: 'uz', context: dbState.context }] };
    }
    if (/INSERT INTO\s+tg_agent_daily_free_usage/i.test(sql) && /VALUES/i.test(sql)) {
      const limit = Number(params[1]) || 0;
      if (dbState.aiAnswers >= limit) return { rows: [] };
      dbState.aiAnswers++;
      return { rows: [{ free_answers: dbState.aiAnswers }] };
    }
    if (/UPDATE\s+tg_agent_daily_free_usage/i.test(sql)) {
      dbState.aiAnswers = Math.max(0, dbState.aiAnswers - 1);
      return { rows: [] };
    }
    if (/AS\s+free_used/i.test(sql) && /AS\s+paid_credits/i.test(sql)) {
      const pending = Array.from(dbState.reservations.values()).some(r => r.chatId === String(params[0]) && r.status === 'pending');
      return { rows: [{ free_used: dbState.aiAnswers, paid_credits: dbState.paidCredits, answer_pending: pending }] };
    }
    if (/SELECT\s+credits\s+FROM\s+tg_answer_wallets/i.test(sql)) {
      return { rows: dbState.paidCredits ? [{ credits: dbState.paidCredits }] : [] };
    }
    if (/UPDATE\s+tg_answer_wallets/i.test(sql)) {
      if (dbState.paidCredits < 1) return { rows: [] };
      dbState.paidCredits--;
      return { rows: [{ credits: dbState.paidCredits }] };
    }
    if (/INSERT INTO\s+tg_conversations/i.test(sql) && /state\s*=\s*'idle'/i.test(sql)) {
      dbState.turns = [];
      dbState.clarifyCount = 0;
      dbState.state = 'idle';
      dbState.context = {};
      return { rows: [] };
    }
    if (/INSERT INTO\s+tg_conversations/i.test(sql) && /CASE WHEN \$4/i.test(sql)) {
      dbState.state = String(params[1] || 'idle');
      if (params[3]) dbState.context = JSON.parse(params[2] || '{}');
      return { rows: [] };
    }
    if (/last_intent, language, state/i.test(sql)) {
      dbState.state = String(params[3] || 'idle');
      return { rows: [] };
    }
    if (/chat_id, turns, clarify_count/i.test(sql) && params.length === 3) {
      dbState.turns = JSON.parse(params[1] || '[]');
      dbState.clarifyCount = Number(params[2]) || 0;
      return { rows: [] };
    }
    return { rows: [] };
  },
};
fakePool.connect = async () => ({
  query: fakePool.query,
  release() {},
});

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
  const calls = { answer: 0, intent: 0, korpus: 0, attorneys: 0, attorneyCriteria: null, contacts: 0, events: 0, quota: 0, release: 0, shadow: 0, shadowPayload: null, retrieval: null };
  const dependencies = {
    calls,
    callCheapAI: async () => {
      calls.intent++;
      return { text: JSON.stringify(o.intent || { intent: 'huquqiy_savol', missing: [] }) };
    },
    callAI: async () => {
      calls.answer++;
      return { text: o.answer !== undefined ? o.answer : 'Mehnat kodeksining 100-moddasiga ko\'ra ish beruvchi buyruq chiqarishi shart.', provider: 'test-model' };
    },
    retrieveLegalContext: async (query, topic, language, options) => {
      calls.retrieval = { query, topic, language, options };
      return {
        context: o.chunks && o.chunks.length ? 'kontekst' : '',
        chunks: o.chunks !== undefined ? o.chunks : [{ law_name: 'Mehnat kodeksi', article_numbers: ['100'], source_url: 'https://lex.uz/docs/1', chunk_text: '100-modda ...' }],
      };
    },
    verifyCitations: () => ({ total: 1, unverified: o.unverified || [] }),
    buildTopicPrompt: () => 'SYSTEM',
    classifyLegalTopic: async () => o.topic || 'mehnat',
    searchKorpus: o.korpus ? async () => { calls.korpus++; return { corrected_answer: o.korpus }; } : null,
    embeddingApiKey: o.korpus ? 'key' : null,
    findAttorneys: async (criteria) => {
      calls.attorneys++;
      calls.attorneyCriteria = criteria;
      return o.attorneys || [];
    },
    getAttorneyContact: async () => {
      calls.contacts++;
      return o.contact || null;
    },
    recordAgentEvent: async () => { calls.events++; },
    claimDailyAnswer: async () => {
      calls.quota++;
      return o.quota || { allowed: true, reservationId: '00000000-0000-4000-8000-000000000001', source: 'free', used: 1, remaining: 2, limit: 3, paidCredits: 0 };
    },
    releaseDailyAnswer: async () => { calls.release++; },
  };
  if (o.shadow) {
    dependencies.runShadowEvaluation = async payload => {
      calls.shadow++;
      calls.shadowPayload = payload;
      if (o.shadowError) throw new Error('shadow offline');
      return { status: 'success' };
    };
  }
  return dependencies;
}

/** Set how many clarifying questions this chat has already been asked. */
function stubMemory(clarifyCount = 0) {
  dbState.clarifyCount = clarifyCount;
  dbState.turns = [];
  dbState.mode = 'automatic';
  dbState.state = 'idle';
  dbState.context = {};
  dbState.aiAnswers = 0;
  dbState.reservations = new Map();
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

  await test('a free-text document request starts deterministic paid-service intake', async () => {
    const d = deps();
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: "Menga da'vo arizasi tayyorlab bering" });
    assert.strictEqual(r.action, 'document_intake_started');
    assert.strictEqual(r.escalate, false);
    assert.strictEqual(r.meta.conversationState, 'document_type');
    assert.ok(/pullik xizmat/.test(r.reply));
    assert.ok(!/\d[\d\s,.]*\s*(so['’]?m|UZS)/i.test(r.reply), 'agent must not invent a price');
    assert.strictEqual(d.calls.intent, 0, 'document keyword routing must not use AI');
  });

  await test('a legal case mentioning documents and a written fine stays in legal Q&A', async () => {
    stubMemory();
    const d = deps();
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({
      chatId: 1,
      text: "GAI meni to'xtatib hujjatlarimni so'radi, men mygov mobil ilovasidan ID-kartamni ko'rsatsam tan olmadi va menga jarima yozib mashinamni stoyanka qildi. Shu to'g'rimi?",
    });
    assert.strictEqual(r.action, 'answered');
    assert.strictEqual(r.meta.intent, 'huquqiy_savol');
    assert.strictEqual(d.calls.intent, 1, 'the legal facts must reach intent classification');
    assert.strictEqual(d.calls.answer, 1, 'the legal question must reach RAG answering');
  });

  await test('completed document intake creates a lawyer-approved paid service', async () => {
    const d = deps();
    agent.initTelegramAgent(d);
    dbState.state = 'document_details';
    dbState.context = { serviceSlug: 'claim', documentTypeLabel: "Da'vo arizasi", category: 'Odil sudlov' };
    const r = await agent.handleUserMessage({
      chatId: 1,
      text: "Qarz oluvchi olti oydan beri 20 million so'm qarzni qaytarmayapti, tilxat bor.",
    });
    assert.strictEqual(r.action, 'paid_service');
    assert.strictEqual(r.escalate, true);
    assert.strictEqual(r.meta.serviceSlug, 'claim');
    assert.strictEqual(r.meta.category, 'Odil sudlov');
    assert.strictEqual(r.meta.requiresLawyerApproval, true);
    assert.strictEqual(d.calls.intent, 0, 'button-selected document intake must not use AI classification');
    stubMemory();
  });

  await test('a generic attorney request starts intake instead of guessing matches', async () => {
    const d = deps();
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Menga yurist kerak!' });
    assert.strictEqual(r.action, 'attorney_intake_started');
    assert.strictEqual(r.escalate, false);
    assert.strictEqual(r.meta.conversationState, 'attorney_field');
    assert.strictEqual(d.calls.attorneys, 0, 'directory must not be searched without criteria');
    assert.strictEqual(d.calls.intent, 0, 'obvious attorney request must not use AI classification');
    assert.ok(/yo'nalishi va hududni tanlash/i.test(r.reply));
    stubMemory();
  });

  await test('a completed attorney intake uses strict explicit criteria', async () => {
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
    dbState.state = 'attorney_problem';
    dbState.context = {
      fieldCode: 'labor',
      fieldLabel: 'Mehnat huquqi',
      legalField: 'Fuqarolik va iqtisodiy sud ishlarini yuritish',
      category: 'Mehnat va aholining bandligi',
      strictField: true,
      region: 'Toshkent shahar',
      regionLabel: 'Toshkent shahri',
      strictRegion: true,
    };
    const r = await agent.handleUserMessage({
      chatId: 1,
      text: 'Ish beruvchi meni noqonuniy bo\'shatdi, buyruq nusxasini bermadi va ishga tiklanmoqchiman.',
    });
    assert.strictEqual(r.action, 'attorney_matches');
    assert.strictEqual(r.escalate, false);
    assert.ok(/Aziza Karimova/.test(r.reply));
    assert.ok(/narxini belgilamaydi/.test(r.reply));
    assert.ok(!/\+998 90 000-00-00/.test(r.reply), 'phone must stay hidden before the user chooses');
    assert.ok(/raqamini yuboring/.test(r.reply), 'the consent step must be explicit');
    assert.deepStrictEqual(r.meta.attorneyIds, [7]);
    assert.deepStrictEqual(r.meta.attorneyRefs, ['eadvokat:7']);
    assert.strictEqual(r.meta.category, 'Mehnat va aholining bandligi');
    assert.strictEqual(d.calls.intent, 0, 'structured attorney intake must not use AI classification');
    assert.deepStrictEqual(d.calls.attorneyCriteria, {
      query: 'Ish beruvchi meni noqonuniy bo\'shatdi, buyruq nusxasini bermadi va ishga tiklanmoqchiman.',
      legalField: 'Fuqarolik va iqtisodiy sud ishlarini yuritish',
      legalSubfield: 'Mehnat huquqi',
      region: 'Toshkent shahar',
      strictField: true,
      strictRegion: true,
      limit: 3,
    });
    stubMemory();
  });

  await test('an incomplete attorney problem never searches the directory', async () => {
    const d = deps();
    agent.initTelegramAgent(d);
    dbState.state = 'attorney_problem';
    dbState.context = {
      fieldCode: 'criminal',
      fieldLabel: 'Jinoyat ishlari',
      legalField: "Ma'muriy va jinoiy sud ishlarini yuritish",
      strictField: true,
      region: 'Samarqand viloyati',
      regionLabel: 'Samarqand',
      strictRegion: true,
    };
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Advokat kerak' });
    assert.strictEqual(r.action, 'attorney_problem_required');
    assert.strictEqual(d.calls.attorneys, 0);
    assert.strictEqual(d.calls.intent, 0);
    stubMemory();
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

  await test('the advertised "qaysi biri mos?" phrase compares candidates instead of forcing a number', async () => {
    dbState.state = 'awaiting_attorney_choice';
    dbState.context = {
      criteria: { fieldLabel: 'Mehnat huquqi', regionLabel: 'Toshkent shahri' },
      attorneyOptions: [
        { index: 1, ref: 'eadvokat:7', name: 'Aziza Karimova', region: 'Toshkent shahar', reasons: ['soha mos keladi', 'hudud mos keladi'] },
        { index: 2, ref: 'eadvokat:8', name: 'Jasur Alimov', region: 'Toshkent shahar', reasons: ['soha mos keladi'] },
      ],
    };
    const d = deps();
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'qaysi biri mos?' });
    assert.strictEqual(r.action, 'attorney_compare');
    assert.ok(/xizmat sifatini kafolatlay olmayman/i.test(r.reply));
    assert.ok(/Aziza Karimova/.test(r.reply));
    assert.strictEqual(d.calls.contacts, 0, 'comparison is not consent to reveal a phone');
    assert.strictEqual(d.calls.intent, 0, 'choice-state messages must not use AI classification');
    stubMemory();
  });

  await test('no verified strict match creates a human follow-up request', async () => {
    const d = deps({ attorneys: [] });
    agent.initTelegramAgent(d);
    dbState.state = 'attorney_problem';
    dbState.context = {
      fieldCode: 'criminal',
      fieldLabel: 'Jinoyat ishlari',
      legalField: "Ma'muriy va jinoiy sud ishlarini yuritish",
      strictField: true,
      region: 'Namangan viloyati',
      regionLabel: 'Namangan',
      strictRegion: true,
    };
    const r = await agent.handleUserMessage({
      chatId: 1,
      text: 'Tergovchi meni gumon qilinuvchi sifatida chaqirdi va himoyachi ishtiroki kerak.',
    });
    assert.strictEqual(r.action, 'attorney_request');
    assert.strictEqual(r.escalate, true);
    assert.ok(/Master Adminga yuborildi/.test(r.reply));
    assert.strictEqual(d.calls.attorneyCriteria.strictField, true);
    assert.strictEqual(d.calls.attorneyCriteria.strictRegion, true);
    stubMemory();
  });

  console.log('\ntelegram-agent — answering\n');

  await test('button-selected legal questions bypass intent classification', async () => {
    const d = deps();
    agent.initTelegramAgent(d);
    dbState.state = 'legal_question_intake';
    dbState.context = {};
    const r = await agent.handleUserMessage({
      chatId: 1,
      text: 'Ish beruvchi meni ishdan bo\'shatdi, lekin buyruq nusxasini bermadi. Nima qilaman?',
    });
    assert.strictEqual(r.action, 'answered');
    assert.strictEqual(d.calls.intent, 0, 'service menu already supplied the intent');
    assert.strictEqual(d.calls.answer, 1);
    stubMemory();
  });

  await test('generic legal-help wording clarifies without AI, sources, or quota use', async () => {
    stubMemory();
    const d = deps({ korpus: 'This verified answer must not be reached.' });
    agent.initTelegramAgent(d);
    dbState.state = 'legal_question_intake';
    dbState.context = {};
    const r = await agent.handleUserMessage({ chatId: 1, text: 'menga huquqiy yordam kerak' });
    assert.strictEqual(r.action, 'clarify');
    assert.ok(/nima sodir bo['’]ldi/i.test(r.reply));
    assert.ok(!/Manbalar|yuridik kuchga ega emas|bepul AI javob/i.test(r.reply));
    assert.strictEqual(d.calls.intent, 0, 'generic help needs no intent-model call');
    assert.strictEqual(d.calls.korpus, 0, 'generic help must not search the answer bank');
    assert.strictEqual(d.calls.answer, 0, 'generic help must not generate an answer');
    assert.strictEqual(d.calls.quota, 0, 'clarification must not consume an answer entitlement');
    stubMemory();
  });

  await test('a clear legal question is answered with sources and a disclaimer', async () => {
    const d = deps();
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Ish beruvchi meni ishdan bo\'shatdi, buyruq bermadi. Nima qilishim kerak?' });
    assert.strictEqual(r.action, 'answered');
    assert.strictEqual(r.escalate, false, 'a confident answer must not also queue a lawyer');
    assert.ok(/Mehnat kodeksi/.test(r.reply), 'sources missing');
    assert.ok(/lex\.uz/.test(r.reply), 'source link missing');
    assert.ok(/#:~:text=/.test(r.reply), 'source must deep-link to the cited provision');
    assert.ok(/yuridik kuchga ega emas/.test(r.reply), 'disclaimer missing');
    assert.ok(/Bugun yana 2 ta bepul AI huquqiy javobingiz qoldi/i.test(r.reply), 'daily free-answer balance missing');
    assert.strictEqual(r.meta.entitlementSource, 'free');
    assert.deepStrictEqual(
      r.meta.nextActions.map(action => action.kind),
      ['document', 'document', 'attorney', 'custom'],
      'a completed answer must offer deterministic next steps'
    );
    assert.strictEqual(dbState.state, 'awaiting_next_action');
  });

  await test('a clarification answer retrieves the complete labor case with strict topic scope', async () => {
    stubMemory(1);
    dbState.state = 'clarifying';
    dbState.turns = [
      { role: 'user', text: "Meni ishdan bo'shatishdi va ikki oylik ish haqimni berishmadi. Mehnat shartnomam mavjud." },
      { role: 'ai', text: "Buyruq asosi, sana va to'lanmagan oylarni yozing." },
    ];
    const d = deps();
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({
      chatId: 1,
      text: "Asossiz, 10-avgustda. Iyun va iyul uchun to'lashmadi. Xabarnoma berishmadi.",
    });
    assert.strictEqual(r.action, 'answered');
    assert.strictEqual(d.calls.retrieval.topic, 'mehnat');
    assert.strictEqual(d.calls.retrieval.options.strictTopic, true);
    assert.match(d.calls.retrieval.query, /ishdan bo['’]shatishdi/i);
    assert.match(d.calls.retrieval.query, /iyun va iyul/i);
    stubMemory();
  });

  await test('Telegram uses inline named citations and no separate Manbalar footer', async () => {
    const d = deps({
      answer: 'Mehnat kodeksining 100-moddasiga ko\'ra ish beruvchi yozma buyruq berishi shart.',
      chunks: [
        { law_name: 'Mehnat kodeksi', article_numbers: ['100'], source_url: 'https://lex.uz/docs/1', chunk_text: '100-modda ...' },
        { law_name: "Ma'muriy sud ishlarini yuritish kodeksi", article_numbers: ['126'], source_url: 'https://lex.uz/docs/2', chunk_text: '126-modda ...' },
        { law_name: 'Fuqarolik kodeksi', article_numbers: ['382'], source_url: 'https://lex.uz/docs/3', chunk_text: '382-modda ...' },
      ],
    });
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: "Ish beruvchi meni ishdan bo'shatdi." });
    assert.doesNotMatch(r.reply, /Manbalar/);
    assert.match(r.reply, /\[\*\*Mehnat kodeksi, 100-modda, tegishli qism\*\*\]\(https:\/\/lex\.uz/u);
    assert.doesNotMatch(r.reply, /Ma'muriy sud ishlarini yuritish kodeksi/);
    assert.doesNotMatch(r.reply, /Fuqarolik kodeksi/);
  });

  await test('non-labor legal fields use their classified topic and grounded sources', async () => {
    const d = deps({
      topic: 'oila',
      answer: '**Tahlil**\nOila kodeksi 96-moddasiga ko\'ra aliment undiriladi.\n\n**Xulosa**\nSudga murojaat qiling.',
      chunks: [
        { law_name: 'Oila kodeksi', article_numbers: ['96'], source_url: 'https://lex.uz/docs/3', chunk_text: '96-modda ...' },
      ],
    });
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Alimentni undirish tartibi qanday?' });
    assert.strictEqual(r.action, 'answered');
    assert.strictEqual(d.calls.retrieval.topic, 'oila');
    assert.match(r.reply, /Oila kodeksi, 96-modda/);
  });

  await test('Telegram links only law articles applied in Tahlil', async () => {
    const d = deps({
      topic: 'mamuriy',
      answer: [
        '**Huquqiy asos**',
        "MJTK 128-moddasi va Ma'muriy sud ishlarini yuritish kodeksi 126-moddasi mavjud.",
        '',
        '**Tahlil**',
        "Sizning jarima holatingizga Ma'muriy javobgarlik to'g'risidagi kodeks 128-moddasi qo'llanadi.",
        '',
        '**Xulosa**',
        'Jarima qarorini tekshiring.',
      ].join('\n'),
      chunks: [
        { law_name: "Ma'muriy javobgarlik to'g'risidagi kodeks", article_numbers: ['128'], source_url: 'https://lex.uz/docs/4', chunk_text: '128-modda ...' },
        { law_name: "Ma'muriy sud ishlarini yuritish kodeksi", article_numbers: ['126'], source_url: 'https://lex.uz/docs/5', chunk_text: '126-modda ...' },
      ],
    });
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: "Yo'l harakati jarimasiga qanday shikoyat qilaman?" });
    assert.match(r.reply, /\[\*\*Ma'muriy javobgarlik to'g'risidagi kodeks, 128-modda, tegishli qism\*\*\]/u);
    assert.doesNotMatch(r.reply, /\[\*\*Ma'muriy sud ishlarini yuritish kodeksi, 126-modda/u);
  });

  await test('Telegram links every distinct article applied in Tahlil', async () => {
    const d = deps({
      topic: 'fuqarolik',
      answer: [
        '**Tahlil**',
        'Fuqarolik kodeksi 382-moddasi shartnomani o\'zgartirishga, Fuqarolik kodeksi 384-moddasi esa uning tartibiga qo\'llanadi.',
        '',
        '**Xulosa**',
        'Shartnomani yozma tartibda o\'zgartiring.',
      ].join('\n'),
      chunks: [
        { law_name: 'Fuqarolik kodeksi', article_numbers: ['382'], source_url: 'https://lex.uz/docs/6', chunk_text: '382-modda ...' },
        { law_name: 'Fuqarolik kodeksi', article_numbers: ['384'], source_url: 'https://lex.uz/docs/6', chunk_text: '384-modda ...' },
        { law_name: 'Iqtisodiy protsessual kodeksi', article_numbers: ['134'], source_url: 'https://lex.uz/docs/7', chunk_text: '134-modda ...' },
      ],
    });
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Shartnomani qanday o\'zgartirish mumkin?' });
    assert.match(r.reply, /Fuqarolik kodeksi, 382-modda, tegishli qism/u);
    assert.match(r.reply, /Fuqarolik kodeksi, 384-modda, tegishli qism/u);
    assert.doesNotMatch(r.reply, /Iqtisodiy protsessual kodeksi/u);
  });

  await test('a fourth unpaid legal answer is blocked before retrieval or generation', async () => {
    const d = deps({ quota: { allowed: false, used: 3, remaining: 0, limit: 3, paidCredits: 0 } });
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Mehnat ta\'tili necha kun?' });
    assert.strictEqual(r.action, 'quota_exceeded');
    assert.ok(/Bugungi 3 ta bepul AI huquqiy javobingizdan foydalandingiz/i.test(r.reply));
    assert.strictEqual(d.calls.answer, 0, 'quota must block answer generation');
    assert.strictEqual(d.calls.korpus, 0, 'quota must block paid/verified answer work');
  });

  await test('an in-flight answer never shows the used-free-answer payment prompt', async () => {
    const d = deps({ quota: { allowed: false, pending: true, used: 1, remaining: 2, limit: 3, paidCredits: 0 } });
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Mehnat ta\'tili necha kun?' });
    assert.strictEqual(r.action, 'answer_pending');
    assert.match(r.reply, /javob hali tayyorlanmoqda/i);
    assert.doesNotMatch(r.reply, /bepul AI huquqiy javobingizdan foydalandingiz/i);
    assert.strictEqual(d.calls.answer, 0, 'a duplicate in-flight request must not start another answer');
  });

  await test('an exhausted user is blocked before model-based intent classification', async () => {
    stubMemory();
    dbState.aiAnswers = 3;
    const d = deps();
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Ishdagi murakkab vaziyat bo\'yicha nima qilaman?' });
    assert.strictEqual(r.action, 'quota_exceeded');
    assert.strictEqual(d.calls.intent, 0, 'no token may be spent before payment');
    assert.strictEqual(d.calls.answer, 0);
    stubMemory();
  });

  await test('an exhausted user can still greet without any model or credit', async () => {
    stubMemory();
    dbState.aiAnswers = 3;
    const d = deps();
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Assalomu alaykum', firstName: 'Malika' });
    assert.strictEqual(r.action, 'greeting');
    assert.strictEqual(d.calls.intent, 0);
    assert.strictEqual(d.calls.answer, 0);
    assert.strictEqual(dbState.aiAnswers, 3);
    stubMemory();
  });

  await test('Hermes shadow never spends tokens on deterministic greetings', async () => {
    stubMemory();
    const d = deps({ shadow: true });
    agent.initTelegramAgent(d);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Assalomu alaykum', firstName: 'Malika' });
    assert.strictEqual(r.action, 'greeting');
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(d.calls.shadow, 0);
  });

  await test('the daily-free reservation is atomic and releasable', async () => {
    dbState.aiAnswers = 0;
    const first = await agent.claimDailyAiAnswer(77);
    const second = await agent.claimDailyAiAnswer(77);
    assert.strictEqual(first.allowed, true);
    assert.strictEqual(first.source, 'free');
    assert.strictEqual(first.remaining, 2);
    assert.strictEqual(second.allowed, false);
    await agent.releaseDailyAiAnswer(77, first);
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
    assert.ok(r.meta.reservationId, 'delivery must receive the reservation ID to finalize later');
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
    assert.strictEqual(d.calls.release, 1, 'failed generation must refund the answer entitlement');
  });

  await test('an intent-classifier failure still answers rather than stalling', async () => {
    const d = deps();
    d.callCheapAI = async () => { throw new Error('classifier down'); };
    agent.initTelegramAgent(d);
    stubMemory(0);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Mehnat shartnomasi haqida savol' });
    assert.strictEqual(r.action, 'answered');
  });

  await test('a failing Hermes shadow cannot change or delay a production legal answer', async () => {
    const d = deps({ shadow: true, shadowError: true });
    agent.initTelegramAgent(d);
    stubMemory(0);
    const r = await agent.handleUserMessage({ chatId: 1, text: 'Mehnat shartnomasini bekor qilish tartibi qanday?' });
    assert.strictEqual(r.action, 'answered');
    assert.strictEqual(r.handled, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(d.calls.shadow, 1);
    assert.strictEqual(d.calls.shadowPayload.productionResult.action, 'answered');
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

  await test('service menu exposes the three supported request types', async () => {
    const callbacks = intakeMenus.serviceKeyboard().inline_keyboard.flat().map(button => button.callback_data);
    assert.deepStrictEqual(callbacks, ['svc_legal', 'svc_attorney', 'svc_document']);
  });

  await test('attorney menu callbacks collect field and region before the problem', async () => {
    const field = intakeMenus.resolveIntakeCallback('atf_labor', {});
    assert.strictEqual(field.state, 'attorney_region');
    assert.strictEqual(field.context.fieldLabel, 'Mehnat huquqi');
    assert.strictEqual(field.context.category, 'Mehnat va aholining bandligi');
    assert.strictEqual(field.context.strictField, true);

    const region = intakeMenus.resolveIntakeCallback('atr_tashkent_city', field.context);
    assert.strictEqual(region.state, 'attorney_problem');
    assert.strictEqual(region.context.region, 'Toshkent shahar');
    assert.strictEqual(region.context.strictRegion, true);
    assert.ok(/faqat shu ma'lumotlardan keyin tanlanadi/i.test(region.message));
  });

  await test('document menu records the selected paid service without AI', async () => {
    const action = intakeMenus.resolveIntakeCallback('doc_claim', {});
    assert.strictEqual(action.state, 'document_details');
    assert.strictEqual(action.context.serviceSlug, 'claim');
    assert.strictEqual(action.context.category, 'Odil sudlov');
    assert.ok(/pullik xizmat/i.test(action.message));
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

  await test('/start explains AI identity, the free answer and unlimited non-token conversation', async () => {
    const botSource = fs.readFileSync(path.join(__dirname, '../src/bot/bot.js'), 'utf8');
    assert.ok(/Men inson yurist emasman/.test(botSource));
    assert.ok(/Har kuni \$\{freeAiLimit\} ta AI huquqiy javobni bepul olasiz/.test(botSource));
    assert.ok(/AGENT_FREE_AI_LIMIT \|\| '3'/.test(botSource), 'Telegram daily allowance must default to three');
    assert.ok(/bepul va cheklanmagan/.test(botSource));
    assert.ok(/callback_data: 'bot_stats'/.test(botSource), 'public anonymous user statistics must be available');
    assert.ok(/bot\.on\('pre_checkout_query'/.test(botSource), 'Telegram Stars checkout must be verified');
    assert.ok(/telegram_payment_charge_id/.test(botSource), 'successful payments must store Telegram receipt IDs');
    assert.ok(/setMyCommands\(\[/.test(botSource), 'payment support, terms and statistics must be discoverable');
    assert.ok(/if \(agentReplyDelivered\)[\s\S]*finalizeDailyAiAnswer[\s\S]*else[\s\S]*releaseDailyAiAnswer/.test(botSource), 'answers must finalize after delivery and refund when delivery fails');
    assert.ok(/reservationId: agentResult\.meta && agentResult\.meta\.reservationId/.test(botSource), 'delivery accounting must use the exact reservation ID');
    assert.ok(/const PAID_ANSWER_STARS[^\n]*\|\| '1'/.test(botSource), 'the cheapest invoice must be one Telegram Star');
    assert.ok(/const PAID_ANSWER_CREDITS[^\n]*\|\| '4'/.test(botSource), 'one Star must grant four cost-recovery answer credits');
    assert.ok(/await telegramAgent\.resetConversation\(chatId\)/.test(botSource), 'bare /start must clear stale agent state');
    assert.ok(/reply_markup: startKeyboard\(false\)/.test(botSource), 'bare /start must show the deterministic service menu');
    assert.ok(/categoryFromAgentMeta\(agentMeta\)/.test(botSource), 'guided intake category must reach the Master Admin queue without another classifier');
    assert.ok(/'identity', 'answer_pending', 'quota_exceeded', 'quota_unavailable'/.test(botSource), 'non-legal guardrail replies must not create queue rows');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
