# AI model routing (2026-10-04)

What the code does today, per stage, and how it differs from the chain the
founder expects. Model ids are the ones the code sends; whether an account
can use them is decided by the provider, not by this file.

## Chains

| Router | Primary | Then | Last resort |
|---|---|---|---|
| `callAI` (standard lane) | VoiceLab `aisha-orbit`* | OpenAI `MODELS.standard` (`gpt-6-sol`) | Gemini `gemini-2.5-flash` |
| `callAI` with `model: MODELS.chat` (Telegram/web answer) | VoiceLab `aisha-comet`* | OpenAI `gpt-6-luna` | Gemini `gemini-2.5-flash` |
| `callCheapAI` | VoiceLab `aisha-comet`* | OpenAI `MODELS.cheap` (`gpt-6-luna`) | Gemini `gemini-2.5-flash` |
| `callPremiumAI` | VoiceLab `aisha-halo`* | OpenAI `MODELS.premium` (`gpt-6-sol`), `premiumRetries` | Gemini `gemini-2.5-flash` |
| Streaming answer (web) | VoiceLab (lane of the model)* | OpenAI stream | Gemini stream, then `callAI` |
| Embeddings | Gemini `gemini-embedding-001` / HF `multilingual-e5-large` / OpenAI `text-embedding-3-small` (`EMBED_PROVIDER`; not routed, the corpus is embedded with one) | — | — |
| Rerank | HF `BAAI/bge-reranker-v2-m3` | — | keyword re-rank (no AI call), request marked `degraded` |

\* only when `LLM_PROVIDER=voicelab` and `VOICELAB_API_KEY` are set, and the
lane is in `VOICELAB_LANES`; `MODEL_TELEGRAM=voicelab/<id>` pins Telegram.

Changed on 2026-10-04: `callCheapAI` and `callPremiumAI` used to fall back to
the whole `callAI` chain — Orbit and Sol again — before Gemini. They now go
straight to Gemini, so a failing helper call no longer costs three more calls.

## Stages → router

| Stage (ledger) | Endpoint label | Router |
|---|---|---|
| intent (Telegram) | `/tg-agent/intent` | `callCheapAI` |
| topic | `/rag/classify-topic` | `callCheapAI` |
| query_rewrite | `/rag/query-rewrite` | `callCheapAI` |
| retrieval_plan | `/rag/lex-query-plan` | `callAI` (standard) |
| retrieval_grade | `/rag/corrective-grade` | `callAI` (standard); `RAG_CORRECTIVE_MODE=cheap` moves it to `callCheapAI` |
| answer | `/tg-agent/answer`, `/api/legal-chat` | `callAI` with `MODELS.chat` / `MODEL_TELEGRAM` |
| cross_check | `*/lex-cross-check` | `callAI` with the chat model |
| claim_check | `*/claim-check` | `callAI` with the chat model |
| source_suggestion | `/rag/source-suggestions` | `callAI` (standard) |
| document, legal opinion | `/api/draft/*` | `callPremiumAI` / `callCheapAI` |

## Failure handling (src/ai/provider-health.js)

- Errors are classified from the status **and** the provider's own error
  code or message: a 429 with `insufficient_quota`/billing words is a
  permanent quota error, a plain 429 a transient rate limit; 401/402/403 are
  account-wide permanent errors; 404 and 400/422 permanent for that model.
- A permanent error opens a breaker (`AI_BREAKER_PERMANENT_MS`, default 10
  min; account-wide for auth/payment/quota): calls to it are not made, the
  ledger shows one `skipped` row with the reason, and the router moves on.
- Three transient errors within a minute open it briefly
  (`AI_BREAKER_TRANSIENT_MS`, default 30 s, or Retry-After).
- Essential stages (answer, cross-check, claim-check, STT, TTS, documents,
  OCR) retry a transient error once (Retry-After up to 4 s, else 0.4-1 s
  jittered); helpers do not, the router falls back instead. Streams never.
- Per request (`AI_REQUEST_MAX_CALLS` 30 + `AI_REQUEST_ESSENTIAL_RESERVE` 6,
  `AI_REQUEST_MAX_MS` 120000, `AI_REQUEST_MAX_COST_USD` 0.25): calls and
  time are enforced even when prices are unknown.

## Calls for one legal question (2026-10-04)

Measured before: 31 and 53 calls, 19 and 33 of them HF rerank pairs that
all returned 402. From the code after this change (not yet measured in
production - the owner's retest confirms it):

- rerank: one probe pair while HF answers 402, then no call for 10 minutes
  (a `skipped` row); at most `RERANK_MAX_CANDIDATES` (12) pairs when HF works;
- question parts (deadline, compensation, evidence, remedy): up to 4 light
  corpus searches - one embedding each, no rewrite, grader, live lex.uz or
  rerank (`src/rag/question-aspects.js`); the claim guard's re-retrieval is
  light too;
- a helper whose provider failed permanently is not called again until the
  breaker closes; cheap/premium helpers try at most VoiceLab, OpenAI, Gemini;
- in any case no more than `AI_REQUEST_MAX_CALLS` + reserve per request.

## Founder's expected chain vs today

Expected: **VoiceLab → Claude Opus 5.5 / Sonnet 5 → GPT-6 Sol/Luna**.

Today: **VoiceLab → GPT-6 → Gemini 2.5 Flash**. There is **no Claude
(Anthropic) adapter or configuration** in the code; two comments mention
Claude but no call reaches it. Adding it is an external decision: an
Anthropic API key and account limits, a price row checked against the
official pricing page, an adapter wired into the usage ledger and breakers,
and the choice of which stages use it. Gemini stays as the last resort until
then — it is the provider that answered on 2026-10-04 while Orbit and OpenAI
failed.

## External actions (not done by code)

- **Hugging Face rerank (HTTP 402):** read the provider message in the
  ledger (`error_message`); if it is the Inference Providers credit limit,
  either add credit / a PRO plan or turn the reranker off with
  `RERANKER=off` (keyword re-rank, no calls, request marked degraded). An
  open breaker already stops the calls for 10 minutes after one 402.
- **OpenAI 429:** the ledger now shows `HTTP_429_QUOTA` (billing/quota) or
  `HTTP_429_RATE` (rate limit). Quota needs billing on the OpenAI account.
- **Orbit empty text (2026-10-04):** `EMPTY_RESPONSE` at max_tokens 256/700
  with finish_reason "length" - the limit was used up before any visible
  text. VoiceLab now gets at least `VOICELAB_MIN_MAX_TOKENS` (1024), and the
  error records completion/reasoning token counts and the billed usage; if
  it persists at 1024, ask VoiceLab whether Orbit spends tokens on hidden
  reasoning and how to limit it.
- **VoiceLab Orbit errors:** the ledger now shows `NO_CHOICES`,
  `EMPTY_RESPONSE` (with finish_reason and max_tokens) or the HTTP code and
  provider message; send it to VoiceLab support if it is on their side.
- **Gemini embedding price:** not verifiable from the build environment; set
  `AI_PRICE_OVERRIDES` with the price from ai.google.dev/pricing to turn the
  estimated token count into a cost.
