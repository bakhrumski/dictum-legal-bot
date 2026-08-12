'use strict';

const assert = require('assert');
const { createHermesShadow, normalizeProductionRoute, redactSensitiveText, extractDecision } = require('../src/agents/hermes-shadow');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ✗ ${name}\n      ${error.message}`);
    failed++;
  }
}

function fakeDb() {
  const inserts = [];
  return {
    inserts,
    query: async (sql, params = []) => {
      if (/INSERT INTO tg_agent_shadow_runs/i.test(sql)) inserts.push(params);
      if (/COUNT\(\*\).*FROM tg_agent_shadow_runs/is.test(sql)) {
        return { rows: [{ total: 2, successful: 1, failed: 1, agreements: 1, agreement_rate: '100.0', total_tokens: '1100', estimated_cost_usd: 0.00032, average_latency_ms: 42 }] };
      }
      if (/SELECT id, message_preview/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
}

(async () => {
  console.log('\nhermes-shadow — isolation and telemetry\n');

  await test('disabled shadow makes no network or database call', async () => {
    const db = fakeDb();
    let fetches = 0;
    const service = createHermesShadow({
      env: {},
      db,
      fetchImpl: async () => { fetches++; },
    });
    const result = await service.run({ chatId: 1, text: 'Savol' });
    assert.strictEqual(result.status, 'disabled');
    assert.strictEqual(fetches, 0);
    assert.strictEqual(db.inserts.length, 0);
  });

  await test('successful evaluation records a redacted, comparable decision', async () => {
    const db = fakeDb();
    let requestedUrl = '';
    const service = createHermesShadow({
      env: {
        HERMES_SHADOW_ENABLED: 'true',
        HERMES_SHADOW_URL: 'http://hermes.internal:8642/v1',
        HERMES_SHADOW_MODEL: 'hermes-agent',
        HERMES_SHADOW_PRICING_MODEL: 'gpt-5.6-luna',
        HERMES_SHADOW_SAMPLE_RATE: '1',
      },
      db,
      random: () => 0,
      fetchImpl: async (url) => {
        requestedUrl = url;
        return {
          ok: true,
          json: async () => ({
            model: 'hermes-agent',
            choices: [{ message: { content: JSON.stringify({
              intent: 'huquqiy_savol',
              recommended_action: 'answer',
              needs_clarification: false,
              should_use_ai_answer: true,
              should_escalate: false,
              confidence: 0.91,
              reason: 'Concrete legal question',
            }) } }],
            usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 },
          }),
        };
      },
    });

    const result = await service.run({
      chatId: 77,
      text: 'Telefonim +998 90 123 45 67, GAI jarima yozdi',
      productionResult: { action: 'answered', escalate: false, meta: { intent: 'huquqiy_savol' } },
    });

    assert.strictEqual(requestedUrl, 'http://hermes.internal:8642/v1/chat/completions');
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.agreement, true);
    assert.strictEqual(db.inserts.length, 1);
    const row = db.inserts[0];
    assert.ok(row[1].includes('[telefon]'), 'phone must be redacted before persistence or transmission');
    assert.strictEqual(row[3], 'answer');
    assert.strictEqual(row[6], 'answer');
    assert.strictEqual(row[10], true);
    assert.ok(Math.abs(Number(row[15]) - 0.00032) < 1e-12, 'known backing-model cost must be calculated');
  });

  await test('Hermes failure is returned as telemetry and never thrown', async () => {
    const db = fakeDb();
    const service = createHermesShadow({
      env: { HERMES_SHADOW_ENABLED: 'true', HERMES_SHADOW_URL: 'http://hermes:8642' },
      db,
      random: () => 0,
      fetchImpl: async () => ({ ok: false, status: 503, text: async () => 'offline' }),
    });
    const result = await service.run({
      chatId: 9,
      text: 'Savol',
      productionResult: { action: 'clarify', escalate: false, meta: { intent: 'noaniq' } },
    });
    assert.strictEqual(result.status, 'failed');
    assert.match(result.error, /503/);
    assert.strictEqual(db.inserts.length, 1);
    assert.strictEqual(db.inserts[0][17], 'failed');
  });

  await test('invalid JSON is retried once and both attempts are counted', async () => {
    const db = fakeDb();
    let calls = 0;
    const service = createHermesShadow({
      env: {
        HERMES_SHADOW_ENABLED: 'true',
        HERMES_SHADOW_URL: 'http://hermes:8642/v1',
        HERMES_SHADOW_MODEL: 'hermes-agent',
        HERMES_SHADOW_PRICING_MODEL: 'gpt-5.6-luna',
        HERMES_SHADOW_MAX_ATTEMPTS: '2',
      },
      db,
      random: () => 0,
      fetchImpl: async () => {
        calls++;
        return {
          ok: true,
          json: async () => ({
            model: 'hermes-agent',
            choices: [{ message: { content: calls === 1 ? 'Aniqlashtirish kerak.' : JSON.stringify({
              intent: 'noaniq',
              recommended_action: 'clarify',
              needs_clarification: true,
              should_use_ai_answer: false,
              should_escalate: false,
              confidence: 0.88,
              reason: 'Vague help request',
            }) } }],
            usage: { prompt_tokens: 500, completion_tokens: 50, total_tokens: 550 },
          }),
        };
      },
    });
    const result = await service.run({
      chatId: 10,
      text: 'Menga yordam kerak',
      productionResult: { action: 'clarify', escalate: false, meta: { intent: 'noaniq' } },
    });
    assert.strictEqual(calls, 2);
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.agreement, true);
    assert.strictEqual(result.usage.totalTokens, 1100);
    assert.ok(Number(db.inserts[0][15]) > 0, 'pricing alias must use the configured backing model');
  });

  await test('compact fallback accepts only enumerated, explicit routing fields', async () => {
    const extracted = extractDecision(
      'ROUTE=clarify; INTENT=noaniq; ESCALATE=false; CONFIDENCE=0.93; REASON=The request is vague'
    );
    assert.strictEqual(extracted.format, 'compact');
    assert.strictEqual(extracted.value.recommended_action, 'clarify');
    assert.strictEqual(extracted.value.intent, 'noaniq');
    assert.strictEqual(extracted.value.should_escalate, false);
    assert.throws(
      () => extractDecision('The user probably needs clarification.'),
      /recognized decision/
    );
  });

  await test('compact Hermes decision completes without a retry', async () => {
    const db = fakeDb();
    let calls = 0;
    const service = createHermesShadow({
      env: {
        HERMES_SHADOW_ENABLED: 'true',
        HERMES_SHADOW_URL: 'http://hermes:8642/v1',
        HERMES_SHADOW_MODEL: 'hermes-agent',
      },
      db,
      random: () => 0,
      fetchImpl: async () => {
        calls++;
        return {
          ok: true,
          json: async () => ({
            model: 'hermes-agent',
            choices: [{ message: { content: 'ROUTE=clarify; INTENT=noaniq; ESCALATE=false; CONFIDENCE=0.94; REASON=Vague help request' } }],
            usage: { prompt_tokens: 400, completion_tokens: 30, total_tokens: 430 },
          }),
        };
      },
    });
    const result = await service.run({
      chatId: 11,
      text: 'Menga yordam kerak',
      productionResult: { action: 'clarify', escalate: false, meta: { intent: 'noaniq' } },
    });
    assert.strictEqual(calls, 1);
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.agreement, true);
    const rawResult = JSON.parse(db.inserts[0][19]);
    assert.strictEqual(rawResult.responseFormat, 'compact');
  });

  await test('timeout can be configured up to sixty seconds', async () => {
    const service = createHermesShadow({
      env: {
        HERMES_SHADOW_ENABLED: 'true',
        HERMES_SHADOW_URL: 'http://hermes:8642/v1',
        HERMES_SHADOW_TIMEOUT_MS: '60000',
      },
      db: fakeDb(),
      fetchImpl: async () => { throw new Error('unused'); },
    });
    assert.strictEqual(service.publicStatus().timeoutMs, 60000);
  });

  await test('report exposes only public configuration and aggregate metrics', async () => {
    const db = fakeDb();
    const service = createHermesShadow({
      env: {
        HERMES_SHADOW_ENABLED: 'true',
        HERMES_SHADOW_URL: 'http://hermes:8642/v1',
        HERMES_SHADOW_API_KEY: 'must-not-leak',
        HERMES_SHADOW_MODEL: 'hermes-local',
      },
      db,
      fetchImpl: async () => { throw new Error('unused'); },
    });
    const report = await service.report({ days: 7, limit: 20 });
    assert.strictEqual(report.status, 'ready');
    assert.strictEqual(report.stats.successful, 1);
    assert.ok(!JSON.stringify(report).includes('must-not-leak'));
    assert.ok(!JSON.stringify(report).includes('hermes:8642'));
  });

  await test('helpers normalize production routes and redact identifiers', async () => {
    assert.strictEqual(normalizeProductionRoute({ action: 'document_intake_started' }), 'document_intake');
    assert.strictEqual(normalizeProductionRoute({ action: 'skip', escalate: true }), 'human_review');
    assert.ok(redactSensitiveText('AA1234567 86001234123412 a@b.uz').includes('[hujjat]'));
    assert.ok(redactSensitiveText('AA1234567 86001234123412 a@b.uz').includes('[JShShIR]'));
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
