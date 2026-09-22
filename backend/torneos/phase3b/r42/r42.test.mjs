import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {tokenVariants, bridgeToken, decodeJwt, decodeHeader, guardedFetch, registerSecret, containsSecret, redact, forget, assertNoSecret, ISSUER, AUDIENCE, TTL} from './lib.mjs';
import {deletePlan, createRunRegistry, buildFixtures} from './fixtures.mjs';
import {assertAnonKey, assertServiceKey} from './core.mjs';
import {buildAuthorization} from './operator.mjs';
import {assembleMatrix} from './matrix.mjs';
import {validateAuthorization, validatePublicCoreKey} from '../r4/authorization.mjs';
import {validateMatrix, REQUIRED_CASES} from '../r4/certification.mjs';

function ring() {
  const mk = (kid) => { const {publicKey, privateKey} = crypto.generateKeyPairSync('rsa', {modulusLength: 2048}); const jwk = publicKey.export({format: 'jwk'}); return {kid, privateKey: privateKey.export({type: 'pkcs8', format: 'pem'}), publicKey: {kty: 'RSA', n: jwk.n, e: jwk.e}}; };
  return {keys: [mk('p3b-k1'), mk('p3b-k2')], activeKid: 'p3b-k1', trustedKids: ['p3b-k1']};
}
const identity = {sub: crypto.randomUUID(), coreUserId: crypto.randomUUID(), sessionId: crypto.randomUUID()};

