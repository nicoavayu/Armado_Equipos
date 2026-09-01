/**
 * Browser-side mirror of the Multimedia pipeline contract.
 *
 * The same numbers exist in three places on purpose, because all three have to
 * agree before a byte moves:
 *   - `public.tournament_media_variant_box` / `_geometry` (PostgreSQL)
 *   - `supabase/functions/_shared/tournamentMediaContract.ts` (processor)
 *   - this file (browser)
 *
 * The processor recomputes the geometry from the dimensions it measured itself
 * and refuses anything that does not match, so a drift here is a rejected
 * upload rather than a silently wrong variant. Tests pin all three together.
 */

export const MEDIA_LIMITS = Object.freeze({
  maxFileBytes: 12 * 1024 * 1024,
  maxSelectedFileBytes: 48 * 1024 * 1024,
  maxPixels: 36_000_000,
  maxEdge: 12_000,
  maxBatchFiles: 40,
  maxConcurrentUploads: 3,
  allowHeicTranscode: true,
  resizeToFit: false,
});

// Temporary reduced-security tier. These values intentionally do not replace
// the external processor contract above: the backend selects one complete set
// or the other and the browser mirrors that decision.
export const MVP_SIMPLE_MEDIA_LIMITS = Object.freeze({
  maxSelectedFileBytes: 8 * 1024 * 1024,
  maxFileBytes: 4 * 1024 * 1024,
  maxPixels: 2_560_000,
  maxEdge: 1600,
  maxBatchFiles: 10,
  maxConcurrentUploads: 2,
  allowHeicTranscode: false,
  resizeToFit: true,
});

export const MEDIA_VARIANT_BOX = Object.freeze({
  thumbnail: 320,
  grid: 800,
  detail: 1600,
});

export const MEDIA_DERIVED_KINDS = Object.freeze(['thumbnail', 'grid', 'detail']);

export const MEDIA_UPLOAD_MIME = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Formats the browser can decode but the pipeline cannot store. They are
 * accepted at selection time and re-encoded to JPEG locally; if the browser
 * turns out not to decode them, the file is rejected with a clear message
 * rather than uploaded as something it is not.
 */
export const MEDIA_TRANSCODABLE_MIME = Object.freeze([
  'image/heic', 'image/heif',
]);

/** Deterministic "fit inside a box, never upscale". `floor(x + 0.5)` matches SQL. */
export function variantGeometry(kind, width, height) {
  const box = MEDIA_VARIANT_BOX[kind];
  if (!box) return null;
  const longest = Math.max(width, height);
  if (longest <= box) return { kind, width, height };
  return {
    kind,
    width: Math.max(1, Math.floor((width * box) / longest + 0.5)),
    height: Math.max(1, Math.floor((height * box) / longest + 0.5)),
  };
}

export function variantPlan(width, height) {
  return MEDIA_DERIVED_KINDS.map((kind) => variantGeometry(kind, width, height));
}

/**
 * The upload state machine, in the order the user sees it. `staging_required`
 * is not a step: it is the terminal state when the environment has no
 * certified pipeline, and it is derived from the backend, never assumed.
 */
export const MEDIA_UPLOAD_STATES = Object.freeze([
  'ready',
  'preparing',
  'uploading',
  'processing',
  'pending_review',
  'error',
  'cancelled',
  'invalid',
  'staging_required',
]);

export const MEDIA_UPLOAD_STATE_LABELS = Object.freeze({
  ready: 'Lista para subir',
  preparing: 'Preparando',
  uploading: 'Subiendo',
  processing: 'Procesando',
  pending_review: 'Pendiente de aprobación',
  error: 'Con error',
  cancelled: 'Cancelada',
  invalid: 'No admitida',
  staging_required: 'Carga no disponible',
});

export const MEDIA_ASSET_STATE_LABELS = Object.freeze({
  uploading: 'Subiendo',
  processing: 'Procesando',
  pending_review: 'Pendiente de aprobación',
  approved: 'Aprobada',
  published: 'Publicada',
  rejected: 'Rechazada',
  hidden: 'Oculta',
  revoked: 'Consentimiento revocado',
  failed: 'Con error',
});

