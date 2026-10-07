// COMMERCE-PRODUCTION — the database contract of 00000000000013 on a real PostgreSQL (lab/pg-lab.mjs, the image of the
// certified Torneos lab, migrations 0000 → 0013 applied as the installer). Every case uses the real roles: the bridge
// identity through the emulated PostgREST, and the real payment LOGINS over TCP (TEST and production).
//   node backend/torneos/commerce-production/lab/pg-lab.mjs up && node --test backend/torneos/commerce-production/commerce-production-db.test.mjs
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { up, MIGRATIONS_DIR, sql, sqlTry } from './lab/pg-lab.mjs';
import {
  admin, age, allow, asUserJson, checkout, entitlementsOf, eventTypes, grantEvents, identity, j, lit, member, paymentsDb, planOf,
  purchaseRow, refusal, refusedBy, season, setScope, testCheckout, world,
} from './lab/fixtures.mjs';

const MIGRATION = path.join(MIGRATIONS_DIR, '00000000000013_mercadopago_checkout_pro_production.sql');
let prod;
let testDb;
const t0 = Date.parse('2026-10-07T12:00:00.000Z');
const at = (minutes) => new Date(t0 + minutes * 60_000).toISOString();
// Provider payment ids are unique per run (the lab database outlives a run; a reused id is a real payment conflict).
const RUN_DIGITS = String(Date.now()).slice(-9);
const pid = (logical) => `${RUN_DIGITS}${logical}`;

before(async () => {
  await up();
  prod = paymentsDb('production');
  testDb = paymentsDb('test');
  setScope('open');
});
after(async () => {
  setScope('off', 'Laboratorio cerrado al terminar');
  await prod?.end();
  await testDb?.end();
});

/** A production purchase with its preference recorded (what the payments service leaves before the buyer pays). */
async function payable(w = world()) {
  const p = checkout(w.owner, w);
  const pref = `123456789-${randomUUID()}`;
  await prod.call('public.record_production_tournament_purchase_preference', [p.id, pref, new Date(Date.now() + 30 * 60_000).toISOString()]);
  return { ...w, id: p.id, externalReference: p.externalReference, preferenceId: pref };
}
const status = (p, s, payment, minute, detail = null) => prod.call('public.apply_production_tournament_payment_status',
  [p.id, s, s, detail, pid(payment), at(minute)]);
const reversal = (p, action, payment, minute, providerStatus = action) => prod.call('public.apply_production_tournament_payment_reversal',
  [p.id, action, providerStatus, null, pid(payment), at(minute)]);

