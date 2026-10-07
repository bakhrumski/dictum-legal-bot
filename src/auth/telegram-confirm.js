'use strict';

/**
 * Telegram confirmation codes for web sign-in and registration (2026-10-07).
 *
 * Before: opening the auth bot's login_/reg_ link approved the browser that
 * started it ("APPROVED"), so a person who opened someone else's link signed
 * that someone into their own account. Now opening the link only sends a
 * 6-digit code to the Telegram chat that opened it; the code is typed into
 * the browser that started the flow. It is never returned by any API or
 * status poll.
 *
 * Each flow ('login', 'register') has its own token store, the code is
 * stored for its flow only, and a code is bound to:
 *   - the token and its flow (a login code does not register and the other
 *     way round; recovery and credential step-up have their own tokens);
 *   - the Telegram id that opened the link (a second Telegram account
 *     cannot take over a link already opened by another);
 *   - the browser that started the flow (an httpOnly SameSite=Strict cookie
 *     per flow, set by /api/login-session or /api/reg-session);
 * and it lasts 5 minutes, allows 5 wrong tries, at most 3 codes per link,
 * and is used once (checked and spent synchronously, so two parallel
 * requests with the same code cannot both pass).
 */

const crypto = require('crypto');

const CODE_TTL_MS = 5 * 60 * 1000;
const LINK_TTL_MS = 10 * 60 * 1000;
const MAX_TRIES = 5;
const MAX_CODES = 3;
const COOKIE = 'jai_tga'; // + '_' + flow: one per flow, so a login and a registration started together do not clash
const cookieName = flow => `${COOKIE}_${flow}`;
const FLOWS = Object.freeze(['login', 'register']);

const hashOf = (token, code) => crypto.createHash('sha256').update(`${token}:${code}`).digest();

