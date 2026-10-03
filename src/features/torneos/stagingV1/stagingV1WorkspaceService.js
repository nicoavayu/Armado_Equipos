// Staging-v1 workspace adapter: the legacy alias interface (what the providers and
// pages already call) over the foundation client, for the staging-v1 scope only.
//
// It deliberately has NO method for anything outside the scope. The providers
// duck-type the service (`typeof service.loadFixtureContext === 'function'`), so a
// missing alias is how a blocked surface stays off without a request. Everything
// here goes through `client.execute` / `client.select`; nothing imports the Core
// singleton, the legacy service or storage.
//
// COMPETITION-V1: the competition aliases (fixture, scheduling, venues, squads, match reports,
// standings, lifecycle, withdrawal, participant hub, communications, notification preferences,
// public page settings) — the same RPC name and p_* payload as the legacy service, alias by alias
// (scripts/torneos-frontend/competition-adapter.test.mjs). Deliberately absent, so the pages hide
// them: archiveFixture and changeMatchPlan (service-only RPCs since the baseline), lockRoster,
// manual availability, points adjustments, disciplinary overrides and every media / branding /
// social / portrait / team-photo / visual-policy alias.
//
// MP-A5: with `commerce: true` (billing TEST overlay only) it also serves the commerce
// scope — loadPurchase, createCheckout — through the same client. Plan reads have an independent opt-in.
// Without it those aliases do not exist, so nothing ever asks for them.
//
// SOCIAL-V1: with `social: true` (foundation/config.js resolveTorneosSocialStudio) it also serves the three Estudio
// Social aliases — loadSocialStudioContext, loadSocialSnapshot, authorizeSocialExport — with the legacy RPC and p_*
// payload (scripts/torneos-frontend/social-adapter.test.mjs). Never setSocialPermission (no screen hands out
// permissions), and never the Multimedia signer or the crest/logo resolvers: without them every crest falls back to
// its monogram and a photo can only be a local file (social/socialStudio.js).
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
import { normalizeMatchOutcome } from '../domain/matchOutcome';

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
export const PLAN_READ_METHODS = Object.freeze(['loadSeasonEntitlements', 'loadEntitlements']);
export const SOCIAL_METHODS = Object.freeze(['loadSocialStudioContext', 'loadSocialSnapshot', 'authorizeSocialExport']);
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
  planRead = false,
  social = false,
  checkoutTimeoutMs = CHECKOUT_TIMEOUT_MS,
}) {
  const commerceEnabled = commerce === true;
  const client = createTorneosClient({ transport, commerce: commerceEnabled, planRead, social: social === true });
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

  // Independent read-only contract. Default OFF until the gateway serves it.
  const planAliases = commerceEnabled || planRead === true ? {
    loadSeasonEntitlements: async ({ organizationId, seasonId } = {}) => {
      if (!UUID.test(String(organizationId)) || !UUID.test(String(seasonId))) throw invalidRequest();
      return call(
        'get_effective_tournament_season_entitlements',
        { p_organization_id: organizationId, p_season_id: seasonId },
        'No pudimos cargar las funcionalidades disponibles para esta temporada.',
      );
    },
    loadEntitlements: async ({ organizationId, tournamentId } = {}) => {
      if (!UUID.test(String(organizationId)) || !UUID.test(String(tournamentId))) throw invalidRequest();
      return call(
        'get_effective_tournament_entitlements',
        { p_organization_id: organizationId, p_tournament_id: tournamentId },
        'No pudimos cargar las funcionalidades disponibles para este torneo.',
      );
    },
  } : {};

  const commerceAliases = commerceEnabled ? {
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

  // SOCIAL-V1: exact legacy payloads; every id is checked before the network and the export branding must be a real
  // boolean (the database refuses NULL, the client never coerces it).
  const isUuid = (value) => UUID.test(String(value));
  const isName = (value) => typeof value === 'string' && /^[a-z_]{1,40}$/.test(value);
  const socialAliases = social === true ? {
    loadSocialStudioContext: async (organizationId) => {
      if (!isUuid(organizationId)) throw invalidRequest();
      return call('get_tournament_social_studio_context', {
        p_organization_id: organizationId,
      }, 'No pudimos abrir el Estudio Social.');
    },
    loadSocialSnapshot: async ({
      organizationId, tournamentId, categoryId, phaseId, piece, roundId = null, groupId = null,
    } = {}) => {
      if (![organizationId, tournamentId, categoryId, phaseId].every(isUuid) || !isName(piece)
        || ![roundId, groupId].every((id) => id === null || isUuid(id))) throw invalidRequest();
      return call('get_tournament_social_snapshot', {
        p_organization_id: organizationId,
        p_tournament_id: tournamentId,
        p_category_id: categoryId,
        p_phase_id: phaseId,
        p_piece: piece,
        p_round_id: roundId,
        p_group_id: groupId,
      }, 'No pudimos preparar esta pieza con datos oficiales.');
    },
    authorizeSocialExport: async ({
      organizationId, tournamentId, piece, theme, includeArma2Branding,
    } = {}) => {
      if (![organizationId, tournamentId].every(isUuid) || !isName(piece) || !isName(theme)
        || typeof includeArma2Branding !== 'boolean') throw invalidRequest();
      return call('authorize_tournament_social_export', {
        p_organization_id: organizationId,
        p_tournament_id: tournamentId,
        p_piece: piece,
        p_theme: theme,
        p_include_arma2_branding: includeArma2Branding,
      }, 'No pudimos autorizar la exportación de esta pieza.');
    },
  } : {};

  return Object.freeze({
    ...planAliases,
    ...commerceAliases,
    ...socialAliases,
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

    // ── collaborators / organization members ───────────────────────────────
    // OFFICIALIZATION-V1: the member list is the membership RPC (roles, the viewer's own row
    // and, for those who manage invitations, the invited email), in the row shape the page
    // already renders. Invitations, role changes and removals are RPCs of the same contract.
    listMembers: async (organizationId) => {
      if (!UUID.test(String(organizationId))) throw invalidRequest();
      const rows = await call(
        'list_tournament_organization_members',
        { p_organization_id: organizationId },
        'No pudimos cargar los miembros.',
      );
      return (Array.isArray(rows) ? rows : []).map((row) => ({
        id: row.id,
        user_id: row.userId,
        role: row.role,
        status: row.status,
        joined_at: row.joinedAt,
        created_at: row.createdAt,
        email: row.email ?? null,
        is_viewer: row.isViewer === true,
      }));
    },
    listMemberInvitations: ({ organizationId }) => call(
      'list_tournament_organization_invitations',
      { p_organization_id: organizationId },
      'No pudimos cargar las invitaciones.',
    ),
    inviteMember: ({ organizationId, email, role }) => call(
      'invite_tournament_organization_member',
      { p_organization_id: organizationId, p_email: email, p_role: role },
      'No pudimos generar la invitación.',
    ),
    revokeMemberInvitation: ({ organizationId, invitationId }) => call(
      'revoke_tournament_organization_invitation',
      { p_organization_id: organizationId, p_invitation_id: invitationId },
      'No pudimos revocar la invitación.',
    ),
    acceptOrganizationInvitation: (token) => call(
      'accept_tournament_organization_invitation',
      { p_token: token },
      'No pudimos aceptar la invitación.',
    ),
    updateMemberRole: ({ organizationId, membershipId, role }) => call(
      'update_tournament_organization_member_role',
      { p_organization_id: organizationId, p_membership_id: membershipId, p_role: role },
      'No pudimos cambiar el rol.',
    ),
    removeMember: ({ organizationId, membershipId }) => call(
      'remove_tournament_organization_member',
      { p_organization_id: organizationId, p_membership_id: membershipId },
      'No pudimos quitar al miembro.',
    ),
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

    ...competitionAliases(call, client),

    // ── pure helpers ───────────────────────────────────────────────────────
    createIdempotencyKey: () => uuidv4(),
  });
}

// ── COMPETITION-V1 ───────────────────────────────────────────────────────────
const projectionScope = (input) => ({
  p_organization_id: input.organizationId,
  p_tournament_id: input.tournamentId,
  p_category_id: input.categoryId,
  p_phase_id: input.phaseId,
  p_group_id: input.groupId || null,
});

function competitionAliases(call, client) {
  const selectTable = async (table, query, fallbackMessage) => {
    try {
      return await client.select(table, query);
    } catch (error) {
      throw translateBoundaryError(error, fallbackMessage);
    }
  };
  return {
    // ── fixture / draw / versions ──────────────────────────────────────────
    loadFixtureContext: (organizationId, tournamentId, categoryId) => call('get_tournament_fixture_context', {
      p_organization_id: organizationId, p_tournament_id: tournamentId, p_category_id: categoryId,
    }, 'No pudimos cargar el fixture.'),
    loadScheduleContext: (organizationId, tournamentId, categoryId) => call('get_tournament_schedule_context', {
      p_organization_id: organizationId, p_tournament_id: tournamentId, p_category_id: categoryId,
    }, 'No pudimos cargar la programación.'),
    freezeParticipants: (input) => call('freeze_tournament_participants', {
      p_organization_id: input.organizationId,
      p_tournament_id: input.tournamentId,
      p_category_id: input.categoryId,
      p_idempotency_key: input.idempotencyKey,
    }, 'No pudimos cerrar los participantes.'),
    reopenParticipants: (input) => call('reopen_tournament_participants', {
      p_organization_id: input.organizationId,
      p_tournament_id: input.tournamentId,
      p_category_id: input.categoryId,
      p_reason: input.reason,
    }, 'No pudimos reabrir los participantes.'),
    saveDrawPots: (input) => call('save_tournament_draw_pots', {
      p_organization_id: input.organizationId,
      p_tournament_id: input.tournamentId,
      p_category_id: input.categoryId,
      p_pots: input.pots,
    }, 'No pudimos guardar los bombos.'),
    executeGroupDraw: (input) => call('execute_tournament_group_draw', {
      p_organization_id: input.organizationId,
      p_tournament_id: input.tournamentId,
      p_category_id: input.categoryId,
      p_group_count: input.groupCount,
      p_seed: input.seed,
      p_publish: Boolean(input.publish),
    }, 'No pudimos ejecutar el sorteo.'),
    generateFixture: (input) => call('generate_tournament_fixture', {
      p_organization_id: input.organizationId,
      p_tournament_id: input.tournamentId,
      p_category_id: input.categoryId,
      p_seed: input.seed || null,
      p_configuration: input.configuration || {},
      p_idempotency_key: input.idempotencyKey,
    }, 'No pudimos generar el fixture.'),
    createManualFixture: (input) => call('create_manual_fixture_version', {
      p_organization_id: input.organizationId,
      p_tournament_id: input.tournamentId,
      p_category_id: input.categoryId,
      p_source_fixture_version_id: input.sourceFixtureVersionId || null,
      p_idempotency_key: input.idempotencyKey,
    }, 'No pudimos crear la versión manual.'),
    updateDraftFixture: (input) => call('update_draft_fixture', {
      p_organization_id: input.organizationId,
      p_fixture_version_id: input.fixtureVersionId,
      p_action: input.action,
      p_payload: input.payload || {},
    }, 'No pudimos editar el fixture.'),
    validateFixture: (input) => call('validate_tournament_fixture', {
      p_organization_id: input.organizationId,
      p_fixture_version_id: input.fixtureVersionId,
    }, 'No pudimos validar el fixture.'),
    publishFixture: (input) => call('publish_tournament_fixture', {
      p_organization_id: input.organizationId,
      p_fixture_version_id: input.fixtureVersionId,
    }, 'No pudimos publicar el fixture.'),
    appendPlayoffPhase: (input) => call('append_tournament_playoff_phase', {
      p_organization_id: input.organizationId,
      p_tournament_id: input.tournamentId,
      p_category_id: input.categoryId,
      p_source_phase_id: input.sourcePhaseId,
      p_qualifier_count: input.qualifierCount,
      p_double_leg: Boolean(input.doubleLeg),
      p_idempotency_key: input.idempotencyKey,
    }, 'No pudimos agregar los Playoffs.'),
    supersedeFixture: (input) => call('supersede_tournament_fixture', {
      p_organization_id: input.organizationId,
      p_fixture_version_id: input.fixtureVersionId,
      p_idempotency_key: input.idempotencyKey,
    }, 'No pudimos preparar una nueva versión.'),

    // ── venues / courts / scheduling ───────────────────────────────────────
    // Organization resources without a read RPC: the two certified table routes (RLS
    // venues.read / courts.read), mapped exactly like the legacy service.
    loadOrganizationVenues: async (organizationId) => {
      if (!UUID.test(String(organizationId))) throw invalidRequest();
      const [venues, courts] = await Promise.all([
        selectTable('tournament_venues', {
          select: stagingV1Tables.tournament_venues.columns.join(','),
          organization_id: `eq.${organizationId}`,
          order: 'status.asc,name.asc',
        }, 'No pudimos cargar las sedes.'),
        selectTable('tournament_courts', {
          select: stagingV1Tables.tournament_courts.columns.join(','),
          organization_id: `eq.${organizationId}`,
          order: 'status.asc,name.asc',
        }, 'No pudimos cargar las canchas.'),
      ]);
      return {
        venues: venues.map((venue) => ({
          id: venue.id,
          name: venue.name,
          address: venue.address,
          placeId: venue.place_id,
          latitude: venue.latitude,
          longitude: venue.longitude,
          locality: venue.locality,
          timezone: venue.timezone,
          status: venue.status,
          notes: venue.notes,
        })),
        courts: courts.map((court) => ({
          id: court.id,
          venueId: court.venue_id,
          name: court.name,
          sportModality: court.sport_modality,
          status: court.status,
          notes: court.notes,
        })),
      };
    },
    createVenue: (input) => call('create_tournament_venue', {
      p_organization_id: input.organizationId,
      p_name: input.name,
      p_address: input.address,
      p_place_id: input.placeId || null,
      p_latitude: input.latitude ?? null,
      p_longitude: input.longitude ?? null,
      p_locality: input.locality || null,
      p_timezone: input.timezone || 'America/Argentina/Buenos_Aires',
      p_notes: input.notes || null,
    }, 'No pudimos crear la sede.'),
    createCourt: (input) => call('create_tournament_court', {
      p_organization_id: input.organizationId,
      p_venue_id: input.venueId,
      p_name: input.name,
      p_sport_modality: input.sportModality,
      p_notes: input.notes || null,
    }, 'No pudimos crear la cancha.'),
    saveScheduleWindows: (input) => call('save_tournament_schedule_windows', {
      p_organization_id: input.organizationId,
      p_tournament_id: input.tournamentId,
      p_windows: input.windows,
    }, 'No pudimos guardar las ventanas.'),
    validateMatchSchedule: (input) => call('validate_tournament_match_schedule', {
      p_organization_id: input.organizationId,
      p_match_id: input.matchId,
      p_scheduled_at: input.scheduledAt,
      p_venue_id: input.venueId,
      p_court_id: input.courtId,
      p_duration_minutes: input.durationMinutes,
    }, 'No pudimos validar la programación.'),
    scheduleMatch: (input) => call('schedule_tournament_match', {
      p_organization_id: input.organizationId,
      p_match_id: input.matchId,
      p_scheduled_at: input.scheduledAt,
      p_venue_id: input.venueId,
      p_court_id: input.courtId,
      p_duration_minutes: input.durationMinutes,
      p_override_warnings: Boolean(input.overrideWarnings),
      p_override_reason: input.overrideReason || null,
    }, 'No pudimos programar el partido.'),
    rescheduleMatch: (input) => call('reschedule_tournament_match', {
      p_organization_id: input.organizationId,
      p_match_id: input.matchId,
      p_scheduled_at: input.scheduledAt,
      p_venue_id: input.venueId,
      p_court_id: input.courtId,
      p_duration_minutes: input.durationMinutes,
      p_reason: input.reason,
      p_override_warnings: Boolean(input.overrideWarnings),
    }, 'No pudimos reprogramar el partido.'),
    autoScheduleMatches: (input) => call('auto_schedule_tournament_matches', {
      p_organization_id: input.organizationId,
      p_fixture_version_id: input.fixtureVersionId,
    }, 'No pudimos completar la programación automática.'),

    // ── my matches / availability / squads ─────────────────────────────────
    // Same merge as the legacy service: each row keeps which relation it comes from.
    loadPlayerMatches: async () => {
      const [playerRows, managedRows] = await Promise.all([
        call('get_player_tournament_matches', {}, 'No pudimos cargar tus partidos del torneo.'),
        call('get_managed_tournament_matches', {}, 'No pudimos cargar tus partidos del torneo.'),
      ]);
      const byScope = new Map();
      const merge = (rows, relation) => (rows || []).forEach((match) => {
        const key = `${match.matchId}:${match.teamEntryId}`;
        byScope.set(key, { ...(byScope.get(key) || {}), ...match, ...relation });
      });
      merge(playerRows, { isRosteredPlayer: true });
      merge(managedRows, { isTeamManager: true });
      return [...byScope.values()].map((match) => ({
        isRosteredPlayer: false,
        isTeamManager: false,
        ...match,
      }));
    },
    respondMatchAvailability: (input) => call('respond_match_availability', {
      p_match_id: input.matchId,
      p_response: input.response,
      p_comment: input.comment || null,
    }, 'No pudimos guardar tu disponibilidad.'),
    loadMatchSquad: (input) => call('get_match_squad_context', {
      p_organization_id: input.organizationId,
      p_match_id: input.matchId,
      p_team_entry_id: input.teamEntryId,
    }, 'No pudimos cargar la convocatoria.'),
    loadMyManagedMatchSquad: (matchId) => call('get_my_managed_match_squad_context', {
      p_match_id: matchId,
    }, 'No pudimos cargar tu convocatoria.'),
    saveMatchSquad: (input) => call('save_match_squad', {
      p_organization_id: input.organizationId,
      p_match_id: input.matchId,
      p_team_entry_id: input.teamEntryId,
      p_players: input.players,
    }, 'No pudimos guardar la convocatoria.'),
    submitMatchSquad: (input) => call('submit_match_squad', {
      p_organization_id: input.organizationId,
      p_match_id: input.matchId,
      p_team_entry_id: input.teamEntryId,
    }, 'No pudimos presentar la convocatoria.'),

    // ── match reports (actas) ──────────────────────────────────────────────
    loadMatchOperations: (input) => call('get_tournament_match_operations_context', {
      p_organization_id: input.organizationId,
      p_tournament_id: input.tournamentId,
      p_category_id: input.categoryId || null,
    }, 'No pudimos cargar los partidos operativos.'),
    loadMatchOperation: (input) => call('get_tournament_match_operation_context', {
      p_organization_id: input.organizationId,
      p_match_operation_id: input.operationId,
    }, 'No pudimos cargar el acta.'),
    openMatchOperation: (input) => call('open_tournament_match_operation', {
      p_organization_id: input.organizationId,
      p_match_id: input.matchId,
      p_override_reason: input.overrideReason || null,
    }, 'No pudimos abrir el acta.'),
    setMatchOutcome: (input) => call('set_tournament_match_outcome', {
      p_organization_id: input.organizationId,
      p_match_operation_id: input.operationId,
      p_outcome: normalizeMatchOutcome(input.outcome),
    }, 'No pudimos guardar la resolución deportiva.'),
    setMatchScore: (input) => call('set_tournament_match_score', {
      p_organization_id: input.organizationId,
      p_match_operation_id: input.operationId,
      p_score: input.score,
    }, 'No pudimos guardar el resultado.'),
    addMatchEvent: (input) => call('add_tournament_match_event', {
      p_organization_id: input.organizationId,
      p_match_operation_id: input.operationId,
      p_event: input.event,
    }, 'No pudimos agregar el evento.'),
    voidMatchEvent: (input) => call('void_tournament_match_event', {
      p_organization_id: input.organizationId,
      p_event_id: input.eventId,
      p_reason: input.reason,
    }, 'No pudimos anular el evento.'),
    submitMatchOperation: (input) => call('submit_tournament_match_operation', {
      p_organization_id: input.organizationId,
      p_match_operation_id: input.operationId,
    }, 'No pudimos presentar el acta.'),
    reviewMatchOperation: (input) => call('review_tournament_match_operation', {
      p_organization_id: input.organizationId,
      p_match_operation_id: input.operationId,
      p_decision: input.decision,
      p_reason: input.reason,
    }, 'No pudimos revisar el acta.'),
    validateMatchOperation: (input) => call('validate_tournament_match_operation', {
      p_organization_id: input.organizationId,
      p_match_operation_id: input.operationId,
    }, 'No pudimos validar el acta.'),
    makeMatchOfficial: (input) => call('make_tournament_match_official', {
      p_organization_id: input.organizationId,
      p_match_operation_id: input.operationId,
    }, 'No pudimos oficializar el acta.'),
    // OFFICIALIZATION-V1: the tournament's dual-control policy (owner-only change).
    loadMatchDualControl: (input) => call('get_tournament_match_dual_control', {
      p_organization_id: input.organizationId,
      p_tournament_id: input.tournamentId,
    }, 'No pudimos cargar la política de doble control.'),
    setMatchDualControl: (input) => call('set_tournament_match_dual_control', {
      p_organization_id: input.organizationId,
      p_tournament_id: input.tournamentId,
      p_enabled: input.enabled === true,
    }, 'No pudimos cambiar la política de doble control.'),
    requestMatchCorrection: (input) => call('request_tournament_match_correction', {
      p_organization_id: input.organizationId,
      p_match_operation_id: input.operationId,
      p_reason: input.reason,
    }, 'No pudimos solicitar la corrección.'),
    createMatchCorrection: (input) => call('create_tournament_match_correction', {
      p_organization_id: input.organizationId,
      p_match_operation_id: input.operationId,
    }, 'No pudimos crear la nueva versión del acta.'),

    // ── standings / statistics / qualification ─────────────────────────────
    loadStandings: (input) => call('get_tournament_standings_context', projectionScope(input), 'No pudimos cargar la tabla.'),
    loadStatistics: (input) => call('get_tournament_statistics_context', projectionScope(input), 'No pudimos cargar las estadísticas.'),
    rebuildStandings: (input) => call('rebuild_tournament_standings', {
      ...projectionScope(input),
      p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey || uuidv4(),
    }, 'No pudimos recalcular la competencia.'),
    publishStandings: (input) => call('publish_tournament_standings_revision', {
      p_revision_id: input.revisionId,
      p_reason: input.reason,
    }, 'No pudimos publicar la tabla.'),
    resolveQualification: (input) => call('resolve_tournament_qualification', {
      p_revision_id: input.revisionId,
      p_reason: input.reason,
    }, 'No pudimos resolver los clasificados.'),

    // ── lifecycle / withdrawal ─────────────────────────────────────────────
    startCompetition: ({ organizationId, tournamentId }) => call('start_tournament_competition', {
      p_organization_id: organizationId, p_tournament_id: tournamentId,
    }, 'No pudimos iniciar la competencia.'),
    finishCompetition: ({ organizationId, tournamentId }) => call('finish_tournament_competition', {
      p_organization_id: organizationId, p_tournament_id: tournamentId,
    }, 'No pudimos finalizar la competencia.'),
    reopenCompetition: ({ organizationId, tournamentId, reason }) => call('reopen_tournament_competition', {
      p_organization_id: organizationId, p_tournament_id: tournamentId, p_reason: reason,
    }, 'No pudimos reabrir la competencia.'),
    withdrawCompetitionParticipant: ({
      organizationId, tournamentId, teamEntryId, reasonCode, reasonText = null,
    }) => call('withdraw_tournament_competition_participant', {
      p_organization_id: organizationId,
      p_tournament_id: tournamentId,
      p_team_entry_id: teamEntryId,
      p_reason_code: reasonCode,
      p_reason_text: reasonText,
    }, 'No pudimos retirar el equipo.'),

    // ── participant hub ────────────────────────────────────────────────────
    // The hub payload without the branding composition of the legacy service
    // (get_tournament_branding_context is outside the contract: branding is OFF).
    loadParticipantHub: async ({ tournamentId, categoryId = null }) => {
      const hub = await call('get_tournament_participant_hub', {
        p_tournament_id: tournamentId, p_category_id: categoryId,
      }, 'No pudimos cargar el centro del torneo.');
      return { ...hub, tournament: { ...(hub?.tournament || {}), logoPath: null, organizationLogoPath: null } };
    },
    setHubCategory: ({ tournamentId, categoryId }) => call('set_my_tournament_hub_category', {
      p_tournament_id: tournamentId, p_category_id: categoryId,
    }, 'No pudimos cambiar de categoría.'),
    loadPublishedMatches: ({
      tournamentId, categoryId, view = 'all', teamEntryId = null, limit = 20, offset = 0,
    }) => call('get_published_tournament_matches', {
      p_tournament_id: tournamentId,
      p_category_id: categoryId,
      p_view: view,
      p_team_entry_id: teamEntryId,
      p_limit: limit,
      p_offset: offset,
    }, 'No pudimos cargar los partidos publicados.'),
    loadParticipantMatch: (matchId) => call('get_tournament_participant_match', {
      p_match_id: matchId,
    }, 'No pudimos cargar el partido.'),
    loadPublishedTeams: ({
      tournamentId, categoryId, limit = 16, offset = 0,
    }) => call('get_published_tournament_teams', {
      p_tournament_id: tournamentId, p_category_id: categoryId, p_limit: limit, p_offset: offset,
    }, 'No pudimos cargar los equipos publicados.'),
    loadPublishedStandings: ({
      tournamentId, categoryId, phaseId, groupId = null,
    }) => call('get_published_tournament_standings', {
      p_tournament_id: tournamentId, p_category_id: categoryId, p_phase_id: phaseId, p_group_id: groupId,
    }, 'No pudimos cargar la tabla publicada.'),
    loadPublishedStatistics: ({
      tournamentId, categoryId, phaseId, groupId = null,
    }) => call('get_published_tournament_statistics', {
      p_tournament_id: tournamentId, p_category_id: categoryId, p_phase_id: phaseId, p_group_id: groupId,
    }, 'No pudimos cargar las estadísticas publicadas.'),

    // ── communications / notification preferences ──────────────────────────
    loadCommunicationsInbox: ({
      tournamentId = null, filter = 'all', limit = 20, offset = 0,
    } = {}) => call('get_tournament_communications_inbox', {
      p_tournament_id: tournamentId, p_filter: filter, p_limit: limit, p_offset: offset,
    }, 'No pudimos cargar las novedades.'),
    loadAnnouncement: (announcementId) => call('get_tournament_announcement', {
      p_announcement_id: announcementId,
    }, 'No pudimos abrir el comunicado.'),
    markAnnouncementRead: ({ announcementId, confirm = false }) => call('mark_tournament_announcement_read', {
      p_announcement_id: announcementId, p_confirm: confirm,
    }, 'No pudimos registrar la lectura.'),
    loadNotificationPreferences: (tournamentId) => call('get_my_tournament_notification_preferences', {
      p_tournament_id: tournamentId,
    }, 'No pudimos cargar tus preferencias.'),
    updateNotificationPreferences: ({
      tournamentId, general, matchChanges, callups, discipline, documents, summaries,
    }) => call('update_my_tournament_notification_preferences', {
      p_tournament_id: tournamentId,
      p_general: general,
      p_match_changes: matchChanges,
      p_callups: callups,
      p_discipline: discipline,
      p_documents: documents,
      p_summaries: summaries,
    }, 'No pudimos actualizar tus preferencias.'),
    loadPublishedDocuments: ({ tournamentId, categoryId = null }) => call('get_published_tournament_documents', {
      p_tournament_id: tournamentId, p_category_id: categoryId,
    }, 'No pudimos cargar los documentos oficiales.'),
    acknowledgeDocument: ({ versionId, confirm = false }) => call('acknowledge_tournament_document', {
      p_version_id: versionId, p_confirm: confirm,
    }, 'No pudimos registrar la lectura del documento.'),
    loadCommunicationsAdminContext: ({ organizationId, tournamentId = null }) => call('get_tournament_communications_admin_context', {
      p_organization_id: organizationId, p_tournament_id: tournamentId,
    }, 'No pudimos cargar el centro de comunicaciones.'),
    createAnnouncementDraft: ({
      organizationId, tournamentId, categoryId = null, type, title, summary, body,
      priority = 'normal', acknowledgementMode = 'none', scheduledFor = null,
      supersedesId = null, correctionReason = null, idempotencyKey,
    }) => call('create_tournament_announcement_draft', {
      p_organization_id: organizationId,
      p_tournament_id: tournamentId,
      p_category_id: categoryId,
      p_announcement_type: type,
      p_title: title,
      p_summary: summary,
      p_body: body,
      p_priority: priority,
      p_acknowledgement_mode: acknowledgementMode,
      p_scheduled_for: scheduledFor,
      p_supersedes_id: supersedesId,
      p_correction_reason: correctionReason,
      p_idempotency_key: idempotencyKey,
    }, 'No pudimos crear el borrador.'),
    replaceAnnouncementAudience: ({
      announcementId, type, categoryId = null, teamEntryId = null, matchId = null, specificUserId = null,
    }) => call('replace_tournament_announcement_audience', {
      p_announcement_id: announcementId,
      p_audience_type: type,
      p_category_id: categoryId,
      p_team_entry_id: teamEntryId,
      p_match_id: matchId,
      p_specific_user_id: specificUserId,
    }, 'No pudimos reemplazar la audiencia.'),
    setAnnouncementLink: ({
      announcementId, type, resourceId = null, externalUrl = null, label, sortOrder = 0,
    }) => call('set_tournament_announcement_link', {
      p_announcement_id: announcementId,
      p_link_type: type,
      p_resource_id: resourceId,
      p_external_url: externalUrl,
      p_label: label,
      p_sort_order: sortOrder,
    }, 'No pudimos definir el enlace principal.'),
    updateAnnouncementDraft: ({
      announcementId, title, summary, body, priority = 'normal', acknowledgementMode = 'none', scheduledFor = null,
    }) => call('update_tournament_announcement_draft', {
      p_announcement_id: announcementId,
      p_title: title,
      p_summary: summary,
      p_body: body,
      p_priority: priority,
      p_acknowledgement_mode: acknowledgementMode,
      p_scheduled_for: scheduledFor,
    }, 'No pudimos actualizar el borrador.'),
    previewAnnouncementAudience: (announcementId) => call('preview_tournament_announcement_audience', {
      p_announcement_id: announcementId,
    }, 'No pudimos previsualizar la audiencia.'),
    publishAnnouncement: ({ announcementId, expectedRecipientCount = null }) => call('publish_tournament_announcement', {
      p_announcement_id: announcementId, p_expected_recipient_count: expectedRecipientCount,
    }, 'No pudimos publicar el comunicado.'),
    createDocument: ({
      organizationId, tournamentId, categoryId = null, type, title, summary, body,
      acknowledgementMode = 'none', effectiveAt = null, idempotencyKey,
    }) => call('create_tournament_document', {
      p_organization_id: organizationId,
      p_tournament_id: tournamentId,
      p_category_id: categoryId,
      p_document_type: type,
      p_title: title,
      p_summary: summary,
      p_body: body,
      p_acknowledgement_mode: acknowledgementMode,
      p_effective_at: effectiveAt,
      p_idempotency_key: idempotencyKey,
    }, 'No pudimos crear el documento.'),
    publishDocumentVersion: (versionId) => call('publish_tournament_document_version', {
      p_version_id: versionId,
    }, 'No pudimos publicar el documento.'),

    // ── public page settings ───────────────────────────────────────────────
    loadPublicPageSettings: ({ organizationId, tournamentId }) => call('get_tournament_public_page_settings', {
      p_organization_id: organizationId, p_tournament_id: tournamentId,
    }, 'No pudimos cargar el estado de la página pública.'),
    setPublicPagePublished: ({ organizationId, tournamentId, published }) => call('set_tournament_public_page_published', {
      p_organization_id: organizationId, p_tournament_id: tournamentId, p_published: Boolean(published),
    }, 'No pudimos actualizar la página pública.'),
  };
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
export function withoutCommerce(service, { planRead = false } = {}) {
  if (!service) return service;
  return Object.freeze(Object.fromEntries(
    Object.entries(service).filter(([name]) => !COMMERCE_METHODS.includes(name) || (planRead === true && PLAN_READ_METHODS.includes(name))),
  ));
}
