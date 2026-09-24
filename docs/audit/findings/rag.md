# RAG va QA korpusi xaritasi

> 2026-09-24 audit. Kod o'qilgan holda tuzildi, baza va provayderlarga ulanilmagan. Qator raqamlari audit paytidagi `main`ga tegishli.

I've mapped the whole RAG stack and the QA corpus. Everything below comes from reading the code, plus a few `node -e` probes of the pure functions (router, law hints, query variants, registry, gold set, `legal-docs/` script mix). I didn't touch the DB or any provider APIs, so nothing about live corpus contents or live model behaviour is measured. The three confirmed bugs that matter most for accuracy are:
- **Stale-law check never fires:** the freshness job checks the wrong field, so it never marks anything as repealed.
- **New lawyer-verified answers are not embedded:** a missing function inside a try/catch silently skips their vectors.
- **Any logged-in user can write lawyer-verified answers**, and those can later be returned word-for-word to other users.

Line numbers are from the current checkout.

---

## 1. Ingestion

**Fetch (`src/rag/fetch-lex.js`)**
- `httpGet` (46-90) is a plain Node HTTP client that follows 5 redirects and has a 60s timeout.
- `fetchLexDocument` (98-131) accepts a URL or a numeric id (`https://lex.uz/docs/<id>`).
  - If the page is a dated snapshot ("sanasi holatiga"), it follows the "Amaldagi versiyaga o'tish" link to the current version (115-125).
- `parseLexHtml` (136-346) parses with cheerio:
  - **Repeal status (148-201):** looks at the page *header only* (`#divCont` is removed first). It matches "Hujjat(ning) kuchi(ni) yo'qotgan" (with every apostrophe variant), "Документ утратил силу" or "Not in force", and "Hujjatning eski tahriri". A match sets `is_active=false` and `status_label`.
  - **Title, publication, act form (239-260):** from `div.ACT_TITLE`, `PUBLICATION_ORIGIN` and `ACT_FORM`.
  - **Date and number (265-271):** `extractTitleMetadata` (413-459) pulls the adoption date (DD.MM.YYYY or "YYYY yil D <month>") and the document number (registry path, №/N/raqami, -son/-сон, PQ-/ПП- style). The number is normalised by `normalizeOfficialDocumentIdentifier`.
  - **Body (274-333):** walks `#divCont > div.lx_elem` by class: `TEXT_HEADER_DEFAULT`, `CLAUSE_DEFAULT` (`clausePrfx`+`clauseSuff`), `ACT_TEXT`, `FOOTNOTE` (becomes `[Izoh: …]`), `BY_DEFAULT`. `<sup>` is turned into superscript digits.
  - `enrichForIngest` (341, in `prim-notation.js` 106-128) appends a spoken alias, e.g. "7¹-modda (7-modda prim 1)".
- `inferDocLanguage` (368-379) decides uz/ru by script ratio plus the letters ў/қ/ғ/ҳ.
- **Not captured anywhere:** the edition (tahrir) date, the lex numeric id as its own column, the act type, a content hash, and the embedding model.

**Ingest entry points**
- **CLI `src/rag/ingest-lex.js`**
  - Commands: `--url`, `--fetch`, `--fetch-all`, `--priority`, `--docs`, `--dir`, plus a file mode. There are matching npm `ingest:*` scripts.
  - URL path goes `ingestFromUrl` (249-307) → `ingestStructuredHtml` (159-213): structural chunks → embed → `deleteByDocId` → `insertStructuredChunks`.
  - Repealed documents are skipped (117-120, 170-173).
  - Language is guessed only from `/uz/` in the URL (258). So registry URLs like `lex.uz/docs/-97664` are stored as `language='ru'`.
  - `.txt` files go through `ingestText` (111-157), which uses the old chunker; language defaults to `'ru'` (240).
- **Server `ingestLexUrl`** (`server.js` 8195-8308), used by `POST /api/rag/ingest-url` and suggested-source ingest.
  - Uses `inferDocLanguage` and a guard against ingesting page chrome (8250-8261). Stores `source_type='uploaded_doc'`.
