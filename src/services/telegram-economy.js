'use strict';

/**
 * Telegram answer entitlements, payment receipts and anonymous activity stats.
 *
 * The free entitlement is lifetime-based. Conversations, menus and
 * clarification turns are deliberately not recorded here because they must
 * remain unlimited. An answer is reserved before generation, finalized only
 * after Telegram confirms delivery, and automatically restored if abandoned.
 */

const { pool } = require('../database/db');
const crypto = require('crypto');

let tablesReadyPromise = null;
const parsedReservationTtl = Number.parseInt(process.env.TG_ANSWER_RESERVATION_TTL_MIN || '10', 10);
const RESERVATION_TTL_MS = Math.min(60, Math.max(2, parsedReservationTtl || 10)) * 60 * 1000;

function ensureTables() {
  if (tablesReadyPromise) return tablesReadyPromise;
  tablesReadyPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tg_agent_free_usage (
        chat_id      BIGINT PRIMARY KEY,
        free_answers INTEGER NOT NULL DEFAULT 0 CHECK (free_answers >= 0),
        updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tg_answer_wallets (
        chat_id    BIGINT PRIMARY KEY,
        credits    INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tg_answer_reservations (
        reservation_id UUID PRIMARY KEY,
        chat_id        BIGINT NOT NULL,
        source         VARCHAR(8) NOT NULL CHECK (source IN ('free', 'paid')),
        status         VARCHAR(12) NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'delivered', 'released')),
        created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
        finalized_at   TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS tg_answer_one_pending_per_chat
        ON tg_answer_reservations (chat_id)
        WHERE status = 'pending'
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tg_answer_payments (
        id                          BIGSERIAL PRIMARY KEY,
        chat_id                     BIGINT NOT NULL,
        telegram_user_id            BIGINT NOT NULL,
        invoice_payload             VARCHAR(128) NOT NULL,
        currency                    VARCHAR(8) NOT NULL,
        total_amount                INTEGER NOT NULL CHECK (total_amount > 0),
        credits                     INTEGER NOT NULL CHECK (credits > 0),
        telegram_payment_charge_id  VARCHAR(255) NOT NULL UNIQUE,
        provider_payment_charge_id  VARCHAR(255),
        created_at                  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tg_bot_daily_activity (
        activity_day DATE NOT NULL,
        chat_id      BIGINT NOT NULL,
        interactions INTEGER NOT NULL DEFAULT 1 CHECK (interactions > 0),
        updated_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (activity_day, chat_id)
      )
    `);

    // Seed truthful historical totals from existing Telegram users. This does
    // not expose identities; it only gives the aggregate table one activity
    // day per known account based on the platform's existing last-active time.
    await pool.query(`
      INSERT INTO tg_bot_daily_activity (activity_day, chat_id, interactions, updated_at)
      SELECT
        COALESCE(
          (last_active AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent')::date,
          (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent')::date,
          timezone('Asia/Tashkent', NOW())::date
        ),
        telegram_id,
        1,
        NOW()
      FROM users
      WHERE telegram_id IS NOT NULL
      ON CONFLICT (activity_day, chat_id) DO NOTHING
    `).catch(error => {
      if (error && error.code !== '42P01' && error.code !== '42703') throw error;
    });

    // Preserve the old daily quota history when moving to one lifetime-free
    // answer. Anyone who previously received an AI answer has already used the
    // new free entitlement; this prevents a deployment from resetting access.
    await pool.query(`
      INSERT INTO tg_agent_free_usage (chat_id, free_answers, updated_at)
      SELECT chat_id, 1, NOW()
        FROM tg_agent_daily_usage
       WHERE ai_answers > 0
       GROUP BY chat_id
      ON CONFLICT (chat_id) DO NOTHING
    `).catch(error => {
      // Fresh installations do not have the legacy table.
      if (error && error.code !== '42P01') throw error;
    });

    // Repair reservations left behind by the pre-delivery accounting code.
    // Before reservation IDs existed, a Render restart after generation but
    // before bot.sendMessage() could consume the lifetime answer forever. A
    // usage row with neither a delivered Telegram request nor any reservation
    // is that legacy orphan and is safe to restore once.
    await pool.query(`
      UPDATE tg_agent_free_usage usage
         SET free_answers = 0, updated_at = NOW()
       WHERE usage.free_answers > 0
         AND NOT EXISTS (
           SELECT 1 FROM tg_answer_reservations reservation
            WHERE reservation.chat_id = usage.chat_id
         )
         AND NOT EXISTS (
           SELECT 1
             FROM users u
             JOIN requests r ON r.user_id = u.id
            WHERE u.telegram_id = usage.chat_id
              AND r.source_channel = 'telegram'
              AND r.agent_action = 'answered'
              AND COALESCE(r.response_text, '') <> ''
         )
    `).catch(error => {
      // Older/fresh schemas may not have the request audit columns yet. The
      // reservation mechanism still works; only the one-time repair is skipped.
      if (error && !['42P01', '42703'].includes(error.code)) throw error;
    });
  })().catch(error => {
    tablesReadyPromise = null;
    throw error;
  });
  return tablesReadyPromise;
}

async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function getPaidAnswerCreditsFrom(db, chatId) {
  const result = await db.query(
    'SELECT credits FROM tg_answer_wallets WHERE chat_id = $1',
    [chatId]
  );
  return result.rows.length ? Number(result.rows[0].credits) || 0 : 0;
}

async function refundReservation(db, chatId, source) {
  if (source === 'paid') {
    await db.query(`
      INSERT INTO tg_answer_wallets (chat_id, credits, updated_at)
      VALUES ($1, 1, NOW())
      ON CONFLICT (chat_id) DO UPDATE SET
        credits = tg_answer_wallets.credits + 1,
        updated_at = NOW()
    `, [chatId]);
    return;
  }
  await db.query(`
    UPDATE tg_agent_free_usage
       SET free_answers = GREATEST(0, free_answers - 1), updated_at = NOW()
     WHERE chat_id = $1
  `, [chatId]);
}

/** Release abandoned work so a restart/timeout cannot consume an answer. */
async function releaseExpiredReservations(db, chatId) {
  const expired = await db.query(`
    UPDATE tg_answer_reservations
       SET status = 'released', finalized_at = NOW()
     WHERE status = 'pending'
       AND created_at < NOW() - ($1 * INTERVAL '1 millisecond')
       AND ($2::bigint IS NULL OR chat_id = $2)
     RETURNING reservation_id, chat_id, source
  `, [RESERVATION_TTL_MS, chatId == null ? null : chatId]);
  for (const row of expired.rows) {
    await refundReservation(db, row.chat_id, row.source);
  }
  return expired.rows.length;
}

async function getPaidAnswerCredits(chatId) {
  await ensureTables();
  return getPaidAnswerCreditsFrom(pool, chatId);
}

/** Read-only availability check used before any model-based intent call. */
async function getAnswerEntitlementStatus(chatId, freeLimit = 1) {
  await ensureTables();
  const safeLimit = Math.max(0, Number(freeLimit) || 0);
  return inTransaction(async client => {
    await releaseExpiredReservations(client, chatId);
    const result = await client.query(`
      SELECT
        COALESCE((SELECT free_answers FROM tg_agent_free_usage WHERE chat_id = $1), 0)::int AS free_used,
        COALESCE((SELECT credits FROM tg_answer_wallets WHERE chat_id = $1), 0)::int AS paid_credits,
        EXISTS(
          SELECT 1 FROM tg_answer_reservations
           WHERE chat_id = $1 AND status = 'pending'
        ) AS answer_pending
    `, [chatId]);
    const row = result.rows[0] || {};
    const freeUsed = Number(row.free_used) || 0;
    const paidCredits = Number(row.paid_credits) || 0;
    const pending = row.answer_pending === true;
    return {
      allowed: !pending && (freeUsed < safeLimit || paidCredits > 0),
      pending,
      freeUsed,
      freeRemaining: Math.max(0, safeLimit - freeUsed),
      paidCredits,
      limit: safeLimit,
    };
  });
}

/** Atomically reserve either a lifetime-free answer or one paid credit. */
async function claimAnswerEntitlement(chatId, freeLimit = 1) {
  await ensureTables();
  const safeLimit = Math.max(0, Number(freeLimit) || 0);
  return inTransaction(async client => {
    // Serialize entitlement changes for one Telegram chat across Render workers.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [String(chatId)]);
    await releaseExpiredReservations(client, chatId);

    const active = await client.query(`
      SELECT reservation_id FROM tg_answer_reservations
       WHERE chat_id = $1 AND status = 'pending'
       LIMIT 1
    `, [chatId]);
    if (active.rows.length) {
      return {
        allowed: false, pending: true, source: null,
        used: safeLimit, remaining: 0, limit: safeLimit,
        paidCredits: await getPaidAnswerCreditsFrom(client, chatId),
      };
    }

    const reservationId = crypto.randomUUID();
    if (safeLimit > 0) {
      const free = await client.query(`
        INSERT INTO tg_agent_free_usage (chat_id, free_answers, updated_at)
        VALUES ($1, 1, NOW())
        ON CONFLICT (chat_id) DO UPDATE SET
          free_answers = tg_agent_free_usage.free_answers + 1,
          updated_at = NOW()
        WHERE tg_agent_free_usage.free_answers < $2
        RETURNING free_answers
      `, [chatId, safeLimit]);
      if (free.rows.length) {
        await client.query(`
          INSERT INTO tg_answer_reservations (reservation_id, chat_id, source)
          VALUES ($1, $2, 'free')
        `, [reservationId, chatId]);
        const used = Number(free.rows[0].free_answers) || 1;
        return {
          allowed: true, reservationId, source: 'free', used,
          remaining: Math.max(0, safeLimit - used), limit: safeLimit,
          paidCredits: await getPaidAnswerCreditsFrom(client, chatId),
        };
      }
    }

    const paid = await client.query(`
      UPDATE tg_answer_wallets
         SET credits = credits - 1, updated_at = NOW()
       WHERE chat_id = $1 AND credits > 0
       RETURNING credits
    `, [chatId]);
    if (paid.rows.length) {
      await client.query(`
        INSERT INTO tg_answer_reservations (reservation_id, chat_id, source)
        VALUES ($1, $2, 'paid')
      `, [reservationId, chatId]);
      return {
        allowed: true, reservationId, source: 'paid', used: safeLimit,
        remaining: 0, limit: safeLimit,
        paidCredits: Number(paid.rows[0].credits) || 0,
      };
    }

    return {
      allowed: false, pending: false, source: null, used: safeLimit,
      remaining: 0, limit: safeLimit, paidCredits: 0,
    };
  });
}

/** Finalize only after every Telegram answer part was delivered successfully. */
async function finalizeAnswerEntitlement(chatId, reservation = {}) {
  await ensureTables();
  if (!reservation.reservationId) return false;
  const result = await pool.query(`
    UPDATE tg_answer_reservations
       SET status = 'delivered', finalized_at = NOW()
     WHERE reservation_id = $1 AND chat_id = $2 AND status = 'pending'
     RETURNING reservation_id
  `, [reservation.reservationId, chatId]);
  return result.rows.length > 0;
}

/** Return a reservation if generation or Telegram delivery fails. Idempotent. */
async function releaseAnswerEntitlement(chatId, reservation = {}) {
  await ensureTables();
  if (!reservation.reservationId) return false;
  return inTransaction(async client => {
    const released = await client.query(`
      UPDATE tg_answer_reservations
         SET status = 'released', finalized_at = NOW()
       WHERE reservation_id = $1 AND chat_id = $2 AND status = 'pending'
       RETURNING source
    `, [reservation.reservationId, chatId]);
    if (!released.rows.length) return false;
    await refundReservation(client, chatId, released.rows[0].source);
    return true;
  });
}

/**
 * Idempotently turn a successful Telegram Stars receipt into answer credits.
 * The unique Telegram charge ID prevents webhook/polling retries from granting
 * the same purchase twice.
 */
async function grantPaidAnswers(payment) {
  await ensureTables();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(`
      INSERT INTO tg_answer_payments
        (chat_id, telegram_user_id, invoice_payload, currency, total_amount,
         credits, telegram_payment_charge_id, provider_payment_charge_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (telegram_payment_charge_id) DO NOTHING
      RETURNING id
    `, [
      payment.chatId,
      payment.telegramUserId,
      payment.invoicePayload,
      payment.currency,
      payment.totalAmount,
      payment.credits,
      payment.telegramPaymentChargeId,
      payment.providerPaymentChargeId || null,
    ]);

    if (!inserted.rows.length) {
      await client.query('COMMIT');
      return { credited: false, duplicate: true, credits: await getPaidAnswerCredits(payment.chatId) };
    }

    const wallet = await client.query(`
      INSERT INTO tg_answer_wallets (chat_id, credits, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (chat_id) DO UPDATE SET
        credits = tg_answer_wallets.credits + EXCLUDED.credits,
        updated_at = NOW()
      RETURNING credits
    `, [payment.chatId, payment.credits]);
    await client.query('COMMIT');
    return { credited: true, duplicate: false, credits: Number(wallet.rows[0].credits) || 0 };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function recordTelegramActivity(chatId) {
  try {
    await ensureTables();
    await pool.query(`
      INSERT INTO tg_bot_daily_activity (activity_day, chat_id, interactions, updated_at)
      VALUES (timezone('Asia/Tashkent', NOW())::date, $1, 1, NOW())
      ON CONFLICT (activity_day, chat_id) DO UPDATE SET
        interactions = tg_bot_daily_activity.interactions + 1,
        updated_at = NOW()
    `, [chatId]);
  } catch (error) {
    console.warn('[TG-STATS] activity could not be recorded:', error.message);
  }
}

async function getTelegramUserStats() {
  await ensureTables();
  const result = await pool.query(`
    SELECT
      COUNT(DISTINCT chat_id) FILTER (
        WHERE activity_day = timezone('Asia/Tashkent', NOW())::date
      )::int AS daily_users,
      COUNT(DISTINCT chat_id) FILTER (
        WHERE date_trunc('month', activity_day::timestamp) =
              date_trunc('month', timezone('Asia/Tashkent', NOW()))
      )::int AS monthly_users,
      COUNT(DISTINCT chat_id)::int AS total_users
    FROM tg_bot_daily_activity
  `);
  const row = result.rows[0] || {};
  return {
    dailyUsers: Number(row.daily_users) || 0,
    monthlyUsers: Number(row.monthly_users) || 0,
    totalUsers: Number(row.total_users) || 0,
  };
}

module.exports = {
  claimAnswerEntitlement,
  finalizeAnswerEntitlement,
  getAnswerEntitlementStatus,
  releaseAnswerEntitlement,
  getPaidAnswerCredits,
  grantPaidAnswers,
  recordTelegramActivity,
  getTelegramUserStats,
};
