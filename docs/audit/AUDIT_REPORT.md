# Audit hisoboti (1-bosqich: xavfsizlik, pul, ishonchlilik)

Sana: 2026-09-24. To'liq dalillar (fayl:qator) ilovalarda:
[money](findings/money.md), [reliability](findings/reliability.md),
[rag](findings/rag.md), [frontend-xss](findings/frontend-xss.md).

Daraja: **C** — Critical, **H** — High, **M** — Medium, **L** — Low.
Holat: ✅ PR ochildi, 🟢 merge qilindi (production), ⏳ backlog, 🟡 egasining qarori kerak ([DECISIONS](DECISIONS.md)).

## Critical

| ID | Topilma | Holat |
|----|---------|-------|
| C-SEC-1 | Oddiy `user` barcha murojaatlarni, Excel eksportni, xodimlar chatini ko'radi, murojaatlarni tayinlaydi va korpusga "tasdiqlangan" javob yozadi | 🟢 #326 |
| C-SEC-2 | Har boot'da `masteradmin` / `juristAI` (e'lon qilingan parol) master yaratiladi | 🟢 #322 — **parolni hoziroq o'zgartiring** |
| C-SEC-3 | Telegram webhook yo'li Express 5'da wildcard: soxta update va soxta to'lov yuborish mumkin; bot tokeni logga yoziladi | 🟢 #321 |
| C-SEC-4 | Dashboard'dagi murojaat modali Telegram foydalanuvchisi matnini ekranlamaydi (stored XSS → xodim sessiyasi) | 🟢 #328 (main'da 9 payload ishladi → 0) |
| C-MONEY-1 | To'lov provayderi yo'q, `PAYMENTS_ENABLED` bo'lsa `/api/tariff/select` pullik tarifni tekinga beradi | 🟢 D-2: yoqilmaydi (egasi qarori) |
| C-REL-1 | Boot'dagi `runMigrations` xato bersa, marshrutlarning katta qismi ulanmaydi, server esa "sog'lom" bo'lib ishlayveradi | 🟢 #335 |

## High

| ID | Topilma | Holat |
|----|---------|-------|
| H-MONEY-1 | Haftalik draft limiti umuman tekshirilmaydi | 🟢 #320 |
| H-MONEY-2 | Hafta seshanbadan boshlanadi (Toshkent) | 🟢 #319 |
| H-MONEY-3 | Xulosa (opinion) krediti race: parallel so'rovlar bitta kreditni ikki marta sarflaydi | 🟢 #341 (5 parallel → aynan 1) |
| H-MONEY-4 | Kvota check-then-insert (race) va DB xatosida fail-open | 🟢 #330, #341 (10 parallel, limit 3: eski 9 → yangi 3) |
| H-MONEY-5 | `/api/analyze/ocr-image` va Workspace AI kvotasiz | 🟢 #332 |
| H-RAG-1 | Yangi tasdiqlangan javoblar embedding olmaydi | 🟢 #325 |
| H-RAG-2 | Freshness skripti hech qachon qonunni "kuchini yo'qotgan" deb belgilamaydi | 🟢 #324 |
| H-RAG-3 | Qayta ingest avval o'chiradi, keyin yozadi — embedding xatosida hujjat yo'qoladi | 🟢 #342 |
| H-SEC-5 | `/api/health` korpus tafsilotlari va token holatini ochiq beradi | 🟢 #323 |
| H-SEC-6 | `escapeHtml` qo'shtirnoqni ekranlamaydi; `simpleMarkdown` linklarida sxema tekshiruvi yo'q; AI hujjat HTML'i xom qo'yiladi | 🟢 #328, #329, #343 |
| H-SEC-7 | `login.html` `postAuthDestination` open redirect (`/\evil.com`) | 🟢 #329 |
| H-SEC-8 | OTP va tokenlar logga yoziladi; OTP `Math.random` | 🟢 #340 |
| H-REL-2 | Global error handler, graceful shutdown va AI fetch timeout'lari yo'q | 🟢 #335, #344 |
| H-REL-3 | `/api/register` autentifikatsiyasiz 10 MB base64 qabul qiladi; `verificationTokens` cheksiz o'sadi | 🟢 #347 (ro'yxat xotirasi); ⏳ verificationTokens (ro'yxatdan o'tish Telegram OTP talab qiladi) |

## Medium (tanlab)

- M: `legal-verify` `corrected_answer` o'qiydi, `searchKorpus` esa `.answer` qaytaradi — QA korpus ishlatilmaydi.
- M: `answer_cache` korpus reviziyasiga bog'lanmagan (qonun o'zgarsa ham 72 soat eski javob).
- M: `isFailedAnswer` regex'i oddiy javoblarda ham ishlaydi → xotiradan qayta javob.
- M: Workspace a'zosining huquqi egasining tarifiga tushib qoladi.
- M: Ovoz berish (vote) dedupe yo'q; xodim fayllariga kirish chegarasi keng.
- M: Indekslar yo'q: `llm_spend_log(ts, user_id)`, `ai_analyses(request_id, created_at)`, `ai_chat_sessions(admin_id, updated_at)`.
- M: Rate-limit xotirada (bir nechta instansiyada ishlamaydi); CSP yo'q.
- M: LLM kunlik byudjeti UTC bo'yicha, tariflar esa Toshkent bo'yicha.
- M: Narxlar HTML'da takrorlangan (`tariff.html`, `index.html`).
- M: `npm audit`: 20 zaiflik (2 critical, 9 high).

