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

**Master brauzerida trace olish (2026-10-08 dan: «Diagnostika» tugmasi):**
1. juristai.uz'ga master akkaunt bilan kiring va dashboard'ni oching.
2. Hujjatni (matnli PDF yoki DOCX) AI chatga biriktiring. Hujjat chiplari ostida **«🔬 Diagnostika»** belgisi chiqadi (faqat Master interfeysida); uni yoqing.
3. «Hujjat mazmunini tushuntirish» → narx kartasida «Davom etish».
4. Javob ostida «🔬 Diagnostika tayyor» kartasi chiqadi → **«JSON yuklab olish»**. Fayl `{ source, response }` ko'rinishida, faqat shu brauzer xotirasidan olinadi. **Uni repoga, chatga yoki boshqa joyga qo'ymang.**
5. Tekshiring: `node scripts/explain-trace.js --bundle explain-trace-….json`. Chiqishda ikki qism bor:
   - so'zma-so'z atamalar (tanlangan qatorlardan avtomatik yoki `--checks checks.json`);
   - **RELATIONS**: kalit bandlarning kim / harakat / holat / shart / muddat / istisno / oqibat / mezonlari har bosqichda so'zma-so'z topildimi; dayjest va javobda muddat, holat, tartib, «va/yoki», ehtimollik yoki ta'rif chegarasi boshqacha bog'langan joylar; ro'yxatga sig'magan qatorlar.
6. Diagnostikani o'chirish: belgini o'chiring yoki kartadagi «Xotiradan o'chirish»ni bosing; sahifani yangilash ham hammasini o'chiradi (hech narsa brauzer xotirasiga yoki serverga yozilmaydi).

Server tomoni o'zgarmagan: trace faqat `trace: true` so'ralganda, faqat bazada `master` rolidagi akkauntga, `Cache-Control: no-store` bilan qaytadi. Tugma faqat interfeysdagi qulaylik; Master bo'lmagan hisob uni ko'rmaydi, ko'rsa ham server trace bermaydi. Konsol yo'li ham ishlaydi: `window.__JAI_TRACE = true`, keyin `window.__lastExplain`.

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

## 4d. Band ichidagi munosabatlar: kim → harakat → shart → muddat → istisno → oqibat (2026-10-08, #422 jonli sinovidan keyin)

#422 jonli javobida so'zlar ko'pincha saqlangan, lekin ular boshqa harakatga bog'langan: shart, holat va vaqt farqlari yo'qolgan. Bu bo'limdagi hamma narsa **AI'siz**, **ogohlantirish rejimida** ishlaydi. Belgi «qo'lda tekshiring» degani, xato isboti emas. Hech narsa o'chirilmaydi.

### Umumiy xatolar sintetik misollarda (`tests/fixtures/explain-eval/09-relations-memorandum.json`)

