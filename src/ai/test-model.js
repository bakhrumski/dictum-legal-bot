'use strict';

/**
 * A master's own test model (2026-10-13, owner: try GLM, DeepSeek V4 Pro /
 * Flash and GPT-6 Sol / Luna on the platform without moving customers).
 *
 * The dashboard's master-only "🧪 Sinov modeli" picker sends the header
 * X-JAI-Test-Model on that tab's API requests. The server applies it only
 * when the session's account is master IN THE DATABASE and the id is one of
 * TEST_MODELS; for anyone else the header is ignored (never an error, never
 * applied). While it applies, every text call of that one request - chat
 * (streamed too), legal opinion, analysis, explanation, drafts, and their
 * helpers - asks for that model (callOpenAI / callOpenAIStream, the
 * explanation router; a long document's digest keeps the production model,
 * see apply). The normal chain stays behind it: a failure is
 * answered by the lane's fallback, and the provider that really answered is
 * in the usage ledger and the reply. Images / OCR, embeddings, the hybrid
 * pipeline and Telegram are not touched. No env change, no restart.
 */

const { AsyncLocalStorage } = require('async_hooks');

const HEADER = 'x-jai-test-model';
const TEST_MODELS = Object.freeze([
  { id: 'zai/glm-5.3-flash', label: 'GLM-5.3 Flash' },
  { id: 'deepseek/deepseek-flash', label: 'DeepSeek Flash' },
  { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  { id: 'openai/gpt-6-luna', label: 'GPT-6 Luna' },
  { id: 'openai/gpt-6-sol', label: 'GPT-6 Sol' },
]);
const ALLOWED = new Set(TEST_MODELS.map(m => m.id));

const als = new AsyncLocalStorage();

/** The test model of the running request, or null. */
function current() {
  const s = als.getStore();
  return s ? s.model : null;
}

/**
 * options with the test model as `model` while one applies (the caller's
 * object is not changed). A long document's digest parts keep the
 * production model: the digest is tuned to its 1 600-token cap (a reasoning
 * model would spend it) and is shared per user and document for an hour, so
 * every test model writes its answer on the same digest.
 */
function apply(options = {}) {
  const model = current();
  if (!model || (options.detail && options.detail.phase === 'digest')) return options;
  return { ...options, model, testModel: model };
}

/**
 * Express middleware. verifyMaster(adminId) checks the role in the database
 * (src/rag/document-explain-route.js createVerifyMaster). onApplied is told
 * (e.g. to annotate the usage ledger).
 */
function createMiddleware({ verifyMaster, onApplied = () => {} }) {
  return async (req, res, next) => {
    const raw = req.get ? req.get(HEADER) : (req.headers && req.headers[HEADER]);
    if (!raw) return next();
    const model = String(raw).trim().toLowerCase();
    const session = req.session || {};
    let ok = false;
    try {
      ok = ALLOWED.has(model) && session.role === 'master' && !!session.adminId && await verifyMaster(session.adminId);
    } catch (_) { ok = false; }
    if (!ok) return next();
    res.setHeader('X-JAI-Test-Model', model);
    res.setHeader('Cache-Control', 'no-store');
    try { onApplied(model, req); } catch (_) { /* annotation must not block the request */ }
    return als.run({ model }, next);
  };
}

module.exports = { HEADER, TEST_MODELS, current, apply, createMiddleware, _als: als };
