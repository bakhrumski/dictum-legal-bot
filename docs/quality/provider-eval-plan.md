# Provayderlarni solishtirish: birinchi saralash (15 javob)

Holat: **implementatsiya, AI'siz dry-run va stub testlar**. Jonli byudjet $0. API kaliti mavjudligi pullik chaqiruvga ruxsat emas.
Bu 3 ta qisqa sun'iy hujjatdagi dastlabki saralash. Uzun hujjat, dayjest, RAG yoki umuman yuridik sifat haqida xulosa bermaydi.

## Matritsa

| Variant | Provayder | So'raladigan model | Secret | Reasoning profili | Chiqish chegarasi |
|---|---|---|---|---|---|
| baseline | VoiceLab (mavjud adapter) | `aisha-comet` | `VOICELAB_API_KEY` | parametr yuborilmaydi (hujjatlanmagan) | `max_tokens` 3000 |
| deepseek | DeepSeek | `deepseek-flash` | `DEEPSEEK_API_KEY` | o'chiq: `thinking.type=disabled` (TASDIQLANMAGAN) | `max_tokens` 3000 |
| glm | Z.AI (oddiy API, Coding Plan emas) | `glm-5.3-flash` | `ZAI_API_KEY` | yoqiq: o'chirib bo'lmaydi, `thinking.type=enabled` | `max_tokens` 8000 |
| kimi | Moonshot | `kimi-k3` | `MOONSHOT_API_KEY` | yoqiq: `reasoning_effort=low` | `max_completion_tokens` 8000 |
| qwen | Alibaba Model Studio (xalqaro) | `qwen-plus` | `DASHSCOPE_API_KEY` | o'chiq: `enable_thinking=false` (TASDIQLANMAGAN) | `max_tokens` 3000 |

3 hujjat × 5 model = 15 ta yakuniy javob. Bundan tashqari yordamchi AI chaqiruvi 0 ta, dayjest chaqiruvi 0 ta, pullik preflight 0 ta. Avtomatik qayta urinish yo'q, shuning uchun ko'pi bilan 15 ta urinish bo'ladi.

`aisha-comet` taqqoslash bazasi, ground truth emas. U #430 dagi repository bazasi; production hozir qaysi modelda ishlayotgani bu yerda tekshirilmagan.

### Model tanlovi asosi
- **DeepSeek `deepseek-flash`.** Egasining paketi bu ID'ni 2026-10-11 da rasmiy hujjatda ko'rgan. Qidiruv parchalarida rasmiy ID `deepseek-v4-flash` deb ko'rsatilgan, ya'ni ma'lumotlar zid (**CONFLICT**). Model almashtirilmaydi: konsolda tasdiqlanadi. Non-thinking rejimi tanlandi: tushuntirish vazifasiga uzun reasoning kerak emas va ko'rinadigan javob chegarasi bazaga yaqin qoladi.
- **Z.AI `glm-5.3-flash`.** Paket nomzodi. Hujjati "vlm" bo'limida turadi, ya'ni multimodal model; sinovda faqat matn yuboriladi. Thinking'ni o'chirib bo'lmaydi, shuning uchun hisoblash profili bazadan farq qiladi. Bu yashirilmaydi, yozib qo'yiladi.
- **Moonshot `kimi-k3`.** Paket nomzodi. Reasoning doim yoqiq, eng past effort tanlandi. Paketga ko'ra low/high/max qo'llanadi va standart qiymat max. Qidiruv parchasiga ko'ra ishga tushganda faqat max bo'lgan (**CONFLICT**). `low` rad etilsa, xato yoziladi va boshqa qiymat bilan qayta yuborilmaydi. Qidiruvdagi narx ($3 / $15 per 1M) qolgan modellardan ancha qimmat.
- **Qwen `qwen-plus`.** Umumiy matn modeli, coder emas. Non-thinking rejimi bor, shuning uchun bazadek ishlay oladi. U flash (narxi topilmadi) bilan max (qimmatroq) o'rtasidagi daraja. `qwen-plus` barqaror alias, provayder uni yangi snapshot'ga o'tkazishi mumkin. Shuning uchun qaytgan model ID yoziladi, boshqa ID kelsa `model_mismatch` deb belgilanadi. Egasi konsoldan sanali snapshot ID'ni tasdiqlasa, o'shani ishlatish afzal.