| Xato turi | Noto'g'ri gap (sintetik) | Mexanik belgi |
|---|---|---|
| Ariza topshirish ≠ ro'yxatdan o'tish | «Oqtosh-Lux» belgisi ro'yxatdan o'tmagan (hujjatda: ariza topshirilmagan) | `holat` |
| Sana boshqa harakatga | 10-iyunda ro'yxatdan o'tkazilgan (hujjatda: 10-iyunda ariza topshirilgan) | `bog'lanish`, `holat` |
| Javob muddati ≠ bitim muddati | Bitim 10 ish kuni ichida tuziladi (hujjatda 10 ish kuni — javob, bitim — 60 kalendar kun) | `bog'lanish` |
| «Aniqlanmadi» ≠ moliyaviy holat tasdiqlangan | Moliyaviy holati barqaror | ibora (`holat: moliyaviy holat barqaror`) |
| Shart noto'g'ri harakatga / tartib teskari | Dalolatnoma to'lovdan keyin imzolanadi | `tartib` |
| «va» ↔ «yoki» | Investor yoki direktor imzolaganda | `va/yoki` |
| Ehtimoliy zarar → yetkazilgan zarar | 300 000 000 so'm zarar yetkaziladi | `ehtimollik` |
| Ta'rifdagi chegara ≠ jarima | 1 000 000 000 so'm jarima (hujjatda bu yirik bitim ta'rifining chegarasi) | `ta'rif` |
| Qo'shimcha mezon tushib qolgan | Nazorat qiluvchi shaxs — faqat 50 foiz mezoni | `mezon` |
| Istisno tushib qolgan | (dayjest bosqichida) | trace: `exception` topilmadi |

Shu bandlarning to'g'ri bayoni hech qanday belgi olmaydi. 9 ta baholash hujjatining har biri o'z matniga qarshi tekshirilganda soxta belgi chiqmaydi. Shu da'voni o'z bo'lagida rad etgan gap belgilanmaydi. Shartli gap tekshiruvdan chiqarilmaydi (pastda: «Inkor va shart faqat o'z da'vosiga tegishli»).

### Qanday tekshiriladi (`src/rag/clause-relations.js`)

Harakatlar umumiy lug'atdan olinadi (o'zbek lotin va rus): ariza, ro'yxat, javob, bitim, to'lov, imzolash, taqdim etish, xabardor qilish, yetkazib berish, qaytarish, bekor qilish, begonalashtirish, rozilik, garov. Bitta hujjatga xos so'z yo'q.

- **Muddat yoki sana** gapda o'zidan keyingi eng yaqin harakatga bog'lanadi («10 kun ichida javob beradi»). Topilmasa, oldingi harakatga bog'lanadi; bunda «…dan keyin / boshlab» hodisasi o'tkazib yuboriladi.
- **Holat:** harakat yonidagi inkor («o'tmagan», «topshirilmagan»), «aniqlanmadi» yoki o'tgan zamon. Javob gapi hujjatdagi xuddi shu masala bilan solishtiriladi: avval qo'shtirnoqdagi nom bo'yicha, bo'lmasa umumiy so'zlar bo'yicha.
- **Tartib:** «A oldidan B», «A dan keyin B», «A sharti bilan B».
- **«va/yoki»** bir xil ikki so'z orasida solishtiriladi.
- **Ehtimollik:** hujjat zarar, xavf yoki yo'qotishni faqat «mumkin/ehtimoliy» deb aytgan bo'lsa-yu, javob aniq deb aytsa, belgilanadi.
- **Ta'rif:** chegara raqami javobda jarima yonida kelsa, hujjatda esa faqat ta'rifda bo'lsa, belgilanadi.
- **Mezon:** «X deganda … tushuniladi» ta'rifining mezonlaridan faqat bir qismi javobda uchrasa, belgilanadi.

Bular mexanik signallar. Lug'atda yo'q sinonim ko'rinmaydi. To'g'ri ma'no boshqa so'z bilan yozilsa, belgilanishi mumkin. Noto'g'ri ma'no hujjat so'zlari bilan yozilsa, o'tib ketishi mumkin. Ma'noni yurist baholaydi.

### Dayjest munosabatlarni saqladimi

- Dayjest qatori endi `- <band> | <kim> → <harakat> | shart: … | muddat: … | istisno: … | oqibat: … | <kimning so'zi>` ko'rinishida. Har bir muddat, shart va oqibat o'z harakati qatorida turadi; o'z muddati bor ikki harakat ikki qatorga yoziladi.
- `scripts/explain-trace.js --bundle` hujjatning kalit bandlari uchun har bosqichda (dayjest, javob) qaysi qism so'zma-so'z topilmaganini ko'rsatadi. Kalit band — kamida ikki xil munosabati bor band, ta'rif yoki istisno. Qismlar: kim, harakat, holat, shart, muddat, istisno, oqibat, mezon.
- Dayjestning o'zi ham javob kabi bog'lanish, holat, tartib va boshqa turlar bo'yicha tekshiriladi.

### 25 qatorlik tanlov: nima chiqib qolardi va nima o'zgardi

#422 tanlovi faqat qamrov so'zi bor qatorlarni olgan va `;` da bo'lgan. Shuning uchun quyidagilar ro'yxatga umuman tushmasdi:
- holatlar: «ariza topshirilmagan», «aniqlanmadi», «tekshirilmadi»;
- harakat va muddat: «10 ish kuni ichida javob beradi»;
- tartib: «imzolanganidan keyin to'laydi»;
- «va» bilan bog'langan imzolovchilar;
- ehtimoliy zarar;
- narx.

«Ariza topshirgan; ro'yxatdan o'tkazilmagan» ham ikki bo'lakka ajralardi. Kalit bandlar (`keyPoints` langari) ro'yxatda:

| Hujjat | Yo'l | #422 | #423 |
|---|---|---|---|
| contract-supply | to'liq matn | 1/7 | 5/7 |
| due-diligence | to'liq matn | 0/9 | 5/9 |
| long-lease | dayjest | 1/5 | 4/5 |
| long-service-docx | dayjest | 1/8 | 7/8 |
| investment-agreement | dayjest | 5/6 | 6/6 |
| relations-memorandum | dayjest | 3/10 | 10/10 |

Hali ham ro'yxatga kirmaydiganlar: muallif, jo'natuvchi, ulush, direktorlar tarixi, ilova jadvali. Bular munosabat emas, identifikatsiya; ular to'liq matnda yoki dayjestda bor.

**Takrorlanish:** model allaqachon so'zma-so'z ega bo'lgan qator endi qayta yuborilmaydi, o'rniga qisqa havola (band raqami va boshlanishi, `[matnda]` / `[dayjestda]`) beriladi:
- to'liq matn yo'lida har bir qator matnda bor, shuning uchun ro'yxat havolalardan iborat (#422 ularni to'liq takrorlardi);
- dayjest yo'lida havola faqat dayjestning o'sha band qatori uning barcha qamrov so'zlari, raqamlari, harakatlari, shartlari va istisnolarini saqlagan bo'lsa beriladi; aks holda manba qatori to'liq yuboriladi.

Tejalgan joy hisobiga ro'yxat chegarasi 25 dan 40 qatorga ko'tarildi. Belgi chegarasi o'zgarmadi (6 000 belgi), shuning uchun yakuniy chaqiruvning narx jadvalidagi chegarasi ro'yxat sababli o'smaydi. 120 000 belgili sinov matnida 56 nomzoddan 40 tasi tanlandi, 16 tasi sig'madi. Sig'maganlar soni modelga va javob ostida aytiladi, ro'yxati esa trace'da (`scopeDropped`) beriladi.

### Inkor va shart faqat o'z da'vosiga tegishli (#423 ko'rib chiqilgandan keyin)

Inkor yoki shart bor gap endi tekshiruvdan butunlay chiqarilmaydi.

- **Inkor** faqat o'z bo'lagidagi da'voni chiqaradi. «…, lekin», «;» yoki «:» yangi da'vo boshlaydi.
  - «Belgi ro'yxatdan o'tmagan, lekin bu noqonuniy degani emas» — «degani emas» faqat «noqonuniy»ga tegishli, shuning uchun «ro'yxatdan o'tmagan» tekshiriladi.
  - «10 ish kuni bitim tuzish muddati emas» — inkor aynan shu bog'lanishni rad etadi, belgi qo'yilmaydi.
