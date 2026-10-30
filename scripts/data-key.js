#!/usr/bin/env node
'use strict';

/**
 * A new encryption-at-rest key (docs/design/shifrlash-1-bosqich.md §2).
 * Run locally; nothing is sent anywhere and nothing is written to disk.
 *
 *   node scripts/data-key.js v1          -> DATA_KEYS for a first key
 *   node scripts/data-key.js v2 '<old DATA_KEYS JSON>'   -> the ring with v2 added (rotation)
 *
 * Put the printed DATA_KEYS and DATA_KEY_ACTIVE into Render's environment and
 * keep an offline copy of DATA_KEYS (the owner): a lost key is lost data.
 */

const { newKey, loadKeyRing } = require('../src/privacy/crypto');

const id = String(process.argv[2] || 'v1').trim();
const ring = process.argv[3] ? JSON.parse(process.argv[3]) : {};
if (ring[id]) { console.error(`key "${id}" is already in the ring`); process.exit(1); }
ring[id] = newKey();
loadKeyRing({ DATA_KEYS: JSON.stringify(ring), DATA_KEY_ACTIVE: id }); // throws on a bad ring
console.log(`DATA_KEYS=${JSON.stringify(ring)}`);
console.log(`DATA_KEY_ACTIVE=${id}`);
