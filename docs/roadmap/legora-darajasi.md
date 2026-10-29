# JuristAI → Legora darajasi: yo'l xaritasi

Boshlangan: 2026-10-27, egasining topshirig'i: "Oxirgi bosqichga olib borishimiz
kerak". Bu fayl yo'lning yagona ro'yxati. Har bir ish tugaganda shu yerda
belgilanadi: PR raqami, sana, nima o'lchangani. Yangi sessiya ishni shu fayldan
davom ettiradi.

Belgilar: `[ ]` boshlanmagan · `[~]` ishlanmoqda (PR ochiq) · `[x]` staging'da ·
`[-]` egasi bekor qildi (sababi yoziladi).

Har bir PR uchun qoidalar CLAUDE.md "Working agreement"dagidek:
- `src/**`, `migrations/**`, tariflar va DB o'zgarishi faqat PR orqali va
  egasining roziligi bilan merge qilinadi.
- `/api/legal-chat` egasining roziligisiz o'zgarmaydi.
- Jonli bazaga Claude yozmaydi.

## Taqqoslash (2026-10-27)

Legora haqidagi ma'lumot uchinchi tomon sharhlari va press-relizlardan olingan,
legora.com hujjatlari bevosita o'qilmagan. JuristAI haqidagisi repodagi koddan.

| Yo'nalish | Legora | JuristAI (2026-10-27) |
|---|---|---|
| Agent | Rejani o'zi tuzadi, sub-agentlar parallel ishlaydi | `src/agents/harness.js`: qat'iy qadamlar, ketma-ket, bitta HTTP so'rov ichida (≤150 s) |
| Workflow'lar | Ko'p, firma o'zi tuzadi | 3 ta: da'vo arizasi, jadvalli tahlil, playbook |
| Tabular Review | Minglab hujjat, real vaqtda hamkorlik, teglar | 20 hujjat × 10 savol, so'zma-so'z iqtibos tekshiruvi, CSV; natija saqlanmaydi |
| Word | Savol-javob, playbook, izoh va redline asosida tahrir | `public/word/`: savol-javob, Track Changes bilan tahrir, hujjatda izohlar, o'ng tugma menyusi. Playbook Word'da yo'q |
| Outlook | Xat zanjiri, javob loyihasi | Yo'q. O'rnida Telegram bot (ovoz bilan), bu bizning ustunligimiz |
| Tadqiqot | Ko'p yurisdiksiya, ontologiya, citator | lex.uz jonli qidiruv (2 bosqich), relevance hakami, kalit qator, istisno birinchi. Sud amaliyoti yo'q |
| Monitoring | Qonunchilik o'zgarishlari | Yo'q |
| Ish (matter) / Lists | Natijalar loyihada, manbaga bog'langan | Yo'q. Chatlar alohida, agent natijalari saqlanmaydi. Workspace (Platinum) vazifalar uchun |
| Portal | Mijoz bilan umumiy makon, audit | Yurist navbati bor, mijoz portali yo'q |
| Firma bilimi | Hujjatlar ombori, prompt kutubxonasi | Shaxsiy playbook'lar, ko'nikmalar; Workspace xotirasi (faqat Platinum) |
| Natija formatlari | Word, Excel, PowerPoint | Word, CSV |
| Ishonch | Manbaga havola | Bizda kuchliroq: so'zma-so'z iqtibos, claim guard, qamrov, "tasdiqlanmadi" belgisi |

O'zgarmas tamoyillar:
1. Ishonch mexanizmlari tezlik uchun bo'shatilmaydi. Agent qanchalik avtonom
   bo'lmasin, yakuniy natija tekshiruvdan (iqtibos, claim guard) o'tadi.
2. Narx chegarasi va tasdiqsiz avtonom ish bo'lmaydi.
3. Legora ko'r-ko'rona nusxalanmaydi: bozor O'zbekiston (Telegram, ovoz,
   lex.uz, o'zbek tili).

## 0-bosqich. Dizayn

