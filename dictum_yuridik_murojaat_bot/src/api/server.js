require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');
const os = require('os');
const fs = require('fs');
const { pool } = require('../database/db');

// Shared in-memory store for Telegram verification codes (used by bot.js too)
const { verificationTokens } = require('../verification-store');
const crypto = require('crypto');
const { initLegalDataset, retrieveSimilarExamples, formatExamplesForPrompt, addExample, updateExample, deleteExample, getAllExamples, getDatasetStats } = require('../dataset/legal-dataset');
const { initFeedbackDataset, saveMentorFeedback, retrieveFeedbackExamples, formatFeedbackForPrompt, getFeedbackStats, getAllFeedback } = require('../dataset/feedback-dataset');
const { classifyLegalField, formatClassificationForPrompt } = require('../agents/classifier');
const { initCaseLawDataset, retrieveSimilarCases, formatCasesForPrompt, addCase, updateCase, deleteCase, getAllCases, getCaseLawStats } = require('../dataset/case-law-dataset');

// Multer config for registration document uploads
const regUpload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype);
    cb(ok ? null : new Error('Faqat JPG, PNG, WebP yoki PDF'), ok);
  }
});

// yurxizmat.uz document template catalog (verified URLs)
const YURXIZMAT_CATALOG = [
  { cat: 'Shartnomalar', url: '/uz/category/contracts', subs: [
    { name: 'Yuridik shaxslarga oid shartnomalar', url: '/uz/category/for-juridical-contracts' },
    { name: "Ko'chmas mulkka oid shartnomalar", url: '/uz/category/real-estate-contracts' },
    { name: 'Avtotransportlarga oid shartnomalar', url: '/uz/category/contracts-for-auto' },
    { name: "Mahsulot sotish, xizmat ko'rsatish", url: '/uz/category/services-contract' },
    { name: 'Boshqa turdagi shartnomalar', url: '/uz/category/other-types-of-contracts' },
    { name: 'Kelishuvlar', url: '/uz/category/agreements' },
    { name: 'Bitimlar', url: '/uz/category/deals' },
    { name: 'Ishonchnomalar', url: '/uz/category/power-of-attorneys' }
  ]},
  { cat: 'Arizalar', url: '/uz/category/statements', subs: [
    { name: 'Yuridik shaxslarga oid arizalar', url: '/uz/category/applications-for-legal' },
    { name: 'Jismoniy shaxslarga oid arizalar', url: '/uz/category/applications-for-individuals' },
    { name: 'Bolalarga oid arizalar', url: '/uz/category/for-kids' },
    { name: 'Iltimosnomalar', url: '/uz/category/petitions' }
  ]},
  { cat: 'Shaxsiy tarkibga oid hujjatlar', url: '/uz/category/personal-documents', subs: [
    { name: 'Arizalar', url: '/uz/category/personal-applications' },
    { name: 'Bildirishnomalar', url: '/uz/category/notifications' },
    { name: 'Buyruqlar', url: '/uz/category/commands' },
    { name: 'Dalolatnamalar', url: '/uz/category/acts' },
    { name: 'Kelishuvlar va shartnomalar', url: '/uz/category/personal-agreements' },
    { name: 'Boshqa hujjatlar', url: '/uz/category/other-documents' }
  ]},
  { cat: 'Notarial hujjatlar', url: '/uz/category/notarial', subs: [
    { name: 'Meros va vasiyatnoma arizalari', url: '/uz/category/notarial-inheritance' },
    { name: "Ko'chmas mulk rasmiylash.", url: '/uz/category/notarial-registration' },
    { name: 'Avtotransport rasmiylash.', url: '/uz/category/notarial-auto' },
    { name: 'Nikoh va oila masalalari', url: '/uz/category/notarial-wedding' },
    { name: 'Boshqa notarial arizalar', url: '/uz/category/notarial-others' },
    { name: 'Vasiyatnamalar', url: '/uz/category/wills' },
    { name: 'Notarial ishonchnomalar', url: '/uz/category/notarial-credentials' },
    { name: 'Ayirboshlash shartnomasi', url: '/uz/category/contracts-con' },
    { name: 'Garov shartnomasi', url: '/uz/category/contracts-bail' },
    { name: 'Ijara shartnomasi', url: '/uz/category/contracts-rent' },
    { name: 'Ipoteka shartnomasi', url: '/uz/category/contracts-mortgage' },
    { name: 'Qarz shartnomasi', url: '/uz/category/contracts-debt' },
    { name: 'Merosga oid shartnomalar', url: '/uz/category/contracts-heritage' },
    { name: 'Renta shartnomasi', url: '/uz/category/contracts-rent-agreement' },
    { name: 'Hadya shartnomasi', url: '/uz/category/contracts-gift-agreement' },
    { name: 'Oilaviy munosabatlar', url: '/uz/category/contracts-family' },
    { name: 'Oldi-sotdi shartnomasi', url: '/uz/category/contracts-buy' },
    { name: 'Boshqa notarial shartnomalar', url: '/uz/category/contracts-other-documents' }
  ]},
  { cat: 'Sudga oid hujjatlar', url: '/uz/category/court', subs: [
    { name: "Da'vo arizalari (mehnat)", url: '/uz/category/claims-t' },
    { name: "Da'vo arizalari (uy-joy)", url: '/uz/category/claims-home' },
    { name: "Da'vo arizalari (oilaviy)", url: '/uz/category/claims-family' },
    { name: "Da'vo arizalari (zarar)", url: '/uz/category/claims-harm' },
    { name: "Da'vo arizalari (meros)", url: '/uz/category/claims-testament' },
    { name: "Da'vo arizalari (avto)", url: '/uz/category/claims-auto' },
    { name: "Da'vo arizalari (boshqa)", url: '/uz/category/claims-others' },
    { name: 'Sud hujjatlaridan nusxa', url: '/uz/category/apply-court-copy' },
    { name: 'Talablarga aniqlik kiritish', url: '/uz/category/apply-court-update' },
    { name: "Ta'minlash choralari", url: '/uz/category/claims-note' },
    { name: "Ishlarni qayta ko'rib chiqish", url: '/uz/category/court-back' },
    { name: 'Sud qarorining ijrosi', url: '/uz/category/court-decree' },
    { name: 'Boshqa sud arizalari', url: '/uz/category/court-others' },
    { name: 'Apellyatsiya, kassatsiya', url: '/uz/category/appeals-cassation-complaints' },
    { name: 'Bayonnomalar', url: '/uz/category/corporate-protocols' },
    { name: 'Sud iltimosnomalar', url: '/uz/category/court-petitions' }
  ]},
  { cat: 'Korporativ hujjatlar', url: '/uz/category/corporate-documents', subs: [
    { name: 'Talablar', url: '/uz/category/corporate-demands' },
    { name: 'Nizomlar', url: '/uz/category/corporate-u' },
    { name: 'Dalolatnamalar va bayonnomalar', url: '/uz/category/corporate-acts' },
    { name: 'Boshqa korporativ hujjatlar', url: '/uz/category/corporate-other-documents' }
  ]}
];

function getYurxizmatCatalogText() {
  return YURXIZMAT_CATALOG.map(c =>
    `${c.cat} (${c.url}):\n` + c.subs.map(s => `  - ${s.name}: ${s.url}`).join('\n')
  ).join('\n');
}

const app = express();
const PORT = process.env.PORT || 3000;

// Prevent process crashes from unhandled errors
process.on('unhandledRejection', (err) => {
  console.error('[PROCESS] Unhandled rejection:', err.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('[PROCESS] Uncaught exception:', err.message || err);
});

// Import bot from bot.js (created with polling: false)
const { bot } = require('../bot/bot');

// Catch ALL bot errors to prevent crashes
bot.on('error', (err) => {
  console.error('[BOT] Bot error:', err.message || err);
});
bot.on('polling_error', (err) => {
  console.error('[BOT] Polling error:', err.message || err);
});
bot.on('webhook_error', (err) => {
  console.error('[BOT] Webhook error:', err.message || err);
});

// Detect environment
const WEBHOOK_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.WEBHOOK_DOMAIN;
const IS_RAILWAY = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_SERVICE_NAME || process.env.PORT === '8080');

console.log('[BOT] Environment:', IS_RAILWAY ? 'Railway' : 'Local');
console.log('[BOT] RAILWAY_PUBLIC_DOMAIN:', process.env.RAILWAY_PUBLIC_DOMAIN || 'NOT SET');
console.log('[BOT] WEBHOOK_DOMAIN:', WEBHOOK_DOMAIN || 'NOT SET');
console.log('[BOT] PORT:', PORT);

