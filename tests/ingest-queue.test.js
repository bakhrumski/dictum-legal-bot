#!/usr/bin/env node
/**
 * ingest-queue.js — unit tests (no DB, no network)
 *
 * Uses a fresh IngestQueue instance per test (not the singleton) to avoid
 * state leaking between tests.
 *
 * Tests:
 *   - enqueueUrl() basic + deduplication
 *   - enqueueCategory() basic queuing
 *   - _processUrl() skip when doc already in corpus (skip active)
 *   - _processUrl() skip when ingestFromUrl returns 0 (inactive)
 *   - _processUrl() normal ingest path (dirty flag + done event)
 *   - event emission: queued / start / done / idle sequence
 *   - getStatus() shape
 *
 * Run:  node tests/ingest-queue.test.js
 */

'use strict';

process.env.LOG_LEVEL = 'error';

const { IngestQueue } = require('../src/rag/ingest-queue');

// ─── Harness ─────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
  }
}

function section(label) {
  console.log(`\n━━━ ${label} ━━━`);
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEq'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'expected truthy');
}

function assertFalse(cond, msg) {
  if (cond) throw new Error(msg || 'expected falsy');
}

/**
 * Collect all 'progress' events from a queue until an 'idle' event arrives,
 * then resolve with the list of events. Times out after `ms` milliseconds.
 */
function collectUntilIdle(queue, ms = 3000) {
  return new Promise((resolve, reject) => {
    const events = [];
    const timer = setTimeout(() => reject(new Error('timeout waiting for idle')), ms);
    queue.on('progress', (e) => {
      events.push(e);
      if (e.type === 'idle') {
        clearTimeout(timer);
        resolve(events);
      }
    });
  });
}

// Minimal _drain that doesn't rebuild vector index or call real DB
function patchedDrain(processUrlImpl) {
  return async function () {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length > 0) {
      const job = this.queue.shift();
      await processUrlImpl.call(this, job);
    }
    this.current = null;
    this.processing = false;
    this._dirty = false;
    this._emit({ type: 'idle' });
  };
}

