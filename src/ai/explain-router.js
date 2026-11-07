'use strict';

/**
 * Which model writes the document explanation (2026-10-12): DeepSeek
 * deepseek-flash with a 6 000-token answer cap, then GPT-6 Luna at 8 000,
 * then the last-resort tier. The other text calls go to DeepSeek first
 * through callOpenAI (src/ai/deepseek.js routes); this route only fixes the
 * explanation's caps, as measured in the provider evaluation.
 *
 * Environment (an env change, not a deploy, turns it off):
 *   EXPLAIN_PROVIDER              'deepseek' (default when DEEPSEEK_API_KEY is
 *                                 set) or 'default' = the cheap lane as before
 *   EXPLAIN_DEEPSEEK_MAX_TOKENS   default 6000 (at 3000 both evaluation
 *                                 answers were cut)
 *   EXPLAIN_FALLBACK_MODEL        default openai/gpt-6-luna (explicit OpenAI:
 *                                 never routed to VoiceLab)
 *   EXPLAIN_FALLBACK_MAX_TOKENS   default 8000 (Luna reasons inside the cap;
 *                                 it used ~6 000 on the evaluation document)
 *
 * Each provider attempt is its own usage-ledger row with a cost bound, so the
 * request budget and the pilot budget see it before it is made.
 */

function routing(env = process.env) {
  // DEEPSEEK_ROUTING=off turns DeepSeek off everywhere, this route included
  const has = String(env.DEEPSEEK_API_KEY || '').trim().length > 0 && String(env.DEEPSEEK_ROUTING || '').trim().toLowerCase() !== 'off';
  const provider = String(env.EXPLAIN_PROVIDER || (has ? 'deepseek' : 'default')).trim().toLowerCase();
  const n = (v, d) => { const x = Number(v); return Number.isFinite(x) && x >= 16 ? x : d; };
  return {
    provider: provider === 'deepseek' && has ? 'deepseek' : 'default',
    deepseekMaxTokens: n(env.EXPLAIN_DEEPSEEK_MAX_TOKENS, 6000),
    fallbackModel: String(env.EXPLAIN_FALLBACK_MODEL || 'openai/gpt-6-luna').trim(),
    fallbackMaxTokens: n(env.EXPLAIN_FALLBACK_MAX_TOKENS, 8000),
  };
}

/**
 * deps: { usageLedger, modelPricing, deepseek, callOpenAI, paidAllowed (an
 *         OpenAI key and the daily ceiling), spendAllowed (the daily ceiling),
 *         lastResort, callDefault, log }
 * callDefault is the previous route (callCheapAI) for EXPLAIN_PROVIDER=default.
 */
function createExplainAI(deps) {
  const { usageLedger, modelPricing, deepseek, callOpenAI, paidAllowed, spendAllowed = paidAllowed, lastResort, callDefault, log = console, testModel = () => null,
    // the person's "not to DeepSeek" choice (src/privacy/provider-choice.js): the default route, which skips it too
    deepseekAllowed = async () => true } = deps;
  return async function callExplainAI(messages, options = {}) {
    const cfg = routing();
    // a master's own test model (src/ai/test-model.js): through callOpenAI,
    // which asks for it, at this route's caps - DeepSeek's 6 000 (callOpenAI
    // doubles a deepseek/ or zai/ cap) or GPT-6's 8 000
    const tm = testModel();
    if (tm) {
      const halved = /^(deepseek|zai)\//u.test(tm);
      return callOpenAI(messages, { ...options, model: tm, lane: 'cheap', maxTokens: halved ? Math.round(cfg.deepseekMaxTokens / 2) : cfg.fallbackMaxTokens, useSearch: false });
    }
    if (cfg.provider !== 'deepseek' || !(await deepseekAllowed())) return callDefault(messages, options);
    return usageLedger.withChain(async () => {
      // the same daily paid-spend ceiling as every paid model
      if (!(await spendAllowed())) return lastResort(messages, options);
      try {
        return await usageLedger.track({ provider: 'deepseek', model: 'deepseek/deepseek-flash', endpoint: options.endpoint, userId: options.userId || null, detail: options.detail || null,
          bound: modelPricing.callCostBound({ model: 'deepseek/deepseek-flash', inputTokensMax: modelPricing.inputTokenBound(messages), outputTokensMax: cfg.deepseekMaxTokens }) },
        call => deepseek.chatCompletion(messages, { maxTokens: cfg.deepseekMaxTokens, temperature: options.temperature == null ? 0.2 : options.temperature, call }));
      } catch (e) {
        log.warn(`[ExplainAI] deepseek-flash failed (falling back to ${cfg.fallbackModel}):`, e.message);
      }
      if (await paidAllowed()) {
        try {
          return await callOpenAI(messages, { ...options, model: cfg.fallbackModel, lane: 'cheap', maxTokens: cfg.fallbackMaxTokens, useSearch: false });
        } catch (e) {
          log.warn(`[ExplainAI] ${cfg.fallbackModel} failed (falling back to the last resort):`, e.message);
        }
      }
      return lastResort(messages, options);
    });
  };
}

module.exports = { routing, createExplainAI };
