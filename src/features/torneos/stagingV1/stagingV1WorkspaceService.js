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
//
// CONNECTED-V1: with `connected: true` (foundation/config.js resolveTorneosConnectedProduct) it also serves the
// connected product — Torneos profile and inbox, catalog management, registration requests — with the legacy RPC
// and p_* payload (scripts/torneos-frontend/connected-adapter.test.mjs). Never the platform removal lever.
//
// BRANDING-V1: with `branding: true` (foundation/config.js resolveTorneosBranding) it also serves the existing branding
// contract — upload/remove a logo or shield (object route + set_tournament_branding_reference, the LOCAL service's
// exact sequence) and the organization's branding context. Whatever the option, a branding path of a response only
// becomes an image through a URL the gateway signed (brandingUrls.js); nothing here resolves storage URLs itself.
//
// MEDIA-V1: with `media: true` (foundation/config.js resolveTorneosMedia) it also serves the photo galleries — the
// LOCAL service's gallery aliases with the same RPC name and p_* payload (scripts/torneos-frontend/media-adapter.test.mjs),
// plus uploadMediaPhoto (normalize in the browser, then ONE request to the gateway's upload route, which verifies,
// stores and registers the photo; a retry with the same key never makes a second photo) and signMediaReadUrls (the
// gateway's signed reads). Never deleteMediaAsset: retiring a photo is moderation (hide / revoke), and the permanent
// erasure of an object is not part of MEDIA-V1.
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
import { buildBrandingPath, prepareBrandingFile } from '../domain/brandingFiles';
import { requireAuthorizedBrandingUrls } from '../domain/brandingUrlRegistry';
import { withSignedBranding } from './brandingUrls';
import { prepareUploadPayload, MediaClientError } from '../domain/mediaImageClient';
import { describeMediaPipelineError } from '../domain/mediaPipeline';

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
export const CONNECTED_METHODS = Object.freeze([
  'loadTorneosProfile', 'updateTorneosProfile', 'loadTorneosNotifications', 'markTorneosNotificationsRead',
  'loadTorneosInboxSummary', 'loadCatalogListingSettings', 'saveCatalogListing', 'setCatalogListingStatus',
  'setApplicationsState', 'saveCategoryCapacity', 'loadApplicationInbox', 'searchApplicableCoreTeams',
  'startTournamentApplication', 'loadMyRegistrations', 'listMyCoreTeamsForApplication', 'loadMyParticipations',
]);
export const BRANDING_METHODS = Object.freeze(['uploadBrandingAsset', 'removeBrandingAsset', 'loadBrandingContext']);
// Responses the gateway signs (torneos-gateway/branding.ts SIGNED_AUTHENTICATED_RPCS): their paths keep only with a URL.
const SIGNED_BRANDING_RPCS = new Set([
  'get_tournament_branding_context', 'get_team_registration_context', 'get_tournament_teams_context',
  'get_tournament_participant_hub',
]);
const BRANDING_LABELS = Object.freeze({
  organization: 'logo de la organización', tournament: 'logo del torneo', team: 'escudo del equipo',
});
export const MEDIA_METHODS = Object.freeze([
  'loadMediaAdminContext', 'loadSeasonMediaUsage', 'createMediaGallery', 'updateMediaGallery', 'cancelMediaUploadSession',
  'transitionMediaAsset', 'setMediaCover', 'reorderMediaItem', 'publishMediaGallery', 'changeMediaGalleryState',
  'handleMediaReport', 'loadPublishedMedia', 'reportMediaAsset', 'uploadMediaPhoto', 'signMediaReadUrls',
]);

