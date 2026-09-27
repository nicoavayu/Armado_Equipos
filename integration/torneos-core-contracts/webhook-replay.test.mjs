// MP-B1.1 R2 — webhook replay / freshness on the local commerce lab (TORNEOS_LAB_MODE=commerce).
//
// Every notification is signed with the official Mercado Pago manifest by this suite; the lab mp-stub is the provider.
// What is proven end to end (real torneos-payments function, real Torneos DB 0000 → 0003, MP-B1.2 ordering):
//   • authentication: bad signature / malformed ts / absurd FUTURE ts → 401 with 0 provider reads, domain untouched;
//   • an OLD but authentic notification is not refused for its age (no documented maximum) — it only triggers a
//     provider re-fetch; exact replays and repeats re-fetch again and are idempotent in the DB;
//   • the webhook body / its ts never decide state: old approved after refunded, old disputed after restored and old
//     approved/restored after revocation re-fetch the CURRENT provider state and keep it; a provider snapshot older than
//     the watermark (stale read) is `stale_ignored` by MP-B1.2; there is never a second grant.
// Results: backend/torneos/mp-b/evidence/mp-b1.1-r2/webhook-replay[-tag].json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import {
  cfg, http, stub, stubCalls, preparedPurchase, purchaseRow, eventTypes, grantEvents, grantEffective, snapshot, waitPayments,
  assertNoLeak, containerLogs, mpSignature, repo, randomUUID, WEBHOOK_PATH,
} from './payments-lab.mjs';

const EVIDENCE = `${repo}backend/torneos/mp-b/evidence/mp-b1.1-r2/`;
const TAG = process.env.MP_B11R2_EVIDENCE_TAG ? `-${process.env.MP_B11R2_EVIDENCE_TAG}` : '';
const results = [];
const matrix = [];
const bodies = [];
const nowS = () => Math.floor(Date.now() / 1000);

/** One notification, frozen: sending it again is an exact replay (same request id, signature, query and bytes). */
function notification(dataId, { type = 'payment', ts = nowS(), requestId = randomUUID(), bodyOver = {} } = {}) {
  const body = JSON.stringify({ action: type === 'payment' ? 'payment.updated' : 'chargeback.updated', api_version: 'v1', type,
    data: type === 'payment' ? { id: dataId } : { id: dataId, checkout: 'PRO' }, live_mode: false, user_id: Number(cfg.mpa.sellerId),
    date_created: new Date(ts * 1000).toISOString(), id: Number(String(ts).slice(-9)), ...bodyOver });
  const headers = { 'content-type': 'application/json', 'x-request-id': requestId, 'x-signature': mpSignature({ dataId, requestId, ts }) };
  const query = `?data.id=${encodeURIComponent(dataId)}&type=${type}`;
  return { ts, send: () => http(WEBHOOK_PATH, { query, headers, body }), withSignature: (sig) => http(WEBHOOK_PATH, { query, headers: { ...headers, 'x-signature': sig }, body }) };
}
const reads = async () => (await stubCalls()).filter(c => c.method === 'GET' && !String(c.route).startsWith('/__lab')).length;
const grants = (id) => grantEvents(id).filter(e => e === 'granted').length;

