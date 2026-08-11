'use strict';

/**
 * Shared data layer for the JuristAI attorney directory, paid legal services,
 * and the 24/7 Telegram concierge. The module deliberately keeps matching
 * deterministic and explainable: an LLM may classify a request, but it never
 * decides who is "best" without verifiable profile fields.
 */

const { pool } = require('../database/db');
const { searchEAdvokat, PUBLIC_DIRECTORY_URL } = require('./e-advokat-registry');

const DEFAULT_ATTORNEY_LIMIT = 5;

const PRACTICE_AREAS = [
  { slug: 'family', uz: 'Oila huquqi' },
  { slug: 'civil', uz: 'Fuqarolik huquqi' },
  { slug: 'labor', uz: 'Mehnat huquqi' },
  { slug: 'criminal', uz: 'Jinoyat huquqi' },
  { slug: 'business', uz: 'Tadbirkorlik huquqi' },
  { slug: 'administrative', uz: "Ma'muriy huquq" },
  { slug: 'tax', uz: 'Soliq huquqi' },
  { slug: 'real-estate', uz: "Ko'chmas mulk va kadastr" },
  { slug: 'construction', uz: 'Qurilish huquqi' },
  { slug: 'inheritance', uz: 'Meros masalalari', parent: 'civil' },
  { slug: 'debt-recovery', uz: 'Qarz undirish', parent: 'civil' },
  { slug: 'consumer-rights', uz: "Iste'molchilar huquqi", parent: 'civil' },
  { slug: 'divorce', uz: 'Nikohni bekor qilish', parent: 'family' },
  { slug: 'alimony', uz: 'Aliment undirish', parent: 'family' },
  { slug: 'child-custody', uz: 'Bola bilan bog\'liq nizolar', parent: 'family' },
  { slug: 'employment-reinstatement', uz: 'Ishga tiklash', parent: 'labor' },
  { slug: 'salary-recovery', uz: 'Ish haqi undirish', parent: 'labor' },
  { slug: 'fraud', uz: 'Firibgarlik', parent: 'criminal' },
  { slug: 'theft', uz: "O'g'irlik", parent: 'criminal' },
  { slug: 'contracts', uz: 'Shartnomalar', parent: 'business' },
  { slug: 'customs', uz: 'Bojxona nizolari', parent: 'business' },
];

const SERVICE_CATALOG = [
  { slug: 'legal-document', name: 'Yuridik hujjat tayyorlash' },
  { slug: 'claim', name: "Da'vo arizasi tayyorlash" },
  { slug: 'complaint', name: 'Shikoyat tayyorlash' },
  { slug: 'contract', name: 'Shartnoma tayyorlash' },
  { slug: 'application', name: 'Ariza tayyorlash' },
  { slug: 'legal-opinion', name: 'Yuridik xulosa tayyorlash' },
];

