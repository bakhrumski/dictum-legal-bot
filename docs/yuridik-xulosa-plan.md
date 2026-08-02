# Yuridik xulosa — pipeline (current state)

Legal-opinion mode for uploaded documents. Hard source restriction: grounding
comes from **qa-corpus + lex.uz only** — no general web anywhere in the path.

## Architecture (as shipped, `POST /api/draft/legal-opinion`)

1. **Reference extraction — on the RAW text, before any digest.**
   Two extractors merged (`src/rag/lex-resolve.js`):
   - regex scanner over the full document: bare `N-son(li)` forms, prefixed
     codes (PF/F/PQ/VMQ/O'RQ, Latin+Cyrillic), number lists sharing one suffix
     ("276, 596-son qarorlar"), corroborated parenthesised citations;
   - LLM extractor (`legal-verify.js#extractReferences`) windowed 3×30k in
     parallel — contributes the CLAIMS the document makes about each act.
   Foreign instruments (Turkiya/EU/OECD…) are flagged clause-locally and at
   merge time and are **never searched on lex.uz**.
2. **Map-reduce digest** (`digestLongDocument`) for documents >14k chars —
   used only for the synthesis prompt, never for extraction.
3. **Corpus retrieval** with a BUILT query (subject line + sanitized act
   names; no claims — article numbers in claims trigger the retriever's
   cross-law article fallback) + a relevance gate: chunks survive only on a
   non-generic stem overlap with the document subject (`prefixOverlap`).
4. **lex.uz live resolution** (`resolveReferences`, concurrency 4, top 15 refs,
   `OPINION_MAX_REFS`): per-reference Cyrillic-first query variants, then an
   **identity gate** — the fetched page must state the cited number as its OWN
   (metadata / act-form line / national-registry path `03/21/684/0367` /
   signature-block tail), with year agreement; amendment decrees pass only as
   unconfirmed; one act per reference (`gateAndCapHits`), same-number
   collisions of other bodies stay in context with a caution label but are
   excluded from Manbalar. Excerpts are selected by the reference's CLAIMS
   (`scoreText`), so cited articles ("55 va 69-modda") outrank the preamble.
5. **Synthesis** — `callPremiumAI`, IRAC structure, cite-only-from-KONTEKST
   rule, unresolved references disclosed to the model (TEKSHIRILMAGAN
   HAVOLALAR + XORIJIY MANBALAR blocks) so it states WHY, not just
   "tasdiqlanmadi".
6. **Citation audit** (`auditOpinionCitations`) → correction pass (keeps the
   original if the rewrite truncates) → italic disclosure of anything still
   unverified → Manbalar footer (corpus chunks actually cited + confirmed
   lex.uz docs, deduped).

## Models / limits

- **Sol (`MODELS.premium`) for every paid tier**; Luna for sinov. Overrides:
  `OPINION_MODEL`, `OPINION_MODEL_<PLAN>`, `OPINION_MODEL_STAFF`.
- `premiumRetries: 2` on synthesis (1 on correction): transient errors retry
  the premium model before falling back; a fallback is logged
  (`FALLBACK: requested … answered by …`, `actual-model=` in the tokens line)
  and surfaced master-only as `modelDowngraded`.
- Output caps: 7000 tokens paid / 4500 sinov (Uzbek ≈ 3 tokens/word, so the
  1200–1800-word rule needs the headroom). Opinion counts per tariff period:
  sinov 1, silver 3, gold 10, platinum 30 (`OPINION_LIMIT_<PLAN>`).
- Typical cost per opinion (79k-char report, Sol): ~$0.25 synthesis + digest.

## Tests

- `npm run test:opinion` = `tests/lex-resolve.test.js` (52) +
  `tests/lex-excerpt.test.js` (6) + `tests/legal-verify.test.js` (3).
  Fixtures are the real citation strings from the outsourcing-report runs.

## Known limits (accepted, disclosed in the opinion)

- lex.uz full-text search recall: some cited acts (596/200/59/276 in test
  runs) don't surface in the top results under any query variant → honest
  `✗` with the tried queries logged. Permanent fix: ingest the field's acts
  into the corpus.
- Yearly numbering collides across issuing bodies; number+year matches with
  zero topical overlap are kept only with a caution label.
- lex.uz is blocked from the CI sandbox (403) — verify live on Render.

## Remaining TODO (not blocking)

1. **User-visible verification table** — wire `legal-verify.js#verifyDocument`
   output (status per reference: tasdiqlandi / qisman / nomuvofiqlik /
   tekshirilmadi + lex.uz links) into the opinion HTML + .docx export, with
   SSE progress per reference. The engine is built and tested; only the
   endpoint/frontend wiring remains.
2. **Corpus ingest** of procurement/outsourcing acts (O'RQ-684, VMQ-306,
   healthcare decrees) via the existing ingest pipeline.
