'use strict';

/**
 * Autonomous Telegram legal agent.
 *
 * Runs a full conversation with a Telegram user WITHOUT a human in the loop:
 * understands what they sent, asks for the missing facts when the question is
 * unanswerable as written, answers from the platform's own verified pipeline
 * (qa-korpus → RAG over the legal corpus → citation check), and escalates to a
 * human lawyer only when it cannot stand behind an answer.
 *
 * Why this exists: bot.js previously auto-answered through `askJustify`, an
 * external service that defaults to http://localhost:8000. In production that
 * host does not exist, so `_justifyOk` is false and EVERY request — including
 * simple ones the platform can answer in seconds — sat in the human queue.
 * This agent uses the same retrieval + verification stack as the dashboard
 * chat, so a Telegram user gets the same grounded, cited answer.
 *
 * Design commitments:
 *  - Never invent law. Citations are checked against the retrieved context;
 *    an answer that cites articles we cannot verify is downgraded, not sent
 *    as authority.
 *  - Never silently stall. Every path ends in a message to the user — an
 *    answer, a question, or an honest "a lawyer will take this".
 *  - Dependency-injected (initTelegramAgent) so this module has no static
 *    dependency on server.js and cannot create a require cycle with bot.js.
 */

const { pool } = require('../database/db');

// ─────────────────────────────────────────────────────────────────────────────
// Wiring
// ─────────────────────────────────────────────────────────────────────────────

let D = null;

/**
 * @param {object} deps
 *   callAI, callCheapAI            — model routers from server.js
 *   retrieveLegalContext           — corpus retrieval
 *   verifyCitations                — article-number check against context
 *   buildTopicPrompt               — the same prompt the dashboard chat uses
 *   classifyLegalTopic             — legal field classifier
 *   searchKorpus, embeddingApiKey  — lawyer-verified answer bank (optional)
 *   findAttorneys                  — verified, explainable attorney matching
 *   recordAgentEvent               — operational telemetry (optional)
 */
function initTelegramAgent(deps) {
  D = deps || null;
  console.log('[TG-AGENT] initialized' + (deps && deps.searchKorpus ? ' (with qa-korpus)' : ''));
}

function isReady() { return !!(D && D.callAI && D.retrieveLegalContext); }

// ─────────────────────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────────────────────

const AUTO_ANSWER      = process.env.AGENT_AUTO_ANSWER !== 'false';   // master switch
const ESCALATE_WEAK    = process.env.AGENT_ESCALATE_WEAK !== 'false'; // hand low-confidence to humans
const MAX_CLARIFY      = parseInt(process.env.AGENT_MAX_CLARIFY, 10) || 2;
const parsedDailyLimit = Number.parseInt(process.env.AGENT_DAILY_AI_LIMIT || '3', 10);
const DAILY_AI_LIMIT   = Number.isFinite(parsedDailyLimit) && parsedDailyLimit >= 0 ? parsedDailyLimit : 3;
const HISTORY_TURNS    = 8;
const HISTORY_TTL_H    = 48;
const TG_LIMIT         = 3900;  // Telegram hard limit is 4096; leave headroom

const DISCLAIMER = "\n\n_Javob SI tomonidan tayyorlandi va yuridik kuchga ega emas. Muhim masalalarda yurist bilan maslahatlashing._";

// ─────────────────────────────────────────────────────────────────────────────
// Conversation memory
// ─────────────────────────────────────────────────────────────────────────────
// Persisted rather than in-memory: Render restarts containers frequently, and
// a user mid-clarification would otherwise be asked the same question twice.

