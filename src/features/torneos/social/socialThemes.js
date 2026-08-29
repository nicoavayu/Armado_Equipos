const sharedTypography = Object.freeze({
  display: 'Bebas Neue',
  heading: 'Oswald',
  body: 'Inter',
});

export const BASE_SOCIAL_THEME = Object.freeze({
  id: 'base',
  label: 'Base',
  background: '#08090C',
  backgroundDeep: '#11131A',
  surface: 'rgba(255, 255, 255, 0.035)',
  surfaceStrong: '#F4F1EA',
  hairline: 'rgba(255, 255, 255, 0.16)',
  text: '#F7F5F0',
  textMuted: 'rgba(247, 245, 240, 0.68)',
  textFaint: 'rgba(247, 245, 240, 0.42)',
  electricBlue: '#3B82F6',
  violet: '#9D7BFF',
  ...sharedTypography,
  lineWidth: 2,
  radii: Object.freeze({ card: 0, match: 0 }),
  shadows: Object.freeze({ card: null }),
  accentBehavior: Object.freeze({ defaultAccentId: 'violeta', backdropOpacity: 0.18 }),
});

export const STREET_SOCIAL_THEME = Object.freeze({
  id: 'street',
  label: 'Street',
  background: '#11100E',
  backgroundDeep: '#1A1814',
  surface: '#EAE4D8',
  surfaceStrong: '#F7F1E5',
  hairline: 'rgba(247, 241, 229, 0.30)',
  text: '#F7F1E5',
  textMuted: 'rgba(247, 241, 229, 0.72)',
  textFaint: 'rgba(247, 241, 229, 0.48)',
  electricBlue: '#40D7FF',
  violet: '#EF3D2F',
  ...sharedTypography,
  lineWidth: 2,
  radii: Object.freeze({ card: 0, match: 0 }),
  shadows: Object.freeze({ card: null }),
  accentBehavior: Object.freeze({ defaultAccentId: 'violeta', backdropOpacity: 0 }),
});

export const EDITORIAL_SOCIAL_THEME = Object.freeze({
  id: 'editorial',
  label: 'Editorial',
  background: '#F1ECE2',
  backgroundDeep: '#DED6C7',
  surface: '#F8F4EC',
  surfaceStrong: '#17181A',
  hairline: 'rgba(23, 24, 26, 0.24)',
  text: '#17181A',
  textMuted: 'rgba(23, 24, 26, 0.66)',
  textFaint: 'rgba(23, 24, 26, 0.44)',
  electricBlue: '#3156A3',
  violet: '#6546C7',
  ...sharedTypography,
  lineWidth: 1,
  radii: Object.freeze({ card: 0, match: 0 }),
  shadows: Object.freeze({ card: null }),
  accentBehavior: Object.freeze({ defaultAccentId: 'violeta', backdropOpacity: 0 }),
});

export const SOCIAL_RESULTS_THEMES = Object.freeze([
  BASE_SOCIAL_THEME,
  STREET_SOCIAL_THEME,
  EDITORIAL_SOCIAL_THEME,
]);

const THEMES_BY_ID = Object.freeze(Object.fromEntries(
  SOCIAL_RESULTS_THEMES.map((theme) => [theme.id, theme]),
));

// Compatibility alias for saved local UI state from the pre-Base spike.
export const CLASSIC_SOCIAL_THEME = BASE_SOCIAL_THEME;

/** Unknown ids resolve to Base; explicit theme objects remain testable dependencies. */
export function resolveSocialTheme(theme = 'classic') {
  if (theme && typeof theme === 'object') return theme;
  if (theme === 'classic') return BASE_SOCIAL_THEME;
  return THEMES_BY_ID[theme] || BASE_SOCIAL_THEME;
}

export const DEFAULT_SOCIAL_THEME = BASE_SOCIAL_THEME;

export default DEFAULT_SOCIAL_THEME;