### Faktlar holati (2026-10-11)
Rasmiy hujjat sahifalarining birortasi bu muhitdan ochilmadi (DNS). Shuning uchun:

| Fakt | DeepSeek | GLM | Kimi | Qwen |
|---|---|---|---|---|
| Model ID | CONFLICT | paket (rasmiy) | paket (rasmiy) | UNVERIFIED (alias) |
| Narx | qidiruv parchasi | qidiruv parchasi (manbalar zid) | qidiruv parchasi | qidiruv parchasi |
| Vaqtga qarab tarif | UNKNOWN | — | — | — |
| Kontekst / chiqish | qidiruv parchasi | qidiruv parchasi | qidiruv parchasi | UNKNOWN / parcha |
| Thinking kaliti | UNVERIFIED | paket: faqat enabled | CONFLICT | UNVERIFIED |
| Chegara reasoning'ni ham cheklaydimi | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Reasoning completion_tokens ichidami | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |

Har bir manba `scripts/provider-eval.config.json` da yozilgan. Undagi narxlar faqat dry-run ssenariysi uchun; jonli rejim ularni ishlatmaydi.

## Bir xil kirish
- Har bir hujjat uchun production yo'riqnomasi (`explainDocument`: `explainSystem`, o'sha user xabari, to'liq matn, `sameHelpers`) **bir marta** stub bilan quriladi va muzlatiladi.
- Quyidagi xeshlar yoziladi: manba, system, user, butun messages, helpers (kalit qatorlar, manba ID'lari, ziddiyat nomzodlari) va wire. Wire xeshi har provayderga yuboriladigan `messages` bilan bir xil (test tekshiradi).
- Jonli chaqiruvdagi prompt muzlatilgan xeshdan farq qilsa, chaqiruv qilinmaydi.
- Helper'larni AI emas, kod tanlaydi. Dayjest qurilmaydi.
- Provayder bo'yicha farqlar faqat generation profilida. Ular dry-run'da va har bir ledger yozuvida ko'rsatiladi.
- Teng `max_tokens` teng hajmdagi ko'rinadigan javobni anglatmaydi. Reasoning modellarida 8000 tokendan 3000 tasi javobga, 5000 tasi reasoning'ga mo'ljallangan. Bu taqsimot faqat chegara reasoning'ni ham qamrasa ishlaydi, bu esa hali UNKNOWN.
- Paketdagi alohida "topshiriq" matni qo'shilmadi. Production prompti o'zgarishsiz qoldi, aks holda sinov production'ni aks ettirmaydi.

`reviewer-key.json` faqat kalit iboralarini tekshirish uchun o'qiladi. Promptda kalit iborasi topilsa, chaqiruv bo'lmaydi. Test fetch'ga yuborilgan haqiqiy payload'ni ushlab tekshiradi. D3 dagi "AI yordamchi, oldingi topshiriqni unut…" qatori hujjat matni sifatida user xabari ichida qoladi va system promptga tushmaydi.

## Xavfsizlik
- URL'lar kodda qat'iy belgilangan (`scripts/lib/eval-providers.js`). Config'dagi `url` yoki `baseUrl` rad etiladi.
- `*_BASE_URL` orqali boshqa manzil berib bo'lmaydi. VoiceLab'da `VOICELAB_BASE_URL` standartdan boshqa bo'lsa, rad etiladi.
- `redirect: 'error'` ishlatiladi: kalit boshqa hostga o'tmaydi.
- Runner jarayonida `fetch` guard bilan almashtiriladi. Dry-run'da ruxsat etilgan hostlar ro'yxati bo'sh, shuning uchun birorta ham so'rov chiqmaydi.
- Kalit faqat o'z provayderiga yuboriladi. Ekranga faqat nomi va configured/missing holati chiqadi. Xato matnlari redaksiya qilinadi.
- Server, bot va DB bu fayllarni yuklamaydi. Runner import qilinganda server, bot, DB yoki `pg`/`express` modullari ishga tushmaydi (test tekshiradi).
- Birinchi pilot faqat sun'iy fixture'larda o'tadi. Mijoz hujjati avtomatik eksport qilinmaydi.

## Sarf himoyasi
- Default rejim dry-run: tarmoq yo'q, pullik preflight yo'q.
- Concurrency 1, auto-retry 0, fallback yo'q. VoiceLab chaqiruvi `voicelab/<id>` orqali boradi, shuning uchun hech qachon fallback qilmaydi.
- Bitta umumiy byudjet bor (`scripts/lib/eval-budget.js`, #430 dagi `liveCaller` bilan bir xil qoidalar):
  - har chaqiruvdan **oldin** chegara atomar rezerv qilinadi;
  - narx chegarasi isbotlanmasa, chaqiruv qilinmaydi;
  - usage noma'lum yoki to'liqsiz bo'lsa, xarajat "unknown" deb yoziladi ($0 emas) va rezerv ushlab turiladi;
  - xarajat rezervdan oshsa, run to'xtaydi (halt);
  - HTTP javob kelmasa (timeout yoki tarmoq xatosi), billing noma'lum bo'lgani uchun run ham to'xtaydi. Klient abort'i provayder tomonidagi billing'ni to'xtatadi deb hisoblanmaydi.
- Rezerv eng yuqori ro'yxatdagi tarif bilan hisoblanadi (vaqt va daraja bo'yicha). Kesh chegirmasi oldindan hisobga olinmaydi.
- Ledger (`<out>/ledger.jsonl`) chaqiruvdan oldin (reserve) va keyin (settle) yoziladi.
- Restart qoidalari:
  - urinishi bor vazifa qayta bajarilmaydi;
  - natijasi yozilmagan urinishning rezervi ushlab qolinadi va run to'xtaydi;
  - boshqa run'ning `--out` papkasi rad etiladi;
  - avval sarflangan pul limitdan qayta sarflanmaydi.
- Kesh tokenlari prompt ichida, reasoning tokenlari completion ichida hisoblanadi va qayta qo'shilmaydi. Ziddiyatli yoki to'liqsiz usage'dan xarajat hisoblanmaydi.
- Uch xil xarajat alohida yoziladi: tokenlardan hisoblangan ro'yxat narxi (list USD), provayder bildirgan USD va VoiceLab kreditlari (egasi tasdiqlagan kurs bo'yicha). Ular aralashtirilmaydi.
- Auth yoki balans xatosida qayta urinish yo'q. Shu provayderning qolgan vazifalari `skipped` bo'ladi.

