# JuristAI Landing — barcha animatsiyalar

Manba: `design/JuristAI Landing.dc.html`. `@keyframes` qoidalari 56–176-qatorlarda
(`<helmet><style>` ichida). Qolgan mantiq logic klassda.

---

## 1. Header (sticky navigatsiya)

| Element | Effekt | Nom / qiymat |
|---|---|---|
| Header foni | `backdrop-filter: blur(20px)` + 94% shaffof canvas | CSS, animatsiya emas |
| Navigatsiya havolalari | hover'da rang `--muted` → `--brand` | `transition` |
| Mavzu tugmasi | dark/light almashtirish | JS, `data-theme` atributi |

---

## 2. Hero

### 2.1. "sun'iy intellekt" — doimiy digital glitch
- **Keyframes:** `jai-gl-a`, `jai-gl-b`, `jai-gl-skew` (148–171-qator)
- **Ishlatilishi:** 270-qator, `data-r="hero-h1"` ichidagi span
- **Mantiq:** matn uch qatlamga bo'linadi — asosiy + ikki `::before/::after`
  klon. Klonlar `clip-path: inset()` bilan yuqori/pastki yarmiga kesiladi va
  bir necha piksel siljiydi. Butun blok `skewX(1.2deg)` bilan qaltiraydi.
- **Davomiylik:** `jai-gl-a` va `jai-gl-b` uzluksiz takrorlanadi; siljish faqat
  sikl davomiyligining 7–20% va 92–95% oynasida sodir bo'ladi — shuning uchun
  glitch tasodifiy ko'rinadi.

### 2.2. Orqa fondagi tarozi
- **Keyframes:** `jai-kenburns` — `scale(1.12)` → `scale(1.3)`
- **Ishlatilishi:** 253-qator, `media/hero-scales.jpg`
- **Qiymatlar:** `opacity: .1`, `filter: contrast(1.25) saturate(.8)`,
  chapdan `-16%`, tepadan `150px`. Sarlavha **orqasida** (z-index 0).
- **Mask:** `linear-gradient(180deg, #000 0, #000 76%, transparent)` — pastda
  yo'qoladi, kesilgan chiziq ko'rinmaydi.

### 2.3. Qonun moddalari 3D zoom
- **Keyframes:** `jai-zoom-a`, `-b`, `-c`, `-d` (123–146-qator)
- **Ishlatilishi:** 848–861-qator (`codeRefs` massivi), 257–260-qatordagi markup
- **Mantiq:** `perspective: 900px` konteynerda matnlar (`MK 333`, `SK 45-modda`,
  `MJtK 135-modda`, `PQ-10`, `VMQ-426`) `translate3d(0,0,-1400px) scale(.10)`
  dan boshlanib tomoshabinga qarab uchib keladi va yon tomonga chiqib ketadi.
- **Har biri boshqa yo'nalish:** a → chapga-yuqoriga, b → o'ngga-pastga,
  c → yuqoriga, d → chapga-pastga. `filter: blur()` masofa hissi beradi.

