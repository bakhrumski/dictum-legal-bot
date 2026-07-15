# Yuridik xulosa — verification pipeline (assembly plan)

Implements the uploaded spec: a legal-opinion mode that verifies every citation
in an uploaded document against **only** qa-corpus + lex.uz, producing a
verification table + thematic critique + downloadable .docx.

## Decisions (defaults; change if needed)
- **Verify budget:** top 15 load-bearing references in full; rest → `tekshirilmadi`.
- **Docx:** reuse the existing Word-HTML approach (`wrapDocumentHtml`/`sendExport`).
- **Model:** `callAI` (Gemini 2.5 Flash primary) for extraction/judge/synthesis.

## DONE (committed)
- `src/rag/legal-verify.js` — engine: `extractReferences`, `verifyReference`
  (lex.uz-only via `searchLexUz` + qa-corpus + LLM judge, records `lex_urls`),
  `verifyDocument` (extract → weight-order → cap at maxRefs → defer rest →
  status counts + confidence + keyFinding). Dependency-injected.
- `tests/legal-verify.test.js` — passing unit tests (parsing, ordering, cap).

## TODO (fresh session) — 3 pieces

### 1. Rework `POST /api/draft/legal-opinion` (src/api/server.js, ~line 5168)
Replace the current single-synthesis body with:
```
const { verifyDocument } = require('../rag/legal-verify');
const { searchKorpus } = require('../rag/qa-korpus');
const apiKey = process.env.HF_TOKEN || process.env.GEMINI_API_KEY || process.env.GPT_API_KEY;
// keep the map-reduce digest ONLY if you also want a prose summary; for the
// verification memo the raw full text drives extraction.
const result = await verifyDocument(documentText, {
  callAI, apiKey, searchKorpus, retrieveLegalContext, maxRefs: 15,
  onProgress: sse ? (d,total,label) => sse({type:'status', text:`⚖️ Havolalar tekshirilmoqda... ${d}/${total} — ${label}`}) : null,
});
// then a final synthesis call: pass result.references (table rows) + the
// document digest to build the memo sections (Xulosa predmeti, Metodologiya,
// Asosiy topilma, thematic assessment, Xulosa va tavsiyalar).
```
- Make this endpoint **SSE-capable** like `/api/legal-chat` (accept `stream:true`);
  emit `status` during extraction + per-reference verification, then `done`
  with `{ html, summary, references }`.
- Audit-log the run (already has `logAudit`).

### 2. `.docx` memo template (src/drafting/routes.js — extend wrapDocumentHtml, or a new buildOpinionDocx)
Structure EXACTLY (Uzbek, Times New Roman body, justified):
1. Title "YURIDIK XULOSA" + subject (doc name) + date.
2. Bold disclaimer (AI-assisted, qa-corpus+lex.uz only, not a lawyer's sign-off).
3. Xulosa predmeti.
4. Tekshiruv metodologiyasi va cheklovlari (state verified-in-full vs deferred honestly — use verifiedCount/deferredCount).
5. Asosiy topilma(lar) (summary.keyFinding if any nomuvofiqlik).
6. Verification table — cols: Manba | Hisobotdagi tavsif | Tekshiruv natijasi (status + izoh). Shaded header row. One row per reference; include `lex_urls` as footnote/links.
7. Hujjatning asosiy tezislari bo'yicha huquqiy baho (thematic — from synthesis call).
8. Xulosa va tavsiyalar (real bullet list, no literal •).
9. Closing italic note: verification date + "qonunchilik o'zgarishi mumkin".
Add an `/api/draft/opinion-export` (or reuse export-raw) that renders this to .doc/.pdf.

### 3. Frontend (public/dashboard.html)
- The upload card + `docFlowGenerateOpinion` already exist. Switch its fetch to
  the SSE endpoint, render progress via the existing `readAiChatStream` status
  handling (or a small dedicated reader), then render the memo as an inline
  doc message (`renderDocMessage`) with Word/PDF export.
- Show the 2-4 sentence summary card: confidence + counts (tasdiqlandi/
  nomuvofiqlik/tekshirilmadi) + keyFinding.

## Constraints to keep
- lex.uz-only (searchLexUz enforces it; never add general web here).
- No fabricated citations; unverifiable → tekshirilmadi.
- Short quotes only from lex.uz (paraphrase); disclaimer in every doc.
- Log lex.uz URLs per reference (engine already returns `lex_urls`).
- Note: lex.uz is blocked from the CI sandbox (403) — verify live on Render.
