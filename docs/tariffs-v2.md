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

### Hujjat biriktirilgan chat (2026-10-05)

Fayl biriktirilgani o'zi tahlil degani emas: xizmat amalda so'ralgan ishga qarab aniqlanadi (`src/rag/document-job.js`). Qoida veb, Workspace va Telegram'da bir xil.

- **Hujjat bo'yicha savol** ("5-band qonuniymi?") = 1 chat birligi.
  - Modelga hujjatning savolga oid parchalari beriladi: sarlavha qismi va savol so'zlari bo'yicha tanlangan bandlar, ko'pi bilan 20 000 belgi (yarim tahlil birligi).
  - Modelga "bu to'liq tahlil emas" deyiladi.
  - Javob ostida qancha qism ishlatilgani va to'liq tahlil alohida xizmat ekani ko'rsatiladi.
  - Ilgari hujjatning birinchi 15 000 belgisi jimgina 1 chat birligiga berilardi.
- **Tahlil, tekshiruv yoki xulosa so'ralsa** ("hujjatni tahlil qiling", "проанализируйте договор") — bu hujjat ishi:
  - butun hujjatdan birlik hisoblanadi;
  - server avval 409 `DOC_COST_CONFIRM` va quote qaytaradi, dashboard tasdiq kartasini ko'rsatadi;
  - tasdiqlangach (`confirmedUnits`) **faqat** tahlil birliklari yechiladi — chat birligi qo'shimcha olinmaydi.
- **Workspace.** Hujjat konteksti xuddi shu 20 000 belgilik chegarada, parchalar bilan. To'liq tahlil so'ralsa, javob parchalarga asoslanganini aytadi va «Hujjat tahlili» xizmatiga yo'naltiradi.
- **Telegram.** Fayllar AI'ga emas, yurist navbatiga tushadi; matn va ovozli savol esa chat.

## 4. OCR, ovoz

- **OCR.** Cheksiz emas: davr uchun har bir tahlil birligiga 10 sahifa (Sinov 10, Silver 80, Gold 240, Platinum 400). Bitta so'rov — bitta sahifa/rasm. Narxi `llm_spend_log` da alohida o'lchanadi (stage `ocr`).
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

**Rollback.**
1. PR revert qilinadi.
2. `migrations/down/20261004_013_tariff_periods.down.sql` bajariladi.
3. `schema_migrations` dan yozuv o'chiriladi.

Natija:
- v1 kodi `admins.tariff_*` va `tariff_usage` (admin_id, ts) bilan ishlashda davom etadi.
- `released` qatorlar v1'da o'chirilgan qator kabi emas, ishlatilgan bo'lib ko'rinadi. Shuning uchun rollback faqat shoshilinch holat uchun.

**Feature flag yo'q, ataylab.** Ikkita parallel enforcement tizimi — topshiriq taqiqlagan "parallel hisob-kitob". Bosqichli joriy etish bayroqlari tasdiqlangan javoblar (exact → semantic shadow) uchun keyingi bosqichda qo'shiladi.

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

**To'lovdan oldin:** `GET /api/admin/tariff/offers/:id/check` — muddat va joriy minimal narx tekshiriladi.

**Xarajat modeli:** `TARIFF_COST_MODEL` (JSON) bilan almashtiriladi. Har bir komponent `status` bilan beriladi (`estimated`, `unknown` + `reserveUzs` + `reserveBasis`). Zaxirasiz noma'lum komponent yangi takliflarni to'xtatadi.

Iqtisodiyot va audit: [`docs/finance/tariffs-v2-report.md`](finance/tariffs-v2-report.md) §5–6.

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
