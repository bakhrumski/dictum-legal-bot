# Dizayn: Matter (ish), uzoq ishlar (agent_runs) va reja tuzuvchi agent

Holat: **qabul qilingan**, 2026-10-28. Egasi 8-bo'limdagi tavsiyalarni qabul qildi;
PR-A (Matter) yozildi. Yo'l xaritasi: `docs/roadmap/legora-darajasi.md`, 1-bosqich.

Bu hujjat uch narsani belgilaydi:
1. **Matter** - bitta huquqiy ish atrofida hamma natijani yig'adigan obyekt.
2. **agent_runs** - bitta HTTP so'rovdan uzoq davom etadigan, deploy va xatodan
   keyin davom etadigan agent ishi.
3. **Reja tuzuvchi agent** - topshiriqqa qarab vositalarni o'zi tanlaydigan,
   lekin qat'iy chegaralar ichida ishlaydigan agent.

`/api/legal-chat` va Telegram javob zanjiri bu ishda o'zgarmaydi. Ular faqat
"natijani ishga qo'shish" orqali Matter'ga bog'lanadi.

---

## 1. Hozirgi holat (kod bo'yicha, 2026-10-27)

| Narsa | Qayerda | Cheklov |
|---|---|---|
| Harness | `src/agents/harness.js` | Qat'iy qadamlar ro'yxati, ketma-ket; `maxSteps` 12, `maxMs` 150 s; holat faqat xotirada. Server qayta ishga tushsa ish yo'qoladi |
| Workflow'lar | `src/agents/workflows/{claim-draft,tabular-review,playbook-review}.js` | Har biri bitta HTTP so'rov ichida tugaydi; natija javobda qaytadi va hech qayerda saqlanmaydi |
| Route'lar | `src/agents/agent-routes.js` | Birlik avval rezerv qilinadi, natija chiqsa commit, aks holda release qilinadi |
| Tarif rezervi | `src/rag/tariff-ledger.js` | Rezerv 30 daqiqa yashaydi (`TARIFF_RESERVATION_TTL_MIN`, ≤120); `meta.holdUntil` uni uzaytiradi (OCR shundan foydalanadi) |
| AI byudjeti | `src/ai/usage-ledger.js` `runWithRequest` | Bitta so'rovga: `AI_REQUEST_MAX_CALLS` 30, `AI_REQUEST_MAX_MS` (staging'da 240 s), `AI_REQUEST_MAX_COST_USD` 0,25. AsyncLocalStorage orqali uzatiladi |
| Chatlar | `ai_chat_sessions` (id `SERIAL`, `messages` jsonb) | Ishga bog'lanmagan |
| Skanlar | `document_scans` (uuid, 7 kun) | Hisobga bog'langan, ishga emas |
| Workspace | `workspaces`, `workspace_ai_runs`, `workspace_memory_items`, `workspace_documents` (migratsiya 001) | Faqat Platinum, jamoa uchun. `workspace_ai_runs` - Workspace AI'ning bitta generatsiyasi, ko'p qadamli agent uchun emas |
| Server | Render, bitta Node jarayoni, 512 MB | Fon ishlari deploy bilan to'xtaydi; og'ir lex.uz o'qishlari xotira chegarasida |

Bundan uchta xulosa chiqadi:
- **Natija saqlanmaydi.** Jadval, playbook va da'vo loyihasi sahifa yopilsa
  yo'qoladi. Matter shu muammoni hal qiladi.
- **Ish xotirada yashaydi.** Uzoq ish deploy'dan omon qolishi uchun holat
  Postgres'da bo'lishi kerak.
- **Rezerv TTL va so'rov byudjeti bitta HTTP so'rovga mo'ljallangan.** Uzoq
  ishga o'z byudjeti va `holdUntil` kerak.

---

## 2. Matter (ish)

### 2.1 Tushuncha

Matter - foydalanuvchining bitta huquqiy ishi, masalan "Pudratchi bilan nizo"
yoki "IT Park: chet ellik xodim". Unga quyidagilar bog'lanadi:

