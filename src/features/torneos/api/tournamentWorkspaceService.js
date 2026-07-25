import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../../../services/api/supabase';

const ERROR_MESSAGES = {
  TORNEOS_AUTH_REQUIRED: 'Tu sesión venció. Volvé a iniciar sesión para continuar.',
  TORNEOS_IDEMPOTENCY_REQUIRED: 'No pudimos preparar la creación. Volvé a intentarlo.',
  TORNEOS_IDEMPOTENCY_CONFLICT: 'Ese intento de creación corresponde a un recurso archivado.',
  TORNEOS_INVALID_NAME: 'Revisá el nombre de la organización.',
  TORNEOS_INVALID_SLUG: 'Revisá el identificador de la organización.',
  TORNEOS_SLUG_TAKEN: 'Ese identificador ya está en uso. Probá con otro.',
  TORNEOS_CREATION_RATE_LIMITED: 'Se hicieron varios intentos. Esperá unos minutos y probá de nuevo.',
  TORNEOS_WORKSPACE_FORBIDDEN: 'Ya no tenés acceso a ese espacio.',
  TORNEOS_ORGANIZATION_FORBIDDEN: 'No tenés permiso para realizar esa acción.',
  TORNEOS_ARCHIVE_FORBIDDEN: 'Sólo el owner puede archivar la organización.',
  TORNEOS_INVALID_STATUS: 'El estado seleccionado no es válido.',
  TORNEOS_ACTIVE_OWNER_REQUIRED: 'La organización debe conservar un owner activo.',
  TORNEOS_RESOURCE_FORBIDDEN: 'No encontramos ese recurso o no tenés permiso para acceder.',
  TORNEOS_CONTEXT_FORBIDDEN: 'Ese contexto ya no está disponible.',
  TORNEOS_INVALID_SEASON: 'Revisá los datos de la temporada.',
  TORNEOS_INVALID_DATES: 'Revisá el orden de las fechas.',
  TORNEOS_SEASON_SLUG_TAKEN: 'Ya existe una temporada con ese identificador.',
  TORNEOS_INVALID_SEASON_TRANSITION: 'Ese cambio de estado de temporada no está permitido.',
  TORNEOS_SEASON_HAS_TOURNAMENTS: 'Archivá primero los torneos vigentes de esta temporada.',
  TORNEOS_INVALID_TOURNAMENT: 'Revisá la configuración del torneo.',
  TORNEOS_INVALID_MODALITY: 'Seleccioná una modalidad válida.',
  TORNEOS_INVALID_PATCH: 'La configuración enviada contiene campos no permitidos.',
  TORNEOS_INVALID_SCORING: 'Revisá la configuración de puntuación.',
  TORNEOS_INVALID_DISCIPLINE: 'Revisá la configuración disciplinaria.',
  TORNEOS_TOURNAMENT_SLUG_TAKEN: 'Ya existe un torneo con ese identificador en la temporada.',
  TORNEOS_INVALID_TIEBREAKS: 'Revisá el orden de los criterios de desempate.',
  TORNEOS_INVALID_CATEGORY: 'Revisá los datos de la categoría.',
  TORNEOS_CATEGORY_SLUG_TAKEN: 'Ya existe una categoría con ese identificador.',
  TORNEOS_CATEGORY_REQUIRED: 'El torneo debe conservar al menos una categoría activa.',
  TORNEOS_INVALID_TOURNAMENT_TRANSITION: 'Ese cambio de estado del torneo no está permitido.',
  TORNEOS_REGISTRATION_INCOMPLETE: 'Completá los requisitos antes de preparar la inscripción.',
  TORNEOS_SCOPE_IMMUTABLE: 'No se puede mover un recurso entre organizaciones o torneos.',
  TORNEOS_REGISTRATION_CLOSED: 'La inscripción no está abierta para ese torneo o categoría.',
  TORNEOS_INVALID_TEAM_ENTRY: 'Revisá los datos del equipo.',
  TORNEOS_TEAM_ALREADY_REGISTERED: 'Ese equipo ya está inscripto en la categoría.',
  TORNEOS_INVALID_MANAGER: 'Revisá los datos del responsable.',
  TORNEOS_MANAGER_INVITATION_REQUIRED: 'El responsable debe confirmar una invitación con su propia cuenta.',
  TORNEOS_INVITATION_RATE_LIMITED: 'Se generaron varias invitaciones. Esperá unos minutos.',
  TORNEOS_SEARCH_RATE_LIMITED: 'Se hicieron muchas búsquedas. Esperá un minuto y probá de nuevo.',
  TORNEOS_INVITATION_INVALID: 'La invitación no existe, ya fue usada o no corresponde a esta cuenta.',
  TORNEOS_INVITATION_EXPIRED: 'La invitación venció. Pedí al organizador un enlace nuevo.',
  TORNEOS_ENTRY_NOT_EDITABLE: 'La inscripción ya no admite cambios.',
  TORNEOS_INVALID_PLAYER: 'Revisá el nombre del jugador.',
  TORNEOS_INVALID_PLAYER_IDENTITY: 'Elegí un jugador de Arma2 o creá uno provisional.',
  TORNEOS_DUPLICATE_PLAYER: 'Ese jugador ya está en el plantel.',
  TORNEOS_DUPLICATE_SHIRT_NUMBER: 'Ese dorsal ya está asignado.',
  TORNEOS_ROSTER_MAXIMUM_REACHED: 'El plantel alcanzó el máximo permitido.',
  TORNEOS_ROSTER_INCOMPLETE: 'El plantel todavía no cumple todos los requisitos.',
  TORNEOS_MANAGER_REQUIRED: 'Asigná al menos un responsable antes de presentar.',
  TORNEOS_INVALID_REVIEW: 'Indicá un motivo claro para completar la revisión.',
  TORNEOS_REASON_REQUIRED: 'Indicá el motivo de esta acción.',
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

export function toWorkspaceError(error, fallbackMessage) {
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

export async function loadTournamentCompetitionContext(organizationId) {
  try {
    return unwrapRpc(
      await supabase.rpc('get_tournament_competition_context', {
        p_organization_id: organizationId,
      }),
      'No pudimos cargar temporadas y torneos.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos cargar temporadas y torneos.');
  }
}

export async function createTournamentSeason({
  organizationId,
  name,
  slug,
  startDate = null,
  endDate = null,
  idempotencyKey,
}) {
  try {
    return unwrapRpc(
      await supabase.rpc('create_tournament_season', {
        p_organization_id: organizationId,
        p_name: name,
        p_slug: slug,
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_idempotency_key: idempotencyKey,
      }),
      'No pudimos crear la temporada.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos crear la temporada.');
  }
}

export async function updateTournamentSeason({
  organizationId,
  seasonId,
  name = null,
  slug = null,
  startDate = null,
  endDate = null,
  status = null,
}) {
  try {
    return unwrapRpc(
      await supabase.rpc('update_tournament_season', {
        p_organization_id: organizationId,
        p_season_id: seasonId,
        p_name: name,
        p_slug: slug,
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_status: status,
        p_clear_start_date: startDate === '',
        p_clear_end_date: endDate === '',
      }),
      'No pudimos actualizar la temporada.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos actualizar la temporada.');
  }
}

export async function createTournamentCompetition({
  organizationId,
  seasonId,
  name,
  slug,
  description = null,
  sportModality,
  competitionFormat,
  genderCategory,
  startDate = null,
  endDate = null,
  idempotencyKey,
}) {
  try {
    return unwrapRpc(
      await supabase.rpc('create_tournament_with_defaults', {
        p_organization_id: organizationId,
        p_season_id: seasonId,
        p_name: name,
        p_slug: slug,
        p_description: description || null,
        p_sport_modality: sportModality,
        p_competition_format: competitionFormat,
        p_gender_category: genderCategory,
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_idempotency_key: idempotencyKey,
      }),
      'No pudimos crear el torneo.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos crear el torneo.');
  }
}

export async function updateTournamentCompetition({
  organizationId,
  tournamentId,
  patch,
}) {
  try {
    return unwrapRpc(
      await supabase.rpc('update_tournament_configuration', {
        p_organization_id: organizationId,
        p_tournament_id: tournamentId,
        p_patch: patch,
      }),
      'No pudimos guardar la configuración.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos guardar la configuración.');
  }
}

export async function saveTournamentCategory({
  organizationId,
  tournamentId,
  categoryId = null,
  name,
  slug,
  description = null,
  sortOrder = 0,
  minAge = null,
  maxAge = null,
  genderCategory = null,
  sportModality = null,
  teamSize = null,
  status = 'active',
}) {
  try {
    return unwrapRpc(
      await supabase.rpc('save_tournament_category', {
        p_organization_id: organizationId,
        p_tournament_id: tournamentId,
        p_category_id: categoryId,
        p_name: name,
        p_slug: slug,
        p_description: description || null,
        p_sort_order: sortOrder,
        p_min_age: minAge,
        p_max_age: maxAge,
        p_gender_category: genderCategory,
        p_sport_modality: sportModality,
        p_team_size: teamSize,
        p_status: status,
      }),
      'No pudimos guardar la categoría.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos guardar la categoría.');
  }
}

export async function changeTournamentCompetitionStatus({
  organizationId,
  tournamentId,
  status,
}) {
  try {
    return unwrapRpc(
      await supabase.rpc('change_tournament_status', {
        p_organization_id: organizationId,
        p_tournament_id: tournamentId,
        p_status: status,
      }),
      'No pudimos cambiar el estado del torneo.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos cambiar el estado del torneo.');
  }
}

export async function setActiveTournamentContext({
  organizationId,
  seasonId,
  tournamentId = null,
}) {
  try {
    return unwrapRpc(
      await supabase.rpc('set_active_tournament_context', {
        p_organization_id: organizationId,
        p_season_id: seasonId,
        p_tournament_id: tournamentId,
      }),
      'No pudimos cambiar el contexto competitivo.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos cambiar el contexto competitivo.');
  }
}

export async function loadTournamentTeamsContext(organizationId, tournamentId) {
  try {
    return unwrapRpc(
      await supabase.rpc('get_tournament_teams_context', {
        p_organization_id: organizationId,
        p_tournament_id: tournamentId,
      }),
      'No pudimos cargar los equipos.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos cargar los equipos.');
  }
}

export async function loadTeamRegistrationContext(organizationId, teamEntryId) {
  try {
    return unwrapRpc(
      await supabase.rpc('get_team_registration_context', {
        p_organization_id: organizationId,
        p_team_entry_id: teamEntryId,
      }),
      'No pudimos cargar la inscripción.',
    );
  } catch (error) {
    throw toWorkspaceError(error, 'No pudimos cargar la inscripción.');
  }
}

export async function createTournamentTeamEntry(input) {
  return unwrapRpc(await supabase.rpc('create_tournament_team_entry', {
    p_organization_id: input.organizationId,
    p_tournament_id: input.tournamentId,
    p_category_id: input.categoryId,
    p_arma2_team_id: input.arma2TeamId || null,
    p_name: input.name,
    p_short_name: input.shortName || null,
    p_primary_color: input.primaryColor || null,
    p_secondary_color: input.secondaryColor || null,
    p_registration_source: input.registrationSource,
    p_manager_user_id: input.managerUserId || null,
    p_manager_email: input.managerEmail || null,
    p_manager_display_name: input.managerDisplayName || null,
    p_idempotency_key: input.idempotencyKey,
  }), 'No pudimos crear la inscripción.');
}

export async function updateTournamentTeamEntry(input) {
  return unwrapRpc(await supabase.rpc('update_tournament_team_entry', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
    p_patch: input.patch,
  }), 'No pudimos guardar los datos del equipo.');
}

export async function createTournamentProvisionalPlayer(input) {
  return unwrapRpc(await supabase.rpc('create_tournament_provisional_player', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
    p_display_name: input.displayName,
  }), 'No pudimos crear el jugador provisional.');
}

