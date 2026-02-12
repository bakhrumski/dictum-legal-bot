require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { pool } = require('../database/db');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// Use shared bot instance from bot.js, or create send-only instance if running standalone
let bot;
try {
  bot = require('../bot/bot').bot;
} catch (e) {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
}

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

// Single-session enforcement: one active session per admin
const activeSessions = new Map(); // adminId -> sessionId

// Authentication middleware
function requireAuth(req, res, next) {
  if (req.session.isAuthenticated) {
    const activeSessionId = activeSessions.get(req.session.adminId);
    if (activeSessionId && activeSessionId !== req.sessionID) {
      req.session.destroy();
      return res.status(401).json({ error: 'Boshqa qurilmadan kirilgan. Iltimos, qayta kiring.' });
    }
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

function requireMasterOrLawyer(req, res, next) {
  if (req.session.isAuthenticated && (req.session.role === 'master' || req.session.role === 'lawyer')) {
    next();
  } else {
    res.status(403).json({ error: 'Lawyer or Master admin access required' });
  }
}

// Activity tracking middleware
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
    const result = await pool.query(
      'SELECT * FROM admins WHERE username = $1',
      [username]
    );

    if (result.rows.length > 0) {
      const admin = result.rows[0];

      // Try bcrypt first, then plain text fallback (for legacy passwords)
      let passwordMatch = false;
      const isBcryptHash = admin.password && admin.password.startsWith('$2');
      if (isBcryptHash) {
        passwordMatch = await bcrypt.compare(password, admin.password);
      } else {
        passwordMatch = (password === admin.password);
        // Auto-upgrade plain text password to bcrypt
        if (passwordMatch) {
          const hashed = await bcrypt.hash(password, 10);
          await pool.query('UPDATE admins SET password = $1 WHERE id = $2', [hashed, admin.id]);
        }
      }

      if (passwordMatch) {
        req.session.isAuthenticated = true;
        req.session.role = admin.role;
        req.session.adminId = admin.id;
        req.session.username = admin.username;
        req.session.fullName = admin.full_name;

        // Enforce single session
        activeSessions.set(admin.id, req.sessionID);

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
  if (req.session.adminId) {
    activeSessions.delete(req.session.adminId);
  }
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
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
        COUNT(*) FILTER (WHERE status = 'student_responded') AS student_responded,
        COUNT(*) FILTER (WHERE status = 'lawyer_approved') AS lawyer_approved,
        COUNT(*) FILTER (WHERE status = 'answered') AS answered
      FROM requests
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
        r.assigned_student_id,
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
        sa.full_name as assigned_student_name
      FROM requests r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN admins a ON r.assigned_to = a.id
      LEFT JOIN admins sa ON r.assigned_student_id = sa.id
      ORDER BY r.created_at DESC
    `);

    res.json(result.rows);
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
        r.assigned_student_id,
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
        sa.full_name as assigned_student_name
      FROM requests r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN admins a ON r.assigned_to = a.id
      LEFT JOIN admins sa ON r.assigned_student_id = sa.id
      WHERE r.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    res.json(result.rows[0]);
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

// Student submits response
app.post('/api/student-response', requireAuth, async (req, res) => {
  try {
    const { requestId, responseText } = req.body;

    // Verify student is assigned
    const reqCheck = await pool.query('SELECT assigned_student_id FROM requests WHERE id = $1', [requestId]);
    if (reqCheck.rows.length > 0 && reqCheck.rows[0].assigned_student_id && reqCheck.rows[0].assigned_student_id !== req.session.adminId) {
      return res.status(403).json({ error: 'Siz bu murojaatga tayinlanmagansiz' });
    }

    await pool.query(`
      UPDATE requests
      SET student_response = $1,
          status = 'student_responded',
          student_admin_id = $3,
          responded_by = $4
      WHERE id = $2
    `, [responseText, requestId, req.session.adminId, req.session.fullName]);

    res.json({ success: true, message: 'Javob tasdiqlash uchun yuborildi' });

  } catch (error) {
    console.error('Error submitting student response:', error);
    res.status(500).json({ error: 'Failed to submit response' });
  }
});

// Lawyer approves student response (3-step chain: student -> lawyer -> master)
app.post('/api/lawyer-approve', requireMasterOrLawyer, async (req, res) => {
  try {
    const { requestId } = req.body;

    const reqCheck = await pool.query('SELECT id, status, assigned_to FROM requests WHERE id = $1', [requestId]);
    if (reqCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Murojaat topilmadi' });
    }
    if (reqCheck.rows[0].status !== 'student_responded') {
      return res.status(400).json({ error: 'Bu murojaat hali student javob bermagan' });
    }

    await pool.query(`
      UPDATE requests SET status = 'lawyer_approved' WHERE id = $1
    `, [requestId]);

    res.json({ success: true, message: 'Javob tasdiqlandi, master ko\'rib chiqadi' });
  } catch (error) {
    console.error('Error approving:', error);
    res.status(500).json({ error: 'Tasdiqlashda xatolik' });
  }
});

// Lawyer rejects student response
app.post('/api/lawyer-reject', requireMasterOrLawyer, async (req, res) => {
  try {
    const { requestId, reason } = req.body;

    await pool.query(`
      UPDATE requests
      SET status = 'rejected',
          student_response = student_response || E'\n\n--- YURIST RAD ETDI ---\nSabab: ' || $2
      WHERE id = $1
    `, [requestId, reason || 'Sabab ko\'rsatilmagan']);

    res.json({ success: true, message: 'Javob rad etildi' });
  } catch (error) {
    console.error('Error rejecting:', error);
    res.status(500).json({ error: 'Rad etishda xatolik' });
  }
});

// Master admin approves response (sends to client)
app.post('/api/approve-response', requireMasterAdmin, async (req, res) => {
  try {
    const { requestId } = req.body;

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

    await pool.query(`
      UPDATE requests
      SET response_text = student_response,
          status = 'answered',
          master_approved = TRUE,
          answered_at = NOW()
      WHERE id = $1
    `, [requestId]);

    const message = `
✅ Yuristdan javob keldi!

Hurmatli ${first_name},

${student_response}

Dictum advokatlik firmasi
    `;

    await bot.sendMessage(telegram_id, message);

    // Send rating request
    try {
      await bot.sendMessage(telegram_id, '⭐ Iltimos, javobni baholang (1-5):', {
        reply_markup: {
          inline_keyboard: [[
            { text: '1⭐', callback_data: `rate_${requestId}_1` },
            { text: '2⭐', callback_data: `rate_${requestId}_2` },
            { text: '3⭐', callback_data: `rate_${requestId}_3` },
            { text: '4⭐', callback_data: `rate_${requestId}_4` },
            { text: '5⭐', callback_data: `rate_${requestId}_5` }
          ]]
        }
      });
    } catch (e) {
      console.error('Failed to send rating request:', e);
    }

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

    // Send rating request
    try {
      await bot.sendMessage(telegram_id, '⭐ Iltimos, javobni baholang (1-5):', {
        reply_markup: {
          inline_keyboard: [[
            { text: '1⭐', callback_data: `rate_${requestId}_1` },
            { text: '2⭐', callback_data: `rate_${requestId}_2` },
            { text: '3⭐', callback_data: `rate_${requestId}_3` },
            { text: '4⭐', callback_data: `rate_${requestId}_4` },
            { text: '5⭐', callback_data: `rate_${requestId}_5` }
          ]]
        }
      });
    } catch (e) {
      console.error('Failed to send rating request:', e);
    }

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

    if (req.session.role !== 'master' && req.session.adminId !== parseInt(id)) {
      return res.status(403).json({ error: 'Faqat o\'z smenangizni o\'zgartira olasiz' });
    }

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
    if (!['master', 'lawyer', 'student'].includes(role)) {
      return res.status(400).json({ error: 'Rol faqat master, lawyer yoki student bo\'lishi mumkin' });
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
    if (!['master', 'lawyer', 'student'].includes(role)) {
      return res.status(400).json({ error: 'Rol faqat master, lawyer yoki student bo\'lishi mumkin' });
    }
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
    if (adminId === req.session.adminId) {
      return res.status(400).json({ error: 'O\'zingizni o\'chira olmaysiz' });
    }
    const adminCheck = await pool.query('SELECT id, full_name FROM admins WHERE id = $1', [adminId]);
    if (adminCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Admin topilmadi' });
    }
    await pool.query('UPDATE requests SET assigned_to = NULL, assigned_at = NULL WHERE assigned_to = $1', [adminId]);
    await pool.query('UPDATE requests SET assigned_student_id = NULL WHERE assigned_student_id = $1', [adminId]);
    await pool.query('DELETE FROM admins WHERE id = $1', [adminId]);
    res.json({ success: true, deleted: adminCheck.rows[0].full_name });
  } catch (error) {
    console.error('Error deleting admin:', error);
    res.status(500).json({ error: 'Admin o\'chirib bo\'lmadi' });
  }
});

// Assign request to lawyer AND/OR student (dual assignment)
app.post('/api/assign-request', requireAuth, async (req, res) => {
  try {
    const { requestId, lawyerId, studentId } = req.body;

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (lawyerId !== undefined) {
      updates.push(`assigned_to = $${paramIndex}`);
      params.push(lawyerId || null);
      paramIndex++;
    }
    if (studentId !== undefined) {
      updates.push(`assigned_student_id = $${paramIndex}`);
      params.push(studentId || null);
      paramIndex++;
    }

    updates.push(`assigned_at = NOW()`);
    params.push(requestId);

    await pool.query(
      `UPDATE requests SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      params
    );

    // Get names for response
    const names = {};
    if (lawyerId) {
      const lr = await pool.query('SELECT full_name FROM admins WHERE id = $1', [lawyerId]);
      if (lr.rows.length) names.lawyerName = lr.rows[0].full_name;
    }
    if (studentId) {
      const sr = await pool.query('SELECT full_name FROM admins WHERE id = $1', [studentId]);
      if (sr.rows.length) names.studentName = sr.rows[0].full_name;
    }

    res.json({
      success: true,
      message: 'Tayinlandi',
      ...names
    });

  } catch (error) {
    console.error('Error assigning request:', error);
    res.status(500).json({ error: 'Failed to assign request' });
  }
});

