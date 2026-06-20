'use strict';

const log = require('../utils/logger').createLogger('PORTAL');

/**
 * Portal AI Services — interfaces with RAG, LLM providers, and agent workflows
 *
 * Architecture:
 *   User query → retrieveLegalContext() → callAI() → stream/return
 *                     ↓ (parallel)
 *              textOnlySearch() fallback
 *
 * Providers (auto-fallback):
 *   1. Gemini 2.0 Flash (free, Google Search grounding)
 *   2. Groq / Llama 3.3 70B (free, fast)
 *   3. OpenAI GPT-4o (paid fallback)
 */

const { pool } = require('../database/db');
const { normalizeResponseForUser } = require('../rag/prim-notation');
const { getChunkArticleRefs } = require('../rag/citation-utils');
const { getDefinitionPromptAddendum, getTermExplanationRule } = require('../rag/query-intent');
const { screenAnswer } = require('../rag/answer-verification');

// ════════════════════════════════════════
// LEGAL CHAT SERVICE
// ════════════════════════════════════════

const LEGAL_TOPICS = {
  konstitutsiya:       'Konstitutsiyaviy tuzum',
  'davlat-boshqaruvi': 'Davlat boshqaruvi',
  fuqarolik:           'Fuqarolik qonunchiligi',
  oila:                'Oila qonunchiligi',
  mehnat:              "Mehnat va aholining bandligi",
  ijtimoiy:            "Ijtimoiy ta'minot va ijtimoiy himoya",
  moliya:              "Moliya va kredit",
  soliq:               "Soliq qonunchiligi",
  bank:                "Bank faoliyati",
  'uy-joy':            "Uy-joy qonunchiligi. Kommunal xo'jalik",
  tadbirkorlik:        "Tadbirkorlik va xo'jalik faoliyati",
  'tashqi-iqtisod':    "Tashqi iqtisodiy faoliyat. Bojxona ishi",
  ekologiya:           "Atrof tabiiy muhit va tabiiy resurslar",
  axborot:             "Axborot va axborotlashtirish",
  talim:               "Ta'lim. Fan. Madaniyat",
  soglik:              "Sog'liqni saqlash. Sport. Turizm",
  mudofaa:             'Mudofaa',
  jinoyat:             'Jinoyat qonunchiligi',
  mamuriy:             "Ma'muriy javobgarlik",
  sudlov:              'Odil sudlov',
  adliya:              'Prokuratura. Advokatura. Notariat. Adliya organlari',
  xalqaro:             'Xalqaro munosabatlar. Xalqaro huquq',
  shaxsiy:             "Shaxsiy tusdagi hujjatlar",
};

/**
 * Process a legal chat message with RAG + AI
 *
 * @param {object} opts
 * @param {string} opts.message     - user message
 * @param {string} opts.topic       - legal topic key
 * @param {number} opts.conversationId - conversation ID
 * @param {number} opts.userId      - user ID
 * @param {object[]} opts.history   - prior messages [{role, content}]
 * @param {function} opts.onChunk   - SSE chunk callback (optional, for streaming)
 * @returns {Promise<{reply: string, sources: object[], model: string, tokens: number, duration: number}>}
 */
