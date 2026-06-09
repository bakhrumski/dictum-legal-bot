'use strict';

/**
 * Advanced RAG API Routes
 *
 * Mounts on the Express app to provide:
 *   - POST   /api/qa-bank            — Save edited QA pair
 *   - GET    /api/qa-bank            — List QA bank entries
 *   - POST   /api/qa-bank/:id/vote   — Thumbs up/down
 *   - DELETE /api/qa-bank/:id         — Delete entry
 *   - GET    /api/qa-bank/stats       — Stats
 *   - POST   /api/advanced-chat       — Chat with few-shot + parent-child retrieval
 *   - POST   /api/ingest-structured   — Ingest URL with structural chunker
 *
 * These routes extend (not replace) the existing /api/legal-chat endpoint.
 * The advanced-chat route adds:
 *   1. QA bank few-shot injection
 *   2. Parent-child retrieval
 *   3. Strict 4-part system prompt
 */

const { saveToQaBank, voteQaBankEntry, findSimilarQA, formatQaFewShot, parentChildSearch, getAdvancedStats, initAdvancedCorpus, insertStructuredChunks } = require('./advanced-corpus');
const { buildAdvancedPrompt, formatAdvancedContext } = require('./system-prompt');
const { chunkLegalDocumentStructured } = require('./structural-chunker');
const { fetchLexDocument, parseLexHtml } = require('./fetch-lex');
const { getEmbeddingsBatch, detectProvider } = require('./embeddings');
const { deleteByDocId, logIngest, rebuildVectorIndex } = require('./legal-corpus');
const hybridPipeline = require('./hybrid-pipeline');
const spendLog = require('./llm-spend-log');
const subscription = require('./subscription-tiers');
const metricsDashboard = require('./metrics-dashboard');
const { searchKorpus, formatKorpusGroundTruth } = require('./qa-korpus');
const { rerankChunks } = require('./reranker');
const { expandQueryVariants, normalizeResponseForUser } = require('./prim-notation');

// Feature flag: when HYBRID_PIPELINE=1, /api/advanced-chat routes through
// the 2-model classify→generate pipeline in hybrid-pipeline.js.
const HYBRID_ENABLED = process.env.HYBRID_PIPELINE === '1';

/**
 * Mount advanced RAG routes on Express app.
 *
 * @param {import('express').Express} app
 * @param {Object} deps - { requireAuth, requireMasterAdmin, callAI, pool }
 */
