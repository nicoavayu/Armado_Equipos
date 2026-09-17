#!/usr/bin/env node
// OFFLINE tests for the Phase 3B R2-local runner (integration/torneos-isolated-local + phase3b/local).
// No Docker, no socket, no stack: compose/runner invariants, the shared bootstrap contract identity
// (local ≡ remote by construction), token contract, evidence rules, summarize tri-state.
// Run: node --test backend/torneos/phase3b/local/local.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPublicKey, createVerify } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CERTIFIED, FILES, FORBIDDEN_LITERALS, PROJECT, REST, evaluateExpect, promoteEvidence, renderVerify, gatedNames, secretsKnown, canonical } from '../../../../integration/torneos-isolated-local/lab.mjs';
import { bearer, generateKey, ISSUER, AUDIENCE, TTL } from '../../../../integration/torneos-isolated-local/jwt.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const LAB = path.join(REPO, 'integration/torneos-isolated-local');
const read = (p) => fs.readFileSync(p, 'utf8');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const COMPOSE = read(path.join(LAB, 'compose.yaml'));
const LAB_SRC = read(path.join(LAB, 'lab.mjs'));
const JWT_SRC = read(path.join(LAB, 'jwt.mjs'));
const CERTIFY_SRC = read(path.join(HERE, 'certify-torneos-local.mjs'));
const DRIFT_SRC = read(path.join(HERE, 'drift-torneos-local.mjs'));
const REMOTE_BOOT = read(path.join(HERE, '../remote/bootstrap-torneos.sh'));
// Remote literals assembled at runtime so this test file itself never carries them.
const J = (...parts) => parts.join('');
const PROD_REF = J('rcyuuoaq', 'fwcembdajcss');
const CORE_STAGING = J('hhyvmhgp', 'apyuzjgxfnqv');
const REMOTE_LITERALS = [PROD_REF, CORE_STAGING, J('api.supa', 'base.com'), J('supa', 'base.co/'), J('mgmt', '.mjs'), J('lib', '.sh'), J('read_', 'pat'), J('keychain', '.py'), J('SUPABASE_ACCESS', '_TOKEN'), J('--', 'linked'), J('supabase ', 'db'), J('curl', ' ')];

test('compose: project name, certified images, internal network, loopback-only ports, no Core service, gateway behind a profile, no Core migrations mount', () => {
  assert.match(COMPOSE, /^name: arma2-torneos-isolated-local$/m);
  assert.equal(PROJECT, 'arma2-torneos-isolated-local');
  assert.match(COMPOSE, new RegExp(`image: ${CERTIFIED.image.replace(/[.]/g, '\\.')}$`, 'm'));
  assert.match(COMPOSE, new RegExp(`image: ${CERTIFIED.postgrest_image.replace(/[.]/g, '\\.')}$`, 'm'));
  const ports = [...COMPOSE.matchAll(/ports: \[(.*?)\]/g)].map((m) => m[1]);
  assert.deepEqual(ports, ['"127.0.0.1:58430:3000"', '"127.0.0.1:58431:9000"']);
  assert.match(COMPOSE, /isolated:\n\s+internal: true/);
  assert.match(COMPOSE, /enable_ip_masquerade: "false"/);
  for (const svc of ['core-db', 'core-auth', 'core-api', 'core-rest', 'core-functions', 'gotrue', 'kong', 'studio', 'storage']) assert.doesNotMatch(COMPOSE, new RegExp(`^\\s{2}${svc}:`, 'm'), svc);
  assert.doesNotMatch(COMPOSE, /\.\.\/\.\.\/supabase\/migrations|\.\.\/\.\.\/supabase\/functions:/, 'Core migrations/functions must not be mounted');
  assert.match(COMPOSE, /torneos-functions:\n(?:.*\n){0,6}?\s+profiles: \[gateway\]/, 'the gateway does not start in R2');
  assert.doesNotMatch(COMPOSE, /PGRST_DB_PRE_REQUEST:/, 'pre-request comes from the database role setting, like the remote runner');
  assert.match(COMPOSE, /PGRST_JWT_AUD: arma2-torneos-local/);
  assert.match(COMPOSE, /PGRST_JWT_CACHE_MAX_LIFETIME: 0/);
  // torneos-db: internal only, no ports; torneos-rest: isolated + loopback-ingress; egress only on the gateway
  const db = COMPOSE.slice(COMPOSE.indexOf('  torneos-db:'), COMPOSE.indexOf('  torneos-rest:'));
  assert.match(db, /networks: \[isolated\]/); assert.doesNotMatch(db, /ports:/);
  const rest = COMPOSE.slice(COMPOSE.indexOf('  torneos-rest:'), COMPOSE.indexOf('  torneos-functions:'));
  assert.match(rest, /networks: \[isolated, loopback-ingress\]/);
  assert.equal((COMPOSE.match(/egress\]/g) || []).length, 1, 'egress attached to exactly one service (the R4 gateway)');
  for (const lit of REMOTE_LITERALS) assert.equal(COMPOSE.includes(lit), false, lit);
});

