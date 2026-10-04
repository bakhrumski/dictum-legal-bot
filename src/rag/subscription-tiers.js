'use strict';

/**
 * JuristAI tariff plans - for common users (role = 'user').
 *
 * Tariffs v2 (2026-10-04, docs/tariffs-v2.md). The catalogue, the units and
 * the reserve / commit / release ledger are in tariff-ledger.js; this module
 * keeps the HTTP middleware (enforceQuota, meterJob), the free-access gate,
 * the legacy rules of subscriptions sold before v2, and reporting.
 *
 *   Sinov     free, once per person: 5 chat + 1 analysis + 1 opinion unit
 *   Silver    199 000 so'm / 30 days: 150 chat, 8 analysis, 8 opinion, 10 drafts
 *   Gold      599 000 so'm / 30 days: 3 x Silver
 *   Platinum  999 000 so'm / 30 days: 5 x Silver; can create a Workspace
 *
 * No daily or weekly reset and no rollover: a paid period's limits are for
 * its 30 days. Usage: tariff_usage (one row per job, with service, units and
 * status); entitlements: tariff_periods.
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
//
// LEGACY (tariffs v1). Since 2026-10-04 these rules apply only to a
// subscription sold under them, until it ends (tariff_periods rules
// 'legacy_v1') - what was bought is not reduced. New periods use the v2
// catalogue in tariff-ledger.js.
const LEGACY_PLANS = {
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
    durationDays: null,
    dailyOcrPages: 3,            // D-7: scanned pages/images read per day          // no expiry
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
    dailyOcrPages: 5,            // D-7: scanned pages/images read per day
    priceUzs: 0,
  },
  silver: {
    label: 'Silver',
    dailyLimit: null,
    monthlyLimit: null,          // unlimited chat
    fairUseDaily: parseInt(process.env.FAIR_USE_SILVER, 10) || 15,
    weeklyOpinionCredits: parseInt(process.env.CREDITS_SILVER, 10) || 9,
    weeklyDrafts: parseInt(process.env.DRAFTS_SILVER, 10) || 22,
    dailyOcrPages: parseInt(process.env.OCR_PAGES_SILVER, 10) || 20,
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
    dailyOcrPages: parseInt(process.env.OCR_PAGES_GOLD, 10) || 50,
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
    dailyOcrPages: parseInt(process.env.OCR_PAGES_PLATINUM, 10) || 100,
    durationDays: 30,
    priceUzs: 999000,
  },
};

const ledger = require('./tariff-ledger');

// The plan catalogue the UI, the bot and the API show: one source.
const PLANS = Object.freeze(Object.fromEntries(Object.entries(ledger.PLAN_CATALOG).map(([k, v]) => [k, Object.freeze({
  ...v, durationDays: v.periodDays,
})])));

// v1 metered opinions in credits by size (1 / 2 / 3); v2 meters every
// document service in units (tariff-ledger.js docUnits).

/** Units a document of this length costs (v2: one unit per 40 000 characters / 10 pages). */
function opinionCreditsFor(charCount, pages = null) {
  return ledger.docUnits({ chars: charCount, pages }).units || 1;
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
// Owner-approved weights (docs/audit/DECISIONS.md D-11):
//   0  work that has its own weekly allowance (AI drafts, opinions) or calls
//      no model (Word/PDF export), so it is not limited twice;
//   3  document explanation and analysis, which read up to 120k characters;
//   1  everything else, chat included.
// Before this, drafts and opinions also cost 7 chat-equivalents each in
// fair-use, so Silver/Gold/Platinum reached ~7/14/35 drafts a week instead
// of the 22/50/125 they are sold with.
const ENDPOINT_WEIGHT_SQL = `
  CASE
    WHEN endpoint LIKE '/api/draft/export%'           THEN 0
    WHEN endpoint LIKE '/api/draft/ai-generate%'      THEN 0
    WHEN endpoint LIKE '/api/templates/import%'       THEN 0
    WHEN endpoint LIKE '/api/draft/legal-opinion%'    THEN 0
    WHEN endpoint LIKE '/api/opinion-request%'        THEN 0
    WHEN endpoint LIKE '/api/analyze/ocr%'            THEN 0
    WHEN endpoint LIKE '/api/draft/explain-document%' THEN 3
    WHEN endpoint = '/api/analyze'                    THEN 3
    ELSE 1
  END`;

/**
 * Questions counted against the free and trial daily limits: one per row
 * that weighs anything, so exports, drafts and opinions (which have their
 * own allowances) do not use up the day's questions.
 */
// A unit given back (released) or a reservation abandoned long ago is not
// usage; rows written before v2 have no status and count.
const LIVE_SQL = `(status IS NULL OR status = 'committed' OR (status = 'reserved' AND ts > now() - interval '${ledger.RESERVATION_TTL_MIN} minutes'))`;

async function dailyQuestionsSince(adminId, since, db = pool) {
  const r = await db.query(
    `SELECT COUNT(*) FILTER (WHERE (${ENDPOINT_WEIGHT_SQL}) > 0)::int AS used
       FROM tariff_usage WHERE admin_id = $1 AND ts >= $2 AND ${LIVE_SQL}`,
    [adminId, since]
  );
  return r.rows[0].used;
}

/** SUM of cost-weighted usage since `since`, for one admin. */
async function weightedUsageSince(adminId, since, db = pool) {
  const r = await db.query(
    `SELECT COALESCE(SUM(${ENDPOINT_WEIGHT_SQL}), 0)::int AS used
       FROM tariff_usage WHERE admin_id = $1 AND ts >= $2 AND ${LIVE_SQL}`,
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
//
// The weekday must be read from the Tashkent calendar date, not from the UTC
// instant of Tashkent midnight: that instant is 19:00 UTC on the previous
// day, so getUTCDay() on it came out one day early and the week started on
// Tuesday — a Monday was counted into the week before, and the limit the 429
// message promised back "dushanba kuni" only returned a day later.
function tashkentWeekStart(nowMs = Date.now()) {
  const tashkent = new Date(nowMs + 5 * 3600 * 1000);   // UTC+5, no DST
  const dow = (tashkent.getUTCDay() + 6) % 7;           // 0 = Monday
  const y = tashkent.getUTCFullYear();
  const m = String(tashkent.getUTCMonth() + 1).padStart(2, '0');
  const day = String(tashkent.getUTCDate()).padStart(2, '0');
  const midnight = new Date(`${y}-${m}-${day}T00:00:00+05:00`);
  return new Date(midnight.getTime() - dow * 86400000);
}

/**
 * The account's plan now, from its tariff periods:
 *   { plan: 'silver'|'gold'|'platinum', kind: 'paid', rules, startsAt, expiresAt }
 *   { plan: 'sinov', kind: 'trial' }          the one-time Sinov (used or not)
 *   { plan: null, kind: 'none', trialAvailable }
 *   { plan: 'master' } / { plan: <role>, staff: true }   not metered
 * Read-only: a Sinov is created on first metered use, not by reading.
 */
async function getUserPlan(adminId, db = pool) {
  if (!_initialized) await initSubscriptionSchema();
  const ent = await ledger.resolveEntitlement(db, { adminId }, { createTrial: false });
  if (ent.reason === 'unknown_user') return null;
  if (ent.kind === 'staff') return ent.role === 'master' ? { plan: 'master', role: 'master' } : { plan: ent.role, role: ent.role, staff: true };
  if (ent.kind === 'paid') {
    return { plan: ent.plan, role: 'user', kind: 'paid', rules: ent.rules, legacy: ent.rules === 'legacy_v1',
      startsAt: ent.period.starts_at, expiresAt: ent.period.ends_at, periodId: ent.period.id };
  }
  if (ent.kind === 'trial') return { plan: 'sinov', role: 'user', kind: 'trial', rules: 'v2', startsAt: ent.periods[0].starts_at, expiresAt: null };
  return { plan: null, role: 'user', kind: 'none', trialAvailable: true };
}

/** Chat allowance now, read-only (for /api/tariff/me and the dashboard). */
async function checkQuota(adminId, db = pool) {
  const u = await getUserPlan(adminId, db);
  if (!u) return { allowed: false, reason: 'unknown_user' };
  if (u.plan === 'master') return { allowed: true, plan: 'master', remaining: Infinity };
  if (u.staff) return { allowed: true, plan: u.role, remaining: Infinity };
  const b = await ledger.balance({ adminId }, { db });
  if (b.kind === 'none') return { allowed: !!b.trialAvailable, plan: null, reason: 'no_plan', trialAvailable: !!b.trialAvailable, limit: b.trialQuotas.chat, used: 0, remaining: b.trialQuotas.chat, period: 'trial' };
  if (b.legacy) return { allowed: true, plan: b.plan, legacy: true, period: 'legacy', expiresAt: b.endsAt };
  const c = b.services.chat;
  return { allowed: c.remaining > 0, plan: b.plan, limit: c.limit, used: c.used, remaining: c.remaining,
    period: b.kind === 'trial' ? 'trial' : 'period', expiresAt: b.endsAt, services: b.services };
}

// ════════════════════════════════════════
// FREE-ACCESS GATE — channel-join + weekly survey for free-tier users
// (role='user' on sinov/no plan). Paid plans and staff bypass.
// ════════════════════════════════════════

const PAID_PLANS = new Set(['silver', 'gold', 'platinum']);
const SURVEY_GRACE_MS = 7 * 24 * 60 * 60 * 1000;  // survey due 7 days after anchor
const CHANNEL_GRACE_MS = (parseInt(process.env.CHANNEL_GRACE_DAYS || '0', 10)) * 24 * 60 * 60 * 1000; // mandatory immediately by default
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

/**
 * Log one unit of usage outside the reserve/commit flow (kept for callers
 * that only record). Returns the new row id, or null when the insert failed;
 * `{ throwOnError: true }` makes a failure throw instead.
 */
async function recordUsage(adminId, endpoint, credits = 1, { throwOnError = false, db = pool } = {}) {
  if (!_initialized) await initSubscriptionSchema();
  try {
    const r = await db.query(
      `INSERT INTO tariff_usage (admin_id, endpoint, credits, status) VALUES ($1, $2, $3, 'committed') RETURNING id`,
      [adminId, endpoint || null, credits]
    );
    return r.rows[0] ? r.rows[0].id : null;
  } catch (err) {
    console.warn('[TARIFF] usage log failed:', err.message);
    if (throwOnError) throw err;
    return null;
  }
}

// ── Refunds ─────────────────────────────────────────────────────────────────
// A job that is not delivered gives its units back and says so (DECISIONS.md
// D-6): the reservation is released. A delivered job is committed. A client
// that disconnects after the answer started streaming has received work the
// providers were paid for: that job is committed, not released, so a cancel
// cannot be used to get model calls for free (docs/tariffs-v2.md).
const REFUND_NOTICE = "So'rov limiti qaytarildi: bu urinish hisobga olinmadi.";

/** Give back the units of this response's job. Idempotent. */
function refundUsage(res, reason = 'failed') {
  const t = res && res.locals && res.locals.tariffUsage;
  if (!t || t.refunded || t.committed || !t.jobKey) return {};
  t.refunded = true;
  ledger.release(t.jobKey, reason)
    .then(ok => { if (ok) console.log(`[TARIFF] released ${t.service} x${t.units} (${t.endpoint}, ${reason})`); })
    .catch(err => console.warn('[TARIFF] release failed:', err.message));
  return { quotaRefunded: true, refundNotice: REFUND_NOTICE };
}

function commitUsage(res) {
  const t = res && res.locals && res.locals.tariffUsage;
  if (!t || t.refunded || t.committed || !t.jobKey) return;
  t.committed = true;
  ledger.commit(t.jobKey).catch(err => console.warn('[TARIFF] commit failed:', err.message));
}

// A 4xx/5xx JSON reply releases the job and tells the client; a reply that
// finishes successfully commits it.
function attachRefundOnFailure(res) {
  if (typeof res.json === 'function') {
    const json = res.json.bind(res);
    res.json = function (body) {
      if (res.statusCode >= 400 && body && typeof body === 'object' && !Array.isArray(body)) {
        body = Object.assign({}, body, refundUsage(res, 'status ' + res.statusCode));
      }
      return json(body);
    };
  }
  if (typeof res.on === 'function') {
    res.on('finish', () => {
      if (res.statusCode >= 400) refundUsage(res, 'status ' + res.statusCode);
      else commitUsage(res);
    });
    // the connection closed before the response finished
    res.on('close', () => {
      if (res.writableFinished) return;
      if (res.headersSent) commitUsage(res);      // the answer had started
      else refundUsage(res, 'client_closed');      // nothing was delivered
    });
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

/**
 * The Sinov is taken by using it (created on the first metered request) or
 * here. A paid plan is never granted by the user's own request: only a
 * payment (or a master's grant) through ledger.grantPaidPeriod.
 */
async function selectPlan(adminId, plan) {
  if (!_initialized) await initSubscriptionSchema();
  if (!PLANS[plan]) throw new Error(`Unknown plan: ${plan}`);
  if (plan !== 'sinov') throw new Error('payment_required');
  const ent = await ledger.resolveEntitlement(pool, { adminId });
  if (ent.kind === 'paid') throw new Error('paid_plan_active');
  if (ent.kind !== 'trial') throw new Error('trial_unavailable');
  return { plan: 'sinov', startsAt: ent.periods[0].starts_at, expiresAt: null, quotas: PLANS.sinov.quotas };
}

/**
 * Run `fn(client)` holding a per-user advisory lock in one transaction, on
 * one connection. Check-then-insert quota logic used to run unlocked, so N
 * parallel requests at `used = limit - 1` all passed (audit M1, H4). Every
 * query inside must use the client it is given: a lock holder that asked
 * the pool for a second connection could wait behind requests that are
 * themselves waiting for the lock. Same key as tariff-ledger's lock.
 */
async function withUserLock(adminId, fn) {
  // Schema setup uses the pool; do it before taking the lock, not inside.
  if (!_initialized) await initSubscriptionSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('juristai:tariff:' || $1::text))", [adminId]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Expensive paths refuse to run when the quota cannot be checked; chat keeps
// working through a database hiccup (DECISIONS.md D-5).
const QUOTA_UNAVAILABLE = {
  error: 'quota_unavailable',
  code: 'QUOTA_UNAVAILABLE',
  message: "Limitni hozir tekshirib bo'lmadi. Bir necha daqiqadan keyin qayta urinib ko'ring.",
};

// Which service an endpoint draws on. null: no model call, not metered.
const SERVICE_BY_ENDPOINT = [
  [/^\/api\/draft\/export/u, null],
  [/^\/api\/templates\/import/u, null],
  [/^\/api\/draft\/ai-generate/u, 'draft'],
  [/^\/api\/analyze\/ocr/u, 'ocr'],
  [/^\/api\/analyze$|explain-document/u, 'analysis'],
  [/legal-opinion|opinion-request/u, 'opinion'],
];
function serviceFor(endpoint = '') {
  for (const [re, svc] of SERVICE_BY_ENDPOINT) if (re.test(String(endpoint))) return svc;
  return 'chat';
}

const SERVICE_LABEL = {
  chat: 'huquqiy chat', analysis: 'hujjat tahlili', opinion: 'AI yuridik xulosa', draft: 'hujjat (draft) yaratish', ocr: "rasm/skan o'qish",
};

function tashkentDateText(d) {
  if (!d) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric' })
    .formatToParts(new Date(d)).map(x => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year}`;
}

/** The refusal for a reservation that was not allowed: status and body. */
function refusal(r, service) {
  const label = SERVICE_LABEL[service] || service;
  if (r.fairUseHit) {
    return [429, { error: 'rate_limited', code: 'FAIR_USE', reason: 'fair_use',
      message: "Juda ko'p so'rov yuborildi. Biroz kuting va davom eting.", plan: r.plan, retryAfterHours: 24 }];
  }
  if (r.kind === 'none' || r.reason === 'no_plan') {
    return [402, { error: 'plan_required', code: 'PLAN_REQUIRED', service, upgradeUrl: '/tariff.html',
      message: "Sinov limitingiz tugagan yoki tarif tanlanmagan. Davom etish uchun tarifni tanlang — avtomatik to'lov olinmaydi." }];
  }
  const planLabel = (PLANS[r.plan] || {}).label || r.plan;
  if (r.reason === 'not_in_plan' || r.limit === 0) {
    return [402, { error: 'not_in_plan', code: 'NOT_IN_PLAN', service, plan: r.plan, upgradeUrl: '/tariff.html',
      message: `${label[0].toUpperCase()}${label.slice(1)} ${planLabel} tarifiga kirmaydi. Silver, Gold yoki Platinum tarifini tanlang.` }];
  }
  const until = r.kind === 'trial'
    ? "Sinov bir martalik va yangilanmaydi — davom etish uchun tarifni tanlang."
    : (r.endsAt ? `Limit ${tashkentDateText(r.endsAt)} da yangi 30 kunlik davr bilan qayta tiklanadi (avtomatik to'lov olinmaydi) yoki yuqori tarifga o'tishingiz mumkin.` : '');
  return [429, { error: 'quota_exceeded', code: 'QUOTA_EXCEEDED', service, plan: r.plan, upgradeUrl: '/tariff.html',
    used: r.used, limit: r.limit, cost: r.units, remaining: r.remaining,
    message: `${planLabel}: ${label} limiti yetarli emas (${r.used}/${r.limit}${r.units > 1 ? `, bu ish ${r.units} birlik talab qiladi` : ''}). ${until}`.trim() }];
}

/**
 * Reserve `units` of `service` for this request's job and tie the
 * reservation to the response: committed when it succeeds, released (with a
 * notice) when it fails. Sends the refusal itself and returns
 * { allowed: false } when the person has no allowance. The payer is the
 * session's own account, never an id from the request.
 */
async function meterJob(req, res, { service, units = 1, endpoint = null, workspaceId = null, meta = null } = {}) {
  const adminId = req.session && req.session.adminId;
  if (!adminId) return { allowed: true, unmetered: true };
  if (req.session.role && req.session.role !== 'user') return { allowed: true, staff: true };
  const r = await ledger.reserve({
    adminId, service, units, endpoint, channel: workspaceId ? 'workspace' : 'web',
    actorId: adminId, workspaceId, meta,
  });
  if (r.kind === 'staff') return { allowed: true, staff: true };
  if (!r.allowed) {
    const [status, body] = refusal(r, service);
    res.status(status).json(body);
    return { allowed: false, ...r };
  }
  res.locals.quota = r;
  res.locals.tariffUsage = { jobKey: r.jobKey, adminId, endpoint, service, units: r.units, refunded: false, committed: false };
  attachRefundOnFailure(res);
  return r;
}

/**
 * Size a document job, refuse it if it cannot run on the plan, and reserve
 * its units. Returns { allowed, size } or sends the response itself:
 *   400 empty document (no units charged)
 *   413 larger than one job may be on this plan (clear message, no cut)
 *   402/429 no allowance
 * text: the extracted text; docTicket: from /api/analyze/extract (PDF page
 * count), optional.
 */
async function meterDocument(req, res, { service, text = '', docTicket = null, endpoint = null } = {}) {
  const clean = String(text || '').replace(/\u0000/gu, '').trim();
  const ticket = ledger.readDocTicket(docTicket, clean);
  const size = ledger.docUnits({ chars: clean.length, pages: ticket ? ticket.pages : null });
  if (!size.units) {
    res.status(400).json({ error: "Hujjat matni bo'sh yoki o'qib bo'lmadi — limit sarflanmadi.", code: 'EMPTY_DOCUMENT', quotaRefunded: true });
    return { allowed: false, size };
  }
  const adminId = req.session && req.session.adminId;
  let plan = 'silver';
  if (adminId && (!req.session.role || req.session.role === 'user')) {
    const access = await checkFreeAccess(adminId);
    if (!access.allowed) {
      res.status(403).json({ error: access.code, code: access.code, message: access.code === 'SURVEY_REQUIRED'
        ? 'Bepul foydalanishni davom ettirish uchun qisqa so\'rovnomani to\'ldiring.'
        : 'Bepul foydalanish uchun rasmiy Telegram kanalimizga obuna bo\'ling.' });
      return { allowed: false, size };
    }
    const u = await getUserPlan(adminId);
    plan = u && u.plan && PLANS[u.plan] ? u.plan : 'sinov';
  }
  const fit = ledger.jobFits(plan, { chars: size.chars, pages: size.pages });
  if (!fit.ok) {
    const label = (PLANS[plan] || {}).label || plan;
    res.status(413).json({
      error: 'document_too_large', code: 'DOCUMENT_TOO_LARGE', service, plan, size,
      maxPages: fit.maxPages, maxChars: fit.maxChars, maxUnits: fit.maxUnits, quotaRefunded: true,
      message: `Hujjat hajmi: ${size.pages} sahifa, ${size.chars.toLocaleString('ru-RU')} belgi (${size.units} birlik). `
        + `${label} tarifida bitta ish ko'pi bilan ${fit.maxPages} sahifa va ${fit.maxChars.toLocaleString('ru-RU')} belgi`
        + `${plan === 'sinov' ? ' (1 birlik)' : ''}. Hujjat qisqartirilmaydi: uni qismlarga bo'lib yuboring${plan === 'sinov' ? ' yoki tarif tanlang' : ''}. Limit sarflanmadi.`,
    });
    return { allowed: false, size };
  }
  const r = await meterJob(req, res, { service, units: size.units, endpoint, meta: { pages: size.pages, chars: size.chars, ticket: !!ticket } });
  return { ...r, size };
}

/**
 * What a document job will cost before it runs: size, units, whether it
 * fits the plan, and what remains after it. Read-only.
 */
async function quoteDocument(adminId, { service = 'analysis', text = '', chars = null, pages = null, docTicket = null } = {}) {
  const clean = String(text || '').trim();
  const ticket = clean ? ledger.readDocTicket(docTicket, clean) : null;
  const size = ledger.docUnits({ chars: chars != null ? chars : clean.length, pages: ticket ? ticket.pages : pages });
  const u = await getUserPlan(adminId);
  if (u && (u.plan === 'master' || u.staff)) return { service, size, units: size.units, fits: true, unlimited: true };
  const plan = u && u.plan && PLANS[u.plan] ? u.plan : 'sinov';
  const fit = ledger.jobFits(plan, size);
  const b = await ledger.balance({ adminId });
  const svc = b.services ? b.services[service] : (b.kind === 'none' ? { limit: b.trialQuotas[service], used: 0, remaining: b.trialQuotas[service] } : null);
  return {
    service, plan, size, units: size.units, fits: fit.ok, reason: fit.ok ? null : fit.reason,
    maxPages: fit.maxPages, maxChars: fit.maxChars,
    legacy: !!b.legacy,
    remaining: svc ? svc.remaining : null,
    remainingAfter: svc ? Math.max(0, svc.remaining - size.units) : null,
    enough: svc ? svc.remaining >= size.units : true,
  };
}

/**
 * Express middleware: reserve one unit of the endpoint's service.
 * Master and staff bypass; the free-access gate applies to Sinov users.
 * Analysis and opinion size their units from the document and call
 * meterJob from the handler instead.
 */
function enforceQuota(endpoint, { failClosed = false, service: forced, units = 1 } = {}) {
  const service = forced !== undefined ? forced : serviceFor(endpoint);
  return async (req, res, next) => {
    if (!service) return next();
    let passed = false;
    try {
      const adminId = req.session?.adminId;
      if (!adminId) return next();
      if (req.session?.role === 'master') return next();
      if (req.session?.role && req.session.role !== 'user') return next();

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
      const workspaceId = /\/workspaces?\//u.test(String(req.originalUrl || req.url || '')) && req.params && /^[0-9a-f-]{36}$/iu.test(String(req.params.id || ''))
        ? req.params.id : null;
      const r = await meterJob(req, res, { service, units: typeof units === 'function' ? units(req) : units, endpoint, workspaceId });
      if (!r.allowed) return;
      passed = true;
      next();
    } catch (err) {
      console.error('[TARIFF] enforceQuota error:', err.message);
      if (passed || res.headersSent) return;
      if (failClosed) return res.status(503).json(QUOTA_UNAVAILABLE);
      next(); // fail-open: chat
    }
  };
}

// ── Legacy (v1) allowances ──────────────────────────────────────────────────
// Counted from tariff_usage rows tagged with the endpoint, for subscriptions
// sold under v1 (until they end). v2 periods count units per service.

/** Opinion credits spent this week (legacy). */
async function opinionCreditsUsed(adminId, db = pool) {
  const r = await db.query(
    `SELECT COALESCE(SUM(COALESCE(credits, 1)), 0)::int AS n
       FROM tariff_usage
      WHERE admin_id = $1 AND ts >= $2 AND endpoint LIKE '%legal-opinion%' AND ${LIVE_SQL}`,
    [adminId, tashkentWeekStart()]);
  return r.rows[0].n;
}

/** Drafts generated this week (legacy). */
async function draftsUsed(adminId, db = pool) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM tariff_usage
      WHERE admin_id = $1 AND ts >= $2 AND endpoint LIKE '%draft/ai-generate%' AND ${LIVE_SQL}`,
    [adminId, tashkentWeekStart()]);
  return r.rows[0].n;
}

/** OCR pages read today (legacy). */
async function ocrPagesUsed(adminId, db = pool) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM tariff_usage
      WHERE admin_id = $1 AND ts >= $2 AND endpoint LIKE '/api/analyze/ocr%' AND ${LIVE_SQL}`,
    [adminId, tashkentMidnight()]);
  return r.rows[0].n;
}

/**
 * How a legacy_v1 period is checked: the v1 rules for its plan, unchanged -
 * chat and analysis under the daily fair-use ceiling (cost-weighted),
 * opinions and drafts weekly, OCR pages daily. Runs inside the ledger's lock.
 */
async function legacyCheck(db, { adminId, plan, service, units = 1 }) {
  const cfg = LEGACY_PLANS[plan];
  if (!cfg) return { allowed: false, reason: 'unknown_plan' };
  const week = { period: 'week', resetsAt: new Date(tashkentWeekStart().getTime() + 7 * 86400000) };
  if (service === 'opinion') {
    const limit = cfg.weeklyOpinionCredits || 0;
    const used = await opinionCreditsUsed(adminId, db);
    return { allowed: limit > 0 && used + units <= limit, limit, used, remaining: Math.max(0, limit - used), reason: limit ? 'limit_reached' : 'not_in_plan', ...week };
  }
  if (service === 'draft') {
    const limit = cfg.weeklyDrafts || 0;
    const used = await draftsUsed(adminId, db);
    return { allowed: limit > 0 && used + units <= limit, limit, used, remaining: Math.max(0, limit - used), reason: limit ? 'limit_reached' : 'not_in_plan', ...week };
  }
  if (service === 'ocr') {
    const limit = cfg.dailyOcrPages || 0;
    const used = await ocrPagesUsed(adminId, db);
    return { allowed: limit > 0 && used + units <= limit, limit, used, remaining: Math.max(0, limit - used), reason: limit ? 'limit_reached' : 'not_in_plan', period: 'day' };
  }
  // chat and analysis: unlimited, under the daily anti-abuse ceiling
  const fairUse = cfg.fairUseDaily;
  if (!fairUse) return { allowed: true, limit: null, used: 0, remaining: null };
  const usedToday = await weightedUsageSince(adminId, tashkentMidnight(), db);
  return { allowed: usedToday < fairUse, limit: null, unlimited: true, used: usedToday, remaining: null, fairUseHit: usedToday >= fairUse, reason: 'fair_use' };
}
ledger.setLegacyCheck(legacyCheck);

/**
 * Reserve opinion units for one opinion (atomic, idempotent). Kept for the
 * callers of the v1 name; the unit count comes from ledger.docUnits.
 */
async function reserveOpinionCredits(adminId, credits = 1) {
  if (!_initialized) await initSubscriptionSchema();
  const r = await ledger.reserve({ adminId, service: 'opinion', units: credits, endpoint: '/api/draft/legal-opinion' });
  if (r.kind === 'staff') return { allowed: true, unlimited: true, reservationId: null };
  return { ...r, cost: r.units, reservationId: r.allowed ? r.jobKey : null };
}

/** Give reserved opinion units back (the opinion was not delivered). */
async function releaseOpinionCredits(adminId, reservationId) {
  return ledger.release(reservationId, 'opinion_not_delivered');
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
       LEFT JOIN llm_spend_log l ON l.user_id = a.id AND l.ts >= $1
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
  ledger,
  withUserLock,
  meterJob,
  meterDocument,
  quoteDocument,
  serviceFor,
  refusal,
  legacyCheck,
  reserveOpinionCredits,
  releaseOpinionCredits,
  ocrPagesUsed,
  refundUsage,
  REFUND_NOTICE,
  QUOTA_UNAVAILABLE,
  ENDPOINT_WEIGHT_SQL,
  opinionCreditsFor,
  opinionCreditsUsed,
  draftsUsed,
  marginReport,
  tashkentWeekStart,
  PLANS,
  LEGACY_PLANS,
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
