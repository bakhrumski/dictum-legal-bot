'use strict';

const http2 = require('node:http2');

/**
 * Minimal, fail-soft adapter for the Ministry of Justice's public attorney
 * directory. It intentionally copies only professional directory fields.
 * Passport, PINFL, birth and other unrelated profile data are never requested
 * or stored by JuristAI.
 */

const API_BASE = 'https://api.e-advokat.uz/api/v.1/';
const PUBLIC_DIRECTORY_URL = 'https://e-advokat.adliya.uz/lawyer';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const ACTIVE_STATUSES = new Set(['DEGREE_GIVEN', 'LICENSED']);
const responseCache = new Map();
let h2Session = null;
let h2ActiveStreams = 0;
let h2IdleTimer = null;

function cleanText(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function localeValue(value, locale = 'Lt') {
  if (!value || typeof value !== 'object') return '';
  return cleanText(value[`name${locale}`] || value.nameLt || value.nameUz || value.nameRu || value.nameEn);
}

function splitPractices(value) {
  return cleanText(value, 2000)
    .split(/[;,]/)
    .map(item => cleanText(item, 255))
    .filter(Boolean);
}

function normalizeDate(value) {
  const text = cleanText(value, 30);
  const dmy = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizeOfficialAttorney(profile = {}, mainTypes = []) {
  const practices = [
    ...splitPractices(profile.licenseTypeNameLt || profile.licenseTypeNameUz || profile.licenseTypeNameRu),
    ...(Array.isArray(mainTypes) ? mainTypes.map(item => localeValue(item)) : []),
  ];
  const uniquePractices = [...new Set(practices.filter(Boolean))].slice(0, 20);
  const region = cleanText(profile.regionParentNameLt || profile.regionNameLt || profile.regionParentNameUz || profile.regionNameUz, 120);
  const district = cleanText(profile.regionNameLt || profile.regionNameUz || '', 120);
  const serial = cleanText(profile.licenseSerialTitle, 30);
  const number = cleanText(profile.regNumber, 80);

  return {
    source: 'e_advokat',
    source_id: cleanText(profile.id, 80),
    source_profile_url: PUBLIC_DIRECTORY_URL,
    full_name: cleanText(profile.fullName, 255),
    organization_name: cleanText(profile.contragentName, 255),
    region,
    district,
    workplace_address: cleanText(profile.contragentAddress || profile.address, 500),
    license_number: [serial, number].filter(Boolean).join(' - '),
    license_status: ACTIVE_STATUSES.has(String(profile.status || '').toUpperCase()) ? 'active' : 'inactive',
    license_issued_on: normalizeDate(profile.beginDate),
    contact_phone: cleanText(profile.mobilePhone, 60) || null,
    practice_areas: uniquePractices.map(name => ({ slug: '', name_uz: name, is_verified: true })),
    is_published: true,
    is_accepting_requests: false,
    languages: ['uz'],
    consultation_formats: [],
    verification_source: PUBLIC_DIRECTORY_URL,
  };
}

function scheduleH2Close() {
  if (h2IdleTimer) clearTimeout(h2IdleTimer);
  if (!h2ActiveStreams && h2Session && typeof h2Session.unref === 'function') h2Session.unref();
  h2IdleTimer = setTimeout(() => {
    if (!h2ActiveStreams && h2Session && !h2Session.closed && !h2Session.destroyed) h2Session.close();
    h2Session = null;
  }, 30_000);
  if (typeof h2IdleTimer.unref === 'function') h2IdleTimer.unref();
}

function getH2Session() {
  if (h2Session && !h2Session.closed && !h2Session.destroyed) {
    if (typeof h2Session.ref === 'function') h2Session.ref();
    return h2Session;
  }
  h2Session = http2.connect(new URL(API_BASE).origin);
  if (typeof h2Session.ref === 'function') h2Session.ref();
  h2Session.once('error', () => { h2Session = null; });
  h2Session.once('close', () => { h2Session = null; });
  return h2Session;
}

function postHttp2Json(path, body, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const url = new URL(path, API_BASE);
    const session = getH2Session();
    h2ActiveStreams += 1;
    let settled = false;
    let status = 0;
    let size = 0;
    const chunks = [];
    const request = session.request({
      ':method': 'POST',
      ':path': url.pathname + url.search,
      accept: 'application/json, text/plain, */*',
      'accept-language': 'lt',
      'content-type': 'application/json',
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('official registry timeout')));
    request.on('response', headers => { status = Number(headers[':status'] || 0); });
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_RESPONSE_BYTES) request.destroy(new Error('official registry response is too large'));
      else chunks.push(chunk);
    });
    request.on('error', error => {
      if (settled) return;
      settled = true;
      h2ActiveStreams = Math.max(0, h2ActiveStreams - 1);
      scheduleH2Close();
      reject(error);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      h2ActiveStreams = Math.max(0, h2ActiveStreams - 1);
      scheduleH2Close();
      if (status < 200 || status >= 300) return reject(new Error(`official registry returned ${status || 'no status'}`));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch (_) {
        reject(new Error('official registry returned invalid JSON'));
      }
    });
    request.end(payload);
  });
}

