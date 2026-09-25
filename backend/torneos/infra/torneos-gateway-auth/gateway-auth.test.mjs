// GATEWAY/AUTH (G2) — offline unit tests of the Production gateway/auth tooling. No network, no Keychain, no Docker.
// Run: node --test backend/torneos/infra/torneos-gateway-auth/gateway-auth.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as G from './gateway-auth-contract.mjs';
import * as K from './keyring.mjs';
import { runGatewayAuth, StopError, productionGatewayEnv, validateGatewayEnvWithRealConfig, MODES, DEPLOY_SECRET_NAMES, DEPLOY_CONFIG_NAMES } from './gateway-auth.mjs';
import { makeClient } from './mgmt-gateway-auth.mjs';
import { mintBridgeToken } from './bridge-probe.mjs';
import { assertNamespace } from './keychain-gateway-auth.mjs';
import { loadGatewayTree } from './gateway-loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T = G.TORNEOS_REF;
const P = G.CORE_PROD_REF;
const ring = K.generateRing();
const pin = K.jwksPinDocument(ring.jwks, { generatedAt: '2026-09-25T00:00:00Z' });
const tree = await loadGatewayTree();
test.after(() => tree.cleanup());

test('pins: refs, topology and bridge constants equal the gateway sources (topology.ts, token.ts)', async () => {
  const topo = await tree.import('torneos-gateway/topology.ts');
  const tok = await tree.import('torneos-gateway/token.ts');
  assert.equal(topo.CORE_PRODUCTION_REF, G.CORE_PROD_REF);
  assert.equal(topo.TORNEOS_DATA_REF, G.TORNEOS_REF);
  assert.equal(topo.CORE_STAGING_REF, G.STAGING_REF);
  for (const k of Object.keys(G.GATEWAY_TOPOLOGY)) assert.equal(topo.PRODUCTION[k], G.GATEWAY_TOPOLOGY[k], k);
  assert.deepEqual([tok.ISSUER, tok.AUDIENCE, tok.TTL], [G.BRIDGE.issuer, G.BRIDGE.audience, G.BRIDGE.ttl]);
  assert.deepEqual([G.CORE_PROD_REF, G.TORNEOS_REF, G.STAGING_REF, G.OLD_REF, G.ORG_SLUG, G.WEB_ORIGIN], ['rcyuuoaqfwcembdajcss', 'onzpwnqxnvlgsevivngf', 'hhyvmhgpapyuzjgxfnqv', 'giaeztyghmhzcngskjmw', 'gwqrborhnqjdzzmpxulh', 'https://app.arma2.com.ar']);
  assert.deepEqual(G.foundationDrift(), [], 'the certified foundation tooling + pin are byte-identical');
});

