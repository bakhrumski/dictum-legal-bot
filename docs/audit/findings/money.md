# Pul mantig'i auditi (tariflar, limitlar, kreditlar)

# JuristAI money-logic audit (read-only)

I didn't modify anything. The two worst problems:
- **The weekly draft limit is never enforced.** Draft usage is saved under an endpoint name that the counting query never matches.
- **Weekly limits reset on Tuesday, not Monday.** The week-start function is off by one day.

Paths below are relative to `/home/user/dictum-legal-bot`. Main files: `src/rag/subscription-tiers.js`, `src/api/server.js`, `src/drafting/routes.js`, `src/ocr/routes.js`, `src/workspace/authz.js`, `src/workspace/routes.js`, `src/services/telegram-economy.js`, `src/agents/telegram-agent.js`, `src/bot/bot.js`, `src/rag/advanced-routes.js`, `public/tariff.html`, `public/index.html`.

---

## (A) Spec vs code

| Spec item | Code | Difference |
|---|---|---|
| bepul 10/day for 30 days, then 3/day, free forever | `subscription-tiers.js:48-62, 258-271` | Numbers match. (1) The 30 days count from `tariff_starts_at`, not signup, and re-selecting bepul through `/api/tariff/select` resets that date (`:446-478`), so a user can stay at 10/day forever. (2) The day count is rolling 24-hour blocks, not calendar days (`:259`). (3) The daily count is a raw `COUNT(*)` of every usage row, so draft exports and opinions also use up chat allowance (`:263-265`). |
| bepul: no opinions, no drafts | `:58-59`; checked in `server.js:6725`, `drafting/routes.js:396` | Only `/api/draft/ai-generate` checks the draft limit. For bepul users, `/api/draft/suggest` (`drafting/routes.js:291`, calls AI) and `/api/templates/analyze` (`:496`, calls AI) are limited only by the daily chat count. A rejected opinion or draft still uses one chat, because the chat quota row is written before the credit check. |
| sinov 3/day, 1 credit/week, 2 drafts/week, 10 days | `:63-72` | Numbers match. Draft counting is broken (finding H1). When sinov expires, the user is blocked (`no_plan`) instead of moved to bepul (`:233-234, 252`). |
| silver 199000, fair-use 15, 9 credits, 22 drafts, 30 days | `:73-82` | Numbers match, but each can be overridden by environment variables (`FAIR_USE_*`, `CREDITS_*`, `DRAFTS_*`), which the hard-coded HTML ignores. `parseInt(x) \|\| default` means a limit can never be set to 0. The fair-use weighting makes 22 drafts/week impossible to reach (H2). |
| gold 399000, 30/day, 17 credits, 50 drafts | `:83-92` | Numbers match; same weighting problem. |
| platinum 999000, 70/day, 42 credits, 125 drafts + Workspace | `:93-102`; `migrations/20260825_005_workspace_master_owner.sql:6-23`; `workspace/authz.js:8-30` | Numbers match. Workspace AI is not counted in fair-use at all (`workspace/routes.js:1496`). There is a member-entitlement bug (M4). |
| Opinion credits: ≤40000 chars = 1, ≤90000 = 2, else 3 | `:110-121`, `server.js:6707` | Matches. Documents are cut to 120000 characters (`server.js:6685`), so 3 is the most one opinion can cost. |
| Weekly reset Monday 00:00 Asia/Tashkent | `:215-219` | **Wrong: resets Tuesday 00:00 Tashkent** (H3). |
| Paid-plan expiry → bepul | `:233-234`, `:252` | No fallback. An expired user gets 429 "Tarif rejasi tanlanmagan". `tariff_plan` is never cleared and there is no downgrade job. |
| Telegram | `telegram-agent.js:75-78`, `bot.js:35-38` | Not in the spec. Telegram has its own economy (3 free answers/day per chat, plus Stars packs) that isn't linked to web plans. A Platinum web user still gets 3/day in the bot. |

---

## (B) Findings by severity

### Critical

**C1. With `PAYMENTS_ENABLED=true`, anyone can give themselves a paid plan.**
- `server.js:9554-9561` only checks the flag, then calls `selectPlan`.
- On the page, `confirmPayment()` (`public/tariff.html:649-658`) just POSTs `{plan, payment_method}` to `/api/tariff/select`. The server ignores `payment_method`.
- There is no Click, Payme or Uzum integration anywhere: no callbacks, no signature checks, no invoice table. The Click/Payme buttons at `tariff.html:542-543` are only for show.
- Scenario: flip the flag, then `POST /api/tariff/select {"plan":"platinum"}` gives Platinum and Workspace for free.
- Today the flag is off, so this is latent. The flag must not be turned on until a real provider callback is the only thing that can grant a paid plan.

