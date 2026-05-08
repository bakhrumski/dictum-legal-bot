'use strict';

/**
 * Portal Auth — JWT-based authentication with RBAC
 *
 * Roles:
 *   admin   — full access, manages users/subscriptions
 *   lawyer  — professional access, can verify RAG answers, upload docs
 *   client  — consumer access, can chat and view own history
 *
 * Tokens:
 *   Access token:  15min, in Authorization header
 *   Refresh token: 7d, in httpOnly cookie
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('../database/db');

const JWT_SECRET = process.env.JWT_SECRET || 'dictum-ai-portal-secret-change-me';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || JWT_SECRET + '-refresh';
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

// ════════════════════════════════════════
// TOKEN GENERATION
// ════════════════════════════════════════

function generateTokens(user) {
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.full_name
  };

  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
  const refreshToken = jwt.sign({ sub: user.id, type: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_TTL });

  return { accessToken, refreshToken };
}

function verifyAccessToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, JWT_REFRESH_SECRET);
}

// ════════════════════════════════════════
// MIDDLEWARE
// ════════════════════════════════════════

/**
 * Authenticate request via Bearer token.
 * Sets req.user = { sub, email, role, name }
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Avtorizatsiya kerak', code: 'UNAUTHORIZED' });
  }

  try {
    const decoded = verifyAccessToken(authHeader.slice(7));
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token muddati tugagan', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Noto\'g\'ri token', code: 'INVALID_TOKEN' });
  }
}

/**
 * Role-based access control.
 * Usage: authorize('admin', 'lawyer')
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Avtorizatsiya kerak', code: 'UNAUTHORIZED' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Bu amal uchun ${roles.join(' yoki ')} huquqi kerak`,
        code: 'FORBIDDEN'
      });
    }
    next();
  };
}

// ════════════════════════════════════════
// USER OPERATIONS
// ════════════════════════════════════════

async function registerUser({ fullName, email, phone, password, firmName, role = 'client', plan = 'trial' }) {
  // Check duplicate
  const existing = await pool.query('SELECT id FROM portal_users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    throw Object.assign(new Error('Bu email allaqachon ro\'yxatdan o\'tgan'), { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const result = await pool.query(`
    INSERT INTO portal_users (full_name, email, phone, password_hash, firm_name, role, plan, plan_started_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    RETURNING id, full_name, email, role, plan, created_at
  `, [fullName, email, phone || null, passwordHash, firmName || null, role, plan]);

  return result.rows[0];
}

async function loginUser(email, password) {
  const result = await pool.query(
    'SELECT id, full_name, email, password_hash, role, plan, is_active FROM portal_users WHERE email = $1',
    [email]
  );

  if (result.rows.length === 0) {
    throw Object.assign(new Error('Email yoki parol noto\'g\'ri'), { status: 401 });
  }

  const user = result.rows[0];

  if (!user.is_active) {
    throw Object.assign(new Error('Hisob bloklangan'), { status: 403 });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw Object.assign(new Error('Email yoki parol noto\'g\'ri'), { status: 401 });
  }

  // Update last login
  await pool.query('UPDATE portal_users SET last_login_at = NOW() WHERE id = $1', [user.id]);

  return { id: user.id, full_name: user.full_name, email: user.email, role: user.role, plan: user.plan };
}

async function getUserById(id) {
  const result = await pool.query(
    `SELECT id, full_name, email, phone, firm_name, role, plan, plan_started_at,
            queries_used, queries_limit, is_active, created_at, last_login_at
     FROM portal_users WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function incrementQueryCount(userId) {
  const result = await pool.query(`
    UPDATE portal_users SET queries_used = queries_used + 1
    WHERE id = $1
    RETURNING queries_used, queries_limit
  `, [userId]);

  if (result.rows.length === 0) return null;
  const { queries_used, queries_limit } = result.rows[0];

  if (queries_limit > 0 && queries_used > queries_limit) {
    throw Object.assign(new Error('Oylik so\'rov limiti tugadi. Tarifni yangilang.'), { status: 429 });
  }

  return { queries_used, queries_limit };
}

module.exports = {
  generateTokens,
  verifyAccessToken,
  verifyRefreshToken,
  authenticate,
  authorize,
  registerUser,
  loginUser,
  getUserById,
  incrementQueryCount
};
