# Ishonchlilik, baza va kod sifati auditi

# JuristAI reliability, database and code-quality audit

This was a read-only audit: no files were modified. Paths below are relative to `/home/user/dictum-legal-bot/`.

**Top issues:**
1. **Forged Telegram updates:** the legal bot's webhook route puts the bot token in the URL path. Express 5 reads the part after the `:` as a route parameter, so anyone who knows the bot's numeric ID can post fake updates, including fake payments.
2. **Default master login:** every boot seeds a master account with the password `juristAI`.
3. **Half-started server:** any early failure in the boot-time schema code silently skips most route mounting, and the server starts anyway.
4. **No global error handling or graceful shutdown.**

On Render the legal bot runs by webhook, not polling. The polling bot is the separate registration bot.

---

## CRITICAL

**C1. The webhook secret path works as a wildcard (src/api/server.js:235-239)**
- The code is ``const secretPath = `/webhook/${process.env.TELEGRAM_BOT_TOKEN}`; app.post(secretPath, …bot.processUpdate(req.body))``.
- A token looks like `123456:AAH…`. Express 5.2.1 uses path-to-regexp 8.3.0, which reads the text after the `:` as a parameter name.
- I checked this with path-to-regexp directly:
  - For a token with no `-`, `/webhook/7123456789ANYTHING` matches the route.
  - For a token like `…:AAHk-XyZ_abc`, only the part before the first `-` stays secret.
- There is no `secret_token` / `X-Telegram-Bot-Api-Secret-Token` check anywhere.
- **Impact:** anyone who knows the bot ID can inject updates as any user, including admin chat IDs. That includes forged `successful_payment` messages (bot.js:1084-1105). The only check there is on the payload format (bot.js:1087-1089), which is predictable, so this could grant free paid-answer credits.
- Related: line 243 logs the full webhook URL, which contains the token, to Render logs.

**C2. Hardcoded default master credentials, seeded on every boot (server.js:10021-10027)**
- The code is `bcrypt.hash('juristAI', 10)`, then `INSERT … ('masteradmin', …, 'master') ON CONFLICT DO NOTHING`.
- Line 10019 also forces the `admin` user to the `master` role on every boot.
- **Impact:** if that account's password was never changed, or the account is deleted and recreated, there is a known master login. 2FA only applies when Telegram is linked (server.js:480).

**C3. Partial boot: most subsystems are skipped silently when early schema code fails (server.js:9884-10435, 10471-10480)**
- `runMigrations()` wraps about 240 schema statements, route mounting and the versioned migrations in one `try`.
- Any failure before line 10387 (DB down, lock timeout, or a fresh DB with no `admins` table) lands in the catch at 10431-10434. That catch only logs and does not rethrow.
- `app.listen` then runs anyway, but none of these happen:
  - Advanced RAG, Drafting, OCR, Enterprise, Usage-feedback and Workspace routes are never mounted.
  - The datasets are never initialised.
  - The versioned migrations never run.
- **Impact:** the site looks up (`/health` returns OK) but whole features return 404 until the next restart. Nothing retries.
- The opposite case is also a problem. When the Workspace migration fails, it only sets `process.exitCode = 1` (10479) and never calls `process.exit`. The polling registration bot and the pg keepalive keep the process alive, so it never binds `PORT`.

**C4. Tariff quota can be bypassed by a race, and fails open (src/rag/subscription-tiers.js:514-547)**
- `checkQuota` runs a `COUNT(*)` (lines 263-266 and 275-278), then `recordUsage` inserts separately (541, 409-419). There is no transaction or lock.
- **Impact:** N parallel requests all see `used < limit`, so free and trial limits can be exceeded while paid AI calls run.
- The catch at 544-546 calls `next()` with the comment "fail-open". Any DB error therefore means unlimited AI calls.
- `recordUsage` also swallows insert errors (416-418).

## HIGH

**H1. No global error handler, errors swallowed at process level, no graceful shutdown**
- There is no `app.use((err, req, res, next) …)` anywhere in `src/`. Workspace has its own handling through `asyncRoute` / `sendWorkspaceError` (workspace/routes.js:125, workspace/errors.js).
- Express 5 therefore falls back to its default handler. `NODE_ENV` is never set or read anywhere in `src/`, so the default handler returns HTML with stack traces. Errors that reach it:
  - multer fileFilter errors (server.js:85, 102)
  - JSON parse errors
  - sync throws outside `try`, for example `const { username, password } = req.body` at line 458 when `req.body` is undefined
