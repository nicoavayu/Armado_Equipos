import {
  CORE_SPORT_ENTITLEMENTS,
  TOURNAMENT_ENTITLEMENTS,
  TOURNAMENT_PLANS,
  TOURNAMENT_PLAN_SOURCES,
} from '../features/torneos/domain/entitlements';

export function tournamentEntitlementsFixture({
  organizationId = '10000000-0000-4000-8000-000000000001',
  tournamentId = '30000000-0000-4000-8000-000000000001',
  plan = TOURNAMENT_PLANS.FREE,
  assignmentSource = plan === TOURNAMENT_PLANS.PREMIUM
    ? TOURNAMENT_PLAN_SOURCES.LEGACY_GRANT
    : TOURNAMENT_PLAN_SOURCES.FIRST_FREE,
  capabilities = {},
  galleryAssetLimit = plan === TOURNAMENT_PLANS.PREMIUM ? 10000 : 100,
  administrativeSeatLimit = plan === TOURNAMENT_PLANS.PREMIUM ? 10 : 1,
  administrativeSeatUsage = 0,
} = {}) {
  const premium = plan === TOURNAMENT_PLANS.PREMIUM;
  const core = Object.fromEntries(CORE_SPORT_ENTITLEMENTS.map((key) => [key, true]));
  return {
    schemaVersion: 2,
    plan,
    assignmentSource,
    scope: {
      type: 'tournament_edition',
      organizationId,
      tournamentId,
      audience: 'organization_member',
    },
    pricing: {
      currency: 'ARS',
      listPrice: 49900,
      launchPrice: 39900,
      billingModel: 'one_time',
      scope: 'tournament_edition',
    },
    capabilities: {
      ...core,
      [TOURNAMENT_ENTITLEMENTS.PUBLIC_BASIC_PAGE]: true,
      [TOURNAMENT_ENTITLEMENTS.IDENTITY_ESSENTIAL_ASSETS]: true,
      [TOURNAMENT_ENTITLEMENTS.COMMUNICATIONS_BASIC]: true,
      [TOURNAMENT_ENTITLEMENTS.STATISTICS_BASIC]: true,
      [TOURNAMENT_ENTITLEMENTS.ADVANCED_STATISTICS]: premium,
      [TOURNAMENT_ENTITLEMENTS.ADVANCED_BRANDING]: premium,
      [TOURNAMENT_ENTITLEMENTS.SPONSORS]: premium,
      [TOURNAMENT_ENTITLEMENTS.PREMIUM_SOCIAL_STUDIO]: premium,
      [TOURNAMENT_ENTITLEMENTS.PROFESSIONAL_EXPORTS]: premium,
      [TOURNAMENT_ENTITLEMENTS.MEDIA_UPLOAD]: true,
      [TOURNAMENT_ENTITLEMENTS.MEDIA_HISTORY]: true,
      [TOURNAMENT_ENTITLEMENTS.MEDIA_EXTENDED_RETENTION]: true,
      [TOURNAMENT_ENTITLEMENTS.SOCIAL_STUDIO_BASIC]: true,
      [TOURNAMENT_ENTITLEMENTS.SOCIAL_STUDIO_FULL]: premium,
      [TOURNAMENT_ENTITLEMENTS.ADVANCED_STATS]: premium,
      [TOURNAMENT_ENTITLEMENTS.HIGHER_LIMITS]: premium,
      ...capabilities,
    },
    limits: {
      galleryAssetLimit,
      administrativeCollaboratorLimit: administrativeSeatLimit,
    },
    media: {
      galleryAssetLimit,
      essentialAssetsCountTowardLimit: false,
    },
    administration: {
      currentAdministrativeSeatUsage: administrativeSeatUsage,
      administrativeSeatLimit,
      ownerIncluded: true,
      ownerCountsTowardLimit: false,
    },
    branding: {
      mode: premium ? 'powered_by_arma2' : 'arma2_visible',
      arma2Visible: true,
      label: premium ? 'Powered by Arma2' : 'Arma2 Torneos',
    },
  };
}
