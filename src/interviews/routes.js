'use strict';

/**
 * Interview recordings over HTTP (2026-10-28, CustDev stage 4; src/interviews/store.js).
 * Staff only (master / student / lawyer, the role read in the database); a
 * recording is seen by its uploader and a master only. INTERVIEWS=off stops it.
 *
 *   GET    /api/interviews/notice                       the consent text the page shows
 *   POST   /api/matters/:id/interviews  multipart {file, consentBy, consentAt, consentMethod, consentNote, consentAck='yes', title, clientId, lang}
 *          -> 202 { recording }: refused (422) without the consent, before anything is stored; transcribed in the background
 *   GET    /api/matters/:id/interviews                  own recordings of that Matter (a master: all)
 *   GET    /api/interviews/:id                          the recording, latest transcript, versions, events
 *   PUT    /api/interviews/:id/transcript  { body }     a corrected transcript = a new version
 *   POST   /api/interviews/:id/summary                  optional AI summary (quotes checked word for word)
 *   POST   /api/interviews/:id/retry                    transcribe again after a failure (while the audio is kept)
 *   DELETE /api/interviews/:id/audio                    delete the audio now (the transcript stays)
 */

const multer = require('multer');
const store = require('./store');

const off = () => String(process.env.INTERVIEWS || '').toLowerCase() === 'off';