- `process.on('unhandledRejection' | 'uncaughtException')` (server.js:191-196) logs only `err.message`, with no stack, and keeps the process running after an uncaught exception, in an undefined state.
- There is no SIGTERM or SIGINT handler: no `server.close`, `pool.end` or `regBot.stopPolling`. The `app.listen` return value is not even stored (10473).
- **Impact on Render deploys:**
  - In-flight SSE and AI streams are cut off.
  - The old and new instances both poll `REG_BOT_TOKEN`, causing 409 Conflict errors (reg-bot.js:20).
  - Spend and usage writes that are fire-and-forget are lost.

**H2. A bot failure can affect the web server**
- In webhook mode, `bot.processUpdate(req.body)` (server.js:237) runs listeners synchronously inside the Express route. A sync throw skips `res.sendStatus(200)` and goes to the default 500 handler. Telegram then keeps redelivering the same update (a poison-update loop).
- The async bot handlers rely on the global unhandledRejection handler that swallows errors.
- Error listeners that do exist: `bot.on('error' | 'polling_error' | 'webhook_error')` at server.js:206-214, and in reg-bot.js:27-32.

**H3. No timeouts on the main AI provider calls**
There is no `AbortController` or `AbortSignal.timeout` on any of these fetches:

| Call | Location |
|---|---|
| `callGemini` | server.js:3276 |
| `callOpenAIStream` | server.js:3350 |
| `callGeminiStream` | server.js:3421 |
| `callOpenAI` | server.js:3654 |
| `triggerAiScreening` | server.js:8823, 8836 |
| Telegram file fetches | server.js:8747, bot.js:1395 |
| Google OAuth | server.js:9156, 9164 |
| `hybrid-pipeline` | 190, 245 |
| `ocr/routes` | 100, 131 |
| `workspace/storage` | 45 |

- Only these have timeouts: voicelab.js:189, hermes-shadow.js:320, e-advokat-registry.js:149, lex-anchor-resolver.js:118, plus the socket timeouts in embeddings, fetch-lex, web-search and justify-client, and a `Promise.race` in reranker.
- There is no abort when the client disconnects, so the AI call and its cost continue.
- The circuit breaker only exists in `hybrid-pipeline.js:50-90`, which is opt-in via `HYBRID_PIPELINE=1`. The main `callAI` / `callPremiumAI` / `callCheapAI` path (server.js:3734-3822) has none.
- Retries are thin: one parameter-rejection retry (3667), `premiumRetries` with linear 800 ms backoff (3755-3766), and a Gemini retry without search (3808).
- **Impact:** a hung provider holds Express connections and DB pool slots indefinitely.

**H4. Secrets, one-time codes and PII in logs**

| Location | What is logged |
|---|---|
| server.js:243 | bot token (inside the webhook URL) |
| auth/email-code.js:76 | ``[EMAIL STUB] code for ${email}: ${code} (token: ${token})`` |
| server.js:8884 | verification token |
| server.js:9607 | recovery token plus username |
| embeddings.js:150 | HF token prefix, on every HF request |
| server.js:4439 | full user query |
| server.js:6132 | full user message plus the stored corpus question |
| lex-live-search.js:73, legal-corpus.js:852/929, server.js:4979, web-search.js:93 | query prefixes |

- `nodemailer` is not in package.json or node_modules, so stub mode is always active. Every email code is written to the log and never actually sent.
- **Impact:** codes and tokens are readable by anyone with log access, and email verification is effectively broken.

**H5. /api/health is public, expensive and leaks information (server.js:10441-10469)**
- It exposes `hf_token_prefix: process.env.HF_TOKEN.substring(0, 8) + '...'` (**line 10464**).
- It runs a full aggregate over `legal_chunks` on every call: `count(*)`, two `FILTER` counts, `count(DISTINCT category)`, `count(DISTINCT law_name)` and `array_agg(DISTINCT category)`.
- It returns raw DB `e.message` (10454), plus node version, memory, uptime and provider names.
- It only has the global limiter of 300/min per IP.
- **Impact:** it is an easy DB-load vector. A cheap `/health` also exists (line 258), but it does not check the DB.

