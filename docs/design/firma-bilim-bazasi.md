# Firma bilim bazasi: shablonlar, avvalgi hujjatlar, jamoa ko'nikmalari (dizayn)

Holat: **qabul qilingan** (egasi, 2026-11-04: "takliflaringni qabul qilaman, K1a ni boshla"). Javoblar 9-bo'limda.
Yo'l xaritasi: `docs/roadmap/legora-darajasi.md`, 3-bosqich ("Firma bilim bazasi").
Egasining topshirig'i (2026-11-04): "Keyingi bosqichni boshla!"

## 1. Nima uchun va kim nima yutadi

Bugun firmaning bilimi bir joyda emas. Har yurist o'z shablonlarini, o'z
playbook'larini va o'z "Hujjatlarim"ini saqlaydi; buni hamkasbi ko'rmaydi.
Chatdagi ko'nikmalar ("Javobga talablar") esa faqat bitta brauzerda turadi:
boshqa kompyuterda ular yo'q, jamoaga berib bo'lmaydi (ilovada "Jamoa" va
"Tashkilot" tugmalari bor, lekin "server tomoni tayyor bo'lgach ochiladi"
deb yopiq turibdi). Yurist "biz o'tgan yili shunday shartnoma tuzgandik"
degan hujjatni hamkasbidan so'raydi yoki papkalardan qidiradi.

- **Firmadagi yurist** firmaning avvalgi hujjatlaridan kerakli bandni
  so'z bilan bir necha soniyada topadi. Hujjatni, uning qaysi joyi
  ekanini va undan bir parcha ko'radi, hamkasbidan so'ramaydi.
- **Yangi yurist** birinchi kunidan firmaning shablonlari, playbook'lari va
  ko'nikmalari bilan ishlaydi; ularni qayta yozmaydi.
- **Firma rahbari** shablon yoki playbook'ni bir marta tuzatadi, va
  o'zgarish hammaga yetadi. Endi har kimda alohida nusxa qolib ketmaydi.
- **Har bir foydalanuvchi** (firmasiz ham): o'z ko'nikmalari serverda
  saqlanadi va boshqa kompyuter yoki telefonda ham chiqadi.

Nima yangi bo'lmaydi: qonun manbalari, claim guard va javob zanjiri o'zgarmaydi
(K4 alohida rozilik bilan). Firma hujjati hech qachon "qonun" deb
ko'rsatilmaydi.

## 2. Bazada hozir nima bor (2026-11-04, kod bo'yicha)

| Narsa | Qayerda | Kim ko'radi | Qidiruv |
|---|---|---|---|
| Shablonlar | `document_templates` (`src/drafting/db.js`), `owner_id` | egasi (yoki hamma — umumiy kutubxona) | yo'q |
| Playbook'lar | `playbooks` (migratsiya 018) | faqat egasi | yo'q |
| Hujjatlarim | `document_scans` (015, 029), matn shifrlangan | faqat egasi | yo'q |
| Workspace hujjatlari | `workspace_documents` / `_versions` (matn shifrlangan) | Workspace a'zolari | yo'q |
| Workspace xotirasi | `workspace_memory_items` (faqat AI javoblari, `kind='answer'`) | a'zolar | Postgres FTS (ochiq matn) |
| Chat ko'nikmalari | brauzer `localStorage jai-skills` (40 ta) | faqat shu brauzer | — |
| Embedding | faqat `legal_chunks`, `qa_korpus` | — | foydalanuvchi matni embed qilinmaydi |

Workspace rollari: owner / member / viewer (`src/workspace/authz.js`), a'zo
o'zining pullik tarifiga ega bo'lishi kerak (`requireActive`).

## 3. Asosiy qaror: "firma" = Workspace

Yangi "tashkilot" tushunchasi qo'shilmaydi. Firma bilim bazasi Workspace
ichida bo'ladi: a'zolar, rollar, pullik tarif sharti, shifrlash (E5) va
kirish jurnali (E6b) tayyor. Yakka yurist ham o'z Workspace'ini ochib, shu
bazani o'zi uchun ishlatadi (pullik tariflarda Workspace bor).

Huquqlar: **owner va member** qo'shadi, tahrirlaydi, olib tashlaydi;
**viewer** o'qiydi va ishlatadi. Har o'zgarish Workspace jurnaliga
yoziladi (kim, qachon, nima — matn emas).

