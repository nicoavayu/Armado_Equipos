// MP-A3 — T4: torneos-payments webhook POST /webhooks/mercadopago/v1 on the local commerce lab.
// Mercado Pago is the lab mp-stub; notifications are signed with the official x-signature manifest by the
// suite (the stub never calls back). The payload is never authority: the function re-reads payment /
// merchant order / chargeback from "Mercado Pago", binds them server-side and delegates every state change
// to the MP-A2 RPCs on the REAL Torneos DB through the payment-service login.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cfg, webhook, http, stub, preparedPurchase, payAndNotify, purchaseRow, eventTypes, grantEvents, grantEffective, snapshot,
  waitPayments, writeEvidence, assertNoLeak, containerLogs, randomUUID, WEBHOOK_PATH,
} from './payments-lab.mjs';

const results = [];
const bodies = [];
const matrix = [];

test('MP-A3 — T4 Mercado Pago webhook', async (t) => {
  async function check(name, fn) {
    await t.test(name, async () => {
      try { await fn(); results.push({ name, status: 'PASS' }); }
      catch (error) { results.push({ name, status: 'FAIL', error: String(error.message ?? error).slice(0, 300) }); throw error; }
    });
  }
  const note = (scenario, r, extra = {}) => { bodies.push(r.text); matrix.push({ scenario, http: r.status, outcome: r.body?.outcome ?? r.body?.error ?? null, ...extra }); return r; };
  const same = (p, before) => assert.equal(snapshot(p.id), before, 'domain untouched');
  try {
    await check('lab: commerce lab reachable (mp-stub up, torneos-payments answers)', async () => {
      assert.ok(cfg?.mpa, 'commerce .runtime present');
      await stub('/__lab/health');
      await stub('/__lab/reset', {}); // no scenario queued by an earlier run survives
      assert.equal(await waitPayments(), 401);
    });

    // ============================================================ request-level rejection
    let base;
    await check('request rejection: GET/PUT/OPTIONS → 404 without CORS; Origin → 400; body > 32 KiB → 413; invalid JSON → 400; missing/invalid data.id → 400', async () => {
      base = await preparedPurchase('reject');
      const pay = await stub('/__lab/payments', { preferenceId: base.preferenceId, status: 'approved', statusDetail: 'accredited' });
      const before = snapshot(base.id);
      for (const method of ['GET', 'PUT', 'OPTIONS', 'DELETE']) {
        const r = note(`method ${method}`, await http(WEBHOOK_PATH, { method, query: `?data.id=${pay.paymentId}&type=payment`, body: ['GET', 'OPTIONS'].includes(method) ? undefined : '{}' }));
        assert.equal(r.status, 404, method);
        assert.ok(!Object.keys(r.headers).some(h => h.startsWith('access-control-')), 'no CORS');
      }
      assert.equal(note('origin', await webhook({ dataId: pay.paymentId, headers: { origin: 'https://www.mercadopago.com.ar' } })).status, 400);
      assert.equal(note('oversize', await webhook({ dataId: pay.paymentId, payload: JSON.stringify({ type: 'payment', data: { id: pay.paymentId }, pad: 'x'.repeat(33 * 1024) }) })).status, 413);
      assert.equal(note('invalid json', await webhook({ dataId: pay.paymentId, payload: '{"type":' })).status, 400);
      assert.equal(note('no data.id', await webhook({ dataId: pay.paymentId, query: '?type=payment' })).status, 400);
      assert.equal(note('non-numeric data.id', await webhook({ dataId: 'abc', query: '?data.id=abc&type=payment' })).status, 400);
      same(base, before);
    });
    await check('signature: invalid v1 → 401; wrong secret → 401; x-request-id missing → 401; x-signature missing / malformed → 401; signed for another id → 401', async () => {
      const pay = await stub('/__lab/payments', { preferenceId: base.preferenceId, status: 'approved', statusDetail: 'accredited' });
      const before = snapshot(base.id);
      const ts = Math.floor(Date.now() / 1000);
      assert.equal(note('bad v1', await webhook({ dataId: pay.paymentId, signature: `ts=${ts},v1=${'0'.repeat(64)}` })).status, 401);
      assert.equal(note('wrong secret', await webhook({ dataId: pay.paymentId, signature: (await import('./payments-lab.mjs')).mpSignature({ dataId: pay.paymentId, requestId: 'r1', secret: 'x'.repeat(32) }), requestId: 'r1' })).status, 401);
      assert.equal(note('request-id missing', await webhook({ dataId: pay.paymentId, requestId: null })).status, 401);
      assert.equal(note('x-signature missing', await webhook({ dataId: pay.paymentId, signature: null })).status, 401);
      assert.equal(note('x-signature malformed', await webhook({ dataId: pay.paymentId, signature: 'v1=abc' })).status, 401);
      assert.equal(note('signed other id', await webhook({ dataId: pay.paymentId, signId: '999999' })).status, 401);
      same(base, before);
    });
    await check('payload consistency after a valid signature: query/body id mismatch, unknown type, payload live_mode=true, foreign user_id → 400; domain untouched', async () => {
      const pay = await stub('/__lab/payments', { preferenceId: base.preferenceId, status: 'approved', statusDetail: 'accredited' });
      const before = snapshot(base.id);
      const payload = (over) => ({ type: 'payment', data: { id: pay.paymentId }, live_mode: false, user_id: Number(cfg.mpa.sellerId), ...over });
      assert.equal(note('query/body mismatch', await webhook({ dataId: pay.paymentId, payload: payload({ data: { id: '12345' } }) })).status, 400);
      assert.equal(note('unknown type', await webhook({ dataId: pay.paymentId, payload: payload({ type: 'plan' }) })).status, 400);
      assert.equal(note('payload live_mode', await webhook({ dataId: pay.paymentId, payload: payload({ live_mode: true }) })).status, 400);
      assert.equal(note('payload user_id', await webhook({ dataId: pay.paymentId, payload: payload({ user_id: 1 }) })).status, 400);
      same(base, before);
    });

    // ============================================================ binding (re-query is the authority) → 422, no mutation
    const bindingCases = [
      ['seller mismatch (payment.collector_id)', { payment: { collector_id: 1 } }],
      ['seller mismatch (order.collector)', { order: { collector: { id: 1 } } }],
      ['metadata.purchase_id mismatch', { payment: { metadata: { purchase_id: '00000000-0000-4000-8000-000000000000' } } }],
      ['amount mismatch', { payment: { transaction_amount: 1 } }],
      ['currency mismatch', { payment: { currency_id: 'USD' } }],
      ['preference mismatch (order.preference_id)', { order: { preference_id: 'another-preference' } }],
      ['payment live_mode=true', { payment: { live_mode: true } }],
      ['payment order type ≠ mercadopago', { payment: { order: { type: 'other' } } }],
      ['order does not list the payment', { order: { payments: [] } }],
    ];
    for (const [label, overrides] of bindingCases) {
      await check(`binding: ${label} → 422; domain untouched`, async () => {
        const p = await preparedPurchase('bind');
        const before = snapshot(p.id);
        const pay = await stub('/__lab/payments', { preferenceId: p.preferenceId, status: 'approved', statusDetail: 'accredited', overrides });
        const r = note(label, await webhook({ dataId: pay.paymentId }));
        assert.deepEqual([r.status, r.body?.error], [422, 'payment_verification_failed']);
        same(p, before);
      });
    }
    await check('binding: external_reference of ANOTHER existing purchase (metadata still ours) → 422; both purchases untouched', async () => {
      const p = await preparedPurchase('extref'); const other = await preparedPurchase('extref-other');
      const [a, b] = [snapshot(p.id), snapshot(other.id)];
      const pay = await stub('/__lab/payments', { preferenceId: p.preferenceId, status: 'approved', statusDetail: 'accredited', overrides: { payment: { external_reference: other.externalReference } } });
      const r = note('external_reference mismatch', await webhook({ dataId: pay.paymentId }));
      assert.equal(r.status, 422);
      same(p, a); same(other, b);
    });
    await check('binding: external_reference of no purchase → 404 purchase_not_found; malformed external_reference → 422', async () => {
      const p = await preparedPurchase('noref');
      const before = snapshot(p.id);
      const pay = await stub('/__lab/payments', { preferenceId: p.preferenceId, status: 'approved', overrides: { payment: { external_reference: `arma2:season:purchase:${randomUUID()}` } } });
      assert.deepEqual([note('purchase inexistent', await webhook({ dataId: pay.paymentId })).status], [404]);
      const bad = await stub('/__lab/payments', { preferenceId: p.preferenceId, status: 'approved', overrides: { payment: { external_reference: "x' or 1=1 --" } } });
      assert.equal(note('malformed external_reference', await webhook({ dataId: bad.paymentId })).status, 422);
      same(p, before);
    });
    await check('chargeback binding: chargeback with two payments / live_mode=true / unknown payment → 422; domain untouched', async () => {
      const p = await preparedPurchase('cbbind');
      const { pay } = await payAndNotify(p, 'approved', 'accredited');
      const before = snapshot(p.id);
      for (const [label, overrides] of [['two payments', { payments: [Number(pay.paymentId), 1] }], ['live_mode', { live_mode: true }], ['no payments', { payments: [] }]]) {
        const cb = await stub('/__lab/chargebacks', { paymentId: pay.paymentId, overrides });
        const r = note(`chargeback ${label}`, await webhook({ dataId: cb.chargebackId, type: 'topic_chargebacks_wh' }));
        assert.deepEqual([label, r.status], [label, 422]);
      }
      same(p, before);
    });

    // ============================================================ state matrix (delegated to the MP-A2 RPCs)
    let life;
    await check('pending → 200 pending; purchase pending; no grant', async () => {
      life = await preparedPurchase('life');
      const { pay, r } = await payAndNotify(life, 'pending', 'pending_contingency');
      note('pending', r);
      assert.deepEqual([r.status, r.body?.outcome], [200, 'pending']);
      assert.equal(purchaseRow(life.id).status, 'pending'); assert.deepEqual(grantEvents(life.id), []);
      life.pendingPayment = pay.paymentId;
    });
    await check('duplicate delivery of the same notification → 200, idempotent (one event)', async () => {
      const before = eventTypes(life.id).length;
      const r = note('duplicate pending', await webhook({ dataId: life.pendingPayment }));
      assert.equal(r.status, 200); assert.equal(eventTypes(life.id).length, before);
    });
    await check('approved (same payment, now accredited) → 200 approved; purchase approved; Premium grant granted and effective', async () => {
      await stub('/__lab/payment-state', { paymentId: life.pendingPayment, status: 'approved', statusDetail: 'accredited' });
      const r = note('approved', await webhook({ dataId: life.pendingPayment }));
      assert.deepEqual([r.status, r.body?.outcome], [200, 'approved']);
      const row = purchaseRow(life.id);
      assert.equal(row.status, 'approved'); assert.equal(row.approved_provider_payment_id, life.pendingPayment); assert.ok(row.entitlement_activated_at);
      assert.deepEqual(grantEvents(life.id), ['granted']); assert.equal(grantEffective(life.id), true);
    });
    await check('ordering: missing/malformed provider time cannot be supplied by webhook body', async () => {
      const p = await preparedPurchase('ordering-missing');
      for (const value of [null, '', 'not-a-date', '2026-01-01', 'infinity']) {
        const pay = await stub('/__lab/payments', { preferenceId: p.preferenceId, status: 'approved', overrides: { payment: { date_last_updated: value } } });
        const before = snapshot(p.id);
        const r = await webhook({ dataId: pay.paymentId, payload: { type: 'payment', data: { id: pay.paymentId }, live_mode: false,
          user_id: Number(cfg.mpa.sellerId), date_last_updated: '2026-09-24T00:00:00Z' } });
        assert.equal(r.status, 422);
        same(p, before);
      }
    });
    await check('approved duplicated → 200 provider_snapshot_duplicate; no second grant', async () => {
      const r = note('approved duplicate', await webhook({ dataId: life.pendingPayment }));
      assert.deepEqual([r.status, r.body?.outcome], [200, 'provider_snapshot_duplicate']);
      assert.deepEqual(grantEvents(life.id), ['granted']);
    });
    await check('out-of-order: a late pending / rejected for the approved payment → 200 stale_ignored; purchase stays approved', async () => {
      await stub('/__lab/payment-state', { paymentId: life.pendingPayment, status: 'pending', statusDetail: null });
      const r1 = note('late pending', await webhook({ dataId: life.pendingPayment }));
      await stub('/__lab/payment-state', { paymentId: life.pendingPayment, status: 'rejected', statusDetail: 'cc_rejected_other_reason' });
      const r2 = note('late rejected', await webhook({ dataId: life.pendingPayment }));
      assert.deepEqual([r1.status, r1.body?.outcome, r2.status, r2.body?.outcome], [200, 'stale_ignored', 200, 'stale_ignored']);
      assert.equal(purchaseRow(life.id).status, 'approved'); assert.equal(grantEffective(life.id), true);
      await stub('/__lab/payment-state', { paymentId: life.pendingPayment, status: 'approved', statusDetail: 'accredited' });
    });
    await check('requiresManualRefund: a second approved payment on the activated purchase → 200 (never 503) duplicate_payment, requiresManualRefund=true; one grant', async () => {
      const { r } = await payAndNotify(life, 'approved', 'accredited');
      note('second approved payment', r);
      assert.deepEqual([r.status, r.body?.outcome, r.body?.requiresManualRefund], [200, 'duplicate_payment', true]);
      assert.deepEqual(grantEvents(life.id), ['granted']);
    });
    await check('chargeback (topic_chargebacks_wh, payment charged_back/in_process) → 200 reversal_applied; purchase charged_back; grant suspended', async () => {
      await stub('/__lab/payment-state', { paymentId: life.pendingPayment, status: 'charged_back', statusDetail: 'in_process' });
      const cb = await stub('/__lab/chargebacks', { paymentId: life.pendingPayment });
      life.chargeback = cb.chargebackId;
      const r = note('chargeback disputed', await webhook({ dataId: cb.chargebackId, type: 'topic_chargebacks_wh' }));
      assert.deepEqual([r.status, r.body?.outcome], [200, 'reversal_applied']);
      assert.equal(purchaseRow(life.id).status, 'charged_back');
      assert.deepEqual(grantEvents(life.id), ['granted', 'suspended']); assert.equal(grantEffective(life.id), false);
    });
    await check('restored (charged_back/reimbursed) → 200 reversal_applied; purchase approved; grant restored and effective', async () => {
      await stub('/__lab/payment-state', { paymentId: life.pendingPayment, status: 'charged_back', statusDetail: 'reimbursed' });
      const r = note('chargeback restored', await webhook({ dataId: life.chargeback, type: 'topic_chargebacks_wh' }));
      assert.deepEqual([r.status, r.body?.outcome], [200, 'reversal_applied']);
      assert.equal(purchaseRow(life.id).status, 'approved');
      assert.deepEqual(grantEvents(life.id), ['granted', 'suspended', 'restored']); assert.equal(grantEffective(life.id), true);
    });
    await check('refund (refunded) → 200 reversal_applied; purchase refunded; grant revoked; a later restore is ignored after revocation (200)', async () => {
      await stub('/__lab/payment-state', { paymentId: life.pendingPayment, status: 'refunded', statusDetail: 'refunded' });
      const r = note('refund', await webhook({ dataId: life.pendingPayment }));
      assert.deepEqual([r.status, r.body?.outcome], [200, 'reversal_applied']);
      assert.equal(purchaseRow(life.id).status, 'refunded');
      assert.deepEqual(grantEvents(life.id), ['granted', 'suspended', 'restored', 'revoked']); assert.equal(grantEffective(life.id), false);
      await stub('/__lab/payment-state', { paymentId: life.pendingPayment, status: 'charged_back', statusDetail: 'reimbursed' });
      const late = note('restore after revocation', await webhook({ dataId: life.chargeback, type: 'topic_chargebacks_wh' }));
      assert.deepEqual([late.status, late.body?.outcome], [200, 'reversal_ignored_after_revocation']);
      assert.deepEqual(grantEvents(life.id), ['granted', 'suspended', 'restored', 'revoked'], 'no restored after revoked');
    });
    await check('buyer_won (charged_back/settled after dispute) → 200; purchase charged_back; grant revoked', async () => {
      const p = await preparedPurchase('buyerwon');
      const { pay } = await payAndNotify(p, 'approved', 'accredited');
      await stub('/__lab/payment-state', { paymentId: pay.paymentId, status: 'in_mediation', statusDetail: 'in_process' });
      const cb = await stub('/__lab/chargebacks', { paymentId: pay.paymentId });
      assert.equal(note('dispute', await webhook({ dataId: cb.chargebackId, type: 'topic_chargebacks_wh' })).status, 200);
      await stub('/__lab/payment-state', { paymentId: pay.paymentId, status: 'charged_back', statusDetail: 'settled' });
      const r = note('buyer won', await webhook({ dataId: cb.chargebackId, type: 'topic_chargebacks_wh' }));
      assert.deepEqual([r.status, r.body?.outcome], [200, 'reversal_applied']);
      assert.equal(purchaseRow(p.id).status, 'charged_back');
      assert.deepEqual(grantEvents(p.id), ['granted', 'suspended', 'revoked']); assert.equal(grantEffective(p.id), false);
    });
    await check('rejected / cancelled / expired are attempts: 200 attempt_*; purchase stays preference_created; a later approved on the same preference activates', async () => {
      const p = await preparedPurchase('attempts');
      for (const [status, detail, outcome] of [['rejected', 'cc_rejected_insufficient_amount', 'attempt_rejected'], ['cancelled', 'by_collector', 'attempt_cancelled'], ['cancelled', 'expired', 'attempt_expired']]) {
        const { r } = await payAndNotify(p, status, detail);
        note(`${status}/${detail}`, r);
        assert.deepEqual([status, r.status, r.body?.outcome], [status, 200, outcome]);
        assert.equal(purchaseRow(p.id).status, 'preference_created');
      }
      const { r } = await payAndNotify(p, 'approved', 'accredited');
      assert.deepEqual([r.status, r.body?.outcome], [200, 'approved']);
      assert.deepEqual(grantEvents(p.id), ['granted']);
    });
    await check('payment id conflict: a payment already approved for another purchase, re-bound to this one → 422 (22023 TORNEOS_PAYMENT_CONFLICT); no second grant', async () => {
      const a = await preparedPurchase('conflict-a'); const b = await preparedPurchase('conflict-b');
      const { pay } = await payAndNotify(a, 'approved', 'accredited');
      const before = snapshot(b.id);
      await stub('/__lab/payments', { preferenceId: b.preferenceId, paymentId: pay.paymentId, status: 'approved', statusDetail: 'accredited' });
      const r = note('payment id conflict', await webhook({ dataId: pay.paymentId }));
      assert.equal(r.status, 422);
      same(b, before); assert.deepEqual(grantEvents(a.id), ['granted']);
    });
    await check('unknown provider status → 202 accepted, domain untouched', async () => {
      const p = await preparedPurchase('unknown');
      const before = snapshot(p.id);
      const pay = await stub('/__lab/payments', { preferenceId: p.preferenceId, status: 'mystery_status' });
      const r = note('unknown status', await webhook({ dataId: pay.paymentId }));
      assert.deepEqual([r.status, r.body?.outcome], [202, 'unknown_status']);
      same(p, before);
    });
    await check('provider 5xx (payment / merchant order / chargeback read) → 503, domain untouched; the retry then applies', async () => {
      const p = await preparedPurchase('mp5xx');
      const pay = await stub('/__lab/payments', { preferenceId: p.preferenceId, status: 'approved', statusDetail: 'accredited' });
      const before = snapshot(p.id);
      for (const route of ['/v1/payments/:id', '/merchant_orders/:id']) {
        await stub('/__lab/fail', { method: 'GET', route, status: 500, times: 1 });
        const r = note(`5xx ${route}`, await webhook({ dataId: pay.paymentId }));
        assert.deepEqual([route, r.status], [route, 503]);
        same(p, before);
      }
      const cb = await stub('/__lab/chargebacks', { paymentId: pay.paymentId });
      await stub('/__lab/fail', { method: 'GET', route: '/v1/chargebacks/:id', status: 503, times: 1 });
      assert.equal(note('5xx chargeback', await webhook({ dataId: cb.chargebackId, type: 'topic_chargebacks_wh' })).status, 503);
      same(p, before);
      const ok = note('retry after 5xx', await webhook({ dataId: pay.paymentId }));
      assert.deepEqual([ok.status, ok.body?.outcome], [200, 'approved']);
    });
    await check('no secret / PII in responses nor in torneos-functions / mp-stub logs (tokens, secrets, seller, DB URL, payer e-mail/document)', async () => {
      const responses = bodies.join('\n');
      assertNoLeak(responses, [cfg.mpa.sellerId], 'T4 responses');
      assert.ok(!/payer|collector|transaction_amount|external_reference|preference_id/.test(responses), 'responses are a whitelist');
      const logs = containerLogs('torneos-functions', 'mp-stub');
      assertNoLeak(logs, [cfg.mpa.sellerId], 'container logs');
      assert.ok(/torneos-payments/.test(logs), 'the payments worker did log (whitelisted fields)');
    });
  } finally {
    await writeEvidence('t4-webhook', { suite: 'MP-A3 T4 webhook', results, matrix,
      passed: results.filter(r => r.status === 'PASS').length, total: results.length });
  }
});