describe('schema and ACL', () => {
  test('re-applying 0013 is a no-op that keeps the operator switch', () => {
    setScope('allowlist', 'Laboratorio reaplicación');
    sql(readFileSync(MIGRATION, 'utf8'));
    assert.equal(admin('select checkout_scope from public.tournament_commerce_production_settings').trim(), 'allowlist');
    setScope('open');
  });

  test('the environment CHECK admits MERCADO_PAGO production and nothing new for FAKE', () => {
    const def = admin("select pg_get_constraintdef(oid) from pg_constraint where conname='tournament_purchases_environment_check'").trim();
    assert.match(def, /MERCADO_PAGO.*'test'::text, 'production'::text/);
    assert.match(def, /FAKE.*'local'::text, 'qa'::text/);
  });

  test('every client and service role executes exactly what it must', () => {
    const can = (role, fn) => admin(`select has_function_privilege('${role}', '${fn}', 'EXECUTE')`).trim() === 't';
    const service = ['public.get_production_provider_tournament_purchase(text)', 'public.record_production_tournament_purchase_preference(uuid,text,timestamptz)',
      'public.apply_production_tournament_payment_status(uuid,text,text,text,text,timestamptz)', 'public.apply_production_tournament_payment_reversal(uuid,text,text,text,text,timestamptz)',
      'public.list_production_tournament_purchases_to_reconcile(integer)', 'public.claim_production_tournament_purchase_check(uuid,integer)',
      'public.complete_production_tournament_purchase_check(uuid,text)'];
    for (const fn of service) {
      assert.equal(can('torneos_payment_production_service', fn), true, fn);
      for (const role of ['anon', 'authenticated', 'service_role', 'torneos_payment_service']) assert.equal(can(role, fn), false, `${role} ${fn}`);
    }
    for (const fn of ['public.create_tournament_season_production_checkout_purchase(uuid,uuid,uuid)', 'public.get_tournament_season_purchases(uuid,uuid)']) {
      assert.equal(can('authenticated', fn), true, fn);
      for (const role of ['anon', 'service_role', 'torneos_payment_service', 'torneos_payment_production_service']) assert.equal(can(role, fn), false, `${role} ${fn}`);
    }
    // The production role reaches none of the TEST service functions and no generic activation / reversal.
    for (const fn of ['public.get_provider_tournament_purchase(text,text,text)', 'public.record_tournament_purchase_preference(uuid,text,text,text,timestamptz)',
      'public.apply_verified_tournament_payment_status(uuid,text,text,text,text,text,text,timestamptz)',
      'public.activate_verified_tournament_purchase(uuid,text,text,text,text,text,text)', 'public.apply_tournament_purchase_reversal(uuid,text,text)']) {
      assert.equal(can('torneos_payment_production_service', fn), false, fn);
    }
  });

  test('payment logins cannot read or write any commercial table directly', async () => {
    for (const [db, name] of [[prod, 'production'], [testDb, 'test']]) {
      for (const table of ['tournament_purchases', 'tournament_commerce_production_settings', 'tournament_purchase_provider_checks']) {
        const why = await refusedBy(db.raw(`select count(*) from public.${table}`));
        assert.match(String(why), /permission denied/, `${name} ${table}`);
      }
    }
  });
});

describe('operator switch and authorization', () => {
  test('off refuses every organization; allowlist only the listed one; open everyone', () => {
    const listed = world('listed');
    const other = world('other');
    setScope('off');
    assert.equal(refusal(listed.owner, `select public.create_tournament_season_production_checkout_purchase(${lit(listed.org)}, ${lit(listed.season)}, ${lit(randomUUID())})`), 'TORNEOS_BILLING_DISABLED');
    setScope('allowlist');
    allow(listed.org);
    assert.equal(checkout(listed.owner, listed).providerEnvironment, 'production');
    assert.equal(refusal(other.owner, `select public.create_tournament_season_production_checkout_purchase(${lit(other.org)}, ${lit(other.season)}, ${lit(randomUUID())})`), 'TORNEOS_BILLING_DISABLED');
    setScope('open');
    assert.equal(checkout(other.owner, other).status, 'created');
  });

  test('only owners and admins of the season may buy; outsiders and other organizations never', () => {
    const w = world('auth');
    const otherOrg = world('auth-other');
    const outsider = identity('outsider');
    const collaborator = member(w.org, 'collaborator', [w.season]);
    const adminNoSeason = member(w.org, 'admin', []);
    const call = (actor, org, s) => refusal(actor, `select public.create_tournament_season_production_checkout_purchase(${lit(org)}, ${lit(s)}, ${lit(randomUUID())})`);
    assert.equal(call(outsider, w.org, w.season), 'TORNEOS_BILLING_FORBIDDEN');
    assert.equal(call(collaborator, w.org, w.season), 'TORNEOS_BILLING_FORBIDDEN');
    assert.equal(call(adminNoSeason, w.org, w.season), 'TORNEOS_BILLING_FORBIDDEN');
    assert.equal(call(w.owner, w.org, otherOrg.season), 'TORNEOS_BILLING_FORBIDDEN');
    // An admin assigned to the season may buy (another season: FREE allows one administrative seat).
    const w2 = world('auth-admin');
    const seasonAdmin = member(w2.org, 'admin', [w2.season]);
    assert.equal(checkout(seasonAdmin, w2).organizationId, w2.org);
  });
});

