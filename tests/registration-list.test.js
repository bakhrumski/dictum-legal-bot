'use strict';

/**
 * The master's registration list never loads applicants' documents or
 * password hashes, and is bounded (audit H7).
 *
 *   node tests/registration-list.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
const start = server.indexOf("app.get('/api/registration-requests', requireMasterAdmin");
const handler = server.slice(start, server.indexOf('\n});', start)).replace(/^\s*\/\/.*$/gm, '');

assert.ok(start > 0, 'route found');
assert.ok(!/SELECT rr\.\*/.test(handler), 'no SELECT rr.* (it pulled every base64 document into memory)');
assert.ok(/column_name NOT IN \('document_base64', 'password_hash'\)/.test(handler), 'document and hash columns are not selected');
assert.ok(/\(rr\.document_base64 IS NOT NULL\) AS has_document_base64/.test(handler), 'the flag is computed in SQL');
assert.ok(/LIMIT 500/.test(handler), 'the list is bounded');
console.log('  ✓ registration list selects no documents or hashes and is bounded\n\n1 passed, 0 failed');
