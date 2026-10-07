# Hujjat mazmunini tushuntirish: aniqlik, qamrov va dalil (2026-10-07, #419)

Bu hujjatda uch narsa bor:
- tushuntirish xizmatining sifati nimadan buzilayotgani (koddagi dalil bilan);
- nima o'zgartirilgani;
- yurist baholashi uchun benchmark rejasi va baholash jadvali.

**Haqiqiy model bilan benchmark hali o'tkazilmagan.** Bu yerdagi testlarning
hammasi stub AI bilan ishlaydi. Ular modelga nima yetib borishini va server
javob bilan nima qilishini isbotlaydi, javob sifatini isbotlamaydi.

## 1. Tushuntirish yo'llari

| Kanal | Yo'l | AI | Bu PR'da |
|---|---|---|---|
| Veb, «Hujjat mazmunini tushuntirish» | extract (AI'siz) → narx kartasi → `POST /api/draft/explain-document` (`confirmed: true`) | ≤ 14 000 belgi: 1 arzon chaqiruv; undan uzun: N ta dayjest + 1 | prompt, qamrov, sahifalar, tekshiruv, qisman natija qoidasi |
| Veb, yuridik xulosa | `/api/draft/legal-opinion` | umumiy dayjest (> 14 000) | faqat dayjest va qisman natija qoidasi; xulosa prompti o'zgarmagan (faqat «to'liq dayjest» so'zi olib tashlandi) |
| Veb, chatda hujjat tahlili | `/api/legal-chat`, document mode (> 30 000) | umumiy dayjest | dayjest va qisman natija qoidasi |
| Veb, chatda hujjat haqida savol | `selectExcerpt` (> 20 000 belgida parchalar) | — (parcha tanlashda AI yo'q) | parchalar sahifa belgisi bilan beriladi; band tanlash o'zgarmagan |
| `/api/analyze` (JSON) | dashboard'dan chaqirilmaydi | umumiy dayjest | faqat dayjest |
| Telegram | fayllarda AI yo'q | — | o'zgarmagan |
| Workspace | tahlil yoki xulosa AI bo'limiga yo'naltiriladi | — | o'zgarmagan |

Yangi xizmat yoki kanal qo'shilmagan. Quyidagilar avvalgidek ishlaydi:
routing, tariflar, tasdiq (409) va fayl yuklanganda AI ishlamasligi.

Qo'shimcha AI chaqiruvi yo'q, ikkinchi tekshiruvchi model ham yo'q.

## 2. Sabablar: MIMORAM namunasi va uzun hujjatlar alohida

### 2a. MIMORAM namunasi (3 617 belgi): dayjest ishlamagan

3 617 belgi 14 000 belgidan kam. Shuning uchun eski yo'lda ham hujjatning
**to'liq matni** bitta chaqiruvda modelga berilgan, dayjest ishga tushmagan.
Shu sabab namunadagi xatolar qamrov yoki dayjest xatosi emas. Ular **prompt
va model xatolari**:

| Namunadagi xato | Turi | Eski promptdagi sabab |
|---|---|---|
| Tekshiruvni investorlar o'tkazgan deb yozilgan | o'ylab topilgan shaxs yoki tekshiruv | «Kim nima dedi»ni saqlash va hujjatda yo'q odam qo'shmaslik qoidasi yo'q edi |
| Sud ma'lumoti kompaniya vakillariga tegishli ekani yo'qolgan | atributsiya | atributsiya qoidasi yo'q edi |
| «Aniqlanmadi» → «yo'q» | cheklov yo'qolgan | cheklovlar va sanani saqlash qoidasi yo'q edi |
| «Ariza berilmagan» → huquq yo'q yoki rad etilgan | ma'no siljigan | «ariza yo'q ≠ ro'yxat yo'q ≠ huquq yo'q» qoidasi yo'q edi |
| Ro'yxatdan o'tkazish tavsiyasi xulosa muallifiga tegishli ekani yo'qolgan | tavsiya muallifi | fakt, muallif tavsiyasi va AI talqinini ajratish qoidasi yo'q edi |
| Mualliflik huquqi oqibati qo'shilgan | o'ylab topilgan oqibat | «⚠️ Nimalarga e'tibor berish kerak» bo'limi maslahatga undardi |
| Litsenziya yo'q → litsenziya majburiy yoki faoliyat noqonuniy | asossiz xulosa | hujjat chiqarmagan xulosani taqiqlovchi qoida yo'q edi |
| «Ilhomovaga tegishli» | to'g'ri edi | — |

Bu namuna uchun ta'sir qiladigan o'zgarish faqat **yangi prompt** (A–C
qoidalari). Mexanik tekshiruv bu xatolardan birortasini ham ushlamaydi:
ularning hammasi ma'no xatosi. **Yangi prompt bu xatolarni amalda tuzatadimi —
tasdiqlanmagan.** Buni faqat jonli benchmark ko'rsatadi (5–6-bo'lim).
Namunaning o'zi repoga qo'yilmagan. Testlarda anonim sintetik o'xshashi bor:
`02-due-diligence.json`, unda 8 ta tuzoq.

### 2b. Uzun hujjatlar (14 000 belgidan ortiq): qamrov va dayjest kamchiliklari

Bular promptni o'zgartirish bilan tuzalmaydi:

1. **Sahifa yo'q edi.**
   - Matnli PDF modelga sahifa chegarasiz yetib borardi.
   - Shuning uchun model sahifa raqamini faqat o'ylab topishi mumkin edi.
2. **Eski dayjest muhim ma'lumotni tashlab yuborardi.**
   - Eski dayjest faqat majburiyat, huquq, sana va muddatni so'rardi.
   - Model ko'rishidan oldin yo'qolgan narsalar: kim aytgani, cheklovlar, istisnolar, tavsiya va uning muallifi.
   - Uzun hujjatda 2a dagi xatolar shu yerdan ham kelib chiqishi mumkin edi.
3. **O'qilmagan qism sezilmasdi.**
   - Muvaffaqiyatsiz yoki kesilgan dayjest qismi, kesilgan javob jimgina o'tib ketardi.
   - Bunday natija baribir to'liq deb ko'rsatilib, limit yechilardi.
4. **Matn jimgina kesilmagan.**
   - Eski bo'laklar ham 120 000 belgini to'liq qoplardi.
   - Dry-run'da kalit iqtiboslar eski va yangi yo'lda bir xil: 5/5.

## 3. Nima o'zgardi

Hammasi umumiy qoidalar, hujjatga xos emas. Promptda baholash to'plamidagi
nomlar yoki raqamlar yo'q, buni test tekshiradi.

| # | O'zgarish | Fayl |
|---|---|---|
| 1 | Matnli PDF har sahifa oldidan `[Sahifa n]` bilan qaytadi | `src/ocr/routes.js` |
| 2 | **Sahifa belgilari xizmat hajmiga kirmaydi.** Ular quyidagilarni oshirmaydi: birliklar (`contentChars`), reja chegarasi (`jobFits`), to'liq matn/dayjest chegarasi (14 000), chat chegaralari (30 000 va 20 000). **Provider kirishida va xarajat hisobida esa saqlanadi:** belgilar modelga boradi, `inputTokenBound`/`callCostBound` ularni sanaydi (test), ledger provider qaytargan usage'ni yozadi | `subscription-tiers.js`, `document-explain.js`, `document-job.js`, `server.js` |
| 3 | Dayjest kim aytganini, cheklovlarni, istisnolarni, tavsiya va uning muallifini, ziddiyatlarni, qonun havolalarini (raqami bilan) va sahifani saqlaydi. Bo'lak sahifa chegarasida kesiladi, lekin bu qamrovni kamaytirsa yoki bitta ortiqcha chaqiruv talab qilsa, eskicha qat'iy kesish ishlaydi | `DIGEST_SYSTEM`, `digestChunks` |
| 4 | Modelga «QAMROV» eslatmasi beriladi: to'liq matnmi yoki dayjestmi, o'qilmagan qismlar, matnsiz sahifalar, sahifaga havola qilish mumkinmi | `coverageNote` |
| 5 | Tushuntirish prompti: A–F qoidalari, hujjat turiga mos sarlavhalar, «AI izohi:» belgisi | `explainSystem` |
| 6 | Mexanik tekshiruv (4-bo'lim) | `verifyExplanation` |
| 7 | Qisman natija qoidasi (5-bo'lim) | route, `server.js`, `document-job.js`, dashboard |
| 8 | Chat parchalarida har bir band o'zi boshlangan sahifa belgisi bilan beriladi; band tanlash belgilar bilan ham, belgisiz ham bir xil (test) | `document-job.js` |

## 4. Mexanik tekshiruv nimani tekshiradi va nimani tekshirmaydi

**Faqat solishtiradi:** javobdagi raqam, sana, sahifa va band raqamlarini
hujjat matni bilan. **Ma'noni, kim nima deganini, cheklovlarni, talqinni va
huquqiy to'g'rilikni tekshirmaydi.**

Masalan, «qarz tasdiqlangan» degan noto'g'ri atributsiya tekshiruvdan o'tib
ketadi (test bor). Har bir javob ostida, xato topilmaganda ham, shu yozuv
chiqadi:

> **Avtomatik tekshiruv (AI emas):** faqat raqam, sana, sahifa va band raqamlari hujjat matni bilan solishtirildi. Mazmun, kim nima degani, talqin va huquqiy to'g'rilik tekshirilmagan.

Javobda `check.scope = "figures_dates_pages_clauses_only"` qaytadi.

**Asossiz ogohlantirishlarga qarshi tekshirilgan holatlar (test):**

| Holat | Misol | Natija |
|---|---|---|
| Sanalar boshqa shaklda | 05.02.2026 / 2026-02-05 / 5-fevral 2026 / 31 декабря 2026 ↔ «2026-yil 5-fevral» | ogohlantirish yo'q |
| Hujjatda yo'q sana | 06.02.2026; 5-mart; 2025-02-05 | sana sifatida belgilanadi |
| Foizlar | 0,1% / 0.1 % / 10% / 15% ↔ «0,1 foizi», «10 foizidan» | ogohlantirish yo'q |
| Pul | 84,5 mln / 84 500 ming / 84.5 mln ↔ «84 500 000» | ogohlantirish yo'q |
| Band raqamlari | «4.1 va 4.3-bandlar», 8.2-band, 5-bo'lim, 2.3-bandda | ogohlantirish yo'q |
| Markdown raqamlangan ro'yxat | «10. …», «12) …» | raqam sifatida tekshirilmaydi |
| Sahifa oralig'i | 1–3-sahifalar, 2-3-sahifa | ikkala sahifa tekshiriladi |
| Arifmetik hosila | 30% × 84 500 000 = 25 350 000; 84 500 000 − 25 350 000 = 59 150 000 | «o'ylab topilgan» deyilmaydi, «AI hisobi — tekshiring» deb alohida ko'rsatiladi |
| Hujjatdagi summa | 11 000 000 + 1 400 000 = 12 400 000 | ogohlantirish yo'q |

**Cheklovlar:**
- Hosila faqat summalar uchun (≥ 1 000) va ikki qadamgacha tekshiriladi.
- Kichik sonlar (kun, foiz) hosila deb hisoblanmaydi. Hujjatda bo'lmasa, «topilmagan» deyiladi.
- Ko'p raqamli hujjatda o'ylab topilgan summa tasodifan «hosila» bo'lib chiqishi mumkin. U baribir ko'rsatiladi, faqat «tekshiring» belgisi bilan.

## 5. Qisman natija: foydalanuvchiga ko'rinishi va limit

| Holat | Foydalanuvchi ko'radi | Limit | Qaysi mavjud qoidaga mos |
|---|---|---|---|
| Dayjestning bir qismi o'qilmadi yoki uzunlik chegarasida kesildi (hujjat to'liq o'qilmagan) | Javob boshida: «⚠️ **Qisman natija — to'liq tahlil emas:** hujjatning N-qism (a–b-sahifa) o'qilmadi…» va «limit qaytarildi» xabari | **qaytariladi** (`released`) | OCR qoidasi (2026-10-06): sahifasi yetishmagan hujjat — xizmat emas, limit qaytariladi |
| Hujjat to'liq o'qildi, lekin javob token chegarasida kesildi | Javob boshida: «⚠️ **Qisman natija — to'liq tahlil emas:** javob uzunlik chegarasida to'xtadi…»; javob oxirgi to'liq gapgacha qisqartiriladi | **yechiladi** (`committed`) | claim-guard qoidasi: kesilib, oxirgi to'liq gapgacha qisqartirilgan javob yetkazilgan hisoblanadi |
| Bo'sh javob yoki xato | xato xabari | qaytariladi | avvalgidek |

- Yuridik xulosa va chatdagi hujjat tahlilida ham shu qoida ishlaydi:
  - dayjestda o'qilmagan qism bo'lsa, birliklar qaytariladi;
  - modelga o'qilmagan qismlar aytiladi;
  - xulosa «⚠️ Qisman xulosa — to'liq emas» bilan boshlanadi;
  - chat izohi «⚠️ Qisman natija…» deb chiqadi (ogohlantirish rangida).
- Testlar haqiqiy Postgres'da: `released` va `committed` holatlari tekshiriladi (`tests/upload-no-ai.db.test.js`).
- Muqobil variant ham bor: kesilgan javobda ham limitni qaytarish. Egasi tanlasa, bu bir qatorlik o'zgarish.

## 6. Token limitlari va xarajat (dry-run, chaqiruvsiz)

`node scripts/explain-benchmark.js`. Raqamlar `src/ai/model-pricing.js`
(`callCostBound`) narx jadvalidan hisoblangan **rejalash raqamlari**:
- kirish UTF-8 baytlarda, chiqish providerga yuborilgan cap bo'yicha hisoblangan;
- bu **haqiqiy sarf emas va kafolatlangan maksimum ham emas**: jadval noto'g'ri bo'lishi mumkin;
- VoiceLab kreditda hisoblaydi, ro'yxat narxi taxminiy olingan.

Token cap'lari o'zgardi: dayjest qismi 1300 → 1600, javob 2500 → 3000.

| Sahifa (~2 500 belgi/sahifa) | Sahifa belgilari (bayt, kirishda) | Yo'l | Chaqiruvlar | Eski | Yangi prompt + eski cap | Yangi | comet: eski → yangi | luna: eski → yangi |
|---|---|---|---|---|---|---|---|---|
| 2 | 22 | to'liq matn | 1 | cap 2 500 | 2 500 | 3 000 | $0.0045 → $0.0056 | $0.0037 → $0.0045 |
| 10 | 111 | dayjest | 4 | 6 400 | 6 400 | 7 800 | $0.0193 → $0.0226 | $0.0130 → $0.0154 |
| 30 | 351 | dayjest | 8 | 11 600 | 11 600 | 14 200 | $0.0498 → $0.0560 | $0.0301 → $0.0347 |

O'sishning qariyb yarmi uzunroq promptdan, qolgani cap'lardan. Chaqiruvlar
soni o'zgarmagan.

Taklif qilinadigan jonli benchmark:
- 6 ta sintetik hujjat va 10 ta anonim haqiqiy hujjat (har biri 30 sahifa);
- eski va yangi yo'l, har biri 3 marta;
- rejalash raqami: VoiceLab comet ≈ $3.5, gpt-6-luna ≈ $2.2.

## 7. Eski va yangi yo'lni solishtirish rejasi (ruxsatdan keyin)

1. **Hujjatlar:**
   - `tests/fixtures/explain-eval` (6 ta tur);
   - siz tanlagan 10 ta anonim hujjat (repoga qo'yilmaydi), jumladan MIMORAM namunasi.
2. **Ishga tushirish:**
   - eski yo'l (5d57b4d) va yangi yo'l;
   - bir xil model, 3 marta;
   - token, vaqt va narx `llm_spend_log` usage'idan olinadi.
3. Javoblar qaysi yo'ldan ekani yashirilgan holda yuristga beriladi (8-bo'limdagi jadval).
4. **Mezon:**
   - tuzoqlar bo'yicha yangi yo'l eskisidan yomon bo'lmasligi;
   - asossiz da'volar kamayishi;
   - xarajat 6-bo'limdagi raqamlar oralig'ida qolishi.
5. Mexanik tekshiruv yetmasa, tekshiruvchi AI chaqiruvi alohida ruxsat bilan ko'rib chiqiladi (hozir qo'shilmagan).

## 8. Yurist uchun jadval

Har bir javob uchun bir qator. Ballar: 0 — xato, 1 — qisman, 2 — to'g'ri.

| Hujjat | Yo'l (yashirin) | Takror | Faktlar aniqligi | Cheklov va muddatlar | Asosiy bandlar (k/n) | Dalil mosligi | Asossiz da'volar soni | Hujjat / muallif tavsiyasi / AI izohi ajratilganmi | Qamrov yoki noaniqlik aytilganmi | Kirish tokenlari | Chiqish tokenlari | Vaqt (s) | Narx ($, manba) | Izoh |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| contract-supply | A | 1 | | | /7 | | | | | | | | | |
| due-diligence | A | 1 | | | /9 | | | | | | | | | |
| court-decision | A | 1 | | | /5 | | | | | | | | | |
| talabnoma | A | 1 | | | /5 | | | | | | | | | |
| corporate-protocol | A | 1 | | | /4 | | | | | | | | | |
| long-lease | A | 1 | | | /5 | | | | | | | | | |

Asosiy bandlar va tuzoqlar har bir fiksturada `keyPoints` va `traps`
maydonlarida.

## 9. Testlar va ular nimani isbotlamaydi

- `tests/document-explain.test.js` (16) tekshiradi:
  - qamrov va sahifalar;
  - o'qilmagan yoki kesilgan qismlar;
  - qisman natija belgisi;
  - tekshiruv doirasi;
  - asossiz ogohlantirishlar;
  - arifmetik hosila;
  - belgilar chegara va birlikni o'zgartirmasligi, lekin provider kirishida qolishi;
  - promptda hujjatga xos matn yo'qligi.
- `tests/document-digest-shared.test.js` (6) — yuridik xulosa va chat regressiyalari:
  - havolalar belgilar bilan ham, belgisiz ham bir xil topilishi;
  - dayjest qonun havolalarini saqlashi;
  - qisman natija qoidasi;
  - chat parchalarida sahifa belgilari.
- `tests/upload-no-ai.db.test.js` (12, haqiqiy Postgres) tekshiradi:
  - tasdiq (409);
  - birliklar;
  - trigger;
  - uzun hujjat oxirigacha o'qilishi;
  - o'qilmagan qismda `released`, kesilgan javobda `committed`;
  - bo'sh javobda limit qaytarilishi.

**Tasdiqlanmagan:**
- Haqiqiy model 2a va 2b dagi xatolarni amalda tuzatadimi.
- Bu faqat 7–8-bo'limlardagi jonli benchmark va yurist bahosi bilan tasdiqlanadi.