describe('purchase creation', () => {
  test('the purchase snapshot is the current offer, fixed server-side', () => {
    const w = world('snapshot');
    const p = checkout(w.owner, w);
    assert.deepEqual({ provider: p.provider, env: p.providerEnvironment, product: p.productCode, amount: p.amount, list: p.listAmount, currency: p.currency },
      { provider: 'MERCADO_PAGO', env: 'production', product: 'torneos_premium', amount: 39900, list: 49900, currency: 'ARS' });
    assert.equal(p.externalReference, `arma2:season:purchase:${p.id}`);
    assert.deepEqual(eventTypes(p.id), ['purchase.created']);
  });

  test('double tap and retries with the same key answer the same purchase', () => {
    const w = world('idem');
    const key = randomUUID();
    const first = checkout(w.owner, w, key);
    const again = checkout(w.owner, w, key);
    assert.equal(again.id, first.id);
    assert.equal(again.idempotentReplay, true);
    // Another key (a reload) continues the one open purchase of the season; so does another manager.
    assert.equal(checkout(w.owner, w).id, first.id);
    const seasonAdmin = member(w.org, 'admin', [w.season]);
    const continued = checkout(seasonAdmin, w);
    assert.equal(continued.id, first.id);
    assert.equal(continued.existingOpenPurchase, true);
    assert.equal(Number(admin(`select count(*) from public.tournament_purchases where season_id = ${lit(w.season)}`)), 1);
  });

  test('concurrent first taps create exactly one purchase', async () => {
    const w = world('race');
    const key = randomUUID();
    const results = await Promise.all([0, 1, 2].map(() => new Promise((resolve) => resolve(checkout(w.owner, w, key)))));
    assert.equal(new Set(results.map((r) => r.id)).size, 1);
    assert.equal(Number(admin(`select count(*) from public.tournament_purchases where season_id = ${lit(w.season)}`)), 1);
  });

  test('reusing a key for another season is a conflict, never a silent new purchase', () => {
    const w = world('conflict');
    const s2 = season(w.owner, w.org, 'conflict-2');
    const key = randomUUID();
    checkout(w.owner, w, key);
    assert.equal(refusal(w.owner, `select public.create_tournament_season_production_checkout_purchase(${lit(w.org)}, ${lit(s2)}, ${lit(key)})`), 'TORNEOS_IDEMPOTENCY_CONFLICT');
  });

  test('an open TEST purchase of the season is never continued as production (and vice versa)', () => {
    const w = world('cross');
    testCheckout(w.owner, w);
    assert.equal(refusal(w.owner, `select public.create_tournament_season_production_checkout_purchase(${lit(w.org)}, ${lit(w.season)}, ${lit(randomUUID())})`),
      'TORNEOS_OPEN_PURCHASE_PROVIDER_CONFLICT');
    const w2 = world('cross2');
    checkout(w2.owner, w2);
    assert.equal(refusal(w2.owner, `select public.create_tournament_season_checkout_purchase(${lit(w2.org)}, ${lit(w2.season)}, ${lit(randomUUID())})`),
      'TORNEOS_OPEN_PURCHASE_PROVIDER_CONFLICT');
  });

  test('a stale preference expires on the next checkout; an open payment never does', async () => {
    const stale = await payable(world('stale'));
    age(stale.id, { createdMinutes: 60, updatedMinutes: 60, expiresMinutes: 20 });
    const next = checkout(stale.owner, stale);
    assert.notEqual(next.id, stale.id);
    assert.equal(purchaseRow(stale.id).status, 'expired');
    const pending = await payable(world('pending-keep'));
    await status(pending, 'pending', '9001', 1);
    age(pending.id, { createdMinutes: 600, updatedMinutes: 600, expiresMinutes: 500 });
    assert.equal(checkout(pending.owner, pending).id, pending.id);
    assert.equal(purchaseRow(pending.id).status, 'pending');
  });
});

