#!/usr/bin/env node
'use strict';

/**
 * K2b: the firm search on the synthetic set (docs/quality/kb-search-eval/cases.json).
 * No AI, no network. Needs a throwaway database (TEST_DATABASE_URL, migrations
 * applied): it makes a temporary account and Workspace, adds the documents
 * through src/workspace/kb.js exactly as the API does, runs each query and
 * reports where the expected document came (1 = first), whether it came only
 * as a partial match, and the misses. Everything it made is deleted at the end.
 * Mechanical only: "found" means the words are there, not that the clause
 * answers the lawyer's need.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jai PGSSL=disable node scripts/kb-search-eval.js [--keys]
 *   --keys: with a throwaway DATA_KEYS (sealed bands, blind index); without: plain text, ILIKE
 */

const fs = require('fs');
const path = require('path');
if (!process.env.TEST_DATABASE_URL) { console.error('TEST_DATABASE_URL (a throwaway database) is required'); process.exit(1); }
if (/supabase\.co|render\.com|pooler\./i.test(process.env.TEST_DATABASE_URL)) { console.error('refusing to run against what looks like production'); process.exit(1); }
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
if (process.argv.includes('--keys')) { process.env.DATA_KEYS = JSON.stringify({ e1: require('crypto').randomBytes(32).toString('base64') }); process.env.DATA_KEY_ACTIVE = 'e1'; } else delete process.env.DATA_KEYS;

(async () => {
  const { pool } = require('../src/database/db');
  const privacy = require('../src/privacy/crypto');
  const { withWorkspaceTransaction } = require('../src/workspace/authz');
  const kb = require('../src/workspace/kb').createKnowledgeBase({ db: pool });
  const set = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/quality/kb-search-eval/cases.json'), 'utf8'));
  const u = (await pool.query(`INSERT INTO admins (username, password, full_name, role, tariff_plan, tariff_expires_at) VALUES ($1, 'x', 'KB eval', 'user', 'silver', now() + interval '1 day') RETURNING id`, [`kbeval_${Date.now()}`])).rows[0].id;
  const ws = (await withWorkspaceTransaction(pool, u, c => c.query(`INSERT INTO workspaces (name, slug, owner_id, created_by) VALUES ('KB baholash', $1, $2, $2) RETURNING id`, [`kbeval-${Date.now()}`, u]))).rows[0].id;
  const ids = {};
  try {
    for (const d of set.documents) {
      const wd = (await withWorkspaceTransaction(pool, u, c => c.query(`INSERT INTO workspace_documents (workspace_id, title, kind, created_by) VALUES ($1, $2, 'generated', $3) RETURNING id`, [ws, d.name, u]))).rows[0].id;
      await withWorkspaceTransaction(pool, u, c => c.query(`INSERT INTO workspace_document_versions (workspace_id, document_id, version_number, content_text, created_by) VALUES ($1, $2, 1, $3, $4)`,
        [ws, wd, privacy.seal(d.text, `workspace_document_versions.content_text:${ws}:${wd}`), u]));
      ids[(await kb.add(ws, u, { from: { kind: 'workspace_doc', id: wd } })).id] = d.id;
    }
    const rows = [];
    for (const q of set.queries) {
      const t = Date.now();
      const r = await kb.search(ws, u, { q: q.q });
      const order = [...new Set(r.results.map(x => ids[x.documentId]))];
      const at = order.indexOf(q.expect);
      const first = r.results.find(x => ids[x.documentId] === q.expect);
      rows.push({ q: q.q, kind: q.kind, expect: q.expect, place: at < 0 ? null : at + 1, partial: first ? first.partial : null, where: first ? [first.label, first.page].filter(Boolean).join('/') : '', ms: Date.now() - t, mode: r.mode });
    }
    const found = rows.filter(r => r.place);
    console.log(`mode: ${rows[0] && rows[0].mode}; ${set.documents.length} documents, ${rows.length} queries; reviewed: ${set.reviewed}\n`);
    for (const r of rows) console.log(`${r.place ? (r.place === 1 ? '  1st ' : `  #${r.place}  `) : '  miss'}${r.partial ? ' (partial)' : ''}  "${r.q}"  [${r.kind}]${r.where ? `  at ${r.where}` : ''}  ${r.ms} ms`);
    console.log(`\nfound ${found.length}/${rows.length}, first place ${found.filter(r => r.place === 1).length}, only partial ${found.filter(r => r.partial).length}, misses: ${rows.filter(r => !r.place).map(r => `"${r.q}"`).join(', ') || 'none'}`);
  } finally {
    await withWorkspaceTransaction(pool, u, c => c.query('DELETE FROM workspaces WHERE id = $1', [ws])).catch(() => {});
    await pool.query('DELETE FROM admins WHERE id = $1', [u]).catch(() => {});
    await pool.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