export async function addTournamentRosterPlayer(input) {
  return unwrapRpc(await supabase.rpc('add_tournament_roster_player', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
    p_roster_id: input.rosterId,
    p_arma2_user_id: input.arma2UserId || null,
    p_provisional_player_id: input.provisionalPlayerId || null,
    p_display_name: input.displayName,
    p_avatar_url: input.avatarUrl || null,
    p_shirt_number: input.shirtNumber === '' ? null : input.shirtNumber,
    p_primary_position: input.primaryPosition || null,
    p_secondary_position: input.secondaryPosition || null,
    p_is_goalkeeper: Boolean(input.isGoalkeeper),
  }), 'No pudimos agregar el jugador.');
}

export async function updateTournamentRosterPlayer(input) {
  return unwrapRpc(await supabase.rpc('update_tournament_roster_player', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
    p_roster_player_id: input.rosterPlayerId,
    p_shirt_number: input.shirtNumber === '' ? null : input.shirtNumber,
    p_primary_position: input.primaryPosition || null,
    p_secondary_position: input.secondaryPosition || null,
    p_is_goalkeeper: Boolean(input.isGoalkeeper),
  }), 'No pudimos actualizar el jugador.');
}

export async function removeTournamentRosterPlayer(input) {
  return unwrapRpc(await supabase.rpc('remove_tournament_roster_player', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
    p_roster_player_id: input.rosterPlayerId,
  }), 'No pudimos quitar el jugador.');
}

