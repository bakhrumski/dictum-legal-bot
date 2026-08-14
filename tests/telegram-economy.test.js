'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');
const fs = require('fs');

const state = {
  currentDay: '2026-08-14',
  freeByDay: new Map(),
  credits: 0,
  payments: new Set(),
  activity: new Map(),
  reservations: new Map(),
};

const freeKey = (chatId, day = state.currentDay) => `${day}:${chatId}`;
const getFree = (chatId, day = state.currentDay) => state.freeByDay.get(freeKey(chatId, day)) || 0;
const setFree = (chatId, value, day = state.currentDay) => state.freeByDay.set(freeKey(chatId, day), value);

function query(sql, params = []) {
  if (/CREATE TABLE|CREATE UNIQUE INDEX|ALTER TABLE|INSERT INTO tg_bot_daily_activity[\s\S]*SELECT/i.test(sql)) return { rows: [] };
  if (/BEGIN|COMMIT|ROLLBACK|pg_advisory_xact_lock/i.test(sql)) return { rows: [] };
  if (/UPDATE tg_agent_free_usage\s+usage/i.test(sql)) return { rows: [] };
  if (/UPDATE tg_answer_reservations/i.test(sql) && /created_at\s*</i.test(sql)) {
    const ttlMs = Number(params[0]) || 0;
    const chatId = params[1] == null ? null : String(params[1]);
    const rows = [];
    for (const reservation of state.reservations.values()) {
      if (reservation.status !== 'pending') continue;
      if (chatId !== null && reservation.chatId !== chatId) continue;
      if (Date.now() - reservation.createdAt < ttlMs) continue;
      reservation.status = 'released';
      rows.push({ reservation_id: reservation.id, chat_id: reservation.chatId, source: reservation.source, usage_day: reservation.usageDay });
    }
    return { rows };
  }
  if (/SELECT reservation_id FROM tg_answer_reservations/i.test(sql)) {
    const chatId = String(params[0]);
    const found = Array.from(state.reservations.values()).find(r => r.chatId === chatId && r.status === 'pending');
    return { rows: found ? [{ reservation_id: found.id }] : [] };
  }
  if (/INSERT INTO tg_answer_reservations/i.test(sql)) {
    const reservation = {
      id: String(params[0]), chatId: String(params[1]),
      source: /'paid'/i.test(sql) ? 'paid' : 'free',
      usageDay: /usage_day/i.test(sql) && !/'paid'/i.test(sql) ? state.currentDay : null,
      status: 'pending', createdAt: Date.now(),
    };
    state.reservations.set(reservation.id, reservation);
    return { rows: [] };
  }
  if (/UPDATE tg_answer_reservations/i.test(sql) && /status = 'delivered'/i.test(sql)) {
    const reservation = state.reservations.get(String(params[0]));
    if (!reservation || reservation.chatId !== String(params[1]) || reservation.status !== 'pending') return { rows: [] };
    reservation.status = 'delivered';
    return { rows: [{ reservation_id: reservation.id }] };
  }
  if (/UPDATE tg_answer_reservations/i.test(sql) && /RETURNING source/i.test(sql)) {
    const reservation = state.reservations.get(String(params[0]));
    if (!reservation || reservation.chatId !== String(params[1]) || reservation.status !== 'pending') return { rows: [] };
    reservation.status = 'released';
    return { rows: [{ source: reservation.source, usage_day: reservation.usageDay }] };
  }
  if (/AS\s+free_used/i.test(sql) && /AS\s+paid_credits/i.test(sql)) {
    const chatId = String(params[0]);
    const pending = Array.from(state.reservations.values()).some(r => r.chatId === chatId && r.status === 'pending');
    return { rows: [{ free_used: getFree(chatId), paid_credits: state.credits, answer_pending: pending }] };
  }
  if (/INSERT INTO tg_agent_daily_free_usage/i.test(sql)) {
    const chatId = String(params[0]);
    const limit = Number(params[1]) || 0;
    const used = getFree(chatId);
    if (used >= limit) return { rows: [] };
    setFree(chatId, used + 1);
    return { rows: [{ free_answers: used + 1 }] };
  }
  if (/UPDATE tg_agent_daily_free_usage/i.test(sql)) {
    const chatId = String(params[0]);
    const day = params[1] || state.currentDay;
    setFree(chatId, Math.max(0, getFree(chatId, day) - 1), day);
    return { rows: [] };
  }
  if (/UPDATE tg_agent_free_usage/i.test(sql)) return { rows: [] };
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
  const first = await economy.claimAnswerEntitlement(1, 3);
  assert.strictEqual(first.allowed, true);
  assert.strictEqual(first.source, 'free');
  assert.strictEqual(first.remaining, 2);
  assert.ok(first.reservationId);

  const blocked = await economy.claimAnswerEntitlement(1, 3);
  assert.strictEqual(blocked.allowed, false);
  assert.strictEqual(blocked.pending, true, 'a simultaneous question must see the in-flight reservation');
  const preflightPending = await economy.getAnswerEntitlementStatus(1, 3);
  assert.strictEqual(preflightPending.pending, true);
  assert.strictEqual(await economy.finalizeAnswerEntitlement(1, first), true);
  assert.strictEqual(await economy.finalizeAnswerEntitlement(1, first), false, 'delivery finalization is idempotent');

  const second = await economy.claimAnswerEntitlement(1, 3);
  assert.strictEqual(second.remaining, 1);
  await economy.finalizeAnswerEntitlement(1, second);
  const third = await economy.claimAnswerEntitlement(1, 3);
  assert.strictEqual(third.remaining, 0);
  await economy.finalizeAnswerEntitlement(1, third);

  const preflightBlocked = await economy.getAnswerEntitlementStatus(1, 3);
  assert.strictEqual(preflightBlocked.allowed, false);
  assert.strictEqual(preflightBlocked.pending, false);

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

  const paid = await economy.claimAnswerEntitlement(1, 3);
  assert.strictEqual(paid.source, 'paid');
  assert.strictEqual(paid.paidCredits, 3);
  await economy.releaseAnswerEntitlement(1, paid);
  assert.strictEqual(await economy.getPaidAnswerCredits(1), 4, 'failed paid answer must refund a credit');
  await economy.releaseAnswerEntitlement(1, paid);
  assert.strictEqual(await economy.getPaidAnswerCredits(1), 4, 'a repeated release must not double-refund');

  state.credits = 0;
  setFree('2', 0);
  const freeReservation = await economy.claimAnswerEntitlement(2, 3);
  await economy.releaseAnswerEntitlement(2, freeReservation);
  assert.strictEqual(getFree('2'), 0, 'failed free answer must restore today\'s entitlement');

  const staleReservation = await economy.claimAnswerEntitlement(3, 3);
  state.reservations.get(staleReservation.reservationId).createdAt = Date.now() - (11 * 60 * 1000);
  const restored = await economy.getAnswerEntitlementStatus(3, 3);
  assert.strictEqual(restored.allowed, true, 'an abandoned reservation must expire back into an available answer');
  assert.strictEqual(getFree('3'), 0);

  state.currentDay = '2026-08-15';
  const reset = await economy.getAnswerEntitlementStatus(1, 3);
  assert.strictEqual(reset.allowed, true, 'the free allowance must reset on the next Tashkent calendar day');
  assert.strictEqual(reset.freeRemaining, 3);

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
