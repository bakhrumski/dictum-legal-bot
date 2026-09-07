# juristAI — trademark & logotype assets (rev 02)

All files are standalone SVG. Wordmark type is **converted to outlines** (Inter 500 / 600–700),
so nothing depends on a font being installed.

## Files

| File | Use |
|---|---|
| `lockup-horizontal-glow.svg` | Primary lockup. App header, deck covers, dark web surfaces. |
| `lockup-stacked-glow.svg` | Square-ish placements: social avatars, splash, print centrefold. |
| `lockup-caps-glow.svg` | Micro-typography variant. Nav bars, document footers, API docs. |
| `lockup-*-mono-white.svg` | One-colour reversed. Photography, video, embroidery, low-fidelity print. |
| `lockup-*-mono-black.svg` | One-colour positive. Letterheads, contracts, invoices, court filings. |
| `mark-glow.svg` | Trademark alone, on dark. Watermark, loading state, empty state. |
| `mark-mono-white.svg` / `mark-mono-black.svg` | Trademark alone, one colour. |
| `mark-compact-small-sizes.svg` | Simplified geometry for ≤32 px. Thicker strokes, detail dropped, core kept. |
| `app-icon.svg` | Pre-composed tile on obsidian. Export at 1024 for stores. |
| `favicon.svg` | 16–48 px tile. Uses the compact geometry. |

## Recolouring

Monochrome files use `currentColor`:

```html
<img src="mark-mono-white.svg">          <!-- ships white -->
<div style="color:#2DD4BF"><!-- inline the svg here --></div>
```

Inline the SVG (not `<img>`) if you want `color` to cascade into it.

## Rules

- Glow versions are for **dark surfaces only** (#0A0A0A–#050505). On light backgrounds use mono-black.
- Clearspace = one core diameter (15 units on the 96 grid) on all sides.
- Minimum sizes: mark 24 px digital / 8 mm print; horizontal lockup 96 px wide.
- Below 32 px switch to `mark-compact-small-sizes.svg` — the hairlines disappear otherwise.
- Never: recolour the letterforms with a gradient, outline the type, add a capital J, or place the glow on white.

## Regenerating

Built from Inter (SIL Open Font License 1.1) via `build_logo.py`. Outlined glyphs may be
embedded in a trademark filing; the OFL permits this, but keep the licence on file.