async function processLegalChat(opts) {
  const { message, topic, conversationId, userId, history = [], onChunk } = opts;
  const startTime = Date.now();

  // Lazy-load from main server's callAI (shared infrastructure)
  let callAI, retrieveLegalContext, buildTopicPrompt;
  try {
    // These functions are exported from the main server module
    const serverModule = require('../api/server');
    // If server doesn't export these, we use our own lightweight versions below
    callAI = serverModule.callAI;
    retrieveLegalContext = serverModule.retrieveLegalContext;
  } catch {
    // Fallback: call Groq directly if server module not available
    callAI = callGroqDirect;
  }

  // RAG retrieval
  let ragContext = '';
  let retrievedChunks = [];
  try {
    if (typeof retrieveLegalContext === 'function') {
      const ragResult = await retrieveLegalContext(message, topic || null, 'uz');
      retrievedChunks = Array.isArray(ragResult?.chunks) ? ragResult.chunks : [];

      if (ragResult?.context) {
        ragContext = ragResult.context;
      } else if (retrievedChunks.length > 0) {
        ragContext = retrievedChunks.map((r, i) => {
          const arts = getChunkArticleRefs(r).join(', ');
          const badge = r.source_type === 'verified_qa' ? ' [TASDIQLANGAN]' : '';
          return `[${i + 1}] ${r.law_name}${badge}${arts ? ` (${arts}-moddalar)` : ''}\n${r.chunk_text}`;
        }).join('\n\n');
      }
    } else {
      const { hybridSearch, textOnlySearch } = require('../rag/legal-corpus');
      const apiKey = process.env.GEMINI_API_KEY || process.env.GPT_API_KEY;

      if (apiKey) {
        try {
          retrievedChunks = await hybridSearch(message, { category: topic, limit: 6, apiKey });
        } catch { /* fall through to text-only */ }
      }
      if (!retrievedChunks || retrievedChunks.length === 0) {
        retrievedChunks = await textOnlySearch(message, { category: topic, limit: 6 });
      }

      if (retrievedChunks && retrievedChunks.length > 0) {
        ragContext = retrievedChunks.map((r, i) => {
          const arts = getChunkArticleRefs(r).join(', ');
          const badge = r.source_type === 'verified_qa' ? ' [TASDIQLANGAN]' : '';
          return `[${i + 1}] ${r.law_name}${badge}${arts ? ` (${arts}-moddalar)` : ''}\n${r.chunk_text}`;
        }).join('\n\n');
      }
    }
    log.debug('RAG retrieval done', { chunks: retrievedChunks.length, topic });
  } catch (ragErr) {
    log.warn('RAG retrieval failed', { err: ragErr.message });
  }

  // Build system prompt
  const topicLabel = LEGAL_TOPICS[topic] || topic || 'Umumiy huquq';
  const systemPrompt = buildLegalSystemPrompt(topicLabel, ragContext, message);

  // Build messages array
  const aiMessages = [{ role: 'system', text: systemPrompt }];
  if (history.length > 0) {
    const recent = history.slice(-20);
    recent.forEach(m => {
      aiMessages.push({ role: m.role === 'assistant' ? 'model' : 'user', text: m.content });
    });
  }
  aiMessages.push({ role: 'user', text: message });

  // Call AI (streaming if onChunk provided)
  let result;
  if (onChunk && typeof callGroqStreaming === 'function') {
    result = await callGroqStreaming(aiMessages, { maxTokens: 8192 }, onChunk);
  } else {
    result = await callAI(aiMessages, { useSearch: true, maxTokens: 8192 });
  }

  // Screen every cited document (in-corpus + ungrounded) against lex.uz
  // "kuchini yo'qotgan" status. This catches decrees the LLM cited from
  // training memory that were never ingested (e.g. repealed PQ-3126).
  const screened = await screenAnswer(result.text, { pool });
  result.text = screened.text;

  const duration = Date.now() - startTime;
  const sources = extractSources(retrievedChunks);

  // Store messages in DB
  let messageId = null;
  if (conversationId) {
    try {
      await pool.query(
        `INSERT INTO portal_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
        [conversationId, message]
      );
      const msgInsert = await pool.query(
        `INSERT INTO portal_messages (conversation_id, role, content, model_used, duration_ms, sources)
         VALUES ($1, 'assistant', $2, $3, $4, $5) RETURNING id`,
        [conversationId, result.text, result.provider || 'unknown', duration, JSON.stringify(sources)]
      );
      messageId = msgInsert.rows[0]?.id;
      await pool.query(
        `UPDATE portal_conversations SET message_count = message_count + 2, updated_at = NOW() WHERE id = $1`,
        [conversationId]
      );
    } catch (dbErr) {
      log.error('Message save failed', { err: dbErr.message, conversationId });
    }
  }

  log.info('chat complete', { topic, model: result.provider, durationMs: duration, sources: sources.length });

  return {
    reply: normalizeResponseForUser(result.text),
    sources,
    model: result.provider || 'unknown',
    tokens: result.outTokens || 0,
    duration,
    messageId,
    verification: {
      expired: screened.verification.expired.map(e => e.raw),
      unverified: screened.verification.unverified.map(u => u.raw),
    },
  };
}

/**
 * Deduplicate and shape RAG chunks into client-facing source objects.
 */
function extractSources(chunks = []) {
  const seen = new Set();
  const sources = [];
  for (const chunk of chunks) {
    const key = chunk.doc_id || chunk.law_name || '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    sources.push({
      doc_id: chunk.doc_id || null,
      law_name: chunk.law_name || null,
      source_url: chunk.source_url || null,
      article_refs: getChunkArticleRefs(chunk),
      source_type: chunk.source_type || 'law',
    });
  }
  return sources;
}

function buildLegalSystemPrompt(topicLabel, ragContext, userQuestion = '') {
  const definitionPromptAddendum = getDefinitionPromptAddendum(userQuestion);
  const termExplanationRule = getTermExplanationRule(userQuestion);

  return `Siz O'zbekiston ${topicLabel} bo'yicha YUQORI MALAKALI yuridik maslahatchi AI siz.

QATTIQ QOIDALAR:
1. Javob FAQAT O'zbek (lotin) tilida
2. Modda raqamlarini FAQAT 100% ishonchli bo'lsangiz keltiring
3. To'qib chiqarishdan QATTIYAN SAQLANING
4. Har bir huquqiy tasdiq uchun MANBA ko'rsating: qonun nomi, QABUL QILINGAN SANASI, modda va QISM raqami
5. Javob chuqur va to'liq bo'lsin
6. MODDA RAQAMLARINI TO'G'RI YOZING: O'zbekiston qonunchiligida prim (qo'shimcha) moddalar mavjud. Ularni AYNAN "N-modda prim M" shaklida yozing. Masalan: "4-modda prim 1" (to'rt modda prim bir), "3-modda prim 1", "12-modda prim 2". Bu "41-modda", "4-modda" yoki "4¹-modda" EMAS. Superskript (¹²³) ishlatish MAN ETILGAN — faqat "prim" so'zi bilan yozing
7. HUJJAT RAQAMLARI: Har qanday PF-XXXX, PQ-XXXX, VM-XXXX raqamini FAQAT quyidagi KONTEKSTDA ko'rsangiz yozing. O'quv ma'lumotlaringizda eslaydigan raqamni HECH QACHON ishlatmang — u KUCHINI YO'QOTGAN yoki o'zgartirilgan bo'lishi mumkin. Agar kontekstda tegishli hujjat yo'q bo'lsa: "Ushbu hujjat ma'lumotlar bazamizda topilmadi. Lex.uz orqali qidirishni tavsiya etamiz" deng.
${ragContext ? '8. Quyidagi QONUNCHILIK KONTEKSTIGA BIRINCHI NAVBATDA tayanib javob bering' : ''}

JAVOB TUZILMASI:

Savolni avval tahlil qiling: bu NAZARIY savol yoki AMALIY savol?

${definitionPromptAddendum}

## Huquqiy asos
Tegishli qonun(lar) — har birini shu formatda keltiring:
- Qonun nomi, qabul qilingan sanasi va raqami
- ANIQ modda va QISM raqami (masalan: "4-modda prim 1, 1 va 2-qismlar"). Prim moddalarni AYNAN shu shaklda yozing — superskript emas!
- Har bir moddaning ANIQ mazmunini chuqur tushuntiring. Bu asosiy javob.

## Muddatlar va jarimalar
FAQAT qonunda ANIQ SON bor bo'lsagina yozing (masalan: "30 kun", "5 BHM jarima"). Aniq raqam yo'q bo'lsa — bu bo'limni UMUMAN YOZMANG, hatto "raqam mavjud emas" deb ham yozmang.

## Yuridik maslahat
Maksimum 2-3 ta QISQA punkt, har biri 1-2 jumla. FAQAT YANGI ma'lumot: murojaat joyi, kerakli hujjatlar, kam ma'lum mexanizmlar.

TAQIQLAR:
- "Holat tahlili", "Amaliy qadamlar", "Maslahat" bo'limlarini YOZMANG
- Huquqiy asos bo'limida AYTILGAN ma'lumotni qayta yozmang va boshqa so'zlar bilan takrorlamang
- "Qonunchilikni kuzating", "Yuristga murojaat qiling", "Xabardor bo'ling", "Huquqlaringizni biling" YOZMANG
${termExplanationRule}

${ragContext ? `\nQONUNCHILIK KONTEKSTI:\n${ragContext}\n` : ''}
> Bu javob AI tahlili asosida. Muhim qarorlar uchun litsenziyalangan yuristga murojaat qiling.`;
}

// ════════════════════════════════════════
// DIRECT GROQ CALL (standalone fallback)
// ════════════════════════════════════════

async function callGroqDirect(messages, options = {}) {
  const { temperature = 0.2, maxTokens = 8192 } = options;
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  // Try Groq first
  if (groqKey) {
    const input = messages.map(m => ({
      role: m.role === 'model' ? 'assistant' : m.role,
      content: m.text
    }));

    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: input, temperature, max_tokens: maxTokens })
    });

    if (resp.ok) {
      const data = await resp.json();
      return { text: data.choices?.[0]?.message?.content || '', provider: 'Groq/Llama' };
    }
  }

  // Fallback: Gemini
  if (geminiKey) {
    let systemInstruction = null;
    const chatMessages = [];
    for (const m of messages) {
      if (m.role === 'system') {
        systemInstruction = { parts: [{ text: m.text }] };
      } else {
        chatMessages.push({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text }] });
      }
    }

    const body = {
      contents: chatMessages,
      generationConfig: { temperature, maxOutputTokens: maxTokens }
    };
    if (systemInstruction) body.systemInstruction = systemInstruction;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (resp.ok) {
      const data = await resp.json();
      const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
      return { text, provider: 'Gemini' };
    }
  }

  throw new Error('Barcha AI provayderlar ishlamayapti');
}

// ════════════════════════════════════════
// GROQ STREAMING (SSE)
// ════════════════════════════════════════

async function callGroqStreaming(messages, options = {}, onChunk) {
  const { temperature = 0.2, maxTokens = 8192 } = options;
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) throw new Error('GROQ_API_KEY kerak (streaming uchun)');

  const input = messages.map(m => ({
    role: m.role === 'model' ? 'assistant' : m.role,
    content: m.text
  }));

  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: input,
      temperature,
      max_tokens: maxTokens,
      stream: true
    })
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    throw new Error(`Groq streaming ${resp.status}: ${err.substring(0, 200)}`);
  }

  let fullText = '';
  const reader = resp.body;

  // Parse SSE stream
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of reader) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content || '';
        if (delta) {
          fullText += delta;
          if (onChunk) onChunk(delta);
        }
      } catch { /* skip malformed chunks */ }
    }
  }

  return { text: fullText, provider: 'Groq/Llama (stream)' };
}

// ════════════════════════════════════════
// DOCUMENT ANALYSIS SERVICE
// ════════════════════════════════════════

async function analyzeDocument(docId) {
  const doc = await pool.query('SELECT * FROM portal_documents WHERE id = $1', [docId]);
  if (doc.rows.length === 0) throw new Error('Hujjat topilmadi');

  const document = doc.rows[0];
  if (!document.extracted_text) throw new Error('Hujjat matni ajratilmagan');

  await pool.query(
    `UPDATE portal_documents SET analysis_status = 'processing' WHERE id = $1`,
    [docId]
  );

  try {
    const prompt = `Siz yuridik hujjat tahlilchisisiz. Quyidagi hujjatni tahlil qiling:

HUJJAT MATNI:
${document.extracted_text.substring(0, 8000)}

TAHLIL QILING:
1. Hujjat turi (shartnoma, ariza, qaror, va h.k.)
2. Asosiy tomonlar (kim bilan kim o'rtasida)
3. Muhim sanalar va muddatlar
4. Asosiy shartlar va majburiyatlar
5. Potensial huquqiy xavflar
6. Tavsiyalar

Javob JSON formatda bering.`;

    const result = await callGroqDirect(
      [{ role: 'system', text: 'Siz yuridik hujjat tahlilchisisiz. JSON formatda javob bering.' },
       { role: 'user', text: prompt }],
      { temperature: 0.1, maxTokens: 4096 }
    );

    let analysis;
    try {
      // Try to parse JSON from response
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw_analysis: result.text };
    } catch {
      analysis = { raw_analysis: result.text };
    }

    await pool.query(
      `UPDATE portal_documents SET analysis_result = $1, analysis_status = 'completed', category = $2 WHERE id = $3`,
      [JSON.stringify(analysis), analysis.document_type || null, docId]
    );

    return analysis;
  } catch (err) {
    await pool.query(
      `UPDATE portal_documents SET analysis_status = 'failed' WHERE id = $1`,
      [docId]
    );
    throw err;
  }
}

// ════════════════════════════════════════
// AGENTIC WORKFLOW SERVICE
// ════════════════════════════════════════

const AGENT_TASK_TYPES = {
  'draft-nda': {
    name: 'NDA loyihasi',
    steps: ['Ma\'lumot yig\'ish', 'Qonun bazasidan qidiruv', 'Loyiha tuzish', 'Tekshirish'],
    systemPrompt: `Siz NDA (Maxfiylik shartnomasi) tuzuvchi AI yuristsiz. O'zbekiston qonunchiligi asosida professional NDA loyihasini tayyorlang.`
  },
  'compliance-review': {
    name: 'Muvofiqlik tekshiruvi',
    steps: ['Hujjat tahlili', 'Qonunchilik solishtirish', 'Xavflar aniqlash', 'Hisobot tayyorlash'],
    systemPrompt: `Siz compliance (muvofiqlik) mutaxassisi AI siz. Berilgan hujjat yoki jarayonni O'zbekiston qonunchiligiga muvofiqligini tekshiring.`
  },
  'contract-review': {
    name: 'Shartnoma tekshiruvi',
    steps: ['Shartnoma tahlili', 'Shartlar tekshiruvi', 'Xavflar baholash', 'Tavsiyalar'],
    systemPrompt: `Siz shartnoma tahlilchisi AI siz. Berilgan shartnomani O'zbekiston qonunchiligi nuqtai nazaridan tekshiring.`
  },
  'legal-memo': {
    name: 'Huquqiy xulosa',
    steps: ['Savol tahlili', 'Qonun bazasidan qidiruv', 'Xulosa yozish', 'Manbalar kiritish'],
    systemPrompt: `Siz professional yuridik memo (xulosa) yozuvchi AI siz. O'zbekiston qonunchiligi asosida to'liq huquqiy xulosa tayyorlang.`
  }
};

async function createAgentTask(userId, taskType, input, conversationId = null) {
  const taskDef = AGENT_TASK_TYPES[taskType];
  if (!taskDef) throw new Error(`Noma'lum vazifa turi: ${taskType}`);

  const result = await pool.query(`
    INSERT INTO portal_agent_tasks (user_id, conversation_id, task_type, task_input, total_steps, steps)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `, [
    userId, conversationId, taskType, JSON.stringify(input),
    taskDef.steps.length,
    JSON.stringify(taskDef.steps.map((s, i) => ({ step: i + 1, name: s, status: 'pending' })))
  ]);

  return result.rows[0].id;
}

async function executeAgentTask(taskId, onProgress) {
  const taskResult = await pool.query('SELECT * FROM portal_agent_tasks WHERE id = $1', [taskId]);
  if (taskResult.rows.length === 0) throw new Error('Vazifa topilmadi');

  const task = taskResult.rows[0];
  const taskDef = AGENT_TASK_TYPES[task.task_type];
  if (!taskDef) throw new Error('Noma\'lum vazifa turi');

  await pool.query(
    `UPDATE portal_agent_tasks SET status = 'running', started_at = NOW() WHERE id = $1`,
    [taskId]
  );

  const startTime = Date.now();
  let steps = JSON.parse(JSON.stringify(task.steps));

  try {
    // Execute each step sequentially
    for (let i = 0; i < steps.length; i++) {
      steps[i].status = 'running';
      await pool.query(
        `UPDATE portal_agent_tasks SET current_step = $1, steps = $2 WHERE id = $3`,
        [i + 1, JSON.stringify(steps), taskId]
      );
      if (onProgress) onProgress({ step: i + 1, name: steps[i].name, status: 'running' });

      // Build step-specific prompt
      const stepPrompt = buildStepPrompt(task.task_type, i, task.task_input, steps);

      const result = await callGroqDirect(
        [{ role: 'system', text: taskDef.systemPrompt },
         { role: 'user', text: stepPrompt }],
        { temperature: 0.2, maxTokens: 4096 }
      );

      steps[i].status = 'completed';
      steps[i].output = result.text;

      await pool.query(
        `UPDATE portal_agent_tasks SET steps = $1 WHERE id = $2`,
        [JSON.stringify(steps), taskId]
      );
      if (onProgress) onProgress({ step: i + 1, name: steps[i].name, status: 'completed' });
    }

    // Compile final output
    const finalOutput = steps.map(s => `### ${s.name}\n${s.output || ''}`).join('\n\n');

    await pool.query(`
      UPDATE portal_agent_tasks
      SET status = 'completed', completed_at = NOW(),
          task_output = $1, duration_ms = $2
      WHERE id = $3
    `, [JSON.stringify({ result: finalOutput, steps }), Date.now() - startTime, taskId]);

    return { result: finalOutput, steps };
  } catch (err) {
    await pool.query(
      `UPDATE portal_agent_tasks SET status = 'failed', error_message = $1 WHERE id = $2`,
      [err.message, taskId]
    );
    throw err;
  }
}

function buildStepPrompt(taskType, stepIndex, input, previousSteps) {
  const parsedInput = typeof input === 'string' ? JSON.parse(input) : input;
  const previousOutputs = previousSteps
    .filter(s => s.status === 'completed' && s.output)
    .map(s => `[${s.name}]: ${s.output}`)
    .join('\n\n');

  const baseContext = `VAZIFA: ${parsedInput.description || parsedInput.query || JSON.stringify(parsedInput)}
${previousOutputs ? `\nOLDINGI QADAMLAR NATIJALARI:\n${previousOutputs}` : ''}`;

  return `${baseContext}\n\nHozirgi qadam (${stepIndex + 1}): ${previousSteps[stepIndex]?.name}\nShu qadamni bajaring.`;
}

module.exports = {
  LEGAL_TOPICS,
  processLegalChat,
  callGroqDirect,
  callGroqStreaming,
  analyzeDocument,
  AGENT_TASK_TYPES,
  createAgentTask,
  executeAgentTask
};
