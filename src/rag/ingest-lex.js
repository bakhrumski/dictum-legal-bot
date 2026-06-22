'use strict';

/**
 * Ingestion Pipeline for Legal Documents
 *
 * Usage:
 *   # From local .txt file:
 *   node src/rag/ingest-lex.js <file.txt> --category mehnat
 *
 *   # Fetch directly from lex.uz:
 *   node src/rag/ingest-lex.js --url https://lex.uz/docs/145261 --category mehnat --doc-id mehnat-kodeks
 *
 *   # Fetch ALL registered laws for a category:
 *   node src/rag/ingest-lex.js --fetch --category mehnat
 *
 *   # Fetch ALL registered laws (all categories):
 *   node src/rag/ingest-lex.js --fetch-all
 *
 *   # Directory of .txt files:
 *   node src/rag/ingest-lex.js --dir legal-docs/mehnat --category mehnat
 *
 *   # Stats / rebuild:
 *   node src/rag/ingest-lex.js --stats
 *   node src/rag/ingest-lex.js --rebuild-index
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chunkLegalDocument } = require('./chunker');
const { chunkLegalDocumentStructured } = require('./structural-chunker');
const { getEmbeddingsBatch, detectProvider } = require('./embeddings');
const { insertChunks, deleteByDocId, getCorpusStats, rebuildVectorIndex, initLegalCorpus } = require('./legal-corpus');
const { insertStructuredChunks } = require('./advanced-corpus');
const { fetchLexDocument } = require('./fetch-lex');
const { getLawsForCategory, getAllLaws, getRegistryStats, LEX_REGISTRY } = require('./lex-registry');

// ========== CONFIG ==========

// Derived from the registry so it never drifts when categories are added/removed.
const VALID_CATEGORIES = Object.keys(LEX_REGISTRY);

function getApiKey() {
  // Resolve the key for whichever provider detectProvider() will actually use,
  // so the key matches the provider. HF_TOKEN takes priority in detectProvider,
  // so it must be checked first here too — otherwise we'd send a Gemini key to
  // the HuggingFace endpoint (401 Invalid username or password).
  const provider = detectProvider();
  if (provider === 'huggingface') return process.env.HF_TOKEN;
  if (provider === 'gemini') return process.env.GEMINI_API_KEY;
  return process.env.GPT_API_KEY || process.env.OPENAI_API_KEY;
}

/**
 * Guard against silently storing NULL embeddings.
 *
 * The whole RAG pipeline is useless without vectors — a doc inserted with
 * embedding=NULL is invisible to vector search but still occupies the corpus
 * and passes naive row-count checks. Historically this is exactly how the
 * corpus ended up with 5000+ rows and 0 embeddings. Fail the ingest loudly
 * instead so the operator notices immediately.
 */
function assertEmbeddings(embeddings, chunks, docMeta) {
  if (!Array.isArray(embeddings) || embeddings.length !== chunks.length) {
    throw new Error(
      `Embedding count mismatch for "${docMeta.law_name}": ` +
      `${Array.isArray(embeddings) ? embeddings.length : 'non-array'} embeddings for ${chunks.length} chunks. Aborting insert.`
    );
  }
  const bad = embeddings.findIndex(e => !Array.isArray(e) || e.length === 0);
  if (bad !== -1) {
    throw new Error(
      `Empty/invalid embedding at index ${bad} for "${docMeta.law_name}". ` +
      `Refusing to insert chunks without vectors.`
    );
  }
}

// ========== FILE PARSING ==========

function parseFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const result = { body: raw, metadata: {} };

  if (raw.startsWith('---')) {
    const endIdx = raw.indexOf('---', 3);
    if (endIdx > 0) {
      const header = raw.substring(3, endIdx).trim();
      result.body = raw.substring(endIdx + 3).trim();

      for (const line of header.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const key = line.substring(0, colonIdx).trim();
          const val = line.substring(colonIdx + 1).trim();
          result.metadata[key] = val;
        }
      }
    }
  }

  return result;
}

// ========== CORE: INGEST TEXT INTO DB ==========

