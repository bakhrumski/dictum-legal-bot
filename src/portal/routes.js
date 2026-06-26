'use strict';

/**
 * Portal API Routes — RESTful endpoints for Dictum AI Portal
 *
 * Base path: /api/portal
 *
 * Auth:
 *   POST /auth/register       — create account
 *   POST /auth/login           — get JWT tokens
 *   POST /auth/refresh          — refresh access token
 *   GET  /auth/me               — get current user profile
 *
 * Conversations:
 *   GET    /conversations       — list user's conversations
 *   POST   /conversations       — create new conversation
 *   GET    /conversations/:id   — get conversation with messages
 *   DELETE /conversations/:id   — delete conversation
 *
 * Chat:
 *   POST /chat                  — send message (JSON response)
 *   POST /chat/stream           — send message (SSE streaming)
 *
 * Documents:
 *   POST   /documents/upload    — upload document for analysis
 *   GET    /documents           — list user's documents
 *   GET    /documents/:id       — get document + analysis
 *   POST   /documents/:id/analyze — trigger analysis
 *
 * Agent Tasks:
 *   POST   /tasks               — create agentic task
 *   GET    /tasks               — list user's tasks
 *   GET    /tasks/:id           — get task status + output
 *   GET    /tasks/:id/stream    — SSE stream task progress
 *   POST   /tasks/:id/cancel    — cancel running task
 *
 * Admin:
 *   GET    /admin/users         — list all users
 *   PATCH  /admin/users/:id     — update user role/plan
 *   GET    /admin/stats          — platform statistics
 */

const express = require('express');
const multer = require('multer');
const os = require('os');
const fs = require('fs');
const { pool } = require('../database/db');
const { authenticate, authorize, generateTokens, verifyRefreshToken, registerUser, loginUser, getUserById, incrementQueryCount } = require('./auth');
const { PLAN_LIMITS } = require('./models');
const { processLegalChat, analyzeDocument, AGENT_TASK_TYPES, createAgentTask, executeAgentTask, callGroqStreaming, LEGAL_TOPICS } = require('./services');

const router = express.Router();

// ════════════════════════════════════════
// PER-USER CHAT RATE LIMITER (in-memory sliding window)
// ════════════════════════════════════════

const _chatWindows = new Map(); // userId → number[]  (request timestamps)
const CHAT_RATE_WINDOW_MS = 60_000;
const CHAT_RATE_MAX       = parseInt(process.env.CHAT_RATE_MAX || '20', 10);

function checkChatRateLimit(userId) {
  const now = Date.now();
  const ts  = (_chatWindows.get(userId) || []).filter(t => now - t < CHAT_RATE_WINDOW_MS);
  if (ts.length >= CHAT_RATE_MAX) {
    const err = new Error(`So'rovlar juda tez yuborildi. 1 daqiqada maksimum ${CHAT_RATE_MAX} ta so'rov.`);
    err.status = 429;
    throw err;
  }
  ts.push(now);
  _chatWindows.set(userId, ts);
}

// ════════════════════════════════════════
// FREE-ACCESS GATE — Telegram channel-join + weekly survey
// Free (trial) users get access in exchange for joining the channel and
// completing a survey 7 days after signup, instead of paying.
// ════════════════════════════════════════

const crypto = require('crypto');
const PAID_PLANS = new Set(['silver', 'gold', 'platinum']);
const SURVEY_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days after signup
const CHANNEL_REVERIFY_MS = 24 * 60 * 60 * 1000;  // re-check membership at most daily

// Lazy bot accessor (bot module is loaded by server before portal mounts)
function _bot() {
  try { return require('../bot/bot'); } catch (_) { return {}; }
}