describe('verified payment lifecycle (production service role)', () => {
  test('preference: recorded once, replay accepted, a different one refused', async () => {
    const w = world('pref');
    const p = checkout(w.owner, w);
    const pref = `123-${randomUUID()}`;
    const expires = new Date(Date.now() + 30 * 60_000).toISOString();
    const first = await prod.call('public.record_production_tournament_purchase_preference', [p.id, pref, expires]);
    assert.equal(first.status, 'preference_created');
    assert.equal((await prod.call('public.record_production_tournament_purchase_preference', [p.id, pref, expires])).idempotentReplay, true);
    assert.equal(await refusedBy(prod.call('public.record_production_tournament_purchase_preference', [p.id, `123-${randomUUID()}`, expires])), 'TORNEOS_PREFERENCE_CONFLICT');
  });

  test('approved activates Premium for that season only, exactly once', async () => {
    const p = await payable(world('approve'));
    const other = season(p.owner, p.org, 'approve-other');
    const r = await status(p, 'approved', '7001', 1);
    assert.equal(r.outcome, 'approved');
    assert.equal(planOf(p.org, p.season), 'PREMIUM');
    assert.equal(planOf(p.org, other), 'FREE');
    // Same provider snapshot again (webhook retry) and a newer identical one: no second grant or approved event.
    assert.equal((await status(p, 'approved', '7001', 1)).outcome, 'provider_snapshot_duplicate');
    assert.equal((await status(p, 'approved', '7001', 2)).outcome, 'duplicate_approved');
    assert.equal(eventTypes(p.id).filter((e) => e === 'payment.approved').length, 1);
    assert.deepEqual(grantEvents(p.id), ['granted']);
    assert.equal(Number(admin(`select count(*) from public.tournament_season_plan_grants where origin_purchase_id = ${lit(p.id)}`)), 1);
    // A new checkout of a Premium season is refused.
    assert.equal(refusal(p.owner, `select public.create_tournament_season_production_checkout_purchase(${lit(p.org)}, ${lit(p.season)}, ${lit(randomUUID())})`), 'TORNEOS_SEASON_ALREADY_PREMIUM');
  });

  test('older or late statuses never degrade an activated purchase', async () => {
    const p = await payable(world('order'));
    await status(p, 'approved', '7101', 10);
    assert.equal((await status(p, 'pending', '7101', 5)).outcome, 'stale_ignored');
    assert.equal((await status(p, 'rejected', '7101', 20)).outcome, 'stale_ignored');
    assert.equal(purchaseRow(p.id).status, 'approved');
    assert.equal(planOf(p.org, p.season), 'PREMIUM');
  });

  test('pending then approved; a rejected attempt keeps the purchase open for another card', async () => {
    const p = await payable(world('attempts'));
    assert.equal((await status(p, 'pending', '7201', 1)).status, 'pending');
    assert.equal((await status(p, 'rejected', '7201', 2)).status, 'preference_created');
    assert.equal(planOf(p.org, p.season), 'FREE');
    assert.equal((await status(p, 'approved', '7202', 3)).outcome, 'approved');
    assert.equal(planOf(p.org, p.season), 'PREMIUM');
    // The ended payment never reopens the purchase.
    assert.equal((await status(p, 'pending', '7201', 4)).outcome, 'stale_ignored');
  });

  test('refund revokes Premium once; the season can be bought again', async () => {
    const p = await payable(world('refund'));
    await status(p, 'approved', '7301', 1);
    const r = await reversal(p, 'refund', '7301', 5, 'refunded');
    assert.equal(r.outcome, 'reversal_applied');
    assert.equal(purchaseRow(p.id).status, 'refunded');
    assert.equal(planOf(p.org, p.season), 'FREE');
    assert.equal((await reversal(p, 'refund', '7301', 5, 'refunded')).outcome, 'provider_snapshot_duplicate');
    assert.equal((await reversal(p, 'refund', '7301', 6, 'refunded')).idempotentReplay, true);
    assert.deepEqual(grantEvents(p.id), ['granted', 'revoked']);
    // A late approved of the refunded payment never revives Premium.
    assert.equal((await status(p, 'approved', '7301', 7)).outcome, 'stale_ignored');
    assert.equal(planOf(p.org, p.season), 'FREE');
    assert.equal(checkout(p.owner, p).status, 'created');
  });

  test('chargeback: disputed suspends (no new purchase), restored brings Premium back, buyer won revokes', async () => {
    const p = await payable(world('chargeback'));
    await status(p, 'approved', '7401', 1);
    await reversal(p, 'chargeback_disputed', '7401', 2, 'charged_back');
    assert.equal(planOf(p.org, p.season), 'FREE');
    assert.equal(refusal(p.owner, `select public.create_tournament_season_production_checkout_purchase(${lit(p.org)}, ${lit(p.season)}, ${lit(randomUUID())})`), 'TORNEOS_SEASON_PREMIUM_SUSPENDED');
    await reversal(p, 'chargeback_restored', '7401', 3, 'charged_back');
    assert.equal(planOf(p.org, p.season), 'PREMIUM');
    // The old dispute arriving after the restore is stale for the provider clock: ignored.
    assert.equal((await reversal(p, 'chargeback_disputed', '7401', 2, 'charged_back')).outcome, 'stale_ignored');
    assert.equal(planOf(p.org, p.season), 'PREMIUM');
    await reversal(p, 'chargeback_buyer_won', '7401', 4, 'charged_back');
    assert.equal(planOf(p.org, p.season), 'FREE');
    assert.deepEqual(grantEvents(p.id), ['granted', 'suspended', 'restored', 'revoked']);
  });

  test('anomalies never grant: approved after close, reversal before activation, another payment', async () => {
    const closed = await payable(world('after-close'));
    age(closed.id, { createdMinutes: 60, updatedMinutes: 60, expiresMinutes: 20 });
    checkout(closed.owner, closed); // sweeps it to expired
    const late = await status(closed, 'approved', '7501', 1);
    assert.deepEqual([late.outcome, late.requiresManualRefund], ['approved_after_close', true]);
    assert.equal(planOf(closed.org, closed.season), 'FREE');

    const early = await payable(world('early-reversal'));
    assert.equal((await reversal(early, 'refund', '7601', 1, 'refunded')).outcome, 'reversal_without_activation');

    const two = await payable(world('two-payments'));
    await status(two, 'approved', '7701', 1);
    const second = await status(two, 'approved', '7702', 2);
    assert.deepEqual([second.outcome, second.requiresManualRefund], ['duplicate_payment', true]);
    assert.equal((await reversal(two, 'refund', '7702', 3, 'refunded')).outcome, 'reversal_other_payment');
    assert.equal(planOf(two.org, two.season), 'PREMIUM');
  });

  test('a payment already approved for another purchase is a conflict', async () => {
    const a = await payable(world('pay-a'));
    const b = await payable(world('pay-b'));
    await status(a, 'approved', '7801', 1);
    assert.equal(await refusedBy(status(b, 'approved', '7801', 2)), 'TORNEOS_PAYMENT_CONFLICT');
    assert.equal(planOf(b.org, b.season), 'FREE');
  });

  test('the production service never touches TEST purchases', async () => {
    const w = world('test-row');
    const t = testCheckout(w.owner, w);
    assert.equal(await refusedBy(prod.call('public.get_production_provider_tournament_purchase', [t.externalReference])), 'TORNEOS_PURCHASE_NOT_FOUND');
    assert.equal(await refusedBy(prod.call('public.record_production_tournament_purchase_preference', [t.id, '123-x', new Date().toISOString()])), 'TORNEOS_PURCHASE_INVALID');
    assert.equal(await refusedBy(prod.call('public.apply_production_tournament_payment_status', [t.id, 'approved', 'approved', null, pid('7901'), at(1)])), 'TORNEOS_PURCHASE_INVALID');
    assert.equal(await refusedBy(prod.call('public.claim_production_tournament_purchase_check', [t.id, 0])), 'TORNEOS_PURCHASE_INVALID');
  });

  test('the TEST login cannot move a production purchase, even through the generic baseline function', async () => {
    const w = world('isolation');
    const p = checkout(w.owner, w);
    const why = await refusedBy(testDb.call('public.record_tournament_purchase_preference', [p.id, 'MERCADO_PAGO', 'production', `123-test-runtime-${randomUUID()}`, new Date().toISOString()]));
    assert.equal(why, 'TORNEOS_PAYMENT_ENVIRONMENT_ISOLATION');
    assert.equal(purchaseRow(p.id).status, 'created');
    assert.equal(await refusedBy(testDb.call('public.get_provider_tournament_purchase', [p.externalReference, 'MERCADO_PAGO', 'production'])), 'TORNEOS_PROVIDER_INVALID');
    // The TEST runtime keeps working on TEST rows (certified path unchanged).
    const tw = world('isolation-test');
    const t = testCheckout(tw.owner, tw);
    const recorded = await testDb.call('public.record_tournament_purchase_preference', [t.id, 'MERCADO_PAGO', 'test', `123-test-ok-${randomUUID()}`, new Date(Date.now() + 1800_000).toISOString()]);
    assert.equal(recorded.status, 'preference_created');
  });
});

