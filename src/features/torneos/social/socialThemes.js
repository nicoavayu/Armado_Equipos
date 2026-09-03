import { SOCIAL_FORMAT_IDS, SOCIAL_PIECE_IDS } from './socialContracts';

const completeFamilyRegistry = (variants = {}) => Object.freeze(Object.fromEntries(
  SOCIAL_PIECE_IDS.map((familyId) => [familyId, Object.freeze({
    layouts: Object.freeze(Object.fromEntries(
      SOCIAL_FORMAT_IDS.map((formatId) => [formatId, `${familyId}:${formatId}`]),
    )),
    variants: Object.freeze(variants[familyId] || ['default']),
  })]),
));

const makeTheme = ({
  id, name, tier, fonts, supportedBrandingModes, tokens, capabilities, variants,
}) => Object.freeze({
  id, name, label: name, tier,
  supportedBrandingModes: Object.freeze(supportedBrandingModes),
  fonts: Object.freeze(fonts),
  fixedAssets: Object.freeze([]),
  tokens: Object.freeze(tokens),
  capabilities: Object.freeze(capabilities),
  families: completeFamilyRegistry(variants),
  background: tokens.background,
  backgroundDeep: tokens.backgroundDeep,
  surface: tokens.surface,
  surfaceStrong: tokens.surfaceStrong,
  hairline: tokens.hairline,
  text: tokens.text,
  textMuted: tokens.textMuted,
  textFaint: tokens.textFaint,
  electricBlue: tokens.secondary,
  violet: tokens.accent,
  display: fonts.display,
  heading: fonts.heading,
  body: fonts.body,
  lineWidth: 2,
  radii: Object.freeze({ card: 0, match: 0 }),
  shadows: Object.freeze({ card: null }),
  accentBehavior: Object.freeze({ defaultAccentId: 'violeta', backdropOpacity: 0 }),
});

const PREMIUM_VARIANTS = Object.freeze({
  round_results: ['res4', 'res8', 'resLong'],
  next_fixture: ['next'],
  standings: ['table8', 'table18'],
  mvp: ['figuraFoto', 'figuraSin'],
  final: ['final'],
  champion: ['campeon', 'campeonSin', 'campeonFoto'],
  scorers: ['scorers'],
  discipline: ['discipline'],
  best_eleven: ['best11'],
  round_summary: ['summary'],
  semifinals: ['semis'],
});

export const BASE_SOCIAL_THEME = makeTheme({
  id: 'base', name: 'Base', tier: 'free',
  supportedBrandingModes: ['arma2_visible', 'white_label'],
  fonts: { display: 'Bebas Neue', heading: 'Oswald', body: 'Inter' },
  tokens: {
    background: '#08090C', backgroundDeep: '#11131A', surface: 'rgba(255, 255, 255, 0.035)',
    surfaceStrong: '#F4F1EA', hairline: 'rgba(255, 255, 255, 0.16)', text: '#F7F5F0',
    textMuted: 'rgba(247, 245, 240, 0.68)', textFaint: 'rgba(247, 245, 240, 0.42)',
    accent: '#9D7BFF', secondary: '#3B82F6',
  },
  capabilities: { playerPhoto: true, teamPhoto: false, sponsors: false, accentOverride: true },
});

export const HERITAGE_SOCIAL_THEME = makeTheme({
  id: 'heritage', name: 'Heritage', tier: 'premium',
  supportedBrandingModes: ['white_label'],
  fonts: { display: 'Anton', heading: 'Barlow Condensed', body: 'Barlow Semi Condensed' },
  tokens: {
    background: '#EFE6D8', backgroundDeep: '#E0D4C3', surface: '#16181C',
    surfaceStrong: '#16181C', hairline: 'rgba(22,24,28,.18)', text: '#16181C',
    textMuted: '#8A7F73', textFaint: 'rgba(22,24,28,.55)', accent: '#7C1C2E', secondary: '#D9A2AC',
  },
  capabilities: { playerPhoto: true, teamPhoto: true, sponsors: true, accentOverride: false },
  variants: PREMIUM_VARIANTS,
});

