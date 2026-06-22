'use strict';

const https = require('https');

// Matches any apostrophe-like character BETWEEN two Unicode letters.
// Covers all 7 variants found in Uzbek Latin text (', ʻ, `, ʼ, ', ', ′, etc.)
// so that o'zbek, oʻzbek, o`zbek all normalize to the same token before embedding.
const UZBEK_APOSTROPHE_RX = /(\p{L})['`ʹʻʼʽʾ՚‘’‛′´](?=\p{L})/gu;

/**
 * POST JSON to HTTPS endpoint using Node built-in https (no global fetch needed).
 * Returns { status, body (parsed JSON) }.
 */
function httpsPostJson(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
      timeout: 60000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        try {
          resolve({ status: res.statusCode, body: JSON.parse(text), text });
        } catch {
          resolve({ status: res.statusCode, body: null, text });
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(payload);
    req.end();
  });
}

/**
 * Embeddings Service — Multi-provider
 *
 * Priority: HF_TOKEN → GEMINI_API_KEY → GPT_API_KEY → error
 *
 * HuggingFace (multilingual-e5-large):          ← BEST for RU/UZ legal text
 *   - FREE Inference API (rate-limited)
 *   - 1024 dimensions
 *   - Natively supports Russian + Uzbek
 *   - E5 requires "query: " / "passage: " prefix
 *
 * Gemini (gemini-embedding-001):
 *   - FREE tier (1500 req/min)
 *   - 3072 dimensions
 *   - Good multilingual
 *
 * OpenAI (text-embedding-3-small):
 *   - $0.02/1M tokens
 *   - 1536 dimensions
 */

// ========== PROVIDER DETECTION ==========

