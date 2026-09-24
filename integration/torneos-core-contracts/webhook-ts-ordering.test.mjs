// MP-B1.1 R3 — webhook ts 10 / 13 digits on the local commerce lab (TORNEOS_LAB_MODE=commerce): the ts format changes
// authentication only, never ordering. Real torneos-payments (edge-runtime) + real Torneos DB 0000 → 0003 (MP-B1.2) + mp-stub.
//
//   • authentic 13-digit (milliseconds) notifications are accepted and re-fetched like 10-digit ones; malformed or absurdly
//     future ones are 401 with 0 provider reads;
//   • old approved after refunded, old disputed after restored, exact replays, duplicate approved / refund / dispute, stale
//     provider snapshots and revoked-never-revives hold whatever the ts unit of each notification — including a NEWER ts on a
//     STALE provider snapshot (the ts never outranks the provider's date_last_updated); max 1 grant.
// Results: backend/torneos/mp-b/evidence/mp-b1.1-r3/webhook-ts-ordering[-tag].json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import {
  cfg, http, stub, stubCalls, preparedPurchase, purchaseRow, eventTypes, grantEvents, grantEffective, snapshot,
  assertNoLeak, containerLogs, mpSignature, repo, randomUUID, WEBHOOK_PATH,
} from './payments-lab.mjs';

const EVIDENCE = `${repo}backend/torneos/mp-b/evidence/mp-b1.1-r3/`;
const TAG = process.env.MP_B11R3_EVIDENCE_TAG ? `-${process.env.MP_B11R3_EVIDENCE_TAG}` : '';
const results = [];
const matrix = [];
const bodies = [];
const S = () => String(Math.floor(Date.now() / 1000));
const MS = () => String(Date.now());

/** One frozen notification with a RAW ts string (10 or 13 digits); sending it again is an exact replay. */
function notification(dataId, ts, { type = 'payment', requestId = randomUUID(), sign = ts } = {}) {
  const body = JSON.stringify({ action: 'payment.updated', api_version: 'v1', type, data: { id: dataId }, live_mode: false, user_id: Number(cfg.mpa.sellerId),
    date_created: new Date().toISOString(), id: Number(ts.slice(-9)) || 1 });
  const signature = mpSignature({ dataId, requestId, ts: sign }).replace(/^ts=[^,]*/, `ts=${ts}`);
  const headers = { 'content-type': 'application/json', 'x-request-id': requestId, 'x-signature': signature };
  return { ts, send: () => http(WEBHOOK_PATH, { query: `?data.id=${encodeURIComponent(dataId)}&type=${type}`, headers, body }) };
}
const reads = async () => (await stubCalls()).filter(c => c.method === 'GET' && !String(c.route).startsWith('/__lab')).length;
const grants = (id) => grantEvents(id).filter(e => e === 'granted').length;

