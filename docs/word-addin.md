# JuristAI for Word (task pane add-in)

Files: `public/word/` (task pane, connect page, icons), `src/addin/word-addin.js`
(pairing, tokens, manifest), tests `tests/word-addin.test.js`, `tests/word-addin.e2e.test.js`.

## What it does
- **Hujjat**: the whole document goes to `/api/legal-chat` with the same prompts as the app's
  skills (risk review, legal opinion, plain-language explanation). Long documents get the
  usual cost confirmation (`DOC_COST_CONFIRM`) and tariff units.
- **Tanlangan**: a question about the selected text, or an edit proposal. The proposal comes
  back between `<<<YANGI_MATN … YANGI_MATN>>>`; it can replace the selection with Track Changes
  and a comment (WordApi 1.4), replace it plainly, or be left as a comment.
- **Chat**: a conversation, optionally with the document as context.
- Any answer can be inserted after the cursor, formatted, with its lex.uz sources.

## In the document itself
- **Hujjatda ko'rib chiqish** (Hujjat tab): one analysis request asks for each finding as
  `### IZOH n` with `IQTIBOS / MUAMMO / ASOS / TAVSIYA / YANGI MATN` (public/word/shared.js
  `REVIEW_PROMPT`, `parseReview`). Each quote is searched in the document (whole quote, then
  shorter starts; punctuation and spacing ignored) and gets a Word comment there; with the
  checkbox, `YANGI MATN` replaces the quote under Track Changes. Missing terms and quotes not
  found are commented on the first paragraph. "Izohlarni o'chirish" removes JuristAI comments.
  Google Docs: found quotes are highlighted, notes go to a "JuristAI izohlari" section at the end.
- **Right-click menu** (Word, `ContextMenuText`): Qonunga moslashtirish / Aniqroq yozish /
  Tarafimni himoya qilish / Izoh berish run `public/word/commands.js` without opening the pane:
  a "JuristAI: ishlanmoqda…" comment appears at once, then the fix goes in under Track Changes
  and the comment shows why. Uses the pane's token; not connected → the comment says so.
  Re-upload the manifest after this change (version 1.1).

## Sign-in
The pane cannot rely on the site cookie inside Word, so it pairs: the pane shows a 6-character
code and opens `/word/ulash.html` in the browser; the signed-in person types the code shown in Word there (the link never carries the code, 2026-10-20).
The pane then holds a `jai_…` token (90 days, only its SHA-256 is stored in `addin_tokens`).
The token opens only: `GET /api/user-info`, `GET /api/tariff/me`, `POST /api/legal-chat`,
`GET /api/addin/me`, `POST /api/addin/logout` — as that account, with its role and limits.
`/word/ulash.html` shows how many Word copies are connected and can disconnect all of them.

## Install for testing (sideload)
Manifest: `https://<host>/word/manifest.xml` (generated for the host it is downloaded from;
`WORD_ADDIN_BASE_URL`, `WORD_ADDIN_ID`, `WORD_ADDIN_NAME` override it).

- **Word on the web** (Microsoft 365 / outlook.com account): open a document → Home → Add-ins →
  More Add-ins → My Add-ins → *Upload My Add-in* → choose the manifest file.
- **Word for Windows**: put the manifest in a shared folder (e.g. `C:\JuristAI-addin`, Share it
  with yourself), then Word → File → Options → Trust Center → Trust Center Settings → Trusted
  Add-in Catalogs → add `\\<computer>\JuristAI-addin`, tick *Show in Menu*, restart Word →
  Home → Add-ins → *Shared Folder* → JuristAI.
- **Word for Mac**: copy the manifest to
  `~/Library/Containers/com.microsoft.Word/Data/Documents/wef/` and restart Word.

Store listing (AppSource) is a separate step: it needs a privacy policy URL, a support URL
and Microsoft's validation.

# Google Docs (sidebar, Apps Script)

Files: `addins/gdocs/Code.gs`, `addins/gdocs/Sidebar.html`, `public/gdocs/host.js`; the pane
itself is the same `public/word/taskpane.js` (markup served as `/gdocs/panel.js` from
`taskpane.html`), so both editors get every change from the server.

- The sidebar runs on a `*-script.googleusercontent.com` origin. CORS is open to that origin
  only for the add-in's token routes and pairing, never with cookies; pane assets under `/word/`
  and `/gdocs/` carry `Cross-Origin-Resource-Policy: cross-origin`.
- Google Docs has no API for suggestion mode or anchored comments: "Tahrir belgisi bilan"
  leaves the old text struck through in red and puts the new text after it, underlined in blue.
  The comment button is hidden. Answers are inserted as paragraphs / headings / numbered items
  with bold text and lex.uz links kept.
- `@OnlyCurrentDoc`: the script can open only the document it is used in.

## Install for testing
1. Open a Google Doc → **Extensions → Apps Script** (Расширения → Apps Script).
2. Replace `Code.gs` with `addins/gdocs/Code.gs`; add an HTML file named `Sidebar` with
   `addins/gdocs/Sidebar.html`. Check `JURISTAI_BASE` at the top of `Code.gs`. Save.
3. Reload the document → menu **JuristAI → Panelni ochish** → allow the permissions once.

Publishing for everyone (Google Workspace Marketplace) needs a Google Cloud project, an OAuth
consent screen, a privacy policy and Google's review.
