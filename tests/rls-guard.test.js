'use strict';

const assert = require('assert');
const { enableRlsEverywhere, quoteIdent } = require('../src/database/rls-guard');

function stubPool(rows, { failOn } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(sql);
      if (/FROM pg_class/.test(sql)) return { rows };
      if (failOn && sql.includes(failOn)) throw new Error('permission denied');
      return { rows: [] };
    },
  };
}
const quiet = { log() {}, warn() {} };

(async () => {
  // own tables get RLS, another owner's table is only named
  {
    const pool = stubPool([
      { name: 'admins', owner: 'postgres', mine: true },
      { name: 'odd"name', owner: 'postgres', mine: true },
      { name: 'ext_table', owner: 'supabase_admin', mine: false },
    ]);
    const r = await enableRlsEverywhere(pool, { log: quiet });
    assert.deepStrictEqual(r.enabled, ['admins', 'odd"name']);
    assert.deepStrictEqual(r.foreign, ['ext_table (supabase_admin)']);
    assert.ok(pool.calls.includes('ALTER TABLE public."admins" ENABLE ROW LEVEL SECURITY'));
    assert.ok(pool.calls.includes('ALTER TABLE public."odd""name" ENABLE ROW LEVEL SECURITY'));
    assert.ok(!pool.calls.some(s => s.includes('ext_table') && s.startsWith('ALTER')));
    assert.ok(!pool.calls.some(s => /FORCE/.test(s)), 'never FORCE: the owner (the server) must keep its access');
  }
  // one failure does not stop the others
  {
    const pool = stubPool([
      { name: 'a', owner: 'postgres', mine: true },
      { name: 'b', owner: 'postgres', mine: true },
    ], { failOn: '"a"' });
    const r = await enableRlsEverywhere(pool, { log: quiet });
    assert.deepStrictEqual(r.enabled, ['b']);
    assert.deepStrictEqual(r.failed, ['a']);
  }
  // nothing to do
  {
    const pool = stubPool([]);
    const r = await enableRlsEverywhere(pool, { log: quiet });
    assert.deepStrictEqual(r.enabled, []);
    assert.strictEqual(pool.calls.length, 1);
  }
  // switch
  {
    process.env.RLS_GUARD = 'off';
    const pool = stubPool([{ name: 'a', owner: 'postgres', mine: true }]);
    const r = await enableRlsEverywhere(pool, { log: quiet });
    assert.strictEqual(r.skipped, 'off');
    assert.strictEqual(pool.calls.length, 0);
    delete process.env.RLS_GUARD;
  }
  assert.strictEqual(quoteIdent('x'), '"x"');
  console.log('rls-guard tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
