/*
 * Compatibility facade for the V2 Premium DOM renderer.
 *
 * The former generic Canvas midpoint has been retired. Product preview and PNG
 * export now dispatch to eight independent React/DOM compositions under
 * ./premium/generated.
 */

export { PREMIUM_REQUIRED_FONTS, ensurePremiumSocialFonts } from './premium/premiumFonts';
export {
  createPremiumDomRender,
  premiumDomToPngBlob,
  releasePremiumDomRender,
  waitForPremiumDomAssets,
} from './premium/premiumDomRenderer';
export { PREMIUM_DOM_LAYOUTS } from './premium/PremiumRenderer';

export const PREMIUM_THEME_IDS = Object.freeze([
  'heritage', 'street', 'scoreboard', 'editorial',
]);

// Kept explicit as a public contract for Equipo Ideal and its QA matrix.
export const PREMIUM_PITCH_LINE_LABELS = Object.freeze({
  DEL: 'DELANTEROS',
  MED: 'MEDIOCAMPO',
  DEF: 'DEFENSA',
  ARQ: 'ARQUERO',
});
export const PREMIUM_PITCH_LINE_ORDER = Object.freeze(['DEL', 'MED', 'DEF', 'ARQ']);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Useful non-visual helper preserved from the Canvas implementation. */
export function drawPremiumCoverImage(ctx, image, x, y, width, height, focal = {}) {
  if (!image?.width || !image?.height) return false;
  const fx = clamp(Number.isFinite(focal.x) ? focal.x : 0.5, 0, 1);
  const fy = clamp(Number.isFinite(focal.y) ? focal.y : 0.5, 0, 1);
  const scale = Math.max(width / image.width, height / image.height);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sx = (image.width - sourceWidth) * fx;
  const sy = (image.height - sourceHeight) * fy;
  ctx.drawImage(image, sx, sy, sourceWidth, sourceHeight, x, y, width, height);
  return true;
}

/** Compatibility sizing helper used by existing QA assertions. */
export function sponsorRailHeight(sponsors, isStory = false) {
  const renderable = Array.isArray(sponsors)
    ? sponsors.filter((entry) => entry?.image || entry?.src).slice(0, 3)
    : [];
  return renderable.length ? (isStory ? 112 : 88) : 0;
}

export function renderPremiumSocialPiece() {
  const error = new Error('PREMIUM_CANVAS_RENDERER_RETIRED');
  error.code = 'PREMIUM_CANVAS_RENDERER_RETIRED';
  throw error;
}