/** Error codes the signer and processor return, in product language. */
const PIPELINE_MESSAGES = Object.freeze({
  auth_required: 'Tu sesión venció. Volvé a iniciar sesión y reintentá.',
  forbidden: 'No tenés permiso para cargar en esta galería.',
  upload_session_invalid: 'La preparación de esta foto venció. Reintentá para empezar de nuevo.',
  duplicate_asset: 'Esa foto ya está en el archivo de la organización.',
  quota_exceeded: 'La galería alcanzó su límite de espacio.',
  source_object_missing: 'La foto no llegó completa. Reintentá.',
  source_size_mismatch: 'La foto no llegó completa. Reintentá.',
  source_rejected: 'No pudimos verificar esta imagen. Probá con otro archivo.',
  variant_rejected: 'No pudimos preparar las versiones de esta foto. Reintentá.',
  variant_missing: 'No pudimos preparar las versiones de esta foto. Reintentá.',
  variant_geometry_mismatch: 'No pudimos preparar las versiones de esta foto. Reintentá.',
  variant_size_invalid: 'No pudimos preparar las versiones de esta foto. Reintentá.',
  processing_required: 'La foto todavía se está procesando.',
  storage_unavailable: 'El servicio de fotos no está disponible en este momento.',
  delete_storage_failed: 'No pudimos terminar de eliminar la foto. Reintentá.',
  delete_finalize_failed: 'La foto quedó pendiente de eliminación. Reintentá para completarla.',
  delete_contract_invalid: 'No pudimos eliminar la foto de forma segura.',
  media_service_failed: 'No pudimos completar la carga. Reintentá en unos minutos.',
  signer_failed: 'No pudimos completar la carga. Reintentá en unos minutos.',
  rate_limited: 'Preparaste muchas fotos seguidas. Esperá unos minutos y reintentá.',
});

/**
 * Content-level rejections from the processor. These are the user's problem to
 * fix, so they say what is wrong with the file — without ever echoing a path,
 * a bucket or an internal identifier.
 */
const CONTENT_MESSAGES = Object.freeze({
  MEDIA_MIME_MISMATCH: 'El archivo no es una foto JPEG, PNG o WebP real.',
  MEDIA_MIME_UNSUPPORTED: 'Formato no admitido. Usá JPEG, PNG o WebP.',
  MEDIA_CONTENT_CORRUPT: 'La imagen está dañada o incompleta.',
  MEDIA_TRAILING_BYTES: 'El archivo tiene contenido extra después de la imagen.',
  MEDIA_ANIMATION_UNSUPPORTED: 'Las imágenes animadas todavía no se admiten.',
  MEDIA_DIMENSIONS_INVALID: 'La foto excede las dimensiones permitidas.',
  MEDIA_TOO_LARGE: 'La foto supera el límite permitido.',
  MEDIA_EMPTY: 'El archivo está vacío.',
  MEDIA_ORIENTATION_NOT_NORMALIZED: 'No pudimos normalizar la orientación. Reintentá.',
  MEDIA_METADATA_PRESENT: 'No pudimos limpiar los metadatos de la foto. Reintentá.',
  MEDIA_UNKNOWN_CRITICAL_CHUNK: 'La imagen usa una función que no admitimos.',
});

export function describeMediaPipelineError(error, code) {
  if (code && CONTENT_MESSAGES[code]) return CONTENT_MESSAGES[code];
  if (error && PIPELINE_MESSAGES[error]) return PIPELINE_MESSAGES[error];
  return 'No pudimos completar la carga. Reintentá en unos minutos.';
}

/**
 * Whether the environment can actually accept a file right now.
 *
 * Every input comes from the backend's own readiness projection. Nothing here
 * is optimistic: an absent `storage` object means not ready.
 */
