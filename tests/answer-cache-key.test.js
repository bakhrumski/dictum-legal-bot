'use strict';

/**
 * The legal-chat answer cache is keyed on the corpus revision and the
 * prompt-policy versions (Astra audit RAG2): an ingested, repealed or
 * corrected law retires cached answers at once, not after 72 hours. The
 * revision itself is bumped by a trigger on legal_chunks (migration 003).
 *
 *   node tests/answer-cache-key.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
const trigger = fs.readFileSync(path.join(__dirname, '..', 'migrations', '20260822_003_workspace_corpus_revision.sql'), 'utf8');

const block = server.slice(server.indexOf('const cacheKey = cacheable'), server.indexOf('const cacheKey = cacheable') + 900);
assert.ok(/'\|rev:' \+ \(await corpusRevisionForCache\(\)\)/.test(block), 'revision in the key');
assert.ok(/'\|policy:' \+ JSON\.stringify\(getLegalPolicyVersions\(\)\)/.test(block), 'policy versions in the key');
assert.ok(/SELECT revision FROM juristai_private\.legal_corpus_state WHERE singleton = true/.test(server));
assert.ok(/Date\.now\(\) - corpusRevisionCache\.at < 60000/.test(server), 'read at most once a minute');
assert.ok(/legal_chunks/.test(trigger) && /revision/.test(trigger), 'legal_chunks changes bump the revision');
console.log('  ✓ answer cache key follows corpus revision and prompt policy\n\n1 passed, 0 failed');
