'use strict';

/**
 * Document Templates — PostgreSQL persistence layer
 *
 * Table: document_templates
 *   id          SERIAL PRIMARY KEY
 *   slug        VARCHAR(100) UNIQUE   — URL-safe id used by drafting UI
 *   name        JSONB                 — {uz, ru}
 *   description JSONB                 — {uz, ru}
 *   category    VARCHAR(100)
 *   lang        VARCHAR(5)            — primary doc language ('uz'|'ru')
 *   fields      JSONB                 — array of field descriptors
 *   body        TEXT                  — HTML template with {{key}} placeholders
 *   is_active   BOOLEAN
 *   created_by  INTEGER               — admin id
 *   updated_by  INTEGER
 *   created_at  TIMESTAMPTZ
 *   updated_at  TIMESTAMPTZ
 */

const { pool } = require('../database/db');
const { TEMPLATES: SEED } = require('./templates');

let _ready = false;

async function initTemplatesTable() {
  if (_ready) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS document_templates (
      id          SERIAL PRIMARY KEY,
      slug        VARCHAR(100) UNIQUE NOT NULL,
      name        JSONB NOT NULL DEFAULT '{}',
      description JSONB DEFAULT '{}',
      category    VARCHAR(100) DEFAULT 'boshqa',
      lang        VARCHAR(5) DEFAULT 'uz',
      fields      JSONB NOT NULL DEFAULT '[]',
      body        TEXT NOT NULL DEFAULT '',
      is_active   BOOLEAN DEFAULT TRUE,
      created_by  INTEGER,
      updated_by  INTEGER,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // owner_id NULL = curated library, visible to everyone.
  // owner_id set  = a template one user uploaded, visible only to them.
  //
  // Uploaded templates routinely contain real client names, sums and terms —
  // the source document IS someone's contract — so they are private by
  // default and never surface in another user's picker.
  await pool.query(`ALTER TABLE document_templates ADD COLUMN IF NOT EXISTS owner_id INTEGER`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_doc_templates_owner
                    ON document_templates(owner_id) WHERE owner_id IS NOT NULL`);

  // Seed from static library if table is empty
  const { rows } = await pool.query('SELECT COUNT(*) AS n FROM document_templates');
  if (parseInt(rows[0].n) === 0 && SEED.length > 0) {
    for (const t of SEED) {
      await pool.query(
        `INSERT INTO document_templates (slug, name, description, category, lang, fields, body)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (slug) DO NOTHING`,
        [t.id, JSON.stringify(t.name), JSON.stringify(t.description || {}),
         t.category || 'boshqa', t.lang || 'uz',
         JSON.stringify(t.fields || []), t.body || '']
      );
    }
    console.log('[DRAFT DB] Seeded', SEED.length, 'templates');
  }
  _ready = true;
}

function rowToTemplate(r) {
  return {
    id:          r.id,
    slug:        r.slug,
    name:        r.name,
    description: r.description || {},
    category:    r.category,
    lang:        r.lang,
    fields:      r.fields || [],
    body:        r.body,
    isActive:    r.is_active,
    ownerId:     r.owner_id || null,
    isMine:      r.owner_id != null,
    createdAt:   r.created_at,
    updatedAt:   r.updated_at,
  };
}

/**
 * Templates visible to one user: the curated library plus their own uploads.
 * Passing no ownerId returns the curated library only — so a caller that
 * forgets to scope leaks nothing.
 */
async function dbListTemplates(ownerId = null) {
  const { rows } = await pool.query(
    `SELECT id, slug, name, description, category, lang, fields, is_active, owner_id, created_at, updated_at
       FROM document_templates
      WHERE is_active = TRUE AND (owner_id IS NULL OR owner_id = $1)
      ORDER BY owner_id NULLS FIRST, created_at ASC`,
    [ownerId]
  );
  return rows.map(r => ({
    ...rowToTemplate(r),
    fieldCount: Array.isArray(r.fields) ? r.fields.length : 0,
  }));
}

/**
 * Fetch one template, enforcing ownership. A private template is returned
 * only to its owner; the check is in the QUERY, not in the caller, so no
 * route can accidentally serve someone else's uploaded contract.
 */
async function dbGetTemplate(slugOrId, ownerId = null) {
  const isNum = /^\d+$/.test(String(slugOrId));
  const { rows } = await pool.query(
    `SELECT * FROM document_templates
      WHERE ${isNum ? 'id=$1' : 'slug=$1'} AND (owner_id IS NULL OR owner_id = $2)`,
    [slugOrId, ownerId]
  );
  return rows[0] ? rowToTemplate(rows[0]) : null;
}

/** Unscoped list — master editor only. Never reachable from a user route. */
async function dbListTemplatesAll() {
  const { rows } = await pool.query(
    `SELECT id, slug, name, description, category, lang, fields, body, is_active, owner_id, created_at, updated_at
       FROM document_templates WHERE is_active = TRUE ORDER BY owner_id NULLS FIRST, created_at ASC`);
  return rows.map(r => ({ ...rowToTemplate(r), fieldCount: Array.isArray(r.fields) ? r.fields.length : 0 }));
}

/** Unscoped read — master tools only. Never reachable from a user route. */
async function dbGetTemplateAny(slugOrId) {
  const isNum = /^\d+$/.test(String(slugOrId));
  const { rows } = await pool.query(
    `SELECT * FROM document_templates WHERE ${isNum ? 'id=$1' : 'slug=$1'}`, [slugOrId]);
  return rows[0] ? rowToTemplate(rows[0]) : null;
}

async function dbCountOwnedTemplates(ownerId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM document_templates WHERE owner_id = $1 AND is_active = TRUE`,
    [ownerId]);
  return rows[0].n;
}

async function dbCreateTemplate({ slug, name, description, category, lang, fields, body, createdBy, ownerId }) {
  const { rows } = await pool.query(
    `INSERT INTO document_templates (slug, name, description, category, lang, fields, body, created_by, owner_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [slug, JSON.stringify(name), JSON.stringify(description || {}),
     category || 'boshqa', lang || 'uz', JSON.stringify(fields || []), body || '',
     createdBy || null, ownerId || null]
  );
  return rowToTemplate(rows[0]);
}

async function dbUpdateTemplate(id, { name, description, category, lang, fields, body, updatedBy }) {
  const { rows } = await pool.query(
    `UPDATE document_templates
     SET name=$2, description=$3, category=$4, lang=$5, fields=$6, body=$7,
         updated_by=$8, updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [id, JSON.stringify(name), JSON.stringify(description || {}),
     category || 'boshqa', lang || 'uz', JSON.stringify(fields || []), body || '', updatedBy || null]
  );
  return rows[0] ? rowToTemplate(rows[0]) : null;
}

async function dbDeleteTemplate(id) {
  await pool.query(`UPDATE document_templates SET is_active=FALSE, updated_at=NOW() WHERE id=$1`, [id]);
}

/** Delete only if the caller owns it. Returns false when it is not theirs. */
async function dbDeleteOwnedTemplate(id, ownerId) {
  const r = await pool.query(
    `UPDATE document_templates SET is_active=FALSE, updated_at=NOW()
      WHERE id=$1 AND owner_id=$2 AND is_active=TRUE`,
    [id, ownerId]);
  return r.rowCount > 0;
}

module.exports = {
  initTemplatesTable, dbListTemplates, dbListTemplatesAll, dbGetTemplate, dbGetTemplateAny,
  dbCountOwnedTemplates, dbCreateTemplate, dbUpdateTemplate,
  dbDeleteTemplate, dbDeleteOwnedTemplate,
};
