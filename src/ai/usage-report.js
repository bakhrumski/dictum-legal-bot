'use strict';

/**
 * Master-only views of the usage ledger (2026-10-03).
 *
 *   GET /api/admin/ai-usage/requests          recent requests with totals
 *   GET /api/admin/ai-usage/requests/:id      every AI call of one request
 *   GET /api/admin/ai-usage/report            daily or monthly totals
 *
 * A request's total is "complete" only when every call has a known cost and
 * no ledger write failed; otherwise the known part is shown with the number
 * of calls whose cost is unknown. Averages are taken over complete requests
 * only, and say how many requests that is. No prompt, answer, document text
 * or key is stored, so none can be shown.
 */

const RETRY_OR_FALLBACK = `(COALESCE(l.attempt, 1) > 1 OR l.fallback_from IS NOT NULL OR COALESCE(l.status, 'success') <> 'success')`;

function intParam(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function dateParam(value) {
  const s = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/u.test(s) ? s : null;
}

const REQUEST_TOTALS = `
  SELECT l.request_id,
         COUNT(*)::int                                              AS calls,
         COUNT(*) FILTER (WHERE l.cost_usd IS NULL)::int            AS unknown_cost_calls,
         COALESCE(SUM(l.cost_usd), 0)::float                        AS known_cost_usd,
         COALESCE(SUM(l.provider_credits), 0)::float                AS provider_credits,
         COUNT(*) FILTER (WHERE ${RETRY_OR_FALLBACK})::int          AS retry_or_fallback_calls,
         COALESCE(SUM(l.cost_usd) FILTER (WHERE ${RETRY_OR_FALLBACK}), 0)::float AS retry_or_fallback_cost_usd,
         array_agg(COALESCE(l.model_returned, l.model_requested, l.model) ORDER BY l.seq NULLS LAST, l.started_at) AS models,
         array_agg(l.stage ORDER BY l.seq NULLS LAST, l.started_at) AS stages,
         array_agg(DISTINCT l.cost_source) AS cost_sources
    FROM llm_spend_log l
   WHERE l.request_id IS NOT NULL`;

function completeness(row) {
  const complete = row.unknown_cost_calls === 0 && (row.telemetry_errors || 0) === 0;
  return {
    complete,
    note: complete ? null
      : [row.unknown_cost_calls ? `${row.unknown_cost_calls} call(s) with unknown cost` : null,
        row.telemetry_errors ? `${row.telemetry_errors} ledger write failure(s)` : null].filter(Boolean).join('; '),
  };
}

function mountUsageReportRoutes(app, { requireMasterAdmin, pool, ledger }) {
  // Recent requests, newest first.
  app.get('/api/admin/ai-usage/requests', requireMasterAdmin, async (req, res) => {
    try {
      const limit = intParam(req.query.limit, 50, 1, 200);
      const days = intParam(req.query.days, 7, 1, 90);
      const service = req.query.service ? String(req.query.service).slice(0, 20) : null;
      const { rows } = await pool.query(`
        WITH totals AS (${REQUEST_TOTALS} AND l.ts > NOW() - ($1 || ' days')::interval GROUP BY l.request_id)
        SELECT r.request_id, r.service, r.kind, r.user_id, r.chat_id IS NOT NULL AS telegram,
               r.started_at, r.finished_at, r.latency_ms, r.outcome, r.legal_check, r.telemetry_errors,
               t.calls, t.unknown_cost_calls, t.known_cost_usd, t.provider_credits,
               t.retry_or_fallback_calls, t.retry_or_fallback_cost_usd, t.models, t.stages, t.cost_sources
          FROM ai_requests r JOIN totals t ON t.request_id = r.request_id
         WHERE ($2::text IS NULL OR r.service = $2)
         ORDER BY r.started_at DESC
         LIMIT $3`, [days, service, limit]);
      res.json({ requests: rows.map(r => ({ ...r, ...completeness(r) })) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Every call of one request, in order.
  app.get('/api/admin/ai-usage/requests/:id', requireMasterAdmin, async (req, res) => {
    try {
      const id = String(req.params.id || '');
      if (!/^[0-9a-f-]{36}$/iu.test(id)) return res.status(400).json({ error: 'request_id must be a UUID' });
      const [reqRow, calls] = await Promise.all([
        pool.query('SELECT * FROM ai_requests WHERE request_id = $1', [id]),
        pool.query(`
          SELECT call_id, seq, stage, service, provider, model_requested, model_returned, status, error_code, error_message,
                 attempt, retry_reason, fallback_from, started_at, finished_at, latency_ms,
                 in_tokens, cached_in_tokens, out_tokens, reasoning_tokens, audio_ms, characters, provider_credits,
                 cost_usd::float AS cost_usd, cost_source, pricing, endpoint
            FROM llm_spend_log WHERE request_id = $1
           ORDER BY seq NULLS LAST, started_at`, [id]),
      ]);
      if (!reqRow.rows.length && !calls.rows.length) return res.status(404).json({ error: 'not found' });
      const unknown = calls.rows.filter(c => c.cost_usd == null).length;
      const summary = {
        calls: calls.rows.length,
        known_cost_usd: calls.rows.reduce((sum, c) => sum + (c.cost_usd || 0), 0),
        unknown_cost_calls: unknown,
        provider_credits: calls.rows.reduce((sum, c) => sum + (Number(c.provider_credits) || 0), 0),
        model_sequence: calls.rows.map(c => ({ stage: c.stage, model: c.model_returned || c.model_requested, confirmed: Boolean(c.model_returned), status: c.status })),
        retry_or_fallback_calls: calls.rows.filter(c => (c.attempt || 1) > 1 || c.fallback_from || c.status !== 'success').length,
      };
      const request = reqRow.rows[0] || null;
      res.json({ request, summary: { ...summary, ...completeness({ ...summary, telemetry_errors: request ? request.telemetry_errors : 0 }) }, calls: calls.rows });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Daily or monthly totals.
  app.get('/api/admin/ai-usage/report', requireMasterAdmin, async (req, res) => {
    try {
      const period = req.query.period === 'month' ? 'month' : 'day';
      const to = dateParam(req.query.to) || new Date().toISOString().slice(0, 10);
      const from = dateParam(req.query.from) || new Date(Date.now() - (period === 'month' ? 180 : 30) * 864e5).toISOString().slice(0, 10);
      const bucket = period === 'month' ? `to_char(l.ts, 'YYYY-MM')` : `to_char(l.ts, 'YYYY-MM-DD')`;
      const range = `l.ts >= $1::date AND l.ts < ($2::date + 1)`;
      const [totals, byService, byModel, requests] = await Promise.all([
        pool.query(`
          SELECT ${bucket} AS period, COUNT(*)::int AS calls,
                 COALESCE(SUM(l.cost_usd), 0)::float AS known_cost_usd,
                 COUNT(*) FILTER (WHERE l.cost_usd IS NULL)::int AS unknown_cost_calls,
                 COUNT(*) FILTER (WHERE l.in_tokens IS NULL AND l.out_tokens IS NULL AND l.audio_ms IS NULL AND l.characters IS NULL)::int AS no_usage_calls,
                 COUNT(*) FILTER (WHERE l.pricing IS NULL)::int AS no_price_calls,
                 COUNT(*) FILTER (WHERE ${RETRY_OR_FALLBACK})::int AS retry_or_fallback_calls,
                 COALESCE(SUM(l.cost_usd) FILTER (WHERE ${RETRY_OR_FALLBACK}), 0)::float AS retry_or_fallback_cost_usd,
                 COALESCE(SUM(l.provider_credits), 0)::float AS provider_credits
            FROM llm_spend_log l WHERE ${range} GROUP BY 1 ORDER BY 1`, [from, to]),
        pool.query(`
          SELECT ${bucket} AS period, COALESCE(l.service, 'legacy') AS service, COUNT(*)::int AS calls,
                 COALESCE(SUM(l.cost_usd), 0)::float AS known_cost_usd,
                 COUNT(*) FILTER (WHERE l.cost_usd IS NULL)::int AS unknown_cost_calls
            FROM llm_spend_log l WHERE ${range} GROUP BY 1, 2 ORDER BY 1, 4 DESC`, [from, to]),
        pool.query(`
          SELECT ${bucket} AS period, COALESCE(l.model_returned, l.model_requested, l.model) AS model, COALESCE(l.provider, '?') AS provider,
                 COUNT(*)::int AS calls, COALESCE(SUM(l.cost_usd), 0)::float AS known_cost_usd,
                 COUNT(*) FILTER (WHERE l.cost_usd IS NULL)::int AS unknown_cost_calls
            FROM llm_spend_log l WHERE ${range} GROUP BY 1, 2, 3 ORDER BY 1, 5 DESC`, [from, to]),
        pool.query(`
          WITH totals AS (${REQUEST_TOTALS} AND ${range} GROUP BY l.request_id)
          SELECT to_char(r.started_at, ${period === 'month' ? `'YYYY-MM'` : `'YYYY-MM-DD'`}) AS period,
                 COUNT(*)::int AS requests,
                 COUNT(*) FILTER (WHERE t.unknown_cost_calls = 0 AND r.telemetry_errors = 0)::int AS complete_requests,
                 COALESCE(SUM(t.known_cost_usd) FILTER (WHERE t.unknown_cost_calls = 0 AND r.telemetry_errors = 0), 0)::float AS complete_cost_usd,
                 (array_agg(r.request_id ORDER BY r.started_at) FILTER (WHERE t.unknown_cost_calls = 0 AND r.telemetry_errors = 0))[1:200] AS complete_request_ids
            FROM ai_requests r JOIN totals t ON t.request_id = r.request_id
           GROUP BY 1 ORDER BY 1`, [from, to]),
      ]);
      const perRequest = new Map(requests.rows.map(r => [r.period, r]));
      const periods = totals.rows.map(t => {
        const r = perRequest.get(t.period) || { requests: 0, complete_requests: 0, complete_cost_usd: 0, complete_request_ids: [] };
        return {
          ...t,
          cost_complete: t.unknown_cost_calls === 0,
          requests: r.requests,
          average_cost_per_request_usd: r.complete_requests ? r.complete_cost_usd / r.complete_requests : null,
          average_basis: {
            included_requests: r.complete_requests,
            excluded_incomplete_requests: r.requests - r.complete_requests,
            included_request_ids: r.complete_request_ids || [],
            rule: 'only requests whose every call has a known cost and no ledger write failed',
          },
          by_service: byService.rows.filter(x => x.period === t.period),
          by_model: byModel.rows.filter(x => x.period === t.period),
        };
      });
      res.json({
        period, from, to, periods,
        ledger_health: ledger ? { rows_written_since_boot: ledger.stats.rowsWritten, write_failures_since_boot: ledger.stats.writeFailures } : null,
        note: 'known_cost_usd sums the calls whose cost is known; unknown_cost_calls are not included in it. Calls before 2026-10-03 are "legacy" rows without request ids.',
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { mountUsageReportRoutes, completeness };
