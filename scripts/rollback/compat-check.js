#!/usr/bin/env node
'use strict';

/**
 * Old code on the new schema (docs/tariffs-v2-rollback.md). Steps, on a
 * THROWAWAY database that the new release has already migrated:
 *
 *   node scripts/rollback/compat-check.js seed               (new code) v2 data: an offer, an upgrade, committed / released / reserved usage
 *   OLD_DIR=<checkout of the previous release> node scripts/rollback/compat-check.js old
 *                                                             (old code) reads plans and quotas, writes and refunds a usage row
 *   node scripts/rollback/compat-check.js new                (new code) after roll-forward: balances and the margin report
 *
 * DATABASE_URL must point at the throwaway database; a hosted one is refused.
 * scripts/rollback/compat-check.sh runs the whole sequence.
 */

const assert = require('assert');
const path = require('path');

const url = process.env.DATABASE_URL || '';
if (!url || /supabase\.co|render\.com|pooler\./i.test(url)) {
  console.error('set DATABASE_URL to a throwaway local database');
  process.exit(1);
}
process.env.PGSSL = process.env.PGSSL || 'disable';
const step = process.argv[2];
const root = step === 'old' ? path.resolve(process.env.OLD_DIR || '') : path.resolve(__dirname, '..', '..');
const req = m => require(path.join(root, 'src', m));

(async () => {
  const { pool } = req('database/db');
  const ids = async () => Object.fromEntries((await pool.query(
    `SELECT username, id FROM admins WHERE username IN ('compat_master', 'compat_buyer', 'compat_upgrader')`)).rows.map(r => [r.username, r.id]));
  try {
    if (step === 'seed') {
      const ledger = req('rag/tariff-ledger');
      const offers = req('rag/tariff-offers');
      const mk = async (u, role) => (await pool.query(
        `INSERT INTO admins (username, password, full_name, role, channel_verified_at, survey_completed_at, free_gate_since)
         VALUES ($1, 'x', $1, $2, now(), now(), now()) RETURNING id`, [u, role])).rows[0].id;
      const master = await mk('compat_master', 'master');
      const buyer = await mk('compat_buyer', 'user');
      const upgr = await mk('compat_upgrader', 'user');
      const { offer } = await offers.createOffer({ createdBy: master, userId: buyer, plan: 'silver', discountUzs: 40000, reason: 'compat seed' });
      await ledger.grantPaidPeriod({ adminId: buyer, plan: 'silver', paymentRef: 'manual:compat-1', offerId: offer.id });
      await ledger.grantPaidPeriod({ adminId: upgr, plan: 'silver', paymentRef: 'manual:compat-2', now: new Date(Date.now() - 10 * 864e5) });
      await ledger.grantPaidPeriod({ adminId: upgr, plan: 'gold', paymentRef: 'manual:compat-3' });
      for (let i = 0; i < 2; i++) { const r = await ledger.reserve({ adminId: buyer, service: 'chat', endpoint: '/api/legal-chat', channel: 'web', actorId: buyer }); await ledger.commit(r.jobKey); }
      const rel = await ledger.reserve({ adminId: buyer, service: 'analysis', units: 3, endpoint: '/api/legal-chat#analysis', channel: 'web', actorId: buyer });
      await ledger.release(rel.jobKey, 'status 500');
      await ledger.reserve({ adminId: buyer, service: 'chat', endpoint: '/api/legal-chat', channel: 'web', actorId: buyer });
      console.log('seeded: 2 committed, 1 released, 1 reserved usage rows; an offer period; an upgrade');
    } else if (step === 'old') {
      const tiers = req('rag/subscription-tiers');
      const { compat_buyer: buyer, compat_upgrader: upgr } = await ids();
      const pb = await tiers.getUserPlan(buyer);
      const pu = await tiers.getUserPlan(upgr);
      assert.deepStrictEqual([pb.plan, pb.expired, pu.plan, pu.expired], ['silver', false, 'gold', false], 'the old code sees the plans the new code sold');
      const q = await tiers.checkQuota(buyer);
      assert.strictEqual(q.allowed, true);
      const used = (await tiers.getUsageStats(buyer)).daily;
      const held = (await pool.query(`SELECT to_regclass('public.tariff_usage_v2_hold') IS NOT NULL AS h`)).rows[0].h;
      console.log(`old code: plans silver/gold active; buyer usage counted by the old code = ${used} (${held ? 'after' : 'BEFORE'} tariffs-v2-to-v1.sql)`);
      // rows the old code itself wrote (status NULL) are real usage under it
      const own = Number((await pool.query(`SELECT count(*) AS n FROM tariff_usage WHERE admin_id = $1 AND status IS NULL`, [buyer])).rows[0].n);
      if (held) assert.strictEqual(used, 2 + own, 'after the prep script: delivered v2 work + the old code\'s own rows, nothing refunded or unfinished');
      const id = await tiers.recordUsage(buyer, '/api/legal-chat', 1, { throwOnError: true });
      assert.ok(id, 'the old code writes a usage row on the new schema');
      console.log(`old code: wrote usage row ${id}`);
    } else if (step === 'new') {
      const ledger = req('rag/tariff-ledger');
      const tiers = req('rag/subscription-tiers');
      const { compat_buyer: buyer, compat_upgrader: upgr } = await ids();
      const b = await ledger.balance({ adminId: buyer });
      assert.strictEqual(b.services.chat.used, 2, 'the two delivered chats, nothing more');
      const back = (await pool.query(`SELECT status, release_reason FROM tariff_usage WHERE admin_id = $1 AND service IS NOT NULL ORDER BY id`, [buyer])).rows;
      assert.deepStrictEqual(back.map(r => r.status), ['committed', 'committed', 'released', 'released'], 'held rows are back; the running reservation came back released');
      const m = await tiers.marginReport({});
      const u = m.rows.find(r => r.adminId === upgr);
      assert.strictEqual(u.cashReceivedUzs, 199000 + (599000 - u.creditCarriedInUzs), 'cash counted once');
      assert.strictEqual(u.recognizedRevenueUzs + u.deferredRevenueUzs, u.cashReceivedUzs);
      console.log(`new code after roll-forward: chat used ${b.services.chat.used}; upgrader cash ${u.cashReceivedUzs}, credit ${u.creditCarriedInUzs} (not cash)`);
    } else {
      console.error('usage: compat-check.js seed|old|new');
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
})().catch(e => { console.error(`compat-check ${step} FAILED:`, e.message); process.exit(1); });
