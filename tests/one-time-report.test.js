'use strict';

/**
 * One-time purchases report for the master admin (2026-10-22): read only,
 * refunded purchases listed but not counted, what is left of each person's
 * bought units, and a database without the table answered as "not available".
 *
 *   node tests/one-time-report.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { oneTimeReport } = require('../src/services/one-time-report');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

(async () => {
  await test('report: purchases with who bought, totals without refunds, today, and units left per person and service', async () => {
    const sqls = [];
    const db = { async query(sql, p) {
      sqls.push(sql);
      if (/to_regclass/.test(sql)) return { rows: [{ ok: true }] };
      if (/FROM service_credits c/.test(sql)) return { rows: [
        { id: 2, product: 'draft', service: 'draft', units: 1, stars: 190, subject: 'a:5', admin_id: 5, full_name: 'Ali', refunded_at: null },
        { id: 1, product: 'chat5', service: 'chat', units: 5, stars: 100, subject: 't:77', telegram_user_id: 77, refunded_at: '2026-10-21' },
      ] };
      if (/GROUP BY product/.test(sql)) return { rows: [{ product: 'draft', count: 1, units: 1, stars: 190, price_uzs: 29000 }] };
      if (/AT TIME ZONE/.test(sql)) return { rows: [{ count: 1, stars: 190 }] };
      if (/SELECT b.subject/.test(sql)) return { rows: [{ subject: 'a:5', service: 'draft', bought: 1, used: 1 }, { subject: 't:77', service: 'chat', bought: 5, used: 2 }] };
      return { rows: [] };
    } };
    const r = await oneTimeReport(db, { days: 30 });
    assert.strictEqual(r.available, true);
    assert.deepStrictEqual(r.purchases.map(p => p.remaining), [0, 3]);
    assert.strictEqual(r.today.count, 1);
    assert.ok(sqls.filter(s => /GROUP BY product|AT TIME ZONE/.test(s)).every(s => /refunded_at IS NULL/.test(s)), 'refunds are not counted');
    assert.ok(sqls.every(s => !/^\s*(INSERT|UPDATE|DELETE)/i.test(s)), 'read only');
  });

  await test('report: no table yet -> not available, nothing else is queried; days are bounded', async () => {
    const sqls = [];
    const db = { async query(sql) { sqls.push(sql); return { rows: [{ ok: false }] }; } };
    const r = await oneTimeReport(db, { days: 99999 });
    assert.deepStrictEqual([r.available, sqls.length], [false, 1]);
  });

  await test('route and page: master only; the section is in the money group and in "Bugun"', () => {
    const server = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    assert.match(server, /app\.get\('\/api\/admin\/one-time-purchases', requireMasterAdmin/u);
    const admin = fs.readFileSync(path.join(__dirname, '../public/app/admin.js'), 'utf8');
    assert.match(admin, /\['xaridlar', 'tg', 'adm\.buy', 'money'\]/u);
    assert.match(admin, /xaridlar: viewBuy/u);
    assert.match(admin, /\['xaridlar', 'adm\.t\.buy'\]/u);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
