'use strict';

/**
 * Embedding smoke test — proves the configured provider actually returns
 * vectors before committing to a full corpus re-ingest.
 *
 *   node src/eval/embed-test.js
 *
 * Exits 0 and prints the dimension on success; exits 1 with the provider
 * error on failure (e.g. HF 401, model loading, network).
 */

require('dotenv').config();
const { getEmbedding, getEmbeddingsBatch, detectProvider } = require('../rag/embeddings');

function resolveApiKey() {
  const provider = detectProvider();
  if (provider === 'huggingface') return process.env.HF_TOKEN;
  if (provider === 'gemini') return process.env.GEMINI_API_KEY;
  return process.env.GPT_API_KEY || process.env.OPENAI_API_KEY;
}

async function main() {
  const provider = detectProvider();
  const apiKey = resolveApiKey();

  console.log('─'.repeat(50));
  console.log('EMBEDDING SMOKE TEST');
  console.log('─'.repeat(50));
  console.log(`  Provider:    ${provider || '(none detected)'}`);
  console.log(`  API key:     ${apiKey ? apiKey.slice(0, 6) + '…' + ` (len ${apiKey.length})` : 'MISSING'}`);

  if (!provider) {
    console.error('\nFAIL: No provider detected. Set HF_TOKEN, GEMINI_API_KEY, or GPT_API_KEY.');
    process.exit(1);
  }
  if (!apiKey) {
    console.error(`\nFAIL: Provider is ${provider} but its key env var is empty.`);
    process.exit(1);
  }

  // 1. Single query embedding (the path used at search time)
  console.log('\n[1/2] Single query embedding…');
  const single = await getEmbedding("Ishchi ishdan asossiz bo'shatilgan, nima qilish kerak?", apiKey);
  if (!Array.isArray(single) || single.length === 0) {
    console.error('FAIL: getEmbedding returned no vector.');
    process.exit(1);
  }
  console.log(`      OK — ${single.length} dimensions. Sample: [${single.slice(0, 3).map(n => n.toFixed(4)).join(', ')}, …]`);

  // 2. Batch embedding (the path used at ingest time)
  console.log('\n[2/2] Batch embedding (3 passages)…');
  const batch = await getEmbeddingsBatch([
    'Mehnat shartnomasi yozma shaklda tuziladi.',
    'Yillik mehnat tatili kamida yigirma olti kun.',
    'Ish haqi har oyda toʻlanadi.',
  ], apiKey);
  if (!Array.isArray(batch) || batch.length !== 3) {
    console.error(`FAIL: getEmbeddingsBatch returned ${Array.isArray(batch) ? batch.length : 'non-array'} vectors for 3 inputs.`);
    process.exit(1);
  }
  console.log(`      OK — ${batch.length} vectors, ${batch[0].length} dimensions each.`);

  console.log('\n' + '─'.repeat(50));
  console.log(`VERDICT: ${provider} embeddings WORK (${single.length}d). Safe to run ingest:fetch-all.`);
  console.log('─'.repeat(50));
}

main().catch(err => {
  console.error('\nFAIL:', err.message);
  process.exit(1);
});
