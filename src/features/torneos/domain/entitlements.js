export const TOURNAMENT_PLANS = Object.freeze({
  FREE: 'FREE',
  PREMIUM: 'PREMIUM',
});

export const TOURNAMENT_PLAN_SOURCES = Object.freeze({
  FIRST_FREE: 'first_free',
  PURCHASE: 'purchase',
  LEGACY_GRANT: 'legacy_grant',
  UNASSIGNED: 'unassigned',
});

export const TOURNAMENT_ENTITLEMENTS = Object.freeze({
  SPORT_TEAMS: 'sport.teams',
  SPORT_ROSTERS: 'sport.rosters',
  SPORT_FIXTURE: 'sport.fixture',
  SPORT_SCHEDULE: 'sport.schedule',
  SPORT_MATCHES: 'sport.matches',
  SPORT_MATCH_REPORTS: 'sport.match_reports',
  SPORT_RESULTS: 'sport.results',
  SPORT_STANDINGS: 'sport.standings',
  SPORT_BASIC_SCORERS: 'sport.basic_scorers',
  SPORT_CARDS: 'sport.cards',
  SPORT_DISCIPLINE: 'sport.discipline',
  SPORT_SANCTIONS: 'sport.sanctions',
  PUBLIC_BASIC_PAGE: 'public.basic_page',
  IDENTITY_ESSENTIAL_ASSETS: 'identity.essential_assets',
  COMMUNICATIONS_BASIC: 'communications.basic',
  STATISTICS_BASIC: 'statistics.basic',
  ADVANCED_STATISTICS: 'statistics.advanced',
  ADVANCED_BRANDING: 'branding.advanced',
  SPONSORS: 'sponsors',
  PREMIUM_SOCIAL_STUDIO: 'social_studio.premium',
  PROFESSIONAL_EXPORTS: 'exports.professional',
  MEDIA_UPLOAD: 'media.upload',
  MEDIA_HISTORY: 'media.history',
  MEDIA_EXTENDED_RETENTION: 'media.extended_retention',
  SOCIAL_STUDIO_BASIC: 'social_studio.basic',
  SOCIAL_STUDIO_FULL: 'social_studio.full',
  ADVANCED_STATS: 'advanced_stats',
  HIGHER_LIMITS: 'higher_limits',
});

export const CORE_SPORT_ENTITLEMENTS = Object.freeze([
  TOURNAMENT_ENTITLEMENTS.SPORT_TEAMS,
  TOURNAMENT_ENTITLEMENTS.SPORT_ROSTERS,
  TOURNAMENT_ENTITLEMENTS.SPORT_FIXTURE,
  TOURNAMENT_ENTITLEMENTS.SPORT_SCHEDULE,
  TOURNAMENT_ENTITLEMENTS.SPORT_MATCHES,
  TOURNAMENT_ENTITLEMENTS.SPORT_MATCH_REPORTS,
  TOURNAMENT_ENTITLEMENTS.SPORT_RESULTS,
  TOURNAMENT_ENTITLEMENTS.SPORT_STANDINGS,
  TOURNAMENT_ENTITLEMENTS.SPORT_BASIC_SCORERS,
  TOURNAMENT_ENTITLEMENTS.SPORT_CARDS,
  TOURNAMENT_ENTITLEMENTS.SPORT_DISCIPLINE,
  TOURNAMENT_ENTITLEMENTS.SPORT_SANCTIONS,
]);

const KNOWN_ENTITLEMENTS = new Set(Object.values(TOURNAMENT_ENTITLEMENTS));
const KNOWN_SOURCES = new Set(Object.values(TOURNAMENT_PLAN_SOURCES));

function matchesExpectedScope(scope, expectedScope) {
  if (!expectedScope || Object.keys(expectedScope).length === 0) return true;
  if (!scope || typeof scope !== 'object') return false;
  if (expectedScope.organizationId && scope.organizationId !== expectedScope.organizationId) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(expectedScope, 'tournamentId')) {
    return (scope.tournamentId || null) === (expectedScope.tournamentId || null);
  }
  return true;
}

