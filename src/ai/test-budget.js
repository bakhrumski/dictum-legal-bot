'use strict';

/**
 * The total AI budget of a test entitlement (the pilot, 2026-10-06).
 *
 * A master gives a test account quotas and a budget (tariff-ledger
 * grantTestEntitlement: budgetUsd, unknownCallUsd, perRequestUsd). Every
 * request of that account - web or its linked Telegram chat - that is about
 * to make its first AI call first reserves a hold of its per-request limit:
 *
 *   spent + held + this hold <= budget        else no AI call at all
 *
 * spent  = what finished requests committed: the larger of the usage
 *          ledger's rows (known cost + every unknown-cost call at the assumed
 *          price, never $0) and what the request itself counted at its end;
 * held   = the per-request limit of every request still running.
 * So parallel requests cannot together pass the budget. Inside a request
 * the usage ledger stops further calls once its own known cost plus its
 * unknown-cost calls at the assumed price reach the hold.
 *
 * Known limits (docs/finance/tariffs-v2-report.md §7):
 *   - the check is made before each call; one call's own cost can carry a
 *     request past its hold (the overshoot is at most the last call of
 *     each running request);
 *   - an unknown-cost call is counted at the assumed price; if its real
 *     price is higher, the budget is exceeded by the difference - the $5
 *     is strict only for calls whose price is known.
 *
 * Off for every account without a live test entitlement; production limits
 * (AI_REQUEST_*) are not changed by it - a per-request limit set on the
 * entitlement applies to that account only.
 */

const { pool } = require('../database/db');
const usageLedger = require('./usage-ledger');

const STALE_HOLD_MIN = 15;     // a hold never released (the process stopped) counts in full
const CACHE_MS = 30000;

let cache = { at: 0, ids: new Set() };

/** Accounts with a live test entitlement, cached briefly (cheap for everyone else). */
async function accountsWithTest(db = pool, now = Date.now()) {
  if (now - cache.at < CACHE_MS) return cache.ids;
  const r = await db.query(
    `SELECT DISTINCT admin_id FROM tariff_periods
      WHERE source = 'test' AND status = 'active' AND starts_at <= now() AND ends_at > now()`);
  cache = { at: now, ids: new Set(r.rows.map(x => Number(x.admin_id))) };
  return cache.ids;
}
function resetCache() { cache = { at: 0, ids: new Set() }; }

/** The live test entitlement of an account, with its budget, or null. */
async function entitlementFor(db, adminId, now = new Date()) {
  if (adminId == null) return null;
  const r = await db.query(
    `SELECT p.id, p.admin_id, p.starts_at, p.ends_at, p.economics, a.telegram_user_id, a.telegram_chat_id
       FROM tariff_periods p JOIN admins a ON a.id = p.admin_id
      WHERE p.subject = $1 AND p.source = 'test' AND p.status = 'active' AND p.starts_at <= $2 AND p.ends_at > $2
      ORDER BY p.id DESC LIMIT 1`, [`a:${adminId}`, now]);
  const p = r.rows[0];
  if (!p) return null;
  const e = p.economics || {};
  const productionPerRequest = usageLedger.requestBudget().maxCostUsd;
  return {
    periodId: Number(p.id), adminId: Number(p.admin_id),
    chatIds: [p.telegram_user_id, p.telegram_chat_id].filter(x => x != null).map(String),
    startsAt: p.starts_at, endsAt: p.ends_at,
    budgetUsd: Number(e.budgetUsd || 5),
    unknownCallUsd: Number(e.unknownCallUsd || 0.05),
    // the account's own per-request limit, else the production one
    perRequestUsd: e.perRequestUsd != null ? Number(e.perRequestUsd) : productionPerRequest,
  };
}

