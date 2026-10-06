# Tariflar v2 (2026-10-04)

Ushbu hujjat egasining 2026-10-04 dagi topshirig'ini amalga oshirishning
1-bosqichi: tariflar, limitlar, yagona kvota ledgeri, migratsiya va
foydalanuvchiga ko'rinadigan matnlar. Oldingi tarif takliflari (D-4, D-11,
"kuniga 10 → 3 muddatsiz", haftalik limitlar, "cheksiz chat") shu bilan
almashtiriladi. Narx va limitlarning yagona manbasi —
`src/rag/tariff-ledger.js` (`PLAN_CATALOG`).

## 1. Tariflar

| Xizmat | Sinov | Silver | Gold | Platinum |
|---|---:|---:|---:|---:|
| Narx | Bepul, bir martalik | 199 000 so'm | 599 000 so'm | 999 000 so'm |
| Davr | Yangilanmaydi | 30 kun | 30 kun | 30 kun |
| Huquqiy chat | 5 | 150 | 450 | 750 |
| Hujjat tahlili (birlik) | 1 | 8 | 24 | 40 |
| AI yuridik xulosa (birlik) | 1 | 8 | 24 | 40 |
| Draft yaratish | 0 | 10 | 30 | 50 |
| Rasm/skan o'qish (sahifa) | 10 | 80 | 240 | 400 |
| Workspace yaratish | Yo'q | Yo'q | Yo'q | Ha |
| Workspace'ga qo'shilish | Yo'q | Ha | Ha | Ha |

Gold = 3 × Silver, Platinum = 5 × Silver: kodda Silver limitlaridan
ko'paytuvchi bilan chiqariladi va test bilan tekshiriladi.

## 2. Qoidalar

**Sinov.**
- Bitta shaxsga bir marta beriladi: `tariff_periods` da `source = 'trial'` uchun unikal indeks bor, qayta deploy, qayta so'rov yoki callback ikkinchisini bermaydi.
- Birinchi hisoblanadigan so'rov bilan boshlanadi; kun, hafta yoki oy bo'yicha yangilanmaydi; muddati tugamaydi — ishlatib bo'linadi.
- Telegram va veb hisoblari bog'langan bo'lsa (`admins.telegram_user_id`), bitta umumiy Sinov ishlaydi: bog'lanishdan oldin Telegram'da ishlatilgani ham hisobga olinadi.
- Turli odamlar faqat IP bir xilligi sababli birlashtirilmaydi (IP ishlatilmaydi).
- Salomlashuv, menyu, /balance, /help va yordam buyruqlari limit sarflamaydi.
- Tugagach avtomatik to'lov olinmaydi, tarif tanlash taklif qilinadi.

**Pullik davr.**
- Aynan 30 kun; boshlanish va tugash `tariff_periods` da serverda saqlanadi.
- Haftalik/kunlik reset va rollover yo'q.
- Ishlatilmagan limit keyingi davrga o'tmaydi va avtomatik qayta sotib olinmaydi.
- **Renewal** (o'sha tarif, joriy davr bor): yangi davr joriy davr tugagan paytdan boshlanadi.
- **Upgrade** (yuqori tarif): darhol boshlanadi; joriy (va navbatdagi) quyi davrlar `superseded` bo'ladi. Joriy davrning ishlatilmagan kunlari narxdan pro rata chegiriladi (`quotePlanChange`, 1 000 so'mga yaxlitlangan).
- **Downgrade** (quyi tarif): joriy davr tugagach boshlanadi.
- Takroriy payment callback ikki marta kvota bermaydi (`payment_ref` unikal).
- To'lov provayderi ulanmagan (D-2): pullik davrni master `POST /api/admin/tariff/grant` bilan to'lov raqami (`paymentRef`) orqali beradi. Foydalanuvchining o'z so'rovi (`/api/tariff/select`) pullik tarifni hech qachon bermaydi.

**Bekor qilish va qisman bajarilgan ish.** Har bir ish:
`reserve → commit (yetkazildi) | release (yetkazilmadi)`. Ish atomar
(per-payer advisory lock) va `job_key` bo'yicha idempotent.

