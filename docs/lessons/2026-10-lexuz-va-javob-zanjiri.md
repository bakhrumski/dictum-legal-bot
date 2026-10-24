# Saboqlar: lex.uz qidiruvi, javob zanjiri va Telegram bot (2026-yil oktabr)

Bu hujjat 2026-yil 22–24-oktabrda jonli botda topilgan muammolar, ularni
**qanday o'lchab topganimiz** va qabul qilingan qarorlarni bir joyga yig'adi.
Maqsad: keyingi ishlab chiquvchi (yoki Hermes) xuddi shu xatolarni
takrorlamasligi va shu o'lchovlarni qayta o'tkaza olishi.

Bu yerdagi raqamlar o'sha kungi o'lchovlar: lex.uz o'zgarsa, ular ham
o'zgaradi. Shubha bo'lsa, qayta o'lchang (pastdagi "Qanday o'lchash" bo'limi).

Bog'liq PR'lar: #476 (vaqt chegarasi), #477 (so'rovlar), #478 (buyurtma
holati), #479 (/testmode loyiha), #480 (xotira), #481 (javob tuzilmasi).

---

## 1. Lex.uz qidiruvi qanday ishlaydi (jonli sinab topilgan)

Qidiruv manzili: `https://lex.uz/search/nat?Query=...`. Sahifaning o'z
formasi quyidagi parametrlarni yuboradi (`query`, `searchtitle`, `status`,
`form_id`, `lang`, `actnum`, `exact`, ...).

| Kuzatuv | Misol (2026-10-22) |
|---|---|
| Yonma-yon turgan **2–3 so'zni** topadi; 4+ so'zli ibora yoki gap deyarli doim **0** beradi | "avans to'lovini qaytarish majburiyati" → 0; "avans to'lovini" → 17 |
| So'z o'zagini taniydi | "pudratchi avansni" = "pudratchi avans" (9 ta) |
| Shikoyatdagi **tuslangan fe'lni topmaydi**, qonundagi shaklni topadi | "bajarmadi", "qaytarmayapti" → 0; "ishni bajarmaslik" → 33 |
| Natijalar **sana bo'yicha** (eng yangisi birinchi), dolzarbligi bo'yicha emas | "Fuqarolik kodeksi" matn qidiruvida kodeks chiqmaydi |
| **Hujjat turi filtri** (`form_id`) kerakli kodeksni bir necha natija ichiga tushiradi | "pudratchining javobgarligi" + Kodeks → faqat FK (ikkinchi qism) |
| `status=Y` — faqat amaldagi hujjatlar | o'z kuchini yo'qotganlar keyin baribir tashlanardi |
| Matn so'rovi **100 belgigacha** (sahifa formasi undan uzunini rad etadi) | |

