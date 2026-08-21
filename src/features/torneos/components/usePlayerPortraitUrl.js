/**
 * Resolución de firmas para retratos privados.
 *
 * El caché con la expiración real de la firma, el reintento único y la regla de
 * no cancelar una firma compartida viven en `useSignedImageUrl`, porque son los
 * mismos para cualquier imagen privada del producto. Acá queda lo que sí es del
 * retrato: a qué resolver se le pregunta y que el punto focal viaje al lado de
 * la URL, que es lo que consumen las cards.
 */

import { resolvePlayerPortrait } from '../api/tournamentPlayerPortraitService';
import { createSignedImageUrl } from './useSignedImageUrl';

const portraits = createSignedImageUrl(resolvePlayerPortrait);

export function invalidatePlayerPortraitUrl(ref) {
  portraits.invalidate(ref);
}

export function clearPlayerPortraitUrlCache() {
  portraits.clear();
}

export function getPlayerPortraitUrl(ref, options = {}) {
  return portraits.get(ref, options);
}

/**
 * @returns {{status: 'empty'|'loading'|'ready'|'error', url: string|null,
 *   focal: {x: number, y: number}|null, retry: () => void, reportImageError: () => void}}
 */
export function usePlayerPortraitUrl(ref) {
  const { resolved, ...state } = portraits.useSignedUrl(ref);
  return { ...state, focal: resolved?.focal || null };
}