- **Shartli gap:** faqat shartning o'zi («agar X bo'lsa») faraz hisoblanadi; oqibat qismi da'vo sifatida tekshiriladi.
- Shartli gapdagi muddat, summa, harakat, tartib, «va/yoki» va ta'rif chegarasi har doim tekshiriladi. Masalan, «Agar bitim 10 ish kuni ichida tuzilmasa…» — `bog'lanish` belgisi qo'yiladi.
- Holat («ro'yxatdan o'tmagan») va «ehtimol ↔ aniq» shartning ichida tekshirilmaydi (u yerda hech narsa tasdiqlanmaydi), oqibat qismida esa tekshiriladi.

### Baholash to'plami — natija faqat shu to'plam uchun

`tests/fixtures/explain-eval/09-relations-memorandum.json` ichidagi `evalSet`ni `node scripts/explain-relations-eval.js` hisoblaydi. To'plamni o'zimiz yozganmiz, lug'at ham shu to'plamda sozlangan. Shuning uchun **bu semantik aniqlik kafolati emas.**

| To'plam | Natija |
|---|---|
| To'g'ri parafrazalar (manbani aynan takrorlamaydi), 12 ta | 9 tasida belgi yo'q; 3 tasida noto'g'ri belgi |
| Manba so'zlarini ishlatadigan noto'g'ri gaplar, 12 ta | 12 tasi belgilandi; 11 tasi kutilgan tur bilan |

To'g'ri bo'lsa ham belgilanganlar:
- «bitimni **imzolash** uchun 60 kun» — lug'atda «imzolash» va «bitim tuzish» boshqa harakat;
- «kapitalning **yarmidan** ko'pi» — so'z bilan yozilgan raqam mezon sifatida ko'rinmaydi;
- «moliyaviy ahvol **tekshirilmagan**» — hujjatda «tekshiruv doirasiga kirmagan»; bu sinonim lug'atda yo'q.

Kutilmagan tur bilan belgilangan: «moliyaviy holati aniqlandi» gapi «aniqlandi» uchun emas, boshqa ibora («mavjud emas») uchun belgilandi.

Bu to'plamda belgilanmay qolgan xato yo'q. Shu to'plam yozilgach, ikki umumiy tur qo'shildi:
- `chegara`: yuqori chegara («oshmaydi», «bilan cheklangan», «…gacha») bilan stavka almashgan;
- `istisno`: istisno inkor qilingan («bundan mustasno emas»).

### Dayjestning 1 600 tokenga sig'ishi

Global token chegarasi oshirilmadi. Uchta o'zgarish:
1. **Qism band chegarasida kesiladi.** Sahifa belgisi yoki bo'sh qator bo'lmasa, oxirgi raqamli band boshida kesiladi. Shunda bandning harakati, sharti va istisnosi ikki qismga bo'linmaydi.
2. **Takror kamaytirildi.**
   - Oldingi qism bilan umumiy 300 belgi `[KONTEKST]` deb belgilanadi va dayjestga qayta yozilmaydi.
   - Faqat raqami yoki nomi farq qiladigan band bitta qatorga yoziladi, barcha raqamlari bilan.
   - `<kim>` yuqoridagi qator bilan bir xil bo'lsa, yozilmaydi.
3. **AI'siz baho bo'yicha oldindan bo'lish.**
   - Har bir qismning dayjest hajmi oldindan baholanadi: har bir alohida band uchun 45 token. Bu taxmin, kalibrlanmagan.
   - Bahosi cheklovga teng yoki undan katta qism boshidanoq ikki yarim sifatida o'qiladi. Bu 1 ta qo'shimcha chaqiruv. Kutish yo'lida esa kesilgan chaqiruv behuda ketadi va yana 2 ta qayta o'qish kerak bo'ladi.
   - Oldindan bo'lish qayta o'qishlar bilan bir xil `maxExtraCalls` (4) hisobidan olinadi, shuning uchun jami chaqiruvlar chegarasi o'zgarmaydi.
   - Har bir chaqiruvning ledger tafsilotida `predictedTokens` yoziladi. Keyingi jonli sinov baholashni haqiqiy chiqish bilan kalibrlashga imkon beradi.

Juda zich hujjatda (har ~150 belgida yangi band) bahodan oshgan qismlar 4 tadan ko'p bo'lishi mumkin. Unda faqat 4 tasi bo'linadi, qolganlari kesilishi mumkin. Kesilgan qism avvalgidek ishlatilmaydi va nomi aytiladi.

### Bandlarni birlashtirish va qism chegarasidan oshgan band (#423 merge'dan keyingi tekshiruv)

**1. Birlashtirish faqat ro'yxat raqami farq qilganda.**
#423 da kalit qatorlar ro'yxati va dayjest hajmi bahosi qatorlarni harflari bo'yicha solishtirgan, raqamlarni tashlab yuborgan. Natijada summasi yoki sanasi boshqa bo'lgan bandlar bitta deb hisoblangan: «9 000 000 so'm, 5-sana» va «12 000 000 so'm, 10-sana» bitta nomzodga aylangan. Dayjest promptida ham «faqat raqami yoki nomi farq qilsa — bitta qator» deyilgan edi.

Endi ikki band faqat boshidagi ro'yxat raqamidan boshqa hamma narsasi aynan bir xil bo'lsa birlashtiriladi (`repeatKey`). Summa, sana, foiz, muddat, nom yoki band havolasi farq qilsa, bandlar alohida qoladi. Bu dayjest prompti, kalit qatorlar ro'yxati, hajm bahosi va trace'ga tegishli.

**2. Qism chegarasidan oshgan band.**
- **Matn yo'qolmaydi.** Qismlar bir-birini 300 belgi qoplaydi; test har bir belgining kamida bitta qismda borligini tekshiradi.
- **Oldin ikki muammo bor edi:**
  - qator o'rtasida kesilgan band qamrovda baribir `all_read` bo'lib qolardi;
  - band chegarasida kesish ko'proq chaqiruv talab qilganda kod qattiq uzunlik bo'yicha kesishga qaytardi, shuning uchun oddiy uzun hujjatlarda ham band o'rtasidan kesilardi.
- **Endi:**
  - qism qatorining oxirigacha ko'pi bilan 5% uzayishi mumkin. Shu sababli chaqiruvlar soni oshmaydi; baholash hujjatlarida birorta band bo'linmaydi;
  - bitta qismdan uzun band baribir bo'linadi. Bunda qamrov holati `read_with_splits` bo'ladi, `all_read` emas (dashboard: «… to'liq deb hisoblanmaydi»);
  - dayjest matni o'zi bu bandni nomlaydi, shuning uchun tushuntirish, xulosa va chat tahlili buni ko'radi;
  - tushuntirish javobi ostida va xulosa boshida «qo'lda tekshiring» degan eslatma chiqadi.
- Barcha qismlar to'liq o'qilgani uchun bu holat «qisman xizmat» hisoblanmaydi va limit qaytarilmaydi; o'qilmagan qism bo'lsa, avvalgidek qaytariladi.

### Xarajat taqqoslash (#423 va #422, dry-run, chaqiruvsiz)

`node scripts/explain-benchmark.js`. Narx jadvali chegarasi har bir chaqiruv uchun hisoblanadi: kirish UTF-8 baytda, chiqish cheklov bo'yicha, dayjest qismlari esa yakuniy chaqiruvga cheklov hajmida kiradi. Ikki holat ko'rsatiladi:
- **«oddiy»** — hech bir qism kesilmagan;
- **«qayta o'qish bilan»** — `DIGEST_LIMITS`dagi qolgan qo'shimcha chaqiruvlarning hammasi kesilgan qismlarni qayta o'qishga ketgan.

| Hujjat | Chaqiruvlar #422 → #423 (oddiy / qayta o'qish bilan) | Oldindan bo'lingan | aisha-comet #422 → #423 | gpt-6-luna #422 → #423 |
|---|---|---|---|---|
| long-lease (37 888) | 6/10 → 6/10 | 0 | $0.0391 / $0.0582 → $0.0419 / $0.0626 | $0.0250 / $0.0379 → $0.0262 / $0.0398 |
| long-service-docx (53 538) | 8/12 → 8/12 | 0 | $0.0531 / $0.0722 → $0.0567 / $0.0774 | $0.0334 / $0.0463 → $0.0350 / $0.0486 |
| investment-agreement (21 934) | 4/8 → 4/8 | 0 | $0.0251 / $0.0441 → $0.0268 / $0.0474 | $0.0165 / $0.0294 → $0.0173 / $0.0308 |
| zich sintetik 51 398 | 8/12 → 12/12 | 4 | $0.0524 / $0.0715 → $0.0719 / $0.0719 | $0.0331 / $0.0460 → $0.0461 / $0.0461 |
| zich sintetik 120 000 | 14/18 → 18/18 | 4 | $0.1042 / $0.1247 → $0.1261 / $0.1261 | $0.0627 / $0.0762 → $0.0768 / $0.0768 |

Qo'shimcha kirish:
- dayjest prompti har bir qismga +887 bayt;
- tushuntirish prompti +461 bayt;
- kalit qatorlar ro'yxati kattaroq.

Dayjest chiqishiga maydon belgilari qo'shiladi: qatorga 0–10 belgi deb olingan, o'lchanmagan.

Zich hujjatda #423 ning «oddiy» chegarasi #422 ning eng yomon holatiga teng. Sabab: oldindan bo'lish qayta o'qish byudjetini oladi, chaqiruvlar shifti esa o'zgarmaydi.

Eng katta oddiy ishda (120 000 belgi, qism 9 508 belgi) bir qismning kutilgan yuqori chiqishi 1 521 → 1 673 tokenga o'sadi va cheklovdan oshishi mumkin. Haqiqiy `finish_reason` va chiqish tokenlari keyingi jonli sinovda ledger'dan o'lchanadi.

VoiceLab credit'da hisoblaydi; bu yerdagi narx — ro'yxat narxi, tasdiqlangan kurs emas.

### Diagnostika so'rovga bog'langan

- Diagnostikani yoqish, JSON yuklab olish va xotiradan o'chirish hech qanday so'rov yubormaydi (na server, na AI). Statik test va brauzer tekshiruvi buni ko'rsatdi.
- Brauzer tekshiruvida yuklab olish paytida bitta `/api/ai-chat-sessions` so'rovi ko'rindi. Bu tushuntirish oqimining chat suhbatini saqlash so'rovi, yuklab olishga aloqasi yo'q va AI chaqirmaydi.
- **Bog'lanish.** Har bir tushuntirish so'roviga brauzer `traceTag` beradi. Server uni trace'da qaytaradi va yoniga `requestId` (shu so'rovning `ai_requests` qatori), `documentSha256` va `createdAt`ni qo'shadi.
- **Eskirish.** Quyidagi holatlardan keyin oldingi trace yaroqsiz bo'ladi:
  - yangi suhbat yoki boshqa suhbatga o'tish;
  - yangi yoki olib tashlangan fayl;
  - Diagnostikani o'chirish;
  - yangi so'rov.

  Bunday holda eski kartadagi tugma fayl bermaydi. Javob kelguncha holat o'zgarsa, javob trace sifatida olinmaydi.
- **Tekshirish skripti.** `scripts/explain-trace.js` manba matnining hash'i trace'nikiga mos kelmasa, to'xtaydi.
- **Master tekshiruvi.** Server `createVerifyMaster` orqali tekshiradi; `server.js` ham, DB testi ham aynan shu funksiyani ishlatadi. Test real HTTP orqali, real Postgres'da o'tadi:
  - sessiyasi «master» deb da'vo qilgan, lekin bazada Master bo'lmagan hisob trace olmaydi;
  - Master trace'ni faqat so'raganda, `no-store` bilan oladi;
  - teg aynan qaytadi, begona teg tashlab yuboriladi;
  - `requestId` shu so'rovning `ai_requests` qatoriga mos;
  - ikkinchi so'rov boshqa teg va boshqa `requestId` oladi.

  Testdagi sessiya qatlami sarlavha orqali simulyatsiya qilingan; production'dagi cookie sessiyasi bu testda yo'q.

### Testlar va tasdiqlanmagan

- `tests/explain-relations.test.js` (15 ta) quyidagilarni tekshiradi:
  - har bir xato turi va to'g'ri bayon;
  - o'z matniga qarshi soxta belgi yo'qligi;
  - inkor va shartning o'z da'vosiga tegishliligi;
  - baholash to'plami natijalari;
  - band chegarasida kesish, `[KONTEKST]` va oldindan bo'lish;
  - asosiy matn va AI izohi uchun bir xil mezon;
  - trace skripti, shu jumladan boshqa hujjatning bundle'i rad etilishi.
- DB testi (`upload-no-ai.db.test.js`): trace'ning so'rovga bog'lanishi, sahifadagi funksiyalarda so'rov yo'qligi va eski trace'ning yaroqsiz bo'lishi.
- Brauzerda tekshirildi (Chromium, 1280 px va 390 px, `/api` o'rniga soxta javoblar):
  - tugma faqat Master uchun chiqadi;
  - yoqish 0 ta so'rov yuboradi;
  - JSON yuklanadi;
  - yangi fayl, yangi suhbat yoki o'chirilgan Diagnostikadan keyin eski karta fayl bermaydi;
  - kech kelgan javob yangi trace bo'lib qolmaydi;
  - gorizontal toshish yo'q.
- Haqiqiy iPhone/Safari'da tekshirilmagan. Production'da ham tekshirilmagan.
- **Tasdiqlanmagan:**
  - jonli modelda munosabatlar haqiqatan saqlanishi;
  - `predictedTokens` bahosining aniqligi.

  Ikkalasi bitta jonli sinovda javob, ledger va diagnostika JSON'ini birga review qilish orqali tekshiriladi. Pullik sinov egasining ruxsatisiz boshlanmaydi.

## 4e. Production diagnostikasi bo'yicha regressiya (2026-10-08, #425)

**Manba:** Master diagnostika JSON'i (bitta jonli so'rov). Uning ichidagi hujjat repoga qo'yilmadi; bu bo'limda ism, summa yoki ibora yo'q, faqat xato turlari bor. Dalil jadvali (manba → dayjest → javob) egasiga alohida yuborildi.

### Tasdiqlangan xato turlari (JSON'dagi matnlar bilan solishtirilgan)

| Tur | Qayerda paydo bo'lgan | Mexanik signal endi |
|---|---|---|
| «e'lon qilingan, lekin to'lanmagan» → «to'lanmagan» | dayjestda to'g'ri, javobda o'zgargan | dayjest → javob: qamrov so'zi |
| «barcha ishtirokchilar, jumladan X» → «boshqa ishtirokchilar» | dayjestda to'g'ri, javobda o'zgargan | dayjest → javob: qamrov so'zi |
| Bir buzilishning oqibatlari: xarajatlar va «zarardan tashqari alohida» tushib qolgan | dayjestda to'g'ri, javobda o'zgargan | dayjest → javob: oqibat / qamrov so'zi |
| Muddat «yuborilgan sanadan» → «olgan sanadan»; «yuborishi mumkin» → «javob berishi kerak» | dayjestda to'g'ri, javobda o'zgargan | muddat boshlanishi; `majburiyat` |
| Hisobot uchun ikki xil muddat (bir tomonning majburiyati, boshqasining huquqi) javobda bitta muddatga qo'shilgan. Bu **tasdiqlangan ziddiyat emas** — turli bandlar bo'lishi mumkin | dayjest ikkalasini alohida saqlagan, javob qo'shgan | «ikki muddat» — nomuvofiqlik nomzodi, qo'lda tekshiriladi |
| Jadvalning oxirgi qatoriga boshqa qatorning muddati bog'langan | dayjestda | jadval o'qilishi (qator/ustun) va `jadval` signali |
| Jadval qatorlari soni noto'g'ri («1–6», aslida 7 ta) | dayjestda | jadval qatorlari endi raqamlangan |
| Natija ustuni shart deb yozilgan | dayjestda | ustun sarlavhasi har bir qiymat yonida |
| Shartdagi subyekt (kim ro'yxatdan o'tkazadi) tushib qolgan | dayjestda | dayjest promptiga qoida qo'shildi (mexanik tekshiruv yo'q) |
| Ziddiyat nomzodi: sanksiya foizi va ta'rif chegarasi | tanlovda | obyekt, harakat, bosqich va hisoblash asosi bo'yicha solishtirish |
| `[Qism 5/7]` «hujjatda yo'q raqam» deb belgilangan | mexanik tekshiruvda | tizim havolalari raqam tekshiruvidan chiqarilgan |
| Kalit qatorlar sanog'ida havolalar soni tanlanganlardan ko'p | sanoqda | faqat yuborilgan qator sanaladi |

**Sintetik taxmin (JSON'da tasdiqlanmagan):** DOCX'dagi avtomatik raqamlash (`4.5.`) matnga o'tmaydi, chunki mammoth uni tashlab yuboradi. Bu band havolalarini tekshirishni qiyinlashtiradi; bu PR'da tuzatilmagan.

### Nima o'zgardi

- **DOCX jadvallari** (`src/ocr/docx-text.js`):
  - jadvalli hujjat har bir qator bitta qator bo'ladigan qilib o'qiladi: `⟦Jadval N · M-qator · bo'lim⟧ ⟨ustun⟩ qiymat ¦ …`;
  - birlashtirilgan kataklar, ko'p qatorli sarlavha, bo'sh katak (`⟨bo'sh⟩`) va yuqoridan birlashgan qiymat (`⟨↑ …⟩`) saqlanadi;
  - jadvalsiz hujjat avvalgidek (mammoth) o'qiladi;
  - jadval o'quvchisi mammoth'dagidan kamroq matn olsa, mammoth matni ishlatiladi — matn yo'qolmaydi;
  - qismdan uzun qator bo'linsa, keyingi qismga qator identifikatori qayta beriladi va qamrov `read_with_splits` bo'ladi.
