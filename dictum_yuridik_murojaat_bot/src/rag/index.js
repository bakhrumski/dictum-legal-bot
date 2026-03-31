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

  // Chunker
  chunkLegalDocument,
  parseDocument,

  // Fetcher
  fetchLexDocument,

  // Registry
  LEX_REGISTRY,
  getLawsForCategory,
  getAllLaws
};
