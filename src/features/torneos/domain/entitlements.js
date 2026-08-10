export const TOURNAMENT_PLANS = Object.freeze({
  FREE: 'FREE',
  PRO: 'PRO',
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

export function normalizeTournamentEntitlements(payload) {
  const hasKnownPlan = payload?.plan === TOURNAMENT_PLANS.FREE
    || payload?.plan === TOURNAMENT_PLANS.PRO;
  const plan = hasKnownPlan ? payload.plan : TOURNAMENT_PLANS.FREE;
  const capabilities = Object.fromEntries(
    [...KNOWN_ENTITLEMENTS].map((capability) => [
      capability,
      hasKnownPlan && payload?.capabilities?.[capability] === true,
    ]),
  );
  const media = hasKnownPlan && payload?.media && typeof payload.media === 'object'
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

  return {
    schemaVersion: payload?.schemaVersion === 1 ? 1 : null,
    plan,
    subscriptionStatus: String(payload?.subscriptionStatus || 'unknown'),
    capabilities,
    media,
    scope: payload?.scope || null,
  };
}

export function hasEffectiveTournamentEntitlement(entitlements, capability) {
  if (!KNOWN_ENTITLEMENTS.has(capability)) return false;
  return normalizeTournamentEntitlements(entitlements).capabilities[capability] === true;
}