| Holat | Kvota | AI xarajati |
|---|---|---|
| Ish muvaffaqiyatli | sarflanadi (commit) | ledgerda qoladi |
| Server xatosi, javob yo'q | qaytariladi (release) + "limit qaytarildi" xabari | ledgerda qoladi (o'chirilmaydi) |
| Foydalanuvchi javob boshlanishidan oldin chiqib ketdi | qaytariladi | ledgerda qoladi |
| Javob oqimi boshlangandan keyin chiqib ketdi (cancel) | sarflanadi | ledgerda qoladi |
| Process to'xtadi (rezerv tashlab ketildi) | 30 daqiqadan keyin hisobdan chiqadi (`TARIFF_RESERVATION_TTL_MIN`) | ledgerda qoladi |

Cancel orqali bepul model chaqiruvlarini olish mumkin emas: javob boshlangan
bo'lsa ish hisoblanadi.

## 3. Hujjat birligi

Bitta tahlil yoki xulosa birligi — ko'pi bilan 10 sahifa va 40 000 belgi:

    birlik = max(ceil(sahifa / 10), ceil(belgi / 40 000))

- **PDF.** Sahifa soni serverda (`/api/analyze/extract`) o'qiladi va matn hash'i bilan imzolangan "hujjat chiptasi" (`docTicket`, HMAC, 24 soat) bilan qaytadi. Klient sahifa sonini kamaytira olmaydi: chiptasiz holatda belgilarning standart sahifalashi ishlatiladi.
- **DOCX va matn.** Standart sahifa — 4 000 belgi. Fontni kichraytirish limitni chetlab o'tmaydi, chunki belgi soni hisoblanadi.
- **Sinov.** Bitta hujjat ko'pi bilan 1 birlik.
- **Pullik tarif.** Bitta ish ko'pi bilan 30 sahifa va 120 000 belgi (dastlabki chegara, benchmark bilan tasdiqlanadi).
- Katta hujjat 413 bilan rad etiladi; jimgina qisqartirilmaydi. `/api/analyze` 9 000 belgida, xulosa va tushuntirish esa 120 000 belgida kesar edi — endi kesilmaydi, uzun hujjat to'liq digest orqali o'qiladi (digest 11 bo'lak, 127 600 belgini qamraydi).
- Bo'sh yoki o'qib bo'lmaydigan fayl kvota sarflamaydi.
- Ish boshlanishidan oldin dashboard hajm, xizmat, birlik va qoladigan limitni ko'rsatadi (`POST /api/tariff/quote`).
- Tahlil va xulosa ketma-ket buyurtma qilinsa, o'sha foydalanuvchining digest natijasi qayta ishlatiladi (1 soat, user + matn hash kaliti bilan; boshqa hisobga o'tmaydi). Har bir xizmat o'z birligini alohida sarflaydi.
- **Draft.** 1 birlik ≈ 5 standart sahifa / 20 000 chiqish belgisi (`draftUnits`). Hozirgi generatsiya 4 096 token bilan cheklangan va bu chegaradan oshmaydi. Uzun draft uchun alohida birlik — keyingi bosqich.

### Hujjat biriktirilgan chat (2026-10-05, review 2026-10-06)

Fayl biriktirilgani o'zi tahlil degani emas: xizmat amalda so'ralgan ishga qarab aniqlanadi (`src/rag/document-job.js`, `requestedServices`). Qoida veb, Workspace va Telegram'da bir xil.

| So'rov | Xizmat | Qaysi limitdan |
|---|---|---|
| Hujjat bo'yicha savol ("5-band qonuniymi?") | chat | 1 chat birligi |
| "Hujjatni tahlil qiling", "проанализируйте договор" | Hujjat tahlili | tahlil birligi |
| "Yuridik xulosa yozing", "юридическое заключение" | AI yuridik xulosa | **xulosa** birligi |
| "Tahlil qilib, yuridik xulosa tayyorlang" | ikkalasi | har biri o'z limitidan, alohida |