- **Hajm va limit** — serverda, asl hujjat matni bo'yicha:
  - jadval belgilari hisoblanmaydi;
  - o'lcham imzolangan ticket'ga yoziladi (`chars`);
  - ticket bo'lmasa, yuborilgan matn belgilari bilan birga sanaladi, ya'ni mijozga hech qachon kam emas.
- **Dayjest → javob:**
  - dayjest qatoridagi qamrov so'zlari, oqibatlar, istisnolar, muddat boshlanishi va boshqa qiymatlar javobning o'sha masaladagi gapida so'zma-so'z topilmasa, «qo'lda tekshiring» signali chiqadi;
  - bu ma'no hukmi emas, javobdan hech narsa o'chirilmaydi.
- **Javob qo'shimcha tekshiruvlari:**
  - ikki xil muddat («ikki muddat»);
  - imkoniyat → majburiyat (`majburiyat`);
  - jadval qatori (`jadval`).
- **Ziddiyat nomzodlari:**
  - bir masala, bir xil rol (sanksiya, chegara, ta'rif), bir xil hisoblash asosi, harakat va bosqich bo'lsagina nomzod bo'ladi;
  - turli shaxslar yoki sanksiyalar nomzod emas;
  - 100% yig'indining o'zi nomzodni chiqarib tashlamaydi.
- **Promptlar** (umumiy qoidalar):
  - jadval qatori va ustuni saqlanadi;
  - shartdagi subyekt va muddat boshlanishi saqlanadi;
  - ikki muddat ikkalasi aytiladi;
  - qisman ro'yxat «qisman» deb aytiladi.

### Qaysi o'zgarish noto'g'ri bayonning oldini oladi, qaysi biri faqat belgilaydi

**Oldini oluvchi** — modelga boradigan narsani o'zgartiradi. Ta'siri faqat jonli sinovda ko'rinadi; mexanik testlar uni tasdiqlamaydi:
- **DOCX jadvali qatorlab o'qiladi.** Qiymat modelga o'z qatori va ustun sarlavhasi bilan boradi. Tuzilish saqlanmasa, model buni bilmaydi, lekin foydalanuvchiga aytiladi.
- **Dayjest prompti** quyidagilarni talab qiladi:
  - jadval qatori va ustunini saqlash;
  - shartdagi subyekt;
  - muddat qaysi hodisadan boshlanishi (yuborilgan yoki olingan);
  - «mumkin» va «kerak» farqi.
- **Yakuniy prompt** dayjest yoki hujjatdagidek saqlashni talab qiladi:
  - subyekt («barcha ishtirokchilar, jumladan X» ≠ «boshqa ishtirokchilar»);
  - muddat boshlanishi;
  - «mumkin» / «kerak»;
  - «va» bilan bog'langan har bir shart;
  - har bir istisno;
  - bitta buzilishning barcha oqibatlari;
  - ikki muddat bo'lsa, ikkalasi ham, kimniki ekani bilan;
  - qisman ro'yxat bo'lsa, «qisman» ekani va to'liq ro'yxat qayerdaligi.

  Bu talablar `tests/explain-regression.test.js` da tekshiriladi.
- **Ziddiyat nomzodlari** aniqroq tanlanadi va modelga «tekshir, o'zing hal qilma» degan nomzod sifatida beriladi.
- **Qismdan uzun jadval qatori** keyingi qismga qator identifikatori bilan boradi.

**Faqat belgilovchi** — tayyor javobni o'zgartirmaydi, ostiga «qo'lda tekshiring» eslatmasini qo'shadi:
- dayjest → javob signallari;
- «ikki muddat»;
- `majburiyat` (mumkin → kerak);
- `jadval` (qiymat boshqa qatorda);
- jadval tuzilishi saqlanmagani yoki qatorlab o'qilgani haqidagi eslatma.

Bunday eslatma qo'shilgani «mazmun xatosi tuzatildi» degani **emas**: noto'g'ri gap javobda qoladi, faqat ko'rsatiladi.

**Soxta belgini olib tashlovchi:** `[Qism n/m]` havolasi endi «hujjatda yo'q raqam» deb ko'rsatilmaydi. Kalit qatorlar sanog'i ham tuzatildi.

### Hajm ticket'i va mammoth fallback'i (#425 ko'rib chiqilgandan keyin)

**Ticket aniq matnga bog'langan.**
- Imzo matnning SHA-256 xeshini o'z ichiga oladi (bosh va oxirdagi bo'shliqlarsiz).
- Boshqa matn bilan kelgan ticket o'qilmaydi va server hajmni yuborilgan matndan qayta o'lchaydi. Bu holda jadval belgilari ham sanaladi.
- DB testi (HTTP orqali): kichik DOCX ticket'i taxminan 80 000 belgili boshqa matn bilan yuborilganda Sinov tarifida 413 `DOCUMENT_TOO_LARGE` qaytadi, AI chaqirilmaydi. Kichik matn o'z ticket'i bilan 1 birlikka ishlaydi.

