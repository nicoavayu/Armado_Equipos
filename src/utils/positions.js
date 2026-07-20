// Shared player-position helpers.
//
// Positions are stored on `usuarios.posiciones` (text[], max 2, no duplicates,
// values in ARQ/DEF/MED/DEL). The legacy single `usuarios.posicion` column is
// kept in sync (posiciones[0]) by a DB trigger for backward compatibility.
//
// These helpers are the single client-side source of truth for normalizing,
// validating and displaying positions, so the profile editor, profile card,
// mini cards, goalkeeper market and join flow all agree.

export const POSITION_KEYS = ['ARQ', 'DEF', 'MED', 'DEL'];

export const MAX_POSITIONS = 2;

export const GOALKEEPER_POSITION = 'ARQ';

export const POSITION_LABELS = {
  ARQ: 'ARQ',
  DEF: 'DEF',
  MED: 'MED',
  DEL: 'DEL',
};

export const POSITION_LONG_LABELS = {
  ARQ: 'Arquero',
  DEF: 'Defensor',
  MED: 'Mediocampista',
  DEL: 'Delantero',
};

export const POSITION_COLORS = {
  ARQ: '#FDB022',
  DEF: '#FF6B9D',
  MED: '#06C270',
  DEL: '#FF3B3B',
};

const TOKEN_MAP = {
  ARQ: 'ARQ', ARQUERO: 'ARQ', GK: 'ARQ', PORTERO: 'ARQ',
  DEF: 'DEF', DEFENSOR: 'DEF', DEFENSA: 'DEF',
  MED: 'MED', MEDIOCAMPISTA: 'MED', MEDIO: 'MED', VOL: 'MED',
  DEL: 'DEL', DELANTERO: 'DEL', ATACANTE: 'DEL',
};

/**
 * Normalize a single raw token to a canonical position key, or null.
 * @param {string} raw
 * @returns {('ARQ'|'DEF'|'MED'|'DEL'|null)}
 */
export const normalizePositionToken = (raw) => {
  const key = String(raw == null ? '' : raw).trim().toUpperCase();
  if (!key) return null;
  return TOKEN_MAP[key] || null;
};

/**
 * Normalize an arbitrary positions input (array, comma/slash separated string,
 * or single token) into a deduped, validated, capped array of canonical keys.
 * @param {(string|string[]|null|undefined)} input
 * @param {number} [max=MAX_POSITIONS]
 * @returns {string[]}
 */
export const normalizePositions = (input, max = MAX_POSITIONS) => {
  let list = [];
  if (Array.isArray(input)) {
    list = input;
  } else if (typeof input === 'string') {
    list = input.split(/[,/|]/);
  } else if (input != null) {
    list = [input];
  }

  const out = [];
  for (const raw of list) {
    const norm = normalizePositionToken(raw);
    if (norm && !out.includes(norm)) {
      out.push(norm);
      if (out.length >= max) break;
    }
  }
  return out;
};

/**
 * Read the canonical positions of a profile-shaped object, checking the array
 * column first and falling back to the legacy single field.
 * @param {object} profile
 * @returns {string[]}
 */
export const getProfilePositions = (profile) => {
  if (!profile) return [];
  if (Array.isArray(profile.posiciones) && profile.posiciones.length > 0) {
    return normalizePositions(profile.posiciones);
  }
  return normalizePositions(profile.posicion || profile.rol_favorito || '');
};

/**
 * Positions for DISPLAY: same as getProfilePositions but never empty — falls
 * back to ['DEF'] so cards always render a position badge (matches legacy UI).
 * @param {object} profile
 * @returns {string[]}
 */
export const getDisplayPositions = (profile) => {
  const positions = getProfilePositions(profile);
  return positions.length > 0 ? positions : ['DEF'];
};

/**
 * @param {object} profile
 * @returns {boolean} whether the profile lists ARQ among its positions.
 */
export const hasGoalkeeperPosition = (profile) => getProfilePositions(profile).includes(GOALKEEPER_POSITION);

/**
 * Apply a toggle to a selection under the "max N, no duplicates" rule.
 * Selecting a present key removes it; selecting a new key adds it only when
 * under the cap.
 * @param {string[]} current
 * @param {string} key
 * @param {number} [max=MAX_POSITIONS]
 * @returns {string[]}
 */
export const togglePosition = (current, key, max = MAX_POSITIONS) => {
  const norm = normalizePositionToken(key);
  if (!norm) return normalizePositions(current, max);
  const base = normalizePositions(current, max);
  if (base.includes(norm)) {
    return base.filter((p) => p !== norm);
  }
  if (base.length >= max) return base;
  return [...base, norm];
};

/** @param {string} key @returns {string} color hex for a position key. */
export const getPositionColor = (key) => POSITION_COLORS[normalizePositionToken(key)] || '#8178e5';