- [x] Matter va agent_runs + reja tuzuvchi agent dizayni:
  `docs/design/matter-va-agent-runs.md` (#491, 2026-10-28). Egasi
  tavsiyalarni qabul qildi (8-bo'lim).

## 1-bosqich. Asos (Matter, uzoq ishlar, reja tuzuvchi)

Tartib va PR bo'linishi dizayn hujjatining 9-bo'limida.

- [x] PR-A: `matters`, `matter_items` (migratsiya 019) va API (#494, 2026-10-28). UI hali yo'q.
- [x] PR-B (#495): `agent_runs` va `agent_run_steps` (migratsiya 020), DB'dagi
  navbat va worker. Mavjud 3 ta workflow run sifatida ishlaydi, eski route'lar
  javob shaklini saqlaydi.
- [x] PR-C (#496): Matter UI (`/app/#/ishlar`): ro'yxat, ish sahifasi, "ishga
  qo'shish" tugmalari (chat, jadval, playbook, loyiha).
- [x] PR-D (#497): Vositalar reestri va reja tuzuvchi agent. Avval faqat master
  uchun (`AGENT_PLANNER=master`). Reja va narxni tasdiqlash shu PR'da
  (PR-E'dan oldinga olindi).
- [x] PR-V (#498): Ishlarni ovoz bilan boshqarish: Telegram'da ulangan akkaunt
  orqali va ilova ichida (egasi, 2026-10-28). `src/matters/commands.js`.
  Keyingi qadam: ovoz bilan agent topshirig'i (reja → tasdiq) - PR-F bilan.
- [x] PR-E (#499): Parallel qadamlar, `needs_input`
  dan keyin davom ettirish.
- [x] PR-F (#501): Telegram: ish holati bitta xabarda yangilanadi, tasdiq tugmalari.
  Botdagi da'vo agenti hali run emas (keyingi qadam).
- [~] PR-G: Agent baholash to'plami (`docs/quality/agent-eval.md`): har bir
  workflow uchun yurist ko'rib chiqqan 20–30 holat; har PR'da stub bilan.

## 2-bosqich. Mavjudini Legora tajribasiga yaqinlashtirish

- [~] Tabular Review: 100+ hujjat run sifatida (fon navbati); ustun turlari
  (ha/yo'q, sana, summa, tanlov); teglar; Excel eksport; natija ishda saqlanadi.
  #504 merge (2026-10-28): 100 hujjat (`TABULAR_MAX_DOCS`, <= 200), tanlov
  ustuni, qator teglari, Excel, fonda ishlash va bosqichlar. Jonli AI bilan
  100 hujjatda sinalmagan.
- [~] Word: playbook tahlili Word ichida (izoh va Track Changes bilan), "ishga
  saqlash". #505 merge (2026-10-28); haqiqiy Word'da sinalmagan.
- [x] Natijalar: Excel (jadval), PowerPoint (ish bo'yicha qisqa taqdimot).
  Jadval Excel'i #504, ish taqdimoti va Excel'i #508 (2026-10-28). Haqiqiy
  PowerPoint'da ochib ko'rilmagan.

## 3-bosqich. Raqobat ustunligi

- [ ] Sud amaliyoti korpusi: Oliy sud Plenumi qarorlari, keyin ochiq sud
  qarorlari. Manba va litsenziya avval tekshiriladi.
- [ ] Citator: akt amaldami, qachon o'zgargan, qaysi Plenum qarori unga
  tayangan. Javobda "o'zgargan" belgisi chiqadi.
- [ ] Monitoring: lex.uz'dagi yangi va o'zgargan aktlar; foydalanuvchi
  ishlariga tegishlisi Telegram'ga yuboriladi (kuniga bitta yig'ma xabar).
- [ ] Firma bilim bazasi: firmaning shablonlari va avvalgi hujjatlari, qidiruv
  bilan (Workspace xotirasidan kengaytiriladi); jamoaviy prompt va ko'nikma
  kutubxonasi.
- [~] Adaptiv akkaunt va platformaning o'zini yaxshilashi (egasi, 2026-10-28):
  dizayn `docs/design/adaptiv-akkaunt.md` (#509, qabul qilingan), PR A1-A8.
  Birinchi qismi: shaxsiy ovoz glossariysi (#507). A1 (signallar va profil)
  #510; A2 ("Moslashish" sahifasi) #511.

## 4-bosqich. Korporativ daraja

- [ ] Mijoz portali: yurist va mijoz uchun umumiy ish, fayllar, savollar,
  rollar, audit trail.
- [~] Ma'lumot himoyasi 1-bosqich (egasi, 2026-10-28, occlum.io tahlilidan keyin):
  `docs/design/shifrlash-1-bosqich.md` - bazada shifrlash, AI'ga yuborishdan
  oldin shaxsiy ma'lumotni yashirish, provayder siyosati, kirish jurnali.
  Qoralama; 9-bo'lim savollariga javob kutilmoqda.
- [ ] Ma'lumot siyosati: hujjatlarni DeepSeek'ga yubormaslik opsiyasi
  (korporativ tarif), saqlash muddatlari, eksport va o'chirish.
- [ ] SSO (korporativ mijoz so'rasa).

## Jurnal

Har bir merge shu yerga bir qator bo'lib yoziladi: sana, PR, nima qilindi,
nima o'lchandi.

- 2026-10-28: #491 merge: yo'l xaritasi va dizayn hujjati.
- 2026-10-28: #494 merge (PR-A): migratsiya 019, `/api/matters`. Lokal
  Postgres'da `tests/matters.db.test.js` (7 ta) va boot smoke (anonim so'rov
  401/403) o'tdi. Shu kuni #493 merge: keyingi qadam tugmalari (MChJ
  savoliga jarima shikoyati chiqqan edi).
- 2026-10-28: PR-B ochildi: migratsiya 020, run store, worker, checkpoint'lar.
  3 ta workflow run orqali ishlaydi. Lokal Postgres'da
  `tests/agent-runs.db.test.js` 9 ta testdan o'tdi (3 marta ketma-ket).
  Testlar: deploy simulyatsiyasi (o'lgan worker, lease, davom ettirish,
  tugagan qadam qayta ishlamadi), 3 urinishdan keyin birliklar qaytishi,
  bekor qilish, bir kishiga bittadan ish, eski javob shakli. Boot smoke ham
  o'tdi: worker ishga tushdi va SIGTERM'da toza to'xtadi.
- 2026-10-28: #495 merge (PR-B). #496 merge (PR-C, frontend): ishlar
  ro'yxati, ish sahifasi, "Ishga qo'shish", 202 kuzatuvi; lokal server va
  haqiqiy API bilan 1280 / 390 px'da tekshirildi; barcha modallar 390 px'da
  ekrandan chiqmaydigan qilindi.
- 2026-10-28: PR-D ochildi: vositalar reestri (5 ta), reja tuzuvchi, server
  tekshiruvi, tasdiq va narx, `planned` run. `tests/agent-planner.test.js`
  (8) va `tests/agent-planner.db.test.js` (5) o'tdi; ish sahifasidagi agent
  kartasi stub javoblar bilan 1280 / 390 px'da tekshirildi. Haqiqiy AI bilan
  hali ishga tushirilmadi (bu yerda kalit yo'q).
- 2026-10-28: PR-V ochildi: ishlar uchun ovozli va matnli buyruqlar (uz / ru):
  ro'yxat, yangi ish, yozuv, ko'rsatish, yopish va qayta ochish (tasdiq
  bilan). Telegram'da (ulangan akkaunt, ovozli xabar STT orqali) va
  ilovada (🎙 tugma, diktovka). `tests/matter-commands.test.js` (6): test
  fayllaridagi 6 384 ta satrdan birortasi buyruq deb olinmadi.
  `tests/matters.db.test.js`ga route testi qo'shildi (8). Ilova 1280 / 390
  px'da Chromium soxta mikrofoni bilan tekshirildi (STT stub). Haqiqiy
  Telegram va haqiqiy STT bilan sinalmagan.
- 2026-10-28: #497 (PR-D) va #498 (PR-V) merge. #498 PR-D ustiga qurilgani
  uchun squash'dan keyin konflikt berdi; PR-V commit'i yangi staging ustiga
  cherry-pick qilinib, CI'dan qayta o'tkazildi.
- 2026-10-28: PR-E ochildi: harness grafi (qadam `after`ga ko'ra, bir
  vaqtda <= 3), `ask_user` vositasi va `needs_input`dan davom etish
  (birlik qaytariladi, javob bilan qayta band qilinadi). Test ikki qadam
  bir vaqtda tugaganda natija yo'qolish xatosini topdi (tuzatildi).
  `agent-planner.test.js` 12, `agent-planner.db.test.js` 6 ta test.
- 2026-10-28: #499 (PR-E) merge. Egasining skrinshoti: ovozli "Yangi ish
  och." nomsiz edi - #500 nomni so'raydigan qildi.
- 2026-10-28: PR-F ochildi: botda "agent: <topshiriq>" (matn yoki ovoz) ->
  reja va narx tugmalari -> bitta status xabari qadamlar bilan yangilanadi
  -> javob; agent savoli chatga keladi, keyingi xabar javob ("yo'q" ham
  javob, faqat "bekor" to'xtatadi). Planner servisga ajratildi (web va bot
  bir xil). Chat va xabar run qatorida, deploy'dan keyin ham shu chatga
  yoziladi. Haqiqiy Telegram bilan sinalmagan.
- 2026-10-28: #500 (nomsiz "yangi ish och") va #501 (PR-F) merge; #502
  (frontend): mikrofon yozayotganda qizil nuqta, ovoz balandligi ustunlari
  va vaqt (chat va Ishlar buyruq satri), soxta mikrofon bilan tekshirildi.
- 2026-10-28: PR-G ochildi: 24 ta sintetik holat (hammasi
  `reviewed: false`), AI'siz baholovchi, runner (dry standart; jonli -
  server API orqali master sessiyasi, run sha tasdig'i bilan). Yurist
  ko'rib chiqmaguncha sifat haqida xulosa yo'q.
- 2026-10-28: #503 (PR-G) merge. 2-bosqich, jadval PR ochildi:
  - 100 tagacha hujjat. Run faqat ustunlar va har hujjatning savollarga mos
    qismlarini saqlaydi; har 10 hujjat alohida qadam (checkpoint).
  - Run'ning o'z chegaralari: hujjat soni + 8 chaqiruv, har hujjatga $0.05
    (kamida $1), 15 s (20 daqiqagacha).
  - Chegara yoki bekor qilish o'rtada to'xtatsa, o'qilgan qatorlar
    ko'rsatiladi va haqi olinadi, qolganining birliklari qaytariladi.
  - Tanlov ustuni (2-8 variant). Variantdan tashqari javob "Topilmadi"
    bo'ladi.
  - Qator teglari run natijasida saqlanadi (`PUT /api/agent/runs/:id/tags`).
  - Excel (Jadval, Iqtiboslar, Izoh).
  - Sahifa: fayllar 3 tadan o'qiladi; 10 dan ortiq hujjat fonda ishlaydi,
    `#/jadval/<runId>` bosqichlarni ko'rsatadi; teglar bo'yicha filtr.
  - Brauzerda 1280 va 390 px'da tekshirildi, AI javobi bazaga tayyor
    yozilgan. Haqiqiy AI bilan 100 hujjat sinalmagan: vaqt va narx
    o'lchanmagan.
- 2026-10-28: #504 (jadval) merge. Word playbook PR ochildi:
  - Word va Google Docs panelida "Playbook" bloki: tayyor yoki o'z playbook
    tanlanadi, shartnoma saytdagi xizmatga yuboriladi (tahlil birligi
    shartnoma hajmiga qarab).
  - Farq, yo'q va noaniq qoidalar hoshiyada izoh bo'ladi. Iqtibosi server
    topgan "farq" bandi uchun taklif Track Changes bilan kiritiladi.
  - Qoida izohda "Qoida:" deb yoziladi, hech qachon "Asos:" emas: playbook
    qonun emas.
  - "Ishga saqlash": mavjud ishga yoki yangi ishga.
  - Panel tokeni ochadigan yangi yo'llar: `GET /api/playbooks`,
    `POST /api/agent/playbook-review`, `GET /api/agent/runs/:id`,
    `GET/POST /api/matters`, `POST /api/matters/:id/items`.
  - Token so'rovi same-origin tekshiruvidan o'tadi: brauzer tokenni o'zi
    yubormaydi, shuning uchun uni boshqa saytdan soxtalashtirib bo'lmaydi.
  - Brauzerda 320 va 450 px'da soxta hujjat muhiti bilan tekshirildi.
    Haqiqiy Word va Google Docs'da sinalmagan.
- 2026-10-28: #505 (Word playbook) va #506 (ovozli buyruq tasdig'i, glossariy)
  merge; #507 ochildi (har akkauntning o'z glossariysi). Ish eksporti PR
  ochildi:
  - Ish sahifasida "Yuklab olish: PowerPoint / Excel".
  - Taqdimot faqat ishda bor narsadan yig'iladi: muqova, tarkib, yozuvlar,
    har bog'langan natija (jadval, playbook, da'vo loyihasining asosi,
    agent javobining Xulosasi), chatlar. Oxirgi slayd: bu AI material,
    yakuniy xulosa emas.
  - Excel: ish, elementlar, har jadval va playbook natijasi alohida varaqda.
  - AI chaqirilmaydi, birlik yechilmaydi. Ish ko'ruvchisi ham yuklab oladi,
    begonaga 404.
  - PPTX `jszip` bilan yig'iladi: `pptxgenjs` npm'dagi "https" paketiga
    bog'liq, shuning uchun qo'shilmadi.
  - `python-pptx` o'qidi, LibreOffice Impress ochdi va PDF'ga aylantirdi.
    Haqiqiy PowerPoint'da ochib ko'rilmagan.
- 2026-10-28: #507 (shaxsiy glossariy, migratsiya 021) va #508 (ish taqdimoti
  va Excel) merge. #507 CI'da Workspace to'plami yiqilgan edi: migratsiyalar
  ro'yxatini tekshiradigan testga 021 qo'shilmagan; qo'shildi. #508 #507
  ustiga rebase qilindi (versiya qatorlari). Adaptiv akkaunt dizayn hujjati
  ochildi (`docs/design/adaptiv-akkaunt.md`, egasining savollari 9-bo'limda).
- 2026-10-28: #509 (adaptiv dizayn) merge. Egasining javoblari: standart
  yoqiq, A/B ha, yurist navbatini egasi ko'radi (haftasiga 5 soat), firma
  profili ha, Telegram ha. Signallar ro'yxati va muddat A1 PR'ida ko'rsatildi.
  A1 PR ochildi:
  - migratsiya 022 (`user_signals`, `user_profile`), `src/adaptive/profile.js`;
  - veb-chat (javob yuborilgandan keyin), Telegram (bog'langan akkaunt) va
    agent run'lari signal yozadi;
  - profil AI'siz hisoblanadi, 180 kundan eski signallar o'chadi, akkaunt
    o'chirilganda profil ham o'chadi;
  - `GET /api/adaptive/profile` faqat o'qish uchun. Profil hali hech qayerda
    ishlatilmaydi.
- 2026-10-28: #510 (A1) merge. A2 PR ochildi:
  - `#/moslashish` sahifasi: JuristAI biladigan sohalar, aktlar va xizmatlar
    (har birini olib tashlash yoki qaytarish mumkin);
  - javob uzunligi, alifbo, odamning o'z tarafi (sohaga qarab, faqat odam
    tanlaydi);
  - oxirgi 30 signal jadvali, to'xtatish va hammasini tozalash.
  - Brauzerda 1280 va 390 px'da tekshirildi.
- 2026-10-28: #511 (A2, "Moslashish" sahifasi) va #512 (yangi lotin alifbosi,
  OʻRQ-1184: standart yangi, eski tanlov bilan; Golos Text'dagi Ğ breve
  xatosi tuzatildi) merge. #512 #511 ustidan rebase qilindi.
- 2026-10-28: #507-#513 merge (glossariy, ish eksporti, adaptiv A1/A2,
  2026 alifbosi, CustDev pilot 1-2-bosqich). Egasi: "Workspace ni barcha
  tarif uchun och" va pilot uchun 1-variant. Yangi PR: migratsiya 025 -
  Workspace'ni har qanday faol pullik tarif (Silver, Gold, Platinum) egasi
  ochadi; `workspaces.internal` - master tarifsiz ochadigan ichki (xodimlar)
  Workspace, a'zolari faqat master / student / lawyer, mijoz hech qachon
  a'zo bo'lmaydi, bayroq yaratilgandan keyin o'zgarmaydi.
- 2026-10-28: #514 merge (Workspace hamma pullik tarifga, ichki Workspace).
  #515 ochildi: mijoz turi va bir bosishda pilot (migratsiya 026), CustDev
  3-bosqich - pilot Workspace vazifalari va Telegram fikrlari (027), 4-bosqich -
  rozilik bilan intervyu yozuvlari (028).
- 2026-10-28: #515 merge (mijoz turi, CustDev 3-4-bosqichlar). Ma'lumot
  himoyasi 1-bosqich dizayni ochildi (`docs/design/shifrlash-1-bosqich.md`).
- 2026-10-29: #516 (ma'lumot himoyasi dizayni, qabul qilindi), #517 (hujjat
  tayyorlash: suhbatga qaytish, fayldan shablon) va #518 (E1, shifrlash
  moduli) merge. E2a PR: "Hujjatlarim" (har bir yuklangan hujjat egasi
  o'chirmaguncha) va shifrlangan saqlash.
