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
  // plan / billing — three separate concepts; only the PLAN READ and MP-A5 TEST overlays below turn them on
  entitlements: false,          // reading the effective season plan (get_effective_tournament_season_entitlements)
  plan: false,                  // Mi plan: nav, header context, selector badge and the season Plan page
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
  social_studio: false,         // the Estudio Social: only the SOCIAL-V1 overlay below turns it on
  // connected product: only the CONNECTED-V1 overlay below turns them on
  torneos_profile: false,       // Mi perfil de Torneos (nombre de presentación + avisos que la bandeja cumple)
  torneos_inbox: false,         // bandeja de actividad de Torneos + contador de la campana
  catalog_management: false,    // convocatoria, cupos y bandeja de solicitudes del organizador
  tournament_applications: false, // solicitud de inscripción con equipo autorizado + seguimiento
  tournament_catalog: false,    // Explorar torneos (catálogo público)
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

// PLAN READ: `REACT_APP_TORNEOS_PLAN_READ_MODE=on` in the hybrid composition (foundation/config.js
// resolveTorneosPlanRead). Reading the season plan and showing it (Mi plan) go on together, never
// one without the other: before the read is deliberately enabled the plan UX does not exist.
// No purchase: billing stays off.
export const stagingV1PlanReadOverlay = Object.freeze({
  entitlements: true,
  plan: true,
});

const planReadFeatures = Object.freeze({ ...stagingV1Features, ...stagingV1PlanReadOverlay });

// SOCIAL-V1: the Estudio Social (foundation/config.js resolveTorneosSocialStudio = hybrid + PLAN READ + the
// production-eligible flag). It needs the season plan to tell FREE from PREMIUM, so it never applies without the
// plan read: `social` alone keeps it off. Billing is not part of it.
export const stagingV1SocialOverlay = Object.freeze({
  social_studio: true,
});

const planReadSocialFeatures = Object.freeze({ ...planReadFeatures, ...stagingV1SocialOverlay });
const billingTestSocialFeatures = Object.freeze({ ...billingTestFeatures, ...stagingV1SocialOverlay });

// CONNECTED-V1: the connected product (foundation/config.js resolveTorneosConnectedProduct = hybrid + the explicit
// opt-in that matches the gateway's TORNEOS_CONNECTED_MODE=on). Independent of plan, billing and Social.
export const stagingV1ConnectedOverlay = Object.freeze({
  torneos_profile: true,
  torneos_inbox: true,
  catalog_management: true,
  tournament_applications: true,
  tournament_catalog: true,
});

function baseFeaturesFor(billingMode, { planRead = false, social = false } = {}) {
  const mode = typeof billingMode === 'string' ? billingMode : billingMode?.mode;
  if (mode === 'test') return social === true ? billingTestSocialFeatures : billingTestFeatures;
  if (planRead !== true) return stagingV1Features;
  return social === true ? planReadSocialFeatures : planReadFeatures;
}

export function stagingV1FeaturesFor(billingMode, { planRead = false, social = false, connected = false } = {}) {
  const base = baseFeaturesFor(billingMode, { planRead, social });
  return connected === true ? Object.freeze({ ...base, ...stagingV1ConnectedOverlay }) : base;
}

// The legacy composition (single-project LOCAL QA) keeps every surface on.
export const legacyFeatures = Object.freeze(Object.fromEntries(
  Object.keys(stagingV1Features).map((key) => [key, true]),
));

export const stagingV1OnFeatures = Object.freeze(Object.keys(STAGING_V1_ON));
export const competitionV1OnFeatures = Object.freeze(Object.keys(COMPETITION_V1_ON));
export const officializationV1OnFeatures = Object.freeze(Object.keys(OFFICIALIZATION_V1_ON));
export const stagingV1OffFeatures = Object.freeze(Object.keys(OFF));
