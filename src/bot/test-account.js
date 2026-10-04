'use strict';

/**
 * Telegram test account (2026-10-04): one ordinary user account may ask legal
 * questions without the daily free-answer limit or paid answer credits, so
 * the owner can retest the bot from it. Nothing else changes for it, or for
 * anyone else:
 *
 *   - permission is the Telegram user id, never a username; the id must be
 *     linked in the database (admins.telegram_user_id) to an account whose
 *     role is 'user' - a staff account is refused, and no role is granted;
 *   - only in the private chat of that id (chat id = user id);
 *   - the usage ledger, legal checks, circuit breakers, the one-answer-at-a-
 *     time reservation and each request's time/call/cost limits all stay;
 *   - its AI spend is counted apart (llm_spend_log rows of that chat inside
 *     the mode's window), and the mode has its own total budget ($5 default):
 *     once known spend + unknown-cost calls at an assumed price reach it, the
 *     ledger refuses every new paid call for that chat;
 *   - off unless configured; ends by itself 48 hours after it starts.
 *
 * Configuration (Render environment):
 *   TG_TEST_ACCOUNT_USER_ID   Telegram user id (digits)
 *   TG_TEST_ACCOUNT_SINCE     start, ISO time; the mode ends 48 h later
 *   TG_TEST_ACCOUNT_HOURS     shorter window if wanted (max 48)
 *   TG_TEST_ACCOUNT_BUDGET_USD  total budget (default 5)
 *   TG_TEST_UNKNOWN_CALL_USD  price assumed for a call whose cost is unknown
 *                             (default 0.05; unknown is never counted as $0)
 *   TG_TEST_ACCOUNT=off       turns it off at once
 */

const MAX_HOURS = 48;
const LABEL = 'telegram test account';

function num(v, d) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; }

/** The configured mode, active or not, and why. Never throws. */
function testAccountConfig(env = process.env, now = Date.now()) {
  const userId = String(env.TG_TEST_ACCOUNT_USER_ID || '').trim();
  const hours = Math.min(MAX_HOURS, num(env.TG_TEST_ACCOUNT_HOURS, MAX_HOURS) || MAX_HOURS);
  const since = Date.parse(String(env.TG_TEST_ACCOUNT_SINCE || ''));
  const cfg = {
    userId: /^\d{4,20}$/u.test(userId) ? userId : null,
    since: Number.isFinite(since) ? new Date(since).toISOString() : null,
    until: Number.isFinite(since) ? new Date(since + hours * 3600e3).toISOString() : null,
    hours,
    budgetUsd: num(env.TG_TEST_ACCOUNT_BUDGET_USD, 5),
    unknownCallUsd: num(env.TG_TEST_UNKNOWN_CALL_USD, 0.05),
    active: false,
    reason: null,
  };
  if (String(env.TG_TEST_ACCOUNT || '').toLowerCase() === 'off') cfg.reason = 'turned off (TG_TEST_ACCOUNT=off)';
  else if (!userId) cfg.reason = 'not configured';
  else if (!cfg.userId) cfg.reason = 'TG_TEST_ACCOUNT_USER_ID is not a Telegram user id';
  else if (!cfg.since) cfg.reason = 'TG_TEST_ACCOUNT_SINCE is not set';
  else if (since > now + 5 * 60e3) cfg.reason = 'starts in the future';
  else if (now >= Date.parse(cfg.until)) cfg.reason = `ended at ${cfg.until}`;
  else if (!(cfg.budgetUsd > 0)) cfg.reason = 'budget is 0';
  else cfg.active = true;
  return cfg;
}

/**
 * Spend of the test account inside the mode's window, from the usage ledger.
 * Unknown-cost calls are counted, and priced at the assumed price for the
 * budget; skipped calls (nothing was called) are not.
 */
async function testAccountSpend(db, cfg) {
  const { rows } = await db.query(`
    SELECT COALESCE(SUM(cost_usd), 0)::float AS known_usd,
           COUNT(*) FILTER (WHERE cost_usd IS NULL AND COALESCE(status, 'success') <> 'skipped')::int AS unknown_calls,
           COUNT(*) FILTER (WHERE COALESCE(status, 'success') <> 'skipped')::int AS calls,
           COUNT(DISTINCT request_id)::int AS requests
      FROM llm_spend_log
     WHERE chat_id = $1::bigint AND ts >= $2::timestamptz AND ts < $3::timestamptz`,
  [cfg.userId, cfg.since, cfg.until]);
  const r = rows[0] || {};
  const knownUsd = Number(r.known_usd) || 0;
  const unknownCalls = Number(r.unknown_calls) || 0;
  const committedUsd = knownUsd + unknownCalls * cfg.unknownCallUsd;
  return {
    knownUsd, unknownCalls, calls: Number(r.calls) || 0, requests: Number(r.requests) || 0,
    assumedUnknownUsd: unknownCalls * cfg.unknownCallUsd,
    committedUsd,
    remainingUsd: Math.max(0, cfg.budgetUsd - committedUsd),
    exhausted: committedUsd >= cfg.budgetUsd,
    // honest about what this number is
    strict: unknownCalls === 0,
  };
}

