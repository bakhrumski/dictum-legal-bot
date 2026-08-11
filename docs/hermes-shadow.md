# Hermes shadow trial for the Telegram agent

Hermes runs as a private evaluator beside the existing JuristAI Telegram
agent. JuristAI remains the only production decision-maker and the only
system that replies to users. Hermes receives redacted context after the
production decision, evaluates the route, and writes a comparison row for the
Master Admin dashboard.

## What shadow mode measures

- production intent, action, and escalation decision;
- Hermes intent, recommended route, escalation decision, and confidence;
- exact route/escalation agreement;
- failures, model name, tokens, estimated model cost, and latency;
- a redacted message preview for reviewing disagreements.

Hermes failure is isolated. A timeout, invalid JSON, unavailable endpoint, or
database telemetry error cannot replace or delay the Telegram reply.

## Render configuration

Run a separate private Hermes Agent API service using its OpenAI-compatible
endpoint, then add these variables to the JuristAI web service:

```ini
HERMES_SHADOW_ENABLED=true
HERMES_SHADOW_URL=https://your-private-hermes-service.example/v1
HERMES_SHADOW_API_KEY=use-a-separate-random-secret
HERMES_SHADOW_MODEL=hermes-agent
HERMES_SHADOW_SAMPLE_RATE=1
HERMES_SHADOW_TIMEOUT_MS=8000
```

`HERMES_SHADOW_SAMPLE_RATE=1` evaluates every completed Telegram route during
the short trial. After enough examples are collected, `0.10` is a sensible
monitoring rate. If the flag is off or the URL is missing, production continues
normally and the dashboard reports the shadow as disabled or unconfigured.

Do not connect Hermes' own Telegram gateway to the production bot token. The
only supported trial architecture is JuristAI Telegram agent -> private Hermes
HTTP API -> shadow telemetry.

## How to test

1. Deploy the Hermes API and the JuristAI branch.
2. Send the Telegram bot examples from each path: greeting, vague help,
   concrete legal question, attorney request, document request, account help,
   and an unrelated question.
3. Open **Boshqaruv -> Telegram agent** as Master Admin.
4. Review the **Hermes shadow taqqoslash** summary and disagreement rows.
5. Keep Hermes in shadow until at least 100 varied evaluations have been
   reviewed. A useful initial gate is over 90% route agreement and under 2%
   technical failures, followed by manual review of every disagreement.

## Telegram AI cost assumptions

The following estimate uses uncached Standard API prices checked on
2026-08-11 and typical, not maximum, token counts. Actual provider usage is
written to `llm_spend_log`; Hermes usage is written to
`tg_agent_shadow_runs`.

| Telegram path | Typical AI work | Estimated cost per user message |
|---|---|---:|
| `/start`, greeting, menu, account help, attorney/document intake | Deterministic rules/buttons | $0.000000 |
| Verified `qa_korpus` match | Embedding only | ~$0 with HF/Gemini free tier; under $0.00001 with OpenAI embedding |
| Vague free-text classification | Luna: ~700 input + 20 output | $0.000164 |
| Guided legal question | Terra topic + Luna grounded answer | $0.003320 |
| Free-text legal question, full path | Luna intent + Terra topic + Luna answer | $0.003484 |
| Hermes shadow using a local model | Self-hosted inference | $0 token API fee, plus Hermes hosting |
| Hermes shadow backed by Luna | ~1,200 input + 150 output | +$0.000420 per evaluated message |
| Full legal path plus Luna-backed Hermes | Production + shadow | $0.003904 |

Assumptions for the full legal path: Luna intent 700/20 tokens, Terra topic
900/10 tokens, and Luna answer 4,000/500 tokens. The shadow assumption is
1,200/150 tokens. Long conversation history or large retrieved context costs
more; verified-answer reuse costs much less.

| Completed legal answers per day | 30-day production estimate | With Luna-backed shadow on each answer |
|---:|---:|---:|
| 100 | $10.45 | $11.71 |
| 500 | $52.26 | $58.56 |
| 1,000 | $104.52 | $117.12 |

The scale table assumes one Hermes evaluation per completed legal answer. At
100% shadow sampling, greetings, menus, and other deterministic messages also
produce a shadow call; a local Hermes model avoids per-token fees for those
extra evaluations.

The existing three-answer daily Telegram limit makes the typical estimated
maximum about $0.01045 per fully active user-day before shadow evaluation.
Self-hosted Hermes infrastructure must be priced separately from token usage.
