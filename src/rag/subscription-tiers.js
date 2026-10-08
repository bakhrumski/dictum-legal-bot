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
// page marks ("[Sahifa n]") are added by the extract, never billed
const { contentChars, billableChars } = require('./document-explain');

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
  if (ent.kind === 'test') {
    // a master's test entitlement: its nominal plan sets the document size
    // rules; it is not a sale and admins.tariff_* is not changed by it
    return { plan: ent.plan, role: 'user', kind: 'test', test: true, rules: 'v2',
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
  // a live test entitlement granted by a master (tariff_periods.source =
  // 'test'): the channel and survey gate wait while it runs. Decided by the
  // entitlement itself - never by the login or created_by_master_id - and
  // gone the moment it ends or is ended: the account is gated as before.
  // Its quotas and its AI budget still apply (src/ai/test-budget.js).
  if (u.kind === 'test') return { allowed: true, state: 'test', testUntil: u.expiresAt || null };
  if (u.kind === 'paid' && PAID_PLANS.has(u.plan)) return { allowed: true, state: 'paid' };

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

// The jobs reserved for one response. Usually one; a chat request that
// orders both an analysis and an opinion of its document reserves one job
// per service, each from its own quota, and they succeed or fail together.
function jobsOf(res) {
  const l = res && res.locals;
  if (!l) return [];
  if (Array.isArray(l.tariffJobs) && l.tariffJobs.length) return l.tariffJobs;
  return l.tariffUsage ? [l.tariffUsage] : [];
}

/** Give back the units of this response's job(s). Idempotent. */
function refundUsage(res, reason = 'failed') {
  let released = false;
  for (const t of jobsOf(res)) {
    if (!t || t.refunded || t.committed || !t.jobKey) continue;
    t.refunded = true;
    released = true;
    ledger.release(t.jobKey, reason)
      .then(ok => { if (ok) console.log(`[TARIFF] released ${t.service} x${t.units} (${t.endpoint}, ${reason})`); })
      .catch(err => console.warn('[TARIFF] release failed:', err.message));
  }
  return released ? { quotaRefunded: true, refundNotice: REFUND_NOTICE } : {};
}

// A job marked `section` (one of two services in one answer) is paid only
// if its section reached the user (res.locals.deliveredText, kept by the
// handler); one that did not is given back. Other jobs: delivered = paid.
function commitUsage(res) {
  const text = res && res.locals ? res.locals.deliveredText : undefined;
  const jobs = jobsOf(res);
  const sectionJobs = jobs.filter(t => t && t.section);
  const settled = sectionJobs.length && typeof text === 'string'
    ? require('./document-job').settleSections(text, sectionJobs.map(t => t.service)) : {};
  for (const t of jobs) {
    if (!t || t.refunded || t.committed || !t.jobKey) continue;
    if (t.section && settled[t.service] === 'not_delivered') {
      t.refunded = true;
      ledger.release(t.jobKey, 'not_delivered')
        .then(ok => { if (ok) console.log(`[TARIFF] released ${t.service} x${t.units} (${t.endpoint}, section not delivered)`); })
        .catch(err => console.warn('[TARIFF] release failed:', err.message));
      continue;
    }
    t.committed = true;
    ledger.commit(t.jobKey).catch(err => console.warn('[TARIFF] commit failed:', err.message));
  }
}

// A 4xx/5xx JSON reply releases the job and tells the client; a reply that
// finishes successfully commits it.
function attachRefundOnFailure(res) {
  if (typeof res.json === 'function') {
    const json = res.json.bind(res);
    res.json = function (body) {
      if (res.statusCode < 400 && body && typeof body === 'object' && typeof body.reply === 'string') res.locals.deliveredText = body.reply;
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
  const job = { jobKey: r.jobKey, adminId, endpoint, service, units: r.units, refunded: false, committed: false };
  if (!res.locals.tariffUsage) {
    res.locals.quota = r;
    res.locals.tariffUsage = job;
  }
  res.locals.tariffJobs = [...(res.locals.tariffJobs || []), job];
  if (!res.locals.tariffRefundAttached) {
    res.locals.tariffRefundAttached = true;
    attachRefundOnFailure(res);
  }
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
  const size = ledger.docUnits({ chars: billableChars(clean, ticket), pages: ticket ? ticket.pages : null });
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
  // a scanned document whose OCR already reserved this service (before the
  // paid OCR call): that held reservation is the job - not a second one
  const adopted = await adoptHeldScanJob(req, res, { service, units: size.units, endpoint });
  if (adopted) return { allowed: true, adopted: true, size, units: adopted.units };
  const r = await meterJob(req, res, { service, units: size.units, endpoint, meta: { pages: size.pages, chars: size.chars, ticket: !!ticket } });
  return { ...r, size };
}

/**
 * When the request's document is one scan (req.scans) and its OCR held a
 * reservation for `service` covering `units`, make it this response's job:
 * committed when the service is delivered, released when it is not.
 */
async function adoptHeldScanJob(req, res, { service, units, endpoint }) {
  const adminId = req.session && req.session.adminId;
  if (!adminId || !Array.isArray(req.scans) || req.scans.length !== 1) return null;
  if (req.session.role && req.session.role !== 'user') return null;
  const held = await ledger.heldScanJob({ adminId, fileHash: req.scans[0].file_hash, service });
  if (!held || Number(held.units) < Number(units)) return null;
  const job = { jobKey: held.job_key, adminId, endpoint, service, units: Number(held.units), refunded: false, committed: false };
  if (!res.locals.tariffUsage) res.locals.tariffUsage = job;
  res.locals.tariffJobs = [...(res.locals.tariffJobs || []), job];
  if (!res.locals.tariffRefundAttached) {
    res.locals.tariffRefundAttached = true;
    attachRefundOnFailure(res);
  }
  return job;
}

/**
 * Several document services for one document, all or none (analysis and
 * opinion ordered together): the size and plan rules are checked once,
 * then every service's units are reserved in one transaction
 * (ledger.reserveMany) before any AI starts. If one does not fit, nothing
 * is reserved and the refusal names that service. Each job is settled on
 * its own section of the answer (commitUsage).
 */
async function meterDocuments(req, res, { services = [], text = '', docTicket = null, endpoint = null } = {}) {
  if (services.length === 1) return meterDocument(req, res, { service: services[0], text, docTicket, endpoint: `${endpoint}#${services[0]}` });
  const clean = String(text || '').replace(/\u0000/gu, '').trim();
  const ticket = ledger.readDocTicket(docTicket, clean);
  const size = ledger.docUnits({ chars: billableChars(clean, ticket), pages: ticket ? ticket.pages : null });
  if (!size.units) {
    res.status(400).json({ error: "Hujjat matni bo'sh yoki o'qib bo'lmadi — limit sarflanmadi.", code: 'EMPTY_DOCUMENT', quotaRefunded: true });
    return { allowed: false, size };
  }
  const adminId = req.session && req.session.adminId;
  if (!adminId || (req.session.role && req.session.role !== 'user')) return { allowed: true, staff: true, size };
  const access = await checkFreeAccess(adminId);
  if (!access.allowed) {
    res.status(403).json({ error: access.code, code: access.code, message: access.code === 'SURVEY_REQUIRED'
      ? 'Bepul foydalanishni davom ettirish uchun qisqa so\'rovnomani to\'ldiring.'
      : 'Bepul foydalanish uchun rasmiy Telegram kanalimizga obuna bo\'ling.' });
    return { allowed: false, size };
  }
  const u = await getUserPlan(adminId);
  const plan = u && u.plan && PLANS[u.plan] ? u.plan : 'sinov';
  const fit = ledger.jobFits(plan, { chars: size.chars, pages: size.pages });
  if (!fit.ok) {
    res.status(413).json({ error: 'document_too_large', code: 'DOCUMENT_TOO_LARGE', services, plan, size, maxPages: fit.maxPages, maxChars: fit.maxChars, quotaRefunded: true,
      message: `Hujjat hajmi: ${size.pages} sahifa, ${size.chars.toLocaleString('ru-RU')} belgi (${size.units} birlik) — bitta ish chegarasidan katta. Hujjat qisqartirilmaydi. Limit sarflanmadi.` });
    return { allowed: false, size };
  }
  const meta = { pages: size.pages, chars: size.chars, ticket: !!ticket, together: services };
  // services whose reservation a scan's OCR already holds are adopted; the
  // rest are reserved together
  const adoptedJobs = [];
  for (const sv of services) {
    const a = await adoptHeldScanJob(req, res, { service: sv, units: size.units, endpoint: `${endpoint}#${sv}` });
    if (a) { a.section = true; adoptedJobs.push(sv); }
  }
  const rest = services.filter(sv => !adoptedJobs.includes(sv));
  if (!rest.length) return { allowed: true, size, jobs: res.locals.tariffJobs };
  const r = await ledger.reserveMany({
    adminId, actorId: adminId, channel: 'web',
    jobs: rest.map(sv => ({ service: sv, units: size.units, endpoint: `${endpoint}#${sv}`, meta })),
  });
  if (r.kind === 'staff') return { allowed: true, staff: true, size };
  if (!r.allowed) {
    const [status, body] = refusal(r, r.failed);
    res.status(status).json({ ...body, services, quotaRefunded: true });
    return { allowed: false, size, ...r };
  }
  const jobs = r.jobs.map(j => ({ jobKey: j.jobKey, adminId, endpoint: `${endpoint}#${j.service}`, service: j.service, units: j.units, section: true, refunded: false, committed: false }));
  res.locals.quota = r;
  res.locals.tariffUsage = jobs[0];
  res.locals.tariffJobs = [...(res.locals.tariffJobs || []), ...jobs];
  if (!res.locals.tariffRefundAttached) {
    res.locals.tariffRefundAttached = true;
    attachRefundOnFailure(res);
  }
  return { allowed: true, size, jobs };
}

/**
 * What a document job will cost before it runs: size, units, whether it
 * fits the plan, and what remains after it. Read-only.
 */
async function quoteDocument(adminId, { service = 'analysis', text = '', chars = null, pages = null, docTicket = null } = {}) {
  const clean = String(text || '').trim();
  const ticket = clean ? ledger.readDocTicket(docTicket, clean) : null;
  const size = ledger.docUnits({ chars: ticket && ticket.chars != null ? ticket.chars : (chars != null ? chars : billableChars(clean, null)), pages: ticket ? ticket.pages : pages });
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
 * Chat middleware that knows about attached documents (2026-10-05): a file
 * does not make a request a document job, and a chat unit does not buy one.
 *   - question about the document -> one chat unit; the handler gives the
 *     model the relevant clauses only (document-job.selectExcerpt);
 *   - analysis / review of the document -> a document analysis (analysis
 *     quota); a legal opinion on it -> an AI legal opinion (opinion quota);
 *     both -> two jobs, each from its own quota. Sized in units from the
 *     whole document, charged instead of (never on top of) the chat unit,
 *     and run only when the client confirms the units it was shown: the
 *     first call answers 409 DOC_COST_CONFIRM with a quote per service.
 *     Confirmation: confirmedJob { analysis: n, opinion: n }, or
 *     confirmedUnits: n when one service is ordered.
 * res.locals.documentJob = { mode: 'chat' | 'chat_excerpt' | 'document', services, units }.
 */
function enforceChatQuota(endpoint, opts = {}) {
  const chat = enforceQuota(endpoint, opts);
  const docJob = require('./document-job');
  return async (req, res, next) => {
    const body = req.body || {};
    const doc = typeof body.documentText === 'string' ? body.documentText.replace(/\u0000/gu, '').trim() : '';
    const services = doc ? docJob.requestedServices(body.message) : [];
    if (!services.length) {
      res.locals.documentJob = { mode: doc ? 'chat_excerpt' : 'chat', services: [] };
      return chat(req, res, next);
    }
    try {
      const adminId = req.session && req.session.adminId;
      const ticket = ledger.readDocTicket(body.docTicket, doc);
      const size = ledger.docUnits({ chars: billableChars(doc, ticket), pages: ticket ? ticket.pages : null });
      res.locals.documentJob = { mode: 'document', services, units: size.units, size };
      if (!adminId || (req.session.role && req.session.role !== 'user')) return next();
      const confirmed = body.confirmedJob && typeof body.confirmedJob === 'object' ? body.confirmedJob : {};
      const ok = services.every(sv => Number(confirmed[sv]) === size.units)
        || (services.length === 1 && Number(body.confirmedUnits) === size.units);
      if (!ok) {
        const quotes = [];
        for (const sv of services) quotes.push(await quoteDocument(adminId, { service: sv, text: doc, docTicket: body.docTicket }));
        const names = services.map(sv => `${docJob.SERVICE_TITLE[sv]} — ${size.units} birlik (${sv === 'analysis' ? 'tahlil' : 'xulosa'} limitidan)`).join('; ');
        return res.status(409).json({
          error: 'doc_cost_confirm', code: 'DOC_COST_CONFIRM', service: services[0], services, quote: quotes[0], quotes,
          message: `Butun hujjat bo'yicha ish: ${size.pages} sahifa, ${size.chars.toLocaleString('ru-RU')} belgi. ${names}. `
            + `Chat limiti yechilmaydi. Tasdiqlang yoki savolni hujjatning aniq bandi bo'yicha bering (u 1 chat birligi).`,
        });
      }
      // all services reserved together before any AI starts, or none
      const m = await meterDocuments(req, res, { services, text: doc, docTicket: body.docTicket, endpoint });
      if (!m.allowed) return;
      next();
    } catch (err) {
      console.error('[TARIFF] chat document job error:', err.message);
      if (!res.headersSent) res.status(503).json(QUOTA_UNAVAILABLE);
    }
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

// ── Margin report (actual sale prices) ─────────────────────────────────────
// Revenue is what each paid period was actually sold for - cash received
// plus value carried in from a superseded period, after any individual
// discount - recognised pro rata over the days of the window. It is never
// the catalogue price: a discounted customer is not counted at list, and a
// legacy grant whose payment was never recorded has UNKNOWN revenue, shown
// apart (its v1 list price only as a reference). Cost is measured spend from
// llm_spend_log (known cost; calls of unknown cost are counted, not zeroed).
// The loyalty rebate is retired with tariffs v2 (no longer offered).
const UZS_PER_USD = Number(process.env.UZS_PER_USD || ledger.PLANNING.uzsPerUsd);

// Cumulative service revenue of one period at time t, in whole so'm:
// price + credit in - credit out, spread over the days it ran (a running
// period superseded by an upgrade ran until the upgrade; a queued one that
// never started is recognised when it was superseded). Additive over
// windows: revenue in [a, b) = R(b) - R(a), so no so'm is counted twice.
function periodRevenue(p) {
  const known = p.price_uzs != null;
  const creditKnown = !(p.economics && p.economics.creditKnown === false);
  const creditIn = Number(p.credit_uzs || 0);
  const net = known ? Number(p.price_uzs) + (creditKnown ? creditIn : 0) - Number(p.carried_out_uzs || 0) : null;
  const start = new Date(p.starts_at).getTime();
  const end = new Date(p.ends_at).getTime();
  const sup = p.superseded_at ? new Date(p.superseded_at).getTime() : null;
  const point = sup != null && sup <= start ? sup : null;
  const R = (t) => {
    if (net == null) return 0;
    if (point != null) return t >= point ? net : 0;
    if (end <= start) return t >= end ? net : 0;
    const f = Math.min(1, Math.max(0, (t - start) / (end - start)));
    return Math.floor(net * f);
  };
  const share = (a, b) => {
    if (point != null) return point >= a && point < b ? 1 : 0;
    if (end <= start) return 0;
    return Math.max(0, Math.min(end, b) - Math.max(start, a)) / (end - start);
  };
  return { known, net, creditKnown, creditIn, R, share, paidAt: new Date(p.paid_at || p.created_at).getTime() };
}

async function marginReport({ since = null, until = null, plan = null, now = new Date() } = {}) {
  const to = until ? new Date(until) : now;
  const from = since ? new Date(since) : new Date(to.getTime() - 30 * 86400000);
  const a = from.getTime();
  const b = to.getTime();
  // every period that ran, was paid for, or was superseded in the window
  const periods = await pool.query(
    `SELECT p.*, a.username, a.full_name
       FROM tariff_periods p JOIN admins a ON a.id = p.admin_id
      WHERE p.source IN ('payment', 'admin', 'migration') AND p.status IN ('active', 'superseded')
        AND ((p.starts_at < $2 AND p.ends_at > $1)
          OR (COALESCE(p.paid_at, p.created_at) >= $1 AND COALESCE(p.paid_at, p.created_at) < $2)
          OR (p.superseded_at >= $1 AND p.superseded_at < $2))
        AND ($3::text IS NULL OR p.plan = $3)`,
    [from, to, plan]);
  // AI spend of an account while it held a test entitlement (the pilot) is
  // test spend: reported apart, never in a customer's cost or margin
  const inTest = `EXISTS (SELECT 1 FROM tariff_periods t WHERE t.source = 'test' AND t.admin_id = l.user_id AND l.ts >= t.starts_at AND l.ts < t.ends_at)`;
  const spend = await pool.query(
    `SELECT user_id, COALESCE(SUM(cost_usd), 0)::float AS cost_usd,
            COUNT(*) FILTER (WHERE cost_usd IS NULL AND COALESCE(status, 'success') <> 'skipped')::int AS unknown_calls,
            COUNT(*)::int AS calls
       FROM llm_spend_log l WHERE l.ts >= $1 AND l.ts < $2 AND l.user_id IS NOT NULL AND NOT ${inTest} GROUP BY user_id`, [from, to]);
  const testSpend = (await pool.query(
    `SELECT COUNT(DISTINCT user_id)::int AS accounts, COALESCE(SUM(cost_usd), 0)::float AS cost_usd,
            COUNT(*) FILTER (WHERE cost_usd IS NULL AND COALESCE(status, 'success') <> 'skipped')::int AS unknown_calls,
            COUNT(*)::int AS calls
       FROM llm_spend_log l WHERE l.ts >= $1 AND l.ts < $2 AND l.user_id IS NOT NULL AND ${inTest}`, [from, to])).rows[0];
  const spendBy = new Map(spend.rows.map(r => [Number(r.user_id), r]));

  const users = new Map();
  for (const p of periods.rows) {
    const rv = periodRevenue(p);
    const u = users.get(p.admin_id) || {
      adminId: p.admin_id, username: p.username, fullName: p.full_name, plans: new Set(), periods: 0,
      // sold (paid) in the window
      listPriceUzs: 0, discountUzs: 0, cashReceivedUzs: 0, creditCarriedInUzs: 0, creditFromUnknownUzs: 0,
      // value moved out of periods superseded in the window
      creditCarriedOutUzs: 0,
      // service revenue earned in the window, and what is paid for but not yet earned at its end
      recognizedRevenueUzs: 0, deferredRevenueUzs: 0,
      unknownRevenuePeriods: 0, unknownRevenueListUzs: 0, forecastLeftUzs: 0, discounted: false,
    };
    u.plans.add(p.plan);
    u.periods++;
    const paidIn = rv.paidAt >= a && rv.paidAt < b;
    if (!rv.known) {
      u.unknownRevenuePeriods++;
      u.unknownRevenueListUzs += Math.round(Number(p.list_price_uzs || 0) * rv.share(a, b));
    } else {
      if (paidIn) {
        u.listPriceUzs += Number(p.list_price_uzs || 0);
        u.discountUzs += Number(p.discount_uzs || 0);
        u.cashReceivedUzs += Number(p.price_uzs);
        if (rv.creditKnown) u.creditCarriedInUzs += rv.creditIn;
        else u.creditFromUnknownUzs += rv.creditIn;
        if (p.economics && Number.isFinite(Number(p.economics.forecastLeftUzs))) u.forecastLeftUzs += Number(p.economics.forecastLeftUzs);
      }
      if (Number(p.discount_uzs || 0) > 0) u.discounted = true;
      u.recognizedRevenueUzs += rv.R(b) - rv.R(a);
      u.deferredRevenueUzs += rv.paidAt < b ? rv.net - rv.R(b) : 0;
    }
    const supAt = p.superseded_at ? new Date(p.superseded_at).getTime() : null;
    if (supAt != null && supAt >= a && supAt < b) u.creditCarriedOutUzs += Number(p.carried_out_uzs || 0);
    users.set(p.admin_id, u);
  }

  const rows = [...users.values()].map(u => {
    const s = spendBy.get(Number(u.adminId)) || { cost_usd: 0, unknown_calls: 0, calls: 0 };
    const costUzs = Math.ceil(s.cost_usd * UZS_PER_USD);
    const revenueKnown = u.unknownRevenuePeriods === 0 && u.creditFromUnknownUzs === 0;
    const margin = revenueKnown && u.recognizedRevenueUzs > 0 ? (u.recognizedRevenueUzs - costUzs) / u.recognizedRevenueUzs : null;
    return {
      ...u, plans: [...u.plans],
      costUsd: Number(s.cost_usd.toFixed(4)), costUzs, unknownCostCalls: s.unknown_calls, calls: s.calls,
      costComplete: s.unknown_calls === 0,
      revenueKnown,
      margin: margin == null ? null : Number((margin * 100).toFixed(1)),
      band: margin == null ? 'unknown' : margin >= 0.40 ? 'target' : margin >= 0.05 ? 'thin' : 'loss',
    };
  }).sort((x, y) => y.costUzs - x.costUzs);

  const sum = k => rows.reduce((t, r) => t + (r[k] || 0), 0);
  const totals = {
    // cash: what customers paid in the window, each payment once
    cashReceivedUzs: sum('cashReceivedUzs'),
    listPriceUzs: sum('listPriceUzs'), discountUzs: sum('discountUzs'),
    // credit: value moved between a customer's own periods on upgrade - never new cash
    creditCarriedInUzs: sum('creditCarriedInUzs'), creditCarriedOutUzs: sum('creditCarriedOutUzs'), creditFromUnknownUzs: sum('creditFromUnknownUzs'),
    // service revenue: earned in the window; deferred: paid, not yet earned at its end
    recognizedRevenueUzs: sum('recognizedRevenueUzs'), deferredRevenueUzs: sum('deferredRevenueUzs'),
    unknownRevenuePeriods: sum('unknownRevenuePeriods'), unknownRevenueListUzs: sum('unknownRevenueListUzs'),
    // refunds are not recorded anywhere yet: unknown, not a confirmed zero
    // the pilot / test entitlements: AI spend only (no revenue), apart
    testEntitlements: { accounts: testSpend.accounts, costUsd: Number(Number(testSpend.cost_usd).toFixed(4)), unknownCostCalls: testSpend.unknown_calls, calls: testSpend.calls },
    refundsUzs: null, refundsStatus: 'not_tracked',
    refundsNote: "To'lov qaytarish qayd etilmaydi (oqim yo'q): refund summasi noma'lum, tasdiqlangan nol emas.",
    costUsd: Number(sum('costUsd').toFixed(4)), costUzs: sum('costUzs'), unknownCostCalls: sum('unknownCostCalls'),
    forecastLeftUzs: sum('forecastLeftUzs'),
    discountedCustomers: rows.filter(r => r.discounted).length,
    byBand: rows.reduce((t, r) => { t[r.band] = (t[r.band] || 0) + 1; return t; }, {}),
  };
  totals.serviceMargin = totals.recognizedRevenueUzs > 0 && totals.unknownRevenuePeriods === 0 && totals.creditFromUnknownUzs === 0
    ? Number((((totals.recognizedRevenueUzs - totals.costUzs) / totals.recognizedRevenueUzs) * 100).toFixed(1)) : null;
  return {
    since: from, until: to, users: rows.length, uzsPerUsd: UZS_PER_USD, totals, rows,
    basis: 'cash = payments accepted in the window, once; credit = value carried between periods on upgrade, not cash; '
      + 'revenue = price + credit in - credit out of each period, spread over the days it ran; unknown where a legacy payment was never recorded; '
      + 'refunds not tracked (unknown); cost = measured known spend',
  };
}

module.exports = {
  ledger,
  withUserLock,
  meterJob,
  meterDocument,
  meterDocuments,
  commitUsage,
  quoteDocument,
  enforceChatQuota,
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
  periodRevenue,
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