**H6. Boot-time schema code outside `migrations/`**
- About **240 DDL statements** (CREATE TABLE / ALTER TABLE / CREATE INDEX IF NOT EXISTS) run at runtime:

| File | Statements |
|---|---|
| server.js | 88 |
| services/legal-marketplace.js | 38 |
| rag/legal-corpus.js | 26 |
| rag/subscription-tiers.js | 17 |
| rag/advanced-corpus.js | 15 |
| services/telegram-economy.js | 8 |
| rag/qa-korpus.js | 8 |
| dataset/case-law-dataset.js | 8 |
| dataset/legal-dataset.js | 6 |
| dataset/feedback-dataset.js | 6 |
| agents/telegram-agent.js | 6 |
| rag/usage-feedback.js | 3 |
| rag/llm-spend-log.js | 3 |
| drafting/db.js | 3 |
| agents/hermes-shadow.js | 3 |
| enterprise/index.js | 2 |

- Only Workspace (8 files in `migrations/`) is versioned. It runs **last** (10388), after everything else.
- Base tables (`admins`, `users`, `requests`, `chat_messages`) are only created by `src/database/setup.js`, which is never called at boot. On a fresh DB, line 9887 fails, which triggers C3.
- Tables created lazily inside request paths or by first use:
  - `plan_interest` inside the POST handler (server.js:9503)
  - `tg_conversations` via `ensureTable` (telegram-agent.js:92)
  - `_ready` flags in usage-feedback, drafting and enterprise
- **Schema drift risk:** `tg_conversations` is defined twice with different columns (telegram-agent.js:95 has no `active_request_id`; legal-marketplace.js:207 has it).
- `ALTER TABLE requests ALTER COLUMN file_id TYPE TEXT` (9939) runs on every boot. It takes an ACCESS EXCLUSIVE lock and has no `lock_timeout`, so it can block behind the old instance during a deploy.
- Every boot also runs:
  - a regex `DELETE` on `answer_cache` (10244)
  - a full `legal_chunks` snapshot (10306)
  - index builds in `initLegalCorpus`
  - a bcrypt hash
- All of this happens before `listen`, which lengthens Render cold starts.
- The advisory lock (migrations.js:58) is session-level, so it is unsafe through the Supabase transaction pooler (port 6543).

**H7. Unauthenticated registration can bloat DB and memory (server.js:8894, ~8940-8964)**
- `/api/register` accepts a 10 MB file. The file is read with `readFileSync`, base64-encoded (about 13 MB) and stored in `registration_requests.document_base64`, with no auth.
- The master list endpoint (9693) runs `SELECT rr.*` with **no LIMIT**. It loads every base64 document into memory, strips only `document_base64`, and **returns `password_hash`** to the client.

## MEDIUM

**M1. Raw provider errors reach users**
- `/api/legal-chat` returns `'Qonun qidirish xatoligi: ' + error.message` (server.js:~6626, 6631).
- `callAI` builds that message from provider response bodies: `'Barcha AI provayderlar ishlamayapti: ' + errors.join(' | ')` (3821), with up to 200-300 characters of each provider's error body (3284, 3682).
- There are about 90 `error: err.message` responses in total, for example usage-feedback.js:139-180 and advanced-routes.js:82, 124.

**M2. Pool and SSL settings (src/database/db.js)**
- Settings: `max` 15 (from `DB_POOL_MAX`), `idleTimeoutMillis` 30000, `connectionTimeoutMillis` 30000, `keepAlive` on.
- TLS uses `rejectUnauthorized: false` unless `DATABASE_CA_CERT` is set (lines 18-23). It warns at boot.
- There is no `statement_timeout` / `query_timeout` on the pool, so one slow query can hold a slot indefinitely.
- Nothing in the code chooses pooler vs direct; that depends entirely on `DATABASE_URL`.
- The same pool serves sessions, the bot, RAG and SSE.
- `pool.on('error')` is handled (db.js:48).

**M3. Indexes likely missing on hot queries**

