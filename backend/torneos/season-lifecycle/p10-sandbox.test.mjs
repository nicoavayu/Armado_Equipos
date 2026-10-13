// P10 wrapper, offline: the exact runP10() the operator runs against the Mercado Pago sandbox, here with the in-process
// emulator in the shape the sandbox has (a TEST seller: `test_user` on /users/me, live_mode true, API refunds of
// live payments refused) and the person replaced by emulator calls. Proves the WRAPPER end to end on its own lab
// (0000→0019) before anyone types a token. It never proves what only Mercado Pago can answer (that it accepts the
// Preference with these URLs, the real status names, timings): the evidence says so (realProviderFacts).
//   node --test backend/torneos/season-lifecycle/p10-sandbox.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMercadoPago } from '../infra/torneos-payments-test/mp-emulator.mjs';
import { MP_ORIGIN, NOTIFICATION_SINK, NotPerformed, RETURN_ORIGIN, requireTestSeller, returnUrls, runP10, sandboxFetcher, verdictOf } from './p10/p10-sandbox.mjs';

process.env.COMMERCE_PRODUCTION_LAB_CONTAINER = 'arma2-season-p10-test-db';
const SELLER = '2468013579';
const TOKEN = 'APP_USR-2468013579123456-100726-0123456789abcdef0123456789abcdef-2468013579';
const TEST_ME = { id: Number(SELLER), nickname: 'TESTUSER_EMULATED', site_id: 'MLA', tags: ['normal', 'test_user'] };
const CARD = { APRO: ['approved', 'accredited'], OTHE: ['rejected', 'cc_rejected_other_reason'], CONT: ['in_process', 'pending_contingency'] };
const at = () => new Date(Date.now() - 5000).toISOString();
const emulatorHuman = (mp, steps = []) => ({
  async pay({ caseId, initPoint, card }) { steps.push(`${caseId} pay ${card}`); mp.pay(new URL(initPoint).searchParams.get('pref_id'), { status: CARD[card][0], statusDetail: CARD[card][1], at: at() }); },
  async refund({ caseId, paymentId }) { steps.push(`${caseId} refund`); mp.panelRefund(paymentId); },
});

