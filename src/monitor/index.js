'use strict';

/**
 * Monitoring (S4, docs/design/sud-amaliyoti.md). No AI.
 *
 * Once a Tashkent day (after MONITOR_HOUR, 9):
 *   1. collect - for every open matter whose owner has a linked Telegram and
 *      has not switched it off: the lex.uz acts its chats (the answers'
 *      citator and lex.uz links) and agent results link, with the articles
 *      the citator named. Ids and numbers only; the chats are opened in
 *      memory, nothing of their text is kept or sent.
 *   2. refresh - each watched act whose citator row is older than 20 h is
 *      read again from lex.uz: one page at a time, a pause between, at most
 *      LEX_MONITOR_MAX_READS (40) a day, the page size limit of live search;
 *      the row is written by the citator (src/citator/store.js).
 *   3. compare - against what the owner was last told about that act in that
 *      matter (or first saw, which is no news): lex.uz now shows it not in
 *      force; a watched article's latest change note is newer; for an act
 *      watched without articles, a newer amending publication; a Plenum
 *      decision fetched since then naming a watched article of that code.
 *   4. send - one Telegram message per person per day with every matter's
 *      news (matter title, act, what changed, link) and a "🔕" button; the
 *      baseline moves only after the message went out. A matter's text,
 *      notes or chats are never in it.
 *
 * LEX_MONITOR=off stops it; a person's own switch is lex_monitor_settings.
 * Dates are lex.uz's publication dates, not the day a change took effect.
 */

const { linkedIds } = require('../citator/answer');
const citatorStore = require('../citator/store');
const { actKey, articleSet } = require('../plenum/acts');
const P = require('../plenum/answer');

const DAY_MS = 864e5;
const off = () => String(process.env.LEX_MONITOR || '').toLowerCase() === 'off';
const maxReads = () => Math.max(0, Number(process.env.LEX_MONITOR_MAX_READS) || 40);
const pauseMs = () => Math.max(0, Number(process.env.LEX_MONITOR_PAUSE_MS) || 1500);
const hourFrom = () => Math.min(23, Math.max(0, Number(process.env.MONITOR_HOUR) || 9));
const PAGE_MAX_BYTES = () => Math.max(256, Number(process.env.LEX_PAGE_MAX_KB) || 7000) * 1024;
const REFRESH_AFTER_MS = 20 * 3600e3;
const MAX_MATTERS = 2000;
const MAX_ACTS_PER_MATTER = 30;

const tashkentDay = (t = Date.now()) => new Date(t + 5 * 3600e3).toISOString().slice(0, 10);
const tashkentHour = (t = Date.now()) => new Date(t + 5 * 3600e3).getUTCHours();
const day = d => (d ? new Date(d).toISOString().slice(0, 10) : null);
const fmt = d => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isMissing = e => /does not exist/u.test(String(e && e.message));

/** The acts one matter's items link: Map(lexId -> Set(units)). Pure on the opened values. */
function actsFromValues({ chats = [], results = [] }) {
  const out = new Map();
  const add = (id, units = []) => {
    if (!id) return;
    if (!out.has(id)) out.set(id, new Set());
    units.forEach(u => u && out.get(id).add(String(u)));
  };
  for (const messages of chats) {
    for (const m of Array.isArray(messages) ? messages : []) {
      if (!m || m.role === 'user') continue;
      for (const c of Array.isArray(m.citator) ? m.citator : []) add(Math.abs(Number(c.lexId)) || null, (c.units || []).map(u => u && u.n));
      linkedIds(m.text || '').forEach(id => add(id));
    }
  }
  for (const r of results) linkedIds(typeof r === 'string' ? r : JSON.stringify(r || {})).forEach(id => add(id));
  return out;
}

