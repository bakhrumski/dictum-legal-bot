'use strict';

/**
 * Telegram files (Astra audit S1, S2): the bot token never reaches the
 * browser, and a file opens only for staff who may open its request.
 *
 *   node tests/file-routes.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
const route = (sig) => { const i = server.indexOf(sig); assert.ok(i > 0, sig); return server.slice(i, server.indexOf('\n});', i)); };

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

console.log('file routes');

test('no route sends a Telegram file URL (it contains the bot token) to the client', () => {
  // Every getFileLink result must be consumed server-side, never put in a response.
  assert.ok(!/const fileLink = await bot\.getFileLink\([^)]*\);\s*(return )?res\.json\(\{ fileLink \}\)/.test(server));
  assert.ok(/fileLink: `\/api\/files\/\$\{encodeURIComponent\(fileId\)\}\/raw`/.test(server));
  assert.ok(/fileLink: `\/api\/registration-document\/\$\{encodeURIComponent\(fileId\)\}\/raw`/.test(server));
});

test('view, raw and download all check that the caller may open the request', () => {
  for (const sig of ["app.get('/api/files/:fileId', requireStaff", "app.get('/api/files/:fileId/raw', requireStaff", "app.get('/api/files/:fileId/download', requireStaff"]) {
    assert.ok(/if \(!\(await canAccessFile\(req, fileId\)\)\) return res\.status\(404\)/.test(route(sig)), sig);
  }
  const helper = server.slice(server.indexOf('async function canAccessFile'), server.indexOf('async function canAccessFile') + 900);
  assert.ok(/r\.file_id = \$1/.test(helper) && /r\.assigned_to = \$2/.test(helper) && /request_students/.test(helper));
});

test('streamed files can only be media or PDF, never a page', () => {
  assert.ok(/INLINE_SAFE_TYPE = \/\^\(image\\\/\(png\|jpe\?g\|webp\|gif\)/.test(server));
  assert.ok(!/image\\\/svg/.test(server.slice(server.indexOf('const INLINE_SAFE_TYPE'), server.indexOf('const INLINE_SAFE_TYPE') + 200)));
  assert.ok(/X-Content-Type-Options', 'nosniff'/.test(server));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
