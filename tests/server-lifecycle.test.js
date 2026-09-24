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
