# Editor bundle (vendored)

`editor-3.31.4.js` is TipTap 3.31.4 (ProseMirror) built once with esbuild
0.25.10 from `entry.js` (IIFE, `window.JAIEditorKit`). The app has no bundler,
so the build is committed here. Since D3 it carries the live co-editing; since U5a (`?b=4`) sub / superscript, line
spacing, indent, page break and the page's own highlights (decorations: find
results, the place a card points to)
(Yjs, TipTap Collaboration and caret, and `LiveDoc`, the client of
`src/editor/live.js`); the server uses the same yjs / y-protocols / lib0. Every package in it is MIT; `LICENSES.txt`
lists them with versions (license texts are kept at the end of the bundle).

Rebuild (a new version needs the same check of every package's license):

```bash
npm install @tiptap/core@3.31.4 @tiptap/pm@3.31.4 @tiptap/starter-kit@3.31.4 \
  @tiptap/extension-text-align@3.31.4 @tiptap/extension-text-style@3.31.4 \
  @tiptap/extension-highlight@3.31.4 @tiptap/extension-table@3.31.4 \
  @tiptap/extensions@3.31.4 @tiptap/extension-collaboration@3.31.4 \
  @tiptap/extension-collaboration-caret@3.31.4 @tiptap/y-tiptap@3.0.10 \
  @tiptap/extension-subscript@3.31.4 @tiptap/extension-superscript@3.31.4 \
  yjs@13.6.33 y-protocols@1.0.7 lib0@0.2.119 esbuild@0.25.10
npx esbuild entry.js --bundle --minify --format=iife --target=es2019 \
  --legal-comments=eof --outfile=editor-3.31.4.js
```

Design: `docs/design/hujjat-muharriri.md`.
