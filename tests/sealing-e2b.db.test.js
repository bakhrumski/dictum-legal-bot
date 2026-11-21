'use strict';

/**
 * Data protection E2b (2026-10-29, migration 030, docs/design/shifrlash-1-bosqich.md
 * §3.1): with DATA_KEYS set, the bot's conversation turns and context, a
 * matter's summary and notes, an agent run's input / plan / result and its
 * step checkpoints, a service order's intake, a consultation's case summary
 * and the agent traces are sealed in the database, each bound to its row,
 * and every reader gets them back as they were; the read-modify-write paths
 * (an answer to a waiting run, the Telegram target, a table's row tags) keep
 * working; a note no longer lends its first words to its readable title.
 * Needs TEST_DATABASE_URL (throwaway) with the migrations applied.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/sealing-e2b.db.test.js
 */

const assert = require('assert');
const crypto = require('crypto');
if (!process.env.TEST_DATABASE_URL) {
  console.log('sealing E2b (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like production');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATA_KEYS = JSON.stringify({ e2: crypto.randomBytes(32).toString('base64') });
const { pool } = require('../src/database/db');
const privacy = require('../src/privacy/crypto');
privacy.reload();

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const rnd = () => Math.floor(Math.random() * 1e9);
const SECRET = 'Aziz Karimov, pasport AA1234567';
const raw = async (sql, args) => JSON.stringify((await pool.query(sql, args)).rows[0]);
async function makeUser(role = 'user') {
  return (await pool.query(`INSERT INTO admins (username, password, full_name, role) VALUES ($1, 'x', 'Sinov', $2) RETURNING id`, [`e2_${Date.now()}_${rnd()}`, role])).rows[0].id;
}

(async () => {
  console.log('sealing E2b (db)');
  const a = await makeUser();

  await test('Telegram conversation: turns and context sealed, loaded back as they were', async () => {
    const tg = require('../src/agents/telegram-agent');
    const chat = 800000000 + (rnd() % 1e8);
    await tg.saveConversation(chat, [{ role: 'user', text: SECRET }, { role: 'ai', text: 'Javob' }], 1);
    await tg.setConversationState(chat, 'document_details', { details: SECRET });
    const r = await raw('SELECT turns, context FROM tg_conversations WHERE chat_id = $1', [chat]);
    assert.ok(!r.includes('Karimov') && r.includes('enc:e2:'), r.slice(0, 120));
    const c = await tg.loadConversation(chat);
    assert.strictEqual(c.turns[0].text, SECRET);
    assert.strictEqual(c.context.details, SECRET);
    assert.strictEqual(c.state, 'document_details');
    await pool.query('DELETE FROM tg_conversations WHERE chat_id = $1', [chat]);
  });

  let matterId, runId;
  await test('matters: summary and notes sealed; the note\'s title does not carry its words', async () => {
    const store = require('../src/matters/store').createMatterStore({ db: pool });
    const m = await store.create(a, { title: 'Ijara nizosi', summary: SECRET });
    matterId = m.id;
    assert.strictEqual(m.summary, SECRET);
    await store.addItem(m.id, a, { kind: 'note', note: `Sud 12-noyabr. ${SECRET}` });
    const rm = await raw('SELECT summary FROM matters WHERE id = $1', [m.id]);
    const ri = await raw('SELECT note, title FROM matter_items WHERE matter_id = $1', [m.id]);
    assert.ok(!rm.includes('Karimov') && !ri.includes('Karimov') && !ri.includes('Sud 12'), ri);
    const g = await store.get(m.id, a);
    assert.strictEqual(g.summary, SECRET);
    assert.strictEqual(g.items[0].note, `Sud 12-noyabr. ${SECRET}`);
    assert.strictEqual(g.items[0].title, 'Yozuv');
    const u = await store.update(m.id, a, { title: 'Ijara nizosi 2' });
    assert.strictEqual(u.summary, SECRET, 'a summary not given is kept, still sealed');
    assert.ok((await raw('SELECT summary FROM matters WHERE id = $1', [m.id])).includes('enc:e2:'));
  });

  await test('agent runs: input, plan, result and checkpoints sealed; answers, Telegram and tags still update', async () => {
    const runs = require('../src/agents/runs/store').createRunStore({ db: pool });
    const run = await runs.create({ adminId: a, workflow: 'tabular_review', input: { docs: [{ text: SECRET }] }, plan: { task: SECRET }, matterId });
    runId = run.id;
    assert.strictEqual(run.input.docs[0].text, SECRET);
    let r = await raw('SELECT input, plan FROM agent_runs WHERE id = $1', [run.id]);
    assert.ok(!r.includes('Karimov'));
    const claimed = await runs.claim('w1');
    assert.ok(claimed && claimed.id === run.id && claimed.input.docs[0].text === SECRET);
    await runs.saveStep(run.id, { id: 'extract-1', label: 'O‘qish', status: 'ok', ms: 5 }, { rows: [SECRET] });
    assert.ok(!(await raw('SELECT output FROM agent_run_steps WHERE run_id = $1', [run.id])).includes('Karimov'));
    assert.deepStrictEqual((await runs.checkpoints(run.id))['extract-1'], { rows: [SECRET] });
    assert.strictEqual(await runs.setTelegram(run.id, a, { chatId: 5, messageId: 7 }), true);
    assert.deepStrictEqual((await runs.row(run.id, a)).input.telegram, { chatId: 5, messageId: 7 });
    assert.strictEqual(await runs.finish(run.id, { workerId: 'w1', status: 'needs_input', result: { body: { rows: [SECRET] } } }), true);
    const resumed = await runs.resume(run.id, a, { answers: { q1: 'mart' } });
    assert.ok(resumed && resumed.input.answers.q1 === 'mart' && resumed.input.docs[0].text === SECRET && resumed.input.telegram.chatId === 5);
    await runs.claim('w2');
    assert.strictEqual(await runs.finish(run.id, { workerId: 'w2', status: 'done', result: { body: { rows: [SECRET] } } }), true);
    r = await raw('SELECT result FROM agent_runs WHERE id = $1', [run.id]);
    assert.ok(!r.includes('Karimov') && r.includes('enc:e2:'));
    assert.strictEqual(await runs.setTags(run.id, a, { 0: 'muhim' }), true);
    const got = await runs.get(run.id, a);
    assert.deepStrictEqual([got.result.body.rows[0], got.result.body.tags[0]], [SECRET, 'muhim']);
    // a matter's export reads the result through the run store
    const store = require('../src/matters/store').createMatterStore({ db: pool });
    await store.addItem(matterId, a, { kind: 'agent_run', ref: run.id });
    const res = await store.results(matterId, a);
    assert.strictEqual(res[run.id].body.rows[0], SECRET);
  });

  await test('service order and consultation: what the person told is sealed; the master\'s view opens it', async () => {
    const mk = require('../src/services/legal-marketplace');
    await pool.query(`INSERT INTO service_catalog (slug, name_uz, is_active) VALUES ('e2-test', 'Sinov xizmati', true) ON CONFLICT (slug) DO NOTHING`).catch(() => {});
    const order = await mk.createServiceOrder({ serviceSlug: 'e2-test', telegramChatId: 123456, intakeData: { kind: 'lawyer_review', caseSummary: SECRET } });
    if (order) {
      const r = await raw('SELECT intake_data FROM service_orders WHERE id = $1', [order.id]);
      assert.ok(!r.includes('Karimov') && r.includes('enc:e2:'));
      assert.strictEqual(order.intake_data.caseSummary, SECRET);
      const row = (await pool.query('SELECT * FROM service_orders WHERE id = $1', [order.id])).rows[0];
      assert.strictEqual(mk.openOrder(row).intake_data.kind, 'lawyer_review');
    } else {
      console.log('      (service_catalog not available here: the order part was not run)');
    }
    const c = await mk.createConsultationRequest({ telegramChatId: 123456, caseSummary: SECRET, attorneyIds: [] });
    const rc = await raw('SELECT case_summary FROM attorney_consultation_requests WHERE id = $1', [c.id]);
    assert.ok(!rc.includes('Karimov') && rc.includes('enc:e2:'));
    assert.strictEqual(c.case_summary, SECRET);
  });

  await test('agent traces: input summary and output sealed, read back by the request', async () => {
    const runner = require('../src/agents/runner');
    runner.initRunner(async () => ({ text: JSON.stringify({ answer: SECRET }), provider: 'stub' }));
    const requestId = (await pool.query(`INSERT INTO requests (user_id, request_text, request_type, status) VALUES (NULL, 'x', 'text', 'pending') RETURNING id`).catch(() => ({ rows: [{ id: null }] }))).rows[0].id;
    if (requestId == null) { console.log('      (requests table not available here: skipped)'); return; }
    await runner.runAgent('triage', requestId, { messages: [{ role: 'user', text: 'savol' }] }, { inputSummary: SECRET });
    const r = await raw('SELECT input_summary, output FROM agent_traces WHERE request_id = $1', [requestId]);
    assert.ok(!r.includes('Karimov') && r.includes('enc:e2:'), r.slice(0, 120));
    const t = await runner.getTraces(requestId);
    assert.strictEqual(t[0].input_summary, SECRET);
    assert.ok(JSON.stringify(t[0].output).includes('Karimov'));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})();
