# Backlog (ICE bo'yicha)

ICE = Impact × Confidence × Ease (har biri 1–10). Yuqoridan pastga bajariladi.
Egasining qarori kerak bo'lganlar [DECISIONS](DECISIONS.md)da.

| ICE | Ish | Soha | Branch / PR |
|-----|-----|------|-------------|
| 640 | AI hujjat HTML'ini sanitize qilish (`renderDocMessage`, `document.write`) | frontend | — |
| 560 | Opinion kredit rezervatsiyasi (tranzaksiya + `FOR UPDATE`) | money | — |
| 560 | Kvota: tranzaksiya + advisory lock (race) | money | — |
| 504 | Boot: `runMigrations` xatosida jarayonni to'xtatish (partial boot o'rniga) | reliability | — |
| 480 | Global error handler, `SIGTERM` graceful shutdown, AI `fetch` timeout (AbortSignal) | reliability | — |
| 448 | OTP/token loglarini olib tashlash, `crypto.randomInt` OTP | security | — |
| 432 | Qayta ingest: avval embedding, keyin tranzaksiyada delete+insert | rag | — |
| 400 | CI: PR'da `npm test`, `test:workspace`, `test:all`, `npm audit` (Node 22) | ci | — |
| 392 | RAG eval: production `retrieveLegalContext` orqali, qonun+modda aniqligida, 150+ savol | rag | — |
| 360 | Qisqartmalar va Latin "modda N" regex, Kirill/Rus shakllari | rag | — |
| 336 | `legal-verify` `.answer` bug | rag | — |
| 320 | `answer_cache` kalitiga korpus reviziyasini qo'shish | rag | — |
| 280 | Indekslar (qaytariladigan migratsiya) | db | — |
| 240 | `user` roli uchun xodim polling'ini o'chirish (403 shovqini) | frontend | — |
| 224 | Embedding keshi (bir so'rovda 5–6 embed) | rag/perf | — |
| 200 | `.env.example`, runbook, README | docs | — |
| 180 | CSP sarlavhasi (avval report-only) | security | — |
| 160 | Vote dedupe | authz | — |

## Bajarilgan

- 🟢 #328 — dashboard XSS (murojaat modali, ismlar, markdown linklar).
- 🟢 #329 — login open redirect, enterprise/templates escaperlari.
- 🟢 #330–#333 — egasi qarorlari D-4…D-12.

## Yangi (ixtiyoriy)

- Telegram'i bog'langan pullik veb tarif egalari botda o'z tarifidan foydalansin (D-12, 3-band).
- OCR va GPT-6 birlik narxlarini qayta o'lchab, worst-case marjani yangilash.
