# Claude Code topshiriq (copy-paste)

Quyidagini Claude Code'ga repo ichida bering. Har bir bosqich alohida PR.

---

## Bosqich 0 — staging preview (A yo'li)

```
Bu repoda `design_handoff_juristai_web/design/` papkasi bor — bu JuristAI'ning
yangi dizayn prototipi (HTML + preview runtime).

Vazifa: uni production kodga tegmasdan staging preview sifatida chiqar.

1. `design_handoff_juristai_web/design/` ichidagi hamma narsani
   `public/preview/` ga ko'chir. `.dc.html` fayllarni qisqa nom bilan:
   landing.dc.html, login.dc.html, dashboard.dc.html, brand.dc.html.
   Nisbiy yo'llar (./support.js, brand/, media/, icons/, _ds/) o'zgarmasligi
   kerak — papka strukturasini saqla.
2. `index.js`da faqat `/preview/*` uchun helmet CSP'ni yumshat:
   script-src ga 'unsafe-eval' va https://unpkg.com,
   style-src ga https://fonts.googleapis.com,
   font-src ga https://fonts.gstatic.com.
   Boshqa hamma yo'l uchun CSP o'zgarmasin.
3. `/preview/*` ga basic-auth qo'y (env: PREVIEW_USER, PREVIEW_PASS).
4. `robots.txt` ga `Disallow: /preview/`.
5. HTML/CSS/JS fayllarning ichini O'ZGARTIRMA. Bir harf ham.

PR nomi: "chore(preview): serve new design prototypes under /preview"
```

---

## Bosqich 1 — dizayn tokenlari

```
`design_handoff_juristai_web/design/` ichidagi prototiplardan dizayn tokenlarini
ajratib `public/css/tokens.css` yarat.

Manbalar:
- `_ds/juristai-design-system-.../colors_and_type.css`
- har bir .dc.html faylning <helmet><style> ichidagi :root va
  [data-theme="dark"] bloklari
- @keyframes qoidalari

Qoidalar:
- Hech bir qiymatni o'zgartirma, yaxshilama, yumaloqlashtirma. Aynan ko'chir.
- Light default, dark uchun [data-theme="dark"] selektori.
- Shriftlar: Source Serif 4, Inter, JetBrains Mono — Google Fonts <link>.
- tokens.css'ni `public/*.html` sahifalarga hali ulama — keyingi PR'da.

PR nomi: "feat(design): add design tokens from new system"
```

---

## Bosqich 2 — Landing

```
`design_handoff_juristai_web/design/JuristAI Landing.dc.html` ni piksel darajasida
`public/index.html` sifatida qayta yoz. Oddiy HTML + CSS + vanilla JS. React YO'Q.

Konvertatsiya:
- inline style="..." → tokens.css'dagi qiymatlar bilan CSS klasslar. Qiymatlar
  o'zgarmaydi.
- style-hover / style-active / style-focus → :hover / :active / :focus-visible
- <sc-for list="{{ x }}"> → JS .map() yoki statik HTML (ro'yxat o'zgarmasa)
- <sc-if value="{{ x }}"> → shartli render
- class Component extends DCLogic → public/js/landing.js dagi oddiy modul.
  state → obyekt, setState → render() chaqiruvi.
- Barcha animatsiyalar aynan saqlanadi: hero telefon typing, LED panel video
  karusel, sohalar lentasi, tariflar shockwave, FAQ flipboard, CTA spotlight,
  raqamlar hisoblanishi, feedback typing.
- Assetlar: brand/, media/, icons/ → public/ ichiga.
- Dark/light almashtirish tugmasi ishlashi kerak, holat localStorage'da.

Tekshirish: /preview/landing.dc.html va /index.html ni 1440x900 va 390x844 da
solishtir, ikkala rejimda. Farq bo'lmasligi kerak.

PR nomi: "feat(landing): rebuild marketing page with new design"
```

---

## Bosqich 3 — Login

```
`JuristAI Login.dc.html` → `public/login.html`. Bosqich 2 bilan bir xil qoidalar.

Diqqat:
- Hero kartaning fon rasmi (media/hero-scales.jpg) 50% opacity, dark va light
  rejimda BIR XIL ko'rinishi kerak — prototipdagi filter/blend qiymatlarini
  aynan ko'chir.
- brand/wordmark-motion-white.webm — markazda, "Sizning shaxsiy AI yordamchingiz"
  matni ustida, chapdan tekislangan.
- Telegram va Google tugmalari mavjud auth oqimiga ulanadi (hozirgi login.html'dagi
  logikani saqla).

PR nomi: "feat(auth): rebuild login page with new design"
```

---

## Bosqich 4 — Dashboard qobig'i

```
`JuristAI Dashboard.dc.html` → `public/ai-dashboard.html`, faqat qobiq:
header (logo, mavzu tugmasi, profil), pastdagi tab bar (5 tab), sahifa
konteyneri, mavzu tokenlari.

Diqqat:
- Tab bar #db-root ICHIDA bo'lishi kerak (var(--*) ishlashi uchun).
- Gorizontal scroll bo'lmasligi kerak; vertikal scrollbar yashirin (mouse
  bilan scroll ishlaydi).
- Bo'limlar keyingi PR'da; hozir bo'sh konteyner.

PR nomi: "feat(dashboard): new shell, header and tab bar"
```

---

## Bosqich 5 — Dashboard bo'limlari

```
Bo'limlarni ketma-ket ko'chir, har biri alohida commit:
1. Asosiy — statistika grafigi, navbat ro'yxati
2. Workspace — Ro'yxat / Vaqt jadvali / Grafik. Grafikda drag + collision
   mantiqi (layout(), pos(), onDown(), separate() metodlari) aynan ko'chiriladi.
3. Chat — guruh/shaxsiy, uch rejim (faqat guruh, faqat shaxsiy, ikkalasi)
4. AI — chat, manbalar, hujjat drafti; Workspace'dagi "AI'dan so'rash"
   o'ng drawer'ni ochadi
5. Boshqaruv — a'zolar, shablonlar, sozlamalar

Demo ma'lumot massivlari (MATTERS, WS_MEMBERS, ...) vaqtincha saqlanadi,
keyin real API'ga ulanadi — TODO izoh qoldir.

PR nomi: "feat(dashboard): <bo'lim nomi>"
```
