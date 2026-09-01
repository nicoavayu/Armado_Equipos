/**
 * Cliente de la foto privada y moderada del equipo (Multimedia 1C.3B).
 *
 * Todo lo que sabe el navegador es el `ImageRef`. El bucket, el path y la firma
 * los deriva el Edge function después de que la base autorizó la operación, así
 * que acá no hay ninguna llamada a Storage ni ninguna URL persistida: la firma
 * es efímera, vive en memoria y se vuelve a pedir cuando hace falta.
 *
 * Las dos operaciones editoriales —aprobar/rechazar y retirar— van por RPC
 * directa porque no mueven bytes: sólo mueven la decisión de la organización.
 */

import { supabase } from '../../../services/api/supabase';
import {
  TEAM_PHOTO_ENABLED_AUDIENCES,
  isTeamPhotoRef,
  prepareTeamPhotoFile,
} from '../domain/teamPhotos';

const TEAM_PHOTO_FUNCTION = 'tournament-team-photos';

const ERROR_MESSAGES = Object.freeze({
  auth_required: 'Tu sesión venció. Volvé a iniciar sesión y reintentá.',
  forbidden: 'No tenés permiso para administrar la foto de este equipo.',
  audience_disabled: 'Esa vista todavía no puede mostrar la foto del equipo.',
  file_invalid: 'La imagen no cumple el formato o el tamaño permitidos.',
  checksum_invalid: 'No pudimos verificar la integridad de la imagen.',
  state_invalid: 'Esa decisión no aplica al estado de la foto.',
  invalid_image_ref: 'La referencia de la foto no es válida.',
  invalid_request: 'No pudimos procesar el pedido.',
  storage_unavailable: 'El servicio de fotos no está disponible. Reintentá en un momento.',
  upload_finalize_failed: 'No pudimos confirmar la foto. La foto vigente no cambió.',
  upload_contract_invalid: 'No pudimos preparar la carga de la foto.',
  delete_storage_failed: 'No pudimos borrar la foto. Reintentá en un momento.',
  delete_finalize_failed: 'No pudimos completar la baja de la foto.',
  team_photo_service_failed: 'No pudimos completar la operación con la foto.',
  server_misconfigured: 'El servicio de fotos no está configurado en este entorno.',
});

const RPC_ERROR_MESSAGES = Object.freeze({
  TORNEOS_TEAM_PHOTO_FORBIDDEN: ERROR_MESSAGES.forbidden,
  TORNEOS_TEAM_PHOTO_STATE_INVALID: ERROR_MESSAGES.state_invalid,
  TORNEOS_TEAM_PHOTO_CHECKSUM_INVALID: ERROR_MESSAGES.checksum_invalid,
  TORNEOS_AUTH_REQUIRED: ERROR_MESSAGES.auth_required,
});

export class TeamPhotoError extends Error {
  constructor(message, { code = null, retryable = true } = {}) {
    super(message);
    this.name = 'TeamPhotoError';
    this.code = code;
    this.retryable = retryable;
  }
}

function describe(code) {
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.team_photo_service_failed;
}

function toRpcError(error, fallback) {
  const raw = String(error?.message || '');
  const known = Object.keys(RPC_ERROR_MESSAGES).find((key) => raw.includes(key));
  return new TeamPhotoError(
    known ? RPC_ERROR_MESSAGES[known] : fallback,
    { code: known || 'rpc_failed', retryable: !known },
  );
}

function supabaseBaseUrl() {
  return String(process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
}

/**
 * El Edge function devuelve la firma como ruta relativa a propósito, para que
 * el host no viaje en el payload. Reconstruirla contra el origen configurado
 * evita que una respuesta manipulada apunte a otro lado.
 */
function absoluteSignedUrl(rawUrl) {
  const value = String(rawUrl || '');
  const base = supabaseBaseUrl();
  if (!base || !value.startsWith('/')) {
    throw new TeamPhotoError(describe('storage_unavailable'), {
      code: 'storage_unavailable', retryable: false,
    });
  }
  return new URL(value, base).toString();
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token;
  if (!accessToken) {
    throw new TeamPhotoError(describe('auth_required'), {
      code: 'auth_required', retryable: false,
    });
  }
  return {
    apikey: process.env.REACT_APP_SUPABASE_ANON_KEY || '',
    Authorization: `Bearer ${accessToken}`,
  };
}

async function callTeamPhotoFunction({ method, query = '', body, headers = {}, signal }) {
  const base = supabaseBaseUrl();
  if (!base) {
    throw new TeamPhotoError(describe('server_misconfigured'), {
      code: 'server_misconfigured', retryable: false,
    });
  }
  const response = await fetch(
    `${base}/functions/v1/${TEAM_PHOTO_FUNCTION}${query}`,
    { method, headers: { ...(await authHeaders()), ...headers }, body, signal },
  );
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const code = payload?.error || `http_${response.status}`;
    throw new TeamPhotoError(describe(code), {
      code,
      // Un archivo rechazado se vuelve a rechazar; un corte de red no.
      retryable: ![400, 401, 403, 422].includes(response.status),
    });
  }
  return payload;
}

