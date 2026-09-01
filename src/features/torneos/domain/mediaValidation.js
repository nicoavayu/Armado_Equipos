export const MEDIA_LIMITS = Object.freeze({
  maxFileBytes: 12 * 1024 * 1024,
  maxPixels: 36_000_000,
  maxBatchFiles: 40,
});

export const MEDIA_MIME_EXTENSIONS = Object.freeze({
  'image/jpeg': Object.freeze(['jpg', 'jpeg']),
  'image/png': Object.freeze(['png']),
  'image/webp': Object.freeze(['webp']),
});

export const MEDIA_VISIBILITIES = Object.freeze([
  'organization',
  'tournament_participants',
  'match_participants',
  'related_teams',
  'administrative_private',
]);

function extensionOf(name = '') {
  const match = String(name).trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

export function validateTournamentMediaFile(file, limits = MEDIA_LIMITS) {
  if (!file) return { valid: false, code: 'missing', message: 'Elegí un archivo.' };
  const extensions = MEDIA_MIME_EXTENSIONS[file.type];
  if (!extensions) {
    return {
      valid: false,
      code: 'mime',
      message: 'Formato no admitido. Usá JPEG, PNG o WebP.',
    };
  }
  if (!extensions.includes(extensionOf(file.name))) {
    return {
      valid: false,
      code: 'extension',
      message: 'La extensión no coincide con el formato detectado.',
    };
  }
  if (!Number.isFinite(file.size) || file.size < 1 || file.size > limits.maxFileBytes) {
    return {
      valid: false,
      code: 'size',
      message: `La foto debe pesar menos de ${Math.floor(limits.maxFileBytes / 1024 / 1024)} MB.`,
    };
  }
  return { valid: true, code: null, message: '' };
}

export function prepareTournamentMediaBatch(files, limits = MEDIA_LIMITS) {
  const selected = Array.from(files || []).slice(0, limits.maxBatchFiles);
  return selected.map((file, index) => {
    const validation = validateTournamentMediaFile(file, limits);
    return {
      id: `${file.name}:${file.size}:${file.lastModified || 0}:${index}`,
      file,
      safeName: `Foto ${String(index + 1).padStart(2, '0')}`,
      status: validation.valid ? 'ready' : 'invalid',
      error: validation.message,
      progress: 0,
      session: null,
    };
  });
}

export function formatMediaBytes(bytes) {
  if (!Number.isFinite(Number(bytes))) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function getMediaAssetUrl(asset, variant = 'grid') {
  if (!asset) return '';
  if (variant === 'detail') {
    return asset.detailUrl || asset.gridUrl || asset.thumbnailUrl || '';
  }
  return asset.gridUrl || asset.thumbnailUrl || '';
}
