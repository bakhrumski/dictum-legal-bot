# Hujjat muharriri — platformaning o'zida Word kabi (dizayn, qoralama)

Holati: **qoralama** — kod 9-bo'limdagi savollarga javobdan keyin boshlanadi.

Egasi (2026-10-30, skrinshot: Word'ga o'xshash sahifa, yuqorida asboblar
paneli, o'ngda izohlar): hujjat loyihasi platformaning o'zida Word kabi
ochiladi va shu joyda tahrirlanadi; jamoadosh qo'shilsa, bir hujjat ustida
birga ishlanadi va o'zgarishlar unga ham darhol ko'rinadi; PDF va Word
qilib yuklab olinadi; hujjat yonida AI tahlil paneli bo'ladi; yuklangan
hujjat ham xuddi shunday ochiladi; AI tahlil bilan birga texnik va imlo
xatolarini tuzatish ham bo'ladi.

## 0. Kim nimadan yutadi (asosiy qoida, CLAUDE.md)

| Kim | Hozir | Muharrir bilan |
|---|---|---|
| Yurist / firma | AI loyihani .docx qilib yuklaydi → Word'da ochadi → tahrirlaydi → hamkasbiga e-mail/Telegram'da yuboradi → u izoh yozib qaytaradi → kim qaysi nusxada ishlayotgani chalkashadi | Loyiha shu yerda ochiladi, ikkalasi bitta nusxada ishlaydi, izohlar hujjat yonida; yuklab olish faqat oxirida |
| Mijoz | Yuristdan fayl kutadi, savolini alohida yozadi | Unga havola beriladi — o'qiydi, kerakli joyga izoh qoldiradi (tahrir huquqisiz) |
| Har kim | Tahlil natijasi hujjatdan alohida sahifada; qaysi band haqida ekanini o'zi qidiradi | Tahlil paneli hujjat yonida, topilgan band bosilsa hujjatda o'sha joy belgilanadi; taklif qilingan matn bir bosishda kiritiladi (o'zgarish sifatida) |
| Har kim | Imlo va texnik xatolarni ko'z bilan qidiradi (ikki alifbo aralash so'z, bo'sh joylar, raqamlash uzilishi, summa raqam va so'zda farq) | Muharrir ularni belgilaydi; har birini bitta bosishda tuzatish |

Oxirgi qatorda sinab ko'riladigan foyda: **"hujjat bir nechta odam o'rtasida
borib-kelishi" yo'qoladi.** Agar egasi mijozlar buni Word'da qilishni afzal
ko'radi deb hisoblasa, D3 (birgalikda tahrir) keyinga suriladi — 9-savol.

## 1. Hozirgi holat (kod bo'yicha)

| Narsa | Bor | Fayl |
|---|---|---|
| AI loyiha (hujjat tayyorlash, da'vo arizasi) | HTML natija, Word'ga eksport (haqiqiy .docx) | `src/drafting/html-to-docx.js`, `public/app/views.js` |
| Yuklangan hujjat matni | Word (mammoth + jadval o'quvchi), matnli PDF, skan (OCR) → matn; "Hujjatlarim" kutubxonasi; matn shifrlangan | `src/ocr/docx-text.js`, `src/ocr/scan-store.js` |
| Hujjat tahlili | Xavfli / yetishmayotgan bandlar, muvofiqlik; birlik bilan, narx tasdig'i bilan | `/api/analyze/*`, `public/app/views.js` |
| Playbook tekshiruvi | Band bo'yicha mos/farq/yo'q, taklif matni; Word panelida izoh + Track Changes | `src/agents/workflows/playbook-review.js`, `public/word/taskpane.js` |
| Workspace hujjatlari | `workspace_documents` + versiyalar (matn/JSON, shifrlangan) + fayllar; a'zolar va rollar; Supabase realtime **signal** (sahifa API'dan qayta o'qiydi) | `migrations/…001_workspace_core.sql`, `src/workspace/` |
| Matn muharriri | **Yo'q.** Ilovada hujjatni joyida tahrirlash, birgalikda tahrir, izoh yo'q | — |

Ya'ni: import, eksport, tahlil, shifrlash, a'zolik — bor. Yetishmayotgani:
**muharrir**, **real vaqtda birgalikda ishlash**, **hujjatga bog'langan
izohlar va takliflar**.

## 2. Asosiy qoidalar

1. **Hujjat bitta, nusxa bitta.** Har bir saqlanish — versiya; istalgan
   versiyaga qaytish mumkin. Yuklab olingan fayl — faqat nusxa.
2. **Matn shifrlangan holda saqlanadi** (E1: `sealBytes`), faqat a'zolar
   ochadi; xodim boshqa odamning hujjatini ochsa — kirish jurnali (E6b).
3. **AI hech narsani o'zi o'zgartirmaydi.** AI tahlil va tuzatishlar —
   **taklif**: hujjatda belgilanadi, odam qabul qiladi yoki rad etadi. Pulli
   amal (tahlil) avvalgidek narxi ko'rsatilib, tasdiq bilan.
4. **Import halol**: Word'dan nima to'liq o'tmasa (sarlavha/pastki
   kolontitul, izohlar, Track Changes, murakkab jadval), hujjat ochilganda
   aytiladi; asl fayl saqlanadi va yuklab olinadi.
5. **Yangi alifbo**: matn odam yozganidek saqlanadi (eski ham, yangi ham,
   kirill ham); tekshiruvlar va AI uchun ichkarida eski yozuvga o'tkaziladi.

## 3. Nima ko'rinadi

```
┌ Sarlavha · saqlandi ✓ · [Ulashish] [Yuklab olish ▾ Word | PDF]            ┐
│ Asboblar: shrift, o'lcham, B I U S, rang, belgilash, tekislash, ro'yxat,   │
│           jadval, ↶ ↷, sahifa N / M                                        │
├──────────────────────────── A4 sahifa ───────────────┬── Yon panel ────────┤
│                                                      │ [Izohlar] [AI tahlil]│
│   hujjat matni (sahifalarga bo'lingan ko'rinish)     │ [Tekshiruv]          │
│   boshqa odam kursori: rangli, ismi bilan            │ izoh kartalari /     │
│                                                      │ tahlil bandlari /    │
│                                                      │ topilgan xatolar     │
└──────────────────────────────────────────────────────┴──────────────────────┘
```

- **Izohlar** — matndan bir qism belgilanib yoziladi; javob, "hal qilindi",
  @eslatma (jamoadoshga Telegram orqali xabar — mavjud bildirishnoma yo'li).
- **AI tahlil** — mavjud tahlil (birlik, narx tasdig'i). Natijada har band
  hujjatdagi so'zma-so'z topilgan joyga bog'lanadi (topilmasa — "joyi
  topilmadi", taxmin qilinmaydi); "taklif matnini kiritish" — o'zgarish
  sifatida.
- **Tekshiruv** (texnik va imlo) — 6-bo'lim.
- Telefon kengligida yon panel pastdan ochiladigan varaq bo'ladi.

## 4. Texnik yechim (taklif)

| Qism | Taklif | Nega |
|---|---|---|
| Muharrir | ProseMirror asosidagi TipTap (MIT) | Word'ga yaqin tuzilma (sarlavha, ro'yxat, jadval), izoh va "taklif" belgilari, kirill va yangi alifbo bilan muammosiz |
| Birgalikda tahrir | Yjs (MIT, CRDT) + o'z serverimizdagi WebSocket (`ws` paketi) | Ikki kishi bir vaqtda yozsa ham yo'qotish yo'q; matn uchinchi tomondan (Supabase) o'tmaydi; bitta Node jarayonida ishlaydi |
| Paketlash | Muharrir kodi bir marta yig'ilib `public/vendor/editor/` ga qo'yiladi (versiya va litsenziya bilan) | Ilovada bundler yo'q; CDN'ga bog'liqlik bo'lmasin |
| Saqlash | Yangi jadvallar: hujjat, a'zolar (egasi / tahrirlovchi / izohlovchi / o'quvchi), Yjs holati (shifrlangan bayt), nomlangan versiyalar, izohlar (matnli, shifrlangan) | Workspace hujjatlaridan alohida — shaxsiy hujjat ham bo'ladi; Workspace'ga bog'lash ixtiyoriy |
| Import | Word → mavjud o'quvchi (mammoth + jadvallar) → muharrir; matnli PDF va skan → matn (sahifa ko'rinishi saqlanmaydi, aytiladi) | Mavjud, sinalgan kod |
| Word eksport | Mavjud `html-to-docx.js` (+ izohlarni Word izohi qilib qo'shish — D2) | Allaqachon haqiqiy .docx beradi |
| PDF eksport | 1-bosqich: brauzerning "PDF qilib saqlash" (A4 chop etish uslubi bilan) | Serverda Chrome yo'q, Render 512 MB; xarajat nol. Serverda PDF kerak bo'lsa — keyin, alohida |

## 5. Ma'lumotlar (taklif)

- `doc_editor_documents`: id, egasi, sarlavha, manba (AI loyiha / yuklangan /
  bo'sh), bog'langan ish yoki Workspace (ixtiyoriy), holat, vaqtlar.
- `doc_editor_members`: hujjat, akkaunt, rol; taklif havolasi (bir martalik,
  muddatli, faqat sha256 saqlanadi — agent taklifi kabi).
- `doc_editor_state`: Yjs holati (`sealBytes`, AAD hujjat id bilan) + har
  N daqiqada / oxirgi odam chiqqanda siqilgan holat.
- `doc_editor_versions`: nomlangan nusxalar (kim, qachon, izoh).
- `doc_editor_comments`: band joyi (Yjs nisbiy pozitsiya), muallif, matn
  (shifrlangan), javoblar, holat.
- Akkaunt o'chirilganda: egasining hujjatlari o'chadi; boshqaning hujjatidagi
  izohlari "o'chirilgan foydalanuvchi" bo'lib qoladi (9-savol).

## 6. Texnik va imlo tekshiruvi

**A. AI'siz qoidalar (bepul, darhol):** so'z ichida lotin va kirill
aralashgan (masalan "Аlоqabank" ichida lotin "o"); eski va yangi alifbo
aralash; ikki bo'sh joy, tinish belgisidan oldin bo'sh joy; qo'shtirnoq va
qavs juftsiz; raqamlash uzilishi (1, 2, 4); bir so'z ketma-ket takror; sana
formati bir xil emas; summa raqamda va so'zda farq qiladi ("5 000 000 (besh
yuz ming)"); ta'riflangan atama ("Ijarachi") keyin boshqacha yozilgan.
Har biri — belgilanadi, "Tuzatish" bitta bosishda.

**B. AI bilan imlo va uslub (ixtiyoriy):** paragraflar bo'yicha arzon model
(mavjud `callCheapAI`, ledger va bound bilan), faqat **taklif**: o'zgargan
so'zlar ko'rsatiladi, qabul / rad. Raqam, sana, modda, akt kodi, ism-sharif
**hech qachon** o'zgartirilmaydi (o'zgartirgan taklif mexanik tarzda rad
etiladi). Narxi — 9-savol.

O'zbek tili uchun tayyor ochiq imlo lug'ati yo'qligini aytib qo'yaman:
brauzerning imlo tekshiruvi o'zbekchani bilmaydi. Shuning uchun A doim
ishlaydi, B esa AI'ga tayanadi.

## 7. PR tartibi

| PR | Nima | Kim yutadi | Tegadi |
|---|---|---|---|
| D1 | Muharrir bir kishi uchun: AI loyiha yoki yuklangan Word/PDF "Muharrirda ochish", A4 ko'rinish, asboblar, avtosaqlash va versiyalar, Word va PDF yuklab olish | Loyihani Word'ga o'tkazmasdan shu yerda tuzatadi | src, migrations, public, package (vendor) |
| D2 | Izohlar paneli (belgilash, javob, hal qilindi), Word eksportda izohlar | Kimdan qanday izoh kelgani bitta joyda | src, public |
| D3 | Ulashish va birgalikda tahrir: taklif havolasi, rollar, real vaqt, boshqa odam kursori, @eslatma Telegram'ga | Fayl borib-kelmaydi, ikkalasi bitta nusxada | src, migrations, public, package (`ws`) |
| D4 | AI tahlil paneli hujjat ichida: band joyi belgilanadi, taklif "o'zgarish" sifatida kiritiladi | Tahlil va tuzatish bir oynada | src, public |
| D5 | Tekshiruv: A (qoidalar, bepul) + B (AI imlo, taklif) | Texnik xatolar ko'z bilan qidirilmaydi | src, public |

Har PR alohida, har birida brauzerda (kompyuter va ~390px) tekshiruv va
"kim nimadan yutdi" hisoboti.

## 8. Nimani qilmaydi

- Word'ning hammasini takrorlamaydi: sahifa kolontitullari, izohlar
  (footnote), bo'limlar, makroslar — 1-bosqichda yo'q; import vaqtida
  aytiladi, asl fayl saqlanadi.
- Skan qilingan hujjatning asl ko'rinishini (rasm sifatida) tahrirlamaydi —
  OCR matni tahrirlanadi.
- AI matnni o'zi yozib qo'ymaydi — faqat taklif.
- Google Docs / Word Online bilan sinxronlash — yo'q (Word paneli
  `public/word/` o'z yo'lida qoladi).

