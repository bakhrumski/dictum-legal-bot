'use strict';

/**
 * Encryption at rest, stage 1 / E1 (docs/design/shifrlash-1-bosqich.md §2).
 *
 *   keys      DATA_KEYS = {"v1":"<32 bytes, base64>", ...} and DATA_KEY_ACTIVE
 *             (the id new values are sealed with; default: the last id).
 *             Keys live only in the environment - never in the database, a
 *             log, the ledger or an error message.
 *   cipher    AES-256-GCM, a new 12-byte IV per value, and an AAD that binds
 *             the value to its place ("<table>.<column>:<row id>"): a sealed
 *             value copied to another row does not open.
 *   text      "enc:<key id>:<iv>:<tag>:<ciphertext>" (base64url) - fits a
 *             text column; a JSONB column holds {"enc": "<that string>"}
 *   bytes     "JEN1" + key id length + key id + iv + tag + ciphertext
 *   rotation  add v2 and make it active; v1 still opens; re-seal old rows;
 *             then drop v1
 *   no keys   DATA_KEYS unset: sealing is off - values are stored as they
 *             are (with one warning) - and a sealed value met then is an
 *             error (DATA_KEY_MISSING), never a silent empty value
 *   plaintext a value that is not sealed is returned as it is, so columns can
 *             be switched over row by row (E2)
 *
 * A lost key is lost data: the owner keeps an offline copy (§9, answer 5).
 */

const crypto = require('crypto');

const TEXT_PREFIX = 'enc:';
const BYTES_MAGIC = Buffer.from('JEN1');
const KEY_ID_RE = /^[a-z0-9]{1,16}$/;

class CryptoError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const b64u = buf => Buffer.from(buf).toString('base64url');
const fromB64u = s => Buffer.from(String(s), 'base64url');

/** Parse and check the key ring. Throws on a bad ring - the server must not start with one. */
function loadKeyRing(env = process.env) {
  const raw = String(env.DATA_KEYS || '').trim();
  if (!raw) return { keys: new Map(), active: null };
  let obj;
  try { obj = JSON.parse(raw); } catch (_) { throw new CryptoError('DATA_KEYS_INVALID', 'DATA_KEYS is not valid JSON'); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new CryptoError('DATA_KEYS_INVALID', 'DATA_KEYS must be an object of key id -> base64 key');
  const keys = new Map();
  for (const [id, b64] of Object.entries(obj)) {
    if (!KEY_ID_RE.test(id)) throw new CryptoError('DATA_KEYS_INVALID', `DATA_KEYS: key id "${String(id).slice(0, 20)}" must be 1-16 lowercase letters or digits`);
    const key = Buffer.from(String(b64 || ''), 'base64');
    // the key's own bytes never appear in a message, only its id and length
    if (key.length !== 32) throw new CryptoError('DATA_KEYS_INVALID', `DATA_KEYS: key "${id}" must be 32 bytes (got ${key.length})`);
    keys.set(id, key);
  }
  if (!keys.size) return { keys, active: null };
  const active = String(env.DATA_KEY_ACTIVE || '').trim() || [...keys.keys()].pop();
  if (!keys.has(active)) throw new CryptoError('DATA_KEYS_INVALID', `DATA_KEY_ACTIVE "${active.slice(0, 20)}" is not in DATA_KEYS`);
  return { keys, active };
}

let ring = null;
let warned = false;
function current() {
  if (!ring) ring = loadKeyRing();
  return ring;
}
/** Tests and key rotation: read the environment again. */
function reload(env = process.env) { ring = loadKeyRing(env); warned = false; return ring; }

/** Called once at start-up: a bad ring stops the server; no ring is a warning. */
function assertKeysValid(env = process.env, log = console) {
  const r = reload(env);
  if (!r.active) log.warn('[PRIVACY] DATA_KEYS is not set: data is stored WITHOUT encryption at rest (docs/design/shifrlash-1-bosqich.md)');
  else log.log(`[PRIVACY] encryption at rest on: ${r.keys.size} key(s), active "${r.active}"`);
  return { enabled: !!r.active, active: r.active, keyIds: [...r.keys.keys()] };
}

function enabled() { return !!current().active; }

function aadOf(aad) {
  if (typeof aad !== 'string' || !aad) throw new CryptoError('AAD_REQUIRED', 'an AAD ("<table>.<column>:<row id>") is required');
  return Buffer.from(aad, 'utf8');
}

function keyFor(id) {
  const k = current().keys.get(id);
  if (!k) throw new CryptoError('DATA_KEY_MISSING', `the key "${String(id).slice(0, 20)}" that sealed this value is not in DATA_KEYS`);
  return k;
}

function encrypt(plain, aad) {
  const { active } = current();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFor(active), iv);
  c.setAAD(aadOf(aad));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return { id: active, iv, tag: c.getAuthTag(), ct };
}

