'use strict';

/**
 * JuristAI tariff plans — for common users (role = 'user').
 *
 * Plans (see PLANS for the derivation of every number):
 *   bepul    : 10 chat/day for 30 days, then 3/day. Free forever.
 *   sinov    : 3 chat/day + 1 opinion credit + 2 drafts weekly, 10 days
 *   silver   : unlimited chat +  9 credits + 22 drafts weekly,   199,000/oy
 *   gold     : unlimited chat + 17 credits + 50 drafts weekly,   399,000/oy
 *   platinum : unlimited chat + 42 credits + 125 drafts weekly,  999,000/oy
 *
 * Chat is unlimited on paid plans, bounded only by an anti-abuse ceiling.
 * Opinions are metered in CREDITS scaled to document size; drafting has its
 * own weekly count. Both reset every Monday 00:00 Asia/Tashkent.
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

// ── Plan economics ──────────────────────────────────────────────────────────
// Quotas are solved from measured unit costs, not guessed, against three
// targets: a WORST case (100% quota + chat at the ceiling) that still clears
// 5-10%, a MEDIUM case (~35% usage) in the 40-60% band, and anything above
// 75% returned to the customer as a loyalty rebate (see marginReport()).
//
// Measured units @ 11,980 UZS/USD:
//   chat     $0.0058   (Luna)
//   drafting $0.0425   (Terra, larger output)
//   opinion  $0.22 per CREDIT — see OPINION_CREDIT_TIERS below
//
// Weekly windows rather than monthly: a fresh allowance every Monday reads as
// more generous than one big monthly number, and it caps the damage a single
// abusive week can do.
//
// Worst-case margins at these numbers: Silver 8.2%, Gold 8.0%, Platinum 9.8%.
const PLANS = {
  bepul: {
    label: 'Bepul',
    // Generous for the first month, then a smaller steady allowance. A free
    // tier with no step-down is the platform's largest unbounded cost: 1,000
    // active users at 10/day is ~$1,000/month against zero revenue.
    dailyLimit: 10,
    dailyLimitAfterDays: 30,
    dailyLimitLater: 3,
    monthlyLimit: null,
    fairUseDaily: null,
    weeklyOpinionCredits: 0,
    weeklyDrafts: 0,
    durationDays: null,          // no expiry
    priceUzs: 0,
  },
  sinov: {
    label: 'Sinov',
    dailyLimit: 3,
    monthlyLimit: null,
    fairUseDaily: null,
    weeklyOpinionCredits: 1,
    weeklyDrafts: 2,
    durationDays: 10,
    priceUzs: 0,
  },
  silver: {
    label: 'Silver',
    dailyLimit: null,
    monthlyLimit: null,          // unlimited chat
    fairUseDaily: parseInt(process.env.FAIR_USE_SILVER, 10) || 15,
    weeklyOpinionCredits: parseInt(process.env.CREDITS_SILVER, 10) || 9,
    weeklyDrafts: parseInt(process.env.DRAFTS_SILVER, 10) || 22,
    durationDays: 30,
    priceUzs: 199000,
  },
  gold: {
    label: 'Gold',
    dailyLimit: null,
    monthlyLimit: null,
    fairUseDaily: parseInt(process.env.FAIR_USE_GOLD, 10) || 30,
    weeklyOpinionCredits: parseInt(process.env.CREDITS_GOLD, 10) || 17,
    weeklyDrafts: parseInt(process.env.DRAFTS_GOLD, 10) || 50,
    durationDays: 30,
    priceUzs: 399000,
  },
  platinum: {
    label: 'Platinum',
    dailyLimit: null,
    monthlyLimit: null,
    fairUseDaily: parseInt(process.env.FAIR_USE_PLATINUM, 10) || 70,
    weeklyOpinionCredits: parseInt(process.env.CREDITS_PLATINUM, 10) || 42,
    weeklyDrafts: parseInt(process.env.DRAFTS_PLATINUM, 10) || 125,
    durationDays: 30,
    priceUzs: 999000,
  },
};

// A legal opinion costs $0.15-$0.65 depending on document length — a 4x
// spread. Charging one "opinion" regardless meant the worst case was a
// lottery: with every document at max size, every plan went to -20%. Credits
// make cost-per-credit flat (~$0.22) so the worst case is predictable, and
// light users stop subsidising heavy ones.
const OPINION_CREDIT_TIERS = [
  { maxChars: 40000,  credits: 1 },
  { maxChars: 90000,  credits: 2 },
  { maxChars: Infinity, credits: 3 },
];

/** Credits a document of this length costs. */
function opinionCreditsFor(charCount) {
  const n = Number(charCount) || 0;
  for (const t of OPINION_CREDIT_TIERS) if (n <= t.maxChars) return t.credits;
  return 3;
}

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
    // Opinions consume 1-3 credits by document size; everything else is 1.
    // Nullable with a COALESCE at read time, so historical rows need no backfill.
    await pool.query(`ALTER TABLE tariff_usage ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 1`);
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