describe('reconciliation bookkeeping', () => {
  test('claims are atomic and throttled; completion records the outcome', async () => {
    const p = await payable(world('claim'));
    const [a, b] = await Promise.all([
      prod.call('public.claim_production_tournament_purchase_check', [p.id, 15]),
      prod.call('public.claim_production_tournament_purchase_check', [p.id, 15]),
    ]);
    assert.deepEqual([a.claimed, b.claimed].sort(), [false, true]);
    assert.equal((await prod.call('public.claim_production_tournament_purchase_check', [p.id, 15])).claimed, false);
    assert.equal((await prod.call('public.claim_production_tournament_purchase_check', [p.id, 0])).claimed, true);
    const done = await prod.call('public.complete_production_tournament_purchase_check', [p.id, 'no_payment']);
    assert.equal(done.checks, 1);
    assert.equal(await refusedBy(prod.call('public.complete_production_tournament_purchase_check', [p.id, 'Bad Outcome'])), 'TORNEOS_CHECK_OUTCOME_INVALID');
  });

  test('candidates: open purchases after the webhook head start, least recently checked first', async () => {
    const fresh = await payable(world('fresh'));
    const old = await payable(world('old'));
    age(old.id, { createdMinutes: 30, updatedMinutes: 30 });
    const list = await prod.call('public.list_production_tournament_purchases_to_reconcile', [50]);
    const ids = list.map((x) => x.id);
    assert.ok(ids.includes(old.id));
    assert.ok(!ids.includes(fresh.id), 'a purchase updated less than 2 minutes ago waits for its webhook');
    await prod.call('public.claim_production_tournament_purchase_check', [old.id, 0]);
    const again = (await prod.call('public.list_production_tournament_purchases_to_reconcile', [50])).map((x) => x.id);
    assert.ok(!again.includes(old.id), 'checked less than 10 minutes ago');
    assert.ok(list.every((x) => x.providerEnvironment === 'production'));
  });
});

