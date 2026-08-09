'use strict';

/**
 * JuristAI tariff plans — for common users (role = 'user').
 *
 * Plans:
 *   sinov    : 3 chat requests/day, 1 opinion, valid 10 days, ONCE per user, free
 *   silver   : UNLIMITED chat +  3 legal opinions,   299,000 so'm/oy
 *   gold     : UNLIMITED chat + 10 legal opinions,   599,000 so'm/oy
 *   platinum : UNLIMITED chat + 30 legal opinions, 1,199,000 so'm/oy
 *
 * Chat is unlimited on every paid plan and guarded only by a daily fair-use
 * ceiling (see PLANS below). Legal opinions are the metered unit — their
 * limits live in OPINION_LIMITS in server.js.
 *
 * All daily counters reset at 00:00 Asia/Tashkent (UTC+5, no DST).
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

// Paid plans have UNLIMITED chat. Chat runs on the cheap tier at roughly
// $0.006 per answer, so a Silver subscription ($23) only reaches break-even
// past ~125 messages a day — far beyond what a person asks in real legal
// work. Metering it bought nothing and made the product harder to explain.
//
// `fairUseDaily` is not a quota: it is an anti-abuse ceiling, set well above
// genuine use and well below break-even. Its job is to catch one login shared
// across a whole firm, or a script — not to ration a paying subscriber. Users
// who hit it get a slow-down message, never "you are out of messages".
//
// Legal opinions stay metered by count: they are the expensive deliverable
// (~$0.44 each, up to ~$0.80 for a 120k-char document) and the real reason to
// move up a tier. Limits live in OPINION_LIMITS in server.js.
const PLANS = {
  sinov: {
    label: 'Sinov',
    dailyLimit: 3,          // a real quota — the free trial
    monthlyLimit: null,
    fairUseDaily: null,
    durationDays: 10,
    priceUzs: 0,
  },
  silver: {
    label: 'Silver',
    dailyLimit: null,
    monthlyLimit: null,     // unlimited chat
    fairUseDaily: parseInt(process.env.FAIR_USE_SILVER, 10) || 75,
    durationDays: 30,
    priceUzs: 299000,
  },
  gold: {
    label: 'Gold',
    dailyLimit: null,
    monthlyLimit: null,
    fairUseDaily: parseInt(process.env.FAIR_USE_GOLD, 10) || 150,
    durationDays: 30,
    priceUzs: 599000,
  },
  platinum: {
    label: 'Platinum',
    dailyLimit: null,
    monthlyLimit: null,
    fairUseDaily: parseInt(process.env.FAIR_USE_PLATINUM, 10) || 250,
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
    // Unused requests carried from the immediately previous paid period.
    // Carried ONCE: on each renewal this value is REPLACED (never accumulated),
    // so credits that go unused a second time expire.
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS tariff_rollover INTEGER DEFAULT 0`);
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

    // Free-access flow (channel-join + weekly survey instead of paying)
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS telegram_link_code VARCHAR(40)`);
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS channel_verified_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS survey_completed_at TIMESTAMPTZ`);
    // Anchor for the 7-day survey grace. Stamped the first time a free user is
    // evaluated, so existing users get a full fresh week instead of being
    // retroactively blocked the moment the feature ships.
    await pool.query(`ALTER TABLE admins ADD COLUMN IF NOT EXISTS free_gate_since TIMESTAMPTZ`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_admins_linkcode ON admins(telegram_link_code) WHERE telegram_link_code IS NOT NULL`);

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
    rollover: parseInt(row.tariff_rollover, 10) || 0,
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

  // ── Paid plans: unlimited chat, guarded by a daily fair-use ceiling ──────
  // Counted per DAY, not per period: the ceiling exists to stop a shared login
  // or a script, and both show up as a burst within one day. A monthly figure
  // would let an abusive day pass unnoticed and then lock out a legitimate one.
  const fairUse = cfg.fairUseDaily;
  if (!fairUse) {
    return { allowed: true, plan: u.plan, limit: null, used: 0, remaining: Infinity,
             period: 'unlimited', expiresAt: u.expiresAt };
  }

  const midnight = tashkentMidnight();
  const r = await pool.query(
    `SELECT COUNT(*)::int AS used FROM tariff_usage WHERE admin_id = $1 AND ts >= $2`,
    [adminId, midnight]
  );
  const usedToday = r.rows[0].used;
  return {
    allowed: usedToday < fairUse,
    plan: u.plan,
    limit: null,              // the offer is unlimited; this is not a quota
    unlimited: true,
    fairUseDaily: fairUse,
    used: usedToday,
    remaining: Infinity,
    fairUseHit: usedToday >= fairUse,
    period: 'unlimited',
    expiresAt: u.expiresAt,
  };
}

// ════════════════════════════════════════
// FREE-ACCESS GATE — channel-join + weekly survey for free-tier users
// (role='user' on sinov/no plan). Paid plans and staff bypass.
// ════════════════════════════════════════

const PAID_PLANS = new Set(['silver', 'gold', 'platinum']);
const SURVEY_GRACE_MS = 7 * 24 * 60 * 60 * 1000;  // survey due 7 days after anchor
const CHANNEL_GRACE_MS = (parseInt(process.env.CHANNEL_GRACE_DAYS || '3', 10)) * 24 * 60 * 60 * 1000; // soft reminder before hard block
const CHANNEL_REVERIFY_MS = 24 * 60 * 60 * 1000;   // re-check membership at most daily

function _bot() {
  try { return require('../bot/bot'); } catch (_) { return {}; }
}

// Channel membership OK? cached on admins.channel_verified_at, live re-check ≤ daily.
async function isChannelOkForAdmin(row, adminId) {
  if (!row.telegram_user_id) return false;
  const cachedAt = row.channel_verified_at ? new Date(row.channel_verified_at).getTime() : 0;
  if (cachedAt && (Date.now() - cachedAt) < CHANNEL_REVERIFY_MS) return true;
  const { isChannelMember } = _bot();
  if (typeof isChannelMember !== 'function') return cachedAt > 0;
  try {
    const ok = await isChannelMember(row.telegram_user_id);
    if (ok) {
      await pool.query('UPDATE admins SET channel_verified_at = NOW() WHERE id = $1', [adminId]);
      return true;
    }
    await pool.query('UPDATE admins SET channel_verified_at = NULL WHERE id = $1', [adminId]);
    return false;
  } catch (_) {
    return cachedAt > 0;
  }
}

// Access decision for a user. Returns { allowed, code?, state, ... }.
// Only free-tier common users are gated.
async function checkFreeAccess(adminId) {
  if (!_initialized) await initSubscriptionSchema();
  const u = await getUserPlan(adminId);
  if (!u) return { allowed: true, state: 'unknown' };
  if (u.role && u.role !== 'user') return { allowed: true, state: 'staff' };
  if (PAID_PLANS.has(u.plan)) return { allowed: true, state: 'paid' };

  const r = await pool.query(
    `SELECT telegram_user_id, telegram_username, channel_verified_at, survey_completed_at,
            free_gate_since, tariff_starts_at, created_at
       FROM admins WHERE id = $1`,
    [adminId]
  );
  const row = r.rows[0];
  if (!row) return { allowed: true, state: 'unknown' };

  // Stamp the survey anchor on first evaluation so existing users get a full
  // 7-day window from now rather than being blocked retroactively.
  let anchor = row.free_gate_since;
  if (!anchor) {
    anchor = new Date();
    await pool.query(
      'UPDATE admins SET free_gate_since = NOW() WHERE id = $1 AND free_gate_since IS NULL',
      [adminId]
    );
  }

  const start = new Date(anchor).getTime();
  const surveyDue = start + SURVEY_GRACE_MS;
  const channelDue = start + CHANNEL_GRACE_MS;

  const channelOk = await isChannelOkForAdmin(row, adminId);
  if (!row.telegram_user_id || !channelOk) {
    // Soft grace: gently remind but don't block yet (friendlier for existing users)
    if (Date.now() < channelDue) {
      return {
        allowed: true, state: 'free',
        reminder: { type: 'channel', dueAt: new Date(channelDue).toISOString() },
        telegramLinked: !!row.telegram_user_id,
      };
    }
    return { allowed: false, code: 'CHANNEL_REQUIRED', state: 'channel_required', telegramLinked: !!row.telegram_user_id };
  }
  if (Date.now() >= surveyDue && !row.survey_completed_at) {
    return { allowed: false, code: 'SURVEY_REQUIRED', state: 'survey_required', surveyDueAt: new Date(surveyDue).toISOString() };
  }
  return {
    allowed: true, state: 'free',
    telegramLinked: !!row.telegram_user_id,
    telegramUsername: row.telegram_username || null,
    channelVerified: true,
    surveyCompleted: !!row.survey_completed_at,
    surveyDueAt: new Date(surveyDue).toISOString(),
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

/**
 * Per-user query counts across all three reporting periods, computed from the
 * tariff_usage log in a single pass:
 *   daily   — since 00:00 Asia/Tashkent today
 *   weekly  — rolling last 7 days
 *   monthly — rolling last 30 days
 * Returned regardless of the user's plan so the platform can report and enforce
 * limits on any period.
 */
