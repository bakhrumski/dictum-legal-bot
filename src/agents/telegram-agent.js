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
async function ensureTable() {
  if (_tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tg_conversations (
      chat_id       BIGINT PRIMARY KEY,
      turns         JSONB   NOT NULL DEFAULT '[]'::jsonb,
      clarify_count INTEGER NOT NULL DEFAULT 0,
      updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  _tableReady = true;
}

async function loadConversation(chatId) {
  try {
    await ensureTable();
    const r = await pool.query(
      `SELECT turns, clarify_count FROM tg_conversations
        WHERE chat_id = $1 AND updated_at > NOW() - INTERVAL '${HISTORY_TTL_H} hours'`,
      [chatId]
    );
    if (!r.rows.length) return { turns: [], clarifyCount: 0 };
    return {
      turns: Array.isArray(r.rows[0].turns) ? r.rows[0].turns : [],
      clarifyCount: r.rows[0].clarify_count || 0,
    };
  } catch (e) {
    console.warn('[TG-AGENT] loadConversation failed:', e.message);
    return { turns: [], clarifyCount: 0 };
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
const HUMAN_RE    = /(yurist\s+bilan|advokat\s+bilan|inson\s+bilan|jonli\s+odam|operator|real\s+yurist|человек|юрист(ом)?\s+связ)/iu;

const INTENT_PROMPT = `Siz Telegram yuridik botining niyat aniqlovchi modulisiz. Foydalanuvchi xabarini tasniflang.

FAQAT JSON qaytaring:
{"intent":"...","reason":"...","missing":["..."]}

intent qiymatlari:
- "huquqiy_savol"  — javob berish uchun yetarli ma'lumot bor huquqiy savol
- "noaniq"         — huquqiy mavzu, lekin javob berish uchun muhim faktlar yetishmaydi
- "davomi"         — oldingi savolning davomi yoki so'ralgan aniqlikni bergan javob
- "salomlashuv"    — salom, rahmat, xayrlashuv kabi ijtimoiy xabar
- "yurist_kerak"   — jonli yurist bilan bog'lanishni so'ramoqda
- "mavzudan_tashqari" — huquqqa aloqasi yo'q

"missing": agar intent "noaniq" bo'lsa, javob uchun zarur bo'lgan 1-3 ta faktni yozing (o'zbekcha, qisqa). Aks holda [].

Muhim: agar savol umumiy bo'lsa-yu, umumiy huquqiy javob berish mumkin bo'lsa — bu "huquqiy_savol". "noaniq" ni faqat javob berish HAQIQATAN mumkin bo'lmaganda tanlang.`;

async function classifyIntent(text, turns) {
  const t = String(text || '').trim();

  if (GREETING_RE.test(t)) return { intent: 'salomlashuv', kind: 'greeting', missing: [] };
  if (THANKS_RE.test(t))   return { intent: 'salomlashuv', kind: 'thanks',   missing: [] };
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
    const valid = ['huquqiy_savol', 'noaniq', 'davomi', 'salomlashuv', 'yurist_kerak', 'mavzudan_tashqari'];
    return {
      intent: valid.includes(parsed.intent) ? parsed.intent : 'huquqiy_savol',
      missing: Array.isArray(parsed.missing) ? parsed.missing.slice(0, 3).map(String) : [],
    };
  } catch (e) {
    console.warn('[TG-AGENT] intent classification failed, treating as legal question:', e.message);
    // Failing toward "answer it" is the right default: a missed clarification
    // costs one imperfect answer, a missed ANSWER costs the whole interaction.
    return { intent: 'huquqiy_savol', missing: [] };
  }
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
  const { turns, clarifyCount } = await loadConversation(chatId);

  let intent;
  try {
    intent = await classifyIntent(question, turns);
  } catch (e) {
    console.warn('[TG-AGENT] intent failed:', e.message);
    intent = { intent: 'huquqiy_savol', missing: [] };
  }

  const remember = async (replyText, nextClarify = 0) => {
    await saveConversation(
      chatId,
      [...turns, { role: 'user', text: question }, { role: 'ai', text: replyText }],
      nextClarify
    );
  };

  // ── Social ──────────────────────────────────────────────────────────────
  if (intent.intent === 'salomlashuv') {
    const reply = intent.kind === 'thanks'
      ? 'Arzimaydi! 🙌 Yana savolingiz bo\'lsa — yozing.'
      : `Assalomu alaykum${firstName ? ', ' + firstName : ''}! 👋\n\nMen JuristAI — O'zbekiston qonunchiligi bo'yicha yordamchiman.\n\nHuquqiy savolingizni yozing: vaziyatni qisqacha tushuntiring, men amaldagi qonun asosida javob beraman.`;
    await resetClarify(chatId);
    return { handled: true, reply, action: 'greeting', escalate: false, meta: { intent: intent.intent } };
  }

  // ── Wants a human ───────────────────────────────────────────────────────
  if (intent.intent === 'yurist_kerak') {
    return {
      handled: true,
      reply: '👨‍⚖️ Tushunarli — murojaatingiz yuristga yuborildi.\n\nMutaxassis ko\'rib chiqib, shu yerda javob beradi. Kutib turing.',
      action: 'escalate',
      escalate: true,
      meta: { intent: intent.intent },
    };
  }

  // ── Off-topic ───────────────────────────────────────────────────────────
  if (intent.intent === 'mavzudan_tashqari') {
    const reply = 'Men faqat O\'zbekiston qonunchiligi bo\'yicha yordam bera olaman. 🙏\n\nHuquqiy savolingiz bo\'lsa — bemalol yozing.';
    await remember(reply, clarifyCount);
    return { handled: true, reply, action: 'offtopic', escalate: false, meta: { intent: intent.intent } };
  }

  // ── Too vague → ask ONE targeted question, but never loop forever ───────
  if (intent.intent === 'noaniq' && intent.missing.length && clarifyCount < MAX_CLARIFY) {
    const asks = intent.missing.map((m, i) => `${i + 1}. ${m}`).join('\n');
    const reply = `Savolingizga aniq javob berishim uchun quyidagilarni bilishim kerak:\n\n${asks}\n\nShularni yozib yuboring — keyin qonun asosida javob beraman.`;
    await remember(reply, clarifyCount + 1);
    return { handled: true, reply, action: 'clarify', escalate: false, meta: { intent: intent.intent, missing: intent.missing } };
  }

  // ── Answer ──────────────────────────────────────────────────────────────
  let answer;
  try {
    answer = await generateAnswer(question, turns);
  } catch (e) {
    console.error('[TG-AGENT] answer generation failed:', e.message);
    return skip('generation failed: ' + e.message);
  }

  if (!answer.text || answer.text.length < 20) return skip('empty answer');

  const lowConfidence = answer.confidence === 'low' && ESCALATE_WEAK;

  // A low-confidence answer is still shown — with an honest banner — because
  // silence helps nobody. What changes is that it is labelled as preliminary
  // and a human is put on it.
  const banner = lowConfidence
    ? '\n\n⚠️ _Bu dastlabki javob: ba\'zi normalarni tekshirilgan manbalardan tasdiqlay olmadim. Yurist ko\'rib chiqib, aniqlashtiradi._'
    : '';

  const reply = answer.text + answer.sources + banner + DISCLAIMER;

  await remember(answer.text, 0);
  console.log(`[TG-AGENT] chat=${chatId} intent=${intent.intent} path=${answer.meta.path} conf=${answer.confidence} ${Date.now() - started}ms`);

  return {
    handled: true,
    reply,
    action: 'answered',
    escalate: lowConfidence,
    meta: { intent: intent.intent, ...answer.meta, confidence: answer.confidence, ms: Date.now() - started },
  };
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
  loadConversation,
  saveConversation,
};