// ── Cost weighting for the fair-use counter ─────────────────────────────────
// The ceiling is expressed in "chat-equivalents", not raw requests, because
// the endpoints behind it do not cost the same. A chat answer runs on Luna at
// ~$0.006; generating a full legal document runs on Terra with a much larger
// output and costs ~$0.0425 — seven times more.
//
// Counting both as "1 request" is what makes an unlimited plan dangerous: a
// Silver subscriber spending 75 requests a day on documents instead of chat
// would cost ~$97/month against $23 of revenue. Weighting keeps the ceiling
// meaningful whatever mix of features a user actually chooses, and any future
// expensive endpoint only needs a line here.
//
// Applied at COUNT time via SQL rather than stored on the row, so historical
// usage needs no migration and re-pricing needs no backfill.
const ENDPOINT_WEIGHT_SQL = `
  CASE
    WHEN endpoint LIKE '/api/draft/ai-generate%' THEN 7
    WHEN endpoint LIKE '/api/templates/import%'  THEN 7
    WHEN endpoint LIKE '/api/draft%'             THEN 7
    ELSE 1
  END`;

/** SUM of cost-weighted usage since `since`, for one admin. */
async function weightedUsageSince(adminId, since) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(${ENDPOINT_WEIGHT_SQL}), 0)::int AS used
       FROM tariff_usage WHERE admin_id = $1 AND ts >= $2`,
    [adminId, since]
  );
  return r.rows[0].used;
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

// Monday 00:00 Asia/Tashkent — the reset point for weekly credit windows.
function tashkentWeekStart() {
  const d = tashkentMidnight();
  const dow = (d.getUTCDay() + 6) % 7;           // 0 = Monday
  return new Date(d.getTime() - dow * 86400000);
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

  // Bepul: generous for the first 30 days, then a smaller steady allowance.
  if (u.plan === 'bepul') {
    const ageDays = u.startsAt ? (Date.now() - new Date(u.startsAt)) / 86400000 : 0;
    const limit = ageDays > (cfg.dailyLimitAfterDays || 30)
      ? (cfg.dailyLimitLater || 3)
      : cfg.dailyLimit;
    const used = (await pool.query(
      `SELECT COUNT(*)::int AS used FROM tariff_usage WHERE admin_id = $1 AND ts >= $2`,
      [adminId, tashkentMidnight()])).rows[0].used;
    return {
      allowed: used < limit, plan: 'bepul', limit, used,
      remaining: Math.max(0, limit - used), period: 'day',
      steppedDown: ageDays > (cfg.dailyLimitAfterDays || 30),
    };
  }

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

  // Cost-weighted, not a raw request count — see ENDPOINT_WEIGHT_SQL.
  const usedToday = await weightedUsageSince(adminId, tashkentMidnight());
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

async function recordUsage(adminId, endpoint, credits = 1) {
  if (!_initialized) await initSubscriptionSchema();
  try {
    await pool.query(
      `INSERT INTO tariff_usage (admin_id, endpoint, credits) VALUES ($1, $2, $3)`,
      [adminId, endpoint || null, credits]
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

// ── Weekly opinion credits & drafting ───────────────────────────────────────
// Counted from tariff_usage rows tagged with the endpoint and, for opinions,
// the credits consumed. Weighted in SQL so a re-price needs no backfill.

/** Credits already spent this week. */
async function opinionCreditsUsed(adminId) {
  const r = await pool.query(
    `SELECT COALESCE(SUM(COALESCE(credits, 1)), 0)::int AS n
       FROM tariff_usage
      WHERE admin_id = $1 AND ts >= $2 AND endpoint LIKE '%legal-opinion%'`,
    [adminId, tashkentWeekStart()]);
  return r.rows[0].n;
}

/** Drafts already generated this week. */
async function draftsUsed(adminId) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM tariff_usage
      WHERE admin_id = $1 AND ts >= $2 AND endpoint LIKE '%draft/ai-generate%'`,
    [adminId, tashkentWeekStart()]);
  return r.rows[0].n;
}

/**
 * Can this user spend `credits` on an opinion right now?
 * Staff and master bypass; free tiers get their small weekly allowance.
 */
async function checkOpinionCredits(adminId, credits = 1) {
  const u = await getUserPlan(adminId);
  if (!u) return { allowed: false, reason: 'unknown_user' };
  if (u.plan === 'master' || (u.role && u.role !== 'user')) return { allowed: true, unlimited: true };
  const cfg = PLANS[u.plan];
  if (!cfg) return { allowed: false, reason: 'no_plan' };
  const limit = cfg.weeklyOpinionCredits || 0;
  if (limit === 0) return { allowed: false, reason: 'not_in_plan', limit: 0 };
  const used = await opinionCreditsUsed(adminId);
  return {
    allowed: used + credits <= limit,
    limit, used, cost: credits,
    remaining: Math.max(0, limit - used),
    period: 'week', resetsAt: new Date(tashkentWeekStart().getTime() + 7 * 86400000),
  };
}

