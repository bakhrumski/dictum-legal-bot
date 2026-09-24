# JuristAI runbook

Production: Render web service, `main` branch, auto-deploy. Baza: Supabase
Postgres. Maxfiy qiymatlar faqat Render → Environment'da. O'zgaruvchilar
ro'yxati: [`.env.example`](../.env.example).

## Tekshirish nuqtalari

| Nima | Qayerda | Kim |
|------|---------|-----|
| Server tirikmi, baza javob beradimi | `GET /api/health` → `{status, db, uptime}`; baza ishlamasa 503 | hamma (Render health check) |
| Korpus, embedding, provayderlar | `GET /api/admin/health` | master |
| Modellar ishlayaptimi | `GET /api/admin/model-check` | master |
| Ikki modelni solishtirish | `GET /api/admin/model-ab?a=…&b=…` | master |
| Qidiruv sifati (RAG eval) | `GET /api/admin/rag-eval?start=1`, keyin `GET /api/admin/rag-eval` | master |
| AI xarajati | `GET /api/admin/spend-report`, `GET /api/admin/margin-report` | master |
| Audit log | `GET /api/admin/audit-log` | master |

## Deploy

1. PR ochiladi, CI (`.github/workflows/ci.yml`) yashil bo'lishi kerak:
   testlar, boot smoke (haqiqiy server + authz matritsasi), npm audit hisoboti.
2. Merge → Render avtomatik deploy qiladi.
3. Yangi instansiya boot paytida bazani kutadi (6 × 5 s), migratsiyalarni
   qo'llaydi. Migratsiya xato bersa, jarayon to'xtaydi va Render eski
   instansiyani ishlatishda davom etadi: sayt tushmaydi, deploy "failed"
   bo'lib ko'rinadi. Logda `[DB] Migration error` va stack bo'ladi.
4. Deploy'dan keyin: `/api/health`, botga bitta xabar, master bilan kirish.

## Orqaga qaytarish

- **Kod:** Render → Deploys → oldingi muvaffaqiyatli deploy → "Rollback".
  Yoki GitHub'da PR'ni revert qilib merge qilish.
- **Versiyali migratsiya:** `migrations/down/<nomi>.down.sql` ni Supabase SQL
  editor'da ishga tushirish, so'ng
  `DELETE FROM public.schema_migrations WHERE version = '<nomi>.sql';`
  Down fayli yo'q migratsiyani qaytarishdan oldin zaxira oling.

## Deploy'siz o'chiriladigan kalitlar (Render → Environment)

| Holat | O'zgaruvchi |
|-------|-------------|
| VoiceLab muammo qilyapti | `LLM_PROVIDER` ni o'chirish (yoki `VOICELAB_LANES` bilan cheklash) |
| Telegram botni faqat sinash | `MODEL_TELEGRAM` |
| Ovozli xabarlar | `VOICELAB_STT=off`, TTS uchun `VOICELAB_TTS_VOICE_ID` ni o'chirish |
| AI xarajati oshib ketdi | `LLM_DAILY_BUDGET_USD` |
| Javob keshi eskirgan | `ANSWER_CACHE=off` |
| lex.uz sekin yoki ishlamayapti | `LEX_CROSSCHECK_EVERY_ANSWER=false`, `LEX_AI_QUERY_PLANNER=false` |
| Migratsiya xato berib boot to'xtadi, sayt esa ishlashi shart | `BOOT_ALLOW_PARTIAL=true` (vaqtincha; ba'zi bo'limlar ishlamaydi) |
| Master 2FA bot ishlamayapti | `MASTER_2FA=off` (vaqtincha) |

Env o'zgarishi Render'da qayta ishga tushirishni talab qiladi (kod deploy
emas).

## Tez-tez uchraydigan holatlar

**Bot javob bermayapti**
1. Logda `[BOT] Webhook active` bormi? Bo'lmasa `[BOT] Webhook setup failed`
   sababini o'qing.
2. Webhook yo'li token HMAC'idan olinadi va har bir so'rov Telegram
   `secret_token` sarlavhasini tekshiradi. Token almashtirilsa, keyingi boot
   yangi yo'lni o'zi ro'yxatdan o'tkazadi.
3. `/api/health` 503 bo'lsa, muammo bazada.

**Baza ishlamayapti**
- `/api/health` → 503, `db: "down"`. Supabase status sahifasi va loyiha
  limitlarini tekshiring. Boot paytida server 30 s kutib, keyin to'xtaydi;
  Render qayta urinadi.

**Foydalanuvchi "limit tugadi" deydi**
- `/api/tariff/usage-report` (master). Muddati o'tgan tarif avtomatik
  Bepul'ga tushadi. Xato bilan tugagan so'rovlar limitni qaytaradi.

**To'lov (Telegram Stars) kreditga aylanmadi**
- Logda `[BOT] paid answer credit failed` yoki `Stars refunded` ni qidiring.
  Kredit berilmasa Stars avtomatik qaytariladi; qaytarish ham muvaffaqiyatsiz
  bo'lsa, foydalanuvchiga tranzaksiya raqami bilan `/paysupport` yozish
  aytiladi.

## Local ishga tushirish

```bash
cp .env.example .env   # to'ldiring; hech qachon commit qilmang
npm ci
npm start
```

Haqiqiy Supabase'siz, toza Postgres + pgvector bilan:

```bash
createdb jai
DATABASE_URL=postgresql://postgres@localhost:5432/jai scripts/ci/boot-smoke.sh
```

Skript Supabase rollari uchun stub'larni qo'yadi, serverni ko'taradi,
anonim kirish matritsasini tekshiradi va SIGTERM bilan to'xtatadi.

## Testlar

```bash
npm test                # asosiy to'plam
npm run test:workspace  # Workspace API va frontend kontrakti
npm run test:all        # keng to'plam
npm run test:tariff     # tariflar, limitlar, refund
```
