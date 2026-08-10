'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
const helperStart = dashboard.indexOf('function normalizeRequestCategory');
const helperEnd = dashboard.indexOf('async function loadRequests', helperStart);
const helperSource = dashboard.slice(helperStart, helperEnd);

function filters(overrides = {}) {
  return {
    search: '', category: '', assignee: '', status: '', assigned: '', urgency: '',
    source: '', sort: 'priority', overdue: '', agent_action: '', ...overrides,
  };
}

function makeFilter(currentFilters) {
  return new Function('currentFilters', `${helperSource}\nreturn { filterLegacyRequests, normalizeRequestCategory };`)(currentFilters);
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (error) { console.error(`  ✗ ${name}\n      ${error.message}`); failed++; }
}

console.log('\noperations queue filters\n');

test('legacy and current category names match', () => {
  const { filterLegacyRequests } = makeFilter(filters({ category: 'Fuqarolik qonunchiligi' }));
  const result = filterLegacyRequests([
    { id: 1, category: 'Fuqarolik huquqi', status: 'pending', created_at: '2026-01-01' },
    { id: 2, category: 'Jinoyat huquqi', status: 'pending', created_at: '2026-01-01' },
  ]);
  assert.deepStrictEqual(result.map(item => item.id), [1]);
});

test('open status excludes answered requests', () => {
  const { filterLegacyRequests } = makeFilter(filters({ status: 'open' }));
  const result = filterLegacyRequests([
    { id: 1, status: 'pending', created_at: '2026-01-01' },
    { id: 2, status: 'answered', created_at: '2026-01-01' },
  ]);
  assert.deepStrictEqual(result.map(item => item.id), [1]);
});

test('search and channel filters compose', () => {
  const { filterLegacyRequests } = makeFilter(filters({ search: 'bakhrom', source: 'telegram' }));
  const result = filterLegacyRequests([
    { id: 1, first_name: 'Bakhrom', source_channel: 'telegram', created_at: '2026-01-01' },
    { id: 2, first_name: 'Bakhrom', source_channel: 'web', created_at: '2026-01-01' },
  ]);
  assert.deepStrictEqual(result.map(item => item.id), [1]);
});

test('server applies category aliases as one safe parameter', () => {
  assert.ok(server.includes("'Fuqarolik qonunchiligi': ['Fuqarolik huquqi']"));
  assert.ok(server.includes('r.category = ANY(${addParam(categories)}::text[])'));
});

test('health strip and queue share the same outer layout width', () => {
  assert.ok(dashboard.includes('class="operations-health-shell"'));
  assert.ok(/\.operations-health-shell\s*\{[\s\S]*?max-width:\s*1440px;[\s\S]*?padding:\s*0 28px;/.test(dashboard));
});

test('active queue tab has explicit readable contrast', () => {
  assert.ok(/\.queue-view-btn\.active\s*\{[^}]*color:\s*#fff;/.test(dashboard));
});

test('queue filters use the accessible JuristAI dropdown instead of the native popup', () => {
  assert.ok(dashboard.includes('function enhanceQueueFilters()'));
  assert.ok(dashboard.includes("trigger.setAttribute('aria-haspopup', 'listbox')"));
  assert.ok(dashboard.includes("menu.setAttribute('role', 'listbox')"));
  assert.ok(dashboard.includes("event.key === 'ArrowDown'"));
  assert.ok(dashboard.includes("event.key === 'Escape'"));
  assert.ok(/\.queue-select-menu\s*\{[^}]*background:\s*var\(--bg-2\);/.test(dashboard));
  assert.ok(/\.queue-native-select\s*\{[^}]*opacity:\s*0\s*!important;/.test(dashboard));
});

test('new management panels collapse and reopen like registration requests', () => {
  for (const id of ['attorneyAdminSection', 'paidServicesSection', 'telegramAgentSection']) {
    assert.ok(dashboard.includes(`#${id}.collapsed .reg-section-body`), `${id} body must hide when collapsed`);
    assert.ok(dashboard.includes(`openManagementSection('${id}',`), `${id} must use the shared accordion control`);
  }
  assert.ok(dashboard.includes('function openManagementSection(sectionId, loader, forceOpen)'));
  assert.ok(dashboard.includes("else section.classList.toggle('collapsed')"));
  assert.ok(dashboard.includes("header.setAttribute('aria-expanded', isOpen ? 'true' : 'false')"));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
