'use strict';

/**
 * Embeddings Service — Multi-provider (Gemini / OpenAI)
 *
 * Priority: GEMINI_API_KEY → GPT_API_KEY → error
 *
 * Gemini (text-embedding-004):
 *   - FREE tier (1500 req/min)
 *   - 768 dimensions
 *   - Good multilingual (Russian/Uzbek)
 *
 * OpenAI (text-embedding-3-small):
 *   - $0.02/1M tokens
 *   - 1536 dimensions
 *   - Excellent multilingual
 */

// ========== PROVIDER DETECTION ==========

function detectProvider() {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.GPT_API_KEY || process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

function getApiKey() {
  const provider = detectProvider();
  if (provider === 'gemini') return process.env.GEMINI_API_KEY;
  return process.env.GPT_API_KEY || process.env.OPENAI_API_KEY;
}

// ========== PROVIDER CONFIGS ==========

const PROVIDERS = {
  gemini: {
    model: 'text-embedding-004',
    dims: 768,
    maxInput: 8000,
    batchSize: 100  // Gemini supports batch via array of content objects
  },
  openai: {
    model: 'text-embedding-3-small',
    dims: 1536,
    maxInput: 8000,
    batchSize: 100
  }
};

// Export the active dimensions (used by legal-corpus.js for table creation)
function getEmbedDims() {
  const provider = detectProvider();
  return provider ? PROVIDERS[provider].dims : 768; // default to Gemini dims
}

const EMBED_MODEL = () => {
  const p = detectProvider();
  return p ? PROVIDERS[p].model : 'unknown';
};

// ========== GEMINI EMBEDDINGS ==========

async function geminiEmbed(texts, apiKey) {
  // Gemini batchEmbedContents endpoint
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${PROVIDERS.gemini.model}:batchEmbedContents?key=${apiKey}`;

  const requests = texts.map(text => ({
    model: `models/${PROVIDERS.gemini.model}`,
    content: { parts: [{ text }] },
    taskType: 'RETRIEVAL_DOCUMENT'
  }));

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests })
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`Gemini Embedding API ${resp.status}: ${errBody.substring(0, 200)}`);
  }

  const data = await resp.json();
  return data.embeddings.map(e => e.values);
}

async function geminiEmbedQuery(text, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${PROVIDERS.gemini.model}:embedContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${PROVIDERS.gemini.model}`,
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_QUERY'
    })
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`Gemini Embedding API ${resp.status}: ${errBody.substring(0, 200)}`);
  }

  const data = await resp.json();
  return data.embedding.values;
}

// ========== OPENAI EMBEDDINGS ==========

async function openaiEmbed(texts, apiKey) {
  const inputs = texts.map(t => t.substring(0, PROVIDERS.openai.maxInput));

  const resp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model: PROVIDERS.openai.model, input: inputs })
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`OpenAI Embedding API ${resp.status}: ${errBody.substring(0, 200)}`);
  }

  const data = await resp.json();
  const sorted = data.data.sort((a, b) => a.index - b.index);
  return sorted.map(d => d.embedding);
}

async function openaiEmbedQuery(text, apiKey) {
  const results = await openaiEmbed([text], apiKey);
  return results[0];
}

// ========== PUBLIC API ==========

/**
 * Get embedding for a single text (used for query-time search).
 * Uses RETRIEVAL_QUERY task type for Gemini (optimized for queries).
 */
async function getEmbedding(text, apiKey) {
  const key = apiKey || getApiKey();
  if (!key) throw new Error('No API key for embeddings (set GEMINI_API_KEY or GPT_API_KEY)');
  if (!text || text.trim().length === 0) throw new Error('Empty text cannot be embedded');

  const provider = detectProvider();
  const input = text.substring(0, PROVIDERS[provider].maxInput);

  if (provider === 'gemini') {
    return geminiEmbedQuery(input, key);
  } else {
    return openaiEmbedQuery(input, key);
  }
}

/**
 * Get embeddings for multiple texts in batch (used for ingestion).
 * Uses RETRIEVAL_DOCUMENT task type for Gemini (optimized for corpus).
 */
async function getEmbeddingsBatch(texts, apiKey) {
  const key = apiKey || getApiKey();
  if (!key) throw new Error('No API key for embeddings (set GEMINI_API_KEY or GPT_API_KEY)');
  if (!texts || texts.length === 0) return [];

  const provider = detectProvider();
  const config = PROVIDERS[provider];
  const BATCH_SIZE = config.batchSize;
  const allEmbeddings = [];

  console.log(`[EMBEDDINGS] Using ${provider} (${config.model}, ${config.dims}d)`);

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const inputs = batch.map(t => (t || '').substring(0, config.maxInput));

    let embeddings;
    if (provider === 'gemini') {
      embeddings = await geminiEmbed(inputs, key);
    } else {
      embeddings = await openaiEmbed(inputs, key);
    }

    allEmbeddings.push(...embeddings);

    // Rate limiting between batches
    if (i + BATCH_SIZE < texts.length) {
      await new Promise(r => setTimeout(r, provider === 'gemini' ? 100 : 200));
    }

    console.log(`[EMBEDDINGS] Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(texts.length / BATCH_SIZE)} done (${allEmbeddings.length}/${texts.length})`);
  }

  return allEmbeddings;
}

module.exports = {
  getEmbedding,
  getEmbeddingsBatch,
  getEmbedDims,
  detectProvider,
  PROVIDERS,
  // Legacy compat
  get EMBED_MODEL() { return EMBED_MODEL(); },
  get EMBED_DIMS() { return getEmbedDims(); }
};
