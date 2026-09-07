# JuristAI — dizaynni juristai.uz ga implementatsiya qilish

Bu paket `bakhrumski/dictum-legal-bot` repozitoriysiga Claude Code yordamida
pull request orqali kiritish uchun tayyorlangan.

## Ichida nima bor

```
design/
  JuristAI Landing.dc.html          ← marketing sahifa (hero, LED panel, tariflar, FAQ, footer)
  JuristAI Login.dc.html            ← kirish sahifasi
  JuristAI Dashboard.dc.html        ← ilova (Asosiy, Workspace, Chat, AI, Boshqaruv)
  JuristAI Brand Identity.dc.html   ← brend kitobi (logo, ranglar, shrift)
  support.js                        ← preview runtime (faqat prototip uchun)
  brand/  media/  icons/            ← barcha real assetlar
  _ds/.../colors_and_type.css       ← dizayn tokenlari (rang, shrift, spacing)
  _ds/.../README.md                 ← dizayn tizimi qo'llanmasi
CLAUDE_CODE_PROMPT.md               ← Claude Code'ga beriladigan topshiriq
```

`.dc.html` fayllarni brauzerda to'g'ridan-to'g'ri ochish mumkin — ular
`support.js` bilan bir papkada bo'lishi kifoya.

---

## Muhim: nega "hech qayerini o'zgartirmasdan" ikki xil ma'noda bo'ladi

Bu fayllar **prototip**: ular `support.js` preview runtime'ida ishlaydi, u esa
React va Babel'ni `unpkg.com` CDN'idan yuklaydi va shablonni brauzerda
kompilyatsiya qiladi. Ko'rinishi 1:1 to'g'ri, lekin:

- CDN'ga bog'liqlik (unpkg tushsa — sayt oq ekran),
- brauzerda Babel kompilyatsiyasi (~400 KB ortiqcha yuklama, sekin ochilish),
- SEO uchun HTML bo'sh (hamma narsa JS bilan chiziladi),
- `helmet` CSP siyosatingiz tashqi skriptni bloklashi mumkin.

Shuning uchun **ikki bosqichli** yo'l tavsiya qilaman.

---

## A yo'li — darhol staging'ga qo'yish (1 PR, 30 daqiqa)

Maqsad: dizaynni real domenda ko'rish, jamoaga ko'rsatish. Piksel darajasida
aynan shu ko'rinish, hech narsa o'zgarmaydi.

1. `design/` ichidagi hammasini repoga `public/preview/` sifatida ko'chirish:

```
public/preview/support.js
public/preview/landing.dc.html      (JuristAI Landing.dc.html'dan)
public/preview/login.dc.html
public/preview/dashboard.dc.html
public/preview/brand.dc.html
public/preview/brand/  media/  icons/  _ds/
```

2. `index.js`dagi static middleware allaqachon `public/`ni beradi, ya'ni
   `juristai.uz/preview/landing.dc.html` ishlaydi. Agar chiroyli URL kerak bo'lsa:

```js
app.get('/preview/:page', (req, res, next) => {
  const allowed = ['landing', 'login', 'dashboard', 'brand'];
  if (!allowed.includes(req.params.page)) return next();
  res.sendFile(path.join(__dirname, 'public', 'preview', `${req.params.page}.dc.html`));
});
```

3. CSP: `helmet` sozlamasida `unpkg.com` (script-src), `fonts.googleapis.com`
   (style-src) va `fonts.gstatic.com` (font-src) ruxsat etilishi kerak — faqat
   `/preview/*` yo'li uchun.

4. `/preview/*`ni `robots.txt`da yopish va basic-auth qo'yish (production trafik
   uchun mo'ljallanmagan).

**Natija:** dizayn o'zgarmagan holda internetda. Lekin bu vaqtinchalik ko'rgazma,
production emas.

---

## B yo'li — production (asosiy ish, 3-5 PR)

