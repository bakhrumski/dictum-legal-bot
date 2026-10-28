# Dizayn: akkaunt foydalanuvchiga moslashib boradi (adaptiv) va platforma o'zini yaxshilaydi

Holat: **loyiha**, 2026-10-28. Egasi 9-bo'limdagi savollarga javob bermaguncha
kod yozilmaydi. Yo'l xaritasi: `docs/roadmap/legora-darajasi.md`, 3-bosqich.

Egasining so'zi (2026-10-28): *"akkauntdagi AI-chatbot, hujjatlar, Workspace va
boshqa barcha featurelar adaptive bo'la olishi, ya'ni akkaunt qancha ko'p
ishlatilsa userga moslashib boraveradi, self-improvement ham qiladi."*

Bu hujjat ikki narsani ajratadi, chunki ularning xavfi har xil:

1. **Shaxsiy moslashish.** Har akkaunt o'z ma'lumotidan foydalanadi: profil,
   ish xotirasi, glossariy, standart sozlamalar. Ta'siri faqat shu akkauntga
   tegadi. Odam hammasini ko'radi va o'chira oladi.
2. **Platformani yaxshilash (self-improvement).** Ko'p foydalanuvchining
   signallaridan umumiy xatolar topiladi. Ular **yurist tasdiqlaganidan va
   baholash to'plamida o'lchanganidan keyingina** hammaga ta'sir qiladi.

Asosiy qoida: **qonun manbai va javob tekshiruvi moslashmaydi.** Profil javob
uslubini, qidiruv tartibini va standart sozlamalarni o'zgartiradi. Lekin javob
lex.uz manbasiga tayanishi, iqtibos so'zma-so'z tekshirilishi va claim guard
(`src/rag/legal-claim-guard.js`) hech kim uchun yumshatilmaydi. Model
foydalanuvchi ma'lumoti bilan qayta o'qitilmaydi (fine-tune yo'q).

---

## 1. Hozirgi holat (kod bo'yicha, 2026-10-28)

| Narsa | Qayerda | Nima qiladi |
|---|---|---|
| Javob ovozlari | `rag_answer_votes` (migratsiya 012), `src/rag/usage-feedback.js` | 👍/👎, bir akkauntga bitta ovoz. Tasdiqlangan javob ko'p 👎 olsa yurist uchun belgilanadi va so'zma-so'z berilmaydi |
| Shaxsiy glossariy | `voice_glossary` (021), `src/voice/user-glossary.js` | Ovozdan matnga aylantirishdagi tuzatishlardan o'rganadi, faqat taklif qiladi. "Lug'atim"da ko'rinadi |
| Ishlar | `matters`, `matter_items` (019) | Ish bo'yicha chat, skan, yozuv, agent natijalari |
| Agent natijalari | `agent_runs` (020) | 90 kun yoki ish bog'lab turguncha saqlanadi |
| O'z playbook'lari | `playbooks` (018) | Firma qoidalari, 30 tagacha |
| Workspace xotirasi | `workspace_memory_items` (001), `src/workspace/ai-service.js` | Jamoa javoblari va qarorlari, faqat Platinum |
| Baholash to'plami | `docs/quality/agent-eval/` (24 holat, `reviewed: false`) | AI'siz baholovchi; yurist ko'rib chiqmagan |
| AI xarajati | `llm_spend_log`, `src/ai/usage-ledger.js` | Har chaqiruv yoziladi |

Xulosa:
- Fikr-mulohaza va o'rganish bo'laklari bor, lekin **bitta profilga
  yig'ilmagan** va javob zanjiri ulardan foydalanmaydi.
- Yurist tasdig'i navbati faqat tasdiqlangan javoblar uchun bor. Umumiy
  xatolar uchun yo'q.
- Baholash to'plami bor, lekin yurist ko'rib chiqmaguncha o'lchov bo'la
  olmaydi.

---

## 2. Signallar: nima yig'iladi

Faqat platforma ichidagi harakatlar yig'iladi. Har signal qatori **matnsiz**:
savol matni yoki hujjat emas, faqat turi va qiymati. Matn chatda va ishda
qolganicha qoladi.

| Signal | Qayerdan | Nima yoziladi |
|---|---|---|
| Soha | chat va Telegram javobi (`question-aspects`, intent) | soha kodi (mehnat, ijara, soliq…) |
| Akt | javob manbalari | lex.uz hujjat id'si, akt nomi |
| Javob uzunligi | "batafsilroq" / "qisqaroq" so'rovlari, javob o'qilgan vaqti emas | qisqa / o'rta / batafsil |
| Til | yozilgan savol, interfeys tili | uz-Latn / uz-Cyrl / ru |
| Taraf | odamning o'zi tanlaydi (profil) yoki hujjat xizmatida aytadi | xaridor / sotuvchi, ish beruvchi / xodim… |
| Ovoz | 👍/👎 + sabab (yangi: "manba noto'g'ri", "eskirgan", "savolga javob emas", "tushunarsiz") | javob id'si, sabab kodi |
| Tuzatish | glossariy, jadval katagini qo'lda tuzatish, loyihani tahrirlash | qaysi xizmat, nechta tuzatish (matn emas) |
| Shablon | jadval ustunlari, playbook tanlovi, hujjat turi | id yoki ustunlar ro'yxati |

Ataylab **yig'ilmaydigan** narsalar: savol yoki hujjat matni, ismlar, summalar,
javobni o'qish vaqti va sichqoncha harakati, boshqa saytlardagi faoliyat.

Saqlash muddati: signal 180 kun. Profil signallardan qayta hisoblanadi, shuning
uchun eski odat o'z-o'zidan so'nadi (9-bo'lim, 3-savol).

