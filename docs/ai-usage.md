# AI usage, models and cost — JuristAI

Where every AI dollar goes, which model does which job, and how spend is
tracked and capped. Derived from the code, not from estimates — file and
line references are given so this can be re-checked when the code moves.

---

## 1. The model roster

Defined in `src/api/server.js` (`MODELS`). Every name is env-overridable.

| Tier | Model | Env override | Input $/1M | Output $/1M | Cached input $/1M |
|---|---|---|---|---|---|
| premium | `gpt-5.6-sol` | `MODEL_PREMIUM` | 5.00 | 30.00 | 0.50 |
| standard | `gpt-5.6-terra` | `MODEL_STANDARD` | 2.50 | 15.00 | 0.25 |
| cheap | `gpt-5.6-luna` | `MODEL_CHEAP` | 1.00 | 6.00 | 0.10 |
| fallback | `gemini-2.5-flash` | — | 0.30 | 2.50 | 0.075 |

`gpt-5.6` is registered as an alias priced identically to Sol.

**Embeddings:** `gemini-embedding-001` at 1536 dims (`src/rag/embeddings.js`).
Free tier in practice; not billed in `MODEL_PRICING`.

### Routers

| Function | Chain | Used for |
|---|---|---|
| `callPremiumAI` | Sol → (retry) → Terra/Gemini | Legal opinions only |
| `callAI` | Terra → Gemini | Default for almost everything |
| `callCheapAI` | Luna → Gemini | Bulk / mechanical work |
| `callOpenAIStream` | model from caller (streaming) | Chat, primary — passed `MODELS.chat` |
| `callGeminiStream` | Gemini (streaming) | Chat, only if OpenAI is down or over budget |

Gemini is the **only** fallback. It engages when `GPT_API_KEY` is absent, the
daily budget ceiling is hit, or an OpenAI call fails.

---

## 2. Which model does what

### Sol — `gpt-5.6-sol` ($5 / $30)

The most expensive tier, used in exactly one place.

| Job | Where | Notes |
|---|---|---|
| Legal opinion synthesis | `/api/draft/legal-opinion` | `premiumRetries: 2` — transient errors retry Sol before falling back |
| Opinion citation-correction pass | `/api/draft/legal-opinion/fix-citations` | Only runs when the audit flags unverified citations |

**Per plan** (`OPINION_MODELS`): sinov → Luna; **silver, gold, platinum → Sol**.
Overrides: `OPINION_MODEL`, `OPINION_MODEL_<PLAN>`, `OPINION_MODEL_STAFF`.

### Terra — `gpt-5.6-terra` ($2.50 / $15)

The workhorse. Everything that calls `callAI` without a model override.

| Job | Where |
|---|---|
| Document explanation | `/api/draft/explain-document` |
| Document drafting / templates | `src/drafting/routes.js` (3 sites) |
| OCR post-processing | `src/ocr/routes.js` |
| Corrective RAG grading | `src/rag/corrective.js` |
| Reference extraction for opinions | `src/rag/legal-verify.js` |
| Triage / classifier agents | `src/agents/runner.js` |
| Enterprise module | `src/enterprise/index.js` |
| Master tools (ai-analysis, ai-chat, qa enrich, style audit) | various, master-only |

### Luna — `gpt-5.6-luna` ($1 / $6)

Bulk and mechanical work where quality per token matters least.

| Job | Where | Why cheap is right |
|---|---|---|
| **Legal chat answers** (`MODEL_CHAT`) | `/api/legal-chat` | Unlimited on paid plans, so per-answer cost compounds without bound; answers are short and RAG-grounded |
| **Telegram agent answers** | `src/agents/telegram-agent.js` | Same workload, capped at ~200 words |
| **Long-document digest (map-reduce)** | `digestLongDocument` | Summarizing 7+ chunks in parallel; the expensive reasoning happens later on Sol |
| Sinov-tier legal opinions | `/api/draft/legal-opinion` | Free trial |
| Opinion pattern extraction | `/api/draft/legal-opinion/save-pattern` | Master-triggered, structural |
| Answer compaction | `/api/ai-compact-answer` | Shortening existing text |
| Telegram intent classification | `src/agents/telegram-agent.js` | Free-form messages only; menu-selected service, advocate and document flows bypass it |

### Gemini 2.5 Flash — fallback only

Never primary. Engages on OpenAI failure, missing key, or budget ceiling.
Priced in the table so the spend report separates it from OpenAI — mixing
the two is what previously made platform totals disagree with the OpenAI
invoice.

---

## 3. Cost per operation

Measured from production logs where available, otherwise computed from the
token caps in code.

A legal opinion is **four** billed stages, not one. Counting only the
synthesis understates it by roughly half.

