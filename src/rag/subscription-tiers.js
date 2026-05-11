'use strict';

/**
 * JuristAI tariff plans — for common users (role = 'user').
 *
 * Plans:
 *   sinov    : 3 requests/day,  valid 7 days,  ONCE per user, free
 *   silver   : 300 requests/month,   299,000 so'm/oy
 *   gold     : 750 requests/month,   599,000 so'm/oy
 *   platinum : 1,500 requests/month, 1,199,000 so'm/oy
 *
 * Daily quotas (sinov) reset at 00:00 Asia/Tashkent (UTC+5, no DST).
 * Monthly quotas roll on the day of tariff start.
 *
 * Schema additions (admins table):
 *   tariff_plan       VARCHAR(20)   -- 'sinov'|'silver'|'gold'|'platinum'|NULL
 *   tariff_starts_at  TIMESTAMPTZ
 *   tariff_expires_at TIMESTAMPTZ
 *   bepul_used        BOOLEAN       -- true once user has consumed their one sinov
 *   phone             VARCHAR(30)
 *   email             VARCHAR(255)
 *   email_verified    BOOLEAN
 *
 * Usage table: tariff_usage(id, admin_id, endpoint, ts)
 */

const { pool } = require('../database/db');

const PLANS = {
  sinov: {
    label: 'Sinov',
    dailyLimit: 3,
    monthlyLimit: null,
    durationDays: 7,
    priceUzs: 0,
  },
  silver: {
    label: 'Silver',
    dailyLimit: null,
    monthlyLimit: 300,
    durationDays: 30,
    priceUzs: 299000,
  },
  gold: {
    label: 'Gold',
    dailyLimit: null,
    monthlyLimit: 750,
    durationDays: 30,
    priceUzs: 599000,
  },
  platinum: {
    label: 'Platinum',
    dailyLimit: null,
    monthlyLimit: 1500,
    durationDays: 30,
    priceUzs: 1199000,
  },
};

let _initialized = false;