if (WEBHOOK_DOMAIN) {
  // Production: webhook mode — no polling at all
  const secretPath = `/webhook/${process.env.TELEGRAM_BOT_TOKEN}`;
  app.post(secretPath, express.json(), (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
  bot.deleteWebHook().then(() => {
    return bot.setWebHook(`https://${WEBHOOK_DOMAIN}${secretPath}`);
  }).then(() => {
    console.log('[BOT] Webhook active:', WEBHOOK_DOMAIN);
  }).catch(err => {
    console.error('[BOT] Webhook setup failed:', err.message);
  });
} else if (IS_RAILWAY) {
  // On Railway but no public domain — do NOT poll
  console.error('[BOT] WARNING: On Railway but no WEBHOOK_DOMAIN set!');
  console.error('[BOT] Bot messages will not work until domain is configured.');
  console.error('[BOT] Set WEBHOOK_DOMAIN env var to your Railway domain.');
} else {
  // Local development only — safe to poll
  bot.startPolling();
  console.log('[BOT] Polling mode (local dev)');
}

// Health check endpoint for Railway
app.get('/health', (req, res) => res.status(200).send('OK'));


app.use(cors());
app.use(express.json());

// Session configuration — PostgreSQL store survives server restarts
app.use(session({
  store: new pgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true
  }),
  secret: process.env.JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Serve static files
app.use(express.static('public'));

// Authentication middleware
function requireAuth(req, res, next) {
  if (req.session.isAuthenticated) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

function requireMasterAdmin(req, res, next) {
  if (req.session.isAuthenticated && req.session.role === 'master') {
    next();
  } else {
    res.status(403).json({ error: 'Master admin access required' });
  }
}

// Format anonymous ID: #userOrdinal_MM_YY_seq
function anonId(userId, dateStr, seq) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const seqStr = String(seq || 1).padStart(2, '0');
  return `#${userId}_${mm}_${yy}_${seqStr}`;
}

// Short anonymous label (without seq): #userOrdinal_MM_YY
function anonLabel(userId, dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `#${userId}_${mm}_${yy}`;
}

// Anonymize applicant personal info for non-master users
function anonymizeRequest(row, role) {
  if (role === 'master') return row;
  return {
    ...row,
    first_name: `Murojaatchi ${anonId(row.user_id, row.created_at, row.user_request_seq)}`,
    username: null,
    telegram_id: null,
    blocked: false,
    blocked_at: null,
    block_reason: null
  };
}

// Activity tracking middleware - updates last_active_at on every authenticated request
function trackActivity(req, res, next) {
  if (req.session && req.session.isAuthenticated && req.session.adminId) {
    pool.query(
      'UPDATE admins SET last_active_at = NOW() WHERE id = $1',
      [req.session.adminId]
    ).catch(err => console.error('Activity tracking error:', err));
  }
  next();
}
app.use(trackActivity);

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    // Strip @ prefix and make case-insensitive (users may enter Telegram-style username)
    const cleanUsername = (username || '').replace(/^@/, '').trim();
    const result = await pool.query(
      'SELECT * FROM admins WHERE LOWER(username) = LOWER($1)',
      [cleanUsername]
    );

    if (result.rows.length > 0) {
      const admin = result.rows[0];

      // Compare password with hashed password
      const passwordMatch = await bcrypt.compare(password, admin.password);

      if (passwordMatch) {
        req.session.isAuthenticated = true;
        req.session.role = admin.role;
        req.session.adminId = admin.id;
        req.session.username = admin.username;
        req.session.fullName = admin.full_name;

        res.json({
          success: true,
          role: admin.role,
          fullName: admin.full_name
        });
      } else {
        res.status(401).json({ error: 'Noto\'g\'ri foydalanuvchi nomi yoki parol' });
      }
    } else {
      res.status(401).json({ error: 'Noto\'g\'ri foydalanuvchi nomi yoki parol' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get current user info
app.get('/api/user-info', requireAuth, (req, res) => {
  res.json({
    adminId: req.session.adminId,
    username: req.session.username,
    role: req.session.role,
    fullName: req.session.fullName
  });
});

// Redirect root
app.get('/', (req, res) => {
  if (req.session.isAuthenticated) {
    res.redirect('/dashboard.html');
  } else {
    res.redirect('/login.html');
  }
});

// Get request stats
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const role = req.session.role;
    const aid = parseInt(req.session.adminId);
    const assignedFilter = (role === 'student' || role === 'lawyer') ? `WHERE assigned_to = ${aid}` : '';
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
        COUNT(*) FILTER (WHERE status = 'student_responded') AS student_responded,
        COUNT(*) FILTER (WHERE status = 'answered') AS answered
      FROM requests
      ${assignedFilter}
    `);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get all requests
app.get('/api/requests', requireAuth, async (req, res) => {
  try {
    // Lawyers and students only see requests assigned to them
    const role = req.session.role;
    const aid = parseInt(req.session.adminId);
    const assignedFilter = (role === 'student' || role === 'lawyer') ? `WHERE (r.assigned_to = ${aid} OR EXISTS (SELECT 1 FROM request_students rs2 WHERE rs2.request_id = r.id AND rs2.student_id = ${aid}))` : '';
    const result = await pool.query(`
      SELECT
        r.id,
        r.user_id,
        r.category,
        r.request_text,
        r.request_type,
        r.file_id,
        r.file_size,
        r.file_name,
        r.status,
        r.response_text,
        r.student_response,
        r.responded_by,
        r.master_approved,
        r.assigned_to,
        r.assigned_at,
        r.created_at,
        r.answered_at,
        u.telegram_id,
        u.username,
        u.first_name,
        u.blocked,
        u.blocked_at,
        u.block_reason,
        a.full_name as assigned_lawyer_name,
        COALESCE(
          (SELECT json_agg(json_build_object('id', adm.id, 'full_name', adm.full_name, 'assigned_at', rs.assigned_at))
           FROM request_students rs JOIN admins adm ON rs.student_id = adm.id WHERE rs.request_id = r.id),
          '[]'::json
        ) as assigned_students,
        r.triage_result,
        r.verification_result,
        ROW_NUMBER() OVER (PARTITION BY r.user_id ORDER BY r.created_at) as user_request_seq,
        (SELECT aa.id FROM ai_analyses aa WHERE aa.request_id = r.id ORDER BY aa.created_at DESC LIMIT 1) as ai_analysis_id
      FROM requests r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN admins a ON r.assigned_to = a.id
      ${assignedFilter}
      ORDER BY r.created_at ASC
    `);

    const rows = result.rows.map(r => anonymizeRequest(r, req.session.role));
    res.json(rows);
  } catch (error) {
    console.error('Error fetching requests:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get single request
app.get('/api/requests/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT
        r.id,
        r.user_id,
        r.category,
        r.request_text,
        r.request_type,
        r.file_id,
        r.file_size,
        r.file_name,
        r.status,
        r.response_text,
        r.student_response,
        r.responded_by,
        r.master_approved,
        r.assigned_to,
        r.assigned_at,
        r.created_at,
        r.answered_at,
        u.telegram_id,
        u.username,
        u.first_name,
        u.blocked,
        u.blocked_at,
        u.block_reason,
        a.full_name as assigned_lawyer_name,
        COALESCE(
          (SELECT json_agg(json_build_object('id', adm.id, 'full_name', adm.full_name, 'assigned_at', rs.assigned_at))
           FROM request_students rs JOIN admins adm ON rs.student_id = adm.id WHERE rs.request_id = r.id),
          '[]'::json
        ) as assigned_students,
        r.triage_result,
        r.verification_result,
        (SELECT COUNT(*) FROM requests r2 WHERE r2.user_id = r.user_id AND r2.id <= r.id) as user_request_seq,
        (SELECT aa.id FROM ai_analyses aa WHERE aa.request_id = r.id ORDER BY aa.created_at DESC LIMIT 1) as ai_analysis_id
      FROM requests r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN admins a ON r.assigned_to = a.id
      WHERE r.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    res.json(anonymizeRequest(result.rows[0], req.session.role));
  } catch (error) {
    console.error('Error fetching request:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get file from Telegram
app.get('/api/files/:fileId', requireAuth, async (req, res) => {
  try {
    const { fileId } = req.params;
    const fileLink = await bot.getFileLink(fileId);
    res.json({ fileLink });
  } catch (error) {
    console.error('Error getting file:', error);
    res.status(500).json({ error: 'Failed to get file' });
  }
});

// Student submits response (doesn't send to client yet)
app.post('/api/student-response', requireAuth, async (req, res) => {
  try {
    const { requestId, responseText } = req.body;
    
    // Update request with student response
    await pool.query(`
      UPDATE requests 
      SET student_response = $1, 
          status = 'student_responded',
          student_admin_id = $3,
          responded_by = $4
      WHERE id = $2
    `, [responseText, requestId, req.session.adminId, req.session.fullName]);
    
    // Notify master admin on Telegram
    try {
      const requestDetails = await pool.query(`
        SELECT u.username, u.first_name, r.request_text, r.category
        FROM requests r
        JOIN users u ON r.user_id = u.id
        WHERE r.id = $1
      `, [requestId]);
      
      if (requestDetails.rows.length > 0) {
        const { username, first_name, request_text, category } = requestDetails.rows[0];
        const masterNotification = `
🔔 Student admindan yangi javob!

👤 Foydalanuvchi: ${first_name} (@${username})
✍️ Student: ${req.session.fullName}
📂 Yo'nalish: ${category}

📝 Murojaat:
${request_text.substring(0, 100)}...

📝 Student javobi:
${responseText.substring(0, 100)}...

Dashboard: ${process.env.DASHBOARD_URL || 'http://localhost:3000'}
Tasdiqlash uchun dashboardga kiring!
        `;
        
        await bot.sendMessage(process.env.ADMIN_TELEGRAM_ID, masterNotification);
      }
    } catch (error) {
      console.error('Failed to notify master admin:', error);
    }
    
    res.json({ success: true, message: 'Response submitted for approval' });
    
  } catch (error) {
    console.error('Error submitting student response:', error);
    res.status(500).json({ error: 'Failed to submit response' });
  }
});

// Master admin approves response (sends to client)
app.post('/api/approve-response', requireMasterAdmin, async (req, res) => {
  try {
    const { requestId, feedbackType, correctedAnswer, correctedReasoning, correctedArticles } = req.body;
    
    // Get request details
    const requestResult = await pool.query(`
      SELECT 
        u.telegram_id, 
        u.username,
        u.first_name, 
        r.student_response,
        r.request_text,
        r.category,
        r.response_text as ai_response
      FROM requests r
      JOIN users u ON r.user_id = u.id
      WHERE r.id = $1
    `, [requestId]);
    
    if (requestResult.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    const { telegram_id, first_name, student_response, request_text, category, ai_response } = requestResult.rows[0];
    
    // Use corrected answer if provided, otherwise use student response
    const finalResponse = (feedbackType && feedbackType !== 'correct' && correctedAnswer) ? correctedAnswer : student_response;
    
    // Update database
    await pool.query(`
      UPDATE requests 
      SET response_text = $2,
          status = 'answered',
          master_approved = TRUE,
          answered_at = NOW(),
          responded_by = $3
      WHERE id = $1
    `, [requestId, finalResponse, req.session.fullName]);
    
    // Save mentor feedback to learning dataset
    if (feedbackType) {
      try {
        await saveMentorFeedback({
          request_id: requestId,
          question: request_text,
          ai_answer: ai_response || student_response,
          mentor_feedback_type: feedbackType,
          corrected_answer: correctedAnswer || '',
          corrected_legal_reasoning: correctedReasoning || '',
          corrected_law_articles: correctedArticles || '',
          legal_field: category || 'Umumiy',
          mentor_id: req.session.adminId,
          mentor_name: req.session.fullName
        });
      } catch (fbErr) {
        console.error('[FEEDBACK] Save error (non-critical):', fbErr.message);
      }
    }
    
    // Send to client
    const message = `✅ Yuristdan javob keldi!

Hurmatli ${first_name},

${finalResponse}

Dictum advokatlik firmasi`;
    await bot.sendMessage(telegram_id, message);
    
    res.json({ success: true, message: 'Response approved and sent to client' });
    
  } catch (error) {
    console.error('Error approving response:', error);
    res.status(500).json({ error: 'Failed to approve response' });
  }
});

// Master admin rejects response
app.post('/api/reject-response', requireMasterAdmin, async (req, res) => {
  try {
    const { requestId, reason } = req.body;
    
    // Update status back to pending
    await pool.query(`
      UPDATE requests 
      SET status = 'rejected',
          student_response = student_response || E'\n\n--- REJECTED ---\nReason: ' || $2
      WHERE id = $1
    `, [requestId, reason || 'No reason provided']);
    
    res.json({ success: true, message: 'Response rejected' });
    
  } catch (error) {
    console.error('Error rejecting response:', error);
    res.status(500).json({ error: 'Failed to reject response' });
  }
});

// Master admin sends direct response (bypasses student)
app.post('/api/master-response', requireMasterAdmin, async (req, res) => {
  try {
    const { requestId, responseText } = req.body;
    
    const requestResult = await pool.query(`
      SELECT u.telegram_id, u.username, u.first_name
      FROM requests r
      JOIN users u ON r.user_id = u.id
      WHERE r.id = $1
    `, [requestId]);
    
    if (requestResult.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    const { telegram_id, username, first_name } = requestResult.rows[0];
    
    await pool.query(`
      UPDATE requests 
      SET response_text = $1, 
          status = 'answered', 
          master_approved = TRUE,
          answered_at = NOW(),
          responded_by = $3
      WHERE id = $2
    `, [responseText, requestId, req.session.fullName]);
    
    const message = `
✅ Yuristdan javob keldi!

Hurmatli ${first_name},

${responseText}

Dictum advokatlik firmasi
    `;
    
    await bot.sendMessage(telegram_id, message);
    
    res.json({ success: true, message: 'Response sent successfully' });
    
  } catch (error) {
    console.error('Error sending master response:', error);
    res.status(500).json({ error: 'Failed to send response' });
  }
});

// Get all admins (for assignment dropdown + admin management)
app.get('/api/admins', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, username, full_name, role, telegram_username, duty_start, duty_end, last_active_at, created_at,
        CASE
          WHEN last_active_at IS NOT NULL
               AND last_active_at > NOW() - INTERVAL '15 minutes'
          THEN true
          ELSE false
        END AS is_active
      FROM admins
      ORDER BY role DESC, full_name
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching admins:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Update admin timeslot (duty hours)
app.put('/api/admins/:id/timeslot', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { duty_start, duty_end } = req.body;

    // Authorization: admin can only update their own, master can update anyone
    if (req.session.role !== 'master' && req.session.adminId !== parseInt(id)) {
      return res.status(403).json({ error: 'Faqat o\'z smenangizni o\'zgartira olasiz' });
    }

    // Validate time format (HH:MM)
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (duty_start && !timeRegex.test(duty_start)) {
      return res.status(400).json({ error: 'duty_start formati noto\'g\'ri (HH:MM)' });
    }
    if (duty_end && !timeRegex.test(duty_end)) {
      return res.status(400).json({ error: 'duty_end formati noto\'g\'ri (HH:MM)' });
    }

    await pool.query(
      'UPDATE admins SET duty_start = $1, duty_end = $2 WHERE id = $3',
      [duty_start || null, duty_end || null, id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating timeslot:', error);
    res.status(500).json({ error: 'Ish vaqtini yangilab bo\'lmadi' });
  }
});

// Create new admin (master only)
app.post('/api/admins', requireMasterAdmin, async (req, res) => {
  try {
    const { username, password, full_name, role } = req.body;
    if (!username || !password || !full_name || !role) {
      return res.status(400).json({ error: 'Barcha maydonlar to\'ldirilishi shart' });
    }
    if (!['master', 'student'].includes(role)) {
      return res.status(400).json({ error: 'Rol faqat master yoki student bo\'lishi mumkin' });
    }
    const existing = await pool.query('SELECT id FROM admins WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Bu username allaqachon mavjud' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO admins (username, password, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id, username, full_name, role, created_at',
      [username, hashedPassword, full_name, role]
    );
    res.json({ success: true, admin: result.rows[0] });
  } catch (error) {
    console.error('Error creating admin:', error);
    res.status(500).json({ error: 'Admin yaratib bo\'lmadi' });
  }
});

// Update admin (master only)
app.put('/api/admins/:id', requireMasterAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, username, password, role } = req.body;
    if (!full_name || !username || !role) {
      return res.status(400).json({ error: 'Ism, username va rol to\'ldirilishi shart' });
    }
    if (!['master', 'student'].includes(role)) {
      return res.status(400).json({ error: 'Rol faqat master yoki student bo\'lishi mumkin' });
    }
    // Check username uniqueness (excluding current admin)
    const existing = await pool.query('SELECT id FROM admins WHERE username = $1 AND id != $2', [username, id]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Bu username allaqachon mavjud' });
    }
    if (password && password.length > 0) {
      if (password.length < 6) {
        return res.status(400).json({ error: 'Parol kamida 6 ta belgidan iborat bo\'lishi kerak' });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      await pool.query(
        'UPDATE admins SET full_name = $1, username = $2, password = $3, role = $4 WHERE id = $5',
        [full_name, username, hashedPassword, role, id]
      );
    } else {
      await pool.query(
        'UPDATE admins SET full_name = $1, username = $2, role = $3 WHERE id = $4',
        [full_name, username, role, id]
      );
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating admin:', error);
    res.status(500).json({ error: 'Admin yangilab bo\'lmadi' });
  }
});

// Delete admin (master only)
app.delete('/api/admins/:id', requireMasterAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = parseInt(id);
    // Prevent deleting yourself
    if (adminId === req.session.adminId) {
      return res.status(400).json({ error: 'O\'zingizni o\'chira olmaysiz' });
    }
    // Check if admin exists
    const adminCheck = await pool.query('SELECT id, full_name FROM admins WHERE id = $1', [adminId]);
    if (adminCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Admin topilmadi' });
    }
    // Delete the admin (FK constraints have ON DELETE SET NULL/CASCADE)
    await pool.query('DELETE FROM admins WHERE id = $1', [adminId]);
    res.json({ success: true, deleted: adminCheck.rows[0].full_name });
  } catch (error) {
    console.error('Error deleting admin:', error.message, error.detail || '');
    res.status(500).json({ error: 'Admin o\'chirib bo\'lmadi: ' + error.message });
  }
});

// Get rankings data
app.get('/api/rankings', requireAuth, async (req, res) => {
  try {
    // Lawyer rankings: admins with role='master', count answered requests
    const lawyerResult = await pool.query(`
      SELECT a.id, a.full_name, a.username,
        COUNT(CASE WHEN r.status = 'answered' AND r.responded_by = a.full_name THEN 1 END) AS answered_count,
        COUNT(CASE WHEN r.assigned_to = a.id THEN 1 END) AS assigned_count,
        AVG(CASE WHEN r.status = 'answered' AND r.responded_by = a.full_name AND r.answered_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (r.answered_at - r.created_at)) / 3600.0 END) AS avg_hours
      FROM admins a
      LEFT JOIN requests r ON r.assigned_to = a.id OR r.responded_by = a.full_name
      WHERE a.role = 'master'
      GROUP BY a.id, a.full_name, a.username
      ORDER BY answered_count DESC, avg_hours ASC
    `);

    // Student rankings
    const studentResult = await pool.query(`
      SELECT a.id, a.full_name, a.username,
        COUNT(CASE WHEN r.student_admin_id = a.id THEN 1 END) AS response_count,
        COUNT(CASE WHEN r.status = 'answered' AND r.responded_by = a.full_name THEN 1 END) AS approved_count,
        AVG(CASE WHEN r.student_admin_id = a.id AND r.answered_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (r.answered_at - r.created_at)) / 3600.0 END) AS avg_hours
      FROM admins a
      LEFT JOIN requests r ON r.student_admin_id = a.id OR r.responded_by = a.full_name
      WHERE a.role = 'student'
      GROUP BY a.id, a.full_name, a.username
      ORDER BY response_count DESC, avg_hours ASC
    `);

    // Compute star ratings (scale 1-5 relative to team max)
    const computeStars = (rows, countField) => {
      const maxCount = Math.max(...rows.map(r => parseInt(r[countField]) || 0), 1);
      return rows.map(r => ({
        ...r,
        stars: Math.max(1, Math.round((parseInt(r[countField]) || 0) / maxCount * 5))
      }));
    };

    res.json({
      lawyers: computeStars(lawyerResult.rows, 'answered_count'),
      students: computeStars(studentResult.rows, 'response_count')
    });
  } catch (error) {
    console.error('Error fetching rankings:', error);
    res.status(500).json({ error: 'Reyting ma\'lumotlarini olishda xatolik' });
  }
});

// Get request stats for a specific admin
app.get('/api/admin-stats/:id', requireAuth, async (req, res) => {
  try {
    const adminId = parseInt(req.params.id);
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM requests WHERE assigned_to = $1) AS assigned_count,
        (SELECT COUNT(*) FROM requests WHERE assigned_to = $1 AND status = 'answered') AS answered_count,
        (SELECT COUNT(*) FROM requests WHERE student_admin_id = $1) AS student_response_count,
        (SELECT COUNT(*) FROM requests WHERE responded_by = (SELECT full_name FROM admins WHERE id = $1) AND status = 'answered') AS responded_count
    `, [adminId]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ error: 'Statistika olishda xatolik' });
  }
});

// Monte Carlo simulation data
app.get('/api/monte-carlo', requireAuth, async (req, res) => {
  try {
    // Daily request counts for past 60 days
    const dailyResult = await pool.query(`
      SELECT DATE(created_at) as day, COUNT(*) as count
      FROM requests
      WHERE created_at >= NOW() - INTERVAL '60 days'
      GROUP BY DATE(created_at)
      ORDER BY day
    `);

    // Resolution times for answered requests
    const resolutionResult = await pool.query(`
      SELECT EXTRACT(EPOCH FROM (answered_at - created_at)) / 3600.0 AS hours
      FROM requests
      WHERE status = 'answered' AND answered_at IS NOT NULL AND created_at IS NOT NULL
    `);

    // Compute stats for daily requests
    const dailyCounts = dailyResult.rows.map(r => parseInt(r.count));
    const dailyMean = dailyCounts.length > 0 ? dailyCounts.reduce((a, b) => a + b, 0) / dailyCounts.length : 0;
    const dailyStd = dailyCounts.length > 1
      ? Math.sqrt(dailyCounts.reduce((sum, v) => sum + Math.pow(v - dailyMean, 2), 0) / (dailyCounts.length - 1))
      : dailyMean * 0.3;

    // Compute stats for resolution times
    const resTimes = resolutionResult.rows.map(r => parseFloat(r.hours)).filter(h => h > 0 && h < 720);
    const resMean = resTimes.length > 0 ? resTimes.reduce((a, b) => a + b, 0) / resTimes.length : 0;
    const resStd = resTimes.length > 1
      ? Math.sqrt(resTimes.reduce((sum, v) => sum + Math.pow(v - resMean, 2), 0) / (resTimes.length - 1))
      : resMean * 0.3;

    // Sort resolution times for percentiles
    const sortedRes = [...resTimes].sort((a, b) => a - b);
    const percentile = (arr, p) => arr.length > 0 ? arr[Math.floor(arr.length * p / 100)] : 0;

    res.json({
      volume: {
        daily_history: dailyResult.rows,
        mean: Math.round(dailyMean * 10) / 10,
        std: Math.round(dailyStd * 10) / 10,
        sample_size: dailyCounts.length
      },
      resolution: {
        mean_hours: Math.round(resMean * 10) / 10,
        std_hours: Math.round(resStd * 10) / 10,
        p10_hours: Math.round(percentile(sortedRes, 10) * 10) / 10,
        p50_hours: Math.round(percentile(sortedRes, 50) * 10) / 10,
        p90_hours: Math.round(percentile(sortedRes, 90) * 10) / 10,
        sample_size: resTimes.length
      }
    });
  } catch (error) {
    console.error('Error computing Monte Carlo:', error);
    res.status(500).json({ error: 'Monte Carlo hisoblashda xatolik' });
  }
});