- chatlar;
- hujjatlar (yuklangan va skanerlangan);
- agent natijalari (jadval, playbook, loyiha, tahlil);
- yozuvlar.

Har bir element o'z manbasiga ishora qiladi. Matter ma'lumotni nusxalamaydi,
faqat bog'laydi. Istisno agent natijalari: ular hozir hech qayerda saqlanmaydi,
shuning uchun `agent_runs.result`da saqlanadi.

**Workspace bilan munosabati:**
- Workspace - jamoa va tashkilot (Platinum). Matter - ish.
- Matter shaxsiy bo'lib boshlanadi.
- Platinum foydalanuvchi uni o'z Workspace'iga biriktirishi mumkin
  (`workspace_id`). Shunda kirish huquqi Workspace a'zoligidan olinadi:
  owner/member yozadi, viewer o'qiydi.
- Alohida "matter a'zolari" jadvali qilinmaydi, chunki jamoa Workspace'da
  allaqachon bor.

Rad etilgan variant: Workspace'ni Matter sifatida ishlatish. Workspace jamoa
konteyneri bo'lib, a'zolar, takliflar va Gantt bilan keladi. Faqat Platinum
uchun. Shaxsiy ish uchun bu juda og'ir va boshqa tariflarni chetda qoldiradi.

### 2.2 Jadvallar (migratsiya `20261028_019_matters.sql`)

```sql
CREATE TABLE public.matters (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
  workspace_id  uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  title         text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 160),
  summary       text NOT NULL DEFAULT '',          -- foydalanuvchi yozadi; AI emas
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX matters_owner_idx ON public.matters (owner_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX matters_workspace_idx ON public.matters (workspace_id) WHERE workspace_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE public.matter_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('chat','scan','agent_run','note','file')),
  ref_int     bigint,          -- ai_chat_sessions.id
  ref_uuid    uuid,            -- document_scans.id, agent_runs.id
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 240),
  note        text,            -- kind = 'note' uchun matn
  added_by    integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'note') = (note IS NOT NULL)),
  CHECK (kind = 'note' OR ref_int IS NOT NULL OR ref_uuid IS NOT NULL)
);
CREATE UNIQUE INDEX matter_items_ref_uidx ON public.matter_items (matter_id, kind, COALESCE(ref_int, 0), COALESCE(ref_uuid, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX matter_items_matter_idx ON public.matter_items (matter_id, created_at DESC);
ALTER TABLE public.matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_items ENABLE ROW LEVEL SECURITY;
```

PR-A'da amalga oshirilgani (`migrations/20261028_019_matters.sql`) yuqoridagidan
farq qiladi:
- `kind`: `chat`, `scan`, `agent_run`, `note`. `file` olib tashlandi, chunki
  hozir fayl jadvali yo'q.
- `agent_run` havolasi PR-B'gacha qabul qilinmaydi (400).
- `ref_*` maydonlari turiga qarab qat'iy tekshiriladi.
- `admins` havolalari `ON DELETE CASCADE`.

Qoidalar:
- **Polimorf havola (`ref_int` / `ref_uuid`)** tanlangan, chunki manba
  jadvallarining kalit turlari har xil. Har bir o'qishda server havolaning
  egasini tekshiradi: chat, skan va run shu hisobniki bo'lishi kerak. Begona
  yoki o'chgan havola "mavjud emas" deb ko'rsatiladi, xato bermaydi.
