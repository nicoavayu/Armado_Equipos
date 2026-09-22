import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {FLOW_RPCS, slugs, createFlow, P0} from './flow.mjs';
import {REQUIRED_BLOCKS, assembleJourney, coreTeamPayload, QA_TAG, QA_PURPOSE, CLOCK_TOLERANCE_SECONDS, EXPIRY_BOUNDARY_SECONDS, EXPIRY_MARGIN_SECONDS} from './journey.mjs';
import {TTL} from '../r42/lib.mjs';
import {createRunRegistry} from '../r42/fixtures.mjs';
import {coreClient} from '../r42/core.mjs';
import {repo, readJSON, forget} from '../r42/lib.mjs';
import {buildAuthorization} from '../r42/operator.mjs';
import {validateAuthorization} from '../r4/authorization.mjs';
import {teamExistsSql, assertReadOnlySql} from '../remote/mgmt.mjs';

const allowed = [...new Set(Object.values(readJSON(repo + '/backend/torneos/supabase/functions/torneos-gateway/staging-v1-rpc-allowlist.json').features).flat())];
const gated = readJSON(repo + '/backend/torneos/phase2d/staging-v1-rpc-gate.json').functions.map((f) => f.name);

test('the journey dispatches ONLY staging-v1 allowlisted RPCs (43) and never a gated one (33); P0 is in scope', () => {
  assert.equal(allowed.length, 43); assert.equal(gated.length, 33);
  assert.deepEqual(FLOW_RPCS.filter((n) => !allowed.includes(n)), [], 'every planned RPC is allowlisted');
  assert.deepEqual(FLOW_RPCS.filter((n) => gated.includes(n)), [], 'no gated RPC is planned');
  assert.equal(new Set(FLOW_RPCS).size, FLOW_RPCS.length, 'no duplicates');
  assert.ok(FLOW_RPCS.includes(P0) && FLOW_RPCS.includes('search_tournament_arma2_teams') && FLOW_RPCS.includes('accept_tournament_team_invitation'));
  assert.ok(FLOW_RPCS.length >= 40, `covers ${FLOW_RPCS.length}/43 of the allowlist`);
  for (const feature of Object.values(readJSON(repo + '/backend/torneos/supabase/functions/torneos-gateway/staging-v1-rpc-allowlist.json').features)) assert.ok(feature.some((n) => FLOW_RPCS.includes(n)), 'every staging-v1 feature is exercised');
});
test('flow refuses any RPC name outside its plan before dispatching, and requires a registry of the same run', async () => {
  const RUN = 'unit' + crypto.randomBytes(2).toString('hex');
  const actors = Object.fromEntries(['owner', 'admin', 'captain', 'outsider'].map((role) => [role, {role, identity: crypto.randomUUID(), coreUserId: crypto.randomUUID(), email: `${role}@accounts.invalid`}]));
  const calls = [];
  const rpc = async (name) => { calls.push(name); return {status: 200, body: true}; };
  const flow = createFlow({rpc, actors, RUN, registry: createRunRegistry(RUN)});
  await assert.rejects(flow.call('create_tournament_venue', actors.owner, {}), /FLOW_RPC_NOT_PLANNED/);
  await assert.rejects(flow.call('auto_schedule_tournament_matches', actors.owner, {}), /FLOW_RPC_NOT_PLANNED/);
  assert.deepEqual(calls, [], 'nothing dispatched');
  assert.throws(() => createFlow({rpc, actors, RUN, registry: createRunRegistry('other')}), /FLOW_REGISTRY_REQUIRED/);
  assert.throws(() => createFlow({rpc, actors, RUN}), /FLOW_REGISTRY_REQUIRED/);
});
test('flow journals the organization the moment its creating call returns, even when the next call fails (cleanup scope never depends on the aggregate)', async () => {
  const RUN = 'unit' + crypto.randomBytes(2).toString('hex');
  const registry = createRunRegistry(RUN);
  const actors = Object.fromEntries(['owner', 'admin', 'captain', 'outsider'].map((role) => [role, {role, identity: crypto.randomUUID(), coreUserId: crypto.randomUUID(), email: `${role}@accounts.invalid`}]));
  const rpc = async (name) => name === 'is_tournament_organization_slug_available' ? {status: 200, body: true} : name === 'create_tournament_organization' ? {status: 200, body: {organization: {id: 'org-1'}}} : {status: 503, body: {error: 'CORE_UNAVAILABLE'}};
  const flow = createFlow({rpc, actors, RUN, registry});
  await assert.rejects(flow.workspace(), /FLOW_RPC_FAILED: set_tournament_workspace_preference \(owner\) 503/);
  assert.deepEqual(registry.orgs, ['org-1']);
  assert.deepEqual(slugs(RUN), {league: `r5-league-${RUN}`, other: `r5-other-${RUN}`});
});
test('assembled journey is PASS only with every required block PASS, none missing, not aborted; cleanup flags start unverified', () => {
  const blocks = [...REQUIRED_BLOCKS.map((name) => ({name, status: 'PASS', checks: [{name: 'c', pass: true}]})), {name: 'qa_users', status: 'PASS', checks: [], informative: true}, {name: 'cleanup', status: 'PASS', checks: [{name: 'x', pass: true}], informative: true}];
  const base = {run: 'arma2-r42-x', stamp: 'x', gatewayBundleSHA256: 'b', detail: {rpcsExercised: ['a']}, cleanup: {qa: true, fixtures: true, coreFixtures: true, detail: {users: [{role: 'owner'}]}}, coreFixtures: {teams: []}, artifacts: {}};
  const j = assembleJourney({...base, blocks});
  assert.equal(j.schema, 'R5.journey.v1'); assert.equal(j.status, 'PASS'); assert.equal(j.cases.length, REQUIRED_BLOCKS.length); assert.deepEqual(j.missingRequired, []);
  assert.deepEqual(j.cleanup, {qa: true, fixtures: true, coreFixtures: true, sessions: false, complete: false}, 'sessions/complete are set by the operator after the Management API verification');
  assert.equal(j.informative.length, 2); assert.deepEqual(j.qaUsers, [{role: 'owner'}]);
  assert.equal(assembleJourney({...base, blocks: blocks.map((b) => b.name === 'no_fallback' ? {...b, status: 'FAIL'} : b)}).status, 'FAIL');
  const missing = assembleJourney({...base, blocks: blocks.filter((b) => b.name !== 'core_team_import')});
  assert.equal(missing.status, 'FAIL'); assert.deepEqual(missing.missingRequired, ['core_team_import']);
  assert.equal(assembleJourney({...base, blocks, detail: {aborted: 'x'}}).status, 'FAIL');
  assert.equal(new Set(REQUIRED_BLOCKS).size, REQUIRED_BLOCKS.length); assert.equal(REQUIRED_BLOCKS.length, 25);
  for (const n of ['shadow_identity', 'p0_review', 'cross_user', 'cross_workspace', 'cross_season', 'logout_revocation', 'core_unavailable', 'torneos_unavailable', 'gated_off', 'no_fallback']) assert.ok(REQUIRED_BLOCKS.includes(n), n);
});
test('Core team fixture payload is the app insert (owner-only RLS): owner_user_id, run-tagged name, format 5, active', () => {
  const owner = {coreUserId: crypto.randomUUID()};
  assert.deepEqual(coreTeamPayload(owner, 'run1'), {owner_user_id: owner.coreUserId, name: 'QA R5 Team run1', format: 5, is_active: true});
  assert.throws(() => coreTeamPayload({coreUserId: 'nope'}, 'run1'), /CORE_TEAM_OWNER_REQUIRED/);
});
test('R5 QA users are tagged per phase (qa-r5-…, purpose phase3b-r5) and the R4.2 defaults are unchanged; the deletion guard follows the purpose', async () => {
  const calls = [];
  const http = async (url, init) => { calls.push({url, body: init.body ? JSON.parse(init.body) : null, method: init.method}); return {status: 200, body: {id: crypto.randomUUID(), email: JSON.parse(init.body).email}}; };
  const keyOf = (role) => 'x.' + Buffer.from(JSON.stringify({role, ref: 'hhyvmhgpapyuzjgxfnqv'})).toString('base64url') + '.x';
  const r5 = coreClient({http, anonKey: keyOf('anon'), serviceKey: keyOf('service_role'), run: 'arma2-r42-x', tag: QA_TAG, purpose: QA_PURPOSE, label: 'R5'});
  const u = await r5.createUser('owner');
  assert.match(u.email, /^qa-r5-arma2-r42-x-owner-[0-9a-f]{8}@accounts\.invalid$/);
  assert.deepEqual(calls.at(-1).body.app_metadata, {purpose: 'phase3b-r5', run: 'arma2-r42-x'}); assert.equal(calls.at(-1).body.user_metadata.name, 'QA R5 owner arma2-r42-x');
  const r42 = coreClient({http, anonKey: keyOf('anon'), serviceKey: keyOf('service_role'), run: 'arma2-r42-x'});
  const v = await r42.createUser('owner');
  assert.match(v.email, /^qa-r42-arma2-r42-x-owner-/); assert.deepEqual(calls.at(-1).body.app_metadata, {purpose: 'phase3b-r42', run: 'arma2-r42-x'}); assert.equal(calls.at(-1).body.user_metadata.name, 'QA R4.2 owner arma2-r42-x');
  assert.throws(() => coreClient({http, anonKey: keyOf('anon'), serviceKey: keyOf('service_role'), run: 'x', tag: 'prod'}), /QA_TAG_INVALID/);
  forget();
});
test('core-team-exists probe is a single read-only SELECT bound to a uuid', () => {
  const id = crypto.randomUUID();
  const sql = teamExistsSql(id);
  assert.equal(assertReadOnlySql(sql), sql); assert.ok(sql.includes(id) && !sql.includes(';'));
  assert.throws(() => teamExistsSql('not-a-uuid'), /uuid_malformed__ABORT/);
  assert.throws(() => teamExistsSql(`${id}' or '1'='1`), /uuid_malformed__ABORT/);
});
test('R5 authorization: the operator restricts the sealed runner to start-gateway + smoke (no certify) under the R4.1A seal', () => {
  const seal = 'a'.repeat(64);
  const anon = 'x.' + Buffer.from(JSON.stringify({role: 'anon', ref: 'hhyvmhgpapyuzjgxfnqv'})).toString('base64url') + '.x';
  const doc = buildAuthorization({sealSHA256: seal, coreAnonKey: anon, now: Date.now()});
  doc.commands = ['start-gateway', 'smoke'];
  for (const c of ['start-gateway', 'smoke']) assert.equal(validateAuthorization(doc, c, seal), doc);
  assert.throws(() => validateAuthorization(doc, 'certify', seal), /NOT_AUTHORIZED/);
  assert.throws(() => validateAuthorization(doc, 'cleanup', seal), /NOT_AUTHORIZED/);
});
test('run-r5.sh: TTY-only operator entrypoint, mode r5, r5-terminal log, no Production ref, no argv secret', () => {
  const sh = fs.readFileSync(new URL('./run-r5.sh', import.meta.url), 'utf8');
  assert.ok(sh.includes('require_tty') && sh.includes('MODE="r5"') && sh.includes('r5-terminal-$STAMP.log') && sh.includes('printf \'{"pat":"%s","secret":"%s","stamp":"%s","mode":"%s"}\''));
  assert.ok(!sh.includes('rcyuuoaqfwcembdajcss') && !sh.includes('--pat'));
  assert.ok(sh.includes('R5_HYBRID_E2E_CERTIFIED'));
});
test('real-expiry threshold: a bridge bearer is refused only after exp + the gateway clock tolerance (token.ts clockTolerance: 5; run 20260921T043550Z asserted at 124 s)', () => {
  const tokenTs = fs.readFileSync(repo + '/backend/torneos/supabase/functions/torneos-gateway/token.ts', 'utf8');
  const m = /clockTolerance:\s*(\d+)/.exec(tokenTs); assert.ok(m, 'clockTolerance declared in token.ts');
  assert.equal(Number(m[1]), CLOCK_TOLERANCE_SECONDS); assert.equal(TTL, 120);
  assert.equal(EXPIRY_BOUNDARY_SECONDS, 125); assert.ok(EXPIRY_MARGIN_SECONDS >= 1);
  assert.ok(EXPIRY_BOUNDARY_SECONDS + EXPIRY_MARGIN_SECONDS > 124, 'the failed threshold (121 s wait, 124 s observed) is below the certified boundary');
});
