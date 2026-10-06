# Tariflar v2 — moliyaviy hisobot (2026-10-04, yangilangan 2026-10-06)

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
| **Noma'lum** | Hujjat tahlili, xulosa va draftning haqiqiy birlik narxi; OCR, STT, TTS narxi; Gemini embedding narxi (`AI_PRICE_OVERRIDES` bo'lmaguncha "estimated"); VoiceLab kredit iste'moli (kredit qaytmasa noma'lum, token narxiga aylantirilmaydi) | Benchmark va production o'lchovi kerak |
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
| Silver | 199 000 | 109 800 | 10 200 | 120 000 | 79 000 | 39.70% | 159 200 |
| Gold | 599 000 | 329 400 | 30 600 | 360 000 | 239 000 | 39.90% | 479 200 |
| Platinum | 999 000 | 549 000 | 51 000 | 600 000 | 399 000 | 39.94% | 799 200 |

Bitta Sinov AI budjeti: $0.725 ≈ 8 700 so'm.

| Ssenariy | Tushum, mln | Pullik xizmat budjeti, mln | Sinov AI, mln | Natija, mln (boshqa xarajatlardan oldin) |
|---|---:|---:|---:|---:|
| 1. 1 000 yangi Sinov + 100 Silver (hammasi 100%) | 19.90 | 12.00 | 8.70 | -0.80 |
| 2. 100 yangi Sinov + 100 Silver | 19.90 | 12.00 | 0.87 | 7.03 |
| 3. 100 Silver renewal, yangi Sinovsiz | 19.90 | 12.00 | 0.00 | 7.90 |
| 4. 100 Gold + 100 Platinum | 159.80 | 96.00 | 0.00 | 63.80 |
| 5. 1 Platinum + 4 Silver (bitta Workspace) | 1.79 | 1.08 | 0.00 | 0.71 |

1 000 Sinovni qoplash uchun kamida 111 ta Silver xaridi kerak (har biri 79 000 so'm qoldiradi).

Tasdiqlangan javob hit rate (hit narxi = generatsiyaning 20% — taxmin):

| Hit rate | Silver | Gold | Platinum |
|---|---:|---:|---:|
| 0% | 120 000 (60.3%) | 360 000 (60.1%) | 600 000 (60.1%) |
| 25% | 111 000 (55.8%) | 333 000 (55.6%) | 555 000 (55.6%) |
| 50% | 102 000 (51.3%) | 306 000 (51.1%) | 510 000 (51.1%) |
| 75% | 93 000 (46.7%) | 279 000 (46.6%) | 465 000 (46.5%) |

Stress (jami xizmat budjeti, narxga nisbatan; 80% chegara):

| Holat | Silver | Gold | Platinum |
|---|---:|---:|---:|
| provider narxi yoki kurs +20% | 141 960 (71.3%) | 425 880 (71.1%) | 709 800 (71.1%) |
| hujjat tannarxi +50% (tahlil va xulosa $0.45) | 148 800 (74.8%) | 446 400 (74.5%) | 744 000 (74.5%) |
| storage/ops +50% | 125 100 (62.9%) | 375 300 (62.7%) | 625 500 (62.6%) |
| hammasi birga | 181 620 (91.3% ⚠ >80%) | 544 860 (91.0% ⚠ >80%) | 908 100 (90.9% ⚠ >80%) |

Individual chegirma chegarasi (xarajat modeli cm-2026-10-05-planning-v1, taxminiy):

| Tarif | Katalog | Konservativ xarajat | Minimal narx (xarajat / 0,80, 1 000 ga yuqoriga) | Eng katta chegirma | Minimal narxda xarajat ulushi |
|---|---:|---:|---:|---:|---:|
| Silver | 199 000 | 120 000 | 150 000 | 49 000 (24.62%) | 80.0% |
| Gold | 599 000 | 360 000 | 450 000 | 149 000 (24.87%) | 80.0% |
| Platinum | 999 000 | 600 000 | 750 000 | 249 000 (24.92%) | 80.0% |

100 Silver: 70 katalog narxida, 30 minimal narxda (hammasi 100%): katalog bo'yicha 19.90 mln, haqiqiy tushum 18.43 mln (chegirma 1.47 mln), xizmat budjeti 12.00 mln, natija 6.43 mln (boshqa xarajatlardan oldin).


## 3. 80% xarajat maqsadi

- **Planlash budjeti bo'yicha:** 100% foydalanishda xizmat budjeti narxning ~60% i (Silver 60,3%, Gold 60,1%, Platinum 60,1%) — 80% chegarasidan past. Bu **dalil emas, reja**: haqiqiy birlik narxi o'lchanmaguncha maqsad bajarilgan deb hisoblanmaydi.
- **Bitta stress yetarli emas:** provayder narxi yoki kurs +20% → ~71%; hujjat tannarxi +50% → ~75%.
- **Hammasi birga** (narx +20%, hujjat +50%, storage +50%) → **~91%**, chegaradan oshadi. Agar o'lchov hujjat birligini $0.45 dan qimmat ko'rsatsa, birinchi tuzatish — tahlil/xulosa limitlari yoki birlik hajmi (masalan, 1 birlik = 8 sahifa / 32 000 belgi). Narxga tegish ikkinchi.
- **Tekshirish usuli:**
  - **Narxi ma'lum o'lchov:** `GET /api/admin/tariff/economics?days=30` → `measured[].knownUsdPerUnit` ni `planningUsdPerUnit` bilan solishtirish. `complete: false` bo'lsa (noma'lum narxli chaqiruv bor), natija faqat quyi chegara.
  - **To'liq foydalanuvchi:** `GET /api/admin/margin-report` — mijoz bo'yicha real `llm_spend_log` xarajati.