---

## 3. Profil: signallardan nima chiqadi

`user_profile` jadvali, akkauntga bitta qator. AI'siz, signallardan
hisoblanadi: yangi signal kelganda va kuniga bir marta.

```
admin_id         integer PK
answer_length    'qisqa' | 'orta' | 'batafsil' | null
script           'latn' | 'cyrl' | null
party_roles      jsonb  [{ area: 'ijara', role: 'ijarachi' }]   faqat odam tanlagani
areas            jsonb  [{ code: 'mehnat', weight: 0.42 }]       eng ko'pi 8 ta
acts             jsonb  [{ docId: '6257288', title: 'Mehnat kodeksi', weight: 0.3 }]  eng ko'pi 12 ta
defaults         jsonb  { tabularColumns: [...], playbook: 'supply_buyer', draftType: 'davo' }
manual           jsonb  odam o'zi o'zgartirgan maydonlar (hisob ularni bosib ketmaydi)
paused           boolean  moslashish o'chirilgan
updated_at       timestamptz
```

Qoidalar:
- **Ko'rinadi va tahrirlanadi.** "Mening sozlamalarim → Moslashish" sahifasida
  JuristAI odam haqida "bilgan" hamma narsa oddiy tilda yoziladi. Masalan:
  "Siz ko'pincha mehnat va ijara bo'yicha so'raysiz; qisqa javobni
  afzal ko'rasiz". Har bandni o'zgartirish yoki o'chirish mumkin. "Hammasini
  tozalash" va "Moslashishni to'xtatish" tugmalari bor.
- **Taraf hech qachon taxmin qilinmaydi.** "Siz xaridorsiz" degan xulosani
  faqat odam o'zi tanlaydi: noto'g'ri taraf javobni teskari qilib qo'yadi.
- **Hisob qo'lda kiritilganni bosib ketmaydi** (`manual`).
- Akkaunt o'chirilganda profil va signallar o'chadi
  (`src/services/account-deletion.js`).

---

## 4. Moslashish qayerda ishlatiladi

Xavf darajasi bo'yicha, eng xavfsizidan boshlab:

### 4.1. Interfeys (xavfsiz, javob zanjiriga tegmaydi)
- Bosh sahifa: eng ko'p ishlatiladigan xizmatlar va ishlar birinchi.
- Jadvalli tahlil: oxirgi ustunlar to'plami taklif qilinadi; "Mening tayyor
  savollarim".
- Playbook: oxirgi tanlangan playbook standart bo'ladi.
- Hujjat tayyorlash: ko'p tayyorlanadigan hujjat turlari birinchi.
- Buyruq satri va ovoz: glossariy (bor), ishlar nomlari taklifda.

### 4.2. Ish xotirasi (matter facts)
Ishdagi faktlar (taraflar, shartnoma sanasi, summa, sud, muddat) `matter_facts`
jadvalida saqlanadi:
- **faqat odam tasdiqlagani** saqlanadi: agent taklif qiladi ("Shartnoma
  sanasi: 10.03.2026 — saqlaymi?"), odam tasdiqlaydi;
- har faktning manbasi ko'rsatiladi (qaysi yozuv yoki hujjat);
- shu ish ichidagi chat, agent va hujjat tayyorlash faktni qayta so'ramaydi;
- fakt boshqa ishga o'tmaydi.

### 4.3. Javob uslubi (`/api/legal-chat` va Telegram — egasining roziligi kerak)
Javob promptiga qisqa **"FOYDALANUVCHI PROFILI"** bloki qo'shiladi (≤ 400
belgi):
- javob uzunligi, yozuv (lotin/kirill), odam tanlagan taraf;
- blok **ma'lumot, ko'rsatma emas** deb belgilanadi va promptdagi qoidalardan
  ustun turmaydi;
