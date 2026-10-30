'use strict';

/**
 * The adaptive account, PR A1 (2026-10-28, docs/design/adaptiv-akkaunt.md;
 * migration 022). Records what a person does as short codes and derives a
 * profile from them with no AI. Nothing here changes an answer: A1 only
 * collects and computes; the profile is read by later PRs (A2 page, A3 UI,
 * A6/A7 answer style and search, each behind its own switch).
 *
 * A signal is never text the person wrote or received:
 *
 *   area      a legal area code of the answer ("mehnat", "ijara" ...)
 *   act       a lex.uz act id cited by the answer, with the act's title
 *   script    the script the question was written in: latn | cyrl
 *   lang      uz | ru
 *   service   chat | telegram | tabular_review | playbook_review | claim_draft | planned
 *   playbook  a built-in playbook key, or "own" for the person's own
 *
 * The profile (user_profile.profile):
 *   areas     [{ code, weight }]          top 8, weights sum to 1
 *   acts      [{ docId, title, weight }]  top 12, an act cited at least twice
 *   script    'latn' | 'cyrl' | null      only when >= 70 % of the questions
 *   lang      'uz' | 'ru' | null          same rule
 *   services  [{ code, weight }]
 *   playbook  the last built-in key used, or null
 * Older signals count less (half-life 60 days) and go after 180 days, so an
 * old habit fades. `manual` (what the person set) always wins; `paused`
 * stops recording and use. ADAPTIVE=off stops recording for everyone.
 * Account deletion removes both tables' rows (deleteAccountProfile).
 */

const KINDS = Object.freeze(['area', 'act', 'script', 'lang', 'service', 'playbook']);
const SERVICES = Object.freeze(['chat', 'telegram', 'tabular_review', 'playbook_review', 'claim_draft', 'planned']);
const HALF_LIFE_DAYS = 60;
const MAX = Object.freeze({ areas: 8, acts: 12, perRequest: 20 });
const keepDays = () => Math.max(7, Math.min(730, Number(process.env.USER_SIGNALS_DAYS) || 180));
const off = () => String(process.env.ADAPTIVE || '').toLowerCase() === 'off';

/** a signal's value as stored, or null when it is not one of the allowed forms (free text never is) */
function cleanSignal(s) {
  if (!s || !KINDS.includes(s.kind)) return null;
  const v = String(s.value == null ? '' : s.value).trim().toLowerCase();
  const label = String(s.label == null ? '' : s.label).replace(/\s+/gu, ' ').trim().slice(0, 160);
  switch (s.kind) {
    case 'area': return /^[a-z][a-z-]{1,30}$/u.test(v) ? { kind: 'area', value: v, label: '' } : null;
    case 'act': return /^\d{3,12}$/u.test(v) ? { kind: 'act', value: v, label } : null;
    case 'script': return ['latn', 'cyrl'].includes(v) ? { kind: 'script', value: v, label: '' } : null;
    case 'lang': return ['uz', 'ru'].includes(v) ? { kind: 'lang', value: v, label: '' } : null;
    case 'service': return SERVICES.includes(v) ? { kind: 'service', value: v, label: '' } : null;
    case 'playbook': return /^(own|[a-z][a-z_]{1,30})$/u.test(v) ? { kind: 'playbook', value: v, label: '' } : null;
    default: return null;
  }
}