Reponing o'zi allaqachon **oddiy statik HTML + CSS + vanilla JS** (`public/*.html`,
Express bilan beriladi). Ya'ni prototipni shu formatga o'girish kerak — freymvork
qo'shish shart emas, bu eng kam risk.

Har bir sahifa uchun bitta PR:

| PR | Nima | Nishon fayl |
|---|---|---|
| 1 | Tokenlar + shriftlar + assetlar | `public/css/tokens.css`, `public/brand/`, `public/media/` |
| 2 | Landing | `public/index.html` (yoki `ai-portal.html` o'rniga) |
| 3 | Login | `public/login.html` |
| 4 | Dashboard qobig'i (header, tab bar, mavzu almashtirish) | `public/ai-dashboard.html` |
| 5 | Dashboard bo'limlari (Workspace, Chat, AI drawer, Boshqaruv) | shu yerda |

### Konvertatsiya qoidalari (Claude Code shu qoidalarga amal qilishi kerak)

1. **Inline `style="..."` → aynan shu qiymatlar bilan CSS klasslar.** Hech bir
   piksel, hex, radius, gap o'zgarmaydi. Prototipda styling faqat inline —
   qidirib topish oson.
2. **`var(--*)`** o'zgaruvchilari `colors_and_type.css` va DC'ning `<helmet>`
   ichidagi `:root` / `[data-theme="dark"]` bloklaridan olinadi — ularni
   `public/css/tokens.css`ga ko'chirish kerak, o'zgartirmasdan.
3. **`<sc-for list="{{ x }}">` → `.map()` yoki server-side render.** Ma'lumot
   massivlari (`MATTERS`, `WS_MEMBERS`, `TABS`, `PLANS`, `FAQS` va h.k.) logic
   klass boshida turadi — ular to'g'ridan-to'g'ri ko'chiriladi va keyin real
   API'ga ulanadi.
4. **`<sc-if>` → shartli render / `hidden` atributi.**
5. **`class Component extends DCLogic` → oddiy JS modul.** `state` → modul
   ichidagi obyekt, `setState` → qayta chizish funksiyasi. Metodlar (drag,
   collision, typing animatsiya, carousel) mantiqiy jihatdan o'zgarishsiz
   ko'chiriladi.
6. **`@keyframes` va `<helmet><style>` ichidagi hamma narsa** — o'zgarishsiz
   `tokens.css` yoki sahifa CSS'iga.
7. **`style-hover` / `style-active` / `style-focus`** atributlari → `:hover`,
   `:active`, `:focus-visible` qoidalari.
8. **React'ga o'tmaslik.** Repoda React yo'q; qo'shish katta refactor va
   deployni buzadi.

### Qabul mezoni (har bir PR uchun)

- Prototip va yangi sahifa yonma-yon 1440×900 va 390×844 da solishtiriladi —
  ko'zga ko'rinadigan farq bo'lmasligi kerak.
- Dark va light rejim ikkalasi ham tekshiriladi.
- `npm run test:ui` va `npm run test:pricing` o'tadi.
- Lighthouse: hozirgi sahifadan yomon bo'lmasligi.

---

## Nima qilishni tavsiya qilaman

1. Avval **A yo'li** — bugun staging'da ko'rasiz, jamoa tasdiqlaydi.
2. Keyin **B yo'li** — PR ketma-ket, har birini staging bilan solishtirib.
3. Landing va Login birinchi (eng oson, eng ko'rinadigan). Dashboard oxirida —
   u eng katta va real API'ga ulanishi kerak.

## Ochiq savollar

- `media/led-ad.webm` bu paketda yo'q (loyihada ham yo'q) — LED paneldagi video
  faylni qayta yuklash kerak.
- Dashboarddagi ma'lumotlar (masalalar, a'zolar, chat) — demo. Qaysi API
  endpointlarga ulanishini aytishingiz kerak.
- Font: **Source Serif 4** va **Inter** Google Fonts'dan yuklanadi. Agar o'z
  serveringizdan bermoqchi bo'lsangiz, `.woff2` fayllarni `public/fonts/`ga
  qo'yib `@font-face` yozish kerak.