// Is the user's channel membership currently OK? Uses a cached timestamp and
// re-checks live (via the bot) at most once per day. Updates the cache.
async function isChannelOk(user) {
  if (!user.telegram_user_id) return false;
  const cachedAt = user.channel_verified_at ? new Date(user.channel_verified_at).getTime() : 0;
  if (cachedAt && (Date.now() - cachedAt) < CHANNEL_REVERIFY_MS) return true;
  const { isChannelMember } = _bot();
  if (typeof isChannelMember !== 'function') return cachedAt > 0; // can't check → trust last known
  try {
    const ok = await isChannelMember(user.telegram_user_id);
    if (ok) {
      await pool.query('UPDATE portal_users SET channel_verified_at = NOW() WHERE id = $1', [user.id]);
      return true;
    }
    // Lost membership — clear the cached verification
    await pool.query('UPDATE portal_users SET channel_verified_at = NULL WHERE id = $1', [user.id]);
    return false;
  } catch (_) {
    return cachedAt > 0; // API hiccup → don't punish; trust last known
  }
}

// Decide the access state for a (full) portal_users row.
// Returns one of: 'paid' | 'free' | 'channel_required' | 'survey_required'
async function computeAccessState(user) {
  if (PAID_PLANS.has(user.plan)) return { state: 'paid' };
  const channelOk = await isChannelOk(user);
  if (!user.telegram_user_id || !channelOk) {
    return { state: 'channel_required', linked: !!user.telegram_user_id };
  }
  const signup = new Date(user.plan_started_at || user.created_at).getTime();
  if (Date.now() >= signup + SURVEY_GRACE_MS && !user.survey_completed_at) {
    return { state: 'survey_required' };
  }
  return { state: 'free' };
}

