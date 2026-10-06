# Tariflar v2: production rollback (2026-10-06)

Qisqasi: **production'da rollback — bu kodni qaytarish, ma'lumotni emas.**
Takliflar (`tariff_offers`) yoki obuna davrlari (`tariff_periods`) yozila
boshlagach, jadvallarni o'chirish rollback emas: bu mijozlar to'lagan
davrlarni va har bir chegirmaning auditini yo'q qiladi.
`migrations/down/20261004_013_tariff_periods.down.sql` faqat **v2
ma'lumotlari yo'q test bazasi** uchun; jadvallarning birortasida qator bo'lsa,
u ishlashdan bosh tortadi.

## 1. Bosqichlar (eng yengilidan)

| Muammo | Nima qilinadi | Ma'lumot |
|---|---|---|
| Faqat individual chegirmalar | Render env: `TARIFF_OFFERS=off`. Yangi taklif yaratilmaydi va aktivatsiya qilinmaydi; chegirmasiz grant ishlaydi | O'zgarmaydi; sotib olingan davrlar joyida |
| Narx modeli shubhali | `TARIFF_COST_MODEL` ni o'zgartirish. Eski takliflar yangi model yoki komissiya bilan avtomatik qo'llanmaydi (`offer_cost_model_changed`, `offer_fee_scope_changed`) | O'zgarmaydi |
| VoiceLab / provayder | Env (`LLM_PROVIDER`, `VOICELAB_*`), deploy'siz | — |
| Tariflar v2 butunlay | **Kod rollback** (2-bo'lim) | Saqlanadi |

## 2. Kod rollback (ma'lumot saqlanadi)

1. Render: oldingi relizni (v2'dan oldingi `main` commit, hozir `a3b858b`)
   qayta deploy qilish. Schema o'zgarmaydi: 013 qo'shgan jadval va ustunlar
   joyida qoladi, eski kod ularni o'qimaydi.
2. Deploy tugagach, production bazasida bir marta:
   `psql "$DATABASE_URL" -f scripts/rollback/tariffs-v2-to-v1.sql`

   Sababi: eski kod `tariff_usage` dagi hisobning **har bir** qatorini
   ishlatilgan deb sanaydi. v2 da bajarilmagan ishlar (`released` — limiti
   qaytarilgan, `reserved` — davom etayotgan) ham qator bo'lib turadi.
   Skript ularni o'chirmaydi: `tariff_usage_v2_hold` jadvaliga ko'chiradi.
   Skript idempotent.
3. Tekshirish: `GET /api/health`, bitta oddiy hisob bilan chat.

Rollback davrida nimalar bo'ladi (tekshirilgan, 4-bo'lim):
- v2 da sotilgan davrlar eski kodda ham amal qiladi: v2 `admins.tariff_*`
  ustunlarini sinxron yuritgan. Eski kod ularga **v1 qoidalarini** qo'llaydi
  (masalan, Silver'da cheksiz chat va fair-use). Bu mijoz uchun kamaytirish
  emas, ko'paytirish.
- Sinov (v2 trial) faqat `tariff_periods` da turadi. Eski kod uni ko'rmaydi
  va foydalanuvchiga v1 dagi tarifini qo'llaydi.
- Takliflar va narx/kredit ustunlari o'zgarmaydi. Eski kodda chegirma
  ekrani yo'q.
- Test huquqi (`source = 'test'`) va `test_budget_holds` ni eski kod
  o'qimaydi. Pilot akkaunti eski kodda oddiy hisob bo'ladi: test kvotasi
  ham, $5 budjet ham yo'q. Shuning uchun rollback oldidan pilot to'xtatiladi.

## 3. Qayta oldinga (roll-forward)

1. v2 relizini qayta deploy qilish. Migratsiya 013 allaqachon qo'llangan,
   checksum bir xil bo'lgani uchun qayta qo'llanmaydi.
2. `psql "$DATABASE_URL" -f scripts/rollback/tariffs-v1-to-v2.sql` —
   ushlab turilgan qatorlarni qaytaradi. Rollback paytida davom etayotgan
   rezerv v2 tomonidan yetkazilmagan, shuning uchun u `released`
   (`code_rollback`) bo'lib qaytadi va birligi mijozga qaytadi. Bo'sh qolgan
   `tariff_usage_v2_hold` jadvalini inson o'chiradi.
3. Rollback davridagi oqibatlar:
   - Eski kod yozgan qatorlarda `service` ham, `status` ham yo'q. v2 ularni
     davr limitiga qo'shmaydi, ya'ni o'sha davrdagi ish mijoz foydasiga
     hisoblanmaydi.
   - Eski admin ekranida berilgan tarif `tariff_periods` da yo'q. Uni v2
     birinchi murojaatda `adoptUnrecordedPlan` bilan "narxi qayd
     etilmagan" eski grant sifatida oladi: tushum noma'lum bo'ladi, 0 emas.

## 4. Tekshiruv: eski kod yangi schema bilan

`scripts/rollback/compat-check.sh` (bo'sh, tashlab yuboriladigan Postgres +
pgvector bazasida) 2026-10-06 da lokal ishga tushirildi va test huquqi
qo'shilgandan keyin yana takrorlandi. Ikkala safar natija: `compat check OK`.

1. **Yangi kod ko'tarildi.** Barcha migratsiyalar, jumladan 013, qo'llandi;
   boot smoke 41/41.
2. **Yangi kod v2 ma'lumotlarini yozdi:**
   - chegirmali Silver;
   - Silver → Gold upgrade;
   - 2 ta committed, 1 ta released va 1 ta reserved qator.
3. **Eski kod (`a3b858b`) shu bazada ko'tarildi.** Migratsiyalar o'tkazib
   yuborildi (`013` yozuviga e'tibor bermaydi); boot smoke va anonim kirish
   matritsasi 41/41.
4. **Eski kod ishladi:** v2 sotgan Silver va Gold'ni faol deb ko'rdi,
   `checkQuota` ruxsat berdi, `recordUsage` yangi schema'ga qator yozdi.
   **Topilma:** prep skriptidan oldin u xaridorning ishini 4 deb sanadi,
   holbuki yetkazilgani 2 ta.
5. **`tariffs-v2-to-v1.sql`:** 2 ta qator ushlab turildi; skript ikki marta
   ishlatildi, natija bir xil.
6. **Prep skriptidan keyin** eski kod yetkazilgan 2 ta v2 ishini va o'zi
   yozgan qatorni sanadi. Qaytarilgan va tugallanmagan ishlar sanalmadi.
7. **`tariffs-v1-to-v2.sql`:** 0 ta qator ushlab turilgan qoldi;
   rezerv `released` bo'lib qaytdi.
8. **Yangi kod qayta ko'tarildi:** boot smoke OK.
9. **Yangi kod ikkala kod yozgan ma'lumotni o'qidi:**
   - chat sarfi 2;
   - upgrade qilgan mijozdan naqd 666 000 bir marta sanaldi, 132 000 kredit
     naqd deb sanalmadi;
   - tan olingan daromad + kechiktirilgan daromad = naqd.

Destruktiv down-migratsiya ham tekshirildi:
- ma'lumot bor bazada `tariff_offers has rows` xatosi bilan rad etdi va
  hech narsa o'chmadi;
- bo'sh test bazasida ikkala jadvalni o'chirdi.

Tekshirilmagan: haqiqiy Render muhitida rollback. Supabase ustidagi
production bazasida ham ishga tushirilmadi — production'ga yozish ruxsati
yo'q.

## 5. Merge/deploy'dan keyingi qisqa tekshiruv

1. **Deploy holati.** Render'da deploy tugadi va jonli commit SHA PR'nikiga teng. Logda `[MIGRATIONS] Applied 20261004_013_tariff_periods.sql` bor va `BOOT` xatosi yo'q.
2. **Sog'liq.** `GET /api/health` → `db: ok`.
3. **Master:**
   - `GET /api/admin/tariff/economics` — `measured` va `measuredTest` qaytadi;
   - `GET /api/admin/margin-report` — `refundsStatus: not_tracked`, `testEntitlements` maydoni bor;
   - `GET /api/admin/tariff/offers` — bo'sh ro'yxat, xato yo'q.
4. **Legacy obuna.** Ishlab turgan v1 obunasi bor bitta mijozda `/api/tariff/me` → `legacy_v1`, limit kamaymagan.
5. **Oddiy hisob (Sinov):**
   - bitta savol — 1 chat yechiladi;
   - hujjat + "tahlil qiling" — 409 tasdiq kartasi chiqadi, chat yechilmaydi.
6. **Telegram:**
   - matnli savolga javob keladi;
   - fayl yuborilsa, "AI tahlili emas, yurist navbati" xabari va sayt tugmasi chiqadi.
7. **Workspace (Platinum):** "shartnomani tahlil qiling" — yo'naltirish chiqadi, limit yechilmaydi; band bo'yicha savolga javob keladi.
8. **Muammo bo'lsa:** chegirmalar uchun `TARIFF_OFFERS=off`; butunlay — 2-bo'limdagi kod rollback.
