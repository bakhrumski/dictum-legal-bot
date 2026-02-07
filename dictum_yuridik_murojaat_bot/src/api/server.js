require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcryptjs');
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
        r.assigned_at,
        r.created_at,
        r.answered_at,
        u.telegram_id,
        u.username,
        u.first_name,
        u.blocked,
        u.blocked_at,
        u.block_reason,
        a.full_name as assigned_lawyer_name
      FROM requests r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN admins a ON r.assigned_to = a.id
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
        r.assigned_at,
        r.created_at,
        r.answered_at,
        u.telegram_id,
        u.username,
        u.first_name,
        u.blocked,
        u.blocked_at,
        u.block_reason,
        a.full_name as assigned_lawyer_name
      FROM requests r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN admins a ON r.assigned_to = a.id
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

// Get all admins (for assignment dropdown)
app.get('/api/admins', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, username, full_name, role
      FROM admins
      ORDER BY role DESC, full_name
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching admins:', error);
    res.status(500).json({ error: 'Database error' });
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
    
    // Get lawyer name for notification
    const lawyerResult = await pool.query(
      'SELECT full_name FROM admins WHERE id = $1',
      [lawyerId]
    );
    
    res.json({ 
      success: true, 
      message: 'Request assigned successfully',
      lawyerName: lawyerResult.rows[0]?.full_name 
    });
    
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

// Send a chat message
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

app.listen(PORT, () => {
  console.log(`Dashboard server running on http://localhost:${PORT}`);
});