test('runner sources carry no remote literal, import no remote helper, use the fixed Docker socket and only 127.0.0.1', () => {
  const labWithoutDenylist = LAB_SRC.split('\n').filter((l) => !l.includes('FORBIDDEN_LITERALS = Object.freeze') && !l.startsWith("  'core-db', 'core-auth'")).join('\n');
  for (const [name, src] of [['lab.mjs', labWithoutDenylist], ['jwt.mjs', JWT_SRC], ['certify', CERTIFY_SRC], ['drift', DRIFT_SRC]]) {
    for (const lit of REMOTE_LITERALS) assert.equal(src.includes(lit), false, `${name} contains ${lit}`);
    assert.doesNotMatch(src, /(from '[^']*|import\([^)]*)phase3b\/remote\//, `${name} imports remote helpers`);
    assert.doesNotMatch(src, /https?:\/\/(?!127\.0\.0\.1)/, `${name} has a non-loopback URL`);
  }
  assert.match(LAB_SRC, /'--host', 'unix:\/\/\/var\/run\/docker\.sock'/);
  assert.equal(REST, 'http://127.0.0.1:58430');
  assert.match(LAB_SRC, /image_id !== CERTIFIED\.image_id\) stop\('IMAGE_ID_DIFFERS_FROM_CERTIFIED'/, 'image pinned by id');
  assert.doesNotMatch(LAB_SRC, /'pull'|docker pull/, 'never pulls');
  assert.match(CERTIFY_SRC, /u\.host !== '127\.0\.0\.1:58430'.*stop\('REMOTE_REQUEST_REFUSED'/, 'runtime request guard');
  assert.match(DRIFT_SRC, /informative: true, blocking: false/);
  assert.match(DRIFT_SRC, /'--network', 'none'/);
  assert.ok(FORBIDDEN_LITERALS.includes(PROD_REF) && FORBIDDEN_LITERALS.includes(CORE_STAGING), 'preflight denylist covers Production and Core staging');
  assert.equal(fs.existsSync(path.join(LAB, 'node_modules')), false, 'dependency-free lab (no npm install, no network)');
  assert.deepEqual(JSON.parse(read(path.join(LAB, 'package.json'))).dependencies, undefined);
  assert.equal(read(path.join(LAB, '.gitignore')), '.runtime/\nnode_modules/\n');
});

test('shared bootstrap contract V2: rendered verification SQL pinned (v2 = v1 with lazy cron_jobs/storage_buckets), expect document pinned and identical to v1, 16 ordered expectations', async () => {
  const names = await gatedNames();
  assert.equal(names.length, 33);
  const rendered = await renderVerify(names);
  assert.equal(sha(rendered), CERTIFIED.verify_sql_rendered);
  assert.equal(sha(rendered), '0d6ef458d0d46375d8332c6a85e014597a7d30f0d4891d1b62e12df88c9c844c');
  assert.equal((read(FILES.verify).match(/__GATED_NAMES__/g) || []).length, 4);
  assert.doesNotMatch(read(FILES.verify), /^--/m, 'no header comment: the file is the exact SQL text');
  const v2 = read(FILES.verify);
  assert.equal((v2.match(/query_to_xml\('select count\(\*\) as c from (cron\.job|storage\.buckets)', false, true, ''\)/g) || []).length, 2, 'v2: exactly the two lazy optional-relation probes');
  assert.doesNotMatch(v2, /\(select count\(\*\) from (cron\.job|storage\.buckets)\)/, 'v1 eager probes are gone');
  assert.equal(sha(fs.readFileSync(FILES.expect)), CERTIFIED.expect);
  const expectDoc = JSON.parse(read(FILES.expect));
  assert.deepEqual(Object.entries(expectDoc), [
    ['public_functions', 359], ['security_definer', 304], ['anon_execute', 12], ['authenticated_execute', 147], ['service_role_execute', 328], ['anon_sequences', 0],
    ['gated_present', 33], ['gated_anon_execute', 0], ['gated_authenticated_execute', 0], ['gated_service_role_execute', 33], ['p0_authenticated_execute', true], ['identity_rls', true],
    ['foreign_servers', 0], ['writer_members', ['torneos_edge_identity_writer']], ['adapter_members', ['torneos_edge_core_adapter']], ['pre_request', ['pgrst.db_pre_request=private.check_token']]]);
  // The same comparison the remote shell makes (json_field → string / JSON text), including the array cases.
  const rows = evaluateExpect(expectDoc, { public_functions: 359, security_definer: 304, anon_execute: 12, authenticated_execute: 147, service_role_execute: 328, anon_sequences: 0, gated_present: 33, gated_anon_execute: 0, gated_authenticated_execute: 0, gated_service_role_execute: 33, p0_authenticated_execute: true, identity_rls: true, foreign_servers: 0, writer_members: ['torneos_edge_identity_writer'], adapter_members: ['torneos_edge_core_adapter'], pre_request: ['pgrst.db_pre_request=private.check_token'] });
  assert.equal(rows.filter((r) => !r.ok).length, 0);
  assert.equal(evaluateExpect({ a: ['x'] }, { a: ['x', 'y'] })[0].ok, false);
  assert.equal(evaluateExpect({ a: 1 }, { a: '1' })[0].ok, true, 'scalar string form, like the shell');
  assert.equal(evaluateExpect({ a: 1 }, {})[0].ok, false);
});

test('remote bootstrap runner: reads the shared contract, pins both hashes at runtime, keeps no inline copy, bash renders exactly the pinned bytes (bash 3.2)', () => {
  assert.equal(spawnSync('bash', ['-n', path.join(HERE, '../remote/bootstrap-torneos.sh')], { encoding: 'utf8' }).status, 0);
  assert.match(REMOTE_BOOT, /VERIFY_TEMPLATE="\$REPO\/backend\/torneos\/phase3b\/contracts\/torneos-bootstrap-verify\.sql"/);
  assert.match(REMOTE_BOOT, /EXPECT_JSON="\$REPO\/backend\/torneos\/phase3b\/contracts\/torneos-bootstrap-expect\.json"/);
  assert.match(REMOTE_BOOT, new RegExp(`CERTIFIED_VERIFY_SQL="${CERTIFIED.verify_sql_rendered}"`));
  assert.match(REMOTE_BOOT, new RegExp(`CERTIFIED_EXPECT="${CERTIFIED.expect}"`));
  assert.match(REMOTE_BOOT, /== "\$CERTIFIED_VERIFY_SQL" \]\] \|\| abort "rendered verification SQL differs/);
  assert.match(REMOTE_BOOT, /== "\$CERTIFIED_EXPECT" \]\] \|\| abort "bootstrap expect document differs/);
  assert.doesNotMatch(REMOTE_BOOT, /VERIFY_SQL="select json_build_object/, 'no inline verification SQL');
  assert.doesNotMatch(REMOTE_BOOT, /^expect public_functions 359$/m, 'no inline expectations');
  assert.match(REMOTE_BOOT, /\[\[ "\$EXPECT_COUNT" == 16 \]\] \|\| abort/);
  assert.ok(REMOTE_BOOT.indexOf('CERTIFIED_VERIFY_SQL" ]] || abort') < REMOTE_BOOT.indexOf('step "target ('), 'contract pins are checked before any credential or network step');
  // Render with the runner's own two lines (extracted verbatim) under bash 3.2: identical bytes.
  const renderLine = REMOTE_BOOT.split('\n').find((l) => l.startsWith('VERIFY_SQL="$(cat "$VERIFY_TEMPLATE")"'));
  const namesLine = REMOTE_BOOT.split('\n').find((l) => l.startsWith('GATED_NAMES="$(node -e'));
  assert.ok(renderLine && namesLine);
  const script = `set -euo pipefail\nREPO=${JSON.stringify(REPO)}\nGATE_JSON="$REPO/backend/torneos/phase2d/staging-v1-rpc-gate.json"\nVERIFY_TEMPLATE="$REPO/backend/torneos/phase3b/contracts/torneos-bootstrap-verify.sql"\n${namesLine}\n${renderLine}\nprintf '%s' "$VERIFY_SQL" | shasum -a 256 | cut -d' ' -f1\n`;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), CERTIFIED.verify_sql_rendered);
  // The expect feed line the runner uses produces exactly the strings the old inline `expect` calls carried.
  const feed = spawnSync(process.execPath, ['-e', 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const [k,v] of Object.entries(d))process.stdout.write(k+"\\t"+(typeof v==="object"?JSON.stringify(v):String(v))+"\\n")', FILES.expect], { encoding: 'utf8' });
  assert.equal(feed.stdout, 'public_functions\t359\nsecurity_definer\t304\nanon_execute\t12\nauthenticated_execute\t147\nservice_role_execute\t328\nanon_sequences\t0\ngated_present\t33\ngated_anon_execute\t0\ngated_authenticated_execute\t0\ngated_service_role_execute\t33\np0_authenticated_execute\ttrue\nidentity_rls\ttrue\nforeign_servers\t0\nwriter_members\t["torneos_edge_identity_writer"]\nadapter_members\t["torneos_edge_core_adapter"]\npre_request\t["pgrst.db_pre_request=private.check_token"]\n');
});

