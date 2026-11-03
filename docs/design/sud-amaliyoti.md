# Sud amaliyoti: Plenum qarorlari, citator, monitoring (dizayn)

Holat: **qabul qilingan** (egasi, 2026-11-03: "takliflaringni qabul qilaman, S1 ni boshla"). Javoblar 9-bo'limda.
Yo'l xaritasi: `docs/roadmap/legora-darajasi.md`, 3-bosqich ("Raqobat ustunligi").
Egasining topshirig'i (2026-11-03): "Keyingi bosqichni boshla!"

## 1. Nima uchun va kim nima yutadi

Hozir javob faqat qonun matniga tayanadi: kodeks, qonun, qarorning moddasi va
bandi. Sud esa normani Oliy sud Plenumining tushuntirishi bo'yicha qo'llaydi.
Yurist javobni olgach, Plenum nima deganini lex.uz'dan o'zi qidiradi. Mijoz
esa bunday tushuntirish borligini umuman bilmaydi.

- **Yurist** javobning o'zida "Oliy sud Plenumi shu moddani qanday
  tushuntirgan"ini ko'radi: qarorning raqami, sanasi, bandi va so'zma-so'z
  iqtibos lex.uz havolasi bilan. Alohida qidirish kerak bo'lmaydi.
- **Mijoz** "sudda bu qanday ko'riladi?" savoliga taxmin emas, Plenumning
  rasmiy tushuntirishini oladi.
- **Hammasi** (keyingi qismlarda): javobda keltirilgan akt o'zgargan yoki
  kuchini yo'qotgan bo'lsa, "o'zgargan" belgisi chiqadi (citator). Ishiga
  tegishli akt o'zgarsa, Telegram'ga kuniga bitta yig'ma xabar keladi
  (monitoring).

## 2. Manba: nima tekshirildi (2026-11-03, jonli lex.uz)

- **Plenum qarorlari lex.uz'da bor.** Qidiruvdagi "Organ" filtri:
  "O'zbekiston Respublikasi Oliy sudi" (`body_id=2328`), akt turi "Qaror"
  (`form_id=3972`), faqat amaldagilar (`status=Y`). Bu filtr bilan
  qidiruv Plenum qarorlarini qaytardi. Masalan, `8346794`: "Fuqarolik
  ishlari bo'yicha, ma'muriy va iqtisodiy sudlar tomonidan da'voni
  ta'minlash (dastlabki himoya) choralarini ko'rishning ayrim masalalari
  to'g'risida", "Ўзбекистон Республикаси Олий суди пленумининг қарори,
  03.07.2026 йилдаги 19-сон". Hujjat lotin, kiril va rus tillarida bor.
- **Tuzilishi:** bandlar raqamlangan (1, 2, … 30). Sahifada kuchga kirish
  sanasi, "Keyingi / Oldingi tahrir" va "Korrespondentlar / Respondentlar"
  (qaysi akt qaysisiga tayanadi) ko'rsatilgan. Citator uchun kerak bo'ladigan
  bog'lanishlarni lex.uz'ning o'zi beradi.