export async function submitTournamentTeamEntry(input) {
  return unwrapRpc(await supabase.rpc('submit_tournament_team_entry', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
  }), 'No pudimos presentar la inscripción.');
}

export async function reviewTournamentTeamEntry(input) {
  return unwrapRpc(await supabase.rpc('review_tournament_team_entry', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
    p_decision: input.decision,
    p_reason: input.reason,
    p_issues: input.issues || [],
  }), 'No pudimos completar la revisión.');
}

export async function withdrawTournamentTeamEntry(input) {
  return unwrapRpc(await supabase.rpc('withdraw_tournament_team_entry', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
    p_reason: input.reason,
  }), 'No pudimos retirar la inscripción.');
}

export async function archiveTournamentTeamEntry(input) {
  return unwrapRpc(await supabase.rpc('archive_tournament_team_entry', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
    p_reason: input.reason,
  }), 'No pudimos archivar la inscripción.');
}

export async function lockTournamentRoster(input) {
  return unwrapRpc(await supabase.rpc('lock_tournament_roster', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
    p_roster_id: input.rosterId,
  }), 'No pudimos bloquear el plantel.');
}

export async function inviteTournamentTeamManager(input) {
  return unwrapRpc(await supabase.rpc('invite_tournament_team_manager', {
    p_organization_id: input.organizationId,
    p_team_entry_id: input.teamEntryId,
    p_email: input.email,
    p_display_name: input.displayName,
    p_role: input.role || 'captain',
  }), 'No pudimos generar la invitación.');
}

