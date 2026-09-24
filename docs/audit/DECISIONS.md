# Qarorlar jurnali

Audit davomida mustaqil qabul qilingan qarorlar va egasining qarorini
kutayotgan savollar. Format: **kontekst → qaror / tavsiya → sabab**.

## Qabul qilingan (audit tomonidan)

**D-0. Shriftlar.** Audit prompti dashboard uchun Inter / Source Serif 4 /
JetBrains Mono ni aytadi. `CLAUDE.md` va egasining #316 dagi qarori — butun
platformada yagona Space Grotesk. `CLAUDE.md` ustun, Space Grotesk qoladi.

**D-1. Backend PR'lar alohida va kichik.** Har bir Critical/High topilma
alohida `audit/<soha>-<tavsif>` branch'da, bitta test bilan. Sabab: egasi har
birini alohida tasdiqlaydi va kerak bo'lsa alohida qaytaradi.

**D-3. Master Platinum.** Master rolidagi admin tarif cheklovlarisiz ishlaydi
(mavjud xulq). O'zgartirilmadi.

**D-8. Embeddinglar VoiceLab'ga o'tkazilmaydi.** O'tkazish butun korpusni
qayta embed qilishni talab qiladi (`CLAUDE.md`). Provider abstraksiyasi
yozilganda ham embedding provayderi alohida qoladi.

**D-9. Test framework qo'shilmadi.** Mavjud uslub (oddiy node skriptlar,
`require.cache` stub, `vm` sandbox) saqlandi; yangi bog'liqlik kiritilmadi.

**D-10. Lint.** Loyihada linter yo'q (`CLAUDE.md`). PR'lar oldidan
`node --check` va testlar ishlatiladi; linter qo'shish CI bosqichida alohida
taklif sifatida ko'riladi.

## Egasining qarori kerak

**D-2. To'lov (C-MONEY-1).** To'lov provayderi ulanmagan. `PAYMENTS_ENABLED`
yoqilsa, foydalanuvchi pullik tarifni o'zi tanlab oladi. Tavsiya: provayder
(Click/Payme) ulanmaguncha `PAYMENTS_ENABLED` ni yoqmang; pullik tarif faqat
master tomonidan beriladi.

**D-4. Muddati tugagan tarif.** Hozir muddati o'tgan pullik tarif `no_plan`
bo'lib, foydalanuvchi butunlay bloklanadi. Tavsiya: avtomatik `bepul`ga
tushirish.

**D-5. Kvota fail-open.** DB xatosida kvota tekshiruvi o'tkazib yuboriladi
(foydalanuvchi uchun qulay, pul uchun xavfli). Tavsiya: chat uchun fail-open
qolsin, qimmat yo'llar (opinion, OCR, premium) uchun fail-closed.

**D-6. Qaytarish (refund).** AI xato bersa ham limit sarflanadi. Tavsiya:
javob muvaffaqiyatsiz bo'lsa usage yozuvini o'chirish.

**D-7. OCR va Workspace AI hisobi.** Hozir kvotasiz. Qaysi limitdan ayirish
kerak (kunlik chat yoki alohida)?

**D-11. Fair-use og'irliklari.** `ENDPOINT_WEIGHT_SQL`: eksport 0 (#320).
Boshqa og'irliklar egasi bilan kelishilishi kerak.

**D-12. Telegram iqtisodiyoti.** Telegram Stars env nomlari mos emas (M6),
eski subscription marshrutlari buzuq (M8). Qaysi biri kerak?

**D-13. Kirill yozuvi.** Foydalanuvchi matnlari o'zbek (lotin), rus, ingliz
tillarida bo'lishi kerak. O'zbek kirill qo'llab-quvvatlansinmi?

**D-14. Ma'lumotlarni lokalizatsiya qilish.** O'zbekiston qonunchiligi
(shaxsiy ma'lumotlar, O'RQ-547) fuqarolar ma'lumotini O'zbekistondagi
serverlarda saqlashni talab qiladi. Supabase va Render xorijda. Yuristga
murojaat tavsiya etiladi (6-bosqich).

**D-15. VoiceLab sinovi.** 1 oylik sinov davomida `VOICELAB_FALLBACK` yoqiq
qolsin; sifat `model-ab` bilan o'lchanib, natija METRICS'ga yoziladi.