test('MP-B1.1 R2 — webhook replay / freshness (lab)', async (t) => {
  async function check(name, fn) {
    await t.test(name, async () => {
      try { await fn(); results.push({ name, status: 'PASS' }); }
      catch (error) { results.push({ name, status: 'FAIL', error: String(error.message ?? error).slice(0, 400) }); throw error; }
    });
  }
  async function note(scenario, promise, expect = {}) {
    const before = await reads();
    const r = await promise;
    bodies.push(r.text);
    const providerReads = (await reads()) - before;
    matrix.push({ scenario, http: r.status, outcome: r.body?.outcome ?? r.body?.error ?? null, providerReads, ...expect });
    return { ...r, providerReads };
  }
  try {
    await check('lab: commerce lab reachable, provider stub reset', async () => {
      assert.ok(cfg?.mpa, 'commerce .runtime present');
      await stub('/__lab/reset', {});
      assert.equal(await waitPayments(), 401);
    });

    // ------------------------------------------------------------ authentication / freshness (no provider read)
    let p1, pay1;
    await check('auth: bad signature, wrong manifest, malformed ts (9 / 13 digits, letters, missing) → 401, 0 provider reads, domain untouched', async () => {
      p1 = await preparedPurchase('r2-auth');
      pay1 = await stub('/__lab/payments', { preferenceId: p1.preferenceId, status: 'approved', statusDetail: 'accredited' });
      const before = snapshot(p1.id);
      const n = notification(pay1.paymentId);
      const good = /v1=([0-9a-f]{64})/.exec(mpSignature({ dataId: pay1.paymentId, requestId: 'x', ts: n.ts }))[1];
      for (const [label, sig] of [['bad v1', `ts=${n.ts},v1=${'0'.repeat(64)}`], ['v1 of another request', `ts=${n.ts},v1=${good}`],
        ['ts 9 digits', `ts=${String(n.ts).slice(1)},v1=${'a'.repeat(64)}`], ['ts 13 digits (ms)', `ts=${n.ts}000,v1=${'a'.repeat(64)}`],
        ['ts letters', `ts=abcdefghij,v1=${'a'.repeat(64)}`], ['ts missing', `v1=${'a'.repeat(64)}`]]) {
        const r = await note(label, n.withSignature(sig), { expected: 401 });
        assert.deepEqual([label, r.status, r.body?.error, r.providerReads], [label, 401, 'invalid_signature', 0]);
      }
      assert.equal(snapshot(p1.id), before);
    });
    await check('freshness: authentic notification with an absurd FUTURE ts (+301 s, +1 h, +1 day, +10 years) → 401 before any provider read; domain untouched', async () => {
      const before = snapshot(p1.id);
      for (const offset of [301, 3600, 86400, 86400 * 3650]) {
        const r = await note(`future ts +${offset}s (authentic)`, notification(pay1.paymentId, { ts: nowS() + offset }).send(), { expected: 401 });
        assert.deepEqual([offset, r.status, r.body?.error, r.providerReads], [offset, 401, 'invalid_signature', 0]);
      }
      assert.equal(snapshot(p1.id), before);
    });
    let oldApproved;
    await check('freshness: authentic OLD notification (ts −30 days) → accepted, provider re-fetched, approved; exactly 1 grant', async () => {
      oldApproved = notification(pay1.paymentId, { ts: nowS() - 30 * 86400, bodyOver: { status: 'refunded' } });
      const r = await note('old signed approved (−30 d)', oldApproved.send(), { expected: 200 });
      assert.deepEqual([r.status, r.body?.outcome], [200, 'approved']);
      assert.ok(r.providerReads >= 2, 'payment + merchant order re-fetched');
      assert.equal(purchaseRow(p1.id).status, 'approved'); assert.equal(grants(p1.id), 1); assert.equal(grantEffective(p1.id), true);
    });
    await check('freshness: small forward skew (+60 s) is accepted (and still re-fetched)', async () => {
      const r = await note('skew +60 s', notification(pay1.paymentId, { ts: nowS() + 60 }).send(), { expected: 200 });
      assert.equal(r.status, 200); assert.ok(r.providerReads >= 2);
      assert.equal(grants(p1.id), 1);
    });

    // ------------------------------------------------------------ replay / duplicates
    await check('exact replay (same request id, signature, bytes) ×3 → 200 provider_snapshot_duplicate, re-fetched every time, no new event, 1 grant', async () => {
      const events = eventTypes(p1.id).length;
      for (let i = 0; i < 3; i++) {
        const r = await note(`exact replay #${i + 1}`, oldApproved.send(), { expected: 200 });
        assert.deepEqual([r.status, r.body?.outcome], [200, 'provider_snapshot_duplicate']);
        assert.ok(r.providerReads >= 2, 'replay still re-fetches');
      }
      assert.equal(eventTypes(p1.id).length, events); assert.equal(grants(p1.id), 1);
    });
    await check('same payment repeated (new request ids) and duplicate approved → idempotent: no new event, 1 grant', async () => {
      const events = eventTypes(p1.id).length;
      const out = [];
      for (let i = 0; i < 3; i++) out.push((await note(`repeat approved #${i + 1}`, notification(pay1.paymentId).send())).body?.outcome);
      assert.deepEqual(out, Array(3).fill('provider_snapshot_duplicate'));
      assert.equal(eventTypes(p1.id).length, events); assert.equal(grants(p1.id), 1);
    });
    let refundNote;
    await check('refund → refunded, grant revoked; duplicate refund (repeat + exact replay) → no new event', async () => {
      await stub('/__lab/payment-state', { paymentId: pay1.paymentId, status: 'refunded', statusDetail: 'refunded' });
      refundNote = notification(pay1.paymentId);
      const r = await note('refund', refundNote.send());
      assert.deepEqual([r.status, r.body?.outcome], [200, 'reversal_applied']);
      assert.equal(purchaseRow(p1.id).status, 'refunded'); assert.deepEqual(grantEvents(p1.id), ['granted', 'revoked']);
      const events = eventTypes(p1.id).length;
      for (const [label, send] of [['duplicate refund (new id)', notification(pay1.paymentId).send()], ['duplicate refund (exact replay)', refundNote.send()]]) {
        const d = await note(label, send);
        assert.deepEqual([label, d.status, d.body?.outcome], [label, 200, 'provider_snapshot_duplicate']);
      }
      assert.equal(eventTypes(p1.id).length, events); assert.deepEqual(grantEvents(p1.id), ['granted', 'revoked']);
    });
    await check('old approved notification AFTER refunded (exact replay of the −30 d approved) → re-fetch sees refunded → stays refunded; no second grant', async () => {
      const before = snapshot(p1.id);
      const r = await note('old approved after refunded', oldApproved.send());
      assert.equal(r.status, 200); assert.ok(r.providerReads >= 2);
      assert.equal(purchaseRow(p1.id).status, 'refunded');
      assert.equal(snapshot(p1.id), before, 'commercial state and events unchanged');
      assert.equal(grants(p1.id), 1); assert.equal(grantEffective(p1.id), false);
    });
    await check('stale provider read: re-fetch returns an OLDER approved snapshot after refunded → MP-B1.2 stale_ignored; refunded preserved; no second grant', async () => {
      // The refund watermark is the provider time of the refunded snapshot (≈ now); this read is one hour older.
      await stub('/__lab/payment-state', { paymentId: pay1.paymentId, status: 'approved', statusDetail: 'accredited',
        overrides: { payment: { date_last_updated: new Date(Date.now() - 3600_000).toISOString() } } });
      const commercial = JSON.stringify([purchaseRow(p1.id), grantEvents(p1.id)]);
      const r = await note('stale approved snapshot after refunded', oldApproved.send());
      assert.deepEqual([r.status, r.body?.outcome], [200, 'stale_ignored']);
      assert.equal(purchaseRow(p1.id).status, 'refunded');
      assert.equal(JSON.stringify([purchaseRow(p1.id), grantEvents(p1.id)]), commercial);
      assert.equal(grants(p1.id), 1);
    });

    // ------------------------------------------------------------ dispute → restored; old disputed must not downgrade
    let p2, pay2, oldDispute;
    await check('dispute → charged_back, grant suspended; duplicate dispute (repeat + exact replay) → no new event', async () => {
      p2 = await preparedPurchase('r2-dispute');
      pay2 = await stub('/__lab/payments', { preferenceId: p2.preferenceId, status: 'approved', statusDetail: 'accredited' });
      assert.equal((await note('approve p2', notification(pay2.paymentId).send())).body?.outcome, 'approved');
      await stub('/__lab/payment-state', { paymentId: pay2.paymentId, status: 'charged_back', statusDetail: 'in_process' });
      oldDispute = notification(pay2.paymentId, { bodyOver: { status: 'charged_back' } });
      const r = await note('dispute', oldDispute.send());
      assert.deepEqual([r.status, r.body?.outcome], [200, 'reversal_applied']);
      assert.equal(purchaseRow(p2.id).status, 'charged_back'); assert.deepEqual(grantEvents(p2.id), ['granted', 'suspended']);
      const events = eventTypes(p2.id).length;
      for (const [label, send] of [['duplicate dispute (new id)', notification(pay2.paymentId).send()], ['duplicate dispute (exact replay)', oldDispute.send()]]) {
        const d = await note(label, send);
        assert.deepEqual([label, d.status, d.body?.outcome], [label, 200, 'provider_snapshot_duplicate']);
      }
      assert.equal(eventTypes(p2.id).length, events);
    });
    await check('restored → approved, grant restored; OLD disputed notification replayed after restore → re-fetch sees restored → stays approved, grant effective', async () => {
      await stub('/__lab/payment-state', { paymentId: pay2.paymentId, status: 'charged_back', statusDetail: 'reimbursed' });
      const r = await note('restored', notification(pay2.paymentId).send());
      assert.deepEqual([r.status, r.body?.outcome], [200, 'reversal_applied']);
      assert.equal(purchaseRow(p2.id).status, 'approved'); assert.deepEqual(grantEvents(p2.id), ['granted', 'suspended', 'restored']);
      const before = snapshot(p2.id);
      const old = await note('old disputed after restored (exact replay)', oldDispute.send());
      assert.equal(old.status, 200); assert.ok(old.providerReads >= 2);
      assert.equal(snapshot(p2.id), before);
      assert.equal(purchaseRow(p2.id).status, 'approved'); assert.equal(grantEffective(p2.id), true);
    });
    await check('stale provider read: re-fetch returns an OLDER disputed snapshot after restored → stale_ignored; restored preserved; 1 grant', async () => {
      await stub('/__lab/payment-state', { paymentId: pay2.paymentId, status: 'charged_back', statusDetail: 'in_process',
        overrides: { payment: { date_last_updated: new Date(Date.now() - 3600_000).toISOString() } } });
      const commercial = JSON.stringify([purchaseRow(p2.id), grantEvents(p2.id)]);
      const r = await note('stale disputed snapshot after restored', oldDispute.send());
      assert.deepEqual([r.status, r.body?.outcome], [200, 'stale_ignored']);
      assert.equal(JSON.stringify([purchaseRow(p2.id), grantEvents(p2.id)]), commercial);
      assert.equal(purchaseRow(p2.id).status, 'approved'); assert.equal(grants(p2.id), 1); assert.equal(grantEffective(p2.id), true);
    });

    // ------------------------------------------------------------ revocation is final
    await check('revoked stays revoked: buyer won (settled) → revoked; old approved / old dispute replays and a stale restored snapshot never revive it', async () => {
      const p3 = await preparedPurchase('r2-revoked');
      const pay3 = await stub('/__lab/payments', { preferenceId: p3.preferenceId, status: 'approved', statusDetail: 'accredited' });
      const approvedNote = notification(pay3.paymentId);
      assert.equal((await note('approve p3', approvedNote.send())).body?.outcome, 'approved');
      await stub('/__lab/payment-state', { paymentId: pay3.paymentId, status: 'charged_back', statusDetail: 'in_process' });
      const disputeNote = notification(pay3.paymentId);
      assert.equal((await note('dispute p3', disputeNote.send())).body?.outcome, 'reversal_applied');
      await stub('/__lab/payment-state', { paymentId: pay3.paymentId, status: 'charged_back', statusDetail: 'settled' });
      assert.equal((await note('buyer won p3', notification(pay3.paymentId).send())).body?.outcome, 'reversal_applied');
      assert.deepEqual(grantEvents(p3.id), ['granted', 'suspended', 'revoked']);
      const commercial = JSON.stringify([purchaseRow(p3.id), grantEvents(p3.id)]);
      for (const [label, send] of [['old approved after revoked', () => approvedNote.send()], ['old dispute after revoked', () => disputeNote.send()]]) {
        const r = await note(label, send());
        assert.equal(r.status, 200, label);
      }
      await stub('/__lab/payment-state', { paymentId: pay3.paymentId, status: 'charged_back', statusDetail: 'reimbursed',
        overrides: { payment: { date_last_updated: new Date(Date.now() - 3600_000).toISOString() } } });
      assert.equal((await note('stale restored snapshot after revoked', approvedNote.send())).body?.outcome, 'stale_ignored');
      assert.equal(JSON.stringify([purchaseRow(p3.id), grantEvents(p3.id)]), commercial);
      assert.equal(grantEffective(p3.id), false); assert.equal(grants(p3.id), 1);
    });

    await check('no secret / PII in responses or in torneos-functions / mp-stub logs', async () => {
      assertNoLeak(bodies.join('\n'), [cfg.mpa.sellerId], 'R2 responses');
      assertNoLeak(containerLogs('torneos-functions', 'mp-stub'), [cfg.mpa.sellerId], 'container logs');
    });
  } finally {
    await mkdir(EVIDENCE, { recursive: true });
    const text = JSON.stringify({ suite: 'MP-B1.1 R2 webhook replay / freshness (lab)', results, matrix,
      passed: results.filter(r => r.status === 'PASS').length, total: results.length }, null, 2) + '\n';
    assertNoLeak(text, cfg?.mpa ? [cfg.mpa.sellerId] : [], 'evidence');
    await writeFile(`${EVIDENCE}webhook-replay${TAG}.json`, text);
  }
});