function detectProvider() {
  if (process.env.HF_TOKEN) return 'huggingface';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.GPT_API_KEY || process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

function getApiKey() {
  const provider = detectProvider();
  if (provider === 'huggingface') return process.env.HF_TOKEN;
  if (provider === 'gemini') return process.env.GEMINI_API_KEY;
  return process.env.GPT_API_KEY || process.env.OPENAI_API_KEY;
}

// ========== PROVIDER CONFIGS ==========

const PROVIDERS = {
  huggingface: {
    model: 'intfloat/multilingual-e5-large',
    dims: 1024,
    maxInput: 512,   // tokens (not chars) — E5 context window
    batchSize: 32,   // HF Inference API batch limit
    endpoint: 'https://router.huggingface.co/hf-inference/models/intfloat/multilingual-e5-large/pipeline/feature-extraction',
  },
  gemini: {
    model: 'gemini-embedding-001',
    dims: 3072,
    maxInput: 8000,
    batchSize: 100,
  },
  openai: {
    model: 'text-embedding-3-small',
    dims: 1536,
    maxInput: 8000,
    batchSize: 100,
  },
};

// Export the active dimensions (used by legal-corpus.js for table creation)
// Default 1024 (multilingual-e5-large) — safest fallback for new installs
function getEmbedDims() {
  const provider = detectProvider();
  return provider ? PROVIDERS[provider].dims : 1024;
}

const EMBED_MODEL = () => {
  const p = detectProvider();
  return p ? PROVIDERS[p].model : 'unknown';
};

// ========== HUGGINGFACE EMBEDDINGS (multilingual-e5-large) ==========

/**
 * E5 models require a task prefix:
 *   "query: "   — for search queries (retrieval_query)
 *   "passage: " — for documents being indexed (retrieval_document)
 */
function addE5Prefix(text, isQuery = false) {
  const prefix = isQuery ? 'query: ' : 'passage: ';
  // Trim to rough token limit (4 chars ≈ 1 token, 512 tokens max)
  const maxChars = PROVIDERS.huggingface.maxInput * 4;
  return prefix + text.substring(0, maxChars);
}

async function hfEmbed(texts, apiKey, isQuery = false) {
  const inputs = texts.map(t => addE5Prefix(t, isQuery));

  console.log(`[EMBEDDINGS] HF request: token=${apiKey ? apiKey.substring(0, 8) + '...' : 'MISSING'}, texts=${texts.length}`);

  // Retry transient failures (network resets, 5xx, rate limits) with exponential
  // backoff so a single blip doesn't lose a whole document during long ingests.
  const MAX_ATTEMPTS = 5;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let resp;
    try {
      // router.huggingface.co uses plain { inputs } — no options wrapper
      resp = await httpsPostJson(
        PROVIDERS.huggingface.endpoint,
        { inputs },
        { 'Authorization': `Bearer ${apiKey}` }
      );
    } catch (err) {
      // Network-level errors (ECONNRESET, ETIMEDOUT, socket hang up) throw here.
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        const wait = 2000 * Math.pow(2, attempt - 1); // 2s, 4s, 8s, 16s
        console.warn(`[EMBEDDINGS] HF network error (${err.message}), retry ${attempt}/${MAX_ATTEMPTS - 1} in ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw lastErr;
    }

    if (resp.status === 200) {
      const data = resp.body;
      // router returns: array of embeddings (each embedding is a float array)
      // Some models return nested arrays [[emb1], [emb2]] — flatten one level if needed
      if (!Array.isArray(data)) {
        throw new Error('HuggingFace: unexpected response format');
      }
      return Array.isArray(data[0]) ? data : data.map(d => Array.isArray(d) ? d : d.embedding || d);
    }

    // 503 = model loading; 429 = rate limit; 5xx = transient server error — all retriable.
    if ((resp.status === 503 || resp.status === 429 || resp.status >= 500) && attempt < MAX_ATTEMPTS) {
      const wait = resp.status === 503 ? 20_000 : 2000 * Math.pow(2, attempt - 1);
      console.warn(`[EMBEDDINGS] HF ${resp.status}, retry ${attempt}/${MAX_ATTEMPTS - 1} in ${wait / 1000}s...`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }

    throw new Error(`HuggingFace Embedding API ${resp.status}: ${(resp.text || '').substring(0, 200)}`);
  }

  throw lastErr || new Error('HuggingFace: exhausted retries');
}

// ========== GEMINI EMBEDDINGS ==========

async function geminiEmbed(texts, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${PROVIDERS.gemini.model}:batchEmbedContents?key=${apiKey}`;

  const requests = texts.map(text => ({
    model: `models/${PROVIDERS.gemini.model}`,
    content: { parts: [{ text }] },
    taskType: 'RETRIEVAL_DOCUMENT'
  }));

  const resp = await httpsPostJson(url, { requests });

  if (resp.status !== 200) {
    throw new Error(`Gemini Embedding API ${resp.status}: ${(resp.text || '').substring(0, 200)}`);
  }

  return resp.body.embeddings.map(e => e.values);
}

async function geminiEmbedQuery(text, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${PROVIDERS.gemini.model}:embedContent?key=${apiKey}`;

  const resp = await httpsPostJson(url, {
    model: `models/${PROVIDERS.gemini.model}`,
    content: { parts: [{ text }] },
    taskType: 'RETRIEVAL_QUERY'
  });

  if (resp.status !== 200) {
    throw new Error(`Gemini Embedding API ${resp.status}: ${(resp.text || '').substring(0, 200)}`);
  }

  return resp.body.embedding.values;
}

// ========== OPENAI EMBEDDINGS ==========

async function openaiEmbed(texts, apiKey) {
  const inputs = texts.map(t => t.substring(0, PROVIDERS.openai.maxInput));

  const resp = await httpsPostJson(
    'https://api.openai.com/v1/embeddings',
    { model: PROVIDERS.openai.model, input: inputs },
    { 'Authorization': `Bearer ${apiKey}` }
  );

  if (resp.status !== 200) {
    throw new Error(`OpenAI Embedding API ${resp.status}: ${(resp.text || '').substring(0, 200)}`);
  }

  const sorted = resp.body.data.sort((a, b) => a.index - b.index);
  return sorted.map(d => d.embedding);
}

async function openaiEmbedQuery(text, apiKey) {
  const results = await openaiEmbed([text], apiKey);
  return results[0];
}

// ========== PUBLIC API ==========

/**
 * Get embedding for a single text (query-time).
 * Uses appropriate task prefix per provider.
 */
async function getEmbedding(text, apiKey) {
  const key = apiKey || getApiKey();
  if (!key) throw new Error('No API key for embeddings (set HF_TOKEN, GEMINI_API_KEY, or GPT_API_KEY)');
  if (!text || text.trim().length === 0) throw new Error('Empty text cannot be embedded');

  // Normalize Uzbek apostrophe variants before embedding so that o'zbek,
  // oʻzbek, o`zbek etc. all produce the same vector. Matches the BM25
  // normalization already applied in search-utils.js, keeping retrieval
  // consistent across the hybrid pipeline.
  text = text.normalize('NFKC').replace(UZBEK_APOSTROPHE_RX, '$1');

  const provider = detectProvider();
  if (!provider) throw new Error('No embedding provider configured (set HF_TOKEN, GEMINI_API_KEY, or GPT_API_KEY)');

  if (provider === 'huggingface') {
    const results = await hfEmbed([text], key, true /* isQuery */);
    return results[0];
  } else if (provider === 'gemini') {
    return geminiEmbedQuery(text.substring(0, PROVIDERS.gemini.maxInput), key);
  } else {
    return openaiEmbedQuery(text.substring(0, PROVIDERS.openai.maxInput), key);
  }
}

/**
 * Get embeddings for multiple texts in batch (ingestion).
 * Uses document/passage prefix for indexing.
 */
async function getEmbeddingsBatch(texts, apiKey, opts = {}) {
  const { signal } = opts;
  const key = apiKey || getApiKey();
  if (!key) throw new Error('No API key for embeddings (set HF_TOKEN, GEMINI_API_KEY, or GPT_API_KEY)');
  if (!texts || texts.length === 0) return [];

  // Same apostrophe normalization as getEmbedding — must be identical so
  // query vectors and corpus vectors are in the same space.
  texts = texts.map(t => (t || '').normalize('NFKC').replace(UZBEK_APOSTROPHE_RX, '$1'));

  const provider = detectProvider();
  if (!provider) throw new Error('No embedding provider configured (set HF_TOKEN, GEMINI_API_KEY, or GPT_API_KEY)');
  const config = PROVIDERS[provider];
  const BATCH_SIZE = config.batchSize;
  const allEmbeddings = [];

  console.log(`[EMBEDDINGS] Using ${provider} (${config.model}, ${config.dims}d)`);

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    // Cancellation point: if the caller aborted (e.g. Master-Admin clicked
    // "Bekor qilish" on the queue), stop between batches instead of embedding
    // every remaining chunk of a large codex.
    if (signal && signal.aborted) {
      const e = new Error('Embedding aborted by user');
      e.name = 'AbortError';
      throw e;
    }
    // Preserve 1:1 alignment with the input: do NOT drop empty strings, or the
    // returned array would be shorter than `texts` and the caller's
    // `chunks[i].embedding = embeddings[i]` would misalign (trailing chunks
    // silently get undefined → stored as NULL). Replace blanks with a single
    // space so the provider still returns one vector per input.
    const batch = texts.slice(i, i + BATCH_SIZE).map(t => {
      const trimmed = (t || '').trim();
      return trimmed.length > 0 ? trimmed : ' ';
    });

    let embeddings;
    if (provider === 'huggingface') {
      embeddings = await hfEmbed(batch, key, false /* isQuery=passage */);
    } else if (provider === 'gemini') {
      embeddings = await geminiEmbed(batch.map(t => t.substring(0, config.maxInput)), key);
    } else {
      embeddings = await openaiEmbed(batch.map(t => t.substring(0, config.maxInput)), key);
    }

    if (!Array.isArray(embeddings) || embeddings.length !== batch.length) {
      throw new Error(
        `[EMBEDDINGS] Provider ${provider} returned ${Array.isArray(embeddings) ? embeddings.length : 'non-array'} ` +
        `embeddings for a batch of ${batch.length}. Refusing to continue with misaligned vectors.`
      );
    }

    allEmbeddings.push(...embeddings);

    // Rate limiting between batches
    if (i + BATCH_SIZE < texts.length) {
      const delay = provider === 'huggingface' ? 500 : provider === 'gemini' ? 100 : 200;
      await new Promise(r => setTimeout(r, delay));
    }

    console.log(`[EMBEDDINGS] Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(texts.length / BATCH_SIZE)} done (${allEmbeddings.length}/${texts.length})`);
  }

  if (allEmbeddings.length !== texts.length) {
    throw new Error(`[EMBEDDINGS] Got ${allEmbeddings.length} embeddings for ${texts.length} texts — alignment broken.`);
  }

  return allEmbeddings;
}

module.exports = {
  getEmbedding,
  getEmbeddingsBatch,
  getEmbedDims,
  detectProvider,
  PROVIDERS,
  httpsPostJson,
  // Legacy compat
  get EMBED_MODEL() { return EMBED_MODEL(); },
  get EMBED_DIMS() { return getEmbedDims(); }
};