test('identity bearer (node:crypto RS256): header kid, claim contract of private.current_identity_id, signature verifies against the JWK', () => {
  const key = generateKey('p3b-k1');
  assert.deepEqual(Object.keys(key.publicKey).sort(), ['alg', 'e', 'kid', 'kty', 'n', 'use']);
  assert.match(key.privateKey, /^-----BEGIN PRIVATE KEY-----/);
  const id = { id: '11111111-1111-4111-8111-111111111111', core_user_id: '22222222-2222-4222-8222-222222222222' };
  const tok = bearer(key, id);
  const [h, p, s] = tok.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url'));
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  assert.deepEqual(header, { alg: 'RS256', typ: 'JWT', kid: 'p3b-k1' });
  assert.equal(claims.iss, ISSUER); assert.equal(claims.aud, AUDIENCE); assert.equal(claims.role, 'authenticated');
  assert.equal(claims.sub, id.id); assert.equal(claims.core_user_id, id.core_user_id);
  assert.equal(claims.exp - claims.iat, TTL); assert.equal(claims.nbf, claims.iat); assert.equal(TTL, 120);
  for (const k of ['jti', 'session_id']) assert.match(claims[k], /^[0-9a-f-]{36}$/);
  const pub = createPublicKey({ key: key.publicKey, format: 'jwk' });
  assert.equal(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(pub, Buffer.from(s, 'base64url')), true);
  const forged = bearer(key, id, { session_id: undefined });
  assert.equal('session_id' in JSON.parse(Buffer.from(forged.split('.')[1], 'base64url')), false);
  assert.equal(JSON.parse(Buffer.from(bearer(key, id, { exp: claims.iat + 3600 }).split('.')[1], 'base64url')).exp - claims.iat, 3600);
});

