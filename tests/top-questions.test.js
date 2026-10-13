'use strict';

/**
 * Most-asked questions report (src/rag/top-questions.js): read only, no AI,
 * personal numbers masked, near-duplicates grouped per field, bank coverage
 * marked, a missing source named instead of failing. Fake database.
 *
 *   node tests/top-questions.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const tq = require('../src/rag/top-questions');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}

const fakeDb = (tables, fail = {}) => {
  const seen = [];
  return {
    seen,
    query: async (sql) => {
      seen.push(sql);
      if (/^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)/iu.test(sql)) throw new Error('write attempted');
      for (const [name, rows] of Object.entries(tables)) {
        if (new RegExp(`FROM ${name}\\b`, 'u').test(sql)) {
          if (fail[name]) throw new Error(fail[name]);
          return { rows };
        }
      }
      return { rows: [] };
    },
  };
};

(async () => {
  await test('personal numbers are masked; the legal text is kept', () => {
    const m = tq.maskPersonal('Tel +998 90 123-45-67, email ali@mail.uz, pasport AB1234567, JShShIR 12345678901234, karta 8600 1234 5678 9012. Mehnat kodeksi 100-modda, 2026-yil');
    for (const leak of ['123-45-67', 'ali@mail.uz', 'AB1234567', '12345678901234', '8600 1234']) assert.ok(!m.includes(leak), leak);
    assert.ok(/\[telefon\]/u.test(m) && /\[email\]/u.test(m) && /\[pasport\]/u.test(m) && /\[JShShIR\]/u.test(m) && /\[karta\]/u.test(m));
    assert.ok(m.includes('100-modda') && m.includes('2026-yil'), 'article numbers and years stay');
  });

  await test('grouping: the same question in other words and spellings is one group per field; a different matter is another; short noise is dropped', () => {
    const rows = [
      { text: "Ish beruvchi mehnat shartnomasini qanday bekor qiladi?", topic: 'mehnat', channel: 'web', weak: true },
      { text: "ish beruvchi mehnat shartnomasini qanday bekor qiladi", topic: 'mehnat', channel: 'telegram' },
      { text: "Ish beruvchi mehnat shartnomasini bekor qilishi mumkinmi?", topic: 'mehnat', channel: 'web' },
      { text: "Ish beruvchi menga mehnat shartnomasini bekor qila oladimi", topic: 'mehnat', channel: 'web' },
      { text: "Ish haqi kechiktirilsa nima qilaman?", topic: 'mehnat', channel: 'web' },
      { text: "Ish beruvchi mehnat shartnomasini qanday bekor qiladi?", topic: 'fuqarolik', channel: 'web' },
      { text: 'salom', topic: 'mehnat', channel: 'telegram' },
    ];
    const byTopic = tq.groupQuestions(rows);
    const mehnat = byTopic.get('mehnat');
    assert.strictEqual(mehnat[0].count, 4, JSON.stringify(mehnat.map(g => [g.count, g.example])));
    assert.deepStrictEqual(mehnat[0].channels, { web: 3, telegram: 1 });
    assert.strictEqual(mehnat[0].weak, 1);
    assert.strictEqual(mehnat.length, 2, 'wage delay is its own group');
    assert.strictEqual(byTopic.get('fuqarolik')[0].count, 1, 'another field is another group');
    assert.ok(!mehnat.some(g => g.example === 'salom'));
  });

  await test('report: read only, both channels, bank coverage marked, missing acts listed, a failing source named - never a failed report', async () => {
    const db = fakeDb({
      coverage_log: [
        { query: 'Ish haqi kechiktirilsa nima qilaman? Tel +998901234567', topic: 'mehnat', weak: true, created_at: '2026-10-10T10:00:00Z' },
        { query: 'Ish haqi kechiktirilsa nima qilish kerak?', topic: 'mehnat', weak: false, created_at: '2026-10-11T10:00:00Z' },
      ],
      requests: [{ request_text: 'Ish haqi kechiktirilsa nima qilaman', category: 'mehnat', created_at: '2026-10-12T10:00:00Z' }],
      qa_korpus: [{ id: 7, question: 'Ish haqi kechiktirilsa xodim nima qiladi?' }],
      suggested_sources: [{ topic: 'mehnat', title: 'VMQ-589 Texnopark', lex_url: 'https://lex.uz/docs/-4422250', times_suggested: 5, sample_query: 'IT park rezidenti +998901112233' }],
    });
    const r = await tq.buildReport(db, { days: 30, perTopic: 10 });
    assert.ok(db.seen.every(sql => /^\s*SELECT/iu.test(sql)), 'only SELECT');
    assert.ok(db.seen.some(sql => /source_channel = 'telegram'/u.test(sql)));
    const g = r.topics[0].top[0];
    assert.deepStrictEqual([r.topics[0].topic, g.count, g.channels.web, g.channels.telegram, g.weakShare], ['mehnat', 3, 2, 1, 0.5]);
    assert.ok(!/998901234567/u.test(JSON.stringify(r)) && !/998901112233/u.test(JSON.stringify(r)), 'no phone anywhere');
    assert.deepStrictEqual(g.inBank && g.inBank.id, 7);
    assert.strictEqual(r.missingActs[0].timesSuggested, 5);
    assert.deepStrictEqual([r.sources.web_chat.rows, r.sources.telegram.rows, r.sources.qa_korpus.rows], [2, 1, 1]);

    const broken = await tq.buildReport(fakeDb({ coverage_log: [{ query: 'Ish haqi kechiktirilsa nima qilaman?', topic: 'mehnat' }], requests: [] }, { requests: 'column "source_channel" does not exist' }));
    assert.ok(/source_channel/u.test(broken.sources.telegram.error) && broken.sources.web_chat.rows === 1 && broken.topics.length === 1);
  });

  await test('CSV for Excel: BOM, one row per group, quotes escaped', async () => {
    const r = await tq.buildReport(fakeDb({ coverage_log: [{ query: 'Ijara shartnomasi "notarial" tasdiqlanadimi?', topic: 'uy-joy', weak: false }] }), {});
    const csv = tq.toCsv(r);
    assert.ok(csv.startsWith('﻿"soha","necha_marta"'));
    assert.strictEqual(csv.trim().split('\r\n').length, 2);
    assert.ok(csv.includes('""notarial""'));
  });

  await test('server: master only, no-store, audited', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/api/server.js'), 'utf8');
    const at = src.indexOf("app.get('/api/admin/top-questions', requireMasterAdmin,");
    assert.ok(at > 0);
    const body = src.slice(at, at + 1200);
    assert.ok(/no-store/u.test(body) && /logAudit\(req, 'admin\.top_questions'/u.test(body) && /format/u.test(body));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