/**
 * Shared ingestion logic: chunk text, embed, store.
 * Used by both file-based and URL-based ingestion.
 */
async function ingestText(body, docMeta) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('No embedding API key set (HF_TOKEN / GEMINI_API_KEY / GPT_API_KEY / OPENAI_API_KEY)');
  }

  if (docMeta.is_active === false) {
    console.warn(`  SKIPPED (inactive): "${docMeta.law_name}" — ${docMeta.status_label || 'document not in force'}. Not ingesting stale text.`);
    return 0;
  }

  const provider = detectProvider();
  console.log(`\n=== Ingesting: ${docMeta.law_name} (${provider}) ===`);
  console.log(`  Category: ${docMeta.category}`);
  console.log(`  Doc ID:   ${docMeta.doc_id}`);
  console.log(`  Source:   ${docMeta.source_url || 'local file'}`);
  console.log(`  Length:   ${body.length} chars`);

  // 1. Chunk
  const chunks = chunkLegalDocument(body, docMeta);
  if (chunks.length === 0) {
    console.log('  WARNING: No chunks generated. Check document format.');
    return 0;
  }
  console.log(`  Chunks:   ${chunks.length}`);

  // 2. Generate embeddings
  console.log('  Generating embeddings...');
  const texts = chunks.map(c => c.text);
  const embeddings = await getEmbeddingsBatch(texts, apiKey);

  assertEmbeddings(embeddings, chunks, docMeta);

  for (let i = 0; i < chunks.length; i++) {
    chunks[i].embedding = embeddings[i];
    chunks[i].chunkIndex = i;
  }

  // 3. Delete old chunks (re-ingest support)
  await deleteByDocId(docMeta.doc_id);

  // 4. Insert
  const inserted = await insertChunks(chunks);
  console.log(`  DONE: ${inserted} chunks inserted\n`);

  return inserted;
}

async function ingestStructuredHtml(rawHtml, docMeta, opts = {}) {
  const { signal } = opts;
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('No embedding API key set (HF_TOKEN / GEMINI_API_KEY / GPT_API_KEY / OPENAI_API_KEY)');
  }

  // Refuse to ingest repealed / superseded documents. Storing stale law text
  // is worse than missing it — the model cites it confidently and hallucinates
  // (e.g. an "Hujjat kuchini yo'qotgan" decree described as if in force). The
  // fetcher sets is_active=false when it sees that banner; honour it here.
  if (docMeta.is_active === false) {
    console.warn(`  SKIPPED (inactive): "${docMeta.law_name}" — ${docMeta.status_label || 'document not in force'}. Not ingesting stale text.`);
    return 0;
  }

  const provider = detectProvider();
  console.log(`\n=== Ingesting (structured): ${docMeta.law_name} (${provider}) ===`);
  console.log(`  Category: ${docMeta.category}`);
  console.log(`  Doc ID:   ${docMeta.doc_id}`);
  console.log(`  Source:   ${docMeta.source_url || 'lex.uz html'}`);

  const chunks = chunkLegalDocumentStructured(rawHtml, docMeta, { isHtml: true });
  if (chunks.length === 0) {
    console.log('  WARNING: No structured chunks generated. Check document format.');
    return 0;
  }

  console.log(`  Chunks:   ${chunks.length}`);
  console.log('  Generating embeddings...');

  const texts = chunks.map((chunk) => chunk.text);
  const embeddings = await getEmbeddingsBatch(texts, apiKey, { signal });

  assertEmbeddings(embeddings, chunks, docMeta);

  for (let i = 0; i < chunks.length; i++) {
    chunks[i].embedding = embeddings[i];
    chunks[i].chunkIndex = i;
  }

  // Final cancellation point before we touch the DB: don't delete the existing
  // doc's chunks if the operator cancelled while we were embedding.
  if (signal && signal.aborted) {
    const e = new Error('Ingest aborted by user'); e.name = 'AbortError'; throw e;
  }

  await deleteByDocId(docMeta.doc_id);

  const inserted = await insertStructuredChunks(chunks);
  const totalInserted = inserted.parents + inserted.children;
  console.log(`  DONE: ${totalInserted} structured chunks inserted (${inserted.parents} parents, ${inserted.children} children)\n`);

  return totalInserted;
}