| Operation | Model | Typical tokens | Cost |
|---|---|---|---|
| **Legal opinion, all-in** (79k-char document) | mixed | — | **~$0.44** |
| — reference extraction (3 × 30k windows) | Terra | ~36k in / ~4.5k out | ~$0.158 |
| — document digest (map-reduce) | Luna | ~32k in / ~9k out | ~$0.086 |
| — synthesis | Sol | ~17k in / ~5k out | ~$0.24 |
| — topic classification | Terra | ~1k in / 16 out | ~$0.003 |
| — citation correction (only when triggered) | Sol | ~12k in / ~5k out | ~$0.21 |
| **Legal opinion, typical contract** (<14k chars) | Sol | — | **~$0.15–0.20** |
| **Chat answer** | **Luna** | ~4k in / ~0.3k out | **~$0.006** |
| **Telegram answer** | **Luna** | ~4.6k in / ~0.36k out | **~$0.007** |
| — Telegram greeting | none (regex) | 0 | **$0.00** |
| — Telegram service menu / advocate intake / document intake | none (buttons + state machine) | 0 | **$0.00** |
| — Telegram clarifying question | Luna | ~0.6k in / 60 out | ~$0.001 |
| — Telegram answer from qa-korpus | embedding only | — | ~$0.0001 |
| Document explanation | Terra | varies | ~$0.01–0.03 |
| Topic classification | Terra | ~1k in / 16 out | ~$0.003 |

A document under ~14,000 chars skips the digest entirely and needs one
reference window instead of three, so a normal contract costs a third of the
79k-char stress-test document these figures come from.

**Worst case** — large document, all four stages plus a correction pass —
lands near **$0.65**.

Verified against the real invoice: five logged opinion runs on the same 79k
document sum to $0.953 of synthesis; adding the three support stages
($0.246 each) predicts **$2.19** total. The OpenAI account showed **$2.22**
spent at that point. The model is accurate to about 1%.

### Output caps in code

