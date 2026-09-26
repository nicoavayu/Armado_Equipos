// PAYMENTS TEST — offline unit tests of the operator session contract (no Docker, no network). The end-to-end run of
// every command is session-rehearsal.mjs (Docker).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as C from './payments-test-contract.mjs';
import { makeSession, sellerOfToken, SessionStop } from './payments-session.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELLER = '2718281828';
const TOKEN = `APP_USR-1234567890123456-092611-${'a'.repeat(32)}-${SELLER}`;
const GOOD = { pat: `sbp_${'a'.repeat(40)}`, deno: `ddo_${'b'.repeat(30)}`, mpToken: TOKEN, mpSecret: 'c'.repeat(64) };
const deps = { say: () => {}, readLine: () => '', now: () => Date.now() };

test('P1 the seller id is the last token segment; malformed inputs never build a session', () => {
  assert.equal(sellerOfToken(TOKEN), SELLER);
  for (const [k, v, code] of [['pat', 'nope', 'PAT_MALFORMED'], ['deno', 'x', 'DENO_TOKEN_MALFORMED'], ['mpToken', `TEST-1234567890-092611-${'a'.repeat(32)}-${SELLER}`, 'MP_TOKEN_MALFORMED'], ['mpSecret', 'short', 'MP_WEBHOOK_SECRET_MALFORMED']]) {
    assert.throws(() => makeSession({ ...GOOD, [k]: v, deps }), (e) => e instanceof SessionStop && e.code === code, k);
  }
  const s = makeSession({ ...GOOD, deps });
  assert.equal(s.sellerId, SELLER);
  assert.deepEqual(s.known, Object.values(GOOD));
  s.wipe(); assert.equal(s.known.length, 0);
});

test('P2 unknown or argument-carrying commands are refused before any I/O', async () => {
  const s = makeSession({ ...GOOD, deps });
  for (const [line, code] of [['drop-everything', 'COMMAND_UNKNOWN'], ['pb now', 'COMMAND_REFUSED'], ['preference 1', 'COMMAND_REFUSED'], ['ordering', 'RUN_FIXTURES_FIRST'], ['refund', 'RUN_FIXTURES_FIRST'], ['refund-verify', 'RUN_FIXTURES_FIRST'], ['refund-verify now', 'COMMAND_REFUSED']]) {
    await assert.rejects(s.run(line), (e) => e.code === code, line);
  }
});

test('P3 Mercado Pago allowlist: reads only, one armed full refund, nothing else', () => {
  assert.equal(C.classifyMpRequest({ method: 'GET', path: '/users/me' }).id, 'users-me');
  assert.throws(() => C.classifyMpRequest({ method: 'POST', path: '/checkout/preferences', body: {} }), /not_allowlisted/);
  assert.throws(() => C.classifyMpRequest({ method: 'POST', path: '/v1/payments/123/refunds', body: {} }), /not_armed/);
  assert.throws(() => C.classifyMpRequest({ method: 'POST', path: '/v1/payments/123/refunds', body: { amount: 1 } }, { armedFor: 'refund:123' }), /full_refund/);
  assert.equal(C.classifyMpRequest({ method: 'POST', path: '/v1/payments/123/refunds', body: {} }, { armedFor: 'refund:123' }).kind, 'write:refund');
  assert.throws(() => C.classifyMpRequest({ method: 'POST', path: '/v1/payments/124/refunds', body: {} }, { armedFor: 'refund:123' }), /not_armed/);
  assert.deepEqual(C.classifyMpRequest({ method: 'GET', path: '/v1/payments/123/refunds' }), { id: 'payment-refunds', kind: 'read' });
  assert.throws(() => C.classifyMpRequest({ method: 'GET', path: '/v1/payments/123/refunds', body: {} }), /get_with_body/);
  assert.throws(() => C.classifyMpRequest({ method: 'GET', path: '/v1/payments/123/refunds/9' }), /not_allowlisted/);
});

