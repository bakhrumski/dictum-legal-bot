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

## 4a. «AI izohi» ham shu qoidalarga bo'ysunadi (2026-10-07, #419 jonli sinovidan keyin)

Jonli sinovda asosiy javob yaxshilandi, lekin «AI izohi» manbaga sodiqlikni
buzdi:
- hujjatda yo'q faktni hujjatga nisbat berdi;
- «ariza berilmagan»ni «ro'yxatdan o'tmagan» deb almashtirdi;
- dalilsiz «asosiy xatar» deb ustuvorlik belgiladi;
- vaqt va manba cheklovlarini tushirib qoldirdi.

**Prompt (#420):**
- Barcha qoidalar javobning hamma qismiga, jumladan AI izohiga ham taalluqli.
- AI izohi ixtiyoriy: foydali va hujjatga asoslangan qo'shimcha izoh bo'lmasa, umuman yozilmaydi — sarlavha ham, to'ldiruvchi ham chiqmaydi.
- Qoidalar umumiy so'zlar bilan yozilgan, baholash to'plamidagi nomlar promptda yo'q.

**Mexanik tekshiruv faqat ogohlantiradi, hech narsani o'chirmaydi.**
- Iboraning manbada yo'qligi xatoning isboti emas, shuning uchun lug'atga qarab avtomatik o'chirish yo'q.
- Yagona istisno — bo'sh yoki to'ldiruvchi AI izohi («AI izohi: yo'q»). U ko'rsatilmaydi: bu ma'noga emas, promptdagi «to'ldiruvchi yozma» qoidasiga taalluqli.

**Bir xil mezon.** Asosiy matn va AI izohi aynan bir xil tekshiriladi (test bilan isbotlangan). Tekshiriladigan narsalar:
- raqam, sana, sahifa va band;
- holat iboralari: ro'yxatdan o'tmagan, ariza berilmagan, huquq yo'q, rad etilgan, mavjud emas, aniqlanmadi, tekshirilmagan, noqonuniy, majburiy, tasdiqlangan, haqiqiy emas, kuchga kirgan;
- oqibat iboralari: jarima, javobgarlikka tortish, huquqbuzarlik, jinoiy, musodara, faoliyatni to'xtatish, mualliflik huquqi;
- ustuvorlik iboralari: eng katta, eng muhim, asosiy xatar va boshqalar;
- vaqt: hujjat ma'lum sana holatiga yozilgan bo'lsa, «hozir» degan gap.

Lug'at o'zbekcha (lotin) va ruscha. Har bir guruhga sinonimlar kiritilgan: «ro'yxatga olinmagan» = «ro'yxatdan o'tmagan» = «не зарегистрирован». Manba shu guruhdagi iborani ishlatsa, ibora tasdiqlangan hisoblanadi.

**Ogohlantirish matni.** Javob ostida har bir bo'lim uchun alohida qator chiqadi:

> - Asosiy matn — manba bilan qo'lda tekshirish kerak: «…» (holat) — hujjat matnida bu ibora yoki uning sinonimi uchramadi.
> - AI izohi — manba bilan qo'lda tekshirish kerak: …

Umumiy izohda shunday deyiladi: «Belgilangan joy da'vo noto'g'ri degani emas: uni manba bilan qo'lda tekshirish kerak. Hech bir bo'lim, belgilanmaganlari ham, mazmunan yoki huquqiy jihatdan tasdiqlangan emas.»

Hech narsa belgilanmagan bo'lsa: «Mexanik solishtirishda belgilanadigan joy topilmadi. Bu mazmun yoki huquqiy to'g'rilik tasdig'i emas.»

API javobida `check.mode = "flag_for_manual_review"`, `check.verified = false` qaytadi. «Tasdiqlandi» deb o'qilishi mumkin bo'lgan `ok` maydoni olib tashlandi.

**Asossiz ogohlantirishga qarshi.** Ibora quyidagi hollarda belgilanmaydi:
- **Inkor yoki shubha:** «… deb xulosa chiqarib bo'lmaydi», «… degani emas», «… anglatmaydi», «hujjatda … deyilmagan», «… noma'lum», «hujjat … aytmaydi», «нельзя», «не означает».
- **Shartli gap:** «agar … bo'lsa», «если», «в случае».
- **Hujjatdan to'g'ridan-to'g'ri iqtibos:** manbada bor, shuning uchun qo'llab-quvvatlangan.
- **Sinonim:** hujjat boshqa so'z bilan aytgan bo'lsa.
- **Arifmetik hosila:** hujjatdagi raqamlarning yig'indisi, ayirmasi yoki foizi «hisobni tekshiring» deb ko'rsatiladi, «uchramagan raqam» deb emas.

Bitta gapda bir ibora inkor qilinib, boshqasi tasdiqlansa, faqat tasdiqlangani belgilanadi. Hujjatda bo'lmagan «iqtibos» esa baribir tekshiriladi.

**Cheklov:**
- Bu ma'noni tekshirmaydi.
- Lug'atda yo'q so'z bilan aytilgan asossiz da'vo belgilanmay qoladi.
- Inkor va shart naqshlari to'liq emas.
- Yakuniy baho yuristniki (8-bo'lim jadvalidagi «AI izohi» ustuni).

**Test holatlari** (`aiNoteCases`, 6 hujjat turida 22 ta holat, har biri uch xil yozilish shaklida):
- `flagged`: ko'rsatiladi va qo'lda tekshirishga belgilanadi;
- `kept`: belgilanmaydi;
- `removed`: faqat to'ldiruvchi izoh, ko'rsatilmaydi.

Ulardan tashqari inkor, iqtibos, shartli gap, sinonim va arifmetik hosila uchun alohida testlar bor.

## 4b. Uzun hujjat dayjesti: #420 jonli sinovi (2026-10-07)

**Holat:** 13 sahifali DOCX, 51 398 belgi. 5 ta dayjest chaqiruvining har
biri aynan 1 600 output token sarfladi. Yakuniy javob bilan birga 6 ta
chaqiruv bo'ldi, hisoblangan xarajat $0.0201. 5 ta qismning hammasi
«to'liq o'qilmagan» deb belgilandi, lekin yakuniy javob baribir yaratildi.

### Sabab: ehtimoliy, tasdiqlanmagan

Production trace'ni ko'rmadim: bu muhitdan production bazasi ochilmaydi.
Bundan oldin ledger `finish_reason` va `truncated`ni umuman yozmagan.

**Ma'lum faktlar:**
- 51 398 belgi o'sha paytdagi 12 000 belgilik bo'laklarda (400 belgi ustma-ust) aynan 5 qism bo'ladi.
- 1 600 — dayjest chaqiruvining output chegarasi. Har bir chaqiruv aynan shu chegarada to'xtagan, bu «chegaraga yetdi» degani.

**Ehtimoliy sabab 1 — ko'rinadigan matn chegaraga sig'madi.** #419 dagi
dayjest prompti har bir bandni hujjat so'zlariga yaqin ro'yxat qilib
yozishni so'raydi. Dry-run taxmini (o'lchanmagan): 12 000 belgilik qism
uchun bunday dayjest 1 714–4 320 tokenni talab qiladi. Bu taxminning eng
quyi chegarasi ham 1 600 dan oshadi.

**Ehtimoliy sabab 2 — ko'rinmas «reasoning» tokenlari byudjetni yedi.**
Bu Orbit modelida avval kuzatilgan. Comet modelida ham shunday bo'lishi
mumkin, lekin tasdiqlanmagan.

**Ikkalasini ajratish uchun production'da shu so'rovni bajaring** (faqat o'qiydi):

```sql
SELECT seq, stage, status, error_code, out_tokens, reasoning_tokens, error_message
  FROM llm_spend_log WHERE request_id = '<so''rov id>' ORDER BY seq;
```

- `status = error`, `error_code = EMPTY_RESPONSE` va xabarda `finish_reason: length` bo'lsa — matn bo'sh, butun byudjetni reasoning olgan.
- `status = success` bo'lsa va `reasoning_tokens` kichik yoki NULL bo'lsa — ko'rinadigan matn kesilgan.

Bu PR'dan keyin har bir qatorda `finish_reason`, `truncated` va
`call_detail` (qaysi qism) ham bo'ladi.

### Nima o'zgardi

1. **Hech bir qism to'liq o'qilmasa, yakuniy generatsiya yo'q.** Bu
   tushuntirish, yuridik xulosa va chatdagi hujjat tahliliga taalluqli.
   - Javob: `422 DOCUMENT_NOT_READ`, xizmat limiti qaytariladi.
   - Bajarilgan dayjest chaqiruvlari xarajati bilan ledger'da qoladi.
   - Bu oddiy foydalanuvchi bilan haqiqiy Postgres'da DB testida tekshirilgan:
     - `tariff_usage.status = released`;
     - har bir qism uchun `llm_spend_log` qatori, `cost_source = calculated`;
     - yakuniy chaqiruv yo'q.
2. **Kesilgan qism siyosati: umuman ishlatilmaydi.**
   - Kesilgan dayjestning qaytgan parchasi ham yakuniy modelga berilmaydi. Parcha qaysi bandlarni qamraganini va qaysi istisno yoki chegara kesilib qolganini bilib bo'lmaydi.
   - Bunday qism «o'qilmadi» deb nomlanadi: modelga ham, javob boshida («Qisman natija») ham, `coverage.parts`da ham.
   - Model u qismlarga havola qilmasligi va xulosa chiqarmasligi kerak.
3. **Kichikroq bo'lak va ixcham dayjest.** Output chegarasi 1 600'ligicha qoldi, ko'r-ko'rona oshirilmadi.
   - Bo'lak hajmi 12 000 → 8 000 belgi. 120 000 belgilik ish 13 bo'lakka sig'ishi uchungina kattalashadi (eng ko'pi ~9 500).
   - Dayjest formati: har band — bitta qator, «nima | kim | shart yoki istisno | band», qator ~30 so'zdan oshmaydi.
   - Dayjest qism uzunligining taxminan uchdan biridan oshmasligi so'raladi.
4. **Cheklangan qayta o'qish.** Chegarada kesilgan qism bir marta, ikki yarmiga bo'linib qayta o'qiladi.
   - Bitta dayjestga eng ko'pi 4 ta qo'shimcha chaqiruv (2 ta qism).
   - Ular faqat dayjest boshlangandan keyin 75 soniya ichida boshlanadi.
   - Bir vaqtda 8 tadan ortiq chaqiruv yuborilmaydi.
   - Yarmi ham kesilsa, u ishlatilmaydi.
   - Provider xatosi qayta bo'linmaydi (ledger'ning bitta vaqtinchalik retry'i avvalgidek).
   - So'rovning umumiy byudjeti (`AI_REQUEST_*`: 30+6 chaqiruv, 120 soniya, $0.25) ustidan turadi: u rad etgan chaqiruv «o'qilmagan qism» bo'ladi, cheksiz takror bo'lmaydi.
5. **Umumiy qoidalar** (dayjest va tushuntirish promptlarida, hujjatga xos emas):
   - shablon va to'ldirilmagan joylar tanib olinadi; ular AI'siz sanaladi va modelga aytiladi;
   - «ariza topshirish» ≠ «ro'yxatdan o'tish» ≠ huquq;
   - to'lov shartlari, istisnolar, penya va uning chegarasi, jami (kumulyativ) javobgarlik chegarasi, zid bandlar (ikkalasi ham) va ilova jadvallari saqlanadi.
6. **Ledger:**
   - Dayjest `document_digest` bosqichida, yakuniy javob `document` bosqichida yoziladi.
   - Har qatorda: `finish_reason`, `truncated` va `call_detail` (`{ phase: 'digest', part: '3a', of: 7, chars }` yoki `{ phase: 'final' }`).
   - `ai_requests.doc_coverage` xizmat hujjatni qancha o'qiganini saqlaydi: qismlar, o'qilgan, kesilgan, xato, yakuniy javob yaratildimi.
   - Master'ning «AI so'rovlar» oynasi uch narsani alohida ko'rsatadi: provider javob berdimi, xizmat qamrovi va xarajat aniqligi. Masalan, VoiceLab ro'yxat narxi bilan hisoblanadi, haqiqiy kredit tasdiqlanmagan.

### Byudjet, vaqt va qamrov (#421 ko'rib chiqilgandan keyin)

**Chaqiruvlar soni — atomar.**
- Avval chaqiruvlar limiti chaqiruv *tugagach* sanalardi, shuning uchun bir vaqtda boshlangan parallel chaqiruvlar uni chetlab o'ta olardi (testda: limit 5 bo'lsa ham 8 tasi ishlagan).
- Endi tekshiruv va «slot» bitta sinxron qadamda olinadi (`usage-ledger` → `callsInFlight`), slot chaqiruv yozilganda qaytariladi. Testda 8 ta parallel chaqiruvdan aynan 5 tasi ishlaydi, 3 tasi `skipped` qatori bo'ladi.
- Vaqtinchalik xatodan keyingi retry slotni kutish oldidan oladi.

**Xarajat chegarasi ($0.25) qanday ishlaydi:**
- Har chaqiruv boshlanishidan oldin uning eng ko'p narxi rezerv qilinadi: tugagan narx + ishlayotganlar rezervi + shu chaqiruv ≤ $0.25.
- Eng ko'p narx — `callCostBound` chegarasi. U yo'q bo'lsa (VoiceLab kreditda hisoblaydi), ledger shu chaqiruvni baholaydigan ro'yxat narxi bo'yicha rejalash raqami (`planUsd`) olinadi.
- **Bu qat'iy dollar kafolati emas:**
  - VoiceLab uchun $0.25 ro'yxat narxi bilan hisoblanadi, haqiqiy kredit tasdiqlanmagan;
  - chegarasi ham, rejalash raqami ham yo'q chaqiruv (masalan, «thinking»i cheklanmagan Gemini zaxirasi) rezervsiz boshlanadi. Uni faqat chaqiruvlar limiti to'xtatadi, narxi tugagach ma'lum bo'ladi.
- Testda: 8 ta parallel $0.005 lik chaqiruv $0.02 chegarasida → 4 tasi ishlaydi (chegara bilan ham, rejalash raqami bilan ham).
- Parallellik 8 da qoldi. Uni 4 ga tushirish 13 qismni to'rt to'lqinga cho'zib, 120 soniyalik so'rov chegarasiga urardi. Atomar slot va rezerv bilan 8 xavfsiz: xarajatni chegara yoki rejalash raqami bilan baholab bo'lmaydigan chaqiruvlar limitni bir martada eng ko'pi 8 ta chaqiruv narxicha oshirishi mumkin, holos.

**Vaqt chegaralari:**
- **75 soniya** (dayjest boshidan): faqat yangi qayta o'qish boshlanishini to'xtatadi. Ishlab turgan qism uzilmaydi (test bor).
- **120 soniya** (so'rov boshidan, `AI_REQUEST_MAX_MS`): undan keyin hech bir yangi chaqiruv boshlanmaydi — qism, qayta o'qish, yakuniy javob, retry. Har biri `skipped` qatori bo'ladi, qism «o'qilmadi» hisoblanadi.
  - Yakuniy chaqiruv boshlanmasa, xizmat 500 bilan tugaydi va limit qaytariladi.
- **Ishlab turgan chaqiruvlar to'xtatilmaydi.** Ular o'z provider timeout'igacha (VoiceLab 120 s) davom etadi va usage'i kelganda yoziladi, javob foydalanuvchiga ketgandan keyin ham (testda tasdiqlangan).
- Timeout bo'lgan chaqiruv `status = timeout` qatori bo'ladi, narxi NULL (noma'lum), $0 emas. Provider bu chaqiruv uchun haq olgan bo'lishi mumkin — ledger buni noma'lum deb ko'rsatadi.
- Vaqt chegarasidan keyin timeout'ga retry qilinmaydi (test bor).

**Qamrov (texnik) — uch holat:**
- `all_read` — barcha qismlar to'liq o'qildi;
- `some_excluded` — ayrim qismlar chiqarildi (natija «qisman», limit qaytariladi);
- `none_read` — hech biri o'qilmadi (yakuniy chaqiruv yo'q, 422).

«To'liq o'qilgan qism» faqat qism modelga butun yetganini bildiradi. Bu mazmun yoki huquqiy tasdiq emas (`meaning: 'technical'`, oynada «texnik, mazmun tasdig'i emas»).

**`doc_coverage` ustuni qo'shilmasa:**
- `ALTER` xatosi tizimni to'xtatmaydi.
- `ai_requests` va `llm_spend_log` qatorlari yangi ustunlarsiz yoziladi, hech bir qator yo'qolmaydi.
- Master oynasida qamrov «yozilmagan — to'liq deb hisoblanmaydi» (`not_recorded`) bo'ladi, hech qachon «to'liq» emas.
- Foydalanuvchiga ketadigan javobdagi qamrov ustunga bog'liq emas.
- DB testida ustunlar haqiqatan olib tashlab tekshirildi.

### Dry-run taqqoslash (chaqiruvsiz, taxminlar bilan)

`node scripts/explain-benchmark.js` — «Long-document digest» bo'limi.

**Taxminlar** (o'lchanmagan):
- 1 token = 2.5–3.5 belgi;
- dayjest/qism nisbati: #420 uchun 0.5–0.9, ixcham uchun 0.15–0.33;
- reasoning tokenlari hisobga olinmagan;
- kirish tokeni — UTF-8 bayt bo'yicha yuqori chegara;
- «qayta o'qish bilan» — 4 ta qo'shimcha chaqiruv sarflanadigan eng og'ir holat.

| Hujjat | Tartib | Qismlar | Eng katta qism | Dayjest tokeni / qism | 1 600 ga yetadimi | Chaqiruvlar: odatiy / qayta o'qish bilan | Kirish tokeni chegarasi: odatiy / qayta o'qish | Kutilgan dayjest output (hammasi) | Output cap jami: odatiy / qayta o'qish | comet: odatiy / qayta o'qish | luna: odatiy / qayta o'qish |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 51 398 | #420 | 5 | 12 000 | 1 714–4 320 | ha, quyi chegarada ham | 6 / 6 | 71 869 / 71 869 | 7 114–8 000 (cap) | 11 000 / 11 000 | $0.0400 / $0.0400 | $0.0254 / $0.0254 |
| 51 398 | yangi | 7 | 8 000 | 343–1 056 | yo'q | 8 / 12 | 82 291 / 106 455 | 2 281–7 022 | 14 200 / 20 600 | $0.0470 / $0.0623 | $0.0307 / $0.0419 |
| 120 000 | #420 | 11 | 12 000 | 1 714–4 320 | ha | 12 / 12 | 161 189 / 161 189 | 16 571–17 440 (cap) | 20 600 / 20 600 | $0.0870 / $0.0870 | $0.0528 / $0.0528 |
| 120 000 | yangi | 13 | 9 508 | 407–1 255 | yo'q | 14 / 18 | 174 539 / 201 719 | 5 291–16 315 | 23 800 / 30 200 | $0.0952 / $0.1119 | $0.0587 / $0.0705 |

Xarajat ustunlari narx jadvali bo'yicha **rejalash chegarasi**: haqiqiy sarf
ham, kafolatlangan maksimum ham emas. VoiceLab narxi ro'yxat narxi, kredit
tasdiqlanmagan. Jonli sinovdagi haqiqiy hisoblangan xarajat ($0.0201) shu
chegaradan ($0.0400) past.

**To'lov:**
- Qismlar ko'paygani uchun chaqiruvlar soni va kirish tokenlari oshadi.
- 13 qism ikki to'lqinda o'qiladi (avval 11 qism bitta to'lqinda edi), shuning uchun kechikish oshishi mumkin.
- Yuridik xulosada dayjest chaqiruvlari 11 tadan 13 tagacha, qayta o'qish bilan 17 tagacha oshishi mumkin. So'rovning 30+6 chaqiruv chegarasidan oshgani atomar rad etiladi va qism «o'qilmadi» bo'ladi.

**Tasdiqlanmagan:**
- Yangi format haqiqiy modelda chegaraga sig'adimi va dayjest sifati yetarlimi — buni faqat jonli sinov ko'rsatadi.
- Reja: deploy tasdiqlangach, bitta uzun anonim hujjatni yangi tartibda sinash.

## 4c. Qamrov so'zlari, oldingi shartlar, mezonlar, oqibatlar va zid bandlar (2026-10-08, #421 jonli sinovidan keyin)

**Jonli sinov natijasi:**
- 7 ta dayjest qismining hammasi `finish: stop`, texnik qamrov 7/7.
- 8 ta chaqiruv, $0.0195 hisoblangan xarajat, 51.3 soniya.
- Lekin yakuniy javobda 6 ta muhim shart yo'qolgan.

### Ma'no qaysi bosqichda yo'qoldi — nimani bilaman va nimani bilmayman

**Production dayjest matni hech qayerda saqlanmaydi.** Ledger faqat usage
yozadi; server xotirasida esa bir soatlik kesh bor. Shuning uchun aynan shu
hujjat uchun manba → dayjest → javob zanjirini **ko'ra olmadim**. Quyidagisi
promptlar va tuzilma bo'yicha **ehtimoliy** tahlil:

| Holat | Ehtimoliy bosqich | Sabab (#421 dagi qoidalar) |
|---|---|---|
| Qolgan summa «barcha ishtirokchilar, jumladan Investor» o'rtasida | dayjest, keyin yakuniy javob | Dayjest «qator ~30 so'z», «faqat hal qiluvchi so'zlarni keltir» der edi. «jumladan» qamrov so'zi alohida nomlanmagan edi |
| «E'lon qilingan **va** to'lanmagan» dividendlar | dayjest | Ikki shart birlashtirilib, «to'lanmagan»ga qisqartirilishi mumkin edi; «va»/«yoki» qoidasi yo'q edi |
| Sezilarli aktiv mezonlari | dayjest | «Takroriy ta'riflarni tashla» qoidasi mezonli ta'rifni ham tashlab yuborishga yo'l qo'yardi |
| Birinchi transh oldidan davlat ro'yxatidan o'tkazish | dayjest yoki yakuniy javob | «Oldingi shart» toifasi yo'q edi, «oldidan» so'zi umumiy «shart» ichida yo'qolardi |
| Qaytarish + xarajat/zarar + alohida 25% jarima | dayjest va yakuniy javob | Bitta qisqa qator «qaytarish va jarima»ga siqiladi. Oqibatlar qo'shiladimi yoki o'rnini bosadimi — bu qoida yo'q edi |
| O'zaro nomuvofiq bandlar | **tuzilmaviy** | Zid bandlar odatda turli dayjest qismlariga tushadi. Har qism faqat o'zini ko'radi, shuning uchun ziddiyatni hech bir qism ko'ra olmaydi. Yakuniy modelga esa faqat siqilgan qatorlar boradi |

Yakuniy javob 250–700 so'zlik chegarada bo'lgani uchun u ham siqardi.

**Trace — mexanik signal.** U har bir bosqichda so'z **so'zma-so'z
topildimi yoki topilmadimi**, shuni ko'rsatadi; ma'no saqlanganini yoki
yo'qolganini aytmaydi:
- sinonim «topilmadi» bo'lib chiqadi;
- inkor qilingan gap yoki «va» o'rniga «yoki» yozilgan gap, agar so'zlarni takrorlasa, «topildi» bo'lib chiqadi (testlar bor);
- ma'noni yurist solishtiradi.

**Trace qanday olinadi:**
- Faqat aniq so'ralganda (`trace: true`) qaytadi.
- Faqat **bazada** roli `master` bo'lgan akkauntga: sessiyadagi rol yetarli emas, server bazadan qayta tekshiradi.
- Faqat shu so'rovdagi hujjat uchun.
- Javob `Cache-Control: no-store` bilan keladi.
- Matn log, audit, ledger, `ai_requests` yoki boshqa keshga tushmaydi; DB testi buni tekshiradi.

**Master brauzerida trace olish:**
1. juristai.uz'ga master akkaunt bilan kiring va dashboard'ni oching.
2. Brauzer konsolini oching (F12 → Console) va kiriting: `window.__JAI_TRACE = true`.
3. Hujjatni (matnli PDF yoki DOCX) chatga biriktiring → «Hujjat mazmunini tushuntirish» → narx kartasida «Davom etish».
4. Javob kelgach, konsolda `[JuristAI] trace saved` yozuvi chiqadi. Kiriting: `copy(JSON.stringify(window.__lastExplain))`. Bu buferga `{ source, response }` ni nusxalaydi.
5. Nusxani kompyuteringizda `explain-trace.json` faylga saqlang. **Uni repoga qo'ymang.**
6. Tekshiring: `node scripts/explain-trace.js --bundle explain-trace.json` — tekshiruvlar tanlangan qatorlardan avtomatik tuziladi. Yoki o'zingizning ro'yxatingiz bilan: `--checks checks.json`, format: `[{"id":"...","terms":["so'z",["muqobil","muqobil"]]}]`.
7. Trace'ni o'chirish: sahifani yangilang, yoki `window.__JAI_TRACE = false` va `delete window.__lastExplain`.

Skanerlangan hujjatda manba matni brauzerda bo'lmaydi (u serverda turadi), shuning uchun `--source` bilan OCR matnini alohida berish kerak.

### Nima o'zgardi (umumiy, hujjatga xos emas)

1. **Dayjest prompti:**
   - qamrov so'zlari aynan saqlanadi: «jumladan», «faqat», «bundan tashqari/mustasno», «alohida/qo'shimcha», «kamida/ko'pi bilan», «barcha» va shartlar orasidagi «va»/«yoki»;
   - to'lov yoki taqsimotda ishtirok etuvchi har bir tomon nomlanadi;
   - oldingi shartlar (nima nimadan oldin) alohida yoziladi;
   - ta'rif mezonlari hammasi saqlanadi, ular hech qachon tashlab yuborilmaydi;
   - bitta buzilishning barcha oqibatlari bitta qatorda, ular qo'shiladimi yoki o'rnini bosadimi aytiladi;
   - boshqa bandga havola nomlanadi;
   - ixchamlik maqsadi «taxminan uchdan bir», lekin to'liq shart qisqa qatordan muhimroq.
2. **Yakuniy prompt:**
   - xuddi shu qoidalar;
   - turli qismlardagi bir masalaga oid bandlarni solishtirish;
   - joy yetmasa, sodda tilni qisqartirish, lekin shart, mezon, istisno, oqibat va ziddiyatni hech qachon tashlamaslik.
3. **«SAQLANADIGAN SHARTLAR» (AI'siz):**
   - asl hujjatdan qamrov so'zi yoki ta'rif belgisi bor gaplar tanlanadi;
   - ular yakuniy modelga asl so'zlari bilan beriladi, shuning uchun dayjest siqib yuborgan so'z ham yetib boradi;
   - chegara: 25 qator, har biri 320 belgigacha, jami 6 000 belgi;
   - saralash: avval qamrov so'zi ko'p va raqami bor gaplar, keyin hujjat tartibi; faqat raqami bilan farq qiladigan takroriy shablon bandlar bitta nomzod hisoblanadi;
   - chegara **ochiq**: modelga va javob ostida «N ta nomzoddan M tasi berildi, K tasi sig'madi» deb yoziladi; qisqartirilgan uzun gap yoki jadval qatori «…» bilan tugaydi; sonlar `coverage.scopeLines` va trace'da ham bor;
   - sig'magan nomzodlar hujjat matni yoki dayjest orqali beriladi, ularga ham shu qoidalar taalluqli.
4. **«EHTIMOLIY ZIDDIYATLAR» (AI'siz):**
   - butun hujjatdan bir masala haqidagi (mazmun so'zlarining ≥60% umumiy), lekin boshqa muddat, foiz yoki summa aytgan gap juftlari topiladi;
   - modelga «nomzod, tekshir» deb beriladi, hukm sifatida emas;
   - cheklov: boshqacha so'z bilan yozilgan zid bandlarni topmaydi (masalan, sintetik shartnomadagi 4.1 va 4.3).
5. **Javob ostidagi tekshiruv:** saqlanadigan qatorlardagi qamrov so'zi javobda umuman uchramasa, «manba bilan qo'lda tekshirish kerak» deb yoziladi. Javobdan hech narsa o'chirilmaydi.

### Xarajat ta'siri (dry-run, chaqiruvsiz)

- **Yangi AI chaqiruvi yo'q.** Token cap'lar oshirilmadi (dayjest 1 600, javob 3 000).
- **Qo'shimcha kirish** (UTF-8 bayt chegarasi, ro'yxat narxi — rejalash raqami):

| Hujjat | Belgilar | Saqlanadigan qatorlar | Ziddiyat juftlari | Yakuniy chaqiruv + bayt | Dayjest chaqiruvlari | Dayjest + bayt (uzunroq prompt) | comet + $ | luna + $ |
|---|---|---|---|---|---|---|---|---|
| long-lease | 37 888 | 8 | 0 | 1 209 | 5 | 6 440 | $0.0034 | $0.0008 |
| long-service-docx | 53 538 | 4 | 1 | 1 021 | 7 | 9 016 | $0.0045 | $0.0010 |
| investment-agreement | 21 934 | 8 | 1 | 1 770 | 3 | 3 864 | $0.0025 | $0.0006 |

- **Output xavfi:** dayjest endi ko'p shartli qoidaga to'liq yozishga ruxsat beradi, shuning uchun taxminiy siqish nisbatining yuqori chegarasi 0.33 → 0.40 ga ko'tarildi.
  - 51 398 belgi: qism 343–1 280 token, 1 600 dan zaxira bilan past.
  - 120 000 belgi (qism ~9 500): 407–1 521 token, ya'ni yuqori taxminda **cap'ga yaqin**. Oshib ketsa, cheklangan qayta o'qish (yarmilar) uni ushlaydi; u ham yetmasa, qism «o'qilmadi» bo'ladi.

### Testlar va tasdiqlanmagan

**Testlar:** `tests/explain-scope.test.js` (7) va yangi anonim sintetik fikstura `08-investment-agreement.json` (uch dayjest qismi, oltita holat, `traceChecks`). Ular tekshiradi:
- yo'qotuvchi dayjest bilan ham asl so'zlar yakuniy modelga yetadi;
- zid juftlik turli qismlarda turibdi va topiladi;
- javob ostidagi qamrov so'zi ogohlantirishi ishlaydi;
- trace (mexanik, so'zma-so'z) sinonim, inkor va «va/yoki» holatlarida qanday natija berishi; skriptda semantik hukm yo'qligi;
- tanlov sonlari va chegaraning ochiqligi;
- xarajat: faqat kirish qo'shiladi.

DB testida tekshirildi: trace faqat aniq so'ralganda va bazada master bo'lgan akkauntga qaytadi; soxta sessiya roli yetmaydi; `no-store`; matn ledger va so'rov qatoriga tushmaydi. Brauzerda (390px, stub API) tekshirildi: flag bo'lmasa `trace: false`, flag bo'lsa `trace: true` yuboriladi va `window.__lastExplain` saqlanadi.

**Tasdiqlanmagan:**
- Haqiqiy model bu qoidalar bilan 6 holatni saqlaydimi — buni jonli sinov va yurist bahosi ko'rsatadi.
- Mexanik tekshiruv faqat so'z borligini ko'radi, ma'no to'g'riligini emas.

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

| Hujjat | Yo'l (yashirin) | Takror | Faktlar aniqligi | Cheklov va muddatlar | Asosiy bandlar (k/n) | Dalil mosligi | Asossiz da'volar soni | Hujjat / muallif tavsiyasi / AI izohi ajratilganmi | AI izohi qoidaga mos (yoki kerak bo'lmaganda yo'q) | Qamrov yoki noaniqlik aytilganmi | Kirish tokenlari | Chiqish tokenlari | Vaqt (s) | Narx ($, manba) | Izoh |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| contract-supply | A | 1 | | | /7 | | | | | | | | | | |
| due-diligence | A | 1 | | | /9 | | | | | | | | | | |
| court-decision | A | 1 | | | /5 | | | | | | | | | | |
| talabnoma | A | 1 | | | /5 | | | | | | | | | | |
| corporate-protocol | A | 1 | | | /4 | | | | | | | | | | |
| long-lease | A | 1 | | | /5 | | | | | | | | | | |

Asosiy bandlar va tuzoqlar har bir fiksturada `keyPoints` va `traps`
maydonlarida.

## 9. Testlar va ular nimani isbotlamaydi

- `tests/document-explain.test.js` (27) tekshiradi:
  - uzun hujjat: 8 000 belgilik qismlar, cheklangan qayta o'qish, kesilgan parcha ishlatilmasligi, hech qism o'qilmasa yakuniy chaqiruv yo'qligi, shablon belgilari, uzun DOCX (ilova jadvali, ariza ≠ ro'yxat, jami javobgarlik, zid bandlar);
  - AI izohi bo'yicha 22 ta holat, har biri uch shaklda; asosiy matn va AI izohida bir xil mezon; inkor, iqtibos, shartli gap, sinonim va arifmetik hosila; to'ldiruvchi izoh; ruscha yorliq;
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
- `tests/digest-budget.test.js` (8) tekshiradi:
  - parallel chaqiruvlar limiti va xarajat rezervi (atomar);
  - 120 s'dan keyin yangi chaqiruv yo'qligi, ishlayotganlar yozilishi;
  - timeout = narx NULL;
  - so'rov tugagandan keyin kelgan usage.
- `tests/upload-no-ai.db.test.js` (15, haqiqiy Postgres) tekshiradi:
  - qamrovning uch holati; `doc_coverage` va chaqiruv ustunlari olib tashlanganda qatorlar yo'qolmasligi va «yozilmagan» ko'rinishi;
  - oddiy foydalanuvchi: hech qism o'qilmasa 422, limit `released`, har qism ledger'da (`document_digest`, `finish_reason`, `truncated`, `call_detail`, xarajat), `ai_requests.doc_coverage`; to'liq o'qilganda digest va final alohida bosqich;
  - tasdiq (409);
  - birliklar;
  - trigger;
  - uzun hujjat oxirigacha o'qilishi;
  - o'qilmagan qismda `released`, kesilgan javobda `committed`;
  - bo'sh javobda limit qaytarilishi.

**Tasdiqlanmagan:**
- Haqiqiy model 2a va 2b dagi xatolarni amalda tuzatadimi.
- Bu faqat 7–8-bo'limlardagi jonli benchmark va yurist bahosi bilan tasdiqlanadi.
