'use strict';

/**
 * Subscription Tiers + Rate Limiter — JuristAI (Phase 3)
 *
 * Tiers (monthly AI chat requests):
 *   free     :  20   (default for new users)
 *   basic    : 300
 *   pro      : 1000
 *   business : custom (per-user override, typically 5000+)
 *
 * Rate-limit window = 30 rolling days. We count rows in ai_chat_usage
 * in the last 30 days for the caller.
 *
 * NOTE: Payment integration (Stripe / Click / Payme / Paynet) is intentionally
 * deferred. Tier assignment is done by master admin via /api/subscription/set-tier.
 *
 * Schema:
 *   users.subscription_tier   VARCHAR(20) DEFAULT 'free'
 *   users.subscription_limit  INTEGER                (override; NULL → use tier default)
 *   users.subscription_expires_at TIMESTAMPTZ        (NULL → no expiry)
 *
 *   ai_chat_usage(
 *     id         SERIAL PRIMARY KEY,
 *     user_id    INTEGER NOT NULL,
 *     endpoint   VARCHAR(50),
 *     ts         TIMESTAMPTZ DEFAULT NOW()
 *   )
 */

const { pool } = require('../database/db');

const TIER_LIMITS = {
  free:     20,
  basic:    300,
  pro:      1000,
  business: 5000,
};

let _initialized = false;

async function initSubscriptionSchema() {
  if (_initialized) return;
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(20) DEFAULT 'free'`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_limit INTEGER`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_chat_usage (
        id       SERIAL PRIMARY KEY,
        user_id  INTEGER NOT NULL,
        endpoint VARCHAR(50),
        ts       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_chat_usage_user_ts ON ai_chat_usage(user_id, ts DESC)`);

    _initialized = true;
    console.log('[SUBSCRIPTION] schema ready (tiers + ai_chat_usage)');
  } catch (err) {
    console.error('[SUBSCRIPTION] init failed:', err.message);
  }
}

/**
 * Get a user's effective monthly limit.
 * Honors per-user override, falls back to tier default, falls back to 'free'.
 */
async function getUserQuota(userId) {
  if (!_initialized) await initSubscriptionSchema();
  const r = await pool.query(
    `SELECT subscription_tier, subscription_limit, subscription_expires_at
       FROM users WHERE id = $1`,
    [userId]
  );
  if (r.rows.length === 0) return { tier: 'free', limit: TIER_LIMITS.free, expiresAt: null };

  let { subscription_tier: tier, subscription_limit: override, subscription_expires_at: expiresAt } = r.rows[0];
  // Expired paid subscriptions revert to free
  if (expiresAt && new Date(expiresAt) < new Date()) {
    tier = 'free';
    override = null;
  }
  tier = tier || 'free';
  const limit = (override != null && override > 0) ? override : (TIER_LIMITS[tier] || TIER_LIMITS.free);
  return { tier, limit, expiresAt };
}

/**
 * Count rolling-30-day chat calls for this user.
 */
async function getUsage30d(userId) {
  if (!_initialized) await initSubscriptionSchema();
  const r = await pool.query(
    `SELECT COUNT(*)::int AS used
       FROM ai_chat_usage
      WHERE user_id = $1 AND ts > NOW() - INTERVAL '30 days'`,
    [userId]
  );
  return r.rows[0].used;
}

/**
 * Check quota. Returns { allowed, tier, limit, used, remaining }.
 * Does NOT record usage — call `recordUsage()` after a successful response.
 */
async function checkQuota(userId) {
  const [{ tier, limit, expiresAt }, used] = await Promise.all([
    getUserQuota(userId),
    getUsage30d(userId),
  ]);
  return {
    allowed: used < limit,
    tier,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    expiresAt,
  };
}

async function recordUsage(userId, endpoint) {
  if (!_initialized) await initSubscriptionSchema();
  try {
    await pool.query(
      `INSERT INTO ai_chat_usage (user_id, endpoint) VALUES ($1, $2)`,
      [userId, endpoint || null]
    );
  } catch (err) {
    console.warn('[SUBSCRIPTION] usage log failed:', err.message);
  }
}

/**
 * Set a user's subscription tier (admin action).
 * @param {number} userId
 * @param {string} tier - 'free' | 'basic' | 'pro' | 'business'
 * @param {Object} opts - { customLimit, expiresAt }
 */
async function setTier(userId, tier, { customLimit = null, expiresAt = null } = {}) {
  if (!_initialized) await initSubscriptionSchema();
  if (!TIER_LIMITS[tier]) throw new Error(`Unknown tier: ${tier}`);
  await pool.query(
    `UPDATE users
        SET subscription_tier = $1,
            subscription_limit = $2,
            subscription_expires_at = $3
      WHERE id = $4`,
    [tier, customLimit, expiresAt, userId]
  );
}

/**
 * Express middleware that enforces the user's quota.
 * Requires req.user.id to be set by the upstream auth middleware.
 * On quota exceeded: 429 with a structured body.
 *
 * Usage:
 *   app.post('/api/advanced-chat', requireAuth, enforceQuota('/api/advanced-chat'), handler)
 */
function enforceQuota(endpoint) {
  return async (req, res, next) => {
    try {
      const userId = req.session?.adminId || req.session?.userId || req.user?.id || req.userId;
      if (!userId) return next(); // upstream auth will reject; don't double-fail
      // Master admins bypass quotas entirely
      if (req.session?.role === 'master') return next();
      const q = await checkQuota(userId);
      if (!q.allowed) {
        return res.status(429).json({
          error: 'quota_exceeded',
          message: `Oylik limit tugadi (${q.used}/${q.limit}). Tarifni yangilang.`,
          tier: q.tier,
          limit: q.limit,
          used: q.used,
          remaining: 0,
        });
      }
      // Record usage OPTIMISTICALLY (counts attempts). Switch to post-response
      // hook if you want to only count successful calls.
      await recordUsage(userId, endpoint);
      // Expose to downstream handlers
      res.locals.quota = q;
      next();
    } catch (err) {
      console.error('[SUBSCRIPTION] enforceQuota error:', err.message);
      next(); // fail-open — do NOT lock users out on quota system errors
    }
  };
}

module.exports = {
  TIER_LIMITS,
  initSubscriptionSchema,
  getUserQuota,
  getUsage30d,
  checkQuota,
  recordUsage,
  setTier,
  enforceQuota,
};