- **Skan 7 kunda o'chadi** (`document_scans.expires_at`). Ishga qo'shilgan skan
  uchun ikki variant bor edi (egasi (a) ni tanladi, 8-bo'lim):
  - (a) ishga qo'shilganda `expires_at` uzaytiriladi;
  - (b) matn `matter_files`ga ko'chiriladi.

  Bu egasining qarori (8-bo'lim, 3-savol). Tavsiya: (a), ish yopilguncha va
  yana 30 kun saqlanadi.
- **Hisob o'chirilganda** (`src/services/account-deletion.js`) shu hisobning
  matter'lari va elementlari o'chiriladi. Agent natijalari ham o'chadi, chunki
  ularda shaxsiy ma'lumot bor.
- **Limit:** bir hisobga 200 ta ochiq ish, bir ishga 500 ta element
  (`MATTER_MAX_*`).

### 2.3 API (`src/matters/routes.js`)

| Metod | Yo'l | Izoh |
|---|---|---|
| GET | `/api/matters` | O'z ishlari va o'z Workspace'laridagi ishlar |
| POST | `/api/matters` | `{ title, summary?, workspaceId? }`; Workspace'ga faqat a'zo (owner/member) biriktira oladi |
| GET | `/api/matters/:id` | Ish va elementlar, har bir element havolasi tekshirilgan |
| PATCH | `/api/matters/:id` | Nom, xulosa, holat |
| DELETE | `/api/matters/:id` | Yumshoq o'chirish (`deleted_at`) |
| POST | `/api/matters/:id/items` | `{ kind, ref, title }`; havola egasi tekshiriladi |
| DELETE | `/api/matters/:id/items/:itemId` | Faqat bog'lanish o'chadi, manbaning o'zi qoladi |

Har bir POST, PATCH va DELETE `requireSameOrigin` va `requireAuth` bilan
himoyalanadi. Begona ish uchun 404 qaytariladi (403 emas), shunda uning
borligi ham bilinmaydi.

### 2.4 UI (PR-C, faqat `public/app/`)

- **Yon panel:** "Ishlar" (`#/ishlar`) - ro'yxat, qidiruv, holat.
- **Ish sahifasi** (`#/ishlar/:id`):
  - sarlavha va xulosa;
  - vaqt bo'yicha elementlar (chat, hujjat, jadval, playbook, loyiha, yozuv);
  - "Agent topshirig'i" maydoni (4-bo'lim).
- **"Ishga qo'shish" tugmasi** chat javobi, jadval, playbook va loyiha
  natijasi ostida turadi. U ish tanlash oynasini ochadi, oynada yangi ish
  ochish ham mumkin.
- Dizayn qoidalari: chap rangli chiziqli kartalar yo'q; rangli fon faqat och
  ko'k; shrift Golos Text.

---

## 3. Uzoq ishlar: `agent_runs`

### 3.1 Jadvallar (migratsiya `20261028_020_agent_runs.sql`)

```sql
CREATE TABLE public.agent_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id       integer NOT NULL REFERENCES public.admins(id) ON DELETE RESTRICT,
  matter_id      uuid REFERENCES public.matters(id) ON DELETE SET NULL,
  workflow       text NOT NULL,               -- 'claim_draft' | 'tabular_review' | 'playbook_review' | 'planned'
  channel        text NOT NULL CHECK (channel IN ('web','telegram','word')),
  status         text NOT NULL DEFAULT 'queued' CHECK (status IN
                   ('queued','awaiting_approval','running','needs_input','done','failed','cancelled','budget')),
  input          jsonb NOT NULL,              -- foydalanuvchi kiritgani; hujjat matni emas, scanId / fayl havolasi
  plan           jsonb,                       -- reja tuzuvchi natijasi (4-bo'lim), tasdiqlangan ko'rinishi
  price          jsonb,                       -- { service: units } - tasdiq oynasidagi narx
  jobs           jsonb NOT NULL DEFAULT '[]', -- tarif rezervlari: [{ jobKey, service, units, step }]
  budget         jsonb NOT NULL,              -- { maxSteps, maxMs, maxCalls, maxCostUsd }
  spent          jsonb NOT NULL DEFAULT '{}', -- { calls, costUsd, costUnknown, ms }
  result         jsonb,                       -- yakuniy natija (draftHtml, rows, ...)
  error          text,                        -- qisqa, kalitsiz (safeError)
  lease_owner    text,                        -- worker id (jarayon + boshlanish vaqti)
  lease_until    timestamptz,
  attempts       integer NOT NULL DEFAULT 0,
  request_id     uuid NOT NULL,               -- usage ledger: run'ning hamma AI chaqiruvlari shu id ostida
  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  expires_at     timestamptz NOT NULL         -- natija saqlanish muddati
);
CREATE INDEX agent_runs_queue_idx ON public.agent_runs (created_at) WHERE status IN ('queued','running');
CREATE INDEX agent_runs_admin_idx ON public.agent_runs (admin_id, created_at DESC);

CREATE TABLE public.agent_run_steps (
  run_id      uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  step_id     text NOT NULL,
  label       text NOT NULL,
  status      text NOT NULL CHECK (status IN ('running','ok','failed','skipped','skipped_error')),
  output      jsonb,                          -- keyingi qadamlar uchun checkpoint; prompt va xom model matni YO'Q
  note        text,
  ms          integer,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (run_id, step_id)
);
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_run_steps ENABLE ROW LEVEL SECURITY;
```

`agent_run_steps.output` - checkpoint. Qadam tugaganda uning natijasi shu
yerga yoziladi. Ish qayta boshlanganda harness tugagan qadamlarni o'tkazib
yuboradi va `state.steps`ni shu yerdan tiklaydi.

Maxfiylik: `output`da prompt va modelning xom matni saqlanmaydi.
- Saqlanadi: tanlangan manbalar (id, akt, modda, url), asos ro'yxati,
  jadval kataklari, loyiha HTML'i.
- Hujjat matni saqlanmaydi. U `scanId` yoki ishning faylidan qayta o'qiladi.

### 3.2 Holat mashinasi

```
queued ──► running ──► done
   │          │  ├──► needs_input ──(foydalanuvchi javobi)──► queued
   │          │  ├──► failed
   │          │  └──► budget
   │          └──(lease tugadi: server qayta ishga tushdi)──► queued (attempts+1, ≤ 3)
   └──(reja tuzuvchi)──► awaiting_approval ──(tasdiq)──► queued
                                 └──(rad etish yoki 24 soat)──► cancelled
istalgan holat (done/failed'dan tashqari) ──(foydalanuvchi)──► cancelled
```

### 3.3 Worker

- **Bitta jarayon ichida.** `src/agents/run-worker.js` server bilan birga
  ishga tushadi. Alohida Render servisi kerak emas.
- **Navbatdan olish.** Har 2 soniyada:
  ```sql
  UPDATE agent_runs SET status='running', lease_owner=$1, lease_until=now()+interval '90 seconds', attempts=attempts+1, started_at=COALESCE(started_at, now())
  WHERE id = (SELECT id FROM agent_runs
              WHERE status='queued' OR (status='running' AND lease_until < now())
              ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING *;
  ```
  Ish ketayotganda `lease_until` har 30 soniyada yangilanadi.
- **Bir vaqtda ishlaydigan run'lar.** PR-B'da `AGENT_RUN_CONCURRENCY` = 2.
  Bu loyihadagi 1 dan farq qiladi, sababi:
  - PR-B'gacha bu uchta route bir jarayonda cheklovsiz parallel ishlardi,
    shuning uchun 2 avvalgidan qattiqroq;
  - 1 bo'lganda bir kishining jadvali boshqa kishining da'vo loyihasini
    kutib turardi.

  lex.uz o'qishlari baribir jarayon bo'ylab bittadan
  (`LEX_FETCH_CONCURRENCY` 1, `docs/lessons/2026-10-lexuz-va-javob-zanjiri.md`).
  Bitta foydalanuvchining bir vaqtda bitta run'i ishlaydi, keyingisi
  `queued`da kutadi. Bir kishiga 5 tagacha faol run
  (`AGENT_RUNS_ACTIVE_PER_USER`), oshsa 429.
- **Qayta ishga tushish.** Deploy yoki crash bo'lsa, lease tugaydi va boshqa
  (yoki yangi) jarayon run'ni oladi. Tugagan qadamlar checkpoint'dan
  tiklanadi. `attempts` > 3 bo'lsa, run `failed` bo'ladi va birliklar
  qaytariladi.
- **Qadamlar idempotent bo'lishi shart.** AI chaqiruvi qayta bajarilsa, pul
  ikki marta ketadi, lekin natija bir xil saqlanadi. Shuning uchun run'ning
  AI byudjeti avvalgi urinishlarning `spent`ini hisobga oladi.
- **`MAINTENANCE_MODE=on`** bo'lsa, worker yangi run olmaydi.
- **O'chirish.** `AGENT_RUNS=off` bo'lsa, yangi run qabul qilinmaydi va eski
  route'lar hozirgidek sinxron ishlaydi.

### 3.4 Pul va byudjet

**Tarif birliklari:**
- Run yaratilganda (yoki reja tasdiqlanganda) narx `reserveMany` bilan bir
  tranzaksiyada rezerv qilinadi.
- Rezervga `meta.holdUntil` = run muddati + 30 daqiqa qo'yiladi. Shu mexanizm
  OCR'da ishlaydi, shuning uchun 30 daqiqalik TTL uzoq ishni kesmaydi.
- Natija qismi chiqqanda shu qismga tegishli birlik commit qilinadi, bu
  hozirgi `settleSections` / per-row qoidasi bilan bir xil. Qolgani release
  qilinadi.
- `cancelled`, `failed` yoki `budget` holatida chiqmagan qismlarning birligi
  qaytariladi.

**AI byudjeti:**
- Run `usageLedger.runWithRequest({ requestId: run.request_id, ... }, fn)`
  ichida ishlaydi va o'z chegarasini oladi: `AGENT_RUN_MAX_CALLS` 60,
  `AGENT_RUN_MAX_MS` 15 daqiqa, `AGENT_RUN_MAX_COST_USD` 1,00 (egasi
  tasdiqlaydi, 8-bo'lim 2-savol).
- Har bir qadamning ichki chaqiruvlari hozirgidek ledger qatori bo'ladi va
  `bound` talab qilinadi.
- Qayta urinishda `spent` DB'dan o'qiladi va byudjetdan ayiriladi.
- Narxi noma'lum chaqiruv byudjetda $0 deb hisoblanmaydi. U `costUnknown`
  bo'lib sanaladi va master hisobotida ko'rinadi.

### 3.5 Kuzatish (UI va Telegram)

- **`GET /api/agent/runs/:id`:** holat, qadamlar (label, holat, ms, note),
  sarflangan birlik, natija (`done` bo'lsa).
- **`GET /api/agent/runs/:id/events` (SSE):** server DB'dagi
  `agent_run_steps`ni 1,5 soniyada bir o'qiydi. Run boshqa jarayonda ketishi
  mumkin, shuning uchun xotiradagi event emitter'ga tayanilmaydi. Heartbeat
  25 soniya, hozirgi chat SSE bilan bir xil.
- **`POST /api/agent/runs/:id/cancel`** va
  **`POST /api/agent/runs/:id/input`** (`needs_input` javobi).
- **Telegram:** bitta xabar `editMessageText` bilan yangilanadi, xuddi hozirgi da'vo
  agenti kabi (`src/bot/bot.js`, "⚖️ Da'vo arizasi agenti" xabari). Tasdiq va bekor qilish inline tugmalar
  bilan.
- **Saqlash muddati:** `expires_at` = 90 kun (ishga bog'langan bo'lsa, ish
  o'chguncha). Kunlik tozalash `agent_run_steps.output` va `result`ni
  o'chiradi, qatorning o'zi hisobot uchun qoladi.

### 3.6 Mavjud workflow'lar run sifatida (PR-B)

`POST /api/agent/{claim-draft,tabular-review,playbook-review}` javob shakli
o'zgarmaydi. PR-B'da amalga oshirilgani (`src/agents/agent-routes.js`):

- **Uch qism.** Har bir workflow xizmat sifatida uch qismga bo'lindi:
  - `prepare`: kirish, manbalar va rezerv. AI chaqiruvi yo'q.
  - `run`: harness.
  - `settle`: yetkazilgan qism commit qilinadi, qolgani release qilinadi; javob shu yerda tuziladi.

  Shu bitta kod so'rov ichida ham, run sifatida ham ishlaydi.
- **Route kutadi.** Route run yaratadi va uning tugashini kutadi: workflow
  vaqti + 120 soniya navbat (`AGENT_SYNC_QUEUE_MS`). Keyin hozirgidek javob
  beradi, javobga faqat `runId` qo'shiladi.
- **202 qachon qaytadi.** `async: true` yuborilsa yoki kutish vaqti tugasa,
  `202 { runId }` qaytadi. Sahifa SSE'ga PR-C/PR-E'da o'tadi; hozirgi sahifa
  o'zgarmagan.
- **Rezerv.** Run uchun rezerv `meta.holdUntil` bilan ushlanadi: 45 daqiqa,
  `AGENT_RUN_HOLD_MIN`.
- **Eski yo'l.** `AGENT_RUNS=off` bo'lsa yoki jadval bo'lmasa, ish
  avvalgidek so'rov ichida bajariladi.
- **Telegram.** Botdagi da'vo agenti (`src/agents/telegram-claim.js`) hali
  so'rov ichida ishlaydi; u PR-F'da run'ga o'tadi.
- **Ma'lum cheklov.** Masterning "🧪" model tanlovi (`X-JAI-Test-Model`)
  so'rovga tegishli, shuning uchun worker ichidagi run'ga o'tmaydi. Pilot
  test-byudjeti esa o'tadi (`test-budget.attach`).

---

## 4. Reja tuzuvchi agent

### 4.1 Vositalar reestri (`src/agents/tools/index.js`)

Har bir vosita quyidagi maydonlarga ega:

```js
{
  id: 'lex_search',
  label: "lex.uz'da qidirish",
  describe: "...",            // reja tuzuvchi ko'radigan bitta jumla
  input: { /* JSON schema */ },
  output: { /* JSON schema */ },
  cost: { service: null, units: 0, aiClass: 'cheap', maxCalls: 3 },  // tarif birligi va AI sinfi
  sideEffects: false,         // true: foydalanuvchi nomidan biror narsa yaratadi (hujjat, xabar)
  needsApproval: false,
  run: async (args, ctx) => {...}
}
```

Birinchi to'plam faqat mavjud kodni o'raydi, yangi AI mantig'i qo'shilmaydi:

| Vosita | Asosi | Birlik |
|---|---|---|
| `lex_search` | `searchLexUz` (deadline bilan) | - |
| `read_act_unit` | lex kesh / `findKeyLine` | - |
| `corpus_search` | hybrid RAG | - |
| `doc_excerpt` | `selectExcerpt`, `document-explain` digest | chat yoki analysis |
| `tabular` | `tabular-review` qadamlari | hujjatga 1 chat |
| `playbook` | `playbook-review` | analysis |
| `draft_claim` | `claim-draft` | 1 draft |
| `answer` | Tahlil / Xulosa promptlari (`buildTopicPrompt`) | 1 chat |
| `verify` | `restoreQuotes` + `legal-claim-guard` + mexanik tekshiruvlar | - |
| `ask_user` | `needs_input` | - |

### 4.2 Reja

Reja tuzuvchi bitta arzon chaqiruv (`lane: cheap`, DeepSeek birinchi).
- **Ko'radi:** topshiriq, ish xulosasi, ishdagi elementlar ro'yxati (nomlari)
  va vositalarning `describe` jumlalari.
- **Qaytaradi:** JSON DAG:

```json
{ "goal": "...", "nodes": [
  { "id": "n1", "tool": "doc_excerpt", "args": { "item": "scan:…", "questions": ["…"] } },
  { "id": "n2", "tool": "lex_search",  "args": { "query": "pudrat avans qaytarish" } },
  { "id": "n3", "tool": "answer",      "args": { "question": "…" }, "after": ["n1","n2"] },
  { "id": "n4", "tool": "verify",      "args": {}, "after": ["n3"] } ] }
```

Server rejani **mexanik** tekshiradi, AI ishlatilmaydi:
- vosita reestrda bor, `args` sxemaga mos;
- havolalar shu ishniki;
- sikl yo'q;
- ≤ 12 tugun, ≤ 3 parallel;
- natija beruvchi har bir tugundan keyin `verify` bor;
- narx hisoblanadi.

Mos kelmagan reja rad etiladi. Shunda bitta qayta so'rov yuboriladi, xato
nomi bilan. Ikkinchisi ham yaroqsiz bo'lsa, foydalanuvchiga yaqin keladigan
qat'iy workflow taklif qilinadi.

**Tasdiq:**
- Narx > 0 bo'lsa yoki `sideEffects` vositasi bo'lsa, run
  `awaiting_approval` holatiga o'tadi.
- Foydalanuvchi qadamlar ro'yxatini va narxni ko'radi ("3 ta qadam, 2 savol
  birligi, 1 tahlil birligi"), keyin tasdiqlaydi.
- Tasdiqlangan reja `agent_runs.plan`ga yoziladi va o'zgarmaydi.

**Qayta rejalash:**
- Faqat bir marta va faqat tugun `failed` bo'lsa.
- Yangi reja narxi tasdiqlanganidan oshmasligi kerak, aks holda yana tasdiq
  so'raladi.

### 4.3 Parallel ijro

- Harness'ga qadam turi qo'shiladi: `{ id, parallel: [step, step], limit }`.
  Tugunlar `after` bo'yicha to'lqinlarga bo'linadi va har to'lqin
  `Promise.all` bilan ishlaydi, `limit` ≤ 3.
- Byudjet umumiy: chaqiruv joyi bir qadamda olinadi (hozirgi atomik
  `requestBudget`).
- lex.uz o'qishlari parallel bo'lsa ham `LEX_FETCH_CONCURRENCY` (1) va
  `readBudget` bilan cheklanadi. Bu xotira qoidasi agentda ham o'zgarmaydi.

### 4.4 O'zgarmas qoidalar

1. **Yakuniy matnni faqat `answer` / `draft_claim` / `tabular` / `playbook`
   yozadi** va undan keyin `verify` keladi. `verify`dan o'tmagan natija
   foydalanuvchiga "tekshirilmagan" belgisiz chiqmaydi.
2. **Reja tuzuvchi huquqiy matn yozmaydi.** U faqat vositalarni tanlaydi.
3. **Hujjat matni va foydalanuvchi ma'lumoti trace'ga tushmaydi.** Trace'da
   faqat label, holat, ms va qisqa note bo'ladi (hozirgidek).
4. **Vosita faqat chaqiruvchi hisobning ma'lumotiga tegadi.** `ctx.adminId`
   har bir o'qishda tekshiriladi.
5. **Ishga tushirish bosqichma-bosqich:** avval `AGENT_PLANNER=master` (faqat
   DB'dagi master), keyin `paid`, keyin `all`.

---

## 5. Xavfsizlik va maxfiylik

- **Yangi tashqi xizmat qo'shilmaydi.** AI chaqiruvlari hozirgi provayderlarga (DeepSeek birinchi)
  boradi. Foydalanuvchi matni `api.deepseek.com`ga ketishi bu yerda ham
  amal qiladi va maxfiylik sahifasida aytilgan bo'lishi kerak.
- **Begona ish va run uchun 404.** Master diagnostikasi (`trace: true`)
  hozirgi qoidada qoladi: DB'dagi master, `no-store`, log va saqlash yo'q.
- **Hisob o'chirilishi** matters, matter_items, agent_runs va
  agent_run_steps'ni qamraydi. Tarif va ledger qatorlari shaxsiy
  ma'lumotsiz qoladi (hozirgi qoida).

## 6. Resurslar

- **Xotira.** Bitta run bir vaqtda; `doc_excerpt` hujjatning faqat kerakli
  qismini xotirada ushlaydi. PR-B'da `scripts/lex-round-probe.js` kabi
  probe ishga tushiriladi: 3 qadamli run, peak memory, event-loop
  bloklanishi. Natija `docs/lessons`ga yoziladi.
- **DB.** Navbat so'rovi indeksli. Har bir run uchun ≤ 12 ta `agent_run_steps`
  qatori bo'ladi.

## 7. Testlar va qabul mezonlari

| PR | Testlar | Qabul |
|---|---|---|
| A | `tests/matters.test.js`: egalik, Workspace roli, begona havola 404, limitlar, hisob o'chirish; `tests/matters.db.test.js` CI'ning Postgres bosqichida | API stub DB bilan; migratsiya boot-smoke'da (`scripts/ci/boot-smoke.sh`) |
| B | `tests/agent-runs.test.js`: holat mashinasi, lease tugashi va davom ettirish (checkpoint'dan, qadam qayta bajarilmaydi), attempts > 3 → failed + release, holdUntil, cancel, byudjet `spent` bilan | 3 ta eski workflow testlari o'zgarishsiz o'tadi; deploy simulyatsiyasi (worker o'ldiriladi, boshqasi davom ettiradi) |
| C | front-end kontrakt testi; Chromium 1280 / 390 | Ish yaratish, chatni qo'shish, jadvalni qo'shish |
| D | `tests/agent-planner.test.js`: yaroqsiz reja rad etiladi (sikl, noma'lum vosita, verify yo'q, begona havola, 12+ tugun), narx hisobi, qayta so'rov bir marta | Stub provayder; 10 ta topshiriqda reja sxemaga mos |
| E | parallel to'lqinlar, umumiy byudjet, `needs_input` → davom | lex.uz o'qishlari parallel ham 1 tadan |
| F | Telegram xabari yangilanishi, tugmalar | `/testmode`da master sinovi |
| G | `docs/quality/agent-eval.md`, stub bilan CI'da | Yurist ko'rib chiqqan holatlar to'plami |

## 8. Egasining qarorlari (2026-10-28: "takliflaringni qabul qildim")

1. **Kim uchun.** Matter hamma pullik tarifda (Silver va undan yuqori, test
   entitlement, xodimlar) - 200 ta ochiq ish (`MATTER_MAX_OPEN`); Sinov va
   tarifsiz hisob - 1 ta ochiq ish. Agent rejasi avval faqat master uchun,
   keyin Gold va undan yuqori.
2. **Run byudjeti.** Bitta agent ishi: AI chegarasi $1,00 va 15 daqiqa.
   Reja tuzish chaqiruvi bepul (arzon lane); tarif birligi rejadagi
   vositalar yig'indisi.
3. **Skan.** Ishga qo'shilgan skan ochiq ish uni ushlab turganicha
   saqlanadi; oxirgi shunday ish yopilsa yoki o'chirilsa, yoki element olib
   tashlansa, yana 30 kun saqlanadi. OCR keshi bir xil faylni qayta
   o'qisa, muddat qisqarmaydi (`GREATEST`).
4. **Agent natijalari.** 90 kun; ishga bog'langan bo'lsa, ish o'chguncha.
5. **Workspace.** Viewer ishni faqat o'qiydi; owner va member yozadi.

## 9. PR tartibi

1. **PR-A:** migratsiya 019 va `/api/matters`, testlar. UI yo'q.
2. **PR-B:** migratsiya 020, worker, harness'ga checkpoint/resume, 3 workflow
   run orqali. Eski javob shakli saqlanadi.
3. **PR-C:** Matter UI va "ishga qo'shish" tugmalari. Faqat frontend,
   tekshiruvdan keyin merge qilinadi.
4. **PR-D:** vositalar reestri va reja tuzuvchi (`AGENT_PLANNER=master`).
5. **PR-E:** parallel to'lqinlar, tasdiq oynasi, `needs_input` davomi.
6. **PR-F:** Telegram.
7. **PR-G:** agent eval to'plami.

Har bir PR merge qilinganda `docs/roadmap/legora-darajasi.md`dagi belgi va
jurnal yangilanadi.