- Tahlil/Xulosa tuzilishi, manba va iqtibos talablari o'zgarmaydi.

Bu yangi AI chaqiruvi qo'shmaydi. `ADAPTIVE_PROMPT=off` bilan o'chiriladi.

### 4.4. Qidiruv tartibi (javob zanjiri — egasining roziligi kerak)
Odam ko'p ishlatadigan aktlar lex.uz va korpus natijalarida biroz yuqoriga
chiqadi:
- kichik va cheklangan qo'shimcha (masalan, +5, hozirgi `code-search` +40 dan
  ancha kam);
- **hech qachon** boshqa aktni olib tashlamaydi;
- relevance hakami (`source_relevance`) va claim guard avvalgidek ishlaydi;
- akt bekor qilingan bo'lsa, qo'shimcha berilmaydi (`superseded-acts`).

Xavfi: odam doim bitta aktni ko'radi va yangi, to'g'riroq aktni ko'rmaydi
(filter bubble). Shuning uchun qo'shimcha kichik va 5-bo'limdagi o'lchov bilan
tekshiriladi.

### 4.5. Workspace (firma darajasi)
Platinum jamoada firma profili bo'ladi:
- umumiy playbook'lar, shablonlar va glossariy;
- firma ko'p ishlaydigan aktlar;
- a'zo o'z profilini saqlaydi, firma profili standart vazifasini bajaradi;
- faqat egasi (owner) firma profilini o'zgartiradi, a'zolar taklif qiladi.

---

## 5. Platformani yaxshilash (self-improvement) tsikli

```
signallar ──► yig'ma (kuniga, AI'siz) ──► nomzodlar ──► yurist navbati
                                                          │ tasdiq
                                                          ▼
                   qaytarish ◄── o'lchov (baholash) ◄── o'zgarish (qoida / pin / prompt / holat)
```

1. **Yig'ma.** Kuniga bir marta, AI'siz, `scripts/` yoki worker'da. Nomzodlar:
   - bir akt yoki modda bo'yicha "manba noto'g'ri" 👎 ko'paygan;
   - "eskirgan" deb belgilangan akt;
   - claim guard ko'p ushlagan da'vo turi;
   - ko'p javobsiz qolgan soha (manba topilmagan savollar).

   Nomzodda faqat sanoq va javob id'lari bo'ladi, shaxsiy ma'lumot bo'lmaydi.
2. **Yurist navbati** (`/app/#/boshqaruv/sifat`). Yurist javoblarni ochib
   ko'radi (faqat master va lawyer rollari), keyin qaror qiladi:
   - "noto'g'ri, to'g'risi bu";
   - "to'g'ri, signal shovqin";
   - "baholash holati qilib qo'shish".
3. **O'zgarish turlari** (hech biri o'zi qo'llanmaydi):
   - **pin:** savol turi uchun to'g'ri akt (`lex-pinned`), masalan VMQ-589
     17-band misoli;
   - **qoida:** query reja qoidasi, sinonim (`query-aliases`), eskirgan akt
     (`superseded-acts`);
   - **baholash holati:** `docs/quality/agent-eval/cases.json` ga yangi holat,
     `reviewed: true`, yurist ismi bilan;
   - **prompt** o'zgarishi faqat PR orqali, egasining roziligi bilan.
4. **O'lchov.** Har o'zgarish PR'da ko'rib chiqilgan baholash holatlarida
   o'lchanadi. Natija yomonlashsa, merge bo'lmaydi.
5. **Qaytarish.** Har o'zgarish bayroq yoki ma'lumot qatori bilan qilinadi va
   bir buyruq bilan qaytariladi.

Bu tsikl **sekin, lekin xavfsiz**. Yuridik javobda tekshirilmagan avtomatik
o'zgarish bir foydalanuvchining xatosini hammaga tarqatadi, ataylab
"zaharlash" ham mumkin.

---

## 6. Xavflar