/** Can this user generate another document this week? */
async function checkDraftQuota(adminId) {
  const u = await getUserPlan(adminId);
  if (!u) return { allowed: false, reason: 'unknown_user' };
  if (u.plan === 'master' || (u.role && u.role !== 'user')) return { allowed: true, unlimited: true };
  const cfg = PLANS[u.plan];
  if (!cfg) return { allowed: false, reason: 'no_plan' };
  const limit = cfg.weeklyDrafts || 0;
  if (limit === 0) return { allowed: false, reason: 'not_in_plan', limit: 0 };
  const used = await draftsUsed(adminId);
  return {
    allowed: used < limit, limit, used,
    remaining: Math.max(0, limit - used),
    period: 'week', resetsAt: new Date(tashkentWeekStart().getTime() + 7 * 86400000),
  };
}

// ── Loyalty rebate ──────────────────────────────────────────────────────────
// Margin above REBATE_THRESHOLD is returned to the customer as a discount on
// their next renewal. Light users are the ones subsidising the model; giving
// the excess back turns that into a retention mechanism instead of a windfall.
// Paid as a discount, not cash: same cost, funded by the following month's
// revenue, and it only pays out to someone who stays.
const REBATE_THRESHOLD = Number(process.env.REBATE_THRESHOLD || 0.75);
const UZS_PER_USD = Number(process.env.UZS_PER_USD || 11980);

/**
 * Per-customer margin over a period, with the rebate each has earned.
 * Reads real spend from llm_spend_log — this is measured, not modelled.
 */
async function marginReport({ since = null, plan = null } = {}) {
  const from = since ? new Date(since) : new Date(Date.now() - 30 * 86400000);
  const r = await pool.query(
    `SELECT a.id, a.username, a.full_name, a.tariff_plan,
            COALESCE(SUM(l.cost_usd), 0)::float AS cost_usd,
            COUNT(l.id)::int AS calls
       FROM admins a
       LEFT JOIN llm_spend_log l ON l.user_id = a.id AND l.created_at >= $1
      WHERE a.tariff_plan IS NOT NULL
        AND ($2::text IS NULL OR a.tariff_plan = $2)
      GROUP BY a.id, a.username, a.full_name, a.tariff_plan
      ORDER BY cost_usd DESC`,
    [from, plan]);

  const rows = r.rows.map(row => {
    const cfg = PLANS[row.tariff_plan] || {};
    const revenue = (cfg.priceUzs || 0) / UZS_PER_USD;
    const margin = revenue > 0 ? (revenue - row.cost_usd) / revenue : null;
    // Only paid plans can earn a rebate — there is no margin on a free one.
    const rebateUsd = (margin != null && margin > REBATE_THRESHOLD)
      ? (margin - REBATE_THRESHOLD) * revenue : 0;
    return {
      adminId: row.id, username: row.username, fullName: row.full_name,
      plan: row.tariff_plan, calls: row.calls,
      revenueUsd: Number(revenue.toFixed(2)),
      costUsd: Number(row.cost_usd.toFixed(4)),
      margin: margin == null ? null : Number((margin * 100).toFixed(1)),
      rebateUsd: Number(rebateUsd.toFixed(2)),
      rebateUzs: Math.round(rebateUsd * UZS_PER_USD / 1000) * 1000,
      band: margin == null ? 'free'
        : margin > REBATE_THRESHOLD ? 'rebate'
        : margin >= 0.40 ? 'target'
        : margin >= 0.05 ? 'thin' : 'loss',
    };
  });

  const totals = rows.reduce((t, x) => {
    t.revenueUsd += x.revenueUsd; t.costUsd += x.costUsd; t.rebateUsd += x.rebateUsd;
    t.byBand[x.band] = (t.byBand[x.band] || 0) + 1;
    return t;
  }, { revenueUsd: 0, costUsd: 0, rebateUsd: 0, byBand: {} });
  totals.grossMargin = totals.revenueUsd > 0
    ? Number((((totals.revenueUsd - totals.costUsd) / totals.revenueUsd) * 100).toFixed(1)) : null;
  totals.netMargin = totals.revenueUsd > 0
    ? Number((((totals.revenueUsd - totals.costUsd - totals.rebateUsd) / totals.revenueUsd) * 100).toFixed(1)) : null;
  for (const k of ['revenueUsd', 'costUsd', 'rebateUsd']) totals[k] = Number(totals[k].toFixed(2));

  return { since: from, users: rows.length, totals, rows };
}

module.exports = {
  opinionCreditsFor,
  opinionCreditsUsed,
  draftsUsed,
  checkOpinionCredits,
  checkDraftQuota,
  marginReport,
  tashkentWeekStart,
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