// Assign request to lawyer
app.post('/api/assign-request', requireAuth, async (req, res) => {
  try {
    const { requestId, lawyerId } = req.body;

    await pool.query(`
      UPDATE requests
      SET assigned_to = $1, assigned_at = NOW()
      WHERE id = $2
    `, [lawyerId, requestId]);

    // Get lawyer info for notification
    const lawyerResult = await pool.query(
      'SELECT full_name, telegram_chat_id FROM admins WHERE id = $1',
      [lawyerId]
    );

    res.json({
      success: true,
      message: 'Request assigned successfully',
      lawyerName: lawyerResult.rows[0]?.full_name
    });

    // Send Telegram notification to assigned admin (async, don't block response)
    const lawyer = lawyerResult.rows[0];
    if (lawyer && lawyer.telegram_chat_id) {
      (async () => {
        try {
          const reqResult = await pool.query(
            `SELECT r.id, r.user_id, r.request_text, r.request_type, r.file_id, r.created_at,
                    u.first_name, u.username, u.telegram_id,
                    (SELECT COUNT(*) FROM requests r2 WHERE r2.user_id = r.user_id AND r2.id <= r.id) as user_request_seq
             FROM requests r JOIN users u ON r.user_id = u.id
             WHERE r.id = $1`,
            [requestId]
          );

          if (reqResult.rows.length > 0) {
            const req = reqResult.rows[0];
            const typeLabels = { text: 'Matn', voice: 'Ovozli xabar', video: 'Video', video_note: 'Video xabar', document: 'Fayl', photo: 'Rasm' };
            const typeLabel = typeLabels[req.request_type] || req.request_type;
            const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';

            let notifText = `📋 Yangi murojaat tayinlandi!\n\n👤 Murojaatchi: Murojaatchi ${anonId(req.user_id, req.created_at, req.user_request_seq)}`;
            notifText += `\n📝 Turi: ${typeLabel}`;
            notifText += `\n🔢 Murojaat #${req.id}`;

            if (req.request_type === 'text' && req.request_text) {
              const preview = req.request_text.length > 300 ? req.request_text.substring(0, 300) + '...' : req.request_text;
              notifText += `\n\n📄 Murojaat:\n${preview}`;
            }

            // Send notification with inline keyboard
            const keyboard = {
              inline_keyboard: [[
                { text: '✏️ Javob berish', callback_data: `respond_${requestId}` },
                { text: '📊 Dashboard', url: dashboardUrl }
              ]]
            };

            await bot.sendMessage(lawyer.telegram_chat_id, notifText, { reply_markup: keyboard });

            // For non-text requests, also forward the file
            if (req.file_id && req.request_type !== 'text') {
              try {
                if (req.request_type === 'voice') {
                  await bot.sendVoice(lawyer.telegram_chat_id, req.file_id);
                } else if (req.request_type === 'video' || req.request_type === 'video_note') {
                  await bot.sendVideo(lawyer.telegram_chat_id, req.file_id);
                } else if (req.request_type === 'document') {
                  await bot.sendDocument(lawyer.telegram_chat_id, req.file_id);
                } else if (req.request_type === 'photo') {
                  await bot.sendPhoto(lawyer.telegram_chat_id, req.file_id);
                }
              } catch (fileErr) {
                console.error('Failed to forward file to admin:', fileErr);
              }
            }
          }
        } catch (notifErr) {
          console.error('Assignment Telegram notification error:', notifErr);
        }
      })();
    }

  } catch (error) {
    console.error('Error assigning request:', error);
    res.status(500).json({ error: 'Failed to assign request' });
  }
});

// Update request category
app.post('/api/update-category', requireAuth, async (req, res) => {
  try {
    const { requestId, category } = req.body;

    await pool.query(
      'UPDATE requests SET category = $1 WHERE id = $2',
      [category, requestId]
    );

    res.json({ success: true, message: 'Category updated' });

  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Unassign request
app.post('/api/unassign-request', requireAuth, async (req, res) => {
  try {
    const { requestId } = req.body;
    
    await pool.query(`
      UPDATE requests 
      SET assigned_to = NULL, assigned_at = NULL
      WHERE id = $1
    `, [requestId]);
    
    res.json({ success: true, message: 'Assignment removed' });
    
  } catch (error) {
    console.error('Error unassigning request:', error);
    res.status(500).json({ error: 'Failed to unassign request' });
  }
});

// Assign student to request
app.post('/api/assign-student', requireAuth, async (req, res) => {
  try {
    const { requestId, studentId } = req.body;

    await pool.query(`
      INSERT INTO request_students (request_id, student_id) VALUES ($1, $2)
      ON CONFLICT (request_id, student_id) DO NOTHING
    `, [requestId, studentId]);

    const studentResult = await pool.query(
      'SELECT full_name, telegram_chat_id FROM admins WHERE id = $1',
      [studentId]
    );

    res.json({
      success: true,
      message: 'Student assigned successfully',
      studentName: studentResult.rows[0]?.full_name
    });

    // Telegram notification to assigned student
    const student = studentResult.rows[0];
    if (student && student.telegram_chat_id) {
      (async () => {
        try {
          const reqResult = await pool.query(
            `SELECT r.id, r.request_text, r.request_type, r.category FROM requests r WHERE r.id = $1`,
            [requestId]
          );
          if (reqResult.rows.length > 0) {
            const r = reqResult.rows[0];
            const preview = (r.request_text || '').substring(0, 100);
            await bot.sendMessage(student.telegram_chat_id,
              `📋 Sizga yangi murojaat tayinlandi!\n\n` +
              `🆔 Murojaat #${r.id}\n` +
              `📂 ${r.category || 'Boshqa'}\n` +
              `📝 ${preview}${preview.length >= 100 ? '...' : ''}\n\n` +
              `Dashboard orqali javob bering.`
            );
          }
        } catch (e) {
          console.error('[ASSIGN STUDENT] Telegram notify error:', e.message);
        }
      })();
    }
  } catch (error) {
    console.error('Error assigning student:', error);
    res.status(500).json({ error: 'Failed to assign student' });
  }
});

// Unassign student from request
app.post('/api/unassign-student', requireAuth, async (req, res) => {
  try {
    const { requestId, studentId } = req.body;

    await pool.query(`
      DELETE FROM request_students WHERE request_id = $1 AND student_id = $2
    `, [requestId, studentId]);

    res.json({ success: true, message: 'Student assignment removed' });
  } catch (error) {
    console.error('Error unassigning student:', error);
    res.status(500).json({ error: 'Failed to unassign student' });
  }
});

// Export to Excel
app.get('/api/export-excel', requireAuth, async (req, res) => {
  try {
    const XLSX = require('xlsx');
    
    const result = await pool.query(`
      SELECT
        r.id,
        r.user_id,
        u.username,
        u.first_name,
        r.category,
        r.request_text,
        r.request_type,
        r.status,
        r.response_text,
        r.responded_by,
        r.created_at,
        r.answered_at,
        (SELECT COUNT(*) FROM requests r2 WHERE r2.user_id = r.user_id AND r2.id <= r.id) as user_request_seq
      FROM requests r
      JOIN users u ON r.user_id = u.id
      ORDER BY r.created_at DESC
    `);
    
    // Anonymize for non-master users
    const rows = result.rows.map(r => anonymizeRequest(r, req.session.role));

    // Format data for Excel
    const excelData = rows.map(row => ({
      'ID': row.id,
      'Username': row.username || '',
      'Ism': row.first_name,
      'Yo\'nalish': row.category,
      'Murojaat': row.request_text,
      'Turi': row.request_type,
      'Status': row.status === 'pending' ? 'Kutilmoqda' :
                row.status === 'student_responded' ? 'Student javobi' :
                row.status === 'answered' ? 'Javob berilgan' : 
                row.status === 'rejected' ? 'Rad etilgan' : row.status,
      'Javob': row.response_text || '',
      'Javob berdi': row.responded_by || '',
      'Yaratilgan': new Date(row.created_at).toLocaleString('uz-UZ'),
      'Javob berilgan': row.answered_at ? new Date(row.answered_at).toLocaleString('uz-UZ') : ''
    }));
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);
    
    // Set column widths
    ws['!cols'] = [
      { wch: 5 },  // ID
      { wch: 20 }, // Username
      { wch: 25 }, // Ism
      { wch: 20 }, // Yo'nalish
      { wch: 50 }, // Murojaat
      { wch: 15 }, // Turi
      { wch: 15 }, // Status
      { wch: 50 }, // Javob
      { wch: 20 }, // Javob berdi
      { wch: 20 }, // Yaratilgan
      { wch: 20 }  // Javob berilgan
    ];
    
    XLSX.utils.book_append_sheet(wb, ws, 'Murojaatlar');
    
    // Generate buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    // Send file
    const filename = `dictum_murojaatlar_${new Date().toISOString().split('T')[0]}.xlsx`;
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
    
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    res.status(500).json({ error: 'Failed to export' });
  }
});

// Delete request (master only)
app.delete('/api/requests/:id', requireMasterAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    await pool.query('DELETE FROM requests WHERE id = $1', [id]);
    
    res.json({ success: true, message: 'Request deleted successfully' });
    
  } catch (error) {
    console.error('Error deleting request:', error);
    res.status(500).json({ error: 'Failed to delete request' });
  }
});

// Block user (master only)
app.post('/api/users/block', requireMasterAdmin, async (req, res) => {
  try {
    const { userId, reason } = req.body;
    
    await pool.query(`
      UPDATE users 
      SET blocked = TRUE, 
          blocked_at = NOW(), 
          blocked_by = $1,
          block_reason = $2
      WHERE id = $3
    `, [req.session.adminId, reason || 'No reason provided', userId]);
    
    res.json({ success: true, message: 'User blocked successfully' });
    
  } catch (error) {
    console.error('Error blocking user:', error);
    res.status(500).json({ error: 'Failed to block user' });
  }
});

// Unblock user (master only)
app.post('/api/users/unblock', requireMasterAdmin, async (req, res) => {
  try {
    const { userId } = req.body;
    
    await pool.query(`
      UPDATE users 
      SET blocked = FALSE, 
          blocked_at = NULL, 
          blocked_by = NULL,
          block_reason = NULL
      WHERE id = $1
    `, [userId]);
    
    res.json({ success: true, message: 'User unblocked successfully' });
    
  } catch (error) {
    console.error('Error unblocking user:', error);
    res.status(500).json({ error: 'Failed to unblock user' });
  }
});

