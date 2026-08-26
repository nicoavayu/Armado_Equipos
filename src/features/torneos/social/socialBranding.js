const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function optionalText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalColor(value) {
  const color = optionalText(value);
  return HEX_COLOR.test(color) ? color.toUpperCase() : null;
}

/** Minimal, persistence-free branding boundary for the visual spike. */
export function normalizeSocialBranding(branding = {}, content = null) {
  const input = branding && typeof branding === 'object' ? branding : {};
  return Object.freeze({
    tournamentName: optionalText(input.tournamentName)
      || optionalText(content?.competition?.tournamentName),
    tournamentLogo: optionalText(input.tournamentLogo) || null,
    primaryColor: optionalColor(input.primaryColor),
    secondaryColor: optionalColor(input.secondaryColor),
  });
}

/** Tournament colors are accents, never a wholesale template recolor. */
export function resolveBrandingAccent(branding, fallback, theme) {
  if (theme.id === 'street') return branding.primaryColor || theme.violet || fallback;
  if (theme.id === 'editorial') return branding.secondaryColor || branding.primaryColor || fallback;
  return fallback;
}
