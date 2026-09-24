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
| C-REL-1 | Boot'dagi `runMigrations` xato bersa, marshrutlarning katta qismi ulanmaydi, server esa "sog'lom" bo'lib ishlayveradi | ⏳ |

## High

| ID | Topilma | Holat |
|----|---------|-------|
| H-MONEY-1 | Haftalik draft limiti umuman tekshirilmaydi | 🟢 #320 |
| H-MONEY-2 | Hafta seshanbadan boshlanadi (Toshkent) | 🟢 #319 |
| H-MONEY-3 | Xulosa (opinion) krediti race: parallel so'rovlar bitta kreditni ikki marta sarflaydi | ⏳ |
| H-MONEY-4 | Kvota check-then-insert (race) va DB xatosida fail-open | 🟢 fail-closed #330; ⏳ race |
| H-MONEY-5 | `/api/analyze/ocr-image` va Workspace AI kvotasiz | 🟢 #332 |
| H-RAG-1 | Yangi tasdiqlangan javoblar embedding olmaydi | 🟢 #325 |
| H-RAG-2 | Freshness skripti hech qachon qonunni "kuchini yo'qotgan" deb belgilamaydi | 🟢 #324 |
| H-RAG-3 | Qayta ingest avval o'chiradi, keyin yozadi — embedding xatosida hujjat yo'qoladi | ⏳ |
| H-SEC-5 | `/api/health` korpus tafsilotlari va token holatini ochiq beradi | 🟢 #323 |
| H-SEC-6 | `escapeHtml` qo'shtirnoqni ekranlamaydi; `simpleMarkdown` linklarida sxema tekshiruvi yo'q; AI hujjat HTML'i xom qo'yiladi | 🟢 #328, #329 (escaper, linklar); ⏳ AI hujjat HTML'i |
| H-SEC-7 | `login.html` `postAuthDestination` open redirect (`/\evil.com`) | 🟢 #329 |
| H-SEC-8 | OTP va tokenlar logga yoziladi; OTP `Math.random` | ⏳ |
| H-REL-2 | Global error handler, graceful shutdown va AI fetch timeout'lari yo'q | ⏳ |
| H-REL-3 | `/api/register` autentifikatsiyasiz 10 MB base64 qabul qiladi; `verificationTokens` cheksiz o'sadi | ⏳ |

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
