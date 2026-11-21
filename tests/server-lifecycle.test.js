'use strict';

/**
 * Boot, error handling and shutdown (audit C3, H1):
 *   - a failed boot migration stops the process instead of serving half the
 *     routes, unless BOOT_ALLOW_PARTIAL=true;
 *   - boot waits for the database before migrating;
 *   - uncaught route errors answer JSON without internals;
 *   - SIGTERM stops the polling bot, drains, closes the pool, exits.
 *
 *   node tests/server-lifecycle.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { jsonErrorHandler, waitForDatabase, installGracefulShutdown, SERVER_ERROR_MESSAGE } = require('../src/api/lifecycle');

const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
const quiet = { log() {}, warn() {}, error() {} };

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}
function fakeRes() {
  return { headersSent: false, statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

(async () => {
  console.log('server lifecycle');

  await test('a 5xx answers JSON with a generic message, never the stack', async () => {
    const res = fakeRes();
    const origError = console.error; console.error = () => {};
    jsonErrorHandler(new Error('db password is hunter2'), { method: 'GET', originalUrl: '/api/x?token=1' }, res, () => {});
    console.error = origError;
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.body.error, SERVER_ERROR_MESSAGE);
    assert.ok(!JSON.stringify(res.body).includes('hunter2'));
  });

  await test('a bad JSON body is a 400 with the parser message', async () => {
    const err = Object.assign(new SyntaxError('Unexpected token'), { status: 400, expose: true, type: 'entity.parse.failed' });
    const res = fakeRes();
    jsonErrorHandler(err, { method: 'POST', originalUrl: '/api/login' }, res, () => {});
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.error, 'Unexpected token');
  });

  await test('upload limits map to 413 / 400', async () => {
    const big = fakeRes();
    jsonErrorHandler(Object.assign(new Error('File too large'), { name: 'MulterError', code: 'LIMIT_FILE_SIZE' }), { method: 'POST' }, big, () => {});
    assert.strictEqual(big.statusCode, 413);
    const other = fakeRes();
    jsonErrorHandler(Object.assign(new Error('Unexpected field'), { name: 'MulterError', code: 'LIMIT_UNEXPECTED_FILE' }), { method: 'POST' }, other, () => {});
    assert.strictEqual(other.statusCode, 400);
  });

  await test('an error after headers went out is passed on, not answered twice', async () => {
    let passedOn = false;
    const res = Object.assign(fakeRes(), { headersSent: true });
    jsonErrorHandler(new Error('x'), { method: 'GET' }, res, () => { passedOn = true; });
    assert.ok(passedOn);
    assert.strictEqual(res.body, null);
  });

  await test('boot waits for the database and gives up after the last attempt', async () => {
    let calls = 0;
    await waitForDatabase({ query: async () => { if (++calls < 3) throw new Error('down'); } }, { attempts: 5, delayMs: 0, log: quiet });
    assert.strictEqual(calls, 3);
    calls = 0;
    await assert.rejects(waitForDatabase({ query: async () => { calls++; throw new Error('down'); } }, { attempts: 4, delayMs: 0, log: quiet }), /down/);
    assert.strictEqual(calls, 4);
  });

  await test('shutdown stops bots, closes the server and the pool, then exits 0', async () => {
    const order = [];
    let exitCode = null;
    const shutdown = installGracefulShutdown({
      server: { close(cb) { order.push('server'); cb(); } },
      pool: { end: async () => { order.push('pool'); } },
      stopBots: [async () => { order.push('bot'); }],
      exit: (c) => { exitCode = c; },
      log: quiet,
    });
    await shutdown('SIGTERM');
    assert.deepStrictEqual(order, ['bot', 'server', 'pool']);
    assert.strictEqual(exitCode, 0);
    process.removeAllListeners('SIGTERM'); process.removeAllListeners('SIGINT');
  });

  await test('shutdown is forced when connections never close', async () => {
    let exitCode = null;
    const shutdown = installGracefulShutdown({
      server: { close() { /* an SSE stream keeps it open */ } },
      pool: null, timeoutMs: 20, exit: (c) => { exitCode = c; }, log: quiet,
    });
    shutdown('SIGTERM');
    await new Promise(r => setTimeout(r, 60));
    assert.strictEqual(exitCode, 0);
    process.removeAllListeners('SIGTERM'); process.removeAllListeners('SIGINT');
  });

  // 2026-11-06: a deploy cut a long document answer after 25 s with nothing said ("Javob uzildi")
  const { trackStream, openStreamCount, shutdownWaitMs } = require('../src/api/lifecycle');
  const EventEmitter = require('events');
  const fakeStream = () => { const r = new EventEmitter(); r.ended = false; r.end = () => { r.ended = true; r.emit('finish'); }; return r; };

  await test('an open answer that ends in time is waited for and never told anything', async () => {
    const res = fakeStream(); let told = false, exitCode = null;
    trackStream(res, () => { told = true; });
    const order = [];
    const shutdown = installGracefulShutdown({
      server: { close() { order.push('server'); } }, pool: { end: async () => { order.push('pool'); } },
      beforeClose: [async () => { order.push('save'); }],
      timeoutMs: 2000, pollMs: 10, exit: (c) => { exitCode = c; }, log: quiet,
    });
    const done = shutdown('SIGTERM');
    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(exitCode, null, 'still waiting for the answer');
    res.end();
    await done;
    assert.strictEqual(told, false);
    assert.strictEqual(exitCode, 0);
    assert.deepStrictEqual(order, ['save', 'server', 'pool'], 'what lives in memory is saved before the server closes');
    assert.strictEqual(openStreamCount(), 0);
    process.removeAllListeners('SIGTERM'); process.removeAllListeners('SIGINT');
  });

  await test('an answer still open at the end is told why, before the exit', async () => {
    const res = fakeStream(); const seq = []; let exitCode = null;
    trackStream(res, () => { seq.push('told'); res.end(); });
    const shutdown = installGracefulShutdown({ server: { close() {} }, pool: null, timeoutMs: 1700, pollMs: 10,
      exit: (c) => { seq.push('exit'); exitCode = c; }, log: quiet });
    const t0 = Date.now();
    await shutdown('SIGTERM');
    assert.deepStrictEqual(seq, ['told', 'exit']);
    assert.strictEqual(exitCode, 0);
    assert.ok(Date.now() - t0 < 1700, 'before the forced exit');
    process.removeAllListeners('SIGTERM'); process.removeAllListeners('SIGINT');
  });

  await test('an endless feed (wait: false) is ended at once and does not hold the shutdown', async () => {
    const feed = fakeStream(); let exitCode = null;
    trackStream(feed, null, { wait: false });
    const shutdown = installGracefulShutdown({ server: { close(cb) { cb(); } }, pool: null, timeoutMs: 5000, pollMs: 10,
      exit: (c) => { exitCode = c; }, log: quiet });
    const t0 = Date.now();
    await shutdown('SIGTERM');
    assert.ok(feed.ended);
    assert.strictEqual(exitCode, 0);
    assert.ok(Date.now() - t0 < 1000, 'no waiting for a stream that never ends');
    process.removeAllListeners('SIGTERM'); process.removeAllListeners('SIGINT');
  });

  await test('SHUTDOWN_WAIT_MS: 25 s by default, kept within 5 s - 290 s', () => {
    assert.strictEqual(shutdownWaitMs({}), 25000);
    assert.strictEqual(shutdownWaitMs({ SHUTDOWN_WAIT_MS: '280000' }), 280000);
    assert.strictEqual(shutdownWaitMs({ SHUTDOWN_WAIT_MS: '1000' }), 5000);
    assert.strictEqual(shutdownWaitMs({ SHUTDOWN_WAIT_MS: '999999' }), 290000);
    assert.strictEqual(shutdownWaitMs({ SHUTDOWN_WAIT_MS: 'x' }), 25000);
  });

  await test('wiring: the chat stream is tracked, told SERVER_RESTART with its units released; the editor saves first', () => {
    assert.ok(/require\('\.\/lifecycle'\)\.trackStream\(res, \(\) => \{[\s\S]{0,200}tariffModule\.refundUsage\(res, 'server_restart'\)[\s\S]{0,200}code: 'SERVER_RESTART'[\s\S]{0,160}refund\.quotaRefunded \? ' — limit qaytarildi\.'/.test(server));
    assert.ok(server.includes("require('./lifecycle').trackStream(res, null, { wait: false });"), 'the staff event feed');
    assert.ok(/beforeClose: \[async \(\) => \{ if \(editorHub\) await editorHub\.shutdown\(\); \}\]/.test(server));
    const live = fs.readFileSync(path.join(__dirname, '..', 'src', 'editor', 'live.js'), 'utf8');
    assert.ok(/async shutdown\(\) \{[\s\S]{0,200}await Promise\.all\(list\.map\(r => save\(r\)\)\);[\s\S]{0,200}ws\.close\(1012, 'restart'\)/.test(live));
  });

  await test('the editor hub saves every open document, then closes its sockets with 1012', async () => {
    const { createHub } = require('../src/editor/live');
    const saved = [];
    const hub = createHub({ store: { saveLiveState: async (id) => { saved.push(id); } }, log: quiet });
    const Y = require('yjs');
    const closed = [];
    const ws = { close: (code) => closed.push(code) };
    hub._rooms.set('d1', { id: 'd1', seeded: true, timer: null, doc: new Y.Doc(), conns: new Map([[ws, {}]]) });
    hub._rooms.set('d2', { id: 'd2', seeded: false, timer: null, doc: new Y.Doc(), conns: new Map() });
    assert.strictEqual(await hub.shutdown(), 2);
    assert.deepStrictEqual(saved, ['d1'], 'only a seeded room has state to save');
    assert.deepStrictEqual(closed, [1012]);
  });

  await test('server wiring: strict boot, error handler after routes, shutdown installed', () => {
    assert.ok(/if \(err\.workspaceMigrationFatal \|\| process\.env\.BOOT_ALLOW_PARTIAL !== 'true'\) throw err;/.test(server),
      'a migration failure stops boot');
    assert.ok(/lifecycle\.waitForDatabase\(pool\)\s*\.then\(\(\) => runMigrations\(\)\)/.test(server));
    assert.ok(/app\.use\(lifecycle\.jsonErrorHandler\);\s*const server = app\.listen\(/.test(server));
    assert.ok(/lifecycle\.installGracefulShutdown\(\{/.test(server));
    assert.ok(/setTimeout\(\(\) => process\.exit\(1\), 200\)/.test(server), 'failed boot really exits');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
