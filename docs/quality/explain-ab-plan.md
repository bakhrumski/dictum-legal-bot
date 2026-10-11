# Hujjat tushuntirishi: birinchi A/B saralash rejasi (12 javob)

Holat: **reja va AI'siz dry-run**. Jonli sinov egasining alohida ruxsatisiz boshlanmaydi.
Bu dastlabki saralash, umumiy sifat tasdig'i emas.

## Nima uchun
Uchinchi jonli sinovning dalil jadvali (egada; repoda emas) shuni ko'rsatdi: ushbu namunadagi ko'p yo'qotishlar yakuniy bosqichda yuz bergan, lekin dayjestda ham mustaqil xato bor. Yakuniy bosqichdagi yo'qotishlar:
- «e'lon qilingan» sharti;
- «barcha ishtirokchilar, jumladan …»;
- oqibatlar to'plami;
- KPI muddatlari;
- «ish qo'zg'atilmagan» → «deb topilmagan».

Dayjestdagi xato: «roziligisiz» → «roziligi bilan».

Lug'at yoki ogohlantirish qo'shish asosiy yechim sifatida qaralmaydi. Reja ikki savolni ajratib tekshiradi: yakuniy modelning o'zi ta'sir qiladimi, va dayjest o'rniga to'liq matn ta'sir qiladimi.

## Variantlar

| Variant | Kirish | Yakuniy model |
|---|---|---|
| A | saqlangan dayjest | aisha-comet (hozirgi) |
| B | aynan o'sha dayjest | bitta kuchliroq model |
| C | to'liq matn | aisha-comet |
| D | to'liq matn | o'sha kuchliroq model |

**Kuchliroq model — tavsiya: `voicelab/aisha-halo`.**
- Provayder va adapter comet bilan bir xil, shuning uchun faqat model o'zgaradi.
- Ro'yxat narxi 3.20 / 12.70 USD (1M token uchun), `model-pricing.js`, 2026-09-23.
- Kontekst 1M — bu faqat kod izohida yozilgan, **tekshirilmagan**.
- Muqobil — `gpt-6-sol` (2 / 10 USD). U `temperature` ni rad etishi mumkin, uzun kontekst ustamasi narx jadvalida yo'q. Jonli skript hozircha faqat VoiceLab modellari bilan ishlaydi.

**Jonli sinovdan oldin tekshiriladi** (VoiceLab konsoli yoki hujjatlari orqali; token sarflamasdan):
- model identifikatori haqiqatan mavjudligi;
- joriy narx va kredit kursi;
- kontekst va chiqish chegaralari;
- yashirin reasoning bormi. Orbit ilgari butun chiqish chegarasini reasoning'ga sarflagan (2026-10-04). Halo uchun bu **noma'lum**. Shu sabab rezervga har bir javobga bitta qayta urinish kiritilgan.

## Nazoratlar
- Har bir hujjat uchun dayjest **bir marta** olinadi va `digest-<sha>.json` ga saqlanadi. A va B aynan shu dayjestni o'zgartirmasdan ishlatadi.
- Bir hujjatning to'rt variantida quyidagilar bir xil:
  - topshiriq (`explainSystem`);
  - kalit qatorlar va ularning identifikatorlari, ziddiyat nomzodlari;
  - chiqish chegarasi (3 000 token).
- Kalit qatorlar har ikki kirish shaklida bir xil tanlanadi va to'liq yuboriladi (`sameHelpers`, faqat A/B uchun). Dry-run'da A=B va C=D promptlari bayt-baytgacha bir xil, identifikatorlar soni to'rtalasida teng.
- Kirish shakli majbur qiladigan farqlar hujjatlashtiriladi: C/D da dayjest o'rniga to'liq matn, promptning boshidagi eslatma qaysi biri ekanini aytadi.
- Model qabul qilmaydigan parametr (masalan, `temperature`) majburan tenglashtirilmaydi, farqi yozib qo'yiladi. Comet va halo uchun 0.2.
- **Ko'r baholash.** Javoblar tasodifiy kodlar bilan `blind/` papkasiga yoziladi. Kalit (`key.json`) alohida saqlanadi. Model nomi va provayder yurist ko'radigan javobda yo'q.

## Hujjatlar
- 3 ta turli hujjat.
- Kamida 2 tasi prompt, lug'at yoki bashoratni sozlashda **ishlatilmagan** bo'lishi kerak. Ularni egasi beradi.
- Uchinchi sinov hujjati sozlashda ishlatilgan, u uchinchisi bo'lishi mumkin.
- Quyidagi dry-run raqamlarida ikki sintetik fixture faqat hajm o'rnini bosuvchi sifatida olingan. Ular sozlashda ishlatilgan, jonli saralashga yaramaydi.
- Hujjat matni, javoblar va kalit repoga tushmaydi: `--out` repodan tashqarida bo'lishi shart, skript buni tekshiradi.

