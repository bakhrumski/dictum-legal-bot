# Tariflar v2 — moliyaviy hisobot (2026-10-04, yangilangan 2026-10-06, OCR bilan)

**Holat: rejalashtirish.** Bu hisobotdagi barcha xarajat raqamlari egasining
dastlabki birlik budjetlaridan chiqadi. Ular provayderning tasdiqlangan
narxlari emas, o'lchangan tannarx ham, billing kafolati ham emas. Hujjat
tahlili, yuridik xulosa va draftning haqiqiy tannarxi **hali o'lchanmagan**.
Shu sabab bu limitlar moliyaviy jihatdan tasdiqlangan deb e'lon qilinmaydi.

Raqamlar `node scripts/tariff-scenarios.js` bilan koddagi katalog va planlash
budjetidan qayta chiqariladi (`src/rag/tariff-ledger.js` `PLAN_CATALOG`,
`PLANNING`). Kod o'zgarsa, hisobot ham shu buyruq bilan yangilanadi.

## 1. Fakt, taxmin va noma'lum

| Tur | Nima | Manba |
|---|---|---|
| **Fakt** | Narxlar 199 000 / 599 000 / 999 000 so'm; limitlar (jadval `docs/tariffs-v2.md`); Gold 3×, Platinum 5× | Kod va testlar (`tests/tariffs-v2*.test.js`) |
| **Fakt** | Har bir AI chaqiruvi `llm_spend_log` da: provider, model, tokenlar, reasoning tokenlari, retry/fallback/skipped, known / estimated / unknown xarajat, narx manbasi va versiyasi | `src/ai/usage-ledger.js` |
| **Fakt** | Har bir yetkazilgan ish (`tariff_usage`, `status = committed`) o'z AI so'roviga (`request_id`) bog'langan; xizmat bo'yicha o'lchangan tannarx `GET /api/admin/tariff/economics` → `measured` | `measuredServiceCost` |
| **Taxmin (egasi)** | Kurs 12 000 so'm/$; chat $0.025; tahlil va xulosa $0.30/birlik; draft $0.06; operatsion ajratma 10 200 / 30 600 / 51 000 so'm | `PLANNING` |
| **Taxmin (shu hisobot)** | Tasdiqlangan javob bazadan berilganda generatsiya narxining 20% (retrieval, moslik tekshiruvi, infratuzilma 0 emas) | `--hit-cost-share` |
| **Taxmin (rejalashtirish)** | OCR: PDF sahifasi $0.010959, 16 MP rasm $0.019673 — Gemini-only yo'nalish uchun rejalashtirish taxmini; real tannarx yoki qat'iy maksimal emas (Developer API narxi, 2026-08-11; §2a) | `src/ocr/scan-limits.js` |
| **Noma'lum** | Hujjat tahlili, xulosa va draftning haqiqiy birlik narxi; OCR sahifasining haqiqiy (o'lchangan) narxi va VoiceLab / OpenAI vision fallback narxi; STT, TTS narxi; Gemini embedding narxi (`AI_PRICE_OVERRIDES` bo'lmaguncha "estimated"); VoiceLab kredit iste'moli (kredit qaytmasa noma'lum, token narxiga aylantirilmaydi) | Benchmark va production o'lchovi kerak |
| **Noma'lum** | Hosting (Render), Supabase (DB + storage), support, Workspace storage — operatsion ajratmani tekshirish uchun hisob-fakturalar kerak | Egasining hisoblari |
| **Doira (scope), o'lchov emas** | To'lov komissiyasi 0: provayder ulanmagan, to'lov qo'lda (master grant). Provayder ulanganda komissiya noma'lum bo'ladi, model qayta tekshiriladi; eski takliflar shungacha qo'llanmaydi | `feeScope` (`src/rag/tariff-pricing.js`) |
| **Noma'lum (0 emas)** | Refundlar: qaytarish oqimi va yozuvi yo'q. Hisobotda `refundsUzs: null`, `refundsStatus: 'not_tracked'` — "tasdiqlangan nol refund" emas | `marginReport` |
| **Alohida, bu yerda yo'q** | Umumiy kompaniya xarajatlari, marketing (CAC), soliqlar, individual yurist ekspertizasi | — |

Xizmat marjasi (narx − xizmat budjeti) **sof foyda emas**: yuqoridagi alohida
xarajatlar undan keyin ayiriladi.

## 2. Hisob-kitob

Asos: planning budgets at 100% use, not measured cost (src/rag/tariff-ledger.js PLANNING). Kurs 12000 so'm/$.

| Tarif | Narx | AI budjeti | Operatsion | Jami xizmat | Qoladi | Xizmat marjasi | 80% chegara |
|---|---:|---:|---:|---:|---:|---:|---:|
| Silver | 199 000 | 141 362 | 10 200 | 151 562 | 47 438 | 23.84% | 159 200 |
| Gold | 599 000 | 424 086 | 30 600 | 454 686 | 144 314 | 24.09% | 479 200 |
| Platinum | 999 000 | 706 810 | 51 000 | 757 810 | 241 190 | 24.14% | 799 200 |

OCR: PDF sahifasi uchun $0.010959 — rejalashtirish taxmini; real tannarx ham, qat'iy maksimal narx ham emas (o'lchanmagan). gemini-2.5-flash, Gemini Developer API (generativelanguage.googleapis.com v1beta, API key); narx $0.3 / $2.5 per 1M (https://ai.google.dev/gemini-api/docs/pricing (paid tier; the free tier bills $0), checked 2026-08-11).
  = ((5160 PDF sahifasi + 305 prompt ulushi) × $0.3 + (1536 chiqish + 0 thinking) × $2.5) / 1M × 2 (retry) × 1 = $0.0054795 × 2. Kirmaydi: qayta o'qishlar, fallback.
  Alohida rasm (16 MP chegarasida, taxmin): 19683 input token → $0.019673.
  100% da sahifalar: Sinov 30, Silver 240, Gold 720, Platinum 1200. Faqat Gemini-only yo'nalishida amal qiladi (OCR_IMAGE_PROVIDER=gemini, OCR_FALLBACK=off).

Bitta Sinov AI budjeti (OCR bilan): $1.054 ≈ 12 645 so'm (OCR'siz 8 700 so'm).

| Ssenariy | Tushum, mln | Pullik xizmat budjeti, mln | Sinov AI, mln | Natija, mln (boshqa xarajatlardan oldin) |
|---|---:|---:|---:|---:|
| 1. 1 000 yangi Sinov + 100 Silver (hammasi 100%) | 19.90 | 15.16 | 12.64 | -7.90 |
| 2. 100 yangi Sinov + 100 Silver | 19.90 | 15.16 | 1.26 | 3.48 |
| 3. 100 Silver renewal, yangi Sinovsiz | 19.90 | 15.16 | 0.00 | 4.74 |
| 4. 100 Gold + 100 Platinum | 159.80 | 121.25 | 0.00 | 38.55 |
| 5. 1 Platinum + 4 Silver (bitta Workspace) | 1.79 | 1.36 | 0.00 | 0.43 |

1 000 Sinovni qoplash uchun kamida 267 ta Silver xaridi kerak (har biri 47 438 so'm qoldiradi).

Tasdiqlangan javob hit rate (hit narxi = generatsiyaning 20% — taxmin):

| Hit rate | Silver | Gold | Platinum |
|---|---:|---:|---:|
| 0% | 151 562 (76.2%) | 454 686 (75.9%) | 757 810 (75.9%) |
| 25% | 142 562 (71.6%) | 427 686 (71.4%) | 712 810 (71.4%) |
| 50% | 133 562 (67.1%) | 400 686 (66.9%) | 667 810 (66.8%) |
| 75% | 124 562 (62.6%) | 373 686 (62.4%) | 622 810 (62.3%) |

Stress (jami xizmat budjeti, narxga nisbatan; 80% chegara):

| Holat | Silver | Gold | Platinum |
|---|---:|---:|---:|
| provider narxi yoki kurs +20% | 173 522 (87.2% ⚠ >80%) | 520 566 (86.9% ⚠ >80%) | 867 610 (86.8% ⚠ >80%) |
| hujjat tannarxi +50% (tahlil va xulosa $0.45) | 180 362 (90.6% ⚠ >80%) | 541 086 (90.3% ⚠ >80%) | 901 810 (90.3% ⚠ >80%) |
| storage/ops +50% | 156 662 (78.7%) | 469 986 (78.5%) | 783 310 (78.4%) |
| OCR sahifa narxi +50% | 167 343 (84.1% ⚠ >80%) | 502 029 (83.8% ⚠ >80%) | 836 714 (83.8% ⚠ >80%) |
| har bir OCR sahifasi 16 MP rasm | 176 658 (88.8% ⚠ >80%) | 529 973 (88.5% ⚠ >80%) | 883 288 (88.4% ⚠ >80%) |
| hammasi birga | 228 963 (115.1% ⚠ >80%) | 686 889 (114.7% ⚠ >80%) | 1 144 814 (114.6% ⚠ >80%) |

Individual chegirma chegarasi (xarajat modeli cm-2026-10-06-planning-v2-ocr, taxminiy):

| Tarif | Katalog | Konservativ xarajat | Minimal narx (xarajat / 0,80, 1 000 ga yuqoriga) | Eng katta chegirma | Minimal narxda xarajat ulushi |
|---|---:|---:|---:|---:|---:|
| Silver | 199 000 | 151 562 | 190 000 | 9 000 (4.52%) | 79.8% |
| Gold | 599 000 | 454 686 | 569 000 | 30 000 (5%) | 79.9% |
| Platinum | 999 000 | 757 810 | 948 000 | 51 000 (5.1%) | 79.9% |

100 Silver: 70 katalog narxida, 30 minimal narxda (hammasi 100%): katalog bo'yicha 19.90 mln, haqiqiy tushum 19.63 mln (chegirma 0.27 mln), xizmat budjeti 15.16 mln, natija 4.47 mln (boshqa xarajatlardan oldin).

Chatdagi OCR, A/B (100% foydalanish). A — OCR faqat tahlil/xulosa ichida; B — A + chatdagi skan sahifalari (hozirgi taklif). Chat sahifalari = tahlil birligi × 10 (tariflar v2 qoidasi), o'lchangan talab emas.

| Tarif | Tahlil+xulosa OCR (sahifa / so'm) | Chat OCR (sahifa / so'm) | A: xizmat xarajati (ulush) | B: xizmat xarajati (ulush) | A: minimal narx / eng katta chegirma | B: minimal narx / eng katta chegirma |
|---|---:|---:|---:|---:|---:|---:|
| Sinov | 20 / 2 631 | 10 / 1 316 | 11 331 (—) | 12 646 (—) | — | — |
| Silver | 160 / 21 042 | 80 / 10 521 | 141 042 (70.9%) | 151 562 (76.2%) | 177 000 / 22 000 | 190 000 / 9 000 |
| Gold | 480 / 63 124 | 240 / 31 562 | 423 124 (70.6%) | 454 686 (75.9%) | 529 000 / 70 000 | 569 000 / 30 000 |
| Platinum | 800 / 105 207 | 400 / 52 604 | 705 207 (70.6%) | 757 810 (75.9%) | 882 000 / 117 000 | 948 000 / 51 000 |

1 000 Sinov + 100 Silver: A — natija -5.54 mln, qoplash uchun 196 Silver; B — natija -7.90 mln, qoplash uchun 267 Silver.

### 2a. OCR (skan hujjat) — 2026-10-06, #411 review

OCR alohida xizmat emas: skan hujjat tahlil, xulosa yoki chat ichida
o'qiladi (`docs/tariffs-v2.md` §4). Lekin provayder xarajati bor, shuning
uchun u xizmat budjetiga, Sinovga va chegirma chegarasiga kiritilgan.

**PDF sahifasi: $0.010959 — rejalashtirish taxmini.** Bu real tannarx emas
va qat'iy maksimal narx ham emas. Haqiqiy narx o'lchanmagan; uni pilot har
chaqiruvning `usageMetadata` maydonlaridan (promptTokenCount,
candidatesTokenCount, thoughtsTokenCount) o'lchaydi.

| Qism | Qiymat | Holat | Asos |
|---|---:|---|---|
| Model, API | gemini-2.5-flash, **Gemini Developer API** (`generativelanguage.googleapis.com/v1beta`, API key) | fakt (kod) | Vertex AI emas |
| Narx | $0.30 / 1M input, $2.50 / 1M output | manbali, **qayta tekshirilmagan** | `src/ai/model-pricing.js`: ai.google.dev/gemini-api/docs/pricing, paid tier, 2026-08-11. 2026-10-06/07 da ai.google.dev bu muhitdan ochilmadi |
| PDF sahifasi (input) | 5 160 token | **rejalashtirish taxmini, isbotlangan chegara emas** | Vertex sahifasi: PDF sahifasi bitta rasm sifatida hisoblanadi; "1024x1024 image … 1290 tokens; varies by resolution". ×4 — katta sahifa tasviri uchun zaxira. Developer API uchun sahifa token soni bu yerda o'qilmadi |
| Alohida rasm (input) | 1 290 × max(1, piksel / 1024²); 16 MP chegarasida 19 683 | **rejalashtirish taxmini** | Vertex misoliga proporsional deb olingan, e'lon qilingan raqam emas. 16 MP rasm sahifasi ≈ $0.019673 |
| Prompt | sahifaga 305 (ulush) | chaqiruv bo'yicha isbotlangan chegara, sahifaga ulush | prompt chaqiruvga bir marta yuboriladi. UTF-8 bayt chegarasi: rasm — 305, PDF bo'lagi (5 sahifa) — 463 (sahifaga ≈93), 1 sahifali PDF chaqiruvi — 462 (+157 token ≈ +$0.00005) |
| Chiqarilgan matn | sahifaga 1 536 | biz yuboradigan chegara | `maxOutputTokens = 1 536 × chaqiruvdagi sahifalar` — har sahifa uchun, bo'lak ichida umumiy; chegaraga yetgan o'qish rad etiladi, lekin to'lanadi |
| Thinking | 0 | **reja, tasdiqlanmagan** | `thinkingConfig.thinkingBudget = 0` yuboriladi (request testi bor). Gemini thinking'ni output narxida, `candidatesTokenCount` dan tashqarida hisoblaydi — real javobda 0 ekanini pilot tasdiqlaydi |
| Retry | ×2 | fakt (kod) | usage-ledger chaqiruvni bitta vaqtinchalik xatoda qayta yuboradi. Retry butun bo'lakni (5 sahifa input + output) qayta yuboradi, shuning uchun ×2 bo'lakdagi har bir sahifaga qo'llanadi |
| Qayta o'qish (kesilgan yoki yetishmagan sahifa) | — | **taxminga kirmaydi** | bo'lak yarmlarga bo'linib qayta o'qiladi, oxirida bitta sahifa 4 096 token bilan bir marta o'qiladi; har biri ledgerda alohida qator. Qanchalik tez-tez bo'lishi o'lchanmagan |
| Fallback (VoiceLab, OpenAI vision) | — | **noma'lum, taxminga kirmaydi** | pastda |
| Qo'shimcha zaxira | ×1 | — | yuqoridagilardan tashqari zaxira yo'q |

Formula (PDF sahifasi):
`((5 160 + 305) × 0.30 + (1 536 + 0) × 2.50) / 1 000 000 × 2 × 1 = 0.0054795 × 2 = $0.010959`

Ko'p sahifali faylda xarajat qanday taqsimlanadi (masalan, 30 sahifa):
- PDF 5 sahifali bo'laklarga bo'linadi, ya'ni 6 ta chaqiruv. Har birining chiqish chegarasi 5 × 1 536 = 7 680 token.
- Prompt har chaqiruvga bir marta ketadi: 6 × 463 = 2 778 token. Taxmin esa 30 × 305 = 9 150 token ajratadi.
- Retry faqat xato qilgan bo'lakni qayta yuboradi, butun hujjatni emas. Taxmin har bo'lakni ikki marta to'langan deb oladi.
- Kesilgan bo'lak yarmlarga bo'linadi (5 → 3 + 2 → … → 1). Bu qo'shimcha chaqiruvlar taxminga kirmaydi va ledgerda ko'rinadi.

**PDF qamrovi.** Har bir chaqiruvga sahifa soni aytiladi va javob har sahifani `=== PAGE n ===` belgisi bilan boshlashi kerak.
- Yetishmagan sahifa, ostida matni yo'q belgi yoki bo'sh javob — sahifa o'qilmagan deb hisoblanadi.
- Bo'sh sahifa `[[EMPTY PAGE]]` bilan qabul qilinadi.
- Oxirgi urinishdan keyin ham kesilgan, bo'sh yoki yetishmagan sahifa bo'lsa, butun hujjat rad etiladi (`OCR_TRUNCATED`, `OCR_INCOMPLETE`, `OCR_EMPTY`): hech narsa keshlanmaydi, qisman matn tahlilga yuborilmaydi, xizmat limiti qaytariladi, provayder sarfi ledgerda qoladi.
- Kesilgan o'qish provayder xatosi hisoblanmaydi: retry qilinmaydi va circuit breaker ochilmaydi.

**Provayder tanlash qoidasi** (`scanLimits.ocrProviders`, jimgina almashtirilmaydi):

| Fayl | Birinchi (primary) | Keyin (fallback, `OCR_FALLBACK=off` bo'lmasa) |
|---|---|---|
| Rasm, default | VoiceLab vision (vision lane yoqilgan bo'lsa — #411 dan oldingidek), aks holda Gemini | qolganlari: Gemini → OpenAI vision |
| Rasm, `OCR_IMAGE_PROVIDER=gemini` | Gemini | VoiceLab → OpenAI vision |
| Skan PDF | Gemini (VoiceLab va OpenAI Chat Completions PDF qabul qilmaydi) | yo'q |

- Har bir provayder chaqiruvi `llm_spend_log` da o'z `provider` qatori bilan yoziladi (stage `ocr`), shuning uchun primary va fallback xarajatlari alohida ko'rinadi.
- Gemini'da kesilgan o'qish (MAX_TOKENS) boshqa provayderga yuborilmaydi — rad etiladi.

**Xarajat holati:**

| Yo'nalish | Sahifa narxi |
|---|---|
| Gemini-only (`GEMINI_API_KEY` + `OCR_IMAGE_PROVIDER=gemini` + `OCR_FALLBACK=off`) | $0.010959 (budjet) |
| VoiceLab vision (aisha-halo) primary yoki fallback | noma'lum: token narxi bor, lekin rasm input tokenlari e'lon qilinmagan; kredit tokenga aylanmasligi mumkin |
| OpenAI vision fallback | noma'lum: rasm tokenlari bu yerda chegaralanmagan |

Qoida: OCR narxi "taxminiy" faqat sahifa yeta oladigan **har bir** provayder Gemini bo'lganda (`ocrCostBasis`). Aks holda OCR narxi noma'lum, Gemini budjeti boshqa provayderga qo'llanmaydi va chegirma taklifi yaratilmaydi.

**Production uchun xulosa:** production'da VoiceLab yoqilgan. Uning vision lane'i ham yoqilganmi yoki default fallback'lar bor-yo'qligi tekshirilmagan. Agar shunday bo'lsa, production'da OCR narxi **noma'lum** bo'ladi va chegirmalar to'xtaydi. Bu jadvaldagi raqamlar Gemini-only konfiguratsiya uchun.

**Chegirma holati (production yo'nalishi).** Agar OCR yo'lida VoiceLab vision (yoki OpenAI vision fallback) bo'lsa, OCR narxi noma'lum bo'ladi. Bu holatda:
- yangi chegirma taklifi yaratilmaydi;
- admin quote kartasida "OCR xarajati: noma'lum", amaldagi rasm/PDF yo'li va sabab yoziladi;
- oddiy tarif xizmatlari, qo'lda grant va allaqachon sotib olingan davrlar o'zgarmaydi (`tests/tariff-offers*.test.js`);
- provayder yo'li chegirma uchun Gemini'ga almashtirilmaydi.

**Chatdagi OCR chegaralari (10/80/240/400) qayerdan:** tariflar v2 qoidasi "davr uchun har bir tahlil birligiga 10 sahifa" (`PLAN_CATALOG`: `ocr = analysis × 10`; Sinov 1, Silver 8, Gold 24, Platinum 40 tahlil). Ular chatdagi skan talabining o'lchovidan emas, tahlil kvotasidan kelib chiqqan. Bu PR ularni o'zgartirmaydi.

**Bu raqamlar tasdiqlangan chegirma chegaralari emas.** 190 000 / 569 000 / 948 000 — o'lchanmagan planlash budjeti va OCR sahifasi budjetidan hisoblangan taxminiy chegaralar. Haqiqiy tannarx o'lchanmaguncha ular tasdiqlangan deb e'lon qilinmaydi.

Eski takliflar: xarajat modeli versiyasi o'zgardi (`cm-2026-10-05-planning-v1` → `cm-2026-10-06-planning-v2-ocr`). Eski faol taklif `offer_cost_model_changed` bilan to'xtaydi va Master uni qayta ko'radi.

## 3. 80% xarajat maqsadi

- **Planlash budjeti bo'yicha (OCR bilan, 2026-10-06):** 100% foydalanishda xizmat budjeti narxning ~76% i (Silver 76,2%, Gold 75,9%, Platinum 75,9%); chatdagi OCR'siz (A) ~71% — 80% chegarasidan past, lekin zaxira kichik. OCR'siz ~60% edi. Bu **dalil emas, reja**: haqiqiy birlik narxi o'lchanmaguncha maqsad bajarilgan deb hisoblanmaydi.
- **Bitta stress ham yetadi:** provayder narxi yoki kurs +20% → ~87%; hujjat tannarxi +50% → ~90%; OCR sahifa narxi +50% → ~84%. Hammasi 80% dan oshadi.
- **Hammasi birga** (narx +20%, hujjat +50%, storage +50%, OCR +50%) → **~115%**. Agar o'lchov hujjat birligini $0.45 dan qimmat ko'rsatsa, birinchi tuzatish — tahlil/xulosa limitlari yoki birlik hajmi (masalan, 1 birlik = 8 sahifa / 32 000 belgi). Narxga tegish ikkinchi.
- **Tekshirish usuli:**
  - **Narxi ma'lum o'lchov:** `GET /api/admin/tariff/economics?days=30` → `measured[].knownUsdPerUnit` ni `planningUsdPerUnit` bilan solishtirish. `complete: false` bo'lsa (noma'lum narxli chaqiruv bor), natija faqat quyi chegara.
  - **To'liq foydalanuvchi:** `GET /api/admin/margin-report` — mijoz bo'yicha real `llm_spend_log` xarajati.

## 4. Ssenariylar talqini

- **1-ssenariy** (1 000 Sinov + 100 Silver, hammasi 100%, OCR bilan) — boshqa xarajatlardan oldin −7,90 mln. Birinchi davrni qoplash uchun kamida **267 Silver** kerak. Bu konversiya taxmini emas: 1 000 Sinovdan 267 tasi (26,7%) to'lashi kerak degani. Har bir Sinov ikkita 10 sahifali skan hujjat va 10 sahifa chat skani bilan to'liq ishlatilgan deb olingan — bu eng yomon holat.
- **Trial conversion, retention va CAC** bu yerda aralashtirilmaydi:
  - har biri o'lchanmagan;
  - marketing xarajati xizmat marjasidan alohida.
- **Sinov narxi** $1.054 (OCR'siz $0.725) — bu Sinovning to'liq ishlatilishi; ko'p foydalanuvchi uni oxirigacha ishlatmaydi. Haqiqiy o'rtacha qiymatni `tariff_usage` (`period.source = trial`) va `measured` beradi.
- **Telegram Stars.**
  - Narx: hozir 1 ⭐ = 4 qo'shimcha javob (`TG_PAID_ANSWER_STARS`, `TG_PAID_ANSWER_CREDITS`; D-12 bo'yicha saqlangan).
  - Muammo: 1 ⭐ dasturchiga taxminan $0.013 keltiradi (Telegram kursi, tekshirilmagan), 4 javobning planlash budjeti esa $0.10. Ya'ni bu paket chat birligining planlash narxidan ancha arzon.
  - Tavsiya: yangi invoice narxini (masalan, 1 ⭐ = 1 javob yoki Stars sotuvini to'xtatish) egasi hal qiladi. Kod buni o'zgartirmadi.
  - Sotib olingan kreditlar to'liq saqlanadi.

## 5. Individual chegirmalar (2026-10-05)

Qoida: `finalPrice >= conservativeTotalServiceCost / 0.80`, minimal narx 1 000 so'mga yuqoriga yaxlitlanadi, butun son (so'm) arifmetikasi (`src/rag/tariff-pricing.js`).

**Konservativ xarajat nimadan tuziladi:**
- yangi davr limitlarining 100% ishlatilishi (planlash birlik budjetlari bilan, barcha AI bosqichlari);
- OCR: (tahlil + xulosa) × 10 sahifa + chatdagi skan chegarasi, sahifa narxi taxmini bilan (§2a); taxmin amal qilmasa — noma'lum, taklif yo'q;
- operatsion ulush: hosting, DB, storage, support; Platinum'da Workspace ham;
- to'lov komissiyasi — hozir doira bo'yicha 0 (pastda).

**Nimalar ishlatilmaydi:** foydalanuvchining tarixiy kam sarfi, o'rtacha yoki p95 sarf, isbotlanmagan cache foydasi.

**O'lchangan tannarx** faqat yuqoriga ta'sir qiladi: agar o'lchangan birlik narxi planlash budjetidan yuqori bo'lsa, AI qismi oshiriladi.

**Asos o'lchanmagan, chegaralar tasdiqlanmagan.** 190 000 / 569 000 / 948 000 minimal narxlar egasining o'lchanmagan planlash budjetidan va OCR sahifasining budjetidan chiqadi; ular faqat Gemini-only OCR yo'nalishida amal qiladi; admin ekrani har quote'da buni ko'rsatadi. Pilot (§7) o'lchagan birlik narxi budjetdan yuqori chiqsa, minimal narx avtomatik ko'tariladi (o'lchov faqat yuqoriga ta'sir qiladi).

**Payment fee:**
- Hozir 0 bp. Bu o'lchangan komissiya emas, **hisob doirasi**: provayder ulanmagan, to'lov qo'lda (master grant) qabul qilinadi (`feeScope.providers = ['manual']`). Admin ekranida "To'lov komissiyasi: 0 so'm · doira" qatori izohi bilan chiqadi.
- Provayder ulanganda komissiya ulush sifatida kiritiladi, formula `fixed / (0.80 − fee)`. Misol: 3% fee bilan 120 000 so'mlik xarajatning minimal narxi 156 000.
- Taklif o'zi hisoblangan doira va model versiyasini saqlaydi. Boshqa provayder orqali, boshqa komissiya bilan yoki boshqa model versiyasida u aktivlashtirilmaydi (`offer_fee_scope_changed`, `offer_cost_model_changed`). Master qayta tekshirib, yangi taklif yaratadi; avtomatik qayta narxlash yo'q.

**Noma'lum xarajat:** asoslangan zaxirasi bo'lmasa, taklif rad etiladi (0 deb hisoblanmaydi).

**Minimal narx katalog narxidan yuqori bo'lsa:**
- chegirma berilmaydi;
- admin ogohlantirishi chiqadi;
- sotib olingan huquqlar o'zgarmaydi.

**Taklif nimani o'zgartiradi va nimani o'zgartirmaydi:**
- Kvotani kamaytirmaydi — tarifning to'liq limiti beriladi.
- Bitta 30 kunlik davr uchun, bir martalik; renewal'ga o'tmaydi.
- Yaratilishi obunani faollashtirmaydi: haqiqiy to'lov tasdiqlangach `POST /api/admin/tariff/grant { offerId, paymentRef }` (kelajakdagi provider callback ham shu funksiya).
- Narx taklifdan olinadi: klient yuborgan summa farq qilsa, grant rad etiladi.

**Upgrade bilan birga:**
- Eski davr(lar)ning ishlatilmagan qiymati `credit_uzs` sifatida yoziladi — bu yangi naqd tushum emas.
- `price_uzs` = naqd = yakuniy narx − kredit.
- Yangi kvota to'liq xarajat bilan baholanadi (`economics` maydoni).
- To'lov qabul qilingandan keyin model o'zgargan bo'lsa ham, narx hurmat qilinadi va `belowCurrentMinimum` belgisi qo'yiladi. Yashirin qo'shimcha haq chiqarilmaydi.

**Audit** (`tariff_offers`): `offer_id`, `user_id`, plan va kvota versiyasi, `list_price` / `discount` / `final_price`, `min_price`, `cost_estimate` va `cost_model_version`, yaratuvchi Master, sabab, `created_at` / `expires_at`, holat (draft / active / redeemed / expired / revoked), `payment_ref` va aktivatsiya qilingan `period_id`. Bekor qilish allaqachon sotib olingan davrni bekor qilmaydi.

## 6. Margin hisoboti: naqd, kredit va xizmat daromadi alohida (2026-10-06)

`GET /api/admin/margin-report?since=&until=` (`marginReport`, `periodRevenue`). Uch xil narsa aralashmaydi:

| Ko'rsatkich | Nima | Qachon sanaladi |
|---|---|---|
| `cashReceivedUzs` | Mijoz to'lagan naqd (`price_uzs`) | To'lov qabul qilingan paytda (`paid_at`), **bir marta** |
| `creditCarriedInUzs` / `creditCarriedOutUzs` | Upgrade'da mijozning bir davridan boshqasiga o'tgan qiymat | Naqd emas; daromad sifatida qayta sanalmaydi |
| `recognizedRevenueUzs` | Xizmat daromadi: davr narxi + kirgan kredit − chiqqan kredit, davr ishlagan kunlarga taqsimlanadi | Davr kunlari oynaga tushganda |
| `deferredRevenueUzs` | To'langan, lekin oyna oxirigacha hali ishlab topilmagan qism | Oyna oxirida |

**Qanday ishlaydi:**
- Upgrade'da eski davr upgrade paytida tugaydi. Uning upgrade'ga o'tgan qiymati `carried_out_uzs` bo'lib yoziladi.
- Oldindan sotib olingan, lekin hali boshlanmagan renewal ham upgrade'da almashtiriladi: uning qiymati kreditga o'tadi, kredit bo'lmagan qoldiq almashtirilgan paytda tan olinadi.
- Daromad kumulyativ funksiya bilan hisoblanadi, shuning uchun oynalar qo'shiladi: [a, b) + [b, c) = [a, c). Hech bir so'm ikki marta sanalmaydi.
- `recognized + deferred = naqd` tenglamasi testlarda aniq bajariladi.

**Aniq summali tekshiruv** (`tests/tariff-revenue.db.test.js`):
- **Oddiy renewal.** Ikki marta 199 000 to'langan, ikkinchisi 29-kuni. [-1; 40) oynasida: naqd 398 000, daromad 265 333, kechiktirilgan 132 667.
- **Oldindan sotib olingan renewal** (1-kuni to'langan). [-1; 15) oynasida: naqd 398 000, daromad 99 500. [30; 45) oynasida yangi naqd yo'q, daromad 99 500.
- **Upgrade zanjiri.** Silver 0-kuni, renewal 5-kuni oldindan, Gold 10-kuni.
  - Kredit = 132 666 (ishlayotgan davrning 20/30 qismi) + 199 000 (navbatdagi renewal) = 331 666; 1 000 ga pastga yaxlitlanib 331 000.
  - Gold uchun naqd 268 000.
  - Kompaniya naqdi 666 000 — 997 000 emas (kredit qayta sanalmagan).
  - [-1; 25) oynasida daromad 366 500 (66 334 + 666 + 299 500), kechiktirilgan 299 500.
  - Butun zanjir bo'yicha daromad 666 000 = naqd.

Boshqa qoidalar:
- Chegirmali mijoz katalog narxida hisoblanmaydi: `listPriceUzs` va `discountUzs` alohida.
- Legacy (migratsiya) davrlar: to'lov yozilmagan, daromad **noma'lum**. v1 ro'yxat narxi faqat ma'lumot uchun. Noma'lum davrdan kelgan kredit `creditFromUnknownUzs` sifatida alohida chiqadi va marja hisoblanmaydi.
- Refund: **noma'lum** (`null`, `not_tracked`), 0 emas.
- Xarajat — o'lchangan ma'lum spend; noma'lum narxli chaqiruvlar soni alohida. Prognoz marja (grant paytidagi `economics.forecastLeftUzs`) va yakuniy marja ham alohida.

## 7. Jonli benchmark: avval kichik pilot (tasdiqsiz boshlanmaydi)

Stub testlar provider billingini isbotlamaydi. ~$75 lik to'liq benchmark tasdiqlanmagan. Pilot ham **hali boshlanmagan** — egasining ruxsati kerak.

**Namunalar (xizmatlar alohida):**

| Xizmat | Namunalar | Birlik | Planlash budjeti |
|---|---|---:|---:|
| Chat | 8 savol: 333/560 ish haqi va kompensatsiya — 3; 511/347 chalkashtiruvchi — 2; fuqarolik — 2; "summani hisoblamang" — 1 | 8 | $0.20 |
| Hujjat bo'yicha savol (parcha) | 2: muhim band oxirida va boshqa bandga havola qilgan hujjat; band topilmaydigan savol | 2 chat | $0.05 |
| **Hujjat tahlili** | 3 hujjat: 3 sahifa (1 birlik), 12 sahifa (2 birlik), **25 sahifa (3 birlik)** | 6 | $1.80 |
| **AI yuridik xulosa** | 2: 3 sahifa (1 birlik), **25 sahifa (3 birlik)** — tahlil bilan bir xil hujjat, solishtirish uchun | 4 | $1.20 |
| **Draft** | 2 | 2 | $0.12 |
| OCR | 1 skan (2 sahifa) | 2 sahifa | noma'lum (o'lchanadi) |
| **Jami** | | | **≈ $3.4** + OCR |

**Nima o'lchanadi.** Foydalanuvchi ko'radigan butun pipeline: bitta so'rovning `request_id` si ostidagi barcha chaqiruvlar (`/api/admin/ai-usage/requests/:id`). Bularga intent, embedding, rerank, retrieval grade/plan, javob, cross-check, claim-check, digest (uzun hujjat), OCR, retry va fallback kiradi.

Har so'rov uchun:
- chaqiruvlar soni;
- known / estimated / unknown xarajat;
- p50 latency;
- `skipped` qatorlar.

Xizmat bo'yicha birlik narxi ham hisoblanadi (known cost / birlik). Shunda ko'p birlikli 25 sahifali hujjat birlik narxi chiziqli o'sadimi, yo'qmi, ko'rinadi.

**Pilot akkauntiga huquq berish (to'lovsiz, tushumsiz) — `docs/tariffs-v2.md` §10:**
1. Alohida oddiy (role `user`) hisob ochiladi; unda pullik davr bo'lmasligi kerak.
2. Master shunday huquq beradi:
   `POST /api/admin/tariff/test-entitlements { userId, reason: "Pilot 2026-10", hours: 48, plan: "gold", quotas: { chat: 12, analysis: 8, opinion: 6, draft: 3, ocr: 10 }, budgetUsd: 5 }`
   - `perRequestUsd` berilmaydi, ya'ni production'dagi $0.25 qo'llanadi. `budgetMode` standart bo'yicha `strict`.
   - `plan: "gold"` faqat hujjat hajmi qoidasi uchun kerak (≤ 30 sahifa). U narx ham, tushum ham emas.
3. `GET /api/admin/tariff/test-entitlements` orqali kvota, `spent` va `held` kuzatiladi.
4. Pilot tugagach `…/:userId/end`. Hisob avvalgidek qoladi; sarf `measuredTest` va `testEntitlements` da alohida turadi.

**Pilot budjeti: nima kafolatlanadi, nima kafolatlanmaydi (2026-10-06).** Avvalgi "$5 qat'iy" ta'rifi olib tashlandi.
- Ilgari tekshiruv chaqiruvdan *oldin* qilinardi, lekin chaqiruvning o'z narxi rezerv qilinmasdi. Shuning uchun narxi ma'lum oxirgi chaqiruv ham rezervdan oshib ketardi. `tests/pilot-budget.test.js` buni ko'rsatadi: $0.10 limitda ikkinchi chaqiruv $0.14 ga olib chiqdi.
- Endi har bir provider chaqiruvi uchun chaqiruvdan oldin uning **maksimal narxi** (`callCostBound`) rezerv qilinadi. Retry va adapterning o'z retry'i ham alohida rezerv oladi; fallback ham o'z chaqiruvi sifatida rezerv oladi.
- Shart: `so'rovda sarflangan + ishlayotgan chaqiruvlar rezervi + bu chaqiruv chegarasi ≤ so'rov hold'i`. Hold'lar yig'indisi esa ≤ umumiy budjet. Rezerv yetmasa, provider chaqirilmaydi (`CALL_RESERVE` / `TEST_BUDGET`).

**Chegara qachon isbotlangan.** Chegara hisoblanishi uchun to'rt narsa kerak:
- manbasi ma'lum narx (`model-pricing.js`, versiya va sana bilan);
- input tokenlari chegarasi: UTF-8 baytlar + har xabar uchun qo'shimcha;
- reasoning'ni ham cheklaydigan output limiti;
- jadvalda yo'q boshqa to'lovli qism bo'lmasligi.

GPT-6 uzun kontekstda taxminan ikki baravar narxlanadi, shuning uchun chegarada GPT-6 narxlari ×2 olinadi.

| Chaqiruv | Chegara | Sabab |
|---|---|---|
| OpenAI Responses (chat, tahlil, xulosa, draft), web search'siz | **bor** | `max_output_tokens` reasoning'ni ham cheklaydi |
| OpenAI embedding (`text-embedding-3-small`) | **bor** | faqat input |
| OpenAI Responses + web search | yo'q | qidiruv chaqiruvi va natija tokenlari narxlanmagan |
| Hybrid pipeline (Chat Completions `max_tokens`) | yo'q | reasoning'ni cheklashi isbotlanmagan |
| Gemini 2.5 (javob, OCR) | yo'q | thinking tokenlari `maxOutputTokens` ga kirmaydi |
| VoiceLab (LLM, vision, STT, TTS) | yo'q | kredit bilan hisoblanadi; tokenga kredit nisbati tasdiqlanmagan |
| Hugging Face embedding / rerank | yo'q | narx yo'q |
| Gemini embedding | faqat `AI_PRICE_OVERRIDES` bo'lsa | jadvalda narx yo'q |
| Rasmli OCR | yo'q | rasm uchun token chegarasi yo'q |

**Ikki rejim:**
1. **`strict` (standart).** Faqat chegarasi isbotlangan chaqiruvlar bajariladi, chegarasizlari rad etiladi.
   - Kafolat: umumiy sarf ≤ budjet, *agar* narx jadvali to'g'ri bo'lsa.
   - Narx jadvali o'zi kafolat emas. Provider narxni o'zgartirsa yoki jadval eskirgan bo'lsa, real narx chegaradan oshishi mumkin. Bunday holat `boundExceeded` bilan belgilanadi va budjet hisobiga real narxda kiradi.
   - Shu sababli bu ham **qat'iy dollar kafolati emas**: kafolat narx jadvali bilan cheklangan.
2. **`estimated` (alohida qaror bilan).** Chegarasiz chaqiruvlar Master yozgan taxmin bilan ishlaydi (`unboundedCallUsd` va uning asosi `riskBasis`). Ular har so'rovda "taxminiy risk" sifatida alohida yoziladi (`test_budget_holds.risk`). Bu nazorat qilinadigan taxminiy budjet, kafolat emas.

**Qat'iy rejim pilotga nima qiladi** (pullik chaqiruvsiz, `callCostBound` bilan oldindan hisoblandi; production'dagi so'rov limiti $0.25).

Jadvaldagi summalar — **maksimal rezerv taxmini**, real tannarx emas. Ular eng yomon holat uchun hisoblangan:
- output limiti to'liq ishlatiladi;
- har bir input bayti alohida token deb olinadi;
- GPT-6 narxi ×2.

Real sarf odatda ancha past bo'ladi. U faqat pilotda o'lchanadi.

| Qadam (asosiy chaqiruv) | Maksimal rezerv taxmini (real narx emas) | $0.25 so'rov limiti bilan |
|---|---:|---|
| Chat javobi (`gpt-6-luna`, 8 192 output) | $0.0098 | o'tadi |
| Cross-check / claim-check (`gpt-6-luna`) | $0.0057 | o'tadi |
| Hujjat bo'yicha savol (20 000 belgilik parcha, `luna`) | $0.0134 | o'tadi |
| Tahlil, 3 sahifa (`gpt-6-sol`) | $0.2162 | faqat asosiy chaqiruv sig'adi; qolgan bosqichlarga joy qolmaydi |
| Tahlil, 12 sahifa (`sol`) | $0.3082 | **birinchi chaqiruvdayoq rad etiladi** |
| Tahlil va xulosa, 25 sahifa (`sol`) | $0.4282 | **birinchi chaqiruvdayoq rad etiladi** |
| Draft (`sol`) | $0.2002 | faqat asosiy chaqiruv |

Qo'shimcha: production'da `LLM_PROVIDER=voicelab` yoki Gemini yo'li yoqilgan bo'lsa, yoki embedding/rerank HF yoki Gemini orqali ketsa, ular strict rejimda **rad etiladi**. Bunda retrieval va javob sifati pilotda production'dagidan farq qiladi. Production'dagi qaysi sozlama ishlayotganini `GET /api/admin/runtime-routing` ko'rsatadi.

**Taklif: nazorat qilinadigan taxminiy budjet (alohida ruxsat uchun).**
1. **Bosqich A — strict, $2.** Chat (8), hujjat savoli (2) va 3 sahifali tahlil (1), production limiti bilan. Narxi ma'lum yo'llarni o'lchaydi; isbotlangan chegaralar ichida qoladi.
2. **Bosqich B — faqat shu akkaunt uchun `perRequestUsd` = $0.50, strict, $3.** 12 va 25 sahifali tahlil, xulosa va draft. Global `AI_REQUEST_MAX_COST_USD` o'zgarmaydi.
3. **Chegarasiz xizmatlar** (VoiceLab, Gemini, HF, OCR) A va B'da o'chiq. Ularni o'lchash kerak bo'lsa, alohida `estimated` bosqichi qilinadi:
   - har chaqiruv uchun taxmin (masalan, $0.02) va uning asosi yoziladi;
   - risk alohida hisobotda ko'rsatiladi;
   - avval qaror so'raladi.

Umumiy reja: $5 = A $2 + B $3. Bu "taxminiy nazoratli" budjet, qat'iy emas: oshib ketish faqat narx jadvali noto'g'ri bo'lgan holda bo'lishi mumkin va bu `boundExceeded` bilan ko'rinadi.

**A/B pilot nimani baholamaydi.** A va B faqat chegarasi isbotlangan yo'llarni ishlatadi: OpenAI Responses (web search'siz) va OpenAI embedding. Quyidagilar o'chiq, shuning uchun **baholanmaydi**:
- VoiceLab (LLM, vision, STT, TTS);
- Gemini (javob, OCR, embedding);
- Hugging Face (embedding, rerank);
- rasmli OCR;
- web search;
- hybrid pipeline.

Shu sababli A/B natijasi:
- production'dagi **butun pipeline xarajatini tasdiqlamaydi** — production'da yoqilgan VoiceLab, Gemini yoki HF yo'llari pilotdagidan boshqacha ishlaydi;
- tariflarning **80% xarajat maqsadini tasdiqlamaydi**, chunki u production pipeline'ining 100% limitdagi to'liq xarajatiga bog'liq;
- faqat OpenAI yo'lidagi xizmatlarning birlik narxi va sifati haqida fakt beradi.

**Hisobot providerlar bo'yicha alohida bo'ladi.** Har bir provider/model uchun `/api/admin/ai-usage/report` va `llm_spend_log` bo'yicha alohida ko'rsatiladi:
- chaqiruvlar soni;
- known / estimated / unknown xarajat;
- rad etilgan (`CALL_RESERVE`, `TEST_BUDGET`) va `skipped` chaqiruvlar;
- `boundExceeded` holatlari.

Sifat (reviewer ballari) ham xizmat va javob bergan provider bo'yicha alohida beriladi. O'chiq providerlar "baholanmagan" deb belgilanadi.

**Pilot akkaunti doirasi.** Budjet faqat test huquqi berilgan hisobning chaqiruvlarini qamraydi: veb va bog'langan Telegram chati. Boshqa foydalanuvchilar va production limitlari o'zgarmaydi.

**Katta hujjat rad etilsa nima yoziladi:**
- qaysi bosqichda va qaysi chaqiruvda to'xtagani — `skipped` qatori, `CALL_RESERVE` va chegara summasi;
- haqiqiy sarf (oldindan hisoblanganidek, birinchi chaqiruvda rad etilsa — 0);
- natija yetkazilmagani;
- kvota qaytarilgani (`release_reason`).

**Tartib.** Avval har xizmatdan bittadan arzon namuna, keyin ko'p birlikli hujjatlar. Chegara erta tugasa ham har xizmat o'lchangan bo'ladi.

**Reviewer mezonlari** (har biri 0–2 ball):
- norma mavjudligi to'g'ri;
- hisoblash usuli manbaga mos;
- faktlar yetarliligi to'g'ri baholangan;
- noto'g'ri modda yo'q;
- javob to'liq va uzilmagan.

Hujjat bo'yicha savollar uchun qo'shimcha mezon: parcha yetmaganda qat'iy xulosa berilmaganmi?

**Kengaytirish sharti:**
- har xizmat bo'yicha o'lchangan known birlik narxi planlash budjetidan oshmasa (yoki farq tushuntirilsa);
- unknown narxli chaqiruvlar ≤ 10%;
- reviewer ballari ≥ 1,5 o'rtacha.

Shundan keyingina to'liq benchmark (~$75) uchun alohida ruxsat so'raladi.

## 8. Hisobotni qayta hosil qilish

    node scripts/tariff-scenarios.js
    node scripts/tariff-scenarios.js --hit-cost-share=0.3
    node scripts/tariff-scenarios.js --json
