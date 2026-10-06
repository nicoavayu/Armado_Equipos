// CONNECTED-V1 scope snapshot of the gateway contract (torneos-gateway/connected-v1-rpc-allowlist.json,
// backend/torneos/connected-v1/contract.json); guards verify equality.
//
// The connected product: Torneos profile, Torneos inbox, catalog management, registration requests (authenticated
// route) and the public catalog (anonymous read-only route). Opt-in: the client permits it only when the composition
// says so (`connected: true`). Like the other scopes this only restricts the client; the gateway
// (TORNEOS_CONNECTED_MODE) and the database (00000000000009_connected_product_v1.sql) decide what is served.
const features = {
  "torneos_profile": [
    "get_my_torneos_profile",
    "update_my_torneos_profile"
  ],
  "torneos_inbox": [
    "get_my_torneos_notifications",
    "mark_my_torneos_notifications_read",
    "get_my_torneos_inbox_summary"
  ],
  "catalog_management": [
    "get_tournament_catalog_listing_settings",
    "save_tournament_catalog_listing",
    "set_tournament_catalog_listing_status",
    "set_tournament_applications_state",
    "save_tournament_category_capacity",
    "get_tournament_application_inbox"
  ],
  "tournament_applications": [
    "search_my_applicable_core_teams",
    "start_tournament_application",
    "get_my_tournament_registrations"
  ]
};
const publicFeatures = {
  "tournament_catalog": [
    "search_tournament_catalog",
    "get_tournament_catalog_facets",
    "get_tournament_catalog_entry"
  ]
};

const freeze = (source) => Object.freeze(Object.fromEntries(
  Object.entries(source).map(([feature, operations]) => [feature, Object.freeze(operations)]),
));
export const connectedV1Scope = freeze(features);
export const connectedV1PublicScope = freeze(publicFeatures);
const permitted = new Set(Object.values(connectedV1Scope).flat());
const permittedPublic = new Set(Object.values(connectedV1PublicScope).flat());
export const isConnectedV1Operation = (name) => typeof name === 'string' && permitted.has(name);
export const isConnectedV1PublicOperation = (name) => typeof name === 'string' && permittedPublic.has(name);