test('only a TEST seller of MLA, owner of the token; the fetcher is locked to the runtime\'s own calls', async () => {
  assert.equal(requireTestSeller(TEST_ME, TOKEN), SELLER);
  assert.throws(() => requireTestSeller({ ...TEST_ME, tags: ['normal'] }), /P10_NOT_A_TEST_SELLER/);
  assert.throws(() => requireTestSeller({ ...TEST_ME, site_id: 'MLB' }), /P10_SELLER_INVALID/);
  assert.throws(() => requireTestSeller({ ...TEST_ME, id: 1357924680 }, TOKEN), /P10_SELLER_MISMATCH/);
  const mp = makeMercadoPago({ sellerId: SELLER, accessToken: TOKEN, me: TEST_ME });
  const { fetcher, stats } = sandboxFetcher((i, n) => mp.fetch(i, n), { token: TOKEN });
  const me = await (await fetcher(`${MP_ORIGIN}/users/me`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
  assert.deepEqual(me.tags, ['normal'], 'only test_user is removed');
  assert.equal(me.id, TEST_ME.id);
  assert.equal(stats.attestationRewrites, 1);
  await assert.rejects(fetcher(`${MP_ORIGIN}/v1/payments/1/refunds`, { method: 'POST' }), /P10_CALL_REFUSED/);
  await assert.rejects(fetcher(`${MP_ORIGIN}/v1/payments`, { method: 'POST' }), /P10_CALL_REFUSED/);
  await assert.rejects(fetcher('https://api.mercadopago.com.evil.example/users/me'), /P10_ORIGIN_REFUSED/);
  // Return URLs: the runtime's lab paths on the certified TEST host; nothing else is accepted.
  assert.deepEqual(returnUrls({ success: 'https://app.unit.invalid/torneos/organizacion/o/temporada/s/plan/compra/p/exito' }),
    { success: `${RETURN_ORIGIN}/torneos/organizacion/o/temporada/s/plan/compra/p/exito` });
  assert.throws(() => returnUrls({ success: 'https://app.arma2.com.ar/x' }), /P10_BACK_URL_UNEXPECTED/);
  // A production seller's token stops the run before any lab is built.
  const prod = makeMercadoPago({ sellerId: SELLER, accessToken: TOKEN, me: { ...TEST_ME, tags: ['normal'] } });
  await assert.rejects(runP10({ accessToken: TOKEN, baseFetch: (i, n) => prod.fetch(i, n), provider: 'emulator', human: {} }), /P10_NOT_A_TEST_SELLER/);
});

test('verdict: PASS only with A–D all run; a passing subset is PARTIAL with its pending cases; any failure is FAIL', () => {
  const ok = [{ ok: true }];
  assert.deepEqual(verdictOf(ok, ['A', 'B', 'C', 'D']), { verdict: 'P10_PASS', pending: [] });
  assert.deepEqual(verdictOf(ok, ['A', 'C']), { verdict: 'P10_PARTIAL', pending: ['B', 'D'] });
  assert.deepEqual(verdictOf([{ ok: true }, { ok: false }], ['A', 'B', 'C', 'D']).verdict, 'P10_FAIL');
  assert.deepEqual(verdictOf([], ['A']).verdict, 'P10_FAIL');
  assert.deepEqual(verdictOf(ok, ['A', 'B', 'C', 'D'], [{ caseId: 'D', reason: 'x' }]), { verdict: 'P10_PARTIAL', pending: ['D'] });
});

test('a step Mercado Pago did not allow leaves its case PENDING with the reason, never PASS', { timeout: 900000 }, async () => {
  const mp = makeMercadoPago({ sellerId: SELLER, accessToken: TOKEN, me: TEST_ME });
  const base = emulatorHuman(mp);
  const human = { ...base, async pay(step) { if (step.caseId === 'D') throw new NotPerformed('no deja pagar dos veces'); return base.pay(step); } };
  const evidence = await runP10({ accessToken: TOKEN, baseFetch: (i, n) => mp.fetch(i, n), provider: 'emulator', human, cases: ['A', 'D'], pollMs: 0, maxPolls: 3, ageClaims: true });
  assert.equal(evidence.verdict, 'P10_PARTIAL');
  assert.deepEqual(evidence.pending, ['B', 'C', 'D']);
  assert.deepEqual(evidence.notPerformed, [{ caseId: 'D', reason: 'no deja pagar dos veces' }]);
});

test('cases A–D through the real runtime on a fresh 0000→0019 lab', { timeout: 900000 }, async () => {
  const mp = makeMercadoPago({ sellerId: SELLER, accessToken: TOKEN, me: TEST_ME });
  mp.refuseLiveRefunds(true);
  const sent = [];
  const baseFetch = (i, n = {}) => { if ((n.method ?? 'GET') === 'POST') sent.push(JSON.parse(n.body)); return mp.fetch(i, n); };
  const steps = []; const lines = [];
  const evidence = await runP10({ accessToken: TOKEN, baseFetch, provider: 'emulator', human: emulatorHuman(mp, steps), pollMs: 0, maxPolls: 3, ageClaims: true,
    log: (l) => lines.push(l) });
  assert.deepEqual(steps, ['A pay APRO', 'B pay OTHE', 'B pay CONT', 'C pay APRO', 'C refund', 'D pay APRO']);
  assert.equal(evidence.verdict, 'P10_PASS', lines.join('\n'));
  assert.equal(evidence.offer.amount, 20000);
  assert.equal(evidence.realProviderFacts, 'not established (emulator run)');
  assert.equal(evidence.certifies, false, 'an emulator run never certifies P10');
  assert.equal(evidence.provider.stats.attestationRewrites, 1, 'one attestation per isolate');
  assert.equal(evidence.provider.stats.notificationUrl, 'lab-invalid');
  assert.equal(sent.length, 3, 'three Preferences (A, B, C)');
  for (const body of sent) {
    assert.ok(Object.values(body.back_urls).every((u) => u.startsWith(`${RETURN_ORIGIN}/torneos/organizacion/`)), 'buyers return to the TEST host');
    assert.equal(new URL(body.notification_url).hostname.endsWith('.invalid'), true, 'notification_url stays the lab value');
  }
  assert.equal(Object.keys(evidence.provider.stats.calls).some((k) => /refunds/.test(k)), false, 'the wrapper never calls a refund');
  assert.equal(JSON.stringify(evidence).includes(TOKEN), false, 'the token is never in the evidence');
});

test('a Preference refused for its notification_url is sent once more with the 404 sink, and the evidence says so', { timeout: 900000 }, async () => {
  const mp = makeMercadoPago({ sellerId: SELLER, accessToken: TOKEN, me: TEST_ME });
  const posts = [];
  const baseFetch = async (i, n = {}) => {
    if ((n.method ?? 'GET') === 'POST') {
      posts.push({ key: n.headers?.['X-Idempotency-Key'], notification: JSON.parse(n.body).notification_url });
      if (posts.length === 1) return new Response(JSON.stringify({ message: 'notification_url attribute must be url valid', status: 400 }), { status: 400 });
    }
    return mp.fetch(i, n);
  };
  const evidence = await runP10({ accessToken: TOKEN, baseFetch, provider: 'emulator', human: emulatorHuman(mp), cases: ['A'], pollMs: 0, maxPolls: 3, ageClaims: true });
  assert.equal(evidence.verdict, 'P10_PARTIAL');
  assert.deepEqual(evidence.pending, ['B', 'C', 'D']);
  assert.equal(posts.length, 2);
  assert.equal(posts[1].notification, NOTIFICATION_SINK);
  assert.equal(posts[1].key, `${posts[0].key}:p10-sink`, 'a new idempotency key for the different body');
  assert.equal(evidence.provider.stats.notificationUrl, 'sink');
  assert.equal(evidence.provider.stats.preferences[0].refusedFirst.status, 400);
});

test('a case that never completes is a FAIL with its reason, and the next case still runs', { timeout: 900000 }, async () => {
  const mp = makeMercadoPago({ sellerId: SELLER, accessToken: TOKEN, me: TEST_ME });
  const human = {
    async pay({ caseId, initPoint }) {
      if (caseId === 'C') return; // the person never paid case C
      mp.pay(new URL(initPoint).searchParams.get('pref_id'), { status: 'approved', statusDetail: 'accredited', at: at() });
    },
    async refund() { throw new Error('not reached'); },
  };
  const evidence = await runP10({ accessToken: TOKEN, baseFetch: (i, n) => mp.fetch(i, n), provider: 'emulator', human, cases: ['C', 'D'], pollMs: 0, maxPolls: 2, ageClaims: true });
  assert.equal(evidence.verdict, 'P10_FAIL');
  const failed = evidence.checks.filter((c) => !c.ok);
  assert.deepEqual(failed.map((c) => c.caseId), ['C']);
  assert.match(failed[0].got, /P10_TIMEOUT waiting for the late approval/);
  assert.ok(evidence.checks.some((c) => c.caseId === 'D' && c.ok), 'D ran after C failed');
});