**Mammoth fallback'i:**
- Jadval o'quvchisi matn uzunligi bo'yicha emas, so'zlar bo'yicha tekshiriladi. Mammoth o'qigan har bir so'z jadval o'quvchisi matnida kamida shuncha marta bo'lishi kerak.
- Bitta so'z yetishmasa ham mammoth matni ishlatiladi. Bunda tuzilish holati `lost` bo'ladi va u quyidagilarda ko'rsatiladi:
  - extract javobi (`tableStructure`);
  - imzolangan ticket;
  - qamrov (`coverage.tables`) va ledger'dagi `doc_coverage`;
  - diagnostika JSON'i;
  - javob ostidagi «qator va ustun tuzilishi saqlanmadi — qo'lda tekshiring» eslatmasi.
- Qatorlab o'qilgan jadval uchun ham «kataklar to'liq va to'g'ri o'qilgani tasdiqlanmagan» deb yoziladi. So'zlar to'liq bo'lishi kataklar to'g'ri joylashganini isbotlamaydi.

### Production javobini yangi tekshiruvdan o'tkazish (AI'siz)

- `[Qism 5/7]` endi belgilanmaydi.
- Yangi signallar:
  - `majburiyat`;
  - «ikki muddat»;
  - dayjest → javob 6 ta signal. Ular orasida tasdiqlangan oqibat, alohida jarima va muddat boshlanishi bor; boshqa so'z bilan aytilgan joylar ham signal bo'lishi mumkin.
