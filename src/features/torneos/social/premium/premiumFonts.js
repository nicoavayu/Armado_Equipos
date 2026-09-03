export const PREMIUM_REQUIRED_FONTS = Object.freeze({
  heritage: Object.freeze([
    '400 96px "Anton"',
    '700 34px "Barlow Condensed"',
    '600 24px "Barlow Semi Condensed"',
  ]),
  street: Object.freeze([
    '400 86px "Archivo Black"',
    '700 34px "Archivo Narrow"',
    '500 24px "Archivo Narrow"',
  ]),
  scoreboard: Object.freeze([
    '700 96px "Oswald"',
    '600 34px "IBM Plex Sans Condensed"',
    '400 24px "IBM Plex Sans Condensed"',
  ]),
  editorial: Object.freeze([
    '700 96px "Bodoni Moda"',
    '600 34px "Libre Franklin"',
    '400 24px "Libre Franklin"',
  ]),
});

export async function ensurePremiumSocialFonts(themeId) {
  const required = PREMIUM_REQUIRED_FONTS[themeId];
  if (!required) throw new Error(`PREMIUM_THEME_UNSUPPORTED: ${String(themeId)}`);
  if (typeof document === 'undefined' || !document.fonts) return;
  const sample = 'Arma2 ÁÉÍÓÚ Ñ resultados próxima fecha campeón';
  await document.fonts.ready;
  await Promise.all(required.map((font) => document.fonts.load(font, sample)));
  await document.fonts.ready;
  const missing = required.filter((font) => !document.fonts.check(font, sample));
  if (missing.length) throw new Error(`PREMIUM_FONT_UNAVAILABLE: ${missing.join(', ')}`);
}
