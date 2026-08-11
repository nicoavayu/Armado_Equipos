export const TOURNAMENT_PLANS = Object.freeze({
  FREE: 'FREE',
  PRO: 'PRO',
});

export const TOURNAMENT_SUBSCRIPTION_STATUSES = Object.freeze({
  NONE: 'none',
  ACTIVE: 'active',
  GRACE_PERIOD: 'grace_period',
  PAST_DUE: 'past_due',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
});

export const TOURNAMENT_ENTITLEMENTS = Object.freeze({
  MEDIA_UPLOAD: 'media.upload',
  MEDIA_HISTORY: 'media.history',
  MEDIA_EXTENDED_RETENTION: 'media.extended_retention',
  SOCIAL_STUDIO_BASIC: 'social_studio.basic',
  SOCIAL_STUDIO_FULL: 'social_studio.full',
  ADVANCED_STATS: 'advanced_stats',
  HIGHER_LIMITS: 'higher_limits',
});

const KNOWN_ENTITLEMENTS = new Set(Object.values(TOURNAMENT_ENTITLEMENTS));
const KNOWN_SUBSCRIPTION_STATUSES = new Set(
  Object.values(TOURNAMENT_SUBSCRIPTION_STATUSES),
);

function matchesExpectedScope(scope, expectedScope) {
  if (!expectedScope || Object.keys(expectedScope).length === 0) return true;
  if (!scope || typeof scope !== 'object') return false;
  if (
    expectedScope.organizationId
    && scope.organizationId !== expectedScope.organizationId
  ) return false;
  if (Object.prototype.hasOwnProperty.call(expectedScope, 'tournamentId')) {
    return (scope.tournamentId || null) === (expectedScope.tournamentId || null);
  }
  return true;
}

export function normalizeTournamentEntitlements(payload, expectedScope = null) {
  const hasKnownPlan = payload?.plan === TOURNAMENT_PLANS.FREE
    || payload?.plan === TOURNAMENT_PLANS.PRO;
  const isTrusted = payload?.schemaVersion === 1
    && hasKnownPlan
    && matchesExpectedScope(payload?.scope, expectedScope);
  const plan = isTrusted ? payload.plan : TOURNAMENT_PLANS.FREE;
  const capabilities = Object.fromEntries(
    [...KNOWN_ENTITLEMENTS].map((capability) => [
      capability,
      isTrusted && payload?.capabilities?.[capability] === true,
    ]),
  );
  const media = isTrusted && payload?.media && typeof payload.media === 'object'
    ? {
      maxPhotosPerMatchday: Number.isInteger(payload.media.maxPhotosPerMatchday)
        ? payload.media.maxPhotosPerMatchday
        : null,
      retainedMatchdays: Number.isInteger(payload.media.retainedMatchdays)
        ? payload.media.retainedMatchdays
        : null,
      retentionGraceDays: Number.isInteger(payload.media.retentionGraceDays)
        ? payload.media.retentionGraceDays
        : null,
      postExpirationRetentionDays: Number.isInteger(
        payload.media.postExpirationRetentionDays,
      ) ? payload.media.postExpirationRetentionDays : null,
      postProProtectedUntil: payload.media.postProProtectedUntil || null,
    }
    : null;
  const rawSubscriptionStatus = String(payload?.subscriptionStatus || 'unknown');

  return {
    schemaVersion: isTrusted ? 1 : null,
    isTrusted,
    plan,
    subscriptionStatus: isTrusted && KNOWN_SUBSCRIPTION_STATUSES.has(rawSubscriptionStatus)
      ? rawSubscriptionStatus
      : 'unknown',
    capabilities,
    media,
    scope: isTrusted ? payload.scope : null,
  };
}

export function hasEffectiveTournamentEntitlement(entitlements, capability) {
  if (!KNOWN_ENTITLEMENTS.has(capability)) return false;
  return normalizeTournamentEntitlements(entitlements).capabilities[capability] === true;
}
