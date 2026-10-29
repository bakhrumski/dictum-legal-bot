'use strict';

/**
 * Data protection E3 (docs/design/shifrlash-1-bosqich.md §4): personal
 * identifiers are replaced by placeholders before a text goes to an AI
 * provider, and put back in what the provider returns. No AI: rules only.
 *
 *   [PASPORT_1]  passport / ID card     AA1234567, AA 1234567
 *   [JSHSHIR_1]  personal number (14)   only next to "JShShIR / PINFL / ПИНФЛ", or 14 digits starting 3-6
 *   [STIR_1]     tax number (9)         only next to "STIR / INN / ИНН"
 *   [TELEFON_1]  phone                  +998 xx xxx xx xx, 998..., (9x) xxx-xx-xx
 *   [KARTA_1]    bank card (16)         only when the Luhn check passes
 *   [HISOB_1]    account number (20)
 *   [EMAIL_1]    email
 *   [AVTO_1]     car plate              01 A 123 BC, 01 123 ABC
 *   [SHAXS_1]    a person's name        only the names given (the account holder's own)
 *                                       and the words after "F.I.Sh." / "fuqaro"
 *
 * Amounts, dates, article and clause numbers are never touched - a legal
 * answer depends on them and the claim guard checks them.
 *
 * One request keeps one map (the usage-ledger request scope), so every call
 * of a request (digest parts, then the final call) sees the same placeholder
 * for the same value; the map lives in memory only and goes with the request
 * - never in a log, the ledger or the database: only the counts are recorded.
 */

const TAGS = Object.freeze(['PASPORT', 'JSHSHIR', 'STIR', 'TELEFON', 'KARTA', 'HISOB', 'EMAIL', 'AVTO', 'SHAXS']);

function luhn(digits) {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d; alt = !alt;
  }
  return sum % 10 === 0;
}
const onlyDigits = s => String(s).replace(/\D/gu, '');

// Each rule: a regex with the value in group `v` (or the whole match), and an
// optional check. Order matters: longer numbers first, so a card is not read
// as a phone or a personal number.
const RULES = [
  { tag: 'EMAIL', re: /\b(?<v>[\w.+-]+@[\w-]+(?:\.[\w-]+)+)\b/gu },
  { tag: 'HISOB', re: /(?<![\d])(?<v>\d{20})(?![\d])/gu },
  { tag: 'KARTA', re: /(?<![\d])(?<v>\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4})(?![\d])/gu, ok: v => luhn(onlyDigits(v)) },
  { tag: 'JSHSHIR', re: /(?:jshshir|jshir|pinfl|пинфл|жшшир)[\s:№#-]*(?<v>\d{14})(?![\d])/giu },
  { tag: 'JSHSHIR', re: /(?<![\d])(?<v>[3-6]\d{13})(?![\d])/gu },
  { tag: 'STIR', re: /(?:stir|inn|инн|стир)[\s:№#-]*(?<v>\d{9})(?![\d])/giu },
  { tag: 'PASPORT', re: /(?<![A-Za-z])(?<v>[A-Z]{2}\s?\d{7})(?![\d])/gu },
  { tag: 'TELEFON', re: /(?<v>\+?998[\s().-]*\d{2}[\s().-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2})(?![\d])/gu },
  { tag: 'TELEFON', re: /(?<![\d])(?<v>\(\d{2}\)[\s.-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2})(?![\d])/gu },
  { tag: 'AVTO', re: /(?<![\w])(?<v>\d{2}\s?[A-Z]\s?\d{3}\s?[A-Z]{2}|\d{2}\s?\d{3}\s?[A-Z]{3})(?![\w])/gu },
  // the words right after a full-name marker (2-3 capitalised words)
  { tag: 'SHAXS', re: /(?:F\.?\s?I\.?\s?Sh\.?|FISh|[Ff]uqaro|Ф\.?\s?И\.?\s?О\.?|гражданин(?:ка)?)[\s:,-]+(?<v>[A-ZА-ЯЎҚҒҲ][\p{Ll}ʻʼ'’-]+(?:\s+[A-ZА-ЯЎҚҒҲ][\p{Ll}ʻʼ'’-]+){1,2})/gu },
];

function createMap() {
  return { byValue: new Map(), byTag: new Map(), next: Object.fromEntries(TAGS.map(t => [t, 0])), counts: {} };
}

function placeholder(map, tag, value) {
  const key = `${tag}\u0000${value}`;
  if (map.byValue.has(key)) return map.byValue.get(key);
  map.next[tag] += 1;
  const ph = `[${tag}_${map.next[tag]}]`;
  map.byValue.set(key, ph);
  map.byTag.set(ph, value);
  map.counts[tag] = (map.counts[tag] || 0) + 1;
  return ph;
}

const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/**
 * The text with identifiers replaced; `map` is extended. names: full names
 * to hide as well (e.g. the account holder's), each word of 3+ letters.
 */
function redact(text, map = createMap(), { names = [] } = {}) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.re, (...args) => {
      const groups = args[args.length - 1];
      const whole = args[0];
      const v = groups && groups.v != null ? groups.v : whole;
      if (rule.ok && !rule.ok(v)) return whole;
      return whole.replace(v, placeholder(map, rule.tag, v));
    });
  }
  for (const name of names) {
    const n = String(name || '').trim();
    if (n.length < 4 || !/\s/u.test(n)) continue; // a single word is too likely a common word
    out = out.replace(new RegExp(escapeRe(n), 'gu'), m => placeholder(map, 'SHAXS', m));
  }
  return out;
}