- **Shu filtr ostida sud qarorlari ham chiqadi** ("O'zbekiston Respublikasi
  nomidan hal qiluv qarori"). lex.uz'da sud qarorlari uchun alohida qidiruv
  ham bor: ish turi, sud, instansiya. Ular — 5-qism (S5), alohida qaror bilan.
- **Hali tekshirilmagan:**
  - Plenum qarorlarining umumiy soni. S1 ning quruq sinovida sanaladi.
  - Matn ichidagi qidiruvni (`Query`) organ filtri bilan birga ishlatib
    bo'lmadi: bu birikma hech narsa qaytarmadi. S1 ro'yxatni filtr bo'yicha
    sahifalab oladi, matn qidiruvi kerak emas.
  - "Sud amaliyoti" akt turi (`form_id=16389`) qidiruvda bo'sh chiqdi.
- **Litsenziya.** Qonun hujjatlari va sud hujjatlari rasmiy hujjat;
  "Mualliflik huquqi va turdosh huquqlar to'g'risida"gi Qonunning 8-moddasi
  (lex.uz/docs/-1022944, 2026-11-03 da o'qildi): "rasmiy hujjatlar (qonunlar,
  qarorlar, to'xtamlar va shu kabilar), shuningdek ularning rasmiy
  tarjimalari" mualliflik huquqi obyektlari bo'lmaydi. Biz Plenum matnini allaqachon
  lex.uz'dan olayotgan qonunlar bilan bir xil yo'l bilan olamiz: manba
  ko'rsatiladi, lex.uz havolasi beriladi, matn o'zgartirilmaydi. **Buni yurist
  tasdiqlashi kerak** (9-bo'lim, 1-savol). Sud qarorlarida (S5) shaxsiy
  ma'lumot bor, shuning uchun ular alohida ko'rib chiqiladi.

Platformada hozir bor narsa: `court_cases` jadvali
(`src/dataset/case-law-dataset.js`) — my.sud.uz qarorlarini qo'lda kiritish
uchun. Plenum qarorlari korpusi umuman yo'q.

## 3. Qismlar

### S1. Plenum korpusi (AI'siz, javobga hali tegmaydi)

**Bajarildi (2026-11-03, `src/plenum/`, migratsiya 041).** Dizayndan farqi va
o'lchangan sonlar:
- Ro'yxat organ filtri bilan emas, `query=plenumining` + `body_id` (2328 Oliy
  sud, 2342 Oliy xo'jalik sudi) bilan olinadi: organ filtrining o'zi sud
  qarorlarini ham qaytaradi. Sahifalash lex.uz'ning "Keyingisi" postback'i bilan.
- Korpus `legal_chunks`'dan alohida jadvallarda (`plenum_decisions`,
  `plenum_bands`, `plenum_sync_runs`): S2 gacha javoblar ularni ko'rmaydi.
  **Embedding yo'q** — S2 bandni modda havolasi bilan topadi; embedding kerak
  bo'lsa, S2 da narxi bilan qo'shiladi.
- Uchala tahrir: kiril (lex.uz id), lotin (`-id`, lex.uz'ning o'z tahriri),
  rus (alohida id). Bir nechta qarorda lex.uz'ning o'zi "matn faqat o'zbek
  tilida" deydi — hisobotda shunday nomlanadi.
- Lokal sinov bazasida, jonli lex.uz bilan to'liq yuklash: 217 qaror (Oliy sud
  172, Oliy xo'jalik sudi 36, qo'shma 9; o'zgartirish qarorlari 61), 0
  o'qilmagan, 196 soniya, uchala tahrirda 11 284 band, 13,1 mln belgi
  (`plenum_bands` 14 MB), 20 356 modda havolasi, ulardan 12% aktsiz (asosan
  o'zgartirish qarorlaridagi eski matn iqtiboslari va "shu Kodeks"). Qarorlar
  1991-12-20 dan 2026-07-03 gacha. O'zgarmagan qaror qayta tekshiruvda bitta
  sahifa (20 qaror — 19 soniya).

- Ro'yxat lex.uz'dan olinadi: `body_id=2328`, `form_id=3972`, `status=Y`,
  sahifalab. Faqat sarlavhasida yoki rekvizitida "Plenum" so'zi turgan
  hujjatlar olinadi. Bitta qaror bir marta saqlanadi, uchala tildagi tahriri
  bitta qarorga bog'lanadi.
- Har bir qaror mavjud lex.uz o'quvchisi orqali olinadi (`fetch-lex.js`,
  xotira va sahifa cheklovlari o'zgarmaydi). U bandlarga bo'linib korpusga
  `doc_kind = 'plenum'` bilan yoziladi: raqam, sana, kuchga kirish sanasi,
  korrespondentlar.
- Yangilash: haftada bir marta, faqat yangi va o'zgargan qarorlar olinadi.
  Bitta qarorni tekshirish — bitta sahifa.
- Quruq sinov (`scripts/plenum-ingest.js --dry`): nechta qaror, nechta band,
  qancha belgi va embedding narxi (`model-pricing.js` bo'yicha) chiqadi.
  `--apply` ni egasi ishga tushiradi.
- Master uchun Boshqaruv → "Sud amaliyoti": qarorlar soni, oxirgi yangilanish,
  o'qilmagan qarorlar va sababi.

### S2. Javobda Plenum (huquqiy javob zanjiri — egasining roziligi kerak)

- Javob keltirgan modda uchun shu moddani tilga olgan Plenum bandlari qidiriladi.
  Qidiruv korrespondentlar va band matnidagi "N-modda" havolasi orqali, AI'siz.
- Topilgan band **Tahlil** ichida bitta qator bo'lib chiqadi, alohida bo'lim
  ochilmaydi. Egasining qoidasi: javobda ikki bo'lim, Tahlil va Xulosa. Qator:
  qarorning raqami, sanasi, bandi va so'zma-so'z iqtibos.
- Iqtibos mavjud tekshiruvdan o'tadi: so'zlari manbada so'zma-so'z bo'lishi
  shart, aks holda olib tashlanadi. Claim guard Plenumni manba sifatida ko'radi.
- Plenum topilmasa, hech narsa qo'shilmaydi. "Plenum tushuntirmagan" deb
  yozilmaydi, chunki topilmagani bunday tushuntirish yo'qligini anglatmaydi.
- Bu qism `/api/legal-chat` va Telegram javobini o'zgartiradi. Kod faqat
  egasi rozi bo'lgandan keyin yoziladi (CLAUDE.md qoidasi).

**Qanday qilindi (2026-11-03, `src/plenum/answer.js`, `acts.js`).** Qidiruvdan
keyin topilgan manbalarning (kodeks, modda) juftlari olinadi: kodeks nomi
qanday yozilganidan qat'i nazar bitta kalitga keltiriladi (FK, ФК, ГК,
"Fuqarolik kodeksi", "Гражданский кодекс"; qisqartma tahrir tili bo'yicha
o'qiladi - o'zbekcha kirillda ЖК Jinoyat, ruschada Uy-joy kodeksi); kodeks
bo'lmagan akt (qonun, VMQ) hozircha juftga kirmaydi. Shu kodeksning shu
moddasini tilga olgan, amaldagi, o'zgartirish kiritmaydigan qarorning bandi
(muqaddima emas) nomzod. Faqat modda yetmaydi: band savol bilan so'z ildizi
bo'lishishi kerak, va ildizning og'irligi tahrirdagi barcha bandlar bo'yicha
olinadi (log(bandlar / shu ildizli bandlar)): kamida bitta kam uchraydigan
ildiz (<= 3 % bandda) va jami og'irlik >= 6. Ko'pi bilan 2 band, ikki xil
qarordan, har biri <= 1 500 belgi (oxirgi to'liq gapda kesiladi). Tahrir:
ruscha javob - ruscha, kirillcha savol - kirillcha, qolgani lotincha. Bandlar
KONTEKSTga qonun matnidan keyin "SUD AMALIYOTI — PLENUM TUSHUNTIRISHI (qonun
emas...)" bloki bo'lib va iqtibos manbalariga (`citationChunks`) qo'shiladi:
so'zma-so'z tekshiruv, lex.uz havolasi ("Oliy sud Plenumining 26-son qarori
(20.11.2023), 24-band · lex.uz ↗") va claim guard ularni boshqa manba kabi
o'qiydi; "24-band" qonun moddasiga bog'lanmaydi (`article_numbers` bo'sh).
Prompt qoidasi (`plenumRule`): band bevosita tegishli bo'lsa, Tahlilda normadan
keyin bitta qator; Plenum qonun emas; tegishli bo'lmasa umuman yozilmaydi.
`meta.plenum` faqat id va juftlarni yozadi, matnni emas. `PLENUM_ANSWERS=off`
to'xtatadi; jadval bo'sh bo'lsa hech narsa qo'shilmaydi. Ildiz sanog'i har
tahrir uchun bir marta o'qiladi (lokal: ~330 ms, 3 000 band), 6 soat saqlanadi.
Tanlov mexanik: bandning savolga mosligini model (prompt) va yurist hal qiladi.

### S3. Citator: "bu akt hozir amaldami?"

- Javobda keltirilgan har bir akt uchun: amaldami, oxirgi tahrir sanasi,
  bizning nusxamiz eskirganmi. Ma'lumot lex.uz sahifasidan olinadi: holat,
  "Keyingi tahrir", korrespondentlar.
- Akt o'zgargan bo'lsa, manba yonida "⚠ o'zgargan (sana)" belgisi chiqadi.
  Akt kuchini yo'qotgan bo'lsa, u manba sifatida ishlatilmaydi. Hozir ham
  shunday (`legal-force.js`, `superseded-acts.js`); S3 shu tekshiruvlarni
  odamga ko'rinadigan qiladi.
- Plenum shu moddaga tayangan bo'lsa, "Plenum: N-son qaror" havolasi chiqadi.

### S4. Monitoring (yo'l xaritasidagi keyingi band)

- Haftalik yangilash (S1) va citator (S3) yangi yoki o'zgargan aktlarni
  biladi. Odamning ishlarida (Matter) keltirilgan aktlar bilan solishtiriladi,
  AI'siz.
- Tegishli o'zgarish bo'lsa, ulangan Telegram'ga **kuniga bitta yig'ma xabar**
  boradi: qaysi ish, qaysi akt, nima o'zgardi va havola. Matter matni xabarga
  kirmaydi.
- `LEX_MONITOR=off`; odam o'z xabarlarini o'chira oladi.

### S5. Sud qarorlari (keyinroq, alohida qaror bilan)

lex.uz va my.sud.uz'dagi hal qiluv qarorlari. Ularda shaxsiy ma'lumot bor va
hajmi juda katta. Shuning uchun avval S1–S3 ishlasin. Keyin alohida dizaynda:
qaysi sudlar, qanday anonimlashtirish, qanday qidiruv va nima uchun kerakligi.

## 4. Nima qilinmaydi

- AI Plenum yoki sud amaliyotini "eslab" yozmaydi. Faqat korpusda turgan,
  so'zma-so'z tekshirilgan band chiqadi.
- Rasmiy bo'lmagan manbalar (bloglar, forumlar) olinmaydi.
- Plenumning bandi qonun normasining o'rnini bosmaydi: javob avval normani,
  keyin uning tushuntirishini beradi.

## 5. Xarajat

- S1 da AI chaqiruvi yo'q. Faqat bandlarning embeddinglari olinadi; narxini
  quruq sinov hisoblaydi va siz ko'rasiz.
- S2 qo'shimcha AI chaqiruvi qo'shmaydi: Plenum bandi mavjud qidiruv
  natijasiga qo'shiladi. Kontekst ko'pi bilan ~3 300 belgiga (~1 100 token)
  uzayadi: DeepSeek flash'da (kirish $0,30 / 1M) javobiga ~$0,0003, GPT-6
  Sol zaxirasida (~$2 / 1M) ~$0,002; band tanlanmagan savolga $0. Tanlov
  lokal o'lchovda 16-46 ms (birinchi chaqiruv ildiz sanog'i bilan ~400 ms).
- S3 va S4 AI'siz ishlaydi; lex.uz'dan sahifa o'qiydi, xotira cheklovlari
  o'zgarmaydi.

## 6. PR tartibi

| PR | Nima | Tegadi |
|---|---|---|
| S1 | Plenum korpusi, quruq sinov, Boshqaruv ko'rinishi | src, scripts, migrations, public |
| S2 | Javobda Plenum (Tahlil ichida, so'zma-so'z) | huquqiy javob zanjiri — rozilik kerak |
| S3 | Citator belgilari | src, public |
| S4 | Monitoring, Telegram yig'ma xabari | src, migrations |
| S5 | Sud qarorlari — alohida dizayn | — |

## 7. Tekshiruv

- S1: quruq sinov soni lex.uz'dagi sahifalar soniga mos kelishi kerak; o'qib
  bo'lmagan qaror nomi bilan ko'rsatiladi.
- S2: kamida 20 ta savollik to'plam, Plenum bilan va Plenumsiz javoblar
  yonma-yon. Yurist o'qiydi; mexanik solishtirish faqat iqtibos va moddalarni
  sanaydi.
- S3: kuchini yo'qotgan va o'zgargan aktlar bo'yicha sintetik holatlar.

## 8. Xavflar

- lex.uz sahifa tuzilishini o'zgartirsa, ro'yxat o'qilmay qoladi. Shunda S1
  xato beradi va nima o'qilmaganini aytadi; eski korpus o'z holicha qoladi.
- Plenum qarori eskirgan bo'lishi mumkin: unga keyingi qonun to'g'ri kelmaydi.
  S3 qarorning sanasini va o'zgarganini ko'rsatadi; javob avval normaga tayanadi.

## 9. Egasiga savollar

Javoblar (2026-11-03, egasi: "takliflaringni qabul qilaman"):
1. Litsenziya: taklif qabul qilindi — Plenum qarorlari rasmiy hujjat sifatida
   lex.uz'dan, manba va havola bilan, matni o'zgartirilmay olinadi (qonun
   hujjatlari va sud hujjatlari mualliflik huquqi obyekti hisoblanmaydi;
   asos: "Mualliflik huquqi va turdosh huquqlar to'g'risida"gi Qonun, 8-modda;
   yurist ko'rib chiqishi tavsiya etiladi).
2. S2 ga rozilik berildi (Tahlil ichida bitta qator, so'zma-so'z iqtibos).
3. Tartib S1 → S2 → S3 → S4.
4. Uchala tahrir saqlanadi.
5. S5 (sud qarorlari) hozircha qoldiriladi.

Savollar (asl matn):

1. **Litsenziya:** Plenum qarorlarini qonunlar kabi lex.uz'dan olib, manba va
   havola bilan ko'rsatish — yurist bilan tekshirasizmi, yoki men kerakli
   qonun moddasini topib, qisqa izoh yozaymi?
2. **S2 roziligi:** javobda (sayt va Telegram) Tahlil ichida bitta qator
   Plenum bandi chiqishiga rozimisiz? Bu huquqiy javob zanjirini o'zgartiradi.
3. **Tartib:** S1 → S2 → S3 → S4 maqulmi? Yoki monitoring (S4) birinchi
   bo'lsinmi? S4 S1 ning haftalik yangilashiga tayanadi, lekin akt
   o'zgarishlarini Plenumsiz ham kuzata oladi.
4. **Tillar:** uchala tahrir (lotin, kiril, rus) saqlanadimi, yoki faqat
   javob tiliga mosi?
5. **Sud qarorlari (S5):** hozircha qoldiraymi?
