// GATEWAY/AUTH (G2) — offline unit tests of the Production gateway/auth tooling. No network, no Keychain, no Docker.
// Run: node --test backend/torneos/infra/torneos-gateway-auth/gateway-auth.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
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

// The must-off flags exactly as measured on Torneos Auth, 2026-09-25 (ga-02-auth-lockdown-supplement-pre-20260925T204557Z.json,
// sha256 2e112b74…): 38 flags, mfa_totp_enroll_enabled the only one on.
const W1_MEASURED_MUST_OFF = Object.freeze({
  custom_oauth_enabled: false, external_apple_enabled: false, external_azure_enabled: false, external_bitbucket_enabled: false,
  external_discord_enabled: false, external_facebook_enabled: false, external_figma_enabled: false, external_github_enabled: false,
  external_gitlab_enabled: false, external_google_enabled: false, external_kakao_enabled: false, external_keycloak_enabled: false,
  external_linkedin_oidc_enabled: false, external_notion_enabled: false, external_slack_enabled: false, external_slack_oidc_enabled: false,
  external_spotify_enabled: false, external_twitch_enabled: false, external_twitter_enabled: false, external_web3_ethereum_enabled: false,
  external_web3_solana_enabled: false, external_workos_enabled: false, external_x_enabled: false, external_zoom_enabled: false,
  hook_after_user_created_enabled: false, hook_before_user_created_enabled: false, hook_custom_access_token_enabled: false,
  hook_mfa_verification_attempt_enabled: false, hook_password_verification_attempt_enabled: false, hook_send_email_enabled: false,
  hook_send_sms_enabled: false, mfa_phone_enroll_enabled: false, mfa_totp_enroll_enabled: true, mfa_web_authn_enroll_enabled: false,
  oauth_server_enabled: false, passkey_enabled: false, saml_enabled: false, security_manual_linking_enabled: false,
});
/** A hosted-shaped Auth answer as of that pre-check: prior lockdown keys, the measured flags, and fields W1 never touches. */
const hostedAuthConfig = () => ({ ...W1_MEASURED_MUST_OFF, site_url: 'http://localhost:3000', disable_signup: false, external_email_enabled: true, external_phone_enabled: false,
  external_anonymous_users_enabled: false, uri_allow_list: '', jwt_exp: 3600, mailer_autoconfirm: false, sms_autoconfirm: false, mfa_totp_verify_enabled: true, mfa_max_enrolled_factors: 10,
  rate_limit_email_sent: 2, smtp_pass: null, external_google_secret: 'fixture-secret-never-projected', hook_send_email_secrets: null });

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

test('allowlist: Core Production = two GETs; only Torneos is written; no PUT, no DELETE but the pinned superseded B03; writes armed, in their mode, with the exact body', () => {
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
  const { mfa_totp_enroll_enabled: _mfa, ...fiveKeys } = G.AUTH_LOCKDOWN_BODY;
  for (const bad of [{ ...G.AUTH_LOCKDOWN_BODY, disable_signup: false }, { ...G.AUTH_LOCKDOWN_BODY, external_google_enabled: true }, { ...G.AUTH_LOCKDOWN_BODY, site_url: 'https://localhost' }, { disable_signup: true },
    { ...G.AUTH_LOCKDOWN_BODY, mfa_totp_enroll_enabled: true }, fiveKeys, { ...G.AUTH_LOCKDOWN_BODY, passkey_enabled: false }]) {
    assert.throws(() => c('PATCH', `/v1/projects/${T}/config/auth`, bad, { mode: '--auth-lockdown', armedFor: 'auth-lockdown' }), /auth_body/);
  }
  // B03 = jwks_url (2026-09-26): the body is exactly {jwks_url}; inline custom_jwks is never published again (b03-jwks-url.test.mjs).
  assert.equal(c('POST', `/v1/projects/${T}/config/auth/third-party-auth`, G.jwksUrlBody(), { mode: '--b03', armedFor: 'b03', jwksPin: pin }).kind, 'write:b03');
  for (const bad of [G.customJwksBody(pin), { ...G.jwksUrlBody(), oidc_issuer_url: 'https://x' }, { jwks_url: 'https://attacker.invalid/jwks.json' }]) {
    assert.throws(() => c('POST', `/v1/projects/${T}/config/auth/third-party-auth`, bad, { mode: '--b03', armedFor: 'b03', jwksPin: pin }));
  }
  assert.throws(() => c('POST', `/v1/projects/${T}/config/auth/third-party-auth`, G.jwksUrlBody(), { mode: '--b03', armedFor: 'b03', jwksPin: null }), 'no pin → no B03');
});

test('scoped PAT per mode: read-only modes carry no Read-write; W1 = Auth Config RW + Project Settings RW; W5 = Auth Config RW', () => {
  const rw = (m) => G.patRequirement(m).permissions.filter((p) => p.endsWith('Read-write'));
  for (const m of ['--preflight', '--db-bootstrap', '--keyring-generate', '--deploy-preflight', '--certify']) assert.deepEqual(rw(m), [], m);
  assert.deepEqual(rw('--auth-lockdown'), ['Auth Config: Read-write', 'Project Settings: Read-write']);
  assert.deepEqual(rw('--b03'), ['Auth Config: Read-write']);
  assert.deepEqual(G.patRequirement('--auth-lockdown').api_writes, ['auth-lockdown']);
  assert.deepEqual(G.patRequirement('--b03').api_writes, ['tpa-delete', 'tpa-create']);
  assert.deepEqual(G.patRequirement('--db-bootstrap').api_writes, []);
  assert.equal(G.patRequirement('--db-bootstrap').other_writes, 'psql');
  assert.match(G.patRequirementText('--certify'), /resource access: Organization gwqrborhnqjdzzmpxulh/);
});

