# Egasining tasdig'ini kutayotgan PR'lar

`CLAUDE.md` qoidasi: `public/**`dan tashqaridagi hamma o'zgarish (backend, to'lov,
tarif, auth, baza, sozlamalar, testlar, hujjatlar) PR sifatida ochiladi va
**egasi tasdiqlamaguncha merge qilinmaydi**. `main` to'g'ridan-to'g'ri
production'ga chiqadi.

Tavsiya etilgan merge tartibi pastda. Har bir PR alohida branch'da, `main`dan
olingan; ular bir-biriga bog'liq emas, faqat #325 #326 bilan birga yoki undan
keyin kirishi kerak.

| # | Soha | Nima qiladi | Xavf | Merge'dan oldin/keyin egasi nima qiladi |
|---|------|-------------|------|------------------------------------------|
| [#326](https://github.com/bakhrumski/dictum-legal-bot/pull/326) | security | **CRITICAL.** Oddiy `user` akkaunti barcha murojaatlarni, Excel eksportni, xodimlar chatini ko'ra olardi va korpusga "tasdiqlangan" javob yoza olardi. Endi rol bo'yicha cheklangan. | O'rta: yurist/talaba endi faqat o'ziga tayinlangan murojaat tafsilotini ochadi (ro'yxat allaqachon shunday edi). | Merge'dan keyin yurist akkaunti bilan murojaat ochib ko'ring. |
| [#322](https://github.com/bakhrumski/dictum-legal-bot/pull/322) | security | **CRITICAL.** Har boot'da `masteradmin` / `juristAI` (ochiq e'lon qilingan parol) master yaratilardi. Endi yaratilmaydi; e'lon qilingan parollar bilan kirish `403 PASSWORD_MUST_CHANGE`. | O'rta: agar kimdir hali shu parol bilan kirsa, bloklanadi. | **Merge'dan oldin**: master akkauntingiz parolini o'zgartiring (`masteradmin` id 89 ni ham). |
| [#321](https://github.com/bakhrumski/dictum-legal-bot/pull/321) | security | **CRITICAL.** Telegram webhook yo'li Express 5'da wildcard bo'lib qolgan edi — soxta update (shu jumladan to'lov) yuborish mumkin edi. Endi HMAC yo'l + `secret_token` sarlavhasi; token loglarga yozilmaydi. | O'rta: boot paytida `setWebHook` yangi URL bilan qayta chaqiriladi. | Merge'dan keyin botga bitta xabar yuborib tekshiring. Ixtiyoriy: `TELEGRAM_WEBHOOK_SECRET` ni Render'da o'rnating. |
| [#320](https://github.com/bakhrumski/dictum-legal-bot/pull/320) | money | Haftalik hujjat (draft) limiti umuman ishlamasdi; eksport AI-draft sifatida sanalardi. | Past. | — |
| [#319](https://github.com/bakhrumski/dictum-legal-bot/pull/319) | money | Haftalik limit dushanba o'rniga seshanba yangilanardi (Toshkent vaqti). | Past. | — |
| [#325](https://github.com/bakhrumski/dictum-legal-bot/pull/325) | rag | Yurist tasdiqlagan yangi javoblar embedding olmasdi (aniqlanmagan funksiya). | Past, lekin #326 siz korpusga har kim yoza oladi. | #326 bilan birga yoki keyin. |
| [#324](https://github.com/bakhrumski/dictum-legal-bot/pull/324) | rag | Kuchini yo'qotgan qonunlarni belgilash skripti noto'g'ri maydonni o'qigani uchun hech narsani belgilamasdi. | Past (qo'lda ishga tushiriladigan skript). | — |
| [#330](https://github.com/bakhrumski/dictum-legal-bot/pull/330) | money | D-4/D-5/D-6: muddati o'tgan tarif → bepul; xatoda limit qaytariladi va xabar beriladi; qimmat yo'llar fail-closed. | O'rta: tarif xulqi o'zgaradi (sizning qaroringiz). | Merge'dan keyin muddati o'tgan test akkaunt bilan tekshiring. |
| [#323](https://github.com/bakhrumski/dictum-legal-bot/pull/323) | security | `/api/health` faqat liveness (DB `SELECT 1`, 3 s); korpus tafsilotlari `/api/admin/health` (master). | Past. Render health check yo'li o'zgarmaydi. | — |

Tavsiya etilgan tartib: #326 → #322 (parol o'zgartirilgandan keyin) → #321 → #325 → #320 → #319 → #330 → #324 → #323.

Ushbu hujjatlar PR'i (`audit/docs-audit-baseline`) ham faqat hujjat — tasdiq kerak.