// What the organizer reads when ONE photo cannot be uploaded. Retryable answers keep the same idempotency key, so a
// retry never makes a second photo. Never a path, a bucket or an internal code.
export const MEDIA_UPLOAD_MESSAGES = Object.freeze({
  TORNEOS_MEDIA_DUPLICATE: ['Esta foto ya está cargada en la organización.', false],
  TORNEOS_MEDIA_UPLOAD_IN_PROGRESS: ['Esta foto ya se está subiendo. Esperá unos segundos y reintentá.', true],
  TORNEOS_MEDIA_IDEMPOTENCY_CONFLICT: ['Esta foto se preparó para otra galería. Quitala y volvé a elegirla.', false],
  TORNEOS_MEDIA_FORBIDDEN: ['No tenés permiso para cargar fotos en esta galería.', false],
  TORNEOS_AUTH_REQUIRED: ['Tu sesión venció. Volvé a iniciar sesión y reintentá.', false],
  TORNEOS_MEDIA_GALLERY_IMMUTABLE: ['Esta galería ya no admite fotos nuevas.', false],
  TORNEOS_MEDIA_PIPELINE_NOT_READY: ['La carga de fotos no está disponible en este momento.', false],
  TORNEOS_MEDIA_MVP_RATE_LIMITED: ['Subiste muchas fotos seguidas. Esperá unos minutos y reintentá.', true],
  TORNEOS_MEDIA_QUOTA_EXCEEDED: ['Hay muchas fotos subiéndose a la vez. Esperá a que terminen y reintentá.', true],
  TORNEOS_MEDIA_BUSY: ['Hay muchas fotos subiéndose ahora en Arma2 Torneos. Reintentá en unos segundos.', true],
  // Project-wide byte budget: retiring a photo keeps its file, so it frees nothing; only the operator can raise it.
  TORNEOS_MEDIA_STORAGE_BUDGET_EXCEEDED: ['El espacio para fotos de Arma2 Torneos está completo por ahora. Escribinos para seguir subiendo.', false],
  TORNEOS_MEDIA_TOO_LARGE: ['La foto supera los 4 MB incluso optimizada. Probá con otra.', false],
  TORNEOS_MEDIA_TYPE_UNSUPPORTED: ['Formato no admitido. Usá JPEG, PNG o WebP.', false],
  TORNEOS_MEDIA_FILE_INVALID: ['No pudimos verificar esta imagen. Probá con otro archivo.', false],
  TORNEOS_MEDIA_UPLOAD_SESSION_INVALID: ['La preparación de esta foto venció. Reintentá.', true],
  TORNEOS_MEDIA_GATEWAY_REQUIRED: ['No pudimos completar la carga. Reintentá en unos minutos.', true],
});

export class MediaUploadError extends Error {
  constructor(message, { code = null, retryable = true, quota = null, cause = null } = {}) {
    super(message);
    this.name = 'MediaUploadError';
    this.code = code;
    this.retryable = retryable;
    this.quota = quota;
    this.cause = cause;
  }
}

/** One gateway refusal (or outage) → what the queue shows for that file. */
export function translateMediaUploadError(error) {
  if (error instanceof MediaUploadError) return error;
  if (error?.name === 'AbortError' || error?.code === 'cancelled') {
    return new MediaUploadError('Carga cancelada.', { code: 'cancelled', retryable: true, cause: error });
  }
  if (error instanceof MediaClientError) {
    return new MediaUploadError(error.message, {
      code: error.code, retryable: !['mime', 'dimensions', 'size', 'thumbnail', 'canvas_unavailable', 'decode_failed', 'decode_unsupported', 'encode_unsupported'].includes(error.code), cause: error,
    });
  }
  if (isTorneosBoundaryError(error)) {
    const code = error.rpcError?.message || error.gatewayError || error.code;
    const details = error.rpcError?.details || null;
    if (code === 'TORNEOS_SEASON_MEDIA_QUOTA_EXCEEDED') {
      const quota = details?.quota || null;
      const numbers = Number.isInteger(quota?.usage) && Number.isInteger(quota?.limit) ? ` (${quota.usage} de ${quota.limit})` : '';
      return new MediaUploadError(
        // Same rule as the season meter: retired photos still count (they can be restored); rejected ones do not.
        `Llegaste al límite de fotos de esta temporada${numbers}. Para liberar lugar, rechazá fotos que todavía no publicaste${quota?.upgradeRequired ? ', o pasá la temporada a Premium' : ''}.`,
        { code, retryable: false, quota, cause: error },
      );
    }
    if (code === 'TORNEOS_MEDIA_CONTENT_REJECTED') {
      return new MediaUploadError(describeMediaPipelineError(null, details?.code), { code: details?.code || code, retryable: false, cause: error });
    }
    if (MEDIA_UPLOAD_MESSAGES[code]) {
      const [message, retryable] = MEDIA_UPLOAD_MESSAGES[code];
      return new MediaUploadError(message, { code, retryable, cause: error });
    }
    const boundary = translateBoundaryError(error, 'No pudimos completar la carga. Reintentá en unos minutos.');
    return new MediaUploadError(boundary.message, {
      code: boundary.code, retryable: !['TORNEOS_AUTH_REQUIRED', 'TORNEOS_OUTSIDE_STAGING_V1', 'TORNEOS_INVALID_REQUEST'].includes(boundary.code), cause: error,
    });
  }
  return new MediaUploadError('No pudimos completar la carga. Reintentá en unos minutos.', { code: 'media_service_failed', cause: error });
}

