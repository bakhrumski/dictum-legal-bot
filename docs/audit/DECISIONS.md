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

## Egasi qaror qildi (2026-09-24)

**D-2. To'lov.** `PAYMENTS_ENABLED` yoqilmaydi. Pullik tarifni faqat master
beradi, to'lov provayderi ulanguncha shunday qoladi.

**D-4. Muddati tugagan tarif → Bepul.** Amalga oshirildi: #330. Bazaga
yozilmaydi, o'qishda hisoblanadi. Bepulning 30 kunlik "10/kun" davri muddat
tugagan kundan boshlanadi (audit tanlovi).

**D-5. Kvota fail-open/closed.** Chat fail-open; opinion, explain-document,
`/api/analyze`, enterprise fail-closed (503). Amalga oshirildi: #330.
`/api/draft/*` #320 merge bo'lgandan keyin qo'shiladi.

**D-6. Refund.** Xato bilan tugagan so'rov limitni qaytaradi va
foydalanuvchiga xabar beradi. Amalga oshirildi: #330. "Topilmadi" turidagi
javoblar uchun refund `isFailedAnswer` regex'i tuzatilgandan keyin.

**D-13. O'zbek kirill.** Ha, qo'llab-quvvatlanadi. Foydalanuvchi matnlari:
o'zbek (lotin), o'zbek (kirill), rus, ingliz. Eslatma: Space Grotesk'da
kirill yo'q, kirill matn tizim shriftiga tushadi (CLAUDE.md).

**D-14. Ma'lumotlarni lokalizatsiya qilish.** Hozircha kerak emas, egasi
o'zi aytadi. Kod o'zgarmaydi.

**D-15. VoiceLab sinovi.** Tasdiqlandi: 1 oy davomida
`VOICELAB_FALLBACK` yoqiq, sifat `model-ab` bilan o'lchanib METRICS'ga
yoziladi.

## Audit tavsiyasi — egasi tasdiqladi va amalga oshirildi (2026-09-24)

D-7: #332. D-11: #331. D-12: #333 (1 va 2-band; 3-band — bog'langan pullik
veb tarif botda — ixtiyoriy, alohida ish sifatida backlog'da).

**D-7. OCR va Workspace AI hisobi.**
- *OCR* (`/api/analyze/ocr-image`) — bu chat yoki tahlildan oldingi qadam,
  keyingi so'rov baribir hisoblanadi. Uni kunlik chat limitidan ayirish
  foydalanuvchini ikki marta to'lashga majbur qiladi. Tavsiya: alohida
  kunlik sahifa limiti (bepul 3, sinov 5, silver 20, gold 50, platinum 100),
  fair-use og'irligi 0, fail-closed, xatoda refund.
- *Workspace AI* (`/workspaces/:id/assistant/ask`) — Platinum imkoniyati.
  Tavsiya: har bir savol so'ragan a'zoning **o'z** fair-use limitidan 1
  birlik (avval M4 tuzatiladi: a'zo egasining tarifini meros qilmasin),
  chat kabi fail-open, xatoda refund.

**D-11. Fair-use og'irliklari.** Qiymatlarni biznes egasi (siz) tasdiqlaydi;
kodda ular bitta joyda — `ENDPOINT_WEIGHT_SQL`
(`src/rag/subscription-tiers.js`). Tavsiya:
| Yo'l | Hozir | Tavsiya | Sabab |
|------|-------|---------|-------|
| chat, enterprise-chat | 1 | 1 | asosiy birlik |
| `/api/draft/export*` | 7 | 0 (#320) | AI chaqirilmaydi |
| `/api/draft/ai-generate`, templates import/analyze | 7 | 0 | haftalik draft limiti bor, ikki marta cheklanmasin |
| `/api/draft/legal-opinion` | 7 | 0 | haftalik kredit bor |
| `/api/draft/explain-document`, `/api/analyze` | 1 | 3 | 120k belgigacha matn, qimmat |
| OCR | — | 0 | D-7 dagi alohida limit |
Natija: Silver 22, Gold 50, Platinum 125 draft/hafta va'dasi haqiqatda
bajariladigan bo'ladi (hozir ~7/14/35).

**D-12. Telegram iqtisodiyoti.** Tavsiya:
1. *Telegram Stars qoladi* — race-safe ishlaydi, dublikat to'lovdan himoyalangan.
   M6 tuzatiladi: invoice yaratilganda narx va kreditlar payload'ga yoziladi,
   to'lovda env emas, payload bajariladi; kredit berib bo'lmasa
   `refundStarPayment` bilan pul qaytariladi.
2. *Eski `/api/subscription/*` marshrutlari o'chiriladi* — frontend ularni
   ishlatmaydi, `set-tier` 500 beradi, `tiers` bo'sh qaytaradi (M8).
3. *Keyingi qadam (ixtiyoriy):* Telegram'i bog'langan pullik veb tarif
   egalari botda ham o'z tarifidan foydalansin (hozir Platinum ham botda
   3/kun oladi).