function cookieOf(req, name = COOKIE) {
  const raw = String((req && req.headers && req.headers.cookie) || '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/**
 * A new link for `flow` in `store`, bound to this browser by a cookie.
 * Returns { token, cookie } - the caller sets the cookie on the reply.
 */
function createLink(store, flow, { now = Date.now() } = {}) {
  if (!FLOWS.includes(flow)) throw new Error(`unknown flow ${flow}`);
  const token = crypto.randomBytes(12).toString('hex');
  const nonce = crypto.randomBytes(18).toString('base64url');
  store.set(token, { flow, nonceHash: crypto.createHash('sha256').update(nonce).digest('hex'), createdAt: now,
    telegramUserId: null, codeHash: null, codeIssuedAt: null, codesSent: 0, tries: 0, used: false });
  setTimeout(() => store.delete(token), LINK_TTL_MS).unref?.();
  return { token, cookie: { name: cookieName(flow), value: nonce, options: { httpOnly: true, sameSite: 'strict', secure: 'auto', path: '/api', maxAge: LINK_TTL_MS } } };
}

/** Set the browser-binding cookie (express res.cookie may be absent in tests). */
function setLinkCookie(req, res, cookie) {
  const secure = cookie.options.secure === 'auto' ? !!(req.secure || String(req.get && req.get('x-forwarded-proto') || '').startsWith('https')) : !!cookie.options.secure;
  const parts = [`${cookie.name}=${encodeURIComponent(cookie.value)}`, `Path=${cookie.options.path}`, `Max-Age=${Math.floor(cookie.options.maxAge / 1000)}`, 'HttpOnly', 'SameSite=Strict'];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

/**
 * The auth bot opened `flow`'s link: make a code for the Telegram id that
 * opened it. Returns { code, text } to send to that chat, or { text } when
 * nothing is issued.
 */
function issueCode(store, flow, token, from, { now = Date.now() } = {}) {
  const s = store.get(String(token || ''));
  if (!s || s.flow !== flow || s.used || now - s.createdAt > LINK_TTL_MS) {
    return { error: 'expired', text: "⏳ Havola topilmadi yoki muddati o'tgan. Saytda qayta boshlang." };
  }
  const fromId = String(from && from.id);
  if (s.telegramUserId && s.telegramUserId !== fromId) {
    return { error: 'other_telegram', text: "❌ Bu havola boshqa Telegram hisobi uchun allaqachon ochilgan. Saytda yangi havola oling." };
  }
  if (s.codesSent >= MAX_CODES) return { error: 'too_many', text: "⏳ Bu havola uchun kodlar soni tugadi. Saytda qayta boshlang." };
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  s.telegramUserId = fromId;
  s.codeHash = hashOf(token, code);
  s.codeIssuedAt = now;
  s.codesSent += 1;
  s.tries = 0;
  if (flow === 'register' && from) {
    s.firstName = from.first_name || '';
    s.lastName = from.last_name || '';
    s.username = from.username || '';
  }
  const action = flow === 'login' ? 'JuristAI saytiga KIRISH' : "JuristAI'da RO'YXATDAN O'TISH";
  const text = `🔐 ${action} uchun tasdiqlash kodi: ${code}\n\n`
    + "Kodni faqat o'zingiz boshlagan kirish oynasiga kiriting. Uni hech kimga bermang — JuristAI xodimlari kod so'ramaydi.\n"
    + "Kod 5 daqiqa amal qiladi va bir marta ishlatiladi.\n\n"
    + "Agar buni siz boshlamagan bo'lsangiz (masalan, havolani kimdir yuborgan bo'lsa), hech narsa qilmang: kodsiz hech kim hisobingizga kira olmaydi.";
  return { code, text };
}

/**
 * Check the code typed in the browser. Synchronous: the code is spent before
 * any database work, so a replay or a parallel request cannot pass twice.
 * Returns { ok: true, telegramUserId, session } or { error, status, message }.
 */
function verifyCode(store, flow, token, code, req, { now = Date.now() } = {}) {
  const s = store.get(String(token || ''));
  const fail = (error, status, message) => ({ error, status, message });
  if (!s || s.flow !== flow || s.used) return fail('not_found', 400, 'Sessiya topilmadi. Telegram tugmasini qayta bosing.');
  const nonce = cookieOf(req, cookieName(flow));
  const nonceHash = nonce ? crypto.createHash('sha256').update(nonce).digest('hex') : '';
  if (!nonceHash || nonceHash.length !== s.nonceHash.length || !crypto.timingSafeEqual(Buffer.from(nonceHash), Buffer.from(s.nonceHash))) {
    return fail('other_browser', 400, "Bu kod boshqa brauzerda boshlangan kirish uchun. Shu sahifada qayta boshlang.");
  }
  if (!s.codeHash) return fail('no_code', 400, 'Avval Telegram botni ochib, kodni oling.');
  if (now - s.codeIssuedAt > CODE_TTL_MS) { store.delete(String(token)); return fail('expired', 400, "Kod muddati o'tgan. Qayta boshlang."); }
  const given = /^\d{6}$/u.test(String(code || '').trim()) ? hashOf(token, String(code).trim()) : Buffer.alloc(32);
  if (!crypto.timingSafeEqual(given, s.codeHash)) {
    s.tries += 1;
    if (s.tries >= MAX_TRIES) { store.delete(String(token)); return fail('locked', 429, "Juda ko'p noto'g'ri urinish. Qayta boshlang."); }
    return fail('wrong_code', 400, "Kod noto'g'ri. Telegramdagi 6 raqamli kodni kiriting.");
  }
  s.used = true;
  store.delete(String(token));
  return { ok: true, telegramUserId: s.telegramUserId, session: s };
}

/** What a status poll may learn: whether a code was sent. Never the code. */
function linkStatus(store, flow, token, { now = Date.now() } = {}) {
  const s = store.get(String(token || ''));
  if (!s || s.flow !== flow) return { codeSent: false, expired: true };
  return { codeSent: !!s.codeHash, expired: now - s.createdAt > LINK_TTL_MS };
}

module.exports = { CODE_TTL_MS, LINK_TTL_MS, MAX_TRIES, MAX_CODES, COOKIE, createLink, setLinkCookie, issueCode, verifyCode, linkStatus, cookieOf };