| Feature | Cap |
|---|---|
| Legal opinion (paid) | 7,000 tokens |
| Legal opinion (sinov) | 4,500 tokens |
| Opinion correction pass | cap + 1,000 |
| Chat | 8,192 tokens |
| Telegram answer | 900 tokens (~200 words) |
| Topic classification | 16 tokens (OpenAI's minimum) |

---

## 4. Plan economics

Rate: **11,980 UZS/USD**. Quotas are *solved* from measured unit costs against
three targets — worst case 5–10%, medium (35% usage) 40–60%, and anything a
customer generates above 75% returned to them as a rebate.

| Plan | Price | USD | Chat | Fair use | Opinion credits/wk | Drafts/wk | Worst case |
|---|---|---|---|---|---|---|---|
| Bepul | free | — | 10/day → 3/day after 30d | — | 0 | 0 | — |
| Sinov | free, 10d | — | 3/day | — | 1 | 2 | — |
| Silver | 199,000 | $16.61 | unlimited | 15/day | **9** (~39/mo) | **22** (~95/mo) | **8.2%** |
| Gold | 399,000 | $33.31 | unlimited | 30/day | **17** (~74/mo) | **50** (~217/mo) | **8.0%** |
| Platinum | 999,000 | $83.39 | unlimited | 70/day | **42** (~182/mo) | **125** (~542/mo) | **9.8%** |

Weekly windows reset Monday 00:00 Asia/Tashkent — a fresh allowance every week
reads as more generous than one monthly number, and caps what a single abusive
week can cost.

### Opinion credits, not opinion counts

An opinion costs $0.15–$0.65 depending on document length — a 4× spread.
Charging one "opinion" regardless made the worst case a lottery: with every
document at max size, every plan went to **−20%**. Credits flatten it to
~$0.22 each.

| Document | Credits |
|---|---|
| ≤ 40k chars (~15 pages) | 1 |
| 40–90k chars | 2 |
| > 90k chars | 3 |

### Margin by usage

| Usage | Silver | Gold | Platinum | |
|---|---|---|---|---|
| 100% quota + ceiling chat | 8% | 8% | 10% | worst |
| 50% + 20 chat/day | 41% | 51% | 58% | target |
| 35% + 15 chat/day | 58% | 65% | 70% | target |
| 20% + 8 chat/day | 76% | 81% | 83% | **rebate** |
| 5% + 2 chat/day | 94% | 95% | 96% | **rebate** |

### Loyalty rebate

Margin above `REBATE_THRESHOLD` (0.75) is returned as a discount on the next
renewal — a discount rather than cash, because it costs the same, is funded by
the following month's revenue, and only pays someone who stays.

`GET /api/admin/margin-report` (master only) computes it per customer from
**real** `llm_spend_log` cost, and bands each user `rebate` / `target` /
`thin` / `loss`. Modelled on a 50/30/20 light/medium/heavy mix it returns
~8% of revenue and lands net margin at 53–65%.

### Telegram cost controls

Each Telegram chat receives three successful AI legal answers per Tashkent
day by default. The reservation is atomic in PostgreSQL and is released if
generation fails, so concurrent messages cannot exceed the allowance and a
failed provider does not consume it.

The `/start` flow is deterministic and costs nothing: users select **Huquqiy
savol**, **Advokat topish**, or **Hujjat tayyorlash**. Advocate matching does
not invoke an AI classifier; it requires an explicit legal field, region and
case description before querying the verified directory. Document intake is
also button-driven and goes to lawyer approval without generating an AI
document or inventing a price. The selected field is also written directly to
the Master Admin queue, so guided requests skip the separate AI triage call.

The remaining abuse risk is identity-based: a person can use multiple
Telegram accounts. Monitor unique daily chat IDs and add phone/account linking
before increasing `AGENT_DAILY_AI_LIMIT`.

---

## 5. Tracking and controls

### Spend log

`recordSpend()` writes one row per model call to `llm_spend_log`:
day, month, model, stage, in/out tokens, `cost_usd`, `user_id`, `endpoint`.

Cached input tokens are billed at the `cached` rate (~10% of input). Ignoring
that previously made platform estimates *higher* than the real OpenAI invoice
on long, repeated prompts.

### Master-only reporting

`GET /api/admin/spend-report` (master admin only) returns:

- `totalUsd` and **`openaiUsd` separately** — Gemini is broken out, because
  mixing providers is what previously made totals disagree with the invoice
- breakdowns by provider, model, and endpoint
- top 100 users by spend
- latency p50 / p95 / max

Surfaced as a table panel in the dashboard. **Cost telemetry is gated
server-side**, not hidden client-side — non-master users never receive the
numbers in the JSON.

### Budget circuit breaker

`LLM_DAILY_BUDGET_USD` (default `0` = disabled). When the day's logged spend
reaches the ceiling, `paidModelsAllowed()` returns false and every router
falls to the free Gemini tier. The product degrades in quality rather than
going down.

### Model-choice A/B

`GET /api/admin/model-ab` and `npm run model:ab` run fixture legal questions
through the real pipeline on two models and report **unverified citations**,
cost and latency per model. Use it before changing `MODEL_STANDARD`.

---

## 6. Env reference

| Variable | Default | Effect |
|---|---|---|
| `MODEL_PREMIUM` | `gpt-5.6-sol` | Opinion synthesis model |
| `MODEL_STANDARD` | `gpt-5.6-terra` | Default model |
| `MODEL_CHEAP` | `gpt-5.6-luna` | Bulk work model |
| `MODEL_CHAT` | `gpt-5.6-luna` | Chat + Telegram answers (own slot, so raising it does not move drafting/OCR/agents) |
| `OPINION_MODEL` | — | Forces one model for all opinions |
| `OPINION_MODEL_<PLAN>` | — | Per-plan opinion model |
| `OPINION_LIMIT_<PLAN>` | 1/3/10/30 | Opinions per tariff period |
| `OPINION_MAX_REFS` | 15 | lex.uz lookups per opinion |
| `LLM_DAILY_BUDGET_USD` | 0 (off) | Daily paid-model ceiling |
| `ANSWER_CACHE` | on | `off` disables the 72h chat cache |
| `FAIR_USE_SILVER` / `_GOLD` / `_PLATINUM` | 15 / 30 / 70 | Daily anti-abuse ceiling on unlimited chat |
| `CREDITS_SILVER` / `_GOLD` / `_PLATINUM` | 9 / 17 / 42 | Weekly opinion credits |
| `DRAFTS_SILVER` / `_GOLD` / `_PLATINUM` | 22 / 50 / 125 | Weekly document generations |
| `PAYMENTS_ENABLED` | false | **Paid plans are refused until this is `true`.** Governs the server guard, the plan catalogue and the pricing UI together |
| `REBATE_THRESHOLD` | 0.75 | Margin above which the excess is returned to the customer |
| `UZS_PER_USD` | 11980 | Rate used for margin reporting |
| `ALLOW_WEB_SEARCH` | false | `true` lifts the lex.uz-only restriction |
| `AGENT_AUTO_ANSWER` | true | `false` sends all Telegram requests to humans |
| `AGENT_ESCALATE_WEAK` | true | Queue a lawyer on low-confidence answers |
| `AGENT_MAX_CLARIFY` | 2 | Clarifying questions before answering anyway |
| `AGENT_DAILY_AI_LIMIT` | 3 | Successful Telegram legal answers per chat per Tashkent day; greetings, FAQ and clarification do not consume it |

---

## 7. Levers, in the order I would pull them

1. **Monitor the Telegram cap** — anonymous chats receive three successful
   legal answers per Tashkent day by default. Adjust `AGENT_DAILY_AI_LIMIT`
   only after measuring answer quality, repeat usage and conversion.
2. **Grow `qa_korpus`** — a verified answer reused costs ~$0.0001 instead of
   ~$0.015, and it is *higher* quality than generation. The lawyer-correction
   loop already feeds it; nothing else gives a 100× cost reduction and a
   quality gain at the same time.
3. **Set `LLM_DAILY_BUDGET_USD`** — not a saving, but it converts a runaway
   bill into a quality degradation.

Do **not** economize on opinion synthesis. It is the deliverable that
justifies a paid plan, it is capped per period, and at ~$0.30 against a
$23–92 subscription it is not where the money goes.