/** spent and held for an entitlement, in USD (see the header). */
async function standing(db, ent) {
  const r = await db.query(`
    WITH rows AS (
      SELECT request_id::text AS request_id,
             COALESCE(SUM(cost_usd), 0)::float
               + COUNT(*) FILTER (WHERE cost_usd IS NULL AND COALESCE(status, 'success') <> 'skipped') * $5::float AS usd
        FROM llm_spend_log
       WHERE (user_id = $1 OR chat_id::text = ANY($2::text[])) AND ts >= $3 AND ts < $4
       GROUP BY request_id),
    holds AS (
      SELECT request_id, amount_usd::float AS amount, actual_usd::float AS actual,
             (released_at IS NULL AND created_at > now() - interval '${STALE_HOLD_MIN} minutes') AS live
        FROM test_budget_holds WHERE period_id = $6)
    SELECT
      COALESCE(SUM(CASE
        WHEN h.live THEN 0
        WHEN h.request_id IS NOT NULL AND h.actual IS NULL THEN GREATEST(COALESCE(r.usd, 0), h.amount)   -- never released
        ELSE GREATEST(COALESCE(r.usd, 0), COALESCE(h.actual, 0)) END), 0)::float AS spent,
      COALESCE(SUM(CASE WHEN h.live THEN h.amount ELSE 0 END), 0)::float AS held
      FROM rows r FULL OUTER JOIN holds h ON h.request_id = r.request_id`,
  [ent.adminId, ent.chatIds, ent.startsAt, ent.endsAt, ent.unknownCallUsd, ent.periodId]);
  return { spent: Number(r.rows[0].spent) || 0, held: Number(r.rows[0].held) || 0 };
}

/**
 * Reserve a hold of the per-request limit for request `requestId`, under a
 * lock per entitlement. { ok, amount, spent, held, remaining } or
 * { ok: false, reason, spent, held }.
 */
async function admit(ent, requestId, { db = pool } = {}) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`juristai:testbudget:${ent.periodId}`]);
    const existing = await client.query('SELECT amount_usd::float AS amount FROM test_budget_holds WHERE request_id = $1', [requestId]);
    if (existing.rows[0]) { await client.query('COMMIT'); return { ok: true, amount: existing.rows[0].amount, duplicate: true }; }
    const st = await standing(client, ent);
    const amount = Math.min(ent.perRequestUsd, ent.budgetUsd);
    if (st.spent + st.held + amount > ent.budgetUsd + 1e-9) {
      await client.query('COMMIT');
      return { ok: false, reason: `test budget $${ent.budgetUsd}: spent $${st.spent.toFixed(4)} + held $${st.held.toFixed(4)} leaves less than this request's $${amount}`, ...st };
    }
    await client.query('INSERT INTO test_budget_holds (period_id, request_id, amount_usd) VALUES ($1, $2, $3)', [ent.periodId, requestId, amount]);
    await client.query('COMMIT');
    return { ok: true, amount, ...st, remaining: ent.budgetUsd - st.spent - st.held - amount };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** The request finished: record what it committed and free the rest of its hold. Idempotent. */
async function release(requestId, actualUsd, { db = pool } = {}) {
  await db.query(
    `UPDATE test_budget_holds SET released_at = now(), actual_usd = $2 WHERE request_id = $1 AND released_at IS NULL`,
    [requestId, Math.max(0, Number(actualUsd) || 0)]);
}

/**
 * Put the current usage-ledger request of `adminId` under its test budget,
 * if it has a live test entitlement. Nothing is reserved until the request's
 * first AI call (most requests make none). Returns true when attached.
 */
async function attach(adminId, { db = pool } = {}) {
  if (adminId == null) return false;
  const ids = await accountsWithTest(db);
  if (!ids.has(Number(adminId))) return false;
  const ent = await entitlementFor(db, adminId);
  if (!ent) return false;
  return usageLedger.useAdmission({
    label: 'test entitlement',
    admit: (store) => admit(ent, store.requestId, { db }).then(out => ({
      ...out,
      pool: out.ok ? { label: `test entitlement budget (hold $${out.amount})`, limitUsd: out.amount, spentUsd: 0, unknownCallUsd: ent.unknownCallUsd } : null,
      maxCostUsd: out.ok ? out.amount : null,
    })),
    release: (store, committedUsd) => release(store.requestId, committedUsd, { db }),
    unknownCallUsd: ent.unknownCallUsd,
  });
}

module.exports = { entitlementFor, standing, admit, release, attach, accountsWithTest, resetCache, STALE_HOLD_MIN };
