require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { pool } = require('../database/db');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Telegram bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

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

function requireMasterOrLawyer(req, res, next) {
  if (req.session.isAuthenticated && (req.session.role === 'master' || req.session.role === 'lawyer')) {
    next();
  } else {
    res.status(403).json({ error: 'Lawyer or Master admin access required' });
  }
}

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const result = await pool.query(
      'SELECT * FROM admins WHERE username = $1 AND password = $2',
      [username, password]
    );
    
    if (result.rows.length > 0) {
      const admin = result.rows[0];
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
    username: req.session.username,
    role: req.session.role,
    fullName: req.session.fullName,
    adminId: req.session.adminId
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

// Student submits response (goes to assigned lawyer first, then master)
app.post('/api/student-response', requireAuth, async (req, res) => {
  try {
    const { requestId, responseText } = req.body;

    // Verify this student is the assigned student
    const reqCheck = await pool.query('SELECT assigned_student_id FROM requests WHERE id = $1', [requestId]);
    if (reqCheck.rows.length > 0 && reqCheck.rows[0].assigned_student_id && reqCheck.rows[0].assigned_student_id !== req.session.adminId) {
      return res.status(403).json({ error: 'Bu murojaat sizga tayinlanmagan' });
    }

    // Update request with student response
    await pool.query(`
      UPDATE requests
      SET student_response = $1,
          status = 'student_responded',
          student_admin_id = $3,
          responded_by = $4
      WHERE id = $2
    `, [responseText, requestId, req.session.adminId, req.session.fullName]);

    res.json({ success: true, message: 'Javob yuborildi! Yurist ko\'rib chiqadi.' });

  } catch (error) {
    console.error('Error submitting student response:', error);
    res.status(500).json({ error: 'Failed to submit response' });
  }
});

// Lawyer approves student response (sends to master for final approval)
app.post('/api/lawyer-approve', requireMasterOrLawyer, async (req, res) => {
  try {
    const { requestId } = req.body;

    // Verify this lawyer is the assigned lawyer
    const reqCheck = await pool.query('SELECT assigned_to, status FROM requests WHERE id = $1', [requestId]);
    if (reqCheck.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    if (reqCheck.rows[0].status !== 'student_responded') return res.status(400).json({ error: 'Bu murojaat tasdiqlanishi mumkin emas' });

    const assignedLawyer = reqCheck.rows[0].assigned_to;
    if (assignedLawyer && assignedLawyer !== req.session.adminId && req.session.role !== 'master') {
      return res.status(403).json({ error: 'Bu murojaat sizga tayinlanmagan' });
    }

    await pool.query(`
      UPDATE requests SET status = 'lawyer_approved' WHERE id = $1
    `, [requestId]);

    res.json({ success: true, message: 'Javob tasdiqlandi! Master admin ko\'rib chiqadi.' });

  } catch (error) {
    console.error('Error lawyer approving:', error);
    res.status(500).json({ error: 'Failed to approve' });
  }
});

// Lawyer rejects student response
app.post('/api/lawyer-reject', requireMasterOrLawyer, async (req, res) => {
  try {
    const { requestId, reason } = req.body;

    const reqCheck = await pool.query('SELECT assigned_to, status FROM requests WHERE id = $1', [requestId]);
    if (reqCheck.rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    const assignedLawyer = reqCheck.rows[0].assigned_to;
    if (assignedLawyer && assignedLawyer !== req.session.adminId && req.session.role !== 'master') {
      return res.status(403).json({ error: 'Bu murojaat sizga tayinlanmagan' });
    }

    await pool.query(`
      UPDATE requests
      SET status = 'rejected',
          student_response = student_response || E'\n\n--- YURIST RAD ETDI ---\nSabab: ' || $2
      WHERE id = $1
    `, [requestId, reason || 'Sabab ko\'rsatilmagan']);

    res.json({ success: true, message: 'Javob rad etildi' });

  } catch (error) {
    console.error('Error lawyer rejecting:', error);
    res.status(500).json({ error: 'Failed to reject' });
  }
});

// Master admin final approval (sends to client)
app.post('/api/approve-response', requireMasterAdmin, async (req, res) => {
  try {
    const { requestId } = req.body;

    // Get request details
    const requestResult = await pool.query(`
      SELECT
        u.telegram_id,
        u.username,
        u.first_name,
        r.student_response,
        r.status
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

// Master admin sends direct response (only when no student/lawyer assigned)
app.post('/api/master-response', requireMasterAdmin, async (req, res) => {
  try {
    const { requestId, responseText } = req.body;

    const requestResult = await pool.query(`
      SELECT u.telegram_id, u.username, u.first_name, r.assigned_to, r.assigned_student_id
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

// Get all admins (for assignment dropdown)
app.get('/api/admins', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, username, full_name, role, created_at
      FROM admins
      ORDER BY role DESC, full_name
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching admins:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Assign request (lawyer + student)
app.post('/api/assign-request', requireMasterAdmin, async (req, res) => {
  try {
    const { requestId, lawyerId, studentId } = req.body;

    await pool.query(`
      UPDATE requests
      SET assigned_to = $1, assigned_student_id = $2, assigned_at = NOW()
      WHERE id = $3
    `, [lawyerId || null, studentId || null, requestId]);

    const names = [];
    if (lawyerId) {
      const lr = await pool.query('SELECT full_name FROM admins WHERE id = $1', [lawyerId]);
      if (lr.rows[0]) names.push(lr.rows[0].full_name);
    }
    if (studentId) {
      const sr = await pool.query('SELECT full_name FROM admins WHERE id = $1', [studentId]);
      if (sr.rows[0]) names.push(sr.rows[0].full_name);
    }

    res.json({
      success: true,
      message: 'Request assigned successfully',
      assignedNames: names.join(', ')
    });

  } catch (error) {
    console.error('Error assigning request:', error);
    res.status(500).json({ error: 'Failed to assign request' });
  }
});

// Unassign request
app.post('/api/unassign-request', requireMasterAdmin, async (req, res) => {
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

// Update request category
app.post('/api/update-category', requireMasterOrLawyer, async (req, res) => {
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
    
    // Format data for Excel
    const excelData = result.rows.map(row => ({
      'ID': row.id,
      'Username': row.username,
      'Ism': row.first_name,
      'Yo\'nalish': row.category,
      'Murojaat': row.request_text,
      'Turi': row.request_type,
      'Status': row.status === 'pending' ? 'Kutilmoqda' :
                row.status === 'student_responded' ? 'Student javobi' :
                row.status === 'lawyer_approved' ? 'Yurist tasdiqlagan' :
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

// Create new admin
app.post('/api/admins', requireMasterAdmin, async (req, res) => {
  try {
    const { username, password, full_name, role } = req.body;

    if (!username || !password || !full_name || !role) {
      return res.status(400).json({ error: 'Barcha maydonlarni to\'ldiring' });
    }

    if (!['master', 'lawyer', 'student'].includes(role)) {
      return res.status(400).json({ error: 'Noto\'g\'ri rol' });
    }

    const existing = await pool.query('SELECT id FROM admins WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Bu username allaqachon mavjud' });
    }

    const result = await pool.query(
      'INSERT INTO admins (username, password, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id, username, full_name, role, created_at',
      [username, password, full_name, role]
    );

    res.json({ success: true, admin: result.rows[0] });
  } catch (error) {
    console.error('Error creating admin:', error);
    res.status(500).json({ error: 'Admin yaratishda xatolik' });
  }
});

// Update admin
app.put('/api/admins/:id', requireMasterAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, role, password } = req.body;

    if (!full_name || !role) {
      return res.status(400).json({ error: 'Ism va rol majburiy' });
    }

    if (!['master', 'lawyer', 'student'].includes(role)) {
      return res.status(400).json({ error: 'Noto\'g\'ri rol' });
    }

    // Prevent demoting yourself
    if (parseInt(id) === req.session.adminId && role !== 'master') {
      return res.status(400).json({ error: 'O\'z rolingizni o\'zgartira olmaysiz' });
    }

    if (password) {
      await pool.query(
        'UPDATE admins SET full_name = $1, role = $2, password = $3 WHERE id = $4',
        [full_name, role, password, id]
      );
    } else {
      await pool.query(
        'UPDATE admins SET full_name = $1, role = $2 WHERE id = $3',
        [full_name, role, id]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating admin:', error);
    res.status(500).json({ error: 'Admin yangilashda xatolik' });
  }
});

// Rate student response
app.post('/api/rate-student', requireMasterOrLawyer, async (req, res) => {
  try {
    const { requestId, rating } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    // Get student_admin_id from the request
    const reqResult = await pool.query('SELECT student_admin_id FROM requests WHERE id = $1', [requestId]);
    if (reqResult.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const studentId = reqResult.rows[0].student_admin_id;
    if (!studentId) {
      return res.status(400).json({ error: 'No student assigned to this request' });
    }

    // Check if already rated
    const existing = await pool.query('SELECT id FROM student_ratings WHERE request_id = $1', [requestId]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Already rated' });
    }

    await pool.query(
      'INSERT INTO student_ratings (request_id, student_id, rated_by, rating) VALUES ($1, $2, $3, $4)',
      [requestId, studentId, req.session.adminId, rating]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error rating student:', error);
    res.status(500).json({ error: 'Failed to rate student' });
  }
});

// Get student rankings
app.get('/api/student-rankings', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        a.id,
        a.full_name,
        a.username,
        COUNT(DISTINCT CASE WHEN r.status IN ('answered', 'student_responded', 'lawyer_approved') THEN r.id END) as total_responses,
        COUNT(DISTINCT CASE WHEN r.status = 'rejected' THEN r.id END) as total_rejects,
        COALESCE(ROUND(AVG(sr.rating)::numeric, 1), 0) as avg_rating,
        COUNT(DISTINCT sr.id) as total_ratings,
        CASE
          WHEN COUNT(DISTINCT CASE WHEN r.answered_at IS NOT NULL THEN r.id END) > 0
          THEN ROUND(AVG(CASE WHEN r.answered_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (r.answered_at - r.created_at)) / 3600
            END)::numeric, 1)
          ELSE NULL
        END as avg_response_hours
      FROM admins a
      LEFT JOIN requests r ON r.student_admin_id = a.id
      LEFT JOIN student_ratings sr ON sr.student_id = a.id
      WHERE a.role = 'student'
      GROUP BY a.id, a.full_name, a.username
      ORDER BY COALESCE(AVG(sr.rating), 0) DESC, COUNT(DISTINCT CASE WHEN r.status IN ('answered', 'student_responded', 'lawyer_approved') THEN r.id END) DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching student rankings:', error);
    res.status(500).json({ error: 'Failed to fetch rankings' });
  }
});

// Check if request has been rated
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
    console.error('Error checking rating:', error);
    res.status(500).json({ error: 'Failed to check rating' });
  }
});

// Delete admin
app.delete('/api/admins/:id', requireMasterAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (parseInt(id) === req.session.adminId) {
      return res.status(400).json({ error: 'O\'zingizni o\'chira olmaysiz' });
    }

    await pool.query('DELETE FROM admins WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting admin:', error);
    res.status(500).json({ error: 'Admin o\'chirishda xatolik' });
  }
});

// Auto-migrate database on startup
async function runMigrations() {
  try {
    await pool.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS assigned_student_id INTEGER REFERENCES admins(id)`);
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
