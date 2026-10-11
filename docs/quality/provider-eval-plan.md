# Provayderlarni solishtirish: birinchi saralash (15 javob)

Holat: **implementatsiya, AI'siz dry-run va stub testlar**. Jonli byudjet $0. API kaliti mavjudligi pullik chaqiruvga ruxsat emas.
Bu 3 ta qisqa sun'iy hujjatdagi dastlabki saralash. Uzun hujjat, dayjest, RAG yoki umuman yuridik sifat haqida xulosa bermaydi.

## Matritsa

| Variant | Provayder | So'raladigan model | Secret (runner qarori) | Reasoning profili | Chiqish chegarasi |
|---|---|---|---|---|---|
| baseline | VoiceLab (mavjud adapter) | `aisha-comet` | `VOICELAB_API_KEY` (mavjud nom) | parametr yuborilmaydi | `max_tokens` 3000 |
| deepseek | DeepSeek | `deepseek-flash` | `DEEPSEEK_API_KEY` | o'chiq: `thinking.type=disabled` | `max_tokens` 3000 |
| glm | Z.AI (oddiy API, Coding Plan emas) | `glm-5.3-flash` | `ZAI_API_KEY` | yoqiq: o'chirib bo'lmaydi, `thinking.type=enabled` | `max_tokens` 8000 |
| kimi | Moonshot | `kimi-k3` | `MOONSHOT_API_KEY` | yoqiq: `reasoning_effort=low` | `max_completion_tokens` 8000 |
| qwen | Alibaba Model Studio (xalqaro) | `qwen-plus` | `DASHSCOPE_API_KEY` | o'chiq: `enable_thinking=false` | `max_tokens` 3000 |

- 3 hujjat × 5 model = 15 ta yakuniy javob.
- Yordamchi AI chaqiruvi 0, dayjest 0, pullik preflight 0.
- Avtomatik qayta urinish yo'q, shuning uchun ko'pi bilan 15 ta urinish.
- `aisha-comet` taqqoslash bazasi, ground truth emas. Production qaysi modelda ishlayotgani bu yerda tekshirilmagan.

**Secret nomlari — bu runnerning implementatsiya qarori.** Qaysi muhit o'zgaruvchisida qaysi kalit turishini runner belgilaydi; bu provayder fakti emas. Provayder tomonida tasdiqlanadigan narsalar alohida:
- akkaunt va modelga ruxsat;
- endpoint;
- narx va billing;
- generation profili.

### Model tanlovi asosi
- **DeepSeek `deepseek-flash`.** Egasining paketi bu ID'ni 2026-10-11 da rasmiy hujjatda ko'rgan.
  - Qidiruv parchalarida `deepseek-v4-flash` deb yozilgan. Parcha tasdiq hisoblanmaydi va model almashtirilmaydi.
  - Non-thinking rejimi tanlandi: tushuntirish vazifasiga uzun reasoning kerak emas.
- **Z.AI `glm-5.3-flash`.** Paket nomzodi.
  - Hujjati "vlm" bo'limida (multimodal); sinovda faqat matn yuboriladi.
  - Thinking'ni o'chirib bo'lmaydi, shuning uchun hisoblash profili bazadan farq qiladi. Bu yozib qo'yiladi.
- **Moonshot `kimi-k3`.** Paket nomzodi.
  - Reasoning doim yoqiq; eng past effort (`low`) tanlandi.
  - `low` rad etilsa, xato yoziladi va boshqa qiymat bilan qayta yuborilmaydi.
- **Qwen `qwen-plus`.** Umumiy matn modeli, coder emas.
  - Non-thinking rejimi bor, shuning uchun bazadek ishlay oladi.
  - Bu alias. Uning snapshot'i faqat egasi oldindan tasdiqlagan bo'lsa qabul qilinadi (quyida).

