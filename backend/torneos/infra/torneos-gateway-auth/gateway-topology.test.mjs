// GATEWAY/AUTH G1 — the gateway accepts Core Production EXCLUSIVELY as the HTTPS authority and never as a data
// backend (topology.ts + config.ts + core-client.ts), offline, on the real sources (gateway-loader.mjs).
//   PASS  Core Production HTTPS authority + Torneos (onzpwnqxnvlgsevivngf) REST/DB, pinned exactly.
//   FAIL  Core Production (or Staging) in a postgres URL / as Torneos REST; the Torneos ref as Core authority;
//         mixed refs in a plane; a Production half with a non-Production half; non-canonical Production URLs;
//         another web origin; an Edge-Function host; wrong / privileged logins; no verified TLS; commerce on;
//         Core keys above anon anywhere in the environment.
// The certified semantics stay as they were: RS256, TTL 120 s, tolerance 5 s, the iss/aud constants.
// Run: node --test backend/torneos/infra/torneos-gateway-auth/gateway-topology.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadGatewayTree } from './gateway-loader.mjs';

const CORE = 'rcyuuoaqfwcembdajcss';
const DATA = 'onzpwnqxnvlgsevivngf';
const STAGING = 'hhyvmhgpapyuzjgxfnqv';
const OTHER = 'abcdefghijklmnopqrst';
const tree = await loadGatewayTree();
test.after(() => tree.cleanup());
const T = await tree.import('torneos-gateway/topology.ts');
const C = await tree.import('torneos-gateway/config.ts');
const K = await tree.import('torneos-gateway/core-client.ts');
const TOK = await tree.import('torneos-gateway/token.ts');

function ring() {
  const keys = [];
  for (const kid of ['fixture-k1', 'fixture-k2']) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    keys.push({ kid, privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKey: publicKey.export({ format: 'jwk' }) });
  }
  // k2 is standby: public half only in the gateway env (its private half stays in custody until a rotation).
  return { activeKid: 'fixture-k1', trustedKids: ['fixture-k1', 'fixture-k2'], keys: [keys[0], { kid: 'fixture-k2', publicKey: keys[1].publicKey }] };
}
const pooler = (login, ref = DATA, host = 'aws-0-sa-east-1.pooler.supabase.com', port = 5432) => `postgres://${login}.${ref}:pw-fixture@${host}:${port}/postgres`;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.${'s'.repeat(43)}`;

export const PROD_ENV = Object.freeze({
  TORNEOS_GATEWAY_PUBLIC_URL: 'https://torneos-gateway.fixture.example/functions/v1/torneos-gateway',
  TORNEOS_ALLOWED_ORIGIN: 'https://app.arma2.com.ar',
  CORE_AUTH_URL: `https://${CORE}.supabase.co/auth/v1`,
  CORE_JWT_ISSUER: `https://${CORE}.supabase.co/auth/v1`,
  CORE_CONTRACT_URL: `https://${CORE}.supabase.co/functions/v1/torneos-core-contract`,
  CORE_ANON_KEY: 'sb_publishable_corefixture0000000000',
  TORNEOS_CONTRACT_SERVICE_SECRET: crypto.createHash('sha256').update('g1-fixture').digest('hex'),
  TORNEOS_REST_URL: `https://${DATA}.supabase.co/rest/v1`,
  TORNEOS_ANON_KEY: 'sb_publishable_torneosfixture00000000',
  TORNEOS_DB_IDENTITY_WRITER_URL: pooler('torneos_edge_identity_writer'),
  TORNEOS_DB_CORE_ADAPTER_URL: pooler('torneos_edge_core_adapter'),
  TORNEOS_DB_SSL_CA: '-----BEGIN CERTIFICATE-----\nZml4dHVyZQ==\n-----END CERTIFICATE-----',
  TORNEOS_BRIDGE_KEYS: JSON.stringify(ring()),
});
const LAB_ENV = Object.freeze({
  ...PROD_ENV,
  TORNEOS_GATEWAY_PUBLIC_URL: 'http://127.0.0.1:54321/functions/v1/torneos-gateway', TORNEOS_ALLOWED_ORIGIN: 'http://localhost:3000',
  CORE_AUTH_URL: 'http://core-auth:9999', CORE_JWT_ISSUER: 'http://core-auth:9999', CORE_CONTRACT_URL: 'http://core-api:8000/functions/v1/torneos-core-contract',
  TORNEOS_REST_URL: 'http://torneos-rest:3000', TORNEOS_DB_SSL_CA: '',
  TORNEOS_DB_IDENTITY_WRITER_URL: 'postgres://lab_identity_writer:pw-fixture@torneos-db:5432/postgres',
  TORNEOS_DB_CORE_ADAPTER_URL: 'postgres://lab_core_adapter:pw-fixture@torneos-db:5432/postgres',
});

