'use strict';

/**
 * Enterprise Uzbekistan / TIFC — English-law API routes
 *
 *   POST /api/enterprise-chat      — English-law Q&A (all auth users, quota-gated)
 *   GET  /api/enterprise/stats     — corpus size (all auth users)
 *   POST /api/enterprise/ingest    — add an English-law document (master only)
 */

const { initEnterpriseCorpus, handleEnterpriseChat, ingestEnterpriseDocument, enterpriseStats } = require('./index');

function mountEnterpriseRoutes(app, deps) {
  const { requireAuth, callAI, tariffModule } = deps;

  function masterOnly(req, res, next) {
    if (req.session?.isAuthenticated && req.session?.role === 'master') return next();
    return res.status(403).json({ error: 'Master admin only' });
  }

  const quota = (tariffModule && typeof tariffModule.enforceQuota === 'function')
    ? tariffModule.enforceQuota('/api/enterprise-chat')
    : (req, res, next) => next();

  initEnterpriseCorpus().catch((e) => console.error('[ENTERPRISE] init:', e.message));

  // ── English-law chat ──
  app.post('/api/enterprise-chat', requireAuth, quota, async (req, res) => {
    try {
      const { message, history } = req.body || {};
      if (!message || !message.trim()) return res.status(400).json({ error: 'Message required' });
      const result = await handleEnterpriseChat({ message: message.trim(), history, callAI });
      res.json(result);
    } catch (e) {
      console.error('[ENTERPRISE] chat error:', e.message);
      res.status(500).json({ error: 'Enterprise chat error: ' + e.message });
    }
  });

  // ── Corpus stats ──
  app.get('/api/enterprise/stats', requireAuth, async (req, res) => {
    res.json(await enterpriseStats());
  });

  // ── Ingest English-law document (master) ──
  app.post('/api/enterprise/ingest', requireAuth, masterOnly, async (req, res) => {
    try {
      const { lawName, sourceUrl, text } = req.body || {};
      if (!lawName || !text || !text.trim()) return res.status(400).json({ error: 'lawName and text required' });
      const result = await ingestEnterpriseDocument({ lawName, sourceUrl, text, verifiedBy: req.session.adminId });
      res.json(result);
    } catch (e) {
      console.error('[ENTERPRISE] ingest error:', e.message);
      res.status(500).json({ error: 'Ingest error: ' + e.message });
    }
  });

  console.log('[ENTERPRISE] English-law routes mounted');
}

module.exports = { mountEnterpriseRoutes };
