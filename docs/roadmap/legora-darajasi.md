# JuristAI → Legora darajasi: yo'l xaritasi

Boshlangan: 2026-10-27, egasining topshirig'i: "Oxirgi bosqichga olib borishimiz
kerak". Bu fayl yo'lning yagona ro'yxati. Har bir ish tugaganda shu yerda
belgilanadi: PR raqami, sana, nima o'lchangani. Yangi sessiya ishni shu fayldan
davom ettiradi.

Belgilar: `[ ]` boshlanmagan · `[~]` ishlanmoqda (PR ochiq) · `[x]` staging'da ·
`[-]` egasi bekor qildi (sababi yoziladi).

Har bir PR uchun qoidalar CLAUDE.md "Working agreement"dagidek:
- `src/**`, `migrations/**`, tariflar va DB o'zgarishi faqat PR orqali va
  egasining roziligi bilan merge qilinadi.
- `/api/legal-chat` egasining roziligisiz o'zgarmaydi.
- Jonli bazaga Claude yozmaydi.

## Taqqoslash (2026-10-27)

Legora haqidagi ma'lumot uchinchi tomon sharhlari va press-relizlardan olingan,
legora.com hujjatlari bevosita o'qilmagan. JuristAI haqidagisi repodagi koddan.

| Yo'nalish | Legora | JuristAI (2026-10-27) |
|---|---|---|
| Agent | Rejani o'zi tuzadi, sub-agentlar parallel ishlaydi | `src/agents/harness.js`: qat'iy qadamlar, ketma-ket, bitta HTTP so'rov ichida (≤150 s) |
| Workflow'lar | Ko'p, firma o'zi tuzadi | 3 ta: da'vo arizasi, jadvalli tahlil, playbook |
| Tabular Review | Minglab hujjat, real vaqtda hamkorlik, teglar | 20 hujjat × 10 savol, so'zma-so'z iqtibos tekshiruvi, CSV; natija saqlanmaydi |
| Word | Savol-javob, playbook, izoh va redline asosida tahrir | `public/word/`: savol-javob, Track Changes bilan tahrir, hujjatda izohlar, o'ng tugma menyusi. Playbook Word'da yo'q |
| Outlook | Xat zanjiri, javob loyihasi | Yo'q. O'rnida Telegram bot (ovoz bilan), bu bizning ustunligimiz |
| Tadqiqot | Ko'p yurisdiksiya, ontologiya, citator | lex.uz jonli qidiruv (2 bosqich), relevance hakami, kalit qator, istisno birinchi. Sud amaliyoti yo'q |
| Monitoring | Qonunchilik o'zgarishlari | Yo'q |
| Ish (matter) / Lists | Natijalar loyihada, manbaga bog'langan | Yo'q. Chatlar alohida, agent natijalari saqlanmaydi. Workspace (Platinum) vazifalar uchun |
| Portal | Mijoz bilan umumiy makon, audit | Yurist navbati bor, mijoz portali yo'q |
| Firma bilimi | Hujjatlar ombori, prompt kutubxonasi | Shaxsiy playbook'lar, ko'nikmalar; Workspace xotirasi (faqat Platinum) |
| Natija formatlari | Word, Excel, PowerPoint | Word, CSV |
| Ishonch | Manbaga havola | Bizda kuchliroq: so'zma-so'z iqtibos, claim guard, qamrov, "tasdiqlanmadi" belgisi |

O'zgarmas tamoyillar:
1. Ishonch mexanizmlari tezlik uchun bo'shatilmaydi. Agent qanchalik avtonom
   bo'lmasin, yakuniy natija tekshiruvdan (iqtibos, claim guard) o'tadi.
2. Narx chegarasi va tasdiqsiz avtonom ish bo'lmaydi.
3. Legora ko'r-ko'rona nusxalanmaydi: bozor O'zbekiston (Telegram, ovoz,
   lex.uz, o'zbek tili).

## 0-bosqich. Dizayn

- [~] Matter va agent_runs + reja tuzuvchi agent dizayni:
  `docs/design/matter-va-agent-runs.md` (2026-10-27). Egasi ochiq savollarga
  javob beradi, keyin 1-bosqich boshlanadi.

## 1-bosqich. Asos (Matter, uzoq ishlar, reja tuzuvchi)

Tartib va PR bo'linishi dizayn hujjatining 9-bo'limida.

- [ ] PR-A: `matters`, `matter_items` (migratsiya 019) va API. UI hali yo'q.
- [ ] PR-B: `agent_runs` va `agent_run_steps` (migratsiya 020), DB'dagi
  navbat va worker. Mavjud 3 ta workflow run sifatida ishlaydi, eski route'lar
  javob shaklini saqlaydi.
- [ ] PR-C: Matter UI (`/app/#/ishlar`): ro'yxat, ish sahifasi, "ishga
  qo'shish" tugmalari (chat, jadval, playbook, loyiha).
- [ ] PR-D: Vositalar reestri va reja tuzuvchi agent. Avval faqat master
  uchun (`AGENT_PLANNER=master`).
- [ ] PR-E: Parallel qadamlar, reja va narxni tasdiqlash, `needs_input`
  dan keyin davom ettirish.
- [ ] PR-F: Telegram: ish holati bitta xabarda yangilanadi, tasdiq tugmalari.
- [ ] PR-G: Agent baholash to'plami (`docs/quality/agent-eval.md`): har bir
  workflow uchun yurist ko'rib chiqqan 20–30 holat; har PR'da stub bilan.

## 2-bosqich. Mavjudini Legora tajribasiga yaqinlashtirish

- [ ] Tabular Review: 100+ hujjat run sifatida (fon navbati); ustun turlari
  (ha/yo'q, sana, summa, tanlov); teglar; Excel eksport; natija ishda saqlanadi.
- [ ] Word: playbook tahlili Word ichida (izoh va Track Changes bilan), "ishga
  saqlash".
- [ ] Natijalar: Excel (jadval), PowerPoint (ish bo'yicha qisqa taqdimot).

## 3-bosqich. Raqobat ustunligi

- [ ] Sud amaliyoti korpusi: Oliy sud Plenumi qarorlari, keyin ochiq sud
  qarorlari. Manba va litsenziya avval tekshiriladi.
- [ ] Citator: akt amaldami, qachon o'zgargan, qaysi Plenum qarori unga
  tayangan. Javobda "o'zgargan" belgisi chiqadi.
- [ ] Monitoring: lex.uz'dagi yangi va o'zgargan aktlar; foydalanuvchi
  ishlariga tegishlisi Telegram'ga yuboriladi (kuniga bitta yig'ma xabar).
- [ ] Firma bilim bazasi: firmaning shablonlari va avvalgi hujjatlari, qidiruv
  bilan (Workspace xotirasidan kengaytiriladi); jamoaviy prompt va ko'nikma
  kutubxonasi.

## 4-bosqich. Korporativ daraja

- [ ] Mijoz portali: yurist va mijoz uchun umumiy ish, fayllar, savollar,
  rollar, audit trail.
- [ ] Ma'lumot siyosati: hujjatlarni DeepSeek'ga yubormaslik opsiyasi
  (korporativ tarif), saqlash muddatlari, eksport va o'chirish.
- [ ] SSO (korporativ mijoz so'rasa).

## Jurnal

Har bir merge shu yerga bir qator bo'lib yoziladi: sana, PR, nima qilindi,
nima o'lchandi.

- 2026-10-27: yo'l xaritasi va dizayn hujjati yozildi (PR shu fayl bilan).