- **`POST /api/rag/reingest-registry`** (8326-8445) and **`POST /api/rag/upload-document`** (8042-8190: PDF/TXT/DOCX, old chunker, `uploaded_doc`, quality 0.8).
- **Registry** (`src/rag/lex-registry.js`): 78 laws in 24 categories. Many "[VERIFY]" entries use suspiciously sequential ids (5765408, 5765412, 5765420, 5765424, 5765428, 5765444, 5765480).
- **Offline:** `src/rag/ingest-offline.js` writes `legal-docs/ingest-all.sql` (currently "0 chunks").
- **`legal-docs/*.txt` seed files (6.3 MB):**
  - They are Russian (Статья …), or Uzbek-Cyrillic for `mulk` and `soliq`, even though their headers carry Latin names.
  - `mehnat-kodeks.txt` is the **old 1995 Labour Code** (lex 145261). The registry points to the new code, -6257288.
  - The `mulk` and `shartnoma` folders are not valid registry categories, so `ingestFile` rejects them.

**Tables**
- **`legal_chunks`:**
  - Base table: `legal-corpus.js` 36-72. Extra columns: 75-85. Parent/child columns: `advanced-corpus.js` 47-54. Feedback columns: `usage-feedback.js` 32-34.
  - Columns: `law_name, doc_id, source_url, category, chunk_text, chunk_index, article_numbers TEXT[], chapter, lex_element_id, enforcement_date, is_valid, last_checked_at, embedding vector(N), tsv, source_type (law_text|verified_qa|uploaded_doc), quality_score, verified_by, language, search_text, is_active, status_label, adoption_date, document_number, chunk_type, chunk_id, parent_chunk_id, article_number_display, part_number, part_type, cross_references, helpful_count, unhelpful_count, flagged_for_review`.
  - The `section` (bo'lim) is parsed but never stored.
- **Indexes:**
  - ivfflat cosine, lists=50 (132-151; rebuilt with lists=√n clamped to 10-100 at 1103-1140).
  - GIN on `tsv` and trigram GIN on `search_text` and `chunk_text` (154-165).
- **Triggers:** `legal_chunks_normalize_search_text` (185-207) and the tsv trigger (210-229) using the `'simple'` config. The corpus-revision trigger writes `juristai_private.legal_corpus_state` (234-295; also in `migrations/20260822_003`).
- **Other tables:**
  - `rag_ingest_log` (305-325).
  - `qa_bank` (`advanced-corpus.js` 64-95), `qa_korpus` (`qa-korpus.js` 213-230).
  - In `server.js`: `coverage_log` (10087), `suggested_sources` (10103), `answer_feedback` (10125), `opinion_cache` (10215), `answer_cache` (10224).
  - Not used for retrieval: `legal_training_dataset`, `lawyer_feedback_dataset`, `court_cases` (`src/dataset/*`).

**In force vs repealed:** there are two flags, `is_valid` and `is_active`.
- Every search filters on both through `buildRetrievalFilters` (430-450).
- There is no versioning; a re-ingest deletes the document and inserts it again.

## 2. Chunking

- **Structural chunker (main path), `src/rag/structural-chunker.js`:**
  - `parseLexStructured` (148-307) splits on CSS classes. Article headers must match `ARTICLE_HEADER_RX` / `_RU` (55-56), in Latin "modda" or Cyrillic "модда", with superscript prim numbers.
  - Parts: if the article has no explicit numbering, each `ACT_TEXT` paragraph becomes its own qism with its own lex element id (184-203). Otherwise `splitIntoParts` (320-398) splits on "N." / "N)" for N ≤ 30.
  - `chunkByArticle` (430-491) makes one **parent** per article, **truncated** to `PARENT_MAX_CHARS`=3200 (`substring`, 441). Long article tails are lost.
  - It also makes one **child** per part, truncated to 800 chars (468), prefixed with the article title and "N-qism:".
  - There is no overlap. Article boundaries are always respected.
  - If zero article numbers are parsed, ingest throws (556-563). If no articles are found at all, it falls back to the old chunker.
- **Old chunker, `src/rag/chunker.js`** (text files, uploads, fallback):
  - Target 800 "tokens" (about 3200 chars), max 1200; `CHUNK_OVERLAP=100` is declared but **never used** (17-20).
  - It merges consecutive short articles into one chunk (248-256), so `article_numbers` holds several articles.
  - Long articles are split on blank lines, repeating the header with "(davomi)" (202-246).
  - Its regex accepts only Latin "modda" (31-34).
  - Structural chunker's `extractPlainText` (587-594) collapses all newlines. Its fallback prefers `fallbackText` (the fetched body) when given, but `reingest-registry` (8379-8394) and the CLI path (`ingest-lex.js:181`) don't pass it. There the old line-based parser gets a single line and yields one giant "raw" chunk.

## 3. Embeddings (`src/rag/embeddings.js`)

- **Provider order** (74-84): `EMBED_PROVIDER` override, otherwise HF_TOKEN, then GEMINI_API_KEY, then GPT/OPENAI key.
  - HF `intfloat/multilingual-e5-large`: 1024 dims, max 512 tokens, input cut at 2048 chars (140-145). Parents up to 3200 chars are therefore embedded only partly.
  - Gemini `gemini-embedding-001`: 1536 dims (`GEMINI_EMBED_DIMS`).
  - OpenAI `text-embedding-3-small`: 1536 dims.
- **Query vs passage:**
  - E5 adds `query: ` / `passage: ` (140-145, 323, 388).
  - Gemini uses `RETRIEVAL_QUERY` / `RETRIEVAL_DOCUMENT` (239, 251).
  - OpenAI gets no prefix.
- **Normalisation:** NFKC plus removal of apostrophes between letters, for both queries and passages (8, 315, 357).
- **Caching:** there is no embedding cache. One legal-chat request embeds the same question about 5-6 times: `searchKorpus`, the verified_qa lookup, `vectorSearch` scoped and unscoped, `parentChildSearch`, and possibly `rrfSearch`.
- **Model mismatch risk:** `legal_chunks` has no `embedding_model` column (`qa_korpus` does). If the dimension changes, the column is dropped only when empty or when `ALLOW_EMBED_MIGRATION` is set (`legal-corpus.js` 90-128, `server.js` 10270-10300). Re-embedding is `reembed-corpus.js`.

## 4. Retrieval: `retrieveLegalContext` (`server.js` 4430-5063)

1. **Query expansion (4437):** `expandQueryVariants` (prim-notation 142-165) then `expandLegalQueryAliases`.
2. **Router (4444):** `routeQuery` (`router.js`; entity regex at line 40) sets the strategy label, which is only logged, and extracts article-number entities.
3. **Exact article lookup (4453-4469):** `articleNumberSearch` (`legal-corpus.js` 1300-1330) runs `article_numbers && $2` plus `law_name ILIKE %hint%`. The law hint comes from `detectLawHint` (`law-hints.js`), using the query or the last 4 history turns. It then retries without topic and without law. Score is a fixed 0.95.
4. **"Semantic guarantee" (4477-4518):** `vectorSearch` limit 12, both topic-scoped and unscoped, then breadth-first (at most 2 per law), top 6 `law_text`.
5. **Main search (4533-4577):** `parentChildSearch` (`advanced-corpus.js` 289-430):
   - Dense search on child chunks only, `limit*2`=30 (327-348), joined to parents (385-397), deduplicated by law+article (400-426).
   - If there are no children it falls back to `rrfSearch` (1053-1097). Then `hybridSearch` (weighted 0.45 dense / 0.55 keyword, 599-648), then `textOnlySearch`.
6. **Dense SQL** (`denseSearchByEmbedding` 452-498): `ORDER BY embedding <=> $1 LIMIT n` with a WHERE filter. No `ivfflat.probes` is set anywhere, so the default probes=1 applies.
7. **Keyword SQL** (`keywordSearch` 500-597):
   - `to_tsquery('simple', prefix:* OR …)` plus a `ts_rank_cd` score.
   - Bonuses: +0.08 per term hit, +0.18 core-term AND, +0.35 exact phrase (via `search_text` POSITION), +0.15 for verified_qa.
   - The query parts come from `buildKeywordArtifacts` (`search-utils.js` 106-153): Uzbek suffix stripping (45-80), a 15-word Uzbek stopword list (12-28), phrases of 2-3 tokens.
8. **RRF fusion** (`fuseRrfResults` 650-724):
   - k=60, dense weight 1.0, keyword weight 1.2.
   - Additive bonuses: exact phrase +0.06, core +0.03, term hits +0.01 each (max 4), verified_qa +0.1.
   - These bonuses are larger than the RRF terms themselves (1/61 ≈ 0.016).
9. **Keyword "rescue" and exact-match failsafe (4580-4660):** up to 2 high-confidence keyword hits (`isHighConfidenceKeywordMatch`, 169-179), article hits and semantic hits are placed first; `exactMatchSearch` (ILIKE, 1229-1287) is added.
10. **Topic underflow (4663-4682):** if fewer than 2 results, it calls itself with no topic. That call loses `opts`, and the query gets expanded a second time.
11. **Cross-field (4687-4726):** up to 2 high-signal chunks from other categories.
12. **Reranking and filtering:** candidate count is capped by `FINAL_K=7` (4731), then the reranker runs, then the corrective filter, then the protected results are merged back in (4744-4786). The "nuclear" ILIKE fallback runs when nothing is left (4801-4817).
13. **Filters:** `is_valid AND is_active`, optional `category`, optional `language`. legal-chat always passes `language=null`.

**Abbreviations and aliases**
- `query-aliases.js` covers only traffic/driving terms:
  - prava → haydovchilik guvohnomasi.
  - GAI / DAN / YPX / DYHXX / YHXX → yo'l-patrul xizmati, plus sub-aliases for stopping, leaving the car, protocol/signature, detention, and a missing licence document.
- `law-hints.js` covers: JPK, FPK, IPK, MJTK, MAJAK, MSIK, MSK, JK, FK, and the names soliq / mehnat / oila / fuqarolik / uy-joy / yer / bojxona / budjet / konstitutsiya.
- **Missing:** Russian abbreviations (ГК, УК, ТК, НК, КоАП, ГПК), Cyrillic-Uzbek forms (МЖтК), SK, MK, OK, O'RQ.
- Probes I ran:
  - `detectLawHint("Ma’muriy javobgarlik")` (with U+2019) returns null.
  - `routeQuery` finds nothing in "modda 358", "386 modda", "ст. 386" or "358¹-modda". Its `[Мм]одда` is Cyrillic, so the Latin form "modda N" is never matched.
  - `expandQueryVariants("7¹-modda")` produces "7-modda prim 1-modda", so the router extracts articles 7 **and** 1. It also cannot match a superscript article stored as "7¹".

**Normalisation**
- Apostrophe variants of o‘ oʻ o' o` are handled in JS (`search-utils.js` 4-10), in SQL (`legal-corpus.js` 191-199) and in embeddings. The SQL list lacks ´, ′, ʹ, ʾ, which the JS list has.
- **Latin to Cyrillic transliteration exists only for lex.uz live queries** (`legal-research-playbook.js` 66-82, `lex-resolve.js` 430-462). It is absent from corpus keyword search.
- Russian: no Russian stemming or stopwords (the `'simple'` config). The Uzbek suffix rules are applied to Russian words too. Russian questions rely only on the multilingual embedding. `lexLangForText` (5296) only picks the lex.uz link language.

## 5. Rerank, corrective filter, lex.uz live search, fallbacks

- **Reranker** (`src/rag/reranker.js`):
  - HF `BAAI/bge-reranker-v2-m3` (`RERANKER_MODEL`), one HTTP call per chunk with body `{inputs:[query, passage]}` (100), passage cut at 512 chars (89), 8s overall limit (30).
  - Without HF_TOKEN or on failure it uses keyword overlap: 0.6 × original score + 0.4 × overlap, +0.15 for verified_qa (177-202).
  - **Suspected, unverified:** the HF text-classification API expects `{text, text_pair}`. A 2-element array is likely treated as two separate texts, and `extractScore` takes `body[0]`, the score of the query alone. That would give every chunk the same score, i.e. no reranking at all. This needs one live call to confirm.
- **Corrective filter** (`src/rag/corrective.js`):
  - One `callAI` call using the standard model (gpt-6-sol), not the cheap one. It grades 300-char snippets (246).
  - A chunk with no score gets 0.3, below the 0.5 cut-off, so it is dropped (282, 229).
  - `needsWebSearch` is set when fewer than 2 chunks pass or the best is ≤ 0.75. If the LLM fails, `gradeByKeywords` is used.
- **Lex.uz live search:**
  - `LEX_CROSSCHECK_EVERY_ANSWER` defaults to on, so it runs on **every** answer (4833-4834).
  - A deterministic plan, `buildLexResearchPlan` (`legal-research-playbook.js` 146-207, ≤15 steps with Cyrillic versions), is merged with an LLM planner (`LEX_AI_QUERY_PLANNER`, 4843-4862; merge limit 22).
  - `searchLexUz` (`lex-live-search.js` 55-192): GET `lex.uz/search/nat?Query=`; lex.uz search results first, then registry documents; title-identity check; relevance gate; excerpts up to 4000 chars.
  - Caches: documents 24h (at most 128 entries); search pages 5 min.
  - Results become `source_type='lex_live'` chunks (4894-4916) and are merged by lex doc id (4922-4942).
- **Tavily web search** runs only if `ALLOW_WEB_SEARCH=true` (`LEXUZ_ONLY`, 3499).
- **Other fallbacks:**
  - `buildCorpusOnlyAnswer` when no LLM is configured (6432-6438).
  - The "Gemini fallback" when `isFailedAnswer` fires (6478-6504). Its regex list (4296-4307) includes "mavjud emas" and "topilmadi", which appear in ordinary valid answers.
  - The Justify external RAG (`justify-client.js`, `JUSTIFY_URL`) is used only for admin testing and indexing.
  - `/api/advanced-chat` plus `hybrid-pipeline.js` is master-only, behind `HYBRID_PIPELINE=1`.

## 6. Generation

- **Topic:**
  - `deterministicLegalTopic` (`src/services/legal-topic-routing.js` 18-38) covers yol-harakati, talim and mehnat.
  - Otherwise `classifyLegalTopic` (5989-6010): cheap model, max 16 tokens, forced pick, default `fuqarolik`.
- **Prompt:** `buildTopicPrompt` (5065-5126) =
  - policy prefix (`src/prompts/core-legal-constitution.md` v1.3.0 + `universal-legal-research-playbook.md`),
  - topic rules,
  - a fixed **3-section format**: `**Huquqiy asos**` / `**Tahlil**` / `**Xulosa**`, with inline citations in the form `(**Full act name (O'RQ/PQ/PF/VMQ-N), N-modda, M-qism**)` and no separate "Manbalar" section,
  - the research directive,
  - the RAG context.
- **RAG context formatting (4947-5060):**
  - Each chunk is **cut to 1200 chars** (verified_qa to 2000).
  - Parent-child chunks are "child + [To'liq modda konteksti:] + parent" (4389-4420), so most of the parent is cut away.
  - A `MANBALAR:` list is built from metadata.
- **Additional prompt blocks:** korpus ground truth (similarity 0.78-0.92), verified_qa few-shot examples (similarity 0.50-0.85), and a prompt-injection guard for attached documents.
- **History:** capped at 18 turns and 12k chars.
- **Model:** `MODELS.chat` = `gpt-6-luna` (3527) through the OpenAI Responses API (3619-3708).
  - Streaming falls back to Gemini `gemini-2.5-flash` (3242), or VoiceLab if enabled.
  - It is called with `useSearch:true`, but the web tool is dropped because `LEXUZ_ONLY` is on by default.
- **Post-processing:** `hydrateMentionedOfficialActChunks`, then the cross-check, then `verifyCitations`, then `hydrateLexAnchors`, then `normalizeLegalAnswerCitations` (`citation-utils.js` 804-824), which turns citations into lex.uz deep links.
- `buildManbalarFooter` (5413) is dead code.

## 7. Verification

- **`verifyCitations`** (5310-5338):
  - Uses a regex for article numbers in the answer.
  - If the answer names an act, it checks law+article pairs via `selectRelevantSourceRefs` (`citation-utils.js` 168-241, nearest preceding act within 320 chars). Otherwise it checks that the number appears in chunk metadata or text.
  - It only reports a list in `rag.citationCheck`, shown on the master badge. It never blocks or rewrites the answer.
- **`crossCheckLegalAnswer`** (`legal-answer-cross-check.js` 64-146):
  - A second LLM pass (`MODELS.chat`) that sees only **lex_live** evidence (18). Corpus chunks are ignored.
  - Returns pass / revise / insufficient. On "revise" the answer is **replaced** with the verifier's rewrite. With no lex_live evidence it returns "insufficient" and nothing is checked.
- **`legal-verify.js`:** for uploaded documents / legal opinions.
  - Extracts references with the LLM, then judges each against lex.uz plus the corpus, classifying as tasdiqlandi / qisman / nomuvofiqlik / tekshirilmadi.
  - Bug: it reads `km.corrected_answer`, but `searchKorpus` returns `.answer`, so the qa-korpus is never used there.
- **Other checks:** `auditOpinionCitations` and `auditOpinionCitationPresentation` (5346-5411) for opinions.
- `answer-verification.js` (repeal-status screening of cited PF/PQ/VM) is only referenced by `lex-resolve.js` and its tests, not by legal-chat.

## 8. QA corpus: three overlapping stores

1. **`qa_korpus`** (`qa-korpus.js` 213-230).
   - Columns: id, question, question_hash (unique; normalised lower-case text, not a real hash), corrected_answer, original_ai_answer, topic, article_refs, embedding, embedding_model, embedding_dims, created_by, created_by_name, timestamps.
   - **There is no status, validity, source-law version or expiry.**
   - `searchKorpus` (339-404) takes the top 3 by cosine, filtered by `topic = $3 OR topic IS NULL`.
     - ≥ 0.92 → verbatim. It is still screened by `hasCriticalTermMismatch` / `hasAnswerTopicMismatch` / `hasCanonicalOfficialCitations` (6128-6178).
     - ≥ 0.78 → injected as "ABSOLYUT HAQIQAT" ground truth.
   - Stored questions are embedded as passages (`getEmbeddingsBatch`, 281) but compared to query-prefixed vectors.
2. **`legal_chunks` with `source_type='verified_qa'`.**
   - Text is "Savol: …\n\nJavob: …", written by `insertVerifiedAnswer` (948-990).
   - `getApiKey()` there is **not defined in that file** (963). The ReferenceError is caught, so **new verified_qa rows never get embeddings**.
   - The legal-chat vector lookup (6187-6199) requires `embedding IS NOT NULL`. ≥ 0.85 → verbatim; ≥ 0.50 → few-shot.
3. **`qa_bank`** (`advanced-corpus.js` 64-95; ratings/votes 504-530).
   - `saveToQaBank` calls `insertVerifiedAnswer` again (485-493), so each verification produces a second verified_qa row.
- **How entries are created:** `POST /api/rag/verify-chat-answer` (7963-8028) writes all three stores.
  - It is guarded only by **`requireAuth`, not master** (346-352), so any logged-in user can add "lawyer-verified" answers.
  - Also: `POST /api/qa-bank` (master), `/api/qa-bank/backfill` (5459), and PATCH/DELETE `/api/qa-korpus/:id`.
- **Enrich endpoints:**
  - `/api/qa-korpus/enrich` (5616-5705) and `/api/verified-qa/enrich` (5708-5790) LLM-rewrite stored answers (≤ 200 words, "keep article numbers") and overwrite them when the rewrite is longer.
  - `/api/answers/style-audit` (5797-5916) rewrites to ≤ 180 words.
  - Rewritten answers are not re-embedded, not re-verified, and there is no human approval step.
- **Statuses:** only `flagged_for_review` (user downvotes ≥ 3, `usage-feedback.js`) and `quality_score`. There are no seed QA files in the repo, so the size can't be determined from code.

## 9. Existing evaluation

- **`src/eval/eval-runner.js`:** calls `parentChildSearch` only, with limit 5 and the gold category. It does **not** run the production `retrieveLegalContext`.
  - Metrics: Recall@5 (any expected article number in the top 5) and MRR.
  - **The law is ignored:** a number match in any law counts, and `expected_law` is unused.
  - Report: `src/eval/eval-report.json`. `eval:ci --min-recall=0.70` exits 1 below the threshold.
- **Dataset:** `src/eval/gold-qa.json`, 30 cases, all Uzbek Latin. Problems:
  - 5 cases use category `xavfsizlik`, which is not a corpus category.
  - The soliq cases use `moliya`; 2 cases have category null.
  - The mehnat article numbers look like old-code numbering.
- **CI:** `.github/workflows/ingest-and-eval.yml` is manual `workflow_dispatch` only: `ingest:fetch-all`, `ingest:rebuild`, `eval`. It never runs `eval:ci`.
- **`/api/admin/model-ab`** (742-815): 8 hard-coded questions. Both models get identical `retrieveLegalContext` + `buildTopicPrompt` + `callOpenAI(useSearch:false)`. It compares the `verifyCitations` unverified count, cost, latency and length. `scripts/model-ab.js` is a client for it.
- **Diagnostics:** `/api/admin/retrieval-debug` (1118), `/corpus-diagnostic` (`corpus-diagnose.js`), `/embed-probe` (874), `/coverage-gaps` (917, from `coverage_log`), `db-check.js`, `db-sample.js`, `embed-test.js`, `metrics-dashboard.js` ("hallucination proxy").
- **Unit tests (no DB):**
  - `tests/rag-search.test.js`: 5 tokeniser/merge tests.
  - `tests/rag-integrity.test.js`: 8 source-ref/Tahlil/dimension-migration tests.
  - `tests/query-aliases.test.js`: GAI/prava aliases plus corpus fallback.

## 10. Caching

- **`answer_cache`:**
  - 72h TTL. Key is sha256 of `'lex-official-id-citations-v5|topic|lowercased message'`, first turn and no attachment only (6291-6328, write 6605-6614).
  - Not tied to `legal_corpus_state.revision`, so a corpus update or repeal doesn't invalidate it.
  - It is read before retrieval but after the QA overrides. Non-lex.uz links are purged on boot (10243-10258).
- **Other caches:**
  - `opinion_cache` (document hash).
  - In-memory caches: lex document 24h, lex search page 5 min, lex anchors 6h, answer-verification 6h, source-suggestion dedupe 24h.
- **Prompt caching:** relies on automatic OpenAI prefix caching. The policy prefix is placed first on purpose (5114-5117); `cached_tokens` is recorded. There is no semantic cache apart from the qa_korpus 0.92 verbatim path.

## 11. Freshness and update jobs

- **`check-freshness.js`:** manual npm script only, no cron.
  - **Bug:** it checks `fetched.is_active` (66), but `fetchLexDocument` returns `{title, body, metadata, rawHtml}`. It should read `fetched.metadata.is_active`, so **it never deactivates anything**.
  - It detects repeal only, not amendments (no hash or edition-date comparison).
  - Because `fetchLexDocument` auto-follows to the current version, a superseded snapshot URL also reads as active.
- **`ingest-queue.js`:** in-memory FIFO queue (lost on restart), fed only by the "Yangilash" button (`/api/rag/update-category`, 8450). There is no scheduler anywhere (the only `setInterval` calls are unrelated).
- **Destructive re-ingest:**
  - `ingestLexUrl` deletes by `source_url` **before** inserting (8279), and `insertStructuredChunks` refuses chunks without vectors (`advanced-corpus.js` 120-128). An embedding failure after the delete therefore wipes that document.
  - `reingest-registry` has the same pattern when no embedding key is configured.
- **Gap-fill:** `coverage_log` feeds `suggested_sources` (5225-5277, LLM-guessed act names verified on lex.uz), which feeds a master's one-click ingest.

## 12. Provider coupling (what a future LLMProvider / EmbeddingProvider layer must absorb)

- **Embeddings:**
  - `embeddings.js` hard-codes the provider order, endpoints, E5 prefixes, Gemini task types, dimensions and the MRL 1536 truncation.
  - `vector(${getEmbedDims()})` DDL is in `legal-corpus.js:60`, `advanced-corpus.js:79`, `qa-korpus.js:221`; dimension migrations also in `server.js` 10270.
  - The `HF_TOKEN || GEMINI_API_KEY || GPT_API_KEY` chain is copied in many places: `server.js` 898, 4431, 4479, 5568, 5938, 6113, 6181, 8100, 8263, 8333; `advanced-corpus.js` 459, 544; `qa-korpus.js` 138, 278; `advanced-routes.js`. The `apiKey` parameters are mostly ignored anyway (`getEmbedding` prefers `getApiKey()`).
- **LLM:**
  - `server.js`: `callOpenAI` (Responses API, `web_search_preview`, `max_output_tokens ≥ 16`, removes temperature for gpt-5+), `callOpenAIStream`, `callGemini`/`callGeminiStream` (`googleSearch`, hard-coded gemini-2.5-flash), `callAI` / `callCheapAI` / `callPremiumAI`, `tryVoiceLab`, the `MODELS` map (3514), `recordSpend`.
  - `hybrid-pipeline.js` has its own clients and model chains (34-35).
  - `legal-answer-cross-check.js` defaults to 'gpt-6-luna' (69).
  - `corrective.js` and `legal-verify.js` receive `callAI` by injection; that pattern is the good one to generalise.
  - `src/ai/voicelab.js`; `src/ai/model-pricing.js`.
- **Other:** reranker hard-wired to HF_TOKEN and the HF router URL (`reranker.js` 48, 92); Tavily (`web-search.js`); Justify (`justify-client.js`).

---

## Top weaknesses (with evidence)

**Bugs that hurt correctness**
1. **Repealed documents are never deactivated automatically:** `check-freshness.js:66` checks the wrong field, and there is no schedule.
2. **Verified answers in `legal_chunks` are never embedded:** `legal-corpus.js:963` calls an undefined `getApiKey`. The verified_qa vector override and few-shot paths therefore only ever see older rows.
3. **Anyone can poison the QA stores:** `/api/rag/verify-chat-answer` is `requireAuth`, not master. At similarity ≥ 0.92 those answers are served word-for-word.
4. **QA answers never go stale and get rewritten without review:** there is no link to a law version. The enrich and style-audit endpoints overwrite answers by LLM with no re-verification.
5. **Re-ingest can wipe a document:** delete happens before insert (`server.js` 8279-8284 and reingest-registry). An embedding failure causes data loss.

**Retrieval recall**
6. **Article references are missed:** "modda 358", "386 modda", "ст. 386" and superscript prim forms aren't extracted (`router.js:40`). The prim expansion adds a spurious article 1. Law hints miss Russian and Cyrillic abbreviations and curly apostrophes.
7. **Truncation at every stage:** parents cut at 3200 chars at ingest, E5 input at 2048, reranker input at 512, corrective at 300, prompt at 1200. Long articles, and later parts of articles, lose evidence.
8. **Approximate search is weakened:** ivfflat runs with default `probes=1` and a post-filter on category or `chunk_type='child'`. Dense recall is likely degraded, and small categories can return fewer rows than requested.
9. **Keyword search is Uzbek-Latin only:** no Latin/Cyrillic transliteration in corpus search, no Russian stemming, and a mixed-script corpus (`legal-docs` is Russian/Cyrillic, including the obsolete 1995 Labour Code). `language` is mislabelled 'ru' for `/docs/-N` URLs.
10. **Ranking is dominated by hand-tuned bonuses:** exact phrase, verified_qa and "guaranteed" merges outweigh the RRF scores. The reranker may be a silent no-op (suspected; needs a live check).

**Faithfulness**
11. **Answers are often not grounded in the corpus:**
    - The cross-check only uses lex_live evidence, and the verifier can replace the whole answer.
    - `verifyCitations` only reports; nothing is blocked.
    - `isFailedAnswer` fires on common phrases and re-answers from parametric memory.
12. **Cache and topic issues:**
    - The 72h `answer_cache` ignores corpus revisions.
    - The topic classifier's forced default `fuqarolik` plus `strictTopic` can hide the correct law.

**Evaluation**
13. **The evaluation doesn't test production:** it bypasses `retrieveLegalContext`, matches article number without the law, has 30 cases with invalid categories and probably outdated article numbering, measures no Russian or Cyrillic queries, and measures no generation or citation accuracy.

## Access needed to measure these

- **Read-only `DATABASE_URL`** (Supabase) to:
  - count `legal_chunks` by `source_type`, `language`, `chunk_type`, embedded vs not, and null `article_number_display`;
  - count verified_qa rows with NULL embedding;
  - look at the size, topics and `created_by` roles of `qa_korpus` / `qa_bank`;
  - look at the age of `answer_cache` entries, the weak rate in `coverage_log`, and `answer_feedback`.
- **The embedding key matching the corpus** (`EMBED_PROVIDER`, plus HF_TOKEN or GEMINI_API_KEY) to run a fixed eval through the real `retrieveLegalContext` and measure the probes effect.
- **HF_TOKEN** for one reranker call to confirm or clear the input-format bug.
- **GPT_API_KEY** (and optionally GEMINI / VoiceLab keys) for end-to-end citation-precision and faithfulness grading.
- **Network access to lex.uz** for freshness, live search and building a law-aware gold set.
- **A lawyer-labelled gold set:** Uzbek Latin + Cyrillic + Russian questions, each with `(doc_id, article, qism)` and an in-force date. The current `gold-qa.json` isn't reliable enough to use as a gate.