'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { canCreateWorkspace, isActivePlatinum } = require('../src/workspace/authz');
const { createWorkspaceAiService, loadContext, normalizeQuestion, sha256 } = require('../src/workspace/ai-service');
const { issueRealtimeToken } = require('../src/workspace/realtime-auth');
const { makeSlug, tokenHash } = require('../src/workspace/routes');
const { combineUsage } = require('../src/workspace/legal-answer-generator');
const { migrationFiles, stripOuterTransaction } = require('../src/database/migrations');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}\n      ${error.stack || error.message}`);
  }
}

const workspaceId = '11111111-1111-4111-8111-111111111111';
const userSubject = '22222222-2222-4222-8222-222222222222';

function transactionalPool(handler) {
  const client = {
    queries: [],
    async query(sql, params = []) {
      this.queries.push({ sql: String(sql), params });
      return handler(String(sql), params, this.queries);
    },
    release() {},
  };
  return { client, connect: async () => client, query: client.query.bind(client) };
}

(async () => {
  console.log('\nworkspace — entitlement and identity bridge\n');

  await test('only active Platinum accounts qualify', () => {
    assert.strictEqual(isActivePlatinum({ tariff_plan: 'platinum', tariff_expires_at: null }), true);
    assert.strictEqual(isActivePlatinum({ tariff_plan: 'PlAtInUm', tariff_expires_at: new Date(Date.now() + 60000) }), true);
    assert.strictEqual(isActivePlatinum({ tariff_plan: 'gold', tariff_expires_at: null }), false);
    assert.strictEqual(isActivePlatinum({ tariff_plan: 'platinum', tariff_expires_at: new Date(Date.now() - 1) }), false);
  });

  await test('active Platinum users and Master Admins can create a Workspace', () => {
    const activePlan = { tariff_plan: 'platinum', tariff_expires_at: new Date(Date.now() + 60000) };
    assert.strictEqual(canCreateWorkspace({ ...activePlan, role: 'user' }), true);
    assert.strictEqual(canCreateWorkspace({ ...activePlan, role: 'master' }), true);
    assert.strictEqual(canCreateWorkspace({ ...activePlan, role: 'lawyer' }), false);
    assert.strictEqual(canCreateWorkspace({ ...activePlan, role: 'student' }), false);
    assert.strictEqual(canCreateWorkspace({ role: 'master', tariff_plan: 'gold', tariff_expires_at: null }), false);
  });

  await test('invitation tokens are stored as one-way hashes', () => {
    const raw = 'secret-invitation-token';
    const digest = tokenHash(raw);
    assert.ok(Buffer.isBuffer(digest));
    assert.strictEqual(digest.length, 32);
    assert.notStrictEqual(digest.toString('utf8'), raw);
    assert.deepStrictEqual(tokenHash(raw), digest);
  });

  await test('Realtime JWT bridges the existing account without exposing the signing secret', async () => {
    const keys = [
      'SUPABASE_JWT_SECRET', 'SUPABASE_JWT_SIGNING_SECRET',
      'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_JWT_PRIVATE_KEY', 'SUPABASE_JWT_ALGORITHM', 'SUPABASE_JWT_KEY_ID',
    ];
    const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    const secret = 'workspace-test-secret-at-least-32-chars';
    process.env.SUPABASE_JWT_SIGNING_SECRET = secret;
    delete process.env.SUPABASE_JWT_PRIVATE_KEY;
    process.env.SUPABASE_JWT_ALGORITHM = 'HS256';
    delete process.env.SUPABASE_JWT_KEY_ID;
    process.env.SUPABASE_URL = 'https://example.supabase.co/';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test-key';
    try {
      const db = { query: async () => ({ rows: [{ id: 42, supabase_subject: userSubject, username: 'tester' }] }) };
      const result = await issueRealtimeToken(db, 42);
      const claims = jwt.verify(result.token, secret, { algorithms: ['HS256'] });
      assert.strictEqual(claims.sub, userSubject);
      assert.strictEqual(claims.app_user_id, 42);
      assert.strictEqual(claims.role, 'authenticated');
      assert.strictEqual(claims.aud, 'authenticated');
      assert.ok(Number.isInteger(claims.iat));
      assert.ok(claims.exp - claims.iat <= 300);
      assert.strictEqual(result.supabaseUrl, 'https://example.supabase.co');
      assert.strictEqual(result.supabaseKey, 'sb_publishable_test-key');
      assert.ok(!JSON.stringify(result).includes(secret));
    } finally {
      for (const key of keys) {
        if (prior[key] === undefined) delete process.env[key];
        else process.env[key] = prior[key];
      }
    }
  });

  await test('Workspace AI usage includes both drafting and independent Lex QA', () => {
    const usage = combineUsage(
      { inTokens: 1200, outTokens: 400, cachedTokens: 300, costUsd: 0.0012 },
      { inTokens: 800, outTokens: 120, cachedTokens: 0, costUsd: 0.0004 }
    );
    assert.deepStrictEqual(
      { inTokens: usage.inTokens, outTokens: usage.outTokens, cachedTokens: usage.cachedTokens },
      { inTokens: 2000, outTokens: 520, cachedTokens: 300 }
    );
    assert.ok(Math.abs(usage.costUsd - 0.0016) < 1e-12);
  });

  await test('Workspace AI uses the same legal quality gates as the main JuristAI chat', () => {
    const generator = fs.readFileSync(path.join(__dirname, '..', 'src', 'workspace', 'legal-answer-generator.js'), 'utf8');
    const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
    for (const requirement of [
      'buildTopicPrompt', 'searchKorpus', 'verified_qa', 'useSearch: true',
      'buildFallbackPrompt', 'hydrateMentionedOfficialActChunks',
      'crossCheckLegalAnswer', 'verifyCitations', 'hydrateLexAnchors',
      'normalizeLegalAnswerCitations', 'buildLegalNextActions',
      'generateSourceSuggestions', 'getLegalPolicyVersions',
    ]) assert.ok(generator.includes(requirement), `Workspace AI is missing ${requirement}`);
    assert.ok(server.includes('generateWorkspaceAnswer = createWorkspaceLegalAnswerGenerator({'));
    assert.ok(server.includes('buildFallbackPrompt: buildGeminiFallbackPrompt'));
    assert.ok(server.includes('verifyCitations,'));
    assert.ok(server.includes('generateSourceSuggestions,'));
  });

  console.log('\nworkspace — shared AI reuse\n');

  await test('context fingerprints are stable and change when a document version changes', async () => {
    let versionId = '33333333-3333-4333-8333-333333333333';
    const db = {
      async query(sql) {
        if (/FROM juristai_private\.legal_corpus_state/.test(sql)) return { rows: [{ revision: '7', updated_at: '2026-08-22T10:00:00.000Z' }] };
        if (/FROM workspace_documents d/.test(sql)) {
          return { rows: [{ id: 'd1', title: 'Shartnoma', version_id: versionId, version_number: 1, content_text: 'Matn' }] };
        }
        if (/mi\.kind = ANY/.test(sql)) return { rows: [{ id: 'm1', kind: 'decision', title: 'Qaror' }] };
        if (/WITH query AS/.test(sql)) return { rows: [] };
        throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
      },
    };
    const first = await loadContext(db, workspaceId, null, '  Ish HAQI  ');
    const second = await loadContext(db, workspaceId, null, 'ish haqi');
    assert.strictEqual(normalizeQuestion('  Ish  HAQI '), 'ish haqi');
    assert.strictEqual(first.reuseKey, second.reuseKey);
    versionId = '44444444-4444-4444-8444-444444444444';
    const changed = await loadContext(db, workspaceId, null, 'ish haqi');
    assert.notStrictEqual(first.contextFingerprint, changed.contextFingerprint);
    assert.notStrictEqual(first.reuseKey, changed.reuseKey);
  });

  await test('context fingerprints change when the legal corpus revision changes', async () => {
    let revision = '11';
    const db = {
      async query(sql) {
        if (/FROM juristai_private\.legal_corpus_state/.test(sql)) return { rows: [{ revision, updated_at: null }] };
        if (/FROM workspace_documents d/.test(sql) || /mi\.kind = ANY/.test(sql) || /WITH query AS/.test(sql)) return { rows: [] };
        throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
      },
    };
    const first = await loadContext(db, workspaceId, null, 'Bir xil savol');
    revision = '12';
    const changed = await loadContext(db, workspaceId, null, 'Bir xil savol');
    assert.notStrictEqual(first.contextFingerprint, changed.contextFingerprint);
    assert.notStrictEqual(first.reuseKey, changed.reuseKey);
  });

  await test('relevant shared memory participates in reuse without self-invalidating the same question', async () => {
    let relevant = [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', kind: 'research', title: 'Tadqiqot', content_markdown: 'Xulosa' }];
    const db = {
      async query(sql, params) {
        if (/FROM juristai_private\.legal_corpus_state/.test(sql)) return { rows: [{ revision: '1', updated_at: null }] };
        if (/FROM workspace_documents d/.test(sql) || /mi\.kind = ANY/.test(sql)) return { rows: [] };
        if (/WITH query AS/.test(sql)) {
          assert.strictEqual(params[3], sha256(normalizeQuestion('Ijara savoli')));
          return { rows: relevant };
        }
        throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
      },
    };
    const first = await loadContext(db, workspaceId, null, 'Ijara savoli');
    relevant = [];
    const changed = await loadContext(db, workspaceId, null, 'Ijara savoli');
    assert.notStrictEqual(first.reuseKey, changed.reuseKey);
  });

  await test('a canonical answer is reused with zero model calls and linked provenance', async () => {
    let generated = 0;
    const memory = {
      id: '55555555-5555-4555-8555-555555555555',
      content_markdown: 'Oldin tekshirilgan javob',
      content_json: { topic: 'mehnat', nextActions: [] },
    };
    const pool = transactionalPool(async (sql) => {
      if (/^BEGIN|^COMMIT|set_config|pg_advisory_xact_lock|UPDATE workspace_ai_threads/.test(sql.trim())) return { rows: [], rowCount: 0 };
      if (/FROM workspaces w/.test(sql)) return { rows: [{ id: workspaceId, role: 'member', tariff_plan: 'platinum', tariff_expires_at: null, deleted_at: null }] };
      if (/FROM juristai_private\.legal_corpus_state/.test(sql)) return { rows: [{ revision: '1', updated_at: null }] };
      if (/FROM workspace_documents d/.test(sql) || /mi\.kind = ANY/.test(sql) || /WITH query AS/.test(sql)) return { rows: [] };
      if (/FROM workspace_memory_items\s+WHERE/.test(sql)) return { rows: [memory] };
      if (/INSERT INTO workspace_ai_threads/.test(sql)) return { rows: [{ id: '66666666-6666-4666-8666-666666666666' }] };
      if (/INSERT INTO workspace_ai_runs/.test(sql)) return { rows: [{ id: '77777777-7777-4777-8777-777777777777' }] };
      if (/INSERT INTO workspace_ai_messages/.test(sql)) return { rows: [], rowCount: 2 };
      throw new Error(`Unexpected query: ${sql.slice(0, 100)}`);
    });
    const service = createWorkspaceAiService({ pool, generateAnswer: async () => { generated++; } });
    const result = await service.ask({ workspaceId, question: 'Ish haqi masalasi', userId: 42 });
    assert.strictEqual(generated, 0);
    assert.strictEqual(result.reused, true);
    assert.strictEqual(result.reply, memory.content_markdown);
    assert.deepStrictEqual(result.usage, { inTokens: 0, outTokens: 0, costUsd: 0 });
    const messageWrite = pool.client.queries.find((item) => /INSERT INTO workspace_ai_messages/.test(item.sql));
    assert.ok(messageWrite.sql.includes('memory_item_id'));
    assert.ok(messageWrite.params.includes(memory.id));
  });

  await test('an already-running identical request returns 202 state without creating an empty thread', async () => {
    let generated = 0;
    const pool = transactionalPool(async (sql) => {
      const trimmed = sql.trim();
      if (/^BEGIN|^COMMIT|set_config|pg_advisory_xact_lock/.test(trimmed)) return { rows: [], rowCount: 0 };
      if (/FROM workspaces w/.test(sql)) return { rows: [{ id: workspaceId, role: 'member', tariff_plan: 'platinum', tariff_expires_at: null, deleted_at: null }] };
      if (/FROM juristai_private\.legal_corpus_state/.test(sql)) return { rows: [{ revision: '1', updated_at: null }] };
      if (/FROM workspace_documents d/.test(sql) || /mi\.kind = ANY/.test(sql) || /WITH query AS/.test(sql)) return { rows: [] };
      if (/FROM workspace_memory_items\s+WHERE/.test(sql)) return { rows: [] };
      if (/UPDATE workspace_ai_runs/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM workspace_ai_runs/.test(sql)) return { rows: [{ id: '88888888-8888-4888-8888-888888888888', thread_id: '99999999-9999-4999-8999-999999999999', status: 'running' }] };
      throw new Error(`Unexpected query: ${sql.slice(0, 100)}`);
    });
    const service = createWorkspaceAiService({ pool, generateAnswer: async () => { generated++; } });
    const result = await service.ask({ workspaceId, question: 'Bir xil savol', userId: 42 });
    assert.strictEqual(result.status, 'in_progress');
    assert.strictEqual(generated, 0);
    assert.ok(!pool.client.queries.some((item) => /INSERT INTO workspace_ai_threads/.test(item.sql)));
  });

  await test('a new answer is persisted once, attributed, costed and supersedes stale matching work', async () => {
    const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const threadId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const memoryId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    let generated = 0;
    const pool = transactionalPool(async (sql, params) => {
      const trimmed = sql.trim();
      if (/^BEGIN|^COMMIT|set_config|pg_advisory_xact_lock/.test(trimmed)) return { rows: [], rowCount: 0 };
      if (/FROM workspaces w/.test(sql)) return { rows: [{ id: workspaceId, role: 'member', tariff_plan: 'platinum', tariff_expires_at: null, deleted_at: null }] };
      if (/FROM juristai_private\.legal_corpus_state/.test(sql)) return { rows: [{ revision: '1', updated_at: null }] };
      if (/FROM workspace_documents d/.test(sql) || /mi\.kind = ANY/.test(sql) || /WITH query AS/.test(sql)) return { rows: [] };
      if (/SELECT \* FROM workspace_memory_items/.test(sql)) return { rows: [] };
      if (/UPDATE workspace_ai_runs/.test(sql)) return { rows: [], rowCount: 1 };
      if (/FROM workspace_ai_runs/.test(sql)) return { rows: [] };
      if (/INSERT INTO workspace_ai_threads/.test(sql)) return { rows: [{ id: threadId }] };
      if (/INSERT INTO workspace_ai_runs/.test(sql)) return { rows: [{ id: runId }] };
      if (/FROM workspace_ai_messages/.test(sql)) return { rows: [] };
      if (/INSERT INTO workspace_ai_messages/.test(sql) || /UPDATE workspace_ai_threads/.test(sql)) return { rows: [], rowCount: 1 };
      if (/INSERT INTO workspace_memory_items/.test(sql)) {
        return { rows: [{ id: memoryId, source_ai_run_id: runId, content_markdown: 'Yangi javob', content_json: { topic: 'mehnat', nextActions: [] } }] };
      }
      if (/UPDATE workspace_memory_items/.test(sql)) {
        assert.strictEqual(params[2], memoryId);
        assert.strictEqual(typeof params[3], 'string');
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql.slice(0, 100)}`);
    });
    const service = createWorkspaceAiService({
      pool,
      generateAnswer: async () => {
        generated++;
        return {
          reply: 'Yangi javob', provider: 'gpt-5.6-luna', topic: 'mehnat',
          rag: { chunks: 2 }, nextActions: [], citations: [], policyVersions: {},
          usage: { inTokens: 100, outTokens: 20, costUsd: 0.000044 },
        };
      },
    });
    const result = await service.ask({ workspaceId, question: 'Yangi mehnat savoli', userId: 42 });
    assert.strictEqual(generated, 1);
    assert.strictEqual(result.reused, false);
    assert.strictEqual(result.memoryItemId, memoryId);
    assert.strictEqual(result.usage.inTokens, 100);
    assert.ok(pool.client.queries.some((item) => /content_json ->> 'questionHash'/.test(item.sql)));
  });

  console.log('\nworkspace — migrations, RLS and API coverage\n');

  await test('migration runner sees only ordered immutable migration names', async () => {
    const files = await migrationFiles(path.join(__dirname, '..', 'migrations'));
    assert.deepStrictEqual(files, [
      '20260822_001_workspace_core.sql',
      '20260822_002_workspace_rls_realtime_storage.sql',
      '20260822_003_workspace_corpus_revision.sql',
      '20260825_004_workspace_entitlements_chat.sql',
      '20260825_005_workspace_master_owner.sql',
      '20260825_006_workspace_open_invitations.sql',
      '20260825_007_workspace_invitation_membership_guard.sql',
    ]);
    assert.strictEqual(stripOuterTransaction('BEGIN;\nSELECT 1;\nCOMMIT;'), 'SELECT 1;');
  });

  await test('all Workspace tables have RLS and authenticated policies', () => {
    const core = fs.readFileSync(path.join(__dirname, '..', 'migrations', '20260822_001_workspace_core.sql'), 'utf8');
    const security = fs.readFileSync(path.join(__dirname, '..', 'migrations', '20260822_002_workspace_rls_realtime_storage.sql'), 'utf8');
    const tables = [...core.matchAll(/CREATE TABLE public\.(workspace_[a-z_]+|workspaces)\s*\(/g)].map((m) => m[1]);
    assert.strictEqual(tables.length, 21);
    for (const table of tables) {
      assert.ok(security.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`), `${table} has no RLS`);
    }
    assert.ok(security.includes("lower(COALESCE(a.tariff_plan, '')) = 'platinum'") || core.includes("lower(COALESCE(a.tariff_plan, '')) = 'platinum'"));
    assert.ok(security.includes("bucket_id = 'workspace-documents'"));
    assert.ok(security.includes("pubname = 'supabase_realtime'"));
    assert.ok(security.includes('ON realtime.messages FOR SELECT TO authenticated'));
    assert.ok(security.includes('ON realtime.messages FOR INSERT TO authenticated'));
    assert.ok(security.includes("realtime.messages.extension = 'presence'"));
    assert.ok(security.includes('realtime_topic_workspace_id'));
    assert.ok(security.includes('GRANT SELECT ON TABLE'));
    assert.ok(!security.includes('GRANT SELECT, INSERT ON public.workspace_document_files'));
    assert.ok(!security.includes('watchers_insert_writer_or_self'), 'Viewer must remain read-only');
    assert.ok(core.includes('ON DELETE SET NULL (source_ai_run_id)'));
    assert.ok(core.includes('REFERENCES public.workspace_ai_runs(workspace_id, id)'));
    assert.ok(core.includes('REFERENCES public.workspace_document_versions(workspace_id, id)'));
    const corpusRevision = fs.readFileSync(path.join(__dirname, '..', 'migrations', '20260822_003_workspace_corpus_revision.sql'), 'utf8');
    assert.ok(corpusRevision.includes('legal_corpus_state'));
    assert.ok(corpusRevision.includes('FOR EACH STATEMENT'));
    assert.ok(corpusRevision.includes('last_transaction'));
    const masterOwner = fs.readFileSync(path.join(__dirname, '..', 'migrations', '20260825_005_workspace_master_owner.sql'), 'utf8');
    assert.ok(masterOwner.includes("a.role IN ('user', 'master')"));
    assert.ok(masterOwner.includes("lower(COALESCE(a.tariff_plan, '')) = 'platinum'"));
    const openInvitations = fs.readFileSync(path.join(__dirname, '..', 'migrations', '20260825_006_workspace_open_invitations.sql'), 'utf8');
    assert.ok(openInvitations.includes('num_nonnulls(target_email, target_username) <= 1'));
    assert.ok(openInvitations.includes('(NEW.target_email IS NULL AND NEW.target_username IS NULL)'));
    const invitationGuard = fs.readFileSync(path.join(__dirname, '..', 'migrations', '20260825_007_workspace_invitation_membership_guard.sql'), 'utf8');
    assert.ok(invitationGuard.includes('Account is already a workspace member'));
    assert.ok(invitationGuard.includes('wm.workspace_id = NEW.workspace_id'));
  });

  await test('Phase 1 routes and fatal migration guard are mounted without legacy FK rewrites', () => {
    const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'workspace', 'routes.js'), 'utf8');
    const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
    for (const endpoint of [
      '/workspaces', '/invitations', '/tasks', '/timeline', '/comments', '/links',
      '/documents', '/versions', '/assistant/ask', '/assistant/runs', '/memory',
      '/workspace-realtime/token',
      '/workspace-account/email/verify',
    ]) assert.ok(routes.includes(endpoint), `missing route ${endpoint}`);
    assert.ok(server.includes('runVersionedMigrations(pool)'));
    assert.ok(server.includes('mountWorkspaceRoutes(app'));
    assert.ok(server.includes('email_verification_source'));
    assert.ok(server.includes('emailWasVerified'));
    assert.ok(server.includes("emailWasVerified = storedCode.channel === 'email'"));
    assert.ok(!server.includes('!!(cleanEmail)'));
    assert.ok(!server.includes('Drop ALL FK constraints referencing admins'));
    assert.ok(!server.includes('WHERE con.contype = \'f\' AND ref.relname = \'admins\''));
  });

  await test('Workspace frontend replaces Jamoa and keeps live collaboration client-side', () => {
    const dashboard = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
    const frontend = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'workspace.js'), 'utf8');
    const styles = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'workspace.css'), 'utf8');
    const redesignStyles = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'redesign-v2.css'), 'utf8');
    const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'workspace', 'routes.js'), 'utf8');
    assert.ok(dashboard.includes('id="workspaceApp"'));
    assert.ok(dashboard.includes('./js/workspace.js'));
    assert.ok(dashboard.includes('<span class="tab-label">Workspace</span>'));
    assert.ok(dashboard.includes("hasPendingWorkspaceInvite ? 'jamoa'"), 'pending invitations must resume in Workspace after login');
    assert.ok(frontend.includes("channel.on('postgres_changes'"));
    assert.ok(frontend.includes("channel.on('presence'"));
    assert.ok(frontend.includes("storage.from('workspace-documents').upload"));
    assert.ok(frontend.includes('var COPY = {'));
    assert.ok(frontend.includes('uz: {') && frontend.includes('ru: {') && frontend.includes('en: {'));
    assert.ok(!frontend.includes('setInterval('), 'Workspace live sync must not poll');
    assert.ok(styles.includes('[data-theme="dark"] .workspace-app'));
    assert.ok(styles.includes('.ws-save-bar { position: static;'), 'task actions must not cover following sections');
    assert.ok(frontend.includes('ws-timeline-label-text'), 'timeline labels need an inner ellipsis boundary');
    assert.ok(styles.includes('appearance: none;'), 'Workspace selects should use the shared dropdown treatment');
    assert.ok(frontend.includes('function enhanceDropdowns(scope)'), 'all Workspace selects need custom dropdown enhancement');
    assert.ok(frontend.includes("optionButton.dataset.action = 'dropdown-option'"), 'custom dropdowns need selectable options');
    assert.ok(styles.includes('.ws-dropdown-menu {'), 'custom dropdown menus need dashboard-native styling');
    assert.ok(styles.includes('.ws-native-select {'), 'native select popovers must stay visually hidden');
    assert.ok(!frontend.includes('onclick="event.stopPropagation()"'), 'modal controls must keep delegated click handling');
    assert.ok(styles.includes('.ws-task-row { width: 100%; min-width: 0;'), 'task rows must span the same grid width as their list header');
    assert.ok(frontend.includes("day: 'Kunlik'"), 'Uzbek timeline controls need the daily zoom label');
    assert.ok(frontend.includes("['day','week','month','quarter']"), 'timeline must expose all four zoom levels');
    assert.ok(frontend.includes('data-from-key="matter" data-to-key="member:'), 'matter must link directly to every Workspace member');
    assert.ok(frontend.includes('data-from-key="matter" data-to-key="task:'), 'matter must link directly to every related task');
    assert.ok(frontend.includes('function updateGraphEdges(stage)'), 'graph links must be recalculated while nodes move');
    assert.ok(frontend.includes('ws-task-description'), 'list view must expose each task description');
    assert.ok(styles.includes('.ws-graph-following'), 'graph followers need the delayed movement treatment');
    assert.ok(styles.includes('scrollbar-width: none;'), 'graph scrolling must remain usable without visible scrollbars');
    assert.ok(styles.includes('#tabJamoa::before'), 'Workspace containers and their pseudo-elements must stay transparent');
    assert.ok(frontend.includes("COPY.uz.dateFormat = 'kk.oo.yyyy'"), 'Workspace dates need the Uzbek numeric format');
    assert.ok(frontend.includes('function datePickerField('), 'Workspace date fields need the shared custom date picker');
    assert.ok(styles.includes('.ws-date-menu {'), 'Workspace date popovers need dashboard-native styling');
    assert.ok(!frontend.includes('type="date"'), 'browser-localized native date popovers must not be used');
    assert.ok(frontend.includes("document.body.classList.toggle('workspace-chat-open'"), 'open team chat must reserve space for the bottom navigation');
    assert.ok(styles.includes('.ws-workspace-layout.chat-open .ws-filters'), 'chat-open filters need their own responsive row');
    assert.ok(styles.includes('white-space: nowrap; cursor: pointer;'), 'view labels must not wrap when chat is open');
    assert.ok(redesignStyles.includes('body.workspace-chat-open .bottom-tab-bar'), 'open chat must move or hide the redesigned bottom navigation');

    const invitePage = fs.readFileSync(path.join(__dirname, '..', 'public', 'workspace-invite.html'), 'utf8');
    assert.ok(invitePage.includes('Ushbu hisob bilan qo‘shilish'), 'invite acceptance must require explicit account confirmation');
    assert.ok(invitePage.includes('Boshqa hisob bilan kirish'), 'invitees must be able to switch accounts before acceptance');
    assert.ok(!invitePage.includes("return request('/api/workspace-invitations/'+encodeURIComponent(token)+'/accept"), 'invite inspection must not auto-accept a bearer link');
    assert.ok(routes.includes('workspace_already_member'), 'the API must reject invitations accepted by existing members');
    assert.ok(routes.includes('acceptingAccount'), 'invite inspection must identify the currently authenticated account');
    assert.ok(routes.includes("zoomLevels: ['day', 'week', 'month', 'quarter']"), 'timeline API must advertise daily zoom');
    assert.ok(frontend.includes('workspace-ai-next-action'), 'Workspace AI must expose the main legal next-step flow');
    assert.ok(frontend.includes("api('POST','/jurist-feedback'"), 'Workspace AI must use the platform feedback loop');
    assert.ok(frontend.includes("data-action=\"ai-thread\""), 'Workspace AI must expose shared conversation history');
    assert.ok(frontend.includes('downloadAiAnswer'), 'Workspace AI answers must keep the platform download action');
    assert.ok(routes.includes('LEFT JOIN workspace_memory_items mi'), 'loaded Workspace AI history must restore saved answer metadata');
    assert.ok(dashboard.includes('sourceAiRunId: continuation.sourceAiRunId || null'), 'generated next-step documents must link back to their Workspace AI run');
  });

  await test('generated Workspace documents preserve their source AI run in version one', () => {
    const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'workspace', 'routes.js'), 'utf8');
    assert.ok(routes.includes("req.body.sourceAiRunId ? uuid(req.body.sourceAiRunId, 'sourceAiRunId') : null"));
    assert.ok(routes.includes('(workspace_id,document_id,version_number,content_text,content_json,source_ai_run_id,created_by)'));
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
})();