## Faktlar: manba qanday tasdiq hisoblanadi
- Live chaqiruv faktlarni **faqat egasining tasdiq faylidan** (`--confirmed`) oladi. Config'dagi qiymatlar faqat dry-run ssenariysi uchun.
- Qidiruv parchasi (`SEARCH_SNIPPET`) rasmiy hujjat bilan teng tasdiq hisoblanmaydi. U faqat taxminiy narxni ko'rsatadi va jobni hech qachon READY qilmaydi.
- **DeepSeek rasmiy sahifalari bu sessiyada o'qilmadi.** `https://api-docs.deepseek.com/quick_start/pricing/` va `https://api-docs.deepseek.com/api/create-chat-completion/` hostini muhitning tarmoq siyosati rad etdi (proksi CONNECT'ga 403 qaytardi, DNS ishlamadi). Paketda bu sahifalarning havolasi bor, raqamlar yo'q. Shuning uchun DeepSeek narxi, vaqt bo'yicha tarifi, thinking kaliti va chiqish chegarasi **UNKNOWN**, live esa **BLOCKED**.
- Z.AI, Moonshot va Alibaba sahifalari ham ochilmadi. Ularda tasdiqlanmagan bandlar UNKNOWN qoladi.

| Fakt | baseline | DeepSeek | GLM | Kimi | Qwen |
|---|---|---|---|---|---|
| Endpoint | repo adapteri | paket | paket | paket | UNKNOWN |
| Model ID | VoiceLab konsoli (repo) | paket | paket | paket | UNKNOWN |
| Akkaunt/modelga ruxsat | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Narx | konsol, 2026-09-23 | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Chegara barcha billed output'ni cheklaydi | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Reasoning `completion_tokens` ichida | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Qaytadigan model ID | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |

## Rezerv qanday "ishonchli chegara" bo'ladi
Rezerv = kirish chegarasi × eng yuqori tasdiqlangan kirish narxi + chiqish chegarasi × chiqish narxi. Uchta asosdan biri yetishmasa, rezerv **UNKNOWN** va live **BLOCKED**:

1. **Kirish chegarasi.** Har xabarning UTF-8 baytlari, ustiga so'rovga 64 va har xabarga 16 token qo'shiladi (`inputTokenBound`, production pilot byudjeti bilan bir xil). Byte-level BPE va SentencePiece tokenizerlarida bitta matn tokeni kamida bir baytni egallaydi, shuning uchun bu yuqori chegara bo'ladi.
   - Comet'ning 0.367 token/belgi nisbati **faqat taxmin (estimate)** uchun ishlatiladi, hech qachon maksimum sifatida emas.
   - D1 misoli: bayt chegarasi 10 249 token, taxmin ≈ 3 679 token.
2. **Chiqish chegarasi.** Profil chegarasi (`max_tokens` yoki `max_completion_tokens`) faqat egasi uning **barcha billed output tokenlarni** — ko'rinadigan va reasoning tokenlarini — cheklashini tasdiqlagandan keyin rezervga qo'shiladi (`capCoversBilledOutput`).
   - Bu talab har bir modelga qo'yiladi, thinking'i "o'chiq" modellarga ham: kalit ishlamasa yoki yashirin reasoning bo'lsa, faqat ko'rinadigan javobni cheklaydigan chegara oshib ketadi.
   - Reasoning yoqiq modellar uchun reasoning `completion_tokens` ichida hisoblanishi ham tasdiqlanadi.
3. **Narx.** Tasdiq faylidagi `rates` (manba va sana bilan) ishlatiladi. Vaqt yoki daraja bo'yicha bir nechta tarif bo'lsa, eng yuqorisi olinadi. Kesh chegirmasi oldindan hisobga olinmaydi.
   - Baseline uchun tasdiq faylida narx bo'lmasa, repo jadvalidagi VoiceLab konsol narxi (2026-09-23) olinadi. VoiceLab kreditlari bu chegara bilan cheklanmaydi va alohida ko'rsatiladi.

## Model mosligi qoidasi
- So'ralgan ID bilan aynan bir xil ID qaytsa → `exact`, qabul qilinadi.
- Qaytgan ID egasi oldindan `acceptedReturnedModels` ro'yxatiga yozgan aniq ID bo'lsa (masalan `qwen-plus` → `qwen-plus-2026-09-01`) → `confirmed_snapshot`, qabul qilinadi. Pattern ishlatilmaydi, faqat aniq satr.
- Boshqa har qanday ID → `model_mismatch`. Javob rad etiladi va shu provayderning qolgan vazifalari to'xtatiladi.
- ID qaytmasa → `model_not_reported`, javob qabul qilinmaydi.