test('allowlist: Core Production = two GETs; only Torneos is written; no DELETE/PUT; writes armed, in their mode, with the exact body', () => {
  const c = (method, p, body, opts) => G.classifyRequest({ method, path: p, body }, opts);
  assert.equal(c('GET', `/v1/projects/${P}`, undefined, { mode: '--certify' }).id, 'prod-project');
  assert.equal(c('GET', `/v1/projects/${P}/functions/torneos-core-contract`, undefined, { mode: '--certify' }).id, 'prod-contract-fn');
  const refused = [
    ['GET', `/v1/projects/${P}/config/auth`], ['GET', `/v1/projects/${P}/functions`], ['POST', `/v1/projects/${P}/database/query`, { query: 'select 1', read_only: true }],
    ['PATCH', `/v1/projects/${P}/config/auth`, G.AUTH_LOCKDOWN_BODY], ['POST', `/v1/projects/${P}/config/auth/third-party-auth`, G.customJwksBody(pin)],
    ['GET', `/v1/projects/${G.STAGING_REF}/functions`], ['POST', `/v1/projects/${G.STAGING_REF}/database/query`, { query: 'select 1', read_only: true }], ['POST', `/v1/projects/${G.STAGING_REF}/pause`],
    ['DELETE', `/v1/projects/${T}/config/auth/third-party-auth/x`], ['PUT', `/v1/projects/${T}/config/auth`, {}], ['POST', `/v1/projects/${T}/functions/deploy?slug=torneos-gateway`, {}],
    ['POST', `/v1/projects/${T}/secrets`, []], ['POST', '/v1/projects', {}], ['POST', `/v1/projects/${T}/database/query`, { query: 'create role x', read_only: true }],
    ['POST', `/v1/projects/${T}/database/query`, { query: 'select 1', read_only: false }], ['GET', `/v1/projects/zzzzzzzzzzzzzzzzzzzz`], ['GET', `/v1/projects/${T}/api-keys?reveal=true`],
  ];
  for (const [m, p, b] of refused) for (const mode of Object.keys(MODES)) assert.throws(() => c(m, p, b, { mode, armedFor: 'auth-lockdown', jwksPin: pin }), undefined, `${mode} ${m} ${p}`);
  // Writes: only armed, only in their own mode, only the exact body.
  assert.equal(c('PATCH', `/v1/projects/${T}/config/auth`, { ...G.AUTH_LOCKDOWN_BODY }, { mode: '--auth-lockdown', armedFor: 'auth-lockdown' }).kind, 'write:auth-lockdown');
  assert.throws(() => c('PATCH', `/v1/projects/${T}/config/auth`, { ...G.AUTH_LOCKDOWN_BODY }, { mode: '--auth-lockdown' }), /not_armed/);
  assert.throws(() => c('PATCH', `/v1/projects/${T}/config/auth`, { ...G.AUTH_LOCKDOWN_BODY }, { mode: '--b03', armedFor: 'auth-lockdown' }), /not_in_mode/);
  for (const bad of [{ ...G.AUTH_LOCKDOWN_BODY, disable_signup: false }, { ...G.AUTH_LOCKDOWN_BODY, external_google_enabled: true }, { ...G.AUTH_LOCKDOWN_BODY, site_url: 'https://localhost' }, { disable_signup: true }]) {
    assert.throws(() => c('PATCH', `/v1/projects/${T}/config/auth`, bad, { mode: '--auth-lockdown', armedFor: 'auth-lockdown' }), /auth_body/);
  }
  assert.equal(c('POST', `/v1/projects/${T}/config/auth/third-party-auth`, G.customJwksBody(pin), { mode: '--b03', armedFor: 'b03', jwksPin: pin }).kind, 'write:b03');
  const withD = G.customJwksBody(pin); withD.custom_jwks.keys[0].d = 'x';
  for (const bad of [withD, { custom_jwks: { keys: [pin.keys[0]] } }, { ...G.customJwksBody(pin), oidc_issuer_url: 'https://x' }, { custom_jwks: { keys: [...pin.keys].reverse() } }]) {
    assert.throws(() => c('POST', `/v1/projects/${T}/config/auth/third-party-auth`, bad, { mode: '--b03', armedFor: 'b03', jwksPin: pin }));
  }
  assert.throws(() => c('POST', `/v1/projects/${T}/config/auth/third-party-auth`, G.customJwksBody(pin), { mode: '--b03', armedFor: 'b03', jwksPin: null }), 'no pin → no B03');
});

test('scoped PAT per mode: read-only modes carry no Read-write; W1 = Auth Config RW + Project Settings RW; W5 = Auth Config RW', () => {
  const rw = (m) => G.patRequirement(m).permissions.filter((p) => p.endsWith('Read-write'));
  for (const m of ['--preflight', '--db-bootstrap', '--keyring-generate', '--deploy-preflight', '--certify']) assert.deepEqual(rw(m), [], m);
  assert.deepEqual(rw('--auth-lockdown'), ['Auth Config: Read-write', 'Project Settings: Read-write']);
  assert.deepEqual(rw('--b03'), ['Auth Config: Read-write']);
  assert.deepEqual(G.patRequirement('--auth-lockdown').api_writes, ['auth-lockdown']);
  assert.deepEqual(G.patRequirement('--b03').api_writes, ['tpa-create']);
  assert.deepEqual(G.patRequirement('--db-bootstrap').api_writes, []);
  assert.equal(G.patRequirement('--db-bootstrap').other_writes, 'psql');
  assert.match(G.patRequirementText('--certify'), /resource access: Organization gwqrborhnqjdzzmpxulh/);
});

test('W1: the lockdown body is exactly the five keys; state classification; other sign-in paths must already be off', () => {
  assert.deepEqual(G.AUTH_LOCKDOWN_BODY, { disable_signup: true, external_email_enabled: false, external_phone_enabled: false, external_anonymous_users_enabled: false, site_url: 'https://app.arma2.com.ar' });
  assert.equal(G.authState({ site_url: 'http://localhost:3000', disable_signup: false, external_email_enabled: true }).state, 'pending');
  assert.equal(G.authState({ ...G.AUTH_LOCKDOWN_BODY }).state, 'applied');
  assert.deepEqual(G.authState({ ...G.AUTH_LOCKDOWN_BODY, external_google_enabled: true, saml_enabled: true }).problems, ['AUTH_EXTERNAL_GOOGLE_ENABLED_ON', 'AUTH_SAML_ENABLED_ON']);
});