/** lex.uz acts an answer cites: [{ docId, title }] from its Markdown links, the link text as the title */
function actsOf(text) {
  const out = new Map();
  for (const m of String(text || '').matchAll(/\[([^\]]{2,200})\]\((https?:\/\/(?:www\.)?lex\.uz\/(?:[a-z]{2}\/)?(?:docs|acts)\/-?(\d+)[^)\s]*)\)/giu)) {
    if (!out.has(m[3])) out.set(m[3], { docId: m[3], title: m[1].replace(/[*_`]/gu, '').replace(/,\s*\d+[-‑]?(?:modda|band|qism).*$/iu, '').trim() });
  }
  return [...out.values()];
}

/** latn | cyrl | null - the letters of a question, not its words */
function scriptOf(text) {
  const t = String(text || '');
  const cyr = (t.match(/[Ѐ-ӿ]/gu) || []).length, lat = (t.match(/[a-z]/giu) || []).length;
  if (cyr + lat < 8) return null;
  return cyr > lat ? 'cyrl' : 'latn';
}

/** The signals of one legal answer (web chat or Telegram). The question's text is read here and dropped. */
function answerSignals({ question, answer, topic, channel = 'web' }) {
  const out = [{ kind: 'service', value: channel === 'telegram' ? 'telegram' : 'chat' }];
  if (topic) out.push({ kind: 'area', value: topic });
  const script = scriptOf(question);
  if (script) out.push({ kind: 'script', value: script });
  // Russian is written in Cyrillic; Uzbek in either - only a clearly Russian question counts as ru
  if (script === 'cyrl' && /[ыэъщ]/iu.test(String(question || ''))) out.push({ kind: 'lang', value: 'ru' });
  else if (script) out.push({ kind: 'lang', value: 'uz' });
  for (const a of actsOf(answer).slice(0, 8)) out.push({ kind: 'act', value: a.docId, label: a.title });
  return out;
}

/** The profile from signals, with no AI. signals: [{ kind, value, label, created_at }]; now in ms. */
function computeProfile(signals = [], { now = Date.now() } = {}) {
  const w = s => Math.pow(0.5, Math.max(0, now - new Date(s.created_at || now).getTime()) / (HALF_LIFE_DAYS * 86400e3));
  const sum = (kind) => {
    const m = new Map();
    for (const s of signals) if (s.kind === kind) { const k = s.value; const e = m.get(k) || { value: k, label: s.label || '', weight: 0, n: 0 }; e.weight += w(s); e.n += 1; if (s.label) e.label = s.label; m.set(k, e); }
    return [...m.values()].sort((a, b) => b.weight - a.weight);
  };
  const share = (list, top) => {
    const total = list.reduce((x, e) => x + e.weight, 0) || 1;
    return list.slice(0, top).map(e => ({ code: e.value, weight: Number((e.weight / total).toFixed(3)) }));
  };
  const majority = (kind) => {
    const list = sum(kind);
    const total = list.reduce((x, e) => x + e.weight, 0);
    return list[0] && total > 0 && list[0].weight / total >= 0.7 && list.reduce((x, e) => x + e.n, 0) >= 3 ? list[0].value : null;
  };
  const acts = sum('act').filter(e => e.n >= 2);
  const actTotal = acts.reduce((x, e) => x + e.weight, 0) || 1;
  const playbooks = signals.filter(s => s.kind === 'playbook' && s.value !== 'own').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return {
    areas: share(sum('area'), MAX.areas),
    acts: acts.slice(0, MAX.acts).map(e => ({ docId: e.value, title: e.label, weight: Number((e.weight / actTotal).toFixed(3)) })),
    script: majority('script'),
    lang: majority('lang'),
    services: share(sum('service'), SERVICES.length),
    playbook: playbooks[0] ? playbooks[0].value : null,
  };
}

const LENGTHS = Object.freeze(['qisqa', 'orta', 'batafsil']);
const ROLES = Object.freeze(['xaridor', 'sotuvchi', 'ijarachi', 'ijaraga_beruvchi', 'ish_beruvchi', 'xodim', 'pudratchi', 'buyurtmachi',
  'qarz_beruvchi', 'qarz_oluvchi', 'tadbirkor', 'jismoniy_shaxs', 'boshqa']);

/**
 * manual (what the person set on the page):
 *   answerLength  qisqa | orta | batafsil
 *   script        latn | cyrl
 *   alphabet      new | old   (the Latin alphabet text is shown in; new by default)
 *   hidden        { areas: [code], acts: [docId] }   items the person removed
 *   partyRoles    [{ area, role }]                    their side, by area - only ever set here
 *   noDeepseek    true                                 "not to DeepSeek" (E6b, src/privacy/provider-choice.js);
 *                                                      kept by "clear" and by a pause - it is a privacy choice, not adaptation
 */
function cleanManual(m = {}) {
  const out = {};
  if (!m || typeof m !== 'object') return out;
  if (LENGTHS.includes(m.answerLength)) out.answerLength = m.answerLength;
  if (['latn', 'cyrl'].includes(m.script)) out.script = m.script;
  // the Latin alphabet text is shown in: the 2026 one (default) or the old one (OʻRQ-1184)
  if (['new', 'old'].includes(m.alphabet)) out.alphabet = m.alphabet;
  if (m.noDeepseek === true) out.noDeepseek = true;
  const h = m.hidden && typeof m.hidden === 'object' ? m.hidden : {};
  const areas = [...new Set((Array.isArray(h.areas) ? h.areas : []).filter(a => /^[a-z][a-z-]{1,30}$/u.test(String(a))))].slice(0, 40);
  const acts = [...new Set((Array.isArray(h.acts) ? h.acts : []).map(String).filter(a => /^\d{3,12}$/u.test(a)))].slice(0, 100);
  if (areas.length || acts.length) out.hidden = { areas, acts };
  const roles = (Array.isArray(m.partyRoles) ? m.partyRoles : [])
    .filter(r => r && /^[a-z][a-z-]{1,30}$/u.test(String(r.area)) && ROLES.includes(r.role))
    .map(r => ({ area: String(r.area), role: r.role }));
  const byArea = new Map(roles.map(r => [r.area, r]));
  if (byArea.size) out.partyRoles = [...byArea.values()].slice(0, 20);
  return out;
}

/** The profile later PRs use: hidden items out, what the person set on top. */
function effectiveOf(profile = {}, manual = {}) {
  const p = profile || {}, m = manual || {};
  const hid = m.hidden || {};
  return {
    areas: (p.areas || []).filter(a => !(hid.areas || []).includes(a.code)),
    acts: (p.acts || []).filter(a => !(hid.acts || []).includes(a.docId)),
    script: m.script || p.script || null,
    lang: p.lang || null,
    services: p.services || [],
    playbook: p.playbook || null,
    answerLength: m.answerLength || null,
    alphabet: m.alphabet || 'new',
    partyRoles: m.partyRoles || [],
  };
}

function createProfileStore({ db }) {
  const pausedCache = new Map(); // adminId -> { at, paused }
  const timers = new Map();      // adminId -> pending recompute

  async function isPaused(adminId) {
    const hit = pausedCache.get(adminId);
    if (hit && Date.now() - hit.at < 60e3) return hit.paused;
    const r = await db.query('SELECT paused FROM user_profile WHERE admin_id = $1', [adminId]);
    const paused = !!(r.rows[0] && r.rows[0].paused);
    pausedCache.set(adminId, { at: Date.now(), paused });
    if (pausedCache.size > 5000) pausedCache.delete(pausedCache.keys().next().value);
    return paused;
  }

  /** Record what one request showed; never throws, never waits for the profile. */
  async function record(adminId, list, { channel = 'web' } = {}) {
    if (off() || !Number.isInteger(Number(adminId)) || Number(adminId) <= 0) return 0;
    try {
      if (await isPaused(Number(adminId))) return 0;
      const rows = (Array.isArray(list) ? list : []).map(cleanSignal).filter(Boolean).slice(0, MAX.perRequest);
      if (!rows.length) return 0;
      const ch = ['web', 'telegram', 'word'].includes(channel) ? channel : 'web';
      const params = [];
      const values = rows.map((s, i) => { params.push(Number(adminId), s.kind, s.value, s.label, ch); const b = i * 5; return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`; });
      await db.query(`INSERT INTO user_signals (admin_id, kind, value, label, channel) VALUES ${values.join(', ')}`, params);
      schedule(Number(adminId));
      return rows.length;
    } catch (e) {
      if (!/relation "user_(signals|profile)" does not exist/u.test(String(e && e.message))) console.warn('[ADAPTIVE] record failed:', e.message);
      return 0;
    }
  }

  // one recompute per person a little after their last signal (one process; the daily sweep catches the rest)
  function schedule(adminId, ms = 20000) {
    clearTimeout(timers.get(adminId));
    const t = setTimeout(() => { timers.delete(adminId); recompute(adminId).catch(e => console.warn('[ADAPTIVE] recompute failed:', e.message)); }, ms);
    if (t.unref) t.unref();
    timers.set(adminId, t);
  }

  async function recompute(adminId, { now = Date.now() } = {}) {
    const r = await db.query(`SELECT kind, value, label, created_at FROM user_signals WHERE admin_id = $1 AND created_at > now() - ($2 || ' days')::interval ORDER BY created_at DESC LIMIT 5000`, [adminId, String(keepDays())]);
    const profile = computeProfile(r.rows, { now });
    await db.query(`INSERT INTO user_profile (admin_id, profile, signals, computed_at, updated_at) VALUES ($1, $2::jsonb, $3, now(), now())
      ON CONFLICT (admin_id) DO UPDATE SET profile = EXCLUDED.profile, signals = EXCLUDED.signals, computed_at = now(), updated_at = now()`,
    [adminId, JSON.stringify(profile), r.rows.length]);
    return profile;
  }

  /** The person's profile as later PRs read it: computed, with what they set themselves on top; null when paused. */
  async function get(adminId) {
    const r = await db.query('SELECT profile, manual, paused, signals, computed_at FROM user_profile WHERE admin_id = $1', [adminId]);
    const row = r.rows[0];
    if (!row) return { profile: null, manual: {}, paused: false, signals: 0, computedAt: null, effective: null };
    return { profile: row.profile, manual: row.manual || {}, paused: row.paused, signals: row.signals, computedAt: row.computed_at,
      effective: row.paused ? null : effectiveOf(row.profile, row.manual) };
  }

  /** What the person set (A2 page): checked field by field; anything else is dropped. */
  async function setManual(adminId, manual) {
    const m = cleanManual(manual);
    await db.query(`INSERT INTO user_profile (admin_id, manual, updated_at) VALUES ($1, $2::jsonb, now())
      ON CONFLICT (admin_id) DO UPDATE SET manual = EXCLUDED.manual, updated_at = now()`, [adminId, JSON.stringify(m)]);
    return get(adminId);
  }

  async function setPaused(adminId, paused) {
    await db.query(`INSERT INTO user_profile (admin_id, paused, updated_at) VALUES ($1, $2, now())
      ON CONFLICT (admin_id) DO UPDATE SET paused = EXCLUDED.paused, updated_at = now()`, [adminId, !!paused]);
    pausedCache.set(adminId, { at: Date.now(), paused: !!paused });
    return get(adminId);
  }

  /** "Hammasini tozalash": every signal, the computed profile and what the person set go; pause stays as it was. */
  async function clear(adminId) {
    await db.query('DELETE FROM user_signals WHERE admin_id = $1', [adminId]);
    // the provider choice is not adaptation: it stays (E6b)
    await db.query(`UPDATE user_profile SET profile = '{}'::jsonb, manual = jsonb_strip_nulls(jsonb_build_object('noDeepseek', manual->'noDeepseek')), signals = 0, computed_at = now(), updated_at = now() WHERE admin_id = $1`, [adminId]);
    return get(adminId);
  }

  /** The person's own recent signals, as stored (codes), newest first. */
  async function signals(adminId, { limit = 50 } = {}) {
    const r = await db.query('SELECT kind, value, label, channel, created_at FROM user_signals WHERE admin_id = $1 ORDER BY created_at DESC LIMIT $2',
      [adminId, Math.max(1, Math.min(200, Number(limit) || 50))]);
    const n = await db.query('SELECT count(*)::int AS n FROM user_signals WHERE admin_id = $1', [adminId]);
    return { rows: r.rows, total: n.rows[0].n, keepDays: keepDays() };
  }

  /** Daily: signals past their days go; profiles of people with signals in the last day are recomputed. */
  async function sweep() {
    const gone = await db.query(`DELETE FROM user_signals WHERE created_at < now() - ($1 || ' days')::interval`, [String(keepDays())]);
    const recent = await db.query(`SELECT DISTINCT admin_id FROM user_signals WHERE created_at > now() - interval '1 day'`);
    for (const row of recent.rows) await recompute(row.admin_id).catch(() => {});
    return { removed: gone.rowCount, recomputed: recent.rows.length };
  }

  return { record, recompute, get, setManual, setPaused, clear, signals, sweep, isPaused };
}

