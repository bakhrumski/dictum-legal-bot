# Ma'lumot himoyasi, 1-bosqich: shifrlash va AI'ga yuborishdan oldin yashirish

Holat: **qoralama** (2026-10-28). Egasining javobi (9-bo'lim) kelmaguncha kod boshlanmaydi.

Egasi (2026-10-28): "1-bosqichni boshla!" — occlum.io tahlilidan keyin. Occlum
(Intel SGX LibOS) Render'da ishlamaydi va asosiy chiqish yo'llarini (AI
provayderlar, Supabase, Telegram) yopmaydi. Shuning uchun 1-bosqich kod
ichidagi himoya: bazada shifrlash, AI'ga yuborishdan oldin shaxsiy
ma'lumotni yashirish, provayder siyosati va kirish jurnali. 2-bosqich
(maxfiy VM, AMD SEV-SNP) va 3-bosqich (maxfiy AI) alohida qaror.

## 1. Nimadan himoya qiladi, nimadan qilmaydi

| Xavf | 1-bosqichdan keyin |
|---|---|
| Baza nusxasi (dump, backup) sizib chiqadi | Shifrlangan ustunlar kalitsiz o'qilmaydi |
| Supabase xodimi yoki SQL konsolga kirgan odam | Shifrlangan ustunlarni ko'rmaydi |
| AI provayder (DeepSeek, OpenAI, Gemini, VoiceLab) | Pasport, JShShIR, STIR, telefon, karta, hisob raqami, email o'rniga belgi ko'radi. **Savolning mazmunini ko'radi** |
| Hujjat skan (rasm, PDF) OCR'ga | **Himoya yo'q**: rasm baytlari yashirilmaydi (faqat provayder siyosati, 5-bo'lim) |
| Ovoz (STT) | **Himoya yo'q**: audio provayderga boradi; transkriptdan keyingi AI qadamlari yashiriladi |
| Server xotirasi, Render | **Himoya yo'q** (2-bosqich) |
| Telegram | **Himoya yo'q**: bot yozishmalari Telegram serverlarida |
| Bizning kodimizdagi xato, xodim | **Himoya yo'q**: server kalitni biladi; faqat kirish jurnali (6-bo'lim) |

Landing va ilovada faqat shu jadvalga mos gap yoziladi ("uchidan-uchigacha
shifrlash", "AI ko'rmaydi" — **yozilmaydi**).

## 2. Kalit

- `DATA_KEYS` (Render env): `{"v1":"<32 bayt base64>"}`, `DATA_KEY_ACTIVE=v1`.
  Kalit bazada, logda, ledgerda, xato matnida hech qachon bo'lmaydi.
- Shifr: AES-256-GCM (Node `crypto`), har qiymatga yangi 12 baytli IV.
  Saqlanish shakli: `enc:v1:<iv>:<tag>:<ciphertext>` (base64url) — matn
  ustuniga sig'adi; JSONB ustunda `{"enc":"enc:v1:..."}`.
  AAD = `<jadval>.<ustun>:<qator id>` — bir qatorning shifrini boshqa
  qatorga ko'chirib bo'lmaydi.
- Aylantirish: yangi kalit `v2` qo'shiladi va faol bo'ladi; o'qish ikkalasini
  biladi; fon skripti eski qatorlarni qayta shifrlaydi; keyin `v1` olinadi.
- **Kalit yo'qolsa — ma'lumot yo'qoladi.** Kalitning oflayn nusxasi egasida
  (9-bo'lim, 4-savol). Kalitsiz server ishga tushmaydi (shifrlangan
  qatorni o'qiy olmaydi) — bu ataylab.
- Modul: `src/privacy/crypto.js` (`seal(value, aad)`, `open(value, aad)`,
  `isSealed`), testlar: almashtirilgan qator, buzilgan tag, eski kalit,
  kalitsiz ishga tushish.

## 3. Bazada shifrlash: qaysi ustunlar

### 3.1. Darhol (faqat id bo'yicha o'qiladi, SQL qidiruvi yo'q)

| Jadval.ustun | Yozadi |
|---|---|
| `document_scans.text` | `src/ocr/scan-store.js:40` |
| `tg_conversations.turns`, `context` | `src/agents/telegram-agent.js:244` (butun qiymat qayta yoziladi) |
| `matters.summary`, `matter_items.note` | `src/matters/store.js` |
| `agent_runs.input/plan/result`, `agent_run_steps.output/note` | `src/agents/runs/store.js` |
| `interview_transcripts.body`, `interview_audio.data`, `interview_recordings.summary/consent_by/consent_note` | `src/interviews/store.js` |
| `answer_cache.reply`, `opinion_cache.html` | server.js (kalit sha256) |
| `service_orders.intake_data`, `attorney_consultation_requests.case_summary` | `src/services/legal-marketplace.js` |
| `workspace_task_comments.body`, `workspace_messages.body`, `workspace_direct_messages.body`, `workspace_ai_messages.content`, `workspace_ai_runs.request_text/context_snapshot`, `workspace_document_versions.content_text/content_json` | `src/workspace/*` — **3.3 shartidan keyin** |
| `answer_feedback.selected_text/question/answer_text`, `chat_messages.message`, `agent_traces.input_summary/output` | server.js, runner.js |

Eski qatorlar: o'qish ikkala shaklni ham tushunadi (ochiq matn ham, `enc:`
ham); yangi yozuv shifrlangan. To'liq o'tkazish — `scripts/seal-backfill.js`
(quruq ishga tushirish odatiy; jonli bazaga yozishni egasi ishga tushiradi —
Claude jonli bazaga yozmaydi).

### 3.2. SQL'da qidiriladi — qaror kerak (9-bo'lim)

| Ustun | Bugungi qidiruv | Taklif |
|---|---|---|
| `ai_chat_sessions.messages` (JSONB), `title` | `messages \|\| $2` (telegram-history.js:28), `messages->0->>'text'` (server.js:8233) | messages shifrlanadi; qo'shish o'qib-qayta-yozish bilan (bitta tranzaksiya, `FOR UPDATE`); ro'yxat uchun alohida ochiq `title` qoladi, unda shaxsiy ma'lumot yashiriladi |
| `requests.request_text`, `response_text` | admin `ILIKE` (server.js:1877) | shifrlash + qidiruv yo'qoladi **yoki** "ko'r indeks" (so'z ildizlarining HMAC'i) — 1-savol |
| `ai_analyses.request_text` | `ILIKE` (server.js:8364) | `requests` bilan bir xil |
| `workspace_tasks.title/description` | `ILIKE` (workspace/routes.js:238) | ochiq qoladi (vazifa nomi), lekin yashirish qo'llanadi; yoki ko'r indeks |
| `workspace_memory_items.*` | `tsvector` + embedding | ochiq qoladi, kiritishda shaxsiy ma'lumot yashiriladi (qidiruv so'zlari kerak) |
| `qa_bank`, `qa_korpus`, `lawyer_feedback_dataset`, `legal_training_dataset`, `legal_chunks` (`verified_qa`) | embedding, trigram, `ILIKE` | ochiq qoladi, lekin yozishdan **oldin** shaxsiy ma'lumot yashiriladi (o'rganish to'plamiga pasport kirmaydi) |

Embedding'lar (vektorlar) mazmunning izi — shifrlanmaydi; bu ochiq aytiladi.

### 3.3. Workspace realtime

`public/js/workspace.js:2804` va `ai-dashboard.js:1550` Supabase
`postgres_changes` orqali qatorlarni **to'g'ridan-to'g'ri brauzerga** oladi.
Shifrlangan ustun brauzerga shifr bo'lib keladi. Yechim: realtime faqat
"o'zgardi" signali, matn API'dan (server ochadi) olinadi. Bu Workspace
frontendiga tegadi (`tests/workspace-phase1.test.js`), alohida PR (E5).

### 3.4. Fayllar

Supabase Storage `workspace-documents` (private): fayl yuklashdan oldin
serverda AES-GCM bilan shifrlanadi, yuklab olishda ochiladi (bugun signed
URL beriladi — server orqali oqimga o'tadi). Interview audio — 3.1 da.

## 4. AI'ga yuborishdan oldin yashirish

Modul `src/privacy/redact.js` (AI'siz, faqat qoidalar):

| Tur | Belgi | Aniqlash |
|---|---|---|
| Pasport / ID karta | `[PASPORT_1]` | `[A-Z]{2}\s?\d{7}` |
| JShShIR (PINFL) | `[JSHSHIR_1]` | 14 raqam, kontekst so'zi bilan yoki boshi 3–6 |
| STIR (INN) | `[STIR_1]` | 9 raqam + "STIR/INN" yaqinida |
| Telefon | `[TELEFON_1]` | `+998`, `998`, `(9x)` shakllari |
| Bank karta | `[KARTA_1]` | 16 raqam + Luhn |
| Hisob raqam | `[HISOB_1]` | 20 raqam |
| Email | `[EMAIL_1]` | |
| Avtomobil raqami | `[AVTO_1]` | O'zbekiston formati |
| Ism-familiya | `[SHAXS_1]` | **ixtiyoriy** (2-savol): akkaunt egasining o'z ismi + "F.I.Sh.", "fuqaro …", "…ov/ova/ev/eva" qoidalari |

- Bir so'rov ichida bir xil qiymat bir xil belgi oladi; xarita faqat
  xotirada (so'rov tugashi bilan yo'qoladi), javobda belgi qaytariladi
  (`restore`), logga va ledgerga xarita yozilmaydi — faqat sanoq
  (`redacted: {PASPORT: 1}`).
- Summa, sana, modda raqami, shartnoma bandi **yashirilmaydi** — huquqiy
  javob ularga bog'liq; claim guard ham ular bilan ishlaydi.
- Hujjat tushuntirish va jadvalli tahlil iqtiboslarni hujjatning o'zidan
  so'zma-so'z tekshiradi: AI belgilangan matnni ko'radi, server tekshiruvni
  belgilangan matnga qarshi qiladi, keyin `restore`.

Qo'yiladigan joylar (yagona "bo'g'iz" yo'q):
1. `callOpenAI`, `callOpenAIStream`, `callGemini` (server.js) — chat,
   Telegram, xulosa, tahlil, yordamchilar, agentlar shu orqali.
2. `src/rag/hybrid-pipeline.js` `callOpenAIModel` / `callGeminiModel`.
3. `src/rag/embeddings.js` — so'rov embedding'i (savol matni).
4. `src/rag/reranker.js` — so'rov qismi.
5. AI screening (server.js:9840) — to'g'ridan-to'g'ri chaqiruvlar.
6. Mavjud `redactSensitiveText` (hermes-shadow.js:74) va `maskPersonal`
   (top-questions.js:31) yangi modulga ko'chadi.

**`/api/legal-chat` javob zanjiriga tegadi** — CLAUDE.md bo'yicha egasining
alohida roziligi kerak (3-savol). Undan oldin boshqa yo'llar (agentlar,
hujjat, Workspace, Telegram yordamchilari) yoqiladi; legal-chat esa
`REDACT_LEGAL_CHAT=on` bilan, rozilikdan keyin.

Yopilmaydigan yo'llar (ochiq aytiladi): OCR'ga rasm/PDF baytlari, STT'ga
audio, TTS'ga javob matni (u bizning javobimiz).

## 5. Provayder siyosati

- Akkaunt sozlamasi (Moslashish sahifasi): "Hujjatlarim va savollarim
  DeepSeek'ka yuborilmasin" — shu akkaunt uchun `tryDeepSeek` o'tkazib
  yuboriladi (keyingi provayder, narx farqi ledgerda ko'rinadi).
  Odatiy qiymat — 4-savol.
- Hujjat OCR: shu sozlama bilan VoiceLab vision o'rniga faqat Gemini
  (yoki aksincha) — provayder tanlovi foydalanuvchiga ko'rinadi.
- Ilovada "Ma'lumotlaringiz qayerga boradi" sahifasi: har xizmat uchun
  provayder nomi va mamlakati (1-jadvaldan, rost).

## 6. Kirish jurnali

`data_access_log` (yangi jadval): xodim (master, lawyer, student) **boshqa
odamning** shifrlangan ma'lumotini ochganda bir qator — kim, kimning, qaysi
jadval, qachon, sabab (route). O'z ma'lumotini o'qish yozilmaydi.
Boshqaruv'da "Kirish jurnali" (faqat master). Matn yozilmaydi, faqat fakt.

## 7. Tezlik va xotira

AES-GCM bir necha KB matnga mikrosoniyalar; 25 MB audio — ~20–40 ms.
Ro'yxat sahifalari ochiq `title` bilan ishlaydi (shifr ochilmaydi).

## 8. PR'lar ketma-ketligi

| PR | Nima | Tegadi |
|---|---|---|
| E1 | `src/privacy/crypto.js`, kalit halqasi, testlar; kalitsiz ishga tushmaslik (`DATA_KEYS` bo'lmasa — shifrlash o'chiq, ogohlantirish, keyin majburiy) | src |
| E2 | 3.1 ustunlari: yozishda shifr, o'qishda ikkala shakl; `seal-backfill.js` (quruq) | src, scripts |
| E3 | `src/privacy/redact.js` + legal-chat'dan tashqari yo'llar; ledgerda sanoq | src |
| E4 | legal-chat yo'li (`REDACT_LEGAL_CHAT`) — **egasining roziligi bilan** | src (javob zanjiri) |
| E5 | Workspace realtime → signal; Workspace ustunlari; fayllarni shifrlash | src, public |
| E6 | 3.2 qarorlari (chat sessiyalari, requests); kirish jurnali; provayder sozlamasi | src, migrations, public |
| E7 | Landing animatsiyasi (10-bo'lim) — **faqat E2 va E3 jonli bo'lgandan keyin** (va'da rost bo'lishi kerak) | public |

Har PR: migratsiya + down fayl, testlar, CI, brauzer tekshiruvi (UI bo'lsa).

## 9. Egasiga savollar

1. **Admin qidiruvi** (`requests`, `ai_analyses` matni bo'yicha `ILIKE`):
   (a) shifrlab, qidiruvni olib tashlash; (b) ko'r indeks (so'z ildizlari
   HMAC'i — to'liq so'z bo'yicha qidiradi, qism bo'yicha emas); (c) ochiq
   qoldirish. Taklif: (b).
2. **Ism-familiyani yashirish**: yoqilsinmi? Foydasi katta, lekin xato
   ham bo'ladi (masalan, "Karimov ko'chasi"). Taklif: avval faqat
   akkaunt egasining o'z ismi va "F.I.Sh."/"fuqaro" yonidagi ismlar.
3. **`/api/legal-chat` ga yashirishni qo'shishga rozimisiz** (E4)?
   Javob sifati 20 ta savolda oldin/keyin solishtiriladi.
4. **DeepSeek'dan voz kechish sozlamasi** — odatiy holatda o'chiq (narx
   arzon qoladi) yoki yoqiq (hujjatlar Xitoyga bormaydi, narx oshadi)?
   Taklif: odatiy o'chiq, Moslashish sahifasida tanlov + landingda rost
   yozuv.
5. **Kalitning oflayn nusxasi** kimda saqlanadi? (Taklif: siz, parol
   menejeri yoki qog'ozda; Render'dan tashqari bitta joy.)
6. **O'rganish to'plamlari** (`qa_bank`, `qa_korpus`, …): shaxsiy
   ma'lumotni yashirib saqlash (taklif) yoki umuman yig'ishni to'xtatish.

## 10. Landing: shifrlash animatsiyasi (taklif)

Yangi animatsiya **o'ylab topilmaydi** (`docs/design-handoff/ANIMATIONS.md`):
faqat landingda bor keyframe'lar qayta ishlatiladi.

Bo'lim: "Ma'lumotingiz qanday himoyalanadi" — `#how` dan keyin, bitta
gorizontal "yo'l" (telefonda vertikal), 4 qadam sikl bilan:

| Qadam | Ko'rinish | Mavjud animatsiya |
|---|---|---|
| 1. Siz yozasiz | Telefon kartasida savol harfma-harf: "Aziz Karimov, pasport AA1234567, ijarachi 3 oydan beri to'lamayapti" | 2.4 typing: `draft` harfma-harf, `jai-blink` kursor, `jai-rise` xabar |
| 2. Shaxsiy ma'lumot yashiriladi | Skan chizig'i matn ustidan o'tadi; "AA1234567" va "Aziz Karimov" split-flap bilan `[PASPORT]`, `[SHAXS]` ga aylanadi; ostida: "AI provayderga shu ketadi" | `jai-scan` (LED skan chizig'i) + `jai-flipboard` / `jai-flapout` / `jai-flapin` (FAQ flipboard) |
| 3. Bazada shifrlanadi | Butun qator belgi-belgi split-flap bilan shifr satriga (`enc:v1:9fQ…`) aylanadi; qulf belgisi chiziladi | `jai-flipboard` kaskad (50% qoidasi) + `jai-tickdraw` / `jai-tickpop` |
| 4. Faqat sizga ochiladi | Shifr qayta flip bilan ochiq matnga qaytadi, javob chipi chiqadi | `jai-flipboard` teskari + `jai-rise` |

- Faol qadam nuqtasi — `jai-pulse` (#how dagi kabi); qadamlar orasidagi
  chiziq — `jai-barfill`. Oxirgi qadamdan keyin 2 s pauza (checkbox
  qoidasi), keyin qaytadan.
- Easing va davomiylik — ANIMATIONS.md "Umumiy qoidalar": kirish
  `cubic-bezier(.2,.8,.2,1)`, sakrash yo'q, flip kaskadi 4 s ichida.
- Ranglar: brand ko'k; rangli matn foni faqat och ko'k (egasining qoidasi);
  chap rangli chiziqli karta yo'q.
- `prefers-reduced-motion`: animatsiya yo'q, 4 qadam yakuniy holatda
  statik ko'rinadi.
- 2026 alifbosi: matnlar `toNew` orqali; shifr satri `data-noalpha`.
- Ostidagi izoh (rost, 1-jadvaldan): "Pasport, telefon, karta kabi
  ma'lumotlar AI'ga yuborilishidan oldin yashiriladi; suhbat va hujjatlaringiz
  bazada shifrlangan holda saqlanadi. Savol mazmuni javob uchun AI
  provayderga yuboriladi." + "Ma'lumotlaringiz qayerga boradi →" havolasi.
- Faqat E2 va E3 jonli bo'lgandan keyin chiqadi (landing va'dalari rost
  bo'lishi shart — 2026-10-20 auditi).
