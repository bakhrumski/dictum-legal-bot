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

**Kuchliroq model — hozircha faqat nomzod: `voicelab/aisha-halo`.**
Uni rasmiy manbadan tasdiqlab bo'lmadi: qidiruvda `aisha-halo` haqida provayder sahifasi topilmadi, `aisha.group` hujjatlariga bu muhitdan ulanib bo'lmadi. Kod izohi va ichki narx jadvali tasdiq sifatida olinmaydi. Har bir band bo'yicha holat:

| Band | Holat | Sizdan aynan kerak |
|---|---|---|
| Model identifikatori va API'da mavjudligi | **noma'lum** | VoiceLab konsolidagi LLM modellari ro'yxati (`aisha-halo` aynan shu nom bilanmi, chat completions orqali chaqiriladimi) — skrinshot yoki eksport |
| Kirish / chiqish / kesh narxi | **noma'lum**. Ichki jadvalda 3.20 / 12.70 USD (1M token uchun), kesh yo'q — bu tasdiq emas | Konsoldagi joriy tarif: 1M kirish, 1M chiqish va keshlangan kirish tokeni uchun narx (yoki kredit) |
| VoiceLab kredit hisobi | **qisman**. Xarid kursi siz tasdiqlagan: 1 200 000 kredit = $90. Halo'ning bir tokeniga necha kredit ketishi noma'lum | Halo uchun kirish va chiqish tokeniga kredit stavkasi; javobda kredit qaytariladimi |
| Kontekst va chiqish chegaralari | **noma'lum** (kod izohidagi «1M» tasdiq emas) | Maksimal kontekst va maksimal `max_tokens` |
| Yashirin reasoning tokenlari va ularning hisoblanishi | **noma'lum** (Orbit chiqish chegarasini reasoning'ga sarflagan, 2026-10-04) | Halo reasoning qiladimi; u `max_tokens` ga kiradimi; alohida hisoblanadimi; o'chirish parametri bormi |

Bu ma'lumotlarsiz jonli rejimda halo chaqirilmaydi. Jonli rejim chaqiriladigan har bir model narxini egasi `--prices-confirmed` orqali tasdiqlashini talab qiladi. Narx faqat ichki jadvalda bo'lsa, u noma'lum hisoblanadi va model chaqirilmaydi. Narxni rezervlashga yetarli ma'lumot bo'lmasa, o'sha chaqiruv boshlanmaydi.

Muqobil — `gpt-6-sol` (ichki jadvalda 2 / 10 USD). U `temperature` ni rad etishi mumkin, uzun kontekst ustamasi narx jadvalida yo'q. Jonli skript hozircha faqat VoiceLab modellari bilan ishlaydi.

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
**O'lchovlar so'rov bo'yicha alohida.** Har biri bitta hujjatning comet'dagi jonli sinovidan olingan, birlashtirilmaydi va mustaqil kalibrlash emas.

