// COMMERCE-PRODUCTION — the Deno Deploy operator tool offline: fake Deno and Mercado Pago transports, an in-memory
// Keychain, the REAL production config.ts validating the env and the REAL bundle walker.
//   node --test backend/torneos/infra/torneos-payments-production/production-deploy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as C from './production-contract.mjs';
import { buildProductionAssets, productionModuleGraph, SHARED_TEST_FILES } from './production-bundle.mjs';
import { assertCreateBody, makeSession, productionEnv, writeEvidence } from './production-deploy.mjs';

const SELLER = '2468013579';
const TOKEN = `APP_USR-1234567890123456-100726-0123456789abcdef0123456789abcdef-${SELLER}`;
const SECRET = 'ProdWebhookSecretFixture0123456789ABCDEF';
const DENO = 'ddo_' + 'x'.repeat(40);
const CA = '-----BEGIN CERTIFICATE-----\nMIIfixture\n-----END CERTIFICATE-----\n';
const secrets = { deno: DENO, mpToken: TOKEN, mpSecret: SECRET, sellerId: SELLER };

function keychain({ password = 'p'.repeat(20) + 'Q'.repeat(20) } = {}) {
  let internal = null;
  return {
    dbPassword: { check: () => (password ? 'PRESENT' : 'ABSENT'), read: () => password, generate: () => { throw new Error('not here'); } },
    internalSecret: { check: () => (internal ? 'PRESENT' : 'ABSENT'), generate: () => { internal = crypto.randomBytes(32).toString('hex'); }, read: () => internal },
  };
}
function fakes({ me = { id: Number(SELLER), site_id: 'MLA', tags: ['normal'] }, apps = { 'torneos-payments-test': { id: 't', slug: 'torneos-payments-test', env_vars: [] } } } = {}) {
  const calls = [];
  const deno = async ({ token, method, path: p, body }) => {
    calls.push({ host: 'deno', method, path: p, token, body });
    const m = /^\/v2\/apps\/([a-z-]+)$/.exec(p);
    if (method === 'GET' && m) return apps[m[1]] ? { status: 200, body: apps[m[1]] } : { status: 404, body: null };
    if (method === 'POST' && p === '/v2/apps') { apps[body.slug] = { id: 'new', slug: body.slug, env_vars: body.env_vars.map(({ key }) => ({ key })), config: body.config, labels: body.labels }; return { status: 201, body: apps[body.slug] }; }
    if (method === 'POST' && p === '/v2/apps/torneos-payments/deploy') return { status: 202, body: { id: 'rev1', status: 'queued', labels: body.labels } };
    if (method === 'GET' && p.startsWith('/v2/apps/torneos-payments/revisions')) return { status: 200, body: [{ id: 'rev1', status: 'succeeded' }] };
    return { status: 500, body: null };
  };
  const mp = async ({ token, method, path: p }) => { calls.push({ host: 'mp', method, path: p, token }); return token === TOKEN ? { status: 200, body: me } : { status: 401, body: null }; };
  return { calls, deno, mp, apps };
}
const build = (opts) => buildProductionAssets({ ...opts, requireClean: false });