/**
 * The test account for this Telegram update, or null. Only the configured
 * user id in its own private chat, linked in the database to a role 'user'
 * account. A database error means null: ordinary limits apply.
 */
async function resolveTestAccount(db, { chatId, fromUserId, chatType = 'private' } = {}, env = process.env, now = Date.now()) {
  const cfg = testAccountConfig(env, now);
  if (!cfg.active || fromUserId == null) return null;
  if (String(fromUserId) !== cfg.userId || String(chatId) !== cfg.userId || chatType !== 'private') return null;
  try {
    const { rows } = await db.query(
      `SELECT id, role FROM admins WHERE telegram_user_id = $1::bigint ORDER BY id LIMIT 2`, [cfg.userId]);
    if (rows.length !== 1) {
      console.warn(`[TG-TEST] user id configured but ${rows.length ? 'linked to more than one account' : 'not linked to any account'}; ordinary limits apply`);
      return null;
    }
    if (rows[0].role !== 'user') {
      console.warn('[TG-TEST] the linked account is not an ordinary user; test mode refused');
      return null;
    }
    const spend = await testAccountSpend(db, cfg);
    return {
      userId: cfg.userId, adminId: rows[0].id, since: cfg.since, until: cfg.until,
      budgetUsd: cfg.budgetUsd, unknownCallUsd: cfg.unknownCallUsd, spend, exhausted: spend.exhausted,
    };
  } catch (error) {
    console.warn('[TG-TEST] check failed; ordinary limits apply:', error.message);
    return null;
  }
}

/** The ledger's shared budget for a resolved test account. */
function ledgerPool(account) {
  return {
    label: LABEL,
    limitUsd: account.budgetUsd,
    spentUsd: account.spend.committedUsd,
    unknownCallUsd: account.unknownCallUsd,
  };
}

/** Tashkent time, e.g. "06.10.2026, 10:00". */
function tashkentTime(iso) {
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year}, ${p.hour}:${p.minute}`;
}

/**
 * The budget in words, keeping apart what is known and what is only reserved
 * (2026-10-04: "$0.4188 sarflandi" read as a bill although $0.40 of it was
 * the assumed price of 8 calls whose cost is unknown). extra adds the current
 * request: { knownUsd, unknownCalls }.
 */
function budgetLines(account, extra = {}) {
  const s = account.spend;
  const knownUsd = s.knownUsd + (Number(extra.knownUsd) || 0);
  const unknownCalls = s.unknownCalls + (Number(extra.unknownCalls) || 0);
  const reservedUsd = unknownCalls * account.unknownCallUsd;
  const remainingUsd = Math.max(0, account.budgetUsd - knownUsd - reservedUsd);
  const lines = [`Narxi ma'lum sarf: $${knownUsd.toFixed(4)}.`];
  if (unknownCalls) {
    lines.push(`Narxi noma'lum chaqiruvlar: ${unknownCalls} ta. Ular $0 deb hisoblanmaydi: budjetdan har biriga $${account.unknownCallUsd} zaxira ajratilgan (jami $${reservedUsd.toFixed(2)}). Bu haqiqiy hisob-faktura emas, shuning uchun budjet hisobi qat'iy emas.`);
  }
  lines.push(`Test budjeti qoldig'i: $${remainingUsd.toFixed(2)} / $${account.budgetUsd}.`);
  return lines;
}

/** The note under a test-mode answer. */
function testModeNote(account, extra = {}) {
  return [`🧪 Test rejimi (${tashkentTime(account.until)} gacha, Toshkent vaqti): kunlik limit va kredit hisoblanmadi.`, ...budgetLines(account, extra)].join('\n');
}

/** The /balance block of a test account. */
function balanceText(account) {
  return [
    '🧪 Test rejimi yoqilgan.',
    `Tugash vaqti: ${tashkentTime(account.until)} (Toshkent vaqti). Shundan keyin oddiy limitlar qaytadi.`,
    'Huquqiy savollar uchun kunlik bepul limit va javob krediti talab qilinmaydi; tekshiruvlar va bir vaqtda bitta javob qoidasi saqlanadi.',
    ...budgetLines(account),
    account.exhausted ? 'Test budjeti tugagan: yangi AI chaqiruvlari to\'xtatilgan.' : '',
  ].filter(Boolean).join('\n');
}

module.exports = { MAX_HOURS, testAccountConfig, testAccountSpend, resolveTestAccount, ledgerPool, testModeNote, balanceText, budgetLines, tashkentTime };