### High

**H1. The weekly draft limit is never enforced, for any plan.**
- Every drafting route uses `enforceQuota('/api/draft')` (`drafting/routes.js:211-213`), so every row is saved as the literal string `/api/draft`.
- `draftsUsed` counts rows `LIKE '%draft/ai-generate%'` (`subscription-tiers.js:566-571`). Nothing ever writes that value, so it always returns 0.
- `checkDraftQuota` (`drafting/routes.js:396-406`) therefore always allows. The only thing limiting drafts is fair-use (paid plans) or the daily count (bepul/sinov).
- The weighting SQL at `:187-188` mentions `/api/draft/ai-generate%` and `/api/templates/import%`, but those strings are never saved either.

**H2. The fair-use weights are wrong and make the promised draft counts unreachable.**
- `ENDPOINT_WEIGHT_SQL` (`:185-191`) gives weight 7 to anything matching `/api/draft%`. That includes:
  - `/api/draft/export` and `/api/draft/export-raw`: these only render a file with no AI call (`drafting/routes.js:355-384`).
  - `/api/draft/suggest` and `/api/templates/analyze`: both are saved as `/api/draft`.
  - `/api/draft/legal-opinion` (saved at `server.js:7080`), which also matches `/api/draft%`.
- One opinion costs 8 chat-equivalents: 1 for the `/api/legal-chat` row written by `enforceQuota` (`server.js:6680`) plus 7 for the opinion row.
- One generated document plus its export costs 14.
- Result: Silver (15/day) gets about 1 document a day, roughly 7 a week against the 22 promised. Gold gets 2 a day (~14 vs 50). Platinum gets 5 a day (~35 vs 125).
- Heavy endpoints are under-weighted at 1: `/api/draft/explain-document` (`server.js:7130`, digests up to 120k chars), `/api/analyze`, `/api/enterprise-chat`.

**H3. Weekly limits reset Tuesday 00:00 Tashkent, not Monday.**
- `tashkentWeekStart()` (`:215-219`) calls `getUTCDay()` on Tashkent midnight. Tashkent midnight is 19:00 UTC on the previous day, so the weekday comes out one day early.
- I checked this with node:
  - Mon 2026-09-21 10:00 Tashkent → week start = **Tue 2026-09-15 00:00**.
  - Tue 2026-09-22 00:30 → week start = Tue 2026-09-22.
  - Mon 2026-09-28 03:00 → still Tue 2026-09-22.
- Effect: a user who used all credits on Sunday gets nothing back on Monday, even though the 429 message says "Limit dushanba kuni yangilanadi" (`server.js:6730`, `drafting/routes.js:402`). `resetsAt` (`:591, 608`) also reports Tuesday.
- No test covers `tashkentWeekStart`.
- `tashkentMidnight()` (`:204-212`) is correct.

**H4. Opinion credits can be overspent by sending requests in parallel.**
- Credits are checked at the start (`server.js:6725`) and recorded only after generation (`server.js:7080`), which can take minutes. Nothing locks in between.
- Scenario: a sinov user with 1 credit sends 3 opinions at once (the chat check is also racy, see M1). All 3 pass. A Platinum user with 3 credits left sends 10 documents of 90k+ characters at once; all pass, costing about $0.65 each.
- It fails open: any exception in the check block is logged and allowed (`server.js:6740`).

**H5. Paid and sinov users are fully blocked when their plan expires.**
- `getUserPlan` sets `plan = null` when expired (`:233-234`). `checkQuota` then returns `no_plan` (`:252`), and `enforceQuota` returns 429 (`:530-539`).
- Spec says bepul is free forever, but nothing moves them to it.
- When they re-select bepul manually, they get a fresh 30 days at 10/day.

### Medium

**M1. Every chat-style limit is check-then-insert with no transaction or lock.**
- `enforceQuota` does `checkQuota` (a `SELECT COUNT/SUM`) and then `recordUsage` (an `INSERT`) (`:514, 541`). This applies to the bepul daily limit, the sinov daily limit and paid fair-use.
- N parallel requests at `used = limit-1` all pass.
- The only brake is `aiLimiter`: 40 requests per 5 minutes, per IP, on `/api/legal-chat|analyze|draft|ai-chat` only (`server.js:305-312`).
- `checkDraftQuota` is racy too (not that it matters while H1 stands).
- The fix is an advisory lock per `admin_id` inside a transaction, the same pattern `telegram-economy.js:234` already uses.

