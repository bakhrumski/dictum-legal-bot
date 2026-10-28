'use strict';

/**
 * Interview recordings on a Matter (2026-10-28, CustDev stage 4, migration 028,
 * src/interviews/): an upload without the consent is refused and stores
 * nothing; another member of the Workspace the Matter is attached to cannot
 * see a recording (nor a client); a long recording is cut into chunks; the
 * transcript is versioned and stays when the audio is deleted (by hand or by
 * retention, each logged); a summary quote not in the transcript word for
 * word is removed and counted. Needs TEST_DATABASE_URL (throwaway) with the
 * migrations applied. No provider is called: STT and the AI are stubs.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node tests/interviews.db.test.js
 */

const assert = require('assert');
const { execFileSync } = require('child_process');
if (!process.env.TEST_DATABASE_URL) {
  console.log('interviews (db): skipped, TEST_DATABASE_URL not set');
  process.exit(0);
}
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) {
  console.error('refusing to run against what looks like production');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const express = require('express');
const { pool } = require('../src/database/db');
const store = require('../src/interviews/store');
const { mountInterviewRoutes } = require('../src/interviews/routes');
const { withWorkspaceTransaction } = require('../src/workspace/authz');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.stack || e.message}`); failed++; }
}
const rnd = () => Math.floor(Math.random() * 1e9);
async function makeUser(role = 'user') {
  const r = await pool.query(`INSERT INTO admins (username, password, full_name, role) VALUES ($1, 'x', 'Sinov', $2) RETURNING id`, [`iv_${Date.now()}_${rnd()}`, role]);
  return r.rows[0].id;
}
const consent = { by: 'Nodira Yusupova', at: new Date(Date.now() - 3600e3).toISOString(), method: 'verbal_recording', ack: true };
const fakeAudio = Buffer.from('OggS fake audio bytes for the test');
const count = async () => (await pool.query('SELECT count(*)::int AS n FROM interview_recordings')).rows[0].n;
const stubStt = { sttEnabled: () => true, transcribeDetailed: async (buf, o) => ({ text: '', segments: [
  { speaker: 'A', text: 'Biz hozir hammasini Excelda yuritamiz va oyiga ikki million to‘laymiz yordamchiga.' },
  { speaker: 'B', text: `Bo‘lak ${o.durationSec} soniya.` }], provider: 'stub' }) };

(async () => {
  console.log('interviews (db)');
  const agent = await makeUser('student');
  const other = await makeUser('student');
  const client = await makeUser('user');
  const matter = (await pool.query(`INSERT INTO matters (owner_id, title) VALUES ($1, 'Pilot intervyu') RETURNING id`, [agent])).rows[0].id;
  let rec;

  await test('no consent, no upload: every missing part is named and nothing is stored', async () => {
    const before = await count();
    for (const [k, bad] of [['consentBy', { ...consent, by: '' }], ['consentAt', { ...consent, at: 'x' }], ['consentMethod', { ...consent, method: 'phone' }], ['consentAck', { ...consent, ack: false }]]) {
      const r = await store.create(pool, { actorId: agent, matterId: matter, audio: fakeAudio, mime: 'audio/ogg', durationSec: 30, consent: bad });
      assert.strictEqual(r.status, 422);
      assert.ok(r.missing.includes(k), k);
    }
    assert.strictEqual(await count(), before);
  });

  await test('with consent: stored for the uploader\'s own matter only; a client account cannot upload', async () => {
    assert.strictEqual((await store.create(pool, { actorId: other, matterId: matter, audio: fakeAudio, mime: 'audio/ogg', durationSec: 30, consent })).status, 404);
    assert.strictEqual((await store.create(pool, { actorId: client, matterId: matter, audio: fakeAudio, mime: 'audio/ogg', durationSec: 30, consent })).status, 404);
    const r = await store.create(pool, { actorId: agent, matterId: matter, audio: fakeAudio, mime: 'audio/ogg', durationSec: 1500, consent });
    assert.strictEqual(r.ok, true); rec = r.recording;
    const ev = (await pool.query('SELECT event, details FROM interview_events WHERE recording_id = $1', [rec.id])).rows;
    assert.strictEqual(ev[0].event, 'uploaded');
    assert.match(ev[0].details.notice, /VoiceLab, DeepSeek/u);
  });

  await test('transcription in chunks: one STT call per chunk, timestamps, version 1; audio kept for 30 days', async () => {
    let calls = 0;
    const stt = { transcribeDetailed: async (b, o) => { calls++; return stubStt.transcribeDetailed(b, o); } };
    const split = async (buf, o) => [0, 1, 2].map(i => ({ buffer: buf, start: i * o.chunkSec, contentType: 'audio/ogg' }));
    const r = await store.transcribe(pool, { id: rec.id, stt, split });
    assert.deepStrictEqual([r.ok, r.chunks, calls], [true, 3, 3]);
    const t = await store.latestTranscript(pool, rec.id);
    assert.strictEqual(t.version, 1);
    assert.match(t.body, /^\[00:00:00\]\nS1: Biz hozir/u);
    assert.match(t.body, /\[00:20:00\]/u);
    const row = (await pool.query(`SELECT status, extract(day FROM audio_delete_after - transcribed_at)::int AS days FROM interview_recordings WHERE id = $1`, [rec.id])).rows[0];
    assert.deepStrictEqual([row.status, row.days], ['transcribed', 30]);
    assert.strictEqual((await store.transcribe(pool, { id: rec.id, stt, split })).error, 'not_queued');
  });

  await test('ffmpeg really cuts a long recording into valid chunks', async () => {
    const bin = require('ffmpeg-static');
    if (!bin || !require('fs').existsSync(bin)) { console.log('      (ffmpeg binary not installed here: skipped)'); return; }
    const wav = execFileSync(bin, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-f', 'wav', 'pipe:1']);
    const parts = await store.splitAudio(wav, { durationSec: 5, chunkSec: 2 });
    assert.ok(parts.length >= 3, `parts ${parts.length}`);
    assert.ok(parts.every(p => p.buffer.slice(0, 4).toString() === 'OggS'));
    assert.strictEqual((await store.splitAudio(wav, { durationSec: 5, chunkSec: 600 })).length, 1);
  });

  await test('another member of the Workspace the Matter is attached to cannot see it; a master can', async () => {
    const owner = await makeUser('master');
    const ws = await withWorkspaceTransaction(pool, owner, async (db) => {
      const id = (await db.query(`INSERT INTO workspaces (name, slug, owner_id, created_by, internal) VALUES ('Pilot', $1, $2, $2, true) RETURNING id`, [`iv-${rnd()}`, owner])).rows[0].id;
      await db.query(`INSERT INTO workspace_members (workspace_id, user_id, role, invited_by) VALUES ($1, $2, 'member', $3), ($1, $4, 'member', $3)`, [id, agent, owner, other]);
      return id;
    });
    await pool.query('UPDATE matters SET workspace_id = $2 WHERE id = $1', [matter, ws]);
    assert.strictEqual(await store.visible(pool, rec.id, other), null);
    assert.strictEqual((await store.get(pool, { id: rec.id, actorId: other })).status, 404);
    assert.strictEqual((await store.list(pool, { matterId: matter, actorId: other })).length, 0);
    assert.strictEqual((await store.addVersion(pool, { id: rec.id, actorId: other, body: 'x' })).status, 404);
    assert.strictEqual((await store.deleteAudio(pool, { id: rec.id, actorId: other })).status, 404);
    assert.ok(await store.visible(pool, rec.id, owner), 'a master sees it');
    assert.strictEqual((await store.list(pool, { matterId: matter, actorId: agent })).length, 1);
  });

  await test('a corrected transcript is version 2; version 1 is kept', async () => {
    const v = await store.addVersion(pool, { id: rec.id, actorId: agent, body: 'Biz hozir hammasini Excelda yuritamiz va oyiga ikki million to‘laymiz yordamchiga. (tuzatildi)' });
    assert.strictEqual(v.version, 2);
    const g = await store.get(pool, { id: rec.id, actorId: agent });
    assert.deepStrictEqual(g.versions.map(x => [x.version, x.source]), [[1, 'stt'], [2, 'edit']]);
  });

  await test('summary: a quote not in the transcript word for word is removed and counted; labelled', async () => {
    const ai = async () => ({ provider: 'stub', text: JSON.stringify({
      quotes: ['Biz hozir hammasini Excelda yuritamiz', 'Narx bizga juda ma’qul keldi'],
      problem: 'Hujjatlar Excelda', current_solution: 'Excel va yordamchi', current_price: 'oyiga ikki million', confusing: [], missing: ['sud amaliyoti'], signal: "o'rtacha", price_answers: ['ikki million'] }) });
    const r = await store.summarize(pool, { id: rec.id, actorId: agent, ai });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.summary.quotes, ['Biz hozir hammasini Excelda yuritamiz']);
    assert.strictEqual(r.summary.quotesRemoved, 1);
    assert.strictEqual(r.summary.label, 'AI xulosasi, transkript bilan tekshiring');
    assert.strictEqual(r.summary.transcriptVersion, 2);
    assert.strictEqual((await store.summarize(pool, { id: rec.id, actorId: other, ai })).status, 404);
  });

  await test('deletion: by hand and by retention - the audio goes, the transcript stays, both logged', async () => {
    const d = await store.deleteAudio(pool, { id: rec.id, actorId: agent, reason: 'manual' });
    assert.strictEqual(d.ok, true);
    assert.ok(!(await pool.query('SELECT 1 FROM interview_audio WHERE recording_id = $1', [rec.id])).rows[0]);
    assert.ok(await store.latestTranscript(pool, rec.id));
    assert.strictEqual((await store.deleteAudio(pool, { id: rec.id, actorId: agent })).already, true);
    // retention
    const r2 = (await store.create(pool, { actorId: agent, matterId: matter, audio: fakeAudio, mime: 'audio/ogg', durationSec: 60, consent: { ...consent, method: 'written' } })).recording;
    await store.transcribe(pool, { id: r2.id, stt: stubStt });
    await pool.query(`UPDATE interview_recordings SET audio_delete_after = now() - interval '1 minute' WHERE id = $1`, [r2.id]);
    assert.ok((await store.purgeDue(pool)) >= 1);
    const ev = (await pool.query(`SELECT actor_id, details->>'reason' AS reason FROM interview_events WHERE recording_id = $1 AND event = 'audio_deleted'`, [r2.id])).rows;
    assert.deepStrictEqual(ev, [{ actor_id: null, reason: 'retention' }]);
    assert.ok(await store.latestTranscript(pool, r2.id));
  });

  await test('HTTP: no consent -> 422 before anything is stored; a client gets 404; the other member gets 404', async () => {
    const app = express();
    app.use(express.json());
    let as = {};
    app.use((req, _r, next) => { req.session = { isAuthenticated: true, ...as }; next(); });
    const pass = (q, r, n) => n();
    mountInterviewRoutes(app, { pool, requireAuth: pass, requireSameOrigin: pass, stt: { sttEnabled: () => false }, probe: async () => 12 });
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const form = (withConsent) => {
      const fd = new FormData();
      if (withConsent) { fd.append('consentBy', 'Aziz'); fd.append('consentAt', new Date().toISOString()); fd.append('consentMethod', 'written'); fd.append('consentAck', 'yes'); }
      fd.append('file', new Blob([fakeAudio], { type: 'audio/ogg' }), 'a.ogg');
      return fd;
    };
    try {
      as = { adminId: agent, role: 'student' };
      const before = await count();
      const r = await fetch(`${base}/api/matters/${matter}/interviews`, { method: 'POST', body: form(false) });
      assert.strictEqual(r.status, 422);
      assert.deepStrictEqual((await r.json()).missing.sort(), ['consentAck', 'consentAt', 'consentBy', 'consentMethod']);
      assert.strictEqual(await count(), before);
      const ok = await fetch(`${base}/api/matters/${matter}/interviews`, { method: 'POST', body: form(true) });
      assert.strictEqual(ok.status, 202);
      as = { adminId: client, role: 'user' };
      assert.strictEqual((await fetch(`${base}/api/interviews/${rec.id}`)).status, 404);
      assert.strictEqual((await fetch(`${base}/api/matters/${matter}/interviews`)).status, 404);
      as = { adminId: other, role: 'student' };
      assert.strictEqual((await fetch(`${base}/api/interviews/${rec.id}`)).status, 404);
      assert.strictEqual((await (await fetch(`${base}/api/matters/${matter}/interviews`)).json()).recordings.length, 0);
    } finally { server.close(); }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})();