## 4. Qismlar

### K1. Firma kutubxonasi: shablonlar, playbook'lar, ko'nikmalar (AI'siz)

- O'z shabloni, playbook'i yoki ko'nikmasini **"Firmaga ulashish"** tugmasi
  bilan Workspace'ga beradi. Nusxa ko'chirilmaydi: firma nusxasi alohida
  yozuv bo'ladi (`workspace_library_items`: kind template / playbook /
  skill, egasi Workspace, muallifi, versiyasi), shaxsiy nusxa esa
  o'zgarmaydi.
- Shablonlar sahifasi, Playbook sahifasi va chatdagi ko'nikmalar ro'yxatida
  "Firma" bo'limi chiqadi. U tanlangan (yoki yagona) Workspace'dan olinadi.
  Ishlatish shaxsiysini ishlatishdek: shablon to'ldiriladi, playbook bilan
  shartnoma tekshiriladi, ko'nikma javobga talab sifatida qo'shiladi.
- Ko'nikmalar serverga ko'chadi (`user_skills`): brauzerdagilar birinchi
  kirishda serverga bir marta yuklanadi va keyin hamma qurilmada chiqadi.
  Ilovadagi "Jamoa" va "Tashkilot" tugmalari ochiladi.
- Tahrir: owner / member, versiya bilan (oldingisiga qaytish mumkin).
  Cheklov: Workspace'da har turdan 200 ta (`WS_LIBRARY_MAX`).

### K2. Firma hujjatlari va qidiruv (AI'siz, matn shifrlangan)

- Hujjat qo'shish: "Hujjatlarim"dan, muharrirdan (D1) yoki Workspace
  hujjatlaridan "Firma bazasiga qo'shish" tugmasi bilan. Fayl ham, matn ham
  Workspace kaliti bilan shifrlanadi (E5 kabi). Qo'shgan odam nomi,
  qo'shilgan sana va teglar (shartnoma turi, soha, mijoz — ixtiyoriy)
  saqlanadi.
