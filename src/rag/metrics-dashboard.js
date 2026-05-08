'use strict';

/**
 * Metrics Dashboard — JuristAI (Phase 4)
 *
 * Aggregates signals for operators to monitor quality and spend:
 *
 *   1. Citation health:
 *      - chunks total / active / verified_qa
 *      - % of chunks with populated article_number_display
 *      - % with adoption_date and document_number
 *
 *   2. Thumbs ratio (proxy for answer quality):
 *      - total thumbs_up / thumbs_down on qa_bank
 *      - ratio = up / (up + down)
 *
 *   3. LLM spend (via llm-spend-log):
 *      - today / month totals, model breakdown
 *
 *   4. Subscription health:
 *      - users per tier
 *      - top 10 users by 30-day chat volume
 *
 *   5. Hallucination proxy:
 *      - count of answers marked with `provider='fallback-no-context'`
 *      - (requires the caller to log answer provider into answer_audit table;
 *         gracefully returns null when the table doesn't exist)
 */

const { pool } = require('../database/db');
const spendLog = require('./llm-spend-log');

async function tableExists(name) {
  const r = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS ok`,
    [name]
  );
  return r.rows[0].ok;
}

async function getCitationHealth() {
  if (!(await tableExists('legal_chunks'))) return null;
  const r = await pool.query(`
    SELECT
      COUNT(*)::int                                                                AS total,
      COUNT(*) FILTER (WHERE is_valid = TRUE)::int                                  AS valid,
      COUNT(*) FILTER (WHERE is_valid = TRUE AND (is_active IS NULL OR is_active = TRUE))::int AS active,
      COUNT(*) FILTER (WHERE source_type = 'verified_qa')::int                      AS verified_qa,
      COUNT(*) FILTER (WHERE article_number_display IS NOT NULL)::int               AS with_article,
      COUNT(*) FILTER (WHERE adoption_date IS NOT NULL)::int                        AS with_date,
      COUNT(*) FILTER (WHERE document_number IS NOT NULL)::int                      AS with_doc_number
    FROM legal_chunks
  `);
  const row = r.rows[0];
  const pct = (n) => row.total ? +(100 * n / row.total).toFixed(1) : 0;
  return {
    ...row,
    pct_with_article: pct(row.with_article),
    pct_with_date: pct(row.with_date),
    pct_with_doc_number: pct(row.with_doc_number),
  };
}

async function getThumbsRatio() {
  if (!(await tableExists('qa_bank'))) return null;
  const r = await pool.query(`
    SELECT
      COUNT(*)::int                            AS entries,
      COALESCE(SUM(thumbs_up), 0)::int         AS thumbs_up,
      COALESCE(SUM(thumbs_down), 0)::int       AS thumbs_down
    FROM qa_bank
  `);
  const { thumbs_up, thumbs_down, entries } = r.rows[0];
  const total = thumbs_up + thumbs_down;
  return {
    entries,
    thumbs_up,
    thumbs_down,
    ratio: total > 0 ? +(thumbs_up / total).toFixed(3) : null,
  };
}

async function getSubscriptionHealth() {
  if (!(await tableExists('users'))) return null;
  const hasTiers = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name='users' AND column_name='subscription_tier') AS ok`
  );
  if (!hasTiers.rows[0].ok) return null;

  const byTier = await pool.query(`
    SELECT COALESCE(subscription_tier, 'free') AS tier, COUNT(*)::int AS users
      FROM users
     GROUP BY tier
     ORDER BY users DESC
  `);

  let topUsers = [];
  if (await tableExists('ai_chat_usage')) {
    const t = await pool.query(`
      SELECT u.id, u.username, u.name, COUNT(au.id)::int AS calls_30d
        FROM ai_chat_usage au
        JOIN users u ON u.id = au.user_id
       WHERE au.ts > NOW() - INTERVAL '30 days'
       GROUP BY u.id, u.username, u.name
       ORDER BY calls_30d DESC
       LIMIT 10
    `);
    topUsers = t.rows;
  }

  return { byTier: byTier.rows, topUsers };
}

async function getHallucinationProxy() {
  // Requires an optional `answer_audit` table the caller can log to.
  // Shape: answer_audit(id, provider, created_at, ...)
  if (!(await tableExists('answer_audit'))) return null;
  const r = await pool.query(`
    SELECT
      COUNT(*)::int                                                                  AS total,
      COUNT(*) FILTER (WHERE provider = 'fallback-no-context')::int                  AS no_context,
      COUNT(*) FILTER (WHERE provider = 'verified-qa')::int                          AS verified_verbatim
    FROM answer_audit
    WHERE created_at > NOW() - INTERVAL '30 days'
  `);
  const row = r.rows[0];
  return {
    ...row,
    pct_no_context: row.total ? +(100 * row.no_context / row.total).toFixed(1) : 0,
    pct_verified: row.total ? +(100 * row.verified_verbatim / row.total).toFixed(1) : 0,
  };
}

/**
 * Full dashboard snapshot. Each section is independent — if one query fails,
 * that section is set to null and the rest still returns.
 */
async function getDashboard() {
  const results = await Promise.allSettled([
    getCitationHealth(),
    getThumbsRatio(),
    spendLog.getSpendTotals().catch(() => null),
    spendLog.getSpendBreakdown({ days: 30 }).catch(() => []),
    getSubscriptionHealth(),
    getHallucinationProxy(),
  ]);
  const val = (i) => results[i].status === 'fulfilled' ? results[i].value : null;
  return {
    generatedAt: new Date().toISOString(),
    citationHealth: val(0),
    thumbs: val(1),
    spend: {
      totals: val(2),
      breakdown: val(3),
    },
    subscription: val(4),
    hallucination: val(5),
  };
}

module.exports = {
  getDashboard,
  getCitationHealth,
  getThumbsRatio,
  getSubscriptionHealth,
  getHallucinationProxy,
};
