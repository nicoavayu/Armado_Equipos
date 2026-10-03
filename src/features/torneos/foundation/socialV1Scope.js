// SOCIAL-V1 scope snapshot of the gateway contract (torneos-gateway/social-v1-rpc-allowlist.json,
// backend/torneos/social-v1/contract.json); guards verify equality.
//
// The Estudio Social: organization context, the official snapshot of a piece and the export authorization asked
// before every PNG. Opt-in: the client permits it only when the composition says so (`social: true`). Like the other
// scopes this only restricts the client; the gateway (TORNEOS_SOCIAL_MODE) and the database
// (00000000000008_social_v1_export_authorization.sql) decide what is actually served and exported.
const features = {
  "social_studio": [
    "get_tournament_social_studio_context",
    "get_tournament_social_snapshot",
    "authorize_tournament_social_export"
  ]
};

export const socialV1Scope = Object.freeze(Object.fromEntries(
  Object.entries(features).map(([feature, operations]) => [feature, Object.freeze(operations)]),
));
const permitted = new Set(Object.values(socialV1Scope).flat());
export const isSocialV1Operation = (name) => typeof name === 'string' && permitted.has(name);