## 9. Egasiga savollar

1. **Kim qo'shiladi?** (a) faqat Workspace a'zolari; (b) har qanday JuristAI
   akkaunti havola orqali (mijoz ham); (c) ikkalasi. Taklif: (c) — Workspace
   a'zolari avtomatik, tashqaridagi odam havola bilan, standart roli
   "izohlovchi".
2. **Qaysi tariflarda?** Taklif: muharrir va izohlar — hamma (Sinov ham,
   1 hujjat); birgalikda tahrir va ulashish — pullik tariflar.
3. **Yangi paketlar**: TipTap/ProseMirror + Yjs (bir marta yig'ilib
   `public/vendor/` ga), serverda `ws`. Rozimisiz? (Hammasi MIT.)
4. **PDF**: 1-bosqichda brauzer orqali "PDF qilib saqlash" yetadimi?
   Taklif: ha; serverda PDF — talab bo'lsa keyin.
5. **AI imlo tuzatish narxi**: (a) bepul (bizning xarajat); (b) har 4 000
   belgiga 1 chat birligi; (c) hujjat tahlili ichida bepul. Taklif: (c) —
   tahlil qilinganda imlo ham tekshiriladi; alohida bosilsa (b).
6. **Odam o'zgarishlari ham "Track Changes" kabi ko'rinsinmi** (kim nimani
   o'zgartirdi, qabul/rad), yoki faqat AI takliflari? Taklif: 1-bosqichda
   faqat AI takliflari + versiyalar tarixi; odam o'zgarishlarini kuzatish — D3
   dan keyin, kerak bo'lsa.
7. **Workspace hujjatlari** shu muharrirga ko'chsinmi (bitta joy), yoki
   alohida qolsinmi? Taklif: D3 da Workspace hujjati ham shu muharrirda
   ochiladi.
8. **Akkaunt o'chirilganda** boshqaning hujjatidagi izohlar: o'chsinmi yoki
   "o'chirilgan foydalanuvchi" bo'lib qolsinmi? Taklif: qolsin, ism olib
   tashlanadi.
9. **Tartib**: D1 → D2 → D3 → D4 → D5 maqulmi, yoki birgalikda tahrir (D3)
   birinchi kerakmi? Taklif: D1 dan boshlash — bir kishi uchun foyda darhol,
   D3 ning eng qiyin qismi (real vaqt) D1 ning ustiga quriladi.
