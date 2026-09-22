// Static feature map of the staging-v1 composition. Pure data: the shell, the
// pages with gated sub-features and the tests read it; nothing else decides what
// is on. The eight ON keys are exactly the Phase 2D scope keys (guarded by test);
// everything OFF has no RPC in the gateway allowlist or lives outside the gateway
// contract (Edge Functions, storage, anon public pages).
const ON = Object.freeze({
  organizations_workspaces: true,
  collaborators: true,
  seasons: true,
  tournaments: true,
  team_registration_basic_roster: true,
  invitations: true,
  core_team_import: true,
  team_entry_review: true,
});

const OFF = Object.freeze({
  // plan / billing
  entitlements: false,          // get_effective_tournament_(season_)entitlements → fail-closed FREE without network
  plan: false,                  // plan pages, checkout & purchases (Edge Functions + get_tournament_purchase)
  // competition operation
  fixtures: false,              // fixture, draw, scheduling, venues & courts (26 RPC + 2 tables)
  match_operations: false,      // partidos, actas, convocatorias, mis-partidos (22 RPC)
  standings: false,             // tabla, estadísticas, clasificación, disciplina
  lifecycle_actions: false,     // start / finish / reopen competition
  participant_withdrawal: false,
  roster_lock: false,
  // communication & participation
  communications: false,        // admin, inbox and hub panel (12 RPC)
  notifications: false,
  participant_hub: false,       // /torneos/torneo/:id/** (16 RPC)
  // visual & media
  branding_assets: false,       // logo / escudo upload (storage + set_tournament_branding_reference)
  player_portraits: false,
  team_photos: false,
  team_visual_policy: false,
  media: false,
  social_studio: false,
  public_pages: false,
});

export const stagingV1Features = Object.freeze({ ...ON, ...OFF });

// The legacy composition (single-project LOCAL QA) keeps every surface on.
export const legacyFeatures = Object.freeze(Object.fromEntries(
  Object.keys(stagingV1Features).map((key) => [key, true]),
));

export const stagingV1OnFeatures = Object.freeze(Object.keys(ON));
export const stagingV1OffFeatures = Object.freeze(Object.keys(OFF));