## Baholash mezonlari (javoblarni ko'rishdan oldin yoziladi)
1. **Kalit nuqtalar.** Yurist har bir hujjat manbasidan 15–25 ta kalit nuqta va ularning muhimligini (muhim / oddiy) belgilaydi. Kamida quyidagi toifalar qamraladi:
   - kim, nimaga rozilik (rozilik bilan / roziliksiz);
   - holat va uning chegarasi (masalan, «ish qo'zg'atilmagan / ariza berilmagan» ≠ «deb topilmagan»);
   - shartlar («e'lon qilingan, lekin to'lanmagan» kabi);
   - taqsimot subyekti («barcha … jumladan …»);
   - bitta buzilishning barcha oqibatlari va ularning qo'shilishi («… dan tashqari alohida»);
   - jadval qatorlari: transh, mezon va muddat bog'lanishi;
   - muddat boshlanishi;
   - «mumkin» va «kerak» farqi.
2. **Har bir nuqtaning holati:** to'g'ri va to'liq / to'liqsiz / yo'q / buzilgan.
3. **Muhim nuqta buzilgan yoki tushib qolgan bo'lsa, javob muvaffaqiyatsiz.** Umumiy ball bunday xatoni yashirmaydi: hisobotda avval o'tdi/o'tmadi, keyin ball keltiriladi.
4. **Iqtiboslar alohida baholanadi:**
   - aniqlik — hujjatdagi matnga mosligi (server tekshiradi);
   - to'liqlik — jadval qatori to'liqmi (server tekshiradi);
   - yonidagi izohga tegishliligi va izohning to'g'riligi (yurist baholaydi).

   To'g'ri iqtibos yonidagi noto'g'ri izoh «buzilgan» hisoblanadi. Boshqa banddan olingan yoki da'voni to'liq qo'llamaydigan iqtibos alohida qayd etiladi.
5. **Qaror qoidasi (oldindan).** B, C yoki D faqat ikki shart bajarilsa A dan yaxshi hisoblanadi:
   - muhim nuqtalar bo'yicha muvaffaqiyatsiz javoblar kamayadi;
   - hech bir hujjatda natija yomonlashmaydi.

   12 javob faqat saralash beradi. Tanlangan variant keyin kengroq to'plamda tasdiqlanadi.

## Xarajat va vaqt (`node scripts/explain-ab.js --docs …`, AI'siz)
**O'lchangan** (bitta jonli sinov, comet):
- 0,345 token/belgi;
- 1 737 tokenlik javob 37,5 s da;
- dayjest tezligi ≈ 52 token/s.

**Taxmin:** dayjest hajmi bashoratdan olinadi.

**Noma'lum:**
- halo tezligi;
- halo'da yashirin reasoning bormi;
- VoiceLab kreditining haqiqiy kursi.

Dry-run (3 hujjat: uchinchi sinov hujjati ~51 ming belgi va ikki sintetik hajm o'rnini bosuvchi):

| Qism | Taxmin (javob 1 737 token) | Taxmin (javob 3 000 token) | Rezerv |
|---|---|---|---|
| 3 dayjest (bir martadan) | ≈ $0.053 | ≈ $0.053 | ≈ $0.21 |
| 6 javob, comet (A, C) | ≈ $0.047 | ≈ $0.053 | ≈ $0.26 |
| 6 javob, halo (B, D) | ≈ $0.42 | ≈ $0.51 | ≈ $2.15 |
| **Jami** | **≈ $0.52** | **≈ $0.62** | **≈ $2.63** |

- Rezerv har bir chaqiruv uchun alohida hisoblanadi: kirish UTF-8 baytlari bilan chegaralanadi, chiqish chegarasi to'liq olinadi, har bir javobga bitta qayta urinish qo'shiladi, dayjest uchun 4 ta qayta o'qish qo'shiladi.
- Rezerv narx jadvali bo'yicha **rejalash chegarasi**, kafolatlangan maksimum emas. VoiceLab kreditda hisoblaydi va kreditning token kursi tasdiqlanmagan.

**Vaqt:**
- Mashina: 3 dayjest ≈ 1–1,5 daqiqadan, 6 ta comet javobi ≈ 40 s dan, 6 ta halo javobi — noma'lum. Jami taxminan 10–20 daqiqa.
- Yurist: kalit nuqtalar ≈ 3 × 45 daqiqa, 12 javobni baholash ≈ 12 × 10–12 daqiqa. Jami taxminan 4–4,5 soat.

## Jonli ishga tushirish (faqat ruxsatdan keyin)
```
EXPLAIN_AB_LIVE=yes node scripts/explain-ab.js --docs a.docx,b.docx,c.docx \
  --strong voicelab/aisha-halo --live --budget-usd 3 --out /xavfsiz/papka
```
- Butun rezerv byudjetga sig'masa, birorta ham chaqiruv qilinmaydi.
- Har bir chaqiruv o'z chegarasini qolgan byudjetdan oldindan band qiladi. Sig'masa, chaqirilmaydi.
- Chaqiruvdan keyin haqiqiy narx band qilingan summa o'rniga yoziladi. Narx noma'lum bo'lsa, butun band qilingan summa sarflangan deb hisoblanadi.
- Natijalar faqat `--out` ga yoziladi: `calls.jsonl` (sarf, promptning sha'si), `blind/` (yurist uchun), `key.json` (alohida).