`form_id` qiymatlari (sahifadagi ro'yxat): Kodeks **3964**, Qonun **3968**,
Farmon 3973, Qaror 3972, Konstitutsiya 4131. Nizom (487), Qoidalar (488),
Yo'riqnoma (489) filtrlari "pudrat shartnomasi", "ish haqi" kabi so'rovlarga
**0** qaytardi: nizomlar odatda qarorga ilova bo'lib, alohida tur sifatida
indekslanmaydi. Ularni "<2 so'z> nizom" ko'rinishida qidirish ishlaydi
("ish haqi nizom" → 62).

**Natija (#477):** reja savol so'zlarini 3 tadan qidiradi. Inkor va davom
fe'llari harakat nomiga aylantiriladi (`nominalizeVerb`: "bajarmadi" →
"bajarmaslik"). Kodeks va qonunlar alohida, filtr bilan qidiriladi. AI
rejalashtiruvchiga ham shu qoidalar aytiladi. 0 natijada ibora boshidagi va
oxiridagi ikki so'z bilan bir marta qayta qidiriladi, bog'lovchilar
tashlanadi. O'lchov: 10 savolda eski reja 110 qidiruvdan **0** tasida,
yangisi 128 tadan **110** tasida hujjat topdi.

**Ochiq muammo:** sana tartibi tufayli saqlangan hujjatlar orasida mavzuga
aloqasiz yangi qarorlar ham bo'ladi (2026-10-24 sinovida "Atom
energiyasidan foydalanish..." kabi). Ular so'z mosligi tekshiruvidan o'tib
qolyapti. Javob modeliga ular kontekst sifatida boradi.

## 2. Xotira: 512 MB instance

Render'dagi juristai-staging instance'ida **512 MB** bor. #477 dan keyin
qidiruvlar hujjat topa boshladi va bitta savol uchun 63 ta sahifa (~60 MB
HTML) **parallel** yuklandi. Lokal o'lchovda jarayon 57 → **515 MB** ga
o'sdi. 2026-10-24 13:05 da Render "Instance failed" qayd etdi, javob
kelmadi.

Sabablar:
- har bir qidiruv nomzodlarni ketma-ket, lekin 22 ta qidiruv bir vaqtda
  ishladi;
- kesh har bir hujjatning to'liq HTML'ini (0,3–1 MB) 128 tagacha saqlagan;
- V8 xotira chegarasini bilmasa, axlatni kech yig'adi.

**Natija (#480):**
- bir vaqtda ko'pi bilan 2 sahifa (`LEX_FETCH_CONCURRENCY`);
- keshda HTML yo'q, faqat matn (`LEX_DOCUMENT_CACHE_LIMIT` 64);
- bitta savolga ko'pi bilan 48 yangi sahifa (`LEX_ROUND_MAX_READS`);
- Render'da `NODE_OPTIONS=--max-old-space-size=320`.

Shu savolda: 16–18 hujjat saqlanadi, cho'qqi ~233–241 MB.

**Qoida:** qidiruvni kengaytiradigan har bir o'zgarishdan keyin
`scripts/lex-round-probe.js` bilan xotira cho'qqisini o'lchang.

## 3. Vaqt: bitta so'rov 120 soniya

`AI_REQUEST_MAX_MS` (standart 120 s, Render'da endi 240 s) o'tgach **yangi
AI chaqiruvi boshlanmaydi**. Boshlangani tugaguncha davom etadi. Zanjir
tartibi: intent → topic → qidiruv rejasi → lex.uz → javob → cross-check →
claim-check. Oxirgi ikkitasi eng oxirda turadi, shuning uchun vaqt tugasa
birinchi bo'lib ular qoladi.

Belgilari:
- javob ostida "⚠️ Bu dastlabki javob ... aniq qiymatlarni tekshiruvchi model
  ishlamadi";
- /testmode'da "🔬 Tekshiruvchi ishlamadi, sababi: ... time limit 120000 ms
  reached";
- AI so'rovlar jadvalida `cross_check` / `claim_check` → `skipped · REQUEST_BUDGET`.

**Natija (#476):** lex.uz bosqichi so'rov vaqtidan ko'pi bilan
`AI_REQUEST_MAX_MS − LEX_ANSWER_RESERVE_MS` (60 s) oladi. Bitta sahifaga 30 s
kutiladi (`LEX_FETCH_MAX_MS`). Egasining qarori: **sifat tezlikdan muhimroq**,
shuning uchun lex.uz'ga alohida qisqa chegara yo'q (`LEX_LIVE_MAX_MS` faqat
qo'yilsa).

Diqqat: tekshiruvchilar `deepseek/deepseek-flash-thinking` modelida
ishlaydi, uning bitta chaqiruviga 240 s ruxsat bor
(`DEEPSEEK_THINKING_TIMEOUT_MS`). Boshlangan tekshiruv javobni shuncha
kechiktirishi mumkin.

## 4. "AI so'rovlar" jadvalini o'qish

Boshqaruv → AI so'rovlar → so'rov. Har qator bitta AI chaqiruvi.

| Ko'rinish | Ma'nosi |
|---|---|
| `retrieval_plan` dan keyin hech narsa yo'q, javob kelmagan | jarayon lex.uz bosqichida to'xtagan; Render Events'da "Instance failed"ni qidiring (2-bo'lim) |
| `answer` bor, `cross_check` / `claim_check` `skipped · REQUEST_BUDGET` | vaqt tugagan (3-bo'lim) |
| AI qatorlari yig'indisi ~30 s, lekin so'rov 120 s ga yetgan | vaqt AI'dan tashqarida ketgan (lex.uz yuklash) |
| Bir xil `request_id` boshqa vaqtdagi savolga ko'rsatilgan | eski so'rov ochilgan; vaqt ustunini tekshiring |

Render loglarida `[LEX-LIVE] ... documents from lex.uz (N ms)` har bir
qidiruv vaqtini, `[FETCH-LEX] Downloaded N KB` esa sahifa hajmini
ko'rsatadi.

## 5. Javob tuzilmasi (#481, egasining qarori)

Ikki bo'lim:
- **Tahlil** — hal qiluvchi normadan boshlanadi (hujjat nomi, raqami,
  moddasi va `> «...»` iqtibos), keyin uni vaziyatga qo'llaydi. Har bir
  norma bir marta keltiriladi.
- **Xulosa** — 1–2 gap: javob va keyingi qadam. Tahlilni takrorlamaydi.

Alohida "Huquqiy asos" bo'limi yo'q, chunki u Tahlil va Xulosa bilan
takrorlanardi (2026-10-24 javobida 642-modda uch marta bayon qilingan). Qoida
barcha javob prompt'larida bor; `tests/answer-layout.test.js` uni qo'riqlaydi.

## 6. Telegram va Render sozlamalari

- **Bot tokenlari.** @yuristga_savolbot (asosiy) va @juristAI_registration_bot
  juristai-staging'da turadi. Eski "JuristAI" (main) servisida bot tokeni
  bo'lmasligi kerak. 2026-10-22 gacha asosiy bot eski kodda ishlab turgan:
  staging esa `LEGAL_BOT_USERNAME=juristai_test_bot` bilan test botida edi.
  Belgisi: botda `main` kodidagi eski matnlar chiqadi.
- **Hujjat buyurtmasi holati.** "Da'vo arizasi" tanlangach bot tafsilotni
  30 daqiqa kutadi (`DOC_INTAKE_TTL_MIN`) va "❌ Bekor qilish" tugmasi bor
  (#478). Oldin muddat yo'q edi: 2,5 soatdan keyin berilgan huquqiy savol
  buyurtma tafsiloti deb olingan.
- **/testmode.** Master'ga savollar va AI loyiha (da'vo agenti) bepul
  beriladi, xarajat $5 test byudjetidan (#479). Sinovni boshlashdan oldin
  `/start` bilan eski holatni tozalang.
- **Render'da qo'yilgan o'zgaruvchilar** (qiymatlar git'da yo'q):
  `AI_REQUEST_MAX_MS=240000`, `NODE_OPTIONS=--max-old-space-size=320`,
  bot tokenlari, `LAWYER_COMMISSION_PCT`, Hermes soya rejimi o'zgaruvchilari.

## 7. Qanday o'lchash

```bash
# lex.uz bosqichi: vaqt, xotira cho'qqisi, sahifalar, saqlangan hujjatlar
LEX_PROBE_TERMS="pudratchining javobgarligi|avans to'lovi" \
  node --max-old-space-size=320 scripts/lex-round-probe.js \
  "Pudratchi ishni bajarmadi, avansni qaytarmayapti" fuqarolik
```

`LEX_PROBE_TERMS` AI rejalashtiruvchining o'rnini bosadi (bu yerda AI
chaqirilmaydi). Faqat lex.uz'ga murojaat qiladi. Skript server tomonidan
yuklanmaydi.

Lex.uz'ning o'zini qo'lda tekshirish: brauzerda
`https://lex.uz/search/nat?query=<so'zlar>&status=Y&form_id=3964` ni oching.

## 8. Umumiy saboqlar

1. **Tuzatishdan oldin o'lchang.** Uchta gumon o'lchovdan keyin noto'g'ri
   chiqdi: "deploy yetib kelmagan", "thinking model 240 s kutayapti" va
   tokenlar bir xil degan taxmin. Haqiqiy sabab har safar jadval, log yoki
   jonli takrorlashda ko'rindi.
2. **Bitta tuzatish keyingi muammoni ochadi.** Qidiruv yaxshilandi (#477) →
   hujjatlar ko'paydi → xotira tugadi (#480). Qidiruv yoki kontekst hajmini
   oshiradigan har bir o'zgarishdan keyin xotira va vaqtni o'lchang.
3. **Javob zanjiri (`/api/legal-chat` va Telegram) faqat egasining roziligi
   bilan o'zgaradi.** Har o'zgarish alohida PR, test va CLAUDE.md'da qayd
   bilan.