// Get block history for a user (master only)
app.get('/api/users/:userId/block-history', requireMasterAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const result = await pool.query(`
      SELECT 
        bh.id,
        bh.action,
        bh.reason,
        bh.performed_at,
        a.full_name as performed_by_name
      FROM block_history bh
      LEFT JOIN admins a ON bh.performed_by = a.id
      WHERE bh.user_id = $1
      ORDER BY bh.performed_at DESC
    `, [userId]);
    
    res.json(result.rows);
    
  } catch (error) {
    console.error('Error fetching block history:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// ========== COMMUNITY CHAT API ==========

// Get chat messages (supports polling via ?since_id=N)
app.get('/api/chat/messages', requireAuth, async (req, res) => {
  try {
    const sinceId = parseInt(req.query.since_id) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    let query, params;
    if (sinceId > 0) {
      // Check if since_id still exists (messages may have been deleted)
      const check = await pool.query('SELECT COUNT(*)::int as cnt FROM chat_messages WHERE id <= $1', [sinceId]);
      if (check.rows[0].cnt === 0) {
        // All messages up to since_id were deleted — signal full reset
        const fresh = await pool.query(`
          SELECT cm.id, cm.message, cm.mentions, cm.reply_to_id, cm.created_at,
                 a.id as admin_id, a.username, a.full_name, a.role,
                 rm.message as reply_message, ra.full_name as reply_sender, ra.role as reply_role
          FROM chat_messages cm
          JOIN admins a ON cm.admin_id = a.id
          LEFT JOIN chat_messages rm ON cm.reply_to_id = rm.id
          LEFT JOIN admins ra ON rm.admin_id = ra.id
          ORDER BY cm.id DESC
          LIMIT $1
        `, [limit]);
        return res.json({ messages: fresh.rows.reverse(), reset: true });
      }
      query = `
        SELECT cm.id, cm.message, cm.mentions, cm.reply_to_id, cm.created_at,
               a.id as admin_id, a.username, a.full_name, a.role,
               rm.message as reply_message, ra.full_name as reply_sender, ra.role as reply_role
        FROM chat_messages cm
        JOIN admins a ON cm.admin_id = a.id
        LEFT JOIN chat_messages rm ON cm.reply_to_id = rm.id
        LEFT JOIN admins ra ON rm.admin_id = ra.id
        WHERE cm.id > $1
        ORDER BY cm.id ASC
        LIMIT $2
      `;
      params = [sinceId, limit];
    } else {
      query = `
        SELECT cm.id, cm.message, cm.mentions, cm.reply_to_id, cm.created_at,
               a.id as admin_id, a.username, a.full_name, a.role,
               rm.message as reply_message, ra.full_name as reply_sender, ra.role as reply_role
        FROM chat_messages cm
        JOIN admins a ON cm.admin_id = a.id
        LEFT JOIN chat_messages rm ON cm.reply_to_id = rm.id
        LEFT JOIN admins ra ON rm.admin_id = ra.id
        ORDER BY cm.id DESC
        LIMIT $1
      `;
      params = [limit];
    }

    const result = await pool.query(query, params);
    const messages = sinceId > 0 ? result.rows : result.rows.reverse();
    // Include total count so client can detect individual deletions
    const totalResult = await pool.query('SELECT COUNT(*)::int as total FROM chat_messages');
    res.json({ messages, total: totalResult.rows[0].total });
  } catch (error) {
    console.error('Error fetching chat messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Send a chat message
app.post('/api/chat/messages', requireAuth, async (req, res) => {
  try {
    const { message, reply_to_id } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: 'Message too long' });
    }

    const mentionRegex = /@(\w+)/g;
    const mentions = [];
    let match;
    while ((match = mentionRegex.exec(message)) !== null) {
      mentions.push(match[1].toLowerCase());
    }

    const replyId = reply_to_id ? parseInt(reply_to_id) : null;

    const result = await pool.query(
      `INSERT INTO chat_messages (admin_id, message, mentions, reply_to_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, message, mentions, reply_to_id, created_at`,
      [req.session.adminId, message.trim(), JSON.stringify(mentions), replyId]
    );

    const newMsg = result.rows[0];
    let replyData = {};
    if (replyId) {
      const replyResult = await pool.query(
        `SELECT cm.message, a.full_name as reply_sender, a.role as reply_role
         FROM chat_messages cm JOIN admins a ON cm.admin_id = a.id WHERE cm.id = $1`,
        [replyId]
      );
      if (replyResult.rows.length > 0) {
        replyData = {
          reply_to_id: replyId,
          reply_message: replyResult.rows[0].message,
          reply_sender: replyResult.rows[0].reply_sender,
          reply_role: replyResult.rows[0].reply_role
        };
      }
    }

    res.json({
      success: true,
      message: {
        id: newMsg.id,
        message: newMsg.message,
        mentions: newMsg.mentions,
        reply_to_id: newMsg.reply_to_id,
        created_at: newMsg.created_at,
        admin_id: req.session.adminId,
        username: req.session.username,
        full_name: req.session.fullName,
        role: req.session.role,
        ...replyData
      }
    });

    // Send Telegram DM notifications to mentioned admins (async, don't block response)
    if (mentions.length > 0) {
      const senderName = req.session.fullName;
      const msgPreview = message.trim().length > 200 ? message.trim().substring(0, 200) + '...' : message.trim();
      const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';

      (async () => {
        try {
          const notifiedIds = new Set();
          for (const uname of mentions) {
            if (uname === 'all') {
              const allResult = await pool.query(
                'SELECT telegram_chat_id FROM admins WHERE telegram_chat_id IS NOT NULL AND id != $1',
                [req.session.adminId]
              );
              for (const row of allResult.rows) {
                if (!notifiedIds.has(String(row.telegram_chat_id))) {
                  notifiedIds.add(String(row.telegram_chat_id));
                  const notifText = `💬 Guruh Chat - ${senderName} hammani eslatdi:\n\n"${msgPreview}"\n\nDashboard: ${dashboardUrl}`;
                  bot.sendMessage(row.telegram_chat_id, notifText).catch(() => {});
                }
              }
            } else {
              const adminResult = await pool.query(
                'SELECT telegram_chat_id FROM admins WHERE LOWER(username) = $1 AND telegram_chat_id IS NOT NULL AND id != $2',
                [uname, req.session.adminId]
              );
              if (adminResult.rows.length > 0 && !notifiedIds.has(String(adminResult.rows[0].telegram_chat_id))) {
                notifiedIds.add(String(adminResult.rows[0].telegram_chat_id));
                const notifText = `💬 Guruh Chat - ${senderName} sizni eslatdi:\n\n"${msgPreview}"\n\nDashboard: ${dashboardUrl}`;
                bot.sendMessage(adminResult.rows[0].telegram_chat_id, notifText).catch(() => {});
              }
            }
          }
        } catch (notifErr) {
          console.error('Chat mention Telegram notification error:', notifErr);
        }
      })();
    }

  } catch (error) {
    console.error('Error sending chat message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Delete single chat message (master admin only)
app.delete('/api/chat/messages/:id', requireMasterAdmin, async (req, res) => {
  try {
    const msgId = parseInt(req.params.id);
    if (!msgId) return res.status(400).json({ error: 'Invalid message ID' });
    await pool.query('DELETE FROM chat_messages WHERE id = $1', [msgId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting chat message:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Delete all chat messages (master admin only)
app.delete('/api/chat/messages', requireMasterAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM chat_messages');
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting all chat messages:', error);
    res.status(500).json({ error: 'Failed to delete messages' });
  }
});

// ========== AI PROVIDER: OpenAI GPT-4o ==========
async function callAI(messages, options = {}) {
  const { temperature = 0.2, maxTokens = 8192, useSearch = false } = options;

  const gptKey = process.env.GPT_API_KEY;
  if (!gptKey) {
    throw new Error('GPT_API_KEY sozlanmagan');
  }

  console.log(`[AI] Calling GPT-4o${useSearch ? ' with web search' : ''}...`);

  // Build input for OpenAI Responses API
  const input = messages.map(m => ({
    role: m.role === 'model' ? 'assistant' : (m.role === 'user' ? 'user' : 'assistant'),
    content: m.text
  }));

  const body = {
    model: 'gpt-4o',
    input,
    temperature,
    max_output_tokens: maxTokens
  };

  // Enable web search for legal research queries
  if (useSearch) {
    body.tools = [{ type: 'web_search_preview' }];
  }

  const resp = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${gptKey}`
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`GPT-4o ${resp.status}: ${errBody.substring(0, 200)}`);
  }

  const data = await resp.json();

  // Extract text from Responses API output
  const text = (data.output || [])
    .filter(o => o.type === 'message')
    .flatMap(o => o.content || [])
    .filter(c => c.type === 'output_text')
    .map(c => c.text)
    .join('');

  if (!text) throw new Error('GPT-4o empty response');

  console.log('[AI] GPT-4o succeeded');
  return { text, provider: 'GPT-4o' };
}

// Initialize agent runner with callAI function
const { initRunner } = require('../agents/runner');
initRunner(callAI);

// AI Analysis endpoint — Legal GPT (RAG-based)
app.post('/api/ai-analysis', requireMasterAdmin, async (req, res) => {
  try {
    const { requestText, category, requestId } = req.body;
    if (!requestText) {
      return res.status(400).json({ error: 'Murojaat matni topilmadi' });
    }

    // Check recent feedback for quality adjustment
    let feedbackNote = '';
    try {
      const fbResult = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE rating = 1)::int AS pos,
          COUNT(*) FILTER (WHERE rating = -1)::int AS neg
        FROM ai_feedback
        WHERE created_at > NOW() - INTERVAL '30 days'
      `);
      const { pos, neg } = fbResult.rows[0];
      const total = pos + neg;
      if (total > 5) {
        const satisfaction = Math.round(pos / total * 100);
        if (satisfaction < 70) {
          feedbackNote = `\n\nEslatma: So'nggi 30 kunda foydalanuvchilar ${satisfaction}% qoniqish bildirdi. Tahlilni yanada batafsil va aniq qiling.`;
        }
      }
    } catch (e) { /* non-critical */ }

    // ========== LEGAL FIELD CLASSIFICATION ==========
    let classificationBlock = '';
    let detectedField = category; // fallback to user-provided category
    try {
      const classification = await classifyLegalField(requestText, requestId || null);
      classificationBlock = formatClassificationForPrompt(classification);
      if (classification.legal_field !== 'Boshqa') {
        detectedField = classification.legal_field;
        console.log(`[AI] Classified as: ${classification.legal_field} (${classification.confidence}%)`);
      }
    } catch (e) {
      console.error('[AI] Classification error:', e.message);
    }

    // ========== GOLDEN DATASET: RETRIEVE SIMILAR EXAMPLES ==========
    let similarExamplesBlock = '';
    try {
      const similarExamples = await retrieveSimilarExamples(requestText, detectedField);
      similarExamplesBlock = formatExamplesForPrompt(similarExamples);
      if (similarExamples.length > 0) {
        console.log(`[AI] Injecting ${similarExamples.length} golden dataset examples into prompt`);
      }
    } catch (e) {
      console.error('[AI] Golden dataset retrieval error:', e.message);
    }

    // ========== FEEDBACK DATASET: RETRIEVE MENTOR CORRECTIONS ==========
    let feedbackExamplesBlock = '';
    try {
      const feedbackExamples = await retrieveFeedbackExamples(requestText, detectedField);
      feedbackExamplesBlock = formatFeedbackForPrompt(feedbackExamples);
      if (feedbackExamples.length > 0) {
        console.log(`[AI] Injecting ${feedbackExamples.length} mentor feedback corrections into prompt`);
      }
    } catch (e) {
      console.error('[AI] Feedback dataset retrieval error:', e.message);
    }

    // ========== CASE-LAW DATASET: RETRIEVE SIMILAR COURT DECISIONS ==========
    let caseLawBlock = '';
    try {
      const similarCases = await retrieveSimilarCases(requestText, detectedField, 3);
      caseLawBlock = formatCasesForPrompt(similarCases);
      if (similarCases.length > 0) {
        console.log(`[AI] Injecting ${similarCases.length} court cases into prompt`);
      }
    } catch (e) {
      console.error('[AI] Case-law retrieval error:', e.message);
    }

    // ========== LEGAL REASONING ENGINE — SYSTEM PROMPT ==========
    const systemPrompt = `You are a professional legal assistant specialized in the legislation of the Republic of Uzbekistan.

Your task is to analyze legal requests submitted by users and provide precise, well-structured legal answers.

You must base your analysis on:
1. Official legal documents from lex.uz (legislation)
2. Court practice from my.sud.uz / public.sud.uz (judicial decisions)

When answering legal questions, you MUST:
- Identify the legal issue
- Cite relevant legislation from lex.uz
- Reference similar court decisions from my.sud.uz if available in context
- Analyze how courts interpret the law in similar situations
- Provide a structured legal conclusion

Use clear professional legal language suitable for lawyers and law students.
All answers MUST be in O'zbek (lotin) tilida.

LEGAL REASONING PROTOCOL (ICHKI TAHLIL — MAJBURIY):
Javob yozishdan OLDIN, quyidagi 5 bosqichli ichki tahlilni o'tkazing:

1-BOSQICH: MASALANI ANIQLASH
- Foydalanuvchi nimani so'rayapti? Aniq huquqiy masala nima?
- Qaysi huquqiy munosabat ko'zda tutilgan?

2-BOSQICH: QONUN IZLASH
- Web search orqali "site:lex.uz [kodeks nomi] [mavzu]" qidiring
- Topilgan har bir norma uchun: AMALDAMI yoki O'Z KUCHINI YO'QOTGANMI tekshiring
- Faqat AMALDAGI (hozirgi kuchga ega) normalarni qabul qiling
- O'zgartirishlar (amendments) borligini tekshiring

3-BOSQICH: SUD AMALIYOTINI TEKSHIRISH
- Kontekstda berilgan sud ishlarini ko'rib chiqing — foydalanuvchi masalasiga tegishlimi?
- Sudlar qonunni QANDAY talqin qilgan — shu talqinni tahlilga kiritish kerakmi?
- "site:public.sud.uz [mavzu]" dan ham qo'shimcha sud qarorlarini izlang
- Sud ishlariga murojaat qilganda: ish raqami, sud nomi, sanasi MAJBURIY

4-BOSQICH: MANTIQIY TEKSHIRISH
- Topilgan normalar va sud amaliyoti foydalanuvchi vaziyatiga TO'G'RIDAN-TO'G'RI tegishlimi?
- Biror norma bilan javob berish uchun YETARLI asosmi? Agar YO'Q — ochiq ayting.

5-BOSQICH: GALLYUTSINATSIYA FILTRI
- Har bir da'voni tekshiring: manba bormi? Web searchda tasdiqlandimi?
- Agar biror modda raqamini tasdiqlash imkoni bo'lmasa — UNI KELTIRMANG.
- Sud qarorlarini to'qima qilmang — faqat kontekstda berilgan yoki web search orqali topilgan ishlarni keltiring.
- Agar huquqiy javob to'liq tasdiqlanmasa, quyidagi iborani ishlating:
  "Mavjud huquqiy ma'lumotlarga asosan aniq javob berish imkoni cheklangan. Qo'shimcha huquqiy ekspertiza talab qilinadi."

Bu ichki tahlilni <!--REASONING--> va <!--/REASONING--> teglari orasida yozing.
Bu qism foydalanuvchiga KO'RSATILMAYDI — faqat sifat nazorati uchun.

PRIMARY LEGAL SOURCES:
1. Lex.uz — official database of legislation of Uzbekistan
2. My.sud.uz / Public.sud.uz — court decisions and judicial practice

CITATION FORMAT (MAJBURIY):
Har bir huquqiy da'vo uchun quyidagi formatda manba keltiring:
[Qonun nomi], [raqam]-modda (Manba: lex.uz)

Misollar:
- Mehnat kodeksi, 100-modda (Manba: lex.uz)
- Fuqarolik kodeksi, 354-modda (Manba: lex.uz)
- Oila kodeksi, 38-modda (Manba: lex.uz)

MANBASIZ BAYONOT QILISH QATTIYAN TAQIQLANADI.
Agar qonun normasi web search orqali topilmasa — uni keltirmang.

If the law is unclear or missing, explicitly state:
"Qonunchilikda to'g'ridan-to'g'ri tartibga solish aniq belgilanmagan. Malakali yuristga murojaat qilish tavsiya etiladi."

UZBEKISTAN LEGAL CODE CATALOG:
KODEKSLAR:
- Konstitutsiya: https://lex.uz/docs/35869
- Fuqarolik kodeksi (FK): https://lex.uz/docs/111189
- Mehnat kodeksi (MK): https://lex.uz/docs/145261
- Jinoyat kodeksi (JK): https://lex.uz/docs/111457
- Oila kodeksi (OK): https://lex.uz/docs/104723
- Soliq kodeksi (SK): https://lex.uz/docs/4674893
- Ma'muriy javobgarlik to'g'risida kodeks (MJK): https://lex.uz/docs/97661
- Iqtisodiy protsessual kodeks (IPK): https://lex.uz/docs/112168
- Fuqarolik protsessual kodeks (FPK): https://lex.uz/docs/111325
- Jinoyat-protsessual kodeks (JPK): https://lex.uz/docs/111463
- Ma'muriy sudlov kodeksi: https://lex.uz/docs/3523895
- Uy-joy kodeksi: https://lex.uz/docs/97012
- Yer kodeksi: https://lex.uz/docs/149946
- Budjet kodeksi: https://lex.uz/docs/3523816
- Bojxona kodeksi: https://lex.uz/docs/4102378

ASOSIY QONUNLAR:
- Tadbirkorlik faoliyati erkinligi kafolatlari: https://lex.uz/docs/4538291
- Aksiyadorlik jamiyatlari: https://lex.uz/docs/5765400
- MChJ to'g'risida: https://lex.uz/docs/5765406
- Iste'molchilar huquqlarini himoya qilish: https://lex.uz/docs/89690
- Ijro va sud qarorlari ijrosi: https://lex.uz/docs/5765444
- Bankrotlik: https://lex.uz/docs/5767454
- Davlat xaridlari: https://lex.uz/docs/5759393
- Litsenziyalash: https://lex.uz/docs/6006025
- Korrupsiyaga qarshi kurashish: https://lex.uz/docs/5765442
- Advokatlik faoliyati: https://lex.uz/docs/5765396
- Notariat: https://lex.uz/docs/5765430
- Sudlar to'g'risida: https://lex.uz/docs/5965818
- Bolalar huquqlari kafolatlari: https://lex.uz/docs/49560
- Genderli tenglik: https://lex.uz/docs/5765412
- Xalqaro arbitraj: https://lex.uz/docs/6555446`;

    // ========== REQUEST CLASSIFICATION ==========
    const classificationPrompt = `MUROJAAT KLASSIFIKATSIYASI:
Quyidagi murojaat turini aniqlang:
1. Huquqiy maslahat (Legal consultation)
2. Huquqiy tadqiqot (Legal research)
3. Sud ishi tahlili (Court case analysis)
4. Huquqiy hujjat tayyorlash (Legal document drafting)
5. Shartnoma tahlili (Contract analysis)

Javob strukturasini murojaat turiga moslang.`;

    // ========== STRUCTURED RESPONSE FORMAT ==========
    const responseFormat = `JAVOB TUZILISHI (QATTIYAN RIOYA QILING):

BIRINCHI: Ichki tahlilni <!--REASONING--> teglari orasida yozing (foydalanuvchiga ko'rsatilmaydi):
<!--REASONING-->
1. Masala: [huquqiy masalaning mohiyati]
2. Tegishli normalar: [web search natijasida topilgan normalar]
3. Normalar amaldami: [ha/yo'q har biri uchun]
4. Gallyutsinatsiya tekshiruvi: [tasdiqlanmagan da'volar bormi?]
5. Xulosa ishonchliligi: [yuqori/o'rta/past]
<!--/REASONING-->

KEYIN: Javobni quyidagi 6 bo'limda yozing:

## HUQUQIY MASALA
Foydalanuvchi savolidan kelib chiqadigan aniq huquqiy masalani aniqlang.
Qaysi huquqiy munosabat ko'zda tutilgan — 1-2 gapda yozing.

## QONUNCHILIK ASOSI
Tegishli qonunchilik normalarini keltiring. HAR BIR NORMA UCHUN:
- Qonun nomi va modda raqami (Manba: lex.uz)
- Modda mazmunining qisqa bayoni
- Web search orqali "site:lex.uz [kodeks nomi] [mavzu]" qidirib TASDIQLANGAN moddalarni keltiring
MANBASIZ MODDA KELTIRISH TAQIQLANADI.

## SUD AMALIYOTI
Kontekstda berilgan o'xshash sud ishlarini tahlil qiling. Har bir ish uchun:
- Sud: [sud nomi]
- Qaror sanasi: [kun oy yil]
- Huquqiy masala: [qisqacha]
- Sud mushohada: [sudlar qonunni qanday talqin qilgan]
- Manba: my.sud.uz

Agar kontekstda sud ishlari bo'lmasa — web search orqali "site:public.sud.uz [mavzu]" qidirib toping.
Agar aniq ish topilmasa, shu sohada umumiy sud amaliyoti tendensiyasini yozing.
SUD QARORLARINI TO'QIMA QILISH TAQIQLANADI.

## HUQUQIY TAHLIL
Qonunchilik VA sud amaliyotini foydalanuvchi vaziyatiga BATAFSIL qo'llang:
- Qonun normasi nima deydi?
- Sudlar shu masalani QANDAY hal qilgan?
- Bu normaga ko'ra foydalanuvchi vaziyati qanday baholanadi?
- Qanday huquqiy oqibatlar kutiladi?

## XULOSA
Aniq huquqiy javob — 2-3 gapda.
Da'vo/murojaat muvaffaqiyat ehtimoli (foizda) va noaniqlik darajasi (past/o'rta/yuqori).

Agar aniq javob berish imkoni bo'lmasa:
"Mavjud huquqiy ma'lumotlarga asosan aniq javob berish imkoni cheklangan. Qo'shimcha huquqiy ekspertiza talab qilinadi."

## TAVSIYA ETILADIGAN HARAKATLAR
Amaliy huquqiy maslahat — raqamlangan ro'yxat shaklida:
1. Birinchi qadam
2. Ikkinchi qadam
3. ...

> "Ushbu tahlil sun'iy intellekt asosida shakllantirilgan va sud qarori hisoblanmaydi. Barcha ma'lumotlarni lex.uz va public.sud.uz saytlaridan tekshiring."`;

    // ========== YURXIZMAT CATALOG ==========
    const yurxizmatBlock = `## YURXIZMAT.UZ HUJJAT NAMUNALARI
Quyidagi katalogdan murojaatga eng mos 2-4 ta toifani tanlang.

Katalog:
${getYurxizmatCatalogText()}

Javobingiz eng oxirida quyidagi blokni yozing:

<!--YURXIZMAT-->
[{"name":"Toifa nomi","url":"/uz/category/..."}]
<!--/YURXIZMAT-->

Faqat yuqoridagi katalogdagi URLlardan foydalaning. Agar mos namuna topilmasa: []`;

    // ========== COMBINE FULL PROMPT ==========
    const fullPrompt = `${systemPrompt}

${classificationPrompt}

${classificationBlock}

${detectedField && detectedField !== 'Boshqa' ? `Murojaat yo'nalishi: ${detectedField}` : ''}

MUROJAAT MATNI:
"${requestText}"

${similarExamplesBlock}

${caseLawBlock}

${feedbackExamplesBlock}

${responseFormat}

${yurxizmatBlock}
${feedbackNote}`;

    const aiResult = await callAI([{ role: 'user', text: fullPrompt }], { useSearch: true, maxTokens: 8192, temperature: 0.2 });
    const rawAnalysis = aiResult.text;
    const aiProvider = aiResult.provider;

    // Extract hidden reasoning block (internal chain-of-thought, not shown to user)
    let internalReasoning = null;
    let analysisWithoutReasoning = rawAnalysis;
    const reasoningMatch = rawAnalysis.match(/<!--REASONING-->\s*([\s\S]*?)\s*<!--\/REASONING-->/);
    if (reasoningMatch) {
      internalReasoning = reasoningMatch[1].trim();
      analysisWithoutReasoning = rawAnalysis.replace(/<!--REASONING-->[\s\S]*?<!--\/REASONING-->\s*/, '').trim();
      console.log(`[AI] Internal reasoning extracted (${internalReasoning.length} chars)`);
    }

    // Extract yurxizmat.uz template suggestions from response
    let templateSuggestions = [];
    let analysis = analysisWithoutReasoning;
    const suggestionsMatch = rawAnalysis.match(/<!--YURXIZMAT-->\s*([\s\S]*?)\s*<!--\/YURXIZMAT-->/);
    if (suggestionsMatch) {
      analysis = rawAnalysis.replace(/<!--YURXIZMAT-->[\s\S]*?<!--\/YURXIZMAT-->/, '').trim();
      try {
        const parsed = JSON.parse(suggestionsMatch[1].trim());
        if (Array.isArray(parsed)) {
          templateSuggestions = parsed
            .filter(s => s.name && s.url && s.url.startsWith('/uz/category/'))
            .map(s => ({ name: s.name, url: 'https://yurxizmat.uz' + s.url }))
            .slice(0, 5);
        }
      } catch (e) {
        console.error('[AI] Failed to parse yurxizmat suggestions:', e.message);
      }
    }

    // Archive the analysis (including internal reasoning for audit)
    let archiveId = null;
    try {
      const archiveResult = await pool.query(
        `INSERT INTO ai_analyses (request_id, admin_id, category, request_text, analysis_text, internal_reasoning)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [requestId || null, req.session.adminId, detectedField || category, requestText, analysis, internalReasoning]
      );
      archiveId = archiveResult.rows[0].id;
    } catch (archiveErr) {
      console.error('[AI] Archive save error:', archiveErr.message);
    }

    res.json({ analysis, archiveId, templateSuggestions, provider: aiProvider, detectedField });
  } catch (error) {
    console.error('[AI] Analysis error:', error);
    res.status(500).json({ error: 'AI tahlil xatoligi: ' + error.message });
  }
});

// ========== LEGAL SEARCH CHAT (Multi-DB) ==========

// Database configurations for RAG search
const LEGAL_DATABASES = {
  'lex.uz': {
    site: 'lex.uz',
    name: 'Lex.uz — Qonunchilik bazasi',
    description: 'O\'zbekiston Respublikasi qonunchilik ma\'lumotlar bazasi. Kodekslar, qonunlar, farmonlar, qarorlar.',
    searchHint: 'site:lex.uz'
  },
  'public.sud.uz': {
    site: 'public.sud.uz',
    name: 'Public.sud.uz — Sud qarorlari',
    description: 'O\'zbekiston sudlari qarorlari va amaliyoti. Sud ishlari, hukmlar, ajrimlar.',
    searchHint: 'site:public.sud.uz'
  },
  'my.sud.uz': {
    site: 'my.sud.uz',
    name: 'My.sud.uz — Sud ishi holati',
    description: 'Sud ishlarining holati, jarayoni, qabul qilingan qarorlar.',
    searchHint: 'site:my.sud.uz'
  },
  'mib.uz': {
    site: 'mib.uz',
    name: 'Mib.uz — Ijro byurosi',
    description: 'Ijro hujjatlari, undirish jarayoni, ijro ishlarining holati.',
    searchHint: 'site:mib.uz'
  },
  'soliq.uz': {
    site: 'soliq.uz',
    name: 'Soliq.uz — Soliq qo\'mitasi',
    description: 'Soliq qonunchilik, soliq imtiyozlari, soliq hisobotlari, soliq to\'lovlari.',
    searchHint: 'site:soliq.uz'
  },
  'ihamkor.uz': {
    site: 'ihamkor.uz',
    name: 'Ihamkor.uz — Ijtimoiy hamkorlik',
    description: 'Ijtimoiy himoya, pensiya, nafaqa, mehnat munosabatlari.',
    searchHint: 'site:ihamkor.uz'
  }
};

function buildLegalSearchPrompt(databases) {
  const dbs = Array.isArray(databases) && databases.length > 0 ? databases : ['lex.uz'];
  const validDbs = dbs.filter(db => LEGAL_DATABASES[db]);
  if (validDbs.length === 0) validDbs.push('lex.uz');

  const dbDescriptions = validDbs.map(db => {
    const info = LEGAL_DATABASES[db];
    return `- **${info.name}**: ${info.description} (Qidiruv: "${info.searchHint} [savol]")`;
  }).join('\n');

  const searchSites = validDbs.map(db => LEGAL_DATABASES[db].searchHint).join(' OR ');

  return `Siz O'zbekiston huquqi bo'yicha qonun qidirish yordamchisisiz.

VAZIFANGIZ:
Foydalanuvchi savoliga quyidagi ma'lumot bazalari asosida javob bering:
${dbDescriptions}

QOIDALAR:
- Google Search yordamida yuqoridagi bazalardan tegishli ma'lumotlarni qidiring
- Har bir baza uchun alohida "site:[domain] [savol]" qidiring
- Har bir topilgan natija uchun TO'G'RIDAN-TO'G'RI havola bering
- Havola to'qib chiqarish QATTIYAN TAQIQLANADI! Faqat Google Search natijalarida ko'ringan havolalarni bering
- Agar aniq havola topa olmasangiz, "[sayt] dan qidiring" deb yozing
- Javob FAQAT O'zbek (lotin) tilida bo'lishi shart
- Javob qisqa, aniq va strukturali bo'lsin

JAVOB FORMATI:
${validDbs.indexOf('lex.uz') > -1 ? '1. **Tegishli qonunlar:** (lex.uz dan)\n   - Qonun/kodeks nomi, modda raqami, qisqa mazmun, havola\n' : ''}${validDbs.indexOf('public.sud.uz') > -1 ? '2. **Sud amaliyoti:** (public.sud.uz dan)\n   - Sud ishi, qaror, mohiyat, havola\n' : ''}${validDbs.indexOf('my.sud.uz') > -1 ? '3. **Sud ishi holati:** (my.sud.uz dan)\n   - Ish holati, ma\'lumot\n' : ''}${validDbs.indexOf('mib.uz') > -1 ? '4. **Ijro ma\'lumotlari:** (mib.uz dan)\n   - Ijro hujjati, holat, ma\'lumot\n' : ''}${validDbs.indexOf('soliq.uz') > -1 ? '5. **Soliq ma\'lumotlari:** (soliq.uz dan)\n   - Soliq qoidasi, ma\'lumot, havola\n' : ''}${validDbs.indexOf('ihamkor.uz') > -1 ? '6. **Ijtimoiy himoya:** (ihamkor.uz dan)\n   - Ma\'lumot, havola\n' : ''}
**Xulosa:** Qisqa huquqiy fikr

> "Bu javob AI asosida shakllantirilgan. Aniq ma'lumotlar uchun tegishli saytlardan tekshiring."`;
}

// Topic labels for RAG-based legal chat
const LEGAL_TOPICS = {
  'mehnat':       'Mehnat huquqi',
  'oila':         'Oila huquqi',
  'fuqarolik':    'Fuqarolik huquqi',
  'shartnoma':    'Shartnoma huquqi',
  'soliq':        'Soliq huquqi',
  'jinoyat':      'Jinoyat huquqi',
  'mamuriy':      "Ma'muriy javobgarlik",
  'korporativ':   'Korporativ huquq',
  'tadbirkorlik': 'Tadbirkorlik huquqi',
  'uy-joy':       'Uy-joy oldi-sotdisi',
  'mulk':         'Mulk huquqi',
  'notarius':     'Notarius xizmatlari',
  'ijtimoiy':     'Ijtimoiy himoya'
};

function buildTopicPrompt(topic) {
  const topicLabel = LEGAL_TOPICS[topic] || topic;
  return `Siz O'zbekiston huquqi bo'yicha mutaxassis AI yordamchisiz.

SOHA: ${topicLabel}

VAZIFANGIZ:
Foydalanuvchi savoliga "${topicLabel}" sohasiga oid O'zbekiston qonunchiligi asosida javob bering.

QOIDALAR:
- Javob FAQAT O'zbek (lotin) tilida bo'lishi shart
- Tegishli qonun va kodeks moddalarini aniq ko'rsating
- Agar lex.uz da tegishli qonun mavjud bo'lsa, havolani ko'rsating
- Javob qisqa, aniq va strukturali bo'lsin
- Amaliy maslahat bering

JAVOB FORMATI:
1. **Tegishli qonunlar:** Qonun/kodeks nomi, modda raqami, qisqa mazmun
2. **Tushuntirish:** Savolga javob
3. **Xulosa:** Qisqa huquqiy fikr

> "Bu javob AI asosida shakllantirilgan. Aniq ma'lumotlar uchun lex.uz dan tekshiring."`;
}

app.post('/api/legal-chat', requireMasterAdmin, async (req, res) => {
  try {
    const { message, history, databases, topic } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Xabar matni topilmadi' });
    }

    const systemPrompt = topic ? buildTopicPrompt(topic) : buildLegalSearchPrompt(databases);

    // Build messages array for callAI
    const aiMessages = [];

    if (Array.isArray(history) && history.length > 0) {
      const recentHistory = history.length > 18 ? history.slice(-18) : history;
      recentHistory.forEach((msg, i) => {
        aiMessages.push({
          role: msg.role === 'user' ? 'user' : 'model',
          text: i === 0 && msg.role === 'user' ? systemPrompt + '\n\n' + msg.text : msg.text
        });
      });
    }

    const currentText = aiMessages.length === 0 ? systemPrompt + '\n\n' + message : message;
    aiMessages.push({ role: 'user', text: currentText });

    const aiResult = await callAI(aiMessages, { useSearch: true, maxTokens: 4096 });
    const usedDbs = Array.isArray(databases) && databases.length > 0 ? databases : ['lex.uz'];
    res.json({ reply: aiResult.text, provider: aiResult.provider, databases: usedDbs });
  } catch (error) {
    console.error('[Legal Chat] Error:', error);
    res.status(500).json({ error: 'Qonun qidirish xatoligi: ' + error.message });
  }
});

// ========== AI CHAT SESSIONS CRUD ==========

// List sessions
app.get('/api/ai-chat-sessions', requireMasterAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, databases, messages->0->>'text' as first_message,
              jsonb_array_length(messages) as message_count,
              created_at, updated_at
       FROM ai_chat_sessions
       WHERE admin_id = $1
       ORDER BY updated_at DESC
       LIMIT 50`,
      [req.session.adminId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('[AI Sessions] List error:', error);
    res.status(500).json({ error: 'Suhbatlar yuklanmadi' });
  }
});

// Get single session with messages
app.get('/api/ai-chat-sessions/:id', requireMasterAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, databases, messages, created_at, updated_at
       FROM ai_chat_sessions
       WHERE id = $1 AND admin_id = $2`,
      [req.params.id, req.session.adminId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Suhbat topilmadi' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('[AI Sessions] Get error:', error);
    res.status(500).json({ error: 'Suhbat yuklanmadi' });
  }
});

// Create or update session
app.post('/api/ai-chat-sessions', requireMasterAdmin, async (req, res) => {
  try {
    const { id, title, databases, messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages required' });
    }

    const dbs = Array.isArray(databases) && databases.length > 0 ? databases : ['lex.uz'];
    const sessionTitle = title || (messages[0] && messages[0].text ? messages[0].text.substring(0, 60) : 'Nomsiz suhbat');

    if (id) {
      // Update existing session
      const result = await pool.query(
        `UPDATE ai_chat_sessions
         SET title = $1, databases = $2, messages = $3::jsonb, updated_at = NOW()
         WHERE id = $4 AND admin_id = $5
         RETURNING id`,
        [sessionTitle, dbs, JSON.stringify(messages), id, req.session.adminId]
      );
      if (result.rows.length === 0) {
        // Session not found — create new
        const newResult = await pool.query(
          `INSERT INTO ai_chat_sessions (admin_id, title, databases, messages)
           VALUES ($1, $2, $3, $4::jsonb)
           RETURNING id`,
          [req.session.adminId, sessionTitle, dbs, JSON.stringify(messages)]
        );
        return res.json({ id: newResult.rows[0].id });
      }
      res.json({ id: result.rows[0].id });
    } else {
      // Create new session
      const result = await pool.query(
        `INSERT INTO ai_chat_sessions (admin_id, title, databases, messages)
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING id`,
        [req.session.adminId, sessionTitle, dbs, JSON.stringify(messages)]
      );
      res.json({ id: result.rows[0].id });
    }
  } catch (error) {
    console.error('[AI Sessions] Save error:', error);
    res.status(500).json({ error: 'Suhbat saqlanmadi' });
  }
});

// Delete session
app.delete('/api/ai-chat-sessions/:id', requireMasterAdmin, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM ai_chat_sessions WHERE id = $1 AND admin_id = $2`,
      [req.params.id, req.session.adminId]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('[AI Sessions] Delete error:', error);
    res.status(500).json({ error: 'Suhbat o\'chirilmadi' });
  }
});

// Get archived AI analyses (with filters)
app.get('/api/ai-analyses', requireMasterAdmin, async (req, res) => {
  try {
    const { category, adminId, dateFrom, dateTo, search } = req.query;
    let query = `
      SELECT aa.id, aa.request_id, aa.category, aa.request_text,
             aa.analysis_text, aa.created_at,
             a.full_name as admin_name,
             r.user_id,
             (SELECT COUNT(*) FROM requests r2 WHERE r2.user_id = r.user_id AND r2.id <= r.id) as user_request_seq
      FROM ai_analyses aa
      LEFT JOIN admins a ON aa.admin_id = a.id
      LEFT JOIN requests r ON aa.request_id = r.id
      WHERE 1=1
    `;
    const params = [];
    let paramIdx = 1;

    if (category) {
      query += ` AND aa.category = $${paramIdx++}`;
      params.push(category);
    }
    if (adminId) {
      query += ` AND aa.admin_id = $${paramIdx++}`;
      params.push(adminId);
    }
    if (dateFrom) {
      query += ` AND aa.created_at >= $${paramIdx++}`;
      params.push(dateFrom);
    }
    if (dateTo) {
      query += ` AND aa.created_at < ($${paramIdx++})::date + 1`;
      params.push(dateTo);
    }
    if (search) {
      query += ` AND aa.request_text ILIKE $${paramIdx++}`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY aa.created_at DESC LIMIT 100`;

    const result = await pool.query(query, params);

    // Add anonymous label to each row
    const rows = result.rows.map(row => ({
      ...row,
      anon_name: row.user_id ? `Murojaatchi ${anonId(row.user_id, row.created_at, row.user_request_seq)}` : `Murojaatchi #${row.id}`
    }));

    res.json(rows);
  } catch (error) {
    console.error('[AI Archive] Error:', error);
    res.status(500).json({ error: 'Arxiv yuklashda xatolik' });
  }
});

