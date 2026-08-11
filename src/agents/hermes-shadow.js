'use strict';

const { pool } = require('../database/db');
const { calculateTokenCost } = require('../ai/model-pricing');

const ROUTES = Object.freeze([
  'answer',
  'clarify',
  'social',
  'identity',
  'account_help',
  'attorney_intake',
  'document_intake',
  'human_review',
  'reject_offtopic',
]);

const INTENTS = Object.freeze([
  'huquqiy_savol',
  'noaniq',
  'davomi',
  'salomlashuv',
  'bot_haqida',
  'advokat_kerak',
  'hujjat_tayyorlash',
  'hisob_yordam',
  'yurist_kerak',
  'mavzudan_tashqari',
]);

const SHADOW_SYSTEM_PROMPT = `You are the private shadow evaluator for JuristAI's Uzbek Telegram concierge.

You do not speak to the user, provide legal advice, call tools, reveal contacts, quote prices, or change the production result. Evaluate only how the message should be routed.

Return one JSON object and nothing else:
{"intent":"...","recommended_action":"...","needs_clarification":false,"should_use_ai_answer":false,"should_escalate":false,"confidence":0.0,"reason":"..."}

Allowed intent values: ${INTENTS.join(', ')}.
Allowed recommended_action values: ${ROUTES.join(', ')}.

Routing rules:
- Greetings, thanks, identity and account-support questions never need a legal AI answer.
- A vague request for help needs one short clarification, not a legal answer.
- Attorney requests need deterministic field, region and case intake before candidates are shown.
- Document drafting is a paid intake that needs lawyer approval; never draft it here.
- A concrete Uzbekistan legal problem may use the grounded legal-answer pipeline.
- Ambiguous, unsafe, or high-stakes cases may be sent to human_review.

Judge the new user message using only the supplied redacted context. Keep reason under 180 characters.`;

let defaultService = null;

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeEndpoint(baseUrl) {
  const value = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  if (/\/chat\/completions$/i.test(value)) return value;
  if (/\/v1$/i.test(value)) return `${value}/chat/completions`;
  return `${value}/v1/chat/completions`;
}

function redactSensitiveText(value, maxLength = 1800) {
  return String(value || '')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[email]')
    .replace(/\b(?:\d[ -]*?){16}\b/g, '[karta]')
    .replace(/\b[A-Z]{2}\s?\d{7}\b/gi, '[hujjat]')
    .replace(/\b\d{14}\b/g, '[JShShIR]')
    .replace(/(?:\+?998[\s().-]*)?(?:\d[\s().-]*){9}\b/g, '[telefon]')
    .slice(0, maxLength);
}

function normalizeProductionRoute(result = {}) {
  const action = String(result.action || '');
  if (action === 'answered') return 'answer';
  if (action === 'clarify' || action.endsWith('_required')) return 'clarify';
  if (action === 'greeting') return 'social';
  if (action === 'identity') return 'identity';
  if (action === 'account_help') return 'account_help';
  if (action.startsWith('attorney_')) return 'attorney_intake';
  if (action.startsWith('document_') || action === 'paid_service') return 'document_intake';
  if (action === 'offtopic') return 'reject_offtopic';
  if (result.escalate || ['human_takeover', 'escalate', 'skip'].includes(action)) return 'human_review';
  return 'clarify';
}

function extractJson(content) {
  const raw = Array.isArray(content)
    ? content.map(part => (part && (part.text || part.content)) || '').join('')
    : String(content || '');
  const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Hermes did not return JSON');
  return JSON.parse(match[0]);
}

function validateDecision(value) {
  const intent = INTENTS.includes(value.intent) ? value.intent : 'noaniq';
  const recommendedAction = ROUTES.includes(value.recommended_action)
    ? value.recommended_action
    : 'clarify';
  return {
    intent,
    recommendedAction,
    needsClarification: Boolean(value.needs_clarification),
    shouldUseAiAnswer: Boolean(value.should_use_ai_answer),
    shouldEscalate: Boolean(value.should_escalate),
    confidence: clamp(value.confidence, 0, 1, 0),
    reason: String(value.reason || '').slice(0, 300),
  };
}

