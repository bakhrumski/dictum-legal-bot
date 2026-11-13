'use strict';

/**
 * 2026-11-05 (owner: a document analysis ended in "Javob uzildi"; one tap must
 * retry without uploading the document or typing the request again):
 *   - the web chat's stream sends a heartbeat while slow steps send nothing;
 *   - a failed answer (cut stream, network, 5xx) gets "Qayta urinish": the same
 *     message, the chat's documents and the cost already confirmed;
 *   - a document service whose stream was cut before its first word is not
 *     charged (commitUsage settles it as an empty text);
 *   - the user's bubble keeps the file chip and its own text apart.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const server = read('src/api/server.js');
assert.ok(/const beat = setInterval\(\(\) => \{ try \{ if \(!res\.writableEnded\) res\.write\(': ping\\n\\n'\); \} catch \(_\) \{\} \}, 15000\);/.test(server), 'heartbeat');
assert.ok(server.includes("res.on('close', () => clearInterval(beat));"));

const chat = read('public/app/chat.js');
assert.ok(/function retryBtn\(a, msg, shown, confirmedJob\)/.test(chat));
assert.strictEqual((chat.match(/retryBtn\(a, msg, shown, confirmedJob\);/g) || []).length, 4, 'network, gateway, a cut stream and an answer the claim guard emptied (X5)');
assert.ok(chat.includes("C.history.push({ role: 'user', text: msg });\n        ask(msg, shown, confirmedJob);"));
assert.ok(chat.includes('b.lastElementChild.textContent = text;') && !chat.includes("$('span:last-child', b).textContent = text"));
for (const l of ['uz', 'ru', 'en']) assert.ok(/'err\.retry':'[^']+'/.test(read('public/app/i18n.js')), l);

const tiers = read('src/rag/subscription-tiers.js');
assert.ok(tiers.includes("settleSections(typeof text === 'string' ? text : '', sectionJobs.map(t => t.service))"));
const docJob = require('../src/rag/document-job');
assert.deepStrictEqual(docJob.settleSections('', ['analysis']), { analysis: 'not_delivered' });

console.log('chat retry: heartbeat, one-tap retry with the same documents, no charge for nothing delivered');