export function resolveUploadCapability(storage, { canUpload = false } = {}) {
  const ready = storage?.uploadReady === true;
  const blockers = Array.isArray(storage?.blockers) ? storage.blockers : [];
  let readinessState = 'unknown_error';
  if (ready) readinessState = 'ready';
  else if (blockers.includes('storage.bucket_absent')) readinessState = 'bucket_missing';
  else if (blockers.some((blocker) => [
    'storage.client_write_open',
    'storage.service_policies_absent',
  ].includes(blocker))) readinessState = 'permission_error';
  else if (blockers.some((blocker) => [
    'storage.bucket_public',
    'storage.schema_absent',
    'simple.contract_absent',
    'pipeline.disabled',
  ].includes(blocker))) readinessState = 'configuration_error';
  else if (blockers.length > 0) readinessState = 'service_unavailable';

  const unavailableCopy = {
    bucket_missing: 'El almacenamiento privado de fotos todavía no está preparado.',
    permission_error: 'No pudimos verificar permisos seguros para las fotos.',
    configuration_error: 'La configuración segura de fotos necesita revisión.',
    service_unavailable: 'El servicio de fotos todavía no completó sus verificaciones.',
    unknown_error: 'La carga de fotos todavía no está habilitada en este entorno.',
  }[readinessState];
  const readinessLabel = {
    ready: 'Activa',
    bucket_missing: 'Falta configurar',
    permission_error: 'Revisar acceso',
    configuration_error: 'Revisar configuración',
    service_unavailable: 'No disponible',
    unknown_error: 'No disponible',
  }[readinessState];
  const processingTier = storage?.processingTier || 'processor_external';
  return {
    canOfferUpload: ready && canUpload,
    uploadReady: ready,
    blockers,
    readinessState,
    readinessLabel,
    // Product copy never names the bucket, the signer or the environment.
    unavailableCopy: canUpload
      ? unavailableCopy
      : 'Tu rol puede consultar Multimedia, sin cargar fotos.',
    readyCopy: processingTier === 'mvp_simple'
      ? 'Cada imagen se normaliza y valida antes de quedar pendiente de aprobación.'
      : 'Cada foto se verifica y se limpia antes de quedar pendiente de aprobación.',
    pixelTranscode: storage?.pixelTranscode === true,
    antivirusScanning: storage?.antivirusScanning === true,
    maxFileBytes: Number(storage?.maxFileBytes) || MEDIA_LIMITS.maxFileBytes,
    maxSelectedFileBytes: Number(storage?.maxSelectedFileBytes)
      || MEDIA_LIMITS.maxSelectedFileBytes,
    maxPixels: Number(storage?.maxPixels) || MEDIA_LIMITS.maxPixels,
    maxEdge: Number(storage?.maxEdge) || MEDIA_LIMITS.maxEdge,
    maxBatchFiles: Number(storage?.maxBatchFiles) || MEDIA_LIMITS.maxBatchFiles,
    maxConcurrentUploads: Number(storage?.maxConcurrentUploads)
      || MEDIA_LIMITS.maxConcurrentUploads,
    allowHeicTranscode: storage?.allowHeicTranscode !== false,
    processingTier,
    resizeToFit: processingTier === 'mvp_simple',
    signedUrlTtlSeconds: Number(storage?.signedUrlTtlSeconds) || 300,
  };
}

export function formatMediaBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value)) return '—';
  if (value < 1024) return `${Math.max(1, Math.round(value))} B`;
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * A display-only name. The real filename never leaves the browser: the upload
 * intent is opened with a synthetic name so that nothing derived from the
 * user's filesystem — a person's name, a club, a date — reaches the server or
 * the object path.
 */
export function localDisplayName(file, index) {
  const raw = String(file?.name || '').trim();
  const withoutExtension = raw.replace(/\.[A-Za-z0-9]+$/, '');
  const cleaned = withoutExtension
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .replace(/\s+/g, ' ')
    .slice(0, 48)
    .trim();
  return cleaned || `Foto ${String(index + 1).padStart(2, '0')}`;
}

export function syntheticUploadName(mime) {
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime];
  return extension ? `upload.${extension}` : 'upload.jpg';
}
