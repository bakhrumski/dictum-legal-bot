# JuristAI — notes for Claude Code

JuristAI is an Uzbek legal assistant: a Telegram bot plus the juristai.uz web
app (new app at `/app/`, master admin at `/app/#/boshqaruv`; the old
`dashboard.html` is still served). The repository is `bakhrumski/dictum-legal-bot` (the name predates the
brand). One Node process runs both: `index.js` loads `src/api/server.js`, which
starts Express and the bot.

The owner writes in Uzbek; answer in Uzbek unless asked otherwise.

## Working agreement

- **Branches and services (since 2026-10-20, owner's decision):**
  - `staging` → Render service **"juristai-staging"**, which now serves
    **juristai.uz** (the new design: landing + `/app/`). Database: Supabase
    `juristai-staging-pro` (it started as a copy of production and is now the
    live database). The Telegram bots run here too. **A push to `staging` is
    a release** to juristai.uz.
  - `main` → Render service **"JuristAI"** (the old design, no custom domain,
    the old production database). It lags behind `staging` and is brought up
    to date only by a `staging` → `main` PR. It must not run the same
    Telegram bot token as "juristai-staging" (two pollers get 409 Conflict).
- **After every push, check whether the branch has an open PR.** If it has
  none, open one and give the link. A push without a visible PR has been
  missed more than once; do not assume.
- **What may go live on `staging` is split by what the change touches:**
  - Frontend only (`public/**` — HTML, CSS, client JS, images, fonts, media):
    push or merge to `staging` yourself once verified, then report it.
  - Anything else — `src/**`, `migrations/**`, `scripts/**`, auth, payments,
    tariffs, database, `package.json`, config, tests, docs: work on a branch,
    open a PR into `staging` and **ask before merging**. The answer pipeline
    (`/api/legal-chat`) is not changed without the owner's consent.
  - `staging` → `main` PRs: **ask before merging**.
- The live database is read-only for Claude: queries only, no writes.
- If the branch's PR has already been merged, restart the branch from
  `origin/staging` (or `origin/main` for a `main` PR) before new work; never
  stack commits on merged history.
- Verify visual work in a real browser at desktop and phone widths (~390px)
  before calling it done. Report what was checked, and say plainly what was
  not (e.g. no real iPhone available — Safari behaviour was simulated).
- The owner's design rules for the new app: no coloured left-stripe cards;
  a coloured text background only in light blue.

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

## Roadmap

- **Legora darajasi (2026-10-27, owner: "oxirgi bosqichga olib borishimiz
  kerak"):** `docs/roadmap/legora-darajasi.md` is the single list of stages
  and PRs. Tick it and add a journal line with every merge. The current
  design is `docs/design/matter-va-agent-runs.md` (Matter, `agent_runs`, the
  planner agent); no code starts until the owner answers its section 8.
  Adaptive account and self-improvement (2026-10-28, owner): design
  `docs/design/adaptiv-akkaunt.md` (draft) - personal adaptation (profile
  from text-free signals, visible and editable, matter facts the person
  confirmed) apart from platform improvement (only through a lawyer queue
  and the reviewed evaluation set); sources and the claim guard never
  adapt, no fine-tuning on user data. Accepted (#509); the owner's answers
  are in its section 9. PR A1 (2026-10-28): migration 022 (`user_signals`,
  `user_profile`), `src/adaptive/profile.js` - a signal is a code only
  (area, lex.uz act id + title, script, lang, service, built-in playbook
  key), never the text of a question, answer or document; recorded after a
  web-chat reply is sent (`answerRecorder` on `/api/legal-chat`; the route
  only sets `res.locals.answerTopic`), after a delivered Telegram answer to a
  linked account, and when an agent run ends done; the profile is computed
  with no AI (half-life 60 days, signals kept `USER_SIGNALS_DAYS` 180,
  `manual` wins, `paused` records nothing, `ADAPTIVE=off`); account deletion
  removes it. PR A2 (2026-10-28): `src/adaptive/routes.js` - GET/PUT
  `/api/adaptive/profile` (`manual`: answerLength, script, hidden areas /
  acts, partyRoles from a fixed role list - the side is only ever set by
  the person), `POST .../pause`, `POST .../clear`, `GET /api/adaptive/signals`
  (own codes, newest first); page `#/moslashish` (`public/app/adaptive.js`,
  a tile on Hisob). `effectiveOf` drops hidden items and puts what the person
  set on top. Nothing uses the profile yet (A3 UI, A6/A7 answer and search later).

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
  `src/rag/document-explain.js` (2026-10-07) is the document explanation:
  text PDFs carry `[Sahifa n]` marks (never billed, `contentChars`), the
  long-document digest (shared with opinion and chat) keeps attribution,
  qualifiers, exceptions and recommendation authors and names parts it could
  not read, and the answer is checked with no AI call for figures, dates,
  pages and clauses not in the source (mechanical only: never meaning or
  legal correctness, and every answer says so). Page marks never move a
  unit or a threshold (contentChars) but stay in the provider input and its
  cost. A document not read whole (a digest part failed or was cut) is not
  the service: explanation, opinion and chat analysis are marked partial at
  the top and their units released; a whole reading whose answer was cut is
  marked partial and paid. The "AI izohi" is held to the same rules and is
  optional (an empty or placeholder note is not shown). The mechanical check
  removes nothing: the main text and the AI note are checked by the same
  criteria (figures, dates, pages, clauses, and status / consequence /
  ranking / "now" phrases the source does not use, unless denied,
  conditional or a synonym of the source's word) and flagged "check by hand
  against the source" - a missing word is never proof of an error, and no
  section is shown as verified (`check.verified` is always false).
  Long documents (2026-10-07, after a 51 398-char DOCX had all 5 digest parts
  stop at the 1 600-token cap): parts of 8 000 chars (grown only so 13 cover
  120 000), a compact one-line-per-item digest, the cap unchanged; a part cut
  at the cap is re-read once in halves within `DIGEST_LIMITS` (4 extra calls,
  75 s, 8 at a time); a part still cut is not used at all (not even its
  fragment) and is named; no part read whole -> no final call, 422
  `DOCUMENT_NOT_READ`, units released (explanation, opinion, chat
  analysis). Ledger: stage `document_digest` vs `document`, `finish_reason`,
  `truncated`, `call_detail`, `ai_requests.doc_coverage` (coverage is
  technical: all_read / some_excluded / none_read, `not_recorded` when the
  column is missing - never "complete"; the writers drop a column they
  cannot write rather than lose a row). The request budget is atomic under
  parallel calls: a call slot and its cost (bound, else the list-price
  `planUsd`) are taken in the same step as the check; a call with neither
  is limited by count only, so `AI_REQUEST_MAX_COST_USD` is not a hard
  dollar cap (VoiceLab credits unconfirmed). Past `AI_REQUEST_MAX_MS` no
  call starts; running calls finish and are written.
  Scope (2026-10-08, the #421 live run lost "including X", "declared and
  unpaid", criteria, a condition precedent, cumulative remedies and
  contradictory clauses): the digest and final prompts keep scope words,
  conditions precedent, a defined term's criteria and every remedy of one
  breach; `scopeLines` picks the document's own lines with scope words (no
  AI, max 25) and `conflictCandidates` finds same-matter sentences with
  different figures across the whole document (no AI) - both go to the
  final call as input only, with the list's limit stated (candidates,
  selected, not fitted, shortened); scope words the answer drops are
  flagged. The stage `trace` (digest, scope lines, raw answer) is returned
  only on `trace: true` to an account that is master in the database, with
  `no-store`, never logged or stored (dashboard: the master-only "🔬
  Diagnostika" toggle under the attached document, then "JSON yuklab olish";
  kept in the tab's memory only; `window.__JAI_TRACE = true` still works);
  `scripts/explain-trace.js` reports word-for-word presence per stage -
  never that meaning was kept or lost.
  Relations (2026-10-08, the #422 live run moved periods, conditions and
  statuses to other acts): `src/rag/clause-relations.js`, no AI, warning
  only - a period or date tied to another act, an act denied/done where
  the source says otherwise (filing is not registration), reversed order,
  "or" for "and", possible damage stated as caused, a definition's
  threshold as a penalty, a defined term missing criteria; the digest line
  is `<clause> | <who> → <act> | shart: | muddat: | istisno: | oqibat:`,
  and the trace script reports per key clause which relation slots each
  stage keeps. The key-line list (max 40 lines, still 6 000 chars) also
  takes relation lines and sends a line the model already has word for
  word as a reference (`[matnda]` / `[dayjestda]`), not a repeat. A denial
  or an "if" counts only for its own claim (a period, amount or act inside a
  conditional is still checked; only the condition itself is hypothetical);
  results on the synthetic `evalSet` (`scripts/explain-relations-eval.js`)
  hold for that set only. Digest fit: parts cut at a clause start, the
  overlap marked `[KONTEKST]`, and a part predicted (no AI, uncalibrated,
  `predictedTokens` in the ledger detail) at or over the cap read as halves
  from the start within the same `maxExtraCalls`. A trace carries the
  page's `traceTag`, the `requestId` and the document's sha256; the page
  drops an old trace on a new chat, session, file or switch-off
  (`createVerifyMaster` is the one database check). Clauses are joined
  as repeats only when nothing but their list number differs
  (`repeatKey`); a part may run on to its line end (<= 5%, never one more
  chunk), and a clause still cut between parts makes coverage
  `read_with_splits` (never `all_read`), named in the digest text.
  DOCX tables (2026-10-08, `src/ocr/docx-text.js`): read row by row with
  system markup (`⟦Jadval N · M-qator⟧`, `⟨header⟩`, `⟨↑ …⟩`, `⟨bo'sh⟩`),
  falling back to mammoth if any text would be lost; the markup is never
  billed (`contentChars` strips it, the server signs its own measure into
  the doc ticket as `chars`, `billableChars` uses it; without a ticket the
  markup counts). Digest -> answer signals, two periods for one matter,
  "may" stated as "must" and a table value on another row are mechanical
  signals only (they flag, they do not correct; two periods are a mismatch
  candidate, never a confirmed contradiction); the ticket binds the size to
  the exact text (sha256) - another text is re-measured; when the table
  reader misses a word, mammoth's text is used and the tables are reported
  `lost` (extract `tableStructure`, ticket, `coverage.tables`, a note under
  the answer); a row reading is never called proof of correct cells;
  contradiction candidates need the same object, role,
  base, act and stage; `[Qism n/m]` labels are not figures.
  Second live run (2026-10-09): digest parts are sized by predicted OUTPUT
  tokens (500 + 1.2 per word, fitted to that run's uncut calls, cut calls as
  lower bounds only; uncalibrated) to 75 % of the cap; a document that needs
  more than 13 parts, or a part still at the cap, is `density.fit 'over'` -
  limits never grow to fit. Cut parts are re-read by an uncalibrated
  priority (referred annex/table, rows, figures), each decision in
  `coverage.reread`. DOCX fallback causes are read from the XML (codes to
  ticket/coverage; the words to a DB master only, `no-store`;
  `scripts/docx-table-check.js` runs locally). The word check counts a
  word that differs only by a space or a line break (mammoth drops `w:br`:
  "shartnomaga1-ilova") as `separatorOnly`, not lost - only when the other
  side holds the same letters and digits as neighbouring spare words; any
  other word, number or repetition missing still sends the text to mammoth. Digest -> answer and period
  checks compare only the answer sentence on the same clause; a weak match
  is "mos band aniqlanmadi", never a change. Key lines carry a source id
  bound to the document (`[S12·a3f9]`, src/rag/source-quotes.js): the server
  quotes the document's own sentence (found verbatim, never a digest line)
  under the model's sentence, refuses ids it did not issue, and runs the
  mechanical checks on the model's words without the quotes - a quote is not
  a check of the explanation; no extra AI call. A bracket may list ids or a
  range (`[S1·k, S2·k]`, `[S3·k – S9·k]`, opened id by id, a range over
  `RANGE_MAX` named, never dropped); only system ids leave the figure check;
  a table-row source is the whole row with headers and empty/merged cells;
  `check.quotes.usage` lists issued / used / repeated / refused /
  unprocessed / unused ids and the page adds `quotesOpened` to the trace. Quality is unconfirmed until the lawyer-reviewed
  benchmark (`docs/quality/explain-benchmark.md`) runs.
  Evaluation-only runners (never loaded by the server; dry run, no network
  by default): `scripts/explain-ab.js` (#430, digest vs full text) and
  `scripts/provider-eval.js` (2026-10-11: comet + DeepSeek, GLM, Kimi, Qwen
  on 3 synthetic documents, `docs/quality/provider-eval-plan.md`; `--task
  opinion` runs the legal opinion prompt, which lives in
  `src/rag/legal-opinion.js` shared with the route, with an empty KONTEKST); both
  share one budget module (`scripts/lib/eval-budget.js`). Live needs the
  owner's confirmation file and approval of the run sha.
  The explanation's final call goes to DeepSeek `deepseek-flash` with a
  6 000-token cap, then GPT-6 Luna at 8 000, then Gemini
  (`src/ai/explain-router.js`; `EXPLAIN_PROVIDER=default` for the lane
  routing below).
  Live lex.uz search runs a second, bounded round (2026-10-13,
  `LEX_FOLLOWUP` weak / always / off): one cheap call reads what round one
  found and names up to 4 missing acts as lex.uz terms (never a number
  alone, never another site), searched within `LEX_FOLLOWUP_MAX_MS`; any
  failure keeps round one.
  Every lex.uz round has a deadline (2026-10-22, after a Telegram answer
  used ~29 s of AI calls and still reached the 120 s limit before its claim
  check): the request's time (`AI_REQUEST_MAX_MS`) minus
  `LEX_ANSWER_RESERVE_MS` (60 s) for the answer and its checks; no shorter
  cap unless `LEX_LIVE_MAX_MS` is set (owner: answer quality before speed);
  one page is waited for at most `LEX_FETCH_MAX_MS` (30 s); a search past
  the deadline returns what it found. Other `searchLexUz` callers pass no
  deadline and are unchanged.
  Queries (2026-10-22: one question ran 18 searches, 13 found nothing):
  lex.uz finds 2-3 words near each other in the law's word forms and lists
  the newest acts first. The plan searches the question's terms three at a
  time with negative/progressive verbs as verbal nouns (`nominalizeVerb`:
  "bajarmadi" -> "bajarmaslik"), "<2 words> nizom", and codes / laws by
  lex.uz's form filter (`actForm` code 3964 / law 3968, `code-search` +40 in
  ranking); the planner is told the same rules; text searches are in-force
  only (`status=Y`, <= 100 chars); a phrase that found nothing is searched
  once more as its first and last two words, connectors dropped
  (`relaxedQueries`). Live on 10 questions that day: 0 of 110 old
  deterministic searches found acts, 110 of 128 new ones; the AI planner's
  new prompt was not measured (no key here).
  Memory (2026-10-24: with those queries finding acts, one question read 63
  pages, ~60 MB of HTML, in parallel; locally 57 -> 515 MB, the 512 MB
  Render instance went down and the answer never came): at most
  `LEX_FETCH_CONCURRENCY` (2) pages are read at once, the cache keeps the
  text without the page's HTML (`LEX_DOCUMENT_CACHE_LIMIT` 64), and one
  round reads at most `LEX_ROUND_MAX_READS` (48) uncached pages (a shared
  `readBudget`). Same question after: 16 documents kept, 233 MB peak with
  `--max-old-space-size=320` (301 MB without: V8 collects late).
  2026-10-26 (502 on juristai.uz: the log ended at "Downloaded 7665 KB", an
  8 MB decree page with annexes, then npm start): one page at a time
  (`LEX_FETCH_CONCURRENCY` 1), a page over `LEX_PAGE_MAX_KB` (7000: the Tax
  Code is 6 MB) is not read - the download stops - and a plain search
  result over `LEX_PAGE_MAX_KB_OTHER` (2000) neither; codes / laws found by
  form, registry and pinned acts get the larger limit; the cache holds at
  most `LEX_DOCUMENT_CACHE_MAX_CHARS` (8 M) of text. A 6 MB page read costs
  ~100 MB outside the heap; the round's live heap fit in 128 MB.
  Relevance (2026-10-24, owner: quality first; most kept acts only
  mentioned a word): an act form's bonus and lex.uz's row rank count only for
  an act whose title is about the question; an act whose title is not needs
  5 of the question's words (a code or law found by its form, 2); roots meet
  by their start; complaint words are not counted; then one cheap call
  (`buildLexRelevancePrompt`, stage `source_relevance`) keeps the acts that
  govern the question - an unreadable reply or a failure keeps the list,
  `LEX_RELEVANCE_JUDGE=off` stops it. The judge was not measured here.
  Lessons of 22-24 Oct 2026 (lex.uz behaviour, memory, time, reading the AI
  requests table, Telegram/Render settings) with how each was measured:
  `docs/lessons/2026-10-lexuz-va-javob-zanjiri.md` (Uzbek);
  `scripts/lex-round-probe.js` replays one lex.uz round locally (live lex.uz,
  no AI): time, event-loop block, peak memory, pages, documents kept.
  Answer sections (2026-10-24, owner: "Huquqiy asos" repeated Tahlil and
  Xulosa): two, **Tahlil** (opens with the deciding norm - name, number,
  article, the quote - and applies it, each norm once) and **Xulosa** (1-2
  sentences, the direct answer and next step, never repeating Tahlil), in
  every legal-answer prompt (`buildTopicPrompt` for chat and Telegram, the
  search prompt, the Gemini fallback, advanced RAG, playbook 1.5.0);
  `tests/answer-layout.test.js`.
  Exception first (2026-10-27, owner: an IT Park answer cited VMQ-589 band 5
  and said no exemption exists; band 17 of its regulation grants one): an
  act the server identified itself (pinned, or the number asked) opens its
  excerpt with `SAVOLGA ENG YAQIN QATOR (<unit>)` - the line with the most
  question roots (5-letter starts, common words out, the unit's heading
  counted), +2 for an exception or a right (`findKeyLine`, no AI; not on
  general questions, where it misled: a Labour Code strike line for unpaid
  wages); every legal-answer prompt has `exceptionRule` - an exception or a
  right in the sources comes first, "no exception" only after reading all
  sources. `tests/answer-key-line.test.js`.
  Answer polish (2026-10-27, owner): a citation with no known part is
  "N-modda" alone, never "tegishli qism" (prompts, `citationLocatorLabel`;
  a cached "..., tegishli qism" link still survives); a verified quote's link
  names its act and unit (`quoteSourceLabel`: "VMQ-589, 17-band · lex.uz ↗");
  the claim guard puts the sources holding an exception first for an
  absence claim (VMQ-589 band 17 had fallen past the 14 000-character
  evidence limit) and its notice names such a claim as a claim, still saying
  "not found is not absent from the law" (`tests/claim-guard-exception.test.js`).
  Answer layout (2026-10-13, `src/rag/answer-structure.js`, no AI): a `> «...»` quote of the
  law is kept only when its words are in a retrieved source word for word
  (spaces, case, apostrophe forms aside; "..." parts in order in one
  source), shown in the source's own words with a "lex.uz ↗" link that
  highlights it, else removed and counted (`rag.quotes`); quote lines are
  set aside while citations are linked. The `KEYINGI SAVOLLAR:` block (max
  2) leaves the answer: web chat `followUpQuestions` buttons, Telegram a
  short list, Workspace drops it.
  `src/rag/question-aspects.js` splits a question into deadline,
  compensation, evidence and remedy and runs a light corpus search for each
  (Telegram, web chat, Workspace).
- `src/privacy/crypto.js` (2026-10-29, data protection stage 1 / E1,
  `docs/design/shifrlash-1-bosqich.md`, accepted with all proposals): AES-256-GCM
  at rest, key ring `DATA_KEYS` = {"v1":"<32 bytes base64>"} + `DATA_KEY_ACTIVE`
  (env only; `scripts/data-key.js` makes one; the owner keeps an offline copy -
  a lost key is lost data). `seal`/`open` (text `enc:<id>:…`), `sealJson`/`openJson`
  ({"enc":…} for JSONB), `sealBytes`/`openBytes`; the AAD
  `<table>.<column>:<row id>` binds a value to its place; plain values pass
  through (columns switch row by row); a bad ring stops the server at start,
  an unset one is a warning (stored unencrypted). E2a (2026-10-29): sealed now -
  `document_scans.text` (AAD `document_scans.text:<admin>:<hash>`) and the
  interview audio, transcripts, consent and summary; `scripts/seal-backfill.js`
  seals older rows (dry run by default, `--apply` is the owner's). E2b
  (2026-10-29, migration 030): `tg_conversations` turns / context (AAD by
  chat), `matters.summary` and `matter_items.note` (a note's title is "Yozuv",
  not its first words, while sealing is on), `agent_runs` input / plan / result
  and `agent_run_steps.output` (the run store opens every row it returns;
  answers, the Telegram target and row tags are read, opened, changed, sealed
  and written back only while unchanged; `openResult` for the matter export),
  `service_orders.intake_data` and `attorney_consultation_requests.case_summary`
  (row first, then the sealed value, in one transaction; `openOrder` for the
  master's list and the quote message), `answer_feedback` and `chat_messages`
  (AAD by author), `agent_traces` (AAD by request and agent); `answer_cache`
  since E4. Not sealed: the Workspace (E5). E3 (2026-10-29,
  `src/privacy/redact.js`, no AI): before a text call leaves for a provider,
  passport / JShShIR / STIR (next to its word) / phone / card (Luhn) / account /
  email / car plate / the account holder's own full name and names after
  "F.I.Sh." / "fuqaro" become `[PASPORT_1]`-style placeholders, put back in the
  provider's answer (so word-for-word quote checks still see the original);
  amounts, dates, articles and act codes are never touched; one map per
  usage-ledger request (memory only), the call's ledger `detail.redacted` holds
  counts. Hooked in `callOpenAI` (every provider behind it), `callGemini` and
  the explanation router (`createWrapper`). E4 (2026-10-29): also
  `callOpenAIStream` (each streamed piece restored, a placeholder split
  across pieces held until whole: `createStreamRestorer`) and the hybrid
  pipeline (`callWithFallback`, `content` messages); the legal-answer
  pipeline (`/api/legal-chat`, `/api/rag/*`, the Telegram bot) is redacted
  only with `REDACT_LEGAL_CHAT=on` (default off until the owner has read the
  20-question before/after) or a database master's `X-JAI-Redact: on|off`
  for one request (that request skips the answer cache). A name found after
  "F.I.Sh." / "fuqaro" is hidden wherever else it is written. Before/after:
  `scripts/redaction-eval.js` (dry: rules on `docs/quality/redaction-eval/cases.json`,
  20 synthetic questions; live: each asked off / on through a running
  server as a master, `REDACTION_EVAL_LIVE=yes`, `--approve <runSha>`,
  `--out`; the comparison is mechanical - articles, acts, placeholders left,
  length - a lawyer reads the pairs). `answer_cache.reply` is sealed (AAD
  `answer_cache.reply:<key>`, in `seal-backfill.js`); `opinion_cache` is
  created but never written, so nothing to seal. Not yet: embeddings /
  rerank, images and audio. `REDACT_AI=off` stops it all.
  E5 (2026-10-29, migration 032, `src/workspace/sealing.js`): Workspace task
  comments, room chat, direct messages, Workspace AI questions / answers /
  context snapshots and document version text / JSON are sealed (AAD by
  Workspace and its task / thread / document; the 20 000 / 4 000 limits moved
  to the routes); uploaded files are sealed before Storage (the row keeps the
  original size and sha256) and downloaded through the server
  (`GET /api/workspaces/:id/document-files/:fileId/content`, opened, checked
  against the sha256; the page's `document-download-url` now returns that
  path; without DATA_KEYS a Storage-signed URL as before); the members'
  direct Storage INSERT policy is dropped. Realtime was already a signal
  (both pages re-read through the API); its rows now carry sealed text.
  `seal-backfill.js` covers the columns and, with `--files`, the Storage
  files. Not sealed: task titles / descriptions and `workspace_memory_items`
  (searched in SQL; §3.2 - the memory item's title is the question's first
  240 characters and its body the answer). Fixed on the way: every new
  Workspace AI answer failed at finalization (`reused_memory_item_id` got
  text) and the memory-reuse path had uneven VALUES rows.
  `tests/sealing-workspace.db.test.js`.
  E6a (2026-10-29, migration 033, §3.2 and §9 answers 1 / 6): web chats
  (`ai_chat_sessions.messages`, AAD by account, `src/privacy/chat-sessions.js`)
  are sealed; the list reads the readable title - identifiers hidden by the
  redaction rules - and a stored `message_count`, never the messages; the
  bot's Telegram turn is appended by read-modify-write under FOR UPDATE. The
  human queue's `requests.request_text` / `response_text` (AAD by request id;
  the bot inserts the row, then writes the sealed text in the same
  transaction) and `ai_analyses.request_text` (AAD by author) are sealed, with
  a blind index `request_bidx` (`src/privacy/blind-index.js`: HMAC of
  5-character word roots, both alphabets folded, key derived from DATA_KEYS
  with HKDF - `DATA_BIDX_KEY_ID`, else the first id in sort order, so a
  rotation does not move it) that the staff search uses with ILIKE for old
  plain rows (whole roots, every word; never part of a word). Learning sets
  (mentor feedback, verified QA, the legal dataset) are written with
  identifiers hidden. `seal-backfill.js` covers them (index and count
  included; `--tables` limits a run). `tests/sealing-e6.db.test.js`.
  E6b (2026-10-29, migration 034, §5 / §6 / §9 answer 4): the access log
  (`src/privacy/access-log.js`, table `data_access_log`) - a staff account
  (master, lawyer, student) opening another person's sealed data leaves one
  row per person: who, whose ('account' / 'telegram_user'), table, route,
  rows seen, when - never the text; one's own data and ordinary accounts are
  not logged; `ACCESS_LOG=off`. Hooked: the human queue (list, single,
  export), the AI analysis archive, paid service orders, interview
  recordings. Boshqaruv -> "Kirish jurnali" (`/app/#/boshqaruv/kirish`,
  `GET /api/admin/access-log`, master only). "Not to DeepSeek"
  (`src/privacy/provider-choice.js`): the Moslashish page's checkbox sets
  `user_profile.manual.noDeepseek` (off by default, kept by "clear" and a
  pause); while on, `tryDeepSeek`, the hybrid pipeline and the explanation
  router skip DeepSeek for that account (the lane's GPT-6, then Gemini
  answer); a Telegram request carries its linked account in
  `shared.accountId` (the ledger's user is unchanged). The landing, the tariff
  FAQ and the Moslashish page name the providers (DeepSeek - China; OpenAI,
  Google - USA; VoiceLab - Uzbekistan) and the switch.
  `tests/e6b-access-provider.db.test.js`. Next: E7.
  `tests/privacy-crypto.test.js`, `tests/document-library.db.test.js`,
  `tests/sealing-e2b.db.test.js`, `tests/privacy-redact.test.js`,
  `tests/redaction-eval.test.js`.
- "Hujjatlarim" (2026-10-29, owner: every uploaded document stays for later
  actions until the person deletes it; migration 029): `document_scans` is the
  person's library - a text Word/PDF read by `/api/analyze/extract` (it now
  returns `docId`) and every OCR scan are kept (`library`, `expires_at`
  'infinity', never shortened by matters, never purged; `DOC_LIBRARY_MAX` 500,
  then the old 7-day cache with `libraryFull`); one row per account and file.
  Services use a document by its id through `resolveScans` (`scanId(s)`; a
  `text` kind is billed as text, not as a scan; `last_used_at`). The text never
  goes back to the browser. `/api/documents` (list without text, rename,
  delete for good), page `#/hujjatlarim` and the "Hujjatlarim" picker in the
  composer's attach menu and on Hujjat tahlili (`public/app/library.js`).
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
- `src/ai/deepseek.js` — DeepSeek `deepseek-flash` is the FIRST choice for
  every text call (2026-10-12, owner's decision after the provider
  evaluation): chat (streamed too), Telegram, legal opinion, document
  analysis, digests, helpers - hooked in `callOpenAI` / `callOpenAIStream`
  (`tryDeepSeek`) and the hybrid pipeline's `callOpenAIModel`. Thinking off;
  the cap sent is the caller's x2 (`DEEPSEEK_MAX_TOKENS_FACTOR`, at most
  `DEEPSEEK_MAX_TOKENS_CAP` 16 000). A failure goes to the lane's GPT-6, then
  Gemini; VoiceLab text lanes are skipped while DeepSeek routes them; explicit
  `voicelab/` / `openai/` ids keep their provider. Not for images, OCR,
  vision or embeddings. On when `DEEPSEEK_API_KEY` is set; `DEEPSEEK_ROUTING=off`
  (env) turns it off. Each call is a ledger row with a bound (peak price,
  `model-pricing.js`). Users' text and documents go to api.deepseek.com.
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
  `VOICELAB_PRICES` (JSON, USD/1M). Orbit spent whole helper budgets on hidden
  reasoning (completion = reasoning = 1024 tokens, empty text), so retrieval
  grade and query plan run on the cheap lane (`RAG_CORRECTIVE_MODE`,
  `LEX_PLANNER_LANE`, `standard` to revert); no max_tokens floor
  (`VOICELAB_MIN_MAX_TOKENS` off) and no reasoning parameter, none being
  documented; reasoning text is never used as an answer. Such an error
  carries the billed usage and token counts into the ledger. `MODEL_TELEGRAM` sets the Telegram
  answer model on its own (e.g. `voicelab/aisha-comet`), so the bot can be
  trialled without moving the website.
  Explicit ids pick a provider for side-by-side tests: `voicelab/<model>`
  (VoiceLab, needs only the key, never falls back) and `openai/<model>`
  (bypasses VoiceLab), e.g. `/api/admin/model-ab?a=voicelab/aisha-comet&b=openai/gpt-5.6-luna`.
- `src/ai/deepseek.js` (first for text since #442; `deepseek-flash` is
  V4.1 Flash since 2026-09-10; `deepseek/deepseek-v4-pro` and
  `deepseek/deepseek-flash-thinking` - thinking on, effort high - by explicit
  id only) and `src/ai/zai.js` (GLM, explicit `zai/glm-5.3-flash`
  only): see `docs/ai-routing.md`. Legal opinion: paid plans on
  `openai/gpt-6-sol`; `OPINION_MODEL`, `OPINION_MODEL_<PLAN>` and
  `OPINION_FALLBACK_MODEL` pick the models. A provider error is scrubbed of
  the key before it is logged.
  DeepSeek Search / Fetch (2026-10-27, owner: a Boshqaruv button; evaluation
  only, nothing in the pipeline uses them): `/app/#/boshqaruv/sinov` ->
  `POST /api/admin/deepseek-tools-eval` (master, `no-store`, one run at a
  time, 503 without `DEEPSEEK_API_KEY`), `src/services/deepseek-tools-eval.js`:
  5 questions with a known governing act - our lex.uz search pages (the
  pipeline's plan: AI planner terms, code / law by form, relaxation; no act
  downloaded) vs DeepSeek Search with `site:lex.uz` (place among 10) - and
  Fetch of VMQ-589, the Civil and Tax Codes (whole? the deciding line?);
  13 requests, each a ledger row (stage admin_test) priced per successful
  request (`REQUEST_PRICES`, $0.75 / 1 000, billed from 2026-11-01).
  A master can try any of them on the platform with no env change: the
  dashboard's "🧪" picker (`public/js/test-model.js`) sends
  `X-JAI-Test-Model`, applied by `src/ai/test-model.js` only for a database
  master and that one request (digest excluded); customers never see it.
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
  Account actions (2026-10-20, `src/agents/account-tools.js`): typed or
  spoken (voice -> `src/ai/stt.js` -> the same agent), "limitim qancha?",
  "tariflar", "oxirgi savollarim", "akkauntni ulash", "ilovani och", "nima
  qila olasan?" are fixed read-only tools (intent `hisob_amal` + `action`;
  phrase list first, then the intent model; an unknown action is answered as
  a question): the caller's own balance, the catalogue, their last 5 bot
  questions, links. No AI call, no quota; nothing is paid or granted - such
  a step stays a link the person confirms on the site. "Akkauntni o'chir"
  (`delete_account`) is never a legal question: the bot explains what is
  removed, a button files one pending request per Telegram user
  (`src/services/account-deletion.js`, table `account_deletion_requests`),
  and a master carries it out or declines it with a reason in
  `/app/#/boshqaruv/ochirish`: personal fields scrubbed, web chats deleted,
  sessions revoked, bot texts replaced; tariff, usage and payment rows kept
  without personal data; staff accounts refused.
  A document order waits for its details 30 minutes (`DOC_INTAKE_TTL_MIN`,
  `intakeAt` stamped by `setConversationState`; 2026-10-22: a legal question
  asked 2.5 hours after choosing "Da'vo arizasi" was taken as the order's
  details); after that, or on its "❌ Bekor qilish" (`docin_cancel`), the
  next message is a new one. The intake texts name both ways (AI draft now,
  lawyer priced by the lawyer, nothing paid until agreed).
  Also since 2026-10-20 (landing promises): a linked account's bot Q&A is
  appended to its web chats (`src/services/telegram-history.js`, topic
  'telegram', one per Tashkent day); a paid document order in the bot can be
  drafted by AI as .docx for 1 `draft` unit (button `tgdraft_ai`); Workspace
  task status changes and due-today/tomorrow reminders go to linked members
  by the bot (`src/workspace/telegram-notify.js`, hourly, deduplicated in
  `workspace_telegram_reminders`, title/status/date only,
  `WS_TELEGRAM_NOTIFY=off`); a voice recording's summary can be sent to the
  user's own Telegram (`POST /api/voice/send-telegram`). Voice minutes are
  not metered (`/api/voice/balance` says so; no "X minutes" anywhere).
  Linking (2026-10-21 audit): `ulink_` refuses a Telegram held by another
  account in either column (the way out is `/unlink` in that chat) and
  detaches the account's old chat; `/unlink` clears both columns (private
  chat only); `/link` is private-only with 5 tries / 15 min; the site's
  link status reads the columns. A linked account gets the plan in the bot
  when granted and 3 days / 1 day before it ends (`src/services/plan-notify.js`,
  `tariff_expiry_notices`, `PLAN_NOTIFY=off`). Dictation: the chat's 🎙 button
  -> `POST /api/voice/dictate` (<= 2 min, measured, not metered, rate-limited,
  `VOICE_DICTATION=off`); the text lands in the box, never sent by itself.
  Recordings transcribe only with `VOICE_NOTES_ENABLED=true` (customers also
  `VOICE_NOTES_USERS=true`) and an STT engine; the page says which is missing.
  Account help (login/OTP/password) is matched only on unambiguous account
  words, never "hisob…" in a legal question ("hisoblash" once routed wage
  questions to password reset). `/testmode` (master only, in memory, auto-off after 12 h) lifts that for one
  chat so the owner can try the bot, voice included, from his own account.
  Since 2026-10-13 a master in /testmode asks with no Sinov, limit or credit,
  like the test account below (`resolveMasterTestMode`): master role read
  from the database, own private chat, the 12 h session as the window, its
  own budget `TG_MASTER_TESTMODE_BUDGET_USD` ($5); `TG_MASTER_TESTMODE_UNLIMITED=off`
  restores the limits. Since 2026-10-22 (owner) that master also gets the AI
  draft and the claim agent with no unit and no Stars (`masterDraftTest`):
  nothing reserved or committed, the calls under the same test budget; a
  spent budget falls back to the ordinary rules.
  Separately, one ordinary (role `user`) account can be a test account
  (`src/bot/test-account.js`, `TG_TEST_ACCOUNT_*`): by the Telegram user id
  linked in `admins.telegram_user_id`, never a username; no daily limit or
  credit, but every check, the one-answer-at-a-time reservation and the
  per-request limits stay; its spend (ledger rows of its chat) has its own
  budget ($5 default, unknown cost priced at an assumed rate, never $0) after
  which the ledger refuses new calls; ends 48 h after `TG_TEST_ACCOUNT_SINCE`.
  Status: `/api/admin/telegram-test-account?username=…` (master only).
- Tariffs v2 (2026-10-04, `docs/tariffs-v2.md`): `src/rag/tariff-ledger.js`
  is the single source of prices and limits (`PLAN_CATALOG`: one-time Sinov
  5 chat + 1 + 1; Silver 199 000 / Gold 599 000 / Platinum 999 000 so'm per
  30-day period, Gold 3x and Platinum 5x Silver; no daily/weekly reset, no
  rollover) and of the reserve / commit / release ledger (`tariff_usage` +
  `tariff_periods`, atomic per payer, idempotent by job key). Linked Telegram
  and web accounts share one allowance; Stars credits are a separate balance.
  One-time services (2026-10-21, owner): `src/rag/one-time-products.js` -
  5 questions 15 000, AI draft 29 000, analysis unit 39 000, opinion unit
  49 000 so'm (to be changed with real demand); sold in the bot for Stars
  until Click/Payme are connected (`src/bot/one-time-sales.js`: signed `jsv1`
  invoice, Stars = so'm price at `STAR_PAYOUT_USD` 0.013, rounded up to 10,
  `ONE_TIME_STARS_<KEY>` overrides). A purchase is a `service_credits` row
  (unique charge id; migration 017): used only after the plan's own
  allowance, through tariff_usage rows with no period (`meta.pool =
  'one_time'`), never expires, shared by bot and site; a failed credit
  refunds the Stars; the paid draft or analysis then runs at once. Offered
  after the last Sinov answer, when a limit is spent (with the document the
  last answer pointed to), and when a draft or analysis has no unit. The
  1-Star / 4-answer pack is no longer offered (old invoices still honoured).
  Lawyer services: the lawyer's price is `quoted_price_minor` (so'm); the
  platform's share `LAWYER_COMMISSION_PCT` (0-50, unset = not recorded) is
  written with the quote (`src/services/lawyer-commission.js`); the customer
  gets the price in the bot when it is approved; payment is manual until a
  provider is connected. A delivered AI draft can be sent for lawyer review.
  Master view: `/app/#/boshqaruv/xaridlar` (`GET /api/admin/one-time-purchases`,
  `src/services/one-time-report.js`, read only): purchases, who, Stars,
  catalogue so'm price at the sale (not the Stars payout), units left per
  person and service; refunds listed, never counted.
  Document jobs are sized in units: max(pages/10, chars/40 000), signed PDF
  page counts (`docTicket`), never silently cut. A paid period is granted only
  by `POST /api/admin/tariff/grant` (idempotent `paymentRef`), never by the
  user. Subscriptions sold under v1 keep their rules as `legacy_v1` until they
  end. `src/rag/subscription-tiers.js` keeps the middleware (`enforceQuota`,
  `meterJob`, `meterDocument`), the free-access gate and the legacy rules.
  Every user-facing number (landing, tariff page, bot /start /help /balance)
  comes from the catalogue; `tests/tariffs-v2*.test.js` checks it.
  Economics: `docs/finance/tariffs-v2-report.md`, `scripts/tariff-scenarios.js`.
  A file attached to a chat does not buy a document service
  (`src/rag/document-job.js`): a question about it is one chat unit with
  the matching clauses, their definitions, referred clauses and exceptions
  (<= 20 000 chars, never just the opening pages; when that is not enough
  the answer must say so and not conclude); an analysis takes analysis
  units, a legal opinion opinion units, both are two jobs - each confirmed
  first (409 `DOC_COST_CONFIRM`, `confirmedJob`), never charged as chat too;
  two services are reserved in one transaction before any AI
  (`reserveMany`) and each is settled on its own section of the answer
  (`settleSections`: a delivered analysis stays paid if the opinion fails).
  Workspace does not run full analysis/opinion: such a request is routed to
  the AI section with no AI call and no quota (`createWorkspaceServiceRouting`);
  a clause question is one chat unit. In Telegram a PDF/DOCX (<= 5 MB, text layer) is offered
  for AI analysis for its document units, run only after the button that
  names them (`src/bot/telegram-documents.js`: reserve 'analysis', the
  website's own analysis, commit on delivery, release on failure); the other
  button, and every scan, photo or video, is the lawyer queue (no AI, no
  quota, told plainly, review not promised free). Individual discounts
  (`src/rag/tariff-pricing.js`, `tariff-offers.js`, table `tariff_offers`):
  master only, one user, one plan, one 30-day period, final price >=
  conservative cost / 0.80 (integers, min rounded up to 1 000, floors
  marked unmeasured), unknown cost blocks offers; the zero payment fee is a
  scope (no provider), so an offer is not redeemed through a provider or
  under another fee / cost model; redeemed once by
  `grant { offerId, paymentRef }`; `TARIFF_OFFERS=off` stops them.
  OCR (2026-10-06, `src/ocr/scan-limits.js`, `scan-store.js`) is a step of
  analysis, opinion or chat, never a service of its own: `scan-quote` counts
  pages on the server (no AI) and signs a ticket bound to file hash, account,
  service, size and 15 min; `ocr-image` needs `confirmed`, re-counts, checks
  the free-access gate and reserves the service (held 120 min, adopted by
  the service call) before the provider; it returns a `scanId`, never text,
  and the service endpoints load the text by `scanId` for that account only
  (`document_scans`, 7-day cache, analysis and opinion share one OCR). One
  document: Sinov 10, paid 30 pages. Chat scans draw the plan's `ocr` pool
  in pages (legacy v1: 1 per file). Providers (`scanLimits.ocrProviders`):
  images VoiceLab vision first when that lane is on (as before #411), Gemini
  with `OCR_IMAGE_PROVIDER=gemini`; PDFs Gemini (Developer API, thinking
  off); fallbacks unless `OCR_FALLBACK=off`. A PDF is read in 5-page chunks
  cut with `pdf-lib` (cap 1 536 x pages of the call, every page marked
  `=== PAGE n ===`); a cut or incomplete chunk is re-read in halves, one cut
  page once at 4 096; anything still cut, empty or missing fails the whole
  document - never cached, never analysed, service released, every call in
  the ledger. A cut reading is `providerAnswered` (no retry, no breaker).
  Only the Gemini-only route has a per-page figure ($0.010959 a PDF page, a
  planning estimate - not measured, not a hard maximum; images grow with
  pixels); any route reaching VoiceLab / OpenAI vision makes OCR cost
  unknown: offers blocked and the admin quote says why, nothing else
  changes. Parallel requests for one account and file share one OCR
  (in-process single flight - one Node process only).
  `marginReport` keeps cash (once, at payment), carried credit (not cash)
  and service revenue (price + credit in - credit out over the days run)
  apart; legacy revenue and refunds are unknown, never 0. Rollback is code,
  not data: `docs/tariffs-v2-rollback.md`; the 013 down file is for an empty
  test database only. The pilot runs on a master-only test entitlement
  (`grantTestEntitlement`, 1-336 h = up to 14 days since 2026-10-28, 48 h
  default; quotas and budget cover the whole period; the 14-day CustDev
  pilot's suggested grant is in `docs/tariffs-v2.md` §10;
  `tariff_periods.source = 'test'`: no price, no
  paymentRef, no revenue, admins.tariff_* untouched, spend reported apart)
  with a total AI budget (`src/ai/test-budget.js`): each request holds its
  per-request limit before its first AI call, and inside it every provider
  attempt (retries and fallbacks too) reserves its maximum cost first
  (`model-pricing.callCostBound`: known price, UTF-8 input bound, an output
  cap that also caps reasoning, GPT-6 x2). Strict mode refuses calls with no
  provable bound (Gemini thinking, VoiceLab credits, HF, images, web
  search); 'estimated' mode runs them at a stated estimate as reported risk.
  Not a hard dollar guarantee: it holds only as far as the price table is
  right. Every `usageLedger.track()` call must pass `bound`. Rollback uses
  `MAINTENANCE_MODE=on` (503 on the API, bot notice) before the SQL.
- `src/agents/harness.js` (2026-10-21) — the agentic harness: a workflow is a
  fixed list of steps (tools); the harness enforces `maxSteps` / `maxMs`,
  keeps a trace (label, status, ms, short note - never prompts or raw model
  text), stops on a failed required step or a deliberate halt
  (`needs_input`). First workflow: `src/agents/workflows/claim-draft.js`
  (da'vo arizasi: intake no AI -> issues -> lex.uz retrieval -> basis whose
  quotes must be in the source word for word, else dropped and counted ->
  the drafting generator told to cite only that basis -> mechanical check:
  articles outside the basis, figures not in the facts, missing claim parts;
  warnings only). Route `POST /api/agent/claim-draft`
  (`src/agents/agent-routes.js`): missing facts 422 before any charge or AI;
  1 `draft` unit reserved, committed only when a draft came out. Page:
  `/app/#/agent/dava` (`public/app/agent.js`). In the Telegram bot
  (2026-10-22, `src/agents/telegram-claim.js`, `TG_CLAIM_AGENT=off` to
  stop): a da'vo arizasi order's "AI loyiha" runs this workflow - one cheap
  call reads the free text into the fields (only what it says), missing
  facts are asked for with the unit released and the next message resumes;
  the steps update one message; the .docx, then the basis with lex.uz links
  and the warnings; the unit is committed on delivery. It does not touch
  `/api/legal-chat`. Second workflow (2026-10-22):
  `src/agents/workflows/tabular-review.js` - tabular review, up to 20
  documents x 10 questions: per document the clauses matching the questions
  (`selectExcerpt`, <= 20 000 chars, the row says when a long document was
  read in parts), one AI call per document (4 at a time; a failed document
  is a failed row), each cell's quote checked word for word in the document
  (page from `[Sahifa n]`; unverified cells keep the answer, marked) - a found
  quote proves the words are there, not that the answer is right. Route
  `POST /api/agent/tabular-review`: one `chat` unit per document,
  reserved together (`reserveMany`), committed per row read, released per
  row failed. Page `/app/#/jadval` (`public/app/tabular.js`, CSV export);
  a scan goes through the shared OCR step (`J.readFile` -> scan-quote ->
  confirmed ocr-image, service `chat`: the OCR pages from the plan's pool)
  and is sent as `scanId` (this account's only, from `document_scans`;
  `=== PAGE n ===` marks give the page). Stage 2 (2026-10-28): up to 100
  documents (`TABULAR_MAX_DOCS`, <= 200), 20 MB body; the run keeps the
  columns and each document's excerpt only (`prepareInput`); extraction is
  one checkpointed step per 10 documents; the run carries its own AI limits
  (docs + 8 calls, $0.05 a document, min $1, `TABULAR_RUN_USD_PER_DOC`; 15 s
  a document, <= 20 min); a run stopped by its limits or a cancel shows and
  charges the rows it read and releases the rest (`verifyRows`); a `choice`
  column (2-8 options, an answer outside them is "Topilmadi"); row tags in
  the run's result (`PUT /api/agent/runs/:id/tags`); Excel `POST
  /api/agent/tabular-review/export` (`tabular-export.js`, every cell text,
  never a formula); the page reads files 3 at a time, sends more than 10
  documents `async` and follows them at `#/jadval/<runId>`. Not yet run on
  100 real documents with live AI. Third workflow (2026-10-22):
  `src/agents/workflows/playbook-review.js` - a contract against a firm's
  own rules (not the law): clauses matching the rules (`selectExcerpt`), one
  AI call (mos / farq / yoq / noaniq, the clause's words, a note, a proposed
  wording from the rule's preferred text), quotes checked word for word with
  pages; "mos" with no quote found becomes "noaniq". Four built-in playbooks
  (one side's negotiating preferences, never statements of law); own ones in
  `playbooks` (migration 018, 30 per account, owner-only CRUD
  `/api/playbooks`). `POST /api/agent/playbook-review`: analysis units by the
  contract's size (docUnits, page marks not counted), committed on a
  result; a scanned contract comes as `scanId` from the OCR step for
  `analysis`, and the analysis units that step held are adopted
  (`heldScanJob`) - never charged twice. Page `/app/#/playbook`
  (`public/app/playbook.js`, editor, Word report). In the Word / Google
  Docs pane (2026-10-28, `public/word/taskpane.js`, `shared.js`
  `playbookItems`): the same review; farq / yoq / noaniq become comments
  ("mos" only counted), a found "farq" clause's proposal goes in with Track
  Changes, the rule is written "Qoida:", never "Asos:"; "Ishga saqlash"
  links the run to a matter. The pane token opens `GET /api/playbooks`,
  `POST /api/agent/playbook-review`, `GET /api/agent/runs/:id`,
  `GET/POST /api/matters`, `POST /api/matters/:id/items` (`bearerAllowed`)
  and passes `requireSameOrigin` (a browser never sends it by itself).
- `src/matters/` (2026-10-28, PR-A of the roadmap) — Matters: one legal
  matter and the links to its chats, scans and notes (migration 019,
  `/api/matters`). A link is checked to be the caller's own; another
  account's matter is 404. Attached to a Workspace, its members write and
  viewers read. Paid plans keep 200 open matters, Sinov 1. A scan held by an
  open matter does not expire; 30 days after the last one closes. Account
  deletion removes matters and scans. No AI, no unit; `MATTERS=off`.
- `src/agents/runs/` (2026-10-28, PR-B) — agent runs (migration 020): the
  claim draft, tabular and playbook routes are a service each (`prepare` no
  AI + reservation held with `meta.holdUntil` 45 min, `run` the harness,
  `settle` commit / release and the reply). The route queues an
  `agent_runs` row and waits for it (same reply + `runId`; 202 on
  `async: true` or a long queue); `worker.js` in this process takes runs
  under a 90 s lease (`FOR UPDATE SKIP LOCKED`, `AGENT_RUN_CONCURRENCY` 2,
  one per person), checkpoints each step (`agent_run_steps`), resumes a run
  whose worker died without re-running finished steps, fails and releases
  after 3 attempts; each run is its own usage request (60 calls, 15 min,
  $1, `AGENT_RUN_MAX_*`) and gets the pilot test budget. Input and step
  outputs are emptied when the run ends; results kept 90 days or while a
  matter links them. `/api/agent/runs[/:id[/events|/cancel]]` (own only,
  404 otherwise). `AGENT_RUNS=off` runs in the request as before; the
  Telegram claim agent is not a run yet (PR-F).
- Planner agent (2026-10-28, PR-D): `src/agents/tools/index.js` (matter_context,
  doc_excerpt, lex_search, answer, verify - wrappers of existing code),
  `src/agents/planner.js` (one cheap call, not charged; the server checks the
  plan with no AI: known tools and args, `after` only to earlier steps, <= 12
  steps, <= 4 searches, one answer, verify last, documents only from the
  matter; one retry, then a fixed plan), `src/agents/planner-routes.js`
  (`POST /api/agent/plan` -> a run `awaiting_approval`, nothing reserved;
  `POST /api/agent/runs/:id/approve` reserves the price and queues it; the
  `planned` executor runs the steps; the chat unit is committed only with a
  verified answer). `AGENT_PLANNER` master (default) / gold / all / off. UI:
  the "Agent topshirig'i" card on a matter page (master only for now).
  PR-E: steps with `after` run as a graph in the harness (<= 3 at once,
  `AGENT_PLAN_PARALLEL`; a failure, halt, cancel or limit starts nothing new,
  running steps finish and are recorded); the answer waits for every earlier
  step, verify for all. `ask_user` (once, before the answer) stops the run
  `needs_input` (units released, input and checkpoints kept);
  `POST /api/agent/runs/:id/input` reserves again and requeues; unanswered
  7 days -> cancelled.
  PR-F (Telegram): the planner is a service (`createPlannerService`:
  plan / approve / answer / cancel / attachTelegram) shared by the web
  routes and the bot. "agent: <topshiriq>" (typed or a voice note) ->
  `agent_task` -> the plan with `agp_y_` / `agp_n_` buttons; approving sends
  one status message whose id goes into the run's input (`telegram`), the
  worker reports steps and the end through `src/agents/runs/notify.js` (the
  bot's notifier, `src/bot/agent-runs.js`): the answer in Telegram Markdown,
  or the question - the chat's state `agent_answer` makes the next message
  the answer ("yo'q" is an answer there; only "bekor" stops it). A staff
  account reaches this only in /testmode (staff messages are not questions).
  PR-G: `docs/quality/agent-eval.md` - 24 synthetic cases
  (`docs/quality/agent-eval/cases.json`, all `reviewed: false` until a lawyer
  reviews them; no article numbers guessed), a scorer with no AI
  (`scripts/lib/agent-eval-score.js`: delivered, asked, acts, structure,
  must_say, must_not_say, verification) and `scripts/agent-eval.js` (dry by
  default; live only through a running server's API as a master session,
  with `AGENT_EVAL_LIVE=yes` and `--approve <runSha>`). Only reviewed cases
  speak for quality.
- Matter commands by voice or text (2026-10-28, owner): `src/matters/commands.js`
  - anchored uz / ru phrases (no AI, <= 300 chars: "ishlarim", "yangi ish och:
  …", "<ish> ishiga yozuv: …", "<ish> ishini ko'rsat / yop / qayta och",
  "мои дела", "новое дело: …"); a matter is found by its words, an unknown or
  ambiguous name is asked about, never guessed; close / reopen need a
  confirmation (a 10-minute token of that account, used once, in memory).
  Telegram: `classifyDeterministicIntent` -> `ish_amal` (typed, or a voice
  note after STT), the linked account of any role, buttons `mtc_y_` / `mtc_n_`
  in bot.js. App: `POST /api/matters/command` and the command bar with 🎙
  (dictation) on the Ishlar pages. No AI, no unit; `MATTERS=off` stops it.
  `tests/matter-commands.test.js` scans every string in tests/ for false hits.
  Export (2026-10-28, roadmap stage 2): `GET /api/matters/:id/export?format=
  pptx|xlsx` (`src/matters/export.js`, deck written by `src/exports/pptx.js`
  with jszip - pptxgenjs was not added, it depends on the npm package
  "https"): built only from what the matter holds (summary, notes, chats,
  the linked agent results via `store.results`, read with the matter's own
  access), no AI, no unit; the deck ends with "AI material, not a final
  opinion"; xlsx cells are text, never formulas.
  Spoken commands are checked (2026-10-28, owner: "Pudratchi" was heard as
  "Qudratxo'ja" and a matter opened under that name): the app's 🎙 puts the
  text in the box and never runs it; in Telegram a spoken "yangi ish" /
  "yozuv" is shown as heard with buttons (as heard / as the glossary
  suggests `mtc_a_` / cancel), and the next short typed message (not a
  question, not a command, 10 min) replaces the heard name or note
  (`correctPending`). `src/voice/glossary.js`: no engine here takes a
  vocabulary, so after STT a word that is not a known legal term (or a
  suffixed form of one) but shares most of a term's stem is suggested -
  never replaced (a real name stays as said); `/api/voice/dictate` returns
  `suggestions`, the chat names them in a toast.
  Per account (2026-10-28, owner; migration 021 `voice_glossary`,
  `src/voice/user-glossary.js`): a `fix` (heard -> term) is learned when the
  person picks a suggestion, corrects the heard words before running (same
  word count, <= 3 words) or types a correction in the bot; a `word` when they
  keep a heard word against a suggestion, or add a name by hand; their own
  fix is suggested first, their own words are never flagged. "Lug'atim" on the
  Ishlar command bar lists, adds and deletes (`/api/voice/glossary`); 500
  rows an account (a learned row makes room, hand-made rows stay); account
  deletion removes it. Still suggestions only - never a replacement.
- `src/workspace/` — Workspace: routes, authz, Supabase
  realtime/storage, Workspace AI. Since 2026-10-28 (owner, migration 025)
  any active paid plan (Silver, Gold, Platinum) owns one (`PLAN_CATALOG`
  `workspace.create`; `has_workspace_entitlement`); a member still needs
  their own paid plan. `workspaces.internal`: a staff Workspace only a master
  opens (`POST /workspaces` `internal: true`), active with no plan while the
  owner is a master, members staff only (master / student / lawyer, enforced
  by triggers and the invitation check), the flag never changes;
  `tests/workspace-entitlement.db.test.js`.
- `public/` — static pages: `index.html` (landing), `login.html`,
  `dashboard.html` (the app), `ai-dashboard.html` (the design reference the
  dashboard follows), plus tariff, attorneys, templates, legal pages.

## CustDev pilot (2026-10-28, owner)

14 days, 5 student lawyers ("agents"), 20 clients. Stage 1: test
entitlements up to 336 h. Stage 2 (migration 024, `src/sales/`): a staff
account (student / lawyer, no new role) gets a random `admins.sales_agent_code`
only from a master (route `requireMasterAdmin` + the role read again in the
database); offer links `/?ref=<code>` (the `jai_ref` httpOnly cookie, set
before the static pages, the first link kept) and
`t.me/<legal bot>?start=ref_<code>` (`referral_pending` until the account
exists; `ref_` is its own prefix and never triggers the bare-start sign-in
fallback); the FIRST agent is written once at registration
(`telegram-auth-routes`, `telegram-login` -> `claimAtRegistration`), an
unknown code is ignored; a referred client gets a pending `pilot_requests`
row; a master approves it with one button (`PILOT_GRANT`: 336 h, silver,
chat 120 / analysis 8 / opinion 4 / draft 6 / ocr 20, $10) or declines; the
client hears it in the bot when linked. Demo: a master-made test account
linked to an agent (`demo_for_agent_id`) with the same entitlement; its
units are reported apart. An agent grants nothing and sees only their own
clients - name, registered, pilot status, units used, paid - never a
question or answer (`GET /api/sales/me`, page `#/mijozlarim`, a nav item for
an agent only). Master: Boshqaruv -> "CustDev pilot" (`/api/admin/sales/*`):
pending requests, agents, codes, links, demo, registered / piloted / paid.
Agents list and invite links (2026-10-29, owner; migration 031,
`src/sales/invites.js`): the list holds only accounts with a code (taking the
code back - "Agentlikdan chiqarish" - takes the account off it); a new agent
comes by "Agent qo'shish": a master's one-use, 7-day link
`t.me/<legal bot>?start=agi_<token>` (only its sha256 kept, shown once,
revocable, an optional note). In the bot the link shows what accepting does;
the tap (token held at /start for that Telegram user, 15 min, never in the
button) makes the Telegram's account a student with a code - made from the
Telegram identity if there is none, a `user` promoted, a student / lawyer
kept; a master or a referred / demo client refused, the link left unused.
`tests/agent-invites.db.test.js`.
Client type and the one-tap join (2026-10-28, owner; migration 026):
`admins.client_type` lawyer / accountant / hr / business / user is what the
client does - it adapts the platform (the home "Sohangiz" chips save it,
`PUT /api/client-type`; `/api/user-info` returns `clientType`) and grants
nothing: every client stays role `user` (a client lawyer is NOT role
`lawyer`, which is staff and shown as "Ekspert"). Set by the person, their
agent (`POST /api/sales/clients/:id/type`) or a master. The bot's ref_ link
asks "kasbingiz?" (`src/bot/pilot-join.js`, buttons `pj_<type>`) and one tap
makes the account from the Telegram identity (`joinFromTelegram`, no site, no
code). Standing rule (owner's "b"): a professional type gets the pilot with
no master's click (`maybeAutoApprove`, one at a time under an advisory lock;
`grantTestEntitlement` `policy: 'custdev_pilot_auto'`, grantedBy null,
`pilot_requests.auto`) while fewer than `PILOT_AUTO_TOTAL` (20) are approved
in all and `PILOT_AUTO_PER_AGENT` (4) for that agent; "user" and anything
past a cap waits for a master; `PILOT_AUTO=off` stops it.
`tests/pilot-join.db.test.js`.
Stage 3 (migration 027, `src/sales/pilot-workspace.js`, no AI): a master
opens the pilot's internal Workspace once (Boshqaruv → CustDev pilot,
`pilot_workspace`); agents with a code are members (also when a code is
given later); a client is never a member. An approved pilot (button or
standing rule) gets one task "Mijoz: <ism> — <tur>" with the sections
Muammo / Hozirgi yechim / Demo / 7-kun / 14-kun / Narx javoblari, due at
the pilot's end, assigned to the agent (`pilot_client_tasks`; the agent or a
master can open it by hand). Feedback: the bot's "💬 Fikr bildirish" (on the
pilot-open message) or `/fikr` puts an active pilot client's private chat in
feedback mode (`src/bot/pilot-feedback.js`, 15 min) - only the NEXT text or
voice note (after STT) is feedback, intercepted before the agent and the
request queue; it becomes one sub-task (`workspace_task_links` subtask) per
Telegram message (`pilot_feedback` unique chat + message). The agent tags it
(xato / chalkash / yangi_imkoniyat / narx) and, once the sub-task is done,
writes a short reply and confirms it - the bot sends it once (a failed
delivery may be resent) with "🔕" to turn replies off
(`admins.pilot_replies_off`). Tag and reply are also task comments. Weekly
view by tag with distinct clients (`/api/sales/feedback/weekly`). Every
Workspace write runs in the Workspace transaction as the acting staff
account, so the triggers log it. Pages: "Mijozlarim" (feedback, tags,
replies, open task) and Boshqaruv → CustDev pilot. `tests/pilot-feedback.db.test.js`.
Stage 4 (migration 028, `src/interviews/`, page: the "Intervyu yozuvlari"
card on a matter, `public/app/interviews.js`, staff only): an interview
recording is stored only with its consent - who, when, how (said at the
start of the recording / written) and the uploader's tick that the person
was told it is transcribed and sent to AI providers (VoiceLab, DeepSeek) and
the audio is deleted after `INTERVIEW_AUDIO_DAYS` (30); without it 422 and
nothing stored. Only the uploader and a master see a recording (not other
members of a Workspace the matter is attached to). STT (`src/ai/stt.js`, its
ledger rows) runs in the background as its own usage request, in chunks of
`INTERVIEW_CHUNK_SEC` (600, ffmpeg to Opus) up to `INTERVIEW_MAX_SEC` (2 h) /
`INTERVIEW_MAX_MB` (50); the transcript is versioned
(`interview_transcripts`: 1 = STT, then edits) and stays when the audio goes
(the hourly retention sweep or by hand; `interview_events` logs every step).
The optional AI summary (`callCheapAI`, ledger + bound) gives quotes,
problem, current solution and price, confusing, missing, signal, price
answers; a quote not in the transcript word for word is removed and counted;
labelled "AI xulosasi, transkript bilan tekshiring". A client's account
deletion removes the recordings made with them. `INTERVIEWS=off` stops it.
`tests/interviews.db.test.js`.

## The 2026 Latin alphabet (OʻRQ-1184 of 21.10.2026)

Oʻ → Ö, Gʻ → Ğ, Sh → Ş, Ch → Ç (owner, 2026-10-28: the new alphabet by
default, the old one on request, either one always available). Inside,
everything stays in the OLD script: lex.uz, the corpus, prompts and every
word-for-word quote check are written in it. `public/js/uz-alphabet.js`
(UMD, used by the server too): `toOld` at the entry points (`/api/legal-chat`
message, the Telegram question, matter commands), `fold` in search and
document matching (`normalizeUzbekForSearch`, document-job `lower`), `toNew`
only for display - the app and the landing convert their text nodes and
placeholders (inputs, textareas, code, `[data-noalpha]` untouched; links,
emails, `code`, mixed-case names like MChJ / JuristAI and act codes like
OʻRQ-1184 kept; a U+200C keeps a sample of the old letters as it is), copy
buttons copy what is shown, a one-time bar offers the old alphabet (no
answer = new). The choice: `localStorage jai-alphabet` and, signed in,
`user_profile.manual.alphabet` (the Moslashish page). The bot
(`src/bot/alphabet.js`, migration 023 `tg_alphabet`): `sendMessage` /
`editMessageText` and button labels in the chat's script, the old one
offered once, `/alifbo` to switch; a linked account's site choice is used
when the chat has none. Not converted yet: the Word pane, generated .docx,
.pptx/.xlsx exports, the old dashboard. Golos Text's upstream Ğ/ğ had no
breve (the composite held only G/g); `public/fonts/golos-text/*latin-ext*`
were rebuilt with fontTools from the Google Fonts variable font with the
breve added the way the font builds Ă (OFL, no reserved name).

## Frontend rules

- **Design source of truth:** `docs/brand/*.dc.html` canvases and
  `docs/design-handoff/` (`ANIMATIONS.md` lists which animations exist — do
  not invent new ones). Match the rendered canvas, not its inline declarations;
  the canvas runtime overrides some of them.
- **Type, new design (landing, `/app/`, Word/Google Docs panels): Golos
  Text**, self-hosted from `public/fonts/golos-text/` through
  `/app/fonts.css` (it has Cyrillic). Pages link that file - never Google
  Fonts (2026-10-20 review replaced 21 Google Fonts links). The rule below
  stays for the old dashboard and the pages that still use its styles.
- **Type, old design: one face, Space Grotesk, everywhere** (owner's decision, Sept 2026;
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
- Sign-in (2026-10-07): Telegram registers and is the main way in. A
  Telegram account gets a random password nobody knows; its owner may add a
  login and password to the SAME account on `account.html`
  (`src/auth/credentials.js`, `credential-routes.js`) after a fresh step-up:
  the auth bot link `stepup_<token>` approved only by the Telegram id linked
  to that account, or the current password where the owner set one; bound to
  the account and session, 5 minutes, single use. The login is chosen (never
  the Telegram username), unique case-insensitively; only the own row of a
  role `user` changes (never the role); other sessions end. `/api/login`
  (`src/auth/login-routes.js`) keeps the master's Telegram 2FA and the
  published-password refusal, gives one reply for unknown login and wrong
  password, locks a login after 10 failures in 15 minutes and starts a new
  session id. Telegram web sign-in and registration
  (`src/auth/telegram-auth-routes.js`, `telegram-confirm.js`, bot side
  `src/bot/auth-start.js`): opening a `login_`/`reg_` link never signs in -
  the bot sends a 6-digit code to the chat that opened it, typed into the
  browser that started (bound by a per-flow `jai_tga_<flow>` cookie); the
  code is never in an API reply, is per flow, per Telegram id, 5 minutes,
  5 tries, used once. Credential, test-user and Telegram-code POSTs need
  this site's Origin/Referer (`src/auth/same-origin.js`). Recovery: the browser never receives a reset token; an
  ordinary account resets on its account page after Telegram sign-in; the
  reset link is for staff. A master may create an ordinary test account
  (`POST /api/admin/test-users`, master password re-entered, initial password
  typed by the master): role user, no plan, Sinov as anyone, not a test
  entitlement.

## Shell gotcha

`pkill -f <pattern>` matches the shell running it when the pattern appears in
the same command line, and kills the session's own shell (exit 144). Kill by
PID instead.
