'use strict';

/**
 * Tariffs v2 (2026-10-04, docs/tariffs-v2.md): the plan catalogue and the
 * entitlement ledger every metered service goes through - web chat, document
 * analysis, legal opinions, drafts, OCR, Workspace AI and Telegram answers.
 *
 *   Sinov     free, once per person, never renewed: 5 chat, 1 analysis unit,
 *             1 opinion unit, 0 drafts
 *   Silver    199 000 so'm / 30 days: 150 chat, 8 + 8 units, 10 drafts
 *   Gold      599 000 so'm / 30 days: 3 x Silver
 *   Platinum  999 000 so'm / 30 days: 5 x Silver, can create a Workspace
 *
 * It extends what existed, it is not a second system: usage rows are the
 * same tariff_usage table (now with service, units, status, period, job key,
 * actor, payer and Workspace), and the plan columns on admins are kept in
 * sync for the code and the database policies that read them (Workspace).
 *
 * Every unit goes reserve -> commit (delivered) or release (not delivered),
 * atomically under the payer's lock and idempotently by job key, so parallel
 * Telegram, web and Workspace work draws on one personal limit and a retried
 * callback cannot charge or refund twice. Limits are per 30-day period -
 * no weekly or daily reset, no rollover.
 *
 * Subscriptions sold before v2 keep the rules they were sold with until they
 * end (rules 'legacy_v1'); those are checked by subscription-tiers.js, which
 * registers the check with setLegacyCheck().
 */

const crypto = require('crypto');
const { pool } = require('../database/db');

// ── Catalogue (the single source for prices and limits) ───────────────────
const SERVICES = Object.freeze(['chat', 'analysis', 'opinion', 'draft', 'ocr']);
const SILVER_QUOTAS = Object.freeze({ chat: 150, analysis: 8, opinion: 8, draft: 10 });
const MULTIPLIER = Object.freeze({ silver: 1, gold: 3, platinum: 5 });

// OCR (reading a scan or photo) is measured on its own and is not unlimited:
// until its cost is measured, a period allows 10 pages per analysis unit
// (one analysis unit is up to 10 pages). See docs/tariffs-v2.md.
const OCR_PAGES_PER_ANALYSIS_UNIT = 10;

function paidQuotas(plan) {
  const m = MULTIPLIER[plan];
  const q = {};
  for (const [k, v] of Object.entries(SILVER_QUOTAS)) q[k] = v * m;
  q.ocr = q.analysis * OCR_PAGES_PER_ANALYSIS_UNIT;
  return Object.freeze(q);
}

const PLAN_CATALOG = Object.freeze({
  sinov: Object.freeze({
    label: 'Sinov', priceUzs: 0, periodDays: null, oneTime: true,
    quotas: Object.freeze({ chat: 5, analysis: 1, opinion: 1, draft: 0, ocr: 1 * OCR_PAGES_PER_ANALYSIS_UNIT }),
    workspace: Object.freeze({ create: false, join: false }),
    // a Sinov document is at most one unit; a larger one is refused, never cut
    job: Object.freeze({ maxUnits: 1, maxPages: 10, maxChars: 40000 }),
  }),
  silver: Object.freeze({
    label: 'Silver', priceUzs: 199000, periodDays: 30, oneTime: false,
    quotas: paidQuotas('silver'),
    workspace: Object.freeze({ create: false, join: true }),
    job: Object.freeze({ maxUnits: 3, maxPages: 30, maxChars: 120000 }),
  }),
  gold: Object.freeze({
    label: 'Gold', priceUzs: 599000, periodDays: 30, oneTime: false,
    quotas: paidQuotas('gold'),
    workspace: Object.freeze({ create: false, join: true }),
    job: Object.freeze({ maxUnits: 3, maxPages: 30, maxChars: 120000 }),
  }),
  platinum: Object.freeze({
    label: 'Platinum', priceUzs: 999000, periodDays: 30, oneTime: false,
    quotas: paidQuotas('platinum'),
    workspace: Object.freeze({ create: true, join: true }),
    job: Object.freeze({ maxUnits: 3, maxPages: 30, maxChars: 120000 }),
  }),
});
const PAID_PLAN_ORDER = Object.freeze(['silver', 'gold', 'platinum']);

// ── Service units ─────────────────────────────────────────────────────────
// One analysis or opinion unit: at most 10 pages AND at most 40 000
// characters. Pages are the PDF's own page count; for DOCX and plain text a
// standard page is 4 000 characters, so a smaller font cannot shrink the bill.
const DOC_UNIT = Object.freeze({ pages: 10, chars: 40000 });
const STANDARD_PAGE_CHARS = DOC_UNIT.chars / DOC_UNIT.pages; // 4 000
// One draft: up to 5 standard pages / 20 000 characters of output.
const DRAFT_UNIT = Object.freeze({ pages: 5, chars: 20000 });

/**
 * Units a document costs: max(ceil(pages / 10), ceil(chars / 40 000)).
 * pages may be unknown (text pasted, DOCX): then the standard paging of the
 * characters is used. Empty input is 0 units (nothing to charge).
 */
function docUnits({ pages = null, chars = 0 } = {}) {
  const c = Math.max(0, Number(chars) || 0);
  const standardPages = Math.ceil(c / STANDARD_PAGE_CHARS);
  const p = Number.isFinite(Number(pages)) && Number(pages) > 0 ? Math.ceil(Number(pages)) : standardPages;
  if (!c && !(Number(pages) > 0)) return { units: 0, pages: 0, chars: 0, standardPages: 0 };
  const units = Math.max(Math.ceil(p / DOC_UNIT.pages), Math.ceil(c / DOC_UNIT.chars), 1);
  return { units, pages: p, chars: c, standardPages };
}

/** Units a draft costs by its output size: 1 up to 20 000 chars, then per 20 000. */
function draftUnits({ chars = 0 } = {}) {
  return Math.max(1, Math.ceil(Math.max(0, Number(chars) || 0) / DRAFT_UNIT.chars));
}

/**
 * Whether one job of this size can run on the plan at all, before quota:
 * a Sinov document is at most 1 unit; a paid job at most 30 pages / 120 000
 * characters (initial cap, to be confirmed by benchmark). Too large is a
 * clear refusal, never a silent cut.
 */
function jobFits(plan, size) {
  const cfg = PLAN_CATALOG[plan];
  if (!cfg) return { ok: true };
  const u = docUnits(size);
  if (u.units === 0) return { ok: false, reason: 'empty_document', ...u };
  if (u.pages > cfg.job.maxPages || u.chars > cfg.job.maxChars || u.units > cfg.job.maxUnits) {
    return { ok: false, reason: 'document_too_large', maxPages: cfg.job.maxPages, maxChars: cfg.job.maxChars, maxUnits: cfg.job.maxUnits, ...u };
  }
  return { ok: true, ...u };
}

