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
  for (const [line, code] of [['drop-everything', 'COMMAND_UNKNOWN'], ['pb now', 'COMMAND_REFUSED'], ['preference 1', 'COMMAND_REFUSED'], ['ordering', 'RUN_FIXTURES_FIRST'], ['refund', 'RUN_FIXTURES_FIRST']]) {
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