| | R1 `5c3c052e-0571-4c70-a6e6-361982965679` (2026-10-09) | R2 `504b2e59-5fe4-4727-a88e-7fd000f77b1d` (2026-10-11) |
|---|---|---|
| Yakuniy chaqiruv | 14 475 kirish / 1 737 chiqish, 37,5 s | 20 047 kirish / 1 947 chiqish, 47,7 s |
| Yakuniy prompt (trace'dan qayta tiklangan) | 41 919 belgi → 0,345 kirish-token/belgi | 54 576 belgi (kod 731d28d da) → 0,367 kirish-token/belgi |
| Butun xizmat | 12 chaqiruv, 90,9 s | 13 chaqiruv, 95,8 s |
| Dayjest tezligi | 1-qism: 1 540 token 30,0 s da (~52 token/s) | — |

- Avvalgi rejada keltirilgan «1 737 token, 37,5 s» R1 dan olingan edi.
- Dry-run endi R2 ni ishlatadi, chunki u eng so'nggi va hozirgi prompt shakliga mos. R1 faqat ma'lumot uchun ko'rsatiladi.

**Taxmin:**
- dayjest hajmi bashoratdan olinadi;
- javoblar ikki ssenariyda hisoblanadi: R2 da o'lchangan 1 947 token va 3 000 tokenlik chegara.

**Noma'lum:**
- halo tezligi;
- halo'da yashirin reasoning bormi;
- halo'ning kredit stavkasi.

**Tekshirilmagan narxlarga asoslangan ssenariy.** Halo narxi rasmiy manbadan tasdiqlanmagan: u ichki jadvaldan olingan. Shuning uchun quyidagi jami summalar ham, rezerv ham prognoz emas, faqat ssenariy. Jonli rejim narx chegarasi noma'lum modelni chaqirmaydi; shuning uchun halo ma'lumotini topish bu vositani tugatishga to'sqinlik qilmaydi, faqat halo bilan jonli sinovga to'sqinlik qiladi.

Dry-run (3 hujjat: uchinchi sinov hujjati va ikki sintetik hajm o'rnini bosuvchi):

| Qism | Javob 1 947 token | Javob 3 000 token | Rezerv |
|---|---|---|---|
| 3 dayjest (bir martadan) | ≈ $0.055 | ≈ $0.055 | ≈ $0.21 |
| 6 javob, comet (A, C) | ≈ $0.051 | ≈ $0.055 | ≈ $0.26 |
| 6 javob, halo (B, D) | ≈ $0.45 | ≈ $0.53 | ≈ $2.15 |
| **Jami** | **≈ $0.56** | **≈ $0.64** | **≈ $2.63** |

**Dollar va kredit alohida ko'rsatiladi.**
- Rezerv ro'yxat narxidagi dollarda.
- VoiceLab esa kreditda hisoblaydi. Halo'ning kredit stavkasi noma'lum, shuning uchun dollar rezervi bilan haqiqiy kredit sarfi bir xil ekanini tasdiqlab bo'lmaydi.
- Jonli rejim har chaqiruvda ikkalasini alohida yozadi:
  - qaytgan tokenlardan hisoblangan ro'yxat narxi;
  - qaytgan kreditlar va ularning xarid kursidagi dollar qiymati.
- Byudjet ikkalasining kattasi bilan yopiladi. Hech biri ma'lum bo'lmasa, butun rezerv sarflangan hisoblanadi. Rezervdan oshib ketgan chaqiruv belgilanadi.
- $2.63 — rejalash chegarasi, **kafolatlangan maksimum emas**.

**Vaqt:**
- Mashina: R2 bo'yicha bitta to'liq xizmat ≈ 96 s. 6 ta comet javobi ≈ 48 s dan. 6 ta halo javobi — noma'lum. Jami taxminan 10–20 daqiqa.
- Yurist: kalit nuqtalar ≈ 3 × 45 daqiqa, 12 javobni baholash ≈ 12 × 10–12 daqiqa. Jami taxminan 4–4,5 soat.

## Umumiy byudjet nazorati (kod va AI'siz test bilan tasdiqlangan)
Bitta byudjet obyekti quyidagilarning hammasini qamraydi: dastlabki dayjest qismlari, oldindan bo'lish, qayta o'qishlar, barcha yakuniy javoblar va har bir retry. Hammasi bitta `liveCaller` orqali o'tadi.

**Uch holat bir-biridan ajratilgan:**
1. **Chaqiruvdan oldin ishonchli narx chegarasi yo'q bo'lsa** (narx jadvalda yo'q yoki hisob faqat kreditda) — provayder **chaqirilmaydi**.
2. **Chaqiruvdan keyin usage ham, haqiqiy sarf ham kelmasa** — rezerv **bo'shatilmaydi**, band qolaveradi. Sarf «noma'lum» deb yoziladi, hech qachon raqam yoki $0 deb emas. Bu xatolik bilan tugagan chaqiruvlarga ham tegishli.
3. **Haqiqiy sarf rezervdan oshsa** — byudjet to'xtatiladi: shundan keyin yangi chaqiruv, retry yoki qayta o'qish boshlanmaydi. Oldin parallel boshlangan chaqiruvlarni qaytarib bo'lmaydi: ular oxirigacha bajariladi va yoziladi. Hisobotda bu ochiq aytiladi.

**Qolgan qoidalar:**
- Har bir urinish oldidan uning chegarasi tekshiriladi va byudjetdan ayiriladi. Bu bitta sinxron qadam, orasida `await` yo'q, shuning uchun parallel chaqiruvlar bir pulni ikki marta ishlata olmaydi.
- Retry — yana rezervlanadigan alohida urinish. U yakuniy javob chegarada kesilganda yoki xato bo'lganda qilinadi. Chegarada kesilgan dayjest qismi esa butunligicha qayta so'ralmaydi: uni `buildDigest` o'z limiti (`maxExtraCalls`) ichida ikki yarmiga bo'lib qayta o'qiydi.
- Fallback yo'q: VoiceLab modeli nomi bilan chaqirilganda boshqa provayderga o'tmaydi.
- Ro'yxat narxidagi dollar va VoiceLab krediti alohida yoziladi. Byudjet ikkalasining kattasi bilan yopiladi.
- Halo'ning kredit stavkasi noma'lum bo'lgani uchun dollar rezervi va haqiqiy kredit sarfi bir xil ekanini tasdiqlab bo'lmaydi.

**Testlar** (`tests/explain-ab.test.js`, stub provayder, AI'siz; jami 9 ta):
- 10 ta parallel chaqiruvdan faqat byudjetga sig'adigan 3 tasi provayderga boradi;
- retry uchun joy bo'lmasa, u qilinmaydi;
- narxsiz model chaqirilmaydi (1-holat);
- usage'siz javobda rezerv band qoladi va sarf «noma'lum» deb yoziladi; usage'siz xato ham shunday (2-holat);
- rezervdan oshgandan keyin yangi chaqiruv rad etiladi, oldin boshlangan parallel chaqiruv tugaydi va yoziladi (3-holat);
- butun xizmat bitta byudjetdan o'tadi, kesilgan qism qayta o'qiladi, dollar va kredit alohida yoziladi;
- dayjest o'rtasida to'xtatilsa, qayta o'qish ham, yakuniy javob ham boshlanmaydi.

## Jonli ishga tushirish (faqat ruxsatdan keyin)
```
EXPLAIN_AB_LIVE=yes node scripts/explain-ab.js --docs a.docx,b.docx,c.docx \
  --strong voicelab/aisha-halo --live --budget-usd 3 --out /xavfsiz/papka \
  --prices-confirmed voicelab/aisha-comet,voicelab/aisha-halo
```
- Butun rezerv byudjetga sig'masa, birorta ham chaqiruv qilinmaydi.
- Har bir chaqiruv o'z chegarasini qolgan byudjetdan oldindan band qiladi. Sig'masa, chaqirilmaydi.
- Chaqiruvdan keyin haqiqiy narx band qilingan summa o'rniga yoziladi. Narx noma'lum bo'lsa, butun band qilingan summa sarflangan deb hisoblanadi.
- Natijalar faqat `--out` ga yoziladi: `calls.jsonl` (sarf, promptning sha'si), `blind/` (yurist uchun), `key.json` (alohida).