/** The provider's text with the placeholders of this map put back. */
function restore(text, map) {
  if (typeof text !== 'string' || !text || !map || !map.byTag.size) return text;
  return text.replace(/\[(PASPORT|JSHSHIR|STIR|TELEFON|KARTA|HISOB|EMAIL|AVTO|SHAXS)_(\d+)\]/gu, ph => (map.byTag.has(ph) ? map.byTag.get(ph) : ph));
}

/** Every string `text` of a messages array redacted (images and other parts untouched). */
function redactMessages(messages, map, opts) {
  if (!Array.isArray(messages)) return messages;
  return messages.map(m => (m && typeof m.text === 'string' ? { ...m, text: redact(m.text, map, opts) } : m));
}

/**
 * Whether the calls of this request are redacted, and its map. Not (yet):
 * the legal-answer pipeline - the web chat (/api/legal-chat), its advanced
 * RAG routes and the Telegram bot - which is E4, done with the owner's
 * consent after a before/after comparison. REDACT_AI=off stops it all.
 */
function forRequest(store, env = process.env) {
  if (String(env.REDACT_AI || 'on').toLowerCase() === 'off') return null;
  if (store) {
    const kind = String(store.kind || '');
    if (store.service === 'telegram') return null;
    if (/\/api\/legal-chat|\/api\/rag\//u.test(kind)) return null;
    if (!store.shared.redaction) store.shared.redaction = createMap();
    return store.shared.redaction;
  }
  return createMap();
}

const countsOf = map => (map && Object.keys(map.counts).length ? { ...map.counts } : null);

/**
 * withRedaction(messages, options, run): run(redactedMessages, options +
 * detail.redacted counts) and the text it returns restored. current(): the
 * usage-ledger request scope; loadName(userId): the account holder's full
 * name (read once per request).
 */
function createWrapper({ current = () => null, loadName = async () => null, env = process.env } = {}) {
  async function scope() {
    const store = current();
    const map = forRequest(store, env);
    if (!map) return null;
    if (store && store.shared.redactNames === undefined) {
      store.shared.redactNames = [];
      const uid = store.userIdOf && store.userIdOf();
      if (uid) {
        try { const n = await loadName(uid); if (n) store.shared.redactNames = [n]; } catch (_) { /* the rules alone */ }
      }
    }
    return { map, names: (store && store.shared.redactNames) || [] };
  }
  return async function withRedaction(messages, options, run) {
    const sc = await scope();
    if (!sc) return run(messages, options);
    const msgs = redactMessages(messages, sc.map, { names: sc.names });
    // the call's ledger row says how many of each were hidden (never the values)
    const counts = countsOf(sc.map);
    const opts = counts ? { ...options, detail: { ...(options && options.detail), redacted: counts } } : options;
    const result = await run(msgs, opts);
    return result && typeof result.text === 'string' ? { ...result, text: restore(result.text, sc.map) } : result;
  };
}

module.exports = { TAGS, createMap, redact, restore, redactMessages, forRequest, countsOf, createWrapper, luhn };