- Jadval signali bu JSON'da chiqmaydi: hujjat eski usulda (mammoth) o'qilgan, jadval tuzilishi yo'q.

Bu mexanik signal, model sifati tasdig'i emas.

### Xarajat (dry-run, `node scripts/explain-benchmark.js`)

Yangi AI chaqiruvi yo'q, cheklovlar o'zgarmagan. Narx jadvali chegarasi (aisha-comet).

| Hujjat | Belgilar (to'lanmaydi, lekin yuboriladi) | Qismlar | #424 → #425 oddiy | qayta o'qish ssenariysi p = 0,14 / 0,5 | barcha qo'shimcha chaqiruvlar |
|---|---|---|---|---|---|
| Faqat matn, 51 398 | 0 | 7 → 7 | $0.0571 → $0.0593 | $0.0668 / $0.0765 → $0.0696 / $0.0798 | $0.0765 → $0.0798 |
| 51 398, 3 jadval (34 qator) | 4 793 | 7 → 8 | $0.0572 → $0.0658 | $0.0670 / $0.0767 → $0.0775 / $0.0863 | $0.0767 → $0.0863 |
| 120 000, 2 ilova jadvali (80 qator) | 12 686 | 13 → 13 | $0.1111 → $0.1206 | $0.1303 / $0.1318 → $0.1416 / $0.1432 | $0.1318 → $0.1432 |

- p = 0,14 — **ssenariy**, bitta production so'rovidan olingan (7 qismdan 1 tasi qayta o'qilgan). Bu statistik ehtimollik emas, kafolatlangan maksimum ham emas.
- Jadval belgilari foydalanuvchi limitiga kirmaydi, lekin provayderga yuboriladi: kirish narxi va qismlar soni oshishi mumkin.
- 120 000 belgili ishda qismlar kattalashadi va 1 600 tokenlik cheklovga yaqinlashadi.
- VoiceLab credit'da hisoblaydi; narx ro'yxat narxi bo'yicha.