function normalizePhoto(raw) {
  if (!raw) return null;
  return {
    teamPhotoId: raw.teamPhotoId,
    ref: raw.ref,
    width: raw.width,
    height: raw.height,
    editorialStatus: raw.editorialStatus || 'approved',
    reviewReason: raw.reviewReason || null,
    approvedAt: raw.approvedAt || null,
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  };
}

/**
 * Una sola lectura por equipo: la foto vigente, la candidata si el que mira
 * puede verla, y las dos capabilities que gobiernan los botones. Las
 * capabilities vienen de los mismos predicados que después autorizan la
 * escritura, así que la UI no puede ofrecer una acción que el servidor rechace.
 */
export async function loadTeamPhotoState({ organizationId, teamEntryId }) {
  const { data, error } = await supabase.rpc('get_tournament_team_photo_state', {
    p_organization_id: organizationId,
    p_team_entry_id: teamEntryId,
  });
  if (error) throw toRpcError(error, 'No pudimos cargar la foto del equipo.');
  return {
    organizationId: data?.organizationId || organizationId,
    teamEntryId: data?.teamEntryId || teamEntryId,
    canManage: data?.canManage === true,
    canModerate: data?.canModerate === true,
    current: normalizePhoto(data?.current),
    candidate: normalizePhoto(data?.candidate),
  };
}

/**
 * Cambia un `ImageRef` por una firma efímera. Nunca se guarda: quien la use la
 * mantiene en memoria mientras dure y vuelve a pedir otra cuando expira.
 */
export async function resolveTeamPhoto(
  ref,
  { audience = TEAM_PHOTO_ENABLED_AUDIENCES[0], signal } = {},
) {
  if (!isTeamPhotoRef(ref)) {
    throw new TeamPhotoError(describe('invalid_image_ref'), {
      code: 'invalid_image_ref', retryable: false,
    });
  }
  const payload = await callTeamPhotoFunction({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'resolve', ref, audience }),
    signal,
  });
  return {
    ref: payload?.ref || ref,
    url: absoluteSignedUrl(payload?.url),
    ttlSeconds: Number(payload?.ttlSeconds) || 0,
    width: payload?.width,
    height: payload?.height,
    mimeType: payload?.mimeType,
  };
}

/**
 * Subir NO reemplaza la foto vigente: crea una candidata que espera moderación.
 * El servidor devuelve cuál sigue siendo la vigente justamente para que la
 * pantalla pueda afirmarlo sin recalcularlo.
 */
export async function uploadTeamPhoto({ organizationId, teamEntryId, file, signal }) {
  const prepared = await prepareTeamPhotoFile(file);
  const query = `?action=upload&organizationId=${encodeURIComponent(organizationId)}`
    + `&teamEntryId=${encodeURIComponent(teamEntryId)}`;
  const payload = await callTeamPhotoFunction({
    method: 'PUT',
    query,
    headers: {
      'Content-Type': prepared.mime,
      'x-image-width': String(prepared.width),
      'x-image-height': String(prepared.height),
    },
    body: prepared.source,
    signal,
  });
  const ref = payload?.imageRef;
  if (!isTeamPhotoRef(ref)) {
    throw new TeamPhotoError(describe('upload_contract_invalid'), {
      code: 'upload_contract_invalid', retryable: false,
    });
  }
  return {
    ref,
    editorialStatus: payload?.editorialStatus || 'pending_review',
    replacedCandidateId: payload?.replacedCandidateId || null,
    currentTeamPhotoId: payload?.currentTeamPhotoId || null,
  };
}

/** Aprobar promueve la candidata a vigente y jubila la anterior, en una transacción. */
export async function setTeamPhotoEditorialStatus({
  organizationId, teamPhotoId, editorialStatus, reviewReason = null,
}) {
  const { data, error } = await supabase.rpc('set_tournament_team_photo_editorial_status', {
    p_organization_id: organizationId,
    p_team_photo_id: teamPhotoId,
    p_editorial_status: editorialStatus,
    p_review_reason: reviewReason,
  });
  if (error) throw toRpcError(error, 'No pudimos registrar la decisión.');
  return {
    teamPhotoId: data?.teamPhotoId || teamPhotoId,
    editorialStatus: data?.editorialStatus || editorialStatus,
    reviewReason: data?.reviewReason || null,
    replacedTeamPhotoId: data?.replacedTeamPhotoId || null,
  };
}

/** Retirar la vigente devuelve el equipo al fallback. No promueve ninguna anterior. */
export async function revokeTeamPhoto({ organizationId, teamPhotoId }) {
  const { data, error } = await supabase.rpc('revoke_tournament_team_photo', {
    p_organization_id: organizationId,
    p_team_photo_id: teamPhotoId,
  });
  if (error) throw toRpcError(error, 'No pudimos retirar la foto.');
  return { teamPhotoId: data?.teamPhotoId || teamPhotoId, revoked: data?.revoked === true };
}

export async function removeTeamPhoto({ teamPhotoId, signal }) {
  const payload = await callTeamPhotoFunction({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete', teamPhotoId }),
    signal,
  });
  return {
    teamPhotoId: payload?.teamPhotoId || teamPhotoId,
    deleted: payload?.deleted === true,
  };
}
