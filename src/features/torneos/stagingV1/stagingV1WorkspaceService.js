// Staging-v1 workspace adapter: the legacy alias interface (what the providers and
// pages already call) over the foundation client, for the staging-v1 scope only.
//
// It deliberately has NO method for anything outside the scope. The providers
// duck-type the service (`typeof service.loadFixtureContext === 'function'`), so a
// missing alias is how a blocked surface stays off without a request. Everything
// here goes through `client.execute` / `client.select`; nothing imports the Core
// singleton, the legacy service or storage.
//
// MP-A5: with `commerce: true` (billing TEST overlay only) it also serves the commerce
// scope — loadSeasonEntitlements, loadPurchase, createCheckout — through the same client.
// Without it those aliases do not exist, so nothing ever asks for them.
import { v4 as uuidv4 } from 'uuid';
import { createTorneosClient } from '../foundation/torneosClient';
import { isTorneosBoundaryError } from '../foundation/errors';
import { stagingV1Tables } from '../foundation/stagingV1Tables';
import { COMMERCE_REQUEST_TIMEOUT_MS } from '../foundation/torneosTransport';
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

// ── MP-A5 commerce ──────────────────────────────────────────────────────────
export const CHECKOUT_TIMEOUT_MS = COMMERCE_REQUEST_TIMEOUT_MS;
// Every alias a commerce surface may duck-type. The composition strips them from any
// service while billing is off, so an OFF overlay can never send a commerce request.
export const COMMERCE_METHODS = Object.freeze([
  'loadSeasonEntitlements', 'loadEntitlements', 'loadPurchase', 'createCheckout', 'simulateFakePayment', 'cancelPurchase',
]);

// User copy for the gateway's commerce answers (MP-A4 RISKS.md error mapping). The code
// stays on the error so the page can react (e.g. no new purchase while suspended).
export const COMMERCE_MESSAGES = Object.freeze({
  TORNEOS_CHECKOUT_INVALID: 'No pudimos iniciar la compra con esos datos. Recargá la página y volvé a intentar.',
  TORNEOS_BILLING_FORBIDDEN: ERROR_MESSAGES.TORNEOS_BILLING_FORBIDDEN,
  TORNEOS_PURCHASE_FORBIDDEN: ERROR_MESSAGES.TORNEOS_PURCHASE_FORBIDDEN,
  TORNEOS_SEASON_ALREADY_PREMIUM: ERROR_MESSAGES.TORNEOS_SEASON_ALREADY_PREMIUM,
  TORNEOS_SEASON_PREMIUM_SUSPENDED: 'El Premium de esta temporada está suspendido por un contracargo en disputa. No se puede iniciar otra compra mientras se resuelve.',
  TORNEOS_IDEMPOTENCY_CONFLICT: 'Ese intento de compra ya se usó con otros datos. Recargá la página para empezar de nuevo.',
  TORNEOS_OPEN_PURCHASE_PROVIDER_CONFLICT: 'Ya hay una compra abierta para esta temporada con otro medio de pago. Esperá a que venza o se resuelva.',
  TORNEOS_PREFERENCE_CONFLICT: 'La compra cambió mientras la preparábamos. Actualizá el plan y volvé a intentar.',
  TORNEOS_CHECKOUT_EXPIRED: 'La solicitud de pago venció. Actualizá el plan y volvé a intentar.',
  TORNEOS_PURCHASE_NOT_PAYABLE: 'Esta compra ya no admite pagos. Revisá su estado en el plan.',
  TORNEOS_PRODUCT_UNAVAILABLE: 'Premium no está disponible para comprar en este momento.',
  TORNEOS_OFFER_UNAVAILABLE: 'La oferta de Premium no está disponible en este momento.',
  TORNEOS_CHECKOUT_FAILED: 'No pudimos preparar el pago y no se realizó ningún cobro. Volvé a intentar en unos minutos.',
  TORNEOS_PAYMENTS_UNAVAILABLE: 'El servicio de pagos no está disponible en este momento y no se realizó ningún cobro. Volvé a intentar en unos minutos.',
});

function commerceCodeOf(error) {
  if (!isTorneosBoundaryError(error)) return null;
  const { gatewayError, status } = error;
  if (error.code === 'TORNEOS_RPC_ERROR') {
    if (gatewayError === 'TORNEOS_CHECKOUT_INVALID' || gatewayError === 'TORNEOS_CHECKOUT_TOO_LARGE') return 'TORNEOS_CHECKOUT_INVALID';
    if (gatewayError && Object.prototype.hasOwnProperty.call(COMMERCE_MESSAGES, gatewayError)) return gatewayError;
  }
  if (error.code === 'TORNEOS_UNAVAILABLE') {
    if (gatewayError === 'TORNEOS_PAYMENTS_UNAVAILABLE') return 'TORNEOS_PAYMENTS_UNAVAILABLE';
    if (status === 502 || gatewayError === 'TORNEOS_CHECKOUT_FAILED') return 'TORNEOS_CHECKOUT_FAILED';
  }
  return null;
}

