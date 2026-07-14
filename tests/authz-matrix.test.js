'use strict';

/**
 * Anonymous authorization matrix — verifies that every sensitive endpoint
 * rejects UNAUTHENTICATED requests (401/403), and that public endpoints stay
 * public. Catches the classic regression: a new route added without
 * requireAuth / requireStaff / requireMasterAdmin.
 *
 * Needs NO credentials and mutates nothing, so it is safe to point at
 * production:
 *
 *   BASE_URL=https://juristai-zd8j.onrender.com node tests/authz-matrix.test.js
 *
 * Default BASE_URL is http://localhost:3000 (local dev).
 * Exit code 0 = all pass, 1 = at least one endpoint mis-secured.
 */

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

// [method, path, allowedStatuses, note]
// 401/403 both count as "rejected"; 429 accepted too (rate limiter kicked in
// first, which also means the route wasn't served anonymously).
const REJECTED = [401, 403, 429];
const CASES = [
  // ── public — must stay open ──
  ['GET', '/health', [200], 'health check'],
  ['GET', '/', [200], 'landing page'],
  ['GET', '/login.html', [200], 'login page'],

  // ── authenticated-only (any role) ──
  ['GET', '/api/user-info', REJECTED, 'session identity'],
  ['GET', '/api/requests', REJECTED, 'client requests list'],
  ['GET', '/api/requests/1', REJECTED, 'client request detail'],
  ['GET', '/api/stats', REJECTED, 'stats'],
  ['GET', '/api/chat/messages', REJECTED, 'team chat'],
  ['GET', '/api/ai-chat-sessions', REJECTED, 'AI chat history'],
  ['GET', '/api/templates', REJECTED, 'doc templates'],
  ['GET', '/api/events', REJECTED, 'SSE event channel'],
  ['POST', '/api/legal-chat', REJECTED, 'AI answer generation'],
  ['POST', '/api/answer-feedback', REJECTED, 'answer flagging'],
  ['POST', '/api/rag/verify-chat-answer', REJECTED, 'corpus write'],
  ['POST', '/api/draft/ai-generate', REJECTED, 'AI drafting'],
  ['POST', '/api/draft/export-raw', REJECTED, 'doc export'],
  ['POST', '/api/analyze', REJECTED, 'doc analysis'],
  ['POST', '/api/analyze/extract', REJECTED, 'PDF extraction'],
  ['POST', '/api/analyze/ocr-image', REJECTED, 'OCR'],

  // ── staff-only ──
  ['GET', '/api/files/AgACAgTEST/download', REJECTED, 'client file download'],
  ['GET', '/api/files/AgACAgTEST', REJECTED, 'client file link'],

  // ── master-only ──
  ['GET', '/api/admin/audit-log', REJECTED, 'audit trail'],
  ['GET', '/api/admin/suggested-sources', REJECTED, 'source suggestions'],
  ['GET', '/api/admin/coverage-gaps', REJECTED, 'coverage log'],
  ['GET', '/api/admin/corpus-diagnostic', REJECTED, 'corpus diagnostic'],
  ['GET', '/api/admin/retrieval-debug?q=test', REJECTED, 'retrieval debug'],
  ['GET', '/api/admin/answer-feedback', REJECTED, 'error reports'],
  ['GET', '/api/templates/full', REJECTED, 'full templates w/ bodies'],
];

async function run() {
  console.log(`Authorization matrix against: ${BASE}\n`);

  // Canary: /health must be 200 before any result can be trusted. A proxy or
  // firewall answering 403 to everything would otherwise make every "rejected"
  // check a false positive.
  try {
    const canary = await fetch(BASE + '/health');
    if (canary.status !== 200) {
      console.error(`ABORT: /health returned ${canary.status} — the app is unreachable from here (proxy/firewall/wrong URL). No authorization conclusions can be drawn.`);
      process.exit(2);
    }
  } catch (e) {
    console.error(`ABORT: cannot reach ${BASE} (${e.message}). Run this from a machine with direct access.`);
    process.exit(2);
  }

  let failed = 0;
  for (const [method, path, allowed, note] of CASES) {
    let status, detail = '';
    try {
      const resp = await fetch(BASE + path, {
        method,
        redirect: 'manual',
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
        body: method === 'POST' ? '{}' : undefined,
      });
      status = resp.status;
      // Redirect to login also counts as rejected for HTML-serving paths.
      if ([301, 302, 303, 307].includes(status) && allowed === REJECTED) {
        const loc = resp.headers.get('location') || '';
        if (loc.includes('login')) status = 401;
      }
      // Drain/cancel body (SSE would otherwise hang the process).
      try { await resp.body?.cancel?.(); } catch (_) {}
    } catch (e) {
      status = 'ERR';
      detail = e.message;
    }
    const ok = Array.isArray(allowed) && allowed.includes(status);
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(status).padEnd(4)} ${method.padEnd(4)} ${path.padEnd(44)} ${note}${detail ? ' — ' + detail : ''}`);
  }
  console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
  if (failed > 0) {
    console.error(`\n❌ ${failed} endpoint(s) mis-secured or unreachable — investigate before launch.`);
    process.exit(1);
  }
  console.log('✅ All sensitive endpoints reject anonymous access.');
}

run().catch(e => { console.error('Runner error:', e.message); process.exit(1); });