/** Account deletion: the person's signals and profile go. */
async function deleteAccountProfile(db, adminId) {
  await db.query('DELETE FROM user_signals WHERE admin_id = $1', [adminId]);
  await db.query('DELETE FROM user_profile WHERE admin_id = $1', [adminId]);
}

/**
 * Express middleware for /api/legal-chat: when the answer is sent - a JSON
 * reply or the stream's "done" frame - its signals are recorded in the
 * background. The reply goes out unchanged and first; any error here is
 * swallowed. `topic` comes from res.locals.answerTopic (set by the route).
 */
function answerRecorder({ store = null } = {}) {
  return (req, res, next) => {
    if (req.method !== 'POST') return next();
    let done = false;
    const note = (payload) => {
      if (done || !payload || typeof payload.reply !== 'string' || !payload.reply.trim() || !req.session || !req.session.adminId) return;
      done = true;
      const sig = answerSignals({ question: req.body && req.body.message, answer: payload.reply, topic: res.locals.answerTopic, channel: 'web' });
      setImmediate(() => (store || profileStore()).record(req.session.adminId, sig, { channel: 'web' }));
    };
    const json = res.json.bind(res);
    res.json = (body) => { try { if (res.statusCode < 400) note(body); } catch (_) { /* never the reply's problem */ } return json(body); };
    const write = res.write.bind(res);
    res.write = (chunk, ...rest) => {
      try {
        const t = typeof chunk === 'string' ? chunk : '';
        if (t.startsWith('data: {"type":"done"')) note(JSON.parse(t.slice(6)));
      } catch (_) { /* never the stream's problem */ }
      return write(chunk, ...rest);
    };
    next();
  };
}

let shared = null;
/** the process's one store (the bot, the routes and the worker share its timers and cache) */
function profileStore() {
  if (!shared) shared = createProfileStore({ db: require('../database/db').pool });
  return shared;
}

module.exports = { createProfileStore, profileStore, answerRecorder, cleanManual, effectiveOf, LENGTHS, ROLES, deleteAccountProfile, computeProfile, cleanSignal, actsOf, scriptOf, answerSignals, KINDS, SERVICES };
