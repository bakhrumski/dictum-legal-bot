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

## Sign-in
The pane cannot rely on the site cookie inside Word, so it pairs: the pane shows a 6-character
code and opens `/word/ulash.html?code=…` in the browser; the signed-in person confirms it there.
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
