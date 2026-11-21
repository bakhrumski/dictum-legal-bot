# Huquqiy javob etalon to'plami (audit X7, 2026-11-10)

Audit: `docs/audit/2026-11-10-audit.md`, Q3 (etalon to'plam yo'q) va G1
(agent to'plamini yurist ko'rmagan).

**Kimga nima beradi.** Egasiga va dasturchiga: javob zanjiridagi har bir
o'zgarishdan (prompt, model, qidiruv, tekshiruv) keyin "yaxshilandimi yoki
yomonlashdimi" degan savolga taxmin emas, savolma-savol ro'yxat. Yuristga:
JSON emas, Excel jadval - har savolga bir qator.

Bu raqam faqat **yurist tasdiqlagan** savollar uchun sifat haqida gapiradi.
Tasdiqlanmagan savollar texnik signal: javob keldimi, tuzilishi, tili,
tekshiruv holati.

## Tarkibi

| Fayl | Nima |
|---|---|
| `docs/quality/answer-eval/cases.json` | 67 ta sintetik savol (mehnat, oila, qarz, pudrat, ijara, meros, iste'molchi, soliq, korporativ, ma'muriy, protsess, uy-joy, yer va b.; o'zbek lotin, kirill va rus). Har birida: kutilgan aktlar, `articles` (bo'sh - yurist to'ldiradi), `mustSay` / `mustNotSay` (qoralama), `gold` (to'g'ri javobning qisqa mazmuni, bo'sh), `reviewed` |
| `scripts/lib/answer-eval-score.js` | Baholovchi. AI'siz, tarmoqsiz |
| `scripts/answer-eval.js` | Runner. Standart rejimi dry: tarmoq yo'q. `--compare` ikki hisobotni solishtiradi |
| `scripts/eval-review-sheet.js` | Yurist uchun Excel jadval: chiqarish va qaytarib o'qish (bu to'plam va agent to'plami uchun) |
| `tests/answer-eval.test.js` | Fayl, baholovchi, runner (stub server), buyruq qatori va jadvalni tekshiradi; `test:all` ichida |

Modda raqamlari taxmin qilinmagan: `articles` hamma savolda bo'sh.
`mustSay` qoralamalari ataylab umumiy ("sud", "notarius"); ular mezon emas,
yurist almashtiradi.

## Tekshiruvlar (har savol uchun)

