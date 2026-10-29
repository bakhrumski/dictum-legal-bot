'use strict';

/**
 * Blind index (E6, docs/design/shifrlash-1-bosqich.md §3.2, §9 answer 1):
 * a sealed text cannot be searched with ILIKE, so next to it the server keeps
 * the keyed hashes of its word roots. A search hashes its own words the same
 * way and asks for rows holding all of them (`bidx @> ARRAY[...]`).
 *
 *   word      letters and digits, both alphabets folded (Ö = O', Ş = sh ...),
 *             lower case; 3+ characters (a number: 2+)
 *   root      a word's first ROOT_LEN (5) characters, so "shartnoma",
 *             "shartnomaga" and "shartnomani" meet; a number whole
 *   hash      HMAC-SHA256 with a key derived from DATA_KEYS
 *             (crypto.derivedKey('blind-index')), the first 16 hex characters
 *
 * What it can do: whole-word (root) search, every word of the query present.
 * What it cannot: part of a word, a phrase in order, a typo. What it leaks:
 * whether two rows share a root (and how often a root is used) to someone
 * reading the database, never the word itself without the key.
 * No DATA_KEYS -> no index (tokens() is null) and search stays ILIKE on the
 * plain text.
 */

const crypto = require('crypto');
const privacy = require('./crypto');
const alphabet = require('../../public/js/uz-alphabet');

const ROOT_LEN = 5;
const MAX_TOKENS = 400;
let cached = null;
function key() {
  if (!privacy.enabled()) return null;
  if (!cached) cached = privacy.derivedKey('blind-index');
  return cached;
}
/** Tests: forget the derived key after DATA_KEYS changed. */
function reset() { cached = null; }

function roots(text) {
  const folded = String(alphabet.fold ? alphabet.fold(String(text || '')) : text).toLowerCase();
  const out = new Set();
  for (const w of folded.split(/[^\p{L}\p{N}]+/u)) {
    if (!w) continue;
    if (/^\p{N}+$/u.test(w)) { if (w.length >= 2) out.add(w); continue; }
    if (w.length < 3) continue;
    out.add(w.slice(0, ROOT_LEN));
  }
  return [...out];
}

function hashes(list, k) {
  return [...new Set(list.map(r => crypto.createHmac('sha256', k).update(r).digest('hex').slice(0, 16)))];
}

/** The index of a text to store with it; null with no keys (nothing stored). */
function tokens(text) {
  const k = key();
  if (!k) return null;
  return hashes(roots(text), k).slice(0, MAX_TOKENS);
}

/** The tokens of a search, every one of which a row must hold; null with no keys or no word. */
function queryTokens(search) {
  const k = key();
  if (!k) return null;
  const r = roots(search);
  return r.length ? hashes(r, k) : null;
}

module.exports = { ROOT_LEN, roots, tokens, queryTokens, reset };