### Testlar

- `tests/explain-regression.test.js` (11 ta): anonim sintetik matn (fixture 10) va kod bilan yasalgan DOCX.
- Model sifatini tasdiqlamaydi.

## 4f. Ikkinchi jonli sinov (2026-10-09): qismlar hajmi, qayta o'qish, moslashtirish, jadval sababi

Manba: master diagnostika JSON'i (51 398 belgi, 7 qism). JSON va hujjat repoda yo'q. Quyidagilar sintetik test va AI'siz hisob-kitob natijalari, model sifatining tasdig'i emas.

### Nima topildi
- 8 000 belgilik qismlarning 3 tasi (3, 4, 7) 1 600 token chegarasida kesildi. Qolganlari chegaraga yaqin chiqdi (1 367–1 588).
- Eski bashorat (har band uchun 45 token) 2–3,5 marta kam chiqdi: 450–810 bashorat, 1 367–1 600 haqiqiy.
- Qayta o'qish hujjat tartibida tanlandi. 3 va 4-qismlar 4 qo'shimcha chaqiruvni ishlatib bo'ldi, KPI jadvalli 7-qism chiqarildi.
- 7 jadvalning hammasi mammoth fallback'iga tushdi. JSON'da sabab yo'q edi, asl DOCX ham yo'q.
- Ikkita mexanik signal turli bandlarni solishtirgan:
  - «10 ish kuni» va «30 kun» (keyingi ro'yxat bandi bilan);
  - «imzolash» va «to'lash» (shart sifatidagi o'tgan zamon fe'li holat deb o'qilgan).

### A. Qism hajmi bashorat qilingan chiqish bo'yicha
- Model: chaqiruv boshiga 500 token va har so'zga 1,2 token (takrorlangan band bir marta sanaladi).
- Faqat dayjest chaqiruvlarining chiqish tokenlariga moslangan: 8 ta kesilmagan chaqiruv. Kesilgan 3 tasi faqat quyi chegara sifatida olingan (1 600 talab emas).
- Moslangan nuqtalarda xato −4…+18%. Kesilgan uchala qismni model past baholaydi (kamida 4–11%).
- Shuning uchun qism chegaraning 75 foiziga (1 200 token) rejalanadi. Qism uzunligi `minSplitChars` (2 000) dan `CHUNK` (8 000) gacha.
- Rejaga 13 tadan ko'p qism kerak bo'lsa yoki biror qism chegaraga yetsa, `density.fit = 'over'`. Hujjat 13 ta teng qismga bo'linadi. Chegaralar (1 600, 13, 4 qo'shimcha chaqiruv, 75 s) oshirilmaydi va hech qachon «sig'di» deyilmaydi.
- Kalibrlanmagan: bitta hujjat, bitta model, 11 chaqiruv. Har chaqiruvning `predictedTokens` qiymati ledgerda turadi, keyingi sinovlar bilan solishtirish mumkin.

### B. Qayta o'qish tanlovi
- Kesilgan qismlar AI'siz muhimlik tartibida saralanadi. Mezonlar:
  - boshqa qismdan havola qilingan ilova yoki jadval;
  - jadval qatorlari yoki alohida qatordagi kataklar;
  - summa, foiz va muddatlar;
  - shart va oqibatli qatorlar.
- Har bir kesilgan qism uchun `coverage.reread` yozuvi bor: qism, qaror, sabab (`extra_call_limit`, `time_limit`, `too_short_to_split`), ball va asoslar.
- Bu tartib kalibrlanmagan: u huquqiy ahamiyat o'lchovi emas, faqat navbat.

### Butun xizmat bo'yicha taqqoslash (`node scripts/digest-plan-sim.js`, AI'siz)
Hisob haqiqiy pipeline'dan stub model bilan o'tkaziladi: `buildDigest` va `explainDocument`. Unga dayjest qismlari, oldindan bo'lish, qayta o'qishlar va yakuniy chaqiruv kiradi. Yakuniy chaqiruvning kirishi haqiqiy prompt bilan sanaladi: qoidalar, dayjest, kalit qatorlar, ziddiyat nomzodlari va #427 da manba identifikatorlari.

**O'lchangan** (bitta jonli sinov, 2026-10-09, bitta 51 398 belgili DOCX, aisha-comet):
- kirish: 0,345 token/belgi (dayjest va yakuniy chaqiruvda bir xil);
- dayjest chiqishi: 2,82 belgi/token;
- yakuniy javob: 1 737 token, 37,5 s;
- dayjest: ≈52 token/s.

