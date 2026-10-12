# AI model routing (2026-10-04)

What the code does today, per stage, and how it differs from the chain the
founder expects. Model ids are the ones the code sends; whether an account
can use them is decided by the provider, not by this file.

## Chains

| Router | Primary | Then | Last resort |
|---|---|---|---|
| `callAI` (standard lane) | DeepSeek `deepseek-flash`† | OpenAI `MODELS.standard` (`gpt-6-sol`) | Gemini `gemini-2.5-flash` |
| `callAI` with `model: MODELS.chat` (Telegram/web answer) | DeepSeek `deepseek-flash`† | OpenAI `gpt-6-luna` | Gemini `gemini-2.5-flash` |
| `callCheapAI` | DeepSeek `deepseek-flash`† | OpenAI `MODELS.cheap` (`gpt-6-luna`) | Gemini `gemini-2.5-flash` |
| `callPremiumAI` (legal opinion, paid plans and staff) | OpenAI `gpt-6-sol` (explicit `openai/${MODELS.premium}`; DeepSeek and VoiceLab bypassed), `premiumRetries` — or DeepSeek `deepseek-v4-pro` with `OPINION_MODEL=deepseek/deepseek-v4-pro` | OpenAI `gpt-6-sol` after V4 Pro | Gemini `gemini-2.5-flash` |
| `callPremiumAI` (legal opinion, Sinov) | DeepSeek `deepseek-flash`† | OpenAI `gpt-6-luna` | Gemini `gemini-2.5-flash` |
| `callExplainAI` (document explanation, final call only; 2026-10-12) | DeepSeek `deepseek-flash`, thinking off, `max_tokens` 6000 | OpenAI `gpt-6-luna` (explicit `openai/`, never VoiceLab), `max_output_tokens` 8000 | Gemini `gemini-2.5-flash` |
| Streaming answer (web) | DeepSeek stream† | OpenAI stream | Gemini stream, then `callAI` |
| Embeddings | Gemini `gemini-embedding-001` / HF `multilingual-e5-large` / OpenAI `text-embedding-3-small` (`EMBED_PROVIDER`; not routed, the corpus is embedded with one) | — | — |
| Rerank | HF `BAAI/bge-reranker-v2-m3` | — | keyword re-rank (no AI call), request marked `degraded` |

† when `DEEPSEEK_API_KEY` is set and `DEEPSEEK_ROUTING` is not `off`
(`src/ai/deepseek.js`; 2026-10-12, owner's decision after the provider
evaluation). Thinking off; the cap sent is the caller's x2 (at most 16 000).
While DeepSeek routes a lane, VoiceLab text lanes (comet, orbit, halo) are
skipped: a DeepSeek failure goes to the lane's GPT-6. An explicit id picks its
provider: `voicelab/<id>` (e.g. `MODEL_TELEGRAM=voicelab/aisha-comet`) still
goes to VoiceLab, `openai/<id>` to OpenAI, `deepseek/<id>` to DeepSeek.
Images, scanned documents (OCR, vision) and embeddings are not routed to
DeepSeek. The hybrid pipeline's `callOpenAIModel` follows the same order.

Legal opinion (2026-10-12): in the opinion test (`scripts/provider-eval.js
--task opinion`, one 54 260-char agreement, empty legal context, read by
hand, not by a lawyer) GPT-6 Sol kept every checked condition, DeepSeek V4
Pro most of them at about a quarter of the cost, deepseek-flash the fewest.
Paid opinions therefore stay on Sol; `OPINION_MODEL=deepseek/deepseek-v4-pro`
(env, no deploy) moves them to V4 Pro (thinking off, cap 7 000 x 2, peak
price 1.32 / 0.044 / 3.96 per 1M in `model-pricing.js`), Sol behind it.
`deepseek/<model>` accepts only `deepseek-flash` and `deepseek-v4-pro`.

GLM (Z.AI, `src/ai/zai.js`, 2026-10-12): opt-in only, for trials on the
platform. A call goes to `glm-5.3-flash` only when its id is
`zai/glm-5.3-flash` (`MODEL_TELEGRAM`, `MODEL_CHAT`, `OPINION_MODEL_<PLAN>`,
`/api/admin/model-ab?a=zai/glm-5.3-flash&b=...`) and `ZAI_API_KEY` is set;
thinking is always on there, sent with `reasoning_effort=low`; a failure or a
refusal (`finish_reason: sensitive`) goes on to DeepSeek, then the lane's
GPT-6. Price 0.15 / 0.03 / 0.50 per 1M (docs.z.ai). Not in the hybrid
pipeline or the explanation router.

