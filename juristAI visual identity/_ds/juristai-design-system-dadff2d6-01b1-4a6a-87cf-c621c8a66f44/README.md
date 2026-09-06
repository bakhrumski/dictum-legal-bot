# JuristAI / Dictum Design System

A design system for **JuristAI** (also known as **Dictum AI**), an AI-powered legal platform serving lawyers, law students, and citizens in Uzbekistan.

---

## What the product is

JuristAI is a legal-research and document-drafting platform built around a Retrieval-Augmented Generation (RAG) pipeline over Uzbek legal codes (Civil, Criminal, Labor, Family, Property, Administrative). Three surfaces compose the product:

| Surface | Audience | Purpose |
|---|---|---|
| **Telegram bot** (`@yuristga_savolbot`) | Citizens | Quick legal Q&A, claim intake, document upload |
| **Dictum admin dashboard** | Master Admin / firm staff | Manage user requests, ingest legal documents (OCR), tag chunks for RAG, review AI feedback |
| **JuristAI portal** (`ai-portal.html` + `ai-dashboard.html`) | Lawyers, law students | Subscription-based AI chat, document drafting, RAG search with source citations |

### Core capabilities (per the user brief)
- Answers any legal question from a curated database, chunked and tagged by the Master Admin
- Ingests legal documents via OCR
- Drafts legal documents from user inputs
- Adapts the user dashboard to behavior (frequently used document types surface first)
- Auto-fills client data for repeat clients during drafting
- Flags typos, errors and critical moments — proceeds only with user permission

### Sources used to build this system
- **Codebase:** `bakhrumski/dictum-legal-bot` (private GitHub repo) — primary truth source
  - `public/login.html` — JuristAI login (light glassmorphism, purple gradient hero)
  - `public/ai-portal.html` — Marketing/landing + auth (dark SaaS, teal accents)
  - `public/ai-dashboard.html` — AI chat dashboard (dark, sidebar + messages)
  - `public/dashboard.html` — Dictum admin dashboard (200KB+, complex)
  - `public/jurist_logo.png`, `jurist_logo_white.png`, `dictum_logo.png` — brand assets
  - `public/fonts/Roboto-{Regular,Bold}.ttf` — print/PDF font
- **User brief:** Described AI legal platform; requested *"warm, professional palette suiting a legal work environment"*

> Design note: The existing codebase mixes two visual directions — a cool dark-teal SaaS look (AI portal) and a warm purple-glass look (login). The user's "warm, professional" steer plus the formal Dictum serif wordmark anchored this system on **parchment + brass + ink**, with a **warm-dark** mode for the AI chat surface that retains the codebase's dark SaaS feel without the cool teals.

---

## Brand at a glance

- **Two product marks**
  - **Dictum** — black serif wordmark with scales-of-justice icon. Used by the law firm / admin platform. Voice: traditional, authoritative.
  - **JuristAI** — 3D-rendered word with **purple** "Jurist" + **gold** "AI". Used by the AI consumer/lawyer product. Voice: modern, technical, optimistic.
- **Languages:** Uzbek (Latin script, primary) → Russian → English. Copy is written in Uzbek first; UI components must accommodate Cyrillic and Latin characters of comparable lengths (Uzbek words are often longer than English equivalents).

---

## Content fundamentals

### Tone
- **Respectful, formal, but warm.** This is legal software for serious work, not a chatbot toy. Copy uses the polite plural form ("Siz" in Uzbek) and direct address.
- **Plain-language even when explaining law.** Match the AI's stance: simplify without dumbing down. Concrete examples > abstract jargon.
- **Citation-first.** Every legal claim is paired with its source (article number, code name). The UI is built around making sources visible.
- **No marketing hyperbole.** Avoid "revolutionary", "disrupt", "best-in-class". Use specific numbers ("13 huquqiy soha", "50+ qonunlar bazasi").

### Voice examples (drawn from the codebase)
- Welcome: *"Xush kelibsiz"* / *"Jurist AI ga xush kelibsiz!"* (Welcome / Welcome to Jurist AI!)
- Tagline: *"Sizning shaxsiy yuridik AI yordamchingiz"* (Your personal legal AI assistant)
- Trust line: *"Jurist AI xatolarga yo'l qo'yishi mumkin. Muhim masalalarda mutaxassis bilan maslahatlashing."* (Jurist AI may make mistakes. For important matters, consult a specialist.) — surfaces beneath the chat input; sets expectations honestly.
- CTA: *"Boshlash"* / *"Bepul sinab ko'rish"* (Begin / Try free) — short, imperative, never exclamation-marked.
- Empty state: *"Hali suhbatlar yo'q"* (No conversations yet) — plain, no jokes.

