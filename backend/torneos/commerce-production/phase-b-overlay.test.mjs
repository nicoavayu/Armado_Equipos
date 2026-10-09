// COMMERCE-PRODUCTION phase B — offline contract of the integrated-preview overlay (lab/phase-b): the files it hands
// the lab owner configure exactly the production lab path, the lab router hands each worker only its own values, and
// nothing secret crosses to the wrong place. The Docker end-to-end is `node lab/phase-b/overlay.mjs selftest`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadGatewayTree, REPO_ROOT } from '../infra/torneos-gateway-auth/gateway-loader.mjs';
import { freshSecrets, PAYMENTS_MOUNT, renderOverlay } from './lab/phase-b/overlay.mjs';
import { makeMercadoPago } from '../infra/torneos-payments-test/mp-emulator.mjs';

const tree = await loadGatewayTree();
const { loadCommerceConfig } = await tree.import('torneos-gateway/commerce.ts');
const { loadProductionPaymentsConfig } = await tree.import('torneos-payments-production/config.ts');

// The lab router (integration/torneos-core-contracts/torneos-edge-main/env.ts), transpiled like the function tree.
const ts = (await import(pathToFileURL(path.join(REPO_ROOT, 'node_modules/typescript/lib/typescript.js')).href)).default;
const routerSource = await fs.readFile(path.join(REPO_ROOT, 'integration/torneos-core-contracts/torneos-edge-main/env.ts'), 'utf8');
const routerDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arma2-phase-b-router-'));
await fs.writeFile(path.join(routerDir, 'env.mjs'), ts.transpileModule(routerSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
const { workerEnv, WORKERS } = await import(pathToFileURL(path.join(routerDir, 'env.mjs')).href);

const parseEnv = (text) => Object.fromEntries(text.trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const secrets = freshSecrets();
const files = renderOverlay(secrets, { appOrigin: 'http://localhost:3121' });
const gatewayEnv = parseEnv(files['gateway-commerce.env']);
const functionsEnv = parseEnv(files['torneos-functions-production.env']);
const stubEnv = parseEnv(files['mp-stub.env']);
const BASE43 = new Set(Array.from({ length: 43 }, (_, i) => `staging_rpc_${i}`));
// What the rehearsal's torneos-functions container already carries (gateway + TEST payments), next to the overlay.
const TEST_PAYMENTS = { TORNEOS_PAYMENT_PROVIDER: 'MERCADO_PAGO', MERCADO_PAGO_ENVIRONMENT: 'test', MERCADO_PAGO_TEST_ACCESS_TOKEN: 'TEST-fixture',
  APP_PUBLIC_URL: 'http://localhost:3000', TORNEOS_PAYMENTS_DB_URL: 'postgres://lab_payment_service:x@torneos-db:5432/postgres' };
const GATEWAY_BASE = { TORNEOS_GATEWAY_PUBLIC_URL: 'http://127.0.0.1:58421/torneos-gateway', TORNEOS_BRIDGE_KEYS: 'x', CORE_AUTH_URL: 'x' };
const edgeGatewayEnv = parseEnv(files['edge-gateway-commerce.env']);
const container = { ...GATEWAY_BASE, ...TEST_PAYMENTS, ...functionsEnv, ...edgeGatewayEnv };
const SECRET_VALUES = [secrets.accessToken, secrets.webhookSecret, secrets.dbPassword, secrets.controlToken];

test('gateway-commerce.env is exactly the lab production commerce: local-lab, the torneos-payments-production mount, the 3 reads', () => {
  assert.deepEqual(Object.keys(gatewayEnv).sort(), ['TORNEOS_COMMERCE_DEPLOYMENT', 'TORNEOS_COMMERCE_MODE', 'TORNEOS_PAYMENTS_INTERNAL_SECRET', 'TORNEOS_PAYMENTS_INTERNAL_URL']);
  const c = loadCommerceConfig(gatewayEnv, { baseAllowlist: BASE43, gatewayPublicUrl: 'http://127.0.0.1:58421/torneos-gateway', distinctFrom: [] });
  assert.deepEqual([c.mode, c.deployment, c.paymentsUrl], ['production', 'local-lab', PAYMENTS_MOUNT]);
  assert.equal(c.readRpcs.size, 3);
  for (const value of SECRET_VALUES) assert.ok(!files['gateway-commerce.env'].includes(value), 'the gateway file carries no Mercado Pago, DB or console secret');
  // The same values never configure a hosted gateway.
  assert.throws(() => loadCommerceConfig(gatewayEnv, { baseAllowlist: BASE43, gatewayPublicUrl: 'https://torneos-gateway-abc-rj.a.run.app', distinctFrom: [] }));
});

test('the lab router: torneos-payments-production gets its values unprefixed and boots in the offline lab configuration', () => {
  assert.deepEqual([...WORKERS].sort(), ['torneos-gateway', 'torneos-payments', 'torneos-payments-production']);
  const worker = Object.fromEntries(workerEnv('torneos-payments-production', container));
  assert.deepEqual(Object.keys(worker).sort(), Object.keys(functionsEnv).map((k) => k.replace(/^PRODUCTION_PAYMENTS__/, '')).sort());
  assert.ok(!Object.keys(worker).some((k) => /^PRODUCTION_PAYMENTS__|^MERCADO_PAGO_TEST_|^CORE_|^TORNEOS_BRIDGE_|^TORNEOS_COMMERCE_|^TORNEOS_PAYMENTS_DEPLOYMENT$/.test(k)));
  assert.equal(worker.MERCADO_PAGO_ENVIRONMENT, 'production');
  const cfg = loadProductionPaymentsConfig(worker);
  assert.equal(cfg.deployment, null, 'lab configuration, never hosted');
  assert.equal(cfg.labMpApiOrigin, 'http://mp-stub:8080');
  assert.match(cfg.notificationUrl, /\.invalid\//);
});

test('the lab router: the TEST worker never sees a production value; the gateway never sees a payments secret', () => {
  const testWorker = Object.fromEntries(workerEnv('torneos-payments', container));
  assert.equal(testWorker.MERCADO_PAGO_ENVIRONMENT, 'test');
  for (const value of [...SECRET_VALUES, secrets.internalSecret]) assert.ok(!Object.values(testWorker).includes(value));
  const gateway = Object.fromEntries(workerEnv('torneos-gateway', container));
  assert.ok(!Object.keys(gateway).some((k) => /^MERCADO_PAGO_|^PRODUCTION_PAYMENTS__|^TORNEOS_PAYMENTS_DB_|^APP_PUBLIC_URL$/.test(k)));
  for (const value of SECRET_VALUES) assert.ok(!Object.values(gateway).includes(value));
  assert.equal(gateway.TORNEOS_PAYMENTS_INTERNAL_URL, PAYMENTS_MOUNT);
  assert.equal(gateway.TORNEOS_PAYMENTS_INTERNAL_SECRET, secrets.internalSecret, 'the Edge gateway signs with the production worker key');
  const c = loadCommerceConfig(gateway, { baseAllowlist: BASE43, gatewayPublicUrl: gateway.TORNEOS_GATEWAY_PUBLIC_URL, distinctFrom: [] });
  assert.deepEqual([c.mode, c.deployment, c.paymentsUrl], ['production', 'local-lab', PAYMENTS_MOUNT]);
  // A stray unprefixed key in the container (e.g. a TEST lab's) is never what the production gateway signs with.
  const stray = Object.fromEntries(workerEnv('torneos-gateway', { ...container, TORNEOS_PAYMENTS_INTERNAL_SECRET: 'ab'.repeat(32) }));
  assert.equal(stray.TORNEOS_PAYMENTS_INTERNAL_SECRET, secrets.internalSecret);
  assert.equal(Object.fromEntries(workerEnv('torneos-gateway', { ...container, PRODUCTION_PAYMENTS__TORNEOS_PAYMENTS_INTERNAL_SECRET: undefined })).TORNEOS_PAYMENTS_INTERNAL_SECRET, undefined,
    'no production key → the gateway gets none (commerce fails closed)');
});

test('the lab router pins local-lab in production mode and forwards no deployment otherwise', () => {
  for (const deployment of ['remote-test', 'production', 'local-lab', undefined]) {
    const gw = Object.fromEntries(workerEnv('torneos-gateway', { ...container, TORNEOS_COMMERCE_DEPLOYMENT: deployment }));
    assert.equal(gw.TORNEOS_COMMERCE_DEPLOYMENT, 'local-lab', String(deployment));
  }
  for (const mode of ['test', '']) {
    const gw = Object.fromEntries(workerEnv('torneos-gateway', { ...container, TORNEOS_COMMERCE_MODE: mode, TORNEOS_COMMERCE_DEPLOYMENT: 'remote-test' }));
    assert.ok(!('TORNEOS_COMMERCE_DEPLOYMENT' in gw), `mode ${JSON.stringify(mode)}`);
  }
});

test('the stub file, the login SQL and the switch SQL carry only what each needs', () => {
  assert.ok(!files['mp-stub.env'].includes(secrets.dbPassword) && !files['mp-stub.env'].includes(secrets.internalSecret), 'the stub has no DB login or gateway HMAC key');
  assert.equal(stubEnv.MP_STUB_PAYMENTS_URL, PAYMENTS_MOUNT);
  assert.equal(stubEnv.MP_STUB_APP_ORIGIN, 'http://localhost:3121');
  assert.match(files['lab-login.sql'], /PASSWORD 'SCRAM-SHA-256\$4096:/);
  assert.ok(!files['lab-login.sql'].includes(secrets.dbPassword), 'the database only ever receives the verifier');
  assert.match(files['lab-login.sql'], /CREATE ROLE lab_payment_production_service LOGIN NOINHERIT/);
  assert.match(files['lab-login.sql'], /GRANT torneos_payment_production_service TO lab_payment_production_service WITH INHERIT FALSE, SET TRUE;/);
  for (const name of ['scope-open.sql', 'scope-off.sql']) assert.match(files[name], /^BEGIN;\nUPDATE public\.tournament_commerce_production_settings SET checkout_scope = '(open|off)'.* WHERE singleton;\nCOMMIT;\n$/s, name);
});

test('the stub is lab-only and never logs a credential', async () => {
  const source = await fs.readFile(new URL('./lab/phase-b/mp-stub-production.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('^http:\\/\\/torneos-functions:\\d{2,5}\\/torneos-payments-production$'), 'notifications only to the lab worker');
  assert.ok(source.includes('^https?:\\/\\/(localhost|127\\.0\\.0\\.1):\\d{2,5}$'), 'return links only to a loopback app');
  for (const [, args] of source.matchAll(/console\.(?:log|error)\((.*)\)/g)) {
    assert.ok(!/\b(CONTROL_TOKEN|ACCESS_TOKEN|WEBHOOK_SECRET|base)\b/.test(args), `logs no credential: ${args}`);
  }
});

test('the emulator keeps its certified default ids; idBase only moves the start', () => {
  const pay = (mp) => {
    const id = 'pref-1';
    mp.state.preferences.set(id, { body: { external_reference: 'r', items: [{ unit_price: 1 }], metadata: { purchase_id: 'p' } }, orderId: null });
    return mp.pay(id, { status: 'approved', at: new Date().toISOString() });
  };
  assert.equal(pay(makeMercadoPago({ sellerId: '1234567', accessToken: 'x' })), '90000000001');
  assert.equal(pay(makeMercadoPago({ sellerId: '1234567', accessToken: 'x', idBase: 1_700_000_000_000_000 })), '1700000000000001');
});