export function translateCommerceError(error, fallbackMessage) {
  const code = commerceCodeOf(error);
  if (code) return new TournamentWorkspaceError(code, COMMERCE_MESSAGES[code], error);
  return translateBoundaryError(error, fallbackMessage);
}

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const sameId = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const invalidRequest = () => new TournamentWorkspaceError(
  'TORNEOS_INVALID_REQUEST',
  BOUNDARY_MESSAGES.TORNEOS_INVALID_REQUEST,
);
const purchaseForbidden = () => new TournamentWorkspaceError(
  'TORNEOS_PURCHASE_FORBIDDEN',
  ERROR_MESSAGES.TORNEOS_PURCHASE_FORBIDDEN,
);
const checkoutFailed = () => new TournamentWorkspaceError(
  'TORNEOS_CHECKOUT_FAILED',
  COMMERCE_MESSAGES.TORNEOS_CHECKOUT_FAILED,
);

// The gateway answers {purchase, preference}. `purchase` is the DB snapshot at creation
// (MP-A4 G1: a fresh checkout still says `created`); only `preference` matters for the
// redirect and only the purchase/entitlement reads decide the state afterwards.
function validCheckoutAnswer(answer, { organizationId, seasonId }) {
  if (!isPlainObject(answer) || !isPlainObject(answer.purchase)) return false;
  const { purchase, preference } = answer;
  if (!UUID.test(String(purchase.id)) || typeof purchase.status !== 'string'
    || !sameId(purchase.organizationId, organizationId) || !sameId(purchase.seasonId, seasonId)) return false;
  if (preference === null) return true;
  return isPlainObject(preference) && preference.provider === 'MERCADO_PAGO'
    && typeof preference.checkoutUrl === 'string' && typeof preference.preferenceId === 'string';
}

export function createStagingV1WorkspaceService({
  transport,
  commerce = false,
  checkoutTimeoutMs = CHECKOUT_TIMEOUT_MS,
}) {
  const commerceEnabled = commerce === true;
  const client = createTorneosClient({ transport, commerce: commerceEnabled });
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

  const commerceAliases = commerceEnabled ? {
    // ── commerce (MP-A5, billing TEST overlay only) ────────────────────────
    loadSeasonEntitlements: async ({ organizationId, seasonId } = {}) => {
      if (!UUID.test(String(organizationId)) || !UUID.test(String(seasonId))) throw invalidRequest();
      return call(
        'get_effective_tournament_season_entitlements',
        { p_organization_id: organizationId, p_season_id: seasonId },
        'No pudimos cargar las funcionalidades disponibles para esta temporada.',
      );
    },
    // The purchase must belong to the organization and season of the route: anything
    // else fails closed, whatever the server returned.
    loadPurchase: async ({ purchaseId, organizationId, seasonId } = {}) => {
      if (![purchaseId, organizationId, seasonId].every((id) => UUID.test(String(id)))) throw invalidRequest();
      const purchase = await call(
        'get_tournament_purchase',
        { p_purchase_id: purchaseId },
        'No pudimos consultar el estado de la compra.',
      );
      if (!isPlainObject(purchase) || !sameId(purchase.id, purchaseId)
        || !sameId(purchase.organizationId, organizationId) || !sameId(purchase.seasonId, seasonId)) {
        throw purchaseForbidden();
      }
      return purchase;
    },
    // Exactly the gateway contract body. Price, provider, currency and environment are
    // the server's; the idempotency key is the caller's (one per purchase attempt).
    createCheckout: async ({ organizationId, seasonId, idempotencyKey } = {}) => {
      if (![organizationId, seasonId, idempotencyKey].every((id) => UUID.test(String(id)))) throw invalidRequest();
      let answer;
      try {
        answer = await client.checkout(
          { organizationId, seasonId, idempotencyKey },
          { timeoutMs: checkoutTimeoutMs },
        );
      } catch (error) {
        throw translateCommerceError(error, 'No pudimos iniciar la compra.');
      }
      if (!validCheckoutAnswer(answer, { organizationId, seasonId })) throw checkoutFailed();
      return answer;
    },
  } : {};

  return Object.freeze({
    ...commerceAliases,
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

// The value of TorneosCommerceContext for the hybrid composition: the commerce aliases
// of a staging-v1 service (never the legacy service). `null` when the service has none.
export function createStagingV1Commerce(service, { redirect = null } = {}) {
  const required = ['loadSeasonEntitlements', 'loadPurchase', 'createCheckout', 'createIdempotencyKey'];
  if (!service || required.some((name) => typeof service[name] !== 'function')) return null;
  return Object.freeze({
    source: 'hybrid',
    // Premium is shown only from the server's effective season entitlement.
    entitlementsAuthority: true,
    loadSeasonEntitlements: (input) => service.loadSeasonEntitlements(input),
    loadPurchase: (input) => service.loadPurchase(input),
    createCheckout: (input) => service.createCheckout(input),
    createIdempotencyKey: () => service.createIdempotencyKey(),
    redirect: typeof redirect === 'function' ? redirect : null,
  });
}

// A service with every commerce alias removed: what the workspace providers receive while
// billing is off, so no screen can duck-type its way into a commerce request.
export function withoutCommerce(service) {
  if (!service) return service;
  return Object.freeze(Object.fromEntries(
    Object.entries(service).filter(([name]) => !COMMERCE_METHODS.includes(name)),
  ));
}