async function postJson(path, body, fetchImpl, timeoutMs = 8000) {
  if (typeof fetchImpl !== 'function') return postHttp2Json(path, body, timeoutMs);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(new URL(path, API_BASE), {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'lt',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller ? controller.signal : undefined,
    });
    if (!response || !response.ok) throw new Error(`official registry returned ${response ? response.status : 'no response'}`);
    return response.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeSearch(value) {
  return cleanText(value, 120).toLocaleLowerCase('uz-UZ')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function findRegionId(tree, wanted) {
  const needle = normalizeSearch(wanted);
  if (!needle) return '';
  const queue = Array.isArray(tree) ? [...tree] : [];
  let broadMatch = '';
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== 'object') continue;
    const names = [item.nameLt, item.nameUz, item.nameRu, item.nameEn].map(normalizeSearch).filter(Boolean);
    if (names.some(name => name === needle)) return item.id || '';
    if (!broadMatch && names.some(name => name.includes(needle) || needle.includes(name))) broadMatch = item.id || '';
    if (Array.isArray(item.children)) queue.push(...item.children);
  }
  return broadMatch;
}

async function mapLimited(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

async function searchEAdvokat(criteria = {}, options = {}) {
  // The official endpoint currently rejects HTTP/1.1 with 400 while its own
  // browser application uses HTTP/2. A fetch implementation is injectable for
  // tests; production therefore uses the bounded HTTP/2 transport above.
  const fetchImpl = options.fetchImpl || null;
  const regionKey = normalizeSearch(criteria.region || 'all');
  const cacheKey = `${regionKey}:${Math.max(1, Math.min(Number(criteria.scanLimit) || 48, 72))}`;
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.items;

  let regionId = '';
  if (criteria.region) {
    const regionTree = await postJson('getInfo/directoryRegionList', undefined, fetchImpl, options.timeoutMs);
    regionId = findRegionId(regionTree, criteria.region);
  }

  const limit = Math.max(1, Math.min(Number(criteria.scanLimit) || 48, 72));
  const query = new URLSearchParams({ search: '', contragentId: '', regionId: String(regionId || '') });
  const result = await postJson(`getInfo/lawyerList?${query.toString()}`, { limit, page: 0 }, fetchImpl, options.timeoutMs);
  const profiles = Array.isArray(result && result.list) ? result.list : [];
  const activeProfiles = profiles.filter(item => ACTIVE_STATUSES.has(String(item && item.status || '').toUpperCase()));

  const selectedProfiles = activeProfiles.slice(0, limit);
  const normalized = options.includeMainTypes ? await mapLimited(selectedProfiles, 4, async profile => {
    let mainTypes = [];
    try {
      const response = await postJson(`getInfo/lawyerMainTypes?lawyerId=${encodeURIComponent(profile.id)}`, undefined, fetchImpl, options.timeoutMs);
      mainTypes = Array.isArray(response && response.map) ? response.map : (Array.isArray(response) ? response : []);
    } catch (_) {
      // The licence specialization remains available even if this optional
      // enrichment endpoint is temporarily unavailable.
    }
    return normalizeOfficialAttorney(profile, mainTypes);
  }) : selectedProfiles.map(profile => normalizeOfficialAttorney(profile));

  const usable = normalized.filter(item => item.source_id && item.full_name && item.license_status === 'active');
  responseCache.set(cacheKey, { items: usable, expiresAt: Date.now() + CACHE_TTL_MS });
  return usable;
}

function clearEAdvokatCache() {
  responseCache.clear();
}

module.exports = {
  API_BASE,
  PUBLIC_DIRECTORY_URL,
  normalizeOfficialAttorney,
  findRegionId,
  searchEAdvokat,
  clearEAdvokatCache,
};
