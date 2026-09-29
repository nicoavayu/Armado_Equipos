// Pure rules for Amigos > Comunidad user search: when a query is specific
// enough to hit the backend. Anything under the minimum never leaves the
// device and never shows results.

export const COMMUNITY_SEARCH_MIN_CHARS = 3;
export const COMMUNITY_SEARCH_DEBOUNCE_MS = 250;
export const COMMUNITY_SEARCH_MIN_CHARS_HINT = 'Escribí al menos 3 letras para buscar';

/** Trim and collapse inner whitespace. @param {string} raw @returns {string} */
export const normalizeCommunitySearchQuery = (raw) => String(raw ?? '').replace(/\s+/g, ' ').trim();

/** Useful characters = everything except whitespace. @param {string} raw @returns {number} */
export const countCommunitySearchChars = (raw) => normalizeCommunitySearchQuery(raw).replace(/\s/g, '').length;

/** @param {string} raw @returns {boolean} */
export const isCommunitySearchReady = (raw) => countCommunitySearchChars(raw) >= COMMUNITY_SEARCH_MIN_CHARS;
