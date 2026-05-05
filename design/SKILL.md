---
name: dictum-design
description: Use this skill to generate well-branded interfaces and assets for Dictum (a warm, professional AI legal platform), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick reference
- **Tokens** — `colors_and_type.css` (CSS vars: parchment/ink neutrals, brass primary, burgundy secondary, semantic, type scale)
- **Fonts** — Source Serif 4 (display + citations), Inter (UI), JetBrains Mono (legal codes). Loaded from Google Fonts.
- **Icons** — Lucide static via CDN, tinted ink-900 with a CSS filter (see `.lic` class in `ui_kits/web_app/styles.css`)
- **UI kit** — `ui_kits/web_app/` — full click-thru: dashboard, chat, document editor with AI review, clients table
- **Preview cards** — `preview/*.html` — atomic specimens of every token & component

## Vibe in one line
A warm law-library: parchment surfaces, ink type, brass accents — never blue, never neon. Serif for content gravitas, sans for UI clarity. Citations are first-class.