**M2. Web chat quota is never refunded.**
- `enforceQuota` records usage *before* the handler runs (`:541`).
- A 400 validation error, AI failure, 500, client disconnect, or a 429 from the opinion or draft check all still use one chat or fair-use unit.
- Opinion credits themselves are correctly recorded only after success (`server.js:7078-7081`). But `recordUsage` swallows DB errors (`:416-418`), so a failed insert means a free opinion.

**M3. Several paths fail open.**
- `enforceQuota` calls `next()` on any exception (`:544-547`), so a DB hiccup means unlimited AI.
- The opinion credit check fails open (`server.js:6740`).
- `isChannelOkForAdmin` returns the cached value on errors (`:346-347`).

**M4. Workspace member entitlement falls back to the owner's plan.**
- `isActivePaidPlan` (`workspace/authz.js:18-22`) uses `row.member_tariff_plan || row.tariff_plan`.
- A member whose `tariff_plan` is NULL (new users stay NULL until they pick a plan) inherits the owner's `platinum` and passes the "Silver or higher" check in `requireWorkspaceAccess` (`:65-83`).
- The expiry check has the same fallback (`||`).

**M5. AI endpoints with no quota at all:**
- `POST /api/analyze/ocr-image` (`ocr/routes.js:303`): Vision OCR, any authenticated user including bepul. The Gold card sells "Skan va rasmdan hujjat tahlili".
- `POST /api/requests/:id/classify` (`server.js:8705`): LLM classifier. Only `requireAuth`, so any `role='user'` can call it, and it takes any request id (also an IDOR: users can reach other users' records).
- `POST /api/workspaces/:id/assistant/ask` (`workspace/routes.js:1496`): only `aiLimiter`, not counted in `tariff_usage` or fair-use.
- Telegram voice STT (`bot.js:1386-1404`) and the TTS reply run before or apart from the entitlement check.
- Not money, but serious: `POST /api/rag/verify-chat-answer` (`server.js:7963`) is only `requireAuth`, so any common user can insert "verified" answers into `legal_chunks`/`qa_bank`, the verified-answer store that `/api/legal-chat` serves verbatim for near-identical questions (corpus poisoning).

**M6. Telegram Stars: a valid payment can be silently dropped.**
- `successful_payment` is checked against the *current* `TG_PAID_ANSWER_STARS` (`bot.js:1087-1089`). If that environment variable changes between invoice and payment, the user is charged, only a log line is written, no message is sent and no credits are given (`:1090-1093`).
- Credits granted are the current `PAID_ANSWER_CREDITS`, not what the invoice promised. No invoice is stored on the server, and there is no `refundStarPayment` path.
- What is correct:
  - Currency must be XTR and the amount must match (`:1052-1054`, `:1087-1089`).
  - The payload is tied to the payer's `from.id`.
  - Duplicate charges are safe: `telegram_payment_charge_id` is UNIQUE and uses `ON CONFLICT DO NOTHING` inside a transaction (`telegram-economy.js:74, 335-379`).
  - Credits go to the chat wallet, not the user.

**M7. `selectPlan` has no guards on switching.**
- An active Silver user can switch to bepul or sinov and lose paid time immediately.
- Re-buying the same plan resets expiry to now+30 days, and the remaining days are lost (`:456-478`).

**M8. Legacy endpoints are broken.**
- `advanced-routes.js:258-280` uses `subscription.TIER_LIMITS` and `subscription.setTier`, which aren't exported. `/api/subscription/set-tier` throws a TypeError (500), and `/api/subscription/tiers` returns an empty body.

### Low

- **Race safety summary:**
  - Race-safe: Telegram entitlements (advisory lock `telegram-economy.js:234`, one-pending unique index `:57-60`, conditional upsert `:252-260`, `credits > 0` decrement `:275-280`) and Telegram payment grants.
  - Not race-safe: web chat/fair-use (M1), opinions (H4), drafts.
  - Harmless race: the sinov `bepul_used` check (`:451-454`).
- **Telegram refunds work:** failure or empty answer releases the reservation (`telegram-agent.js:1117-1128`), as does failed delivery (`bot.js:1536-1539`). Edges:
  - Partial multi-part delivery refunds the whole answer.
  - A reservation older than 10 minutes is auto-refunded even if it was delivered but finalize failed (`telegram-economy.js:173-186`).
- **Timezone, other spots:**
  - The LLM budget and spend-log "day" is the UTC date (`server.js:3588, 3598-3602`; `hybrid-pipeline.js:107-112`; `llm-spend-log.js:64, 82`), so it resets at 05:00 Tashkent.
  - `CURRENT_DATE` in dashboard stats (`server.js:1294, 1356`) follows the DB session timezone.
  - `getUsageStats` weekly is a rolling 7 days, not Monday (`:436`).
  - `retryAfterHours: 24` is a constant (`:527`).
  - The Telegram economy handles time zones correctly with `timezone('Asia/Tashkent', NOW())::date`.
- **Stale session role:** the `enforceQuota` bypass uses `req.session.role` (`:498-499`), so a user demoted in the DB keeps bypassing until the session ends.
- **Dead rollover field:** `getUserPlan` doesn't select `tariff_rollover` (`:224`), so `rollover` is always 0.
- **Display issues on `/api/tariff/me`:** `remaining: Infinity` becomes `null` in JSON, and usage counts aren't weighted.
- **Staff and master exemptions:**
  - `role !== 'user'` (lawyer, student) and master skip every limit (`:249-251, 498-499, 581, 599`; `server.js:6720`).
  - The Telegram `/testmode` (`bot.js:375-400`) lets the master act as an ordinary user.

**Magic numbers duplicated (item 7):**
- Prices appear in `subscription-tiers.js:81/91/101`, `public/tariff.html:487/502/518`, `public/index.html:396/412/429`, `docs/ai-usage.md:151-153`, `docs/brand|design-handoff/landing.dc.html`, and `tests/pricing-cards.test.js`.
- Monthly figures (~39/95, 74/217, 182/542) are hard-coded in both HTML files, so the environment overrides won't show there.
- Bepul 10/3/30 is repeated in `tariff.html:477` and `index.html:384-385, 647-648`.
- Opinion token caps 4500/7000 are at `server.js:6737`.
- Telegram: free limit 3 is parsed twice (`telegram-agent.js:75`, `bot.js:37`); price 1 Star for 4 answers (`bot.js:35-36`).
- `UZS_PER_USD` 11980 at `:619`.

---

## (C) Safe mechanical fixes vs owner decisions

**Safe and mechanical:**
1. Week start (H3): compute the weekday from the Tashkent-shifted date, e.g. `new Date(Date.now()+5h).getUTCDay()`, and add a test.
2. Draft counting (H1): record `/api/draft/ai-generate` for that route, or count it in `draftsUsed` by its real endpoint. Give export, suggest and analyze distinct endpoint names.
3. Weight SQL (H2): give the non-AI exports weight 0, and give `/api/draft/legal-opinion` its own explicit case (or leave it out of fair-use). Also stop recording opinions and explain-document as `/api/legal-chat`.
4. Put `enforceQuota`'s check and insert in one transaction with `pg_advisory_xact_lock(admin_id)`. For opinions, reserve credits up front and delete the row on failure.
5. Add `enforceQuota` to `/api/analyze/ocr-image`. Add `requireStaff` to `/api/requests/:id/classify` and `/api/rag/verify-chat-answer`.
6. Fix `isActivePaidPlan` so it uses only the member's own plan fields.
7. Remove or repair the legacy `/api/subscription/set-tier` and `/api/subscription/tiers`.
8. Use the same Tashkent date for the LLM budget day.
9. Serve the plan limits and prices to the HTML from `PLANS` instead of hard-coding them.

**Needs an owner decision:**
- Payment provider design and a server-verified callback before `PAYMENTS_ENABLED` goes on (C1).
- Whether an expired paid or sinov plan should auto-downgrade to bepul (H5), and whether bepul's 30-day window starts at signup or first selection.
- Fair-use weight values, and whether drafts and opinions should count toward fair-use at all given the weekly allowances.
- Fail-open vs fail-closed on quota errors (M3).
- Refunding chat units on AI failure (M2).
- Renewal and downgrade rules (M7).
- Metering for Workspace AI (M5).
- Telegram: Stars price (1 Star for 4 answers), mismatch and refund handling (M6), and whether web plans should unlock Telegram answers.