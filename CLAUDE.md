# JuristAI — notes for Claude Code

JuristAI is an Uzbek legal assistant: a Telegram bot plus the juristai.uz web
app. The repository is `bakhrumski/dictum-legal-bot` (the name predates the
brand). One Node process runs both: `index.js` loads `src/api/server.js`, which
starts Express and the bot.

The owner writes in Uzbek; answer in Uzbek unless asked otherwise.

## Working agreement

- **After every push, check whether the branch has an open PR.** If it has
  none, open one and give the link. A push without a visible PR has been
  missed more than once; do not assume.
- **Merging is split by what the change touches:**
  - Frontend only (`public/**` — HTML, CSS, client JS, images, fonts, media):
    merge the PR yourself once verified, then report the link.
  - Anything else — `src/**`, `migrations/**`, `scripts/**`, auth, payments,
    tariffs, database, `package.json`, config, tests, docs: open the PR and
    **ask before merging**.
- `main` deploys straight to production on Render. A merge is a release.
- If the branch's PR has already been merged, restart the branch from
  `origin/main` before new work; never stack commits on merged history.
- Verify visual work in a real browser at desktop and phone widths (~390px)
  before calling it done. Report what was checked, and say plainly what was
  not (e.g. no real iPhone available — Safari behaviour was simulated).

## Commands

```bash
npm start                 # server + bot (needs .env; see below)
npm test                  # core suite: phase1 + rag-search — must pass
npm run test:workspace    # Workspace API + frontend contract
npm run test:all          # broad suite
```

There is no linter. Cloud sessions get `node_modules` from the SessionStart
hook in `.claude/hooks/session-start.sh`.

Known state of the suites (Sept 2026):
- `npm test` passes (58 + 5).
- `tests/authz-matrix.test.js` needs a running server on :3000 and aborts
  otherwise — expected, not a regression.
- `tests/provider-resilience.test.js` and `tests/legal-regressions.test.js`
  (A-H, 2026-10-04 retest) use stub providers only; no real cost.
- `tests/workspace-phase1.test.js` passes. It asserts exact code strings
  from the Workspace frontend, so a redesign that renames a class will fail
  it; update the assertion to the current design rather than reverting the
  code.

## Layout

- `src/api/server.js` — Express app and most routes.
- `src/bot/` — Telegram bot. `src/agents/` — agent flows.
- `src/rag/` — legal corpus ingest and hybrid search (lex.uz).
  `src/rag/legal-claim-guard.js` checks every legal answer (Telegram, web
  chat, Workspace) before it is sent: a term, amount, percentage or rate
  must be in the cited source text and confirmed by a verifier for that
  situation and those parties, else it is withheld and named; a verifier
  that fails leaves claims unverified, never passed. Since 2026-10-04 it also
  checks what an article is cited FOR (a basis the source contradicts, or an
  article not in context, is withheld), never lets "not found in the searched
  sources" read as "not in the law", and removes empty headings / cuts a
  truncated answer to its last full sentence. `citationCheck` is the format
  check only; `semanticCheck` is the guard's verdict.
  `src/rag/question-aspects.js` splits a question into deadline,
  compensation, evidence and remedy and runs a light corpus search for each
  (Telegram, web chat, Workspace).
- `src/ai/model-pricing.js` — **single source of truth for model prices**;
  every spend path, hybrid-pipeline included, reads it. Each price carries
  its source and check date; VoiceLab credits convert at the owner's
  purchase, 1,200,000 credits = $90 (`VOICELAB_CREDIT_USD` overrides).
- `src/ai/usage-ledger.js` — per-request AI usage: every user request
  (Telegram message, API request) has a request_id, and every AI call made
  for it — intent, embeddings, rerank, answer, cross-check, claim check,
  retries, fallbacks, OCR, STT, TTS — is one `llm_spend_log` row with stage,
  provider, requested and returned model, usage, latency, status and a cost
  marked provider_reported / calculated / estimated / unknown (unknown is
  NULL, never $0). Wrap a new provider call in `usageLedger.track()`.
  Master views: `/api/admin/ai-usage/{requests,requests/:id,report}` and the
  dashboard's "AI so'rovlar" panel.
- `src/ai/provider-health.js` — provider errors are classified from status
  AND the provider's own code/message (a 429 is quota or rate limit, a 402
  says why), permanent vs transient, with a per-process circuit breaker; an
  open breaker or a spent per-request budget (`AI_REQUEST_*`) is one
  `skipped` ledger row, no call. Rerank pairs of one question are one
  `batch_id`, not retries; `RERANKER=off` turns HF rerank off.
  `docs/ai-routing.md` is the routing map (there is no Claude adapter).
  Report days are Asia/Tashkent.
- Models: GPT-6 since 2026-09-23. `MODELS` in server.js defaults to
  premium and standard `gpt-6-sol`, cheap and chat `gpt-6-luna`, each
  env-overridable (`MODEL_PREMIUM`…). Premium is deliberately not
  `gpt-6-astra`: at 10/50 per 1M it breaks the paid plans' worst-case
  margins. The unit costs in `subscription-tiers.js` were measured on
  GPT-5.6 and need re-measuring on GPT-6. Routers pass an explicit `lane`
  to `callOpenAI`, because one id can serve two lanes (gpt-6-sol).