test('evidence rules: local-torneos- prefix only, never overwrite, never a known secret, never a Production target; prefixes stay out of the remote globs', async () => {
  await assert.rejects(promoteEvidence('bootstrap-x.json', {}), /EVIDENCE_NAME/);
  await assert.rejects(promoteEvidence('local-torneos-x/../y.json', {}), /EVIDENCE_NAME/);
  secretsKnown.push('SECRET_VALUE_FOR_TEST_0123456789');
  await assert.rejects(promoteEvidence('local-torneos-test-never-written.json', { a: 'xx SECRET_VALUE_FOR_TEST_0123456789 yy' }), /EVIDENCE_REJECTED_SECRET_LEAK/);
  await assert.rejects(promoteEvidence('local-torneos-test-never-written.json', { ref: PROD_REF }), /EVIDENCE_REJECTED_PRODUCTION_TARGET/);
  await assert.rejects(promoteEvidence('local-torneos-test-never-written.json', { host: `${CORE_STAGING}.x` }), /EVIDENCE_REJECTED_REMOTE_LITERAL/);
  assert.equal(fs.existsSync(path.join(HERE, '../evidence/local-torneos-test-never-written.json')), false);
  const existing = fs.readdirSync(path.join(HERE, '../evidence')).find((f) => f.startsWith('local-torneos-'));
  if (existing) await assert.rejects(promoteEvidence(existing, {}), /EVIDENCE_EXISTS/);
  // summarize.py reads the remote runners' evidence by prefix; the local files must never match.
  const SUMMARIZE = read(path.join(HERE, '../summarize.py'));
  for (const g of ['remote-inventory-*.json', 'project-create-*.json', 'bootstrap-*.json', 'core-contract-*.json', 'gateway-deploy-*.json', 'remote-certify-*.json']) {
    assert.ok(SUMMARIZE.includes(`'${g}'`), g);
    for (const local of ['local-torneos-bootstrap-20260915T000000Z.json', 'local-torneos-certify-20260915T000000Z.json', 'local-torneos-drift-17.6.1.147-20260915T000000Z.json']) assert.equal(local.startsWith(g.slice(0, g.indexOf('*'))), false, `${local} would match ${g}`);
  }
  assert.equal(canonical({ b: 1, a: [true, null] }), '{"a":[true,null],"b":1}');
});

