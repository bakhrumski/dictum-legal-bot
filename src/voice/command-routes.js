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
 * Nothing is run by parse; run needs the token parse gave this account. No AI,
 * no tariff unit. VOICE_COMMANDS=off stops it (the app then treats the text as
 * typed, as before).
 */

const commands = require('./commands');

function mountVoiceCommandRoutes(app, { requireAuth, requireSameOrigin, pool, matterStore = null }) {
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
    const token = commands.issue(cmd, me(req));
    res.json({ command: { kind: cmd.kind, action: cmd.action, label: cmd.label, route: cmd.route, href: cmd.href, token } });
  }));

  app.post('/api/voice/command/run', requireSameOrigin, requireAuth, guard(async (req, res) => {
    const b = req.body || {};
    const store = matterStore || require('../matters/store').createMatterStore({ db: pool, resolveEntitlement: require('../rag/tariff-ledger').resolveEntitlement });
    const ctx = b.context && typeof b.context === 'object' ? { chatId: b.context.chatId, title: b.context.title } : null;
    const out = await commands.run(b.token, { adminId: me(req), store, db: pool, lastMatterId: b.lastMatterId || null, context: ctx });
    if (!out.ok) return res.status(out.status || 400).json({ error: out.error, message: out.message || null });
    const { ok, ...rest } = out;
    res.json(rest);
  }));
}

module.exports = { mountVoiceCommandRoutes };