## RAG sifati (2-bosqich uchun)

`findings/rag.md` "Top weaknesses" bo'limi: modda raqamlari va qisqartmalar
(ГК/УК/ТК/НК/КоАП, SK/MK) tanilmaydi; har bosqichda kesish (3200/2048/512/300/1200);
ivfflat `probes=1`; reranker kirish formati no-op bo'lishi mumkin (tekshirilmagan);
eval production pipeline'ni o'lchamaydi va 30 ta savoli ishonchsiz.

## Qo'shimcha (egasi qarorlari)

- 🟢 #330 — muddati o'tgan tarif → bepul (D-4); qimmat yo'llar fail-closed (D-5); xatoda limit qaytariladi va xabar beriladi (D-6).
- 🟢 #331 — fair-use og'irliklari (D-11): draft/xulosa endi ikki marta cheklanmaydi.
- 🟢 #332 — OCR sahifa limiti, Workspace AI hisobi, a'zo egasining tarifini meros qilmaydi (M4), haftalik limitdagi oxirgi draft rad etilishi tuzatildi.
- 🟢 #333 — Telegram Stars: invoice'dagi taklif bo'yicha kredit, kredit berilmasa refund (M6); eski `/api/subscription/*` olib tashlandi (M8).

## 2026-09-24 kechki ishlar (egasi: "davom et, merge ham qil")

- 🟢 #335 — yarim boot to'xtatildi, JSON xato ushlagichi, SIGTERM'da toza to'xtash.
- 🟢 #336 — server ichidagi RAG eval (`/api/admin/rag-eval`).
- 🟢 #337 — CI: testlar, haqiqiy Postgres'da boot smoke, npm audit hisoboti.
- 🟢 #338 — `.env.example`, `docs/RUNBOOK.md`.
- 🟢 #339 — npm audit fix: 20 → 14.
- 🟢 #340 — OTP'lar CSPRNG'dan, kod va tokenlar logda yo'q.
- 🟢 #341 — kvota va xulosa kreditlari race'i yopildi.
- 🟢 #342 — qayta ingest qonunni yo'qotmaydi.
- 🟢 #343 — AI hujjat HTML'i tozalanadi.
- 🟢 #344 — barcha tashqi so'rovlarga timeout.
- 🟢 #345 — margin report (doim 500 edi) tuzatildi, indekslar (migratsiya 010).
- 🟢 #346 — legal-verify QA korpusdan foydalanadi.
- 🟢 #347 — ro'yxatdan o'tish ro'yxati hujjatlarni xotiraga yuklamaydi.

Yangi topilma: `/api/admin/margin-report` production'da doim 500 qaytarardi
(`llm_spend_log.created_at` ustuni yo'q) — #345 da tuzatildi.

## GPT-6 Astra auditi topilmalari (2026-09-25)

Mustaqil audit (commit `4cca4ca`) kod topilmalari `main`ga solishtirib
tasdiqlandi va tuzatildi:

| ID | Topilma | Holat |
|----|---------|-------|
| S1 | Xodimga qaytarilgan Telegram fayl havolasida bot tokeni bor | 🟢 #349 — **deploy'dan keyin `TELEGRAM_BOT_TOKEN`ni almashtiring** |
| S2 | Fayl yo'llari murojaatga tegishlilikni tekshirmaydi | 🟢 #349 |
| S3 | `register/common` tasdiqlanmagan Telegram ID bilan akkaunt yaratadi | 🟢 #350 (main: 200, keyin: 400) |
| S4 | Google OAuth `state` soxtalashtiriladi (login CSRF) | 🟢 #350 |
| S5 | 4 xonali tiklash kodiga urinish limiti yo'q; eski sessiyalar bekor qilinmaydi | 🟢 #350 |
| S6 | DM UPDATE policy suhbat tomonlari va matnni o'zgartirishga yo'l qo'yadi | 🟢 #350 (migratsiya 011) |
| RAG6 | Eval `358¹`ni `358` deb hisoblaydi | ✅ #351 |

Ochiq (mahsulot): D1 Workspace fayllari indekslanmaydi; D3 shablon
eksportida erkin tahrir yo'qolishi mumkin; D4 Word eksporti haqiqiy DOCX
emas; RAG1/RAG2/RAG4/RAG5 (tahrir sanasi, kesh reviziyasi, QA eskirishi,
kesish). Bosh sahifadagi tasdiqlanmagan va'dalar — egasi bilan.
