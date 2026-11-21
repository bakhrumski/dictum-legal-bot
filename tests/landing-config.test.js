'use strict';

// Landing settings: only known background options are stored or served.
const assert = require('assert');
const lc = require('../src/config/landing-config');

function fakePool(rows) {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); return { rows: rows || [] }; } };
}

(async () => {
  let failed = 0;
  async function test(name, fn) {
    lc._resetCache();
    try { await fn(); console.log('  ✓ ' + name); } catch (e) { failed++; console.error('  ✗ ' + name + '\n      ' + e.message); }
  }
  console.log('\nlanding-config\n');

  await test('defaults to the grid when nothing is saved', async () => {
    assert.deepStrictEqual(await lc.read(fakePool([])), { bg: '1' });
  });
  await test('serves a saved option', async () => {
    assert.deepStrictEqual(await lc.read(fakePool([{ value: { bg: '3' } }])), { bg: '3' });
  });
  await test('an unknown stored value falls back to the default', async () => {
    assert.deepStrictEqual(await lc.read(fakePool([{ value: { bg: '<script>' } }])), { bg: '1' });
  });
  await test('a failing database still answers with the default', async () => {
    const pool = { query: async () => { throw new Error('down'); } };
    assert.deepStrictEqual(await lc.read(pool), { bg: '1' });
  });
  await test('write refuses an unknown option and touches nothing', async () => {
    const pool = fakePool();
    assert.deepStrictEqual(await lc.write(pool, { bg: '9' }, 1), { error: 'invalid_bg' });
    assert.strictEqual(pool.calls.length, 0);
  });
  await test('write stores the option with the admin id and updates the cache', async () => {
    const pool = fakePool();
    assert.deepStrictEqual(await lc.write(pool, { bg: '0' }, 7), { settings: { bg: '0' } });
    assert.deepStrictEqual(pool.calls[0].params, ['landing', '{"bg":"0"}', 7]);
    assert.deepStrictEqual(await lc.read(fakePool([{ value: { bg: '2' } }])), { bg: '0' });
  });

  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
