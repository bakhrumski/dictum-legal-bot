# Hujjat mazmunini tushuntirish: aniqlik, qamrov va dalil (2026-10-07)

Bu hujjat uch narsani o'z ichiga oladi: tushuntirish xizmatining sifatini
nima buzayotgani (koddagi dalil bilan), nima o'zgartirilgani, va yurist
baholashi uchun benchmark rejasi bilan jadval. **Haqiqiy model bilan
benchmark hali o'tkazilmagan.** Quyidagi testlarning hammasi stub AI bilan
ishlaydi. Ular modelga nima yetib borishini va server javob bilan nima
qilishini isbotlaydi, javob sifatini emas.

## 1. Tushuntirish yo'llari

| Kanal | Yo'l | AI | O'zgardimi |
|---|---|---|---|
| Veb (dashboard) | Fayl biriktiriladi → `/api/analyze/extract` (AI'siz) → «Hujjat mazmunini tushuntirish» → narx kartasi → `POST /api/draft/explain-document` (`confirmed: true`) | Qisqa hujjatga 1 ta arzon chaqiruv. Uzun hujjatga N ta dayjest chaqiruvi + 1 ta | Ha: prompt, qamrov, sahifalar, javob tekshiruvi |
| Veb — yuridik xulosa | `/api/draft/legal-opinion` | Umumiy `digestLongDocument` dayjestidan foydalanadi | Faqat dayjest (bu xulosaning qamrovi yaxshilanadi), xulosa prompti o'zgarmagan |
| Veb — chatda hujjat (tahlil buyurilganda) | `/api/legal-chat` document mode (> 30 000 belgi) | Umumiy dayjest | Faqat dayjest |
| `/api/analyze` (JSON tahlil) | Dashboard'dan chaqirilmaydi (grep) | Umumiy dayjest | Faqat dayjest |
| Telegram | Fayllarda AI ishlamaydi (yuristlar navbatiga ketadi) | — | Yo'q |
| Workspace | To'liq tahlil yoki xulosa AI bo'limiga yo'naltiriladi (`createWorkspaceServiceRouting`) | — | Yo'q |

Yangi xizmat yoki kanal qo'shilmagan. Routing, tarif, kvota va tasdiq avvalgidek
qoldi. Bu DB testi bilan tekshirilgan (`tests/upload-no-ai.db.test.js`):
- tasdiqsiz so'rov → 409, AI chaqirilmaydi;
- tasdiqlangan so'rov → bitta analysis birligi olinadi, trigger `service_confirmed`;
- bo'sh javob → birlik qaytariladi.

## 2. Sabablar: prompt yoki qamrov (koddagi dalil)

Eski kod — `main` 5d57b4d, `src/api/server.js`.

**Qamrov muammolari (promptni o'zgartirish bilan tuzalmaydi):**

1. **Sahifa yo'q edi.**
   - Matnli PDF `pdf-parse` orqali sahifa chegarasiz bitta matn bo'lib modelga borardi.
   - Shu sababli model sahifaga faqat uni o'ylab topib havola qila olardi.
   - Skanlarda `[Sahifa n]` belgisi bor edi (#411), matnli PDF'da yo'q edi.
2. **Dayjest atributsiyani tashlab yuborardi.**
   - Eski dayjest prompti faqat majburiyat, huquq, sana va muddatni so'rardi.
   - Quyidagilar model ko'rishidan oldin yo'qolardi:
     - kim aytgani («vakillarining ma'lumotiga ko'ra»);
     - cheklov va sana bilan aytilgan gaplar («aniqlanmadi», «… holatiga»);
     - istisnolar;
     - tavsiya va uning muallifi.
   - Hujjat 14 000 belgidan uzun bo'lsa, MIMORAM namunasidagi xatolar shu yerda paydo bo'lishi mumkin edi.
3. **O'qilmagan qism sezilmasdi.**
   - Muvaffaqiyatsiz dayjest bo'lagi modelga shunchaki «(o'qib bo'lmadi)» deb borardi. Javobda bu aytilmasdi.
   - Token chegarasida kesilgan bo'lak e'tiborsiz qolardi (`truncated` o'qilmasdi).
   - Kesilgan yakuniy javob ham shunday qaytarilardi.
4. Chegaralar har xil:
   - tushuntirish 14 000 belgidan uzun hujjatni dayjest qiladi, chat 30 000 belgidan uzunini;
   - bu o'zgartirilmadi (routing), faqat qayd etildi.

**Eski kod qilmagan narsa:** matnni jimgina kesmagan. Eski bo'laklar ham
120 000 belgini to'liq qoplardi. `scripts/explain-benchmark.js` ham buni
ko'rsatadi: eski va yangi yo'lda «key anchors in input» 5/5. Demak,
muammo hujjat oxirining yo'qolishida emas edi. Dayjest nimani
saqlayotganida, sahifa yo'qligida va o'qilmagan qismlar yashirilganida edi.

**Prompt muammolari:**

5. Prompt to'rtta qat'iy bo'lim va 150–350 so'z talab qilardi. Shu sababli istisno va cheklovlar qisqartirilardi.
6. «⚠️ Nimalarga e'tibor berish kerak» bo'limi hujjatda yo'q maslahat va oqibatlarni qo'shishga undardi.
   - Masalan, «mualliflik huquqi buziladi» yoki «litsenziyasiz faoliyat noqonuniy».
7. Uch narsani ajratish qoidasi yo'q edi:
   - hujjat mazmuni;
   - hujjat muallifining tavsiyasi;
   - AI talqini.
8. «Aniqlanmadi» ≠ «yo'q», tarixiy holat ≠ hozirgi holat va «ariza berilmagan» ≠ «huquq yo'q» qoidalari yo'q edi.
9. Dalil (sahifa, band yoki iqtibos) qoidasi yo'q edi. Ziddiyatni ko'rsatish talabi ham yo'q edi.

## 3. Nima o'zgardi (umumiy, hujjatga xos emas)

| # | O'zgarish | Fayl |
|---|---|---|
| 1 | Matnli PDF har sahifa oldidan `[Sahifa n]` bilan qaytadi. Matnsiz sahifalar qamrov eslatmasida nomlanadi. Belgilar hisobga kirmaydi (`contentChars`): birlik avvalgidek | `src/ocr/routes.js`, `src/rag/subscription-tiers.js` |
| 2 | Dayjest prompti quyidagilarni saqlaydi: kim aytgani, cheklovlar (so'zma-so'z), istisnolar, tavsiya + muallif, ziddiyat, yetishmayotgan ma'lumot, `(N-sahifa)`. Bo'laklar sahifa yoki paragraf chegarasida kesiladi va o'z sahifalarini biladi | `src/rag/document-explain.js` (`DIGEST_SYSTEM`, `digestChunks`, `buildDigest`) |
| 3 | Muvaffaqiyatsiz yoki kesilgan bo'lak dayjest matnida nomlanadi va keshga yozilmaydi. Bu dayjest xulosa va chat bilan umumiy | `server.js` `digestLongDocumentDetailed` |
| 4 | Modelga mexanik `QAMROV` eslatmasi beriladi: to'liq matnmi yoki dayjestmi, qaysi qismlar o'qilmagan, sahifa belgilari bor-yo'qligi | `coverageNote` |
| 5 | Tushuntirish prompti: A–F qoidalari, hujjat turiga mos sarlavhalar, «AI izohi:» belgisi, 250–700 so'z | `explainSystem` |
| 6 | Javob AI'siz tekshiriladi: manbada yo'q raqam yoki sana, mavjud bo'lmagan sahifa, matnda yo'q band yoki modda. Kesilgan javob oxirgi to'liq gapgacha qisqartiriladi. Bular javob ostida «Avtomatik tekshiruv (AI emas)» bo'lib chiqadi | `verifyExplanation`, `finishExplanation` |
| 7 | Route alohida modulga ko'chirildi, tasdiq, skan va kvota zanjiri o'zgarmadi | `src/rag/document-explain-route.js` |

Promptda MIMORAM'ga xos ism, raqam yoki ibora yo'q. Buni test tekshiradi:
baholash to'plamidagi hech bir ism yoki raqam promptda uchramaydi.

**Qo'shimcha AI chaqiruvi qo'shilmagan.** Token chegaralari oshirildi:
- dayjest bo'lagi 1300 → 1600, chunki endi atributsiya va cheklovlar ham olinadi;
- javob 2500 → 3000, chunki 250–700 so'z o'zbekchada ~2000 tokengacha boradi.

Bu narx chegarasini oshiradi (4-bo'lim).

**Taklif — bajarilmagan:** ikkinchi tekshiruvchi AI chaqiruvi.
- U javobdagi har bir da'voni manba bilan solishtiradi.
- Foydasi: mexanik tekshiruv ilg'amaydigan ma'no xatolarini ushlaydi, masalan atributsiya yo'qolishi va «aniqlanmadi → yo'q».
- Kechikish: arzon model bilan +3–8 s.
- Narx chegarasi: hujjat uchun ~$0.004–0.03 (dayjest yoki to'liq matn + javob kirish sifatida).
- Benchmark mexanik tekshiruv yetmasligini ko'rsatsa, alohida ruxsat bilan qo'shiladi.

## 4. Benchmark byudjeti (dry-run, chaqiruvsiz)

`node scripts/explain-benchmark.js` narxlarni `src/ai/model-pricing.js` →
`callCostBound` dan oladi. Bu yuqori chegaradir: kirish UTF-8 baytlarda,
chiqish esa providerga yuborilgan cap. Bu o'lchangan sarf emas va dollar
kafolati ham emas. VoiceLab kreditda hisoblaydi; bu yerda uning ro'yxat
narxi rejalash raqami sifatida olingan.

| Bitta ishga chegara | voicelab/aisha-comet | gpt-6-luna |
|---|---|---|
| Qisqa hujjat (1–3 sahifa), eski | ~$0.003 | ~$0.003 |
| Qisqa hujjat, yangi | ~$0.004 | ~$0.004 |
| 26 sahifali sintetik ijara, eski / yangi | $0.027 / $0.031 | $0.017 / $0.020 |
| 30 sahifa (~75 000 belgi), eski / yangi | $0.050 / $0.058 | $0.030 / $0.037 |

Taklif qilinadigan jonli benchmark:
- 6 sintetik hujjat + 10 ta anonimlashtirilgan haqiqiy hujjat (har biri ~30 sahifa);
- eski va yangi yo'l, har biri 3 marta;
- **yuqori chegara: VoiceLab comet ≈ $3.5, gpt-6-luna ≈ $2.2.**

Real sarf odatda pastroq bo'ladi, chunki model capgacha yozmaydi. Lekin bu
o'lchanmagan.

## 5. Eski va yangi yo'lni solishtirish rejasi (ruxsatdan keyin)

1. Hujjatlar:
   - `tests/fixtures/explain-eval/*.json` (sintetik, 6 tur);
   - egasi tanlagan 10 ta haqiqiy hujjat. Ular anonimlashtiriladi va repoga qo'yilmaydi.
2. Har bir hujjat ikkala yo'ldan o'tkaziladi:
   - **eski** — prompt va dayjest `main` 5d57b4d dagi kabi, matn sahifa belgisisiz;
   - **yangi** — shu PR.
   - Model bir xil bo'ladi (prod'dagi cheap lane), 3 tadan takror.
   - Har bir chaqiruv `llm_spend_log` ga yoziladi va tokenlar, vaqt, narx real usage'dan olinadi.
3. Javoblar aralashtirilib, qaysi yo'ldan ekani yashirin holda yuristga beriladi (6-bo'limdagi jadval).
4. Qaror mezoni:
   - yangi yo'l «tuzoq» qatorlarida eskisidan yomon bo'lmasligi kerak;
   - asossiz da'volar soni kamayishi kerak;
   - narx 4-bo'limdagi chegaradan oshmasligi kerak.
5. Natijaga qarab: tekshiruvchi AI chaqiruvi kerakmi yoki yo'qmi (3-bo'lim, taklif).

## 6. Yurist uchun jadval

Har bir javobga bitta qator. Ballar 0–2 (0 — xato, 1 — qisman, 2 — to'g'ri).

| Hujjat | Yo'l (yashirin) | Takror | Faktlar aniqligi (ism, summa, sana, band) | Cheklov va muddatlar saqlangan | Asosiy bandlar qamrovi (k/n) | Dalil mosligi (sahifa/band/iqtibos to'g'ri) | Asossiz da'volar soni | Hujjat / muallif tavsiyasi / AI izohi ajratilgan | Qamrov yoki noaniqlik aytilgan | Kirish tokenlari | Chiqish tokenlari | Vaqt (s) | Narx ($, manba) | Izoh |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| contract-supply | A | 1 | | | /7 | | | | | | | | | |
| due-diligence | A | 1 | | | /9 | | | | | | | | | |
| court-decision | A | 1 | | | /5 | | | | | | | | | |
| talabnoma | A | 1 | | | /5 | | | | | | | | | |
| corporate-protocol | A | 1 | | | /4 | | | | | | | | | |
| long-lease | A | 1 | | | /5 | | | | | | | | | |

«Asosiy bandlar» va «tuzoqlar» har bir fiksturaning `keyPoints` va `traps`
maydonlarida yozilgan. Ularning qisqa ro'yxati:

- **contract-supply:**
  - 4.1 va 4.3 o'rtasidagi ziddiyat (E);
  - penya chegarasi 10% (B);
  - fors-major sharti — 3 kun ichida xabar (B).
- **due-diligence:**
  - kim tekshirgani (A);
  - sud ma'lumotining manbai — kompaniya vakillari (A);
  - «aniqlanmadi» ≠ «yo'q» (B);
  - «ariza berilmagan» ≠ «huquq yo'q» (B);
  - tavsiya muallifi (C);
  - qo'shilgan oqibat (A);
  - litsenziya yo'qligidan xulosa chiqarish (A);
  - tarixiy direktor (B).
- **court-decision:**
  - javobgarning e'tirozi fakt emas (A);
  - qaror hali kuchga kirmagan (B);
  - undirilgan summa (A).
- **talabnoma:**
  - qarz — yuboruvchining da'vosi (A);
  - ilova qilinmagan shartnoma (F);
  - muddat talabnoma olingan kundan boshlanadi (B).
- **corporate-protocol:**
  - kvorum ziddiyati, 70% va 75% (E);
  - qaror bir ovozdan emas (A).
- **long-lease:**
  - oxirgi sahifadagi kompensatsiya (D);
  - uning istisnosi (B);
  - o'ylab topilgan sahifa (E).

## 7. Testlar va ular nimani isbotlamaydi

- `tests/document-explain.test.js` (12) tekshiradi:
  - har bir asosiy bandning anchor'i modelga yetib boradi;
  - oxirgi sahifadagi band dayjestga sahifasi bilan kiradi;
  - o'qilmagan yoki kesilgan qism modelga, javobga va `coverage`'ga nomlanadi;
  - kesilgan javob to'liq gapda tugaydi;
  - o'ylab topilgan raqam, sahifa yoki band belgilanadi;
  - sahifasiz (DOCX) matn uchun sahifa raqami taqiqlanadi;
  - extract sahifa belgilarini beradi va birlik o'zgarmaydi;
  - promptda baholash to'plamiga xos matn yo'q.
- `tests/upload-no-ai.db.test.js` (+2) haqiqiy Postgres'da tekshiradi: tasdiq, kvota, trigger, uzun hujjatning to'liq o'qilishi va bo'sh javobda birlikning qaytarilishi.

**Tasdiqlanmagan:** haqiqiy model 1–9-sabablarni amalda tuzatadimi —
atributsiya, «aniqlanmadi», tavsiya muallifi, qo'shilgan oqibatlar. Bu
faqat 5–6-bo'limdagi jonli benchmark va yurist bahosi bilan tasdiqlanadi.
Mexanik tekshiruv ma'no xatosini ushlamaydi. U faqat raqam, sana, sahifa
va band havolalarini manba bilan solishtiradi.
