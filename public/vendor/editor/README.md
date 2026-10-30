# Editor bundle (vendored)

`editor-3.31.4.js` is TipTap 3.31.4 (ProseMirror) built once with esbuild
0.25.10 from `entry.js` (IIFE, `window.JAIEditorKit`). The app has no bundler,
so the build is committed here. Every package in it is MIT; `LICENSES.txt`
lists them with versions (license texts are kept at the end of the bundle).

Rebuild (a new version needs the same check of every package's license):

```bash
npm install @tiptap/core@3.31.4 @tiptap/pm@3.31.4 @tiptap/starter-kit@3.31.4 \
  @tiptap/extension-text-align@3.31.4 @tiptap/extension-text-style@3.31.4 \
  @tiptap/extension-highlight@3.31.4 @tiptap/extension-table@3.31.4 \
  @tiptap/extensions@3.31.4 esbuild@0.25.10
npx esbuild entry.js --bundle --minify --format=iife --target=es2019 \
  --legal-comments=eof --outfile=editor-3.31.4.js
```

Design: `docs/design/hujjat-muharriri.md`.
