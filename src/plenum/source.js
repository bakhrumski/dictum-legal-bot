'use strict';

/**
 * Plenum decisions from lex.uz (S1, docs/design/sud-amaliyoti.md). The list
 * is lex.uz's own search, in force only, for the word "plenumining" and the
 * issuing body (Oliy sudi 2328, Oliy xo'jalik sudi 2342); it pages by the
 * site's form post-back ("Keyingisi"). One page is read at a time with a
 * pause between pages; a page over the size limit is not read.
 */

const https = require('https');
const { httpGet } = require('../rag/fetch-lex');

const BASE = 'https://lex.uz';
const BODIES = { oliy: 2328, xojalik: 2342 };
const PAUSE_MS = () => Math.max(0, Number(process.env.PLENUM_PAUSE_MS) || 800);
const PAGE_MAX_BYTES = () => (Number(process.env.LEX_PAGE_MAX_KB_OTHER) || 2000) * 1024;
const MAX_LIST_PAGES = 60;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const unescape = v => String(v).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function listUrl(body) {
  return `${BASE}/uz/search/nat?status=Y&query=plenumining&body_id=${body}`;
}

/** [{ id (the Latin edition, negative), title }] on one search page. */
function listItems(html) {
  const out = [];
  const re = /href="\/uz\/docs\/(-?\d+)\?query=[^"]*"[^>]*>([^<]+)/g;
  let m;
  while ((m = re.exec(String(html || '')))) out.push({ id: Number(m[1]), title: unescape(m[2]).replace(/\s+/g, ' ').trim() });
  return out;
}
function hiddenFields(html) {
  const out = {};
  const re = /<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"/g;
  let m;
  while ((m = re.exec(String(html || '')))) out[m[1]] = unescape(m[2]);
  return out;
}
const hasNext = html => /id="ucFoundActsControl_LinkButton1" href="javascript:__doPostBack/.test(String(html || ''));

function postForm(url, form, { maxBytes = PAGE_MAX_BYTES(), timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(form).toString();
    const req = https.request(url, {
      method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'Mozilla/5.0 (JuristAI plenum sync)' },
    }, (res) => {
      let size = 0; const chunks = [];
      res.on('data', (c) => { size += c.length; if (size > maxBytes) { req.destroy(new Error('page too large')); return; } chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * Every decision lex.uz lists for one body: [{ id, title, body }]. A page that
 * fails stops the list there and says so (`partial`), never a silent cut.
 */
async function listDecisions(bodyKey, { get = httpGet, post = postForm, pause = PAUSE_MS() } = {}) {
  const url = listUrl(BODIES[bodyKey]);
  const seen = new Map();
  let html, pages = 0, partial = null;
  try { html = await get(url, 5, null, PAGE_MAX_BYTES()); } catch (e) { return { items: [], pages: 0, partial: e.message }; }
  for (;;) {
    pages += 1;
    const before = seen.size;
    listItems(html).forEach(x => { if (!seen.has(x.id)) seen.set(x.id, { ...x, body: bodyKey }); });
    if (!hasNext(html) || pages >= MAX_LIST_PAGES || (pages > 1 && seen.size === before)) break;
    if (pause) await sleep(pause);
    try { html = await post(url, { ...hiddenFields(html), __EVENTTARGET: 'ucFoundActsControl$LinkButton1', __EVENTARGUMENT: '' }); }
    catch (e) { partial = `page ${pages + 1}: ${e.message}`; break; }
  }
  if (pages >= MAX_LIST_PAGES) partial = partial || `stopped at ${MAX_LIST_PAGES} pages`;
  return { items: [...seen.values()], pages, partial };
}

/** One edition's page (html), within the size limit. */
async function fetchEdition(id, { get = httpGet } = {}) {
  return get(`${BASE}/uz/docs/${id}`, 5, null, PAGE_MAX_BYTES());
}

module.exports = { BODIES, listUrl, listItems, hiddenFields, hasNext, listDecisions, fetchEdition, postForm };