// Get single archived AI analysis
app.get('/api/ai-analyses/:id', requireMasterAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT aa.id, aa.request_id, aa.category, aa.request_text,
             aa.analysis_text, aa.created_at,
             a.full_name as admin_name,
             r.user_id,
             (SELECT COUNT(*) FROM requests r2 WHERE r2.user_id = r.user_id AND r2.id <= r.id) as user_request_seq
      FROM ai_analyses aa
      LEFT JOIN admins a ON aa.admin_id = a.id
      LEFT JOIN requests r ON aa.request_id = r.id
      WHERE aa.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tahlil topilmadi' });
    }

    const row = result.rows[0];
    if (req.session.role !== 'master') {
      row.request_text = `Murojaatchi ${anonId(row.user_id || row.id, row.created_at, row.user_request_seq)}`;
    }

    res.json(row);
  } catch (error) {
    console.error('[AI Archive] Error:', error);
    res.status(500).json({ error: 'Tahlil yuklashda xatolik' });
  }
});

// Archive grouped by month → sender (all answered requests)
app.get('/api/ai-archive-grouped', requireMasterAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.category, r.created_at, r.answered_at,
             r.responded_by, r.user_id,
             LEFT(r.request_text, 120) as topic,
             ROW_NUMBER() OVER (PARTITION BY r.user_id ORDER BY r.created_at) as user_request_seq,
             aa.id as ai_analysis_id
      FROM requests r
      LEFT JOIN ai_analyses aa ON aa.request_id = r.id
      WHERE r.status = 'answered'
      ORDER BY r.answered_at DESC
    `);

    const uzMonths = ['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr'];

    // Group by month/year → user_id
    const monthMap = new Map();
    for (const row of result.rows) {
      const d = new Date(row.answered_at || row.created_at);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yy = String(d.getFullYear()).slice(-2);
      const monthKey = `${mm}_${yy}`;
      const monthLabel = `${uzMonths[d.getMonth()]} 20${yy}`;

      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, { month: monthKey, label: monthLabel, senderMap: new Map() });
      }
      const monthData = monthMap.get(monthKey);

      const userId = row.user_id || 0;
      if (!monthData.senderMap.has(userId)) {
        monthData.senderMap.set(userId, {
          user_id: userId,
          anon_name: userId ? `Murojaatchi ${anonLabel(userId, row.created_at)}` : `Murojaatchi #${row.id}`,
          items: []
        });
      }
      monthData.senderMap.get(userId).items.push({
        id: row.id,
        category: row.category,
        created_at: row.created_at,
        answered_at: row.answered_at,
        anon_id: userId ? anonId(userId, row.created_at, row.user_request_seq) : `#${row.id}`,
        topic: row.topic || '',
        has_ai: !!row.ai_analysis_id,
        ai_analysis_id: row.ai_analysis_id,
        responded_by: row.responded_by
      });
    }

    // Convert to array
    const grouped = [];
    for (const [, monthData] of monthMap) {
      const senders = [];
      for (const [, sender] of monthData.senderMap) {
        senders.push({
          user_id: sender.user_id,
          anon_name: sender.anon_name,
          total_requests: sender.items.length,
          items: sender.items
        });
      }
      grouped.push({
        month: monthData.month,
        label: monthData.label,
        senders
      });
    }

    // Sort by date descending (newest months first)
    grouped.sort((a, b) => {
      const [am, ay] = a.month.split('_').map(Number);
      const [bm, by] = b.month.split('_').map(Number);
      return by !== ay ? by - ay : bm - am;
    });

    res.json(grouped);
  } catch (error) {
    console.error('[Archive Grouped] Error:', error);
    res.status(500).json({ error: 'Arxiv yuklashda xatolik' });
  }
});

