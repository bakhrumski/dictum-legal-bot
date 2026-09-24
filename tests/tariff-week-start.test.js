'use strict';

// Weekly allowances (opinion credits, drafts) reset Monday 00:00 Asia/Tashkent
// (UTC+5, no DST). The server runs in UTC, so this is checked at the instants
// where a UTC reading and a Tashkent reading of "which day is it" disagree.

const assert = require('assert');
const { tashkentWeekStart } = require('../src/rag/subscription-tiers');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n      ${e.message}`); }
}

// The Tashkent wall-clock reading of an instant, "YYYY-MM-DD HH:MM Ddd".
function tashkent(date) {
  const t = new Date(date.getTime() + 5 * 3600 * 1000);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.getUTCDay()];
  return `${t.toISOString().slice(0, 16).replace('T', ' ')} ${day}`;
}
const at = (isoTashkent) => new Date(`${isoTashkent}+05:00`).getTime();

console.log('\ntariff — weekly reset is Monday 00:00 Asia/Tashkent\n');

test('every day of a week maps back to that week\'s Monday 00:00', () => {
  const days = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'];
  for (const d of days) {
    for (const time of ['00:00:00', '04:59:00', '05:00:00', '12:00:00', '23:59:59']) {
      assert.strictEqual(tashkent(tashkentWeekStart(at(`${d}T${time}`))), '2026-09-21 00:00 Mon', `${d} ${time}`);
    }
  }
});

test('Monday 00:00 exactly starts the new week; Sunday 23:59 is still the old one', () => {
  assert.strictEqual(tashkent(tashkentWeekStart(at('2026-09-28T00:00:00'))), '2026-09-28 00:00 Mon');
  assert.strictEqual(tashkent(tashkentWeekStart(at('2026-09-27T23:59:59'))), '2026-09-21 00:00 Mon');
});

test('a Monday is never counted into the previous week (the Tuesday-reset bug)', () => {
  // 10:00 Monday Tashkent = 05:00 UTC Monday; the old code returned Tue 15 Sep.
  assert.strictEqual(tashkent(tashkentWeekStart(at('2026-09-21T10:00:00'))), '2026-09-21 00:00 Mon');
  // 00:30 Monday Tashkent is still Sunday in UTC.
  assert.strictEqual(tashkent(tashkentWeekStart(at('2026-09-28T00:30:00'))), '2026-09-28 00:00 Mon');
});

test('year and month boundaries', () => {
  assert.strictEqual(tashkent(tashkentWeekStart(at('2027-01-01T09:00:00'))), '2026-12-28 00:00 Mon');
  assert.strictEqual(tashkent(tashkentWeekStart(at('2026-03-01T00:10:00'))), '2026-02-23 00:00 Mon');
});

test('with no argument it uses the current time and returns a Monday 00:00', () => {
  assert.match(tashkent(tashkentWeekStart()), /00:00 Mon$/);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exitCode = 1;
