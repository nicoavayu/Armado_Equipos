/**
 * Foto del equipo (Multimedia 1C.3B).
 *
 * No es el escudo. El escudo es la marca del equipo: vive en un bucket público,
 * se dibuja chiquita al lado del nombre y cambiarla es un dato del equipo. Esto
 * es una fotografía de personas: vive en un bucket privado, se dibuja grande y
 * publicarla es una decisión editorial de la organización. Los dos conviven y
 * ninguno reemplaza al otro; cuando no hay foto aprobada, el escudo es el
 * fallback.
 *
 * La referencia durable es `ImageRef`: nunca un bucket, un path ni una URL
 * firmada.
 */

import { MediaClientError, prepareUploadPayload } from './mediaImageClient';

export const TEAM_PHOTO_KIND = 'team_photo';
export const TEAM_PHOTO_VARIANTS = Object.freeze(['original']);
/**
 * Una sola audiencia habilitada, igual que el retrato en 1C.2A. `public_page` y
 * `social_export` no están acá porque no están habilitadas en el servidor: la
 * página pública y Social Studio no consumen esta foto en 1C.3B, y pedirlas
 * devuelve `audience_disabled`.
 */
export const TEAM_PHOTO_ENABLED_AUDIENCES = Object.freeze(['authenticated_team']);

export const TEAM_PHOTO_BUCKET = 'tournament-team-photos';
export const TEAM_PHOTO_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const TEAM_PHOTO_ALLOWED_MIME = Object.freeze([
  'image/jpeg', 'image/png', 'image/webp',
]);

/**
 * Los mismos límites que el retrato, y por la misma razón: el techo del
 * contrato es lo que el servidor rechaza, no un objetivo. La normalización del
 * navegador se queda muy por debajo para que el original guardado sea manejable.
 *
 * La única diferencia con el retrato es `maxEdge`: una foto grupal se mira
 * ancha y con caras chicas, así que necesita más resolución horizontal que un
 * retrato individual para que se distinga quién es quién.
 */
export const TEAM_PHOTO_LIMITS = Object.freeze({
  maxFileBytes: TEAM_PHOTO_MAX_FILE_BYTES,
  maxSelectedFileBytes: TEAM_PHOTO_MAX_FILE_BYTES,
  maxPixels: 9_000_000,
  maxEdge: 4000,
  resizeToFit: true,
  // No hay decodificador HEIC/HEIF confiable en el navegador: sin conversión
  // real, se rechaza en vez de prometer una que no existe.
  allowHeicTranscode: false,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_EXTENSIONS = Object.freeze({
  'image/jpeg': Object.freeze(['jpg', 'jpeg']),
  'image/png': Object.freeze(['png']),
  'image/webp': Object.freeze(['webp']),
});

export function teamPhotoRef(id, variant = 'original') {
  if (!UUID_RE.test(String(id)) || !TEAM_PHOTO_VARIANTS.includes(variant)) {
    throw new TypeError('Invalid team photo reference.');
  }
  return Object.freeze({ kind: TEAM_PHOTO_KIND, id, variant });
}

export function isTeamPhotoRef(value) {
  return value?.kind === TEAM_PHOTO_KIND
    && UUID_RE.test(String(value.id))
    && TEAM_PHOTO_VARIANTS.includes(value.variant);
}

function extensionOf(name = '') {
  return String(name).trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
}

/**
 * Pre-flight de la selección. No es la frontera de seguridad —el Edge function
 * y la base vuelven a validar todo— pero evita mandar al servidor lo que ya se
 * sabe que va a rechazar y permite explicar el motivo en castellano.
 */
export function validateTeamPhotoFile(file) {
  if (!file) return { valid: false, code: 'missing', message: 'Elegí una imagen.' };
  const mime = String(file.type || '').toLowerCase();
  if (!TEAM_PHOTO_ALLOWED_MIME.includes(mime)) {
    return {
      valid: false,
      code: 'mime',
      message: 'Formato no admitido. Usá JPEG, PNG o WebP.',
    };
  }
  if (!FILE_EXTENSIONS[mime].includes(extensionOf(file.name))) {
    return {
      valid: false,
      code: 'extension',
      message: 'La extensión no coincide con el formato de la imagen.',
    };
  }
  if (!Number.isFinite(file.size) || file.size < 1) {
    return { valid: false, code: 'size', message: 'La imagen está vacía.' };
  }
  if (file.size > TEAM_PHOTO_MAX_FILE_BYTES) {
    return { valid: false, code: 'size', message: 'La foto supera los 8 MB.' };
  }
  return { valid: true, code: null, message: '' };
}

export async function prepareTeamPhotoFile(file) {
  const validation = validateTeamPhotoFile(file);
  if (!validation.valid) {
    throw new MediaClientError(validation.code, validation.message);
  }
  return prepareUploadPayload(file, { limits: TEAM_PHOTO_LIMITS });
}

/**
 * Las tres cosas que le pueden pasar a la foto que subió el equipo. Es el mismo
 * vocabulario editorial de galerías y retratos —no hay taxonomía nueva—, sólo
 * escrito para esta pantalla.
 */
export const TEAM_PHOTO_EDITORIAL_LABELS = Object.freeze({
  pending_review: 'En revisión',
  approved: 'Publicada',
  rejected: 'Rechazada',
});

export const TEAM_PHOTO_EDITORIAL_HINTS = Object.freeze({
  pending_review: 'La organización todavía no la revisó. Hasta que la apruebe, el equipo sigue mostrando la foto vigente.',
  approved: 'Es la foto que ve el equipo.',
  rejected: 'La organización no la aprobó. La foto vigente no cambió.',
});

/**
 * Qué se muestra, dado el estado completo del equipo. Una sola función para que
 * la pantalla no vuelva a decidirlo en cada lugar donde dibuja algo, y para que
 * la regla —nunca `pending`, nunca `rejected`, nunca un objeto privado suelto—
 * se pueda leer y testear entera.
 *
 * `unknown` es deliberado: si el servidor devuelve una combinación que este
 * cliente no conoce, se cae al fallback en vez de adivinar.
 */
export function resolveTeamPhotoDisplay(state) {
  const current = state?.current || null;
  const candidate = state?.candidate || null;
  if (current && isTeamPhotoRef(current.ref)) {
    return { source: 'current', ref: current.ref, photo: current };
  }
  // Hay vigente pero no se puede referenciar: estado desconocido, fallback.
  if (current) return { source: 'unknown', ref: null, photo: null };
  // Y sin vigente, el fallback: la candidata NUNCA se muestra como la foto del
  // equipo, ni siquiera cuando no hay ninguna otra. Eso sería publicar sin
  // moderar. `candidate` se lee sólo para dejarlo dicho.
  return { source: 'fallback', ref: null, photo: null, hasCandidate: Boolean(candidate) };
}

/**
 * Qué acciones tiene sentido ofrecer. Sale del par (capability, estado) que
 * devuelve el servidor, no del rol del usuario: es lo que impide pintar un
 * botón que la RPC va a rechazar.
 */
export function teamPhotoActions(state) {
  const canManage = state?.canManage === true;
  const canModerate = state?.canModerate === true;
  const candidate = state?.candidate || null;
  const pending = candidate?.editorialStatus === 'pending_review';
  return Object.freeze({
    canUpload: canManage,
    canWithdrawCandidate: canManage && Boolean(candidate),
    canApprove: canModerate && pending,
    canReject: canModerate && pending,
    canRevokeCurrent: canModerate && Boolean(state?.current),
  });
}
