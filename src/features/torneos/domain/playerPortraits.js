export const PLAYER_PORTRAIT_KIND = 'player_portrait';
export const PLAYER_PORTRAIT_VARIANTS = Object.freeze([
  'original', 'square', 'portrait', 'social',
]);
export const PLAYER_PORTRAIT_ENABLED_AUDIENCES = Object.freeze([
  'authenticated_roster',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function playerPortraitRef(id, variant = 'original') {
  if (!UUID_RE.test(String(id)) || !PLAYER_PORTRAIT_VARIANTS.includes(variant)) {
    throw new TypeError('Invalid player portrait reference.');
  }
  return Object.freeze({ kind: PLAYER_PORTRAIT_KIND, id, variant });
}

export function isPlayerPortraitRef(value) {
  return value?.kind === PLAYER_PORTRAIT_KIND
    && UUID_RE.test(String(value.id))
    && PLAYER_PORTRAIT_VARIANTS.includes(value.variant);
}
