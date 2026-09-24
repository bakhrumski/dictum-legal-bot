# Backlog (ICE bo'yicha)

ICE = Impact × Confidence × Ease (har biri 1–10). Yuqoridan pastga bajariladi.
Egasining qarori kerak bo'lganlar [DECISIONS](DECISIONS.md)da.

| ICE | Ish | Soha | Branch / PR |
|-----|-----|------|-------------|
| 810 | Dashboard murojaat modali va ismlar ro'yxatlarini ekranlash; `escapeHtml` qo'shtirnoq/non-string xavfsiz | frontend | `audit/frontend-escape-request-modal` |
| 720 | Login open redirect | frontend | `audit/frontend-login-redirect` |
| 640 | `simpleMarkdown` faqat `https:` linklar; AI hujjat HTML'ini sanitize qilish | frontend | `audit/frontend-ai-html` |
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
| 300 | OCR va Workspace AI kvotasi | money | D-7 dan keyin |
| 280 | Indekslar (qaytariladigan migratsiya) | db | — |
| 240 | `user` roli uchun xodim polling'ini o'chirish (403 shovqini) | frontend | — |
| 224 | Embedding keshi (bir so'rovda 5–6 embed) | rag/perf | — |
| 200 | `.env.example`, runbook, README | docs | — |
| 180 | CSP sarlavhasi (avval report-only) | security | — |
| 160 | Vote dedupe | authz | — |
