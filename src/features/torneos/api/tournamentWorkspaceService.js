import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../../../services/api/supabase';

const ERROR_MESSAGES = {
  TORNEOS_AUTH_REQUIRED: 'Tu sesión venció. Volvé a iniciar sesión para continuar.',
  TORNEOS_IDEMPOTENCY_REQUIRED: 'No pudimos preparar la creación. Volvé a intentarlo.',
  TORNEOS_INVALID_NAME: 'Revisá el nombre de la organización.',
  TORNEOS_INVALID_SLUG: 'Revisá el identificador de la organización.',
  TORNEOS_SLUG_TAKEN: 'Ese identificador ya está en uso. Probá con otro.',
  TORNEOS_CREATION_RATE_LIMITED: 'Se hicieron varios intentos. Esperá unos minutos y probá de nuevo.',
  TORNEOS_WORKSPACE_FORBIDDEN: 'Ya no tenés acceso a ese espacio.',
  TORNEOS_ORGANIZATION_FORBIDDEN: 'No tenés permiso para realizar esa acción.',
  TORNEOS_ARCHIVE_FORBIDDEN: 'Sólo el owner puede archivar la organización.',
  TORNEOS_INVALID_STATUS: 'El estado seleccionado no es válido.',
  TORNEOS_ACTIVE_OWNER_REQUIRED: 'La organización debe conservar un owner activo.',
};

export class TournamentWorkspaceError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = 'TournamentWorkspaceError';
    this.code = code;
    this.cause = cause;
  }
}

function getKnownErrorCode(error) {
  const value = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
  ].filter(Boolean).join(' ');
  return Object.keys(ERROR_MESSAGES).find((code) => value.includes(code)) || null;
}

function toWorkspaceError(error, fallbackMessage) {
  if (error instanceof TournamentWorkspaceError) return error;
  const code = getKnownErrorCode(error) || 'TORNEOS_REQUEST_FAILED';
  return new TournamentWorkspaceError(
    code,
    ERROR_MESSAGES[code] || fallbackMessage,
    error,
  );
}

function unwrapRpc(result, fallbackMessage) {
  if (result?.error) throw toWorkspaceError(result.error, fallbackMessage);
  return result?.data;
}

export function createIdempotencyKey() {
  return uuidv4();
}

export async function loadTournamentWorkspaceContext() {
  try {
    return unwrapRpc(
      await supabase.rpc('get_tournament_workspace_context'),
      'No pudimos cargar tus espacios. Revisá la conexión y volvé a intentar.',
    );
  } catch (error) {
    throw toWorkspaceError(
      error,
      'No pudimos cargar tus espacios. Revisá la conexión y volvé a intentar.',
    );
  }
}

export async function createTournamentOrganization({
  name,
  slug,
  idempotencyKey,
}) {
  try {
    return unwrapRpc(
      await supabase.rpc('create_tournament_organization', {
        p_name: name,
        p_slug: slug,
        p_idempotency_key: idempotencyKey,
      }),
      'No pudimos crear la organización. Tus datos no se guardaron.',
    );
  } catch (error) {
    throw toWorkspaceError(
      error,
      'No pudimos crear la organización. Tus datos no se guardaron.',
    );
  }
}

export async function setTournamentWorkspacePreference(
  workspaceType,
  organizationId = null,
) {
  try {
    return unwrapRpc(
      await supabase.rpc('set_tournament_workspace_preference', {
        p_workspace_type: workspaceType,
        p_organization_id: organizationId,
      }),
      'No pudimos cambiar de espacio. Volvé a intentarlo.',
    );
  } catch (error) {
    throw toWorkspaceError(
      error,
      'No pudimos cambiar de espacio. Volvé a intentarlo.',
    );
  }
}

export async function checkTournamentOrganizationSlugAvailability(slug) {
  try {
    const result = await supabase.rpc(
      'is_tournament_organization_slug_available',
      { p_slug: slug },
    );
    return Boolean(unwrapRpc(
      result,
      'No pudimos comprobar el identificador.',
    ));
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos comprobar el identificador.');
  }
}

export async function updateTournamentOrganization({
  organizationId,
  name = null,
  slug = null,
  status = null,
}) {
  try {
    return unwrapRpc(
      await supabase.rpc('update_tournament_organization', {
        p_organization_id: organizationId,
        p_name: name,
        p_slug: slug,
        p_status: status,
      }),
      'No pudimos guardar los cambios.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos guardar los cambios.');
  }
}

export async function listTournamentOrganizationMembers(organizationId) {
  try {
    const { data, error } = await supabase
      .from('tournament_organization_members')
      .select('id,user_id,role,status,joined_at,created_at')
      .eq('organization_id', organizationId)
      .order('joined_at', { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos cargar los miembros.');
  }
}

export const tournamentWorkspaceService = Object.freeze({
  loadContext: loadTournamentWorkspaceContext,
  createOrganization: createTournamentOrganization,
  checkSlugAvailability: checkTournamentOrganizationSlugAvailability,
  setPreference: setTournamentWorkspacePreference,
  updateOrganization: updateTournamentOrganization,
  listMembers: listTournamentOrganizationMembers,
  createIdempotencyKey,
});
