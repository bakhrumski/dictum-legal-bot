# Backlog (ICE bo'yicha)

ICE = Impact × Confidence × Ease (har biri 1–10). Yuqoridan pastga bajariladi.
Egasining qarori kerak bo'lganlar [DECISIONS](DECISIONS.md)da.

| ICE | Ish | Soha | Branch / PR |
|-----|-----|------|-------------|
| 392 | RAG eval natijalarini olish (endpoint tayyor, #336) va yurist tekshirgan gold set | rag | egasi linkni ochadi |
| 240 | `user` roli uchun xodim polling'ini o'chirish (403 shovqini) | frontend | — |
| 224 | Embedding keshi (bir so'rovda 5–6 embed) | rag/perf | — |
| 180 | CSP sarlavhasi (avval report-only) | security | — |
| 160 | Vote dedupe | authz | — |

## Bajarilgan

- 🟢 #328 — dashboard XSS (murojaat modali, ismlar, markdown linklar).
- 🟢 #329 — login open redirect, enterprise/templates escaperlari.
- 🟢 #330–#333 — egasi qarorlari D-4…D-12.
- ✅ #349–#358 — Astra auditi: S1–S6, DOCX, shablon tahriri, Workspace indeksi, kesh reviziyasi, modda va qonun nomlarini tanish.

## Yangi (ixtiyoriy)

- Telegram'i bog'langan pullik veb tarif egalari botda o'z tarifidan foydalansin (D-12, 3-band).
- OCR va GPT-6 birlik narxlarini qayta o'lchab, worst-case marjani yangilash.
- 🟢 #335–#347 — ishonchlilik, xavfsizlik, CI, RAG eval, indekslar.

## Qo'shildi

| ICE | Ish | Soha |
|-----|-----|------|
| 300 | cheerio 1.x (lex.uz xarakterizatsiya testlari bilan) | security/rag |
| 280 | node-telegram-bot-api'ning `request` zanjiri (2 critical) | security |
| 240 | `verificationTokens` hajmini cheklash | reliability |
| 200 | Loglardagi foydalanuvchi savollarini qisqartirish (PII) | compliance |
