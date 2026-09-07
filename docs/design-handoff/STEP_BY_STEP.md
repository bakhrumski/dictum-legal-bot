# Qadam-baqadam: dizaynni juristai.uz ga chiqarish

Bu qo'llanma hech qanday oldingi tajriba talab qilmaydi. Terminalga yozilishi
kerak bo'lgan buyruqlar ` ``` ` blokda. Har bir qadamdan keyin "Tekshirish"
bandi bor — o'tmasa keyingi qadamga o'tmang.

---

# 0-BOSQICH — Tayyorgarlik (bir marta, ~20 daqiqa)

## 0.1. Kerakli narsalar

- Kompyuterda **Node.js** (`node -v` → v18 yoki yuqori)
- **Git** (`git --version`)
- **Claude Code** (`npm i -g @anthropic-ai/claude-code`, keyin `claude` deb ishga tushadi)
- GitHub akkauntingiz `bakhrumski/dictum-legal-bot` ga yozish huquqiga ega bo'lishi

## 0.2. Repoyni kompyuterga olish

```bash
cd ~
git clone https://github.com/bakhrumski/dictum-legal-bot.git
cd dictum-legal-bot
npm install
```

## 0.3. Saytni lokal ishga tushirish

```bash
cp .env.example .env    # agar .env.example bo'lsa
npm start
```

