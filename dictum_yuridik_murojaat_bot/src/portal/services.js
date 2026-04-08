'use strict';

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

// ════════════════════════════════════════
// LEGAL CHAT SERVICE
// ════════════════════════════════════════

const LEGAL_TOPICS = {
  mehnat: 'Mehnat huquqi', oila: 'Oila huquqi', fuqarolik: 'Fuqarolik huquqi',
  shartnoma: 'Shartnoma huquqi', soliq: 'Soliq huquqi', jinoyat: 'Jinoyat huquqi',
  mamuriy: "Ma'muriy javobgarlik", korporativ: 'Korporativ huquq',
  tadbirkorlik: 'Tadbirkorlik huquqi', 'uy-joy': 'Uy-joy oldi-sotdisi',
  mulk: 'Mulk huquqi', notarius: 'Notarius xizmatlari', ijtimoiy: 'Ijtimoiy himoya',
  advokatura: 'Advokatura'
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
  } catch {
    // Fallback: call Groq directly if server module not available
    callAI = callGroqDirect;
  }

  // RAG retrieval
  let ragContext = '';
  try {
    const { hybridSearch, textOnlySearch } = require('../rag/legal-corpus');
    const { getEmbedding } = require('../rag/embeddings');
    const apiKey = process.env.GEMINI_API_KEY || process.env.GPT_API_KEY;

    let results = [];
    if (apiKey) {
      try {
        results = await hybridSearch(message, { category: topic, limit: 6, apiKey });
      } catch { /* fall through to text-only */ }
    }
    if (!results || results.length === 0) {
      results = await textOnlySearch(message, { category: topic, limit: 6 });
    }

    if (results && results.length > 0) {
      ragContext = results.map((r, i) => {
        const arts = r.article_numbers ? r.article_numbers.join(', ') : '';
        const badge = r.source_type === 'verified_qa' ? ' [TASDIQLANGAN]' : '';
        return `[${i + 1}] ${r.law_name}${badge}${arts ? ` (${arts}-moddalar)` : ''}\n${r.chunk_text}`;
      }).join('\n\n');
    }
  } catch (ragErr) {
    console.warn('[PORTAL] RAG retrieval failed:', ragErr.message);
  }

  // Build system prompt
  const topicLabel = LEGAL_TOPICS[topic] || topic || 'Umumiy huquq';
  const systemPrompt = buildLegalSystemPrompt(topicLabel, ragContext);

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

  const duration = Date.now() - startTime;

  // Store messages in DB
  if (conversationId) {
    try {
      // Store user message
      await pool.query(
        `INSERT INTO portal_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
        [conversationId, message]
      );
      // Store AI response
      const msgInsert = await pool.query(
        `INSERT INTO portal_messages (conversation_id, role, content, model_used, duration_ms)
         VALUES ($1, 'assistant', $2, $3, $4) RETURNING id`,
        [conversationId, result.text, result.provider || 'unknown', duration]
      );
      var messageId = msgInsert.rows[0]?.id;
      // Update conversation
      await pool.query(
        `UPDATE portal_conversations SET message_count = message_count + 2, updated_at = NOW() WHERE id = $1`,
        [conversationId]
      );
    } catch (dbErr) {
      console.error('[PORTAL] Message save error:', dbErr.message);
    }
  }

  return {
    reply: result.text,
    sources: [], // TODO: extract from ragContext
    model: result.provider || 'unknown',
    tokens: 0,
    duration,
    messageId: messageId || null
  };
}

function buildLegalSystemPrompt(topicLabel, ragContext) {
  return `Siz O'zbekiston ${topicLabel} bo'yicha YUQORI MALAKALI yuridik maslahatchi AI siz.

QATTIQ QOIDALAR:
1. Javob FAQAT O'zbek (lotin) tilida
2. Modda raqamlarini FAQAT 100% ishonchli bo'lsangiz keltiring
3. To'qib chiqarishdan QATTIYAN SAQLANING
4. Har bir huquqiy tasdiq uchun MANBA ko'rsating
5. Javob chuqur va to'liq bo'lsin
${ragContext ? '6. Quyidagi QONUNCHILIK KONTEKSTIGA BIRINCHI NAVBATDA tayanib javob bering' : ''}

JAVOB TUZILMASI:

Savolni avval tahlil qiling: bu NAZARIY savol yoki AMALIY savol?

## Huquqiy asos
Tegishli qonun(lar), kodeks va moddalar — har birining ANIQ mazmunini chuqur tushuntiring. Bu asosiy javob.

## Muddatlar va jarimalar
FAQAT qonunda ANIQ SON bor bo'lsagina yozing (masalan: "30 kun", "5 BHM jarima"). Aniq raqam yo'q bo'lsa — bu bo'limni UMUMAN YOZMANG, hatto "raqam mavjud emas" deb ham yozmang.

## Yuridik maslahat
Maksimum 2-3 ta QISQA punkt, har biri 1-2 jumla. FAQAT YANGI ma'lumot: murojaat joyi, kerakli hujjatlar, kam ma'lum mexanizmlar.

TAQIQLAR:
- "Holat tahlili", "Amaliy qadamlar", "Maslahat" bo'limlarini YOZMANG
- Huquqiy asos bo'limida AYTILGAN ma'lumotni qayta yozmang va boshqa so'zlar bilan takrorlamang
- "Qonunchilikni kuzating", "Yuristga murojaat qiling", "Xabardor bo'ling", "Huquqlaringizni biling" YOZMANG
- Savolda berilgan tushunchani qayta tushuntirmang

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