## Bir xil kirish
- Har bir hujjat uchun production yo'riqnomasi (`explainDocument`: `explainSystem`, o'sha user xabari, to'liq matn, `sameHelpers`) **bir marta** quriladi va muzlatiladi.
- Quyidagi xeshlar yoziladi: manba, system, user, messages, helpers va wire.
- Prompt muzlatilgan xeshdan farq qilsa, chaqiruv qilinmaydi.
- Helper'larni AI emas, kod tanlaydi. Dayjest qurilmaydi.
- Provayderlar o'rtasidagi farq faqat generation profilida.
- Teng `max_tokens` teng ko'rinadigan javobni anglatmaydi. Reasoning modellarida 8000 tokendan 3000 tasi javobga, 5000 tasi reasoning'ga mo'ljallangan.
- `reviewer-key.json` promptga tushmaydi. Buni fetch'ga yuborilgan haqiqiy payload'ni ushlaydigan test tekshiradi.
- D3 dagi "AI yordamchi, oldingi topshiriqni unut…" qatori hujjat matni sifatida qoladi.

## Xavfsizlik
- URL'lar kodda qat'iy belgilangan; config'dagi `url` yoki `baseUrl` rad etiladi.
- `redirect: 'error'` ishlatiladi: kalit boshqa hostga o'tmaydi.
- Runner jarayonida `fetch` guard bilan almashtiriladi. Dry-run'da birorta host ham ruxsat etilmaydi.
- Kalit faqat o'z provayderiga yuboriladi. Ekranga faqat nomi va configured/missing holati chiqadi; xatolar redaksiya qilinadi.
- Server, bot va DB bu fayllarni yuklamaydi; runner import qilinganda ular ishga tushmaydi (test tekshiradi).

