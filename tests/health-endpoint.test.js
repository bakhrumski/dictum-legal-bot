'use strict';

// The public health endpoint must say only whether the service is up. It
// used to expose the HF token's first characters, raw database errors and
// corpus statistics to anyone, and aggregate legal_chunks on every call.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
const embeddings = fs.readFileSync(path.join(__dirname, '..', 'src', 'rag', 'embeddings.js'), 'utf8');

function routeBody(signature) {
  const start = server.indexOf(signature);
  assert.ok(start >= 0, `${signature} not found`);
  return server.slice(start, server.indexOf('\n});\n', start));
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n      ${e.message}`); }
}

console.log('\nhealth — public liveness only\n');

test('public /api/health reveals no token, error text or corpus data', () => {
  const body = routeBody("app.get('/api/health'");
  for (const leak of ['HF_TOKEN', 'substring(0, 8)', 'e.message', 'legal_chunks', 'process.version', 'memoryUsage']) {
    assert.ok(!body.includes(leak), `public health still uses ${leak}`);
  }
  assert.ok(body.includes("pool.query('SELECT 1')"), 'public health should probe the database cheaply');
});

test('corpus detail is master-only', () => {
  const body = routeBody("app.get('/api/admin/health'");
  assert.ok(/app\.get\('\/api\/admin\/health', requireMasterAdmin,/.test(body));
  assert.ok(body.includes('legal_chunks'));
  assert.ok(!body.includes('substring(0, 8)'), 'no token prefix even for the master');
});

test('no token prefix is written to the logs by the embeddings client', () => {
  assert.ok(!/apiKey\.substring\(0, 8\)/.test(embeddings));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exitCode = 1;
