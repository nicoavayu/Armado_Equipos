import {
  hasEffectiveTournamentEntitlement,
  TOURNAMENT_ENTITLEMENTS,
} from '../domain/entitlements';

export const SOCIAL_STUDIO_PREMIUM_CAPABILITY =
  TOURNAMENT_ENTITLEMENTS.PREMIUM_SOCIAL_STUDIO;

export const FREE_BASE_FAMILY_IDS = Object.freeze([
  'round_results',
  'standings',
  'next_fixture',
]);

export const PREMIUM_SOCIAL_THEME_IDS = Object.freeze([
  'heritage',
  'street',
  'scoreboard',
  'editorial',
]);

const FREE_BASE_FAMILIES = new Set(FREE_BASE_FAMILY_IDS);
const PREMIUM_THEMES = new Set(PREMIUM_SOCIAL_THEME_IDS);

export class SocialStudioAccessError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'SocialStudioAccessError';
    this.code = code;
  }
}

export function hasSocialStudioPremium(entitlements) {
  return entitlements?.isTrusted === true
    && hasEffectiveTournamentEntitlement(
      entitlements,
      SOCIAL_STUDIO_PREMIUM_CAPABILITY,
    );
}

export function describeSocialCatalogAccess({
  familyId,
  themeId = 'base',
  entitlements,
}) {
  const premium = hasSocialStudioPremium(entitlements);
  const premiumTheme = PREMIUM_THEMES.has(themeId);
  const knownTheme = themeId === 'base' || premiumTheme;
  const usable = knownTheme && (premium || (!premiumTheme && FREE_BASE_FAMILIES.has(familyId)));
  return Object.freeze({
    visible: knownTheme,
    previewable: knownTheme,
    usable,
    exportable: usable,
    locked: !usable,
    premiumRequired: !usable,
  });
}

/**
 * Authoritative in-app export policy. The database repeats this check before a
 * PNG can be downloaded/shared; keeping this resolver pure also makes preview,
 * render keys and UI controls consume one normalized branding decision.
 */
export function resolveSocialExportPolicy({
  familyId,
  themeId = 'base',
  entitlements,
  requestedArma2Branding = true,
}) {
  const access = describeSocialCatalogAccess({ familyId, themeId, entitlements });
  if (!access.visible) throw new SocialStudioAccessError('THEME_UNKNOWN', themeId);
  if (!access.exportable) {
    throw new SocialStudioAccessError(
      'THEME_ENTITLEMENT_REQUIRED',
      `${themeId}/${familyId}`,
    );
  }

  const premium = hasSocialStudioPremium(entitlements);
  const showArma2Branding = themeId === 'base'
    ? (premium ? requestedArma2Branding !== false : true)
    : false;

  return Object.freeze({
    familyId,
    themeId,
    premium,
    showArma2Branding,
    brandingMode: showArma2Branding ? 'arma2_visible' : 'white_label',
  });
}

export function resolveSocialPreviewBranding({ themeId = 'base', entitlements }) {
  if (PREMIUM_THEMES.has(themeId)) return false;
  return !hasSocialStudioPremium(entitlements);
}