function createHermesShadow({ env = process.env, fetchImpl = global.fetch, db = pool, random = Math.random } = {}) {
  const config = Object.freeze({
    enabled: parseBoolean(env.HERMES_SHADOW_ENABLED, false),
    endpoint: normalizeEndpoint(env.HERMES_SHADOW_URL),
    apiKey: String(env.HERMES_SHADOW_API_KEY || ''),
    model: String(env.HERMES_SHADOW_MODEL || 'hermes-agent'),
    sampleRate: clamp(env.HERMES_SHADOW_SAMPLE_RATE, 0, 1, 1),
    timeoutMs: clamp(env.HERMES_SHADOW_TIMEOUT_MS, 1000, 30000, 8000),
  });
  let tableReady = false;

  function publicStatus() {
    const configured = Boolean(config.endpoint && typeof fetchImpl === 'function');
    return {
      enabled: config.enabled,
      configured,
      status: !config.enabled ? 'disabled' : (configured ? 'ready' : 'misconfigured'),
      model: config.model,
      sampleRate: config.sampleRate,
      timeoutMs: config.timeoutMs,
    };
  }

  async function ensureTable() {
    if (tableReady) return;
    await db.query(`
      CREATE TABLE IF NOT EXISTS tg_agent_shadow_runs (
        id BIGSERIAL PRIMARY KEY,
        telegram_chat_id BIGINT NOT NULL,
        message_preview TEXT,
        production_action VARCHAR(80),
        production_route VARCHAR(40),
        production_intent VARCHAR(80),
        production_escalate BOOLEAN NOT NULL DEFAULT FALSE,
        hermes_action VARCHAR(40),
        hermes_intent VARCHAR(80),
        hermes_should_escalate BOOLEAN,
        hermes_confidence NUMERIC(5,4),
        agreement BOOLEAN,
        model VARCHAR(160),
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd NUMERIC(14,8),
        latency_ms INTEGER,
        status VARCHAR(30) NOT NULL,
        error TEXT,
        raw_result JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_tg_shadow_created_at ON tg_agent_shadow_runs(created_at DESC)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_tg_shadow_chat_id ON tg_agent_shadow_runs(telegram_chat_id, created_at DESC)`);
    tableReady = true;
  }

  async function persist(row) {
    await ensureTable();
    await db.query(`
      INSERT INTO tg_agent_shadow_runs (
        telegram_chat_id, message_preview, production_action, production_route,
        production_intent, production_escalate, hermes_action, hermes_intent,
        hermes_should_escalate, hermes_confidence, agreement, model,
        prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd,
        latency_ms, status, error, raw_result
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb
      )
    `, [
      row.chatId,
      row.messagePreview,
      row.productionAction,
      row.productionRoute,
      row.productionIntent,
      row.productionEscalate,
      row.hermesAction || null,
      row.hermesIntent || null,
      row.hermesShouldEscalate == null ? null : row.hermesShouldEscalate,
      row.hermesConfidence == null ? null : row.hermesConfidence,
      row.agreement == null ? null : row.agreement,
      row.model || config.model,
      row.promptTokens || 0,
      row.completionTokens || 0,
      row.totalTokens || 0,
      row.estimatedCostUsd == null ? null : row.estimatedCostUsd,
      row.latencyMs == null ? null : row.latencyMs,
      row.status,
      row.error ? String(row.error).slice(0, 1000) : null,
      JSON.stringify(row.rawResult || null),
    ]);
  }

  async function run({ chatId, text, turns = [], productionResult = {} } = {}) {
    const status = publicStatus();
    if (!status.enabled) return { status: 'disabled' };
    if (!status.configured) return { status: 'misconfigured' };
    if (config.sampleRate <= 0 || random() >= config.sampleRate) return { status: 'sampled_out' };

    const startedAt = Date.now();
    const productionAction = String(productionResult.action || '');
    const productionRoute = normalizeProductionRoute(productionResult);
    const productionIntent = String((productionResult.meta && productionResult.meta.intent) || 'noaniq');
    const productionEscalate = Boolean(productionResult.escalate);
    const messagePreview = redactSensitiveText(text, 1000);
    const history = (Array.isArray(turns) ? turns : []).slice(-4).map(turn => ({
      role: turn && turn.role === 'ai' ? 'assistant' : 'user',
      text: redactSensitiveText(turn && turn.text, 700),
    }));

    const input = {
      recent_context: history,
      new_user_message: messagePreview,
      production_result: {
        intent: productionIntent,
        action: productionAction,
        normalized_route: productionRoute,
        escalated: productionEscalate,
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let row = {
      chatId,
      messagePreview,
      productionAction,
      productionRoute,
      productionIntent,
      productionEscalate,
      model: config.model,
      status: 'failed',
    };

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      const response = await fetchImpl(config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: SHADOW_SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(input) },
          ],
          temperature: 0,
          max_tokens: 300,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Hermes ${response.status}: ${body.slice(0, 240)}`);
      }

      const payload = await response.json();
      const choice = payload && payload.choices && payload.choices[0];
      const decision = validateDecision(extractJson(choice && choice.message && choice.message.content));
      const usage = payload.usage || {};
      const promptTokens = Number(usage.prompt_tokens || usage.input_tokens) || 0;
      const completionTokens = Number(usage.completion_tokens || usage.output_tokens) || 0;
      const totalTokens = Number(usage.total_tokens) || (promptTokens + completionTokens);
      const model = String(payload.model || config.model);
      const agreement = decision.recommendedAction === productionRoute
        && decision.shouldEscalate === productionEscalate;

      row = {
        ...row,
        status: 'success',
        hermesAction: decision.recommendedAction,
        hermesIntent: decision.intent,
        hermesShouldEscalate: decision.shouldEscalate,
        hermesConfidence: decision.confidence,
        agreement,
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd: calculateTokenCost(model, { inTokens: promptTokens, outTokens: completionTokens }),
        latencyMs: Date.now() - startedAt,
        rawResult: decision,
      };
      await persist(row);
      return { status: row.status, agreement, decision, usage: { promptTokens, completionTokens, totalTokens } };
    } catch (error) {
      row = {
        ...row,
        latencyMs: Date.now() - startedAt,
        error: error && error.name === 'AbortError' ? `timeout after ${config.timeoutMs}ms` : error.message,
      };
      try { await persist(row); } catch (dbError) {
        console.warn('[HERMES-SHADOW] could not persist failure:', dbError.message);
      }
      console.warn('[HERMES-SHADOW] evaluation failed:', row.error);
      return { status: 'failed', error: row.error };
    } finally {
      clearTimeout(timer);
    }
  }

  async function report({ days = 7, limit = 25 } = {}) {
    const safeDays = Math.round(clamp(days, 1, 90, 7));
    const safeLimit = Math.round(clamp(limit, 1, 100, 25));
    const status = publicStatus();
    try {
      await ensureTable();
      const [statsResult, recentResult] = await Promise.all([
        db.query(`
          SELECT COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE status = 'success')::int AS successful,
                 COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
                 COUNT(*) FILTER (WHERE status = 'success' AND estimated_cost_usd IS NULL)::int AS unknown_cost_runs,
                 COUNT(*) FILTER (WHERE agreement IS TRUE)::int AS agreements,
                 ROUND(100.0 * COUNT(*) FILTER (WHERE agreement IS TRUE)
                   / NULLIF(COUNT(*) FILTER (WHERE status = 'success'), 0), 1) AS agreement_rate,
                 COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
                 COALESCE(SUM(estimated_cost_usd), 0)::float AS estimated_cost_usd,
                 COALESCE(ROUND(AVG(latency_ms) FILTER (WHERE status = 'success')), 0)::int AS average_latency_ms
            FROM tg_agent_shadow_runs
           WHERE created_at >= NOW() - ($1 * INTERVAL '1 day')
        `, [safeDays]),
        db.query(`
          SELECT id, message_preview, production_action, production_route,
                 production_intent, production_escalate, hermes_action,
                 hermes_intent, hermes_should_escalate, hermes_confidence,
                 agreement, model, total_tokens, estimated_cost_usd,
                 latency_ms, status, error, raw_result->>'reason' AS hermes_reason,
                 created_at
            FROM tg_agent_shadow_runs
           ORDER BY created_at DESC
           LIMIT $1
        `, [safeLimit]),
      ]);
      return { ...status, days: safeDays, stats: statsResult.rows[0], items: recentResult.rows };
    } catch (error) {
      return {
        ...status,
        days: safeDays,
        stats: { total: 0, successful: 0, failed: 0, unknown_cost_runs: 0, agreements: 0, agreement_rate: null, total_tokens: 0, estimated_cost_usd: 0, average_latency_ms: 0 },
        items: [],
        error: error.message,
      };
    }
  }

  return { run, report, publicStatus, ensureTable };
}

function getDefaultService() {
  if (!defaultService) defaultService = createHermesShadow();
  return defaultService;
}

module.exports = {
  createHermesShadow,
  runHermesShadow: payload => getDefaultService().run(payload),
  getHermesShadowReport: options => getDefaultService().report(options),
  getHermesShadowStatus: () => getDefaultService().publicStatus(),
  normalizeProductionRoute,
  redactSensitiveText,
};