describe('Mi plan: purchases of a season', () => {
  test('managers see the season purchases, others only their own, outsiders nothing', async () => {
    const p = await payable(world('list'));
    const collaborator = member(p.org, 'collaborator', [p.season]);
    const outsider = identity('list-outsider');
    const mine = asUserJson(p.owner, `select public.get_tournament_season_purchases(${lit(p.org)}, ${lit(p.season)})`);
    assert.equal(mine.canManageBilling, true);
    assert.equal(mine.purchases.length, 1);
    assert.equal(mine.purchases[0].id, p.id);
    assert.equal(mine.purchases[0].boughtByMe, true);
    assert.equal('buyerUserId' in mine.purchases[0], false);
    assert.equal(mine.checkoutAvailable, true, 'scope open');
    setScope('allowlist');
    assert.equal(asUserJson(p.owner, `select public.get_tournament_season_purchases(${lit(p.org)}, ${lit(p.season)})`).checkoutAvailable, false);
    allow(p.org);
    assert.equal(asUserJson(p.owner, `select public.get_tournament_season_purchases(${lit(p.org)}, ${lit(p.season)})`).checkoutAvailable, true);
    setScope('off');
    assert.equal(asUserJson(p.owner, `select public.get_tournament_season_purchases(${lit(p.org)}, ${lit(p.season)})`).checkoutAvailable, false);
    setScope('open');
    const theirs = asUserJson(collaborator, `select public.get_tournament_season_purchases(${lit(p.org)}, ${lit(p.season)})`);
    assert.deepEqual([theirs.canManageBilling, theirs.purchases.length], [false, 0]);
    assert.equal(refusal(outsider, `select public.get_tournament_season_purchases(${lit(p.org)}, ${lit(p.season)})`), 'TORNEOS_PURCHASE_FORBIDDEN');
  });
});