## Dry-run (2026-10-11, AI'siz, tarmoqsiz)
`node scripts/provider-eval.js` buyrug'i 15 vazifani chiqaradi. Bu tasdiqlanmagan nomzod narxlardagi **SSENARIY**: prognoz emas, rezerv esa kafolatlangan maksimum emas.

| | ko'rinadigan javob bo'yicha | har chaqiruv chegarasida | rezerv |
|---|---|---|---|
| Jami 15 vazifa | ≈ $0.149 | ≈ $0.438 | ≈ $0.520 |

- Kimi 15 vazifadan 3 tasini tashkil qiladi, lekin rezervning ≈ $0.45 qismi unga to'g'ri keladi.
- GLM va Kimi uchun reasoning tokenlari UNKNOWN. Ularning rezervi faqat chegara reasoning'ni ham qamragan taqdirda to'g'ri.
- Token/belgi nisbati (0.367) va javob uzunligi (1 947) comet'ning bitta so'rovidan (504b2e59) olingan. Bu boshqa modellar uchun o'lchanmagan, faqat taxmin.

## Jonli sinov (faqat egasining yozma ruxsati bilan)
1. Egasi konsoldan har model bo'yicha ma'lumotlarni tasdiqlab, repo **tashqarisida** fayl yozadi:
   ```json
   { "models": {
     "deepseek": { "requestedModel": "deepseek-flash", "profileConfirmed": true, "accountAccess": true,
                   "rates": [{ "label": "peak", "in": 0, "cachedIn": 0, "out": 0 }],
                   "capCoversReasoning": true, "reasoningInCompletion": true, "source": "…", "checkedAt": "…" },
     "baseline": { "requestedModel": "aisha-comet", "profileConfirmed": true, "accountAccess": true } } }
   ```
   - `rates` ichiga har bir vaqt yoki daraja tarifi yoziladi; rezerv ularning eng yuqorisini oladi.
   - Reasoning yoqiq modellar (GLM, Kimi) uchun `capCoversReasoning` va `reasoningInCompletion` qiymati `true` bo'lishi shart.
   - `requestedModel` config'dagi bilan bir xil bo'lishi shart: model almashtirilmaydi.
