/**
 * Cliente del retrato privado de un jugador del plantel (Multimedia 1C.2B).
 *
 * Todo lo que sabe el navegador es el `ImageRef`. El bucket, el path y la firma
 * los deriva el Edge function después de que la base autorizó la operación, así
 * que acá no hay ninguna llamada a Storage ni ninguna URL persistida: la firma
 * es efímera, vive en memoria y se vuelve a pedir cuando hace falta.
 */

import { supabase } from '../../../services/api/supabase';
import {
  PLAYER_PORTRAIT_ENABLED_AUDIENCES,
  isPlayerPortraitRef,
  normalizeCrop,
  normalizeFocalPoint,
  preparePlayerPortraitFile,
} from '../domain/playerPortraits';

const PORTRAIT_FUNCTION = 'tournament-player-portraits';

const ERROR_MESSAGES = Object.freeze({
  auth_required: 'Tu sesión venció. Volvé a iniciar sesión y reintentá.',
  forbidden: 'No tenés permiso para administrar la foto de este jugador.',
  audience_disabled: 'Esa vista todavía no puede mostrar retratos.',
  file_invalid: 'La imagen no cumple el formato o el tamaño permitidos.',
  invalid_image_ref: 'La referencia de la foto no es válida.',
  invalid_request: 'No pudimos procesar el pedido.',
  storage_unavailable: 'El servicio de fotos no está disponible. Reintentá en un momento.',
  upload_finalize_failed: 'No pudimos confirmar la foto. Se conservó la anterior.',
  upload_contract_invalid: 'No pudimos preparar la carga de la foto.',
  delete_storage_failed: 'No pudimos borrar la foto. Reintentá en un momento.',
  delete_finalize_failed: 'No pudimos completar la baja de la foto.',
  portrait_service_failed: 'No pudimos completar la operación con la foto.',
  server_misconfigured: 'El servicio de fotos no está configurado en este entorno.',
});

const RPC_ERROR_MESSAGES = Object.freeze({
  TORNEOS_PORTRAIT_FORBIDDEN: ERROR_MESSAGES.forbidden,
  TORNEOS_PORTRAIT_FOCAL_INVALID: 'El encuadre quedó fuera de la imagen.',
  TORNEOS_PORTRAIT_ZOOM_INVALID: 'El zoom quedó fuera de lo que admitimos.',
  TORNEOS_AUTH_REQUIRED: ERROR_MESSAGES.auth_required,
});

export class PlayerPortraitError extends Error {
  constructor(message, { code = null, retryable = true } = {}) {
    super(message);
    this.name = 'PlayerPortraitError';
    this.code = code;
    this.retryable = retryable;
  }
}

function describe(code) {
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.portrait_service_failed;
}

function toRpcError(error, fallback) {
  const raw = String(error?.message || '');
  const known = Object.keys(RPC_ERROR_MESSAGES).find((key) => raw.includes(key));
  return new PlayerPortraitError(
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
    throw new PlayerPortraitError(describe('storage_unavailable'), {
      code: 'storage_unavailable', retryable: false,
    });
  }
  return new URL(value, base).toString();
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token;
  if (!accessToken) {
    throw new PlayerPortraitError(describe('auth_required'), {
      code: 'auth_required', retryable: false,
    });
  }
  return {
    apikey: process.env.REACT_APP_SUPABASE_ANON_KEY || '',
    Authorization: `Bearer ${accessToken}`,
  };
}

async function callPortraitFunction({ method, query = '', body, headers = {}, signal }) {
  const base = supabaseBaseUrl();
  if (!base) {
    throw new PlayerPortraitError(describe('server_misconfigured'), {
      code: 'server_misconfigured', retryable: false,
    });
  }
  const response = await fetch(
    `${base}/functions/v1/${PORTRAIT_FUNCTION}${query}`,
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
    throw new PlayerPortraitError(describe(code), {
      code,
      // Un archivo rechazado se vuelve a rechazar; un corte de red no.
      retryable: ![400, 401, 403, 422].includes(response.status),
    });
  }
  return payload;
}

/**
 * Una sola lectura por equipo: por cada jugador, si hay retrato activo y si
 * este actor puede administrarlo. La capability llega del mismo predicado que
 * después autoriza la escritura, así que la UI no puede ofrecer un botón que el
 * servidor vaya a rechazar.
 */