export async function acceptTournamentTeamInvitation(token) {
  return unwrapRpc(await supabase.rpc('accept_tournament_team_invitation', {
    p_token: token,
  }), 'No pudimos aceptar la invitación.');
}

export async function searchTournamentPlayers(input) {
  return unwrapRpc(await supabase.rpc('search_tournament_players', {
    p_organization_id: input.organizationId,
    p_tournament_id: input.tournamentId,
    p_query: input.query,
    p_limit: input.limit || 8,
    p_team_entry_id: input.teamEntryId || null,
  }), 'No pudimos buscar jugadores.');
}

export async function searchTournamentArma2Teams(input) {
  return unwrapRpc(await supabase.rpc('search_tournament_arma2_teams', {
    p_organization_id: input.organizationId,
    p_tournament_id: input.tournamentId,
    p_query: input.query,
    p_limit: input.limit || 8,
  }), 'No pudimos buscar equipos de Arma2.');
}

export const tournamentWorkspaceService = Object.freeze({
  loadContext: loadTournamentWorkspaceContext,
  createOrganization: createTournamentOrganization,
  checkSlugAvailability: checkTournamentOrganizationSlugAvailability,
  setPreference: setTournamentWorkspacePreference,
  updateOrganization: updateTournamentOrganization,
  listMembers: listTournamentOrganizationMembers,
  loadCompetitionContext: loadTournamentCompetitionContext,
  createSeason: createTournamentSeason,
  updateSeason: updateTournamentSeason,
  createTournament: createTournamentCompetition,
  updateTournament: updateTournamentCompetition,
  saveCategory: saveTournamentCategory,
  changeTournamentStatus: changeTournamentCompetitionStatus,
  setTournamentContext: setActiveTournamentContext,
  loadTeamsContext: loadTournamentTeamsContext,
  loadTeamRegistration: loadTeamRegistrationContext,
  createTeamEntry: createTournamentTeamEntry,
  updateTeamEntry: updateTournamentTeamEntry,
  createProvisionalPlayer: createTournamentProvisionalPlayer,
  addRosterPlayer: addTournamentRosterPlayer,
  updateRosterPlayer: updateTournamentRosterPlayer,
  removeRosterPlayer: removeTournamentRosterPlayer,
  submitTeamEntry: submitTournamentTeamEntry,
  reviewTeamEntry: reviewTournamentTeamEntry,
  withdrawTeamEntry: withdrawTournamentTeamEntry,
  archiveTeamEntry: archiveTournamentTeamEntry,
  lockRoster: lockTournamentRoster,
  inviteTeamManager: inviteTournamentTeamManager,
  acceptTeamInvitation: acceptTournamentTeamInvitation,
  searchPlayers: searchTournamentPlayers,
  searchArma2Teams: searchTournamentArma2Teams,
  createIdempotencyKey,
});