Brauzerda `http://localhost:3000` (yoki `index.js`da ko'rsatilgan port) ochiladi.

**Tekshirish:** hozirgi sayt lokalda ochilsa — davom etamiz. Ochilmasa, `.env`
ichidagi ma'lumotlar bazasi sozlamalari kerak; `npm start` xatosini Claude Code'ga
ko'rsatib so'rang.

## 0.4. Dizayn paketini repoga qo'yish

1. Chatdan yuklab olgan `design_handoff_juristai_web.zip` faylni oching.
2. Ichidagi `design_handoff_juristai_web` papkasini butunligicha
   `~/dictum-legal-bot/` ichiga ko'chiring.

Natijada shunday bo'lishi kerak:

```
dictum-legal-bot/
├── public/
├── src/
├── index.js
└── design_handoff_juristai_web/     ← yangi
    ├── README.md
    ├── STEP_BY_STEP.md
    ├── CLAUDE_CODE_PROMPT.md
    └── design/
```

3. Alohida branch'ga commit qiling:

```bash
git checkout -b design/handoff-package
git add design_handoff_juristai_web
git commit -m "chore(design): add new design handoff package"
git push -u origin design/handoff-package
```

**Tekshirish:** GitHub'da `design/handoff-package` branch'i ko'rinsa — tayyor.

---

# 1-BOSQICH — Staging preview (A yo'li, ~30 daqiqa)

Maqsad: dizaynni real domenda ko'rish. Kod o'zgarmaydi, faqat yangi papka
qo'shiladi.

## 1.1. Yangi branch

```bash
git checkout main
git pull
git checkout -b feat/design-preview
```

## 1.2. Claude Code'ni ishga tushirish

```bash
claude
```

## 1.3. Topshiriqni berish

`design_handoff_juristai_web/CLAUDE_CODE_PROMPT.md` faylini ochib, **"Bosqich 0"**
blokidagi matnni to'liq nusxalab Claude Code'ga tashlang.

Claude Code fayllarni ko'chiradi, `index.js`ga CSP va basic-auth qo'shadi.
Har bir o'zgarishni tasdiqlashni so'raganda diff'ni o'qib **y** bosing.

## 1.4. Lokalda tekshirish

```bash
npm start
```

Brauzerda:
- `http://localhost:3000/preview/landing.dc.html`
- `http://localhost:3000/preview/login.dc.html`
- `http://localhost:3000/preview/dashboard.dc.html`

**Tekshirish:**
- Sahifalar ochilishi kerak, oq ekran bo'lmasligi kerak.
- Brauzerda `F12` → `Console` — qizil xato bo'lmasligi kerak.
- Yuqoridagi mavzu tugmasi dark/light almashtirishi kerak.
- Eski sahifalar (`/`, `/login.html`) avvalgidek ishlashi kerak.

Agar oq ekran bo'lsa: Console'dagi xatoni nusxalab Claude Code'ga bering —
odatda CSP yoki fayl yo'li muammosi.

## 1.5. PR yaratish

```bash
git add -A
git commit -m "chore(preview): serve new design prototypes under /preview"
git push -u origin feat/design-preview
```

Terminal push'dan keyin PR havolasini beradi — bosing, **Create pull request**.

## 1.6. Merge va deploy

PR'ni merge qiling. Deploy avtomatik bo'lsa (Railway / Render / Vercel) —
2-3 daqiqada `juristai.uz/preview/landing.dc.html` ishlaydi.
Basic-auth uchun serverning env'iga `PREVIEW_USER` va `PREVIEW_PASS` qo'shing.

**Tekshirish:** telefonda ham ochib ko'ring. Jamoaga havolani yuboring.

> ⚠️ `/preview/*` ni asosiy sayt sifatida ishlatmang — u CDN'ga bog'liq va
> SEO'siz. Bu faqat ko'rgazma.

---

# 2-BOSQICH — Dizayn tokenlari (~40 daqiqa)

Endi production ish boshlanadi. Bu eng muhim bosqich: ranglar, shriftlar,
o'lchamlar bir joyga yig'iladi va keyingi hamma sahifa shundan foydalanadi.

```bash
git checkout main && git pull
git checkout -b feat/design-tokens
claude
```

`CLAUDE_CODE_PROMPT.md` → **"Bosqich 1"** blokini Claude Code'ga tashlang.

**Tekshirish:**
- `public/css/tokens.css` fayli paydo bo'ldi.
- Ichida `--navy-900`, `--brand`, `--line`, `--panel-solid` kabi
  o'zgaruvchilar bor va `[data-theme="dark"]` bloki mavjud.
- Hech qanday mavjud sahifa buzilmagan (`npm start` bilan tekshiring — bu PR
  hali hech bir sahifaga ulanmaydi).

```bash
git add -A
git commit -m "feat(design): add design tokens from new system"
git push -u origin feat/design-tokens
```

PR → merge.

---

# 3-BOSQICH — Landing sahifa (~2-3 soat)

Bu eng ko'rinadigan natija.

```bash
git checkout main && git pull
git checkout -b feat/landing-redesign
claude
```

`CLAUDE_CODE_PROMPT.md` → **"Bosqich 2"** blokini tashlang.

Claude Code katta ish qiladi — sabr qiling, bir necha marta savol berishi mumkin.
Agar u "React qo'shaymi?" deb so'rasa — **yo'q** deng.

## Yonma-yon solishtirish (majburiy)

Ikki brauzer oynasini yonma-yon qo'ying:

| Chapda | O'ngda |
|---|---|
| `localhost:3000/preview/landing.dc.html` | `localhost:3000/` |

Quyidagilarni ketma-ket tekshiring — **ikkalasida bir xil bo'lishi kerak**:

1. Hero: telefon typing animatsiyasi, orqadagi tarozi (10% opacity)
2. "sun'iy intellekt" matnidagi glitch effekti
3. Sohalar lentasi (aylanuvchi)
4. LED panel: video karusel, logo, "Generated by AI / Verified by human"
5. Kartalar: hover'da orqaga qiyshayish + kursor ortidan yuruvchi ko'k nur
6. Foydalanuvchilar fikri: karusel (4 sekund), typing matn, raqamlar hisoblanishi
7. Tariflar: Bepul kartada shockwave (pastdan o'ngdan yuqoriga chapga, 3 sek)
8. Checkboxlar: ketma-ket belgilanishi
9. FAQ: flipboard animatsiyasi
10. CTA: spotlight nuri
11. Footer: shrift, havolalar (chiziqsiz)

Har birini **dark va light** rejimda, **1440×900 va 390×844** o'lchamda.

Farq topsangiz: skrinshot olib Claude Code'ga "chapdagi prototipda X, o'ngdagi
sahifada Y — prototipga moslashtir" deb bering.

```bash
git add -A
git commit -m "feat(landing): rebuild marketing page with new design"
git push -u origin feat/landing-redesign
```

PR → **merge qilishdan oldin** jamoaga ko'rsatib tasdiq oling → merge.

---

# 4-BOSQICH — Login (~1 soat)

```bash
git checkout main && git pull
git checkout -b feat/login-redesign
claude
```

`CLAUDE_CODE_PROMPT.md` → **"Bosqich 3"**.

**Tekshirish (eng muhimi):**
- Telegram va Google tugmalari **haqiqatan kirita oladi** — eski
  `login.html`dagi auth logikasi saqlangan bo'lishi kerak.
- Fon rasmi dark va light rejimda bir xil ko'rinadi.
- Wordmark video markazda, chapdan tekislangan.

Auth buzilsa — merge qilmang. Claude Code'ga: "eski login.html'dagi auth
funksiyalarini saqla, faqat markup va CSS o'zgarsin" deng.

---

# 5-BOSQICH — Dashboard qobig'i (~1.5 soat)

```bash
git checkout main && git pull
git checkout -b feat/dashboard-shell
claude
```

`CLAUDE_CODE_PROMPT.md` → **"Bosqich 4"**.

**Tekshirish:**
- Gorizontal scroll **yo'q** (sahifani o'ngga sura olmaslik kerak)
- Vertikal scrollbar ko'rinmaydi, lekin mouse roligi ishlaydi
- Pastdagi tab bar: fon to'liq (shaffof emas), ramka va soya bor, shrift Inter
- Dark va light ikkalasida ham

---

# 6-BOSQICH — Dashboard bo'limlari (~1-2 kun)

```bash
git checkout main && git pull
git checkout -b feat/dashboard-sections
claude
```

`CLAUDE_CODE_PROMPT.md` → **"Bosqich 5"**. Bu blokda 5 ta bo'lim bor —
**bittalab** bering, har birini alohida commit qiling:

1. **Asosiy** — statistika grafigi, navbat
2. **Workspace** — Ro'yxat / Vaqt jadvali / Grafik
3. **Chat** — guruh + shaxsiy, uch rejim
4. **AI** — chat, manbalar, hujjat drafti, o'ng drawer
5. **Boshqaruv** — a'zolar, shablonlar, sozlamalar

## Workspace Grafik — alohida diqqat

Bu eng murakkab qism. Tekshirish:
- Masala kartasini bosib sudrash mumkin
- Sudralganda punktir chiziq ortidan ergashadi
- A'zoni sudraganda uning masalalari birga ko'chadi
- Qo'yib yuborilganda kartalar bir-birining ustiga chiqmaydi (12px oraliq)
- Kartalar kanvasdan tashqariga chiqmaydi

## Demo ma'lumot

Bu bosqichda ma'lumotlar hali soxta (`MATTERS`, `WS_MEMBERS`). Bu normal —
Claude Code'ga har biri uchun `// TODO: connect to API` izoh qoldirishni
buyuring. Real API'ga ulash keyingi alohida ish.

---

# 7-BOSQICH — Tozalash (~20 daqiqa)

Hammasi ishlaganidan keyin:

```bash
git checkout main && git pull
git checkout -b chore/remove-preview
claude
```

Claude Code'ga:

```
`public/preview/` papkasini va `index.js`dagi /preview marshrutini,
CSP yumshatishni, basic-auth'ni o'chir. robots.txt'dagi Disallow: /preview/
qatorini ham olib tashla. `design_handoff_juristai_web/` papkasini qoldir —
u dokumentatsiya.
```

**Tekshirish:** sayt ishlaydi, `/preview/*` 404 qaytaradi.

---

# Muammo bo'lsa

| Belgi | Sabab | Yechim |
|---|---|---|
| Oq ekran, Console'da CSP xatosi | helmet tashqi skriptni bloklagan | Claude Code'ga Console xatosini bering |
| Shriftlar noto'g'ri (Times ko'rinadi) | element `#db-root`/`#jai-root` tashqarisida | "bu elementni root ichiga ko'chir" |
| Ranglar yo'q, hammasi shaffof | `var(--*)` root tashqarisida | yuqoridagi bilan bir xil |
| Animatsiya ishlamaydi | `@keyframes` ko'chirilmagan | "prototipdagi @keyframes'ni tokens.css'ga ko'chir" |
| Deploy'dan keyin eski versiya | brauzer keshi | `Ctrl+Shift+R` |
| PR'da 200+ fayl o'zgargan | `node_modules` commit bo'lgan | `.gitignore`ni tekshir |

## Har bir PR'dan oldin doim

```bash
npm run test:ui
npm run test:pricing
npm start           # va brauzerda ko'zdan kechir
```

## Xavfsizlik qoidalari

- **`main`ga to'g'ridan-to'g'ri push qilmang** — har doim branch + PR.
- Bir PR = bir sahifa. Katta PR'ni tekshirish imkonsiz.
- Merge'dan oldin `/preview/*` bilan yonma-yon solishtiring.
- Auth, to'lov, API bilan bog'liq kodga tegmang — bu faqat dizayn ishi.

---

# Vaqt jadvali (taxminiy)

| Bosqich | Vaqt | Natija |
|---|---|---|
| 0 — Tayyorgarlik | 20 daq | Repo lokalda ishlaydi |
| 1 — Preview | 30 daq | Dizayn internetda ko'rinadi |
| 2 — Tokenlar | 40 daq | Ranglar/shriftlar bir joyda |
| 3 — Landing | 2-3 soat | Yangi asosiy sahifa |
| 4 — Login | 1 soat | Yangi kirish sahifasi |
| 5 — Dashboard qobig'i | 1.5 soat | Header + tab bar |
| 6 — Bo'limlar | 1-2 kun | To'liq ilova |
| 7 — Tozalash | 20 daq | Preview olib tashlanadi |