// AI Chat follow-up endpoint
app.post('/api/ai-chat', requireMasterAdmin, async (req, res) => {
  try {
    const { messages, requestText, category } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Xabarlar topilmadi' });
    }

    const systemContext = `Siz O'zbekiston huquqi bo'yicha AI yordamchisiz.
Quyidagi murojaat haqida savollarga javob bering.
${category && category !== 'Boshqa' ? `Yo'nalish: ${category}` : ''}
Murojaat matni: "${requestText}"
Javoblaringiz O'zbek (lotin) tilida, qisqa va aniq bo'lsin.
Huquqiy normalar va lex.uz havolalari bilan javob bering.`;

    const aiMessages = messages.map((msg, i) => ({
      role: msg.role,
      text: i === 0 && msg.role === 'user' ? systemContext + '\n\n' + msg.text : msg.text
    }));

    const aiResult = await callAI(aiMessages, { useSearch: true, maxTokens: 4096 });

    res.json({ reply: aiResult.text });
  } catch (error) {
    console.error('[AI Chat] Error:', error);
    res.status(500).json({ error: 'AI chat xatoligi: ' + error.message });
  }
});

// AI Legal Document Template Generation
app.post('/api/ai-generate-template', requireMasterAdmin, async (req, res) => {
  try {
    const { requestText, category, analysisText, templateType } = req.body;

    if (!requestText || !analysisText) {
      return res.status(400).json({ error: 'Ma\'lumotlar yetarli emas' });
    }

    const templateTypes = {
      'ariza': 'Ariza (sud, prokuratura, yoki boshqa organga)',
      'shikoyat': 'Shikoyat (apellyatsiya yoki kassatsiya)',
      'davo': 'Da\'vo arizasi',
      'shartnoma': 'Shartnoma yoki kelishuv',
      'ishonchnoma': 'Ishonchnoma',
      'bayonnoma': 'Bayonnoma',
      'iltimos': 'Iltimosnoma (petition)',
      'auto': 'Murojaat mazmuniga eng mos hujjat turini aniqlang'
    };

    const selectedType = templateTypes[templateType] || templateTypes['auto'];

    const prompt = `Siz O'zbekiston Respublikasi qonunchiligi bo'yicha huquqiy hujjat tayyorlovchi AI yordamchisiz.

MUROJAAT MATNI:
"${requestText}"
${category && category !== 'Boshqa' ? `Yo'nalish: ${category}` : ''}

AI TAHLIL XULOSASI:
${analysisText.substring(0, 3000)}

VAZIFA: ${selectedType}

HUJJAT TURIGA QARAB KERAKLI MA'LUMOTLAR:

Da'vo arizasi / Ariza / Shikoyat uchun:
- Sud/organ nomi: [ORGAN_NOMI]
- Da'vogar: [DA'VOGAR_ISMI]
- Javobgar: [JAVOBGAR_ISMI]
- Nizo predmeti: murojaat matnidan aniqlang
- Huquqiy asoslar: AI tahlildan oling
- Da'vo miqdori: [SUMMA] (agar tegishli bo'lsa)
- Dalillar: [DALILLAR_ROYXATI]

Shartnoma uchun:
- Shartnoma turi: murojaat matnidan aniqlang
- Tomonlar: [1-TOMON], [2-TOMON]
- Majburiyatlar: murojaat matnidan aniqlang
- To'lov shartlari: [TO'LOV_SHARTLARI]
- Javobgarlik: tegishli qonunchilikka asosan
- Nizolarni hal etish: arbitraj yoki sud tartibi

QOIDALAR:
1. Hujjat O'zbekiston qonunchiligiga TO'LIQ mos bo'lishi shart
2. Rasmiy huquqiy til ishlatilsin (O'zbekiston amaliyotida qo'llaniladigan)
3. To'g'ri tuzilma: sarlavha, kirish, asosiy qism, so'rov/iltimos, imzo
4. [SHAXS_ISMI], [MANZIL], [SANA], [ORGAN_NOMI] kabi to'ldirish joylari qoldiring
5. Tegishli qonun moddalariga aniq havola qiling (Mehnat kodeksi, 100-modda formatida)
6. Faqat O'zbek (lotin) tilida yozing
7. Oxirida: qaysi organga topshirish, nusxa soni, ilova hujjatlar ro'yxati
8. Hujjat to'qib chiqarilgan modda yoki qonunlarga tayanmasin

Hujjatni to'liq professional formatda yozing:`;

    const aiResult = await callAI([{ role: 'user', text: prompt }], { maxTokens: 8192 });

    res.json({ template: aiResult.text });
  } catch (error) {
    console.error('[AI Template] Error:', error);
    res.status(500).json({ error: 'Hujjat yaratish xatoligi: ' + error.message });
  }
});

// Submit AI feedback
app.post('/api/ai-feedback', requireMasterAdmin, async (req, res) => {
  try {
    const { requestId, rating, comment } = req.body;

    if (!requestId || ![1, -1].includes(rating)) {
      return res.status(400).json({ error: 'Noto\'g\'ri ma\'lumot' });
    }

    await pool.query(`
      INSERT INTO ai_feedback (request_id, admin_id, rating, comment)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (request_id, admin_id)
      DO UPDATE SET rating = $3, comment = $4, created_at = NOW()
    `, [requestId, req.session.adminId, rating, comment || null]);

    res.json({ success: true });
  } catch (error) {
    console.error('[AI Feedback] Error:', error);
    res.status(500).json({ error: 'Fikr-mulohaza saqlashda xatolik' });
  }
});


// ========== GOLDEN LEGAL DATASET ENDPOINTS ==========

// GET /api/legal-dataset — list examples with pagination
app.get('/api/legal-dataset', requireMasterAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const data = await getAllExamples(limit, offset);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Dataset yuklashda xatolik' });
  }
});

// GET /api/legal-dataset/stats — dataset statistics
app.get('/api/legal-dataset/stats', requireMasterAdmin, async (req, res) => {
  try {
    const stats = await getDatasetStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Statistika xatolik' });
  }
});

// POST /api/legal-dataset — add new example
app.post('/api/legal-dataset', requireMasterAdmin, async (req, res) => {
  try {
    const { question, legal_field, legal_issue, applicable_law, court_practice, analysis, correct_answer, source, keywords } = req.body;
    if (!question || !legal_field || !legal_issue || !applicable_law || !analysis || !correct_answer) {
      return res.status(400).json({ error: 'Barcha majburiy maydonlar to\'ldirilishi shart' });
    }
    const example = await addExample(req.body);
    res.json({ success: true, example });
  } catch (error) {
    res.status(500).json({ error: 'Namuna qo\'shishda xatolik' });
  }
});

// PUT /api/legal-dataset/:id — update example
app.put('/api/legal-dataset/:id', requireMasterAdmin, async (req, res) => {
  try {
    const example = await updateExample(parseInt(req.params.id), req.body);
    if (!example) return res.status(404).json({ error: 'Namuna topilmadi' });
    res.json({ success: true, example });
  } catch (error) {
    res.status(500).json({ error: 'Yangilashda xatolik' });
  }
});

// DELETE /api/legal-dataset/:id — delete example
app.delete('/api/legal-dataset/:id', requireMasterAdmin, async (req, res) => {
  try {
    await deleteExample(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'O\'chirishda xatolik' });
  }
});

// POST /api/legal-dataset/search — test similarity search
app.post('/api/legal-dataset/search', requireMasterAdmin, async (req, res) => {
  try {
    const { question, legal_field } = req.body;
    if (!question) return res.status(400).json({ error: 'Savol kerak' });
    const results = await retrieveSimilarExamples(question, legal_field);
    res.json({ results, count: results.length });
  } catch (error) {
    res.status(500).json({ error: 'Qidirishda xatolik' });
  }
});

// POST /api/legal-dataset/from-analysis — create dataset entry from approved AI analysis
app.post('/api/legal-dataset/from-analysis', requireMasterAdmin, async (req, res) => {
  try {
    const { requestId } = req.body;
    if (!requestId) return res.status(400).json({ error: 'requestId kerak' });

    // Get the request and its analysis
    const reqResult = await pool.query(`SELECT r.request_text, r.category, aa.analysis_text
      FROM requests r
      LEFT JOIN ai_analyses aa ON aa.request_id = r.id
      WHERE r.id = $1
      ORDER BY aa.created_at DESC LIMIT 1`, [requestId]);

    if (reqResult.rows.length === 0) return res.status(404).json({ error: 'Murojaat topilmadi' });
    const { request_text, category, analysis_text } = reqResult.rows[0];
    if (!analysis_text) return res.status(400).json({ error: 'AI tahlil topilmadi' });

    const example = await addExample({
      question: request_text,
      legal_field: category || 'Umumiy',
      legal_issue: request_text.substring(0, 200),
      applicable_law: 'AI tahlildan olingan — tekshiring',
      analysis: analysis_text.substring(0, 2000),
      correct_answer: analysis_text.substring(0, 1000),
      source: 'ai_analysis_approved',
      keywords: []
    });

    res.json({ success: true, example, note: 'Namuna yaratildi — iltimos, maydonlarni tekshirib tahrirlang.' });
  } catch (error) {
    res.status(500).json({ error: 'Namuna yaratishda xatolik' });
  }
});

// ========== LAWYER FEEDBACK DATASET ENDPOINTS ==========

// GET /api/lawyer-feedback — list feedback with pagination
app.get('/api/lawyer-feedback', requireMasterAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const data = await getAllFeedback(limit, offset);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Feedback yuklashda xatolik' });
  }
});

// GET /api/lawyer-feedback/stats — feedback statistics
app.get('/api/lawyer-feedback/stats', requireMasterAdmin, async (req, res) => {
  try {
    const stats = await getFeedbackStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Statistika xatolik' });
  }
});