// ── Document tickets ──────────────────────────────────────────────────────
// The page count of a PDF is read on the server when the file is extracted
// (/api/analyze/extract); the client then sends the text back for analysis.
// A signed ticket carries that page count with the text's hash, so the
// client cannot send a smaller page count - without a valid ticket the
// standard paging of the characters is used.
function ticketSecret() {
  return process.env.DOC_TICKET_SECRET || process.env.SESSION_SECRET || process.env.JWT_SECRET || 'juristai-dev-doc-ticket';
}
function textHash(text = '') {
  return crypto.createHash('sha256').update(String(text || '').trim()).digest('hex');
}
function signDocTicket({ text = '', pages = null, scanned = false } = {}) {
  const body = { h: textHash(text), p: Number(pages) > 0 ? Math.ceil(Number(pages)) : null, s: scanned ? 1 : 0, t: Date.now() };
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', ticketSecret()).update(payload).digest('base64url').slice(0, 32);
  return `${payload}.${sig}`;
}
// ── Scan tickets (2026-10-06) ─────────────────────────────────────────────
// Before a paid OCR the server counts a scan's pages itself and quotes the
// service; the signed ticket binds that quote to the file (SHA-256 of its
// bytes), the account, the service, the size and a short expiry. The OCR
// call must bring the same file from the same account for the same service
// within the expiry - another file, account or service is refused.
const SCAN_TICKET_MIN = 15;
function signScanTicket({ fileHash, adminId, service, pages, bytes, kind, units, cached = false, now = Date.now() } = {}) {
  const body = { k: 'scan', h: fileHash, a: Number(adminId), s: service, p: pages, b: bytes, f: kind, u: units, c: cached ? 1 : 0, e: now + SCAN_TICKET_MIN * 60e3 };
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', ticketSecret()).update(`scan.${payload}`).digest('base64url');
  return `${payload}.${sig}`;
}
/** The ticket's quote if it is genuine, unexpired and for this account, else { error }. */
function readScanTicket(ticket, { adminId, now = Date.now() } = {}) {
  if (!ticket || typeof ticket !== 'string' || !ticket.includes('.')) return { error: 'scan_ticket_missing' };
  const [payload, sig] = ticket.split('.');
  const want = crypto.createHmac('sha256', ticketSecret()).update(`scan.${payload}`).digest('base64url');
  if (!sig || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return { error: 'scan_ticket_invalid' };
  let body;
  try { body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch (_) { return { error: 'scan_ticket_invalid' }; }
  if (body.k !== 'scan') return { error: 'scan_ticket_invalid' };
  if (now > Number(body.e)) return { error: 'scan_ticket_expired' };
  if (Number(body.a) !== Number(adminId)) return { error: 'scan_ticket_other_account' };
  return { fileHash: body.h, adminId: body.a, service: body.s, pages: body.p, bytes: body.b, kind: body.f, units: body.u, cached: !!body.c, expiresAt: body.e };
}

/** Pages from a valid ticket for exactly this text, else null. Tickets last 24 h. */
function readDocTicket(ticket, text) {
  if (!ticket || typeof ticket !== 'string' || !ticket.includes('.')) return null;
  const [payload, sig] = ticket.split('.');
  const want = crypto.createHmac('sha256', ticketSecret()).update(payload).digest('base64url').slice(0, 32);
  if (!sig || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (body.h !== textHash(text) || Date.now() - body.t > 24 * 3600e3) return null;
    return { pages: body.p, scanned: !!body.s };
  } catch (_) { return null; }
}

// ── Planning economics (initial budgets, NOT provider prices) ─────────────
// Owner's planning figures (2026-10-04). They are unit budgets to size the
// plans, not measured costs and not a billing guarantee; the measured cost
// per service comes from the usage ledger (llm_spend_log).
const PLANNING = Object.freeze({
  uzsPerUsd: 12000,
  unitUsd: Object.freeze({ chat: 0.025, analysis: 0.30, opinion: 0.30, draft: 0.06 }),
  opsUzs: Object.freeze({ silver: 10200, gold: 30600, platinum: 51000 }),
  costCeilingShare: 0.80,
});

/**
 * OCR pages a period can use at 100% (2026-10-06): every analysis and every
 * opinion unit on a different scanned document (10 pages a unit - the
 * analysis and the opinion of one scan share one OCR, so this is the worst
 * case), plus the chat-scan page pool. OCR is a step of those services, not
 * a service sold on its own.
 */
function maxOcrPages(plan) {
  const q = (PLAN_CATALOG[plan] || {}).quotas || {};
  return ((q.analysis || 0) + (q.opinion || 0)) * OCR_PAGES_PER_ANALYSIS_UNIT + (q.ocr || 0);
}

/** OCR cost of a plan at 100% use: { pages, usd, status, basis } - unknown stays unknown, never 0. */
function planOcr(plan) {
  const pages = maxOcrPages(plan);
  const basis = require('../ocr/scan-limits').ocrCostBasis();
  if (basis.status !== 'estimated') return { pages, usd: null, status: 'unknown', reason: basis.reason };
  return { pages, usd: pages * basis.usdPerPage, usdPerPage: basis.usdPerPage, status: 'estimated', estimate: basis.estimate };
}

/** AI budget (OCR included), operations allotment, service margin and the 80% ceiling of a plan at 100% use. */
function planEconomics(plan, planning = PLANNING) {
  const cfg = PLAN_CATALOG[plan];
  if (!cfg) return null;
  const textAiUsd = Object.entries(planning.unitUsd).reduce((s, [k, usd]) => s + (cfg.quotas[k] || 0) * usd, 0);
  const ocr = planOcr(plan);
  const aiUsd = textAiUsd + (ocr.usd || 0);
  const aiUzs = Math.round(aiUsd * planning.uzsPerUsd);
  const opsUzs = planning.opsUzs[plan] || 0;
  const serviceUzs = aiUzs + opsUzs;
  return {
    plan, priceUzs: cfg.priceUzs, aiUsd: Number(aiUsd.toFixed(4)), aiUzs, opsUzs, serviceUzs,
    textAiUsd: Number(textAiUsd.toFixed(4)), ocr, costComplete: ocr.status !== 'unknown',
    leftUzs: cfg.priceUzs - serviceUzs,
    serviceMargin: cfg.priceUzs ? Number(((cfg.priceUzs - serviceUzs) / cfg.priceUzs).toFixed(4)) : null,
    ceilingUzs: Math.round(cfg.priceUzs * planning.costCeilingShare),
    withinCeiling: serviceUzs <= cfg.priceUzs * planning.costCeilingShare,
    basis: 'planning budgets, not measured cost',
  };
}

// ── Subjects and locks ────────────────────────────────────────────────────
function subjectsFor({ adminId = null, telegramUserId = null } = {}) {
  const out = [];
  if (adminId != null && /^\d+$/u.test(String(adminId))) out.push(`a:${adminId}`);
  if (telegramUserId != null && /^\d+$/u.test(String(telegramUserId))) out.push(`t:${telegramUserId}`);
  return out;
}

/** Lock key: the same one subscription-tiers' withUserLock uses for an account. */
function lockKey({ adminId = null, telegramUserId = null } = {}) {
  return adminId != null ? `juristai:tariff:${adminId}` : `juristai:tariff:t${telegramUserId}`;
}

async function withLock(identity, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey(identity)]);
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

// A reservation not committed or released within this time was abandoned
// (the process stopped): it no longer counts against the limit. The
// provider cost of that work stays in the AI usage ledger regardless.
const RESERVATION_TTL_MIN = Math.max(5, Math.min(120, Number(process.env.TARIFF_RESERVATION_TTL_MIN) || 30));
// A scan job's service reservation is held until the service runs (it is
// made before the paid OCR, the analysis or opinion comes a few minutes
// later): meta.holdUntil keeps it live; past it, it no longer counts and is
// marked released ('scan_hold_expired') on the person's next reservation.
const SCAN_HOLD_MIN = 120;
const LIVE_USAGE_SQL = `(u.status IS NULL OR u.status = 'committed' OR (u.status = 'reserved' AND (u.ts > now() - interval '${RESERVATION_TTL_MIN} minutes' OR (u.meta ? 'holdUntil' AND (u.meta->>'holdUntil')::timestamptz > now()))))`;

let legacyCheck = null;
/** subscription-tiers registers how a legacy_v1 period is checked. */
function setLegacyCheck(fn) { legacyCheck = fn; }

// ── Entitlement ───────────────────────────────────────────────────────────
async function accountRow(db, adminId) {
  if (adminId == null) return null;
  const r = await db.query(
    `SELECT id, role, tariff_plan, tariff_starts_at, tariff_expires_at, telegram_user_id
       FROM admins WHERE id = $1`, [adminId]);
  return r.rows[0] || null;
}

/**
 * A paid plan written straight into admins (a master's manual grant before
 * v2, or a script) with no period row gets one, with the legacy rules it was
 * given under. Idempotent by payment_ref.
 */
async function adoptUnrecordedPlan(db, account, now) {
  if (!account || account.role !== 'user') return;
  if (!PAID_PLAN_ORDER.includes(account.tariff_plan) || !account.tariff_expires_at) return;
  if (new Date(account.tariff_expires_at) <= now) return;
  const ref = `migration:legacy_v1:${account.id}:${new Date(account.tariff_expires_at).toISOString().replace(/\D/gu, '').slice(0, 14)}`;
  await db.query(
    `INSERT INTO tariff_periods (subject, admin_id, plan, rules, source, starts_at, ends_at, limits, payment_ref, provider, list_price_uzs)
     SELECT $1, $2, $3, 'legacy_v1', 'migration', $4, $5, '{}'::jsonb, $6, 'migration', $8
      WHERE NOT EXISTS (
        SELECT 1 FROM tariff_periods
         WHERE subject = $1 AND source NOT IN ('trial', 'test') AND status = 'active' AND starts_at <= $7 AND ends_at > $7)
     ON CONFLICT DO NOTHING`,
    [`a:${account.id}`, account.id, account.tariff_plan,
      account.tariff_starts_at || new Date(new Date(account.tariff_expires_at).getTime() - 30 * 86400000),
      account.tariff_expires_at, ref, now, LEGACY_LIST_PRICE_UZS[account.tariff_plan] || null]);
}

// v1 list prices, kept only as a reference for legacy grants whose payment
// was never recorded (their revenue is reported as unknown, not as these)
const LEGACY_LIST_PRICE_UZS = Object.freeze({ silver: 199000, gold: 399000, platinum: 999000 });

/**
 * What this person is entitled to now:
 *   { kind: 'staff' }                         lawyer / student / master: not metered
 *   { kind: 'paid', period, plan, rules }     a paid (or legacy) period covers now
 *   { kind: 'trial', periods, plan: 'sinov' } the one-time Sinov (created on first use)
 *   { kind: 'none' }                          nothing: choose a plan
 * Linked Telegram and web accounts share the Sinov.
 */
async function resolveEntitlement(db, identity = {}, { now = new Date(), createTrial = true } = {}) {
  const account = await accountRow(db, identity.adminId);
  if (identity.adminId != null && !account) return { kind: 'none', reason: 'unknown_user' };
  if (account && account.role !== 'user') return { kind: 'staff', role: account.role };
  const telegramUserId = identity.telegramUserId != null ? identity.telegramUserId
    : (account && account.telegram_user_id != null ? String(account.telegram_user_id) : null);
  const subjects = subjectsFor({ adminId: identity.adminId, telegramUserId });
  if (!subjects.length) return { kind: 'none', reason: 'no_identity' };

  if (account) await adoptUnrecordedPlan(db, account, now);
  if (identity.adminId != null) {
    // a master's test entitlement (pilot) covering now: its own quotas, no
    // sale; it never touches admins.tariff_* or the Sinov
    const test = await db.query(
      `SELECT * FROM tariff_periods
        WHERE subject = $1 AND source = 'test' AND status = 'active' AND starts_at <= $2 AND ends_at > $2
        ORDER BY id DESC LIMIT 1`, [`a:${identity.adminId}`, now]);
    if (test.rows[0]) return { kind: 'test', period: test.rows[0], plan: test.rows[0].plan, rules: 'v2', subjects, account };
    const paid = await db.query(
      `SELECT * FROM tariff_periods
        WHERE subject = $1 AND source NOT IN ('trial', 'test') AND status = 'active' AND starts_at <= $2 AND ends_at > $2
        ORDER BY starts_at DESC, id DESC LIMIT 1`, [`a:${identity.adminId}`, now]);
    if (paid.rows[0]) {
      // keep admins.tariff_* (read by the Workspace policies) on the period
      // covering now - a queued renewal or downgrade takes over here
      if (account && (account.tariff_plan !== paid.rows[0].plan || !account.tariff_expires_at
        || new Date(account.tariff_expires_at) < new Date(paid.rows[0].ends_at))) {
        await syncAccountPlan(db, identity.adminId, now);
      }
      return { kind: 'paid', period: paid.rows[0], plan: paid.rows[0].plan, rules: paid.rows[0].rules, subjects, account };
    }
  }

  let trials = await db.query(
    `SELECT * FROM tariff_periods WHERE subject = ANY($1) AND source = 'trial' ORDER BY id`, [subjects]);
  if (!trials.rows.length && createTrial) {
    const cfg = PLAN_CATALOG.sinov;
    await db.query(
      `INSERT INTO tariff_periods (subject, admin_id, plan, rules, source, starts_at, limits, price_uzs)
       VALUES ($1, $2, 'sinov', 'v2', 'trial', $3, $4, 0)
       ON CONFLICT DO NOTHING`,
      [subjects[0], identity.adminId != null ? identity.adminId : null, now, JSON.stringify(cfg.quotas)]);
    trials = await db.query(
      `SELECT * FROM tariff_periods WHERE subject = ANY($1) AND source = 'trial' ORDER BY id`, [subjects]);
  }
  if (trials.rows.length) return { kind: 'trial', periods: trials.rows, plan: 'sinov', rules: 'v2', subjects, account };
  return { kind: 'none', reason: 'no_plan', subjects, account };
}

function limitsOf(ent) {
  if (ent.kind === 'test') return ent.period.limits || {};
  if (ent.kind === 'paid') {
    const l = ent.period.limits && Object.keys(ent.period.limits).length ? ent.period.limits : (PLAN_CATALOG[ent.plan] || {}).quotas;
    return l || {};
  }
  if (ent.kind === 'trial') return ent.periods[0].limits && Object.keys(ent.periods[0].limits).length ? ent.periods[0].limits : PLAN_CATALOG.sinov.quotas;
  return {};
}

function periodIdsOf(ent) {
  if (ent.kind === 'paid' || ent.kind === 'test') return [ent.period.id];
  if (ent.kind === 'trial') return ent.periods.map(p => p.id);
  return [];
}

async function usedUnits(db, periodIds, service) {
  if (!periodIds.length) return 0;
  const r = await db.query(
    `SELECT COALESCE(SUM(COALESCE(u.credits, 1)), 0)::int AS n
       FROM tariff_usage u
      WHERE u.period_id = ANY($1) AND u.service = $2 AND ${LIVE_USAGE_SQL}`,
    [periodIds, service]);
  return r.rows[0].n;
}

/** Per-service limit, used and remaining for this person, read-only. */
async function balance(identity, { db = pool, now = new Date() } = {}) {
  const ent = await resolveEntitlement(db, identity, { now, createTrial: false });
  if (ent.kind === 'staff') return { kind: 'staff', unlimited: true };
  if (ent.kind === 'none') {
    // a person who never used the Sinov still has it: show it as available
    return { kind: 'none', reason: ent.reason, trialAvailable: ent.reason === 'no_plan', trialQuotas: PLAN_CATALOG.sinov.quotas };
  }
  if (ent.kind === 'paid' && ent.rules === 'legacy_v1') {
    return { kind: 'paid', plan: ent.plan, rules: 'legacy_v1', startsAt: ent.period.starts_at, endsAt: ent.period.ends_at, legacy: true };
  }
  const limits = limitsOf(ent);
  const ids = periodIdsOf(ent);
  const services = {};
  for (const s of SERVICES) {
    const limit = Number(limits[s] || 0);
    const used = await usedUnits(db, ids, s);
    services[s] = { limit, used, remaining: Math.max(0, limit - used) };
  }
  return {
    kind: ent.kind, plan: ent.plan, rules: 'v2',
    startsAt: ent.period ? ent.period.starts_at : ent.periods[0].starts_at,
    endsAt: ent.period ? ent.period.ends_at : null,
    test: ent.kind === 'test' || undefined,
    services,
  };
}

/**
 * Reserve `units` of `service` for one job. Atomic under the payer's lock;
 * idempotent by jobKey (a repeated call returns the first result).
 * Returns { allowed, jobKey, plan, kind, limit, used, remaining, reason? }.
 * The payer is always the identity given here - the server-side session or
 * the Telegram sender - never an id the client sent.
 */
async function reserve({
  adminId = null, telegramUserId = null, service, units = 1, jobKey = null, endpoint = null,
  actorId = null, workspaceId = null, channel = 'web', meta = null, oneAtATime = false, now = new Date(),
  requestId = undefined,
}) {
  // the AI usage request this job runs under (its model calls' cost)
  if (requestId === undefined) {
    try { const st = require('../ai/usage-ledger').current(); requestId = st ? st.requestId : null; } catch (_) { requestId = null; }
  }
  if (!SERVICES.includes(service)) throw new Error(`unknown service: ${service}`);
  const n = Math.max(1, Math.ceil(Number(units) || 1));
  const key = jobKey || crypto.randomUUID();
  const identity = { adminId, telegramUserId };
  return withLock(identity, async (db) => {
    const existing = await db.query('SELECT * FROM tariff_usage WHERE job_key = $1', [key]);
    if (existing.rows[0]) {
      const row = existing.rows[0];
      return { allowed: row.status !== 'released', jobKey: key, duplicate: true, status: row.status, units: row.credits };
    }
    const ent = await resolveEntitlement(db, identity, { now });
    if (ent.kind === 'staff') return { allowed: true, kind: 'staff', unlimited: true, jobKey: null };
    if (ent.kind === 'none') return { allowed: false, kind: 'none', reason: ent.reason || 'no_plan', jobKey: key };

    const subject = ent.subjects[0];
    await releaseExpiredScanHolds(db, ent.subjects);
    if (oneAtATime) {
      // one answer at a time per person (Telegram): a live reservation blocks
      const busy = await db.query(
        `SELECT 1 FROM tariff_usage u WHERE u.subject = ANY($1) AND u.service = $2 AND u.status = 'reserved'
            AND u.channel = $3 AND ${LIVE_USAGE_SQL} LIMIT 1`, [ent.subjects, service, channel]);
      if (busy.rows.length) return { allowed: false, pending: true, kind: ent.kind, plan: ent.plan, jobKey: key };
    }

    let check;
    if (ent.rules === 'legacy_v1') {
      if (typeof legacyCheck !== 'function') throw new Error('legacy tariff check not registered');
      check = await legacyCheck(db, { adminId, plan: ent.plan, service, units: n, period: ent.period });
    } else {
      const limit = Number(limitsOf(ent)[service] || 0);
      const used = await usedUnits(db, periodIdsOf(ent), service);
      check = { allowed: used + n <= limit, limit, used, remaining: Math.max(0, limit - used), reason: limit === 0 ? 'not_in_plan' : 'limit_reached' };
    }
    const periodId = ent.period ? ent.period.id : ent.periods[0].id;
    const base = { kind: ent.kind, plan: ent.plan, rules: ent.rules, periodId,
      endsAt: ent.period ? ent.period.ends_at : null, units: n, ...check };
    if (!check.allowed) return { ...base, allowed: false, jobKey: key };

    await db.query(
      `INSERT INTO tariff_usage
         (admin_id, endpoint, credits, service, status, period_id, subject, job_key, actor_id, workspace_id, channel, meta, ts, request_id)
       VALUES ($1, $2, $3, $4, 'reserved', $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [adminId, endpoint ? String(endpoint).slice(0, 50) : null, n, service, periodId, subject, key,
        actorId != null ? actorId : adminId, workspaceId, channel, meta ? JSON.stringify(meta) : null, now, requestId || null]);
    return { ...base, allowed: true, jobKey: key,
      remaining: Math.max(0, (check.remaining == null ? 0 : check.remaining) - n),
      used: (check.used || 0) + n };
  });
}

/**
 * Reserve several jobs at once - all or none (a chat request that orders
 * both an analysis and an opinion of its document). One lock, one
 * transaction: every job is checked against its own service quota first;
 * if any of them does not fit, nothing is reserved and nothing may start.
 * jobs: [{ service, units, endpoint, meta }]. Returns
 *   { allowed: true, kind, plan, jobs: [{ service, units, jobKey, remaining }] }
 *   { allowed: false, failed: <service>, ...that job's check }
 */
async function reserveMany({
  adminId = null, telegramUserId = null, jobs = [], actorId = null, workspaceId = null, channel = 'web', now = new Date(), requestId = undefined,
}) {
  if (requestId === undefined) {
    try { const st = require('../ai/usage-ledger').current(); requestId = st ? st.requestId : null; } catch (_) { requestId = null; }
  }
  const list = jobs.map(j => {
    if (!SERVICES.includes(j.service)) throw new Error(`unknown service: ${j.service}`);
    return { ...j, units: Math.max(1, Math.ceil(Number(j.units) || 1)), jobKey: j.jobKey || crypto.randomUUID() };
  });
  if (!list.length) throw new Error('no jobs');
  const identity = { adminId, telegramUserId };
  return withLock(identity, async (db) => {
    const ent = await resolveEntitlement(db, identity, { now });
    if (ent.kind === 'staff') return { allowed: true, kind: 'staff', unlimited: true, jobs: list.map(j => ({ service: j.service, units: j.units, jobKey: null })) };
    if (ent.kind === 'none') return { allowed: false, kind: 'none', reason: ent.reason || 'no_plan', failed: list[0].service };
    const periodId = ent.period ? ent.period.id : ent.periods[0].id;
    await releaseExpiredScanHolds(db, ent.subjects);
    const taken = {};
    const checks = [];
    for (const j of list) {
      let check;
      if (ent.rules === 'legacy_v1') {
        if (typeof legacyCheck !== 'function') throw new Error('legacy tariff check not registered');
        check = await legacyCheck(db, { adminId, plan: ent.plan, service: j.service, units: j.units + (taken[j.service] || 0), period: ent.period });
      } else {
        const limit = Number(limitsOf(ent)[j.service] || 0);
        const used = (await usedUnits(db, periodIdsOf(ent), j.service)) + (taken[j.service] || 0);
        check = { allowed: used + j.units <= limit, limit, used, remaining: Math.max(0, limit - used), reason: limit === 0 ? 'not_in_plan' : 'limit_reached' };
      }
      if (!check.allowed) {
        return { kind: ent.kind, plan: ent.plan, rules: ent.rules, periodId, endsAt: ent.period ? ent.period.ends_at : null,
          units: j.units, ...check, allowed: false, failed: j.service };
      }
      taken[j.service] = (taken[j.service] || 0) + j.units;
      checks.push({ j, check });
    }
    const out = [];
    for (const { j, check } of checks) {
      await db.query(
        `INSERT INTO tariff_usage
           (admin_id, endpoint, credits, service, status, period_id, subject, job_key, actor_id, workspace_id, channel, meta, ts, request_id)
         VALUES ($1, $2, $3, $4, 'reserved', $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [adminId, j.endpoint ? String(j.endpoint).slice(0, 50) : null, j.units, j.service, periodId, ent.subjects[0], j.jobKey,
          actorId != null ? actorId : adminId, workspaceId, channel, j.meta ? JSON.stringify(j.meta) : null, now, requestId || null]);
      out.push({ service: j.service, units: j.units, jobKey: j.jobKey, remaining: check.remaining == null ? null : Math.max(0, check.remaining - j.units) });
    }
    return { allowed: true, kind: ent.kind, plan: ent.plan, rules: ent.rules, periodId, jobs: out };
  });
}

/** Held scan reservations past their hold are given back (they stopped counting already). */
async function releaseExpiredScanHolds(db, subjects) {
  await db.query(
    `UPDATE tariff_usage SET status = 'released', finalized_at = now(), release_reason = 'scan_hold_expired'
      WHERE subject = ANY($1) AND status = 'reserved' AND meta ? 'holdUntil'
        AND (meta->>'holdUntil')::timestamptz <= now() AND ts <= now() - interval '${RESERVATION_TTL_MIN} minutes'`, [subjects]);
}

/**
 * The held reservation a scan job made for `service` (before its OCR), if it
 * is still live and belongs to this account; the service then commits it
 * instead of reserving again.
 */
async function heldScanJob({ adminId, fileHash, service, db = pool }) {
  const r = await db.query(
    `SELECT u.job_key, u.credits AS units FROM tariff_usage u
      WHERE u.admin_id = $1 AND u.service = $2 AND u.status = 'reserved' AND u.meta->>'scanHash' = $3
        AND ${LIVE_USAGE_SQL}
      ORDER BY u.id DESC LIMIT 1`, [adminId, service, String(fileHash)]);
  return r.rows[0] || null;
}

/** The job was delivered: the reserved units are spent. Idempotent. */
async function commit(jobKey, { db = pool, meta = null } = {}) {
  if (!jobKey) return false;
  const r = await db.query(
    `UPDATE tariff_usage SET status = 'committed', finalized_at = now(),
            meta = COALESCE(meta, '{}'::jsonb) || COALESCE($2::jsonb, '{}'::jsonb)
      WHERE job_key = $1 AND status = 'reserved' RETURNING id`, [jobKey, meta ? JSON.stringify(meta) : null]);
  return r.rowCount > 0;
}

/**
 * The job was not delivered: the units go back. Idempotent; a committed
 * job is never released (the service was delivered). The AI cost already
 * incurred stays in the usage ledger - it is not erased with the quota.
 */
async function release(jobKey, reason = 'failed', { db = pool } = {}) {
  if (!jobKey) return false;
  const r = await db.query(
    `UPDATE tariff_usage SET status = 'released', finalized_at = now(), release_reason = $2
      WHERE job_key = $1 AND status = 'reserved' RETURNING id`, [jobKey, String(reason || 'failed').slice(0, 60)]);
  return r.rowCount > 0;
}

// ── Paid periods ──────────────────────────────────────────────────────────
/**
 * What a period was sold for: the cash received plus any value carried in
 * from a superseded period. A legacy grant made before payments were
 * recorded has no recorded price: its v1 list price is used as its value,
 * marked unknown (never the new catalogue price).
 */
function periodValue(p) {
  if (p.price_uzs != null) return { uzs: Number(p.price_uzs) + Number(p.credit_uzs || 0), known: true };
  return { uzs: Number(p.list_price_uzs || 0), known: false };
}

/** Unused share of one period's value at `now` (a queued period is wholly unused), in so'm. */
function unusedValue(p, now) {
  const start = new Date(p.starts_at).getTime();
  const end = new Date(p.ends_at).getTime();
  const total = end - start;
  if (total <= 0) return 0;
  const left = Math.max(0, Math.min(total, end - Math.max(start, now.getTime())));
  return Math.floor(periodValue(p).uzs * left / total);
}

/**
 * Credit for an upgrade: the unused value of every period it supersedes -
 * the running one and any renewal already paid and queued - floored to
 * 1 000 so'm. It is value carried over, not new cash.
 */
function upgradeCredit(periods, now) {
  const list = Array.isArray(periods) ? periods : [periods];
  const sum = list.reduce((t, p) => t + unusedValue(p, now), 0);
  return Math.floor(sum / 1000) * 1000;
}

/**
 * Which superseded period gives how much of an upgrade's credit: in order
 * (the running one first, then queued renewals), each at most its unused
 * value, summing to exactly `credit`. Recorded as carried_out_uzs on each,
 * so the value is service revenue of one period only - never of both.
 */
function allocateCredit(periods, now, credit) {
  let left = Math.max(0, Number(credit) || 0);
  return [...periods].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)).map(p => {
    const uzs = Math.min(unusedValue(p, now), left);
    left -= uzs;
    return { periodId: Number(p.id), uzs, known: periodValue(p).known };
  }).filter(x => x.uzs > 0);
}

