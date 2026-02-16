require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const os = require('os');
const fs = require('fs');
const { pool } = require('../database/db');

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

// Session configuration
app.use(session({
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
    const studentFilter = req.session.role === 'student' ? `WHERE assigned_to = ${parseInt(req.session.adminId)}` : '';
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
        COUNT(*) FILTER (WHERE status = 'student_responded') AS student_responded,
        COUNT(*) FILTER (WHERE status = 'answered') AS answered
      FROM requests
      ${studentFilter}
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
    // Students only see requests assigned to them
    const studentFilter = req.session.role === 'student' ? `WHERE r.assigned_to = ${parseInt(req.session.adminId)}` : '';
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
        ROW_NUMBER() OVER (PARTITION BY r.user_id ORDER BY r.created_at) as user_request_seq,
        (SELECT aa.id FROM ai_analyses aa WHERE aa.request_id = r.id ORDER BY aa.created_at DESC LIMIT 1) as ai_analysis_id
      FROM requests r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN admins a ON r.assigned_to = a.id
      ${studentFilter}
      ORDER BY r.created_at DESC
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
    const { requestId } = req.body;
    
    // Get request details
    const requestResult = await pool.query(`
      SELECT 
        u.telegram_id, 
        u.username,
        u.first_name, 
        r.student_response
      FROM requests r
      JOIN users u ON r.user_id = u.id
      WHERE r.id = $1
    `, [requestId]);
    
    if (requestResult.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    const { telegram_id, username, first_name, student_response } = requestResult.rows[0];
    
    // Update database
    await pool.query(`
      UPDATE requests 
      SET response_text = student_response,
          status = 'answered',
          master_approved = TRUE,
          answered_at = NOW()
      WHERE id = $1
    `, [requestId]);
    
    // Send to client
    const message = `
✅ Yuristdan javob keldi!

Hurmatli ${first_name},

${student_response}

Dictum advokatlik firmasi
    `;
    
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
      SELECT id, username, full_name, role, duty_start, duty_end, last_active_at, created_at,
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
    // Remove all FK references to this admin before deleting
    await pool.query('UPDATE requests SET assigned_to = NULL, assigned_at = NULL WHERE assigned_to = $1', [adminId]);
    await pool.query('UPDATE requests SET student_admin_id = NULL WHERE student_admin_id = $1', [adminId]);
    await pool.query('UPDATE block_history SET performed_by = NULL WHERE performed_by = $1', [adminId]);
    await pool.query('UPDATE registration_requests SET reviewed_by = NULL WHERE reviewed_by = $1', [adminId]);
    // Delete the admin
    await pool.query('DELETE FROM admins WHERE id = $1', [adminId]);
    res.json({ success: true, deleted: adminCheck.rows[0].full_name });
  } catch (error) {
    console.error('Error deleting admin:', error);
    res.status(500).json({ error: 'Admin o\'chirib bo\'lmadi' });
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

// AI Analysis endpoint using Gemini 2.5
app.post('/api/ai-analysis', requireMasterAdmin, async (req, res) => {
  try {
    const { requestText, category, requestId } = req.body;
    if (!requestText) {
      return res.status(400).json({ error: 'Murojaat matni topilmadi' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Gemini API kaliti sozlanmagan. GEMINI_API_KEY env o\'rnatilmagan.' });
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
          feedbackNote = `\n\nEslatma: Foydalanuvchilar so'nggi 30 kunda ${satisfaction}% qoniqish bildirdi. Iltimos, tahlilni yanada batafsil va aniq qiling. Har bir xulosani asoslang.`;
        }
      }
    } catch (e) { /* feedback query failure is non-critical */ }

    const prompt = `You are an AI Legal Research Assistant integrated into a legal-tech educational platform in Uzbekistan.

${category && category !== 'Boshqa' ? `Yo'nalish: ${category}` : ''}

Case matni:
"${requestText}"

Your task:
- Tahlil qilish
- Quyidagi lex.uz hujjatlar katalogidan tegishli normalarni topish
- Qisqa va aniq huquqiy xulosa berish

⚠ Natija faqat O'zbek (lotin) tilida bo'lishi shart.
⚠ Javob qisqa, aniq va strukturali bo'lishi shart.
⚠ Ortiqcha izoh berilmasin.
⚠ QATTIYAN TAQIQLANADI: Lex.uz havolalarini to'qib chiqarish (fabricate) mutlaqo man etiladi! Agar aniq URL manzilini bilmasangiz, havola bermang. Mavjud bo'lmagan yoki taxminiy URL yozish MUMKIN EMAS.

## O'ZBEKISTON QONUNCHILIK KATALOGI (lex.uz)

Quyidagi hujjatlardan FAQAT tegishlilarini tanlang:

KODEKSLAR:
- Fuqarolik kodeksi (FK): https://lex.uz/docs/111189
- Mehnat kodeksi (MK): https://lex.uz/docs/145261
- Jinoyat kodeksi (JK): https://lex.uz/docs/111457
- Oila kodeksi (OK): https://lex.uz/docs/104723
- Soliq kodeksi (SK): https://lex.uz/docs/4674893
- Ma'muriy javobgarlik to'g'risida kodeks (MJK): https://lex.uz/docs/97661
- Iqtisodiy protsessual kodeks (IPK): https://lex.uz/docs/112168
- Fuqarolik protsessual kodeks (FPK): https://lex.uz/docs/111325
- Jinoyat-protsessual kodeks (JPK): https://lex.uz/docs/111463
- Ma'muriy sudlov ishlarini yuritish kodeksi: https://lex.uz/docs/3523895
- Uy-joy kodeksi: https://lex.uz/docs/97012
- Yer kodeksi: https://lex.uz/docs/149946
- Budjet kodeksi: https://lex.uz/docs/3523816
- Bojxona kodeksi: https://lex.uz/docs/4102378

ASOSIY QONUNLAR:
- Konstitutsiya: https://lex.uz/docs/35869
- Tadbirkorlik faoliyati erkinligining kafolatlari: https://lex.uz/docs/4538291
- Aksiyadorlik jamiyatlari to'g'risida: https://lex.uz/docs/5765400
- MChJ to'g'risida: https://lex.uz/docs/5765406
- Iste'molchilar huquqlarini himoya qilish: https://lex.uz/docs/89690
- Ijro va sud qarorlari ijrosi: https://lex.uz/docs/5765444
- Bankrotlik to'g'risida: https://lex.uz/docs/5767454
- Davlat xaridlari to'g'risida: https://lex.uz/docs/5759393
- Litsenziyalash to'g'risida: https://lex.uz/docs/6006025
- Korrupsiyaga qarshi kurashish: https://lex.uz/docs/5765442
- Raqamli texnologiyalar: https://lex.uz/docs/6879937
- Advokatlik faoliyati: https://lex.uz/docs/5765396
- Notariat to'g'risida: https://lex.uz/docs/5765430
- Sudlar to'g'risida: https://lex.uz/docs/5965818
- Prokuratura to'g'risida: https://lex.uz/docs/112128
- Bolalar huquqlari kafolatlari: https://lex.uz/docs/49560
- Genderli tenglik: https://lex.uz/docs/5765412
- Xalqaro arbitraj: https://lex.uz/docs/6555446

## 1-QADAM: MUAMMONI TAHLIL QILISH

Case matnidan aniqlang:
- Huquq sohasi
- Asosiy masala
- Kalit so'zlar

Format:
**MASALA:** ...
**KALIT_SOZLAR:** ...

## 2-QADAM: TEGISHLI NORMALARNI TOPISH

Google Search yordamida yuqoridagi lex.uz hujjatlardan tegishli moddalarni qidiring.
- Birinchi navbatda yuqoridagi katalogdan tegishli kodeks yoki qonunni tanlang
- Keyin Google Search bilan "site:lex.uz [kodeks nomi] [modda mavzusi]" qidiring
- Faqat Google Search natijalarida TASDIQLANGAN modda raqamlarini ko'rsating
- Agar aniq modda raqamini topa olmasangiz, faqat kodeks/qonun nomini va bobni ko'rsating

⚠ MUHIM: Modda raqamini to'qib chiqarish QATTIYAN TAQIQLANADI!
Agar aniq modda raqamiga ishonchingiz komil bo'lmasa, "tegishli moddalarni ko'ring" deb yozing va kodeks havolasini bering.

## 3-QADAM: HUJJAT HOLATINI TEKSHIRISH (MAJBURIY)

- "Hujjat kuchini yo'qotgan" yoki "O'z kuchini yo'qotgan" - ❌ Hujjatni butunlay inkor qiling.
- Faqat amaldagi versiya asosida ishlang.

## 4-QADAM: TEGISHLI NORMALAR (FAQAT 2 TA)

⚠ FAQAT 2 ta ENG MUHIM normani keltiring — ORTIQCHA YOZMANG!
⚠ HAR BIR normani yozishdan OLDIN alohida Google Search bilan "site:lex.uz [kodeks nomi] [modda raqami]" qidiring.
⚠ Agar Google Search natijasida aniq modda raqami topilmasa — "tegishli moddalarni ko'ring" deb yozing.
⚠ Xotiradan modda raqami YOZMANG. Faqat Google Search natijasidan!
⚠ 3-chi norma YOZMANG. Faqat 2 ta!

Format (har bir norma uchun):
- **Hujjat nomi:** [Kodeks/Qonun nomi]
- **Modda:** [Raqam — FAQAT Google Search natijasida ko'ringan bo'lsa]
- **Qisqa mazmun:** [Bu norma nima haqida]

❌ Lex.uz havolasini HECH QACHON to'qib chiqarmang! URL faqat Google Search natijasida aniq ko'ringan bo'lsa yozing, aks holda havola bermang.

## 5-QADAM: QISQA HUQUQIY TAHLIL

- **Masala:** ...
- **Qo'llaniladigan norma:** ...
- **Qo'llanishi:** ...
- **Xulosa:** ...

## 6-QADAM: NATIJA PROGNOZI

- **Da'vo ehtimoli:** __%
- **Qarshi tomon ehtimoli:** __%
- **Noaniqlik:** Past / O'rta / Yuqori

> "Ushbu xulosa sun'iy intellekt asosida shakllantirilgan va sud qarori hisoblanmaydi."

## 7-QADAM: YAKUNIY TEKSHIRUV

Tasdiqlang:
- ✔ Modda raqamlari Google Search bilan tasdiqlangan yoki "tegishli moddalarni ko'ring" deb yozilgan
- ✔ Lex.uz havolalar faqat yuqoridagi katalogdan olingan
- ✔ Amaldagi versiya tanlangan

## 8-QADAM: SUD AMALIYOTI TAHLILI

Google Search yordamida "site:public.sud.uz" orqali O'zbekiston sudlari amaliyotidan tegishli ishlarni qidiring.
Har bir ish uchun:
- **Ish raqami:** ...
- **Sud nomi:** ...
- **Sana:** ...
- **Mohiyati:** Qisqacha faktlar va sud qarori
- **Aloqadorlik:** Bu ish joriy masalaga qanday bog'liq

Kamida 2-3 ta eng aloqador sud ishini keltiring.
Agar aniq ish topa olmasangiz, shu sohada umumiy sud amaliyoti tendensiyasini yozing.

> "Sud amaliyoti va modda raqamlarini lex.uz va public.sud.uz saytlaridan tekshiring."

## 9-QADAM: YURXIZMAT.UZ HUJJAT NAMUNALARI

Quyidagi katalogdan murojaatga eng mos 2-4 ta toifani tanlang.

Katalog:
${getYurxizmatCatalogText()}

Javobingiz eng oxirida quyidagi blokni yozing:

<!--YURXIZMAT-->
[{"name":"Toifa nomi","url":"/uz/category/..."},{"name":"Toifa nomi","url":"/uz/category/..."}]
<!--/YURXIZMAT-->

Qoidalar:
- Faqat yuqoridagi katalogdagi URLlardan foydalaning
- 2 dan 4 gacha eng mos toifani tanlang
- name maydoniga qisqa, tushunarli nom yozing
- Agar hech qanday mos namuna topilmasa bo'sh massiv qaytaring: []${feedbackNote}`;

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const geminiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 8192,
        },
        tools: [{ google_search: {} }]
      })
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error('[AI] Gemini API error:', geminiResponse.status, errText);
      return res.status(500).json({ error: `Gemini API xatolik: ${geminiResponse.status}` });
    }

    const geminiData = await geminiResponse.json();
    // With Google Search grounding, response may have multiple text parts
    const parts = geminiData.candidates?.[0]?.content?.parts || [];
    const rawAnalysis = parts.map(p => p.text || '').join('');

    if (!rawAnalysis) {
      return res.status(500).json({ error: 'Gemini javob bermadi' });
    }

    // Extract yurxizmat.uz template suggestions from response
    let templateSuggestions = [];
    let analysis = rawAnalysis;
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

    // Archive the analysis (clean text without markers)
    let archiveId = null;
    try {
      const archiveResult = await pool.query(
        `INSERT INTO ai_analyses (request_id, admin_id, category, request_text, analysis_text)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [requestId || null, req.session.adminId, category, requestText, analysis]
      );
      archiveId = archiveResult.rows[0].id;
    } catch (archiveErr) {
      console.error('[AI] Archive save error:', archiveErr.message);
    }

    res.json({ analysis, archiveId, templateSuggestions });
  } catch (error) {
    console.error('[AI] Analysis error:', error);
    res.status(500).json({ error: 'AI tahlil xatoligi: ' + error.message });
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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Gemini API kaliti sozlanmagan' });
    }

    const systemContext = `Siz O'zbekiston huquqi bo'yicha AI yordamchisiz.
Quyidagi murojaat haqida savollarga javob bering.
${category && category !== 'Boshqa' ? `Yo'nalish: ${category}` : ''}
Murojaat matni: "${requestText}"
Javoblaringiz O'zbek (lotin) tilida, qisqa va aniq bo'lsin.
Huquqiy normalar va lex.uz havolalari bilan javob bering.`;

    const contents = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      contents.push({
        role: msg.role,
        parts: [{ text: i === 0 && msg.role === 'user'
          ? systemContext + '\n\n' + msg.text
          : msg.text }]
      });
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const geminiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4096,
        },
        tools: [{ google_search: {} }]
      })
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error('[AI Chat] Gemini API error:', geminiResponse.status, errText);
      return res.status(500).json({ error: `Gemini API xatolik: ${geminiResponse.status}` });
    }

    const geminiData = await geminiResponse.json();
    const chatParts = geminiData.candidates?.[0]?.content?.parts || [];
    const reply = chatParts.map(p => p.text || '').join('');

    if (!reply) {
      return res.status(500).json({ error: 'Gemini javob bermadi' });
    }

    res.json({ reply });
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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Gemini API kaliti sozlanmagan' });
    }

    const templateTypes = {
      'ariza': 'Ariza (sud, prokuratura, yoki boshqa organga)',
      'shikoyat': 'Shikoyat (apellyatsiya yoki kassatsiya)',
      'davo': 'Da\'vo arizasi',
      'shartnoma': 'Shartnoma yoki kelishuv',
      'ishonchnoma': 'Ishonchnoma',
      'bayonnoma': 'Bayonnoma',
      'auto': 'Murojaat mazmuniga eng mos hujjat turini aniqlang'
    };

    const selectedType = templateTypes[templateType] || templateTypes['auto'];

    const prompt = `Siz O'zbekiston huquqi bo'yicha hujjat tayyorlovchi AI yordamchisiz.

Murojaat matni: "${requestText}"
${category && category !== 'Boshqa' ? `Yo'nalish: ${category}` : ''}

AI tahlil xulosasi:
${analysisText.substring(0, 2000)}

Vazifa: ${selectedType}

Qoidalar:
1. Hujjat O'zbekiston qonunchiligiga to'liq mos bo'lishi shart
2. To'g'ri format va tuzilma: sarlavha, kirish, asosiy qism, so'rov, imzo
3. [SHAXS_ISMI], [MANZIL], [SANA] kabi to'ldirish joylari qoldiring
4. Tegishli qonun moddalariga havola qiling
5. Faqat O'zbek (lotin) tilida yozing
6. Oxirida qisqa izoh: qaysi organga topshirish, nusxa soni, ilova qilinishi kerak bo'lgan hujjatlar

Hujjatni to'liq yozing:`;

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const geminiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 8192,
        }
      })
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error('[AI Template] Gemini API error:', geminiResponse.status, errText);
      return res.status(500).json({ error: `Gemini API xatolik: ${geminiResponse.status}` });
    }

    const geminiData = await geminiResponse.json();
    const template = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!template) {
      return res.status(500).json({ error: 'Gemini hujjat yaratmadi' });
    }

    res.json({ template });
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