// POST /api/lawyer-feedback — manual feedback submission
app.post('/api/lawyer-feedback', requireMasterAdmin, async (req, res) => {
  try {
    const { request_id, question, ai_answer, mentor_feedback_type, corrected_answer,
            corrected_legal_reasoning, corrected_law_articles, legal_field } = req.body;
    if (!question || !mentor_feedback_type) {
      return res.status(400).json({ error: 'Savol va baholash turi kerak' });
    }
    const feedback = await saveMentorFeedback({
      ...req.body,
      mentor_id: req.session.adminId,
      mentor_name: req.session.fullName
    });
    res.json({ success: true, feedback });
  } catch (error) {
    res.status(500).json({ error: 'Feedback saqlashda xatolik' });
  }
});

// ========== CASE-LAW DATASET ENDPOINTS ==========

// GET /api/case-law — list court cases with pagination
app.get('/api/case-law', requireMasterAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const data = await getAllCases(limit, offset);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Sud ishlari yuklashda xatolik' });
  }
});

// GET /api/case-law/stats — case-law statistics
app.get('/api/case-law/stats', requireMasterAdmin, async (req, res) => {
  try {
    const stats = await getCaseLawStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Statistika xatolik' });
  }
});

// POST /api/case-law — add new court case
app.post('/api/case-law', requireMasterAdmin, async (req, res) => {
  try {
    const { case_id, court_name, case_category, legal_issue, facts_summary, applied_laws, court_reasoning, final_decision } = req.body;
    if (!case_id || !court_name || !legal_issue || !facts_summary || !applied_laws || !court_reasoning || !final_decision) {
      return res.status(400).json({ error: 'Barcha majburiy maydonlar to\'ldirilishi shart' });
    }
    const courtCase = await addCase(req.body);
    res.json({ success: true, courtCase });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Bu ish raqami allaqachon mavjud' });
    res.status(500).json({ error: 'Sud ishi qo\'shishda xatolik' });
  }
});

// PUT /api/case-law/:id — update court case
app.put('/api/case-law/:id', requireMasterAdmin, async (req, res) => {
  try {
    const courtCase = await updateCase(parseInt(req.params.id), req.body);
    if (!courtCase) return res.status(404).json({ error: 'Sud ishi topilmadi' });
    res.json({ success: true, courtCase });
  } catch (error) {
    res.status(500).json({ error: 'Yangilashda xatolik' });
  }
});

// DELETE /api/case-law/:id — delete court case
app.delete('/api/case-law/:id', requireMasterAdmin, async (req, res) => {
  try {
    await deleteCase(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'O\'chirishda xatolik' });
  }
});

// POST /api/case-law/search — test case similarity search
app.post('/api/case-law/search', requireMasterAdmin, async (req, res) => {
  try {
    const { question, legal_field } = req.body;
    if (!question) return res.status(400).json({ error: 'Savol kerak' });
    const results = await retrieveSimilarCases(question, legal_field, 3);
    res.json({ results, count: results.length });
  } catch (error) {
    res.status(500).json({ error: 'Qidirishda xatolik' });
  }
});

// ========== AGENT ENDPOINTS ==========

const { triageRequest } = require('../agents/triage');
const { getTraces, getLatestTrace } = require('../agents/runner');

// Re-run triage on a request (master admin only)
app.post('/api/requests/:id/triage', requireMasterAdmin, async (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    const request = await pool.query('SELECT request_text, request_type FROM requests WHERE id = $1', [requestId]);
    if (request.rows.length === 0) return res.status(404).json({ error: 'So\'rov topilmadi' });

    const { request_text, request_type } = request.rows[0];
    const result = await triageRequest(requestId, request_text, request_type);
    if (!result) return res.status(500).json({ error: 'Triage agent xatolik berdi' });

    res.json({ success: true, triage: result });
  } catch (error) {
    console.error('[API] Triage error:', error);
    res.status(500).json({ error: 'Triage xatolik' });
  }
});

// Classify legal field for a request
app.post('/api/requests/:id/classify', requireAuth, async (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    const request = await pool.query('SELECT request_text FROM requests WHERE id = $1', [requestId]);
    if (request.rows.length === 0) return res.status(404).json({ error: 'So\'rov topilmadi' });

    const result = await classifyLegalField(request.rows[0].request_text, requestId);
    res.json({ success: true, classification: result });
  } catch (error) {
    console.error('[API] Classification error:', error);
    res.status(500).json({ error: 'Klassifikatsiya xatolik' });
  }
});

// Get agent traces for a request
app.get('/api/requests/:id/traces', requireAuth, async (req, res) => {
  try {
    const requestId = parseInt(req.params.id);
    const traces = await getTraces(requestId);
    res.json(traces);
  } catch (error) {
    console.error('[API] Traces error:', error);
    res.status(500).json({ error: 'Traces xatolik' });
  }
});

// ========== SELF-REGISTRATION ==========

// AI Screening using GPT-4o
async function triggerAiScreening(regId, regData) {
  const apiKey = process.env.GPT_API_KEY;
  if (!apiKey) return;

  try {
    let docBase64 = null;
    let docMimeType = null;
    let docFetched = false;

    // If document uploaded, fetch and include as vision input
    if (regData.document_file_id && regData.document_file_id !== 'upload_failed') {
      try {
        const fileLink = await bot.getFileLink(regData.document_file_id);
        const resp = await fetch(fileLink);
        const buffer = await resp.arrayBuffer();
        docBase64 = Buffer.from(buffer).toString('base64');
        const ext = fileLink.toLowerCase();
        docMimeType = ext.includes('.png') ? 'image/png' : ext.includes('.webp') ? 'image/webp' : 'image/jpeg';
        docFetched = true;
      } catch (e) {
        console.error('[AI SCREENING] Could not fetch document from Telegram:', e.message);
      }
    }

    // Fallback: use DB-stored base64 document
    if (!docFetched) {
      try {
        const dbDoc = await pool.query('SELECT document_base64, document_mimetype FROM registration_requests WHERE id = $1', [regId]);
        if (dbDoc.rows.length > 0 && dbDoc.rows[0].document_base64) {
          docBase64 = dbDoc.rows[0].document_base64;
          docMimeType = dbDoc.rows[0].document_mimetype;
          // GPT-4o vision supports images only, skip PDFs
          if (docMimeType && !docMimeType.startsWith('image/')) {
            docBase64 = null;
            docMimeType = null;
          } else {
            docFetched = true;
          }
        }
      } catch (e) {
        console.error('[AI SCREENING] Could not fetch document from DB:', e.message);
      }
    }

    const isLawyer = regData.type === 'lawyer';
    const infoBlock = isLawyer
      ? `Ism: ${regData.first_name}\nFamiliya: ${regData.last_name}\nTuri: Advokat\nMutaxassislik: ${regData.specialization || '-'}\nTajriba: ${regData.experience_years || '-'} yil\nTelegram: @${regData.telegram_username}`
      : `Ism: ${regData.first_name}\nFamiliya: ${regData.last_name}\nTuri: Student\nBosqich: ${regData.level || '-'}\nTelegram: @${regData.telegram_username}`;

    const docNote = docFetched
      ? 'Yuklangan hujjatni ko\'ring va tekshiring.'
      : 'Hujjat yuklangan, lekin texnik sabablarga ko\'ra olinmadi. Faqat boshqa ma\'lumotlar asosida baholang. document_authentic ni true deb belgilang.';

    const today = new Date().toISOString().split('T')[0];
    const screenPrompt = `Ro'yxatdan o'tish so'rovini tekshiring.\n\nBugungi sana: ${today}\n\nAriza beruvchi ma'lumotlari:\n${infoBlock}\n\n${docNote}\n\nTekshiring:\n1. ${docFetched ? 'Hujjatdagi ism-familiya ariza beruvchi kiritgan ma\'lumotlarga mosmi?' : 'Ism-familiya to\'g\'ri formatdami?'}\n2. ${docFetched ? 'Hujjat huquqshunoslik (yuridik) sohasiga tegishlimi?' : 'Ma\'lumotlar to\'liqmi?'}\n3. Barcha ma'lumotlar to'liqmi?\n4. ${docFetched ? 'Hujjat haqiqiymi yoki shubhalimi? Bugungi sana ' + today + ' — hujjat sanasi bugungi yoki undan oldingi bo\'lsa, bu normal.' : 'Hujjat texnik sabablarga ko\'ra ko\'rib bo\'lmadi — true deb belgilang.'}\n${isLawyer ? '5. Mutaxassislik hujjatga mosmi?\n' : ''}\nJavobni faqat JSON formatda bering:\n{"status":"passed" yoki "flagged","name_match":true/false,"is_law_field":true/false,"info_complete":true/false,"document_authentic":true/false,"notes":"Qisqa izoh"}`;

    // Build GPT-4o Chat Completions request with vision
    const content = [];
    if (docBase64 && docMimeType) {
      content.push({ type: 'image_url', image_url: { url: `data:${docMimeType};base64,${docBase64}` } });
    }
    content.push({ type: 'text', text: screenPrompt });

    const gptBody = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content }],
      temperature: 0.2,
      max_tokens: 1024,
      response_format: { type: 'json_object' }
    };

    let gptResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(gptBody)
    });

    // Retry once after 3s if rate-limited (429)
    if (gptResp.status === 429) {
      console.log('[AI SCREENING] Rate limited, retrying in 3s...');
      await new Promise(r => setTimeout(r, 3000));
      gptResp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(gptBody)
      });
    }

    if (!gptResp.ok) {
      console.error('[AI SCREENING] GPT-4o API error:', gptResp.status);
      return;
    }

    const data = await gptResp.json();
    const resultText = data.choices?.[0]?.message?.content;
    if (!resultText) return;

    let screeningResult;
    try {
      const cleaned = resultText.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      screeningResult = jsonMatch ? JSON.parse(jsonMatch[0]) : { status: 'passed', notes: 'AI javob berdi, lekin JSON formatda emas. Qo\'lda tekshiring.' };
    } catch (e) {
      screeningResult = { status: 'passed', notes: 'AI javobini parse qilib bo\'lmadi. Qo\'lda tekshiring.', raw: resultText.substring(0, 500) };
    }

    const aiStatus = screeningResult.status === 'passed' ? 'passed' : 'flagged';
    await pool.query(
      `UPDATE registration_requests SET ai_screening_result = $1, ai_screening_status = $2 WHERE id = $3`,
      [JSON.stringify(screeningResult), aiStatus, regId]
    );
    console.log(`[AI SCREENING] Request #${regId}: ${aiStatus}`);
  } catch (error) {
    console.error('[AI SCREENING] Error:', error);
  }
}

// POST /api/send-verification-code — generate code + deep link token
app.post('/api/send-verification-code', async (req, res) => {
  try {
    // Generate 4-digit code + unique deep link token
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const token = crypto.randomBytes(8).toString('hex');

    verificationTokens.set(token, { code, expiresAt: Date.now() + 5 * 60 * 1000 });

    console.log(`[VERIFY] Code generated, token: ${token}`);

    res.json({ success: true, token });
  } catch (error) {
    console.error('[VERIFY CODE] Error:', error);
    res.status(500).json({ error: 'Kod yuborishda xatolik yuz berdi' });
  }
});

// POST /api/register — public self-registration
app.post('/api/register', regUpload.single('document'), async (req, res) => {
  try {
    const { first_name, last_name, type, level, specialization, experience_years, license_number, telegram_username, password, verification_code, verification_token } = req.body;

    if (!first_name || !last_name || !type) {
      return res.status(400).json({ error: 'Barcha maydonlar to\'ldirilishi shart' });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Parol kamida 6 ta belgi bo\'lishi kerak' });
    }

    const regType = type === 'lawyer' ? 'lawyer' : 'student';
    if (regType === 'student' && !level) {
      return res.status(400).json({ error: 'Bosqichni tanlang' });
    }
    if (regType === 'lawyer' && !specialization) {
      return res.status(400).json({ error: 'Mutaxassislikni tanlang' });
    }

    const cleanUsername = telegram_username ? telegram_username.replace(/@/g, '').trim() : '';

    // Verify Telegram code via token
    if (!verification_token || !verification_code) {
      return res.status(400).json({ error: 'Telegram tasdiqlash kodini kiriting' });
    }
    const storedCode = verificationTokens.get(verification_token);
    if (!storedCode || storedCode.code !== verification_code || Date.now() > storedCode.expiresAt) {
      return res.status(400).json({ error: 'Tasdiqlash kodi noto\'g\'ri yoki muddati o\'tgan. Qayta kod yuboring.' });
    }
    const applicantChatId = storedCode.chatId || null;

    // Check duplicate pending (by name since telegram username is optional)
    const existing = await pool.query(
      `SELECT id FROM registration_requests WHERE first_name = $1 AND last_name = $2 AND status = 'pending'`,
      [first_name.trim(), last_name.trim()]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Sizning ismingiz bilan allaqachon so\'rov yuborilgan. Admin javobini kuting.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Iltimos, isbotlovchi hujjatni yuklang' });
    }

    // Read file into base64 for DB storage (reliable fallback)
    const fileBuffer = fs.readFileSync(req.file.path);
    const documentBase64 = fileBuffer.toString('base64');
    const documentMimetype = req.file.mimetype;

    // Try uploading to Telegram for persistent storage
    let documentFileId = null;
    let documentFileName = req.file.originalname;
    try {
      const tgInfo = cleanUsername ? `\n📱 @${cleanUsername}` : '';
      const caption = regType === 'lawyer'
        ? `📋 Yangi advokat ro'yxatdan o'tish\n👤 ${first_name} ${last_name}\n📜 ${specialization}${tgInfo}`
        : `📋 Yangi student ro'yxatdan o'tish\n👤 ${first_name} ${last_name}\n📚 ${level}${tgInfo}`;
      const sentDoc = await bot.sendDocument(process.env.ADMIN_TELEGRAM_ID, req.file.path, { caption }, { filename: req.file.originalname, contentType: req.file.mimetype });
      documentFileId = sentDoc.document.file_id;
    } catch (uploadErr) {
      console.error('[REGISTER] Telegram upload error:', uploadErr.message);
      documentFileId = 'upload_failed';
    } finally {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO registration_requests (type, first_name, last_name, level, specialization, experience_years, license_number, telegram_username, document_file_id, document_file_name, password_hash, document_base64, document_mimetype, telegram_chat_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [regType, first_name.trim(), last_name.trim(), level || null, specialization || null, experience_years ? parseInt(experience_years) : null, license_number || null, cleanUsername || null, documentFileId, documentFileName, passwordHash, documentBase64, documentMimetype, applicantChatId]
    );

    // Registration succeeded — now safe to delete the verification token
    verificationTokens.delete(verification_token);

    // Trigger AI screening asynchronously
    triggerAiScreening(result.rows[0].id, { type: regType, first_name, last_name, level, specialization, experience_years, license_number, telegram_username: cleanUsername, document_file_id: documentFileId }).catch(e => console.error('[AI SCREENING]', e));

    res.json({ success: true, message: 'Tabriklaymiz, Sizning so\'rovingiz muvaffaqiyatli yuborildi! Admin javobini kuting!' });
  } catch (error) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
    console.error('[REGISTER] Error:', error);
    res.status(500).json({ error: 'Ro\'yxatdan o\'tishda xatolik' });
  }
});

// ========== PASSWORD RECOVERY ==========

// POST /api/password-recovery/request — check telegram username exists, generate code
app.post('/api/password-recovery/request', async (req, res) => {
  try {
    const { telegram_username } = req.body;
    if (!telegram_username) {
      return res.status(400).json({ error: 'Telegram username kiriting' });
    }
    const cleanUsername = telegram_username.replace('@', '').trim().toLowerCase();

    // Check if this telegram username exists in admins table
    const adminResult = await pool.query(
      'SELECT id, username, full_name FROM admins WHERE LOWER(telegram_username) = $1',
      [cleanUsername]
    );
    if (adminResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bu Telegram username bilan ro\'yxatdan o\'tgan foydalanuvchi topilmadi. Ro\'yxatdan o\'ting.' });
    }

    // Generate 4-digit code + token
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const token = crypto.randomBytes(8).toString('hex');

    verificationTokens.set('recovery_' + token, {
      code,
      expiresAt: Date.now() + 5 * 60 * 1000,
      adminId: adminResult.rows[0].id,
      telegramUsername: cleanUsername,
      verified: false
    });

    console.log(`[RECOVERY] Code generated for ${cleanUsername}, token: ${token}`);
    res.json({ success: true, token });
  } catch (error) {
    console.error('[RECOVERY REQUEST] Error:', error);
    res.status(500).json({ error: 'Xatolik yuz berdi' });
  }
});