test('W2+W3: one transaction, guard first, exactly 2 NOINHERIT logins + 2 GRANTs + pre_request; SCRAM only (RFC 7677 vector)', () => {
  // RFC 7677 §3 example (user "user", password "pencil"): the derived keys reproduce ClientProof and ServerSignature.
  const { clientKey, storedKey, serverKey } = G.scramKeys('pencil', Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64'), 4096);
  const am = 'n=user,r=rOprNGfwEbeRWgbNEkqO,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
  const sig = crypto.createHmac('sha256', storedKey).update(am).digest();
  assert.equal(Buffer.from(clientKey.map((b, i) => b ^ sig[i])).toString('base64'), 'dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=');
  assert.equal(crypto.createHmac('sha256', serverKey).update(am).digest('base64'), '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
  const pw = crypto.randomBytes(30).toString('base64url');
  const v = G.scramVerifier(pw);
  assert.match(v, G.SCRAM_PATTERN);
  assert.throws(() => G.scramVerifier('short'), /password_shape/);
  const sql = G.renderBootstrapSql({ torneos_edge_identity_writer: v, torneos_edge_core_adapter: G.scramVerifier(crypto.randomBytes(30).toString('base64url')) });
  assert.ok(!sql.includes(pw), 'the plaintext password never enters the SQL');
  const stmts = sql.trim().split('\n');
  assert.equal(stmts[0], 'BEGIN;'); assert.equal(stmts.at(-1), 'COMMIT;');
  assert.match(stmts[2], /GATEWAY_LOGINS_ALREADY_PRESENT/);
  assert.equal(stmts.filter((s) => /^CREATE ROLE torneos_edge_(identity_writer|core_adapter) LOGIN NOINHERIT PASSWORD 'SCRAM-SHA-256\$/.test(s)).length, 2);
  assert.deepEqual(stmts.filter((s) => s.startsWith('GRANT')), ['GRANT torneos_identity_writer TO torneos_edge_identity_writer;', 'GRANT torneos_core_adapter TO torneos_edge_core_adapter;']);
  assert.deepEqual(stmts.filter((s) => s.startsWith('ALTER')), ["ALTER ROLE authenticator SET pgrst.db_pre_request = 'private.check_token';"]);
  assert.ok(!/payment|service_role|SUPERUSER|BYPASSRLS|CREATEROLE|CREATEDB|DROP|DELETE|TRUNCATE/i.test(sql.replace(/PASSWORD '[^']+'/g, '')), 'nothing else');
  assert.throws(() => G.renderBootstrapSql({ torneos_edge_identity_writer: 'plain', torneos_edge_core_adapter: v }), /verifier_shape/);
  assert.throws(() => G.renderBootstrapSql({ torneos_edge_identity_writer: v, torneos_edge_core_adapter: v, torneos_payment_login: v }), /verifier_keys/);
  assert.ok(!G.BOOTSTRAP_SQL_TEMPLATE.includes('SCRAM-SHA-256$'), 'the printable template masks the verifiers');
});

test('delta pin (derived by the rehearsal): tied to this foundation + SQL; exactly the 2 logins; invariants hold on it', () => {
  const delta = JSON.parse(fs.readFileSync(G.DELTA_PIN_FILE, 'utf8'));
  assert.equal(delta.foundation_pin_sha256, G.FOUNDATION_FILES['backend/torneos/infra/torneos-foundation/pins/expected-catalog.json']);
  assert.equal(delta.bootstrap_sql_template_sha256, G.sha256(G.BOOTSTRAP_SQL_TEMPLATE));
  assert.equal(delta.catalog_sql_sha256, G.sha256(G.CATALOG_SQL));
  assert.equal(delta.gateway_roles_sql_sha256, G.sha256(G.GATEWAY_ROLES_SQL));
  assert.deepEqual(Object.keys(delta.catalog).sort(), [...G.DELTA_PATHS].sort());
  assert.equal(delta.catalog.login_roles_torneos, 2);
  assert.deepEqual(delta.catalog.authenticator_pre_request, ['pgrst.db_pre_request=private.check_token']);
  assert.deepEqual(delta.roles.logins.map((l) => [l.name, l.login, l.inherit, l.super, l.bypassrls]), [['torneos_edge_core_adapter', true, false, false, false], ['torneos_edge_identity_writer', true, false, false, false]]);
  for (const { login, memberOf } of G.EDGE_LOGINS) assert.deepEqual(delta.roles.memberships.filter((m) => m.member === login).map((m) => [m.role, m.admin, m.set]), [[memberOf, false, true]]);
  const foundation = JSON.parse(fs.readFileSync(G.FOUNDATION_PIN_FILE, 'utf8'));
  const catalog = { ...foundation.catalog, ...delta.catalog };
  const roles = { ...delta.roles, payment_logins: 0, login_member_of_api_role: 0, authenticator_config: ['pgrst.db_pre_request=private.check_token'], auth_users: 0 };
  assert.deepEqual(G.gatewayInvariantFailures(catalog, roles), []);
  assert.equal(G.dbState(catalog, roles, foundation, delta).state, 'applied');
  assert.equal(G.dbState(foundation.catalog, { logins: [], memberships: [] }, foundation, delta).state, 'pending');
  const tampered = { ...catalog, role_members: [...catalog.role_members, { role: 'torneos_payment_service', member: 'torneos_edge_core_adapter' }] };
  assert.equal(G.dbState(tampered, roles, foundation, delta).state, 'foreign');
  assert.deepEqual(G.gatewayInvariantFailures(catalog, { ...roles, payment_logins: 1 }), ['payment_login_present']);
  assert.ok(G.gatewayInvariantFailures({ ...catalog, authenticator_pre_request: [] }, roles).includes('pre_request_not_check_token'));
  assert.ok(G.gatewayInvariantFailures(catalog, { ...roles, logins: roles.logins.map((l) => ({ ...l, inherit: true })) }).some((x) => x.startsWith('login_inherit_')));
});

test('ring: fresh k1/k2, Production kids from thumbprints, public JWKS only, custody lines < 100 chars (getpass 128), custody ≡ pin', () => {
  assert.deepEqual(ring.slots.map((s) => s.slot), ['k1', 'k2']);
  for (const s of ring.slots) { assert.match(s.kid, G.KID_PATTERN); assert.ok(s.kid.endsWith(K.thumbprint(s.publicJwk).slice(0, 16))); }
  assert.notEqual(ring.slots[0].publicJwk.n, ring.slots[1].publicJwk.n);
  assert.ok(pin.keys.every((k) => Object.keys(k).sort().join(',') === 'alg,e,kid,kty,n,use'), 'no private member in the pin');
  assert.equal(pin.active, ring.slots[0].kid); assert.equal(pin.standby, ring.slots[1].kid);
  for (const bad of ['p3b-k1', 't-k1', 'r3-fixture', 'arma2-torneos-prod-k3-aaaaaaaaaaaaaaaa', 'arma2-torneos-prod-k1-short']) assert.throws(() => K.assertProductionKid(bad, 'k1'), undefined, bad);
  const { parts, meta } = K.splitParts(ring.slots[0].pkcs8, ring.slots[0].kid);
  assert.ok(parts.every((x) => x.length <= 100) && meta.length < 100 && parts.length >= 2 && parts.length <= K.MAX_PARTS, `${parts.length} parts, meta ${meta.length}`);
  assert.equal(K.joinParts(meta, parts, ring.slots[0].kid), ring.slots[0].pkcs8);
  assert.throws(() => K.joinParts(meta, parts, ring.slots[1].kid), /custody_kid_differs_from_pin/);
  assert.throws(() => K.joinParts(meta, [...parts.slice(0, -1), parts.at(-1).slice(1)], ring.slots[0].kid), /digest/);
  assert.throws(() => K.joinParts(meta, parts.slice(1), ring.slots[0].kid), /parts/);
  const back = K.publicFromPkcs8(ring.slots[1].pkcs8, ring.slots[1].kid);
  assert.equal(back.n, pin.keys[1].n);
  assert.equal(K.jwksDigest(pin), K.jwksDigest(G.customJwksBody(pin).custom_jwks));
});

test('ring → gateway: k1 private + k2 PUBLIC only, trusted [k1, k2]; the real gateway accepts it; k2 tokens verify (rotation-ready)', async () => {
  const doc = K.gatewayRingDocument({ k1Pkcs8: ring.slots[0].pkcs8, jwksPin: pin });
  assert.equal(doc.activeKid, pin.active);
  assert.deepEqual(doc.trustedKids, [pin.active, pin.standby]);
  assert.ok(doc.keys[0].privateKey.includes('BEGIN PRIVATE KEY') && !('privateKey' in doc.keys[1]));
  assert.throws(() => K.gatewayRingDocument({ k1Pkcs8: ring.slots[1].pkcs8, jwksPin: pin }), /custody_k1_differs_from_pin/);
  const cfg = await tree.import('torneos-gateway/config.ts');
  const tok = await tree.import('torneos-gateway/token.ts');
  const bridge = cfg.parseBridgeKeys(JSON.stringify(doc));
  const identity = { id: crypto.randomUUID(), core_user_id: crypto.randomUUID() };
  const issued = await tok.issueToken(bridge, identity, crypto.randomUUID());
  assert.equal(JSON.parse(Buffer.from(issued.split('.')[0], 'base64url').toString()).kid, pin.active);
  await tok.verifyToken(issued, bridge);
  await tok.verifyToken(mintBridgeToken({ pkcs8: ring.slots[1].pkcs8, kid: pin.standby, overrides: { sub: identity.id, core_user_id: identity.core_user_id } }), bridge);
  const plan = K.rotationPlan(pin);
  const post = plan.findIndex((s) => /POST third-party-auth/.test(s.action));
  assert.ok(post > 0 && /FIRST/.test(plan[post].action) && /then DELETE/.test(plan[post].action), 'new integration before the old one is removed');
  assert.match(plan[1].action, /125 s/);
});

test('--deploy-preflight env: pins + placeholders → the REAL config.ts boots it as topology=production, commerce off, the pinned ring', async () => {
  const env = productionGatewayEnv({ publicUrl: 'https://torneos-gateway.fixture.example/functions/v1/torneos-gateway', poolerHost: 'aws-0-sa-east-1.pooler.supabase.com', jwksPin: pin, k1Pkcs8: ring.slots[0].pkcs8, torneosAnonKey: 'sb_publishable_fixture000000000000', caPem: '-----BEGIN CERTIFICATE-----\nZml4dHVyZQ==\n-----END CERTIFICATE-----' });
  assert.deepEqual([...Object.keys(env), 'CORE_ANON_KEY'].sort(), [...DEPLOY_SECRET_NAMES, ...DEPLOY_CONFIG_NAMES].sort());
  const v = await validateGatewayEnvWithRealConfig(env);
  assert.deepEqual([v.topology.kind, v.commerce, v.activeKid, v.allowedOrigin], ['production', 'off', pin.active, 'https://app.arma2.com.ar']);
  assert.deepEqual(v.trustedKids, [pin.active, pin.standby]);
  await assert.rejects(validateGatewayEnvWithRealConfig({ ...env, TORNEOS_REST_URL: `https://${P}.supabase.co/rest/v1` }));
  await assert.rejects(validateGatewayEnvWithRealConfig({ ...env, TORNEOS_GATEWAY_PUBLIC_URL: `https://${T}.supabase.co/functions/v1/torneos-gateway` }));
  assert.ok(Object.values(G.GATEWAY_DEPLOY_DECISIONS).every((x) => x === null), 'deploy decisions are pending, not guessed');
});

test('custody namespaces: exclusive, allowlisted accounts, disjoint from every nonprod / Core entry; the helper refuses the rest', () => {
  for (const [s, a] of [[G.KEYCHAIN_GATEWAY_DB_SERVICE, 'torneos_edge_identity_writer'], [G.KEYCHAIN_BRIDGE_SERVICE, 'k1.meta'], [G.KEYCHAIN_BRIDGE_SERVICE, 'k2.part19'], [G.KEYCHAIN_DATAPLANE_DB.service, 'postgres']]) assert.doesNotThrow(() => assertNamespace(s, a));
  for (const [s, a] of [['arma2-torneos-nonprod-bridge', 'keys'], ['arma2-torneos-prod-core-contract', 'contract-secret'], [G.KEYCHAIN_GATEWAY_DB_SERVICE, 'postgres'], [G.KEYCHAIN_BRIDGE_SERVICE, 'k3.meta'], [G.KEYCHAIN_BRIDGE_SERVICE, 'keys'], [G.KEYCHAIN_BRIDGE_SERVICE, 'k1.part20']]) assert.throws(() => assertNamespace(s, a), undefined, `${s}/${a}`);
  for (const ns of [G.KEYCHAIN_GATEWAY_DB_SERVICE, G.KEYCHAIN_BRIDGE_SERVICE]) assert.ok(!G.FORBIDDEN_KEYCHAIN_SERVICES.includes(ns) && !/nonprod|staging/.test(ns));
  const py = path.join(HERE, 'keychain-gateway-auth.py');
  for (const args of [['check', 'arma2-torneos-nonprod-bridge', 'keys'], ['generate', G.KEYCHAIN_BRIDGE_SERVICE, 'k1.meta'], ['store', G.KEYCHAIN_GATEWAY_DB_SERVICE, 'torneos_edge_identity_writer'], ['delete', G.KEYCHAIN_BRIDGE_SERVICE, 'k1.meta'], ['generate', G.KEYCHAIN_GATEWAY_DB_SERVICE, 'postgres']]) {
    const r = spawnSync('python3', [py, ...args], { encoding: 'utf8', input: '' });
    assert.equal(r.status, 2, args.join(' '));
  }
  const src = fs.readFileSync(py, 'utf8');
  assert.ok(!/delete-generic-password|"-U"|'-U'/.test(src), 'no delete, no silent overwrite');
});

test('secret scanning covers SCRAM verifiers, private JWK members, publishable keys, PEM, DB URLs, PATs', () => {
  const samples = [G.scramVerifier(crypto.randomBytes(30).toString('base64url')), `{"d": "${'A'.repeat(60)}"}`, 'sb_publishable_abcdefghijklmnop', '-----BEGIN PRIVATE KEY-----', 'postgres://torneos_edge_core_adapter:secretpw@host/db', `sbp_${'a'.repeat(40)}`];
  for (const s of samples) assert.ok(G.secretFindings(s).length, s.slice(0, 30));
  assert.deepEqual(G.secretFindings(JSON.stringify(pin)), [], 'the public pin is clean');
  assert.deepEqual(G.secretFindings(G.BOOTSTRAP_SQL_TEMPLATE), [], 'the printable SQL template is clean');
});

test('runner entry: only {"pat"}; unknown mode refused; a mode can arm only its own write', async () => {
  const deps = { say: () => {}, now: () => Date.now() };
  await assert.rejects(runGatewayAuth({ mode: '--delete', request: { pat: `sbp_${'a'.repeat(40)}` }, deps }), (e) => e instanceof StopError && e.code === 'USAGE');
  await assert.rejects(runGatewayAuth({ mode: '--certify', request: { pat: `sbp_${'a'.repeat(40)}`, ref: T }, deps }), (e) => e.code === 'REQUEST_REFUSED');
  await assert.rejects(runGatewayAuth({ mode: '--certify', request: { pat: 'nope' }, deps }), (e) => e.code === 'PAT_MALFORMED');
  const client = makeClient({ transport: async () => { throw new Error('must not be reached'); }, pat: 'x', mode: '--certify' });
  await assert.rejects(client.authLockdown(), /endpoint_not_in_mode/);
  await assert.rejects(client.createThirdPartyAuth(G.customJwksBody(pin)), /endpoint_not_in_mode/);
  const lock = makeClient({ transport: async () => { throw new Error('must not be reached'); }, pat: 'x', mode: '--auth-lockdown', armedFor: () => null });
  await assert.rejects(lock.authLockdown(), /not_armed/);
});

test('G2 isolation: the new tooling never uses phase3b/remote, never deploys a function, never writes secrets, no DELETE', () => {
  for (const f of fs.readdirSync(HERE).filter((x) => /\.(mjs|sh|py)$/.test(x) && !x.endsWith('.test.mjs') && x !== 'offline-rehearsal.mjs')) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|#|\*)/.test(l)).join('\n');
    assert.doesNotMatch(src, /phase3b\/remote|functions\/deploy|\/secrets['"`]?\s*,\s*\{|method:\s*'DELETE'|'DELETE'|hhyvmhgpapyuzjgxfnqv\/(pause|database|functions|secrets|config)/, f);
    assert.doesNotMatch(src, /["'`]arma2-torneos-(nonprod|staging)|phase3b\/remote\/keychain\.py/, f); // used as a value (docstrings may name what is excluded)
  }
});

test('wrapper: refuses force flags, extra args and a non-terminal', () => {
  const sh = path.join(HERE, 'run-gateway-auth.sh');
  for (const args of [['--force'], ['-y'], ['--b03', '--yes'], [], ['--delete'], ['--deploy']]) {
    const r = spawnSync('bash', [sh, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.notEqual(r.status, 0); assert.match(r.stderr, /GATEWAY_AUTH_(USAGE|REFUSED)/);
  }
  const r = spawnSync('bash', [sh, '--preflight'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input: '' });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /GATEWAY_AUTH_(BLOCKED_NO_TTY|REFUSED_NON_INTERACTIVE)/);
});