## 4. Ssenariylar talqini

- **1-ssenariy** (1 000 Sinov + 100 Silver, hammasi 100%) — boshqa xarajatlardan oldin −0,8 mln. Birinchi davrni qoplash uchun kamida **111 Silver** kerak. Bu konversiya taxmini emas: 1 000 Sinovdan 111 tasi (11,1%) to'lashi kerak degani.
- **Trial conversion, retention va CAC** bu yerda aralashtirilmaydi:
  - har biri o'lchanmagan;
  - marketing xarajati xizmat marjasidan alohida.
- **Sinov narxi** $0.725 — bu Sinovning to'liq ishlatilishi; ko'p foydalanuvchi uni oxirigacha ishlatmaydi. Haqiqiy o'rtacha qiymatni `tariff_usage` (`period.source = trial`) va `measured` beradi.
- **Telegram Stars.**
  - Narx: hozir 1 ⭐ = 4 qo'shimcha javob (`TG_PAID_ANSWER_STARS`, `TG_PAID_ANSWER_CREDITS`; D-12 bo'yicha saqlangan).
  - Muammo: 1 ⭐ dasturchiga taxminan $0.013 keltiradi (Telegram kursi, tekshirilmagan), 4 javobning planlash budjeti esa $0.10. Ya'ni bu paket chat birligining planlash narxidan ancha arzon.
  - Tavsiya: yangi invoice narxini (masalan, 1 ⭐ = 1 javob yoki Stars sotuvini to'xtatish) egasi hal qiladi. Kod buni o'zgartirmadi.
  - Sotib olingan kreditlar to'liq saqlanadi.

## 5. Individual chegirmalar (2026-10-05)

Qoida: `finalPrice >= conservativeTotalServiceCost / 0.80`, minimal narx 1 000 so'mga yuqoriga yaxlitlanadi, butun son (so'm) arifmetikasi (`src/rag/tariff-pricing.js`).

**Konservativ xarajat nimadan tuziladi:**
- yangi davr limitlarining 100% ishlatilishi (planlash birlik budjetlari bilan, barcha AI bosqichlari);
- OCR;
- operatsion ulush: hosting, DB, storage, support; Platinum'da Workspace ham;
- to'lov komissiyasi — hozir doira bo'yicha 0 (pastda).

**Nimalar ishlatilmaydi:** foydalanuvchining tarixiy kam sarfi, o'rtacha yoki p95 sarf, isbotlanmagan cache foydasi.

**O'lchangan tannarx** faqat yuqoriga ta'sir qiladi: agar o'lchangan birlik narxi planlash budjetidan yuqori bo'lsa, AI qismi oshiriladi.

**Asos o'lchanmagan.** 150 000 / 450 000 / 750 000 minimal narxlar egasining o'lchanmagan planlash budjetidan chiqadi; admin ekrani har quote'da buni ko'rsatadi. Pilot (§7) o'lchagan birlik narxi budjetdan yuqori chiqsa, minimal narx avtomatik ko'tariladi (o'lchov faqat yuqoriga ta'sir qiladi).

**Payment fee:**
- Hozir 0 bp. Bu o'lchangan komissiya emas, **hisob doirasi**: provayder ulanmagan, to'lov qo'lda (master grant) qabul qilinadi (`feeScope.providers = ['manual']`). Admin ekranida "To'lov komissiyasi: 0 so'm · doira" qatori izohi bilan chiqadi.
- Provayder ulanganda komissiya ulush sifatida kiritiladi, formula `fixed / (0.80 − fee)`. Misol: 3% fee bilan Silver minimal narxi 156 000.
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