- `src/ai/voicelab.js` — VoiceLab LLM switch (OpenAI-compatible Chat
  Completions at `api.voicelab.uz`). Off unless `LLM_PROVIDER=voicelab` and
  `VOICELAB_API_KEY` are set; turning it off is an env change, not a deploy.
  Lanes: cheap → aisha-comet, standard → aisha-orbit, premium and vision →
  aisha-halo (ids as the VoiceLab console lists them), each
  overridable (`VOICELAB_MODEL_*`), limited with `VOICELAB_LANES`. A VoiceLab
  failure falls back to the previous provider unless `VOICELAB_FALLBACK=false`.
  Hooked at five places only: `callOpenAI` / `callOpenAIStream` and
  `triggerAiScreening` in server.js, `callOpenAIModel` in hybrid-pipeline.js,
  `callVisionOCR` in ocr/routes.js. Embeddings are deliberately not routed —
  changing them means re-embedding the corpus. Prices come from
  `model-pricing.js` (list prices, 2026-09-23), overridable with
  `VOICELAB_PRICES` (JSON, USD/1M). `MODEL_TELEGRAM` sets the Telegram
  answer model on its own (e.g. `voicelab/aisha-comet`), so the bot can be
  trialled without moving the website.
  Explicit ids pick a provider for side-by-side tests: `voicelab/<model>`
  (VoiceLab, needs only the key, never falls back) and `openai/<model>`
  (bypasses VoiceLab), e.g. `/api/admin/model-ab?a=voicelab/aisha-comet&b=openai/gpt-5.6-luna`.
- `src/ai/voicelab-speech.js` — Telegram voice via VoiceLab (`@voicelab/sdk`).
  STT: a voice note is transcribed, echoed back ("🎙 Savolingiz: …") and
  answered by the agent like typed text; on by default with the key
  (`VOICELAB_STT=off` to stop), and on failure the note goes to the human
  queue as before. TTS: a question asked by voice is also answered as a voice
  note in `VOICELAB_TTS_VOICE_ID` (off without it). TTS returns WAV; it is
  transcoded to OGG/Opus with `ffmpeg-static` so Telegram shows a voice
  bubble, else sent as WAV audio. Master-only checks:
  `/api/admin/voicelab/voices?language=uz`, `/api/admin/voicelab/tts?text=…`.
- Telegram: a linked staff account's own messages (role master, lawyer or
  student — `src/bot/telegram-roles.js`) are never treated as questions. A
  linked customer (role `user`) or an unknown role is an ordinary user. An
  account counts as linked by `telegram_chat_id` (/link) or, in a private
  chat, by `telegram_user_id` (registration, the site's Telegram linking).
  `/testmode` (master only, in memory, auto-off after 12 h) lifts that for one
  chat so the owner can try the bot, voice included, from his own account.
- `src/rag/subscription-tiers.js` — plans (bepul, sinov, silver, gold,
  platinum), daily limits, opinion credits and the margin maths.
- `src/workspace/` — Platinum Workspace: routes, authz, Supabase
  realtime/storage, Workspace AI.
- `public/` — static pages: `index.html` (landing), `login.html`,
  `dashboard.html` (the app), `ai-dashboard.html` (the design reference the
  dashboard follows), plus tariff, attorneys, templates, legal pages.

## Frontend rules

- **Design source of truth:** `docs/brand/*.dc.html` canvases and
  `docs/design-handoff/` (`ANIMATIONS.md` lists which animations exist — do
  not invent new ones). Match the rendered canvas, not its inline declarations;
  the canvas runtime overrides some of them.
- **Type: one face, Space Grotesk, everywhere** (owner's decision, Sept 2026;
  it overrides the dashboard canvas's Inter / Source Serif 4 / JetBrains Mono
  split). It is self-hosted: `public/css/fonts.css` declares it from
  `public/fonts/space-grotesk/` and sets every font role from `html:root`;
  every page links that file — a new page must too. Do not add Google Fonts
  links or literal font names; use `var(--font-sans)`. `tokens.css` keeps the
  prototype values because `tests/design-tokens` checks them; `fonts.css`
  overrides them. Figures keep `tabular-nums`; code stays monospace.
  Space Grotesk has no Cyrillic — Russian falls back to the system sans.
- **Three token systems coexist:** `--jai-*` (`redesign-v2.css`, on `:root`),
  `--ws-*` (`workspace.css`, declared on `.workspace-app` only — they do not
  exist outside it), and `--fg/--bg/--accent` (`design-tokens.css`).
  `tokens.css` + `dashboard.css` are scoped to `#db-root`. Use a token only
  where it is actually defined.
- **Shared classes:** before styling a class, grep where else it is used.
  `.form-subtitle` on login, for example, is shared between form subtitles and
  the Telegram note; give an element its own class rather than changing the
  shared one.
- `[hidden]` loses to any class that sets `display`; pages carry an explicit
  `[hidden]{display:none!important}` for that reason.
- **`dashboard.html` DOM contract:** the page's own scripts look up 222 ids and
  34 classes. A restyle must not drop any of them — markup changes are
  presentation only; handlers, ids and data flow stay.
- Workspace: a task created in List must appear in Timeline (Gantt) and Graph
  without a reload; all three read from `/workspaces/:id/tasks`.
- Login wordmark: `wordmark-motion-white.webm` (VP9 + alpha) on browsers that
  keep the alpha; everywhere else (iOS Safari, or autoplay refused) the
  animated `wordmark-motion-white.webp` made from the same video. Regenerate
  both from one source if the animation changes, or the two will drift.

## Security

- Never commit `.env` or anything like it. `.env.txt` once leaked a bot token
  and `JWT_SECRET`; both were rotated. Secrets live in Render's environment.
- Session cookies are signed with `SESSION_SECRET`, falling back to
  `JWT_SECRET` — keep both set in production.

## Shell gotcha

`pkill -f <pattern>` matches the shell running it when the pattern appears in
the same command line, and kills the session's own shell (exit 144). Kill by
PID instead.