test('the bundle is the production graph plus only the pure TEST helpers; the cron lives in the entrypoint only', () => {
  const { files, bare } = productionModuleGraph();
  assert.deepEqual(bare, ['npm:postgres@3.4.7']);
  assert.ok(files.includes(C.ENTRYPOINT));
  assert.deepEqual(files.filter((f) => f.startsWith('torneos-payments/')), [...SHARED_TEST_FILES].sort());
  for (const f of ['torneos-payments/config.ts', 'torneos-payments/handler.ts', 'torneos-payments/remote-test.ts', 'torneos-payments/index.ts']) assert.ok(!files.includes(f), f);
  assert.match(fs.readFileSync(path.join(C.FUNCTIONS_DIR, C.ENTRYPOINT), 'utf8'), /Deno\.cron\?\.\(/);
});

test('plan: digest, exact env names, the URLs, the gateway and frontend switches; no network', async () => {
  const f = fakes();
  const plan = await makeSession({ ...f, secrets: {}, keychain: keychain(), build }).plan();
  assert.equal(plan.webhook_url, `https://torneos-payments.${C.DENO_ORG}.deno.net/functions/v1/torneos-payments-production/webhooks/mercadopago/v1`);
  assert.deepEqual(plan.env_names, C.ENV_NAMES);
  assert.match(plan.phrases.create, /^CREATE TORNEOS PAYMENTS PRODUCTION APP torneos-payments [0-9a-f]{12}$/);
  assert.equal(plan.gateway_env.TORNEOS_COMMERCE_MODE, 'production');
  assert.equal(f.calls.length, 0);
});

test('the env is validated by the real production config before anything is written', async () => {
  const env = await productionEnv({ ...secrets, keychain: keychain(), caPem: CA });
  assert.equal(env.TORNEOS_PAYMENTS_DEPLOYMENT, 'production');
  assert.equal(env.APP_PUBLIC_URL, 'https://app.arma2.com.ar');
  assert.match(env.TORNEOS_PAYMENTS_DB_URL, /^postgres:\/\/torneos_payments_prod\.onzpwnqxnvlgsevivngf:/);
  await assert.rejects(productionEnv({ ...secrets, sellerId: '1357924680', keychain: keychain(), caPem: CA }), { code: 'MP_TOKEN_NOT_OF_SELLER' });
  await assert.rejects(productionEnv({ ...secrets, mpToken: 'TEST-123', keychain: keychain(), caPem: CA }), { code: 'MP_VALUES_MALFORMED' });
  await assert.rejects(productionEnv({ ...secrets, keychain: keychain({ password: null }), caPem: CA }), /PRODUCTION_LOGIN_PASSWORD_ABSENT/);
});

test('create: phrase, attestation of a production seller, the exact body; the TEST app is never written', async () => {
  const f = fakes();
  const session = makeSession({ ...f, secrets, keychain: keychain(), readCa: () => CA, build });
  const plan = await session.plan();
  await assert.rejects(session.create(['CREATE', 'TORNEOS']), { code: 'PHRASE_REQUIRED' });
  const out = await session.create(plan.phrases.create.split(' '));
  assert.equal(out.verdict, 'PRODUCTION_APP_CREATED');
  const writes = f.calls.filter((c) => c.method === 'POST');
  assert.deepEqual(writes.map((c) => c.path), ['/v2/apps', '/v2/apps/torneos-payments/deploy']);
  assert.ok(assertCreateBody(writes[0].body));
  assert.equal(writes[0].body.env_vars.find((e) => e.key === 'MERCADO_PAGO_PRODUCTION_ACCESS_TOKEN').secret, true);
  assert.equal(writes[0].body.env_vars.find((e) => e.key === 'APP_PUBLIC_URL').secret, false);
  assert.ok(!f.calls.some((c) => /torneos-payments-test/.test(c.path) && c.method !== 'GET'));
  assert.deepEqual(Object.keys(writes[1].body.assets).sort(), build().manifest.map((m) => m.path).sort());
  // A second create refuses (the app exists); a redeploy keeps the env as it is.
  await assert.rejects(session.create(plan.phrases.create.split(' ')), { code: 'APP_ALREADY_EXISTS' });
  assert.equal((await session.deploy(plan.phrases.deploy.split(' '))).verdict, 'PRODUCTION_APP_REDEPLOYED');
});

test('a TEST seller (test_user), another seller or a refused token never gets an app', async () => {
  for (const me of [{ id: Number(SELLER), site_id: 'MLA', tags: ['test_user'] }, { id: 1, site_id: 'MLA', tags: [] }, { id: Number(SELLER), site_id: 'MLB', tags: [] }]) {
    const f = fakes({ me });
    const session = makeSession({ ...f, secrets, keychain: keychain(), readCa: () => CA, build });
    const plan = await session.plan();
    await assert.rejects(session.create(plan.phrases.create.split(' ')), { code: 'MP_NOT_PRODUCTION_SELLER' });
    assert.equal(f.calls.filter((c) => c.method === 'POST').length, 0);
  }
  const f = fakes();
  const pre = await makeSession({ ...f, secrets: { ...secrets, mpToken: TOKEN.replace(/.$/, '0') }, keychain: keychain(), readCa: () => CA, build }).preflight();
  assert.equal(pre.verdict, 'PRODUCTION_PREFLIGHT_FAILED');
});

test('requests outside the allowlist or unarmed writes never reach a socket', async () => {
  const f = fakes();
  const session = makeSession({ ...f, secrets, keychain: keychain(), readCa: () => CA, build });
  // deploy without an app: refused before any write
  const plan = await session.plan();
  await assert.rejects(session.deploy(plan.phrases.deploy.split(' ')), { code: 'APP_ABSENT' });
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 0);
});

test('evidence never carries a value the run holds', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-evidence-'));
  assert.throws(() => writeEvidence('x', { leaked: TOKEN }, [TOKEN], { dir }), { code: 'EVIDENCE_WOULD_LEAK' });
  const file = writeEvidence('ok', { verdict: 'PRODUCTION_STATUS' }, [TOKEN, SECRET, DENO], { dir });
  assert.ok(fs.existsSync(file));
  fs.rmSync(dir, { recursive: true, force: true });
});
