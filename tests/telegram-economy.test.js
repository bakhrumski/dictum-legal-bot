'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');
const fs = require('fs');

const state = {
  free: 0,
  credits: 0,
  payments: new Set(),
  activity: new Map(),
};

function query(sql, params = []) {
  if (/CREATE TABLE|INSERT INTO tg_agent_free_usage[\s\S]*SELECT chat_id|INSERT INTO tg_bot_daily_activity[\s\S]*SELECT/i.test(sql)) return { rows: [] };
  if (/AS\s+free_used/i.test(sql) && /AS\s+paid_credits/i.test(sql)) {
    return { rows: [{ free_used: state.free, paid_credits: state.credits }] };
  }
  if (/INSERT INTO tg_agent_free_usage/i.test(sql)) {
    const limit = Number(params[1]) || 0;
    if (state.free >= limit) return { rows: [] };
    state.free++;
    return { rows: [{ free_answers: state.free }] };
  }
  if (/UPDATE tg_agent_free_usage/i.test(sql)) {
    state.free = Math.max(0, state.free - 1);
    return { rows: [] };
  }
  if (/SELECT credits FROM tg_answer_wallets/i.test(sql)) {
    return { rows: state.credits ? [{ credits: state.credits }] : [] };
  }
  if (/UPDATE tg_answer_wallets/i.test(sql)) {
    if (!state.credits) return { rows: [] };
    state.credits--;
    return { rows: [{ credits: state.credits }] };
  }
  if (/INSERT INTO tg_answer_payments/i.test(sql)) {
    const chargeId = params[6];
    if (state.payments.has(chargeId)) return { rows: [] };
    state.payments.add(chargeId);
    return { rows: [{ id: state.payments.size }] };
  }
  if (/INSERT INTO tg_answer_wallets/i.test(sql)) {
    state.credits += Number(params[1] || 1);
    return { rows: [{ credits: state.credits }] };
  }
  if (/INSERT INTO tg_bot_daily_activity/i.test(sql)) {
    const chatId = String(params[0]);
    state.activity.set(chatId, (state.activity.get(chatId) || 0) + 1);
    return { rows: [] };
  }
  if (/COUNT\(DISTINCT chat_id\)/i.test(sql)) {
    const users = state.activity.size;
    return { rows: [{ daily_users: users, monthly_users: users, total_users: users }] };
  }
  return { rows: [] };
}

const fakePool = {
  query: async (sql, params) => query(sql, params),
  connect: async () => ({
    query: async (sql, params) => query(sql, params),
    release() {},
  }),
};

const economyPath = require.resolve('../src/services/telegram-economy');
const source = fs.readFileSync(economyPath, 'utf8');
const mod = new Module(economyPath);
mod.filename = economyPath;
mod.paths = Module._nodeModulePaths(path.dirname(economyPath));
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '../database/db') return { pool: fakePool };
  return originalRequire.apply(this, arguments);
};
mod._compile(source, economyPath);
Module.prototype.require = originalRequire;
const economy = mod.exports;

(async () => {
  const first = await economy.claimAnswerEntitlement(1, 1);
  assert.strictEqual(first.allowed, true);
  assert.strictEqual(first.source, 'free');

  const blocked = await economy.claimAnswerEntitlement(1, 1);
  assert.strictEqual(blocked.allowed, false);
  const preflightBlocked = await economy.getAnswerEntitlementStatus(1, 1);
  assert.strictEqual(preflightBlocked.allowed, false);

  const payment = {
    chatId: 1,
    telegramUserId: 1,
    invoicePayload: 'juristai_answers_v1:1:test',
    currency: 'XTR',
    totalAmount: 1,
    credits: 4,
    telegramPaymentChargeId: 'charge-1',
  };
  const granted = await economy.grantPaidAnswers(payment);
  assert.strictEqual(granted.credited, true);
  assert.strictEqual(granted.credits, 4);
  const duplicate = await economy.grantPaidAnswers(payment);
  assert.strictEqual(duplicate.duplicate, true);
  assert.strictEqual(duplicate.credits, 4, 'duplicate receipt must not grant credits twice');

  const paid = await economy.claimAnswerEntitlement(1, 1);
  assert.strictEqual(paid.source, 'paid');
  assert.strictEqual(paid.paidCredits, 3);
  await economy.releaseAnswerEntitlement(1, paid);
  assert.strictEqual(await economy.getPaidAnswerCredits(1), 4, 'failed paid answer must refund a credit');

  state.credits = 0;
  state.free = 0;
  const freeReservation = await economy.claimAnswerEntitlement(2, 1);
  await economy.releaseAnswerEntitlement(2, freeReservation);
  assert.strictEqual(state.free, 0, 'failed free answer must restore the lifetime entitlement');

  await economy.recordTelegramActivity(1);
  await economy.recordTelegramActivity(1);
  await economy.recordTelegramActivity(2);
  const stats = await economy.getTelegramUserStats();
  assert.deepStrictEqual(stats, { dailyUsers: 2, monthlyUsers: 2, totalUsers: 2 });

  console.log('telegram-economy: all tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