let _tableReady = false;
let _usageTableReady = false;
async function ensureTable() {
  if (_tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tg_conversations (
      chat_id       BIGINT PRIMARY KEY,
      turns         JSONB   NOT NULL DEFAULT '[]'::jsonb,
      clarify_count INTEGER NOT NULL DEFAULT 0,
      mode          VARCHAR(20) NOT NULL DEFAULT 'automatic',
      state         VARCHAR(40) NOT NULL DEFAULT 'idle',
      language      VARCHAR(10) NOT NULL DEFAULT 'uz',
      last_intent   VARCHAR(60),
      context       JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE tg_conversations ADD COLUMN IF NOT EXISTS mode VARCHAR(20) NOT NULL DEFAULT 'automatic'`);
  await pool.query(`ALTER TABLE tg_conversations ADD COLUMN IF NOT EXISTS state VARCHAR(40) NOT NULL DEFAULT 'idle'`);
  await pool.query(`ALTER TABLE tg_conversations ADD COLUMN IF NOT EXISTS language VARCHAR(10) NOT NULL DEFAULT 'uz'`);
  await pool.query(`ALTER TABLE tg_conversations ADD COLUMN IF NOT EXISTS last_intent VARCHAR(60)`);
  await pool.query(`ALTER TABLE tg_conversations ADD COLUMN IF NOT EXISTS context JSONB NOT NULL DEFAULT '{}'::jsonb`);
  _tableReady = true;
}

async function ensureUsageTable() {
  if (_usageTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tg_agent_daily_usage (
      chat_id    BIGINT  NOT NULL,
      usage_day  DATE    NOT NULL,
      ai_answers INTEGER NOT NULL DEFAULT 0 CHECK (ai_answers >= 0),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, usage_day)
    )
  `);
  _usageTableReady = true;
}

/** Atomically reserve one legal answer for the current Tashkent day. */
async function claimDailyAiAnswer(chatId) {
  if (DAILY_AI_LIMIT === 0) {
    return { allowed: false, used: 0, remaining: 0, limit: 0 };
  }
  try {
    await ensureUsageTable();
    const result = await pool.query(`
      INSERT INTO tg_agent_daily_usage (chat_id, usage_day, ai_answers, updated_at)
      VALUES ($1, timezone('Asia/Tashkent', NOW())::date, 1, NOW())
      ON CONFLICT (chat_id, usage_day) DO UPDATE SET
        ai_answers = tg_agent_daily_usage.ai_answers + 1,
        updated_at = NOW()
      WHERE tg_agent_daily_usage.ai_answers < $2
      RETURNING ai_answers
    `, [chatId, DAILY_AI_LIMIT]);
    if (!result.rows.length) {
      return { allowed: false, used: DAILY_AI_LIMIT, remaining: 0, limit: DAILY_AI_LIMIT };
    }
    const used = Number(result.rows[0].ai_answers) || 1;
    return { allowed: true, used, remaining: Math.max(0, DAILY_AI_LIMIT - used), limit: DAILY_AI_LIMIT };
  } catch (error) {
    console.error('[TG-AGENT] daily quota check failed:', error.message);
    return { allowed: false, unavailable: true, used: 0, remaining: 0, limit: DAILY_AI_LIMIT };
  }
}

/** Release a reservation when generation fails before an answer is delivered. */
async function releaseDailyAiAnswer(chatId) {
  try {
    await ensureUsageTable();
    await pool.query(`
      UPDATE tg_agent_daily_usage
         SET ai_answers = GREATEST(0, ai_answers - 1), updated_at = NOW()
       WHERE chat_id = $1
         AND usage_day = timezone('Asia/Tashkent', NOW())::date
    `, [chatId]);
  } catch (error) {
    console.warn('[TG-AGENT] daily quota release failed:', error.message);
  }
}

async function loadConversation(chatId) {
  try {
    await ensureTable();
    const r = await pool.query(
      `SELECT turns, clarify_count, mode, state, language, context FROM tg_conversations
        WHERE chat_id = $1 AND updated_at > NOW() - INTERVAL '${HISTORY_TTL_H} hours'`,
      [chatId]
    );
    if (!r.rows.length) return { turns: [], clarifyCount: 0, mode: 'automatic', state: 'idle', language: 'uz', context: {} };
    return {
      turns: Array.isArray(r.rows[0].turns) ? r.rows[0].turns : [],
      clarifyCount: r.rows[0].clarify_count || 0,
      mode: r.rows[0].mode || 'automatic',
      state: r.rows[0].state || 'idle',
      language: r.rows[0].language || 'uz',
      context: r.rows[0].context && typeof r.rows[0].context === 'object' ? r.rows[0].context : {},
    };
  } catch (e) {
    console.warn('[TG-AGENT] loadConversation failed:', e.message);
    return { turns: [], clarifyCount: 0, mode: 'automatic', state: 'idle', language: 'uz', context: {} };
  }
}

async function saveConversation(chatId, turns, clarifyCount) {
  try {
    await ensureTable();
    const trimmed = turns.slice(-HISTORY_TURNS);
    await pool.query(
      `INSERT INTO tg_conversations (chat_id, turns, clarify_count, updated_at)
       VALUES ($1, $2::jsonb, $3, NOW())
       ON CONFLICT (chat_id) DO UPDATE
         SET turns = $2::jsonb, clarify_count = $3, updated_at = NOW()`,
      [chatId, JSON.stringify(trimmed), clarifyCount]
    );
  } catch (e) {
    console.warn('[TG-AGENT] saveConversation failed:', e.message);
  }
}

/** Called when a topic closes, so the next question starts clean. */
async function resetClarify(chatId) {
  try {
    await ensureTable();
    await pool.query('UPDATE tg_conversations SET clarify_count = 0 WHERE chat_id = $1', [chatId]);
  } catch (_) { /* non-fatal */ }
}

function historyToText(turns) {
  if (!turns.length) return '';
  return turns.map(t => `${t.role === 'user' ? 'Foydalanuvchi' : 'AI'}: ${String(t.text).slice(0, 400)}`).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Intent
// ─────────────────────────────────────────────────────────────────────────────

// Obvious social messages are matched without an LLM call — they are a large
// share of bot traffic and should cost nothing.
// "Assalomu alaykum" is TWO words — an `assalom\w*` pattern matches the first
// and then fails on the second, sending the commonest greeting in the country
// down the paid answer path.
const GREETING_RE = /^\s*(assalomu?\s+alayku?m|assalom\w*|salom\w*|salam|(?:x|h)ayrli\s+(kun|tong|kech)|hello|hi|привет|здравствуйте)[\s!.,]*$/iu;
const THANKS_RE   = /^\s*(rahmat|raxmat|tashakkur|katta\s+rahmat|thanks|thank\s*you|спасибо)[\s!.,)]*$/iu;
const HELP_RE     = /^\s*(menga\s+)?yordam\s+(kerak|bering|qiling)(\s+iltimos)?[\s!?.]*$/iu;
const IDENTITY_RE = /(siz\s+)?(yurist|advokat)\s*(?:e?mas)?misiz|(?:siz\s+)?(yurist|advokat)\s*mi|kimsiz|kim\s+siz|o['’]?zingiz\s+kim|robotmisiz|ai\s*misiz|sun['’]?iy\s+intellektmisiz|вы\s+(юрист|адвокат)|кто\s+вы/iu;
const ATTORNEY_RE = /(advokat\s+(kerak|top|izla)|yurist\s+(kerak|top|izla)|адвокат\s+(нужен|найти)|найти\s+(адвоката|юриста))/iu;
const HUMAN_RE    = /(inson\s+bilan|jonli\s+odam|operator|real\s+yurist|yurist\s+bilan\s+gaplash|человек|оператор|юрист(ом)?\s+связ)/iu;
const DOCUMENT_RE = /(hujjat|ariza|da['’]?vo|shikoyat|shartnoma|iltimosnoma|e['’]?tiroz|претензи|иск|жалоб|договор|заявлен).*\b(tayyor|yoz|tuz|kerak|состав|подготов)/iu;
const ACCOUNT_RE  = /(ro['’]?yxat|registrat|login|kirish|parol|otp|kod\s+kelm|hisob|аккаунт|регистрац|парол|войти)/iu;

const INTENT_PROMPT = `Siz Telegram yuridik botining niyat aniqlovchi modulisiz. Foydalanuvchi xabarini tasniflang.

FAQAT JSON qaytaring:
{"intent":"...","reason":"...","missing":["..."]}

intent qiymatlari:
- "huquqiy_savol"  — javob berish uchun yetarli ma'lumot bor huquqiy savol
- "noaniq"         — huquqiy mavzu, lekin javob berish uchun muhim faktlar yetishmaydi
- "davomi"         — oldingi savolning davomi yoki so'ralgan aniqlikni bergan javob
- "salomlashuv"    — salom, rahmat, xayrlashuv kabi ijtimoiy xabar
- "bot_haqida"     — foydalanuvchi bot kimligi, AI yoki yurist ekanini so'ramoqda
- "advokat_kerak"  — mos advokat yoki yurist topishni so'ramoqda
- "hujjat_tayyorlash" — ariza, da'vo, shikoyat, shartnoma yoki boshqa hujjat tayyorlashni so'ramoqda
- "hisob_yordam"   — ro'yxatdan o'tish, login, OTP yoki parol masalasi
- "yurist_kerak"   — operator yoki jonli inson bilan gaplashishni so'ramoqda
- "mavzudan_tashqari" — huquqqa aloqasi yo'q

"missing": agar intent "noaniq" bo'lsa, javob uchun zarur bo'lgan 1-3 ta faktni yozing (o'zbekcha, qisqa). Aks holda [].
Imkon bo'lsa legal_field, legal_subfield, region va language (uz/ru) maydonlarini ham qaytaring.

Muhim: bot faqat O'zbekiston qonunchiligiga javob beradi, shuning uchun foydalanuvchidan davlatni so'ramang. Agar savol umumiy bo'lsa-yu, umumiy huquqiy javob berish mumkin bo'lsa — bu "huquqiy_savol". "noaniq" ni faqat javob berish HAQIQATAN mumkin bo'lmaganda tanlang.`;

async function classifyIntent(text, turns) {
  const t = String(text || '').trim();

  if (GREETING_RE.test(t)) return { intent: 'salomlashuv', kind: 'greeting', missing: [] };
  if (THANKS_RE.test(t))   return { intent: 'salomlashuv', kind: 'thanks',   missing: [] };
  if (IDENTITY_RE.test(t)) return { intent: 'bot_haqida', missing: [] };
  if (HELP_RE.test(t))     return { intent: 'noaniq', missing: ['Qanday huquqiy muammo yoki vaziyat bo\'yicha yordam kerak?'] };
  if (DOCUMENT_RE.test(t)) return { intent: 'hujjat_tayyorlash', missing: [] };
  if (ATTORNEY_RE.test(t)) return { intent: 'advokat_kerak', missing: [] };
  if (ACCOUNT_RE.test(t))  return { intent: 'hisob_yordam', missing: [] };
  if (HUMAN_RE.test(t))    return { intent: 'yurist_kerak', missing: [] };

  const ask = D.callCheapAI || D.callAI;
  try {
    const hist = historyToText(turns);
    const res = await ask([
      { role: 'system', text: INTENT_PROMPT },
      { role: 'user', text: (hist ? `Suhbat tarixi:\n${hist}\n\n` : '') + `Yangi xabar:\n${t.slice(0, 1500)}` },
    ], { maxTokens: 300, endpoint: '/tg-agent/intent' });

    const raw = String(res.text || '').replace(/```(?:json)?/gi, '').trim();
    const m = raw.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : {};
    const valid = ['huquqiy_savol', 'noaniq', 'davomi', 'salomlashuv', 'bot_haqida', 'advokat_kerak', 'hujjat_tayyorlash', 'hisob_yordam', 'yurist_kerak', 'mavzudan_tashqari'];
    return {
      intent: valid.includes(parsed.intent) ? parsed.intent : 'huquqiy_savol',
      missing: Array.isArray(parsed.missing) ? parsed.missing.slice(0, 3).map(String) : [],
      legalField: String(parsed.legal_field || '').slice(0, 120),
      legalSubfield: String(parsed.legal_subfield || '').slice(0, 120),
      region: String(parsed.region || '').slice(0, 120),
      language: parsed.language === 'ru' ? 'ru' : 'uz',
    };
  } catch (e) {
    console.warn('[TG-AGENT] intent classification failed, treating as legal question:', e.message);
    // Failing toward "answer it" is the right default: a missed clarification
    // costs one imperfect answer, a missed ANSWER costs the whole interaction.
    return { intent: 'huquqiy_savol', missing: [] };
  }
}

async function setConversationState(chatId, state, context) {
  try {
    await ensureTable();
    const hasContext = context !== undefined;
    await pool.query(`
      INSERT INTO tg_conversations (chat_id, state, context, updated_at)
      VALUES ($1, $2, $3::jsonb, NOW())
      ON CONFLICT (chat_id) DO UPDATE SET
        state = EXCLUDED.state,
        context = CASE WHEN $4 THEN EXCLUDED.context ELSE tg_conversations.context END,
        updated_at = NOW()
    `, [chatId, state, JSON.stringify(hasContext ? context : {}), hasContext]);
  } catch (_) { /* non-fatal */ }
}

function formatAttorneyRecommendations(attorneys) {
  if (!Array.isArray(attorneys) || !attorneys.length) return '';
  const rows = attorneys.slice(0, 5).map((attorney, index) => {
    const reasons = Array.isArray(attorney.match_reasons) ? attorney.match_reasons.join(', ') : 'soha mos keladi';
    const practice = Array.isArray(attorney.practice_areas)
      ? attorney.practice_areas.slice(0, 3).map(area => area.name_uz).filter(Boolean).join(', ')
      : '';
    return [
      `${index + 1}. *${attorney.full_name}*`,
      attorney.region ? `Hudud: ${attorney.region}` : '',
      practice ? `Yo'nalish: ${practice}` : '',
      attorney.license_number ? `Litsenziya: ${attorney.license_number} (faol)` : 'Litsenziya: faol',
      `Moslik sababi: ${reasons}`,
      attorney.source_name ? `Manba: ${attorney.source_name}` : '',
    ].filter(Boolean).join('\n');
  });
  return rows.join('\n\n');
}

function parseAttorneyChoice(text, options) {
  const value = String(text || '').trim();
  if (/^(yo['’]?q|kerak emas|bekor|rad etaman|hech qaysi|нет|отмена)[.!\s]*$/iu.test(value)) return { cancelled: true };
  const number = value.match(/(?:^|\s)([1-5])(?:\s|$|[-.)])/);
  if (!number) return null;
  const index = Number(number[1]) - 1;
  return options[index] ? { option: options[index], index } : null;
}

function detectServiceSlug(text) {
  const value = String(text || '').toLocaleLowerCase('uz');
  if (/da['’]?vo|иск/iu.test(value)) return 'claim';
  if (/shikoyat|жалоб|претензи/iu.test(value)) return 'complaint';
  if (/shartnoma|договор/iu.test(value)) return 'contract';
  if (/xulosa|заключен/iu.test(value)) return 'legal-opinion';
  if (/ariza|заявлен/iu.test(value)) return 'application';
  return 'legal-document';
}

// ─────────────────────────────────────────────────────────────────────────────
// Answer generation
// ─────────────────────────────────────────────────────────────────────────────

function formatSources(chunks, limit = 3) {
  const seen = new Set();
  const out = [];
  for (const c of chunks || []) {
    if (!c || c.is_active === false) continue;
    const law = c.law_name || '';
    if (!law) continue;
    const art = c.article_number_display
      || (Array.isArray(c.article_numbers) && c.article_numbers.length ? `${c.article_numbers[0]}-modda` : '');
    const label = [law, art].filter(Boolean).join(', ');
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c.source_url ? `• [${label}](${c.source_url})` : `• ${label}`);
    if (out.length >= limit) break;
  }
  return out.length ? `\n\n📎 *Manbalar:*\n${out.join('\n')}` : '';
}

/**
 * Produce an answer for a legal question.
 * @returns {{text, confidence:'high'|'low', sources:string, meta:object}}
 */
async function generateAnswer(question, turns) {
  // ── 1. Lawyer-verified answer bank first ────────────────────────────────
  // A human-approved answer beats anything generated, and costs one embedding.
  if (D.searchKorpus && D.embeddingApiKey) {
    try {
      const hit = await D.searchKorpus(question, { apiKey: D.embeddingApiKey });
      if (hit && hit.corrected_answer && String(hit.corrected_answer).trim().length > 40) {
        return {
          text: String(hit.corrected_answer).trim(),
          confidence: 'high',
          sources: '',
          meta: { path: 'qa-korpus', verified: true },
        };
      }
    } catch (e) {
      console.warn('[TG-AGENT] qa-korpus lookup failed:', e.message);
    }
  }

  // ── 2. Retrieval over the legal corpus ──────────────────────────────────
  let topic = null;
  try {
    if (D.classifyLegalTopic) topic = await D.classifyLegalTopic(question, { forcePick: true });
  } catch (_) { /* topic is an optimization, not a requirement */ }

  let ragContext = '', chunks = [];
  try {
    const r = await D.retrieveLegalContext(question, topic, null, {});
    ragContext = typeof r === 'string' ? r : (r.context || '');
    chunks = (r && r.chunks) || [];
  } catch (e) {
    console.warn('[TG-AGENT] retrieval failed:', e.message);
  }

  // ── 3. Generate, using the SAME prompt as the dashboard chat ────────────
  const systemPrompt = D.buildTopicPrompt
    ? D.buildTopicPrompt(topic, ragContext, question)
    : `Siz O'zbekiston qonunchiligi bo'yicha yuridik maslahatchisiz. Faqat quyidagi KONTEKSTga tayaning va modda raqamlarini o'ylab topmang.\n\nKONTEKST:\n${ragContext}`;

  const hist = historyToText(turns);
  const messages = [
    { role: 'system', text: systemPrompt + `

TELEGRAM FORMATI (majburiy):
- Javob 200 so'zdan oshmasin. Telegram — qisqa javob joyi.
- Sarlavha, markdown jadval, "###" kabi belgilar ishlatmang.
- Oddiy, tushunarli til. Har bir da'vo uchun modda raqamini ko'rsating.
- Agar KONTEKSTda javob yo'q bo'lsa — buni ochiq ayting, taxmin qilmang.` },
  ];
  if (hist) messages.push({ role: 'user', text: `Suhbat tarixi (kontekst uchun):\n${hist}` });
  messages.push({ role: 'user', text: question });

  // Same model as web chat (D.chatModel) — Telegram answers are the same
  // workload, capped even shorter, and are the platform's highest-volume
  // path, so they should not run on a more expensive tier than the dashboard.
  const res = await D.callAI(messages, {
    model: D.chatModel || undefined,
    useSearch: false, maxTokens: 900, endpoint: '/tg-agent/answer',
  });
  const text = String(res.text || '').trim();

  // ── 4. Confidence gate ──────────────────────────────────────────────────
  // Two independent failure signals: nothing retrieved, or the answer cites
  // articles that are not in what we retrieved. Either one means we cannot
  // stand behind the citation, which is the whole product promise.
  let unverified = [];
  try {
    if (D.verifyCitations) unverified = (D.verifyCitations(text, chunks) || {}).unverified || [];
  } catch (_) { /* treat as verified rather than blocking the answer */ }

  const confidence = (chunks.length === 0 || unverified.length > 0) ? 'low' : 'high';
  if (confidence === 'low') {
    console.log(`[TG-AGENT] low confidence — chunks=${chunks.length} unverified=[${unverified.join(', ')}]`);
  }

  return {
    text,
    confidence,
    sources: formatSources(chunks),
    meta: { path: 'rag', topic, chunks: chunks.length, unverified, provider: res.provider },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle one inbound Telegram message.
 *
 * Always resolves — never throws into the bot's message handler.
 *
 * @param {{chatId:number|string, text:string, firstName?:string}} input
 * @returns {Promise<{
 *   handled: boolean,          // false => bot should fall back to the human queue
 *   reply: string|null,        // message to send (Markdown)
 *   action: 'answered'|'clarify'|'greeting'|'escalate'|'offtopic'|'skip',
 *   escalate: boolean,         // create/keep a request for human review
 *   meta: object
 * }>}
 */
async function handleUserMessage({ chatId, text, firstName = '' }) {
  const skip = (reason) => ({ handled: false, reply: null, action: 'skip', escalate: true, meta: { reason } });

  if (!AUTO_ANSWER) return skip('auto-answer disabled');
  if (!isReady())   return skip('agent not initialized');
  const question = String(text || '').trim();
  if (!question)    return skip('empty message');

  const started = Date.now();
  const { turns, clarifyCount, mode, state, context } = await loadConversation(chatId);

  // Master Admin can pause automation for an individual conversation. The
  // bot still records the message in the normal request queue, but it does not
  // classify or answer on the user's behalf until automatic mode is restored.
  if (mode === 'human') {
    return {
      handled: true,
      reply: null,
      action: 'human_takeover',
      escalate: true,
      meta: { reason: 'conversation is in human takeover mode' },
    };
  }

  let intent;
  try {
    intent = await classifyIntent(question, turns);
  } catch (e) {
    console.warn('[TG-AGENT] intent failed:', e.message);
    intent = { intent: 'huquqiy_savol', missing: [] };
  }
  if (state === 'attorney_intake') intent = { ...intent, intent: 'advokat_kerak' };

  const complete = async (result) => {
    try {
      await ensureTable();
      const nextState = result.meta && result.meta.conversationState
        ? result.meta.conversationState
        : (result.action === 'clarify' ? 'clarifying' : (result.escalate ? 'awaiting_lawyer' : 'idle'));
      await pool.query(`
        INSERT INTO tg_conversations (chat_id, last_intent, language, state, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (chat_id) DO UPDATE SET
          last_intent = EXCLUDED.last_intent,
          language = EXCLUDED.language,
          state = EXCLUDED.state,
          updated_at = NOW()
      `, [chatId, intent.intent, intent.language === 'ru' ? 'ru' : 'uz', nextState]);
    } catch (e) {
      console.warn('[TG-AGENT] conversation state update failed:', e.message);
    }
    if (D && D.recordAgentEvent) {
      try {
        await D.recordAgentEvent({
          telegramChatId: chatId,
          intent: intent.intent,
          action: result.action,
          legalField: result.meta && result.meta.legalField,
          status: result.handled ? 'completed' : 'failed',
          durationMs: Date.now() - started,
          metadata: result.meta || {},
        });
      } catch (e) {
        console.warn('[TG-AGENT] event telemetry failed:', e.message);
      }
    }
    return result;
  };

  const remember = async (replyText, nextClarify = 0) => {
    await saveConversation(
      chatId,
      [...turns, { role: 'user', text: question }, { role: 'ai', text: replyText }],
      nextClarify
    );
  };

  // ── Social ──────────────────────────────────────────────────────────────
  // The initial recommendation never contains a phone. A numbered choice is
  // treated as explicit consent to reveal that one public directory contact;
  // it does not authorize sharing the user's case or identity with anyone.
  if (state === 'awaiting_attorney_choice') {
    const options = Array.isArray(context && context.attorneyOptions) ? context.attorneyOptions.slice(0, 5) : [];
    const choice = parseAttorneyChoice(question, options);
    if (choice && choice.cancelled) {
      const reply = "Tushunarli. Hech qaysi advokatning aloqa raqami ochilmadi. Keyinroq kerak bo'lsa yana yozishingiz mumkin.";
      await setConversationState(chatId, 'idle', {});
      await remember(reply, 0);
      return complete({ handled: true, reply, action: 'attorney_contact_cancelled', escalate: false, meta: { intent: 'advokat_kerak' } });
    }
    if (!choice || !choice.option) {
      const reply = options.length
        ? `Aloqa raqamini olish uchun 1 dan ${options.length} gacha bo'lgan raqamni yuboring. Masalan: *1*. Bekor qilish uchun “yo'q” deb yozing.`
        : "Advokat tanlovi eskirgan. Iltimos, qaysi yo'nalish va hudud bo'yicha advokat kerakligini qayta yozing.";
      if (!options.length) await setConversationState(chatId, 'idle', {});
      await remember(reply, 0);
      return complete({
        handled: true,
        reply,
        action: 'attorney_choice_required',
        escalate: false,
        meta: { intent: 'advokat_kerak', conversationState: options.length ? 'awaiting_attorney_choice' : 'idle' },
      });
    }

    let contact = null;
    if (D && D.getAttorneyContact) {
      try {
        contact = await D.getAttorneyContact({ telegramChatId: chatId, attorneyRef: choice.option.ref });
      } catch (error) {
        console.warn('[TG-AGENT] attorney contact lookup failed:', error.message);
      }
    }
    if (!contact || !contact.contact_phone) {
      const reply = "Tanlangan advokatning aloqa raqamini hozir rasmiy manbadan qayta tasdiqlab bo'lmadi. Murojaatingiz Master Adminga yuborildi; tekshirilgach shu yerda xabar beramiz.";
      await setConversationState(chatId, 'awaiting_lawyer', {});
      await remember(reply, 0);
      return complete({ handled: true, reply, action: 'attorney_contact_unavailable', escalate: true, meta: { intent: 'advokat_kerak', attorneyRef: choice.option.ref } });
    }

    const reply = [
      `Siz *${contact.full_name || choice.option.name}*ni tanladingiz.`,
      contact.organization_name ? `Advokatlik tuzilmasi: ${contact.organization_name}` : '',
      `Telefon: *${contact.contact_phone}*`,
      contact.source_name ? `Manba: ${contact.source_name}` : '',
      "Sizning shaxsiy ma'lumotlaringiz va murojaat matningiz advokatga yuborilmadi. JuristAI xizmat narxini belgilamaydi va narx bo'yicha muzokara olib bormaydi.",
    ].filter(Boolean).join('\n');
    await setConversationState(chatId, 'idle', {});
    await remember(reply, 0);
    return complete({ handled: true, reply, action: 'attorney_contact_shared', escalate: false, meta: { intent: 'advokat_kerak', attorneyRef: choice.option.ref } });
  }

  if (intent.intent === 'salomlashuv') {
    const reply = intent.kind === 'thanks'
      ? 'Arzimaydi! 🙌 Yana savolingiz bo\'lsa — yozing.'
      : `Assalomu alaykum${firstName ? ', ' + firstName : ''}! 👋\n\nMen JuristAI — O'zbekiston qonunchiligi bo'yicha yordamchiman.\n\nHuquqiy savolingizni yozing: vaziyatni qisqacha tushuntiring, men amaldagi qonun asosida javob beraman.`;
    await resetClarify(chatId);
    return complete({ handled: true, reply, action: 'greeting', escalate: false, meta: { intent: intent.intent } });
  }

  // Identity/capability questions are product FAQ, not legal questions. They
  // must never enter RAG or acquire unrelated statute citations.
  if (intent.intent === 'bot_haqida') {
    const reply = "Men inson yurist yoki advokat emasman. Men JuristAI — O'zbekiston qonunchiligi bo'yicha ma'lumot beruvchi AI yordamchiman.\n\nQonunchilik manbalari asosida tushuntirish beraman, lekin sudda vakillik qilmayman va javobim rasmiy yuridik xulosa hisoblanmaydi. Huquqiy vaziyatingizni yozsangiz, qaysi yo'l tutish mumkinligini tushuntiraman.";
    await remember(reply, clarifyCount);
    return complete({ handled: true, reply, action: 'identity', escalate: false, meta: { intent: intent.intent } });
  }

  // ── Account and authentication support ─────────────────────────────────
  if (intent.intent === 'hisob_yordam') {
    const reply = "Ro'yxatdan o'tish, kirish, OTP va parolni tiklash uchun @juristAI_registration_bot yordam beradi.\n\nBotni ochib, kerakli amalni tanlang. Bu bot esa faqat huquqiy savollar uchun ishlaydi.";
    await remember(reply, 0);
    return complete({ handled: true, reply, action: 'account_help', escalate: false, meta: { intent: intent.intent } });
  }

  // ── Paid document preparation ──────────────────────────────────────────
  if (intent.intent === 'hujjat_tayyorlash') {
    const serviceSlug = detectServiceSlug(question);
    const reply = "Hujjat tayyorlash JuristAI'da pullik xizmat hisoblanadi. Buyurtma faqat mas'ul yurist ko'rib chiqib, ruxsat berganidan keyin ishga olinadi.\n\nHozircha murojaatingizni yurist tekshiruviga yuboraman. Narx va bajarish shartlari tasdiqlangach sizga alohida xabar beriladi.";
    await remember(reply, 0);
    return complete({
      handled: true,
      reply,
      action: 'paid_service',
      escalate: true,
      meta: { intent: intent.intent, serviceSlug, paidService: true, requiresLawyerApproval: true },
    });
  }

  // ── Verified attorney matching ─────────────────────────────────────────
  if (intent.intent === 'advokat_kerak') {
    let legalField = intent.legalField || '';
    if (!legalField && D.classifyLegalTopic) {
      try { legalField = String(await D.classifyLegalTopic(question, { forcePick: true }) || ''); } catch (_) { /* optional */ }
    }

    let attorneys = [];
    if (D.findAttorneys) {
      try {
        attorneys = await D.findAttorneys({
          query: question,
          legalField,
          legalSubfield: intent.legalSubfield || '',
          region: intent.region || '',
          language: intent.language || 'uz',
          limit: 5,
        });
      } catch (e) {
        console.warn('[TG-AGENT] attorney matching failed:', e.message);
      }
    }

    if (attorneys.length) {
      const attorneyOptions = attorneys.slice(0, 5).map((item, index) => ({
        index: index + 1,
        ref: item.contact_ref || `local:${item.id}`,
        name: item.full_name,
        organization: item.organization_name || '',
      }));
      const reply = `Sizning murojaatingizga mos, litsenziyasi tasdiqlangan advokatlar:\n\n${formatAttorneyRecommendations(attorneys)}\n\nTelefon raqamlari tanlovingizgacha yopiq saqlanadi. Bog'lanmoqchi bo'lgan advokat raqamini yuboring: masalan, *1*.\n\nJuristAI advokat xizmatining narxini belgilamaydi va narx bo'yicha muzokara olib bormaydi. Xizmat shartlari advokat bilan alohida kelishiladi.`;
      await remember(reply, 0);
      await setConversationState(chatId, 'awaiting_attorney_choice', { attorneyOptions });
      return complete({
        handled: true,
        reply,
        action: 'attorney_matches',
        escalate: false,
        meta: {
          intent: intent.intent,
          legalField,
          attorneyIds: attorneys.map(item => item.id),
          attorneyRefs: attorneyOptions.map(item => item.ref),
          conversationState: 'awaiting_attorney_choice',
        },
      });
    }

    const reply = "Hozircha ushbu yo'nalish bo'yicha tasdiqlangan mos advokat topilmadi. Murojaatingiz Master Adminga yuborildi — mos mutaxassis topilganda shu yerda xabar beramiz.\n\nJuristAI advokat xizmatlari narxini belgilamaydi va narx bo'yicha muzokara olib bormaydi.";
    await remember(reply, 0);
    await setConversationState(chatId, 'idle');
    return complete({
      handled: true,
      reply,
      action: 'attorney_request',
      escalate: true,
      meta: { intent: intent.intent, legalField, attorneyIds: [] },
    });
  }

  // ── Wants a human ───────────────────────────────────────────────────────
  if (intent.intent === 'yurist_kerak') {
    return complete({
      handled: true,
      reply: '👨‍⚖️ Tushunarli — murojaatingiz yuristga yuborildi.\n\nMutaxassis ko\'rib chiqib, shu yerda javob beradi. Kutib turing.',
      action: 'escalate',
      escalate: true,
      meta: { intent: intent.intent },
    });
  }

  // ── Off-topic ───────────────────────────────────────────────────────────
  if (intent.intent === 'mavzudan_tashqari') {
    const reply = 'Men faqat O\'zbekiston qonunchiligi bo\'yicha yordam bera olaman. 🙏\n\nHuquqiy savolingiz bo\'lsa — bemalol yozing.';
    await remember(reply, clarifyCount);
    return complete({ handled: true, reply, action: 'offtopic', escalate: false, meta: { intent: intent.intent } });
  }

  // ── Too vague → ask ONE targeted question, but never loop forever ───────
  if (intent.intent === 'noaniq' && intent.missing.length && clarifyCount < MAX_CLARIFY) {
    const asks = intent.missing.map((m, i) => `${i + 1}. ${m}`).join('\n');
    const reply = `Savolingizga aniq javob berishim uchun quyidagilarni bilishim kerak:\n\n${asks}\n\nShularni yozib yuboring — keyin qonun asosida javob beraman.`;
    await remember(reply, clarifyCount + 1);
    return complete({ handled: true, reply, action: 'clarify', escalate: false, meta: { intent: intent.intent, missing: intent.missing } });
  }

  // ── Answer ──────────────────────────────────────────────────────────────
  const quota = D.claimDailyAnswer
    ? await D.claimDailyAnswer(chatId, DAILY_AI_LIMIT)
    : await claimDailyAiAnswer(chatId);

  if (!quota.allowed) {
    const reply = quota.unavailable
      ? "Kunlik bepul AI javob limitini hozir tekshirib bo'lmadi. Iltimos, birozdan keyin qayta urinib ko'ring."
      : `Bugungi ${quota.limit} ta bepul AI huquqiy javob limitingiz tugadi. Yangi limit ertaga Toshkent vaqti bilan ochiladi.\n\nShoshilinch holatda “yurist kerak” deb yozishingiz mumkin.`;
    return complete({
      handled: true,
      reply,
      action: quota.unavailable ? 'quota_unavailable' : 'quota_exceeded',
      escalate: false,
      meta: { intent: intent.intent, dailyLimit: quota.limit, remainingDailyAnswers: 0 },
    });
  }

  let answer;
  try {
    answer = await generateAnswer(question, turns);
  } catch (e) {
    if (D.releaseDailyAnswer) await D.releaseDailyAnswer(chatId).catch(() => {});
    else await releaseDailyAiAnswer(chatId);
    console.error('[TG-AGENT] answer generation failed:', e.message);
    return skip('generation failed: ' + e.message);
  }

  if (!answer.text || answer.text.length < 20) {
    if (D.releaseDailyAnswer) await D.releaseDailyAnswer(chatId).catch(() => {});
    else await releaseDailyAiAnswer(chatId);
    return skip('empty answer');
  }

  const lowConfidence = answer.confidence === 'low' && ESCALATE_WEAK;

  // A low-confidence answer is still shown — with an honest banner — because
  // silence helps nobody. What changes is that it is labelled as preliminary
  // and a human is put on it.
  const banner = lowConfidence
    ? '\n\n⚠️ _Bu dastlabki javob: ba\'zi normalarni tekshirilgan manbalardan tasdiqlay olmadim. Yurist ko\'rib chiqib, aniqlashtiradi._'
    : '';

  const allowance = quota.remaining > 0
    ? `\n\n🎟 Bugun yana ${quota.remaining} ta bepul AI javob qolgan.`
    : `\n\n🎟 Bugungi ${quota.limit} ta bepul AI javobdan foydalandingiz. Yangi limit ertaga Toshkent vaqti bilan ochiladi.`;
  const reply = answer.text + answer.sources + banner + DISCLAIMER + allowance;

  await remember(answer.text, 0);
  console.log(`[TG-AGENT] chat=${chatId} intent=${intent.intent} path=${answer.meta.path} conf=${answer.confidence} ${Date.now() - started}ms`);

  return complete({
    handled: true,
    reply,
    action: 'answered',
    escalate: lowConfidence,
    meta: {
      intent: intent.intent,
      ...answer.meta,
      confidence: answer.confidence,
      dailyLimit: quota.limit,
      remainingDailyAnswers: quota.remaining,
      ms: Date.now() - started,
    },
  });
}

/** Split a reply that exceeds Telegram's message limit, preferring paragraph breaks. */
function splitForTelegram(text, limit = TG_LIMIT) {
  const s = String(text || '');
  if (s.length <= limit) return [s];
  const parts = [];
  let rest = s;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit * 0.5) cut = limit;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

module.exports = {
  initTelegramAgent,
  handleUserMessage,
  splitForTelegram,
  isReady,
  // exported for tests
  classifyIntent,
  formatSources,
  formatAttorneyRecommendations,
  detectServiceSlug,
  loadConversation,
  saveConversation,
  setConversationState,
  claimDailyAiAnswer,
  releaseDailyAiAnswer,
  DAILY_AI_LIMIT,
};