// POST /api/password-recovery/verify — verify the 4-digit code
app.post('/api/password-recovery/verify', async (req, res) => {
  try {
    const { token, code } = req.body;
    if (!token || !code) {
      return res.status(400).json({ error: 'Token va kod kerak' });
    }

    const pending = verificationTokens.get('recovery_' + token);
    if (!pending || Date.now() > pending.expiresAt) {
      return res.status(400).json({ error: 'Kod muddati o\'tgan. Qayta urinib ko\'ring.' });
    }
    if (pending.code !== code) {
      return res.status(400).json({ error: 'Kod noto\'g\'ri' });
    }

    // Mark as verified
    pending.verified = true;
    res.json({ success: true });
  } catch (error) {
    console.error('[RECOVERY VERIFY] Error:', error);
    res.status(500).json({ error: 'Xatolik yuz berdi' });
  }
});

// POST /api/password-recovery/reset — set new password
app.post('/api/password-recovery/reset', async (req, res) => {
  try {
    const { token, code, new_password } = req.body;
    if (!token || !code || !new_password) {
      return res.status(400).json({ error: 'Barcha maydonlarni to\'ldiring' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'Parol kamida 6 ta belgi bo\'lishi kerak' });
    }

    const pending = verificationTokens.get('recovery_' + token);
    if (!pending || Date.now() > pending.expiresAt) {
      return res.status(400).json({ error: 'Sessiya muddati o\'tgan. Qayta urinib ko\'ring.' });
    }
    if (pending.code !== code || !pending.verified) {
      return res.status(400).json({ error: 'Tasdiqlash xatosi' });
    }

    // Hash new password and update
    const hashedPassword = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE admins SET password = $1 WHERE id = $2', [hashedPassword, pending.adminId]);

    // Clean up token
    verificationTokens.delete('recovery_' + token);

    console.log(`[RECOVERY] Password reset for admin ID: ${pending.adminId}`);
    res.json({ success: true, message: 'Parol muvaffaqiyatli yangilandi' });
  } catch (error) {
    console.error('[RECOVERY RESET] Error:', error);
    res.status(500).json({ error: 'Parolni yangilashda xatolik' });
  }
});

// GET /api/registration-requests — master only
app.get('/api/registration-requests', requireMasterAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    let query = `SELECT rr.*, a.full_name as reviewer_name FROM registration_requests rr LEFT JOIN admins a ON rr.reviewed_by = a.id`;
    const params = [];
    if (status) { query += ' WHERE rr.status = $1'; params.push(status); }
    query += ' ORDER BY rr.created_at DESC';
    const result = await pool.query(query, params);
    // Strip large base64 data from list response, send flag instead
    const rows = result.rows.map(r => {
      const { document_base64, ...rest } = r;
      rest.has_document_base64 = !!document_base64;
      return rest;
    });
    res.json(rows);
  } catch (error) {
    console.error('[REG REQUESTS] Error:', error);
    res.status(500).json({ error: 'So\'rovlar yuklashda xatolik' });
  }
});

// GET /api/registration-requests/stats
app.get('/api/registration-requests/stats', requireMasterAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE status = 'pending') AS pending,
             COUNT(*) FILTER (WHERE status = 'approved') AS approved,
             COUNT(*) FILTER (WHERE status = 'rejected') AS rejected
      FROM registration_requests
    `);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Statistika xatolik' });
  }
});

// POST /api/registration-requests/:id/approve — master only
app.post('/api/registration-requests/:id/approve', requireMasterAdmin, async (req, res) => {
  try {
    const regResult = await pool.query('SELECT * FROM registration_requests WHERE id = $1 AND status = $2', [req.params.id, 'pending']);
    if (regResult.rows.length === 0) return res.status(404).json({ error: 'So\'rov topilmadi yoki allaqachon ko\'rib chiqilgan' });

    const reg = regResult.rows[0];

    // Use Telegram username as login username, fall back to name-based
    const rawUsername = reg.telegram_username || `${reg.first_name}_${reg.last_name}`;
    let baseUsername = rawUsername.toLowerCase().replace(/[^a-z0-9_]/g, '').substring(0, 30);
    if (!baseUsername) baseUsername = 'user';
    let finalUsername = baseUsername;
    let suffix = 0;
    while ((await pool.query('SELECT id FROM admins WHERE LOWER(username) = $1', [finalUsername.toLowerCase()])).rows.length > 0) {
      suffix++;
      finalUsername = baseUsername + suffix;
    }

    // Use password from registration or generate fallback
    let finalHashedPassword;
    if (reg.password_hash) {
      finalHashedPassword = reg.password_hash;
    } else {
      // Fallback for old registrations without password
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
      let tempPwd = '';
      for (let i = 0; i < 8; i++) tempPwd += chars.charAt(Math.floor(Math.random() * chars.length));
      finalHashedPassword = await bcrypt.hash(tempPwd, 10);
    }

    const fullName = `${reg.last_name} ${reg.first_name}`;
    const role = reg.type === 'lawyer' ? 'lawyer' : 'student';

    await pool.query('INSERT INTO admins (username, password, full_name, role, telegram_username) VALUES ($1, $2, $3, $4, $5)', [finalUsername, finalHashedPassword, fullName, role, reg.telegram_username]);
    await pool.query('UPDATE registration_requests SET status = $1, reviewed_at = NOW(), reviewed_by = $2 WHERE id = $3', ['approved', req.session.adminId, req.params.id]);

    // Notify via Telegram using stored chat_id from verification
    const parolText = reg.password_hash ? "Siz ro'yxatdan o'tishda yaratgan parol" : '(Admin tomonidan beriladi)';
    const approvalMsg = `✅ Tabriklaymiz! Ro'yxatdan o'tish so'rovingiz tasdiqlandi!\n\n🔑 Kirish ma'lumotlari:\n👤 Username: ${finalUsername}\n🔒 Parol: ${parolText}\n\n🌐 Dashboard: ${process.env.DASHBOARD_URL || 'https://' + (process.env.WEBHOOK_DOMAIN || 'localhost:3000')}\n\nDictum advokatlik firmasi`;
    let telegramSent = false;
    try {
      const chatId = reg.telegram_chat_id;
      if (chatId) {
        await bot.sendMessage(chatId, approvalMsg);
        telegramSent = true;
      }
    } catch (e) { console.error('[APPROVE] Telegram error:', e.message); }

    res.json({ success: true, credentials: { username: finalUsername, telegram: reg.telegram_username, fullName, userSetPassword: !!reg.password_hash }, telegramSent, telegramMessage: approvalMsg });
  } catch (error) {
    console.error('[APPROVE] Error:', error);
    res.status(500).json({ error: 'Tasdiqlashda xatolik' });
  }
});

// POST /api/registration-requests/:id/reject — master only
app.post('/api/registration-requests/:id/reject', requireMasterAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Rad etish sababi ko\'rsatilishi shart' });

    const regResult = await pool.query('SELECT * FROM registration_requests WHERE id = $1 AND status = $2', [req.params.id, 'pending']);
    if (regResult.rows.length === 0) return res.status(404).json({ error: 'So\'rov topilmadi' });

    const reg = regResult.rows[0];
    await pool.query('UPDATE registration_requests SET status = $1, rejection_reason = $2, reviewed_at = NOW(), reviewed_by = $3 WHERE id = $4', ['rejected', reason, req.session.adminId, req.params.id]);

    // Notify via Telegram using stored chat_id from verification
    const rejectMsg = `❌ Ro'yxatdan o'tish so'rovingiz rad etildi.\n\nSabab: ${reason}\n\nDictum advokatlik firmasi`;
    let telegramSent = false;
    try {
      const chatId = reg.telegram_chat_id;
      if (chatId) {
        await bot.sendMessage(chatId, rejectMsg);
        telegramSent = true;
      }
    } catch (e) { console.error('[REJECT] Telegram error:', e.message); }

    res.json({ success: true, telegramSent, telegramMessage: rejectMsg });
  } catch (error) {
    console.error('[REJECT] Error:', error);
    res.status(500).json({ error: 'Rad etishda xatolik' });
  }
});

// GET /api/registration-document/:fileId — master only
app.get('/api/registration-document/:fileId', requireMasterAdmin, async (req, res) => {
  try {
    const fileId = req.params.fileId;
    // If Telegram file_id is valid, use Telegram
    if (fileId && fileId !== 'upload_failed') {
      try {
        const fileLink = await bot.getFileLink(fileId);
        return res.json({ fileLink });
      } catch (e) {
        console.error('[REG DOC] Telegram getFileLink failed:', e.message);
      }
    }
    // Fallback: serve from DB base64
    const regId = req.query.regId;
    if (regId) {
      const dbDoc = await pool.query('SELECT document_base64, document_mimetype, document_file_name FROM registration_requests WHERE id = $1', [regId]);
      if (dbDoc.rows.length > 0 && dbDoc.rows[0].document_base64) {
        const row = dbDoc.rows[0];
        return res.json({ base64: row.document_base64, mimetype: row.document_mimetype, fileName: row.document_file_name });
      }
    }
    res.status(404).json({ error: 'Hujjat topilmadi' });
  } catch (error) {
    res.status(500).json({ error: 'Hujjatni olishda xatolik' });
  }
});

// Auto-migrate database on startup (add missing columns)
async function runMigrations() {
  try {
    // Admins table migrations
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT DEFAULT NULL`);
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS duty_start TIME DEFAULT NULL`);
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS duty_end TIME DEFAULT NULL`);
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP DEFAULT NULL`);
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(100) DEFAULT NULL`);

    // Users table migrations (ensure all columns exist)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMP`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_by INTEGER`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS block_reason TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(255)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active TIMESTAMP DEFAULT NOW()`);

    // Drop ALL FK constraints referencing admins, re-add with ON DELETE SET NULL
    try {
      const fks = await pool.query(`
        SELECT con.conname, rel.relname AS table_name
        FROM pg_constraint con
        JOIN pg_class rel ON con.conrelid = rel.oid
        JOIN pg_class ref ON con.confrelid = ref.oid
        WHERE con.contype = 'f' AND ref.relname = 'admins'
      `);
      for (const fk of fks.rows) {
        const action = fk.table_name === 'chat_messages' ? 'CASCADE' : 'SET NULL';
        // Find the column(s) for this constraint
        const colResult = await pool.query(`
          SELECT a.attname FROM pg_constraint c
          JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
          WHERE c.conname = $1
        `, [fk.conname]);
        const col = colResult.rows[0]?.attname;
        if (!col) continue;
        await pool.query(`ALTER TABLE ${fk.table_name} DROP CONSTRAINT ${fk.conname}`);
        await pool.query(`ALTER TABLE ${fk.table_name} ADD CONSTRAINT ${fk.conname} FOREIGN KEY (${col}) REFERENCES admins(id) ON DELETE ${action}`);
        console.log(`[DB] Fixed FK: ${fk.table_name}.${col} -> ON DELETE ${action}`);
      }
    } catch(e) { console.log('[DB] FK constraint migration:', e.message); }

    // Requests table migrations (ensure all columns exist)
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS category VARCHAR(255) DEFAULT 'Boshqa'`);
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS student_response TEXT`);
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS student_admin_id INTEGER`);
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS assigned_to INTEGER`);
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP`);
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS assigned_student_id INTEGER`);
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS assigned_student_at TIMESTAMP`);

    // Multi-student assignment junction table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS request_students (
        id SERIAL PRIMARY KEY,
        request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        assigned_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(request_id, student_id)
      )
    `);
    // Migrate existing single-student assignments into junction table
    try {
      await pool.query(`
        INSERT INTO request_students (request_id, student_id, assigned_at)
        SELECT id, assigned_student_id, COALESCE(assigned_student_at, NOW())
        FROM requests WHERE assigned_student_id IS NOT NULL
        ON CONFLICT (request_id, student_id) DO NOTHING
      `);
    } catch(e) { console.log('[DB] Student migration note:', e.message); }

    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS answered_at TIMESTAMP`);
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS master_approved BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS responded_by VARCHAR(255)`);
    // Widen file_id to TEXT in case Telegram IDs exceed 255 chars
    await pool.query(`ALTER TABLE requests ALTER COLUMN file_id TYPE TEXT`);

    // Chat messages migration
    await pool.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_feedback (
        id SERIAL PRIMARY KEY,
        request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
        admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
        rating SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
        comment TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(request_id, admin_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_analyses (
        id SERIAL PRIMARY KEY,
        request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
        admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
        category VARCHAR(255),
        request_text TEXT,
        analysis_text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_analyses_created ON ai_analyses(created_at DESC)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_chat_sessions (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
        title TEXT,
        databases TEXT[] DEFAULT '{lex.uz}',
        messages JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_updated ON ai_chat_sessions(updated_at DESC)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS registration_requests (
        id SERIAL PRIMARY KEY,
        type VARCHAR(10) NOT NULL DEFAULT 'student',
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        level VARCHAR(20),
        specialization VARCHAR(255),
        experience_years INTEGER,
        license_number VARCHAR(100),
        telegram_username VARCHAR(100),
        document_file_id TEXT,
        document_file_name VARCHAR(255),
        status VARCHAR(20) DEFAULT 'pending',
        ai_screening_result JSONB,
        ai_screening_status VARCHAR(20) DEFAULT 'pending',
        rejection_reason TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        reviewed_at TIMESTAMP,
        reviewed_by INTEGER REFERENCES admins(id) ON DELETE SET NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_reg_requests_status ON registration_requests(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_reg_requests_created ON registration_requests(created_at DESC)`);
    await pool.query(`ALTER TABLE registration_requests ADD COLUMN IF NOT EXISTS password_hash TEXT`);
    await pool.query(`ALTER TABLE registration_requests ADD COLUMN IF NOT EXISTS document_base64 TEXT`);
    await pool.query(`ALTER TABLE registration_requests ADD COLUMN IF NOT EXISTS document_mimetype VARCHAR(100)`);
    await pool.query(`ALTER TABLE registration_requests ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT`);
    await pool.query(`ALTER TABLE registration_requests ALTER COLUMN telegram_username DROP NOT NULL`);
    // Ensure 'admin' account is always master role
    await pool.query(`UPDATE admins SET role = 'master' WHERE username = 'admin'`);

    // Agent traces table — audit log for all AI agent runs
    await pool.query(`CREATE TABLE IF NOT EXISTS agent_traces (
      id SERIAL PRIMARY KEY,
      request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
      agent_type VARCHAR(50) NOT NULL,
      input_summary TEXT,
      output JSONB NOT NULL DEFAULT '{}',
      sources JSONB DEFAULT '[]',
      model_used VARCHAR(100),
      tokens_used INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_agent_traces_request ON agent_traces(request_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_agent_traces_type ON agent_traces(agent_type)`);

    // New columns on requests for agent results
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS triage_result JSONB`);
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS verification_result JSONB`);
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS ai_draft TEXT`);
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS ai_research_brief JSONB`);

    // Legal field classifier column
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS detected_legal_field VARCHAR(100)`);

    // Internal reasoning storage for audit
    await pool.query(`ALTER TABLE ai_analyses ADD COLUMN IF NOT EXISTS internal_reasoning TEXT`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_requests_legal_field ON requests(detected_legal_field)`);

    console.log('[DB] Migrations completed successfully');
    await initLegalDataset();
    await initFeedbackDataset();
    await initCaseLawDataset();
  } catch (err) {
    console.error('[DB] Migration error:', err.message);
  }
}

runMigrations().then(() => {
  app.listen(PORT, () => {
    console.log(`[SERVER] Dashboard running on port ${PORT}${WEBHOOK_DOMAIN ? ' | https://' + WEBHOOK_DOMAIN : ''}`);
  });
});