| Table | Query | Location | Missing index |
|---|---|---|---|
| `llm_spend_log` | `WHERE ts > NOW() - …` | llm-spend-log.js:131, 154 | `ts` (only `day`, `month` indexed at 49-50) |
| `llm_spend_log` | `WHERE month=$1 AND user_id IS NOT NULL GROUP BY user_id` | server.js:679 | `user_id` |
| `ai_analyses` | correlated subquery `WHERE aa.request_id = r.id ORDER BY created_at` for every row of the requests list | server.js:1443, 1904 | `(request_id, created_at)` (only `created_at` at 9965) |
| `ai_chat_sessions` | `WHERE admin_id=$1 ORDER BY updated_at` | 7218 | `(admin_id, updated_at)` (only `updated_at`) |
| `requests` | search `request_text ILIKE '%…%'` | 1332 | trigram index |
| `tariff_usage` | `endpoint LIKE '%legal-opinion%'` | subscription-tiers.js:560, 569 | none needed: `(admin_id, ts)` narrows it enough |

- Covered already: `legal_chunks` (ivfflat, GIN tsv, trigram, category, doc_id, is_valid, partial active index), `chat_messages` (PK plus `created_at`), `requests` (status, user_id, created_at, assigned_to, ops_queue).

**M4. N+1 queries and unbounded result sets**
- Per-mention `SELECT` in a loop (server.js:3172-3194).
- Up to 200 sequential `SELECT`s to find a unique username (9097-9101).
- One `INSERT` per expired member on every GET (workspace/routes.js:472-484).
- One insert per selected user (workspace/routes.js:179).
- The SSE watcher runs a `GROUP BY status` over `requests` every 10 s while any client is connected (3087-3099). It is indexed but still a full aggregate.
- `SELECT *` on large rows: `admins` at login (464), `registration_requests` (9729, 9831).