// ========== INGEST FROM FILE ==========

async function ingestFile(filePath, opts = {}) {
  if (!fs.existsSync(filePath)) {
    console.error(`ERROR: File not found: ${filePath}`);
    process.exit(1);
  }

  const category = opts.category;
  if (!category || !VALID_CATEGORIES.includes(category)) {
    console.error(`ERROR: Invalid category "${category}". Valid: ${VALID_CATEGORIES.join(', ')}`);
    process.exit(1);
  }

  const { body, metadata: fileMeta } = parseFile(filePath);
  const docMeta = {
    law_name: opts.lawName || fileMeta.law_name || path.basename(filePath, '.txt'),
    doc_id: opts.docId || fileMeta.doc_id || path.basename(filePath, '.txt'),
    source_url: opts.sourceUrl || fileMeta.source_url || null,
    category,
    enforcement_date: fileMeta.enforcement_date || null,
    adoption_date: fileMeta.adoption_date || null,
    document_number: fileMeta.document_number || null,
    status_label: fileMeta.status_label || null,
    is_active: fileMeta.is_active !== 'false',
    language: fileMeta.language || 'ru',
    is_valid: true
  };

  return ingestText(body, docMeta);
}

// ========== INGEST FROM URL ==========

async function ingestFromUrl(url, opts = {}) {
  const category = opts.category;
  const signal = opts.signal || null;
  if (!category || !VALID_CATEGORIES.includes(category)) {
    throw new Error(`Invalid category "${category}". Valid: ${VALID_CATEGORIES.join(', ')}`);
  }

  const doc = await fetchLexDocument(url, { signal });
  const lexMeta = doc.metadata || {};
  const inferredLanguage = url.includes('/uz/') ? 'uz' : 'ru';

  const docMeta = {
    ...lexMeta,
    law_name: opts.lawName || doc.title,
    doc_id: opts.docId || url.split('/').pop(),
    source_url: url,
    category,
    enforcement_date: opts.enforcementDate || lexMeta.enforcement_date || null,
    adoption_date: opts.adoptionDate || lexMeta.adoption_date || null,
    document_number: opts.documentNumber || lexMeta.document_number || null,
    status_label: lexMeta.status_label || null,
    is_active: lexMeta.is_active !== false,
    language: opts.language || lexMeta.language || inferredLanguage,
    is_valid: true,
  };

  // Optionally save the raw text to legal-docs/ for backup. Best-effort: the
  // runtime container may have a read-only FS, so never let this break ingest.
  try {
    const saveDir = path.join(__dirname, '..', '..', 'legal-docs', category);
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
    const savePath = path.join(saveDir, `${docMeta.doc_id}.txt`);
    const header = [
      '---',
      `law_name: ${docMeta.law_name}`,
      `doc_id: ${docMeta.doc_id}`,
      `source_url: ${url}`,
      `category: ${category}`,
      `language: ${docMeta.language || inferredLanguage}`,
      docMeta.adoption_date ? `adoption_date: ${docMeta.adoption_date}` : null,
      docMeta.document_number ? `document_number: ${docMeta.document_number}` : null,
      docMeta.status_label ? `status_label: ${docMeta.status_label}` : null,
      docMeta.is_active === false ? 'is_active: false' : 'is_active: true',
      '---',
      '',
    ].filter(Boolean).join('\n');
    fs.writeFileSync(savePath, header + doc.body, 'utf-8');
    console.log(`  Saved raw text: ${savePath}`);
  } catch (fsErr) {
    console.warn(`  (backup skipped: ${fsErr.message})`);
  }

  return ingestStructuredHtml(doc.rawHtml || doc.body, {
    ...docMeta,
    source_type: 'law_text',
    quality_score: 0.5,
    verified_by: null,
  }, { signal });
}

// ========== INGEST FROM REGISTRY ==========

