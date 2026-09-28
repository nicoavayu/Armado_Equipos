// OFFICIALIZATION-V1 — frontend guards of the membership + dual-control contract:
//   • the client scope (foundation/officializationV1Scope.js) = the gateway allowlist = contract.json;
//   • every hybrid alias sends exactly its RPC name and p_* payload, the 9 RPCs are all reached, nothing else;
//   • listMembers maps the membership RPC to the row shape the page renders; a non-uuid never leaves the client;
//   • the client refuses anything outside staging v1 + COMPETITION-V1 + OFFICIALIZATION-V1 before the network;
//   • the feature map turns on exactly the OFFICIALIZATION-V1 keys.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtime } from './sandbox.mjs';
import { read } from './audit.mjs';

const ADAPTER = 'src/features/torneos/stagingV1/stagingV1WorkspaceService.js';
const ORG = '33333333-3333-4333-8333-333333333333';
const ALLOW = JSON.parse(read('backend/torneos/supabase/functions/torneos-gateway/officialization-v1-rpc-allowlist.json'));
const CONTRACT = JSON.parse(read('backend/torneos/officialization-v1/contract.json'));
const uuidStub = { v4: () => 'idempotency-placeholder' };
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));

export const OFFICIALIZATION_SAMPLE = {
  listMemberInvitations: [[{ organizationId: ORG }], 'list_tournament_organization_invitations', { p_organization_id: ORG }],
  inviteMember: [[{ organizationId: ORG, email: 'b@club.com', role: 'admin' }], 'invite_tournament_organization_member', { p_organization_id: ORG, p_email: 'b@club.com', p_role: 'admin' }],
  revokeMemberInvitation: [[{ organizationId: ORG, invitationId: 'i1' }], 'revoke_tournament_organization_invitation', { p_organization_id: ORG, p_invitation_id: 'i1' }],
  acceptOrganizationInvitation: [['a'.repeat(64)], 'accept_tournament_organization_invitation', { p_token: 'a'.repeat(64) }],
  updateMemberRole: [[{ organizationId: ORG, membershipId: 'm1', role: 'collaborator' }], 'update_tournament_organization_member_role', { p_organization_id: ORG, p_membership_id: 'm1', p_role: 'collaborator' }],
  removeMember: [[{ organizationId: ORG, membershipId: 'm1' }], 'remove_tournament_organization_member', { p_organization_id: ORG, p_membership_id: 'm1' }],
  loadMatchDualControl: [[{ organizationId: ORG, tournamentId: 't1' }], 'get_tournament_match_dual_control', { p_organization_id: ORG, p_tournament_id: 't1' }],
  setMatchDualControl: [[{ organizationId: ORG, tournamentId: 't1', enabled: true }], 'set_tournament_match_dual_control', { p_organization_id: ORG, p_tournament_id: 't1', p_enabled: true }],
};

function recording(reply = () => null) {
  const calls = [];
  return { calls, transport: {
    rpc: async (name, params) => { calls.push({ kind: 'rpc', name, params }); return reply(name, params); },
    select: async (table, query) => { calls.push({ kind: 'select', table, query }); return reply(table, query); },
    clear() {}, dispose() {},
  } };
}
const load = (transport) => runtime({ modules: { uuid: uuidStub } }).load(ADAPTER).createStagingV1WorkspaceService({ transport });

test('scope = gateway allowlist = contract.json (feature by feature), disjoint from the other scopes', () => {
  const rt = runtime();
  const { officializationV1Scope } = rt.load('src/features/torneos/foundation/officializationV1Scope.js');
  same(officializationV1Scope, ALLOW.features);
  assert.equal(ALLOW.phase, 'OFFICIALIZATION-V1');
  assert.equal(ALLOW.public, undefined, 'no public RPC');
  for (const [feature, rpcs] of Object.entries(ALLOW.features)) same(Object.keys(CONTRACT.features[feature].rpcs).sort(), [...rpcs].sort());
  const { stagingV1Scope } = rt.load('src/features/torneos/foundation/stagingV1Scope.js');
  const { competitionV1Scope, competitionV1PublicScope } = rt.load('src/features/torneos/foundation/competitionV1Scope.js');
  const others = new Set([...Object.values(stagingV1Scope), ...Object.values(competitionV1Scope), ...Object.values(competitionV1PublicScope)].flat());
  assert.deepEqual(Object.values(ALLOW.features).flat().filter((n) => others.has(n)), []);
});

test('every alias sends its exact RPC name and p_* payload; together they reach the 9 RPCs (listMembers included)', async () => {
  const recorder = recording();
  const service = load(recorder.transport);
  const reached = new Set();
  for (const [alias, [args, name, params]] of Object.entries(OFFICIALIZATION_SAMPLE)) {
    recorder.calls.length = 0;
    await service[alias](...args);
    assert.equal(recorder.calls.length, 1, alias);
    same(recorder.calls[0], { kind: 'rpc', name, params });
    reached.add(name);
  }
  recorder.calls.length = 0;
  await service.listMembers(ORG);
  same(recorder.calls, [{ kind: 'rpc', name: 'list_tournament_organization_members', params: { p_organization_id: ORG } }]);
  reached.add('list_tournament_organization_members');
  same([...reached].sort(), Object.values(ALLOW.features).flat().sort());
  // A falsy/absent `enabled` always travels as an explicit boolean.
  recorder.calls.length = 0;
  await service.setMatchDualControl({ organizationId: ORG, tournamentId: 't1' });
  assert.equal(recorder.calls[0].params.p_enabled, false);
});

test('listMembers maps the membership RPC to the page row shape; a non-uuid organization never reaches the network', async () => {
  const recorder = recording(() => [{ id: 'm1', userId: 'u1', role: 'admin', status: 'active', joinedAt: 'j', createdAt: 'c', email: 'a@b.co', isViewer: true }]);
  const service = load(recorder.transport);
  same(await service.listMembers(ORG), [{ id: 'm1', user_id: 'u1', role: 'admin', status: 'active', joined_at: 'j', created_at: 'c', email: 'a@b.co', is_viewer: true }]);
  await assert.rejects(service.listMembers("x' or 1=1"), { code: 'TORNEOS_INVALID_REQUEST' });
  assert.equal(recorder.calls.length, 1);
});

test('the client permits exactly staging v1 + COMPETITION-V1 + OFFICIALIZATION-V1; anything else fails before the transport', async () => {
  const rt = runtime();
  const { createTorneosClient } = rt.load('src/features/torneos/foundation/torneosClient.js');
  const recorder = recording();
  const client = createTorneosClient({ transport: recorder.transport });
  for (const name of Object.values(ALLOW.features).flat()) await client.execute(name, {});
  assert.equal(recorder.calls.length, 9);
  for (const name of ['assign_tournament_media_photographer', 'delete_tournament_organization', 'set_tournament_organization_subscription']) {
    await assert.rejects(client.execute(name, {}), { code: 'TORNEOS_OUTSIDE_STAGING_V1' });
  }
  assert.equal(recorder.calls.length, 9);
});

test('the feature map turns on exactly the OFFICIALIZATION-V1 keys; the legacy composition keeps every surface', () => {
  const { stagingV1Features, officializationV1OnFeatures, legacyFeatures } = runtime().load('src/features/torneos/stagingV1/stagingV1Features.js');
  same(officializationV1OnFeatures, Object.keys(ALLOW.features));
  same(officializationV1OnFeatures, CONTRACT.frontend_features.on);
  for (const key of officializationV1OnFeatures) { assert.equal(stagingV1Features[key], true, key); assert.equal(legacyFeatures[key], true, key); }
});