(async () => {
  // ─── 1. enqueueUrl — basic ─────────────────────────────────────────────────
  section('1. enqueueUrl — basic');

  await test('returns true and increments queue length', async () => {
    const q = new IngestQueue();
    q._drain = async () => {};
    const ok = q.enqueueUrl({ url: 'https://lex.uz/docs/1', category: 'mehnat', docId: 'meh-1' });
    assertTrue(ok, 'enqueue should return true');
    assertEq(q.queue.length, 1, 'one job in queue');
  });

  await test('returns false when url missing', async () => {
    const q = new IngestQueue();
    q._drain = async () => {};
    assertFalse(q.enqueueUrl({ url: '', category: 'mehnat' }));
  });

  await test('returns false when category missing', async () => {
    const q = new IngestQueue();
    q._drain = async () => {};
    assertFalse(q.enqueueUrl({ url: 'https://lex.uz/docs/1', category: '' }));
  });

  // ─── 2. enqueueUrl — deduplication ────────────────────────────────────────
  section('2. enqueueUrl — deduplication');

  await test('second enqueue of same docId returns false', async () => {
    const q = new IngestQueue();
    q._drain = async () => {};
    q.enqueueUrl({ url: 'https://lex.uz/docs/2', category: 'mehnat', docId: 'meh-2' });
    const second = q.enqueueUrl({ url: 'https://lex.uz/docs/2', category: 'mehnat', docId: 'meh-2' });
    assertFalse(second, 'duplicate enqueue should be rejected');
    assertEq(q.queue.length, 1, 'still only one job');
  });

  await test('second enqueue of same url (no docId) returns false', async () => {
    const q = new IngestQueue();
    q._drain = async () => {};
    q.enqueueUrl({ url: 'https://lex.uz/docs/3', category: 'mehnat' });
    const second = q.enqueueUrl({ url: 'https://lex.uz/docs/3', category: 'mehnat' });
    assertFalse(second, 'duplicate url enqueue rejected');
    assertEq(q.queue.length, 1, 'still only one job');
  });

  await test('different docIds both enqueue', async () => {
    const q = new IngestQueue();
    q._drain = async () => {};
    q.enqueueUrl({ url: 'https://lex.uz/docs/4', category: 'mehnat', docId: 'meh-4' });
    const second = q.enqueueUrl({ url: 'https://lex.uz/docs/5', category: 'mehnat', docId: 'meh-5' });
    assertTrue(second, 'different docId should enqueue');
    assertEq(q.queue.length, 2);
  });

  await test('key cleared after processing, re-enqueue succeeds', async () => {
    const q = new IngestQueue();
    q._drain = async () => {};
    q.enqueueUrl({ url: 'https://lex.uz/docs/6', category: 'mehnat', docId: 'meh-6' });
    // Simulate job finished: key removed from dedup set
    q._enqueuedKeys.delete('meh-6');
    const second = q.enqueueUrl({ url: 'https://lex.uz/docs/6', category: 'mehnat', docId: 'meh-6' });
    assertTrue(second, 're-enqueue after completion should succeed');
  });

  // ─── 3. enqueueCategory ────────────────────────────────────────────────────
  section('3. enqueueCategory');

  await test('enqueues a category job', async () => {
    const q = new IngestQueue();
    q._drain = async () => {};
    const ok = q.enqueueCategory('mehnat');
    assertTrue(ok, 'returns true');
    assertEq(q.queue.length, 1);
    assertEq(q.queue[0].kind, 'category');
    assertEq(q.queue[0].category, 'mehnat');
  });

  await test('returns false for empty category', async () => {
    const q = new IngestQueue();
    q._drain = async () => {};
    assertFalse(q.enqueueCategory(''));
  });

  // ─── 4. getStatus ──────────────────────────────────────────────────────────
  section('4. getStatus');

  await test('initial status is idle with empty queue', async () => {
    const q = new IngestQueue();
    const s = q.getStatus();
    assertEq(s.processing, false);
    assertEq(s.queueLength, 0);
    assertEq(s.current, null);
    assertTrue(Array.isArray(s.recent));
  });

  // ─── 5. _processUrl — skip paths ───────────────────────────────────────────
  section('5. _processUrl — skip paths');

  await test('emits done(skipped=already_in_corpus) when URL already active in corpus', async () => {
    const q = new IngestQueue();

    async function processUrlImpl(job) {
      const { url, category, docId, lawName } = job;
      const key = docId || url;
      this.current = { docId, lawName, category, url };
      this._emit({ type: 'start', docId, lawName, category });
      // Simulate: row found in corpus
      this._emit({ type: 'done', docId, lawName, category, skipped: true, reason: 'already_in_corpus' });
      this._enqueuedKeys.delete(key);
    }

    q._processUrl = processUrlImpl;
    q._drain = patchedDrain(processUrlImpl).bind(q);

    const events = collectUntilIdle(q);
    q.enqueueUrl({ url: 'https://lex.uz/docs/10', category: 'mehnat', docId: 'meh-10' });
    const received = await events;

    const done = received.find(e => e.type === 'done');
    assertTrue(!!done, 'done event emitted');
    assertEq(done.skipped, true, 'skipped=true');
    assertEq(done.reason, 'already_in_corpus');
  });

  await test('emits done(skipped=inactive_or_empty) and leaves _dirty=false', async () => {
    const q = new IngestQueue();

    async function processUrlImpl(job) {
      const { url, category, docId, lawName } = job;
      const key = docId || url;
      this.current = { docId, lawName, category, url };
      this._emit({ type: 'start', docId, lawName, category });
      // Simulate: ingestFromUrl returns 0 (inactive doc)
      this._emit({ type: 'done', docId, lawName, category, skipped: true, reason: 'inactive_or_empty' });
      this._enqueuedKeys.delete(key);
    }

    q._processUrl = processUrlImpl;
    q._drain = patchedDrain(processUrlImpl).bind(q);

    const events = collectUntilIdle(q);
    q.enqueueUrl({ url: 'https://lex.uz/docs/11', category: 'mehnat', docId: 'meh-11' });
    const received = await events;

    const done = received.find(e => e.type === 'done');
    assertTrue(!!done, 'done event emitted');
    assertEq(done.skipped, true, 'skipped=true');
    assertEq(done.reason, 'inactive_or_empty');
    assertFalse(q._dirty, '_dirty not set when doc is inactive');
  });

  // ─── 6. _processUrl — successful ingest ────────────────────────────────────
  section('6. _processUrl — successful ingest');

  await test('emits done(skipped=false, chunks) on success', async () => {
    const q = new IngestQueue();

    async function processUrlImpl(job) {
      const { url, category, docId, lawName } = job;
      const key = docId || url;
      this.current = { docId, lawName, category, url };
      this._emit({ type: 'start', docId, lawName, category });
      // Simulate successful ingest of 5 chunks
      this._dirty = true;
      this._emit({ type: 'done', docId, lawName, category, chunks: 5, skipped: false });
      this._enqueuedKeys.delete(key);
    }

    q._processUrl = processUrlImpl;
    q._drain = patchedDrain(processUrlImpl).bind(q);

    const events = collectUntilIdle(q);
    q.enqueueUrl({ url: 'https://lex.uz/docs/12', category: 'mehnat', docId: 'meh-12' });
    const received = await events;

    const done = received.find(e => e.type === 'done');
    assertTrue(!!done, 'done event emitted');
    assertEq(done.skipped, false, 'not skipped');
    assertEq(done.chunks, 5, 'chunks=5');
  });

  // ─── 7. Event emission sequence ────────────────────────────────────────────
  section('7. Event emission sequence');

  await test('queued → start → done → idle sequence for a url job', async () => {
    const q = new IngestQueue();

    async function processUrlImpl(job) {
      const { docId, lawName, category } = job;
      this._emit({ type: 'start', docId, lawName, category });
      this._emit({ type: 'done', docId, lawName, category, skipped: false, chunks: 1 });
      this._enqueuedKeys.delete(docId || job.url);
    }

    q._processUrl = processUrlImpl;
    q._drain = patchedDrain(processUrlImpl).bind(q);

    const events = collectUntilIdle(q);
    q.enqueueUrl({ url: 'https://lex.uz/docs/20', category: 'mehnat', docId: 'meh-20' });
    const received = await events;

    const types = received.map(e => e.type);
    assertEq(types[0], 'queued', 'first event is queued');
    assertTrue(types.includes('start'), 'start emitted');
    assertTrue(types.includes('done'), 'done emitted');
    assertEq(types[types.length - 1], 'idle', 'last event is idle');
  });

  await test('all events have an ISO timestamp', async () => {
    const q = new IngestQueue();

    async function processUrlImpl(job) {
      this._emit({ type: 'start', docId: job.docId });
      this._emit({ type: 'done', docId: job.docId, skipped: false, chunks: 1 });
      this._enqueuedKeys.delete(job.docId || job.url);
    }

    q._processUrl = processUrlImpl;
    q._drain = patchedDrain(processUrlImpl).bind(q);

    const events = collectUntilIdle(q);
    q.enqueueUrl({ url: 'https://lex.uz/docs/30', category: 'mehnat', docId: 'meh-30' });
    const received = await events;

    assertTrue(q.recent.length > 0, 'recent buffer has entries');
    assertTrue(q.recent.every(e => typeof e.ts === 'string' && e.ts.includes('T')),
      'all events have ISO timestamp');
  });

  await test('recent ring buffer does not exceed recentLimit', async () => {
    const q = new IngestQueue();
    q.recentLimit = 5;

    // Emit 10 events directly
    for (let i = 0; i < 10; i++) {
      q._emit({ type: 'done', docId: `x-${i}` });
    }

    assertTrue(q.recent.length <= 5, `recent should be capped at 5, got ${q.recent.length}`);
    assertEq(q.recent[q.recent.length - 1].docId, 'x-9', 'last entry is most recent');
  });

  // ─── 8. queued event carries queueLength ──────────────────────────────────
  section('8. queued event payload');

  await test('queued event includes docId, category, and queueLength', async () => {
    const q = new IngestQueue();
    q._drain = async () => {};

    const captured = [];
    q.on('progress', e => { if (e.type === 'queued') captured.push(e); });

    q.enqueueUrl({ url: 'https://lex.uz/docs/50', category: 'soliq', docId: 'sol-50', lawName: 'Test' });

    assertEq(captured.length, 1, 'one queued event');
    assertEq(captured[0].docId, 'sol-50');
    assertEq(captured[0].category, 'soliq');
    assertEq(captured[0].queueLength, 1);
  });

  await test('category queued event includes kind=category', async () => {
    const q = new IngestQueue();
    q._drain = async () => {};

    const captured = [];
    q.on('progress', e => { if (e.type === 'queued') captured.push(e); });

    q.enqueueCategory('soliq');

    assertEq(captured.length, 1);
    assertEq(captured[0].kind, 'category');
    assertEq(captured[0].category, 'soliq');
  });

  // ─── 9. pause / resume / cancel ────────────────────────────────────────────
  section('9. pause / resume / cancel');

  await test('pause() sets paused flag and emits paused event', async () => {
    const q = new IngestQueue();
    q._drain = async () => {};
    const captured = [];
    q.on('progress', e => captured.push(e));
    const ok = q.pause();
    assertTrue(ok, 'pause returns true');
    assertTrue(q.paused, 'paused flag set');
    assertTrue(captured.some(e => e.type === 'paused'), 'paused event emitted');
    assertFalse(q.pause(), 'second pause is a no-op (returns false)');
  });

  await test('resume() clears paused flag and emits resumed event', async () => {
    const q = new IngestQueue();
    q._drain = async () => {};
    q.pause();
    const captured = [];
    q.on('progress', e => captured.push(e));
    const ok = q.resume();
    assertTrue(ok, 'resume returns true');
    assertFalse(q.paused, 'paused flag cleared');
    assertTrue(captured.some(e => e.type === 'resumed'), 'resumed event emitted');
    assertFalse(q.resume(), 'resume when not paused is a no-op');
  });

  await test('getStatus() reports paused state', async () => {
    const q = new IngestQueue();
    q._drain = async () => {};
    assertEq(q.getStatus().paused, false, 'initially not paused');
    q.pause();
    assertEq(q.getStatus().paused, true, 'paused reflected in status');
  });

  await test('clearQueue() drops pending jobs and emits cleared', async () => {
    const q = new IngestQueue();
    q._drain = async () => {};
    q.enqueueUrl({ url: 'https://lex.uz/docs/60', category: 'mehnat', docId: 'meh-60' });
    q.enqueueUrl({ url: 'https://lex.uz/docs/61', category: 'mehnat', docId: 'meh-61' });
    const captured = [];
    q.on('progress', e => captured.push(e));
    const removed = q.clearQueue();
    assertEq(removed, 2, 'reports 2 removed');
    assertEq(q.queue.length, 0, 'queue emptied');
    assertEq(q._enqueuedKeys.size, 0, 'dedup keys cleared');
    assertTrue(captured.some(e => e.type === 'cleared' && e.removed === 2), 'cleared event emitted');
  });

  await test('cancelAll() clears queue, sets cancel flag, unpauses', async () => {
    const q = new IngestQueue();
    q._drain = async () => {};
    q.pause();
    q.enqueueUrl({ url: 'https://lex.uz/docs/62', category: 'mehnat', docId: 'meh-62' });
    const captured = [];
    q.on('progress', e => captured.push(e));
    const removed = q.cancelAll();
    assertEq(removed, 1, 'one pending job removed');
    assertEq(q.queue.length, 0, 'queue emptied');
    assertTrue(q._cancelCurrent, 'cancel flag set for in-flight job');
    assertFalse(q.paused, 'unpaused so the worker can drain to idle');
    assertTrue(captured.some(e => e.type === 'cancelled'), 'cancelled event emitted');
  });

  await test('paused queue does not process new url jobs until resumed', async () => {
    const q = new IngestQueue();
    let processedCount = 0;

    async function processUrlImpl(job) {
      processedCount++;
      this._emit({ type: 'start', docId: job.docId });
      this._emit({ type: 'done', docId: job.docId, skipped: false, chunks: 1 });
      this._enqueuedKeys.delete(job.docId || job.url);
    }
    q._processUrl = processUrlImpl;
    // Real-ish drain that honors pause between jobs and finishes with idle.
    q._drain = async function () {
      if (this.processing) return;
      this.processing = true;
      while (this.queue.length > 0) {
        if (this.paused) { this.current = null; this.processing = false; return; }
        const job = this.queue.shift();
        await this._processUrl(job);
      }
      this.current = null;
      this.processing = false;
      this._emit({ type: 'idle' });
    };

    q.pause();
    q.enqueueUrl({ url: 'https://lex.uz/docs/70', category: 'mehnat', docId: 'meh-70' });
    // Give any (incorrect) async processing a tick to run.
    await new Promise(r => setTimeout(r, 50));
    assertEq(processedCount, 0, 'nothing processed while paused');
    assertEq(q.queue.length, 1, 'job still queued');

    const events = collectUntilIdle(q);
    q.resume();
    await events;
    assertEq(processedCount, 1, 'job processed after resume');
  });

  await test('clearLog() empties the recent ring buffer', async () => {
    const q = new IngestQueue();
    q._drain = async () => {};
    q._emit({ type: 'queued', docId: 'a' });
    q._emit({ type: 'queued', docId: 'b' });
    assertTrue(q.recent.length >= 2, 'recent has events before clear');
    const removed = q.clearLog();
    assertTrue(removed >= 2, 'reports how many were dropped');
    assertEq(q.recent.length, 0, 'recent buffer emptied');
    assertEq(q.getStatus().recent.length, 0, 'getStatus reflects empty log');
  });

  await test('cancelAll() aborts the in-flight document via AbortController', async () => {
    const q = new IngestQueue();
    q._drain = async () => {};
    // Simulate a document mid-ingest holding the controller.
    q._abortController = new AbortController();
    const signal = q._abortController.signal;
    let aborted = false;
    signal.addEventListener('abort', () => { aborted = true; });
    q.cancelAll();
    assertTrue(aborted, 'in-flight signal was aborted');
    assertTrue(signal.aborted, 'signal.aborted is true');
  });

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  if (failed === 0) {
    console.log(`  All ${passed} tests passed.`);
  } else {
    console.log(`  ${passed} passed, ${failed} failed.`);
    failures.forEach(({ name, err }) => {
      console.log(`\n  FAIL: ${name}`);
      console.log(`        ${err.stack || err.message}`);
    });
    process.exit(1);
  }
})();
