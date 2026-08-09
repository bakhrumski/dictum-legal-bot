'use strict';

/**
 * Tests for user-uploaded document templates.
 *
 * An uploaded template is somebody's real contract — client names, sums,
 * terms. The security property that matters is therefore simple and absolute:
 * a template one user uploads must never be reachable by another user, on any
 * route, including the indirect ones (the style guides that /api/draft/
 * ai-generate feeds to the model).
 *
 * Ownership is enforced in the SQL, not in the route handlers, so these tests
 * assert on the queries the DB layer actually issues.
 *
 *   node tests/user-templates.test.js
 */

const assert = require('assert');
const Module = require('module');
const path = require('path');
const fs = require('fs');

// ── Load the DB layer against a fake pool that records every query ──────────
const issued = [];
const rowsFor = { list: [], one: null, count: 0, deleted: 0 };
const fakePool = {
  query: async (sql, params = []) => {
    issued.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    if (/^\s*ALTER|^\s*CREATE/i.test(sql)) return { rows: [] };
    if (/COUNT\(\*\)::int AS n FROM document_templates WHERE owner_id/i.test(sql.replace(/\s+/g, ' '))) {
      return { rows: [{ n: rowsFor.count }] };
    }
    if (/SELECT COUNT\(\*\) AS n FROM document_templates/i.test(sql.replace(/\s+/g, ' '))) {
      return { rows: [{ n: 5 }] };   // non-empty => skip seeding
    }
    if (/^UPDATE document_templates/i.test(sql.trim())) return { rowCount: rowsFor.deleted, rows: [] };
    if (/SELECT id, slug/i.test(sql)) return { rows: rowsFor.list };
    if (/SELECT \* FROM document_templates/i.test(sql)) return { rows: rowsFor.one ? [rowsFor.one] : [] };
    if (/^INSERT INTO document_templates/i.test(sql.trim())) return { rows: [rowsFor.one] };
    return { rows: [] };
  },
};

const modPath = require.resolve('../src/drafting/db');
const m = new Module(modPath);
m.filename = modPath;
m.paths = Module._nodeModulePaths(path.dirname(modPath));
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '../database/db') return { pool: fakePool };
  if (id === './templates') return { TEMPLATES: [] };
  return orig.apply(this, arguments);
};
m._compile(fs.readFileSync(modPath, 'utf8'), modPath);
Module.prototype.require = orig;
const db = m.exports;

let passed = 0, failed = 0;
async function test(name, fn) {
  issued.length = 0;
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}
const lastSql = () => issued[issued.length - 1].sql;
const lastParams = () => issued[issued.length - 1].params;

(async () => {
  console.log('\nuser templates — isolation\n');

  await test('listing scopes to the curated library plus the caller\'s own', async () => {
    await db.dbListTemplates(42);
    assert.match(lastSql(), /owner_id IS NULL OR owner_id = \$1/,
      'the visibility rule must be in the query, not the handler');
    assert.deepStrictEqual(lastParams(), [42]);
  });

  await test('listing with no owner returns only the curated library', async () => {
    // A caller that forgets to scope must leak nothing, not everything.
    await db.dbListTemplates();
    assert.deepStrictEqual(lastParams(), [null]);
  });

  await test('fetching one template carries the ownership guard', async () => {
    await db.dbGetTemplate('some-slug', 7);
    assert.match(lastSql(), /owner_id IS NULL OR owner_id = \$2/);
    assert.deepStrictEqual(lastParams(), ['some-slug', 7]);
  });

  await test('another user\'s private template is simply not found', async () => {
    rowsFor.one = null;   // the WHERE excluded it
    const t = await db.dbGetTemplate('99', 7);
    assert.strictEqual(t, null, 'must 404, never fall back to an unscoped read');
  });

  await test('numeric ids are matched on id, slugs on slug', async () => {
    await db.dbGetTemplate('123', 1);
    assert.match(lastSql(), /id=\$1/);
    await db.dbGetTemplate('davo-arizasi', 1);
    assert.match(lastSql(), /slug=\$1/);
  });

  console.log('\nuser templates — ownership on write\n');

  await test('an uploaded template is stored with its owner', async () => {
    rowsFor.one = { id: 1, slug: 'u7-x', name: {}, fields: [], body: 'b', owner_id: 7 };
    const t = await db.dbCreateTemplate({
      slug: 'u7-x', name: { uz: 'X' }, fields: [], body: 'b', createdBy: 7, ownerId: 7,
    });
    assert.ok(lastSql().includes('owner_id'), 'owner_id must be persisted');
    assert.strictEqual(lastParams()[8], 7);
    assert.strictEqual(t.isMine, true);
  });

  await test('a curated template has no owner and is not "mine"', async () => {
    rowsFor.one = { id: 2, slug: 'davo', name: {}, fields: [], body: 'b', owner_id: null };
    const t = await db.dbGetTemplate('davo', 7);
    assert.strictEqual(t.ownerId, null);
    assert.strictEqual(t.isMine, false);
  });

  await test('delete only succeeds on a template the caller owns', async () => {
    rowsFor.deleted = 1;
    assert.strictEqual(await db.dbDeleteOwnedTemplate(5, 7), true);
    assert.match(lastSql(), /owner_id=\$2/, 'ownership must be in the WHERE clause');

    rowsFor.deleted = 0;   // row exists but belongs to someone else
    assert.strictEqual(await db.dbDeleteOwnedTemplate(5, 999), false);
  });

  await test('the personal-template count is per owner', async () => {
    rowsFor.count = 12;
    assert.strictEqual(await db.dbCountOwnedTemplates(7), 12);
    assert.deepStrictEqual(lastParams(), [7]);
  });

  console.log('\nuser templates — routes wired to the scoped calls\n');

  await test('no user-facing route reads templates unscoped', () => {
    const src = fs.readFileSync(require.resolve('../src/drafting/routes.js'), 'utf8');
    // Every dbListTemplates/dbGetTemplate call in the routes must pass an owner.
    const bad = [...src.matchAll(/db(?:List|Get)Template[s]?\(([^)]*)\)/g)]
      .map(mm => mm[0])
      // Unscoped reads are allowed only under an explicitly-named master helper.
      .filter(call => !/adminId/.test(call) && !/dbGetTemplateAny|dbListTemplatesAll/.test(call));
    assert.deepStrictEqual(bad, [], 'unscoped template read(s) in routes: ' + bad.join(', '));
  });

  await test('the AI style-guide path is scoped too', () => {
    // ai-generate feeds template bodies to the model as structure hints. If it
    // read unscoped, one user's contract could surface inside another's draft
    // without ever appearing in a picker — the subtlest leak of the set.
    const src = fs.readFileSync(require.resolve('../src/drafting/routes.js'), 'utf8');
    const guideBlock = src.slice(src.indexOf("app.post('/api/draft/ai-generate'"), src.indexOf('INTERNAL TEMPLATE GUIDE'));
    assert.match(guideBlock, /dbListTemplates\(req\.session\.adminId\)/);
    assert.match(guideBlock, /dbGetTemplate\(h\.id, req\.session\.adminId\)/);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