test('PASS: Core Production HTTPS authority + Torneos data plane (pooler, transaction pooler, direct host)', () => {
  const cfg = C.loadConfig(PROD_ENV);
  assert.deepEqual(cfg.topology, { kind: 'production', coreRef: CORE, dataRef: DATA });
  assert.equal(cfg.coreAuthUrl, `https://${CORE}.supabase.co/auth/v1`);
  assert.equal(cfg.coreJwtIssuer, `https://${CORE}.supabase.co/auth/v1`);
  assert.equal(cfg.coreContractUrl, `https://${CORE}.supabase.co/functions/v1/torneos-core-contract`);
  assert.equal(cfg.torneosRestUrl, `https://${DATA}.supabase.co/rest/v1`);
  assert.equal(cfg.allowedOrigin, 'https://app.arma2.com.ar');
  assert.deepEqual(cfg.bridge.trustedKids, ['fixture-k1', 'fixture-k2']);
  for (const patch of [
    { TORNEOS_DB_IDENTITY_WRITER_URL: pooler('torneos_edge_identity_writer', DATA, 'aws-0-sa-east-1.pooler.supabase.com', 6543), TORNEOS_DB_CORE_ADAPTER_URL: pooler('torneos_edge_core_adapter', DATA, 'aws-0-sa-east-1.pooler.supabase.com', 6543) },
    { TORNEOS_DB_IDENTITY_WRITER_URL: `postgres://torneos_edge_identity_writer:pw-fixture@db.${DATA}.supabase.co:5432/postgres`, TORNEOS_DB_CORE_ADAPTER_URL: `postgres://torneos_edge_core_adapter:pw-fixture@db.${DATA}.supabase.co:5432/postgres` },
    { TORNEOS_DB_IDENTITY_WRITER_URL: pooler('torneos_edge_identity_writer', DATA, 'aws-1-sa-east-1.pooler.supabase.com'), TORNEOS_DB_CORE_ADAPTER_URL: pooler('torneos_edge_core_adapter', DATA, 'aws-1-sa-east-1.pooler.supabase.com') },
    { CORE_AUTH_URL: `https://${CORE}.supabase.co/auth/v1/`, CORE_ANON_KEY: jwt({ ref: CORE, role: 'anon', iss: 'supabase' }) },
    { CORE_ANON_KEY: '', TORNEOS_ANON_KEY: '' },
  ]) assert.equal(C.loadConfig({ ...PROD_ENV, ...patch }).topology.kind, 'production', JSON.stringify(Object.keys(patch)));
  // The Core contract client accepts the certified Production URL (it was refused before G1).
  assert.equal(K.assertCoreContractUrl(`https://${CORE}.supabase.co/functions/v1/torneos-core-contract/`), `https://${CORE}.supabase.co/functions/v1/torneos-core-contract`);
  assert.ok(new K.CoreClient(PROD_ENV.CORE_CONTRACT_URL, new Uint8Array(32)));
});

test('PASS: non-production topologies are unchanged (loopback lab, fixture hosts, a non-prod hosted pair)', () => {
  assert.equal(C.loadConfig(LAB_ENV).topology.kind, 'nonproduction');
  const fixture = { ...LAB_ENV, TORNEOS_GATEWAY_PUBLIC_URL: 'https://gw.torneos-test.example.com/functions/v1/torneos-gateway', TORNEOS_ALLOWED_ORIGIN: 'https://web.torneos-test.example.com',
    CORE_AUTH_URL: 'https://core.torneos-test.example.com/auth/v1', CORE_JWT_ISSUER: 'https://core.torneos-test.example.com/auth/v1', CORE_CONTRACT_URL: 'https://core.torneos-test.example.com/functions/v1/torneos-core-contract',
    TORNEOS_REST_URL: 'https://data.torneos-test.example.com/rest/v1', TORNEOS_DB_IDENTITY_WRITER_URL: 'postgres://torneos_edge_identity_writer:pw-fixture@db.fixture.invalid:5432/postgres',
    TORNEOS_DB_CORE_ADAPTER_URL: 'postgres://torneos_edge_core_adapter:pw-fixture@db.fixture.invalid:5432/postgres' };
  assert.equal(C.loadConfig(fixture).topology.kind, 'nonproduction');
  const hosted = { ...fixture, CORE_AUTH_URL: `https://${STAGING}.supabase.co/auth/v1`, CORE_JWT_ISSUER: `https://${STAGING}.supabase.co/auth/v1`, CORE_CONTRACT_URL: `https://${STAGING}.supabase.co/functions/v1/torneos-core-contract`,
    TORNEOS_REST_URL: `https://${OTHER}.supabase.co/rest/v1`, TORNEOS_DB_IDENTITY_WRITER_URL: pooler('torneos_edge_identity_writer', OTHER, 'aws-0-us-east-1.pooler.supabase.com', 6543), TORNEOS_DB_CORE_ADAPTER_URL: pooler('torneos_edge_core_adapter', OTHER, 'aws-0-us-east-1.pooler.supabase.com', 6543) };
  assert.deepEqual(C.loadConfig(hosted).topology, { kind: 'nonproduction', coreRef: STAGING, dataRef: OTHER });
});

