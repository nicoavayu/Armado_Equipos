/**
 * Resolución de firmas para la foto privada del equipo.
 *
 * Mismo caché, misma expiración real y mismo reintento único que el retrato:
 * la mecánica vive en `useSignedImageUrl` y acá sólo se elige el resolver.
 */

import { resolveTeamPhoto } from '../api/tournamentTeamPhotoService';
import { createSignedImageUrl } from './useSignedImageUrl';

const teamPhotos = createSignedImageUrl(resolveTeamPhoto);

export function invalidateTeamPhotoUrl(ref) {
  teamPhotos.invalidate(ref);
}

export function clearTeamPhotoUrlCache() {
  teamPhotos.clear();
}

export function getTeamPhotoUrl(ref, options = {}) {
  return teamPhotos.get(ref, options);
}

/**
 * @returns {{status: 'empty'|'loading'|'ready'|'error', url: string|null,
 *   retry: () => void, reportImageError: () => void}}
 */
export function useTeamPhotoUrl(ref) {
  const { resolved, ...state } = teamPhotos.useSignedUrl(ref);
  return { ...state, natural: resolved ? { width: resolved.width, height: resolved.height } : null };
}
