// Staging-v1 workspace adapter: the legacy alias interface (what the providers and
// pages already call) over the foundation client, for the staging-v1 scope only.
//
// It deliberately has NO method for anything outside the scope. The providers
// duck-type the service (`typeof service.loadFixtureContext === 'function'`), so a
// missing alias is how a blocked surface stays off without a request. Everything
// here goes through `client.execute` / `client.select`; nothing imports the Core
// singleton, the legacy service or storage.
import { v4 as uuidv4 } from 'uuid';
import { createTorneosClient } from '../foundation/torneosClient';
import { isTorneosBoundaryError } from '../foundation/errors';
import { stagingV1Tables } from '../foundation/stagingV1Tables';
import {
  ERROR_MESSAGES,
  TournamentWorkspaceError,
  toWorkspaceError,
} from '../api/tournamentWorkspaceErrors';
import { TOURNAMENT_STATUS_TRANSITIONS } from '../domain/competitionLifecycle';

// Copy for failures that happen before or around the RPC (transport, session,
// gateway). The RPC's own functional codes keep the legacy ERROR_MESSAGES copy.
export const BOUNDARY_MESSAGES = Object.freeze({
  CORE_AUTH_REQUIRED: ERROR_MESSAGES.TORNEOS_AUTH_REQUIRED,
  TORNEOS_EXCHANGE_DENIED: ERROR_MESSAGES.TORNEOS_AUTH_REQUIRED,
  TORNEOS_SESSION_INVALID: ERROR_MESSAGES.TORNEOS_AUTH_REQUIRED,
  CORE_UNAVAILABLE: 'Arma2 no está disponible en este momento. Tu sesión sigue activa; volvé a intentar en unos minutos.',
  TORNEOS_UNAVAILABLE: 'Torneos no está disponible en este momento. Volvé a intentar en unos minutos.',
  TORNEOS_FORBIDDEN: 'Esa operación no está habilitada en este entorno.',
  TORNEOS_RATE_LIMITED: 'Se hicieron muchas solicitudes. Esperá un minuto y probá de nuevo.',
  TORNEOS_OUTSIDE_STAGING_V1: 'Esa función no está disponible en esta versión de Torneos.',
  TORNEOS_TRANSPORT_NOT_CONNECTED: 'Torneos no está conectado en este entorno.',
  TORNEOS_TRANSPORT_DISPOSED: 'Torneos no está conectado en este entorno.',
  TORNEOS_INVALID_REQUEST: 'La solicitud no es válida. Revisá los datos y volvé a intentar.',
  CORE_DENIED: 'Arma2 no autorizó ese recurso.',
});

