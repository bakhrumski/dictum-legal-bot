# Ovozli buyruqlar — 2-daraja (dizayn, qoralama)

Holati: **qabul qilingan** (2026-10-29, egasi barcha takliflarni qabul qildi — 9-bo'lim).
Egasi (2026-10-29): "message yozish mumkin bo'lgan joylarda ovozli komanda
orqali bajarish". 1-daraja — har bir maydonda mikrofon, gapirilgan matn
maydonga tushadi, hech narsa o'zi bajarilmaydi (#520, #529) — tayyor.
2-daraja — gapirilgan **buyruq** tanib olinadi va **tasdiqlash tugmasi**
bilan bajariladi; faqat chatda va Ishlar buyruq qatorida.

## 1. Hozirgi holat (kod bo'yicha, 2026-10-29)

| Joy | Nima bor | Fayl |
|---|---|---|
| Har bir matn maydoni | 🎙 → `POST /api/voice/dictate` (≤ 2 daqiqa, lug'at takliflari) → matn kursor joyiga; bajarilmaydi | `public/app/dictate.js` |
| Chat (composer) | o'z 🎙, matn qutiga tushadi, foydalanuvchi o'zi yuboradi | `public/app/chat.js` |
| Ishlar buyruq qatori | matn yoki 🎙 → qutiga; "Bajarish" bosilgach `POST /api/matters/command`; yopish/qayta ochish — tasdiq tokeni (10 daqiqa, bir marta); eshitilgan nom tuzatilsa lug'at o'rganadi | `public/app/matters.js`, `src/matters/commands.js` |
| Telegram | ish buyruqlari (`ish_amal`), hisob amallari (`hisob_amal`: limit, tariflar, oxirgi savollar, ulash, ilova, buyruqlar ro'yxati), "agent: …" — matn yoki ovozli xabar (STT) | `src/bot/bot.js`, `src/agents/account-tools.js`, `src/matters/commands.js` |
| Lug'at | eshitilgan so'z → atama taklifi (hech qachon almashtirmaydi), shaxsiy lug'at | `src/voice/glossary.js`, `src/voice/user-glossary.js` |

Ya'ni: buyruqlarni AI'siz tanish (qat'iy iboralar), noaniq nomni so'rash,
yozadigan buyruqni tasdiqlash — **ish buyruqlarida allaqachon bor**. 2-daraja
shu naqshni ilovaning qolgan joylariga yoyadi, yangi mexanizm o'ylab
topmaydi.

## 2. Asosiy qoidalar

1. **Gapirish hech qachon o'zi bajarmaydi.** Har bir ovozli buyruq —
   karta: "Buyruq: <nima qilinadi> · <eshitilgan matn>" va tugmalar
   **[Bajarish] [Savol sifatida yuborish] [Bekor]**. Bitta bosish.
2. **AI'siz tanish.** Faqat qat'iy, boshi-oxiri bog'langan iboralar
   (`commands.js` naqshi), ≤ 300 belgi. Huquqiy savol ("pudratchi ishini
   bajarmadi") buyruq deb olinmaydi. AI intent modeli ishlatilmaydi — xato
   bajarish narxi baland, so'rov narxi esa nol bo'lishi kerak.
3. **Noaniq bo'lsa — so'raladi, taxmin qilinmaydi.** Ikki ish bir xil
   mos kelsa yoki nom topilmasa — ro'yxat chiqadi.
4. **Pul, o'chirish va tashqariga yuborish — ovoz bilan emas.** Bular
   kartada ham chiqmaydi (3.4): ovoz faqat sahifani ochib, maydonni
   to'ldiradi; xarajat tasdig'i (`DOC_COST_CONFIRM`) va boshqa tasdiqlar
   o'z joyida qoladi.
5. **Bitta katalog.** Iboralar serverda bitta modulda
   (`src/voice/commands.js`), ilova va Telegram undan foydalanadi; ilova
   tanishni serverdan so'raydi (`POST /api/voice/command/parse`), brauzerda
   ibora ro'yxati yo'q.
6. **Ikki alifbo va rus tili.** Kirishda `toOld` + `fold` (2026 alifbosi:
   "Hujjatlarimni oç" = "Hujjatlarimni och"), rus iboralari alohida.

## 3. Buyruqlar katalogi (taklif)

### 3.1. Ochish (o'qish, hech narsa yozmaydi)

| Ibora (namuna) | Natija |
|---|---|
| "hujjatlarim", "hujjatlarimni och" / "мои документы" | `#/hujjatlarim` |
| "ishlarim" / "мои дела" | `#/ishlar` (mavjud `list`) |
| "<ish> ishini och / ko'rsat" | `#/ishlar/<id>` (mavjud `show`) |
| "hujjat tahlili", "hujjatni tahlil qil" | `#/tahlil` (hujjat tanlash shu yerda) |
| "hujjat tayyorla", "<tur> tayyorla" (ariza, shartnoma, da'vo arizasi) | `#/tayyorlash?tur=…` (faqat tur oldindan tanlanadi) |
| "jadvalli tahlil" | `#/jadval` |
| "playbook", "shartnomani qoidalar bo'yicha tekshir" | `#/playbook` |
| "yangi suhbat" / "новый чат" | yangi chat |
| "oxirgi suhbat", "suhbatlarim" | oxirgi chat / `#/suhbatlar` |
| "yozuvlarim", "yangi yozuv" | `#/yozuvlar`, `#/yozuvlar/yangi` |
| "jamoa", "workspace" | `#/jamoa` |
| "advokatlar" | `#/advokatlar` |
| "limitim qancha", "tariflar" | `#/hisob` (limit kartasi) / tariflar |
| "moslashish" | `#/moslashish` |

### 3.2. Ishlar (mavjud, o'zgarmaydi)

`yangi ish och: …`, `<ish> ishiga yozuv: …`, `<ish> ishini yop / qayta och` —
`src/matters/commands.js` dagi kabi; ovozdan kelgan "yangi ish" va "yozuv"
eshitilgandek ko'rsatiladi, lug'at taklifi ikkinchi tugma (2026-10-28 dagi
"Qudratxo'ja" holati).

### 3.3. Joriy kontekstga amal (chatda, ochiq javob ustida)

| Ibora | Natija | Mavjud funksiya |
|---|---|---|
| "javobni nusxala" | oxirgi javob buferga | chatdagi "nusxa" tugmasi |
| "Word'ga yukla", "javobni yukla" | oxirgi javob .docx | chatdagi Word tugmasi |
| "shu suhbatni <ish> ishiga biriktir" | chat → ish (`/api/matters/:id/items`) | ishga biriktirish |
| "shu hujjatni tahlil qil" | biriktirilgan hujjat bilan `#/tahlil` ochiladi, **xarajat tasdig'i o'z joyida** | hujjat tahlili oqimi |

### 3.4. Ovoz bilan hech qachon

To'lov va tarif (sotib olish, chegirma, grant), akkaunt yoki hujjatni
o'chirish, Telegram'ga / advokatga / boshqa odamga yuborish, Workspace
taklifi va rollar, Boshqaruv (master) amallari, xizmatni xarajat
tasdig'isiz boshlash. Bunday ibora tanilsa ham karta faqat sahifani
ochishni taklif qiladi: "Bu amal ovoz bilan bajarilmaydi — sahifani
ochaymi?".

## 4. Oqim

```
🎙 gapirildi → /api/voice/dictate (STT, lug'at takliflari)
   → matn qutiga tushadi (1-daraja bilan bir xil)
   → POST /api/voice/command/parse { text, place: 'chat' | 'matters', context }
        ← null                          → oddiy matn: foydalanuvchi o'zi yuboradi
        ← { kind, action, args, label, confirm: token, ask?: [...] }
   → qutining ustida karta: label + eshitilgan matn + [Bajarish] [Savol sifatida yuborish] [Bekor]
   → [Bajarish] → POST /api/voice/command/run { token }  (yoki ochish buyrug'i bo'lsa — faqat brauzerda yo'nalish)
```

- **Token**: `commands.js` dagi kabi — akkauntga bog'langan, 10 daqiqa,
  bir marta, xotirada. `run` serverda qayta tekshiradi (egalik, rol, limit).
- **Yozilgan (typed) matn**: chatda yozilgan matn **savol bo'lib
  qoladi** — karta faqat ovozdan kelgan matnga chiqadi (yozib turgan odam
  buyruq kutmaydi; "ishlarim haqida savol" kabi gaplar buzilmasin).
  Buyruq qatorida esa yozilgan ham, gapirilgan ham buyruq (hozirgidek).
- **Tuzatish**: foydalanuvchi qutidagi matnni o'zgartirsa, karta qaytadan
  so'raladi; eshitilgan nom tuzatilsa lug'at o'rganadi (mavjud
  `/api/voice/glossary/learn`).
- **Telegram**: 3.1 dagi ochish buyruqlari — ilovaning tegishli sahifasiga
  havola (bot ichida bajariladigan narsa yo'q); 3.2 va hisob amallari
  hozirgidek. Bot va ilova bitta katalogni ishlatadi.

## 5. Xavflar va ularga javob

| Xavf | Javob |
|---|---|
| Huquqiy savol buyruq deb olinadi | qat'iy iboralar; chatda faqat ovoz; har doim "Savol sifatida yuborish" tugmasi; `tests/` dagi barcha matnlar va 20 savollik to'plam ustida noto'g'ri tanish 0 bo'lishi testda tekshiriladi (`matter-commands.test.js` usuli) |
| Noto'g'ri eshitilgan nom | eshitilgandek ko'rsatish, lug'at taklifi, tasdiq; topilmasa — so'rash |
| Kimdir boshqa odamning ishini ochadi | `run` hamma narsani shu akkaunt nomidan, mavjud store qoidalari bilan bajaradi |
| Pulli xizmat ovoz bilan ishga tushadi | 3.4: faqat sahifa ochiladi, xarajat tasdig'i o'zgarmaydi |
| Buyruqlar ko'payib, bir-biriga to'qnashadi | bitta katalog, har ibora uchun test; yangi ibora qo'shishda butun to'plam qayta tekshiriladi |

## 6. O'lchov (AI'siz, matnsiz)

`voice_command_events` (yangi jadval, ixtiyoriy — 9-savol): faqat kodlar —
`action`, `place`, `outcome` (`run` / `as_question` / `cancel` / `ask`),
vaqt; **matn yozilmaydi**. Haftalik: qaysi buyruq ko'p, qanchasi
"savol sifatida" yuborildi (noto'g'ri tanish belgisi), qanchasi bekor
qilindi. Telegram'da ham xuddi shu kodlar.

## 7. PR tartibi

| PR | Nima | Tegadi |
|---|---|---|
| V1 | `src/voice/commands.js` — katalog (3.1 + mavjud 3.2), `POST /api/voice/command/parse` va `/run`; testlar: musbat iboralar (uz eski/yangi alifbo, ru), noto'g'ri tanish 0 (`tests/` dagi barcha matnlar + savollar to'plami) | src, tests |
| V2 | Chat: ovozdan keyin karta, [Bajarish] [Savol sifatida yuborish] [Bekor]; brauzerda tekshiruv | public |
| V3 | Ishlar buyruq qatori ham shu kartaga o'tadi (mavjud tasdiqlar o'z joyida) | public |
| V4 | 3.3 kontekst amallari (nusxa, Word, ishga biriktirish, tahlilni ochish) | public, src |
| V5 | Telegram: 3.1 — havolalar, bitta katalog; o'lchov jadvali (9-savolga qarab) | src, migrations |

## 8. Nimani qilmaydi

- AI bilan "erkin" buyruq tushunish (masalan, "kechagi shartnomani Akmalga
  yubor") — 1-bosqichda yo'q; kerak bo'lsa alohida dizayn.
- Ovoz bilan javob o'qish (TTS) ilovada — Telegram'da bor, ilovada bu PR'lar
  doirasida emas.
- Buyruqni brauzerda "doim tinglash" (wake word) — yo'q; faqat 🎙 bosilganda.

## 9. Egasiga savollar

Javoblar (2026-10-29, egasi: "takliflaringni qabul qilaman"):
1. 3.1 ro'yxati — shu bilan boshlanadi.
2. Ochish buyruqlari ham tasdiq tugmasini kutadi.
3. Chatda faqat ovoz buyruq bo'ladi, yozilgan matn — savol.
4. 3.3 kontekst amallari — V4 da, 4 ta amal.
5. O'lchov jadvali (`voice_command_events`, faqat kodlar) — V5 da.
6. Telegram'da ochish buyruqlari ilova havolasi bilan javob beradi.

Savollar (asl matn):

1. **3.1 ro'yxati** — shu yetadimi? Qo'shish / olib tashlash kerakmi?
   Taklif: shu ro'yxat bilan boshlash.
2. **Ochish buyruqlari ham tasdiq tugmasini kutsinmi**, yoki gapirgandan
   keyin darhol ochilsinmi? Taklif: kutsin (hamma ovozli buyruq bir xil
   ishlaydi; xato eshitilsa ham bitta bosish yo'qotiladi, xolos).
3. **Chatda yozilgan matn** buyruq bo'lmasin, faqat ovoz — rozimisiz?
   Taklif: ha.
4. **3.3 kontekst amallari** V4 da kerakmi yoki keyinroq? Taklif: V4 da,
   faqat 4 ta amal.
5. **O'lchov jadvali** (`voice_command_events`, faqat kodlar) kerakmi?
   Taklif: ha, V5 da.
6. **Telegram'da ochish buyruqlari** havola bilan javob bersinmi? Taklif: ha.