// Update request category
app.post('/api/update-category', requireMasterOrLawyer, async (req, res) => {
  try {
    const { requestId, category } = req.body;
    await pool.query('UPDATE requests SET category = $1 WHERE id = $2', [category, requestId]);
    res.json({ success: true, message: 'Category updated' });
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Unassign request (dual)
app.post('/api/unassign-request', requireAuth, async (req, res) => {
  try {
    const { requestId } = req.body;

    await pool.query(`
      UPDATE requests
      SET assigned_to = NULL, assigned_student_id = NULL, assigned_at = NULL
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
        u.username,
        u.first_name,
        r.category,
        r.request_text,
        r.request_type,
        r.status,
        r.response_text,
        r.responded_by,
        r.created_at,
        r.answered_at
      FROM requests r
      JOIN users u ON r.user_id = u.id
      ORDER BY r.created_at DESC
    `);

    const excelData = result.rows.map(row => ({
      'ID': row.id,
      'Username': row.username,
      'Ism': row.first_name,
      'Yo\'nalish': row.category,
      'Murojaat': row.request_text,
      'Turi': row.request_type,
      'Status': row.status === 'pending' ? 'Kutilmoqda' :
                row.status === 'student_responded' ? 'Student javobi' :
                row.status === 'lawyer_approved' ? 'Yurist tasdiqladi' :
                row.status === 'answered' ? 'Javob berilgan' :
                row.status === 'rejected' ? 'Rad etilgan' : row.status,
      'Javob': row.response_text || '',
      'Javob berdi': row.responded_by || '',
      'Yaratilgan': new Date(row.created_at).toLocaleString('uz-UZ'),
      'Javob berilgan': row.answered_at ? new Date(row.answered_at).toLocaleString('uz-UZ') : ''
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);

    ws['!cols'] = [
      { wch: 5 }, { wch: 20 }, { wch: 25 }, { wch: 20 }, { wch: 50 },
      { wch: 15 }, { wch: 15 }, { wch: 50 }, { wch: 20 }, { wch: 20 }, { wch: 20 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Murojaatlar');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

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
      SET blocked = TRUE, blocked_at = NOW(), blocked_by = $1, block_reason = $2
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
      SET blocked = FALSE, blocked_at = NULL, blocked_by = NULL, block_reason = NULL
      WHERE id = $1
    `, [userId]);
    res.json({ success: true, message: 'User unblocked successfully' });
  } catch (error) {
    console.error('Error unblocking user:', error);
    res.status(500).json({ error: 'Failed to unblock user' });
  }
});

// Get block history
app.get('/api/users/:userId/block-history', requireMasterAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(`
      SELECT bh.id, bh.action, bh.reason, bh.performed_at, a.full_name as performed_by_name
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

// Rate student response (by lawyer or master)
app.post('/api/rate-student', requireMasterOrLawyer, async (req, res) => {
  try {
    const { requestId, rating } = req.body;

    const reqResult = await pool.query('SELECT student_admin_id FROM requests WHERE id = $1', [requestId]);
    if (reqResult.rows.length === 0) {
      return res.status(404).json({ error: 'Murojaat topilmadi' });
    }
    const studentId = reqResult.rows[0].student_admin_id;
    if (!studentId) {
      return res.status(400).json({ error: 'Bu murojaatda student javob bermagan' });
    }
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Bahoni 1-5 orasida kiriting' });
    }

    const existing = await pool.query('SELECT id FROM student_ratings WHERE request_id = $1', [requestId]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Bu murojaat allaqachon baholangan' });
    }

    await pool.query(
      'INSERT INTO student_ratings (request_id, student_id, rated_by, rating) VALUES ($1, $2, $3, $4)',
      [requestId, studentId, req.session.adminId, rating]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error rating student:', error);
    res.status(500).json({ error: 'Baholashda xatolik' });
  }
});

// Check if request is rated
app.get('/api/request-rating/:requestId', requireAuth, async (req, res) => {
  try {
    const { requestId } = req.params;
    const result = await pool.query('SELECT rating FROM student_ratings WHERE request_id = $1', [requestId]);
    if (result.rows.length > 0) {
      res.json({ rated: true, rating: result.rows[0].rating });
    } else {
      res.json({ rated: false });
    }
  } catch (error) {
    res.json({ rated: false });
  }
});

// Student rankings (separate endpoint)
app.get('/api/student-rankings', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        a.id, a.full_name, a.username,
        COUNT(DISTINCT CASE WHEN r.status IN ('answered', 'student_responded', 'lawyer_approved') THEN r.id END) AS total_responses,
        COUNT(DISTINCT CASE WHEN r.status = 'rejected' THEN r.id END) AS total_rejects,
        COALESCE(AVG(sr.rating), 0) AS avg_rating,
        COUNT(sr.id) AS total_ratings,
        COALESCE(AVG(CASE WHEN r.answered_at IS NOT NULL THEN EXTRACT(EPOCH FROM (r.answered_at - r.created_at)) / 3600.0 END), 0) AS avg_response_hours
      FROM admins a
      LEFT JOIN requests r ON r.student_admin_id = a.id
      LEFT JOIN student_ratings sr ON sr.student_id = a.id
      WHERE a.role = 'student'
      GROUP BY a.id, a.full_name, a.username
      ORDER BY
        COUNT(DISTINCT CASE WHEN r.status IN ('answered', 'student_responded', 'lawyer_approved') THEN r.id END) DESC,
        COALESCE(AVG(CASE WHEN r.answered_at IS NOT NULL THEN EXTRACT(EPOCH FROM (r.answered_at - r.created_at)) END), 999999) ASC,
        COALESCE(AVG(sr.rating), 0) DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching student rankings:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Lawyer rankings (separate endpoint)
app.get('/api/lawyer-rankings', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        a.id, a.full_name, a.username,
        COUNT(DISTINCT CASE WHEN r.status IN ('answered', 'lawyer_approved') THEN r.id END) AS total_approved,
        COUNT(DISTINCT CASE WHEN r.status = 'rejected' AND r.assigned_to = a.id THEN r.id END) AS total_rejected,
        COUNT(DISTINCT CASE WHEN r.status IN ('answered', 'lawyer_approved', 'rejected') THEN r.id END) AS total_actions,
        COALESCE(AVG(lr.rating), 0) AS avg_rating,
        COUNT(lr.id) AS total_ratings,
        COALESCE(AVG(CASE WHEN r.answered_at IS NOT NULL THEN EXTRACT(EPOCH FROM (r.answered_at - r.assigned_at)) / 3600.0 END), 0) AS avg_action_hours
      FROM admins a
      LEFT JOIN requests r ON r.assigned_to = a.id
      LEFT JOIN lawyer_ratings lr ON lr.lawyer_id = a.id
      WHERE a.role = 'lawyer'
      GROUP BY a.id, a.full_name, a.username
      ORDER BY
        COUNT(DISTINCT CASE WHEN r.status IN ('answered', 'lawyer_approved', 'rejected') THEN r.id END) DESC,
        COALESCE(AVG(CASE WHEN r.answered_at IS NOT NULL THEN EXTRACT(EPOCH FROM (r.answered_at - r.assigned_at)) END), 999999) ASC,
        COALESCE(AVG(lr.rating), 0) DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching lawyer rankings:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Combined rankings (for dashboard compatibility)
app.get('/api/rankings', requireAuth, async (req, res) => {
  try {
    const lawyerResult = await pool.query(`
      SELECT a.id, a.full_name, a.username,
        COUNT(CASE WHEN r.status = 'answered' AND r.responded_by = a.full_name THEN 1 END) AS answered_count,
        COUNT(CASE WHEN r.assigned_to = a.id THEN 1 END) AS assigned_count,
        AVG(CASE WHEN r.status = 'answered' AND r.responded_by = a.full_name AND r.answered_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (r.answered_at - r.created_at)) / 3600.0 END) AS avg_hours
      FROM admins a
      LEFT JOIN requests r ON r.assigned_to = a.id OR r.responded_by = a.full_name
      WHERE a.role IN ('master', 'lawyer')
      GROUP BY a.id, a.full_name, a.username
      ORDER BY answered_count DESC, avg_hours ASC
    `);

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
    const dailyResult = await pool.query(`
      SELECT DATE(created_at) as day, COUNT(*) as count
      FROM requests
      WHERE created_at >= NOW() - INTERVAL '60 days'
      GROUP BY DATE(created_at)
      ORDER BY day
    `);

    const resolutionResult = await pool.query(`
      SELECT EXTRACT(EPOCH FROM (answered_at - created_at)) / 3600.0 AS hours
      FROM requests
      WHERE status = 'answered' AND answered_at IS NOT NULL AND created_at IS NOT NULL
    `);

    const dailyCounts = dailyResult.rows.map(r => parseInt(r.count));
    const dailyMean = dailyCounts.length > 0 ? dailyCounts.reduce((a, b) => a + b, 0) / dailyCounts.length : 0;
    const dailyStd = dailyCounts.length > 1
      ? Math.sqrt(dailyCounts.reduce((sum, v) => sum + Math.pow(v - dailyMean, 2), 0) / (dailyCounts.length - 1))
      : dailyMean * 0.3;

    const resTimes = resolutionResult.rows.map(r => parseFloat(r.hours)).filter(h => h > 0 && h < 720);
    const resMean = resTimes.length > 0 ? resTimes.reduce((a, b) => a + b, 0) / resTimes.length : 0;
    const resStd = resTimes.length > 1
      ? Math.sqrt(resTimes.reduce((sum, v) => sum + Math.pow(v - resMean, 2), 0) / (resTimes.length - 1))
      : resMean * 0.3;

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

// ========== COMMUNITY CHAT API ==========

app.get('/api/chat/messages', requireAuth, async (req, res) => {
  try {
    const sinceId = parseInt(req.query.since_id) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    let query, params;
    if (sinceId > 0) {
      query = `
        SELECT cm.id, cm.message, cm.mentions, cm.created_at,
               a.id as admin_id, a.username, a.full_name, a.role
        FROM chat_messages cm
        JOIN admins a ON cm.admin_id = a.id
        WHERE cm.id > $1
        ORDER BY cm.id ASC
        LIMIT $2
      `;
      params = [sinceId, limit];
    } else {
      query = `
        SELECT cm.id, cm.message, cm.mentions, cm.created_at,
               a.id as admin_id, a.username, a.full_name, a.role
        FROM chat_messages cm
        JOIN admins a ON cm.admin_id = a.id
        ORDER BY cm.id DESC
        LIMIT $1
      `;
      params = [limit];
    }

    const result = await pool.query(query, params);
    const messages = sinceId > 0 ? result.rows : result.rows.reverse();
    res.json({ messages });
  } catch (error) {
    console.error('Error fetching chat messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.post('/api/chat/messages', requireAuth, async (req, res) => {
  try {
    const { message } = req.body;

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

    const result = await pool.query(
      `INSERT INTO chat_messages (admin_id, message, mentions)
       VALUES ($1, $2, $3)
       RETURNING id, message, mentions, created_at`,
      [req.session.adminId, message.trim(), JSON.stringify(mentions)]
    );

    const newMsg = result.rows[0];
    res.json({
      success: true,
      message: {
        id: newMsg.id,
        message: newMsg.message,
        mentions: newMsg.mentions,
        created_at: newMsg.created_at,
        admin_id: req.session.adminId,
        username: req.session.username,
        full_name: req.session.fullName,
        role: req.session.role
      }
    });
  } catch (error) {
    console.error('Error sending chat message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ========== DATABASE MIGRATIONS ==========

async function runMigrations() {
  try {
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS assigned_student_id INTEGER REFERENCES admins(id)`);
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS duty_start TIME DEFAULT NULL`);
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS duty_end TIME DEFAULT NULL`);
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP DEFAULT NULL`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS student_ratings (
        id SERIAL PRIMARY KEY,
        request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
        student_id INTEGER REFERENCES admins(id) ON DELETE CASCADE,
        rated_by INTEGER REFERENCES admins(id),
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(request_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lawyer_ratings (
        id SERIAL PRIMARY KEY,
        request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
        lawyer_id INTEGER REFERENCES admins(id) ON DELETE CASCADE,
        telegram_id BIGINT,
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(request_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        mentions JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at)`);
    console.log('Database migrations completed');
  } catch (error) {
    console.error('Migration error:', error.message);
  }
}

runMigrations().then(() => {
  app.listen(PORT, () => {
    console.log(`Dashboard server running on http://localhost:${PORT}`);
  });
});