describe('Premium is real and season-scoped', () => {
  test('collaborator seats follow the plan; losing Premium removes nobody', async () => {
    const p = await payable(world('seats'));
    const first = member(p.org, 'collaborator', [p.season]);
    assert.ok(first.membership);
    const second = member(p.org, 'collaborator', []);
    const assignSecond = () => sqlTry(`INSERT INTO public.tournament_season_member_assignments (organization_id, season_id, membership_id) VALUES (${lit(p.org)}, ${lit(p.season)}, ${lit(second.membership)})`);
    assert.match(assignSecond().error, /TORNEOS_SEASON_COLLABORATOR_LIMIT_REACHED/);
    await status(p, 'approved', '8001', 1);
    assert.equal(assignSecond().ok, true);
    assert.equal(entitlementsOf(p.org, p.season).administration.administrativeSeatLimit, 10);
    await reversal(p, 'refund', '8001', 2, 'refunded');
    assert.equal(Number(admin(`select count(*) from public.tournament_season_member_assignments where season_id = ${lit(p.season)}`)), 2);
    const third = member(p.org, 'collaborator', []);
    assert.match(sqlTry(`INSERT INTO public.tournament_season_member_assignments (organization_id, season_id, membership_id) VALUES (${lit(p.org)}, ${lit(p.season)}, ${lit(third.membership)})`).error,
      /TORNEOS_SEASON_COLLABORATOR_LIMIT_REACHED/);
  });

  test('Premium capabilities and limits switch with the grant, per season', async () => {
    const p = await payable(world('caps'));
    const free = entitlementsOf(p.org, p.season);
    assert.deepEqual([free.plan, free.limits.galleryAssetLimit, free.social.baseFamilyLimit, free.capabilities['social_studio.premium']], ['FREE', 25, 3, false]);
    await status(p, 'approved', '8101', 1);
    const premium = entitlementsOf(p.org, p.season);
    assert.deepEqual([premium.plan, premium.limits.galleryAssetLimit, premium.social.baseFamilyLimit, premium.capabilities['social_studio.premium'], premium.branding.canRemoveArma2],
      ['PREMIUM', 1000, 11, true, true]);
    assert.equal(premium.assignmentSource, 'purchase');
  });
});

describe('the TEST chain is untouched', () => {
  test('certified TEST bodies keep their md5', () => {
    const pins = {
      'public.create_tournament_season_checkout_purchase(uuid,uuid,uuid)': 'ce838d427a83994f51c1366100d953ea',
      'public.order_verified_tournament_payment(uuid,text,text,text,text,text,text,text,timestamp with time zone)': 'c1b838f976de3426c01cd3f0748bb512',
      'public.unordered_tournament_payment_status(uuid,text,text,text,text,text,text)': '503d79f692d1417e4fa07b3f810ec192',
      'public.activate_verified_tournament_purchase(uuid,text,text,text,text,text,text)': '8a97cc62c510971331eb19de2f83326b',
      'public.record_tournament_purchase_preference(uuid,text,text,text,timestamp with time zone)': '6eb78b1189e03b55545aa1057aafae8d',
    };
    for (const [fn, md5] of Object.entries(pins)) assert.equal(admin(`select md5(prosrc) from pg_proc where oid = '${fn}'::regprocedure`).trim(), md5, fn);
  });
  test('a TEST purchase still cannot be created as production by the TEST wrapper', () => {
    const w = world('test-env');
    assert.equal(testCheckout(w.owner, w).providerEnvironment, 'test');
    assert.equal(j(admin(`select to_jsonb(count(*)) from public.tournament_purchases where provider_environment='production' and season_id=${lit(w.season)}`)), 0);
  });
});
