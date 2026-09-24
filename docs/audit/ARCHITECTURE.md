# JuristAI arxitekturasi (audit xaritasi, 2026-09-24)

Batafsil RAG va QA korpus xaritasi: [`findings/rag.md`](findings/rag.md).

## Jarayon

Bitta Node 22 jarayoni (Render, `main` → production):

```
index.js
 └─ src/api/server.js  (≈10 500 qator, Express 5)
     ├─ REST API + statik public/
     ├─ Telegram bot (webhook rejimi, src/bot/)
     ├─ ro'yxatdan o'tish boti (polling, alohida token)
     └─ boot'da ~250 ta CREATE/ALTER (runtime DDL) + migrations/ (8 fayl)
```

- **Baza:** Supabase Postgres (`pg` Pool), `pgvector` (ivfflat), Supabase
  realtime/storage (Workspace).
- **Sessiya:** imzolangan cookie (`SESSION_SECRET` → `JWT_SECRET`).
- **Rollar:** `master`, `lawyer`, `student` (xodimlar), `user` (mijoz).
  Middleware: `requireAuth`, `requireStaff`, `requireMasterAdmin`.
- **Marshrutlar:** `src/**`da ~268 ta `app.*`/`router.*` handler.

## Modullar

| Papka | Vazifa |
|-------|--------|
| `src/api/server.js` | Express, ko'p marshrutlar, LLM chaqiruvlari (`callOpenAI*`, `callGemini*`, `tryVoiceLab`), `retrieveLegalContext`, prompt yig'ish, spend log |
| `src/bot/` | Telegram bot, webhook auth (#321) |
| `src/agents/` | Telegram agent oqimlari, ovoz (STT/TTS) |
| `src/rag/` | lex.uz ingest, chunking, embeddings, hybrid search, rerank, tariflar (`subscription-tiers.js`) |
| `src/ai/` | `model-pricing.js` (yagona narx manbai), `voicelab.js`, `voicelab-speech.js` |
| `src/drafting/` | Hujjat yaratish va eksport |
| `src/ocr/` | Rasm/PDF OCR (vision) |
| `src/workspace/` | Platinum Workspace: marshrutlar, authz, realtime, AI |
| `src/eval/` | Retrieval eval (30 ta savol; productionni emas, `parentChildSearch`ni o'lchaydi) |
| `public/` | Statik sahifalar; `dashboard.html` (≈18 000 qator, 222 id kontrakti) |

## So'rov oqimi (veb chat)

1. `POST /api/legal-chat` → auth → tarif kvotasi (`enforceQuota`, check-then-insert).
2. `answer_cache` (72 soat) → QA korpus override (≥0.92 so'zma-so'z).
3. `retrieveLegalContext`: so'rov kengaytirish → modda raqami qidiruvi →
   dense + keyword (RRF) → rerank → corrective filtr → lex.uz jonli qidiruv.
4. `buildTopicPrompt` (siyosat prefiksi + mavzu qoidalari + RAG konteksti) →
   `MODELS.chat` (gpt-6-luna) yoki VoiceLab.
5. Post-processing: cross-check (faqat lex_live dalil), `verifyCitations`
   (faqat hisobot), lex.uz deep link.

## Model routing

`MODELS`: premium/standard `gpt-6-sol`, cheap/chat `gpt-6-luna`
(env bilan almashtiriladi). VoiceLab `LLM_PROVIDER=voicelab` bilan yoqiladi,
xato bo'lsa oldingi provayderga qaytadi. Embeddinglar provayderi:
`EMBED_PROVIDER` → HF (e5-large, 1024) → Gemini (1536) → OpenAI (1536).

## Tashqi bog'liqliklar

OpenAI, Gemini, VoiceLab, Hugging Face (embedding, reranker), lex.uz,
Tavily (o'chiq, `ALLOW_WEB_SEARCH`), Telegram Bot API, Supabase.

## CI

`.github/workflows/ingest-and-eval.yml` — faqat qo'lda (`workflow_dispatch`).
PR'larda test ishga tushiradigan CI yo'q (4-bosqichda qo'shiladi).