test('summarize.py: tri-state blocks, remote-to-remote deferred and non-blocking, local R2 conditions derived from the local evidence', () => {
  const SUMMARIZE = read(path.join(HERE, '../summarize.py'));
  for (const k of ['local_conditions', 'hybrid_conditions', 'remote_to_remote_conditions', 'HYBRID_REMOTE_LOCAL_CERTIFIED', 'HYBRID_BLOCKED', 'REMOTE_TO_REMOTE_PENDING_PRELAUNCH', "latest('local-torneos-bootstrap-*.json')", "'local-torneos-certify-*.json'", 'local-torneos-drift-']) assert.ok(SUMMARIZE.includes(k), k);
  const results = JSON.parse(read(path.join(HERE, '../results.json')));
  assert.ok(['HYBRID_REMOTE_LOCAL_CERTIFIED', 'HYBRID_BLOCKED'].includes(results.conclusion), results.conclusion);
  assert.equal(results.remote_to_remote.status, 'REMOTE_TO_REMOTE_PENDING_PRELAUNCH');
  assert.equal(results.remote_to_remote.blocking, false);
  for (const k of Object.keys(results.remote_to_remote_conditions)) assert.equal(results.blocking_conditions.includes(k), false, `${k} must not block`);
  assert.equal(results.drift_informative.blocking, false);
});