async function initLegalMarketplaceSchema(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS legal_practice_areas (
      id SERIAL PRIMARY KEY,
      parent_id INTEGER REFERENCES legal_practice_areas(id) ON DELETE SET NULL,
      slug VARCHAR(100) UNIQUE NOT NULL,
      name_uz VARCHAR(255) NOT NULL,
      name_ru VARCHAR(255),
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS attorney_profiles (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER UNIQUE REFERENCES admins(id) ON DELETE SET NULL,
      registration_request_id INTEGER UNIQUE REFERENCES registration_requests(id) ON DELETE SET NULL,
      full_name VARCHAR(255) NOT NULL,
      license_number VARCHAR(100),
      license_status VARCHAR(30) NOT NULL DEFAULT 'pending',
      license_verified_at TIMESTAMPTZ,
      verification_source TEXT,
      organization_name VARCHAR(255),
      bio TEXT,
      region VARCHAR(120),
      district VARCHAR(120),
      languages JSONB NOT NULL DEFAULT '["uz"]'::jsonb,
      consultation_formats JSONB NOT NULL DEFAULT '["online"]'::jsonb,
      experience_started_on DATE,
      average_response_minutes INTEGER,
      telegram_username VARCHAR(120),
      contact_phone VARCHAR(80),
      is_published BOOLEAN NOT NULL DEFAULT FALSE,
      is_accepting_requests BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE attorney_profiles ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(80)`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_attorney_license_unique ON attorney_profiles(LOWER(license_number)) WHERE license_number IS NOT NULL AND license_status = 'active'`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_attorney_directory ON attorney_profiles(is_published, license_status, is_accepting_requests)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_attorney_region ON attorney_profiles(LOWER(region))`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS attorney_practice_areas (
      attorney_id INTEGER NOT NULL REFERENCES attorney_profiles(id) ON DELETE CASCADE,
      practice_area_id INTEGER NOT NULL REFERENCES legal_practice_areas(id) ON DELETE CASCADE,
      experience_years INTEGER,
      is_verified BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (attorney_id, practice_area_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS attorney_consultation_requests (
      id BIGSERIAL PRIMARY KEY,
      request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      telegram_chat_id BIGINT,
      case_summary TEXT,
      legal_field VARCHAR(120),
      legal_subfield VARCHAR(120),
      region VARCHAR(120),
      language VARCHAR(20),
      urgency VARCHAR(20) NOT NULL DEFAULT 'medium',
      matched_attorney_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      consent_to_share BOOLEAN NOT NULL DEFAULT FALSE,
      contact_reveal_consent BOOLEAN NOT NULL DEFAULT FALSE,
      selected_attorney_ref VARCHAR(160),
      contact_revealed_at TIMESTAMPTZ,
      status VARCHAR(30) NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE attorney_consultation_requests ADD COLUMN IF NOT EXISTS contact_reveal_consent BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.query(`ALTER TABLE attorney_consultation_requests ADD COLUMN IF NOT EXISTS selected_attorney_ref VARCHAR(160)`);
  await db.query(`ALTER TABLE attorney_consultation_requests ADD COLUMN IF NOT EXISTS contact_revealed_at TIMESTAMPTZ`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_consultation_status ON attorney_consultation_requests(status, created_at DESC)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS official_attorney_cache (
      source VARCHAR(40) NOT NULL,
      source_id VARCHAR(100) NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      organization_name VARCHAR(255),
      region VARCHAR(120),
      district VARCHAR(120),
      workplace_address TEXT,
      license_number VARCHAR(100),
      license_status VARCHAR(30) NOT NULL,
      license_issued_on DATE,
      practice_areas JSONB NOT NULL DEFAULT '[]'::jsonb,
      contact_phone VARCHAR(80),
      source_profile_url TEXT NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (source, source_id)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_official_attorney_match ON official_attorney_cache(license_status, region, fetched_at DESC)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_catalog (
      id SERIAL PRIMARY KEY,
      slug VARCHAR(100) UNIQUE NOT NULL,
      name_uz VARCHAR(255) NOT NULL,
      description_uz TEXT,
      price_minor BIGINT,
      currency VARCHAR(10) NOT NULL DEFAULT 'UZS',
      requires_lawyer_approval BOOLEAN NOT NULL DEFAULT TRUE,
      intake_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_orders (
      id BIGSERIAL PRIMARY KEY,
      service_id INTEGER REFERENCES service_catalog(id) ON DELETE SET NULL,
      request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      telegram_chat_id BIGINT,
      status VARCHAR(40) NOT NULL DEFAULT 'pending_lawyer_review',
      quoted_price_minor BIGINT,
      currency VARCHAR(10) NOT NULL DEFAULT 'UZS',
      assigned_lawyer_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      lawyer_approved_at TIMESTAMPTZ,
      intake_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      payment_reference TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_service_orders_status ON service_orders(status, created_at DESC)`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_service_order_request ON service_orders(request_id) WHERE request_id IS NOT NULL`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS telegram_agent_events (
      id BIGSERIAL PRIMARY KEY,
      telegram_chat_id BIGINT,
      request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
      intent VARCHAR(60),
      action VARCHAR(60),
      legal_field VARCHAR(120),
      status VARCHAR(30) NOT NULL DEFAULT 'completed',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_tg_agent_events_created ON telegram_agent_events(created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_tg_agent_events_action ON telegram_agent_events(action, created_at DESC)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS tg_conversations (
      chat_id BIGINT PRIMARY KEY,
      turns JSONB NOT NULL DEFAULT '[]'::jsonb,
      clarify_count INTEGER NOT NULL DEFAULT 0,
      mode VARCHAR(20) NOT NULL DEFAULT 'automatic',
      state VARCHAR(40) NOT NULL DEFAULT 'idle',
      language VARCHAR(10) NOT NULL DEFAULT 'uz',
      last_intent VARCHAR(60),
      context JSONB NOT NULL DEFAULT '{}'::jsonb,
      active_request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE tg_conversations ADD COLUMN IF NOT EXISTS mode VARCHAR(20) NOT NULL DEFAULT 'automatic'`);
  await db.query(`ALTER TABLE tg_conversations ADD COLUMN IF NOT EXISTS state VARCHAR(40) NOT NULL DEFAULT 'idle'`);
  await db.query(`ALTER TABLE tg_conversations ADD COLUMN IF NOT EXISTS language VARCHAR(10) NOT NULL DEFAULT 'uz'`);
  await db.query(`ALTER TABLE tg_conversations ADD COLUMN IF NOT EXISTS last_intent VARCHAR(60)`);
  await db.query(`ALTER TABLE tg_conversations ADD COLUMN IF NOT EXISTS context JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await db.query(`ALTER TABLE tg_conversations ADD COLUMN IF NOT EXISTS active_request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL`);

  await db.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS source_channel VARCHAR(30) NOT NULL DEFAULT 'telegram'`);
  await db.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS legal_subfield VARCHAR(120)`);
  await db.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS urgency VARCHAR(20) NOT NULL DEFAULT 'medium'`);
  await db.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS language VARCHAR(10) NOT NULL DEFAULT 'uz'`);
  await db.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS region VARCHAR(120)`);
  await db.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS agent_intent VARCHAR(60)`);
  await db.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS agent_action VARCHAR(60)`);
  await db.query(`ALTER TABLE requests ADD COLUMN IF NOT EXISTS requires_lawyer_review BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_requests_ops_queue ON requests(status, urgency, created_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_requests_source_channel ON requests(source_channel, created_at DESC)`);

  for (const area of PRACTICE_AREAS.filter(item => !item.parent)) {
    await db.query(
      `INSERT INTO legal_practice_areas (slug, name_uz)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name_uz = EXCLUDED.name_uz, is_active = TRUE`,
      [area.slug, area.uz]
    );
  }
  for (const area of PRACTICE_AREAS.filter(item => item.parent)) {
    await db.query(
      `INSERT INTO legal_practice_areas (slug, name_uz, parent_id)
       SELECT $1, $2, id FROM legal_practice_areas WHERE slug = $3
       ON CONFLICT (slug) DO UPDATE SET name_uz = EXCLUDED.name_uz, parent_id = EXCLUDED.parent_id, is_active = TRUE`,
      [area.slug, area.uz, area.parent]
    );
  }

  for (const service of SERVICE_CATALOG) {
    await db.query(
      `INSERT INTO service_catalog (slug, name_uz, requires_lawyer_approval)
       VALUES ($1, $2, TRUE)
       ON CONFLICT (slug) DO UPDATE SET name_uz = EXCLUDED.name_uz`,
      [service.slug, service.name]
    );
  }
}