export const COMMERCE_METHODS = Object.freeze([
  'loadSeasonEntitlements', 'loadEntitlements', 'loadPurchase', 'createCheckout', 'simulateFakePayment', 'cancelPurchase',
  'loadSeasonPurchases', 'refreshPurchase',
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
  TORNEOS_BILLING_DISABLED: 'La compra de Premium todavía no está habilitada para esta organización. No se realizó ningún cobro.',
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

// COMMERCE-PRODUCTION: the purchases of one season as Mi plan shows them (newest first). Only the organization and
// season of the route; anything else fails closed.
function validSeasonPurchases(answer, { organizationId, seasonId }) {
  return isPlainObject(answer) && sameId(answer.organizationId, organizationId) && sameId(answer.seasonId, seasonId)
    && typeof answer.canManageBilling === 'boolean' && Array.isArray(answer.purchases)
    && answer.purchases.every((item) => isPlainObject(item) && UUID.test(String(item.id)) && typeof item.status === 'string');
}
const REFRESH_OUTCOME = /^[a-z][a-z0-9_]{1,59}$/;

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
  connected = false,
  branding = false,
  media = false,
  checkoutTimeoutMs = CHECKOUT_TIMEOUT_MS,
}) {
  const commerceEnabled = commerce === true;
  const brandingEnabled = branding === true;
  const mediaEnabled = media === true;
  // The hybrid composition never turns a stored branding path into a storage URL of another project.
  requireAuthorizedBrandingUrls();
  const client = createTorneosClient({
    transport, commerce: commerceEnabled, planRead, social: social === true, connected: connected === true,
    branding: brandingEnabled, media: mediaEnabled,
  });
  if (client.status !== 'connected') {
    throw new TournamentWorkspaceError(
      'TORNEOS_TRANSPORT_NOT_CONNECTED',
      BOUNDARY_MESSAGES.TORNEOS_TRANSPORT_NOT_CONNECTED,
    );
  }
  const call = async (operation, params, fallbackMessage) => {
    let result;
    try {
      result = await client.execute(operation, params);
    } catch (error) {
      throw translateBoundaryError(error, fallbackMessage);
    }
    return SIGNED_BRANDING_RPCS.has(operation) ? withSignedBranding(result) : result;
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
    loadSeasonPurchases: async ({ organizationId, seasonId } = {}) => {
      if (![organizationId, seasonId].every((id) => UUID.test(String(id)))) throw invalidRequest();
      const answer = await call(
        'get_tournament_season_purchases',
        { p_organization_id: organizationId, p_season_id: seasonId },
        'No pudimos consultar las compras de esta temporada.',
      );
      if (!validSeasonPurchases(answer, { organizationId, seasonId })) throw purchaseForbidden();
      return answer;
    },
    // "I already paid": the gateway asks Mercado Pago again (production) and answers the purchase as the server sees it
    // now. A gateway without the route (TEST lab) answers 404: the plain read is the answer then.
    refreshPurchase: async ({ purchaseId, organizationId, seasonId } = {}) => {
      if (![purchaseId, organizationId, seasonId].every((id) => UUID.test(String(id)))) throw invalidRequest();
      let answer;
      try {
        answer = await client.refreshPurchase({ purchaseId }, { timeoutMs: checkoutTimeoutMs });
      } catch (error) {
        if (error?.status === 404) answer = null;
        else throw translateCommerceError(error, 'No pudimos actualizar el estado de la compra.');
      }
      if (answer === null) {
        const purchase = await commerceAliases.loadPurchase({ purchaseId, organizationId, seasonId });
        return { purchase, refresh: 'not_available' };
      }
      const purchase = answer?.purchase;
      if (!isPlainObject(purchase) || !sameId(purchase.id, purchaseId)
        || !sameId(purchase.organizationId, organizationId) || !sameId(purchase.seasonId, seasonId)) {
        throw purchaseForbidden();
      }
      return { purchase, refresh: REFRESH_OUTCOME.test(String(answer.refresh)) ? answer.refresh : 'unknown' };
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

  const connectedAliases = connected === true ? {
    loadTorneosProfile: () => call('get_my_torneos_profile', {}, 'No pudimos cargar tu perfil de Torneos.'),
    updateTorneosProfile: async ({ displayName, notifyRegistrationRequests } = {}) => {
      if (typeof notifyRegistrationRequests !== 'boolean') throw invalidRequest();
      return call('update_my_torneos_profile', {
        p_display_name: displayName ?? null,
        p_notify_registration_requests: notifyRegistrationRequests,
      }, 'No pudimos guardar tu perfil de Torneos.');
    },
    loadTorneosNotifications: ({ unreadOnly = false, limit = 20, offset = 0 } = {}) => call('get_my_torneos_notifications', {
      p_unread_only: unreadOnly,
      p_limit: limit,
      p_offset: offset,
    }, 'No pudimos cargar tus avisos.'),
    markTorneosNotificationsRead: async ({ notificationIds = null } = {}) => {
      if (notificationIds !== null && (!Array.isArray(notificationIds) || !notificationIds.every((id) => UUID.test(String(id))))) {
        throw invalidRequest();
      }
      return call('mark_my_torneos_notifications_read', {
        p_notification_ids: notificationIds,
      }, 'No pudimos marcar los avisos como leídos.');
    },
    loadTorneosInboxSummary: () => call('get_my_torneos_inbox_summary', {}, 'No pudimos cargar tus avisos.'),
    loadCatalogListingSettings: ({ organizationId, tournamentId } = {}) => call('get_tournament_catalog_listing_settings', {
      p_organization_id: organizationId,
      p_tournament_id: tournamentId,
    }, 'No pudimos cargar la convocatoria.'),
    saveCatalogListing: ({
      organizationId, tournamentId, summary, locality, venueId = null, entryFeeCents = null,
      entryFeeIncludes = null, paymentNote = null, requirements = null, rulesSummary = null,
      entryFeeUnit = 'team', contactWhatsapp = null, contactPublic = false,
    } = {}) => call('save_tournament_catalog_listing', {
      p_organization_id: organizationId,
      p_tournament_id: tournamentId,
      p_summary: summary ?? null,
      p_locality: locality ?? null,
      p_venue_id: venueId,
      p_entry_fee_cents: entryFeeCents,
      p_entry_fee_includes: entryFeeIncludes,
      p_payment_note: paymentNote,
      p_requirements: requirements,
      p_rules_summary: rulesSummary,
      p_entry_fee_unit: entryFeeUnit || 'team',
      p_contact_whatsapp: contactWhatsapp || null,
      p_contact_public: contactPublic === true,
    }, 'No pudimos guardar la convocatoria.'),
    setCatalogListingStatus: ({ organizationId, tournamentId, listed } = {}) => call('set_tournament_catalog_listing_status', {
      p_organization_id: organizationId,
      p_tournament_id: tournamentId,
      p_listed: listed,
    }, 'No pudimos cambiar la publicación en el catálogo.'),
    setApplicationsState: ({ organizationId, tournamentId, state } = {}) => call('set_tournament_applications_state', {
      p_organization_id: organizationId,
      p_tournament_id: tournamentId,
      p_state: state,
    }, 'No pudimos cambiar la recepción de solicitudes.'),
    saveCategoryCapacity: ({ organizationId, tournamentId, categoryId, maxTeams = null } = {}) => call('save_tournament_category_capacity', {
      p_organization_id: organizationId,
      p_tournament_id: tournamentId,
      p_category_id: categoryId,
      p_max_teams: maxTeams,
    }, 'No pudimos guardar el cupo.'),
    loadApplicationInbox: ({
      organizationId, tournamentId, status = 'submitted', limit = 20, offset = 0,
    } = {}) => call('get_tournament_application_inbox', {
      p_organization_id: organizationId,
      p_tournament_id: tournamentId,
      p_status: status,
      p_limit: limit,
      p_offset: offset,
    }, 'No pudimos cargar las solicitudes.'),
    searchApplicableCoreTeams: ({ publicSlug, query, limit = 8 } = {}) => call('search_my_applicable_core_teams', {
      p_public_slug: publicSlug,
      p_query: query,
      p_limit: limit,
    }, 'No pudimos buscar tus equipos.'),
    // Core contract v1.2 through the gateway: the applicant's own teams, with Core's verdict per team.
    listMyCoreTeamsForApplication: ({ publicSlug } = {}) => call('list_my_core_teams_for_application', {
      p_public_slug: publicSlug,
    }, 'No pudimos cargar tus equipos.'),
    startTournamentApplication: ({
      publicSlug, categorySlug, coreTeamId = null, teamName = null, message = null, acceptConditions, idempotencyKey,
    } = {}) => call('start_tournament_application', {
      p_public_slug: publicSlug,
      p_category_slug: categorySlug,
      p_core_team_id: coreTeamId,
      p_team_name: teamName,
      p_message: message,
      p_accept_conditions: acceptConditions,
      p_idempotency_key: idempotencyKey,
    }, 'No pudimos crear la solicitud.'),
    loadMyRegistrations: ({ limit = 20, offset = 0 } = {}) => call('get_my_tournament_registrations', {
      p_limit: limit,
      p_offset: offset,
    }, 'No pudimos cargar tus inscripciones.'),
    loadMyParticipations: ({ limit = 18, offset = 0 } = {}) => call('get_my_tournament_participations', {
      p_limit: limit,
      p_offset: offset,
    }, 'No pudimos cargar tus torneos.'),
  } : {};

  // BRANDING-V1: the LOCAL service's exact sequence (tournamentBrandingService.js) over the gateway: store a new
  // versioned object, switch the durable reference, then remove the previous object; a failure removes what was
  // stored. Storage RLS and set_tournament_branding_reference decide who may do it.
  const removeBrandingObject = async (path) => {
    if (!path) return;
    await client.brandingObject('DELETE', path).catch(() => {});
  };
  const brandingError = (error, kind, verb) => translateBoundaryError(
    error, `No pudimos ${verb} el ${BRANDING_LABELS[kind] || 'asset'}.`,
  );
  const brandingAliases = brandingEnabled ? {
    loadBrandingContext: ({ organizationId, tournamentId = null }) => call(
      'get_tournament_branding_context',
      { p_organization_id: organizationId, p_tournament_id: tournamentId },
      'No pudimos cargar la identidad visual.',
    ),
    uploadBrandingAsset: async ({ organizationId, kind, entityId, file }) => {
      let uploadedPath = null;
      try {
        const prepared = await prepareBrandingFile(file);
        uploadedPath = buildBrandingPath({ organizationId, kind, entityId, mime: prepared.mime });
        await client.brandingObject('POST', uploadedPath, prepared.source);
        const reference = await client.execute('set_tournament_branding_reference', {
          p_organization_id: organizationId, p_entity_kind: kind, p_entity_id: entityId, p_path: uploadedPath,
        });
        if (reference?.previousPath && reference.previousPath !== uploadedPath) await removeBrandingObject(reference.previousPath);
        return { ...reference, path: uploadedPath, width: prepared.width, height: prepared.height, mime: prepared.mime };
      } catch (error) {
        if (uploadedPath) await removeBrandingObject(uploadedPath);
        // The file itself was refused before any request (format, size, dimensions): its own copy.
        if (!isTorneosBoundaryError(error) && !(error instanceof TournamentWorkspaceError)) {
          throw new Error(error?.message || `No pudimos guardar el ${BRANDING_LABELS[kind] || 'asset'}.`);
        }
        throw brandingError(error, kind, 'guardar');
      }
    },
    removeBrandingAsset: async ({ organizationId, kind, entityId }) => {
      try {
        const reference = await client.execute('set_tournament_branding_reference', {
          p_organization_id: organizationId, p_entity_kind: kind, p_entity_id: entityId, p_path: null,
        });
        if (reference?.previousPath) await client.brandingObject('DELETE', reference.previousPath);
        return reference;
      } catch (error) {
        throw brandingError(error, kind, 'quitar');
      }
    },
  } : {};

  // MEDIA-V1: the LOCAL service's gallery aliases, same RPC and p_* payload (api/tournamentWorkspaceService.js). Every
  // decision — capability, audience, lifecycle, consent, season quota — is the database's.
  const mediaAliases = mediaEnabled ? {
    loadMediaAdminContext: async ({
      organizationId, tournamentId = null, status = null, limit = 30, offset = 0,
    }) => {
      if (!isUuid(organizationId)) throw invalidRequest();
      const [context, storage, processingTiers] = await Promise.all([
        call('get_tournament_media_admin_context', {
          p_organization_id: organizationId, p_tournament_id: tournamentId, p_status: status, p_limit: limit, p_offset: offset,
        }, 'No pudimos cargar el Centro Multimedia.'),
        call('get_tournament_media_upload_capability', { p_organization_id: organizationId }, 'No pudimos verificar la carga de fotos.'),
        call('get_tournament_media_asset_processing_tiers', { p_organization_id: organizationId }, 'No pudimos cargar las fotos.'),
      ]);
      const galleries = (context?.galleries || []).map((gallery) => ({
        ...gallery,
        assets: (gallery.assets || []).map((asset) => ({
          ...asset,
          processingTier: processingTiers?.[asset.id] || 'processor_external',
        })),
      }));
      return { ...context, galleries, storage, entitlements: null };
    },
    loadSeasonMediaUsage: ({ organizationId, seasonId }) => {
      if (!isUuid(organizationId) || !isUuid(seasonId)) throw invalidRequest();
      return call('get_tournament_season_media_usage', {
        p_organization_id: organizationId, p_season_id: seasonId,
      }, 'No pudimos calcular el uso de fotos de la temporada.');
    },
    createMediaGallery: ({
      organizationId, tournamentId, categoryId = null, roundId = null, matchId = null, title, description = '',
      visibility = 'tournament_participants', idempotencyKey,
    }) => call('create_tournament_media_gallery', {
      p_organization_id: organizationId, p_tournament_id: tournamentId, p_category_id: categoryId, p_round_id: roundId,
      p_match_id: matchId, p_title: title, p_description: description, p_visibility: visibility,
      p_idempotency_key: idempotencyKey,
    }, 'No pudimos crear la galería.'),
    updateMediaGallery: ({
      galleryId, title, description = '', visibility, submitForReview = false,
    }) => call('update_tournament_media_gallery', {
      p_gallery_id: galleryId, p_title: title, p_description: description, p_visibility: visibility,
      p_submit_for_review: submitForReview,
    }, 'No pudimos actualizar la galería.'),
    cancelMediaUploadSession: (sessionId) => call('cancel_tournament_media_upload_session', {
      p_session_id: sessionId,
    }, 'No pudimos cancelar la preparación de la foto.'),
    transitionMediaAsset: ({ assetId, action, reason = null }) => call('transition_tournament_media_asset', {
      p_asset_id: assetId, p_action: action, p_reason: reason,
    }, 'No pudimos actualizar el estado de la foto.'),
    setMediaCover: ({ galleryId, assetId }) => call('set_tournament_media_cover', {
      p_gallery_id: galleryId, p_asset_id: assetId,
    }, 'No pudimos elegir la portada.'),
    reorderMediaItem: ({ galleryId, assetId, targetOrder }) => call('reorder_tournament_media_item', {
      p_gallery_id: galleryId, p_asset_id: assetId, p_target_order: targetOrder,
    }, 'No pudimos reordenar la foto.'),
    publishMediaGallery: (galleryId) => call('publish_tournament_media_gallery', {
      p_gallery_id: galleryId,
    }, 'No pudimos publicar la galería.'),
    changeMediaGalleryState: ({ galleryId, action, reason }) => call('change_tournament_media_gallery_state', {
      p_gallery_id: galleryId, p_action: action, p_reason: reason,
    }, 'No pudimos actualizar la galería.'),
    handleMediaReport: ({ reportId, status, resolution = null }) => call('handle_tournament_media_report', {
      p_report_id: reportId, p_status: status, p_resolution: resolution,
    }, 'No pudimos resolver el reporte.'),
    loadPublishedMedia: ({
      tournamentId, categoryId = null, matchId = null, limit = 20, offset = 0,
    }) => call('get_published_tournament_media', {
      p_tournament_id: tournamentId, p_category_id: categoryId, p_match_id: matchId, p_limit: limit, p_offset: offset,
    }, 'No pudimos cargar las fotos.'),
    reportMediaAsset: ({
      assetId, reason, detail = '', requestHide = false, idempotencyKey,
    }) => call('report_tournament_media_asset', {
      p_asset_id: assetId, p_reason: reason, p_detail: detail, p_request_hide: requestHide,
      p_idempotency_key: idempotencyKey,
    }, 'No pudimos enviar el reporte.'),
    // One photo: normalized here (orientation, ≤ 1600 px, no metadata), verified and registered by the gateway.
    uploadMediaPhoto: async ({
      galleryId, file, idempotencyKey, limits, signal, onStage = () => {}, onProgress = () => {},
    }) => {
      try {
        onStage('preparing');
        const payload = await prepareUploadPayload(file, { signal, limits: { ...limits, thumbnail: true, outputMime: 'image/jpeg' } });
        if (signal?.aborted) throw new MediaUploadError('Carga cancelada.', { code: 'cancelled' });
        // One request: the photo, then its grid thumbnail. The gateway verifies both and stores both, or neither.
        const upload = new Blob([payload.source, payload.thumbnail.source], { type: payload.mime });
        onStage('uploading');
        const result = await client.mediaUpload({
          galleryId, idempotencyKey, file: upload, thumbnailSize: payload.thumbnail.source.size,
        }, {
          signal,
          onProgress: (fraction) => {
            onProgress(Math.min(0.97, fraction));
            if (fraction >= 1) onStage('processing');
          },
        });
        onProgress(1);
        return {
          assetId: result?.assetId || null,
          status: result?.status || 'pending_review',
          replayed: result?.replayed === true,
          width: payload.width ?? null,
          height: payload.height ?? null,
          byteSize: payload.source.size,
          thumbnailBytes: payload.thumbnail.source.size,
        };
      } catch (error) {
        throw translateMediaUploadError(error);
      }
    },
    signMediaReadUrls: async (assets, { signal } = {}) => {
      if (!Array.isArray(assets) || assets.length === 0) return {};
      const answer = await client.mediaUrls(assets.slice(0, 120), { signal });
      const urls = {};
      for (const item of answer?.items || []) {
        if (item?.assetId && item?.kind && typeof item.url === 'string') urls[`${item.assetId}:${item.kind}`] = item.url;
      }
      return urls;
    },
  } : {};

  return Object.freeze({
    ...planAliases,
    ...commerceAliases,
    ...socialAliases,
    ...connectedAliases,
    ...brandingAliases,
    ...mediaAliases,
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
      // BRANDING-V1: the same composition as the LOCAL service, from the signed branding context.
      const branding = brandingEnabled
        ? await call('get_tournament_branding_context', { p_organization_id: organizationId, p_tournament_id: null },
          'No pudimos cargar la identidad visual.').catch(() => null)
        : null;
      const logoByTournament = new Map((branding?.tournaments || []).map((item) => [item.id, item.logoPath || null]));
      return {
        ...context,
        organizationBranding: branding?.organization || null,
        tournaments: (context?.tournaments || []).map((tournament) => ({
          ...tournament,
          logoPath: logoByTournament.get(tournament.id) || null,
          organizationLogoPath: branding?.organization?.logoPath || null,
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
      // Signed by the gateway (call → withSignedBranding): only a path with a URL it signed survives; otherwise null
      // and the page shows the initials, as before branding existed.
      return {
        ...hub,
        tournament: {
          ...(hub?.tournament || {}),
          logoPath: hub?.tournament?.logoPath || null,
          organizationLogoPath: hub?.tournament?.organizationLogoPath || null,
        },
      };
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
export function createStagingV1Commerce(service, { redirect = null, environment = 'test' } = {}) {
  const required = ['loadSeasonEntitlements', 'loadPurchase', 'createCheckout', 'createIdempotencyKey'];
  if (!service || required.some((name) => typeof service[name] !== 'function')) return null;
  return Object.freeze({
    source: 'hybrid',
    // COMMERCE-PRODUCTION: 'test' (lab, no real charge) or 'production' (real charges); the pages only label it.
    environment: environment === 'production' ? 'production' : 'test',
    // Premium is shown only from the server's effective season entitlement.
    entitlementsAuthority: true,
    loadSeasonEntitlements: (input) => service.loadSeasonEntitlements(input),
    loadPurchase: (input) => service.loadPurchase(input),
    createCheckout: (input) => service.createCheckout(input),
    loadSeasonPurchases: typeof service.loadSeasonPurchases === 'function' ? (input) => service.loadSeasonPurchases(input) : null,
    refreshPurchase: typeof service.refreshPurchase === 'function' ? (input) => service.refreshPurchase(input) : null,
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