// ========== SELF-REGISTRATION ==========

// AI Screening using Gemini 2.5 Flash
async function triggerAiScreening(regId, regData) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return;

  try {
    let parts = [];
    let docFetched = false;

    // If document uploaded, fetch and include as vision input
    if (regData.document_file_id && regData.document_file_id !== 'upload_failed') {
      try {
        const fileLink = await bot.getFileLink(regData.document_file_id);
        const resp = await fetch(fileLink);
        const buffer = await resp.arrayBuffer();
        const base64Data = Buffer.from(buffer).toString('base64');
        const ext = fileLink.toLowerCase();
        const mimeType = ext.includes('.pdf') ? 'application/pdf' : ext.includes('.png') ? 'image/png' : ext.includes('.webp') ? 'image/webp' : 'image/jpeg';
        parts.push({ inline_data: { mime_type: mimeType, data: base64Data } });
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
          parts.push({ inline_data: { mime_type: dbDoc.rows[0].document_mimetype, data: dbDoc.rows[0].document_base64 } });
          docFetched = true;
        }
      } catch (e) {
        console.error('[AI SCREENING] Could not fetch document from DB:', e.message);
      }
    }

    const isLawyer = regData.type === 'lawyer';
    const infoBlock = isLawyer
      ? `Ism: ${regData.first_name}\nFamiliya: ${regData.last_name}\nTuri: Advokat\nMutaxassislik: ${regData.specialization || '-'}\nTajriba: ${regData.experience_years || '-'} yil\nGuvohnoma raqami: ${regData.license_number || '-'}\nTelegram: @${regData.telegram_username}`
      : `Ism: ${regData.first_name}\nFamiliya: ${regData.last_name}\nTuri: Student\nBosqich: ${regData.level || '-'}\nTelegram: @${regData.telegram_username}`;

    const docNote = docFetched
      ? 'Yuklangan hujjatni ko\'ring va tekshiring.'
      : 'Hujjat yuklangan, lekin texnik sabablarga ko\'ra olinmadi. Faqat boshqa ma\'lumotlar asosida baholang. document_authentic ni true deb belgilang.';

    const screenPrompt = `Ro'yxatdan o'tish so'rovini tekshiring.\n\nAriza beruvchi ma'lumotlari:\n${infoBlock}\n\n${docNote}\n\nTekshiring:\n1. ${docFetched ? 'Hujjatdagi ism-familiya ariza beruvchi kiritgan ma\'lumotlarga mosmi?' : 'Ism-familiya to\'g\'ri formatdami?'}\n2. ${docFetched ? 'Hujjat huquqshunoslik (yuridik) sohasiga tegishlimi?' : 'Ma\'lumotlar to\'liqmi?'}\n3. Barcha ma'lumotlar to'liqmi?\n4. ${docFetched ? 'Hujjat haqiqiymi yoki shubhalimi?' : 'Hujjat texnik sabablarga ko\'ra ko\'rib bo\'lmadi — true deb belgilang.'}\n${isLawyer ? '5. Advokatlk guvohnoma raqami formatiga mosmi?\n6. Mutaxassislik hujjatga mosmi?\n' : ''}\nJavobni faqat JSON formatda bering:\n{"status":"passed" yoki "flagged","name_match":true/false,"is_law_field":true/false,"info_complete":true/false,"document_authentic":true/false,"notes":"Qisqa izoh"}`;

    parts.push({ text: screenPrompt });

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const geminiResp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
      })
    });

    if (!geminiResp.ok) {
      console.error('[AI SCREENING] Gemini API error:', geminiResp.status);
      return;
    }

    const data = await geminiResp.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!resultText) return;

    let screeningResult;
    try {
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      screeningResult = jsonMatch ? JSON.parse(jsonMatch[0]) : { status: 'flagged', notes: 'Parse xatolik' };
    } catch (e) {
      screeningResult = { status: 'flagged', notes: 'AI javobini parse qilib bo\'lmadi', raw: resultText.substring(0, 500) };
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

// POST /api/register — public self-registration
app.post('/api/register', regUpload.single('document'), async (req, res) => {
  try {
    const { first_name, last_name, type, level, specialization, experience_years, license_number, telegram_username, password } = req.body;

    if (!first_name || !last_name || !telegram_username || !type) {
      return res.status(400).json({ error: 'Barcha maydonlar to\'ldirilishi shart' });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Parol kamida 6 ta belgi bo\'lishi kerak' });
    }

    const regType = type === 'lawyer' ? 'lawyer' : 'student';
    if (regType === 'student' && !level) {
      return res.status(400).json({ error: 'Bosqichni tanlang' });
    }
    if (regType === 'lawyer' && (!specialization || !license_number)) {
      return res.status(400).json({ error: 'Mutaxassislik va guvohnoma raqamini kiriting' });
    }

    const cleanUsername = telegram_username.replace(/@/g, '').trim();
    if (!cleanUsername || cleanUsername.length < 3) {
      return res.status(400).json({ error: 'Noto\'g\'ri Telegram username' });
    }

    // Check duplicate pending
    const existing = await pool.query(
      `SELECT id FROM registration_requests WHERE telegram_username = $1 AND status = 'pending'`,
      [cleanUsername]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Bu Telegram username bilan allaqachon so\'rov yuborilgan. Admin javobini kuting.' });
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
      const caption = regType === 'lawyer'
        ? `📋 Yangi advokat ro'yxatdan o'tish\n👤 ${first_name} ${last_name}\n📜 ${specialization}\n📱 @${cleanUsername}`
        : `📋 Yangi student ro'yxatdan o'tish\n👤 ${first_name} ${last_name}\n📚 ${level}\n📱 @${cleanUsername}`;
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
      `INSERT INTO registration_requests (type, first_name, last_name, level, specialization, experience_years, license_number, telegram_username, document_file_id, document_file_name, password_hash, document_base64, document_mimetype)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [regType, first_name.trim(), last_name.trim(), level || null, specialization || null, experience_years ? parseInt(experience_years) : null, license_number || null, cleanUsername, documentFileId, documentFileName, passwordHash, documentBase64, documentMimetype]
    );

    // Trigger AI screening asynchronously
    triggerAiScreening(result.rows[0].id, { type: regType, first_name, last_name, level, specialization, experience_years, license_number, telegram_username: cleanUsername, document_file_id: documentFileId }).catch(e => console.error('[AI SCREENING]', e));

    res.json({ success: true, message: 'Tabriklaymiz, Sizning so\'rovingiz muvaffaqiyatli yuborildi! Admin javobini kuting!' });
  } catch (error) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
    console.error('[REGISTER] Error:', error);
    res.status(500).json({ error: 'Ro\'yxatdan o\'tishda xatolik' });
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

    // Use Telegram username as login username (what the applicant expects)
    let baseUsername = reg.telegram_username.toLowerCase().replace(/[^a-z0-9_]/g, '').substring(0, 30);
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

    await pool.query('INSERT INTO admins (username, password, full_name, role) VALUES ($1, $2, $3, $4)', [finalUsername, finalHashedPassword, fullName, role]);
    await pool.query('UPDATE registration_requests SET status = $1, reviewed_at = NOW(), reviewed_by = $2 WHERE id = $3', ['approved', req.session.adminId, req.params.id]);

    // Try to notify via Telegram
    const parolText = reg.password_hash ? "Siz ro'yxatdan o'tishda yaratgan parol" : '(Admin tomonidan beriladi)';
    const approvalMsg = `✅ Tabriklaymiz! Ro'yxatdan o'tish so'rovingiz tasdiqlandi!\n\n🔑 Kirish ma'lumotlari:\n👤 Username: ${finalUsername}\n🔒 Parol: ${parolText}\n\n🌐 Dashboard: ${process.env.DASHBOARD_URL || 'https://' + (process.env.WEBHOOK_DOMAIN || 'localhost:3000')}\n\nDictum advokatlik firmasi`;
    let telegramSent = false;
    try {
      let chatId = null;
      // 1) Search users table by telegram username (bot users who sent requests)
      const tgUser = await pool.query('SELECT telegram_id FROM users WHERE LOWER(username) = $1', [reg.telegram_username.toLowerCase()]);
      if (tgUser.rows.length > 0) {
        chatId = tgUser.rows[0].telegram_id;
      }
      // 2) Search admins table for linked telegram account
      if (!chatId) {
        const tgAdmin = await pool.query('SELECT telegram_chat_id FROM admins WHERE telegram_chat_id IS NOT NULL AND LOWER(username) = $1', [finalUsername.toLowerCase()]);
        if (tgAdmin.rows.length > 0) chatId = tgAdmin.rows[0].telegram_chat_id;
      }
      // 3) Try resolving @username via Telegram API (works if user has interacted with bot before)
      if (!chatId) {
        try {
          const chat = await bot.getChat('@' + reg.telegram_username);
          if (chat && chat.id) chatId = chat.id;
        } catch (e) { /* @username lookup not available for this user */ }
      }
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

    // Try to notify via Telegram
    const rejectMsg = `❌ Ro'yxatdan o'tish so'rovingiz rad etildi.\n\nSabab: ${reason}\n\nDictum advokatlik firmasi`;
    let telegramSent = false;
    try {
      let chatId = null;
      // 1) Search users table by telegram username
      const tgUser = await pool.query('SELECT telegram_id FROM users WHERE LOWER(username) = $1', [reg.telegram_username.toLowerCase()]);
      if (tgUser.rows.length > 0) {
        chatId = tgUser.rows[0].telegram_id;
      }
      // 2) Try resolving @username via Telegram API
      if (!chatId) {
        try {
          const chat = await bot.getChat('@' + reg.telegram_username);
          if (chat && chat.id) chatId = chat.id;
        } catch (e) { /* @username lookup not available */ }
      }
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

    // Users table migrations (ensure all columns exist)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMP`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_by INTEGER`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS block_reason TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(255)`);

    // Requests table migrations (ensure all columns exist)
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS category VARCHAR(255) DEFAULT 'Boshqa'`);
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS student_response TEXT`);
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS student_admin_id INTEGER`);
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS assigned_to INTEGER`);
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP`);
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
      CREATE TABLE IF NOT EXISTS registration_requests (
        id SERIAL PRIMARY KEY,
        type VARCHAR(10) NOT NULL DEFAULT 'student',
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        level VARCHAR(20),
        specialization VARCHAR(255),
        experience_years INTEGER,
        license_number VARCHAR(100),
        telegram_username VARCHAR(100) NOT NULL,
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
    // Ensure 'admin' account is always master role
    await pool.query(`UPDATE admins SET role = 'master' WHERE username = 'admin'`);
    console.log('[DB] Migrations completed successfully');
  } catch (err) {
    console.error('[DB] Migration error:', err.message);
  }
}

runMigrations().then(() => {
  app.listen(PORT, () => {
    console.log(`[SERVER] Dashboard running on port ${PORT}${WEBHOOK_DOMAIN ? ' | https://' + WEBHOOK_DOMAIN : ''}`);
  });
});