// High-use codes to ingest first (in this order), per product priority.
// Each id must exist as a doc_id in lex-registry.js.
const PRIORITY_DOC_IDS = [
  'fuqarolik-kodeks-1',
  'fuqarolik-kodeks-2',
  'mehnat-kodeks',
  'soliq-kodeks',
  'iqtisodiy-protsessual-kodeks',
  'fuqarolik-protsessual-kodeks',
  'jinoyat-protsessual-kodeks',
  'mamuriy-javobgarlik-kodeks',
  'jinoyat-kodeks',
  'mamuriy-sud-kodeks',
  'oila-kodeks',
];

/**
 * Return registry laws matching PRIORITY_DOC_IDS, in priority order.
 */
function getPriorityLaws() {
  const byId = new Map(getAllLaws().map((law) => [law.doc_id, law]));
  const laws = [];
  for (const id of PRIORITY_DOC_IDS) {
    const law = byId.get(id);
    if (law) laws.push(law);
    else console.warn(`  WARN: priority doc_id "${id}" not found in registry — skipping`);
  }
  return laws;
}

/**
 * Fetch and ingest all registered laws for a category (or all categories),
 * or an explicit pre-selected list of laws.
 */
async function ingestFromRegistry(category, explicitLaws) {
  const laws = explicitLaws || (category ? getLawsForCategory(category) : getAllLaws());

  if (laws.length === 0) {
    console.error(`ERROR: No laws registered for category "${category}"`);
    process.exit(1);
  }

  console.log(`\n========================================`);
  console.log(`Fetching ${laws.length} law(s) from lex.uz`);
  console.log(`========================================\n`);

  let totalChunks = 0;
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < laws.length; i++) {
    const law = laws[i];
    const cat = law.category || category;

    console.log(`[${i + 1}/${laws.length}] ${law.law_name}`);

    try {
      const count = await ingestFromUrl(law.lex_url, {
        category: cat,
        docId: law.doc_id,
        lawName: law.law_name,
        enforcementDate: law.enforcement_date
      });
      totalChunks += count;
      successCount++;
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      failCount++;
    }

    // Rate limit between fetches
    if (i < laws.length - 1) {
      console.log('  Waiting 2s before next fetch...');
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\n========================================`);
  console.log(`Ingestion complete!`);
  console.log(`  Success: ${successCount}/${laws.length}`);
  console.log(`  Failed:  ${failCount}`);
  console.log(`  Total chunks: ${totalChunks}`);
  console.log(`========================================\n`);

  // Rebuild vector index after bulk insert
  if (totalChunks > 0) {
    await rebuildVectorIndex();
  }
}

// ========== INGEST DIRECTORY ==========

async function ingestDirectory(dirPath, category) {
  if (!fs.existsSync(dirPath)) {
    console.error(`ERROR: Directory not found: ${dirPath}`);
    process.exit(1);
  }

  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.txt'));
  if (files.length === 0) {
    console.log(`No .txt files found in ${dirPath}`);
    return;
  }

  console.log(`\nFound ${files.length} files in ${dirPath}`);
  let total = 0;

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const count = await ingestFile(filePath, { category });
    total += count;
  }

  console.log(`\n=== Directory complete: ${total} total chunks from ${files.length} files ===`);
  await rebuildVectorIndex();
}

// ========== CLI ==========

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.log(`
JuristAI Legal Document Ingestion Pipeline

Usage:
  # Fetch from lex.uz by URL:
  node src/rag/ingest-lex.js --url <lex.uz-url> --category <cat> [--doc-id <id>]

  # Fetch all registered laws for a category:
  node src/rag/ingest-lex.js --fetch --category <cat>

  # Fetch ALL registered laws (every category):
  node src/rag/ingest-lex.js --fetch-all

  # Fetch the high-use codes first (priority order):
  node src/rag/ingest-lex.js --priority

  # From local .txt file:
  node src/rag/ingest-lex.js <file.txt> --category <cat>

  # From directory of .txt files:
  node src/rag/ingest-lex.js --dir <path> --category <cat>

  # Stats / maintenance:
  node src/rag/ingest-lex.js --stats
  node src/rag/ingest-lex.js --registry
  node src/rag/ingest-lex.js --rebuild-index

Valid categories: ${VALID_CATEGORIES.join(', ')}
`);
    process.exit(0);
  }

  await initLegalCorpus();

  // --stats
  if (args.includes('--stats')) {
    const stats = await getCorpusStats();
    console.log('\n=== Legal Corpus Stats ===');
    console.log(`Total valid chunks: ${stats.total}`);
    if (stats.byCategory.length > 0) {
      console.log('\nBy category:');
      for (const row of stats.byCategory) {
        console.log(`  ${row.category}: ${row.chunk_count} chunks, ${row.doc_count} docs, ${row.embedded_count} embedded`);
      }
    } else {
      console.log('  (empty — no documents ingested yet)');
    }
    process.exit(0);
  }

  // --registry
  if (args.includes('--registry')) {
    const stats = getRegistryStats();
    const laws = getAllLaws();
    console.log('\n=== Lex.uz Law Registry ===\n');
    for (const law of laws) {
      console.log(`  [${law.category}] ${law.law_name}`);
      console.log(`    ${law.lex_url}`);
    }
    console.log(`\nTotal: ${laws.length} laws across ${Object.keys(stats).length} categories`);
    process.exit(0);
  }

  // --rebuild-index
  if (args.includes('--rebuild-index')) {
    await rebuildVectorIndex();
    process.exit(0);
  }

  // Parse CLI options
  const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
  };

  const category = getArg('--category');
  const docId = getArg('--doc-id');
  const lawName = getArg('--law-name');
  const sourceUrl = getArg('--source-url');
  const url = getArg('--url');
  const dir = getArg('--dir');

  // --priority: fetch the high-use codes first, in priority order
  if (args.includes('--priority')) {
    await ingestFromRegistry(null, getPriorityLaws());
    process.exit(0);
  }

  // --docs fuqarolik-kodeks-1,mehnat-kodeks,...  ingest specific doc_ids only
  const docsArg = getArg('--docs');
  if (docsArg) {
    const ids = docsArg.split(',').map(s => s.trim()).filter(Boolean);
    const byId = new Map(getAllLaws().map((law) => [law.doc_id, law]));
    const laws = [];
    for (const id of ids) {
      const law = byId.get(id);
      if (law) laws.push(law);
      else console.warn(`  WARN: doc_id "${id}" not found in registry — skipping`);
    }
    if (laws.length === 0) { console.error('ERROR: none of the requested doc_ids were found in registry'); process.exit(1); }
    await ingestFromRegistry(null, laws);
    process.exit(0);
  }

  // --fetch-all: fetch all registered laws
  if (args.includes('--fetch-all')) {
    await ingestFromRegistry(null);
    process.exit(0);
  }

  // --fetch: fetch registered laws for a category
  if (args.includes('--fetch')) {
    if (!category) {
      console.error('ERROR: --category is required with --fetch');
      process.exit(1);
    }
    await ingestFromRegistry(category);
    process.exit(0);
  }

  // --url: fetch single URL
  if (url) {
    if (!category) {
      console.error('ERROR: --category is required with --url');
      process.exit(1);
    }
    await ingestFromUrl(url, { category, docId, lawName });
    await rebuildVectorIndex();
    process.exit(0);
  }

  // --dir: ingest directory
  if (dir) {
    if (!category) {
      console.error('ERROR: --category is required with --dir');
      process.exit(1);
    }
    await ingestDirectory(dir, category);
    process.exit(0);
  }

  // Default: file path
  const filePath = args.find(a => !a.startsWith('--'));
  if (!filePath) {
    console.error('ERROR: Provide a file path, --url, --fetch, or --fetch-all');
    process.exit(1);
  }
  await ingestFile(filePath, { category, docId, lawName, sourceUrl });
  await rebuildVectorIndex();
  process.exit(0);
}

// Only run the CLI when invoked directly (`node src/rag/ingest-lex.js ...`),
// not when imported for programmatic ingestion (auto-enrich queue, server).
if (require.main === module) {
  main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
  });
}

module.exports = {
  ingestText,
  ingestStructuredHtml,
  ingestFromUrl,
  ingestFromRegistry,
  ingestFile,
  getApiKey,
  VALID_CATEGORIES,
};