### Casing
- **Sentence case** for headings, buttons, labels (Uzbek convention; "Yangi suhbat", not "Yangi Suhbat").
- **UPPERCASE eyebrows** (small caps) reserved for category labels in the dashboard ("BUGUN", "SHU HAFTA", "OLDINGI").
- Plan tier names — written as designed in source: **Sinov**, **Silver**, **Gold**, **Platinum**.

### "I" vs "you"
- The AI refers to itself in third person or as "Jurist AI", never "I". Users are addressed in second person plural ("Siz").
- Microcopy on critical-action confirmations always asks: *"...xohlaysizmi?"* ("Do you want to ...?") — never assumes.

### Emoji & decorative chars
- **No emoji in product UI.** The codebase uses one decorative emoji (📎 in the file-upload zone) — treat as a legacy exception, prefer SVG icons.
- Unicode arrows (→, ✓) are acceptable as fallback when an SVG icon is overkill.

### Vibe
Warm, considered, courthouse-quiet. Imagine the visual of a leather-bound code on a polished wooden desk under warm lamplight — but the product on top of it is decisively modern.

---

## Visual foundations

### Colors
- **Neutrals:** warm parchment (`#FBF8F2 → #DCCFB1`) and warm ink (`#1A1410 → #9C8C7B`). Never pure white or pure black; everything has a warm undertone.
- **Primary accent:** **Brass** (`#B08442`) — used for primary CTAs, the active sidebar item, and the "verified" seal. Press state darkens to `#8E6730`.
- **Secondary accent:** **Burgundy** (`#6B1F2A`) — used for links, headings flourish (drop caps), and the trust seal. Sparingly.
- **Heritage colors** (kept for the JuristAI logo): **Plum purple** (`#4A1F8C`) and **Gold** (`#C99A3D`). Only used inside the JuristAI logo lockup; do **not** use elsewhere.
- **Semantic:** warm-tuned forest, amber, warm red, deep navy ink (see `colors_and_type.css`).
- **Dark mode** retains the warm temperature: warm near-black (`#18120D`) instead of cool slate; brass desaturated to `#D6B379` for legibility.

### Typography
- **Display / headings:** **Source Serif 4** — a transitional serif with strong but humanist letterforms; reads as "court reporter" without going florid.
- **UI / body:** **Inter** — proven UI workhorse, already in use in the codebase.
- **Print / PDF generation:** **Roboto** — kept for backwards compatibility with existing PDF export pipeline.
- **Mono:** **JetBrains Mono** — used for case numbers, IDs, code snippets in admin tools.
- **Type scale** is modular (1.200 ratio): 11 / 13 / 15 / 18 / 22 / 30 / 40 / 56 px.
- **Body line-height** generous (1.65) — legal text needs breathing room. `text-wrap: pretty` and `hyphens: auto` on long-form blocks.

### Layout & spacing
- **4 px base** spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80.
- **Generous gutters** in long-form (case files, drafts): `padding: var(--s-8) var(--s-12)`.
- **Sidebar dashboards:** 280 px sidebar (matches existing AI dashboard); main content max-width `780 px` for chat, `1200 px` for marketing.

### Backgrounds, imagery
- **Parchment surface** as default (`var(--bg-1)`) — never pure white. Cards sit on top in `#FFFFFF` to gain quiet contrast.
- **No gradients on UI surfaces.** The one exception: the brand-mark hero on marketing/login can use a subtle **warm-light gradient** (parchment → brass-tint) or, in dark mode, a single radial brass glow.
- **Imagery vibe:** warm, naturally-lit, slightly desaturated. Wood, paper, brass hardware, books. Avoid corporate stock photography. **No AI-generated illustrations** — flag with a placeholder if real assets aren't available.
- **No repeating textures** or noise overlays in the UI. Save texture for printed marketing only.

### Borders, dividers, cards
- **Hairline borders** at `1px solid var(--border-1)` (parchment-300). Slightly higher contrast than typical neutral systems — borders matter on parchment.
- **Cards:** white surface, 14 px radius, hairline border, soft shadow (`var(--shadow-1)`). Hover lifts to `--shadow-2` and tints background to `var(--bg-3)`. **Never** colored left-border accents — that's a visual cliché this brand avoids.
- **Inset surfaces** (e.g. quoted legal text inside a card): parchment-100 background, no border, rule-line on the left in brass-300 — like a margin annotation.

### Corner radii
- **6 px** — inputs, small chips
- **10 px** — buttons, badges
- **14 px** — cards, panels
- **20 px** — modals, hero panels
- **999 px** — pills (status, plan tiers)

### Shadows / elevation
- **3-step elevation** (warm-tinted, never gray):
  - `--shadow-1`: resting cards
  - `--shadow-2`: hover, popovers
  - `--shadow-3`: modals
- **Seal shadow** (`--shadow-seal`): a unique brass ring + warm glow used only on "Verified by lawyer" marks and trust badges. Reserve it.