const FAIL = {
  // Core Production as a data backend (DB-to-DB, Torneos REST on Core).
  'Core Prod in the identity-writer postgres host': { TORNEOS_DB_IDENTITY_WRITER_URL: `postgres://torneos_edge_identity_writer:pw-fixture@db.${CORE}.supabase.co:5432/postgres` },
  'Core Prod in the adapter postgres login (pooler)': { TORNEOS_DB_CORE_ADAPTER_URL: pooler('torneos_edge_core_adapter', CORE) },
  'Core Prod postgres URL, percent-encoded login': { TORNEOS_DB_CORE_ADAPTER_URL: `postgres://torneos_edge_core_adapter%2E${CORE}:pw-fixture@aws-0-sa-east-1.pooler.supabase.com:5432/postgres` },
  'Core Prod in the postgres database/options': { TORNEOS_DB_CORE_ADAPTER_URL: `postgres://torneos_edge_core_adapter.${DATA}:pw-fixture@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?options=${CORE}` },
  'Core Prod as Torneos REST': { TORNEOS_REST_URL: `https://${CORE}.supabase.co/rest/v1` },
  'Core Staging as Torneos REST': { TORNEOS_REST_URL: `https://${STAGING}.supabase.co/rest/v1` },
  'Core Staging in a postgres URL': { TORNEOS_DB_IDENTITY_WRITER_URL: pooler('torneos_edge_identity_writer', STAGING) },
  // The Torneos data ref as Core authority.
  'Torneos ref as CORE_AUTH_URL': { CORE_AUTH_URL: `https://${DATA}.supabase.co/auth/v1` },
  'Torneos ref as CORE_JWT_ISSUER': { CORE_JWT_ISSUER: `https://${DATA}.supabase.co/auth/v1` },
  'Torneos ref as CORE_CONTRACT_URL': { CORE_CONTRACT_URL: `https://${DATA}.supabase.co/functions/v1/torneos-core-contract` },
  'Torneos ref as the whole authority plane': { CORE_AUTH_URL: `https://${DATA}.supabase.co/auth/v1`, CORE_JWT_ISSUER: `https://${DATA}.supabase.co/auth/v1`, CORE_CONTRACT_URL: `https://${DATA}.supabase.co/functions/v1/torneos-core-contract` },
  // Mixed refs.
  'authority mixed: contract on Staging': { CORE_CONTRACT_URL: `https://${STAGING}.supabase.co/functions/v1/torneos-core-contract` },
  'authority mixed: issuer on another project': { CORE_JWT_ISSUER: `https://${OTHER}.supabase.co/auth/v1` },
  'authority mixed: auth on a non-hosted host': { CORE_AUTH_URL: 'https://auth.fixture.example/auth/v1' },
  'data mixed: REST on another project': { TORNEOS_REST_URL: `https://${OTHER}.supabase.co/rest/v1` },
  'data mixed: one login on another project': { TORNEOS_DB_CORE_ADAPTER_URL: pooler('torneos_edge_core_adapter', OTHER) },
  'data mixed: login ref ≠ host ref': { TORNEOS_DB_IDENTITY_WRITER_URL: `postgres://torneos_edge_identity_writer.${DATA}:pw-fixture@db.${OTHER}.supabase.co:5432/postgres` },
  'Production half: Core Prod + non-prod data plane': { TORNEOS_REST_URL: `https://${OTHER}.supabase.co/rest/v1`, TORNEOS_DB_IDENTITY_WRITER_URL: pooler('torneos_edge_identity_writer', OTHER), TORNEOS_DB_CORE_ADAPTER_URL: pooler('torneos_edge_core_adapter', OTHER) },
  'Production half: Torneos data + non-prod Core': { CORE_AUTH_URL: `https://${OTHER}.supabase.co/auth/v1`, CORE_JWT_ISSUER: `https://${OTHER}.supabase.co/auth/v1`, CORE_CONTRACT_URL: `https://${OTHER}.supabase.co/functions/v1/torneos-core-contract` },
  'Production half: Core Prod + loopback lab data plane': { TORNEOS_REST_URL: 'http://torneos-rest:3000', TORNEOS_DB_IDENTITY_WRITER_URL: LAB_ENV.TORNEOS_DB_IDENTITY_WRITER_URL, TORNEOS_DB_CORE_ADAPTER_URL: LAB_ENV.TORNEOS_DB_CORE_ADAPTER_URL },
  'same project on both planes': { TORNEOS_REST_URL: `https://${CORE}.supabase.co/rest/v1`, TORNEOS_DB_IDENTITY_WRITER_URL: pooler('torneos_edge_identity_writer', CORE), TORNEOS_DB_CORE_ADAPTER_URL: pooler('torneos_edge_core_adapter', CORE) },
  // Non-canonical Production URLs.
  'Core Prod over plain http': { CORE_AUTH_URL: `http://${CORE}.supabase.co/auth/v1` },
  'Core Prod GoTrue path differs': { CORE_AUTH_URL: `https://${CORE}.supabase.co/auth/v2` },
  'Core Prod issuer differs from GoTrue URL': { CORE_JWT_ISSUER: `https://${CORE}.supabase.co` },
  'Core Prod contract on another function': { CORE_CONTRACT_URL: `https://${CORE}.supabase.co/functions/v1/torneos-core-contract-v2` },
  'Torneos REST path differs': { TORNEOS_REST_URL: `https://${DATA}.supabase.co/graphql/v1` },
  // Browser-facing endpoints.
  'origin: https://localhost': { TORNEOS_ALLOWED_ORIGIN: 'https://localhost' },
  'origin: capacitor://localhost': { TORNEOS_ALLOWED_ORIGIN: 'capacitor://localhost' },
  'origin: another host': { TORNEOS_ALLOWED_ORIGIN: 'https://arma2.com.ar' },
  'public URL: a Supabase Edge Function on Torneos': { TORNEOS_GATEWAY_PUBLIC_URL: `https://${DATA}.supabase.co/functions/v1/torneos-gateway` },
  'public URL: a Supabase Edge Function on Core': { TORNEOS_GATEWAY_PUBLIC_URL: `https://${CORE}.supabase.co/functions/v1/torneos-gateway` },
  // Logins.
  'login postgres': { TORNEOS_DB_IDENTITY_WRITER_URL: pooler('postgres') },
  'login service_role': { TORNEOS_DB_CORE_ADAPTER_URL: pooler('service_role') },
  'login supabase_admin (direct)': { TORNEOS_DB_CORE_ADAPTER_URL: `postgres://supabase_admin:pw-fixture@db.${DATA}.supabase.co:5432/postgres` },
  'login: the payments role': { TORNEOS_DB_CORE_ADAPTER_URL: pooler('torneos_payment_service') },
  'logins swapped': { TORNEOS_DB_IDENTITY_WRITER_URL: pooler('torneos_edge_core_adapter'), TORNEOS_DB_CORE_ADAPTER_URL: pooler('torneos_edge_identity_writer') },
  'pooler login without the project suffix': { TORNEOS_DB_IDENTITY_WRITER_URL: 'postgres://torneos_edge_identity_writer:pw-fixture@aws-0-sa-east-1.pooler.supabase.com:5432/postgres' },
  'pooler outside sa-east-1': { TORNEOS_DB_IDENTITY_WRITER_URL: pooler('torneos_edge_identity_writer', DATA, 'aws-0-us-east-1.pooler.supabase.com'), TORNEOS_DB_CORE_ADAPTER_URL: pooler('torneos_edge_core_adapter', DATA, 'aws-0-us-east-1.pooler.supabase.com') },
  'the two logins on different hosts': { TORNEOS_DB_CORE_ADAPTER_URL: `postgres://torneos_edge_core_adapter:pw-fixture@db.${DATA}.supabase.co:5432/postgres` },
  'another database': { TORNEOS_DB_CORE_ADAPTER_URL: `postgres://torneos_edge_core_adapter.${DATA}:pw-fixture@aws-0-sa-east-1.pooler.supabase.com:5432/template1` },
  // TLS, commerce, keys.
  'no verified TLS CA': { TORNEOS_DB_SSL_CA: '' },
  'commerce TEST against Core Prod': { TORNEOS_COMMERCE_MODE: 'test' },
  'CORE_ANON_KEY is a secret key': { CORE_ANON_KEY: 'sb_secret_corefixture0000000000' },
  'CORE_ANON_KEY is the Core service_role JWT': { CORE_ANON_KEY: jwt({ ref: CORE, role: 'service_role', iss: 'supabase' }) },
  'TORNEOS_ANON_KEY is a service_role JWT': { TORNEOS_ANON_KEY: jwt({ ref: DATA, role: 'service_role', iss: 'supabase' }) },
  'CORE_SERVICE_ROLE_KEY present': { CORE_SERVICE_ROLE_KEY: 'x'.repeat(40) },
  'CORE_JWT_SECRET present': { CORE_JWT_SECRET: 'x'.repeat(40) },
  'CORE_DB_URL present': { CORE_DB_URL: `postgres://postgres:pw-fixture@db.${CORE}.supabase.co:5432/postgres` },
  'a Core service_role JWT under any variable name': { SOME_HELPER_KEY: jwt({ ref: CORE, role: 'service_role', iss: 'supabase' }) },
};
test(`FAIL: ${Object.keys(FAIL).length} topology violations each disable the whole gateway (ConfigError, no value in the reason)`, () => {
  for (const [name, patch] of Object.entries(FAIL)) {
    let error = null;
    try { C.loadConfig({ ...PROD_ENV, ...patch }); } catch (e) { error = e; }
    assert.ok(error instanceof C.ConfigError, `${name}: expected ConfigError, got ${error?.constructor?.name ?? 'accepted'}`);
    for (const v of Object.values(patch)) if (typeof v === 'string' && v.length > 12) assert.ok(!error.message.includes(v), `${name}: reason carries a value`);
    assert.doesNotMatch(error.message, /pw-fixture|BEGIN/, `${name}: reason carries a secret`);
  }
  // The non-production rule set still refuses Core as a data plane.
  for (const patch of [{ TORNEOS_REST_URL: `https://${STAGING}.supabase.co/rest/v1` }, { TORNEOS_DB_CORE_ADAPTER_URL: `postgres://lab_core_adapter:pw-fixture@db.${CORE}.supabase.co:5432/postgres` }]) {
    assert.throws(() => C.loadConfig({ ...LAB_ENV, ...patch }), C.ConfigError);
  }
  for (const bad of [`https://${DATA}.supabase.co/functions/v1/torneos-core-contract`, `https://${CORE}.supabase.co/functions/v1/other`, `http://${CORE}.supabase.co/functions/v1/torneos-core-contract`]) {
    assert.throws(() => K.assertCoreContractUrl(bad), undefined, bad);
  }
});