**M5. Timers and in-memory growth**
- **Timers:**
  - `pending2fa` sweep (443, unref'd)
  - SSE watcher (3087, unref'd)
  - per-connection SSE heartbeats (3075, 8516)
  - bot typing interval (bot.js:1479)
- **Maps with no sweep:**
  - `verificationTokens` (verification-store.js:4): filled by the unauthenticated `/api/send-verification-code` (8882) and by email-code.js:53. Entries are deleted only when verified, so unverified ones accumulate at up to 300/min per IP.
  - `_liveCache` and `_resolveCache` (answer-verification.js:178, 214): TTL is checked on read, but entries are never evicted.
  - `responseCache` (e-advokat-registry.js:17): no size cap.
  - `pendingFiles` (bot.js:126): evicted only when the same chat sends another message.
  - `pendingRequests` object (bot.js:118, 984): written, never read or deleted (dead code and a small leak).
- **Bounded or swept:** `regSessions`, `loginSessions` and `botRecoverSessions` use `setTimeout` deletes (8988, 8996, 9264). `anchorCache`, `documentCache` and `_suggestSeen` are capped.
- **Large payloads in memory:**
  - Workspace uploads use `multer.memoryStorage()` with a 50 MB limit (workspace/routes.js:54-57).
  - Registration and screening hold documents as base64 (8745-8763, 9871-9874).
- `express-rate-limit` uses its default in-memory store, so limits reset on every restart.

**M6. Code duplication and inconsistencies**
- **Four separate OpenAI/Gemini client implementations:**
  - server.js: `callGemini`, `callGeminiStream`, `callOpenAI`, `callOpenAIStream` (3237-3708)
  - hybrid-pipeline.js: `callOpenAIModel`, `callGeminiModel` (156, 220)
  - ocr/routes.js: vision call (131)
  - `triggerAiScreening` (8823)
- `'gemini-2.5-flash'` is hardcoded 7 times.
- **Two budget systems:** `LLM_DAILY_BUDGET_USD` in server.js (3599) and `LLM_DAILY_CEILING_USD` / `LLM_MONTHLY_CEILING_USD` in hybrid-pipeline.
- The OpenAI key is named both `GPT_API_KEY` and `OPENAI_API_KEY` (embeddings.js:77-90, hybrid-pipeline.js:176).
- HTML escaping is reimplemented in 4 places: server.js:5447, word-export.js:105, drafting/templates.js:214, legal-research-playbook.js:371.
- Plan prices (199000 / 399000 / 999000) appear in subscription-tiers.js:81-101 **and** are hardcoded in public/index.html:396-429 and public/tariff.html:487-518.
- The bot usernames are repeated 5 times (server.js:187-188, bot.js:32-33, reg-bot.js:11).

## LOW

**L1. Code size and structure**
- server.js is 10,480 lines, has 173 routes, and contains about 50 inline `require()` calls inside handlers.
- Largest units:

| Function / route | Location | Lines |
|---|---|---|
| `retrieveLegalContext` | 4430 | ~635 |
| `/api/legal-chat` | 6012 | ~628 |
| `runMigrations` | 9884 | ~557 |
| `/api/draft/legal-opinion` | 6680 | ~436 |
| `/api/ai-analysis` | 3870 | ~386 |

- Other large files: bot.js (1770), workspace/routes.js (1629), legal-corpus.js (1368), telegram-agent.js (1218).
- There is a circular require: advanced-routes.js:522 → `../api/server`.

**L2. Dead or legacy code**
- The Justify client is still probed at boot (server.js:67-77). It is used only by the master test route `/api/rag/justify-ask` (7934), the stats route (7919) and an optional ingest hook (8288). bot.js:23-29 says the bot no longer uses it.
- `cookie-parser` is not installed, so the try/require at 287 always fails and `req.cookies?.dfp` (9195) is always undefined.
- `ingest-offline.js` is not imported by anything.
- `/api/ai-analysis`, `/api/ai-generate-template`, `/api/ai-compact-answer` and `/api/rag/verify-chat-answer` are not covered by `aiLimiter`. Its path list (312) includes `/api/analyze`, which does not match `/api/ai-analysis`.

**L3. Logging**
- There are 875 `console.*` calls in `src/`. The structured `createLogger` is used in only 4 files (hybrid-pipeline, answer-verification, ingest-queue, check-freshness).
- There are no request IDs and no access log.
- Log volume is high: two `[AI] Calling / succeeded` lines per call (3788-3790), per-query RAG logs, and a `[SOURCE-GUARD]` line on every suppressed search.

**L4. One-time codes use `Math.random`**
- 4-digit codes are generated with `Math.random` (email-code.js:39, server.js:8880, 9597) rather than `crypto.randomInt`.

**L5. Render-specific points**
- `PORT` comes from env (185).
- `app.set('trust proxy', 1)` (262) is correct for a single Render proxy hop. It is worth confirming `req.ip` if Cloudflare sits in front.
- The session cookie uses `secure: 'auto'` (336).
- `express.static('public')` and `sendFile` with `root: 'public'` depend on the working directory.
- There is no `render.yaml`, so the health-check path is not versioned in the repo.
- On the free tier, the instance sleeps after about 15 minutes. That stops registration-bot polling (OTP login breaks) and makes every wake-up pay the full `runMigrations` cost before `listen`.

## Tests and tooling
- There are about 55 npm scripts, including `test`, `test:all`, `test:workspace`, `test:authz`, `eval`, and `ingest:*`.
- Tests are plain Node scripts with no framework or coverage tool. Many only check that certain strings appear in source files (for example, workspace-phase1.test.js reads 22 files).
- `authz-matrix.test.js` needs a live server on port 3000.
- **Coverage gaps:**
  - login, 2FA, session and recovery flows
  - Telegram webhook authentication
  - `successful_payment` and `grantPaidAnswers` idempotency under forged updates
  - the `enforceQuota` concurrency race
  - DB-down boot behaviour
  - `callAI` timeout and fallback
  - RAG retrieval against a real DB (only rag-search and eval)
- **Tooling gaps:**
  - No ESLint or Prettier config (CLAUDE.md confirms "There is no linter").
  - No README at the root and no `.env.example`.
  - The only workflow, `.github/workflows/ingest-and-eval.yml`, runs manually on Node 20 while production uses Node 22. There is no CI that runs tests on PRs, even though pushing to `main` deploys to production.

---

## Environment variable inventory (for `.env.example`)

Variables that only the logo-rendering and model-A/B scripts read (A, B, W, H, FPS, FADE*, HOLD_MS, TAIL_MS, TRANSPARENT, SIZE, N, COOKIE, BASE_URL) are left out.

**Core / platform**
- `PORT`: HTTP port (Render sets it).
- `LOG_LEVEL`: debug/info/warn/error for the structured logger.
- `SESSION_SECRET`: express-session signing secret (required).
- `JWT_SECRET`: fallback session secret.
- `CORS_ORIGINS`: comma-separated list of allowed cross-origin sites.
- `APP_URL`: public base URL for OAuth redirects and links.
- `PUBLIC_APP_URL`: Workspace invitation base URL.
- `DASHBOARD_URL`: dashboard link used in Telegram notifications.
- `MASTER_2FA`: `off` disables master Telegram 2FA.
- `PAYMENTS_ENABLED`: `true` opens paid plans.
- `RENDER_EXTERNAL_HOSTNAME`, `RENDER_SERVICE_ID`: managed-platform detection and webhook host (set by Render).
- `RAILWAY_ENVIRONMENT`, `RAILWAY_PUBLIC_DOMAIN`, `RAILWAY_SERVICE_NAME`: Railway equivalents (legacy).
- `WEBHOOK_DOMAIN`: manual webhook host.

**Database**
- `DATABASE_URL`: Postgres/Supabase connection string.
- `DATABASE_CA_CERT`: PEM CA certificate; enables verified TLS.
- `PGSSL`: `disable` turns TLS off for local Postgres.
- `DB_POOL_MAX`: pool size (default 15).
- `VERSIONED_MIGRATIONS`: `off` skips the `migrations/*.sql` files.
- `ALLOW_EMBED_MIGRATION`: `true` allows dropping and recreating the embedding column.

**Telegram**
- `TELEGRAM_BOT_TOKEN`: legal bot `@yuristga_savolbot`.
- `REG_BOT_TOKEN`: registration/OTP bot.
- `ADMIN_TELEGRAM_ID`: master chat for notifications.
- `REQUIRED_CHANNEL`: promo or gate channel.
- `TELEGRAM_CHANNEL_GATE_ENABLED`: enforce channel membership.
- `CHANNEL_GRACE_DAYS`: days before the web channel gate applies.
- `INSTAGRAM_URL`: link shown by the bot.
- `TG_PAID_ANSWER_STARS`: Stars price per pack.
- `TG_PAID_ANSWER_CREDITS`: answers per pack.
- `TG_ANSWER_RESERVATION_TTL_MIN`: credit reservation time-to-live.
- `AGENT_FREE_AI_LIMIT`: free AI answers per Telegram user.
- `AGENT_AUTO_ANSWER`: master switch for auto-answering.
- `AGENT_ESCALATE_WEAK`: send low-confidence answers to humans.
- `AGENT_MAX_CLARIFY`: maximum clarification turns.
- `MODEL_TELEGRAM`: Telegram answer model.

**LLM providers and models**
- `GPT_API_KEY`: OpenAI key (primary name).
- `OPENAI_API_KEY`: alias of `GPT_API_KEY`, used by embeddings, hybrid pipeline and qa-korpus.
- `GEMINI_API_KEY`: Gemini fallback LLM and embeddings.
- `MODEL_PREMIUM`, `MODEL_STANDARD`, `MODEL_CHEAP`, `MODEL_CHAT`: model id for each lane.
- `MODEL_VISION`: OCR and screening vision model.
- `OPINION_MODEL`: legal-opinion model.
- `OPINION_MODEL_STAFF`: opinion model for staff.
- `OPINION_MODEL_<PLAN>`: per-plan override (read dynamically, server.js:6738).
- `OPINION_MAX_REFS`: maximum lex.uz references in an opinion.
- `OPINION_LEX_BUDGET_CHARS`: character budget for lex context.
- `OPINION_REF_WINDOWS`: reference excerpt windows.
- `LLM_DAILY_BUDGET_USD`: main-path daily spend cap.
- `LLM_DAILY_CEILING_USD`, `LLM_MONTHLY_CEILING_USD`: hybrid-pipeline caps.
- `HYBRID_PIPELINE`: `1` enables the hybrid `/api/advanced-chat` path.
- `ALLOW_WEB_SEARCH`: `true` permits general web search tools.
- `TAVILY_API_KEY`: Tavily web search.

**VoiceLab**
- `LLM_PROVIDER`: `voicelab` switches the LLM provider.
- `VOICELAB_API_KEY`: VoiceLab key.
- `VOICELAB_BASE_URL`: API base URL.
- `VOICELAB_TIMEOUT_MS`: request timeout.
- `VOICELAB_FALLBACK`: fall back to OpenAI on failure.
- `VOICELAB_LANES`: which lanes are routed to VoiceLab.
- `VOICELAB_MODEL_<LANE>`: per-lane model (read dynamically).
- `VOICELAB_PRICES`: JSON price overrides.
- `VOICELAB_STT`: `off` disables speech-to-text.
- `VOICELAB_STT_LANGUAGE`: STT language.
- `VOICELAB_TTS_VOICE_ID`: enables text-to-speech replies.
- `VOICELAB_TTS_LANGUAGE`, `VOICELAB_TTS_SPEED`, `VOICELAB_TTS_MAX_CHARS`: TTS settings.

**Hermes shadow evaluation**
- `HERMES_SHADOW_ENABLED`, `HERMES_SHADOW_URL`, `HERMES_SHADOW_API_KEY`, `HERMES_SHADOW_MODEL`, `HERMES_SHADOW_PRICING_MODEL`, `HERMES_SHADOW_SAMPLE_RATE`, `HERMES_SHADOW_TIMEOUT_MS`, `HERMES_SHADOW_MAX_ATTEMPTS`: shadow model A/B on Telegram answers.

**RAG, embeddings and verification**
- `HF_TOKEN`: HuggingFace embeddings and reranker.
- `EMBED_PROVIDER`: force the embedding provider.
- `GEMINI_EMBED_DIMS`: Gemini embedding dimensions (2000 or fewer).
- `RERANKER_MODEL`: HF reranker model.
- `REEMBED_BATCH`: batch size for the re-embed script.
- `ANSWER_CACHE`: `off` disables the answer cache.
- `SOURCE_SUGGESTIONS`: on/off for lex.uz source suggestions.
- `COVERAGE_MIN_LAW_CHUNKS`: threshold for a "weak coverage" query.
- `LEX_AI_QUERY_PLANNER`: LLM-based lex query planning.
- `LEX_CROSSCHECK_EVERY_ANSWER`: always cross-check answers against lex.
- `LEX_DOCUMENT_CACHE_TTL_MS`: live lex document cache time-to-live.
- `ANSWER_VERIFICATION_LIVE_FETCH`: live lex.uz status checks.
- `ANSWER_VERIFICATION_TIMEOUT_MS`: timeout for those checks.
- `JUSTIFY_URL`, `JUSTIFY_TENANT`: legacy external RAG service.
- `E_ADVOCAT_ENABLED`: `false` disables the official attorney registry lookup.

**Tariffs**
- `FAIR_USE_SILVER`, `FAIR_USE_GOLD`, `FAIR_USE_PLATINUM`: daily fair-use ceilings.
- `CREDITS_SILVER`, `CREDITS_GOLD`, `CREDITS_PLATINUM`: weekly opinion credits.
- `DRAFTS_SILVER`, `DRAFTS_GOLD`, `DRAFTS_PLATINUM`: draft quotas.
- `UZS_PER_USD`: exchange rate for margin calculations.
- `REBATE_THRESHOLD`: rollover/rebate threshold (default 0.75).
- `MAX_USER_TEMPLATES`: per-user template cap.

**Auth and email**
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: Google OAuth.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: email OTP. This also needs `nodemailer`, which is not installed.
- `ADMIN_PASSWORD`: used by the `update-admin-password.js` script.

**Supabase (Workspace)**
- `SUPABASE_URL` (alias `NEXT_PUBLIC_SUPABASE_URL`): project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: storage API key.
- `SUPABASE_PUBLISHABLE_KEY` (alias `SUPABASE_ANON_KEY`): realtime client key.
- `SUPABASE_JWT_SIGNING_SECRET` (alias `SUPABASE_JWT_SECRET`), `SUPABASE_JWT_PRIVATE_KEY`, `SUPABASE_JWT_KEY_ID`, `SUPABASE_JWT_ALGORITHM`: signing realtime JWTs.