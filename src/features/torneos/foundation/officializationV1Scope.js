// OFFICIALIZATION-V1 scope snapshot of the gateway contract (torneos-gateway/officialization-v1-rpc-allowlist.json,
// backend/torneos/officialization-v1/contract.json); guards verify equality.
//
// Organization membership (invite / accept / roles / removal) and the per-tournament dual-control policy, on the
// authenticated gateway route only. Like the other scopes this only restricts the client; the gateway allowlist and
// the database ACL (00000000000005_officialization_v1.sql) decide what is actually served.
const features = {
  "organization_members": [
    "list_tournament_organization_members",
    "list_tournament_organization_invitations",
    "invite_tournament_organization_member",
    "revoke_tournament_organization_invitation",
    "accept_tournament_organization_invitation",
    "update_tournament_organization_member_role",
    "remove_tournament_organization_member"
  ],
  "match_dual_control": [
    "get_tournament_match_dual_control",
    "set_tournament_match_dual_control"
  ]
};

export const officializationV1Scope = Object.freeze(Object.fromEntries(
  Object.entries(features).map(([feature, operations]) => [feature, Object.freeze(operations)]),
));
const permitted = new Set(Object.values(officializationV1Scope).flat());
export const isOfficializationV1Operation = (name) => typeof name === 'string' && permitted.has(name);
