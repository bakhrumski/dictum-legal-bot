'use strict';

/**
 * Sequential Corpus Ingestion Queue
 *
 * One worker, FIFO — documents are processed strictly in order (per the
 * requirement "auto-update of ingested documents in order"). Emits progress
 * events that the Master-Admin dashboard subscribes to over SSE.
 *
 * Two job kinds:
 *   - 'url'      : ingest a single lex.uz document into a category
 *   - 'category' : re-check + re-ingest every document of a category, in order
 *
 * Used by:
 *   - auto-enrich (portal/services.js): a user's question cites an ACTIVE
 *     document not yet in the corpus → enqueue it so the corpus self-enriches.
 *   - Master-Admin "Yangilash" button (per category) → enqueue a category job.
 *
 * Events (via EventEmitter 'progress'):
 *   { type:'queued',   docId, lawName, category, queueLength }
 *   { type:'start',    docId, lawName, category }
 *   { type:'done',     docId, lawName, category, chunks, skipped, reason }
 *   { type:'error',    docId, lawName, category, error }
 *   { type:'category-start', category, total }
 *   { type:'category-done',  category, succeeded, failed }
 *   { type:'idle' }   // queue drained
 */

const EventEmitter = require('events');
const { pool } = require('../database/db');
const log = require('../utils/logger').createLogger('INGEST-QUEUE');

const REBUILD_INDEX_AFTER = 1; // rebuild vector index once the queue drains