export const STREET_SOCIAL_THEME = makeTheme({
  id: 'street', name: 'Street', tier: 'premium',
  supportedBrandingModes: ['white_label'],
  fonts: { display: 'Archivo Black', heading: 'Archivo Narrow', body: 'Archivo Narrow' },
  tokens: {
    background: '#11100E', backgroundDeep: '#1A1814', surface: '#F2EBDD',
    surfaceStrong: '#F7F1E5', hairline: 'rgba(247,241,229,.30)', text: '#F7F1E5',
    textMuted: 'rgba(247,241,229,.72)', textFaint: 'rgba(247,241,229,.48)',
    accent: '#EF3D2F', secondary: '#40D7FF',
  },
  capabilities: { playerPhoto: true, teamPhoto: true, sponsors: true, accentOverride: false },
  variants: PREMIUM_VARIANTS,
});

// Registered for catalog completeness; rendering remains held until midpoint review.
export const SCOREBOARD_SOCIAL_THEME = makeTheme({
  id: 'scoreboard', name: 'Scoreboard', tier: 'premium',
  supportedBrandingModes: ['white_label'],
  fonts: { display: 'Oswald', heading: 'IBM Plex Sans Condensed', body: 'IBM Plex Sans Condensed' },
  tokens: {
    background: '#0E261D', backgroundDeep: '#07150F', surface: '#F4F0E5',
    surfaceStrong: '#F4F0E5', hairline: 'rgba(244,240,229,.28)', text: '#F4F0E5',
    textMuted: 'rgba(244,240,229,.70)', textFaint: 'rgba(244,240,229,.48)',
    accent: '#5FAE74', secondary: '#D7E35D',
  },
  capabilities: { playerPhoto: true, teamPhoto: true, sponsors: true, accentOverride: false },
  variants: PREMIUM_VARIANTS,
});

export const EDITORIAL_SOCIAL_THEME = makeTheme({
  id: 'editorial', name: 'Editorial', tier: 'premium',
  supportedBrandingModes: ['white_label'],
  fonts: { display: 'Bodoni Moda', heading: 'Libre Franklin', body: 'Libre Franklin' },
  tokens: {
    background: '#F1ECE2', backgroundDeep: '#DED6C7', surface: '#F8F4EC',
    surfaceStrong: '#17181A', hairline: 'rgba(23,24,26,.24)', text: '#17181A',
    textMuted: 'rgba(23,24,26,.66)', textFaint: 'rgba(23,24,26,.44)',
    accent: '#6546C7', secondary: '#3156A3',
  },
  capabilities: { playerPhoto: true, teamPhoto: true, sponsors: true, accentOverride: false },
  variants: PREMIUM_VARIANTS,
});

export const SOCIAL_THEME_REGISTRY = Object.freeze([
  BASE_SOCIAL_THEME,
  HERITAGE_SOCIAL_THEME,
  STREET_SOCIAL_THEME,
  SCOREBOARD_SOCIAL_THEME,
  EDITORIAL_SOCIAL_THEME,
]);

export const SOCIAL_RESULTS_THEMES = SOCIAL_THEME_REGISTRY;
const THEMES_BY_ID = Object.freeze(Object.fromEntries(
  SOCIAL_THEME_REGISTRY.map((theme) => [theme.id, theme]),
));

export const CLASSIC_SOCIAL_THEME = BASE_SOCIAL_THEME;
export const DEFAULT_SOCIAL_THEME = BASE_SOCIAL_THEME;

export function resolveSocialTheme(theme = 'base', { strict = false } = {}) {
  if (theme && typeof theme === 'object') return theme;
  const id = theme === 'classic' ? 'base' : theme;
  const resolved = THEMES_BY_ID[id];
  if (!resolved && strict) {
    const error = new Error(`THEME_UNKNOWN: ${String(theme)}`);
    error.code = 'THEME_UNKNOWN';
    throw error;
  }
  return resolved || BASE_SOCIAL_THEME;
}

export function resolveSocialThemeLayout(themeId, familyId, formatId) {
  const theme = resolveSocialTheme(themeId, { strict: true });
  const family = theme.families[familyId];
  if (!family) {
    const error = new Error(`THEME_FAMILY_UNAVAILABLE: ${familyId}`);
    error.code = 'THEME_FAMILY_UNAVAILABLE';
    throw error;
  }
  const layout = family.layouts[formatId];
  if (!layout) {
    const error = new Error(`THEME_FORMAT_UNAVAILABLE: ${formatId}`);
    error.code = 'THEME_FORMAT_UNAVAILABLE';
    throw error;
  }
  return layout;
}

export default DEFAULT_SOCIAL_THEME;
