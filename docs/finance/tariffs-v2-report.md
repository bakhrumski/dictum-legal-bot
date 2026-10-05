# Tariflar v2 — moliyaviy hisobot (2026-10-04)

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
| **Noma'lum** | Hosting (Render), Supabase (DB + storage), to'lov komissiyasi, support, Workspace storage — operatsion ajratmani tekshirish uchun hisob-fakturalar kerak | Egasining hisoblari |
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
- operatsion ulush: hosting, DB, storage, support, to'lov komissiyasi; Platinum'da Workspace ham.

**Nimalar ishlatilmaydi:** foydalanuvchining tarixiy kam sarfi, o'rtacha yoki p95 sarf, isbotlanmagan cache foydasi.

**O'lchangan tannarx** faqat yuqoriga ta'sir qiladi: agar o'lchangan birlik narxi planlash budjetidan yuqori bo'lsa, AI qismi oshiriladi.

**Payment fee:**
- Hozir 0 bp, chunki egasining operatsion ajratmasi ichida — ikki marta qo'shilmaydi.
- Ulush sifatida kiritilsa, formula `fixed / (0.80 − fee)` bo'ladi. Misol: 3% fee bilan Silver minimal narxi 156 000.

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

## 6. Margin hisoboti endi haqiqiy sotuv narxida

`GET /api/admin/margin-report` (`marginReport`):
- **Daromad** — har bir davrning haqiqiy sotuv narxi (naqd + ko'chirilgan kredit, chegirmadan keyin), oyna kunlariga pro rata.
- **Alohida ko'rsatiladi:** katalog narxi, haqiqiy sotuv narxi, chegirma, naqd va kredit, refund. Refund hozircha 0 — refund oqimi yo'q.
- **Chegirmali mijoz** katalog narxi bilan hisoblanmaydi.
- **Migratsiyadan ko'chirilgan legacy davrlar** (to'lov yozilmagan, master bergan): daromad **noma'lum** deb alohida chiqadi. v1 ro'yxat narxi faqat ma'lumot uchun, yangi katalog narxi hech qachon.
- **Xarajat** — o'lchangan ma'lum spend. Noma'lum narxli chaqiruvlar soni alohida.
- **Prognoz marja** (grant paytidagi `economics.forecastLeftUzs`) va **yakuniy marja** alohida.

## 7. Jonli benchmark: avval kichik pilot (tasdiqsiz boshlanmaydi)

Stub testlar provider billingini isbotlamaydi. ~$75 lik to'liq benchmark tasdiqlanmagan, uning o'rniga avval kichik pilot taklif qilinadi.

**Tanlov:**
- 8 savol: 333/560 ish haqi va kompensatsiya — 3; 511/347 chalkashtiruvchi — 2; fuqarolik — 2; "summani hisoblamang" — 1.
- 4 hujjat: 1–5 sahifa, 6–10 sahifa, 11–20 sahifa (2 birlik), skan (OCR).
- 2 draft.

**Har bir xizmatdan namuna:** chat ×8, tahlil ×4, xulosa ×2 (bitta qisqa, bitta 2 birlik), draft ×2, OCR ×1.

**Xarajat chegarasi:**
- Planlash budjeti bo'yicha ~$4 (8 × $0.025 + 6 × ~1.5 birlik × $0.30 + 2 × $0.06 ≈ $3.0, zaxira bilan).
- **Qattiq limit $5:** test hisobi budjeti sifatida (`TG_TEST_ACCOUNT_BUDGET_USD=5`, mavjud mexanizm) yoki shu summadan oshganda to'xtatiladi.

**Reviewer mezonlari** (har biri 0–2 ball):
- norma mavjudligi to'g'ri;
- hisoblash usuli manbaga mos;
- faktlar yetarliligi to'g'ri baholangan;
- noto'g'ri modda yo'q;
- javob to'liq va uzilmagan.

Har bir javob uchun yozib olinadi: chaqiruvlar soni, known va unknown xarajat, p50 latency.

**Kengaytirish sharti:**
- har xizmat bo'yicha o'lchangan known birlik narxi planlash budjetidan oshmasa (yoki farq tushuntirilsa);
- unknown narxli chaqiruvlar ≤ 10%;
- reviewer ballari ≥ 1,5 o'rtacha.

Shundan keyingina to'liq benchmark (~$75) uchun alohida ruxsat so'raladi.

## 8. Hisobotni qayta hosil qilish

    node scripts/tariff-scenarios.js
    node scripts/tariff-scenarios.js --hit-cost-share=0.3
    node scripts/tariff-scenarios.js --json