async function supersedable(db, adminId, now) {
  const r = await db.query(
    `SELECT * FROM tariff_periods
      WHERE subject = $1 AND source NOT IN ('trial', 'test') AND status = 'active' AND ends_at > $2
      ORDER BY starts_at`, [`a:${adminId}`, now]);
  return r.rows;
}

/**
 * Grant a paid 30-day period for a confirmed payment (a master's grant
 * until a payment provider is connected; a provider callback later - the
 * same function). Idempotent by paymentRef: a repeated callback returns the
 * same period.
 *   renewal (same plan, one is running)  -> starts when the running one ends
 *   upgrade (higher plan)                 -> starts now; the running period
 *                                            is superseded and its unused
 *                                            days are credited (credit_uzs,
 *                                            not new cash)
 *   downgrade (lower plan)                -> starts when the running one ends
 * offerId: an individual discount offer (tariff_offers) for exactly this
 * user and plan, active and not expired; redeemed once, here. The price is
 * the offer's (or the catalogue's) - never one sent by a client; amountUzs,
 * when given, must equal the cash due or the grant is refused. A discount
 * never carries to the next renewal: a period without an offer is at the
 * catalogue price. The full quota of the plan is granted either way.
 * No rollover: each period has its own limits.
 */
async function grantPaidPeriod(args) {
  const out = await grantPaidPeriodLocked(args);
  if (out && out.refused) throw new Error(out.refused);
  return out;
}