async function getUsageStats(adminId) {
  if (!_initialized) await initSubscriptionSchema();
  const midnight = tashkentMidnight();
  const r = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE ts >= $2)::int                       AS daily,
        COUNT(*) FILTER (WHERE ts >= NOW() - INTERVAL '7 days')::int  AS weekly,
        COUNT(*) FILTER (WHERE ts >= NOW() - INTERVAL '30 days')::int AS monthly
       FROM tariff_usage
      WHERE admin_id = $1`,
    [adminId, midnight]
  );
  const row = r.rows[0] || {};
  return { daily: row.daily || 0, weekly: row.weekly || 0, monthly: row.monthly || 0 };
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

  // Rollover is retired. It existed to carry unused CHAT requests into the
  // next period; with chat unlimited on every paid plan there is nothing left
  // to carry. The tariff_rollover column is kept (written as 0) so historical
  // rows stay readable and no migration is needed.
  const rollover = 0;

  await pool.query(
    `UPDATE admins
        SET tariff_plan = $1,
            tariff_starts_at = $2,
            tariff_expires_at = $3,
            bepul_used = bepul_used OR $4,
            tariff_rollover = $6
      WHERE id = $5`,
    [plan, now, expires, plan === 'sinov', adminId, rollover]
  );
  return {
    plan, startsAt: now, expiresAt: expires, rollover,
    limit: cfg.monthlyLimit || cfg.dailyLimit || null,   // null = unlimited chat
    unlimited: !cfg.monthlyLimit && !cfg.dailyLimit,
  };
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

      // Free-access gate: free-tier users must join the channel and (after a
      // week) complete the survey, instead of paying. Paid plans bypass.
      const access = await checkFreeAccess(adminId);
      if (!access.allowed) {
        return res.status(403).json({
          error: access.code,
          code: access.code,
          message: access.code === 'SURVEY_REQUIRED'
            ? 'Bepul foydalanishni davom ettirish uchun qisqa so\'rovnomani to\'ldiring.'
            : 'Bepul foydalanish uchun rasmiy Telegram kanalimizga obuna bo\'ling.',
        });
      }

      const q = await checkQuota(adminId);
      if (!q.allowed) {
        // A paid subscriber who trips the fair-use ceiling has NOT run out —
        // their plan is unlimited. Telling them "limit tugadi" would be false
        // and would read as a bait-and-switch, so it is framed as the
        // temporary slow-down it actually is.
        if (q.fairUseHit) {
          return res.status(429).json({
            error: 'rate_limited',
            reason: 'fair_use',
            message: 'Juda ko\'p so\'rov yuborildi. Biroz kuting va davom eting — tarifingiz cheklanmagan.',
            plan: q.plan,
            unlimited: true,
            retryAfterHours: 24,
          });
        }
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
  getUsageStats,
  selectPlan,
  enforceQuota,
  checkFreeAccess,
  isChannelOkForAdmin,
};
