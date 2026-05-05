'use strict';

/**
 * RAG Module — barrel export
 *
 * Usage in other parts of the app:
 *   const rag = require('./rag');
 *   await rag.initLegalCorpus();
 *   const results = await rag.hybridSearch(query, { category, apiKey });
 */

const { initLegalCorpus, insertChunks, deleteByDocId, hybridSearch, vectorSearch, getCorpusStats, rebuildVectorIndex } = require('./legal-corpus');
const { getEmbedding, getEmbeddingsBatch, getEmbedDims, detectProvider, EMBED_MODEL, EMBED_DIMS } = require('./embeddings');
const { chunkLegalDocument, parseDocument } = require('./chunker');
const { fetchLexDocument } = require('./fetch-lex');
const { LEX_REGISTRY, getLawsForCategory, getAllLaws } = require('./lex-registry');

// v2: Advanced structural chunker + parent-child retrieval
const { chunkLegalDocumentStructured, parseLexStructured } = require('./structural-chunker');
const { initAdvancedCorpus, parentChildSearch, saveToQaBank, findSimilarQA, formatQaFewShot } = require('./advanced-corpus');
const { buildAdvancedPrompt, formatAdvancedContext } = require('./system-prompt');
const { generateWordHtml, markdownToHtml } = require('./word-export');

module.exports = {
  // Corpus (table + retrieval)
  initLegalCorpus,
  insertChunks,
  deleteByDocId,
  hybridSearch,
  vectorSearch,
  getCorpusStats,
  rebuildVectorIndex,

  // Embeddings
  getEmbedding,
  getEmbeddingsBatch,
  getEmbedDims,
  detectProvider,
  EMBED_MODEL,
  EMBED_DIMS,

  // Chunker (legacy)
  chunkLegalDocument,
  parseDocument,

  // Chunker v2 (structural)
  chunkLegalDocumentStructured,
  parseLexStructured,

  // Advanced corpus (parent-child + QA bank)
  initAdvancedCorpus,
  parentChildSearch,
  saveToQaBank,
  findSimilarQA,
  formatQaFewShot,

  // System prompt
  buildAdvancedPrompt,
  formatAdvancedContext,

  // Word export
  generateWordHtml,
  markdownToHtml,

  // Fetcher
  fetchLexDocument,

  // Registry
  LEX_REGISTRY,
  getLawsForCategory,
  getAllLaws
};