function mountInterviewRoutes(app, { pool, requireAuth, requireSameOrigin, ai, usageLedger = require('../ai/usage-ledger'), stt = require('../ai/stt'), probe = require('../ai/audio-duration').probeAudioSeconds, logAudit = () => {} }) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: store.limits().maxBytes },
    fileFilter: (req, file, cb) => {
      const ok = /^audio\//.test(file.mimetype) || /\.(ogg|oga|opus|mp3|m4a|wav|webm|aac|flac)$/i.test(file.originalname || '');
      cb(ok ? null : new Error('Faqat audio fayl'), ok);
    },
  });
  const me = req => req.session.adminId;
  const guard = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (off()) return res.status(404).json({ error: 'not_found' });
    try { await fn(req, res); } catch (e) {
      if (/does not exist/u.test(String(e && e.message))) return res.status(503).json({ error: 'unavailable' });
      console.error('[INTERVIEW]', req.method, req.path, e.message);
      if (!res.headersSent) res.status(500).json({ error: 'failed' });
    }
  };
  const staffOnly = async (req, res, next) => {
    try {
      const r = await pool.query('SELECT role FROM admins WHERE id = $1', [me(req)]);
      if (r.rows[0] && ['master', 'student', 'lawyer'].includes(r.rows[0].role)) return next();
    } catch (_) { /* below */ }
    res.status(404).json({ error: 'not_found' });
  };
  const reply = (res, out, okStatus = 200) => (out.ok ? res.status(okStatus).json(out) : res.status(out.status || 400).json({ error: out.error, message: out.message || null, missing: out.missing }));
  const uuid = v => (/^[0-9a-f-]{36}$/iu.test(String(v || '')) ? String(v) : '00000000-0000-0000-0000-000000000000');

  // speech to text in the background, as its own usage request (the ledger's stt rows)
  const transcribeLater = (id, userId) => setImmediate(() => {
    usageLedger.runWithRequest({ service: 'interview', kind: 'interview stt', userId,
      budget: { maxCalls: 40, maxMs: 30 * 60e3, maxCostUsd: Number(process.env.INTERVIEW_MAX_COST_USD) || 3 } },
    () => store.transcribe(pool, { id, stt })).catch(e => console.warn('[INTERVIEW] transcription failed:', e.message));
  });

  app.get('/api/interviews/notice', requireAuth, staffOnly, guard(async (req, res) => {
    res.json({ text: store.consentText(), methods: store.CONSENT_METHODS, audioDays: store.limits().audioDays });
  }));

  app.post('/api/matters/:id/interviews', requireSameOrigin, requireAuth, staffOnly, (req, res, next) => {
    upload.single('file')(req, res, err => (err ? res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'too_large' : 'bad_file', message: err.code === 'LIMIT_FILE_SIZE' ? 'Fayl juda katta' : err.message }) : next()));
  }, guard(async (req, res) => {
    const b = req.body || {};
    const consent = { by: b.consentBy, at: b.consentAt, method: b.consentMethod, note: b.consentNote, ack: b.consentAck === 'yes' || b.consentAck === 'true' };
    // the consent first: without it nothing is measured, stored or sent anywhere
    const c = store.checkConsent(consent);
    if (!c.ok) return res.status(422).json({ error: 'consent_required', message: "Rozilik ma'lumotlari to'liq emas", missing: c.missing });
    if (!req.file || !req.file.buffer || !req.file.buffer.length) return res.status(400).json({ error: 'audio_required' });
    const measured = await probe(req.file.buffer);
    const out = await store.create(pool, {
      actorId: me(req), matterId: uuid(req.params.id), audio: req.file.buffer, mime: (req.file.mimetype || 'audio/ogg').split(';')[0],
      durationSec: measured == null ? 0 : Math.max(1, Math.round(measured)), consent, title: b.title, clientId: Number(b.clientId) || null, language: b.lang,
    });
    if (!out.ok) return reply(res, out);
    logAudit(req, 'interview.upload', 'interview', null);
    if (stt.sttEnabled()) transcribeLater(out.recording.id, me(req));
    else await pool.query(`UPDATE interview_recordings SET status = 'failed', error = 'stt_not_configured' WHERE id = $1`, [out.recording.id]);
    res.status(202).json({ ok: true, recording: { id: out.recording.id, status: stt.sttEnabled() ? 'queued' : 'failed' } });
  }));

  app.get('/api/matters/:id/interviews', requireAuth, staffOnly, guard(async (req, res) => {
    res.json({ recordings: await store.list(pool, { matterId: uuid(req.params.id), actorId: me(req) }) });
  }));
  app.get('/api/interviews/:id', requireAuth, staffOnly, guard(async (req, res) => {
    reply(res, await store.get(pool, { id: uuid(req.params.id), actorId: me(req) }));
  }));
  app.put('/api/interviews/:id/transcript', requireSameOrigin, requireAuth, staffOnly, guard(async (req, res) => {
    reply(res, await store.addVersion(pool, { id: uuid(req.params.id), actorId: me(req), body: req.body && req.body.body }));
  }));
  app.post('/api/interviews/:id/summary', requireSameOrigin, requireAuth, staffOnly, guard(async (req, res) => {
    if (typeof ai !== 'function') return res.status(501).json({ error: 'ai_unavailable' });
    const out = await usageLedger.runWithRequest({ service: 'interview', kind: 'interview summary', userId: me(req), budget: { maxCalls: 4, maxMs: 120e3 } },
      () => store.summarize(pool, { id: uuid(req.params.id), actorId: me(req), ai }));
    reply(res, out);
  }));
  app.post('/api/interviews/:id/retry', requireSameOrigin, requireAuth, staffOnly, guard(async (req, res) => {
    const rec = await store.visible(pool, uuid(req.params.id), me(req));
    if (!rec) return res.status(404).json({ error: 'not_found' });
    if (rec.status !== 'failed' || rec.audio_deleted_at) return res.status(409).json({ error: 'not_failed' });
    if (!stt.sttEnabled()) return res.status(501).json({ error: 'stt_not_configured' });
    transcribeLater(rec.id, me(req));
    res.status(202).json({ ok: true });
  }));
  app.delete('/api/interviews/:id/audio', requireSameOrigin, requireAuth, staffOnly, guard(async (req, res) => {
    const out = await store.deleteAudio(pool, { id: uuid(req.params.id), actorId: me(req), reason: 'manual' });
    if (out.ok) logAudit(req, 'interview.audio_delete', 'interview', null);
    reply(res, out);
  }));
}

/** The hourly retention sweep (audio INTERVIEW_AUDIO_DAYS after the transcript). */
function startInterviewSweep(pool, { everyMs = 60 * 60e3 } = {}) {
  const run = () => store.purgeDue(pool).then(n => { if (n) console.log(`[INTERVIEW] audio deleted by retention: ${n}`); })
    .catch(e => { if (!/does not exist/u.test(String(e && e.message))) console.warn('[INTERVIEW] retention sweep failed:', e.message); });
  const t = setInterval(run, everyMs);
  if (t.unref) t.unref();
  setTimeout(run, 60e3).unref?.();
  return t;
}

module.exports = { mountInterviewRoutes, startInterviewSweep };