function createMonitor({ db, send, fetchDoc = null, log = m => console.warn(m), appUrl = h => `https://juristai.uz/app/${h}` } = {}) {
  const fetchLex = fetchDoc || ((url, opts) => require('../rag/fetch-lex').fetchLexDocument(url, opts));
  let running = false;
  let lastDay = null;

  /** Open matters of people with Telegram who have not switched it off. */
  async function matters() {
    return (await db.query(
      `SELECT m.id, m.owner_id, m.title, COALESCE(a.telegram_chat_id, a.telegram_user_id) AS chat
         FROM matters m JOIN admins a ON a.id = m.owner_id
        WHERE m.deleted_at IS NULL AND m.status = 'open'
          AND COALESCE(a.telegram_chat_id, a.telegram_user_id) IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM lex_monitor_settings s WHERE s.admin_id = m.owner_id AND s.off)
        ORDER BY m.updated_at DESC LIMIT ${MAX_MATTERS}`)).rows;
  }

  async function collect(m) {
    const { openMessages } = require('../privacy/chat-sessions');
    const items = (await db.query(`SELECT kind, ref_int, ref_uuid FROM matter_items WHERE matter_id = $1 AND kind IN ('chat', 'agent_run')`, [m.id])).rows;
    const chatIds = items.filter(i => i.kind === 'chat').map(i => i.ref_int);
    const runIds = items.filter(i => i.kind === 'agent_run').map(i => i.ref_uuid);
    const chats = [];
    if (chatIds.length) {
      const r = await db.query('SELECT messages FROM ai_chat_sessions WHERE id = ANY($1::bigint[]) AND admin_id = $2', [chatIds, m.owner_id]).catch(() => ({ rows: [] }));
      for (const row of r.rows) { try { chats.push(openMessages(row.messages, m.owner_id)); } catch (e) { log(`[MONITOR] chat unreadable: ${e.message}`); } }
    }
    const results = [];
    if (runIds.length) {
      const { openResult } = require('../agents/runs/store');
      const r = await db.query('SELECT id, result FROM agent_runs WHERE id = ANY($1::uuid[]) AND admin_id = $2 AND result IS NOT NULL', [runIds, m.owner_id]).catch(() => ({ rows: [] }));
      for (const row of r.rows) { try { results.push(openResult(row.id, row.result)); } catch (e) { log(`[MONITOR] result unreadable: ${e.message}`); } }
    }
    return actsFromValues({ chats, results });
  }

  /** Writes the matter's watch rows (new ones not yet baselined), drops acts no longer linked. */
  async function syncWatch(m, acts) {
    const list = [...acts.entries()].slice(0, MAX_ACTS_PER_MATTER);
    for (const [lexId, units] of list) {
      await db.query(
        `INSERT INTO lex_monitor_watch (matter_id, lex_id, units) VALUES ($1, $2, $3::text[])
         ON CONFLICT (matter_id, lex_id) DO UPDATE SET units = (SELECT array_agg(DISTINCT u) FROM unnest(lex_monitor_watch.units || EXCLUDED.units) u), updated_at = now()`,
        [m.id, lexId, [...units]]);
    }
    await db.query('DELETE FROM lex_monitor_watch WHERE matter_id = $1 AND NOT (lex_id = ANY($2::int[]))', [m.id, list.map(x => x[0])]);
  }

  /** Re-reads stale acts from lex.uz (bounded); returns { read, failed }. */
  async function refresh(ids) {
    const out = { read: 0, failed: 0, skipped: 0 };
    if (!ids.length) return out;
    const rows = await citatorStore.rowsFor(db, ids);
    const due = ids.filter(id => !rows.get(id) || Date.now() - new Date(rows.get(id).checked_at).getTime() > REFRESH_AFTER_MS);
    for (const id of due) {
      if (out.read + out.failed >= maxReads()) { out.skipped += 1; continue; }
      const url = `https://lex.uz/docs/-${id}`;
      try {
        const doc = await fetchLex(url, { maxBytes: PAGE_MAX_BYTES() });
        const row = citatorStore.rowOf(url, doc.rawHtml, doc);
        if (row) await citatorStore.writeRow(db, row);
        out.read += 1;
      } catch (e) { out.failed += 1; log(`[MONITOR] read ${id}: ${e.message}`); }
      if (pauseMs()) await sleep(pauseMs());
    }
    return out;
  }

  /** New Plenum decisions (fetched after `since`) naming (code, unit): Map(pair -> [{ name, url, bands }]). */
  async function newPlenum(pairs, since) {
    const out = new Map();
    if (!pairs.size || !since) return out;
    const nums = [...new Set([...pairs].map(p => p.split(':')[1].split('-')[0]))].slice(0, 60);
    let rows;
    try {
      rows = (await db.query(
        `SELECT b.decision_id, b.n, b.article_refs, d.lex_id, d.lat_lex_id, d.court, d.number, d.adopted_on, d.fetched_at
           FROM plenum_bands b JOIN plenum_decisions d ON d.lex_id = b.decision_id
          WHERE b.lang = 'lat' AND b.n > 0 AND d.in_force AND NOT d.is_amendment AND d.fetched_at > $1
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(b.article_refs) r WHERE r->>'act' IS NOT NULL
                         AND (substring(r->>'n' from '^[0-9]+') = ANY($2::text[]) OR r->>'n' ~ '[–—-]'))
          LIMIT 2000`, [since, nums])).rows;
    } catch (e) { return out; }
    for (const r of rows) {
      for (const ref of Array.isArray(r.article_refs) ? r.article_refs : []) {
        const key = actKey(ref.act, 'lat');
        if (!key) continue;
        for (const a of articleSet(ref.n)) {
          const pair = `${key}:${P.artKey(a)}`;
          if (!pairs.has(pair)) continue;
          const list = out.get(pair) || [];
          const d = list.find(x => x.id === r.decision_id);
          if (d) { if (!d.bands.includes(r.n)) d.bands.push(r.n); } else list.push({ id: r.decision_id, name: P.decisionName(r, 'lat'), url: P.urlOf(r, 'lat'), bands: [r.n] });
          out.set(pair, list);
        }
      }
    }
    return out;
  }

  /** The news of one matter's watch rows against their citator rows: [{ lexId, title, url, kind, unit, date, by, plenum }]. */
  function newsOf(watch, citator, plenumNew) {
    const news = [];
    for (const w of watch) {
      const c = citator.get(w.lex_id);
      if (!c || !w.seen_plenum) continue; // not baselined yet
      const title = String(c.title || '').replace(/^O['ʻ‘’]?zbekiston Respublikasining\s+/iu, '').slice(0, 90);
      const url = `https://lex.uz/docs/-${w.lex_id}`;
      if (c.in_force === false && w.seen_in_force !== false) news.push({ lexId: w.lex_id, title, url, kind: 'not_in_force', label: c.status_label || null });
      const units = w.units || [];
      const seen = w.seen_units || {};
      for (const u of units) {
        const now = c.units && c.units[u] ? c.units[u] : null;
        // an article first watched now is its baseline, not news (fillUnits)
        if (now && seen[u] && now.date > seen[u]) news.push({ lexId: w.lex_id, title, url, kind: 'unit', unit: u, unitKind: now.kind, date: now.date, by: now.by });
      }
      if (!units.length && c.last_change && (!w.seen_change || day(c.last_change) > day(w.seen_change))) news.push({ lexId: w.lex_id, title, url, kind: 'act', date: day(c.last_change) });
      const code = actKey(c.title || '', 'lat');
      if (code) for (const u of units) for (const d of plenumNew.get(`${code}:${u}`) || []) news.push({ lexId: w.lex_id, title, url, kind: 'plenum', unit: u, unitKind: 'modda', plenum: d });
    }
    return news;
  }

  /** The digest text for one person: { text, count }. */
  function digestText(groups, today) {
    const lines = [`📜 Ishlaringizdagi qonunchilik o'zgarishlari (${fmt(today)})`, ''];
    let count = 0;
    for (const g of groups) {
      lines.push(`«${g.title}» ishi:`);
      for (const n of g.news.slice(0, 8)) {
        count += 1;
        const unit = n.unit ? `, ${n.unit}-${n.unitKind || 'modda'}` : '';
        if (n.kind === 'not_in_force') lines.push(`• ${n.title}: lex.uz'da kuchini yo'qotgan deb ko'rsatildi${n.label ? ` (${n.label})` : ''}\n  ${n.url}`);
        else if (n.kind === 'unit') lines.push(`• ${n.title}${unit}: ${fmt(n.date)} da o'zgartirilgan${n.by ? ` (${n.by})` : ''}\n  ${n.url}`);
        else if (n.kind === 'act') lines.push(`• ${n.title}: yangi o'zgartirish e'lon qilingan (${fmt(n.date)})\n  ${n.url}`);
        else if (n.kind === 'plenum') lines.push(`• ${n.title}${unit}: yangi Plenum tushuntirishi — ${n.plenum.name}, ${n.plenum.bands.slice(0, 3).join(', ')}-band\n  ${n.plenum.url}`);
      }
      if (g.news.length > 8) lines.push(`• yana ${g.news.length - 8} ta o'zgarish — ishni oching`);
      lines.push('');
    }
    lines.push("Sana — lex.uz'dagi e'lon sanasi. Ishlaringiz matni bu xabarga kiritilmaydi.");
    return { text: lines.join('\n'), count };
  }

  /** Moves a matter's baseline to what the citator shows now (no news is sent for it). */
  async function baseline(w, c, at = new Date()) {
    const units = {};
    for (const u of w.units || []) if (c && c.units && c.units[u]) units[u] = c.units[u].date;
    await db.query(
      `UPDATE lex_monitor_watch SET seen_change = $3::date, seen_in_force = $4, seen_units = $5::jsonb, seen_plenum = $6, updated_at = now()
        WHERE matter_id = $1 AND lex_id = $2`,
      [w.matter_id, w.lex_id, c && c.last_change ? day(c.last_change) : null, c ? c.in_force : null, JSON.stringify(units), at]);
  }

  /** Articles a matter began to cite after its baseline: their current dates, silently. */
  async function fillUnits(watch, citator) {
    for (const w of watch) {
      const c = citator.get(w.lex_id);
      if (!c || !w.seen_plenum) continue;
      const add = {};
      for (const u of w.units || []) if (!(w.seen_units || {})[u] && c.units && c.units[u]) add[u] = c.units[u].date;
      if (Object.keys(add).length) await db.query('UPDATE lex_monitor_watch SET seen_units = seen_units || $3::jsonb WHERE matter_id = $1 AND lex_id = $2', [w.matter_id, w.lex_id, JSON.stringify(add)]);
    }
  }

  /** One full run. `now` for tests. Returns the report. */
  async function run({ now = Date.now(), force = false } = {}) {
    const report = { matters: 0, acts: 0, refresh: null, people: 0, sent: 0, failed: 0, news: 0, skippedToday: 0 };
    if (off() || running) return { ...report, off: off(), running };
    running = true;
    try {
      const today = tashkentDay(now);
      const ms = await matters();
      report.matters = ms.length;
      const watched = new Set();
      for (const m of ms) {
        try {
          const acts = await collect(m);
          await syncWatch(m, acts);
          acts.forEach((_, id) => watched.add(id));
        } catch (e) { log(`[MONITOR] matter ${m.id}: ${e.message}`); }
      }
      report.acts = watched.size;
      report.refresh = await refresh([...watched]);
      const citator = await citatorStore.rowsForAll(db, [...watched]);
      const byOwner = new Map();
      for (const m of ms) {
        if (!byOwner.has(m.owner_id)) byOwner.set(m.owner_id, { chat: m.chat, matters: [] });
        byOwner.get(m.owner_id).matters.push(m);
      }
      for (const [ownerId, o] of byOwner) {
        const groups = [];
        const toMove = [];
        for (const m of o.matters) {
          const watch = (await db.query('SELECT * FROM lex_monitor_watch WHERE matter_id = $1', [m.id])).rows;
          // first sight is no news: the act as it stands is the baseline
          for (const w of watch.filter(x => !x.seen_plenum && citator.get(x.lex_id))) await baseline(w, citator.get(w.lex_id), new Date(now));
          const pairs = new Set();
          for (const w of watch) {
            const code = actKey((citator.get(w.lex_id) || {}).title || '', 'lat');
            if (code && w.seen_plenum) (w.units || []).forEach(u => pairs.add(`${code}:${u}`));
          }
          const since = watch.map(w => w.seen_plenum).filter(Boolean).sort((a, b) => a - b)[0] || null;
          const plenumNew = await newPlenum(pairs, since);
          const news = newsOf(watch, citator, plenumNew);
          await fillUnits(watch, citator);
          if (news.length) { groups.push({ id: m.id, title: String(m.title).slice(0, 120), news }); toMove.push(...watch.filter(w => news.some(n => n.lexId === w.lex_id))); }
        }
        if (!groups.length) continue;
        report.people += 1;
        report.news += groups.reduce((n, g) => n + g.news.length, 0);
        const claim = await db.query('INSERT INTO lex_monitor_digests (admin_id, day, items) VALUES ($1, $2::date, $3) ON CONFLICT DO NOTHING RETURNING admin_id', [ownerId, today, groups.length]);
        if (!claim.rows.length && !force) { report.skippedToday += 1; continue; }
        const { text } = digestText(groups, today);
        try {
          await send(o.chat, text, {
            disable_web_page_preview: true,
            reply_markup: { inline_keyboard: [[{ text: '📂 Ishlarim', url: appUrl(groups.length === 1 ? `#/ishlar/${groups[0].id}` : '#/ishlar') }], [{ text: "🔕 Bu xabarlarni o'chirish", callback_data: 'lxm_off' }]] },
          });
          report.sent += 1;
          for (const w of toMove) await baseline(w, citator.get(w.lex_id), new Date(now));
        } catch (e) {
          report.failed += 1;
          log(`[MONITOR] send to ${ownerId}: ${e.message}`);
          await db.query('DELETE FROM lex_monitor_digests WHERE admin_id = $1 AND day = $2::date', [ownerId, today]).catch(() => {});
        }
      }
      return report;
    } catch (e) {
      if (isMissing(e)) return { ...report, error: 'tables missing' };
      throw e;
    } finally { running = false; }
  }

  /** A person's switch: off = no digests; on again starts from the acts as they stand (no backlog). */
  async function setOff(adminId, value) {
    await db.query(`INSERT INTO lex_monitor_settings (admin_id, off, updated_at) VALUES ($1, $2, now())
                    ON CONFLICT (admin_id) DO UPDATE SET off = EXCLUDED.off, updated_at = now()`, [adminId, !!value]);
    if (!value) await db.query('DELETE FROM lex_monitor_watch WHERE matter_id IN (SELECT id FROM matters WHERE owner_id = $1)', [adminId]);
    return { off: !!value };
  }
  async function isOff(adminId) {
    try { return !!((await db.query('SELECT off FROM lex_monitor_settings WHERE admin_id = $1', [adminId])).rows[0] || {}).off; } catch (e) { return false; }
  }

  /** Hourly tick: the day's run after MONITOR_HOUR, once a day in this process (the digests table keeps one per person). */
  function start() {
    if (off()) return null;
    const tick = () => {
      const t = Date.now();
      if (tashkentHour(t) < hourFrom() || lastDay === tashkentDay(t) || running) return;
      lastDay = tashkentDay(t);
      run().then(r => log(`[MONITOR] ${JSON.stringify(r)}`)).catch(e => log(`[MONITOR] run failed: ${e.message}`));
    };
    const first = setTimeout(tick, 5 * 60e3); if (first.unref) first.unref();
    const timer = setInterval(tick, 3600e3); if (timer.unref) timer.unref();
    return timer;
  }

  return { run, start, setOff, isOff, collect, newsOf, digestText, isRunning: () => running };
}

module.exports = { createMonitor, actsFromValues, tashkentDay };