test('boot(): Production topology with commerce TEST is refused before any connection; Production without commerce boots', async () => {
  const idx = await tree.import('torneos-gateway/index.ts');
  const stub = await import(`${tree.dir}/postgres-driver.mjs`);
  stub.calls.length = 0;
  assert.throws(() => idx.boot({ ...PROD_ENV, TORNEOS_COMMERCE_MODE: 'test' }), (e) => e instanceof C.ConfigError);
  const rt = idx.boot(PROD_ENV);
  assert.equal(rt.cfg.topology.kind, 'production');
  assert.equal(rt.commerce.mode, 'off');
  assert.equal(stub.calls.length, 0, 'boot opens no database session');
});

test('certified semantics unchanged: RS256, TTL 120, tolerance 5, iss/aud constants (no migration 0004)', async () => {
  assert.deepEqual([TOK.ISSUER, TOK.AUDIENCE, TOK.TTL], ['urn:arma2:local:identity-bridge', 'arma2-torneos-local', 120]);
  const cfg = C.loadConfig(PROD_ENV).bridge;
  const identity = { id: crypto.randomUUID(), core_user_id: crypto.randomUUID() };
  const token = await TOK.issueToken(cfg, identity, crypto.randomUUID());
  const [h, p] = token.split('.').slice(0, 2).map((x) => JSON.parse(Buffer.from(x, 'base64url').toString()));
  assert.deepEqual([h.alg, h.kid, p.exp - p.iat, p.nbf === p.iat, p.iss, p.aud], ['RS256', 'fixture-k1', 120, true, TOK.ISSUER, TOK.AUDIENCE]);
  await TOK.verifyToken(token, cfg);
  await TOK.verifyToken(token, cfg, new Date((p.exp + 4) * 1000)); // within the 5 s tolerance (jose: exp > now − 5)
  await assert.rejects(TOK.verifyToken(token, cfg, new Date((p.exp + 6) * 1000)));
  const src = await (await import('node:fs/promises')).readFile(new URL('../../supabase/functions/torneos-gateway/token.ts', import.meta.url), 'utf8');
  assert.match(src, /clockTolerance: 5,/);
});