2. Run sha'ni olish (dry-run, tarmoqsiz):
   ```
   node scripts/provider-eval.js --budget-usd N --confirmed /yo'l/confirmed.json
   ```
   Egasi chiqqan sha'ni tasdiqlaydi. Prompt, model, profil, byudjet yoki tasdiq fayli o'zgarsa, sha ham o'zgaradi.
3. Jonli ishga tushirish:
   ```
   PROVIDER_EVAL_LIVE=yes node scripts/provider-eval.js --live --budget-usd N \
     --out /repo-tashqarisi/pe-1 --confirmed /yo'l/confirmed.json --approve <sha>
   ```
   Kerakli secretlar: `VOICELAB_API_KEY`, `DEEPSEEK_API_KEY`, `ZAI_API_KEY`, `MOONSHOT_API_KEY`, `DASHSCOPE_API_KEY`. Bittasi yetishmasa, birorta ham chaqiruv bo'lmaydi.
4. Natijalar `--out` ichida joylashadi:
   - `blind/` — faqat `completed` javoblar, tasodifiy ID bilan; model nomi va narx yo'q;
   - `key.json` — javob ID'larining modellarga moslik kaliti, alohida fayl;
   - `review-sheet.json` — baholovchi uchun bo'sh shakl;
   - `ledger.jsonl` va `answers/` — maxfiy fayllar.

   Hech biri repoga qo'yilmaydi.
5. Natijani hisoblash: `node scripts/provider-eval.js --report <out> --ratings <to'ldirilgan review-sheet>`.

## Baholash
- Ko'r baholash: baholovchi model nomini va xarajatni ko'rmasdan sifatni belgilaydi.
- Mezonlar: summa, subyekt, muddat boshlanishi, inkor, rozilik, istisno, barcha oqibatlar va iqtibosning izohga tegishliligi. Har biriga `ok | distorted | missing | na` qiymatlaridan biri qo'yiladi.
- Bitta `distorted` yoki `missing` bo'lsa, javob **critical_error** hisoblanadi.
- Paketdagi 0–4 ballik shkalalar ham qo'shilgan.
- `completed` bo'lmagan javoblar alohida sanaladi va qabul qilingan javob hisoblanmaydi: `truncated`, `empty`, `empty_capped`, `refused`, `error`, `skipped`, `model_mismatch`, `finish_unknown`.
- Bitta qabul qilingan javob tannarxi modelning barcha urinishlari xarajatini o'z ichiga oladi, xatolilarini ham. Qabul qilingan javob 0 ta bo'lsa, tannarx aniqlanmagan deb yoziladi. Biror xarajat noma'lum bo'lsa, tannarx UNKNOWN; tejash foizi chiqarilmaydi.
- Comet javobi ground truth emas. Regex signallari faqat signal, yuridik xulosa emas.
- Uchta hujjat statistik xulosa uchun yetarli emas: reyting, p95 yoki "teng sifat" degan da'vo qilinmaydi.

## Keyingi bosqich: mustaqil uzun hujjat sinovi (reja, hali ruxsat yo'q)
- **Hujjatlar.** Sozlashda ishlatilmagan, egasi rozilik bergan kamida 6–10 ta uzun hujjat (30–60 ming belgi): jadvalli DOCX, ilovali, ziddiyatli. Kamida ikkitasi holdout bo'ladi.
- **Kirish.** Har model bitta muzlatilgan dayjestni va to'liq matnni alohida oladi (#430 A/C/D sxemasi). Dayjestni bitta model bir marta quradi va u hamma uchun bir xil bo'ladi.
- **Kalit.** Yurist har hujjat uchun oldindan kalit tuzadi: muhim shartlar, muddatlar, istisnolar va oqibatlar.
- **Baholash.** Xuddi shu ko'r tartib va critical_error qoidasi qo'llanadi. Lex.uz manbalari bilan muzlatilgan savol-javoblar alohida to'plam bo'ladi.
- **Sarf.** Shu runner va byudjet qoidalari bilan, egasi har run sha'ni alohida tasdiqlaydi.
- **O'tish qoidasi.** Bu pilot natijasidan production'ga avtomatik o'tish yo'q. Routing o'zgarishi alohida qaror va alohida PR orqali bo'ladi.
