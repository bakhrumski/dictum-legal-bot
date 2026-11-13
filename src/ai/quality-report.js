'use strict';

/**
 * X4 of the 2026-11-10 audit (Q7): answer quality from what the requests already record -
 * no AI call, no text. Until now only the Telegram bot wrote what a legal answer ended as
 * (`ai_requests.legal_check`); the web chat wrote nothing, so nobody could see how often an
 * answer was thinned by the claim guard, cut short, given without lex.uz or without the reranker.
 *
 *   legalCheckOf(ragMeta)   the web chat's record: statuses and counts only
 *   summarize(rows)         shares per service over a period
 *   GET /api/admin/ai-usage/quality?days=7   (master) - the summary
 *
 * A share is "of the legal answers that recorded a check" - requests before this change, and
 * requests that are not legal answers, are not in the denominator. These are signals of where
 * the chain degrades, not a measure of legal correctness.
 */

const count = v => (Array.isArray(v) ? v.length : (Number(v) || 0));

/** What a web legal answer ended as (no text): for usageLedger.annotate({ legalCheck }). */
function legalCheckOf(ragMeta, { failed = false } = {}) {
  const m = ragMeta || {};
  const g = m.claimGuard || null, q = m.quotes || null;
  return {
    claimGuard: g ? g.status : null,
    withheld: g ? count(g.withheld) : 0,
    unchecked: g ? count(g.uncheckedClaims) : 0,
    truncated: !!(g && g.truncated),
    lexCrossCheck: m.lexCrossCheck ? m.lexCrossCheck.status : null,
    citationCheck: m.citationCheck == null ? null : (typeof m.citationCheck === 'string' ? m.citationCheck : (m.citationCheck.status || null)),
    quotesRemoved: q ? count(q.removed) : 0,
    lexLive: m.lexLive ? m.lexLive.status : null,
    chunks: Number(m.chunks) || 0,
    delivered: !failed && !(g && g.substantive === false),
  };
}

/** rows: [{ service, legal_check, degraded }] -> { days?, services: { web: {...}, telegram: {...} } } */
function summarize(rows = []) {
  const out = {};
  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
  for (const r of rows) {
    const lc = r.legal_check;
    if (!lc || typeof lc !== 'object') continue;
    const s = out[r.service] = out[r.service] || { answers: 0, withheldSome: 0, unverified: 0, unchecked: 0, truncated: 0, noSources: 0,
      lexDown: 0, lexPartial: 0, crossCheckWeak: 0, citationWeak: 0, quotesRemoved: 0, lowConfidence: 0, notDelivered: 0, degraded: {} };
    s.answers++;
    if (lc.claimGuard === 'partial' || Number(lc.withheld) > 0) s.withheldSome++;
    if (lc.claimGuard === 'unverified') s.unverified++;
    if (Number(lc.unchecked) > 0) s.unchecked++;
    if (lc.truncated === true) s.truncated++;
    if (lc.chunks === 0) s.noSources++;
    if (lc.lexLive === 'unreachable' || lc.lexLive === 'deadline') s.lexDown++;
    if (lc.lexLive === 'partial') s.lexPartial++;
    if (['error', 'insufficient'].includes(String(lc.lexCrossCheck || ''))) s.crossCheckWeak++;
    if (lc.citationCheck && lc.citationCheck !== 'ok') s.citationWeak++;
    if (Number(lc.quotesRemoved) > 0) s.quotesRemoved++;
    if (lc.confidence === 'low') s.lowConfidence++;
    if (lc.delivered === false) s.notDelivered++;
    for (const d of (Array.isArray(r.degraded) ? r.degraded : [])) s.degraded[d] = (s.degraded[d] || 0) + 1;
  }
  for (const s of Object.values(out)) {
    s.share = {};
    for (const k of ['withheldSome', 'unverified', 'unchecked', 'truncated', 'noSources', 'lexDown', 'lexPartial', 'crossCheckWeak', 'citationWeak', 'quotesRemoved', 'lowConfidence', 'notDelivered']) s.share[k] = pct(s[k], s.answers);
  }
  return out;
}

function mountQualityReport(app, { requireMasterAdmin, pool }) {
  app.get('/api/admin/ai-usage/quality', requireMasterAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
      const { rows } = await pool.query(
        `SELECT service, legal_check, degraded FROM ai_requests
          WHERE started_at > NOW() - ($1 || ' days')::interval AND legal_check IS NOT NULL
          ORDER BY started_at DESC LIMIT 50000`, [days]);
      res.json({ days, services: summarize(rows), note: 'Shares are of the legal answers that recorded a check; signals of where the chain degrades, not legal correctness.' });
    } catch (e) {
      if (e && e.code === '42P01') return res.json({ days: 0, services: {} });
      console.error('[QUALITY]', e.message);
      res.status(500).json({ error: 'failed' });
    }
  });
}

module.exports = { legalCheckOf, summarize, mountQualityReport };
