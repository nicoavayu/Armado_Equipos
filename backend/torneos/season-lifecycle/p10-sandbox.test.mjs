// P10 wrapper, offline: the exact runP10() the operator runs against the Mercado Pago sandbox, here with the in-process
// emulator in the shape the sandbox has (a TEST seller: `test_user` on /users/me, live_mode true, API refunds of
// live payments refused) and the person replaced by emulator calls. Proves the wrapper end to end on its own lab
// (0000→0019) before anyone types a token; the real run differs only in baseFetch and the human.
//   node --test backend/torneos/season-lifecycle/p10-sandbox.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMercadoPago } from '../infra/torneos-payments-test/mp-emulator.mjs';
import { MP_ORIGIN, requireTestSeller, runP10, sandboxFetcher } from './p10/p10-sandbox.mjs';

process.env.COMMERCE_PRODUCTION_LAB_CONTAINER = 'arma2-season-p10-test-db';
const SELLER = '2468013579';
const TOKEN = 'APP_USR-2468013579123456-100726-0123456789abcdef0123456789abcdef-2468013579';
const TEST_ME = { id: Number(SELLER), nickname: 'TESTUSER_EMULATED', site_id: 'MLA', tags: ['normal', 'test_user'] };

test('only a TEST seller of MLA is accepted; the fetcher is locked to the runtime\'s own calls', async () => {
  assert.equal(requireTestSeller(TEST_ME), SELLER);
  assert.throws(() => requireTestSeller({ ...TEST_ME, tags: ['normal'] }), /P10_NOT_A_TEST_SELLER/);
  assert.throws(() => requireTestSeller({ ...TEST_ME, site_id: 'MLB' }), /P10_SELLER_INVALID/);
  const mp = makeMercadoPago({ sellerId: SELLER, accessToken: TOKEN, me: TEST_ME });
  const { fetcher, stats } = sandboxFetcher((i, n) => mp.fetch(i, n));
  const me = await (await fetcher(`${MP_ORIGIN}/users/me`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
  assert.deepEqual(me.tags, ['normal'], 'only test_user is removed');
  assert.equal(me.id, TEST_ME.id);
  assert.equal(stats.attestationRewrites, 1);
  await assert.rejects(fetcher(`${MP_ORIGIN}/v1/payments/1/refunds`, { method: 'POST' }), /P10_CALL_REFUSED/);
  await assert.rejects(fetcher(`${MP_ORIGIN}/v1/payments`, { method: 'POST' }), /P10_CALL_REFUSED/);
  await assert.rejects(fetcher('https://api.mercadopago.com.evil.example/users/me'), /P10_ORIGIN_REFUSED/);
  // A production seller's token stops the run before any lab is built.
  const prod = makeMercadoPago({ sellerId: SELLER, accessToken: TOKEN, me: { ...TEST_ME, tags: ['normal'] } });
  await assert.rejects(runP10({ accessToken: TOKEN, baseFetch: (i, n) => prod.fetch(i, n), human: {} }), /P10_NOT_A_TEST_SELLER/);
});

test('cases A–D through the real runtime on a fresh 0000→0019 lab', { timeout: 900000 }, async () => {
  const mp = makeMercadoPago({ sellerId: SELLER, accessToken: TOKEN, me: TEST_ME });
  mp.refuseLiveRefunds(true);
  const at = () => new Date(Date.now() - 5000).toISOString();
  // What a test-card holder name produces in Checkout Pro (CONT: in_process / pending_contingency).
  const CARD = { APRO: ['approved', 'accredited'], OTHE: ['rejected', 'cc_rejected_other_reason'], CONT: ['in_process', 'pending_contingency'] };
  const steps = [];
  const human = {
    async pay({ caseId, initPoint, card }) {
      steps.push(`${caseId} pay ${card}`);
      const pref = new URL(initPoint).searchParams.get('pref_id');
      mp.pay(pref, { status: CARD[card][0], statusDetail: CARD[card][1], at: at() });
    },
    async refund({ caseId, paymentId }) { steps.push(`${caseId} refund`); mp.panelRefund(paymentId); },
  };
  const lines = [];
  const evidence = await runP10({ accessToken: TOKEN, baseFetch: (i, n) => mp.fetch(i, n), human, pollMs: 0, maxPolls: 3, ageClaims: true,
    log: (l) => lines.push(l) });
  assert.deepEqual(steps, ['A pay APRO', 'B pay OTHE', 'B pay CONT', 'C pay APRO', 'C refund', 'D pay APRO']);
  assert.equal(evidence.verdict, 'P10_PASS', lines.join('\n'));
  assert.equal(evidence.offer.amount, 20000);
  assert.equal(evidence.provider.attestationRewrites, 1, 'one attestation per isolate');
  assert.equal(Object.keys(evidence.provider.calls).some((k) => /refunds/.test(k)), false, 'the wrapper never calls a refund');
  assert.equal(JSON.stringify(evidence).includes(TOKEN), false, 'the token is never in the evidence');
});

test('a case that never completes is a FAIL with its reason, and the next case still runs', { timeout: 900000 }, async () => {
  const mp = makeMercadoPago({ sellerId: SELLER, accessToken: TOKEN, me: TEST_ME });
  const human = {
    async pay({ caseId, initPoint }) {
      if (caseId === 'C') return; // the person never paid case C
      mp.pay(new URL(initPoint).searchParams.get('pref_id'), { status: 'approved', statusDetail: 'accredited', at: new Date(Date.now() - 5000).toISOString() });
    },
    async refund() { throw new Error('not reached'); },
  };
  const evidence = await runP10({ accessToken: TOKEN, baseFetch: (i, n) => mp.fetch(i, n), human, cases: ['C', 'D'], pollMs: 0, maxPolls: 2, ageClaims: true });
  assert.equal(evidence.verdict, 'P10_FAIL');
  const failed = evidence.checks.filter((c) => !c.ok);
  assert.deepEqual(failed.map((c) => c.caseId), ['C']);
  assert.match(failed[0].got, /P10_TIMEOUT waiting for the late approval/);
  assert.ok(evidence.checks.some((c) => c.caseId === 'D' && c.ok), 'D ran after C failed');
});