**Simulyatsiya** (kalibrlanmagan stsenariy):
- qism talabi = bashorat × 0,88 / 1,00 / 1,15 / 1,30;
- yakuniy javob: o'lchangan 1 737 token va 3 000 token chegarasi.

Bu prognoz emas va kafolatlangan maksimum emas.

**Tekshiruv nuqtasi.** Production hujjatida eski reja ×1,15 bilan $0.0363 va ~96 s chiqdi; jonli sinovda $0.0356 va 90,9 s edi. Bu o'sha hujjat, mustaqil tekshiruv emas.

| Hujjat (sintetik) | ×1,00, javob 1 737: eski | ×1,00: yangi | ×1,30: eski | ×1,30: yangi |
|---|---|---|---|---|
| long-lease, 37 888 | 5 qism, hammasi o'qildi, $0.0168 | bir xil (5 qism) | $0.0182 | bir xil |
| long-service-docx, 53 538 | 7 qism, hammasi, $0.0224 | bir xil | $0.0242 | bir xil |
| investment-agreement, 21 934 | 3 qism, $0.0108 | bir xil | $0.0116 | bir xil |
| band ro'yxati, 46 867 | 4 qism o'qilmadi, birlik qaytarildi, $0.0347 | 13 qism, hammasi, $0.0388 | 6 bo'lak o'qilmadi, $0.0351 | hammasi, $0.0482, ~122 s |
| jadvalli ilova, 24 464 | 5 bo'lak o'qilmadi, $0.0237 | 13 qism, hammasi, $0.0347 | 5 bo'lak o'qilmadi, $0.0240 | 7 qism o'qilmadi, $0.0426 |
| juda zich, 120 000 (`over`) | 11 qism o'qilmadi, $0.0592 | 9 qism o'qilmadi, $0.0580 | hech biri o'qilmadi, 422, yakuniy chaqiruv yo'q | xuddi shunday |

Javob 3 000 token chegarasida bo'lsa, har qatorga taxminan +$0.0009 va +27 s qo'shiladi.

**Siyrak hujjat.** Bashorat takrorlangan bandni bir marta sanaydi. Shuning uchun 8 000 belgilik qism maqsaddan past bo'lsa, yangi reja eskisi bilan aynan bir xil bo'ladi. Siyrak hujjatlarda eski rejaning tejamkorligi saqlanadi (`tests/explain-regression.test.js`).

**Moslashda ishlatilmagan hujjat.** Bunday hujjat bo'yicha o'lchangan natija **yo'q**. Ikkala diagnostika JSON'i ham bitta hujjatdan: sha256 bir xil. `scripts/digest-calibration.js` bashoratni allaqachon bo'lib o'tgan so'rov bilan AI'siz solishtiradi. Unga master'ning diagnostika JSON'i va `/api/admin/ai-usage/requests/<id>` eksporti beriladi; kesilgan chaqiruv faqat quyi chegara sifatida olinadi. Moslashda ishlatilgan sinovda xato −4…+18% (o'rtacha +4%). Kesilgan 3-qism kamida 4%, jadvalli 7-qism kamida 17% past baholangan.

### «Over» holatida foydalanuvchi nima oladi
- Bashorat chegaradan oshgan qismlar boshidan ikkiga bo'lib o'qiladi, 4 qo'shimcha chaqiruv doirasida.
- Kesilgan qismlar muhimlik tartibida qayta o'qiladi. Qolganlari o'qilmaydi.
- Javob tepasida: «Qisman natija — to'liq tahlil emas», o'qilmagan qismlar nomi bilan va «hujjat belgilangan chegaralar uchun juda zich … o'qishdan oldin taxmin qilingan (kalibrlanmagan baho)».
- Javob oxirida: «limit qaytarildi». Dashboard'da ham xabar chiqadi: 200 javobdagi `quotaRefunded` endi ko'rsatiladi.
- Birlik bir marta qaytariladi, AI xarajati ledgerda qoladi. Bu HTTP va Postgres testida sinalgan (`upload-no-ai.db`).
- Hech bir qism o'qilmasa: 422 `DOCUMENT_NOT_READ`, yakuniy chaqiruv yo'q, birlik qaytariladi.

### Jadval fallback sababi
- O'quvchi endi mammoth o'qiydigan 6 ta tuzilmani ham o'qiydi: qator va katak atrofidagi content control, kuzatilgan qo'shimcha, bo'linmas va yumshoq defis, `w:sym`.
- O'quvchi o'chirilgan qatorni va ko'chirilgan matnning eski joyini o'qimaydi.
- Fallback bo'lsa, sabab XML'dan aniqlanadi: har bir topilmagan so'z atrofidagi tuzilma, topilmasa `unknown`.
  - Kodlar: ticket, coverage va log'ga.
  - So'zlar va ularning joyi: faqat bazada master bo'lgan hisobga, `no-store` bilan.
- Lokal tekshiruv (yuklashsiz, AI'siz): `node scripts/docx-table-check.js fayl.docx`.
- Bu sinovdagi hujjatning aniq sababi aniqlanmagan: asl fayl yo'q. Sintetik sabablar production sababi deb ko'rsatilmaydi.

### Moslashtirish
- Dayjest qatori javob jumlasiga faqat o'z mavzusidagi so'zlar bilan bog'lanadi; tomon nomlari bunga kirmaydi.
- Muddat, qiymat va muddat boshlanishi faqat bir xil harakat tilga olingan jumlada solishtiriladi. Keyingi ro'yxat bandi solishtirilmaydi.
- Ishonchsiz moslik «mos band aniqlanmadi» deb belgilanadi va o'zgarish deb hisoblanmaydi.
- Manba bilan solishtirishda ham shunday: band raqami yoki harakat hisobga olinadi, muddat faqat shu banddagi muddat bilan solishtiriladi.
- Sintetik eval to'plamida natija o'zgarmadi: to'g'ri parafrazlar 9/12 belgisiz, noto'g'ri jumlalar 12/12 belgilandi.

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