### 2.4. Telefon typing animatsiyasi
- **Keyframes:** `jai-blink` (kursor), `jai-rise` (xabar paydo bo'lishi),
  `jai-pulse` (online nuqta)
- **Ishlatilishi:** 267 (pulse), 308/318/321 (rise), 312–314/328 (blink)
- **Mantiq (logic klass):**
  1. `keyRows()` — telefon klaviaturasi. Yozilayotgan harf `k.bg` orqali
     yoritiladi.
  2. `draft` — input ichida savol harfma-harf paydo bo'ladi (`qLen` state).
  3. Send tugmasi bosiladi — `sendScale: 0.86`.
  4. Savol xabari `jai-rise` bilan chiqadi.
  5. Uch nuqta (`chatDots`) — `jai-blink` 1.2s, `.2s`/`.4s` kechikish bilan.
  6. Javob `jai-rise` bilan chiqadi, keyin manba chipi.
  7. Sikl qaytadan boshlanadi.

---

## 3. "Qamrab oladi" lentasi

- **Keyframes:** `jai-scroll` — `translateX(-50%)`
- **Ishlatilishi:** 358-qator
- **Mantiq:** soha nomlari ro'yxati ikki marta takrorlanadi, konteyner chapga
  50% suriladi — uzluksiz aylanish. `data-r="mq"` orqali rang teskari
  (dark rejimda oq fon, light rejimda navy).

---

## 4. `#features` + `#how` — Narvon (ladder) animatsiyasi

**Eng murakkab qism.** To'liq tavsif quyida.

- **Konteyner:** `<div data-r="solve" ref="{{ solveRef }}">` — 381-qator.
  `#features` bo'limidan boshlanadi, `#how` bo'limi oxirida tugaydi.
- **Canvas:** 383-qator — `position:sticky; top:0; height:100vh; opacity:.10`
- **Metodlar (logic klass):**

| Metod | Vazifa |
|---|---|
| `buildLadder(w, h)` | 132 pog'ona × 9 nuqta. Seed `20260829` — har safar bir xil |
| `drawField()` | har kadrda `requestAnimationFrame` bilan chizadi |
| `sizeField()` | DPR bilan canvas o'lchamini sozlaydi |
| `fieldNode()` | canvas DOM elementi |
| `this.ladderKey` | `"1440x900"` — o'lcham o'zgarsa qayta quriladi |

- **Mantiq:** scroll pozitsiyasi 0→1 progressga aylanadi. Progress 0 da nuqtalar
  tartibsiz tarqalgan, progress 1 da narvon shakliga yig'ilgan. Har bir nuqtaning
  `sp` (speed) qiymati `0.4 + rnd() * 0.9` — turli tezlikda ko'chadi.
- **Rang:** dark `rgb(128,176,255)`, light `rgb(37,88,214)`.
- **Yo'nalish:** pastga scroll → yig'iladi; yuqoriga scroll → tarqaladi.

### 4.1. Feature kartalar — tilt + kursor nuri
- **CSS:** 63–64-qator, `[data-tilt]` selektori
- **Tilt:** hover'da kursor joyi bo'yicha karta orqaga qiyshayadi.
  `transition: transform 300ms cubic-bezier(.2,.8,.2,1)`
- **Kursor nuri:** karta foni `radial-gradient(120% 90% at var(--gx) var(--gy), ...)`.
  JS `--gx` / `--gy` CSS o'zgaruvchilarini kursor pozitsiyasiga qarab yangilaydi —
  ko'k nur kursor ortidan yuradi.
- **Hover shadow:** `0 22px 60px -22px` brand rangda.

### 4.2. `#how` — qadamlar
- `jai-pulse` (548-qator) — aktiv qadam nuqtasi
- `jai-blink` (493-qator) — "Namuna javob" kartasidagi typing kursori

---

## 5. LED display bo'limi

| Effekt | Keyframes | Qator |
|---|---|---|
| Ekran suzishi | `jai-ledfloat` — `rotateY(-19deg → -16deg)` + `translateY(-10px)` | 526 |
| Skan chizig'i (ustki) | `jai-scan` — pastga tushadi, 12%–88% da ko'rinadi | 509 |
| Skan chizig'i (ostki) | `jai-scanline` — 10%–90% oynasi | 510 |
| Shisha yaltirashi | `jai-glare` — `translateX(-60% → 120%)` | 578 |
| Rasm zoom | `jai-keyart` — `scale(1 → 1.07)` | 537 |

- **Video karusel:** `media/ad-1..4*.png` + har biriga tegishli matn. Har bir
  video/rasm o'z vaqtida almashadi, matn yonida rasm balandligi ekranga to'g'ri
  keladi.
- **Ekran ustidagi yozuvlar:** juristAI wordmark (tepada), "Efirda",
  "Generated by AI" (sparkles ikonka) va "Verified by human" (fingerprint
  ikonka) — pastda.

---

## 6. "Foydalanuvchilar fikri" karusel

- **Keyframes:** `jai-cardfloat` (1416-qator) — old kartada `translateY(-8px)`
  suzish; `jai-numroll` + `jai-numglow` (1424-qator) — raqamlar
- **Karusel mantiqi:** 3 karta — biri oldinda, ikkitasi orqada (blur'langan
  lekin ko'rinadi). Soat yo'nalishi bo'yicha aylanadi.
- **Interval:** **4 sekund**
- **Karta o'lchami:** asosiy o'lchamdan **1.7×** katta
- **Typing matn:** har bir feedback matni harfma-harf yoziladi, oxirida
  **3 sekund** pauza, keyin qaytadan.
- **Raqamlar:** `jai-numroll` — `rotateX(-90deg) scale(.7)` dan aylanib chiqadi,
  `jai-numglow` bilan yorug'lik halqasi.

---

## 7. `#pricing` — Tariflar

### 7.1. Fon
- **Keyframes:** `jai-pool`, `jai-pool2` (589–590-qator)
- Ikki katta yumshoq doira sekin siljib, o'lchami o'zgaradi — "siyoh hovuzi".

### 7.2. Bepul karta — shockwave
- **Keyframes:** `jai-shockwave` (96–101-qator), ishlatilishi 1449-qator
- **Yo'nalish:** `translate(18%, 18%) scale(.28)` → `translate(-18%, -18%) scale(1.5)`
  ya'ni **pastdan-o'ngdan → yuqoriga-chapga**
- **Davomiylik:** **3 sekund**, 12% da to'liq ko'rinadi

### 7.3. Checkboxlar — ketma-ket belgilanish
- **Keyframes:** `jai-tickdraw` (950-qator) — `stroke-dashoffset: 26 → 0`,
  ya'ni belgi chizib chiqiladi (typing uslubi); `jai-tickpop` (954-qator) —
  `scale(1.18)` sakrash
- **Mantiq:** har bir checkbox navbatma-navbat belgilanadi. Har belgi bilan
  yonidagi matn `--muted` dan `--ink` (qora) ga o'tadi.
- **Takrorlanish:** oxirgi belgidan keyin **2 sekund** pauza, keyin qaytadan.

### 7.4. Progress bar
- **Keyframes:** `jai-barfill` — `width: 0% → 100%` (1443-qator)

---

## 8. `#faq` — Flipboard

### 8.1. Savollarning almashishi
- **Keyframes:** `jai-flipboard` (86–91-qator), ishlatilishi 1020-qator
- **Harakat:** `rotateX(-92deg)` dan boshlanib, `rotateX(12deg)` da oshib
  ketadi, keyin `rotateX(0)` ga o'tiradi — aeroportdagi split-flap taxta kabi.
- **Qo'shimcha:** `jai-flapout` (1035) va `jai-flapin` (1043) — eski savol
  pastga aylanib ketadi, yangisi tepadan tushadi.
- **Interval:** har bir savol to'plami **4 sekundda** yangilanadi.
- **Kaskad:** keyingi savolning animatsiyasi oldingisining **50%** da boshlanadi.

### 8.2. Fon — flap kataklari
- **Keyframes:** `jai-flapcell` (76-qator), ishlatilishi 624-qator
- 22×11 to'rdagi kichik to'rtburchaklar tasodifiy vaqtda `scaleY(.2)` ga
  bosilib qaytadi. Har birining davomiyligi 7–16s, kechikishi 0–9s.
- **Mask:** `radial-gradient(120% 90% at 50% 50%, #000 30%, transparent 88%)` —
  chetlarda yo'qoladi.

---

## 9. CTA — "Huquqiy savolingiz bormi?"

- **Keyframes:** `jai-sweep` (77–82-qator), `jai-ctaglow` (83-qator)
- **Spotlight:** 34% kenglikdagi qiya (`rotate(14deg)`) yorug'lik nuri panel
  bo'ylab chapdan o'ngga suriladi (`translateX(0 → 390%)`), `blur(22px)`.
- **Pastdagi nur:** `radial-gradient(60% 90% at 50% 120%)` — nur bilan bir vaqtda
  yorishadi (`opacity: .45 → 1`).
- **Davomiylik:** **13 sekund**, `cubic-bezier(.4,0,.2,1)`

---

## 10. Footer

Animatsiya yo'q. Faqat:
- Havolalarda hover'da rang `--brand-2` ga o'tadi
- Chiziq (`text-decoration`) hamma holatda `none !important`
- Shrift `Space Grotesk` (butun sahifa bilan bir xil)

---

## Umumiy qoidalar

- **Easing:** kirish uchun `cubic-bezier(.2,.8,.2,1)`, simmetrik uchun
  `cubic-bezier(.4,0,.2,1)`
- **Davomiylik:** 120ms (mikro), 220–300ms (holat o'zgarishi), 360ms+ (katta)
- **Sakrash yo'q** — spring/bounce ishlatilmaydi
- **`will-change`** faqat og'ir animatsiyalarda (`jai-zoom`, tilt)
- **Fon animatsiyalari opacity:** 3–10% oralig'ida — matnni bezovta qilmaydi

## Ishlatilmayotgan keyframes (o'chirilishi mumkin)

`jai-breathe`, `jai-shock`, `jai-shockring`, `jai-dash`, `jai-trailglow`,
`jai-sc-a`, `jai-sc-b`, `jai-sc-c` — oldingi iteratsiyalardan qolgan.