- **`delivered`:** 200, javob bor va "huquqiy mazmun qolmadi" deb belgilanmagan.
- **`acts`:** kutilgan har bir akt javobda, uning lex.uz havolalarida, sitatorda yoki qidiruv manbalarida nomlangan.
- **`articles`:** yurist ko'rsatgan har bir modda javobda keltirilgan ("N-modda", "N-band", "статья N").
- **`structure`:** javobda **Tahlil** va **Xulosa** bor.
- **`must_say` / `must_not_say`:** kutilgan iboralar bor, taqiqlanganlari yo'q (`a|b` - a yoki b). Ikkala lotin alifbosi bir xil o'qiladi.
- **`language`:** javob savol tilida (o'zbek / rus).
- **`guard`:** da'vo tekshiruvi (claim guard): `verified` / `no_claims` o'tdi, `partial` ogohlantirish, `unverified` xato; keshdan kelgan javobda ma'lumot bo'lmasa hisoblanmaydi.
- **`quotes`:** manbada topilmagani uchun olib tashlangan iqtibos bo'lsa ogohlantirish.
- **`lex`:** lex.uz ochilmagan yoki muddatga sig'magan bo'lsa ogohlantirish (bu javob emas, infratuzilma).

Topilgan akt, modda yoki ibora faqat **so'zlar bor** ekanini bildiradi.
Javob huquqan to'g'riligini yurist aytadi: u savolning mezonlarini
tasdiqlaydi, hisobotdagi javobni `gold` bilan solishtirib o'qiydi.

## Yurist ko'rigi (keyingi qadam)

```bash
node scripts/eval-review-sheet.js --set answer --out javob-savollari.xlsx
node scripts/eval-review-sheet.js --set agent  --out agent-topshiriqlari.xlsx
```

Yurist jadvalni Excel yoki Google Sheets'da to'ldiradi ("Yo'riqnoma"
varag'ida 7 qadam): aktlar, moddalar, bo'lishi shart / bo'lmasligi kerak
iboralar, to'g'ri javobning qisqa mazmuni, "ha", ism, sana. Yangi savol -
yangi qator va yangi ID.

```bash
node scripts/eval-review-sheet.js --set answer --apply javob-savollari.xlsx          # nima o'zgaradi (yozmaydi)
node scripts/eval-review-sheet.js --set answer --apply javob-savollari.xlsx --write  # cases.json ga yozadi
```

Qator faqat "ha" + yurist ismi (javob to'plamida yana to'g'ri javob
mazmuni) bilan `reviewed: true` bo'ladi; aks holda tahrirlar saqlanadi,
lekin tasdiqlanmagan deb qoladi va sabab chiqariladi. O'zgargan
`cases.json` oddiy PR bilan kiradi.

## Ishga tushirish

**Dry rejim** (tarmoq yo'q): faylni tekshiradi, run sha va eng ko'p narxni
chiqaradi.

```bash
node scripts/answer-eval.js                      # hamma savol
node scripts/answer-eval.js --topic mehnat,oila  # mavzu bo'yicha
node scripts/answer-eval.js --reviewed           # faqat yurist tasdiqlaganlari
node scripts/answer-eval.js --only M01,F03
```

**Jonli rejim.** Ishlab turgan serverning o'z `POST /api/legal-chat`
yo'li orqali, master sessiyasi bilan, ilova so'raganidek so'raydi (lex.uz,
mavzuni server aniqlaydi, tarixsiz). Har bir AI chaqiruvini server o'zi
o'lchaydi, cheklaydi va "AI so'rovlar" paneliga yozadi. Shart: egasi dry
rejim chiqargan sha'ni tasdiqlaydi (sha savollar, manzil va parametrlarni
qamraydi).

```bash
ANSWER_EVAL_LIVE=yes ANSWER_EVAL_COOKIE='<master sessiya cookie>' \
  node scripts/answer-eval.js --live --base https://juristai.uz --approve <runSha> --out <repo tashqarisidagi papka>
```

- Savollar ketma-ket, orasida 8 soniya (`--pause-ms`); 429 kelsa bir marta kutib qayta so'raydi; 401 / 403 da to'xtaydi.
- **Kesh.** Keshdan kelgan javob - foydalanuvchi oladigan javob; hisobot uni belgilaydi. O'zgarishni o'lchash uchun yangi javob kerak: `--redact off` (yoki `on`) master'ning `X-JAI-Redact` sarlavhasini yuboradi - bunday so'rov keshni o'qimaydi ham, yozmaydi ham. E'tibor: bu sarlavha shu so'rov uchun shaxsiy ma'lumotni yashirishni yoqadi yoki o'chiradi; serverdagi `REDACT_LEGAL_CHAT` holatiga mosini tanlang.
- Savollar sintetik, ularda real shaxs ma'lumoti yo'q.

Hisobot (`answer-eval-<sana>.json` va `.md`) javoblarni o'z ichiga oladi
va repodan tashqarida saqlanadi.

**Ikki hisobotni solishtirish** (o'zgarishdan oldin va keyin, tarmoq yo'q):

```bash
node scripts/answer-eval.js --compare oldin.json keyin.json
```

Har savol va tekshiruv bo'yicha yomonlashgan / yaxshilanganlarni
chiqaradi; yurist tasdiqlagan savol yomonlashgan bo'lsa chiqish kodi 3.

## Narx

Bir savol - bitta so'rov, serverning so'rov cheklovlari ostida. Dry rejim
chiqaradigan `maxUsd` = savollar × `AI_REQUEST_MAX_COST_USD` ($0.25): 67
savol uchun $16.75. Bu rejalashtirish chegarasi, kutilgan narx ham, qat'iy
dollar kafolati ham emas (`CLAUDE.md`: so'rov byudjeti narxi noma'lum
chaqiruvni faqat soni bo'yicha cheklaydi). Haqiqiy narx "AI so'rovlar"
panelida. Hali jonli yurgizilmagan - haqiqiy narx o'lchanmagan.

## Cheklovlar

- 67 savol sintetik; real savollar taqsimotini `GET /api/admin/top-questions` ko'rsatadi - yurist ko'rigida mavzular shunga moslab to'ldirilsin.
- Baholovchi ma'noni tekshirmaydi; `mustSay` so'zi bor-yo'qligini ko'radi.
- Telegram bot javobi bu yerda o'lchanmaydi (faqat veb-chat yo'li).
- Qidiruv (retrieval) alohida to'plamda: `src/eval/gold-qa.json`.