function validPricing(pricing) {
  return pricing?.currency === 'ARS'
    && Number.isInteger(pricing?.listPrice)
    && pricing.listPrice > 0
    && Number.isInteger(pricing?.launchPrice)
    && pricing.launchPrice > 0
    && pricing.launchPrice < pricing.listPrice
    && pricing?.billingModel === 'one_time'
    && pricing?.scope === 'tournament_edition';
}

function validPlanSource(plan, source) {
  if (!KNOWN_SOURCES.has(source)) return false;
  if (plan === TOURNAMENT_PLANS.PREMIUM) {
    return source === TOURNAMENT_PLAN_SOURCES.PURCHASE
      || source === TOURNAMENT_PLAN_SOURCES.LEGACY_GRANT;
  }
  return source === TOURNAMENT_PLAN_SOURCES.FIRST_FREE
    || source === TOURNAMENT_PLAN_SOURCES.UNASSIGNED;
}

export function normalizeTournamentEntitlements(payload, expectedScope = null) {
  const hasKnownPlan = payload?.plan === TOURNAMENT_PLANS.FREE
    || payload?.plan === TOURNAMENT_PLANS.PREMIUM;
  const scopeIsValid = payload?.scope?.type === 'tournament_edition'
    && matchesExpectedScope(payload?.scope, expectedScope);
  const isTrusted = payload?.schemaVersion === 2
    && hasKnownPlan
    && scopeIsValid
    && validPricing(payload?.pricing)
    && validPlanSource(payload.plan, payload?.assignmentSource);
  const plan = isTrusted ? payload.plan : TOURNAMENT_PLANS.FREE;
  const capabilities = Object.fromEntries(
    [...KNOWN_ENTITLEMENTS].map((capability) => [
      capability,
      isTrusted && payload?.capabilities?.[capability] === true,
    ]),
  );

  return {
    schemaVersion: isTrusted ? 2 : null,
    isTrusted,
    plan,
    assignmentSource: isTrusted
      ? payload.assignmentSource : TOURNAMENT_PLAN_SOURCES.UNASSIGNED,
    capabilities,
    pricing: isTrusted ? {
      currency: payload.pricing.currency,
      listPrice: payload.pricing.listPrice,
      launchPrice: payload.pricing.launchPrice,
      billingModel: payload.pricing.billingModel,
      scope: payload.pricing.scope,
    } : null,
    limits: isTrusted ? {
      galleryAssetLimit: Number.isInteger(payload?.limits?.galleryAssetLimit)
        ? payload.limits.galleryAssetLimit : null,
      administrativeCollaboratorLimit: Number.isInteger(
        payload?.limits?.administrativeCollaboratorLimit,
      ) ? payload.limits.administrativeCollaboratorLimit : null,
    } : null,
    media: isTrusted ? {
      galleryAssetLimit: Number.isInteger(payload?.media?.galleryAssetLimit)
        ? payload.media.galleryAssetLimit : null,
      essentialAssetsCountTowardLimit:
        payload?.media?.essentialAssetsCountTowardLimit === true,
    } : null,
    administration: isTrusted ? {
      currentAdministrativeSeatUsage: Number.isInteger(
        payload?.administration?.currentAdministrativeSeatUsage,
      ) ? payload.administration.currentAdministrativeSeatUsage : null,
      administrativeSeatLimit: Number.isInteger(
        payload?.administration?.administrativeSeatLimit,
      ) ? payload.administration.administrativeSeatLimit : null,
      ownerIncluded: payload?.administration?.ownerIncluded === true,
      ownerCountsTowardLimit: payload?.administration?.ownerCountsTowardLimit === true,
    } : null,
    branding: isTrusted ? {
      mode: payload?.branding?.mode || null,
      arma2Visible: payload?.branding?.arma2Visible === true,
      label: payload?.branding?.label || '',
    } : null,
    scope: isTrusted ? payload.scope : null,
  };
}

export function hasEffectiveTournamentEntitlement(entitlements, capability) {
  if (!KNOWN_ENTITLEMENTS.has(capability)) return false;
  return normalizeTournamentEntitlements(entitlements).capabilities[capability] === true;
}