test('W1: the lockdown body is exactly the six keys (mfa_totp_enroll_enabled included); state classification; every other sign-in path is a check only', () => {
  assert.deepEqual(G.AUTH_LOCKDOWN_BODY, { disable_signup: true, external_email_enabled: false, external_phone_enabled: false, external_anonymous_users_enabled: false, site_url: 'https://app.arma2.com.ar', mfa_totp_enroll_enabled: false });
  assert.equal(Object.keys(G.AUTH_LOCKDOWN_BODY).length, 6);
  const cfg = hostedAuthConfig();
  assert.deepEqual(G.authState(cfg), { state: 'pending', problems: [], differs: ['disable_signup', 'external_email_enabled', 'site_url', 'mfa_totp_enroll_enabled'] });
  assert.equal(G.authState({ ...cfg, ...G.AUTH_LOCKDOWN_BODY }).state, 'applied');
  assert.equal(G.authState({ ...cfg, ...G.AUTH_LOCKDOWN_BODY, mfa_totp_enroll_enabled: true }).state, 'pending');
  // The 37 must-off flags the 2026-09-25 pre-check measured (38 minus mfa_totp_enroll_enabled, now in the body): checks only.
  const mustOff = G.authMustOffKeys(cfg);
  assert.equal(mustOff.length, 37);
  assert.deepEqual(mustOff, Object.keys(W1_MEASURED_MUST_OFF).filter((k) => k !== 'mfa_totp_enroll_enabled').sort());
  for (const k of mustOff) assert.ok(!(k in G.AUTH_LOCKDOWN_BODY), k);
  assert.deepEqual(G.authState({ ...cfg, external_google_enabled: true, saml_enabled: true }).problems, ['AUTH_EXTERNAL_GOOGLE_ENABLED_ON', 'AUTH_SAML_ENABLED_ON']);
  assert.deepEqual(G.authState({ ...cfg, passkey_enabled: true, hook_send_sms_enabled: true, external_zoom_enabled: true }).problems, ['AUTH_EXTERNAL_ZOOM_ENABLED_ON', 'AUTH_HOOK_SEND_SMS_ENABLED_ON', 'AUTH_PASSKEY_ENABLED_ON']);
  const { oauth_server_enabled: _gone, ...withoutOne } = cfg;
  assert.deepEqual(G.authState(withoutOne).problems, ['AUTH_OAUTH_SERVER_ENABLED_NOT_FALSE'], 'a named must-off flag missing from the answer is not off');
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

test('G2 isolation: the new tooling never uses phase3b/remote, never deploys a function, never writes secrets; the only DELETE is the pinned superseded B03', () => {
  const DELETE_SITES = { 'gateway-auth-contract.mjs': 2, 'mgmt-gateway-auth.mjs': 1 };
  for (const f of fs.readdirSync(HERE).filter((x) => /\.(mjs|sh|py)$/.test(x) && !x.endsWith('.test.mjs') && x !== 'offline-rehearsal.mjs')) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|#|\*)/.test(l)).join('\n');
    assert.doesNotMatch(src, /phase3b\/remote|functions\/deploy|\/secrets['"`]?\s*,\s*\{|hhyvmhgpapyuzjgxfnqv\/(pause|database|functions|secrets|config)/, f);
    assert.equal((src.match(/'DELETE'/g) ?? []).length, DELETE_SITES[f] ?? 0, `${f}: DELETE sites`);
    assert.doesNotMatch(src, /["'`]arma2-torneos-(nonprod|staging)|phase3b\/remote\/keychain\.py/, f); // used as a value (docstrings may name what is excluded)
  }
  const del = G.ENDPOINTS.filter((e) => e.method === 'DELETE');
  assert.deepEqual(del.map((e) => e.id), ['tpa-delete']);
  assert.ok(del[0].re.test(`/v1/projects/${T}/config/auth/third-party-auth/${G.B03_SUPERSEDED_INLINE_ID}`));
  for (const p of [`/v1/projects/${T}/config/auth/third-party-auth/${crypto.randomUUID()}`, `/v1/projects/${T}/config/auth/third-party-auth/${G.B03_SUPERSEDED_INLINE_ID}x`, `/v1/projects/${T}/config/auth/third-party-auth`]) assert.ok(!del[0].re.test(p), p);
  assert.match(fs.readFileSync(path.join(HERE, 'mgmt-gateway-auth.mjs'), 'utf8'), /call\('DELETE', `\/v1\/projects\/\$\{T\}\/config\/auth\/third-party-auth\/\$\{G\.B03_SUPERSEDED_INLINE_ID\}`\)/);
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

// ─────────────── W1 runner, end to end against an emulated Management API + GoTrue (no network) ───────────────
const FOUNDATION_PIN = JSON.parse(fs.readFileSync(G.FOUNDATION_PIN_FILE, 'utf8'));
function w1World({ auth = hostedAuthConfig(), onPatch = null, gotrue = null } = {}) {
  const w = { auth, tpa: [], functions: [], users: 0, patches: [], gotrueCalls: [] };
  const PAT = `sbp_${'c'.repeat(40)}`;
  const PUB = `sb_publishable_${'p'.repeat(24)}`;
  const proj = (ref, name, status, region) => ({ ref, id: ref, name, organization_slug: G.ORG_SLUG, region, status });
  const projects = [proj(G.CORE_PROD_REF, 'core', 'ACTIVE_HEALTHY', 'sa-east-1'), proj(G.STAGING_REF, 'staging', 'INACTIVE', 'us-east-1'), proj(G.OLD_REF, 'old', 'INACTIVE', 'us-west-2'), proj(T, G.PROJECT_NAME, 'ACTIVE_HEALTHY', 'sa-east-1')];
  const roles = { logins: [], memberships: [], payment_logins: 0, login_member_of_api_role: 0, authenticator_config: [], installer: {}, edge_login_can_set_role: {} };
  const transport = async ({ pat, method, path: p, body }) => {
    assert.equal(pat, PAT);
    const cls = G.classifyRequest({ method, path: p, body }, { mode: '--auth-lockdown', armedFor: method === 'PATCH' ? 'auth-lockdown' : null });
    const r = (status, b) => ({ status, body: b });
    switch (cls.id) {
      case 'org': return r(200, { slug: G.ORG_SLUG, plan: 'free' });
      case 'projects': return r(200, projects);
      case 'prod-project': return r(200, projects[0]);
      case 'prod-contract-fn': return r(200, { slug: G.CORE_CONTRACT_SLUG, status: 'ACTIVE', verify_jwt: false, ezbr_sha256: G.CORE_CONTRACT_EZBR });
      case 'project': return r(200, projects.find((x) => x.ref === cls.ref));
      case 'functions': return r(200, w.functions);
      case 'auth-config': return r(200, { ...w.auth });
      case 'third-party-auth': return r(200, w.tpa);
      case 'api-keys': return r(200, [{ name: 'default', type: 'publishable', api_key: PUB }]);
      case 'query': return r(201, [{ json_build_object: body.query === G.CATALOG_SQL ? FOUNDATION_PIN.catalog : { ...roles, auth_users: w.users } }]);
      case 'auth-lockdown': w.patches.push(body); Object.assign(w.auth, body); if (onPatch) onPatch(w); return r(200, { ...w.auth });
      default: throw new Error(`unexpected ${cls.id}`);
    }
  };
  const authProbeTransport = async ({ ref, method, path: p, headers, body }) => {
    assert.equal(ref, T); assert.equal(headers.apikey, PUB);
    w.gotrueCalls.push(`${method} ${p}`);
    if (gotrue) return gotrue({ method, path: p, body, w });
    if (p === '/auth/v1/settings') return { status: 200, body: { disable_signup: w.auth.disable_signup, external: { email: w.auth.external_email_enabled, phone: w.auth.external_phone_enabled, anonymous_users: w.auth.external_anonymous_users_enabled } } };
    return { status: 422, body: { error_code: p.endsWith('/otp') ? 'otp_disabled' : 'signup_disabled' } };
  };
  const said = [];
  const evidenceDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ga-w1-'));
  const keychain = { dbLogin: () => ({ check: () => 'ABSENT' }), dataplane: { check: () => 'PRESENT' }, ring: { check: () => 'ABSENT' } };
  const deps = { transport, authProbeTransport, keychain, now: () => Date.parse('2026-09-25T21:00:00Z'), say: (x) => said.push(x), evidenceDir,
    jwksPinFile: path.join(evidenceDir, 'no-jwks-pin.json'),
    tty: { readLine: () => { const m = /To proceed type exactly:\n {2}(.+)\n/.exec(said.join('\n')); return m ? m[1] : ''; } } };
  const run = () => runGatewayAuth({ mode: '--auth-lockdown', request: { pat: PAT }, deps });
  const evidence = () => fs.readdirSync(evidenceDir).filter((f) => f.startsWith('ga-02')).map((f) => { const text = fs.readFileSync(path.join(evidenceDir, f), 'utf8'); return { f, text, j: JSON.parse(text) }; });
  return { w, run, said, evidence, PAT, PUB };
}

test('W1 runner: mfa_totp_enroll_enabled=true PRE-W1 → ONE PATCH of exactly the six keys turns it off; no other Auth field moves; GoTrue signup/OTP refused', async () => {
  const x = w1World();
  const before = { ...x.w.auth };
  assert.equal(before.mfa_totp_enroll_enabled, true);
  const r = await x.run();
  assert.equal(r.verdict, 'TORNEOS_AUTH_LOCKED');
  assert.equal(x.w.patches.length, 1, 'exactly one remote write');
  assert.deepEqual(x.w.patches[0], { disable_signup: true, external_email_enabled: false, external_phone_enabled: false, external_anonymous_users_enabled: false, site_url: 'https://app.arma2.com.ar', mfa_totp_enroll_enabled: false });
  assert.equal(x.w.auth.mfa_totp_enroll_enabled, false);
  const moved = Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(x.w.auth[k])).sort();
  assert.deepEqual(moved, ['disable_signup', 'external_email_enabled', 'mfa_totp_enroll_enabled', 'site_url'], 'only body keys that differed moved');
  assert.deepEqual(x.w.gotrueCalls, ['GET /auth/v1/settings', 'POST /auth/v1/signup', 'POST /auth/v1/signup', 'POST /auth/v1/otp', 'POST /auth/v1/otp']);
  const plan = x.said.join('\n');
  assert.match(plan, /mfa_totp_enroll_enabled=true/); assert.match(plan, /checked off \(not written\): 37 flags, all false/);
  const [ev] = x.evidence();
  assert.equal(ev.j.verdict, 'TORNEOS_AUTH_LOCKED');
  assert.equal(ev.j.management_api_writes, 1);
  assert.deepEqual(ev.j.changed_outside_body, []);
  assert.equal(ev.j.must_off_checked.length, 37);
  assert.ok(ev.j.must_off_checked.every((k) => ev.j.auth_after[k] === false));
  assert.deepEqual([ev.j.auth_users_after, ev.j.third_party_auth_after, ev.j.edge_functions_after], [0, 0, 0]);
  assert.equal(ev.j.auth_probe.pass, true); assert.equal(ev.j.auth_probe.probes.length, 4);
  assert.ok(ev.j.auth_probe.probes.every((p) => p.refused && p.refusal_code_known));
  assert.doesNotMatch(ev.text, /fixture-secret-never-projected|sb_publishable_|sbp_/);
  assert.ok(!('external_google_secret' in ev.j.auth_after) && !('smtp_pass' in ev.j.auth_after), 'secrets are never projected');
});

test('W1 runner: any other MUST_OFF flag on → AUTH_LOCKDOWN_BLOCKED, 0 writes, 0 GoTrue calls', async () => {
  for (const k of ['passkey_enabled', 'mfa_phone_enroll_enabled', 'external_zoom_enabled', 'hook_send_sms_enabled', 'oauth_server_enabled']) {
    const x = w1World({ auth: { ...hostedAuthConfig(), [k]: true } });
    await assert.rejects(x.run(), (e) => e.code === 'AUTH_LOCKDOWN_BLOCKED' && e.detail.failures.includes(`AUTH_${k.toUpperCase()}_ON`), k);
    assert.equal(x.w.patches.length, 0, k); assert.equal(x.w.gotrueCalls.length, 0, k);
  }
  const u = w1World(); u.w.users = 1;
  await assert.rejects(u.run(), (e) => e.code === 'AUTH_LOCKDOWN_BLOCKED' && e.detail.failures.includes('TORNEOS_AUTH_HAS_USERS'));
  const t = w1World(); t.w.tpa = [{ id: 'x', type: 'oidc' }];
  await assert.rejects(t.run(), (e) => e.code === 'AUTH_LOCKDOWN_BLOCKED');
  assert.equal(u.w.patches.length + t.w.patches.length, 0);
});

test('W1 runner: a field outside the body moving (even an unprojected one) fails the post-check; so does an accepted signup', async () => {
  const moved = w1World({ onPatch: (w) => { w.auth.external_google_secret = 'rotated-by-someone'; } });
  await assert.rejects(moved.run(), (e) => e.code === 'AUTH_LOCKDOWN_POSTCHECK_FAILED' && e.detail.failures.includes('AUTH_SETTINGS_OUTSIDE_THE_BODY_CHANGED'));
  const [ev] = moved.evidence();
  assert.deepEqual(ev.j.changed_outside_body, ['external_google_secret']);
  assert.doesNotMatch(ev.text, /rotated-by-someone|fixture-secret-never-projected/);
  assert.equal(moved.w.gotrueCalls.length, 0, 'no probe on a post-check already failed');
  const accepted = w1World({ gotrue: ({ path: p, w }) => (p === '/auth/v1/settings' ? { status: 200, body: { disable_signup: true, external: { email: false, phone: false, anonymous_users: false } } } : (w.users += 1, { status: 200, body: { id: 'u' } })) });
  await assert.rejects(accepted.run(), (e) => e.code === 'AUTH_LOCKDOWN_POSTCHECK_FAILED' && e.detail.failures.includes('GOTRUE_ACCEPTED_signup_email_password') && e.detail.failures.includes('TORNEOS_AUTH_HAS_USERS'));
  assert.equal(accepted.w.gotrueCalls.length, 2, 'the first acceptance stops the probes');
});

test('W1 auth probe transport: only Torneos /auth/v1/{settings,signup,otp}', async () => {
  const { assertAuthProbeTarget } = await import('./auth-probe.mjs');
  assert.doesNotThrow(() => assertAuthProbeTarget(T, 'GET', '/auth/v1/settings'));
  assert.doesNotThrow(() => assertAuthProbeTarget(T, 'POST', '/auth/v1/otp'));
  for (const [ref, m, p] of [[P, 'GET', '/auth/v1/settings'], [G.STAGING_REF, 'POST', '/auth/v1/signup'], [T, 'POST', '/auth/v1/admin/users'], [T, 'GET', '/auth/v1/signup'], [T, 'DELETE', '/auth/v1/user'], [T, 'POST', '/rest/v1/rpc/x']]) {
    assert.throws(() => assertAuthProbeTarget(ref, m, p), undefined, `${ref} ${m} ${p}`);
  }
});

// ─────────────── W2/W3 installer measured as `postgres` (not the read-only session) + --db-certify / --db-phase ───────────────
import * as LP from './login-probe.mjs';
const DELTA_PIN = JSON.parse(fs.readFileSync(G.DELTA_PIN_FILE, 'utf8'));
// What the hosted API returned on 2026-09-25 for the session block (read_only:true runs as supabase_read_only_user).
const READ_ONLY_SESSION = { user: 'supabase_read_only_user', super: false, createrole: false, admin_on_authenticator: false, admin_on_identity_writer: false, admin_on_core_adapter: false };
// `postgres` as measured on supabase/postgres 17.6.1.147 (local lab 2026-09-25), read by supabase_read_only_user.
const hostedInstaller = (over = {}) => ({ measured_role: 'postgres', measured_by: 'supabase_read_only_user', exists: true, super: false, createrole: true,
  admin_on_authenticator: true, admin_on_identity_writer: true, admin_on_core_adapter: true, supautils_privileged_role: 'supabase_privileged_role', member_of_privileged_role: true,
  supautils_reserved_roles: 'supabase_admin, supabase_auth_admin, supabase_storage_admin, supabase_read_only_user, supabase_realtime_admin, supabase_replication_admin, supabase_etl_admin, dashboard_user, pgbouncer, service_role*, authenticator*, authenticated*, anon*, supabase_privileged_role',
  supautils_allowed_configs: 'auto_explain.*, deadlock_timeout, pg_stat_statements.*, pgrst.*, plan_filter.*, safeupdate.enabled, session_replication_role', ...over });

test('installer capability: postgres measured explicitly; the read-only session is never the answer; fail closed per statement', () => {
  const ok = G.installerCapability(hostedInstaller());
  assert.equal(ok.sufficient, true); assert.equal(ok.model, 'supautils_reserved_authenticator'); assert.deepEqual(ok.missing, []);
  // 1. the hosted read-only session (all false) says nothing: it is not a measurement of postgres → fail closed, never "can"
  assert.deepEqual(G.installerCapability(READ_ONLY_SESSION).missing, ['INSTALLER_MEASUREMENT_UNREADABLE']);
  assert.equal(G.installerCapability(null).sufficient, false);
  // …whereas the same session reading postgres' real privileges is a PASS (no false blocker)
  assert.equal(G.installerCapability(hostedInstaller({ measured_by: 'supabase_read_only_user' })).sufficient, true);
  // 2. postgres really insufficient → BLOCK, naming the statement (each term measured in the lab to be required)
  const cases = [
    [{ createrole: false }, 'INSTALLER_CANNOT_CREATE_ROLE'],
    [{ admin_on_identity_writer: false }, 'INSTALLER_CANNOT_GRANT_IDENTITY_WRITER'],
    [{ admin_on_core_adapter: null }, 'INSTALLER_CANNOT_GRANT_CORE_ADAPTER'],
    [{ member_of_privileged_role: false }, 'INSTALLER_CANNOT_ALTER_AUTHENTICATOR_PRE_REQUEST'],
    [{ supautils_reserved_roles: 'supabase_admin, authenticator' }, 'INSTALLER_CANNOT_ALTER_AUTHENTICATOR_PRE_REQUEST'],
    [{ supautils_allowed_configs: 'deadlock_timeout' }, 'INSTALLER_CANNOT_ALTER_AUTHENTICATOR_PRE_REQUEST'],
    [{ exists: false }, 'INSTALLER_CANNOT_CREATE_ROLE'],
  ];
  for (const [over, want] of cases) { const c = G.installerCapability(hostedInstaller(over)); assert.equal(c.sufficient, false, JSON.stringify(over)); assert.ok(c.missing.includes(want), `${JSON.stringify(over)} → ${c.missing}`); }
  // ADMIN on authenticator is NOT what grants the supautils ALTER (measured): its absence alone is not a blocker there
  assert.equal(G.installerCapability(hostedInstaller({ admin_on_authenticator: false })).sufficient, true);
  // 3. without supautils: the plain PostgreSQL rule; superuser: everything
  const plain = hostedInstaller({ supautils_privileged_role: null, supautils_reserved_roles: null, supautils_allowed_configs: null, member_of_privileged_role: null });
  assert.equal(G.installerCapability(plain).sufficient, true);
  assert.ok(G.installerCapability({ ...plain, admin_on_authenticator: false }).missing.includes('INSTALLER_CANNOT_ALTER_AUTHENTICATOR_PRE_REQUEST'));
  assert.equal(G.installerCapability(hostedInstaller({ super: true, createrole: false, admin_on_identity_writer: false, member_of_privileged_role: false })).sufficient, true);
});

test('installer SQL: read-only, names postgres literally (never current_user as the subject); the roles SQL is byte-identical to the delta pin', () => {
  G.assertReadOnlySql(G.INSTALLER_PRIVILEGES_SQL);
  const terms = G.INSTALLER_PRIVILEGES_SQL.replace("'measured_by', current_user", '');
  assert.doesNotMatch(terms, /current_user|session_user|current_role/);
  assert.equal((G.INSTALLER_PRIVILEGES_SQL.match(/pg_has_role\('postgres'/g) ?? []).length, 4);
  assert.match(G.INSTALLER_PRIVILEGES_SQL, /supautils\.reserved_roles/); assert.match(G.INSTALLER_PRIVILEGES_SQL, /supautils\.privileged_role_allowed_configs/);
  assert.equal(DELTA_PIN.gateway_roles_sql_sha256, G.sha256(G.GATEWAY_ROLES_SQL), 'GATEWAY_ROLES_SQL unchanged: the certified delta pin still applies');
});

function dbWorld({ installer = hostedInstaller(), loginProbe = null, onBootstrap = null } = {}) {
  const PAT = `sbp_${'d'.repeat(40)}`;
  const PUB = `sb_publishable_${'q'.repeat(24)}`;
  const lockedAuth = { ...hostedAuthConfig(), ...G.AUTH_LOCKDOWN_BODY };
  const w = { applied: false, psql: [], generated: [], installer, catalogOverride: null, rolesOverride: null, loginProbes: 0, tls: [] };
  const catalog = () => w.catalogOverride ?? (w.applied ? { ...FOUNDATION_PIN.catalog, ...DELTA_PIN.catalog } : FOUNDATION_PIN.catalog);
  const roles = () => w.rolesOverride ?? (w.applied
    ? { ...DELTA_PIN.roles, payment_logins: 0, login_member_of_api_role: 0, authenticator_config: [...G.PRE_REQUEST_ROLECONFIG], auth_users: 0, installer: READ_ONLY_SESSION, edge_login_can_set_role: {} }
    : { logins: [], memberships: [], payment_logins: 0, login_member_of_api_role: 0, authenticator_config: [], auth_users: 0, installer: READ_ONLY_SESSION, edge_login_can_set_role: {} });
  const proj = (ref, name, status, region) => ({ ref, id: ref, name, organization_slug: G.ORG_SLUG, region, status });
  const projects = [proj(G.CORE_PROD_REF, 'core', 'ACTIVE_HEALTHY', 'sa-east-1'), proj(G.STAGING_REF, 'staging', 'INACTIVE', 'us-east-1'), proj(G.OLD_REF, 'old', 'INACTIVE', 'us-west-2'), proj(T, G.PROJECT_NAME, 'ACTIVE_HEALTHY', 'sa-east-1')];
  const modes = [];
  const transport = async ({ pat, method, path: p, body }) => {
    assert.equal(pat, PAT);
    const cls = G.classifyRequest({ method, path: p, body }, { mode: '--db-phase' });
    const r = (status, b) => ({ status, body: b });
    switch (cls.id) {
      case 'org': return r(200, { slug: G.ORG_SLUG, plan: 'free' });
      case 'projects': return r(200, projects);
      case 'prod-project': return r(200, projects[0]);
      case 'prod-contract-fn': return r(200, { slug: G.CORE_CONTRACT_SLUG, status: 'ACTIVE', verify_jwt: false, ezbr_sha256: G.CORE_CONTRACT_EZBR });
      case 'project': return r(200, projects.find((x) => x.ref === cls.ref));
      case 'health': return r(200, ['auth', 'db', 'pooler', 'rest', 'db_postgres_user'].map((name) => ({ name, status: 'ACTIVE_HEALTHY' })));
      case 'functions': return r(200, []);
      case 'secrets': return r(200, [{ name: 'SUPABASE_URL' }]);
      case 'auth-config': return r(200, { ...lockedAuth });
      case 'third-party-auth': return r(200, []);
      case 'postgrest': return r(200, { db_schema: 'public,graphql_public', max_rows: 1000 });
      case 'api-keys': return r(200, [{ name: 'default', type: 'publishable', api_key: PUB }]);
      case 'db-migrations': return r(200, []);
      case 'pooler': return r(200, [{ db_host: 'aws-0-sa-east-1.pooler.supabase.com', pool_mode: 'session' }, { db_host: 'aws-0-sa-east-1.pooler.supabase.com', pool_mode: 'transaction' }]);
      case 'query': return r(201, [{ json_build_object: body.query === G.CATALOG_SQL ? catalog() : body.query === G.INSTALLER_PRIVILEGES_SQL ? w.installer : roles() }]);
      default: throw new Error(`unexpected ${cls.id}`);
    }
  };
  // PostgREST as hosted after W2: anon reads the public page, everything else refused.
  const probeTransport = async ({ path: p, method, headers }) => {
    if (!headers.apikey) return { status: 401, body: { message: 'No API key found in request' } };
    if (headers.Authorization) return { status: 401, body: { code: 'PGRST301' } };
    if (headers['Accept-Profile']) return { status: 406, body: { code: 'PGRST106' } };
    if (p === '/rest/v1/') return { status: 404, body: null };
    if (method === 'POST') return { status: 401, body: { code: '42501' } };
    return p.includes('tournament_competition_formats') ? { status: 200, body: [] } : { status: 401, body: { code: '42501' } };
  };
  const kc = new Map();
  const keychain = {
    dbLogin: (login) => ({ check: () => (kc.has(login) ? 'PRESENT' : 'ABSENT'), generate: () => { w.generated.push(login); kc.set(login, crypto.randomBytes(30).toString('base64url')); return true; }, read: () => kc.get(login) }),
    dataplane: { check: () => 'PRESENT', read: () => crypto.randomBytes(30).toString('base64url') },
    ring: { check: () => 'ABSENT' },
  };
  const said = [];
  const evidenceDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ga-db-'));
  let clock = Date.parse('2026-09-25T22:00:00Z');
  const deps = { transport, probeTransport, keychain, now: () => (clock += 1000), say: (x) => said.push(x), evidenceDir, jwksPinFile: path.join(evidenceDir, 'no-jwks-pin.json'),
    psqlPrerequisites: () => [], tlsProbe: ({ host, port }) => { w.tls.push(port); return { host, port, pass: true, verification: 'OK' }; },
    applySql: async ({ sql, env }) => { w.psql.push({ user: env.PGUSER, sslmode: env.PGSSLMODE }); assert.equal(sql, G.renderBootstrapSql(Object.fromEntries(G.EDGE_LOGINS.map((l) => [l.login, /PASSWORD '([^']+)'/.exec(sql.split('\n').find((x) => x.includes(`CREATE ROLE ${l.login} `)))[1]])))); if (onBootstrap) return onBootstrap(w); w.applied = true; return { code: 0, elapsed_ms: 1 }; },
    loginProbe: async (args) => { w.loginProbes += 1; for (const l of G.EDGE_LOGINS) assert.match(args.password(l.login), G.DB_PASSWORD_PATTERN); return loginProbe ? loginProbe(args) : { pass: true, runs: [] }; },
    tty: { readLine: () => { const m = /To proceed type exactly:\n {2}(.+)\n/.exec(said.join('\n')); return m ? m[1] : ''; } } };
  const run = (mode) => { modes.push(mode); return runGatewayAuth({ mode, request: { pat: PAT }, deps }); };
  const evidence = (prefix) => fs.readdirSync(evidenceDir).filter((f) => f.startsWith(prefix)).map((f) => { const text = fs.readFileSync(path.join(evidenceDir, f), 'utf8'); return { f, text, j: JSON.parse(text) }; });
  return { w, run, said, evidence, PAT, PUB };
}

test('preflight: the read-only session (all false) is NOT a blocker when postgres is measured sufficient', async () => {
  const x = dbWorld();
  const r = await x.run('--preflight');
  assert.equal(r.verdict, 'GATEWAY_AUTH_PREFLIGHT_PASS'); assert.equal(r.next, '--db-bootstrap');
  const [ev] = x.evidence('ga-01');
  assert.deepEqual(ev.j.risks, []);
  assert.equal(ev.j.measured.query_session.user, 'supabase_read_only_user');
  assert.equal(ev.j.measured.installer.measured_role, 'postgres'); assert.equal(ev.j.measured.installer_capability.sufficient, true);
  assert.deepEqual(ev.j.measured.pooler_tls.map((t) => t.port), [5432, 6543]);
  assert.equal(ev.j.management_api_writes, 0);
});

test('W2+W3: postgres really insufficient → preflight risk + DB_BOOTSTRAP_BLOCKED, 0 psql, no custody generated', async () => {
  for (const over of [{ admin_on_identity_writer: false }, { member_of_privileged_role: false }, { createrole: false }]) {
    const x = dbWorld({ installer: hostedInstaller(over) });
    await x.run('--preflight');
    const [pre] = x.evidence('ga-01');
    assert.ok(pre.j.risks.includes('DB_INSTALLER_LACKS_PRIVILEGE_FOR_W2_W3'), JSON.stringify(over));
    await assert.rejects(x.run('--db-bootstrap'), (e) => e.code === 'DB_BOOTSTRAP_BLOCKED' && e.detail.failures.includes('DB_INSTALLER_LACKS_PRIVILEGE_FOR_W2_W3'));
    assert.equal(x.w.psql.length, 0); assert.deepEqual(x.w.generated, []);
    const [blk] = x.evidence('ga-03-db-bootstrap-blocked');
    assert.equal(blk.j.installer_capability.sufficient, false);
  }
});

test('W2+W3: postgres sufficient → the plan names the installer model, ONE psql transaction, applied', async () => {
  const x = dbWorld();
  const r = await x.run('--db-bootstrap');
  assert.equal(r.verdict, 'TORNEOS_GATEWAY_DB_BOOTSTRAPPED');
  assert.equal(x.w.psql.length, 1); assert.deepEqual(x.w.psql[0], { user: `postgres.${T}`, sslmode: 'verify-full' });
  assert.deepEqual(x.w.generated, G.EDGE_LOGINS.map((l) => l.login));
  assert.match(x.said.join('\n'), /installer: postgres \(supautils_reserved_authenticator\) can create_role, grant_identity_writer, grant_core_adapter, alter_authenticator_pre_request/);
  const [ev] = x.evidence('ga-03-db-bootstrap-');
  assert.equal(ev.j.plan.installer.model, 'supautils_reserved_authenticator');
  assert.doesNotMatch(ev.text, /SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$(?!A{43})/);
});

test('--db-phase: preflight → bootstrap (own plan + phrase) → db-certify in one process; each step its own evidence; nothing after a STOP', async () => {
  const x = dbWorld();
  const r = await x.run('--db-phase');
  assert.equal(r.verdict, 'GATEWAY_AUTH_DB_BOOTSTRAP_PASS');
  assert.deepEqual(r.steps.map((s) => `${s.mode}=${s.verdict}`), ['--preflight=GATEWAY_AUTH_PREFLIGHT_PASS', '--db-bootstrap=TORNEOS_GATEWAY_DB_BOOTSTRAPPED', '--db-certify=GATEWAY_DB_CERTIFIED']);
  assert.equal(x.w.psql.length, 1); assert.equal(x.w.loginProbes, 1);
  const [cert] = x.evidence('ga-03-db-certify');
  assert.equal(cert.j.verdict, 'GATEWAY_DB_CERTIFIED'); assert.deepEqual(cert.j.delta.diff, []); assert.deepEqual(cert.j.foundation.diff, []); assert.deepEqual(cert.j.invariants, []);
  assert.deepEqual(cert.j.pre_request, ['pgrst.db_pre_request=private.check_token']); assert.equal(cert.j.login_roles_torneos, 2);
  assert.equal(cert.j.postgrest_probe.pass, true); assert.equal(cert.j.management_api_writes, 0); assert.equal(cert.j.psql_writes, 0);
  for (const e of [...x.evidence('ga-01'), ...x.evidence('ga-03')]) assert.deepEqual(G.secretFindings(e.text, [x.PAT, x.PUB]), [], e.f);
  // re-run: bootstrap is already applied → preflight says next=--keyring-generate → only the certification runs again
  const again = await x.run('--db-phase');
  assert.deepEqual(again.steps.map((s) => s.mode), ['--preflight', '--db-certify']); assert.equal(x.w.psql.length, 1);
  // a STOP in the bootstrap ends the sequence: no certification
  const y = dbWorld({ installer: hostedInstaller({ admin_on_core_adapter: false }) });
  await assert.rejects(y.run('--db-phase'), (e) => e.code === 'DB_BOOTSTRAP_BLOCKED');
  assert.equal(y.w.loginProbes, 0); assert.equal(y.evidence('ga-03-db-certify').length, 0);
});

test('--db-certify: fails on a failed login probe, roles off the delta pin, or before W2/W3', async () => {
  const x = dbWorld({ loginProbe: async () => ({ pass: false, runs: [{ login: 'torneos_edge_core_adapter', port: 6543, pass: false, failures: ['psql_exit_2'] }] }) });
  await x.run('--db-bootstrap');
  await assert.rejects(x.run('--db-certify'), (e) => e.code === 'GATEWAY_DB_CERTIFICATION_FAILED' && e.detail.failures.includes('EDGE_LOGIN_PROBE_FAILED'));
  const y = dbWorld(); await y.run('--db-bootstrap');
  y.w.rolesOverride = { ...DELTA_PIN.roles, memberships: [...DELTA_PIN.roles.memberships, { role: 'torneos_payment_service', member: 'torneos_edge_core_adapter', admin: false, inherit: false, set: true }], payment_logins: 1, login_member_of_api_role: 1, authenticator_config: [...G.PRE_REQUEST_ROLECONFIG], auth_users: 0, installer: READ_ONLY_SESSION };
  await assert.rejects(y.run('--db-certify'), (e) => e.code === 'GATEWAY_DB_CERTIFICATION_FAILED' && e.detail.failures.includes('ROLES_DIFFER_FROM_DELTA_PIN'));
  assert.equal(y.w.loginProbes, 0, 'no login probe on a database already failing');
  const z = dbWorld();
  await assert.rejects(z.run('--db-certify'), (e) => e.code === 'GATEWAY_DB_CERTIFICATION_FAILED' && e.detail.failures.includes('W2_W3_NOT_APPLIED'));
});

test('login probe: pinned host/port/login only; every block ends in ROLLBACK (never COMMIT); verdict from the server SQLSTATEs', () => {
  const host = 'aws-0-sa-east-1.pooler.supabase.com';
  assert.throws(() => LP.loginEnv({ host: 'db.onzpwnqxnvlgsevivngf.supabase.co', port: 5432, login: 'torneos_edge_core_adapter', password: 'x' }), /pooler_host/);
  assert.throws(() => LP.loginEnv({ host, port: 5433, login: 'torneos_edge_core_adapter', password: 'x' }), /port/);
  assert.throws(() => LP.loginEnv({ host, port: 6543, login: 'postgres', password: 'x' }), /login_not_pinned/);
  const env = LP.loginEnv({ host, port: 6543, login: 'torneos_edge_identity_writer', password: 'pw' });
  assert.equal(env.PGUSER, `torneos_edge_identity_writer.${T}`); assert.equal(env.PGSSLMODE, 'verify-full'); assert.ok(!('PGPASSFILE' in env));
  for (const { login } of G.EDGE_LOGINS) {
    const c = LP.loginChecks(login);
    const script = LP.loginProbeScript(c);
    assert.doesNotMatch(script, /\bCOMMIT\b|^END;|pg_terminate|DROP |ALTER |GRANT /im, login);
    assert.equal((script.match(/^RELEASE SAVEPOINT/gm) ?? []).length, c.own === 'torneos_identity_writer' ? 2 : 2, 'only the kept statements release');
    assert.equal((script.match(/^BEGIN;$/gm) ?? []).length, 2); assert.equal((script.match(/^ROLLBACK;$/gm) ?? []).length, 2);
    // a server that answers every check as expected → pass; one wrong SQLSTATE → fail naming the check
    const want = [...c.before, ...c.common, ...c.specific, ...(c.own === 'torneos_identity_writer' ? c.after : [])];
    const good = [`W|${login}|${login}|1`, ...want.map((k) => `R|${k.name}| ${k.expect} | ${k.message ?? (k.expect === '00000' ? '' : 'permission denied')}`), 'E|done'].join('\n');
    assert.equal(LP.evaluateLoginProbe(login, c, good).pass, true, login);
    const bad = good.replace(`R|set_role_refused_service_role| 42501`, 'R|set_role_refused_service_role| 00000');
    assert.ok(LP.evaluateLoginProbe(login, c, bad).failures.includes('set_role_refused_service_role_sqlstate_00000_want_42501'));
    assert.ok(LP.evaluateLoginProbe(login, c, good.replace('E|done', '')).failures.includes('probe_incomplete'));
    assert.ok(LP.evaluateLoginProbe(login, c, good.replace(`W|${login}|${login}|1`, `W|${login}|${login}|0`)).failures.includes('session_identity_not_the_login'));
  }
});

test('wrapper: --db-certify and --db-phase are modes (reach the tty gate, not USAGE)', () => {
  const sh = path.join(HERE, 'run-gateway-auth.sh');
  for (const m of ['--db-certify', '--db-phase']) {
    const r = spawnSync('bash', [sh, m], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input: '' });
    assert.notEqual(r.status, 0); assert.doesNotMatch(r.stderr, /GATEWAY_AUTH_USAGE/); assert.match(r.stderr, /GATEWAY_AUTH_(BLOCKED_NO_TTY|REFUSED_NON_INTERACTIVE)/);
  }
  assert.deepEqual(G.patRequirement('--db-phase').permissions, G.patRequirement('--preflight').permissions, '--db-phase needs exactly the read-only preflight PAT');
  assert.equal(G.patRequirement('--db-phase').permissions.some((p) => p.endsWith('Read-write')), false);
});
