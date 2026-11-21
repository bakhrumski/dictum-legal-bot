'use strict';

/**
 * Voice commands level 2 over HTTP (V1, docs/design/ovozli-buyruqlar-2.md §4):
 *
 *   POST /api/voice/command/parse { text, place: 'chat'|'matters', voice, lang }
 *        -> { command: null } | { command: { kind, action, label, route?, href?, token } }
 *   POST /api/voice/command/run   { token, lastMatterId, context: { chatId, title } }
 *        -> open / blocked: { route | href } (the page goes there);
 *           matter: what src/matters/commands.js answers (its own confirmations stay);
 *           context: copy / Word / analysis are done by the page; attaching the
 *           chat to a named matter is written here (else the page's picker)
 *
 *   POST /api/voice/command/event { token, outcome: 'as_question'|'cancel' }
 *        -> the card was sent as a question or cancelled (V5): counted, the token dropped
 *   GET  /api/admin/voice-commands?days=7 (master): the weekly counts
 *
 * Every shown, run, cancelled or questioned command is one code-only row
 * (src/voice/command-events.js; no text, no account).
 * Nothing is run by parse; run needs the token parse gave this account. No AI,
 * no tariff unit. VOICE_COMMANDS=off stops it (the app then treats the text as
 * typed, as before).
 */

const commands = require('./commands');
const events = require('./command-events');

function mountVoiceCommandRoutes(app, { requireAuth, requireSameOrigin, requireMasterAdmin = null, pool, matterStore = null }) {
  const off = () => String(process.env.VOICE_COMMANDS || '').toLowerCase() === 'off';
  const me = req => req.session.adminId;
  const guard = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (off()) return res.status(503).json({ error: 'unavailable' });
    try { await fn(req, res); } catch (e) {
      console.error('[VOICE-CMD]', req.path, e.message);
      if (!res.headersSent) res.status(500).json({ error: 'failed' });
    }
  };

  app.post('/api/voice/command/parse', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const b = req.body || {};
    const place = ['chat', 'matters'].includes(b.place) ? b.place : 'chat';
    const cmd = commands.parse(b.text, { place, voice: b.voice === true });
    if (!cmd) return res.json({ command: null });
    const via = b.voice === true ? 'voice' : 'text';
    const token = commands.issue(cmd, me(req), Date.now(), { place, via });
    events.note(pool, { place, kind: cmd.kind, action: cmd.action, outcome: 'shown', via, lang: cmd.lang });
    res.json({ command: { kind: cmd.kind, action: cmd.action, label: cmd.label, route: cmd.route, href: cmd.href, token } });
  }));

  app.post('/api/voice/command/run', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const b = req.body || {};
    const store = matterStore || require('../matters/store').createMatterStore({ db: pool, resolveEntitlement: require('../rag/tariff-ledger').resolveEntitlement });
    const ctx = b.context && typeof b.context === 'object' ? { chatId: b.context.chatId, title: b.context.title } : null;
    const held = commands.peek(b.token, me(req));
    const out = await commands.run(b.token, { adminId: me(req), store, db: pool, lastMatterId: b.lastMatterId || null, context: ctx });
    if (!out.ok) return res.status(out.status || 400).json({ error: out.error, message: out.message || null });
    // run, or run and it asked something back (a name, a matter to pick, a confirmation)
    if (held) events.note(pool, { ...held, outcome: out.needsTitle || out.needsPick || out.confirm ? 'ask' : 'run' });
    const { ok, ...rest } = out;
    res.json(rest);
  }));

  app.post('/api/voice/command/event', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const b = req.body || {};
    const outcome = ['as_question', 'cancel'].includes(b.outcome) ? b.outcome : null;
    if (!outcome) return res.status(400).json({ error: 'outcome' });
    const held = commands.peek(b.token, me(req));
    if (held) {
      commands.drop(b.token, me(req));
      events.note(pool, { ...held, outcome });
    }
    res.json({ ok: true });
  }));

  if (requireMasterAdmin) {
    app.get('/api/admin/voice-commands', requireMasterAdmin, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try { res.json(await events.summary(pool, { days: req.query.days })); } catch (e) {
        if (/does not exist/u.test(String(e && e.message))) return res.json({ days: 7, items: [], total: null, unavailable: true });
        console.error('[VOICE-CMD] summary failed:', e.message);
        res.status(500).json({ error: 'failed' });
      }
    });
  }
}

module.exports = { mountVoiceCommandRoutes };