class IngestQueue extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.processing = false;
    this.current = null;
    this.recent = [];           // ring buffer of recent events (for late subscribers)
    this.recentLimit = 50;
    this._enqueuedKeys = new Set(); // dedupe by docId|url while pending
    this._dirty = false;        // whether anything was ingested since last index rebuild
  }

  _emit(event) {
    const stamped = { ...event, ts: new Date().toISOString() };
    this.recent.push(stamped);
    if (this.recent.length > this.recentLimit) this.recent.shift();
    this.emit('progress', stamped);
  }

  getStatus() {
    return {
      processing: this.processing,
      current: this.current,
      queueLength: this.queue.length,
      recent: this.recent.slice(-20),
    };
  }

  /**
   * Enqueue a single lex.uz URL for ingestion into `category`.
   * Skips if the doc is already pending in the queue.
   */
  enqueueUrl({ url, category, docId = null, lawName = null, reason = 'auto', verifiedBy = null }) {
    if (!url || !category) return false;
    const key = docId || url;
    if (this._enqueuedKeys.has(key)) {
      log.debug('skip enqueue — already pending', { key });
      return false;
    }
    this._enqueuedKeys.add(key);
    this.queue.push({ kind: 'url', url, category, docId, lawName, reason, verifiedBy });
    this._emit({ type: 'queued', docId, lawName, category, reason, queueLength: this.queue.length });
    log.info('enqueued url', { url, category, reason });
    this._drain();
    return true;
  }

  /**
   * Enqueue a whole-category update: re-ingest every registered + already
   * ingested document of `category`, sequentially.
   */
  enqueueCategory(category, verifiedBy = null) {
    if (!category) return false;
    this.queue.push({ kind: 'category', category, verifiedBy });
    this._emit({ type: 'queued', category, kind: 'category', queueLength: this.queue.length });
    log.info('enqueued category', { category });
    this._drain();
    return true;
  }

  async _drain() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      try {
        if (job.kind === 'category') {
          await this._processCategory(job);
        } else {
          await this._processUrl(job);
        }
      } catch (err) {
        log.error('job failed', { job: job.kind, err: err.message });
      }
    }

    this.current = null;
    this.processing = false;

    if (this._dirty) {
      this._dirty = false;
      try {
        const { rebuildVectorIndex } = require('./legal-corpus');
        await rebuildVectorIndex();
        log.info('vector index rebuilt after queue drain');
      } catch (err) {
        log.warn('index rebuild failed', { err: err.message });
      }
    }

    this._emit({ type: 'idle' });
  }

  async _processUrl(job) {
    const { url, category, docId, lawName, verifiedBy } = job;
    const key = docId || url;
    this.current = { docId, lawName, category, url };
    this._emit({ type: 'start', docId, lawName, category });

    try {
      // Skip if this exact URL is already in the corpus and active.
      const existing = await pool.query(
        `SELECT 1 FROM legal_chunks
         WHERE source_url = $1 AND is_valid = TRUE AND (is_active IS NULL OR is_active = TRUE)
         LIMIT 1`,
        [url]
      );
      if (existing.rows.length > 0) {
        this._emit({ type: 'done', docId, lawName, category, skipped: true, reason: 'already_in_corpus' });
        return;
      }

      const { ingestFromUrl } = require('./ingest-lex');
      const inserted = await ingestFromUrl(url, { category, docId, lawName });

      if (inserted === 0) {
        // ingestFromUrl returns 0 when the document is inactive (repealed) —
        // requirement: do NOT ingest expired documents.
        this._emit({ type: 'done', docId, lawName, category, skipped: true, reason: 'inactive_or_empty' });
      } else {
        this._dirty = true;
        this._emit({ type: 'done', docId, lawName, category, chunks: inserted, skipped: false });
      }
    } catch (err) {
      this._emit({ type: 'error', docId, lawName, category, error: err.message });
    } finally {
      this._enqueuedKeys.delete(key);
    }
  }

  async _processCategory(job) {
    const { category, verifiedBy } = job;
    const laws = await this._categoryLaws(category);
    this._emit({ type: 'category-start', category, total: laws.length });

    let succeeded = 0;
    let failed = 0;

    for (const law of laws) {
      this.current = { docId: law.doc_id, lawName: law.law_name, category, url: law.lex_url };
      this._emit({ type: 'start', docId: law.doc_id, lawName: law.law_name, category });
      try {
        const { ingestFromUrl } = require('./ingest-lex');
        const inserted = await ingestFromUrl(law.lex_url, {
          category, docId: law.doc_id, lawName: law.law_name,
        });
        if (inserted === 0) {
          this._emit({ type: 'done', docId: law.doc_id, lawName: law.law_name, category, skipped: true, reason: 'inactive_or_empty' });
        } else {
          this._dirty = true;
          succeeded++;
          this._emit({ type: 'done', docId: law.doc_id, lawName: law.law_name, category, chunks: inserted, skipped: false });
        }
      } catch (err) {
        failed++;
        this._emit({ type: 'error', docId: law.doc_id, lawName: law.law_name, category, error: err.message });
      }
      // Gentle rate-limit between lex.uz fetches
      await new Promise(r => setTimeout(r, 1500));
    }

    this._emit({ type: 'category-done', category, succeeded, failed });
  }

  /**
   * Resolve the list of documents to (re-)ingest for a category: union of the
   * registry entries and anything already ingested under that category.
   */
  async _categoryLaws(category) {
    const { getLawsForCategory, getAllLaws } = require('./lex-registry');
    const registry = getLawsForCategory(category).map(l => ({ ...l, category }));
    const byDocId = new Map(registry.map(l => [l.doc_id, l]));

    // Add anything already in the DB under this category that the registry misses.
    try {
      const { rows } = await pool.query(
        `SELECT DISTINCT doc_id, source_url, law_name FROM legal_chunks
         WHERE category = $1 AND doc_id IS NOT NULL AND source_url IS NOT NULL`,
        [category]
      );
      const regByDocId = new Map(getAllLaws().map(l => [l.doc_id, l]));
      for (const r of rows) {
        if (byDocId.has(r.doc_id)) continue;
        const reg = regByDocId.get(r.doc_id) || {};
        byDocId.set(r.doc_id, {
          doc_id: r.doc_id,
          law_name: r.law_name || reg.law_name || r.doc_id,
          lex_url: reg.lex_url || r.source_url,
          category,
        });
      }
    } catch (err) {
      log.warn('category DB lookup failed', { category, err: err.message });
    }

    return Array.from(byDocId.values()).filter(l => l.lex_url);
  }
}

// Singleton — one queue per process.
const ingestQueue = new IngestQueue();

module.exports = { ingestQueue, IngestQueue };
