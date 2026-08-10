'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');
const fs = require('fs');

// Load pure matching helpers without opening a database connection.
const modulePath = require.resolve('../src/services/legal-marketplace');
const source = fs.readFileSync(modulePath, 'utf8');
const loaded = new Module(modulePath);
loaded.filename = modulePath;
loaded.paths = Module._nodeModulePaths(path.dirname(modulePath));
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '../database/db') return { pool: { query: async () => ({ rows: [] }) } };
  return originalRequire.apply(this, arguments);
};
loaded._compile(source, modulePath);
Module.prototype.require = originalRequire;

const { rankAttorney, publicAttorney } = loaded.exports;

const base = {
  id: 1,
  full_name: 'Test Attorney',
  license_status: 'active',
  is_published: true,
  is_accepting_requests: true,
  region: 'Toshkent',
  languages: ['uz', 'ru'],
  average_response_minutes: 60,
  practice_areas: [{ slug: 'labor', name_uz: 'Mehnat huquqi' }],
};

const matched = rankAttorney(base, { legalField: 'Mehnat huquqi', region: 'Toshkent', language: 'uz' });
assert.ok(matched, 'active published attorney should be eligible');
assert.ok(matched.match_score >= 70, `expected a strong explainable match, got ${matched.match_score}`);
assert.ok(matched.match_reasons.includes('soha mos keladi'));
assert.ok(matched.match_reasons.includes('hudud mos keladi'));
assert.ok(matched.match_reasons.includes('til mos keladi'));

assert.strictEqual(rankAttorney({ ...base, license_status: 'pending' }, {}), null, 'unverified profiles must never be recommended');
assert.strictEqual(rankAttorney({ ...base, is_published: false }, {}), null, 'private profiles must never be recommended');

const weaker = rankAttorney({ ...base, region: 'Samarqand', languages: ['ru'] }, { legalField: 'Mehnat huquqi', region: 'Toshkent', language: 'uz' });
assert.ok(weaker.match_score < matched.match_score, 'region and language matches must improve rank');

const publicProfile = publicAttorney({ ...base, contact_phone: '+998 90 000-00-00', contact_ref: 'eadvokat:7' });
assert.strictEqual(publicProfile.contact_phone, undefined, 'public matching results must never contain the phone');
assert.strictEqual(publicProfile.contact_ref, 'eadvokat:7', 'the opaque consent reference must remain available');

console.log('legal-marketplace: all tests passed');
