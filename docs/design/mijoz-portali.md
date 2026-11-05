# Mijoz portali: yurist va mijoz bitta ishda (dizayn)

Holat: **qabul qilingan** (egasi, 2026-11-05: "Hammasini qabul qilaman" — 9-bo'limdagi barcha takliflar).
Yo'l xaritasi: `docs/roadmap/legora-darajasi.md`, 4-bosqich ("Mijoz portali").
Egasining topshirig'i (2026-11-04): "Keyingi bosqichni boshla!"

## 1. Nima uchun va kim nima yutadi

Bugun yurist ishni platformada yuritadi: ish (Matter), suhbatlar, hujjatlar,
yozuvlar, agent natijalari. Lekin mijoz bu ishni ko'rmaydi. Yurist mijozdan
hujjatni Telegram yoki elektron pochta orqali so'raydi. Mijoz faylni
yuboradi, yurist uni yuklab olib, platformaga qayta yuklaydi. "Ish qaysi
bosqichda?" degan savolga har safar qo'lda javob yoziladi. Bir hujjatning
bir necha nusxasi turli chatlarda qolib ketadi.

- **Yurist** mijozga bitta havola beradi. Shundan keyin so'ralgan hujjat
  to'g'ridan-to'g'ri ishning ichiga tushadi: yuklab olish, qayta yuklash va
  qaysi nusxa oxirgisi ekanini qidirish shart emas.
- **Mijoz** ish qaysi bosqichda ekanini, yurist undan nima kutayotganini va
  muddatlarni o'zi ko'radi; qo'ng'iroq qilib so'ramaydi. Hujjatni Telegram
  botiga yuborishi kifoya, saytga kirishi shart emas.
- **Firma rahbari** kim, qachon, qaysi hujjatni ochgani yoki yuborganini
  jurnalda ko'radi. Nizo bo'lsa, "hujjatni yubordim" / "olmadim" bahsini
  jurnal hal qiladi.

Nima yangi bo'lmaydi: AI chaqiruvi yo'q, limit birligi olinmaydi; javob
zanjiri, qonun manbalari va tariflar o'zgarmaydi.

Ataylab qilinmaydi (V5 saboqi: "saytga havola" yetarli emas): mijozga
faqat saytga havola yuborilib, ishni bot ichida ko'rsatmaslik. Mijozlar
ko'pincha Telegram'da, shuning uchun har bosqichning asosiy yo'li botda.

## 2. Bazada hozir nima bor (2026-11-04, kod bo'yicha)

| Narsa | Qayerda | Kim ko'radi |
|---|---|---|
| Ish | `matters` (019), `owner_id`, ixtiyoriy `workspace_id`, `open` / `closed` | egasi; Workspace'ga biriktirilsa, a'zolar yozadi, viewer o'qiydi |
| Ish bandlari | `matter_items`: chat, scan, agent_run, note (yozuv shifrlangan) | ish ko'radiganlar |
| Hujjatlar | `document_scans` (Hujjatlarim, matn shifrlangan) | faqat egasi |
| Muharrir hujjati | `doc_editor_*` (036-039), havola bilan ulashish: editor / commenter / viewer, istalgan foydalanuvchi | egasi va taklif qilinganlar |
| Workspace a'zoligi | owner / member / viewer; a'zoning o'z pullik tarifi bo'lishi shart | — |
| Telegram | ulangan akkauntga xabar, tugmalar, fayl qabul qilish (Hujjatlarimga saqlanadi) | — |
| Kirish jurnali | `data_access_log` (E6b): xodim boshqaning shifrlangan ma'lumotini ochsa | master |

Bo'shliq: Workspace a'zosi bo'lish uchun pullik tarif kerak, mijozda esa
odatda tarif bo'lmaydi. Bundan tashqari, viewer butun Workspace'ni ko'radi,
mijoz esa faqat o'z ishini ko'rishi kerak. Shuning uchun mijoz Workspace
a'zosi **bo'lmaydi**. U faqat bitta ishning "mijozi" bo'ladi. Bu xuddi
muharrirdagi D3 ulashish kabi: bitta obyekt, bitta havola, istalgan akkaunt.

## 3. Asosiy qaror: mijoz = ishning alohida roli

- Yangi jadval `matter_clients`: ish, mijoz akkaunti, kim taklif qilgan,
  qachon, holat (faol / chiqarilgan).
- Mijoz istalgan platforma akkaunti bo'lishi mumkin, Sinov akkaunti ham.
  Tarif shart emas.
- Mijoz faqat ishdagi **"mijozga ko'rinadi"** deb belgilangan narsalarni
  ko'radi. Standart holatda hech narsa ko'rinmaydi.
- **Ko'rinmaydi:** ichki yozuvlar, AI suhbatlari, agent natijalari, firma
  bazasi, boshqa ishlar, Workspace va uning a'zolari ro'yxati.
- Taklif qiladi: ish egasi yoki Workspace'ning owner / member a'zosi.
  Viewer taklif qila olmaydi.
- Taklif havolasi D3 dagi kabi ishlaydi:
  - bir martalik, 7 kun amal qiladi;
  - bazada faqat sha256 saqlanadi, havolaning o'zi bir marta ko'rsatiladi;
  - bekor qilish mumkin.
- Havola ikki ko'rinishda bo'ladi: sayt (`#/portal/taklif/<token>`) va bot
  (`t.me/<bot>?start=mpi_<token>`). Akkaunti bo'lmagan mijoz botda bir
  bosish bilan Telegram identitetidan akkaunt oladi (`joinFromTelegram`
  kabi).

## 4. Qismlar

### P1. Mijoz ishni ko'radi (faqat o'qish)

- Ishga "bosqich" maydoni qo'shiladi. Bosqichni yurist tanlaydi:
  - Qabul qilindi;
  - Ishlanmoqda;
  - Mijozdan kutilmoqda;
  - Sudda / organda;
  - Yakunlandi.
  Har o'zgarish vaqti bilan saqlanadi.
- Muddatlar: sana va qisqa nom, "mijozga ko'rinadi" belgisi bilan.
- Mijozga ko'rinadigan bandlar:
  - yuristning mijozga yozgan izohi (ichki yozuvdan alohida);
  - Hujjatlarimdagi hujjat (nusxa olib qo'yiladi, keyin original kuzatilmaydi);
  - muharrir hujjati (viewer yoki commenter sifatida, D3 orqali).
- Sayt: `#/portal` — mijozning barcha ishlari; `#/portal/<id>` — bitta ish.
  Mijoz rolidagi akkaunt menyuda faqat shu bo'limni qo'shimcha ko'radi.
- Bot: "ishlarim" buyrug'i mijozga uning ishlarini bot ichida ko'rsatadi
  (bosqich, muddatlar, hujjatlar ro'yxati; hujjat tugma bilan yuboriladi).
- Bosqich o'zgarganda yoki yangi hujjat ulashilganda mijozga Telegram
  xabari boradi: ish nomi va nima o'zgargani. Ichki matn yuborilmaydi.

### P2. Xabarlar (ikki tomonga)

- Ish ichida yurist bilan mijoz o'rtasida bitta suhbat. Xabarlar shifrlangan
  (AAD ish bo'yicha). Bu suhbat Workspace xonasi chatidan alohida.
- Mijoz botga yozadi: suhbat holatidagi keyingi xabari, xuddi "agent_answer"
  kabi, ishga tushadi. "bekor" deb yozsa, suhbat holatidan chiqadi. Yuristga
  sayt va Telegram orqali xabar boradi.
- Yurist javobi mijozga botda keladi; mijoz saytga kirmaydi.
- AI bu suhbatni o'qimaydi va javob bermaydi.

### P3. Hujjat so'rovi va mijoz yuklashi

- Yurist "hujjat so'rovi" ochadi, masalan: "Pasport nusxasi", "Shartnoma
  asli", muddati bilan.
- Mijoz ishga fayl yuklaydi: saytda yoki botga fayl yuborib. Bot qaysi
  so'rovga ekanini tugma bilan so'raydi.
- Fayl shifrlanadi (E5 kabi), sha256 bilan saqlanadi va ishga band bo'lib
  tushadi; yurist uni o'z Hujjatlarimiga oladi.
- Skanerlangan fayl OCR qilinmaydi, toki yurist o'zi xizmatni tanlamaguncha.
  OCR qilinsa, u yuristning limitidan hisoblanadi.
- Cheklovlar: bitta fayl 20 MB, bitta ish 200 fayl.

### P4. Jurnal (audit trail)

- `matter_portal_events` jadvali: kim (yurist yoki mijoz), nima qildi
  (ochdi, yukladi, yubordi, bosqichni o'zgartirdi, taklif qildi, chiqardi),
  qachon, qaysi band. Matn yozilmaydi.
- Ish sahifasida "Jurnal" bo'limi bor: yurist va firma rahbari ko'radi.
  Mijoz faqat o'z harakatlarini ko'radi.
- Eksport: CSV, faqat ish egasi va master.

### P5. Tasdiq ("Tanishdim" / "Roziman") — ixtiyoriy

- Yurist hujjatni "mijoz tasdig'i kerak" deb belgilaydi. Mijoz "Tanishdim"
  yoki "Roziman" tugmasini bosadi va bu vaqt va hujjatning sha256 xeshi
  bilan jurnalga yoziladi.
- Bu **elektron raqamli imzo (ERI) emas** va sahifada shunday deb
  yoziladi. Huquqiy kuchi yo'q, faqat yozishma dalili sifatida qoladi.

## 5. Xavfsizlik va maxfiylik

- Har so'rovda serverda tekshiriladi: so'ralayotgan narsa shu ishniki, mijoz
  shu ishda faolmi va band "mijozga ko'rinadi"mi. Aks holda 404 qaytadi.
- Mijoz chiqarilsa yoki ish yopilsa: chiqarilgan mijoz kirish huquqini
  darhol yo'qotadi. Yopilgan ishni mijoz 30 kun o'qiy oladi (6-savol).
- Yozuvlar, xabarlar va fayllar shifrlangan. Kirish jurnali (E6b) ham
  yoziladi: xodim mijozning xabarini ochsa, jurnalda qoladi.
- Akkaunt o'chirilganda:
  - mijozning xabarlari matni almashtiriladi, ishdagi fayllari qoladi
    (yuristning ish materiali; 7-savol);
  - yurist akkaunti o'chirilsa, mijoz ishga kirish huquqini yo'qotadi.
- Yozish so'rovlari faqat shu saytdan (same-origin); taklif tokeni bir
  martalik.

## 6. Narx

- AI yo'q, limit birligi olinmaydi.
- Saqlash: fayllar Supabase Storage'da. Masalan, 200 fayl × 2 MB = bitta ish
  uchun ~400 MB, jami firma hajmi esa Workspace cheklovi bilan
  chegaralanadi (3-savol).
- Telegram xabarlari bepul.

## 7. Bosqichlar va PR'lar

| PR | Nima | Teginadi | Rozilik |
|---|---|---|---|
| P1a | `matter_clients`, taklif, ruxsat tekshiruvi, bosqich va muddatlar (server) | `src/matters`, migratsiya | so'raladi |
| P1b | `#/portal` sahifalari, ish sahifasida "Mijoz" kartasi | `public/app` | — |
| P1c | Botda mijozning ishlari va xabarnomalar | `src/bot` | so'raladi |
| P2 | Xabarlar (sayt va bot) | server, bot, sahifa | so'raladi |
| P3 | Hujjat so'rovi va mijoz yuklashi | server, bot, sahifa | so'raladi |
| P4 | Jurnal va eksport | server, sahifa | so'raladi |
| P5 | "Tanishdim / Roziman" | server, sahifa | so'raladi |

`/api/legal-chat` va javob zanjiriga hech biri tegmaydi.

## 8. Nimani bilmaymiz

- Mijozlar portalni ishlatadimi yoki odatdagidek Telegram'da yozishni
  afzal ko'radimi, o'lchanmagan. CustDev pilotidagi 20 mijozdan so'rash
  mumkin.
- Advokatlik sirining chegarasi (qaysi hujjat mijozga ko'rsatiladi) — buni
  yurist o'zi hal qiladi; tizim faqat standart holatda yopiq turadi.

## 9. Egasiga savollar

1. **Mijoz = ishning alohida roli** bo'lsinmi (Workspace a'zosi emas,
   tarif talab qilinmaydi)? Taklif: ha.
2. **Kim taklif qiladi:** ish egasi va Workspace'ning owner / member
   a'zolari. Taklif: shunday.
3. **Fayl cheklovlari:** bitta fayl 20 MB, bitta ish 200 fayl, hajmi
   Workspace'ning 2 GB chegarasiga kiradimi? Taklif: ha.
4. **Asosiy yo'l Telegram bot** bo'lsinmi (ishlarim, xabar, fayl botda),
   sayt esa qo'shimcha? Taklif: ha.
5. **P5 ("Tanishdim / Roziman", ERI emas)** kerakmi? Taklif: P4 dan keyin,
   pilotdagi yuristlar so'rasa.
6. **Yopilgan ish:** mijoz uni 30 kun o'qiy oladimi? Taklif: ha, keyin
   yopiladi.
7. **Mijoz akkaunti o'chirilsa,** u yuklagan fayllar yuristning ishida
   qoladimi? Taklif: ha (yuristning ish materiali); xabarlar matni
   almashtiriladi.
8. **Tartib:** P1a → P1b → P1c → P2 → P3 → P4 → (P5). Taklif: shunday.

**Javoblar (2026-11-05, egasi):** 1–8 savollarning hammasiga taklif qilingan
javob qabul qilindi: mijoz — ishning alohida roli, tarifsiz; ish egasi va
Workspace'ning owner / member a'zolari taklif qiladi; 20 MB / 200 fayl,
Workspace'ning 2 GB chegarasi ichida; asosiy yo'l Telegram bot; P5 P4 dan
keyin, yuristlar so'rasa; yopilgan ish mijozga 30 kun ochiq; mijoz akkaunti
o'chirilsa uning fayllari ishda qoladi, xabarlari matni almashtiriladi;
tartib P1a → P1b → P1c → P2 → P3 → P4 → (P5).