async function grantPaidPeriodLocked({ adminId, plan, paymentRef, provider = 'manual', amountUzs = null, createdBy = null, source = 'payment', offerId = null, now = new Date() }) {
  if (!PAID_PLAN_ORDER.includes(plan)) throw new Error(`not a paid plan: ${plan}`);
  if (!paymentRef) throw new Error('paymentRef is required');
  const cfg = PLAN_CATALOG[plan];
  return withLock({ adminId }, async (db) => {
    const dup = await db.query('SELECT * FROM tariff_periods WHERE payment_ref = $1', [paymentRef]);
    if (dup.rows[0]) {
      if (Number(dup.rows[0].admin_id) !== Number(adminId)) throw new Error('payment_ref_used_for_another_user');
      return { period: dup.rows[0], duplicate: true };
    }
    const account = await accountRow(db, adminId);
    if (!account) throw new Error('unknown account');
    if (account.role !== 'user') throw new Error('staff accounts are not on tariffs');

    let offer = null;
    if (offerId && String(process.env.TARIFF_OFFERS || '').toLowerCase() === 'off') throw new Error('offers_disabled');
    if (offerId) {
      const o = await db.query('SELECT * FROM tariff_offers WHERE id = $1 FOR UPDATE', [offerId]);
      offer = o.rows[0] || null;
      if (!offer) throw new Error('offer_not_found');
      if (Number(offer.user_id) !== Number(adminId)) throw new Error('offer_for_another_user');
      if (offer.plan !== plan) throw new Error('offer_for_another_plan');
      if (offer.status === 'active' && new Date(offer.expires_at) <= now) {
        // recorded, then refused after the transaction commits (a throw here
        // would roll the status back)
        await db.query(`UPDATE tariff_offers SET status = 'expired' WHERE id = $1 AND status = 'active'`, [offer.id]);
        return { refused: 'offer_expired' };
      }
      if (offer.status !== 'active') throw new Error(`offer_${offer.status}`);
      // an offer quoted with no payment fee (no provider) is not taken
      // through a provider, or under a changed fee or cost model, until a
      // master quotes it again
      const blocked = require('./tariff-pricing').offerBlockedReason(offer, { provider });
      if (blocked) throw new Error(blocked);
    }

    await adoptUnrecordedPlan(db, account, now);
    const running = await db.query(
      `SELECT * FROM tariff_periods
        WHERE subject = $1 AND source NOT IN ('trial', 'test') AND status = 'active' AND ends_at > $2
        ORDER BY ends_at DESC LIMIT 1`, [`a:${adminId}`, now]);
    const last = running.rows[0] || null;
    let startsAt = now;
    let change = 'new';
    if (last) {
      const lastRank = PAID_PLAN_ORDER.indexOf(last.plan);
      const rank = PAID_PLAN_ORDER.indexOf(plan);
      if (rank > lastRank) change = 'upgrade';
      else { change = rank === lastRank ? 'renewal' : 'downgrade'; startsAt = new Date(last.ends_at); }
    }
    const listPrice = offer ? Number(offer.list_price_uzs) : cfg.priceUzs;
    const discount = offer ? Number(offer.discount_uzs) : 0;
    const finalPrice = listPrice - discount;
    const superseded = change === 'upgrade' ? await supersedable(db, adminId, now) : [];
    const creditAvailable = change === 'upgrade' ? upgradeCredit(superseded, now) : 0;
    const credit = Math.min(creditAvailable, finalPrice);
    const creditFrom = allocateCredit(superseded, now, credit);
    const cash = finalPrice - credit;
    if (amountUzs != null && amountUzs !== '' && Number(amountUzs) !== cash) {
      throw new Error(`amount_mismatch: due ${cash}`);
    }
    // the economics of this sale as granted: the new quota's conservative
    // cost against the price (cash + credit); a price now under the current
    // floor is honoured (the payment was accepted) and flagged, never re-billed
    let economics = null;
    try {
      const pricing = require('./tariff-pricing');
      const model = pricing.costModel();
      const c = pricing.conservativeCost(plan, { model });
      if (c.ok) {
        const fee = Math.floor((finalPrice * (model.paymentFeeBp || 0) + 9999) / 10000);
        const total = c.fixedUzs + fee;
        const min = pricing.minimumPrice(c.fixedUzs, model.paymentFeeBp || 0);
        economics = { costModelVersion: model.version, estimatedServiceCostUzs: total, finalPriceUzs: finalPrice, cashUzs: cash, creditUzs: credit,
          forecastLeftUzs: finalPrice - total, minPriceUzs: min, belowCurrentMinimum: finalPrice < min, confidence: 'estimated' };
      } else {
        economics = { costModelVersion: model.version, unknown: c.reason };
      }
    } catch (e) {
      economics = { error: e.message };
    }
    if (change === 'upgrade') {
      // where the credit came from; value above the new price stays with the
      // old periods (it is not carried, and it is not new cash)
      economics = Object.assign(economics || {}, {
        creditFrom, creditKnown: creditFrom.every(x => x.known), creditNotCarriedUzs: creditAvailable - credit,
      });
    }
    const endsAt = new Date(startsAt.getTime() + cfg.periodDays * 86400000);
    const ins = await db.query(
      `INSERT INTO tariff_periods (subject, admin_id, plan, rules, source, starts_at, ends_at, limits,
                                   price_uzs, list_price_uzs, discount_uzs, credit_uzs, offer_id, economics,
                                   payment_ref, provider, created_by, paid_at)
       VALUES ($1, $2, $3, 'v2', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
      [`a:${adminId}`, adminId, plan, source, startsAt, endsAt, JSON.stringify(cfg.quotas),
        cash, listPrice, discount, credit, offer ? offer.id : null, economics ? JSON.stringify(economics) : null,
        paymentRef, provider, createdBy, now]);
    const period = ins.rows[0];
    if (offer) {
      await db.query(
        `UPDATE tariff_offers SET status = 'redeemed', payment_ref = $2, period_id = $3, redeemed_at = $4 WHERE id = $1`,
        [offer.id, paymentRef, period.id, now]);
    }
    if (change === 'upgrade') {
      // every running or queued lower period gives way to the upgrade; each
      // records the value it carried into it
      for (const x of creditFrom) {
        await db.query('UPDATE tariff_periods SET carried_out_uzs = carried_out_uzs + $2 WHERE id = $1', [x.periodId, x.uzs]);
      }
      await db.query(
        `UPDATE tariff_periods SET status = 'superseded', superseded_by = $1, superseded_at = $2,
                ends_at = CASE WHEN starts_at < $2 THEN $2 ELSE ends_at END
          WHERE subject = $3 AND source NOT IN ('trial', 'test') AND status = 'active' AND id <> $1 AND ends_at > $2`,
        [period.id, now, `a:${adminId}`]);
    }
    await syncAccountPlan(db, adminId, now);
    return { period, change, duplicate: false, offerId: offer ? offer.id : null, cashUzs: cash, creditUzs: credit, economics };
  });
}

// ── Test entitlement (pilot) ──────────────────────────────────────────────
// A master gives one ordinary account quotas for a limited time to test the
// paid services (the pilot), without a payment: no paymentRef, no price, no
// revenue (a check in the table forbids them), and admins.tariff_* is not
// touched, so the account is exactly as before when it ends. Who gave it,
// why and when is stored on the period. Its AI spend stays in the usage
// ledger and is reported apart from customers' (marginReport,
// measuredServiceCost); its total AI budget is enforced by
// src/ai/test-budget.js.
const TEST_DEFAULT_QUOTAS = Object.freeze({ chat: 12, analysis: 8, opinion: 6, draft: 3, ocr: 10 });
const TEST_MAX_HOURS = 168;

function testQuotas(input) {
  const out = {};
  for (const s of SERVICES) {
    const v = input && input[s] != null ? Number(input[s]) : TEST_DEFAULT_QUOTAS[s] || 0;
    if (!Number.isInteger(v) || v < 0 || v > 1000) return null;
    out[s] = v;
  }
  return out;
}

/**
 * Give `adminId` a test entitlement. Master only (checked in the database).
 * Idempotent: while one is live, a repeated or parallel grant returns it
 * unchanged (one live test entitlement per account, a unique index).
 * Refused while the account has a running paid period. Returns
 * { ok, period, duplicate } or { ok: false, reason }.
 */
async function grantTestEntitlement({ adminId, grantedBy, reason = '', hours = 48, plan = 'silver', quotas = null,
  budgetUsd = 5, unknownCallUsd = 0.05, perRequestUsd = null, budgetMode = 'strict', unboundedCallUsd = null, riskBasis = '', now = new Date() }) {
  const why = String(reason || '').trim();
  if (why.length < 3 || why.length > 500) return { ok: false, reason: 'reason_required' };
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0 || h > TEST_MAX_HOURS) return { ok: false, reason: 'invalid_hours' };
  if (!PAID_PLAN_ORDER.includes(plan)) return { ok: false, reason: 'invalid_plan' };
  const q = testQuotas(quotas);
  if (!q) return { ok: false, reason: 'invalid_quotas' };
  const budget = Number(budgetUsd);
  const unknown = Number(unknownCallUsd);
  const perReq = perRequestUsd == null ? null : Number(perRequestUsd);
  if (!(budget > 0 && budget <= 50)) return { ok: false, reason: 'invalid_budget' };
  if (!(unknown > 0 && unknown <= budget)) return { ok: false, reason: 'invalid_unknown_reserve' };
  if (perReq != null && !(perReq > 0 && perReq <= budget)) return { ok: false, reason: 'invalid_per_request' };
  // 'strict' (default): a call runs only within its proven maximum cost;
  // 'estimated': calls with no proven bound run at a stated estimate - a
  // decision with a written basis, reported as risk, never a guarantee
  if (!['strict', 'estimated'].includes(budgetMode)) return { ok: false, reason: 'invalid_budget_mode' };
  const unbounded = unboundedCallUsd == null ? null : Number(unboundedCallUsd);
  if (budgetMode === 'estimated' && !(unbounded > 0 && unbounded <= budget && String(riskBasis || '').trim().length >= 10)) {
    return { ok: false, reason: 'estimated_mode_needs_estimate_and_basis' };
  }
  return withLock({ adminId }, async (db) => {
    const m = await db.query('SELECT role FROM admins WHERE id = $1', [grantedBy]);
    if (!m.rows[0] || m.rows[0].role !== 'master') return { ok: false, reason: 'master_only' };
    const account = await accountRow(db, adminId);
    if (!account) return { ok: false, reason: 'unknown_user' };
    if (account.role !== 'user') return { ok: false, reason: 'not_an_ordinary_user' };
    // a live one: returned as it is - a repeat never adds quota
    const live = await db.query(
      `SELECT * FROM tariff_periods WHERE subject = $1 AND source = 'test' AND status = 'active' ORDER BY id DESC LIMIT 1`, [`a:${adminId}`]);
    if (live.rows[0] && new Date(live.rows[0].ends_at) > now) return { ok: true, period: live.rows[0], duplicate: true };
    if (live.rows[0]) await db.query(`UPDATE tariff_periods SET status = 'ended' WHERE id = $1`, [live.rows[0].id]);
    await adoptUnrecordedPlan(db, account, now);
    const paid = await db.query(
      `SELECT 1 FROM tariff_periods WHERE subject = $1 AND source NOT IN ('trial', 'test') AND status = 'active' AND ends_at > $2 LIMIT 1`,
      [`a:${adminId}`, now]);
    if (paid.rows[0]) return { ok: false, reason: 'account_has_paid_period' };
    const ends = new Date(now.getTime() + Math.round(h * 3600e3));
    const meta = { kind: 'test', reason: why, grantedBy: Number(grantedBy), grantedAt: now.toISOString(),
      budgetUsd: budget, unknownCallUsd: unknown, perRequestUsd: perReq,
      budgetMode, unboundedCallUsd: budgetMode === 'estimated' ? unbounded : null, riskBasis: budgetMode === 'estimated' ? String(riskBasis).trim().slice(0, 500) : null };
    const ins = await db.query(
      `INSERT INTO tariff_periods (subject, admin_id, plan, rules, source, starts_at, ends_at, limits, economics, created_by)
       VALUES ($1, $2, $3, 'v2', 'test', $4, $5, $6, $7, $8) RETURNING *`,
      [`a:${adminId}`, adminId, plan, now, ends, JSON.stringify(q), JSON.stringify(meta), grantedBy]);
    return { ok: true, period: ins.rows[0], duplicate: false };
  });
}

/** End a live test entitlement now (master only). Usage and spend stay recorded. */
async function endTestEntitlement({ adminId, endedBy, now = new Date() }) {
  return withLock({ adminId }, async (db) => {
    const m = await db.query('SELECT role FROM admins WHERE id = $1', [endedBy]);
    if (!m.rows[0] || m.rows[0].role !== 'master') return { ok: false, reason: 'master_only' };
    const r = await db.query(
      `UPDATE tariff_periods SET status = 'ended', ends_at = LEAST(ends_at, GREATEST($2, starts_at + interval '1 second')),
              economics = COALESCE(economics, '{}'::jsonb) || jsonb_build_object('endedBy', $3::int, 'endedAt', $2::timestamptz)
        WHERE subject = $1 AND source = 'test' AND status = 'active' RETURNING *`, [`a:${adminId}`, now, endedBy]);
    return r.rows[0] ? { ok: true, period: r.rows[0] } : { ok: false, reason: 'no_test_entitlement' };
  });
}

/** Test entitlements, newest first (master view). */
async function listTestEntitlements({ db = pool, limit = 50 } = {}) {
  const r = await db.query(
    `SELECT p.id, p.admin_id, a.username, p.plan, p.starts_at, p.ends_at, p.status, p.limits, p.economics, p.created_by
       FROM tariff_periods p LEFT JOIN admins a ON a.id = p.admin_id
      WHERE p.source = 'test' ORDER BY p.id DESC LIMIT $1`, [Math.min(200, Math.max(1, Number(limit) || 50))]);
  return r.rows;
}

/**
 * The price of moving to `plan` now (optionally under an offer's price):
 * an upgrade is credited the unused days of the running period, pro rata of
 * what it was sold for; a renewal or a downgrade starts when the running
 * period ends and costs the full price.
 */
async function quotePlanChange(adminId, plan, { db = pool, now = new Date(), priceUzs = null } = {}) {
  const cfg = PLAN_CATALOG[plan];
  if (!cfg || !cfg.priceUzs) return null;
  const price = priceUzs != null ? Number(priceUzs) : cfg.priceUzs;
  const running = await db.query(
    `SELECT * FROM tariff_periods
      WHERE subject = $1 AND source NOT IN ('trial', 'test') AND status = 'active' AND starts_at <= $2 AND ends_at > $2
      ORDER BY starts_at DESC LIMIT 1`, [`a:${adminId}`, now]);
  const last = running.rows[0];
  if (!last || PAID_PLAN_ORDER.indexOf(plan) <= PAID_PLAN_ORDER.indexOf(last.plan)) {
    return { plan, change: last ? (last.plan === plan ? 'renewal' : 'downgrade') : 'new', priceUzs: price, creditUzs: 0, dueUzs: price,
      startsAt: last ? last.ends_at : now };
  }
  const rows = await supersedable(db, adminId, now);
  const creditUzs = Math.min(upgradeCredit(rows, now), price);
  return { plan, change: 'upgrade', priceUzs: price, creditUzs, creditKnown: rows.every(p => periodValue(p).known), dueUzs: price - creditUzs, startsAt: now };
}

/**
 * Keep admins.tariff_plan / tariff_starts_at / tariff_expires_at equal to
 * the paid period covering now (the Workspace database policies read them).
 * A queued renewal of the same plan extends the expiry.
 */
async function syncAccountPlan(db, adminId, now = new Date()) {
  const r = await db.query(
    `SELECT * FROM tariff_periods
      WHERE subject = $1 AND source NOT IN ('trial', 'test') AND status = 'active' AND ends_at > $2
      ORDER BY starts_at`, [`a:${adminId}`, now]);
  const current = r.rows.find(p => new Date(p.starts_at) <= now);
  if (!current) return null;
  let endsAt = new Date(current.ends_at);
  for (const p of r.rows) {
    if (p.id !== current.id && p.plan === current.plan && new Date(p.starts_at) <= endsAt) endsAt = new Date(Math.max(endsAt, new Date(p.ends_at)));
  }
  await db.query(
    `UPDATE admins SET tariff_plan = $2, tariff_starts_at = $3, tariff_expires_at = $4
      WHERE id = $1 AND (tariff_plan IS DISTINCT FROM $2 OR tariff_expires_at IS DISTINCT FROM $4)`,
    [adminId, current.plan, current.starts_at, endsAt]);
  return { plan: current.plan, expiresAt: endsAt };
}

/**
 * Measured cost per service over the last `days`: delivered jobs joined to
 * their AI calls in the usage ledger. Known, estimated and unknown costs are
 * kept apart; cost per unit uses known cost only and says how complete it is.
 */
async function measuredServiceCost({ days = 30, db = pool, test = false } = {}) {
  // customers' jobs only; test=true: the test entitlements' (pilot) jobs,
  // reported apart and never mixed into the customer cost per unit
  const r = await db.query(`
    WITH jobs AS (
      SELECT service, COALESCE(credits, 1) AS units, request_id, (meta ->> 'cache') AS cache
        FROM tariff_usage u
       WHERE status = 'committed' AND service IS NOT NULL AND ts > now() - ($1 * interval '1 day')
         AND (EXISTS (SELECT 1 FROM tariff_periods p WHERE p.id = u.period_id AND p.source = 'test')) = $2),
    calls AS (
      SELECT l.request_id,
             COALESCE(SUM(l.cost_usd) FILTER (WHERE l.cost_source IN ('provider_reported', 'calculated')), 0) AS known_usd,
             COALESCE(SUM(l.cost_usd) FILTER (WHERE l.cost_source = 'estimated'), 0) AS estimated_usd,
             COUNT(*) FILTER (WHERE l.cost_usd IS NULL AND COALESCE(l.status, 'success') <> 'skipped') AS unknown_calls,
             COUNT(*) FILTER (WHERE COALESCE(l.status, 'success') <> 'skipped') AS calls
        FROM llm_spend_log l
       WHERE l.request_id IN (SELECT request_id FROM jobs WHERE request_id IS NOT NULL)
       GROUP BY l.request_id)
    SELECT j.service, COUNT(*)::int AS jobs, SUM(j.units)::int AS units,
           COUNT(*) FILTER (WHERE j.request_id IS NULL)::int AS jobs_without_request,
           COALESCE(SUM(c.known_usd), 0)::float AS known_usd,
           COALESCE(SUM(c.estimated_usd), 0)::float AS estimated_usd,
           COALESCE(SUM(c.unknown_calls), 0)::int AS unknown_calls,
           COALESCE(SUM(c.calls), 0)::int AS calls,
           COUNT(*) FILTER (WHERE j.cache = 'hit')::int AS cache_hits
      FROM jobs j LEFT JOIN calls c ON c.request_id = j.request_id
     GROUP BY j.service ORDER BY j.service`, [days, !!test]);
  return r.rows.map(x => ({
    ...x,
    knownUsdPerUnit: x.units ? Number((x.known_usd / x.units).toFixed(5)) : null,
    complete: x.unknown_calls === 0 && x.jobs_without_request === 0,
    planningUsdPerUnit: PLANNING.unitUsd[x.service] == null ? null : PLANNING.unitUsd[x.service],
  }));
}

module.exports = {
  measuredServiceCost,
  SERVICES, PLAN_CATALOG, PAID_PLAN_ORDER, MULTIPLIER, SILVER_QUOTAS, OCR_PAGES_PER_ANALYSIS_UNIT,
  DOC_UNIT, DRAFT_UNIT, STANDARD_PAGE_CHARS, PLANNING, RESERVATION_TTL_MIN,
  docUnits, draftUnits, jobFits, planEconomics, maxOcrPages, planOcr, subjectsFor, lockKey,
  signDocTicket, readDocTicket, textHash, signScanTicket, readScanTicket, heldScanJob, SCAN_HOLD_MIN, SCAN_TICKET_MIN,
  setLegacyCheck, resolveEntitlement, balance, reserve, commit, release,
  reserveMany, grantPaidPeriod, grantTestEntitlement, endTestEntitlement, listTestEntitlements, TEST_DEFAULT_QUOTAS, quotePlanChange, syncAccountPlan, usedUnits, periodValue, upgradeCredit, allocateCredit, withLock,
};