test('P4 Deno allowlist: the gateway app is read-only, writes only to torneos-payments-test and only armed', () => {
  assert.throws(() => C.classifyDenoRequest({ method: 'POST', path: '/v2/apps/torneos-gateway/deploy', body: {} }, { armedFor: 'deploy' }), /not_allowlisted/);
  assert.throws(() => C.classifyDenoRequest({ method: 'PATCH', path: '/v2/apps/torneos-gateway', body: {} }), /not_allowlisted/);
  assert.equal(C.classifyDenoRequest({ method: 'GET', path: '/v2/apps/torneos-gateway' }).id, 'app');
  assert.throws(() => C.classifyDenoRequest({ method: 'POST', path: '/v2/apps', body: {} }), /not_armed/);
});

test('P5 the tty wrapper and the contract agree on every input shape', () => {
  const sh = fs.readFileSync(path.join(HERE, 'run-payments-session.sh'), 'utf8');
  const shapes = [...sh.matchAll(/^ask '[^']+' (\w+) '([^']+)'/gm)].map((m) => [m[1], new RegExp(m[2])]);
  assert.deepEqual(shapes.map(([v]) => v), ['PAT', 'DENO', 'MPT', 'MPS']);
  const [pat, deno, mpt, mps] = shapes.map(([, re]) => re);
  for (const [re, good, bad] of [[pat, GOOD.pat, 'sbp_x'], [deno, GOOD.deno, 'ddx_' + 'a'.repeat(30)], [mpt, TOKEN, 'TEST-1-2-3'], [mps, GOOD.mpSecret, 'x']]) { assert.ok(re.test(good)); assert.ok(!re.test(bad)); }
  assert.ok(C.MP_TOKEN_PATTERN.test(TOKEN) && C.MP_SECRET_PATTERN.test(GOOD.mpSecret));
  assert.match(sh, /printf '\{"pat":"%s","deno":"%s","mpToken":"%s","mpSecret":"%s"\}'/);
  execFileSync('bash', ['-n', path.join(HERE, 'run-payments-session.sh')]);
});

test('P6 the QA browser script parses, targets only the certified gateway / Torneos PostgREST and refuses duplicates', () => {
  const src = fs.readFileSync(path.join(HERE, 'qa-fixtures.js'), 'utf8');
  new vm.Script(src);
  const hosts = [...new Set([...src.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(hosts, ['app.arma2.com.ar', 'onzpwnqxnvlgsevivngf.supabase.co', 'torneos-gateway.nicoavayu.deno.net']);
  assert.match(src, /QA_ORG_ALREADY_PRESENT_REFUSE_DUPLICATE/);
  assert.ok(src.includes(C.QA.orgName) && C.QA.seasons.every((s) => src.includes(s.name) && src.includes(s.slugPrefix)));
  assert.ok(!/create_tournament_with_defaults|auth\/v1\/signup|service_role/.test(src));
});

test('P7 secret scan catches the session values and MP token shapes', () => {
  assert.ok(C.secretFindings(`x ${TOKEN} y`).length > 0);
  const hex = crypto.randomBytes(32).toString('hex');
  assert.ok(C.secretFindings(`z ${hex}`, [hex]).length > 0);
});

test('P8 the payments psql runner keeps the whole output (> 64 KB head intact) and fails closed beyond 4 MB', async () => {
  const { EventEmitter } = await import('node:events');
  const D = await import('./payments-db.mjs');
  const fake = (bytes) => () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { end: () => setImmediate(() => { child.stdout.emit('data', Buffer.from('W|torneos_payments_test|torneos_payments_test|1\n')); for (let n = 0; n < bytes; n += 8192) child.stdout.emit('data', Buffer.alloc(8192, 'x')); child.stdout.emit('data', Buffer.from('\nZ|done\n')); child.emit('close', 0); }) };
    return child;
  };
  const ok = await D.runPsqlProbe({ script: '', env: {}, redact: (s) => s, spawn: fake(200 * 1024) });
  assert.equal(ok.code, 0);
  assert.ok(ok.stdout.startsWith('W|torneos_payments_test|') && ok.stdout.endsWith('Z|done\n'));
  const big = await D.runPsqlProbe({ script: '', env: {}, redact: (s) => s, spawn: fake(D.MAX_PROBE_STDOUT + 8192) });
  assert.equal(big.code, -2); assert.equal(big.stderr_tail, 'stdout_overflow');
});

test('P9 SANDBOX redeploy: one PATCH of exactly the public QA organization pin, armed, on the TEST app only; env shapes', () => {
  const org = '2489cc1f-0000-4000-8000-000000000001';
  const good = { env_vars: [{ key: C.QA_ORG_ENV, value: org, secret: false, contexts: 'all' }] };
  assert.throws(() => C.classifyDenoRequest({ method: 'PATCH', path: `/v2/apps/${C.APP_SLUG}`, body: good }), /not_armed/);
  assert.equal(C.classifyDenoRequest({ method: 'PATCH', path: `/v2/apps/${C.APP_SLUG}`, body: good }, { armedFor: 'app-env' }).kind, 'write:app-env');
  assert.throws(() => C.classifyDenoRequest({ method: 'PATCH', path: '/v2/apps/torneos-gateway', body: good }, { armedFor: 'app-env' }), /not_allowlisted/);
  for (const bad of [
    { env_vars: [{ ...good.env_vars[0], key: 'MERCADO_PAGO_ACCESS_TOKEN' }] }, { env_vars: [{ ...good.env_vars[0], secret: true }] }, { env_vars: [{ ...good.env_vars[0], value: 'qa-payments-test-x' }] },
    { env_vars: [{ ...good.env_vars[0], contexts: 'production' }] }, { env_vars: [...good.env_vars, { ...good.env_vars[0], key: 'TORNEOS_PAYMENTS_DEPLOYMENT', value: 'x' }] },
    { ...good, config: C.APP_CONFIG }, { env_vars: [] },
  ]) assert.throws(() => C.assertDenoWriteBody('app-env', bad), /deno_env_update_only_qa_pin/, JSON.stringify(bad));
  assert.equal(C.envShapeOf(C.ENV_NAMES), 'created'); assert.equal(C.envShapeOf(C.ENV_NAMES_SCOPED), 'scoped');
  assert.equal(C.envShapeOf([...C.ENV_NAMES, 'MERCADO_PAGO_ACCESS_TOKEN']), 'other');
  assert.deepEqual(C.forbiddenEnvNames(C.ENV_NAMES_SCOPED), []);
  assert.equal(C.PHRASES.redeploy('abc'), `REDEPLOY TORNEOS PAYMENTS TEST DENO APP ${C.APP_SLUG} abc`);
});

test('P10 SANDBOX relation projection: booleans only, application ids never copied', async () => {
  const { applicationRelation } = await import('./payments-clients.mjs');
  const rel = applicationRelation({ application_id: 4412 }, { application_id: '4412' }, { client_id: '4412' });
  assert.deepEqual(rel, { preference_client_id_present: true, payment_application_id: true, payment_client_id: null, order_application_id: true });
  assert.equal(applicationRelation({}, { application_id: '1' }, { client_id: '4412' }).order_application_id, false);
  assert.ok(!JSON.stringify(rel).includes('4412'));
});

test('P11 FRESH OPERATION: the fresh-purchase browser script touches only the certified hosts, S1 purchase RPC, one swept purchase', () => {
  const src = fs.readFileSync(path.join(HERE, 'qa-fresh-purchase.js'), 'utf8');
  new vm.Script(src);
  const hosts = [...new Set([...src.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(hosts, ['app.arma2.com.ar', 'onzpwnqxnvlgsevivngf.supabase.co', 'torneos-gateway.nicoavayu.deno.net']);
  const rpcs = [...new Set([...src.matchAll(/(?:gw|rest)\('([a-z_]+)'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(rpcs, ['create_tournament_season_checkout_purchase']);
  assert.ok(/expiredStalePurchases === 1/.test(src) && /IDS_MALFORMED/.test(src));
  assert.ok(!/create_tournament_organization|create_tournament_season'|create_tournament_with_defaults|auth\/v1\/signup|service_role/.test(src));
});

test('P12 FRESH OPERATION: a superseded S1 purchase is expired by the service sweep and nothing the provider reached', () => {
  const base = { status: 'expired', preference_id: '3712890098-abc', approved_payment: null, grants: [], watermarks: [], events: [
    { type: 'purchase.created', from: null, to: 'created', actor: 'user' },
    { type: 'preference.created', from: 'created', to: 'preference_created', actor: 'service' },
    { type: 'purchase.expired', from: 'preference_created', to: 'expired', actor: 'service' }] };
  assert.ok(C.isSupersededQaPurchase(base));
  for (const bad of [
    { ...base, status: 'preference_created' }, { ...base, status: 'cancelled' }, { ...base, preference_id: null }, { ...base, approved_payment: '180983221818' },
    { ...base, grants: [{}] }, { ...base, watermarks: [{}] }, { ...base, events: base.events.slice(0, 2) },
    { ...base, events: [...base.events.slice(0, 2), { type: 'payment.approved', from: 'preference_created', to: 'approved', actor: 'provider' }, base.events[2]] },
    { ...base, events: [...base.events.slice(0, 2), { ...base.events[2], actor: 'user' }] }, null,
  ]) assert.equal(C.isSupersededQaPurchase(bad), false, JSON.stringify(bad));
});

test('P13 REFUND, MANUAL INITIATION: every lifecycle check is real; the API initiation is declared not certified', async () => {
  const P1 = 'd4a72039-3b35-489c-8a75-7a6e37d85cd1'; const pay = '181036143126';
  const trail = { purchase: P1, status: 'refunded', approved_payment: pay, approved_at: '2026-09-26T19:46:30.201658+00:00', refunded_at: '2026-09-26T20:20:17.738951+00:00',
    events: [{ type: 'purchase.created', from: null, to: 'created', actor: 'user' }, { type: 'preference.created', from: 'created', to: 'preference_created', actor: 'service' },
      { type: 'payment.approved', from: 'preference_created', to: 'approved', actor: 'provider' }, { type: 'payment.refund', from: 'approved', to: 'refunded', actor: 'provider' }],
    grants: [{ grant: 'g', plan: 'PREMIUM', effective: false, events: [{ type: 'granted', reason_code: 'payment_approved', actor: 'provider' }, { type: 'revoked', reason_code: 'total_refund', actor: 'provider' }] }],
    watermarks: [{ payment: pay, state: ['reversal', 'refund'], manual_refund: false, manual_review: false }] };
  const payment = { id: pay, status: 'refunded', status_detail: 'refunded', collector_matches: true, transaction_amount: 39900, currency_id: 'ARS', external_reference: `arma2:season:purchase:${P1}` };
  const refunds = [{ refund_id: '1', amount: 39900, status: 'approved', source_type: 'collector' }];
  const deliveries = [{ at: '2026-09-26T19:46:31.008Z', status: 200, code: 'approved' }, { at: '2026-09-26T20:20:17.823Z', status: 400, code: 'invalid_request' }, { at: '2026-09-26T20:20:18.659Z', status: 200, code: 'reversal_applied' }];
  const base = { purchaseId: P1, payment, refunds, before: trail, after: structuredClone(trail), deliveries, startedAt: Date.parse('2026-09-26T21:00:00Z'), mpWrites: 0, late: { status: 200, body: { outcome: 'provider_snapshot_duplicate' } } };
  const r = C.manualRefundChecks(base);
  assert.equal(r.checks.length, 9); assert.ok(r.checks.every((c) => c.pass), JSON.stringify(r.checks.filter((c) => !c.pass)));
  assert.equal(r.reversal.length, 1);
  const fail = (over, why) => assert.ok(C.manualRefundChecks({ ...base, ...over }).checks.some((c) => !c.pass), why);
  fail({ mpWrites: 1 }, 'a Mercado Pago write by the session');
  fail({ payment: { ...payment, status: 'approved', status_detail: 'accredited' } }, 'provider not refunded');
  fail({ payment: { ...payment, id: '1' } }, 'another payment');
  fail({ payment: { ...payment, collector_matches: false } }, 'another seller');
  fail({ payment: null }, 'no payment');
  fail({ refunds: [] }, 'no refund at the provider');
  fail({ refunds: [{ ...refunds[0], amount: 19950 }] }, 'partial refund');
  fail({ refunds: [{ ...refunds[0], status: 'rejected' }] }, 'refund not approved');
  fail({ deliveries: deliveries.filter((d) => d.code !== 'reversal_applied') }, 'no real signed delivery');
  fail({ startedAt: Date.parse('2026-09-26T20:20:00Z') }, 'the delivery came after the step started (could be the harness)');
  fail({ deliveries: [...deliveries.slice(0, 2), { ...deliveries[2], at: '2026-09-26T20:25:00Z' }] }, 'the delivery is not the one that refunded the purchase');
  fail({ before: { ...trail, status: 'approved' }, after: { ...trail, status: 'approved' } }, 'purchase not refunded');
  fail({ before: { ...trail, events: [...trail.events.slice(0, 3), { ...trail.events[3], actor: 'service' }] } }, 'refund not applied by the provider path');
  const g = (ev, eff = false) => ({ ...trail, grants: [{ ...trail.grants[0], effective: eff, events: ev }] });
  fail({ before: g(trail.grants[0].events, true) }, 'grant still effective');
  fail({ before: g([trail.grants[0].events[0], { ...trail.grants[0].events[1], reason_code: 'manual' }]) }, 'revoked for another reason');
  fail({ before: { ...trail, grants: [...trail.grants, trail.grants[0]] } }, 'two grants');
  fail({ before: { ...trail, watermarks: [{ ...trail.watermarks[0], state: ['status', 'approved'] }] } }, 'watermark not advanced');
  fail({ before: { ...trail, watermarks: [{ ...trail.watermarks[0], manual_refund: true }] } }, 'manual refund flag');
  fail({ late: { status: 200, body: { outcome: 'applied' } } }, 'late replay applied something');
  fail({ after: { ...trail, status: 'approved' } }, 'late replay revived the purchase');
  assert.match(C.REFUND_LIMITATION.refund_api_initiation, /^NOT CERTIFIED .*"refund API initiation" could not be certified.*Seller Test.*live_mode:true/);
  assert.match(C.REFUND_LIMITATION.refund_lifecycle, /^CERTIFIED .*refund → signed webhook → revoke/);
  assert.deepEqual(C.REFUND_PASS_VERDICTS, ['REFUND_LIFECYCLE_PASS', 'REFUND_LIFECYCLE_PASS_MANUAL_INITIATION']);
  const { makeMercadoPagoClient } = await import('./payments-clients.mjs');
  const seen = [];
  const mp = makeMercadoPagoClient({ token: TOKEN, sellerId: SELLER, transport: async (req) => { seen.push(req); return { status: 200, body: [{ id: 77, payment_id: 181036143126, amount: 39900, status: 'approved', date_created: 'x', source: { id: '999', name: 'Someone', type: 'collector' }, refund_mode: 'standard' }] }; } });
  const rf = await mp.refunds(pay);
  assert.deepEqual(rf, [{ refund_id: '77', payment_id: '181036143126', amount: 39900, status: 'approved', date_created: 'x', source_type: 'collector', refund_mode: 'standard' }]);
  assert.equal(seen[0].method, 'GET'); assert.equal(mp.writes, 0); assert.ok(!JSON.stringify(rf).includes('Someone') && !JSON.stringify(rf).includes('999'));
});