test('a valid bridge token carries the certified claim contract and verifies with the active key', () => {
  const r = ring();
  const t = bridgeToken(r.keys[0], identity);
  const [h, p, s] = t.split('.');
  const c = decodeJwt(t), hd = decodeHeader(t);
  assert.deepEqual([hd.alg, hd.typ, hd.kid], ['RS256', 'JWT', 'p3b-k1']);
  assert.deepEqual([c.sub, c.core_user_id, c.session_id, c.iss, c.aud, c.role, c.exp - c.iat, c.nbf === c.iat], [identity.sub, identity.coreUserId, identity.sessionId, ISSUER, AUDIENCE, 'authenticated', TTL, true]);
  assert.ok(crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(crypto.createPublicKey(r.keys[0].privateKey), Buffer.from(s, 'base64url')));
  assert.ok(containsSecret(t), 'issued tokens are registered as secrets');
  forget();
});
test('every negative variant differs from the contract in exactly the intended way', () => {
  const r = ring();
  const v = Object.fromEntries(tokenVariants(r, identity).map((x) => [x.name, x.token]));
  assert.equal(Object.keys(v).length, 21);
  const claims = (n) => decodeJwt(v[n]), header = (n) => decodeHeader(v[n]);
  assert.notEqual(claims('wrong_issuer').iss, ISSUER); assert.notEqual(claims('wrong_audience').aud, AUDIENCE);
  assert.equal(header('unknown_kid').kid, 'p3b-k9'); assert.equal(header('standby_kid_p3b_k2').kid, 'p3b-k2');
  assert.ok(claims('expired').exp < Math.floor(Date.now() / 1000)); assert.equal(claims('expired').exp - claims('expired').iat, TTL);
  assert.equal(claims('ttl_121').exp - claims('ttl_121').iat, 121); assert.equal(claims('ttl_60').exp - claims('ttl_60').iat, 60);
  assert.notEqual(claims('nbf_not_iat').nbf, claims('nbf_not_iat').iat); assert.ok(claims('iat_future').iat > Math.floor(Date.now() / 1000) + 30);
  assert.equal(claims('role_service_role').role, 'service_role'); assert.equal(claims('role_anon').role, 'anon');
  assert.equal(header('alg_none').alg, 'none'); assert.equal(v.alg_none.split('.')[2], '');
  assert.equal(header('typ_not_jwt').typ, 'JWS'); assert.equal(claims('sub_not_uuid').sub, 'owner');
  assert.equal(claims('core_user_id_not_uuid').core_user_id, '1'); assert.equal(claims('session_id_not_uuid').session_id, 'session');
  assert.equal(claims('jti_missing').jti, undefined); assert.equal(claims('session_id_missing').session_id, undefined); assert.equal(claims('core_user_id_missing').core_user_id, undefined);
  assert.equal(v.garbage, 'not.a.jwt'); assert.equal(v.empty, '');
  // the standby variant is signed by p3b-k2 (never trusted): it must NOT verify with p3b-k1
  const [h, p, s] = v.standby_kid_p3b_k2.split('.');
  assert.equal(crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(crypto.createPublicKey(r.keys[0].privateKey), Buffer.from(s, 'base64url')), false);
  forget();
});
test('secret registry: redaction and evidence refusal', () => {
  registerSecret('sbp_this_is_a_secret_token_value');
  assert.equal(redact('x sbp_this_is_a_secret_token_value y'), 'x «REDACTED» y');
  assert.throws(() => assertNoSecret('{"pat":"sbp_this_is_a_secret_token_value"}', 'evidence'), /SECRET_IN_EVIDENCE/);
  assert.equal(assertNoSecret('clean'), 'clean');
  forget();
});
test('guarded fetch refuses any origin outside the run and Production before any network use', async () => {
  const f = guardedFetch(['http://127.0.0.1:58431', 'https://hhyvmhgpapyuzjgxfnqv.supabase.co']);
  await assert.rejects(f('https://rcyuuoaqfwcembdajcss.supabase.co/auth/v1/health'), /EGRESS_GUARD/);
  await assert.rejects(f('https://google.com/'), /EGRESS_GUARD/);
  await assert.rejects(f('http://127.0.0.1:58430/'), /EGRESS_GUARD/);
  await assert.rejects(f('http://127.0.0.1:58431@evil.example/'), /EGRESS_GUARD/);
});
test('delete plan: run-scoped predicates only; no predicate → null; empty lists never produce IN ()', () => {
  const scope = {orgs: ['o1'], identities: ['i1'], coreUserIds: ['c1']};
  assert.match(deletePlan('public.tournament_organizations', ['id', 'slug'], scope), /WHERE id IN \('o1'\)/);
  assert.match(deletePlan('public.torneos_identity', ['id', 'core_user_id'], scope), /core_user_id IN \('c1'\)/);
  assert.match(deletePlan('public.tournament_audit_log', ['id', 'organization_id', 'actor_user_id'], scope), /organization_id IN \('o1'\)/);
  assert.match(deletePlan('private.core_contract_attestations', ['identity_id'], scope), /identity_id IN \('i1'\)/);
  assert.match(deletePlan('public.user_workspace_preferences', ['user_id'], scope), /user_id IN \('i1'\)/);
  assert.equal(deletePlan('public.tournament_plan_catalog', ['id', 'code'], scope), null);
  assert.match(deletePlan('public.tournament_audit_log', ['organization_id'], {orgs: [], identities: [], coreUserIds: []}), /IN \(NULL\)/);
  assert.match(deletePlan('public.x', ['organization_id'], {orgs: ["a'b"], identities: [], coreUserIds: []}), /IN \('a''b'\)/);
});
test('run registry: records immediately after each creation, scopes cleanup without the fixture aggregate, refuses empty ids', () => {
  const r = createRunRegistry('20260918t224835');
  assert.equal(r.record('organization', 'o1', {slug: 'r42-league-x'}), 'o1');
  r.record('season', 's1', {org: 'o1'}); r.record('organization', 'o2'); r.record('organization', 'o2');
  assert.deepEqual(r.orgs, ['o1', 'o2'], 'dedicated accessor for the cleanup scope, de-duplicated');
  assert.deepEqual(r.ids('season'), ['s1']); assert.deepEqual(r.ids('tournament'), []);
  assert.deepEqual(r.counts(), {organization: 3, season: 1});
  assert.ok(r.snapshot().every((e) => typeof e.at === 'string' && e.id && e.kind), 'journal entries carry kind, id and time');
  for (const bad of [undefined, null, '']) assert.throws(() => r.record('organization', bad), /REGISTRY_ID_MISSING/);
  assert.throws(() => r.record('', 'x'), /REGISTRY_KIND_REQUIRED/);
  assert.throws(() => createRunRegistry(''), /REGISTRY_RUN_REQUIRED/);
});
test('buildFixtures journals every organization the moment its call returns, even when a later call fails (R4.2 20260918T224221Z)', async () => {
  const RUN = 'unit' + crypto.randomBytes(2).toString('hex');
  const registry = createRunRegistry(RUN);
  const actors = Object.fromEntries(['owner', 'admin', 'member', 'outsider', 'captain'].map((role) => [role, {role, identity: crypto.randomUUID(), email: `${role}@accounts.invalid`}]));
  let n = 0;
  // Stub rpc: the two organizations succeed, the first season answers the R4.2 shape (503 CORE_UNAVAILABLE).
  const rpc = async (name) => { n += 1; if (name === 'create_tournament_organization') return {status: 200, body: {organization: {id: `org-${n}`}}}; return {status: 503, body: {error: 'CORE_UNAVAILABLE'}}; };
  await assert.rejects(buildFixtures({rpc, actors, RUN, exercised: new Set(), registry}), /FIXTURE_RPC_FAILED: create_tournament_season 503/);
  assert.deepEqual(registry.orgs, ['org-1', 'org-2'], 'both orgs journaled before the failing call; nothing else');
  assert.deepEqual(registry.counts(), {organization: 2});
  await assert.rejects(buildFixtures({rpc, actors, RUN, exercised: new Set()}), /FIXTURE_REGISTRY_REQUIRED/, 'the aggregate-only pattern is refused');
  await assert.rejects(buildFixtures({rpc, actors, RUN, exercised: new Set(), registry: createRunRegistry('other')}), /FIXTURE_REGISTRY_REQUIRED/, 'registry must belong to the run');
});
test('Core keys: only staging public anon/publishable enters the gateway; only staging service key creates QA', () => {
  const jwt = (o) => 'x.' + Buffer.from(JSON.stringify(o)).toString('base64url') + '.x';
  assert.equal(assertAnonKey('sb_publishable_' + 'a'.repeat(24)), 'publishable');
  assert.equal(assertAnonKey(jwt({role: 'anon', ref: 'hhyvmhgpapyuzjgxfnqv'})), 'legacy-anon');
  for (const bad of [undefined, 'sb_secret_' + 'a'.repeat(24), jwt({role: 'service_role', ref: 'hhyvmhgpapyuzjgxfnqv'}), jwt({role: 'anon', ref: 'rcyuuoaqfwcembdajcss'})]) assert.throws(() => assertAnonKey(bad));
  assert.equal(assertServiceKey('sb_secret_' + 'a'.repeat(24)), 'secret');
  assert.equal(assertServiceKey(jwt({role: 'service_role', ref: 'hhyvmhgpapyuzjgxfnqv'})), 'legacy-service_role');
  for (const bad of [undefined, jwt({role: 'anon', ref: 'hhyvmhgpapyuzjgxfnqv'}), jwt({role: 'service_role', ref: 'rcyuuoaqfwcembdajcss'})]) assert.throws(() => assertServiceKey(bad));
});
test('authorization document satisfies the sealed R4.1 validator for the three commands and only them; expires; refuses admin keys', () => {
  const seal = 'a'.repeat(64);
  const anon = 'x.' + Buffer.from(JSON.stringify({role: 'anon', ref: 'hhyvmhgpapyuzjgxfnqv'})).toString('base64url') + '.x';
  const doc = buildAuthorization({sealSHA256: seal, coreAnonKey: anon, now: Date.now()});
  for (const c of ['start-gateway', 'smoke', 'certify']) assert.equal(validateAuthorization(doc, c, seal), doc);
  assert.throws(() => validateAuthorization(doc, 'cleanup', seal), /NOT_AUTHORIZED/);
  assert.throws(() => validateAuthorization(doc, 'start-gateway', 'b'.repeat(64)), /NOT_AUTHORIZED/);
  assert.throws(() => validateAuthorization(buildAuthorization({sealSHA256: seal, coreAnonKey: anon, now: Date.now() - 3 * 3600000}), 'smoke', seal), /NOT_AUTHORIZED/);
  assert.equal(validatePublicCoreKey(doc.coreAnonKey), anon);
  assert.throws(() => buildAuthorization({sealSHA256: seal, coreAnonKey: 'sb_secret_' + 'a'.repeat(24)}), /ONLY_CORE_STAGING_PUBLIC_ANON_KEY_ALLOWED/);
  assert.equal(doc.phase, 'R4.2'); assert.equal(doc.userAuthorized, true);
});
test('assembled matrix passes the sealed validateMatrix only with every required block PASS, exact 43/33 coverage and full cleanup', () => {
  const art = {detail: {path: 'r4-matrix-detail-x.json', sha256: 'd'}, isolation: {path: 'r4-isolation-x.json', sha256: 'i'}, outage: {path: 'r4-outage-x.json', sha256: 'o'}};
  const allowed = Array.from({length: 43}, (_, i) => 'a' + i), gated = Array.from({length: 33}, (_, i) => 'g' + i);
  const blocks = [...REQUIRED_CASES.map((name) => ({name, status: 'PASS', checks: [{name: 'c', pass: true}]})), {name: 'fixtures', status: 'PASS', checks: [], informative: true}];
  const detail = {dispatch: Object.fromEntries(allowed.map((n) => [n, {}])), gate: Object.fromEntries(gated.map((n) => [n, {}]))};
  const state = {run: 'arma2-r42-x', gatewayBundleSHA256: 'b'};
  const m = assembleMatrix({run: state.run, stamp: 'x', gatewayBundleSHA256: 'b', blocks, detail, cleanup: {qa: true, fixtures: true, detail: {users: []}}, artifacts: art});
  assert.equal(m.status, 'PASS'); assert.equal(m.cases.length, REQUIRED_CASES.length);
  assert.throws(() => validateMatrix(m, state, allowed, gated), /MATRIX_INCOMPLETE_OR_UNBOUND/, 'sessions must be verified by the operator before certify');
  m.cleanup.sessions = true;
  assert.equal(validateMatrix(m, state, allowed, gated).length, REQUIRED_CASES.length + 4);
  assert.throws(() => validateMatrix(m, state, allowed.slice(1), gated), /MATRIX_INCOMPLETE_OR_UNBOUND/);
  assert.throws(() => validateMatrix(m, {...state, gatewayBundleSHA256: 'other'}, allowed, gated));
  const failed = assembleMatrix({run: state.run, stamp: 'x', gatewayBundleSHA256: 'b', blocks: blocks.map((b) => b.name === 'gated' ? {...b, status: 'FAIL'} : b), detail, cleanup: {qa: true, fixtures: true}, artifacts: art});
  assert.equal(failed.status, 'FAIL');
  const missing = assembleMatrix({run: state.run, stamp: 'x', gatewayBundleSHA256: 'b', blocks: blocks.slice(1), detail, cleanup: {qa: true, fixtures: true}, artifacts: art});
  assert.equal(missing.status, 'FAIL'); assert.deepEqual(missing.missingRequired, [REQUIRED_CASES[0]]);
  const aborted = assembleMatrix({run: state.run, stamp: 'x', gatewayBundleSHA256: 'b', blocks, detail: {...detail, aborted: 'x'}, cleanup: {qa: true, fixtures: true}, artifacts: art});
  assert.equal(aborted.status, 'FAIL');
});

test('guarded fetch preserves no-response transport failures instead of manufacturing HTTP 503',async()=>{
  const original=globalThis.fetch;
  try {
    for(const code of ['ECONNRESET','EHOSTUNREACH','UND_ERR_SOCKET']) {
      globalThis.fetch=async()=>{throw new TypeError('fetch failed',{cause:Object.assign(new Error('transport'),{code})});};
      await assert.rejects(guardedFetch(['http://127.0.0.1:58431'])('http://127.0.0.1:58431/torneos-gateway/health'),e=>e.message.includes('HTTP_TRANSPORT_FAILED')&&e.message.includes(code)&&e.message.includes('"httpResponse":false'));
    }
  } finally {globalThis.fetch=original;}
});