// Statuses that `change_tournament_status` accepts. Start/finish/reopen are other
// RPCs, outside the scope: they never leave the client as a `p_status`.
const CHANGEABLE_STATUSES = Object.freeze([...new Set(
  Object.values(TOURNAMENT_STATUS_TRANSITIONS).flat(),
)]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function translateBoundaryError(error, fallbackMessage) {
  if (error instanceof TournamentWorkspaceError) return error;
  if (!isTorneosBoundaryError(error)) return toWorkspaceError(error, fallbackMessage);
  if (error.code === 'TORNEOS_RPC_ERROR' && error.rpcError) {
    const known = toWorkspaceError(error.rpcError, fallbackMessage);
    if (known.code !== 'TORNEOS_REQUEST_FAILED') return known;
    const gatewayCode = error.rpcError.code;
    if (gatewayCode && BOUNDARY_MESSAGES[gatewayCode]) {
      return new TournamentWorkspaceError(gatewayCode, BOUNDARY_MESSAGES[gatewayCode], error);
    }
    return known;
  }
  const code = ['CORE_AUTH_REQUIRED', 'TORNEOS_EXCHANGE_DENIED', 'TORNEOS_SESSION_INVALID'].includes(error.code)
    ? 'TORNEOS_AUTH_REQUIRED'
    : error.code;
  return new TournamentWorkspaceError(
    code,
    BOUNDARY_MESSAGES[error.code] || fallbackMessage,
    error,
  );
}

const orNull = (value) => (value === undefined || value === '' ? null : value);

export function createStagingV1WorkspaceService({ transport }) {
  const client = createTorneosClient({ transport });
  if (client.status !== 'connected') {
    throw new TournamentWorkspaceError(
      'TORNEOS_TRANSPORT_NOT_CONNECTED',
      BOUNDARY_MESSAGES.TORNEOS_TRANSPORT_NOT_CONNECTED,
    );
  }
  const call = async (operation, params, fallbackMessage) => {
    try {
      return await client.execute(operation, params);
    } catch (error) {
      throw translateBoundaryError(error, fallbackMessage);
    }
  };

  async function loadMyTournaments({ limit = 20, offset = 0 } = {}) {
    return call('get_my_tournament_memberships', {
      p_limit: limit,
      p_offset: offset,
    }, 'No pudimos cargar tus torneos.');
  }

  return Object.freeze({
    // ── organizations / workspaces ─────────────────────────────────────────
    loadContext: () => call(
      'get_tournament_workspace_context',
      {},
      'No pudimos cargar tus espacios. Revisá la conexión y volvé a intentar.',
    ),
    setPreference: (workspaceType, organizationId = null) => call(
      'set_tournament_workspace_preference',
      { p_workspace_type: workspaceType, p_organization_id: organizationId },
      'No pudimos cambiar de espacio. Volvé a intentarlo.',
    ),
    createOrganization: ({ name, slug, idempotencyKey }) => call(
      'create_tournament_organization',
      { p_name: name, p_slug: slug, p_idempotency_key: idempotencyKey },
      'No pudimos crear la organización. Tus datos no se guardaron.',
    ),
    checkSlugAvailability: async (slug) => Boolean(await call(
      'is_tournament_organization_slug_available',
      { p_slug: slug },
      'No pudimos comprobar el identificador.',
    )),
    updateOrganization: ({
      organizationId, name = null, slug = null, status = null,
    }) => call(
      'update_tournament_organization',
      {
        p_organization_id: organizationId, p_name: name, p_slug: slug, p_status: status,
      },
      'No pudimos guardar los cambios.',
    ),
    setTournamentContext: ({ organizationId, seasonId, tournamentId = null }) => call(
      'set_active_tournament_context',
      { p_organization_id: organizationId, p_season_id: seasonId, p_tournament_id: tournamentId },
      'No pudimos cambiar el contexto competitivo.',
    ),
    loadMyTournaments,
    loadExperienceRelations: async ({ pageSize = 50, maxItems = 500 } = {}) => {
      const items = [];
      let offset = 0;
      let pagination = null;
      let receivedItems = false;
      do {
        // eslint-disable-next-line no-await-in-loop
        const payload = await loadMyTournaments({ limit: pageSize, offset });
        const page = Array.isArray(payload?.items) ? payload.items : [];
        receivedItems = page.length > 0;
        items.push(...page);
        pagination = payload?.pagination || null;
        offset += page.length;
      } while (pagination?.hasMore && offset < maxItems && receivedItems);
      return {
        items,
        pagination: {
          limit: items.length,
          offset: 0,
          total: pagination?.total ?? items.length,
          hasMore: Boolean(pagination?.hasMore && offset >= maxItems),
        },
      };
    },

    // ── collaborators ──────────────────────────────────────────────────────
    // Phase 2D has no membership RPC: the list is the table route, RLS-scoped by
    // the bridge bearer, exactly as R5 exercised it.
    listMembers: async (organizationId) => {
      if (!UUID.test(String(organizationId))) {
        throw new TournamentWorkspaceError(
          'TORNEOS_INVALID_REQUEST',
          BOUNDARY_MESSAGES.TORNEOS_INVALID_REQUEST,
        );
      }
      try {
        return await client.select('tournament_organization_members', {
          select: stagingV1Tables.tournament_organization_members.columns.join(','),
          organization_id: `eq.${organizationId}`,
          order: 'joined_at.asc',
        });
      } catch (error) {
        throw translateBoundaryError(error, 'No pudimos cargar los miembros.');
      }
    },
    listSeasonMemberAssignments: ({ organizationId, seasonId }) => call(
      'list_tournament_season_member_assignments',
      { p_organization_id: organizationId, p_season_id: seasonId },
      'No pudimos cargar los colaboradores de la temporada.',
    ),
    assignSeasonMember: ({ organizationId, seasonId, membershipId }) => call(
      'assign_tournament_season_member',
      { p_organization_id: organizationId, p_season_id: seasonId, p_membership_id: membershipId },
      'No pudimos asignar el colaborador a la temporada.',
    ),
    removeSeasonMemberAssignment: ({ organizationId, seasonId, membershipId }) => call(
      'remove_tournament_season_member_assignment',
      { p_organization_id: organizationId, p_season_id: seasonId, p_membership_id: membershipId },
      'No pudimos quitar el colaborador de la temporada.',
    ),

    // ── seasons / tournaments ──────────────────────────────────────────────
    // The raw RPC payload, without the branding composition of the legacy
    // service (get_tournament_branding_context is outside the scope).
    loadCompetitionContext: async (organizationId) => {
      const context = await call(
        'get_tournament_competition_context',
        { p_organization_id: organizationId },
        'No pudimos cargar temporadas y torneos.',
      );
      return {
        ...context,
        organizationBranding: null,
        tournaments: (context?.tournaments || []).map((tournament) => ({
          ...tournament,
          logoPath: null,
          organizationLogoPath: null,
        })),
      };
    },
    createSeason: ({
      organizationId, name, slug, startDate = null, endDate = null, idempotencyKey,
    }) => call(
      'create_tournament_season',
      {
        p_organization_id: organizationId,
        p_name: name,
        p_slug: slug,
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_idempotency_key: idempotencyKey,
      },
      'No pudimos crear la temporada.',
    ),
    updateSeason: ({
      organizationId, seasonId, name = null, slug = null, startDate = null, endDate = null, status = null,
    }) => call(
      'update_tournament_season',
      {
        p_organization_id: organizationId,
        p_season_id: seasonId,
        p_name: name,
        p_slug: slug,
        p_start_date: startDate || null,
        p_end_date: endDate || null,
        p_status: status,
        p_clear_start_date: startDate === '',
        p_clear_end_date: endDate === '',
      },
      'No pudimos actualizar la temporada.',
    ),
    createTournament: ({
      organizationId, seasonId, name, slug, description = null, sportModality, competitionFormat,
      genderCategory, startDate = null, endDate = null, idempotencyKey,
    }) => call(
      'create_tournament_with_defaults',
      {
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
      },
      'No pudimos crear el torneo.',
    ),
    updateTournament: ({ organizationId, tournamentId, patch }) => call(
      'update_tournament_configuration',
      { p_organization_id: organizationId, p_tournament_id: tournamentId, p_patch: patch },
      'No pudimos guardar la configuración.',
    ),
    saveCategory: ({
      organizationId, tournamentId, categoryId = null, name, slug, description = null, sortOrder = 0,
      minAge = null, maxAge = null, genderCategory = null, sportModality = null, teamSize = null,
      status = 'active',
    }) => call(
      'save_tournament_category',
      {
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
      },
      'No pudimos guardar la categoría.',
    ),
    changeTournamentStatus: async ({ organizationId, tournamentId, status }) => {
      if (!CHANGEABLE_STATUSES.includes(status)) {
        throw new TournamentWorkspaceError(
          'TORNEOS_INVALID_TOURNAMENT_TRANSITION',
          ERROR_MESSAGES.TORNEOS_INVALID_TOURNAMENT_TRANSITION,
        );
      }
      return call(
        'change_tournament_status',
        { p_organization_id: organizationId, p_tournament_id: tournamentId, p_status: status },
        'No pudimos cambiar el estado del torneo.',
      );
    },

    // ── team registration / basic roster ───────────────────────────────────
    loadTeamsContext: (organizationId, tournamentId) => call(
      'get_tournament_teams_context',
      { p_organization_id: organizationId, p_tournament_id: tournamentId },
      'No pudimos cargar los equipos.',
    ),
    loadTeamRegistration: (organizationId, teamEntryId) => call(
      'get_team_registration_context',
      { p_organization_id: organizationId, p_team_entry_id: teamEntryId },
      'No pudimos cargar la inscripción.',
    ),
    createTeamEntry: (input) => call(
      'create_tournament_team_entry',
      {
        p_organization_id: input.organizationId,
        p_tournament_id: input.tournamentId,
        p_category_id: input.categoryId,
        p_arma2_team_id: input.arma2TeamId || null,
        p_name: input.name,
        p_short_name: orNull(input.shortName),
        p_primary_color: orNull(input.primaryColor),
        p_secondary_color: orNull(input.secondaryColor),
        p_registration_source: input.registrationSource,
        p_manager_user_id: input.managerUserId || null,
        p_manager_email: input.managerEmail || null,
        p_manager_display_name: input.managerDisplayName || null,
        p_idempotency_key: input.idempotencyKey,
      },
      'No pudimos crear la inscripción.',
    ),
    updateTeamEntry: (input) => call(
      'update_tournament_team_entry',
      {
        p_organization_id: input.organizationId,
        p_team_entry_id: input.teamEntryId,
        p_patch: input.patch,
      },
      'No pudimos guardar los datos del equipo.',
    ),
    createProvisionalPlayer: (input) => call(
      'create_tournament_provisional_player',
      {
        p_organization_id: input.organizationId,
        p_team_entry_id: input.teamEntryId,
        p_display_name: input.displayName,
      },
      'No pudimos crear el jugador provisional.',
    ),
    addRosterPlayer: (input) => call(
      'add_tournament_roster_player',
      {
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
      },
      'No pudimos agregar el jugador.',
    ),
    updateRosterPlayer: (input) => call(
      'update_tournament_roster_player',
      {
        p_organization_id: input.organizationId,
        p_team_entry_id: input.teamEntryId,
        p_roster_player_id: input.rosterPlayerId,
        p_shirt_number: input.shirtNumber === '' ? null : input.shirtNumber,
        p_primary_position: input.primaryPosition || null,
        p_secondary_position: input.secondaryPosition || null,
        p_is_goalkeeper: Boolean(input.isGoalkeeper),
      },
      'No pudimos actualizar el jugador.',
    ),
    removeRosterPlayer: (input) => call(
      'remove_tournament_roster_player',
      {
        p_organization_id: input.organizationId,
        p_team_entry_id: input.teamEntryId,
        p_roster_player_id: input.rosterPlayerId,
      },
      'No pudimos quitar el jugador.',
    ),
    submitTeamEntry: (input) => call(
      'submit_tournament_team_entry',
      { p_organization_id: input.organizationId, p_team_entry_id: input.teamEntryId },
      'No pudimos presentar la inscripción.',
    ),
    searchPlayers: (input) => call(
      'search_tournament_players',
      {
        p_organization_id: input.organizationId,
        p_tournament_id: input.tournamentId,
        p_query: input.query,
        p_limit: input.limit || 8,
        p_team_entry_id: input.teamEntryId || null,
      },
      'No pudimos buscar jugadores.',
    ),

    // Service-only aliases of the scope (no UI caller today): routed so the
    // scope is complete, inert until a screen calls them.
    withdrawTeamEntry: (input) => call(
      'withdraw_tournament_team_entry',
      {
        p_organization_id: input.organizationId,
        p_team_entry_id: input.teamEntryId,
        p_reason: input.reason,
      },
      'No pudimos retirar la inscripción.',
    ),
    archiveTeamEntry: (input) => call(
      'archive_tournament_team_entry',
      {
        p_organization_id: input.organizationId,
        p_team_entry_id: input.teamEntryId,
        p_reason: input.reason,
      },
      'No pudimos archivar la inscripción.',
    ),
    loadTournamentCreationEligibility: ({ organizationId }) => call(
      'get_tournament_creation_eligibility',
      { p_organization_id: organizationId },
      'No pudimos verificar si FREE está disponible para este torneo.',
    ),

    // ── invitations ────────────────────────────────────────────────────────
    inviteTeamManager: (input) => call(
      'invite_tournament_team_manager',
      {
        p_organization_id: input.organizationId,
        p_team_entry_id: input.teamEntryId,
        p_email: input.email,
        p_display_name: input.displayName,
        p_role: input.role || 'captain',
      },
      'No pudimos generar la invitación.',
    ),
    acceptTeamInvitation: (token) => call(
      'accept_tournament_team_invitation',
      { p_token: token },
      'No pudimos aceptar la invitación.',
    ),

    // ── core team import ───────────────────────────────────────────────────
    searchArma2Teams: (input) => call(
      'search_tournament_arma2_teams',
      {
        p_organization_id: input.organizationId,
        p_tournament_id: input.tournamentId,
        p_query: input.query,
        p_limit: input.limit || 8,
      },
      'No pudimos buscar equipos de Arma2.',
    ),

    // ── team entry review ──────────────────────────────────────────────────
    reviewTeamEntry: (input) => call(
      'review_tournament_team_entry',
      {
        p_organization_id: input.organizationId,
        p_team_entry_id: input.teamEntryId,
        p_decision: input.decision,
        p_reason: input.reason,
        p_issues: input.issues || [],
      },
      'No pudimos completar la revisión.',
    ),

    // ── pure helpers ───────────────────────────────────────────────────────
    createIdempotencyKey: () => uuidv4(),
  });
}