function normalizeMatchText(value) {
  return String(value || '')
    .toLocaleLowerCase('uz')
    .replace(/[ʻʼ’‘`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedTerms(value) {
  return normalizeMatchText(value)
    .replace(/[^a-z0-9а-яёўқғҳ\s'-]/giu, ' ')
    .split(/\s+/)
    .filter(term => term.length > 2);
}

function rankAttorney(attorney, criteria = {}) {
  if (!attorney || attorney.license_status !== 'active' || !attorney.is_published) return null;

  const practices = Array.isArray(attorney.practice_areas) ? attorney.practice_areas : [];
  const practiceText = practices.map(p => `${p.slug || ''} ${p.name_uz || ''}`).join(' ').toLocaleLowerCase('uz');
  const desired = normalizedTerms(`${criteria.legalField || ''} ${criteria.legalSubfield || ''} ${criteria.query || ''}`);
  const matchedTerms = [...new Set(desired.filter(term => practiceText.includes(term)))];

  let score = 20;
  const reasons = [];
  if (matchedTerms.length) {
    score += Math.min(45, 18 + matchedTerms.length * 7);
    reasons.push('soha mos keladi');
  }

  if (criteria.region && attorney.region && normalizeMatchText(attorney.region).includes(normalizeMatchText(criteria.region))) {
    score += 15;
    reasons.push('hudud mos keladi');
  }

  const languages = Array.isArray(attorney.languages) ? attorney.languages.map(String) : [];
  if (criteria.language && languages.some(lang => lang.toLowerCase() === String(criteria.language).toLowerCase())) {
    score += 10;
    reasons.push('til mos keladi');
  }

  if (attorney.is_accepting_requests) {
    score += 5;
    reasons.push('murojaat qabul qilmoqda');
  }

  if (Number.isFinite(Number(attorney.average_response_minutes))) {
    score += Math.max(0, 5 - Math.floor(Number(attorney.average_response_minutes) / 240));
  }

  return {
    ...attorney,
    match_score: Math.min(100, score),
    match_reasons: reasons.length ? reasons : ['litsenziyasi tasdiqlangan'],
  };
}

function publicAttorney(attorney) {
  if (!attorney) return attorney;
  const { contact_phone, ...safe } = attorney;
  return safe;
}

async function cacheOfficialAttorneys(attorneys, db = pool) {
  for (const attorney of attorneys || []) {
    await db.query(`
      INSERT INTO official_attorney_cache
        (source, source_id, full_name, organization_name, region, district,
         workplace_address, license_number, license_status, license_issued_on,
         practice_areas, contact_phone, source_profile_url, fetched_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULLIF($10, '')::date,
              $11::jsonb, $12, $13, NOW())
      ON CONFLICT (source, source_id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        organization_name = EXCLUDED.organization_name,
        region = EXCLUDED.region,
        district = EXCLUDED.district,
        workplace_address = EXCLUDED.workplace_address,
        license_number = EXCLUDED.license_number,
        license_status = EXCLUDED.license_status,
        license_issued_on = EXCLUDED.license_issued_on,
        practice_areas = EXCLUDED.practice_areas,
        contact_phone = EXCLUDED.contact_phone,
        source_profile_url = EXCLUDED.source_profile_url,
        fetched_at = NOW()
    `, [
      attorney.source,
      attorney.source_id,
      attorney.full_name,
      attorney.organization_name || null,
      attorney.region || null,
      attorney.district || null,
      attorney.workplace_address || null,
      attorney.license_number || null,
      attorney.license_status,
      attorney.license_issued_on || '',
      JSON.stringify(attorney.practice_areas || []),
      attorney.contact_phone || null,
      attorney.source_profile_url || PUBLIC_DIRECTORY_URL,
    ]);
  }
}

async function findOfficialAttorneys(criteria = {}, db = pool) {
  if (process.env.E_ADVOCAT_ENABLED === 'false') return [];
  try {
    const official = await searchEAdvokat({ ...criteria, scanLimit: 48 });
    await cacheOfficialAttorneys(official, db);
    return official
      .map(item => rankAttorney({
        ...item,
        id: `eadvokat:${item.source_id}`,
        contact_ref: `eadvokat:${item.source_id}`,
        source_name: 'e-advokat.adliya.uz',
      }, criteria))
      .filter(Boolean)
      .map(publicAttorney);
  } catch (error) {
    console.warn('[E-ADVOKAT] official registry unavailable:', error.message);
    return [];
  }
}

async function findMatchingAttorneys(criteria = {}, db = pool) {
  const limit = Math.max(1, Math.min(Number(criteria.limit) || DEFAULT_ATTORNEY_LIMIT, 10));
  const result = await db.query(`
    SELECT ap.id, ap.full_name, ap.license_number, ap.license_status,
           ap.license_verified_at, ap.organization_name, ap.bio, ap.region,
           ap.district, ap.languages, ap.consultation_formats,
           ap.experience_started_on, ap.average_response_minutes,
           ap.is_published, ap.is_accepting_requests,
           COALESCE(
             jsonb_agg(DISTINCT jsonb_build_object(
               'slug', lpa.slug,
               'name_uz', lpa.name_uz,
               'is_verified', apa.is_verified
             )) FILTER (WHERE lpa.id IS NOT NULL),
             '[]'::jsonb
           ) AS practice_areas
      FROM attorney_profiles ap
      LEFT JOIN attorney_practice_areas apa ON apa.attorney_id = ap.id
      LEFT JOIN legal_practice_areas lpa ON lpa.id = apa.practice_area_id AND lpa.is_active = TRUE
     WHERE ap.is_published = TRUE
       AND ap.license_status = 'active'
       AND ap.is_accepting_requests = TRUE
     GROUP BY ap.id
     ORDER BY ap.license_verified_at DESC NULLS LAST, ap.updated_at DESC
     LIMIT 100
  `);

  let ranked = result.rows
    .map(row => rankAttorney({
      ...row,
      contact_ref: `local:${row.id}`,
      source_name: 'JuristAI',
      source_profile_url: row.verification_source || null,
    }, criteria))
    .filter(Boolean);

  // Do not make unit tests or data migrations depend on the network. Normal
  // production calls use the shared pool and enrich the result with the
  // Ministry of Justice's public directory.
  if (db === pool) {
    const official = await findOfficialAttorneys(criteria, db);
    ranked.push(...official);
  }

  if (criteria.strictRegion && criteria.region) {
    const region = normalizeMatchText(criteria.region);
    ranked = ranked.filter(item => normalizeMatchText(item.region).includes(region));
  }
  if (criteria.strictField && (criteria.legalField || criteria.legalSubfield)) {
    const wanted = normalizedTerms(`${criteria.legalField || ''} ${criteria.legalSubfield || ''}`);
    ranked = ranked.filter(item => {
      const practiceText = (item.practice_areas || [])
        .map(area => `${area.slug || ''} ${area.name_uz || ''}`)
        .join(' ')
        .toLocaleLowerCase('uz');
      return wanted.some(term => practiceText.includes(term));
    });
  }

  const deduped = new Map();
  for (const item of ranked) {
    const key = normalizedTerms(item.license_number || `${item.full_name} ${item.organization_name || ''}`).join('|');
    const existing = deduped.get(key);
    if (!existing || item.match_score > existing.match_score || (existing.source_name !== 'JuristAI' && item.source_name === 'JuristAI')) {
      deduped.set(key, item);
    }
  }

  return [...deduped.values()]
    .sort((a, b) => b.match_score - a.match_score || String(a.full_name).localeCompare(String(b.full_name)))
    .slice(0, limit);
}

async function revealAttorneyContactAfterConsent(data = {}, db = pool) {
  const chatId = String(data.telegramChatId || '').trim();
  const attorneyRef = String(data.attorneyRef || '').trim().slice(0, 160);
  if (!/^-?\d{4,20}$/.test(chatId) || !/^(local:\d+|eadvokat:[A-Za-z0-9_-]{1,100})$/.test(attorneyRef)) return null;

  let contact = null;
  if (attorneyRef.startsWith('eadvokat:')) {
    const sourceId = attorneyRef.slice('eadvokat:'.length);
    const result = await db.query(`
      SELECT full_name, organization_name, contact_phone, source_profile_url, fetched_at
        FROM official_attorney_cache
       WHERE source = 'e_advokat' AND source_id = $1
         AND license_status = 'active'
         AND contact_phone IS NOT NULL
         AND fetched_at > NOW() - INTERVAL '7 days'
       LIMIT 1
    `, [sourceId]);
    if (result.rows.length) contact = { ...result.rows[0], attorney_ref: attorneyRef, source_name: 'e-advokat.adliya.uz' };
  } else {
    const localId = parseInt(attorneyRef.slice('local:'.length), 10);
    const result = await db.query(`
      SELECT full_name, organization_name, contact_phone, verification_source AS source_profile_url
        FROM attorney_profiles
       WHERE id = $1 AND is_published = TRUE AND license_status = 'active'
         AND contact_phone IS NOT NULL
       LIMIT 1
    `, [localId]);
    if (result.rows.length) contact = { ...result.rows[0], attorney_ref: attorneyRef, source_name: 'JuristAI' };
  }
  if (!contact) return null;

  const consultation = await db.query(`
    UPDATE attorney_consultation_requests
       SET contact_reveal_consent = TRUE,
           selected_attorney_ref = $2,
           contact_revealed_at = NOW(),
           status = 'contact_shared',
           updated_at = NOW()
     WHERE id = (
       SELECT id FROM attorney_consultation_requests
        WHERE telegram_chat_id = $1
          AND matched_attorney_ids ? $2
        ORDER BY created_at DESC
        LIMIT 1
     )
     RETURNING id
  `, [chatId, attorneyRef]);
  return consultation.rows.length ? contact : null;
}

async function createConsultationRequest(data = {}, db = pool) {
  const result = await db.query(
    `INSERT INTO attorney_consultation_requests
       (request_id, user_id, telegram_chat_id, case_summary, legal_field,
        legal_subfield, region, language, urgency, matched_attorney_ids, consent_to_share)
     VALUES ($1, (SELECT id FROM users WHERE telegram_id = $2 LIMIT 1), $2, $3, $4, $5, $6, $7, $8, $9::jsonb, FALSE)
     RETURNING *`,
    [
      data.requestId || null,
      data.telegramChatId || null,
      data.caseSummary || null,
      data.legalField || null,
      data.legalSubfield || null,
      data.region || null,
      data.language || 'uz',
      data.urgency || 'medium',
      JSON.stringify((data.attorneyIds || []).slice(0, 10)),
    ]
  );
  return result.rows[0];
}

async function createServiceOrder(data = {}, db = pool) {
  const serviceSlug = data.serviceSlug || 'legal-document';
  const result = await db.query(
    `INSERT INTO service_orders
       (service_id, request_id, user_id, telegram_chat_id, status, intake_data)
     SELECT sc.id, $2, (SELECT id FROM users WHERE telegram_id = $3 LIMIT 1), $3,
            'pending_lawyer_review', $4::jsonb
       FROM service_catalog sc
      WHERE sc.slug = $1 AND sc.is_active = TRUE
     ON CONFLICT (request_id) WHERE request_id IS NOT NULL
     DO UPDATE SET intake_data = EXCLUDED.intake_data, updated_at = NOW()
     RETURNING *`,
    [serviceSlug, data.requestId || null, data.telegramChatId || null, JSON.stringify(data.intakeData || {})]
  );
  return result.rows[0] || null;
}

async function recordTelegramAgentEvent(event = {}, db = pool) {
  const result = await db.query(
    `INSERT INTO telegram_agent_events
       (telegram_chat_id, request_id, intent, action, legal_field, status, duration_ms, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING id`,
    [
      event.telegramChatId || null,
      event.requestId || null,
      event.intent || null,
      event.action || null,
      event.legalField || null,
      event.status || 'completed',
      Math.max(0, Number(event.durationMs) || 0),
      JSON.stringify(event.metadata || {}),
    ]
  );
  return result.rows[0];
}

module.exports = {
  initLegalMarketplaceSchema,
  findMatchingAttorneys,
  createConsultationRequest,
  createServiceOrder,
  recordTelegramAgentEvent,
  revealAttorneyContactAfterConsent,
  rankAttorney,
  publicAttorney,
  cacheOfficialAttorneys,
  PRACTICE_AREAS,
  SERVICE_CATALOG,
};
