// The pure half of the Torneos branding domain: limits, the versioned object path and the file preparation. No
// client and no network, so every composition (LOCAL service, hybrid adapter) can reuse the same rules.
import { v4 as uuidv4 } from 'uuid';
import { prepareUploadPayload } from './mediaImageClient';

export const BRANDING_BUCKET = 'tournament-branding';
export const BRANDING_ALLOWED_MIME = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
export const BRANDING_LIMITS = Object.freeze({
  maxFileBytes: 2 * 1024 * 1024,
  maxSelectedFileBytes: 10 * 1024 * 1024,
  maxPixels: 4_000_000,
  maxEdge: 2048,
  resizeToFit: true,
  allowHeicTranscode: false,
});

const ENTITY_FOLDERS = Object.freeze({
  organization: 'organizations',
  tournament: 'tournaments',
  team: 'teams',
});
const MIME_EXTENSION = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});
const FILE_EXTENSIONS = Object.freeze({
  'image/jpeg': Object.freeze(['jpg', 'jpeg']),
  'image/png': Object.freeze(['png']),
  'image/webp': Object.freeze(['webp']),
});
const VERSIONED_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(organizations|tournaments|teams)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

function extensionOf(name = '') {
  return String(name).trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
}

export function validateBrandingFile(file) {
  if (!file) return { valid: false, code: 'missing', message: 'Elegí una imagen.' };
  if (!BRANDING_ALLOWED_MIME.includes(file.type)) {
    return {
      valid: false,
      code: 'mime',
      message: 'Formato no admitido. Usá PNG, JPEG o WebP.',
    };
  }
  if (!FILE_EXTENSIONS[file.type]?.includes(extensionOf(file.name))) {
    return {
      valid: false,
      code: 'extension',
      message: 'La extensión no coincide con el formato de la imagen.',
    };
  }
  if (!Number.isFinite(file.size) || file.size < 1) {
    return { valid: false, code: 'size', message: 'La imagen está vacía.' };
  }
  if (file.size > BRANDING_LIMITS.maxSelectedFileBytes) {
    return {
      valid: false,
      code: 'size',
      message: 'La imagen seleccionada supera los 10 MB.',
    };
  }
  return { valid: true, code: null, message: '' };
}

export function isVersionedBrandingPath(path, kind = null) {
  if (typeof path !== 'string' || !VERSIONED_PATH.test(path)) return false;
  return !kind || path.split('/')[1] === ENTITY_FOLDERS[kind];
}

export function buildBrandingPath({ organizationId, kind, entityId, mime }) {
  const folder = ENTITY_FOLDERS[kind];
  const extension = MIME_EXTENSION[mime];
  if (!folder || !organizationId || !entityId || !extension) {
    throw new Error('No pudimos preparar la referencia de branding.');
  }
  return `${organizationId}/${folder}/${entityId}/${uuidv4()}.${extension}`;
}

export async function prepareBrandingFile(file) {
  const validation = validateBrandingFile(file);
  if (!validation.valid) {
    const error = new Error(validation.message);
    error.code = validation.code;
    throw error;
  }
  return prepareUploadPayload(file, { limits: BRANDING_LIMITS });
}