- Hujjat band bo'yicha bo'laklarga bo'linadi (`splitBands` / `selectExcerpt`
  dagi kabi, har biri 300–400 so'z). Har bo'lak shifrlangan, yonida **blind
  index** turadi: so'z ildizlarining kalitli xeshlari
  (`src/privacy/blind-index.js`, so'rovlar navbatida ishlatilgan). Shuning
  uchun baza o'qilsa ham so'zlarning o'zi ko'rinmaydi.
- Qidiruv: so'rovning so'zlari xuddi shunday xeshlanadi va hamma so'z ildizi
  bor bo'laklar topiladi. Ular ildiz soni bo'yicha tartiblanadi, bir hujjatdan
  ko'pi bilan 3 ta bo'lak olinadi. Server topilgan bo'laklarni xotirada ochadi
  va mos parchani ko'rsatadi; natijada hujjat nomi, band raqami, parcha va
  "muharrirda ochish" tugmasi bo'ladi.
- Qidiruv nimani qila olmaydi (aytib qo'yiladi): so'zning bir qismini, aniq
  ibora tartibini va xato yozilgan so'zni topmaydi; ma'nodosh so'z ham
  topilmaydi ("ijara" ↔ "arenda"). Buni K5 (embedding) hal qiladi.
- Band banki (ixtiyoriy, K2 ichida): muharrirda belgilangan matnni
  **"Bandni firmaga saqlash"** bilan saqlab qo'yish va boshqa hujjatga
  muharrirning "Firma bandlari" panelidan qo'yish.
- Cheklov: Workspace'da 2 000 hujjat va 2 GB (`WS_KB_MAX_DOCS`,
  `WS_KB_MAX_BYTES`; tarifga bog'lash 9-bo'limdagi savol). Narx: qo'shish va
  qidiruv bepul (AI yo'q). Skanerlangan hujjat avval mavjud OCR qadamidan
  o'tadi, u odatdagidek pullik.

### K3. Workspace AI firma bazasidan foydalanadi (javob zanjiri emas)

- Workspace AI'ga savol berilganda, oddiy kontekstga qo'shimcha ravishda K2
  qidiruvi topgan 3–5 bo'lak (≤ 8 000 belgi) beriladi. Ular "FIRMA HUJJATI
  (qonun emas)" belgisi bilan alohida blokda turadi. Javobdagi iqtibos
  so'zma-so'z tekshiriladi va havolasi firma hujjatining o'sha joyini ochadi.
- `/api/legal-chat` va Telegram javobi o'zgarmaydi. Lekin Workspace AI ham
  huquqiy savolga javob beradi, shuning uchun K3 ham alohida rozilik bilan
  qilinadi (9-bo'lim, 4-savol).
- Narx: Workspace AI savoli odatdagidek bitta chat birligi; kontekst biroz
  uzayadi (DeepSeek'da bir javobga ~$0,001 qo'shimcha).

### K4. Oddiy chatda "Firma bazasi bo'yicha" (keyin, alohida rozilik bilan)

Chatdagi manbalar tanlovida (`databases`) "Firma bazasi" bandi bo'ladi.
Tanlansa, javob qonun manbalari bilan birga firma hujjatlarini ham ko'radi,
ular alohida belgilanadi. Bu `/api/legal-chat`ni o'zgartiradi, shuning uchun
avval K3 natijasi ko'riladi.

### K5. Ma'no bo'yicha qidiruv (embedding) — hozircha yo'q

So'z bilan qidiruv ma'nodosh so'zni topmaydi. Embedding buni hal qiladi,
lekin unda firma hujjatlarining matni embedding provayderiga (HF / Google /
OpenAI) yuboriladi va bazada vektor bo'lib saqlanadi (vektor matnning
ma'nosini qisman ochib beradi). Shuning uchun K2 qanday ishlashini o'lchab
ko'rgandan keyin, egasi va firma rozi bo'lsa, alohida dizayn bilan qilinadi.

## 5. Nima qilinmaydi

- Firma hujjati boshqa firmaga ham, platformaning umumiy korpusiga ham
  qo'shilmaydi, va undan "o'qitish" (fine-tuning) yo'q (adaptiv akkaunt
  dizaynidagi qoida).
- Mijozning shaxsiy "Hujjatlarim"i o'zi bosmaguncha firmaga o'tmaydi.
- Firma hujjati qonun manbasi deb ko'rsatilmaydi, citator va monitoringga
  kirmaydi.
- Hujjat matni brauzerga to'liq qaytarilmaydi: qidiruvda faqat parcha
  beriladi, to'liq ko'rish esa muharrir yoki yuklab olish orqali, huquq
  bo'yicha.

## 6. Xarajat

- K1, K2: AI yo'q. Saqlash: shifrlangan matn va indeks. 2 000 hujjat
  taxminan 100–300 MB (fayllar alohida, Storage'da).
- K3: mavjud Workspace AI chaqiruvi, kontekst ≤ 8 000 belgi qo'shiladi.
- K5: o'lchanmagan; alohida.

## 7. PR tartibi

| PR | Nima | Tegadi | Rozilik |
|---|---|---|---|
| K1a | Ko'nikmalar serverda (`user_skills`), qurilmalar o'rtasida | src, migrations, public | so'rayman |
| K1b | Firma kutubxonasi: shablon, playbook, ko'nikma ulashish | src, migrations, public | so'rayman |
| K2a | Firma hujjatlari: qo'shish, shifrlash, bo'laklar, blind index | src, migrations | so'rayman |
| K2b | Qidiruv sahifasi va muharrirdagi "Firma bandlari" | src, public | so'rayman |
| K3 | Workspace AI firma bazasi bilan | Workspace AI | **alohida rozilik** |
| K4 | Chatda "Firma bazasi" | `/api/legal-chat` | **alohida rozilik** |

## 8. Tekshiruv va xavflar

- Kirish: boshqa Workspace a'zosi va a'zo bo'lmagan odam 404 oladi; viewer
  qo'sha olmaydi (403). Testlar DB'da.
- Qidiruv: 30 ta sintetik hujjat (shartnoma, da'vo, ariza) va 20 ta so'rov
  bilan nima topilgani va nima topilmagani sanaladi. Ma'nodosh so'zlar
  alohida yoziladi.
- Xavf: blind index ildizlarning takrorlanish chastotasini ochadi (so'zni
  emas). Bu E6 dagi bilan bir xil va o'shanda qabul qilingan.
- Xavf: firma a'zosi ketganda u qo'shgan hujjatlar firmada qoladi (firmaniki).
  Shaxsiy nusxasi o'zida qoladi.

## 9. Egasiga savollar

Javoblar (2026-11-04, egasi: "558 ni merge qil, takliflaringni qabul qilaman"):
1. Firma = Workspace.
2. Owner va member qo'shadi va tahrirlaydi, viewer o'qiydi va ishlatadi.
3. Qidiruv avval so'z ildizlari bo'yicha (K2), embedding (K5) keyin, o'lchovdan so'ng.
4. K3 ga rozilik berildi (Workspace AI firma hujjatlarini "qonun emas" belgisi bilan ko'radi). K4 alohida so'raladi.
5. Cheklov: hammaga bir xil, Workspace'da 2 000 hujjat / 2 GB.
6. Tartib K1a → K1b → K2a → K2b → K3.

K1a (2026-11-04, migratsiya 044, `src/skills/routes.js`): ko'nikmalar
`user_skills` jadvalida (matni shifrlangan, AAD `user_skills.ins:<id>`), har
odamga 40 ta (`SKILLS_MAX`), faqat o'ziniki (boshqaniki 404); brauzerdagi
ro'yxat birinchi kirishda bir marta ko'chiriladi (`/api/skills/import`,
brauzer id'si `client_id` sifatida saqlanadi, takrorlansa hech narsa
qo'shilmaydi); server bo'lmasa (`SKILLS=off`) brauzerdagi ro'yxat avvalgidek.

K1b (2026-11-04, migratsiya 045, `src/workspace/library.js`): firma
kutubxonasi `workspace_library_items` jadvalida (tur: shablon / playbook /
ko'nikma, matn shifrlangan, AAD `workspace_library.content:<ws>:<id>:<v>`),
har o'zgarish oldingi versiyani `workspace_library_versions` da saqlaydi
(oxirgi 20 ta, qaytarish mumkin), eski oynadan yozish 409. O'z elementini
ulashishda server uni egasining jadvalidan o'qiydi (boshqaniki 404); bitta
element bitta Workspace'ga bir marta ulashiladi (qayta urinish 409, "firmadagi
nusxani tahrirlang"). Owner / member yozadi, viewer o'qiydi va ishlatadi,
begona 404; Workspace faol bo'lmasa (owner'ning tarifi tugagan) ko'rinmaydi.
Jurnal (`workspace_activity_log`) kim va qachon yozganini saqlaydi, matnni
emas. Ishlatish: ko'nikma - chatdagi "/" menyusi va "Jamoa" yorlig'i;
playbook - Playbook sahifasidagi "Firma" bo'limi, tekshiruvga qoidalari bilan
yuboriladi; shablon - Hujjat tayyorlash sahifasidagi "Firma" yorlig'i,
`ws:<id>` bilan ochiladi va eksport qilinadi (a'zolik serverda tekshiriladi).
Har turdan 200 ta (`WS_LIBRARY_MAX`), `WS_LIBRARY=off`.

K2a (2026-11-04, migratsiya 046, `src/workspace/kb.js`, AI'siz): firma
hujjatlari `workspace_kb_documents` (matnsiz: nomi, manbasi, hajmi, teglar)
va `workspace_kb_chunks` (bandlar, har biri shifrlangan, AAD
`workspace_kb_chunks.text:<ws>:<doc>:<n>`, yonida so'z ildizlarining blind
indeksi). Member va owner Hujjatlarimidagi o'z hujjatini, o'qiy oladigan
muharrir hujjatini yoki shu Workspace hujjatini qo'shadi. Qo'shilgan paytdagi
matn saqlanadi, manbaning keyingi o'zgarishi kuzatilmaydi. Bir xil matn
ikki marta qo'shilsa, 409 qaytadi. Matn band raqami va xatboshi bo'yicha
~2 000 belgilik bo'laklarga bo'linadi. Sahifa belgilari saqlanadi, lekin
ko'rsatilmaydi: natijada so'z turgan sahifa va band raqami beriladi. Qidiruv
avval hamma so'z ildizi bor bandlarni, kam bo'lsa yarmi bor bandlarni
("qisman") beradi. Bir hujjatdan ko'pi bilan 3 ta, jami 30 ta. Viewer
qidiradi va o'qiydi, qo'sha olmaydi. Begona 404 oladi. Cheklov: 2 000
hujjat va 2 GB matn (`WS_KB_MAX_DOCS`, `WS_KB_MAX_BYTES`). `DATA_KEYS`
bo'lmasa, matn ochiq saqlanadi va qidiruv `ILIKE` bilan ishlaydi.
`WS_KB=off` o'chiradi. UI (qidiruv sahifasi, "Firma bazasiga qo'shish"
tugmalari, muharrirdagi "Firma bandlari") K2b da.

K2b (2026-11-04, `public/app/firm-kb.js`):
- **Sahifa.** `#/firma` "Firma bazasi". Unda ikki yorliq bor:
  - Qidiruv: natijada hujjat, band, sahifa va parcha chiqadi; so'rov so'zlari och ko'k fonda belgilanadi; "qisman" mos kelganlar alohida ko'rsatiladi; band oynada to'liq ochiladi va undan nusxa olinadi.
  - Hujjatlar: ro'yxat. Owner yoki member "Hujjat qo'shish" bilan Hujjatlarimdan qo'shadi va kerak bo'lsa olib tashlaydi.
- **Tugmalar.** Hujjatlarimda har hujjat yonida "Firma bazasiga" tugmasi bor.
- **Muharrir.** "Firma bandlari" paneli: qidiradi, topilgan bandni kursor turgan joyga qo'yadi, shu hujjatni bazaga qo'shadi.
- **Navigatsiya.** Bo'lim Yurist va Advokatlik firmasi ko'rinishlarida va to'liq ko'rinishda bor; Sinovda qulf bilan chiqadi.

K2b paytida qidiruvga uchta o'zgarish kiritildi (sinov to'plami ko'rsatdi):
1. Kirillcha band lotinchada ham indekslanadi, so'rov esa lotinchaga o'giriladi. Lotincha so'rov kirillcha hujjatni topadi va aksincha.
2. 4 harfli so'z boshlari ham indekslanadi. Masalan, "siri" so'rovi "sirini"ni topadi.
3. Parcha so'rov so'zlari eng ko'p uchragan qatordan boshlanadi. Band va sahifa raqami ham shu qatorning o'zidan olinadi.

`DATA_KEYS` bo'lmasa, ildizlar xeshsiz saqlanadi; matn bu holda baribir ochiq turadi. Qidiruv ikkala rejimda bir xil ishlaydi.

O'lchov (`scripts/kb-search-eval.js`, `docs/quality/kb-search-eval/cases.json`: 12 sintetik hujjat, 20 so'rov, yurist hali ko'rmagan):
- kalit bilan ham, kalitsiz ham 20 tadan 19 tasi topildi;
- 17 tasida kerakli hujjat birinchi o'rinda;
- topilmagani "arenda": ma'nodosh so'z, uni K5 hal qiladi;
- "jarima kechikish" so'rovi "qisman" sifatida 2-o'rinda chiqdi;
- bitta so'rov 1–11 ms vaqt oldi.

Dastlabki savollar:

1. **Firma = Workspace** (yangi "tashkilot" tushunchasisiz) bo'lsinmi?
   Taklif: ha.
2. **Huquqlar:** owner va member qo'shadi/tahrirlaydi, viewer faqat
   o'qiydi/ishlatadi. Taklif: shunday.
3. **Qidiruv:** avval so'z ildizlari bo'yicha, shifrlangan holda, AI'siz
   (K2); ma'no bo'yicha qidiruv (embedding, K5) keyin va faqat
   o'lchovdan keyin. Taklif: shunday.
4. **K3 (Workspace AI firma hujjatlarini ko'radi)** ga rozimisiz? K4 (oddiy
   chat) esa K3 natijasidan keyin alohida so'raladi.
5. **Cheklovlar:** Workspace'da 2 000 hujjat / 2 GB hammaga bir xilmi, yoki
   tarifga qarab (masalan Silver 300, Gold 1 000, Platinum 3 000)?
6. **Tartib:** K1a (ko'nikmalar serverda) → K1b → K2a → K2b → K3. Taklif:
   K1a birinchi, chunki u eng kichigi va har bir foydalanuvchiga darhol
   foydali.