- **Tahlil / xulosa (veb).**
  - Birlik butun hujjatdan hisoblanadi.
  - Server avval 409 `DOC_COST_CONFIRM` qaytaradi, unda har bir xizmat uchun quote (`services`, `quotes`) bo'ladi. Dashboard har bir xizmat uchun alohida qator ko'rsatadi.
  - Tasdiq: `confirmedJob { analysis: n, opinion: n }`; bitta xizmat bo'lsa `confirmedUnits: n` ham bo'ladi. Boshqa xizmat uchun yoki boshqa son bilan berilgan tasdiq ishni boshlamaydi.
  - Ikkala xizmat AI boshlanishidan oldin **bitta tranzaksiyada** rezerv qilinadi (`ledger.reserveMany`). Biri sig'masa, hech biri rezerv qilinmaydi va AI ishga tushmaydi.
  - Har bir xizmat o'z bo'limi bo'yicha alohida hisoblanadi. Sarlavhalar qat'iy belgilangan: `## Hujjat tahlili`, `## Yuridik xulosa`. Yetkazilgan bo'lim commit qilinadi, yetkazilmagani release qilinadi (`settleSections`).
    - Tahlil yetkazilib, xulosa muvaffaqiyatsiz bo'lsa, tahlil baribir to'lanadi.
    - Javob AI'gacha xato bersa, ikkalasi ham qaytariladi.
    - Model sarlavhalarni qo'ymasa-yu, to'liq javob bersa, ikkalasi yetkazilgan deb hisoblanadi: format xatosi xizmatni bepul qilmaydi.
  - Release qilingan xizmatning provider sarfi usage ledger'da qoladi.
  - Chat birligi qo'shimcha olinmaydi.
  - "Tahlil qilib xulosa bering" — bu tahlilning xulosasi, ikkinchi xizmat emas. Xulosa xizmati faqat "yuridik/huquqiy xulosa" yoki "xulosa yozing/tayyorlang" deyilganda tanlanadi.
- **Hujjat bo'yicha savol: qaysi qismlar beriladi** (`selectExcerpt`). Hujjatning boshi kesib olinmaydi; ko'pi bilan 20 000 belgi.
  - hujjat boshidan kichik qism (sarlavha, tomonlar), ≤ 700 belgi;
  - savolga mos bandlar (kam uchraydigan so'zlar ko'proq og'irlikka ega; savolda nomi aytilgan band birinchi);
  - ular havola qilgan bandlar, ikki qadamgacha ("14.3 → 7.2"); bo'limga havola bo'lsa ("16-bo'lim"), uning kichik bandlari ham;
  - shu bandlarni nomlagan istisnolar ("14.3-band … qo'llanilmaydi") va istisno o'zi havola qilgan bo'lim;
  - ular ishlatgan atamalarning ta'riflari («Ish kuni» — …).
- **Parchalar yetarli bo'lmasa.** Mos band topilmasa yoki havola qilingan band hujjatda yo'q yoki sig'madi:
  - natija `insufficient` deb belgilanadi;
  - modelga "buni aniq ayting, qat'iy xulosa bermang, to'liq tahlilni taklif qiling" deyiladi;
  - foydalanuvchi ⚠ izoh ko'radi: qaysi band yetmadi va to'liq xizmat necha birlik;
  - mos band umuman topilmasa, model hujjatning birinchi sahifalarini emas, bandlar ro'yxatini oladi.
- **Workspace.**
  - Hujjat konteksti o'sha `selectExcerpt` bilan olinadi. Yetishmagan band blok ichida "Qat'iy xulosa bermang" deb yoziladi, shu qoida promptda ham bor.
  - Workspace'da to'liq tahlil va xulosa xizmati **yo'q**. Shunday so'rov yo'naltiriladi, agar u hujjat yoki yuridik xulosani nomlasa va Workspace'da hujjat bo'lsa (`createWorkspaceServiceRouting`). Bunda:
    - AI chaqirilmaydi va **kvota yechilmaydi**;
    - javob "bu tahlil ham, xulosa ham emas" deydi;
    - tugma AI bo'limidagi mavjud xizmatni ochadi.
  - Band bo'yicha savol yoki hujjatsiz huquqiy savol ("vaziyatni tahlil qiling") — oddiy javob, 1 chat birligi.
- **Telegram.** Fayllar AI'ga emas, yurist navbatiga tushadi (`src/bot/tariff-texts.js`). Foydalanuvchiga quyidagilar aytiladi:
  - bu AI tahlili emas va tahlil yoki xulosa limiti yechilmadi;
  - yurist ko'rigi tarif limitlariga kirmaydi, uning shartlari alohida kelishiladi (bepul deb va'da qilinmaydi);
  - AI tahlil va xulosa saytda bor (tugma bilan).

  Matn va ovozli savol esa chat.