export async function loadRosterPortraits({ organizationId, teamEntryId }) {
  const { data, error } = await supabase.rpc('list_tournament_player_portrait_refs', {
    p_organization_id: organizationId,
    p_team_entry_id: teamEntryId,
  });
  if (error) throw toRpcError(error, 'No pudimos cargar las fotos del plantel.');
  const byRosterPlayerId = new Map();
  for (const entry of data?.players || []) {
    byRosterPlayerId.set(entry.rosterPlayerId, {
      rosterPlayerId: entry.rosterPlayerId,
      canManage: entry.canManage === true,
      portrait: entry.portrait
        ? {
          ref: entry.portrait.ref,
          // El encuadre completo: punto focal más zoom. Las dimensiones
          // naturales viajan al lado porque son las que lo hacen dibujable.
          crop: normalizeCrop({
            x: Number(entry.portrait.focalX),
            y: Number(entry.portrait.focalY),
            zoom: Number(entry.portrait.cropZoom),
          }),
          width: entry.portrait.width,
          height: entry.portrait.height,
          editorialStatus: entry.portrait.editorialStatus,
          publicationConsent: entry.portrait.publicationConsent,
          updatedAt: entry.portrait.updatedAt,
        }
        : null,
    });
  }
  return byRosterPlayerId;
}

/**
 * Cambia un `ImageRef` por una firma efímera. Nunca se guarda: quien la use la
 * mantiene en memoria mientras dure y vuelve a pedir otra cuando expira.
 */
export async function resolvePlayerPortrait(
  ref,
  { audience = PLAYER_PORTRAIT_ENABLED_AUDIENCES[0], signal } = {},
) {
  if (!isPlayerPortraitRef(ref)) {
    throw new PlayerPortraitError(describe('invalid_image_ref'), {
      code: 'invalid_image_ref', retryable: false,
    });
  }
  const payload = await callPortraitFunction({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'resolve', ref, audience }),
    signal,
  });
  return {
    ref: payload?.ref || ref,
    url: absoluteSignedUrl(payload?.url),
    ttlSeconds: Number(payload?.ttlSeconds) || 0,
    // El resolver firma; el encuadre vigente es el de la fila que devuelve
    // `loadRosterPortraits`. Acá sólo viaja el punto focal que 1C.2A ya
    // publicaba, útil como red cuando no hay fila a mano.
    focal: normalizeFocalPoint({
      x: Number(payload?.focalX), y: Number(payload?.focalY),
    }),
    width: payload?.width,
    height: payload?.height,
    mimeType: payload?.mimeType,
  };
}

/**
 * El encuadre son tres fracciones y ningún píxel: se guarda sin volver a tocar
 * el objeto de Storage, así que acomodar la foto no vuelve a subirla ni cambia
 * su estado editorial.
 */
export async function setPlayerPortraitCrop({ organizationId, portraitId, crop }) {
  const normalized = normalizeCrop(crop);
  const { data, error } = await supabase.rpc('set_tournament_player_portrait_crop', {
    p_organization_id: organizationId,
    p_portrait_id: portraitId,
    p_focal_x: normalized.x,
    p_focal_y: normalized.y,
    p_zoom: normalized.zoom,
  });
  if (error) throw toRpcError(error, 'No pudimos guardar el encuadre.');
  return {
    portraitId: data?.portraitId || portraitId,
    crop: normalizeCrop({
      x: Number(data?.focalX), y: Number(data?.focalY), zoom: Number(data?.cropZoom),
    }),
  };
}

/**
 * Reemplazo no destructivo: cada carga estrena su propio path versionado y sólo
 * cuando el servidor la da por activa la anterior pasa a `replaced`. Si algo
 * falla en el camino, el retrato vigente sigue siendo el vigente.
 */
export async function uploadPlayerPortrait({
  organizationId, rosterPlayerId, file, crop = null, signal,
}) {
  const prepared = await preparePlayerPortraitFile(file);
  const query = `?action=upload&organizationId=${encodeURIComponent(organizationId)}`
    + `&rosterPlayerId=${encodeURIComponent(rosterPlayerId)}`;
  const payload = await callPortraitFunction({
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
  if (!isPlayerPortraitRef(ref)) {
    throw new PlayerPortraitError(describe('upload_contract_invalid'), {
      code: 'upload_contract_invalid', retryable: false,
    });
  }
  const result = {
    ref,
    replacedPortraitId: payload?.replacedPortraitId || null,
    crop: normalizeCrop(crop),
    cropSaved: true,
  };
  if (!crop) return { ...result, cropSaved: false };
  try {
    const saved = await setPlayerPortraitCrop({
      organizationId, portraitId: ref.id, crop,
    });
    return { ...result, crop: saved.crop };
  } catch (error) {
    // La foto ya quedó activa: perder el encuadre no puede perder la carga.
    return { ...result, cropSaved: false, cropError: error.message };
  }
}

export async function removePlayerPortrait({ portraitId, signal }) {
  const payload = await callPortraitFunction({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete', portraitId }),
    signal,
  });
  return { portraitId: payload?.portraitId || portraitId, deleted: payload?.deleted === true };
}