test('MP-B1.1 R3 — webhook ts 10 / 13 digits vs ordering (lab)', async (t) => {
  async function check(name, fn) {
    await t.test(name, async () => {
      try { await fn(); results.push({ name, status: 'PASS' }); }
      catch (error) { results.push({ name, status: 'FAIL', error: String(error.message ?? error).slice(0, 400) }); throw error; }
    });
  }
  async function note(scenario, n) {
    const before = await reads();
    const r = await n.send();
    bodies.push(r.text);
    const providerReads = (await reads()) - before;
    matrix.push({ scenario, tsDigits: n.ts.length, http: r.status, outcome: r.body?.outcome ?? r.body?.error ?? null, providerReads });
    return { ...r, providerReads };
  }
  try {
    await check('lab: commerce lab reachable, provider stub reset', async () => {
      assert.ok(cfg?.mpa, 'commerce .runtime present');
      await stub('/__lab/reset', {});
    });

    let p1, pay1, oldApprovedMs;
    await check('13-digit ts: authentic (now) → approved, re-fetched, 1 grant; malformed / absurd future 13-digit → 401 with 0 provider reads', async () => {
      p1 = await preparedPurchase('r3-ms');
      pay1 = await stub('/__lab/payments', { preferenceId: p1.preferenceId, status: 'approved', statusDetail: 'accredited' });
      const before = snapshot(p1.id);
      for (const [label, n] of [['13-digit future +1 d (signed)', notification(pay1.paymentId, String(Date.now() + 86_400_000))],
        ['12 digits (signed)', notification(pay1.paymentId, MS().slice(1))], ['14 digits (signed)', notification(pay1.paymentId, `${MS()}0`)],
        ['leading-zero 13 digits (signed)', notification(pay1.paymentId, `0${MS().slice(1)}`)], ['13-digit header signed as seconds', notification(pay1.paymentId, MS(), { sign: S() })]]) {
        const r = await note(label, n);
        assert.deepEqual([label, r.status, r.body?.error, r.providerReads], [label, 401, 'invalid_signature', 0]);
      }
      assert.equal(snapshot(p1.id), before, 'domain untouched');
      oldApprovedMs = notification(pay1.paymentId, String(Date.now() - 30 * 86_400_000));
      const r = await note('old approved −30 d (13-digit)', oldApprovedMs);
      assert.deepEqual([r.status, r.body?.outcome], [200, 'approved']); assert.ok(r.providerReads >= 2);
      assert.equal(grants(p1.id), 1); assert.equal(grantEffective(p1.id), true);
    });
    await check('exact replay (13-digit) ×2 and duplicate approved (10-digit and 13-digit, new ids) → provider_snapshot_duplicate, re-fetched, no new event, 1 grant', async () => {
      const events = eventTypes(p1.id).length;
      for (const [label, n] of [['exact replay 13-digit #1', oldApprovedMs], ['exact replay 13-digit #2', oldApprovedMs],
        ['duplicate approved 10-digit', notification(pay1.paymentId, S())], ['duplicate approved 13-digit', notification(pay1.paymentId, MS())]]) {
        const r = await note(label, n);
        assert.deepEqual([label, r.status, r.body?.outcome], [label, 200, 'provider_snapshot_duplicate']); assert.ok(r.providerReads >= 2);
      }
      assert.equal(eventTypes(p1.id).length, events); assert.equal(grants(p1.id), 1);
    });
    await check('refund (10-digit) → refunded; duplicate refund (13-digit) → no new event; old approved (13-digit, exact replay) after refunded → stays refunded', async () => {
      await stub('/__lab/payment-state', { paymentId: pay1.paymentId, status: 'refunded', statusDetail: 'refunded' });
      assert.equal((await note('refund 10-digit', notification(pay1.paymentId, S()))).body?.outcome, 'reversal_applied');
      const events = eventTypes(p1.id).length;
      assert.equal((await note('duplicate refund 13-digit', notification(pay1.paymentId, MS()))).body?.outcome, 'provider_snapshot_duplicate');
      const before = snapshot(p1.id);
      const r = await note('old approved after refunded (13-digit replay)', oldApprovedMs);
      assert.equal(r.status, 200); assert.ok(r.providerReads >= 2);
      assert.equal(eventTypes(p1.id).length, events); assert.equal(snapshot(p1.id), before);
      assert.equal(purchaseRow(p1.id).status, 'refunded'); assert.equal(grants(p1.id), 1); assert.equal(grantEffective(p1.id), false);
    });
    await check('stale provider snapshot with a NEWER 13-digit ts (+299 s, within skew) → stale_ignored: the ts never outranks date_last_updated', async () => {
      await stub('/__lab/payment-state', { paymentId: pay1.paymentId, status: 'approved', statusDetail: 'accredited',
        overrides: { payment: { date_last_updated: new Date(Date.now() - 3600_000).toISOString() } } });
      const commercial = JSON.stringify([purchaseRow(p1.id), grantEvents(p1.id)]);
      const r = await note('stale approved snapshot, ts +299 s (13-digit)', notification(pay1.paymentId, String(Date.now() + 299_000)));
      assert.deepEqual([r.status, r.body?.outcome], [200, 'stale_ignored']);
      assert.equal(JSON.stringify([purchaseRow(p1.id), grantEvents(p1.id)]), commercial); assert.equal(grants(p1.id), 1);
    });

    let p2, pay2, oldDisputeMs;
    await check('dispute (13-digit) → charged_back; duplicate dispute (10-digit + exact replay) → no new event; restored (10-digit); old disputed (13-digit replay) after restored → stays approved', async () => {
      p2 = await preparedPurchase('r3-ms-dispute');
      pay2 = await stub('/__lab/payments', { preferenceId: p2.preferenceId, status: 'approved', statusDetail: 'accredited' });
      assert.equal((await note('approve p2 (10-digit)', notification(pay2.paymentId, S()))).body?.outcome, 'approved');
      await stub('/__lab/payment-state', { paymentId: pay2.paymentId, status: 'charged_back', statusDetail: 'in_process' });
      oldDisputeMs = notification(pay2.paymentId, MS());
      assert.equal((await note('dispute 13-digit', oldDisputeMs)).body?.outcome, 'reversal_applied');
      const events = eventTypes(p2.id).length;
      assert.equal((await note('duplicate dispute 10-digit', notification(pay2.paymentId, S()))).body?.outcome, 'provider_snapshot_duplicate');
      assert.equal((await note('duplicate dispute exact replay 13-digit', oldDisputeMs)).body?.outcome, 'provider_snapshot_duplicate');
      assert.equal(eventTypes(p2.id).length, events);
      await stub('/__lab/payment-state', { paymentId: pay2.paymentId, status: 'charged_back', statusDetail: 'reimbursed' });
      assert.equal((await note('restored 10-digit', notification(pay2.paymentId, S()))).body?.outcome, 'reversal_applied');
      const before = snapshot(p2.id);
      const old = await note('old disputed after restored (13-digit replay)', oldDisputeMs);
      assert.equal(old.status, 200); assert.ok(old.providerReads >= 2);
      assert.equal(snapshot(p2.id), before); assert.equal(purchaseRow(p2.id).status, 'approved'); assert.equal(grantEffective(p2.id), true); assert.equal(grants(p2.id), 1);
    });
    await check('stale disputed snapshot after restored, notified with a newer 13-digit ts → stale_ignored; restored preserved', async () => {
      await stub('/__lab/payment-state', { paymentId: pay2.paymentId, status: 'charged_back', statusDetail: 'in_process',
        overrides: { payment: { date_last_updated: new Date(Date.now() - 3600_000).toISOString() } } });
      const commercial = JSON.stringify([purchaseRow(p2.id), grantEvents(p2.id)]);
      assert.equal((await note('stale disputed, ts +120 s (13-digit)', notification(pay2.paymentId, String(Date.now() + 120_000)))).body?.outcome, 'stale_ignored');
      assert.equal(JSON.stringify([purchaseRow(p2.id), grantEvents(p2.id)]), commercial); assert.equal(grants(p2.id), 1);
    });
    await check('revoked (13-digit) never revives: old approved (10-digit replay), old dispute (13-digit replay) and a stale restored snapshot with a newer 13-digit ts; max 1 grant', async () => {
      const p3 = await preparedPurchase('r3-ms-revoked');
      const pay3 = await stub('/__lab/payments', { preferenceId: p3.preferenceId, status: 'approved', statusDetail: 'accredited' });
      const approved = notification(pay3.paymentId, S());
      assert.equal((await note('approve p3 (10-digit)', approved)).body?.outcome, 'approved');
      await stub('/__lab/payment-state', { paymentId: pay3.paymentId, status: 'charged_back', statusDetail: 'in_process' });
      const dispute = notification(pay3.paymentId, MS());
      assert.equal((await note('dispute p3 (13-digit)', dispute)).body?.outcome, 'reversal_applied');
      await stub('/__lab/payment-state', { paymentId: pay3.paymentId, status: 'charged_back', statusDetail: 'settled' });
      assert.equal((await note('buyer won p3 (13-digit)', notification(pay3.paymentId, MS()))).body?.outcome, 'reversal_applied');
      assert.deepEqual(grantEvents(p3.id), ['granted', 'suspended', 'revoked']);
      const commercial = JSON.stringify([purchaseRow(p3.id), grantEvents(p3.id)]);
      for (const [label, n] of [['old approved after revoked (10-digit replay)', approved], ['old dispute after revoked (13-digit replay)', dispute]]) assert.equal((await note(label, n)).status, 200, label);
      await stub('/__lab/payment-state', { paymentId: pay3.paymentId, status: 'charged_back', statusDetail: 'reimbursed',
        overrides: { payment: { date_last_updated: new Date(Date.now() - 3600_000).toISOString() } } });
      assert.equal((await note('stale restored after revoked, ts +200 s (13-digit)', notification(pay3.paymentId, String(Date.now() + 200_000)))).body?.outcome, 'stale_ignored');
      assert.equal(JSON.stringify([purchaseRow(p3.id), grantEvents(p3.id)]), commercial);
      assert.equal(grantEffective(p3.id), false); assert.equal(grants(p3.id), 1);
    });
    await check('no secret / PII in responses or in torneos-functions / mp-stub logs', async () => {
      assertNoLeak(bodies.join('\n'), [cfg.mpa.sellerId], 'R3 responses');
      assertNoLeak(containerLogs('torneos-functions', 'mp-stub'), [cfg.mpa.sellerId], 'container logs');
    });
  } finally {
    await mkdir(EVIDENCE, { recursive: true });
    const text = JSON.stringify({ suite: 'MP-B1.1 R3 webhook ts 10/13 vs ordering (lab)', results, matrix,
      passed: results.filter(r => r.status === 'PASS').length, total: results.length }, null, 2) + '\n';
    assertNoLeak(text, cfg?.mpa ? [cfg.mpa.sellerId] : [], 'evidence');
    await writeFile(`${EVIDENCE}webhook-ts-ordering${TAG}.json`, text);
  }
});