Legal opinion's second model: `OPINION_FALLBACK_MODEL` (e.g.
`deepseek/deepseek-v4-pro`) is tried after the paid model and its retries
fail, before Gemini. Sinov's opinion model is `OPINION_MODEL_SINOV`; a
failure there goes to the cheap lane (GPT-6 Luna), never to Sol.

Without DeepSeek (no key, or `DEEPSEEK_ROUTING=off`) the chains are as
before: VoiceLab first only when `LLM_PROVIDER=voicelab` and
`VOICELAB_API_KEY` are set, and the lane is in `VOICELAB_LANES`.

Changed on 2026-10-12: DeepSeek `deepseek-flash` is the first choice for
every text call (chat, Telegram, legal opinion, document analysis and
explanation, digests, helpers) in place of VoiceLab comet, after the provider
evaluation (`docs/quality/provider-eval-plan.md`): on the 54 260-char
investment agreement it kept every condition of the evidence table (at a
6 000-token cap; at 3 000 it was cut). Users' questions and documents are
sent to DeepSeek (api.deepseek.com). Off everywhere: `DEEPSEEK_ROUTING=off`
(env, no deploy); the explanation alone: `EXPLAIN_PROVIDER=default`.

Changed on 2026-10-04: `callCheapAI` and `callPremiumAI` used to fall back to
the whole `callAI` chain — Orbit and Sol again — before Gemini. They now go
straight to Gemini, so a failing helper call no longer costs three more calls.

## Stages → router

| Stage (ledger) | Endpoint label | Router |
|---|---|---|
| intent (Telegram) | `/tg-agent/intent` | `callCheapAI` |
| topic | `/rag/classify-topic` | `callCheapAI` |
| query_rewrite | `/rag/query-rewrite` | `callCheapAI` |
| retrieval_plan | `/rag/lex-query-plan` | `callCheapAI` (since 2026-10-04; `LEX_PLANNER_LANE=standard` restores `callAI`) |
| retrieval_grade | `/rag/corrective-grade` | `callCheapAI` (default since 2026-10-04); `RAG_CORRECTIVE_MODE=standard` restores `callAI` |
| answer | `/tg-agent/answer`, `/api/legal-chat` | `callAI` with `MODELS.chat` / `MODEL_TELEGRAM` |
| cross_check | `*/lex-cross-check` | `callAI` with the chat model |
| claim_check | `*/claim-check` | `callAI` with the chat model |
| source_suggestion | `/rag/source-suggestions` | `callAI` (standard) |
| document explanation (final answer) | `/api/draft/explain-document` | `callExplainAI` (`src/ai/explain-router.js`); with no `DEEPSEEK_API_KEY` or `EXPLAIN_PROVIDER=default`, `callCheapAI` as before |
| explanation digest, legal opinion, other drafts | `/api/draft/*` | `callPremiumAI` / `callCheapAI` |

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
- **Orbit empty text (2026-10-04):** 3 of 4 Orbit helper calls returned no
  text with completion_tokens = reasoning_tokens = 1024 and finish_reason
  "length": the budget went to hidden reasoning. A larger limit is not the
  fix (it only raises what each failure costs), and no reasoning parameter is
  documented for the VoiceLab API, so none is sent. Retrieval grade and query
  plan moved to the cheap lane (Comet, then GPT-6 Luna, then Gemini). Ask
  VoiceLab whether Orbit's reasoning can be limited; until then Orbit serves
  only stages routed to the standard lane by an explicit choice.
- **VoiceLab Orbit errors:** the ledger now shows `NO_CHOICES`,
  `EMPTY_RESPONSE` (with finish_reason and max_tokens) or the HTTP code and
  provider message; send it to VoiceLab support if it is on their side.
- **Gemini embedding price:** not verifiable from the build environment; set
  `AI_PRICE_OVERRIDES` with the price from ai.google.dev/pricing to turn the
  estimated token count into a cost.