function decrypt({ id, iv, tag, ct }, aad) {
  const d = crypto.createDecipheriv('aes-256-gcm', keyFor(id), iv);
  d.setAAD(aadOf(aad));
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(ct), d.final()]); } catch (_) {
    throw new CryptoError('DECRYPT_FAILED', 'a sealed value did not open: wrong place, wrong key or changed data');
  }
}

function warnOnce() {
  if (!warned) { warned = true; console.warn('[PRIVACY] sealing is off (no DATA_KEYS): a value is stored as it is'); }
}

const isSealed = v => typeof v === 'string' && v.startsWith(TEXT_PREFIX);

/** Seal a string. No keys: the string as it is. null/undefined stay as they are. */
function seal(value, aad) {
  if (value == null) return value;
  const s = String(value);
  if (isSealed(s)) return s; // already sealed: never twice
  if (!enabled()) { warnOnce(); return s; }
  const e = encrypt(Buffer.from(s, 'utf8'), aad);
  return `${TEXT_PREFIX}${e.id}:${b64u(e.iv)}:${b64u(e.tag)}:${b64u(e.ct)}`;
}

/** Open a sealed string; a plain one is returned as it is. */
function open(value, aad) {
  if (!isSealed(value)) return value;
  const p = value.slice(TEXT_PREFIX.length).split(':');
  if (p.length !== 4) throw new CryptoError('DECRYPT_FAILED', 'a sealed value is malformed');
  const [id, iv, tag, ct] = p;
  return decrypt({ id, iv: fromB64u(iv), tag: fromB64u(tag), ct: fromB64u(ct) }, aad).toString('utf8');
}

/** JSONB: any JSON value -> {"enc": "..."}; no keys -> the value as it is. */
function sealJson(value, aad) {
  if (value == null) return value;
  if (isSealedJson(value)) return value;
  if (!enabled()) { warnOnce(); return value; }
  return { enc: seal(JSON.stringify(value), aad) };
}
const isSealedJson = v => !!(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && isSealed(v.enc));
function openJson(value, aad) {
  if (!isSealedJson(value)) return value;
  return JSON.parse(open(value.enc, aad));
}

const isSealedBytes = b => Buffer.isBuffer(b) && b.length > BYTES_MAGIC.length + 1 && b.subarray(0, 4).equals(BYTES_MAGIC);
/** bytea: a Buffer -> a sealed Buffer; no keys -> the Buffer as it is. */
function sealBytes(buf, aad) {
  if (buf == null) return buf;
  if (isSealedBytes(buf)) return buf;
  if (!enabled()) { warnOnce(); return buf; }
  const e = encrypt(Buffer.from(buf), aad);
  const id = Buffer.from(e.id, 'utf8');
  return Buffer.concat([BYTES_MAGIC, Buffer.from([id.length]), id, e.iv, e.tag, e.ct]);
}
function openBytes(buf, aad) {
  if (!isSealedBytes(buf)) return buf;
  const n = buf[4];
  const id = buf.subarray(5, 5 + n).toString('utf8');
  const at = 5 + n;
  if (buf.length < at + 28) throw new CryptoError('DECRYPT_FAILED', 'a sealed value is malformed');
  return decrypt({ id, iv: buf.subarray(at, at + 12), tag: buf.subarray(at + 12, at + 28), ct: buf.subarray(at + 28) }, aad);
}

/** The key id a sealed value was made with (for re-sealing after a rotation); null when plain. */
function keyIdOf(value) {
  if (isSealed(value)) return value.slice(TEXT_PREFIX.length).split(':')[0] || null;
  if (isSealedJson(value)) return keyIdOf(value.enc);
  if (isSealedBytes(value)) return value.subarray(5, 5 + value[4]).toString('utf8');
  return null;
}

/**
 * A key of its own for one purpose (E6: the blind index), derived with HKDF
 * from one ring key: DATA_BIDX_KEY_ID, else the first id in sort order - not
 * the active one, so a rotation (v2 active, v1 kept) does not move it.
 * null when no ring is set. The derived bytes never leave this process.
 */
function derivedKey(label, env = process.env) {
  const r = current();
  if (!r.keys.size) return null;
  const id = String(env.DATA_BIDX_KEY_ID || '').trim() || [...r.keys.keys()].sort()[0];
  const base = r.keys.get(id);
  if (!base) throw new CryptoError('DATA_KEYS_INVALID', `DATA_BIDX_KEY_ID "${id.slice(0, 20)}" is not in DATA_KEYS`);
  return Buffer.from(crypto.hkdfSync('sha256', base, Buffer.alloc(0), Buffer.from(`juristai:${label}`, 'utf8'), 32));
}

/** A new random key for DATA_KEYS (scripts/data-key.js). */
const newKey = () => crypto.randomBytes(32).toString('base64');

module.exports = { CryptoError, loadKeyRing, reload, assertKeysValid, enabled, seal, open, isSealed, sealJson, openJson, isSealedJson,
  sealBytes, openBytes, isSealedBytes, keyIdOf, newKey, derivedKey };