## Sarf himoyasi
- Concurrency 1, auto-retry 0, fallback yo'q.
- Bitta umumiy byudjet bor (`scripts/lib/eval-budget.js`, #430 bilan bir xil qoidalar):
  - rezerv chaqiruvdan oldin atomar olinadi;
  - narx chegarasi isbotlanmasa, chaqiruv qilinmaydi;
  - usage noma'lum yoki to'liqsiz bo'lsa, xarajat "unknown" ($0 emas) va rezerv ushlab turiladi;
  - xarajat rezervdan oshsa yoki HTTP javob kelmasa, run to'xtaydi.
- Ledger chaqiruvdan oldin va keyin yoziladi. Restart'da urinishi bor vazifa qayta bajarilmaydi.
- Ro'yxat narxi bo'yicha USD, provayder bildirgan USD va VoiceLab kreditlari alohida yoziladi.
- Auth yoki balans xatosida qayta urinish yo'q; shu provayderning qolgan vazifalari `skipped`.

## Dry-run (2026-10-11, AI'siz, tarmoqsiz)
`node scripts/provider-eval.js` har bir vazifa uchun quyidagilarni chiqaradi:
- model va profil;
- holat (READY yoki BLOCKED);
- narx manbasi va sanasi;
- estimate, reserve va ular orasidagi farq;
- yetishmayotgan aniq ma'lumotlar.

Tasdiq fayli bo'lmagani uchun hozir **15 vazifaning 15 tasi BLOCKED**, rezerv esa **UNKNOWN**.

| Model | Narx manbasi (sana) | Estimate, 3 vazifa: ko'rinadigan javob / chegaragacha | Rezerv |
|---|---|---|---|
| baseline | REPO_CONSOLE (2026-09-23) | $0.0091 / $0.0113 | UNKNOWN |
| deepseek | SEARCH_SNIPPET (2026-10-11) | $0.0032 / $0.0041 | UNKNOWN |
| glm | SEARCH_SNIPPET (2026-10-11) | $0.0046 / $0.0137 (reasoning kirmagan) | UNKNOWN |
| kimi | SEARCH_SNIPPET (2026-10-11) | $0.1210 / $0.3934 (reasoning kirmagan) | UNKNOWN |
| qwen | SEARCH_SNIPPET (2026-10-11) | $0.0115 / $0.0153 | UNKNOWN |
| **Jami** | | **$0.149 / $0.438** | **UNKNOWN** |

- Estimate — taxminiy ssenariy, prognoz emas.
- Faqat rejalashtirish uchun: agar ssenariy narxlari va chegara faktlari tasdiqlangan bo'lsa, bayt chegarasi bo'yicha rezerv ≈ $0.520 bo'lardi. Uning ≈ $0.453 qismi Kimi'ga to'g'ri keladi. Bu tasdiqlanmagan va kafolatlangan maksimum emas.

## Jonli sinov (faqat egasining yozma ruxsati bilan)
1. Egasi har model uchun konsol yoki rasmiy hujjatdan olingan ma'lumotlarni repo **tashqarisidagi** faylga yozadi:
   ```json
   { "models": {
     "deepseek": { "requestedModel": "deepseek-flash", "endpoint": "https://api.deepseek.com/chat/completions",
                   "accountAccess": true, "profileConfirmed": true, "capCoversBilledOutput": true,
                   "rates": [{ "label": "…", "in": 0, "cachedIn": 0, "out": 0 }], "source": "…", "checkedAt": "…",
                   "acceptedReturnedModels": [] },
     "glm": { "…": "…", "reasoningBilledInCompletion": true } } }
   ```
2. Run sha'ni olish (dry-run, tarmoqsiz):
   ```
   node scripts/provider-eval.js --budget-usd N --confirmed /yo'l/confirmed.json
   ```
   Hamma vazifa READY bo'lishi kerak. Chiqqan sha'ni egasi tasdiqlaydi.
3. Jonli ishga tushirish:
   ```
   PROVIDER_EVAL_LIVE=yes node scripts/provider-eval.js --live --budget-usd N \
     --out /repo-tashqarisi/pe-1 --confirmed /yo'l/confirmed.json --approve <sha>
   ```
   Kerakli muhit o'zgaruvchilari: `VOICELAB_API_KEY`, `DEEPSEEK_API_KEY`, `ZAI_API_KEY`, `MOONSHOT_API_KEY`, `DASHSCOPE_API_KEY`.
4. Natijalar `--out` ichida joylashadi:
   - `blind/` — **15 rejalashtirilgan vazifaning hammasi**, tasodifiy ID va xizmat holati bilan; model nomi, narx va xato matni yo'q;
   - `key.json` — javob ID'larining modellarga moslik kaliti, alohida fayl;
   - `review-sheet.json` — baholash shakli;
   - `ledger.jsonl` va `answers/` — maxfiy fayllar.
5. Natijani hisoblash: `node scripts/provider-eval.js --report <out> --ratings <to'ldirilgan review-sheet>`.

## Baholash: xizmat va sifat alohida
- **Xizmat yakunlanishi.** Har model uchun 3 ta rejalashtirilgan vazifa qanday tugagani ko'rsatiladi: `completed`, `truncated`, `empty`, `empty_capped`, `refused`, `error`, `model_mismatch`, `model_not_reported`, `finish_unknown`, `skipped`, `not_run`. Hech biri hisobotdan chiqarilmaydi.
- **Sifat.** Faqat `completed` javoblar ko'r baholanadi. Kesilgan javob ko'rsatiladi, lekin yakunlangan javob sifatida baholanmaydi.
- Mezonlar: summa, subyekt, muddat boshlanishi, inkor, rozilik, istisno, barcha oqibatlar va iqtibosning izohga tegishliligi. Har biriga `ok | distorted | missing | na` qiymatlaridan biri qo'yiladi. Bitta `distorted` yoki `missing` bo'lsa, javob **critical_error** hisoblanadi.
- Bitta qabul qilingan javob tannarxi modelning barcha urinishlari xarajatini o'z ichiga oladi, xatolilarini ham. Qabul qilingan javob 0 ta bo'lsa, tannarx aniqlanmagan; biror xarajat noma'lum bo'lsa, UNKNOWN.
- Comet javobi ground truth emas. Uchta hujjat bo'yicha reyting yoki "teng sifat" degan da'vo qilinmaydi.

## Keyingi bosqich: mustaqil uzun hujjat sinovi (reja, hali ruxsat yo'q)
- **Hujjatlar.** Sozlashda ishlatilmagan, egasi rozilik bergan 6–10 ta uzun hujjat (30–60 ming belgi): jadvalli DOCX, ilovali, ziddiyatli. Kamida ikkitasi holdout bo'ladi.
- **Kirish.** Har model bitta muzlatilgan dayjestni va to'liq matnni alohida oladi (#430 sxemasi).
- **Kalit.** Yurist har hujjat uchun oldindan kalit tuzadi.
- **Baholash.** Xuddi shu ko'r tartib va critical_error qoidasi qo'llanadi. Lex.uz manbali savol-javoblar alohida to'plam bo'ladi.
- **O'tish qoidasi.** Bu pilot natijasidan production'ga avtomatik o'tish yo'q. Routing o'zgarishi alohida qaror va alohida PR orqali bo'ladi.