async function initSubscriptionSchema() {
  if (_initialized) return;
  try {
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS tariff_plan VARCHAR(20)`);
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS tariff_starts_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS tariff_expires_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS bepul_used BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS phone VARCHAR(30)`);
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS email VARCHAR(255)`);
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email) WHERE email IS NOT NULL`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tariff_usage (
        id       SERIAL PRIMARY KEY,
        admin_id INTEGER NOT NULL,
        endpoint VARCHAR(50),
        ts       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tariff_usage_admin_ts ON tariff_usage(admin_id, ts DESC)`);

    _initialized = true;
    console.log('[TARIFF] schema ready (admins + tariff_usage)');
  } catch (err) {
    console.error('[TARIFF] init failed:', err.message);
  }
}

// Return today's 00:00 Asia/Tashkent as a Date (UTC+5, no DST)
function tashkentMidnight() {
  const nowMs = Date.now();
  const tashkentMs = nowMs + 5 * 3600 * 1000;
  const d = new Date(tashkentMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return new Date(`${y}-${m}-${day}T00:00:00+05:00`);
}

async function getUserPlan(adminId) {
  if (!_initialized) await initSubscriptionSchema();
  const r = await pool.query(
    `SELECT tariff_plan, tariff_starts_at, tariff_expires_at, bepul_used, role
       FROM admins WHERE id = $1`,
    [adminId]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  if (row.role === 'master') return { plan: 'master', role: 'master' };

  let plan = row.tariff_plan;
  const expired = row.tariff_expires_at && new Date(row.tariff_expires_at) < new Date();
  if (plan && expired) plan = null;
  return {
    plan,
    role: row.role,
    startsAt: row.tariff_starts_at,
    expiresAt: row.tariff_expires_at,
    bepulUsed: !!row.bepul_used,
    expired,
  };
}

async function checkQuota(adminId) {
  const u = await getUserPlan(adminId);
  if (!u) return { allowed: false, reason: 'unknown_user' };
  if (u.plan === 'master') return { allowed: true, plan: 'master', remaining: Infinity };
  // Non-common roles (student, lawyer) bypass tariff system
  if (u.role && u.role !== 'user') return { allowed: true, plan: u.role, remaining: Infinity };
  if (!u.plan) return { allowed: false, reason: 'no_plan' };

  const cfg = PLANS[u.plan];
  if (!cfg) return { allowed: false, reason: 'unknown_plan' };

  if (u.plan === 'sinov') {
    const midnight = tashkentMidnight();
    const r = await pool.query(
      `SELECT COUNT(*)::int AS used FROM tariff_usage WHERE admin_id = $1 AND ts >= $2`,
      [adminId, midnight]
    );
    const used = r.rows[0].used;
    return {
      allowed: used < cfg.dailyLimit,
      plan: 'sinov',
      limit: cfg.dailyLimit,
      used,
      remaining: Math.max(0, cfg.dailyLimit - used),
      period: 'day',
      expiresAt: u.expiresAt,
    };
  }

  const since = u.startsAt ? new Date(u.startsAt) : null;
  if (!since) return { allowed: false, reason: 'no_start_date' };
  const r = await pool.query(
    `SELECT COUNT(*)::int AS used FROM tariff_usage WHERE admin_id = $1 AND ts >= $2`,
    [adminId, since]
  );
  const used = r.rows[0].used;
  return {
    allowed: used < cfg.monthlyLimit,
    plan: u.plan,
    limit: cfg.monthlyLimit,
    used,
    remaining: Math.max(0, cfg.monthlyLimit - used),
    period: 'month',
    expiresAt: u.expiresAt,
  };
}

async function recordUsage(adminId, endpoint) {
  if (!_initialized) await initSubscriptionSchema();
  try {
    await pool.query(
      `INSERT INTO tariff_usage (admin_id, endpoint) VALUES ($1, $2)`,
      [adminId, endpoint || null]
    );
  } catch (err) {
    console.warn('[TARIFF] usage log failed:', err.message);
  }
}

async function selectPlan(adminId, plan) {
  if (!_initialized) await initSubscriptionSchema();
  if (!PLANS[plan]) throw new Error(`Unknown plan: ${plan}`);
  const cfg = PLANS[plan];

  if (plan === 'sinov') {
    const r = await pool.query(`SELECT bepul_used FROM admins WHERE id = $1`, [adminId]);
    if (r.rows[0]?.bepul_used) throw new Error('bepul_already_used');
  }

  const now = new Date();
  const expires = new Date(now.getTime() + cfg.durationDays * 24 * 3600 * 1000);
  await pool.query(
    `UPDATE admins
        SET tariff_plan = $1,
            tariff_starts_at = $2,
            tariff_expires_at = $3,
            bepul_used = bepul_used OR $4
      WHERE id = $5`,
    [plan, now, expires, plan === 'sinov', adminId]
  );
  return { plan, startsAt: now, expiresAt: expires };
}

/**
 * Express middleware: enforces the caller's tariff quota.
 * - Master admins bypass entirely.
 * - Student/lawyer roles bypass (legacy admin users).
 * - Common users (role='user') without a plan get 429.
 * - Common users with a plan over their limit get 429.
 */
function enforceQuota(endpoint) {
  return async (req, res, next) => {
    try {
      const adminId = req.session?.adminId;
      if (!adminId) return next();
      if (req.session?.role === 'master') return next();
      if (req.session?.role && req.session.role !== 'user') return next();

      const q = await checkQuota(adminId);
      if (!q.allowed) {
        return res.status(429).json({
          error: 'quota_exceeded',
          reason: q.reason || 'limit_reached',
          message: q.reason === 'no_plan'
            ? 'Tarif rejasi tanlanmagan. Iltimos, tarifni tanlang.'
            : `Limit tugadi (${q.used}/${q.limit}). Yangi tarif tanlang.`,
          plan: q.plan,
          limit: q.limit,
          used: q.used,
        });
      }
      await recordUsage(adminId, endpoint);
      res.locals.quota = q;
      next();
    } catch (err) {
      console.error('[TARIFF] enforceQuota error:', err.message);
      next(); // fail-open
    }
  };
}

module.exports = {
  PLANS,
  initSubscriptionSchema,
  getUserPlan,
  checkQuota,
  recordUsage,
  selectPlan,
  enforceQuota,
};
