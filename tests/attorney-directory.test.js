'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'attorneys.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');

assert.ok(html.includes("fetch('/api/practice-areas')"), 'directory must load the verified taxonomy');
assert.ok(html.includes("fetch('/api/attorneys?'"), 'directory must use the public matching endpoint');
assert.ok(html.includes('license_status') === false, 'the client must not decide whether a licence is valid');
assert.ok(html.includes('yuristga_savolbot?start=advokat'), 'consultation CTA must continue through the legal bot');
assert.ok(/narxini belgilamaydi|narxini belgilamaydi/i.test(html), 'directory must explain that JuristAI does not set attorney prices');
assert.ok(server.indexOf("express.static('public')") < server.indexOf('const sessionMiddleware = session('), 'public pages must not depend on the database session store');
assert.ok(/req\.path === '\/api\/attorneys'/.test(server) && /req\.path === '\/api\/practice-areas'/.test(server), 'public directory APIs must bypass session lookup');

const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
assert.ok(scripts.length >= 2, 'expected theme and directory scripts');
scripts.forEach((code, index) => {
  assert.doesNotThrow(() => new Function(code), `inline script #${index} has a syntax error`);
});

console.log('attorney-directory: all tests passed');