// Express middleware: block value-consuming endpoints unless access is allowed.
async function gateAccess(req, res, next) {
  try {
    const user = await getUserById(req.user.sub);
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    const acc = await computeAccessState(user);
    if (acc.state === 'paid' || acc.state === 'free') return next();
    return res.status(403).json({
      error: acc.state === 'survey_required'
        ? 'Bepul foydalanishni davom ettirish uchun qisqa so\'rovnomani to\'ldiring.'
        : 'Bepul foydalanish uchun rasmiy Telegram kanalimizga obuna bo\'ling.',
      code: acc.state === 'survey_required' ? 'SURVEY_REQUIRED' : 'CHANNEL_REQUIRED'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// File upload config
const docUpload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.originalname.match(/\.(pdf|txt|docx|doc)$/i) ||
      ['application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.mimetype);
    cb(ok ? null : new Error('Faqat PDF, TXT yoki DOCX'), !!ok);
  }
});

// ════════════════════════════════════════
// AUTH ENDPOINTS
// ════════════════════════════════════════

router.post('/auth/register', async (req, res) => {
  try {
    const { fullName, email, phone, password, firmName, plan } = req.body;
    if (!fullName || !email || !password) {
      return res.status(400).json({ error: 'fullName, email, password majburiy' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Parol kamida 8 belgi bo\'lishi kerak' });
    }

    const user = await registerUser({ fullName, email, phone, password, firmName, plan });
    const tokens = generateTokens(user);

    // Set refresh token as httpOnly cookie
    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.status(201).json({
      user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role, plan: user.plan },
      accessToken: tokens.accessToken
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email va parol kerak' });

    const user = await loginUser(email, password);
    const tokens = generateTokens(user);

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({
      user: { id: user.id, fullName: user.full_name, email: user.email, role: user.role, plan: user.plan },
      accessToken: tokens.accessToken
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/auth/refresh', async (req, res) => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!token) return res.status(401).json({ error: 'Refresh token kerak' });

    const decoded = verifyRefreshToken(token);
    const user = await getUserById(decoded.sub);
    if (!user || !user.is_active) return res.status(401).json({ error: 'Foydalanuvchi topilmadi' });

    const tokens = generateTokens(user);

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({ accessToken: tokens.accessToken });
  } catch (err) {
    res.status(401).json({ error: 'Token yaroqsiz' });
  }
});

router.get('/auth/me', authenticate, async (req, res) => {
  try {
    const user = await getUserById(req.user.sub);
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

    const planInfo = PLAN_LIMITS[user.plan] || PLAN_LIMITS.trial;
    res.json({
      id: user.id, fullName: user.full_name, email: user.email, phone: user.phone,
      firmName: user.firm_name, role: user.role,
      plan: { key: user.plan, name: planInfo.name, price: planInfo.price },
      usage: { queriesUsed: user.queries_used, queriesLimit: user.queries_limit },
      createdAt: user.created_at, lastLoginAt: user.last_login_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════
// FREE-ACCESS: status, Telegram link, survey
// ════════════════════════════════════════

// Current access state for the logged-in user (drives the frontend gate).
router.get('/access', authenticate, async (req, res) => {
  try {
    const user = await getUserById(req.user.sub);
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    const acc = await computeAccessState(user);
    const signup = new Date(user.plan_started_at || user.created_at).getTime();
    res.json({
      state: acc.state,
      plan: user.plan,
      telegramLinked: !!user.telegram_user_id,
      telegramUsername: user.telegram_username || null,
      channelVerified: !!user.channel_verified_at,
      surveyCompleted: !!user.survey_completed_at,
      surveyDueAt: new Date(signup + SURVEY_GRACE_MS).toISOString(),
      channel: (_bot().REQUIRED_CHANNEL || ''),
      channelUrl: (typeof _bot().channelLink === 'function' ? _bot().channelLink() : '')
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate a one-time code + Telegram deep link to link the account.
router.get('/telegram/link-code', authenticate, async (req, res) => {
  try {
    const code = crypto.randomBytes(12).toString('hex');
    await pool.query('UPDATE portal_users SET telegram_link_code = $1 WHERE id = $2', [code, req.user.sub]);
    let botUsername = process.env.BOT_USERNAME || '';
    if (!botUsername) {
      try {
        const me = await _bot().bot.getMe();
        botUsername = me.username;
      } catch (_) {}
    }
    const deepLink = botUsername ? `https://t.me/${botUsername}?start=plink_${code}` : null;
    res.json({ code, botUsername, deepLink });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Poll link/verification status (called after the user taps the deep link / joins).
router.get('/telegram/status', authenticate, async (req, res) => {
  try {
    const user = await getUserById(req.user.sub);
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
    const channelOk = await isChannelOk(user);
    const acc = await computeAccessState(user);
    res.json({
      telegramLinked: !!user.telegram_user_id,
      channelVerified: channelOk,
      state: acc.state
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Active survey questions for the user to answer on the web.
router.get('/survey/questions', authenticate, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, question_text, options FROM survey_questions
       WHERE is_active = TRUE ORDER BY position, id LIMIT 3`
    );
    res.json({ questions: r.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit survey answers. Body: { answers: [{ questionId, answer }] }
router.post('/survey/submit', authenticate, async (req, res) => {
  const { answers } = req.body;
  if (!Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ error: 'answers required' });
  }
  const client = await pool.connect();
  try {
    const user = await getUserById(req.user.sub);
    if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

    // Validate against the active question set
    const qres = await pool.query(
      `SELECT id, question_text, options FROM survey_questions WHERE is_active = TRUE`
    );
    const qById = new Map(qres.rows.map(q => [q.id, q]));

    await client.query('BEGIN');
    const sub = await client.query(
      'INSERT INTO survey_submissions (telegram_id, portal_user_id) VALUES ($1, $2) RETURNING id',
      [user.telegram_user_id || null, user.id]
    );
    const submissionId = sub.rows[0].id;
    for (const a of answers) {
      const q = qById.get(parseInt(a.questionId, 10));
      if (!q) continue;
      const ans = String(a.answer == null ? '' : a.answer).slice(0, 2000);
      await client.query(
        'INSERT INTO survey_answers (submission_id, question_id, question_text, answer_text) VALUES ($1,$2,$3,$4)',
        [submissionId, q.id, q.question_text, ans]
      );
    }
    await client.query('UPDATE portal_users SET survey_completed_at = NOW() WHERE id = $1', [user.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ════════════════════════════════════════
// CONVERSATIONS
// ════════════════════════════════════════

router.get('/conversations', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, topic, message_count, model_used, created_at, updated_at
       FROM portal_conversations WHERE user_id = $1 AND NOT is_archived
       ORDER BY updated_at DESC LIMIT 50`,
      [req.user.sub]
    );
    res.json({ conversations: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/conversations', authenticate, async (req, res) => {
  try {
    const { title, topic } = req.body;
    const result = await pool.query(
      `INSERT INTO portal_conversations (user_id, title, topic) VALUES ($1, $2, $3) RETURNING *`,
      [req.user.sub, title || null, topic || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/conversations/:id', authenticate, async (req, res) => {
  try {
    const conv = await pool.query(
      'SELECT * FROM portal_conversations WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.sub]
    );
    if (conv.rows.length === 0) return res.status(404).json({ error: 'Suhbat topilmadi' });

    const messages = await pool.query(
      'SELECT id, role, content, sources, model_used, duration_ms, is_verified, created_at FROM portal_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );

    res.json({ ...conv.rows[0], messages: messages.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/conversations/:id', authenticate, async (req, res) => {
  try {
    await pool.query(
      'UPDATE portal_conversations SET is_archived = TRUE WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.sub]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════
// CHAT (JSON + SSE STREAMING)
// ════════════════════════════════════════

router.post('/chat', authenticate, gateAccess, async (req, res) => {
  try {
    checkChatRateLimit(req.user.sub);
    await incrementQueryCount(req.user.sub);

    const { message, topic, conversationId, history } = req.body;
    if (!message) return res.status(400).json({ error: 'Xabar kerak' });

    const result = await processLegalChat({
      message, topic, conversationId, userId: req.user.sub, history: history || []
    });

    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/chat/stream', authenticate, gateAccess, async (req, res) => {
  // Rate-limit and quota checks must run before we switch to SSE headers,
  // otherwise the 429/400 JSON response can't be sent after writeHead(200).
  try {
    checkChatRateLimit(req.user.sub);
    await incrementQueryCount(req.user.sub);
  } catch (preErr) {
    return res.status(preErr.status || 500).json({ error: preErr.message });
  }

  try {
    const { message, topic, conversationId, history } = req.body;
    if (!message) return res.status(400).json({ error: 'Xabar kerak' });

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    res.write(`data: ${JSON.stringify({ type: 'start', topic })}\n\n`);

    const result = await processLegalChat({
      message, topic, conversationId, userId: req.user.sub,
      history: history || [],
      onChunk: (chunk) => {
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
      }
    });

    res.write(`data: ${JSON.stringify({ type: 'done', model: result.model, duration: result.duration, sources: result.sources || [], verification: result.verification || null })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.end();
  }
});

// ════════════════════════════════════════
// DOCUMENTS
// ════════════════════════════════════════

router.post('/documents/upload', authenticate, docUpload.single('document'), async (req, res) => {
  const filePath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ error: 'Fayl yuklanmadi' });

    let extractedText = '';
    const mime = req.file.mimetype;
    const name = req.file.originalname.toLowerCase();

    if (mime === 'application/pdf' || name.endsWith('.pdf')) {
      const pdfParse = require('pdf-parse');
      const buffer = fs.readFileSync(filePath);
      const parsed = await pdfParse(buffer);
      extractedText = parsed.text;
    } else if (mime === 'text/plain' || name.endsWith('.txt')) {
      extractedText = fs.readFileSync(filePath, 'utf-8');
    } else {
      try {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: filePath });
        extractedText = result.value;
      } catch {
        extractedText = fs.readFileSync(filePath, 'utf-8');
      }
    }

    const result = await pool.query(`
      INSERT INTO portal_documents (user_id, original_name, mime_type, file_size, extracted_text, page_count)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, original_name, mime_type, file_size, analysis_status, created_at
    `, [
      req.user.sub, req.file.originalname, req.file.mimetype,
      req.file.size, extractedText, Math.ceil(extractedText.length / 3000) || 1
    ]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (filePath) fs.unlink(filePath, () => {});
  }
});

router.get('/documents', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, original_name, mime_type, file_size, page_count, analysis_status, category, created_at
       FROM portal_documents WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.sub]
    );
    res.json({ documents: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/documents/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM portal_documents WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.sub]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Hujjat topilmadi' });
    const doc = result.rows[0];
    // Don't send full extracted_text to client — just metadata + analysis
    delete doc.extracted_text;
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/documents/:id/analyze', authenticate, async (req, res) => {
  try {
    await incrementQueryCount(req.user.sub);
    const analysis = await analyzeDocument(parseInt(req.params.id));
    res.json({ analysis });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ════════════════════════════════════════
// AGENT TASKS
// ════════════════════════════════════════

router.get('/tasks/types', authenticate, (req, res) => {
  const types = Object.entries(AGENT_TASK_TYPES).map(([key, val]) => ({
    key, name: val.name, steps: val.steps
  }));
  res.json({ types });
});

router.post('/tasks', authenticate, async (req, res) => {
  try {
    await incrementQueryCount(req.user.sub);
    const { taskType, input, conversationId } = req.body;
    if (!taskType || !input) return res.status(400).json({ error: 'taskType va input kerak' });

    const taskId = await createAgentTask(req.user.sub, taskType, input, conversationId);

    // Execute asynchronously
    executeAgentTask(taskId).catch(err => {
      console.error(`[PORTAL] Task ${taskId} failed:`, err.message);
    });

    res.status(201).json({ taskId, status: 'pending' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/tasks', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, task_type, status, current_step, total_steps, duration_ms, created_at, completed_at
       FROM portal_agent_tasks WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [req.user.sub]
    );
    res.json({ tasks: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tasks/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM portal_agent_tasks WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.sub]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Vazifa topilmadi' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SSE stream for task progress
router.get('/tasks/:id/stream', authenticate, async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const taskId = parseInt(req.params.id);
  let lastStep = 0;

  const interval = setInterval(async () => {
    try {
      const result = await pool.query(
        'SELECT status, current_step, total_steps, steps, task_output FROM portal_agent_tasks WHERE id = $1',
        [taskId]
      );
      if (result.rows.length === 0) {
        clearInterval(interval);
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Not found' })}\n\n`);
        res.end();
        return;
      }

      const task = result.rows[0];

      if (task.current_step > lastStep) {
        lastStep = task.current_step;
        res.write(`data: ${JSON.stringify({ type: 'progress', step: task.current_step, total: task.total_steps, steps: task.steps })}\n\n`);
      }

      if (task.status === 'completed' || task.status === 'failed') {
        clearInterval(interval);
        res.write(`data: ${JSON.stringify({ type: task.status, output: task.task_output })}\n\n`);
        res.end();
      }
    } catch {
      clearInterval(interval);
      res.end();
    }
  }, 1000);

  req.on('close', () => clearInterval(interval));
});

router.post('/tasks/:id/cancel', authenticate, async (req, res) => {
  try {
    await pool.query(
      `UPDATE portal_agent_tasks SET status = 'cancelled' WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'running')`,
      [req.params.id, req.user.sub]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════
// ADMIN ENDPOINTS
// ════════════════════════════════════════

router.get('/admin/users', authenticate, authorize('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, email, phone, firm_name, role, plan, queries_used, queries_limit,
              is_active, created_at, last_login_at
       FROM portal_users ORDER BY created_at DESC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/admin/users/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { role, plan, isActive, queriesLimit } = req.body;
    const updates = [];
    const params = [];
    let idx = 1;

    if (role) { updates.push(`role = $${idx++}`); params.push(role); }
    if (plan) {
      updates.push(`plan = $${idx++}`); params.push(plan);
      const limits = PLAN_LIMITS[plan];
      if (limits) { updates.push(`queries_limit = $${idx++}`); params.push(limits.queries); }
    }
    if (typeof isActive === 'boolean') { updates.push(`is_active = $${idx++}`); params.push(isActive); }
    if (typeof queriesLimit === 'number') { updates.push(`queries_limit = $${idx++}`); params.push(queriesLimit); }

    if (updates.length === 0) return res.status(400).json({ error: 'Yangilash ma\'lumotlari kerak' });

    params.push(req.params.id);
    await pool.query(`UPDATE portal_users SET ${updates.join(', ')} WHERE id = $${idx}`, params);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/stats', authenticate, authorize('admin'), async (req, res) => {
  try {
    const [users, convs, msgs, tasks, docs] = await Promise.all([
      pool.query(`SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE plan = 'trial') AS trial,
        COUNT(*) FILTER (WHERE plan = 'silver') AS silver,
        COUNT(*) FILTER (WHERE plan = 'gold') AS gold,
        COUNT(*) FILTER (WHERE plan = 'platinum') AS platinum,
        COUNT(*) FILTER (WHERE role = 'lawyer') AS lawyers,
        SUM(queries_used) AS total_queries
        FROM portal_users`),
      pool.query('SELECT COUNT(*) FROM portal_conversations'),
      pool.query('SELECT COUNT(*) FROM portal_messages'),
      pool.query(`SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'running') AS running
        FROM portal_agent_tasks`),
      pool.query('SELECT COUNT(*) FROM portal_documents')
    ]);

    res.json({
      users: users.rows[0],
      conversations: parseInt(convs.rows[0].count),
      messages: parseInt(msgs.rows[0].count),
      tasks: tasks.rows[0],
      documents: parseInt(docs.rows[0].count)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════
// FEEDBACK
// ════════════════════════════════════════

// Submit feedback (any authenticated user)
router.post('/feedback', authenticate, async (req, res) => {
  try {
    const { messageId, conversationId, rating, userQuestion, aiResponse, topic } = req.body;
    if (!rating || !['good', 'bad'].includes(rating)) {
      return res.status(400).json({ error: 'rating majburiy (good/bad)' });
    }

    const result = await pool.query(
      `INSERT INTO portal_feedback (user_id, message_id, conversation_id, rating, user_question, ai_response, topic, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'portal') RETURNING id`,
      [req.user.sub, messageId || null, conversationId || null, rating, userQuestion || null, aiResponse || null, topic || null]
    );

    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Feedback report — admin only
router.get('/admin/feedback', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { rating, reviewed, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];
    let idx = 1;

    if (rating) { conditions.push(`f.rating = $${idx++}`); params.push(rating); }
    if (reviewed === 'true') { conditions.push(`f.reviewed = TRUE`); }
    if (reviewed === 'false') { conditions.push(`f.reviewed = FALSE`); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const [rows, countResult] = await Promise.all([
      pool.query(
        `SELECT f.*, u.full_name AS user_name, u.email AS user_email
         FROM portal_feedback f
         LEFT JOIN portal_users u ON u.id = f.user_id
         ${where}
         ORDER BY f.created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, parseInt(limit), offset]
      ),
      pool.query(`SELECT COUNT(*) FROM portal_feedback f ${where}`, params)
    ]);

    res.json({
      feedback: rows.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / parseInt(limit))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Feedback stats — admin only
router.get('/admin/feedback/stats', authenticate, authorize('admin'), async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE rating = 'good') AS good,
        COUNT(*) FILTER (WHERE rating = 'bad') AS bad,
        COUNT(*) FILTER (WHERE reviewed = TRUE) AS reviewed,
        COUNT(*) FILTER (WHERE reviewed = FALSE) AS pending_review,
        COUNT(*) FILTER (WHERE review_result = 'confirmed_good') AS confirmed_good,
        COUNT(*) FILTER (WHERE review_result = 'confirmed_bad') AS confirmed_bad,
        COUNT(*) FILTER (WHERE review_result = 'corrected') AS corrected
      FROM portal_feedback
    `);

    // Per-topic breakdown
    const byTopic = await pool.query(`
      SELECT topic, rating, COUNT(*) AS count
      FROM portal_feedback
      WHERE topic IS NOT NULL
      GROUP BY topic, rating
      ORDER BY topic
    `);

    res.json({ ...stats.rows[0], byTopic: byTopic.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Review a feedback item — admin only
router.patch('/admin/feedback/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { reviewResult, reviewerNote } = req.body;
    if (!reviewResult || !['confirmed_good', 'confirmed_bad', 'corrected'].includes(reviewResult)) {
      return res.status(400).json({ error: 'reviewResult kerak (confirmed_good/confirmed_bad/corrected)' });
    }

    await pool.query(
      `UPDATE portal_feedback SET reviewed = TRUE, review_result = $1, reviewer_note = $2 WHERE id = $3`,
      [reviewResult, reviewerNote || null, req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════
// REFERENCE DATA
// ════════════════════════════════════════

router.get('/topics', (req, res) => {
  res.json({ topics: Object.entries(LEGAL_TOPICS).map(([key, name]) => ({ key, name })) });
});

router.get('/plans', (req, res) => {
  res.json({ plans: Object.entries(PLAN_LIMITS).map(([key, val]) => ({ key, ...val })) });
});

module.exports = router;