## 4. OCR, ovoz

- **OCR — skan hujjat (2026-10-06).** Alohida va bepul xizmat emas: skan PDF yoki rasm hujjat tahlili, yuridik xulosa yoki chat ichida o'qiladi va shu xizmatning birligi bilan hisoblanadi.
  - **Sahifa chegarasi (bitta hujjat):** Sinov 10, pullik tariflar 30 sahifa (`PLAN_CATALOG[*].job.maxPages`). Oshsa, rad etiladi — hujjat qisqartirilmaydi.
  - **Avval narx, keyin OCR.** `POST /api/analyze/scan-quote` (AI chaqiruvi yo'q) sahifalarni serverda sanaydi (PDF — `pdf-parse`, rasm — sarlavha baytlari), shifrlangan, o'qilmaydigan, matnli PDF (≥ 200 belgi/sahifa — u OCR'siz `/api/analyze/extract` bilan o'qiladi) va chegaradan oshganini rad etadi va imzolangan chipta beradi. Chipta fayl xeshi (SHA-256), hisob, xizmat, sahifa, bayt va 15 daqiqalik muddatga bog'langan — boshqa fayl yoki hisob uchun ishlamaydi.
  - **Tasdiq va rezerv.** `POST /api/analyze/ocr-image` faqat `confirmed=true` bilan ishlaydi; faylni qayta xeshlaydi va sahifalarini qayta sanaydi; bepul kirish shartini (kanal, so'rovnoma) tekshiradi; xizmat birligini (tahlil yoki xulosa) **OCR'dan oldin** rezerv qiladi va 120 daqiqa ushlab turadi (`meta.holdUntil`, `scanHash`). Keyingi tahlil/xulosa so'rovi shu rezervni oladi (`adoptHeldScanJob`) — ikkinchi marta yechilmaydi. Mijoz yuborgan maqsad huquq dalili emas: huquq ledgerda tekshiriladi.
  - **Matn brauzerga berilmaydi.** Javob faqat `scanId` (sahifa, belgi soni). Matn `document_scans` da (hisob + fayl xeshi bo'yicha, 7 kun) saqlanadi va faqat xizmat endpointlari (`/api/analyze`, `/api/draft/explain-document`, `/api/draft/legal-opinion`, `/api/legal-chat`) uni `scanId` bo'yicha shu hisob uchun o'qiydi. Boshqa hisob hech qachon o'qiy olmaydi (404).
  - **Kesh.** Bitta hisob bir faylni qayta yuklasa, OCR qayta chaqirilmaydi — tahlil va xulosa bitta OCR'ni bo'lishadi, har biri o'z limitidan yechiladi.
  - **OCR'dan keyin matn kutilganidan uzun bo'lsa:** hech qachon kesilmaydi. Birliklar haqiqiy matn bilan qayta hisoblanadi: bitta ish chegarasidan katta bo'lsa — rad etiladi va rezerv qaytariladi; ko'proq birlik kerak bo'lsa — rezerv qaytariladi va qayta narx (`SCAN_RESIZE`) so'raladi, OCR qayta chaqirilmaydi (kesh). Ikkala holatda ham OCR'ning haqiqiy xarajati `llm_spend_log` da qoladi.
  - **OCR xatosi yoki matn chiqish chegarasiga yetsa** (`OCR_TRUNCATED`): rezerv qaytariladi, provayder xarajati ledgerda qoladi, kesilgan matn berilmaydi.
  - **Rasm:** JPEG/PNG/WebP, ≤ 10 MB, tomoni ≤ 4 096 piksel, ≤ 16 megapiksel — bitta sahifa. PDF ≤ 20 MB.
  - **Chatdagi skan (ichki chegara, sotiladigan xizmat emas):** savol — 1 chat birligi, OCR sahifalari esa davrning skan chegarasidan yechiladi: Sinov 10, Silver 80, Gold 240, Platinum 400 **sahifa** (oldin — so'rov soni, bu sotilgan "10 sahifa" qoidasiga mos emas edi). Chegara tugasa, OCR'dan oldin rad etiladi. Tahlil/xulosa ichidagi skan bu chegaradan yechilmaydi. Balans va `/api/tariff/me` da u xizmat sifatida emas, `scanLimits` sifatida ko'rsatiladi.
  - **Provayder (jimgina almashtirilmaydi):** rasm — default'da #411 dan oldingidek VoiceLab vision birinchi (vision lane yoqilgan bo'lsa), aks holda Gemini; `OCR_IMAGE_PROVIDER=gemini` bilan Gemini birinchi. Skan PDF — Gemini. Xatoda qolgan provayderlar sinaladi, `OCR_FALLBACK=off` bo'lmasa. Gemini: Developer API, thinking o'chiq (`thinkingBudget: 0`), chiqish sahifaga 1 536 token; kesilgan o'qish boshqa provayderga yuborilmaydi. Har bir chaqiruv `llm_spend_log` da o'z provayderi bilan — primary va fallback xarajati alohida.
  - **Narx:** Gemini sahifasi $0.010959 — konservativ yuqori budjet, kutilgan narx emas (`src/ocr/scan-limits.js`, hisobot §2a). VoiceLab va OpenAI vision sahifasi — noma'lum; Gemini budjeti ularga qo'llanmaydi. Sahifa yeta oladigan har bir provayder Gemini bo'lmasa, xarajat modeli OCR'ni noma'lum deb belgilaydi va chegirma taklifi yaratilmaydi.
  - **Parallel so'rovlar:** bir hisob bir fayl uchun bir vaqtda tahlil va xulosa (yoki chat) so'rasa, pullik OCR bir marta bajariladi (jarayon ichidagi single-flight; ilova bitta Node jarayoni). Har bir xizmat o'z rezervini saqlaydi; OCR'ni o'zi bajarmagan chat so'rovining sahifalari qaytariladi (`ocr_shared`).
  - **Eski (legacy_v1) obunalar:** sotib olingan shartlari o'zgarmaydi. Chatdagi skan ular uchun avvalgidek har bir fayl uchun 1 ta (kunlik OCR qoidasi), sahifa bo'yicha emas; tahlil/xulosa ichidagi skan v1 tahlil/xulosa qoidalari bilan. Yangi sahifa chegaralari (10/30) faqat bitta faylning hajmi uchun — v1 da ham chegarasiz fayl OCR'ga yuborilmaydi; bu yangi limit emas, xarajat xavfsizligi. Legacy davr tugagach, foydalanuvchi v2 qoidalariga o'tadi.
  - **Rollback:** `migrations/20261006_015_document_scans.sql` faqat yangi jadval qo'shadi; eski kod uni o'qimaydi. Down fayli (`migrations/down/…015…`) jadvalni o'chiradi (faqat OCR keshi yo'qoladi).
- **STT (ovozli savol).** Savol 1 chat birligi sifatida hisoblanadi. STT narxi ledgerda alohida (stage `stt`) o'lchanadi.
- **TTS.** `VOICELAB_TTS_VOICE_ID` bo'lmasa o'chiq.
- **Taklif.** O'lchangan STT/TTS narxi asosida alohida "ovoz paketi" (masalan, 60 daqiqa / 30 kun) yoki 1 ovozli javob = 2 chat birligi. Qaror haqiqiy sarf o'lchangandan keyin qabul qilinadi.

## 5. Migratsiya (`migrations/20261004_013_tariff_periods.sql`)

- **Yangi jadval va ustunlar.**
  - `tariff_periods` — huquqlar (trial, payment, admin, migration).
  - `tariff_usage` — yagona usage ledgeri, kengaytirildi: `service`, `status`, `period_id`, `subject`, `job_key` (unikal), `actor_id`, `workspace_id`, `channel`, `request_id` (AI ledgerdagi so'rov), `meta`, `finalized_at`, `release_reason`.
- **Ishlab turgan pullik obunalar** (Silver/Gold/Platinum, muddati tugamagan) `legacy_v1` davri sifatida ko'chiriladi. U sotib olingan shartlari bilan tugaguncha ishlaydi: cheksiz chat + kunlik fair-use, haftalik xulosa kreditlari va draftlar, kunlik OCR. Limit yashirincha kamaytirilmaydi.
  - Migratsiya idempotent: `payment_ref = migration:legacy_v1:<id>:<expiry>`.
  - Migratsiyadan keyin master qo'lda yozgan obuna ham birinchi o'qishda shu tarzda olinadi.
- **Eski bepul ("Bepul", muddatsiz), eski Sinov va muddati tugagan foydalanuvchilar** birinchi hisoblanadigan so'rov bilan yangi Sinovni bir marta oladi. Eski kunlik hisoblagichlar hisobga olinmaydi.
- **Telegram'ning kunlik bepul javoblari** bekor qilinadi. Telegram foydalanuvchisi (bog'lanmagan bo'lsa ham) bitta Sinov oladi.
- **Telegram Stars kreditlari** to'liq saqlanadi va tarif limiti tugagach ishlatiladi; alohida hisob, muddati tugamaydi.
- `admins.tariff_*` ustunlari joriy pullik davrga sinxron turadi (Workspace DB siyosatlari ularni o'qiydi).

- **Revenue ustunlari (2026-10-06):** `tariff_periods.paid_at` (naqd shu paytda, bir marta sanaladi), `superseded_at`, `carried_out_uzs` (upgrade'ga o'tgan qiymat — yangi davrning `credit_uzs` iga teng).

**Rollback — kod, ma'lumot emas.** To'liq tartib: [`docs/tariffs-v2-rollback.md`](tariffs-v2-rollback.md).
- Production'da oldingi reliz qayta deploy qilinadi va `scripts/rollback/tariffs-v2-to-v1.sql` ishga tushiriladi. Skript bajarilmagan v2 qatorlarini o'chirmaydi, alohida jadvalga ko'chiradi; v1 kodi ularni sarf deb sanamasligi uchun.
- Qaytishda `tariffs-v1-to-v2.sql` ishga tushiriladi.
- Eski kod yangi schema bilan ishlashi lokal tekshirilgan (`scripts/rollback/compat-check.sh`).
- `migrations/down/20261004_013_tariff_periods.down.sql` destruktiv. U faqat v2 ma'lumoti yo'q test bazasi uchun: takliflar yoki davrlar bo'lsa, ishlamaydi.
- Qisman o'chirish uchun `TARIFF_OFFERS=off` kaliti bor (individual chegirmalar). Tarif enforcement'i uchun ikkinchi parallel tizim (flag) ataylab yo'q: bunday tizim ikki xil hisob-kitobga olib kelardi.

## 6. Xarajat modeli

Rejalashtirish birliklari (egasi, 2026-10-04): kurs 12 000 so'm/$,
chat $0.025, tahlil $0.30/birlik, xulosa $0.30/birlik, draft $0.06.

- Bular provayderning tasdiqlangan narxlari emas, billing kafolati ham emas.
- Raqamlar `node scripts/tariff-scenarios.js` bilan koddan qayta chiqariladi.
- Moliyaviy hisobot: [`docs/finance/tariffs-v2-report.md`](finance/tariffs-v2-report.md).
- O'lchangan tannarx `GET /api/admin/tariff/economics` (`measured`) da ko'rinadi: yetkazilgan ish → AI ledgerdagi chaqiruvlari. known, estimated va unknown alohida; unknown hech qachon 0 emas.

## 7. Sozlamalar

| O'zgaruvchi | Ma'nosi |
|---|---|
| `TARIFF_RESERVATION_TTL_MIN` | Tashlab ketilgan rezerv necha daqiqadan keyin hisobdan chiqadi (30; 5–120). |
| `DOC_TICKET_SECRET` | Hujjat chiptasi HMAC kaliti (bo'lmasa `SESSION_SECRET` / `JWT_SECRET`). |
| `OCR_IMAGE_PROVIDER` | Rasm OCR'ining birinchi provayderi. Bo'sh (default) — VoiceLab vision lane yoqilgan bo'lsa VoiceLab, aks holda Gemini (#411 dan oldingidek); `gemini` — Gemini. |
| `OCR_FALLBACK` | Default yoqiq (#411 dan oldingidek): primary xatosida qolgan provayderlar sinaladi. `off` — fallback yo'q. Narxi noma'lum provayderga yeta oladigan har qanday yo'nalishda OCR narxi noma'lum va chegirma taklifi yaratilmaydi; Gemini-only = `OCR_IMAGE_PROVIDER=gemini` + `OCR_FALLBACK=off`. |
| `PAYMENTS_ENABLED` | Hali ham `false` (D-2). Yoqilsa ham pullik tarif to'lovsiz berilmaydi (501 `CHECKOUT_UNAVAILABLE`). |

`AGENT_FREE_AI_LIMIT` endi ishlatilmaydi.

## 9. Individual chegirma (Master)

Master aniq foydalanuvchiga aniq pullik tarif uchun bitta 30 kunlik davrga chegirmali taklif yaratadi. Dashboard → Boshqaruv → «Chegirmalar» bo'limi yoki `POST /api/admin/tariff/offers`.

**Taklif:**
- sabab va amal qilish muddati (1–30 kun) bilan, bir martalik;
- renewal'ga o'tmaydi; takroriy chegirma — yangi taklif.

**Narx chegarasi:**
- yakuniy narx ≥ konservativ xizmat xarajati / 0,80, 1 000 so'mga yuqoriga yaxlitlanadi;
- boshlang'ich minimal narxlar: Silver 150 000, Gold 450 000, Platinum 750 000 (taxminiy);
- chegaradan oshgan chegirma jimgina o'zgartirilmaydi: rad etiladi va eng katta ruxsat etilgan chegirma ko'rsatiladi.

**Ruxsat:** faqat Master — route (`requireMasterAdmin`) va bazadagi rol tekshiruvi.

**Aktivatsiya:**
- taklif obunani faollashtirmaydi;
- to'lov tasdiqlangach `POST /api/admin/tariff/grant { adminId, plan, paymentRef, offerId }`;
- narx serverdagi taklifdan olinadi;
- taklif boshqa user yoki tarifga qo'llanmaydi;
- parallel redeem — faqat bittasi o'tadi;
- takroriy `paymentRef` qayta kvota bermaydi.

**To'lovdan oldin:** `GET /api/admin/tariff/offers/:id/check[?provider=]` — muddat, joriy minimal narx, xarajat modeli va komissiya doirasi tekshiriladi.

**O'lchanmagan asos va komissiya doirasi (2026-10-06):**
- 150 / 450 / 750 ming minimal narxlar o'lchangan xarajatga emas, o'lchanmagan planlash budjetiga asoslangan. Admin ekranidagi har bir quote buni ko'rsatadi (`basisNote`, `costMeasured: false`).
- To'lov komissiyasi 0. Bu o'lchangan komissiya emas, **hisobning doirasi**: provayder ulanmagan, to'lov qo'lda (master grant) qabul qilinadi (`feeScope.providers = ['manual']`).
- Taklif o'zi hisoblangan model versiyasi va komissiya doirasini saqlaydi. Quyidagi holatlarda u aktivlashtirilmaydi:
  - boshqa provayder orqali to'lansa;
  - komissiya o'zgargan bo'lsa;
  - xarajat modeli versiyasi o'zgargan bo'lsa.

  Xato kodlari: `offer_fee_scope_changed`, `offer_cost_model_changed`. Taklif faol qoladi, Master uni qayta tekshirib, yangisini yaratadi. Qayta narxlash avtomatik qilinmaydi.
- Kalit: `TARIFF_OFFERS=off` yangi taklif va aktivatsiyani to'xtatadi. Sotib olingan davrlar o'zgarmaydi.

**Xarajat modeli:** `TARIFF_COST_MODEL` (JSON) bilan almashtiriladi. Har bir komponent `status` bilan beriladi (`estimated`, `unknown` + `reserveUzs` + `reserveBasis`). Zaxirasiz noma'lum komponent yangi takliflarni to'xtatadi.

Iqtisodiyot va audit: [`docs/finance/tariffs-v2-report.md`](finance/tariffs-v2-report.md) §5–6. Rollback: [`docs/tariffs-v2-rollback.md`](tariffs-v2-rollback.md).

## 10. Test entitlement (pilot, Master)

Pilot uchun test akkauntiga kvota tijoriy to'lov grant'i orqali berilmaydi. Buning uchun Master'ning alohida test huquqi bor.

| | |
|---|---|
| Berish | `POST /api/admin/tariff/test-entitlements { userId, reason, hours (≤ 168, 48 standart), plan (hujjat hajmi qoidasi), quotas, budgetUsd (5), unknownCallUsd (0.05), perRequestUsd }` |
| Ko'rish | `GET /api/admin/tariff/test-entitlements` — kvota sarfi va budjet holati (spent, held) |
| Tugatish | `POST /api/admin/tariff/test-entitlements/:userId/end` |

- **Ruxsat:** faqat Master — route va bazadagi rol tekshiruvi bilan.
- **Kimga:** faqat oddiy (role `user`) hisobga. Hisobda pullik davr ishlayotgan bo'lsa, berilmaydi.
- **Pul tomoni:** `tariff_periods.source = 'test'`. `price_uzs`, `payment_ref` va kredit yo'q — buni jadvaldagi CHECK taqiqlaydi. Tushum yo'q, `admins.tariff_*` o'zgarmaydi.
- **Audit:** kim berdi, sabab va vaqt `economics` ichida va `audit_log` da.
- **Bitta faol huquq.** Har bir hisobda bitta faol test huquqi bo'ladi (unikal indeks). Takroriy yoki parallel berish o'shani qaytaradi va kvotani ko'paytirmaydi.
- **Tugagach:** hisob avvalgidek qoladi — Sinov ishlatilmagan, tarif yozilmagan. Test davridagi sarf yozuvi esa saqlanadi.
- **Hisobotlarda alohida:**
  - `marginReport.totals.testEntitlements` — mijoz qatoriga, tannarxga va marjaga kirmaydi;
  - `GET /api/admin/tariff/economics` → `measuredTest` — mijozlarning birlik tannarxidan alohida.
- **Budjet** (`src/ai/test-budget.js`, `usage-ledger` `reserveCall`) — veb va bog'langan Telegram chati uchun bitta:
  - har so'rov birinchi AI chaqiruvidan oldin o'z so'rov limitini band qiladi (`test_budget_holds`);
  - so'rov ichida har bir provider chaqiruvi — retry va fallback ham — chaqiruvdan oldin o'zining **maksimal narxini** band qiladi (`model-pricing` `callCostBound`);
  - `strict` (standart): chegarasi isbotlanmagan chaqiruv rad etiladi;
  - `estimated`: bunday chaqiruv Master yozgan taxmin va uning asosi bilan ishlaydi, alohida risk sifatida yoziladi;
  - so'rov limiti — production'niki (`AI_REQUEST_MAX_COST_USD`). Faqat shu akkaunt uchun `perRequestUsd` bilan o'zgartiriladi; global limit o'zgarmaydi.
  - Bu **qat'iy dollar kafolati emas**: kafolat narx jadvalining to'g'riligi bilan cheklangan. Cheklovlar va pilot rejasi — moliyaviy hisobot §7.

## 8. Keyingi bosqichlar (alohida PR'lar, ushbu PR'da bajarilmagan)

1. **Workspace.**
   - Hozir bor: ish `actor_id`, `workspace_id` va to'lovchi = sessiyadagi a'zo bilan yoziladi.
   - Qolgan ishlar:
     - owner Platinum'i tugaganda read-only kirish (hozir 402);
     - `workspace_ai_runs` ga `payer_id` / `job_id`;
     - a'zo, fayl va storage sig'imi bo'yicha taklif;
     - Workspace HTTP authz testlari.
2. **RAG.**
   - Promptdagi 1 200 belgilik kesish (333-modda oxiri kesilishining ehtimoliy sababi).
   - Telegram yurist tasdiqlagan javoblarni ishlatmaydi (`hit.corrected_answer` o'qiladi, `searchKorpus` esa `answer` qaytaradi).
   - Faqat o'zgargan chunk'larni qayta embed qilish va atomar almashtirish.
   - Parallel ingest lock.
   - Korpus dolzarb bo'lganda har savolda lex.uz jonli qidiruvini qisqartirish.
3. **Yurist tasdiqlagan javoblar bazasi.** Holatlar, versiya, reviewer; exact → semantic shadow; stale.
4. **Benchmark to'plami.** Savollar, hujjatlar, reviewer varaqasi, sarf budjeti. Pullik jonli test faqat egasining tasdig'i bilan.