| Xavf | Chora |
|---|---|
| Shaxsiy ma'lumot profilda | Signal matnsiz; profil ko'rinadi, tahrirlanadi, o'chiriladi; akkaunt bilan o'chadi |
| Noto'g'ri taraf taxmini | Taraf faqat odam tanlaydi |
| Filter bubble (doim bir xil akt) | Kichik qo'shimcha, hech narsa olib tashlanmaydi, o'lchanadi, o'chirish bayrog'i |
| Ovozlar bilan "zaharlash" | Bir akkauntga bitta ovoz (bor); umumiy o'zgarish faqat yurist orqali; yangi akkauntlar ovozi kam vaznli |
| Eskirgan odat | Signal 180 kun; profil qayta hisoblanadi; "tozalash" tugmasi |
| Xarajat | Profil va yig'ma AI'siz; prompt bloki ≤ 400 belgi |
| Javob sifati pasayishi | Claim guard va manba talablari o'zgarmaydi; 4.3 va 4.4 bayroq ortida, A/B bilan |
| Workspace sizishi | Firma profili faqat shu Workspace a'zolariga; a'zoning shaxsiy profili firmaga o'tmaydi |

---

## 7. O'lchov

- **Shaxsiy:**
  - 👍 ulushi, "batafsilroq/qisqaroq" so'rovlari soni;
  - glossariy tuzatishlari (kamayishi kerak);
  - jadval va playbook'ni sozlashga ketgan qadamlar.
- **Javob zanjiri (4.3–4.4):**
  - A/B: profil bilan va profilsiz;
  - ko'rib chiqilgan baholash holatlari natijasi, claim guard ushlagan
    da'volar soni, xarajat.
- **Platforma:** yurist navbatidagi nomzodlar, tasdiqlanganlar, qaytarilganlar.

Hozircha bitta ham baholash holati yurist tomonidan ko'rib chiqilmagan
(`reviewed: false`). Shuning uchun javob zanjiriga oid moslashish (4.3–4.4)
**yurist ko'rib chiqqan kamida 24 holatsiz** yoqilmaydi.

---

## 8. PR tartibi

| PR | Nima | Javob zanjiriga tegadimi |
|---|---|---|
| A1 | `user_signals` + `user_profile` (migratsiya), yig'uvchi (AI'siz), akkaunt o'chirish | Yo'q |
| A2 | "Moslashish" sahifasi: ko'rish, tahrirlash, tozalash, to'xtatish | Yo'q |
| A3 | Interfeys moslashuvi (4.1) | Yo'q |
| A4 | 👎 sabablari + yurist navbati (`boshqaruv/sifat`) + kunlik yig'ma | Yo'q |
| A5 | Ish xotirasi `matter_facts` (4.2), agent va chatda ish ichida | Agent ha, `/api/legal-chat` yo'q |
| A6 | Javob uslubi bloki (4.3), `ADAPTIVE_PROMPT`, A/B | **Ha, rozilik bilan** |
| A7 | Qidiruv qo'shimchasi (4.4), A/B | **Ha, rozilik bilan** |
| A8 | Firma profili (4.5) | Workspace AI |

A1–A4 xavfsiz va darhol foyda beradi. A6–A7 yurist ko'rib chiqqan baholash
to'plami tayyor bo'lgandan keyin.

---

## 9. Egasiga savollar (javobsiz kod yozilmaydi)

1. **Rozilik matni.** Moslashish standart holatda yoqiqmi (odam o'chira oladi)
   yoki odam o'zi yoqadimi? Tavsiya: yoqiq, birinchi kirishda bir qatorli
   xabar va "Moslashish" sahifasiga havola.
2. **Signallar ro'yxati.** 2-bo'limdagi ro'yxat yetarlimi? Biror narsani olib
   tashlash yoki qo'shish kerakmi?
3. **Saqlash muddati.** Signal uchun 180 kun to'g'rimi?
4. **Javob zanjiri (4.3, 4.4).** Yurist ko'rib chiqqan baholash to'plamidan
   keyin A/B bilan yoqishga rozimisiz? Kim baholash holatlarini ko'rib
   chiqadi va qachon?
5. **Yurist navbati.** Kim ko'rib chiqadi (siz, xodim yurist, tashqi yurist)?
   Haftasiga necha soat?
6. **Workspace.** Firma profili standart holatda yoqiqmi? Uni faqat egasi
   o'zgartiradimi?
7. **Telegram.** Bot ham shu profildan foydalanadimi? (Bog'langan akkaunt
   bo'lsa, tavsiya: ha.)
