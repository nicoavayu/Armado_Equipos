// Static feature map of the hybrid composition. Pure data: the shell, the pages with gated
// sub-features and the tests read it; nothing else decides what is on.
//
//   • STAGING_V1_ON — exactly the Phase 2D scope keys (guarded by test);
//   • COMPETITION_V1_ON — exactly the COMPETITION-V1 contract keys (gateway allowlist
//     competition-v1-rpc-allowlist.json + migration 00000000000004, guarded by test): the
//     full competition — fixture, scheduling, match reports, standings, lifecycle,
//     withdrawal, participant hub, communications, notification preferences, public page;
//   • OFFICIALIZATION_V1_ON — exactly the OFFICIALIZATION-V1 contract keys (officialization-v1-rpc-allowlist.json +
//     migration 00000000000005, guarded by test): organization membership and the dual-control policy;
//   • everything OFF has no RPC in either gateway allowlist or lives outside the gateway
//     contract (media pipeline, storage uploads, social studio, billing).
const STAGING_V1_ON = Object.freeze({
  organizations_workspaces: true,
  collaborators: true,
  seasons: true,
  tournaments: true,
  team_registration_basic_roster: true,
  invitations: true,
  core_team_import: true,
  team_entry_review: true,
});

const COMPETITION_V1_ON = Object.freeze({
  fixtures: true,               // fixture, draw, versions, scheduling, venues & courts (20 RPC + 2 tables)
  match_operations: true,       // partidos, actas, convocatorias, mis-partidos (20 RPC)
  standings: true,              // tabla, estadísticas, clasificación (5 RPC)
  lifecycle_actions: true,      // start / finish / reopen competition (3 RPC)
  participant_withdrawal: true, // withdraw a team from a running competition (1 RPC)
  participant_hub: true,        // /torneos/torneo/:id/** (7 RPC)
  communications: true,         // admin, inbox and hub panel (14 RPC)
  notifications: true,          // notification preferences of the participant (2 RPC)
  public_pages: true,           // settings (2 RPC) + the anonymous public page (1 public RPC)
});

const OFFICIALIZATION_V1_ON = Object.freeze({
  organization_members: true,   // invite / accept / roles / removal of organization members (7 RPC)
  match_dual_control: true,     // optional dual control of match reports, per tournament (2 RPC)
});

const OFF = Object.freeze({
  // plan / billing — three separate concepts; only the MP-A5 TEST overlay below turns them on
  entitlements: false,          // reading the effective season plan (get_effective_tournament_season_entitlements)
  plan: false,                  // the season Plan page and its purchase status pages
  billing: false,               // the frontend may start a checkout (Comprar Premium)
  plan_legacy_routes: false,    // legacy Plan redirects (organization settings, tournament-scoped plan/purchase)
  // competition extras outside the contract (no page calls them in hybrid)
  roster_lock: false,
  // visual & media
  branding_assets: false,       // logo / escudo upload (storage + set_tournament_branding_reference)
  player_portraits: false,
  team_photos: false,
  team_visual_policy: false,
  media: false,
  social_studio: false,
});

export const stagingV1Features = Object.freeze({ ...STAGING_V1_ON, ...COMPETITION_V1_ON, ...OFFICIALIZATION_V1_ON, ...OFF });

// MP-A5: Mercado Pago Checkout Pro TEST in the local lab. The overlay is applied only for a
// billing mode resolved to `test` (foundation/config.js resolveTorneosBillingMode: hybrid +
// loopback gateway/Core/app + development build); anything else keeps the static map above.
// The legacy Plan redirects are not part of it: they stay off in hybrid.
export const stagingV1BillingTestOverlay = Object.freeze({
  entitlements: true,
  plan: true,
  billing: true,
});

const billingTestFeatures = Object.freeze({ ...stagingV1Features, ...stagingV1BillingTestOverlay });

export function stagingV1FeaturesFor(billingMode) {
  const mode = typeof billingMode === 'string' ? billingMode : billingMode?.mode;
  return mode === 'test' ? billingTestFeatures : stagingV1Features;
}

// The legacy composition (single-project LOCAL QA) keeps every surface on.
export const legacyFeatures = Object.freeze(Object.fromEntries(
  Object.keys(stagingV1Features).map((key) => [key, true]),
));

export const stagingV1OnFeatures = Object.freeze(Object.keys(STAGING_V1_ON));
export const competitionV1OnFeatures = Object.freeze(Object.keys(COMPETITION_V1_ON));
export const officializationV1OnFeatures = Object.freeze(Object.keys(OFFICIALIZATION_V1_ON));
export const stagingV1OffFeatures = Object.freeze(Object.keys(OFF));
