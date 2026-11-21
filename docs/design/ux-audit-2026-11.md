# UI/UX audit: platformani "birinchi kun" uchun soddalashtirish

Holat: **qabul qilingan** (egasi, 2026-11-06: "Takliflaringni qabul qilaman", 9 ta maket ko'rilgandan keyin).
Egasining topshirig'i (2026-11-06): "User platformadan 1-marta foydalanishni
boshlaganda hech narsani tushunmaydi… labirintga o'xshaydi. Nima? Qayerda?
Qanday?… Platformadan foydalanish dummy'lar uchun ham oson bo'lishi kerak,
lekin feature'lar saqlanib qolishi kerak." Misol: "Muharrirda bitta hujjat
yuklagan edim, endi uni yo'qotib qo'ydim, qaysi feature'da ekanligi ham
esimda yo'q."

## 1. Qanday tekshirildi

- Lokal serverda ikki akkaunt bilan, brauzerda, 1280px va 390px kengliklarda:
  - yangi akkaunt: Sinov, soha tanlanmagan;
  - Silver akkaunt: hujjatlari, muharrir hujjatlari va suhbatlari bor.
- Ko'rilgan sahifalar: bosh sahifa, chat, Hujjatlarim, Ishlar, Hujjat tahlili,
  Hujjat tayyorlash, Hisob, muharrir va uning "AI tahlil" paneli.
- Kod bo'yicha: barcha marshrutlar (`J.route`), menyu (`NAV`, `ROLE_VIEWS`),
  muharrir asboblar paneli va TipTap kengaytmalari.
- **Tekshirilmadi:**
  - haqiqiy foydalanuvchi bilan sinov (CustDev intervyulari buni beradi);
  - haqiqiy iPhone;
  - lokal bazada muharrir hujjati matni ochilmadi (boshqa sinov kaliti bilan
    shifrlangan), shuning uchun muharrir paneli kod bo'yicha baholandi.

## 2. Asosiy topilmalar

### 2.1 "Hujjatim qayerda?" — saqlangan narsalar 8 xil joyda

| Nima | Qayerda saqlanadi | Qanday topiladi |
|---|---|---|
| Suhbatlar | Suhbatlar (`#/suhbatlar`) | chap paneldagi ro'yxat, "Barchasi" |
| Yuklangan fayllar | Hujjatlarim | menyu |
| Muharrir hujjatlari | Hujjatlarim → "Muharrirdagi hujjatlar" bloki | menyuda "Muharrir" degan so'z yo'q |
| AI loyihalar (Word) | yuklab olinadi, platformada qolmaydi | — |
| Jadvalli tahlil | `#/jadval/<id>` | faqat havola yoki ishga biriktirilgan bo'lsa |
| Playbook natijasi | ishga biriktirilsa, Ishlarda | — |
| Da'vo agenti natijasi | ishga biriktirilsa, Ishlarda | — |
| Ovozli yozuvlar | Yozuvlar | menyu (faqat ba'zi rollarda) |

- Umumiy qidiruv yo'q. "Oxirgi qilganlarim" ro'yxati faqat suhbatlarni
  ko'rsatadi.
- Muharrir hujjati "Hujjatlarim" ichida turibdi. Lekin foydalanuvchi uni
  "muharrirda ochganman" deb eslaydi va "Muharrir" so'zini qidiradi. Menyuda
  bunday so'z yo'q. Egasining yo'qolgan hujjati aynan shu yerda bo'lishi
  kerak.

### 2.2 Birinchi kirishda bir vaqtda 6 ta narsa so'raladi

Yangi akkaunt `/app/` ni birinchi ochganda ekranda:

1. Majburiy tarif tanlash oynasi. Uni yopib bo'lmaydi, avval "Sinovni
   boshlash" bosilishi kerak.
2. Pastda alifbo tanlash paneli. U kontentni yopib turadi.
3. "Sohangizni tanlang" — 6 ta tugma.
4. Salomlashuv.
5. Yozish maydoni va 3–4 tugma: Hujjat, Ko'nikma, Firma bazasi, mikrofon.
6. To'rtta kartochka va "So'nggi suhbatlar".

Foydalanuvchi savol berishdan oldin tarif, alifbo va soha haqida qaror qabul
qilishi kerak. Bularning hech biri uning birinchi maqsadi emas.

### 2.3 Bitta ishning 5 ta eshigi

Hujjatni tahlil qilishning hozir beshta yo'li bor:
1. chatga fayl biriktirib "tahlil qil" deb yozish;
2. "Hujjat tahlili" sahifasi;
3. Jadvalli tahlil;
4. Playbook;
5. muharrirdagi "AI tahlil".

Ularning narxi va natijasi har xil, lekin foydalanuvchiga farq
tushuntirilmaydi. Jadval va Playbook faqat "Hujjat tahlili" sahifasining
yuqorisidagi kartochkalardan topiladi.

### 2.4 Menyu va nomlar

- Menyuda 15 tagacha band bo'lishi mumkin: Bosh sahifa, Ishlar, Hujjatlarim,
  Hujjat tahlili, Hujjat tayyorlash, Ko'nikmalar, Firma bazasi, Yozuvlar,
  Jamoa, Advokatlar, Navbat, Mijozlarim, Yuristdagi ishlarim, Boshqaruv,
  Barcha bo'limlar.
- Rol ko'rinishi (Fuqaro, Yurist…) buni qisqartiradi, lekin boshqa bandlar
  shunchaki yo'qoladi. Masalan, Fuqaro ko'rinishida "Ishlar" yo'q, Playbook va
  Jadval esa hech qaysi menyuda yo'q.
- Ichki nomlar foydalanuvchiga ma'lum emas: "Ko'nikma", "Playbook",
  "Firma bazasi", "Jadval", "Birlik".
- Yuqori o'ng burchakdagi "Shaxsiy / Jamoa" tugmasi nima qilishi
  tushuntirilmagan.
- Limit qutisi ("0 / 0", "0 savol", "Ovozli yozuv: daqiqalar hozircha
  hisoblanmaydi") oddiy foydalanuvchi uchun tushunarsiz.

### 2.5 Javob sifati (skrinshotdagi tahlil)

- **Singan gaplar.** "Это значит, что п. Для вас…" kabi gaplar chiqdi: javob
  tekshiruvchisi "п." dan keyin gapni uzib, raqamli qismini olib tashlagan.
  Tuzatildi, #573.
- **Javob tili.** O'zbekcha so'rovga ruscha javob keldi: savoldagi bitta
  kirillcha so'z butun savolni ruscha deb hisoblatgan. Tuzatildi, #573.

### 2.6 Muharrir

- **AI takliflari.** Taklifning joyini ko'rish uchun alohida "Joyini
  ko'rsatish" tugmasini bosish kerak. Kartaning o'zi bosilmaydi va joy rang
  bilan belgilanmaydi.
- **AI bilan suhbat.** Hujjatning biror joyi haqida AI'dan so'rashning yo'li
  yo'q. Faqat umumiy chatga borish mumkin, u esa boshqa sahifa.
- **Asboblar paneli.** Hozir bor: blok turi, shrift, o'lcham, B I U S, rang,
  fon, tekislash, ro'yxatlar, jadval, bekor qilish / qaytarish. Wordda tez-tez
  ishlatiladigan quyidagilar yo'q:
  - topish va almashtirish;
  - qator oralig'i;
  - xat boshi (indent) +/−;
  - yuqori / pastki indeks;
  - formatlashni tozalash;
  - sahifa uzilishi;
  - so'z va sahifa soni ko'rinishi;
  - masshtab;
  - sahifa raqamlari (Word eksportida).

## 3. Takliflar: kim nima yutadi

### U1. "Hammasi topiladi" — bitta qidiruv va "Davom ettirish"

Kim yutadi: har bir foydalanuvchi. "Qayerda edi?" degan savolga bitta qadamda
javob topadi.

- Chap panelning yuqorisida qidiruv maydoni (Ctrl+K). U nomlar bo'yicha
  qidiradi:
  - suhbatlar;
  - yuklangan hujjatlar;
  - muharrir hujjatlari;
  - ishlar;
  - jadval va playbook natijalari.

  Ichki matn qidirilmaydi: matnlar shifrlangan, nomlar bo'yicha qidiruv
  yetarli.
- Bosh sahifadagi "So'nggi suhbatlar" o'rniga "Davom ettirish" bloki: oxirgi
  8 ta narsa, turidan qat'i nazar (suhbat, hujjat, muharrir, ish, jadval),
  belgisi bilan.
- "Hujjatlarim" o'rniga "Hujjatlar" sahifasi, uchta yorliq bilan:
  "Yuklanganlar" | "Tahrirdagilar (muharrir)" | "Natijalar" (jadval,
  playbook). Muharrir hujjati endi pastdagi blokda yo'qolmaydi.

### U2. Birinchi kirish: bitta savol, qolgani keyin

Kim yutadi: yangi foydalanuvchi. Birinchi savolni berishdan oldin 3 ta qaror
emas, 0 ta qaror qabul qiladi.

- Tarif oynasi birinchi kirishda chiqmaydi:
  - Sinov o'z-o'zidan boshlanadi;
  - tarif faqat limit tugaganda yoki yopiq bo'limga bosilganda taklif
    qilinadi.
- Ekranda bitta savol: "Nimadan boshlaysiz?", uchta katta tugma bilan:
  - "Savol berish";
  - "Hujjatni tekshirish";
  - "Hujjat yozish".

  Soha keyinroq, bitta qatorli taklif bilan so'raladi.
- Alifbo paneli birinchi ishdan keyin chiqadi va kontentni yopmaydi.
- Bo'sh sahifalarda "bu yerda nima bo'ladi va qanday boshlanadi" degan bitta
  gap va bitta tugma bo'ladi.

### U3. Hujjat uchun bitta eshik

Kim yutadi: hujjat bilan ishlovchi har kim. Endi "qaysi sahifaga borish
kerak?" deb o'ylamaydi.

- Faylni istalgan joyga tashlash mumkin: chat, bosh sahifa yoki Hujjatlar.
- Fayl tashlangach, bitta "Nima qilaylik?" kartasi chiqadi. Har bir amal
  yonida narxi (birlik) va natijasi bir qatorda yozilgan:
  - Oddiy tilda tushuntirish;
  - To'liq tahlil (xavflar);
  - Savol berish;
  - Muharrirda ochish;
  - Firma qoidalari bilan tekshirish;
  - Boshqa hujjatlar bilan solishtirish.
- Hozirgi sahifalar o'chirilmaydi, ular shu kartadan ochiladi.

### U4. Menyu: 5 ta band + "Asboblar"

Kim yutadi: hamma. Menyu bir qarashda tushuniladi, lekin hech bir imkoniyat
yo'qolmaydi.

- Asosiy menyu:
  1. Savol;
  2. Hujjatlar;
  3. Ishlar;
  4. Asboblar;
  5. Advokatlar.

  Xodimlarga Navbat va Boshqaruv qo'shimcha chiqadi.
- "Asboblar" sahifasida barcha imkoniyatlar kartochka ko'rinishida turadi:
  bir qatorda "nima qiladi", misol va narx. Ro'yxat: Hujjat tayyorlash,
  Da'vo arizasi, Jadvalli tahlil, Playbook, Firma bazasi, Ko'nikmalar,
  Yozuvlar, Jamoa.
- Telefonda pastda 4 tugmali panel: Savol, Hujjatlar, Ishlar, Ko'proq.
- Nomlarni oddiy qilish (8-bo'limda savol):
  - "Ko'nikma" → "Tayyor buyruqlar";
  - "Playbook" → "Firma qoidalari bilan tekshirish";
  - "Jadval" → "Ko'p hujjatni solishtirish";
  - "Birlik" yonida doim izoh: "1 birlik = 10 sahifagacha".
- Limit qutisi oddiy tilda bo'ladi, masalan: "Bu oy: 148 savol qoldi · 8 ta
  hujjat tahlili qoldi".

### U5. Muharrir: Word darajasiga yaqinlashish

Kim yutadi: shartnoma bilan ishlovchi yurist. Matn, AI izohi va savol bitta
oynada turadi, umumiy chatga o'tish shart emas.

- **Taklifni bosish = joyni ko'rsatish.** AI taklifi yoki tekshiruv kartasi
  bosilganda:
  - hujjatdagi o'sha joy och ko'k fonda belgilanadi;
  - sahifa o'sha joyga aylanadi.

  Alohida "Ko'rsatish" tugmasi olib tashlanadi. "Tuzatish" va "Qabul qilish"
  tugmalari qoladi.
- **"Shu joy haqida so'rash".** Matn belgilansa yoki AI kartasida bo'lsa,
  o'ng panelda chat ochiladi:
  - kontekst — belgilangan band va hujjat;
  - javob lex.uz asosida, xuddi oddiy chatdagi kabi zanjir va tekshiruvlar
    bilan;
  - umumiy chatga o'tib ketmaydi;
  - javobni bir bosishda izoh yoki hujjatga matn sifatida qo'shish mumkin.
- **Word funksiyalari, 1-to'plam:**
  - topish va almashtirish (Ctrl+F / Ctrl+H);
  - qator oralig'i;
  - xat boshi +/−;
  - yuqori / pastki indeks;
  - formatlashni tozalash;
  - sahifa uzilishi;
  - pastki qatorda so'z, belgi va sahifa soni;
  - masshtab;
  - Word eksportida sahifa raqami.
- **2-to'plam (keyin):**
  - o'zgarishlarni kuzatish (Track Changes);
  - sarlavhalardan mundarija;
  - kolontitullar.

### U6. Javob sifati

- #573 merge qilinsin: "п." xatosi va javob tili tuzatilgan.
- Hujjat tahlilida javob tili endi so'rov tiliga mos bo'ladi. So'rov
  o'zbekcha bo'lsa, rus tilidagi hujjat ham o'zbekcha tahlil qilinadi;
  shartnomadan iqtiboslar asl tilida qoladi.

## 4. Nima o'zgarmaydi

- Barcha imkoniyatlar, narxlar, limitlar, javob zanjiri, shifrlash va kirish
  jurnali o'zgarmaydi.
- Hech bir sahifa o'chirilmaydi: ular yangi eshiklar va "Asboblar" orqali
  ochiladi.
- Eski havolalar (`#/tahlil`, `#/jadval`, `#/playbook`…) ishlashda davom
  etadi.

## 5. Narx

- U1–U4 asosan frontend. U1 qidiruvi uchun bitta kichik server so'rovi kerak:
  nomlar bo'yicha, AI'siz.
- U5 dagi "Shu joy haqida so'rash" mavjud chat zanjiridan foydalanadi: har bir
  savol 1 chat birligi, AI xarajati oddiy chatdagi bilan bir xil. Word
  funksiyalari uchun AI kerak emas.

## 6. Bosqichlar

| PR | Nima | Teginadi | Rozilik |
|---|---|---|---|
| U1a | Umumiy qidiruv + "Davom ettirish" (server: nomlar bo'yicha qidiruv) | `src/`, `public/app` | so'raladi |
| U1b | "Hujjatlar" sahifasi yorliqlar bilan | `public/app` | — |
| U2 | Birinchi kirish: tarif oynasisiz, "Nimadan boshlaysiz?" | `public/app` | — (tarif mantig'i o'zgarmaydi) |
| U3 | Fayl uchun "Nima qilaylik?" kartasi | `public/app` | — |
| U4 | Menyu 5+Asboblar, telefon paneli, nomlar | `public/app` | nomlar uchun javob kerak |
| U5a | Muharrir: taklifni bosish = joyini belgilash; Word 1-to'plami | `public/app`, vendor bundle | — |
| U5b | Muharrir: "Shu joy haqida so'rash" chat paneli | `public/app` (+ mavjud `/api/legal-chat`) | so'raladi |

Frontend PR'lar qoidaga ko'ra brauzerda tekshirilgach staging'ga
chiqariladi. Server va javob zanjiriga tegadiganlari uchun rozilik
so'raladi.

## 7. Bilmaymiz

- Haqiqiy foydalanuvchilar qayerda adashishi o'lchanmagan. Taklif: CustDev
  pilotidagi 5 agent har mijozdan 3 ta vazifani bajarishni so'raydi va qayerda
  qotishini yozadi:
  1. "savol bering";
  2. "shartnomani tekshiring";
  3. "kechagi hujjatni toping".
- "Shaxsiy / Jamoa" tugmasidan qanchalik foydalanilishi noma'lum.

## 8. Egasiga savollar

1. **Tarif oynasi** birinchi kirishda chiqmasin, Sinov o'zi boshlansin, tarif
   faqat kerak bo'lganda taklif qilinsinmi? Taklif: ha.
2. **Menyu**: 5 band (Savol, Hujjatlar, Ishlar, Asboblar, Advokatlar) va
   qolganlari "Asboblar" sahifasida bo'lsinmi? Rol ko'rinishlari (Fuqaro,
   Yurist…) unda "Asboblar"dagi tartibni o'zgartiradi. Taklif: ha.
3. **Nomlar**: "Ko'nikma" → "Tayyor buyruqlar", "Playbook" → "Firma qoidalari
   bilan tekshirish", "Jadval" → "Ko'p hujjatni solishtirish". Rozimisiz yoki
   o'z variantingiz bormi?
4. **Muharrirdagi AI chat**: har bir savol 1 chat birligi bo'lsinmi (oddiy
   chat kabi)? Savol-javoblar muharrir panelida va "Suhbatlar"da ham
   saqlansinmi? Taklif: 1 birlik; javoblar shu hujjat bilan saqlansin, Suhbatlar
   ro'yxatiga ham tushsin.
5. **Word funksiyalari**: 1-to'plam (3-bo'lim, U5) to'g'rimi? Sizga eng kerakli
   yana nimalar bor?
6. **Tartib**: avval U1 (yo'qolgan hujjat muammosi) va U5a, keyin U2–U4, keyin
   U5b; roadmap'dagi P2 (mijoz bilan xabarlar) shulardan keyinmi? Taklif:
   shunday.

**Javoblar (2026-11-06, egasi):** 1–6 savollarning hammasiga taklif
qilingan javob qabul qilindi:
- tarif oynasi birinchi kirishda chiqmaydi;
- menyuda 5 ta band, qolganlari "Asboblar"da;
- taklif qilingan nomlar ("Tayyor buyruqlar", "Firma qoidalari bilan
  tekshirish", "Ko'p hujjatni solishtirish");
- muharrirdagi AI chatda har savol 1 chat birligi, javob shu hujjat bilan
  birga va "Suhbatlar"da saqlanadi;
- Word funksiyalarining 1-to'plami;
- tartib: U1 → U5a → U2–U4 → U5b, keyin P2.

Maketlar 9 ta rasm bo'lib egasiga ko'rsatildi (1280px, platformaning
o'z CSS'i va shrifti bilan).