function mountAdvancedRoutes(app, deps) {
  const { requireAuth, requireMasterAdmin, callAI, pool } = deps;

  // ══════════════════════════════════════
  // QA BANK CRUD
  // ══════════════════════════════════════

  /**
   * POST /api/qa-bank — Save an edited QA pair
   * Body: { question, answer, originalAiAnswer, category, topic, sourceUrl, articleRefs }
   * Auth: master admin
   */
  app.post('/api/qa-bank', requireMasterAdmin, async (req, res) => {
    try {
      const { question, answer, originalAiAnswer, category, topic, sourceUrl, articleRefs } = req.body;

      if (!question || !answer) {
        return res.status(400).json({ error: 'question va answer majburiy' });
      }

      const qaId = await saveToQaBank({
        question,
        answer,
        originalAiAnswer,
        category: category || topic,
        topic,
        sourceUrl,
        articleRefs: articleRefs || [],
        editedBy: req.session.adminId,
        editedByName: req.session.adminName || req.session.adminUsername || 'Admin',
      });

      res.json({ id: qaId, message: 'QA bankga saqlandi' });
    } catch (error) {
      console.error('[QA Bank] Save error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/qa-bank — List all QA bank entries
   * Query: ?category=&limit=50&offset=0
   * Auth: master admin
   */
  app.get('/api/qa-bank', requireMasterAdmin, async (req, res) => {
    try {
      const { category, limit = 50, offset = 0 } = req.query;
      const filters = [];
      const params = [];
      let idx = 1;

      if (category) {
        filters.push(`category = $${idx++}`);
        params.push(category);
      }

      const where = filters.length > 0 ? 'WHERE ' + filters.join(' AND ') : '';
      params.push(parseInt(limit), parseInt(offset));

      const result = await pool.query(`
        SELECT id, question, answer, category, topic, article_refs,
               rating, thumbs_up, thumbs_down, edited_by_name,
               created_at, updated_at
        FROM qa_bank
        ${where}
        ORDER BY created_at DESC
        LIMIT $${idx++} OFFSET $${idx}
      `, params);

      const countResult = await pool.query(`SELECT COUNT(*) FROM qa_bank ${where}`, category ? [category] : []);

      res.json({
        items: result.rows,
        total: parseInt(countResult.rows[0].count),
      });
    } catch (error) {
      console.error('[QA Bank] List error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/qa-bank/:id/vote — Thumbs up or down
   * Body: { direction: 'up' | 'down' }
   * Auth: any authenticated user
   */
  app.post('/api/qa-bank/:id/vote', requireAuth, async (req, res) => {
    try {
      const { direction } = req.body;
      if (!['up', 'down'].includes(direction)) {
        return res.status(400).json({ error: "direction 'up' yoki 'down' bo'lishi kerak" });
      }

      await voteQaBankEntry(parseInt(req.params.id), direction);
      res.json({ ok: true });
    } catch (error) {
      console.error('[QA Bank] Vote error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /api/qa-bank/:id — Delete a QA bank entry
   * Auth: master admin
   */
  app.delete('/api/qa-bank/:id', requireMasterAdmin, async (req, res) => {
    try {
      await pool.query('DELETE FROM qa_bank WHERE id = $1', [parseInt(req.params.id)]);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/qa-bank/stats — QA bank statistics
   * Auth: master admin
   */
  app.get('/api/qa-bank/stats', requireMasterAdmin, async (req, res) => {
    try {
      const stats = await getAdvancedStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/hybrid/status — Hybrid pipeline status + LLM spend stats
   * Auth: master admin
   */
  app.get('/api/hybrid/status', requireMasterAdmin, async (req, res) => {
    try {
      const inProc = hybridPipeline.getSpendStats();
      let persistent = null;
      try {
        persistent = await spendLog.getSpendTotals();
      } catch (err) {
        console.warn('[HYBRID/status] spend log read failed:', err.message);
      }
      res.json({
        enabled: HYBRID_ENABLED,
        classifyChain: hybridPipeline.CLASSIFY_MODEL_CHAIN,
        generateChain: hybridPipeline.GENERATE_MODEL_CHAIN,
        spend: {
          // DB-backed totals (authoritative, survive restarts)
          today: persistent ? persistent.today : inProc.today,
          month: persistent ? persistent.month : inProc.month,
          dailyCeiling: inProc.dailyCeiling,
          monthlyCeiling: inProc.monthlyCeiling,
          source: persistent ? 'db' : 'in-process',
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/hybrid/spend-breakdown — per-model/per-stage spend breakdown
   * Query: ?days=30
   * Auth: master admin
   */
  app.get('/api/hybrid/spend-breakdown', requireMasterAdmin, async (req, res) => {
    try {
      const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 30));
      const rows = await spendLog.getSpendBreakdown({ days });
      res.json({ days, rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ══════════════════════════════════════
  // SUBSCRIPTION TIERS (Phase 3)
  // ══════════════════════════════════════

  /**
   * GET /api/subscription/me — current user's tier, limit, usage
   * Auth: any authenticated user
   */
  app.get('/api/subscription/me', requireAuth, async (req, res) => {
    try {
      const userId = req.session?.adminId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const q = await subscription.checkQuota(userId);
      res.json(q);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/subscription/set-tier — admin: assign a tier to a user
   * Body: { userId, tier, customLimit?, expiresAt? }
   * Auth: master admin
   */
  app.post('/api/subscription/set-tier', requireMasterAdmin, async (req, res) => {
    try {
      const { userId, tier, customLimit, expiresAt } = req.body || {};
      if (!userId || !tier) return res.status(400).json({ error: 'userId and tier required' });
      if (!subscription.TIER_LIMITS[tier]) {
        return res.status(400).json({ error: `Unknown tier: ${tier}. Valid: ${Object.keys(subscription.TIER_LIMITS).join(', ')}` });
      }
      await subscription.setTier(userId, tier, {
        customLimit: customLimit != null ? Number(customLimit) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      });
      res.json({ success: true, userId, tier });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/subscription/tiers — list tier limits (public reference)
   */
  app.get('/api/subscription/tiers', (req, res) => {
    res.json(subscription.TIER_LIMITS);
  });

  // ══════════════════════════════════════
  // METRICS DASHBOARD (Phase 4)
  // ══════════════════════════════════════

  /**
   * GET /api/metrics/dashboard — full JSON snapshot of RAG health + spend
   * Auth: master admin
   */
  app.get('/api/metrics/dashboard', requireMasterAdmin, async (req, res) => {
    try {
      const dash = await metricsDashboard.getDashboard();
      res.json(dash);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ══════════════════════════════════════
  // ADVANCED CHAT (with few-shot + parent-child)
  // ══════════════════════════════════════

  /**
   * POST /api/advanced-chat — Legal chat with advanced RAG pipeline
   *
   * Enhances /api/legal-chat with:
   *   1. QA bank few-shot injection (RLHF)
   *   2. Parent-child retrieval (precise + context)
   *   3. Strict 4-part system prompt
   *
   * Body: { message, history, topic, databases, sessionId }
   * Auth: master admin
   */
  app.post('/api/advanced-chat', requireMasterAdmin, subscription.enforceQuota('/api/advanced-chat'), async (req, res) => {
    try {
      const { message, history = [], topic } = req.body;

      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'Xabar matni topilmadi' });
      }

      const apiKey = process.env.HF_TOKEN || process.env.GEMINI_API_KEY || process.env.GPT_API_KEY;

      // ═══════════════════════════════════════════════════════════════
      // STAGE 1: QA KORPUS INTERCEPTOR (Semantic Cache)
      // Check for expert-corrected answers FIRST, before any AI call.
      // ═══════════════════════════════════════════════════════════════
      try {
        if (apiKey) {
          const korpusResult = await searchKorpus(message, { apiKey, topic });
          if (korpusResult && korpusResult.match === 'verbatim') {
            console.log(`[ADV CHAT] KORPUS VERBATIM id=${korpusResult.id} (sim=${korpusResult.similarity.toFixed(3)})`);
            return res.json({
              reply: korpusResult.answer,
              provider: 'qa-korpus',
              ragUsed: false,
              rag: null,
              fewShotCount: 0,
              qaKorpus: { id: korpusResult.id, similarity: korpusResult.similarity, match: 'verbatim' },
            });
          }
        }
      } catch (korpusErr) {
        console.warn(`[ADV CHAT] qa_korpus lookup failed: ${korpusErr.message}`);
      }

      // ═══════════════════════════════════════════════════════════════
      // HYBRID PIPELINE PATH (opt-in via HYBRID_PIPELINE=1)
      // Routes through classify → retrieve → generate with budget guard
      // and zero-hallucination fallback.
      // ═══════════════════════════════════════════════════════════════
      if (HYBRID_ENABLED) {
        try {
          const LEGAL_TOPICS_H = {
            'konstitutsiya':      'Konstitutsiyaviy tuzum',
            'davlat-boshqaruvi':  'Davlat boshqaruvi',
            'fuqarolik':          'Fuqarolik qonunchiligi',
            'oila':               'Oila qonunchiligi',
            'mehnat':             "Mehnat va aholining bandligi",
            'ijtimoiy':           "Ijtimoiy ta'minot va ijtimoiy himoya",
            'moliya':             "Moliya va kredit",
            'soliq':              "Soliq qonunchiligi",
            'bank':               "Bank faoliyati",
            'uy-joy':             "Uy-joy qonunchiligi. Kommunal xo'jalik",
            'tadbirkorlik':       "Tadbirkorlik va xo'jalik faoliyati",
            'tashqi-iqtisod':     "Tashqi iqtisodiy faoliyat. Bojxona ishi",
            'ekologiya':          "Atrof tabiiy muhit va tabiiy resurslar",
            'axborot':            "Axborot va axborotlashtirish",
            'talim':              "Ta'lim. Fan. Madaniyat",
            'soglik':             "Sog'liqni saqlash. Sport. Turizm",
            'mudofaa':            'Mudofaa',
            'jinoyat':            'Jinoyat qonunchiligi',
            'mamuriy':            "Ma'muriy javobgarlik",
            'sudlov':             'Odil sudlov',
            'adliya':             'Prokuratura. Advokatura. Notariat. Adliya organlari',
            'xalqaro':            'Xalqaro munosabatlar. Xalqaro huquq',
            'shaxsiy':            "Shaxsiy tusdagi hujjatlar",
          };

          const result = await hybridPipeline.runPipeline({
            query: message,
            history: (Array.isArray(history) ? history.slice(-18) : []).map(m => ({
              role: m.role === 'user' ? 'user' : 'model',
              text: m.text || m.content || '',
            })),
            retrieve: async (classification) => {
              // Caller-picked topic wins; fall back to classifier topic
              const effectiveTopic = topic || classification.topic;
              if (!effectiveTopic || !apiKey) return { ragContext: '', chunks: [] };
              let chunks = await parentChildSearch(message, {
                category: effectiveTopic,
                limit: 6,
                apiKey,
              });
              if (chunks.length === 0) {
                console.warn(`[ADV CHAT] Topic-scoped parent-child retrieval underflow for "${effectiveTopic}", retrying without category filter`);
                const broadChunks = await parentChildSearch(message, {
                  category: null,
                  limit: 6,
                  apiKey,
                });
                if (broadChunks.length > chunks.length) {
                  chunks = broadChunks;
                }
              }
              return {
                ragContext: formatAdvancedContext(chunks),
                chunks,
              };
            },
            buildPrompt: (classification, { ragContext, chunks }) => {
              const effectiveTopic = topic || classification.topic;
              let fewShotBlock = '';
              // Best-effort few-shot — don't block generation on failure
              return buildAdvancedPrompt({
                topic: effectiveTopic,
                topicLabel: LEGAL_TOPICS_H[effectiveTopic] || effectiveTopic || 'huquq',
                ragContext,
                fewShotBlock,
                retrievedChunks: chunks,
                userQuestion: message,
              });
            },
          });

          return res.json({
            reply: normalizeResponseForUser(result.text),
            provider: result.provider,
            ragUsed: (result.chunks || []).length > 0,
            rag: {
              searchMode: 'hybrid-pipeline',
              chunks: (result.chunks || []).length,
              sources: [...new Set((result.chunks || []).map(c => c.lawName))].slice(0, 3),
            },
            classification: result.classification,
            timings: result.timings,
            estimatedCostUsd: result.estimatedCostUsd,
          });
        } catch (hybridErr) {
          console.warn(`[HYBRID] pipeline failed, falling through to legacy: ${hybridErr.message}`);
          // Fall through to legacy path below
        }
      }

      // ── 0.5. Korpus context injection (sim 0.78-0.92) ──
      let korpusGroundTruth = '';
      try {
        if (apiKey) {
          const korpusResult = await searchKorpus(message, { apiKey, topic });
          if (korpusResult && korpusResult.match === 'context') {
            korpusGroundTruth = formatKorpusGroundTruth(korpusResult);
            console.log(`[ADV CHAT] KORPUS CONTEXT id=${korpusResult.id} (sim=${korpusResult.similarity.toFixed(3)})`);
          }
        }
      } catch (err) {
        console.warn(`[ADV CHAT] korpus context lookup failed: ${err.message}`);
      }

      // ── 1. QA Bank: Find similar verified answers for few-shot ──
      let fewShotBlock = '';
      let qaMatches = [];
      try {
        qaMatches = await findSimilarQA(message, topic || null, 3);
        fewShotBlock = formatQaFewShot(qaMatches);
        if (qaMatches.length > 0) {
          console.log(`[ADV CHAT] Injecting ${qaMatches.length} few-shot examples from QA bank`);
        }
      } catch (err) {
        console.warn(`[ADV CHAT] QA bank lookup failed: ${err.message}`);
      }

      // ── 2. Parent-child retrieval (Stage 2: fetch 15, then re-rank to top 3) ──
      let searchResults = [];
      let ragContext = '';
      let ragMeta = null;

      if (topic && apiKey) {
        try {
          // Prim-notation query expansion — ensures "7 prim 1" matches "7¹" etc.
          const searchQuery = expandQueryVariants(message);
          searchResults = await parentChildSearch(searchQuery, {
            category: topic,
            limit: 15,
            apiKey,
          });
          if (searchResults.length < 2) {
            console.warn(`[ADV CHAT] Topic-scoped parent-child retrieval underflow for "${topic}", retrying without category filter`);
            const broadResults = await parentChildSearch(searchQuery, {
              category: null,
              limit: 15,
              apiKey,
            });
            if (broadResults.length > searchResults.length) {
              searchResults = broadResults;
            }
          }

          // Stage 3: Re-rank with cross-encoder and keep top 3
          if (searchResults.length > 3) {
            try {
              // parentChildSearch returns objects with .childText — map to chunk_text for reranker
              const withChunkText = searchResults.map(r => ({ ...r, chunk_text: r.childText || r.parentText }));
              const reranked = await rerankChunks(searchQuery, withChunkText, { topK: 3 });
              searchResults = reranked;
            } catch (rerankErr) {
              console.warn(`[ADV CHAT] Reranker failed (${rerankErr.message}), using top 3`);
              searchResults = searchResults.slice(0, 3);
            }
          }

          ragContext = formatAdvancedContext(searchResults);

          ragMeta = {
            searchMode: searchResults.some(r => r.legacy) ? 'legacy-rrf' : 'parent-child+rerank',
            chunks: searchResults.length,
            sources: [...new Set(searchResults.map(r => r.lawName))].slice(0, 3),
          };
        } catch (err) {
          console.warn(`[ADV CHAT] Parent-child search failed: ${err.message}`);
          // Fall back to legacy RAG (which now includes re-ranking internally)
          try {
            const { retrieveLegalContext } = require('../api/server');
            if (typeof retrieveLegalContext === 'function') {
              const legacy = await retrieveLegalContext(message, topic);
              ragContext = typeof legacy === 'string' ? legacy : (legacy.context || '');
              ragMeta = legacy.meta || null;
            }
          } catch {
            console.warn('[ADV CHAT] Legacy RAG also failed');
          }
        }
      }

      // ── 3. Build advanced system prompt ──
      const LEGAL_TOPICS = {
        'konstitutsiya':      'Konstitutsiyaviy tuzum',
        'davlat-boshqaruvi':  'Davlat boshqaruvi',
        'fuqarolik':          'Fuqarolik qonunchiligi',
        'oila':               'Oila qonunchiligi',
        'mehnat':             "Mehnat va aholining bandligi",
        'ijtimoiy':           "Ijtimoiy ta'minot va ijtimoiy himoya",
        'moliya':             "Moliya va kredit",
        'soliq':              "Soliq qonunchiligi",
        'bank':               "Bank faoliyati",
        'uy-joy':             "Uy-joy qonunchiligi. Kommunal xo'jalik",
        'tadbirkorlik':       "Tadbirkorlik va xo'jalik faoliyati",
        'tashqi-iqtisod':     "Tashqi iqtisodiy faoliyat. Bojxona ishi",
        'ekologiya':          "Atrof tabiiy muhit va tabiiy resurslar",
        'axborot':            "Axborot va axborotlashtirish",
        'talim':              "Ta'lim. Fan. Madaniyat",
        'soglik':             "Sog'liqni saqlash. Sport. Turizm",
        'mudofaa':            'Mudofaa',
        'jinoyat':            'Jinoyat qonunchiligi',
        'mamuriy':            "Ma'muriy javobgarlik",
        'sudlov':             'Odil sudlov',
        'adliya':             'Prokuratura. Advokatura. Notariat. Adliya organlari',
        'xalqaro':            'Xalqaro munosabatlar. Xalqaro huquq',
        'shaxsiy':            "Shaxsiy tusdagi hujjatlar",
      };

      let systemPrompt = buildAdvancedPrompt({
        topic,
        topicLabel: LEGAL_TOPICS[topic] || topic || 'huquq',
        ragContext,
        fewShotBlock,
        retrievedChunks: searchResults,
        userQuestion: message,
      });
      // Inject korpus ground truth (sim 0.78-0.92) ABOVE the normal prompt
      if (korpusGroundTruth) {
        systemPrompt = korpusGroundTruth + '\n\n' + systemPrompt;
      }

      // ── 4. Build message array ──
      const aiMessages = [{ role: 'system', text: systemPrompt }];

      if (Array.isArray(history) && history.length > 0) {
        const recentHistory = history.length > 18 ? history.slice(-18) : history;
        recentHistory.forEach(msg => {
          aiMessages.push({
            role: msg.role === 'user' ? 'user' : 'model',
            text: msg.text || msg.content || '',
          });
        });
      }

      aiMessages.push({ role: 'user', text: message });

      // ── 5. Call AI ──
      const aiResult = await callAI(aiMessages, {
        useSearch: !ragContext,  // Only use Google Search if no RAG context
        maxTokens: 8192,
        temperature: 0.15,      // Lower temp for legal precision
      });

      res.json({
        reply: normalizeResponseForUser(aiResult.text),
        provider: aiResult.provider,
        ragUsed: !!ragContext,
        rag: ragMeta,
        fewShotCount: qaMatches.length,
      });

    } catch (error) {
      console.error('[ADV CHAT] Error:', error);
      res.status(500).json({ error: 'AI xatoligi: ' + error.message });
    }
  });

  // ══════════════════════════════════════
  // STRUCTURED INGESTION
  // ══════════════════════════════════════

  /**
   * POST /api/ingest-structured — Ingest a lex.uz URL using structural chunker
   * Body: { url, category, docId, lawName }
   * Auth: master admin
   */
  app.post('/api/ingest-structured', requireMasterAdmin, async (req, res) => {
    try {
      const { url, category, docId, lawName } = req.body;

      if (!url || !category) {
        return res.status(400).json({ error: 'url va category majburiy' });
      }

      await initAdvancedCorpus();

      // 1. Fetch HTML from lex.uz
      console.log(`[INGEST-V2] Fetching: ${url}`);
      const { httpGet } = require('./fetch-lex');

      // Use the lower-level function to get raw HTML
      const rawHtml = await (async () => {
        // Reuse the httpGet from fetch-lex module
        const https = require('https');
        const http = require('http');
        return new Promise((resolve, reject) => {
          const lib = url.startsWith('https') ? https : http;
          const r = lib.get(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'text/html,application/xhtml+xml',
              'Accept-Language': 'uz,ru;q=0.9,en;q=0.8',
            },
            timeout: 60000,
          }, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
              const next = response.headers.location.startsWith('http')
                ? response.headers.location
                : new URL(response.headers.location, url).href;
              response.resume();
              // One redirect
              const lib2 = next.startsWith('https') ? https : http;
              lib2.get(next, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 60000 }, (r2) => {
                const chunks = [];
                r2.on('data', c => chunks.push(c));
                r2.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
                r2.on('error', reject);
              }).on('error', reject);
              return;
            }
            if (response.statusCode !== 200) {
              response.resume();
              return reject(new Error(`HTTP ${response.statusCode}`));
            }
            const chunks = [];
            response.on('data', c => chunks.push(c));
            response.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
            response.on('error', reject);
          });
          r.on('error', reject);
          r.on('timeout', () => { r.destroy(); reject(new Error('Timeout')); });
        });
      })();

      // 2. Structural parse + chunk
      const finalDocId = docId || url.split('/').pop();
      const docMeta = {
        law_name: lawName || '',
        doc_id: finalDocId,
        source_url: url,
        category,
      };

      const chunks = chunkLegalDocumentStructured(rawHtml, docMeta, { isHtml: true });

      if (chunks.length === 0) {
        return res.status(400).json({ error: 'Hujjat matni topilmadi yoki strukturasi tanilmadi' });
      }

      // Enrich law_name from parsed title if not provided
      if (!lawName && chunks[0]?.metadata?.law_name) {
        docMeta.law_name = chunks[0].metadata.law_name;
      }

      // 3. Generate embeddings
      const apiKey = process.env.HF_TOKEN || process.env.GEMINI_API_KEY || process.env.GPT_API_KEY;
      let embeddedCount = 0;

      if (apiKey) {
        try {
          const texts = chunks.map(c => c.text);
          const embeddings = await getEmbeddingsBatch(texts, apiKey);
          for (let i = 0; i < chunks.length; i++) {
            chunks[i].embedding = embeddings[i];
            chunks[i].chunkIndex = i;
            embeddedCount++;
          }
        } catch (err) {
          console.warn(`[INGEST-V2] Embedding failed: ${err.message}`);
        }
      }

      // 4. Delete old chunks for this doc
      await deleteByDocId(finalDocId);

      // 5. Insert structured chunks
      const result = await insertStructuredChunks(chunks);

      // 6. Log ingestion
      await logIngest({
        sourceType: 'url',
        sourceUrl: url,
        lawName: docMeta.law_name,
        category,
        chunksTotal: chunks.length,
        embedded: embeddedCount,
        language: 'uz',
        status: 'ok',
        ingestBy: req.session.adminId,
      });

      // 7. Rebuild vector index
      try {
        await rebuildVectorIndex();
      } catch {
        // Non-fatal
      }

      res.json({
        ok: true,
        lawName: docMeta.law_name,
        chunks: chunks.length,
        parents: result.parents,
        children: result.children,
        embedded: embeddedCount,
      });

    } catch (error) {
      console.error('[INGEST-V2] Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  console.log('[ADV ROUTES] Advanced RAG routes mounted');
}

module.exports = { mountAdvancedRoutes };