### Animation
- **Mood:** confident, never bouncy. No spring overshoot, no playful wiggles.
- **Easing:** `cubic-bezier(0.2, 0.8, 0.2, 1)` for enter, `cubic-bezier(0.4, 0, 0.2, 1)` for symmetric.
- **Durations:** 120 ms (micro / focus), 220 ms (most state changes), 360 ms (modal/page transitions).
- **Fades** preferred over slides; **slides** acceptable for sheet/sidebar transitions.
- **Typing indicator** in chat: three-dot pulse (1.4 s loop), the only ambient animation in the system.

### Hover & press states
- **Hover (light mode):** background tints to `var(--bg-3)`, border darkens one step. No transform on cards beyond a 1 px lift on landing-page feature cards.
- **Hover (interactive primary):** brass darkens to `--brass-600`; subtle warm glow on focus.
- **Press:** scale `0.98` is permitted on buttons only; otherwise color shift only.
- **Focus rings:** 3 px brass-100 outer ring + 1 px brass-500 border. Always visible (a11y).

### Transparency & blur
- **Blur is rare.** Only used on the marketing-page header (`backdrop-filter: blur(20px)`) and on modal overlays (`rgba(26,20,16,0.5)`).
- **Glassmorphism is deprecated.** The legacy `login.html` uses heavy glass effects — newer surfaces should not.

### Layout rules
- **Fixed elements:** top nav (marketing), sidebar (dashboard), chat input bar.
- **Scroll:** main content scrolls; sidebars and headers stay put.
- **Density:** comfortable. Targets ≥ 40 px tall; row spacing ≥ 8 px.

---

## Iconography

### Approach
- **Lucide** (https://lucide.dev) is the canonical icon library — the existing codebase already uses Lucide-style stroked icons inline. Stroke width **2 px**, line-cap round.
- **Pull from CDN** when possible: `https://unpkg.com/lucide-static@latest/icons/<name>.svg`. The Lucide style matches what's already shipping; substitution is invisible.
- **No custom icon font.** No icon sprite either. Icons are inlined as SVG (small set used) or rendered via `<img>` for marketing.
- **No emoji** in product chrome.

### Logos & marks
- `assets/jurist_logo.png` — JuristAI primary mark (purple + gold)
- `assets/jurist_logo_white.png` — white variant for dark surfaces
- `assets/dictum_logo.png` — Dictum law-firm wordmark (admin platform)

### Recurring icons in the codebase (already in use)
- **Scales of justice / layered diamonds** — the brand's recurring metaphor for "stacked legal data"
- **Document, file, folder** — common throughout
- **Sparkle / star** — flags AI-generated content
- **Shield + check** — "Verified by lawyer"
- **Telegram bird** — for the bot CTA (kept in original blue `#0088CC`)

---

## Index

```
.
├── README.md                 ← you are here
├── SKILL.md                  ← Claude Code agent skill bundle entry
├── colors_and_type.css       ← CSS variables, fonts, type classes
├── assets/
│   ├── jurist_logo.png       ← JuristAI primary mark
│   ├── jurist_logo_white.png ← JuristAI on dark
│   └── dictum_logo.png       ← Dictum law-firm mark
├── fonts/
│   ├── Roboto-Regular.ttf    ← print/PDF generation
│   └── Roboto-Bold.ttf
├── preview/                  ← per-card design-system specimens (registered as assets)
└── ui_kits/
    └── web_app/              ← Dictum legal AI workspace (dashboard, chat, editor, clients)
```

### Font substitutions flagged
- **Source Serif 4** — used as display/headings serif. Loaded from Google Fonts. *No source files in the repo provided* — flag for the user; if Dictum has a licensed serif, swap it in.
- **Inter** — already used by the codebase, loaded from Google Fonts.
- **Roboto** — repo provides TTF files; included in `fonts/` for PDF pipelines.
- **JetBrains Mono** — added by this design system for IDs/case numbers; loaded from Google Fonts.

---

## Caveats / open questions for the user

1. **Two visual directions in the codebase.** The login page uses a purple/glass aesthetic, the AI portal uses a teal/dark SaaS aesthetic. This system unifies on **warm parchment + brass** (and a warm-dark mirror). If you want to keep the existing teal direction instead, say so — I can pivot the accents.
2. **JuristAI logo PNG is rasterized 3D type.** It scales but won't recolor cleanly. A flat SVG variant would be ideal for small UI use.
3. **Source Serif 4 is a substitution.** If you have a licensed serif (e.g. you've been using something specific in printed materials), I'll swap it in.
4. **One UI kit, not two.** I built one unified `web_app` kit recreating the lawyer-facing workspace (dashboard, AI chat, document editor with AI review, clients). The codebase's admin dashboard is 200KB+ and the surfaces overlap heavily — tell me if you want a separate admin kit, the citizen Telegram-bot mini-app, or the JuristAI marketing site recreated next.
5. **Iconography is Lucide via CDN.** No proprietary icon set was found in the repo. Flag if you have one.
