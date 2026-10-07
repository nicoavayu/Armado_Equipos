import { isStagingV1Operation } from './stagingV1Scope';
import { isCompetitionV1Operation, isCompetitionV1PublicOperation } from './competitionV1Scope';
import { isOfficializationV1Operation } from './officializationV1Scope';
import { isSocialV1Operation } from './socialV1Scope';
import { isConnectedV1Operation, isConnectedV1PublicOperation } from './connectedV1Scope';
import { BRANDING_OBJECT_PATH, isBrandingV1Operation, isBrandingV1PublicOperation } from './brandingV1Scope';
import { isMediaV1Operation, MEDIA_READ_KINDS, MEDIA_THUMBNAIL_MAX_BYTES, MEDIA_UPLOAD_MAX_BYTES, MEDIA_UPLOAD_TYPES, MEDIA_URLS_MAX_ITEMS } from './mediaV1Scope';
import { isStagingV1Table } from './stagingV1Tables';
import { isStagingV1CommerceRead, PURCHASE_REFRESH_PATH, SEASON_CHECKOUT_PATH } from './stagingV1CommerceScope';
import { TorneosBoundaryError } from './errors';

export { TorneosBoundaryError };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PostgREST resolves an RPC by the exact set of named arguments it receives and the
// baseline functions declare no defaults: an argument left `undefined` by a page
// (JSON drops it) would make the whole call unresolvable (PGRST202). Every declared
// argument therefore travels, as an explicit null when the page has no value.
export function normalizeRpcParams(params) {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, value === undefined ? null : value]));
}

// The client is the scope boundary: an operation outside staging v1 + COMPETITION-V1 + OFFICIALIZATION-V1 never
// reaches the transport, and without a transport nothing reaches the network at all. No
// auth object, token, storage, realtime or Core client lives here.
//
// `commerce: true` (MP-A5, billing TEST overlay only) widens it by exactly the commerce
// scope: the two commerce reads and the fixed checkout route. Without it both fail
// closed before the transport. Independent `planRead: true` adds only the two
// certified entitlement RPCs; it never permits purchase reads or checkout.
// Independent `social: true` (SOCIAL-V1) adds only the three Estudio Social RPCs.
// Independent `connected: true` (CONNECTED-V1) adds only the connected product's authenticated RPCs.
// Independent `branding: true` (BRANDING-V1) adds only the two branding RPCs and the object route.
// Independent `media: true` (MEDIA-V1) adds only the gallery RPCs and the two media routes (upload, signed reads).
export function createTorneosClient({
  transport = null, commerce = false, planRead = false, social = false, connected: connectedProduct = false,
  branding = false, media = false,
} = {}) {
  const connected = Boolean(transport) && typeof transport.rpc === 'function';
  const commerceEnabled = commerce === true;
  const permitted = (operation) => isStagingV1Operation(operation)
    || isCompetitionV1Operation(operation)
    || isOfficializationV1Operation(operation)
    || (commerceEnabled && isStagingV1CommerceRead(operation))
    || (planRead === true && ['get_effective_tournament_season_entitlements', 'get_effective_tournament_entitlements'].includes(operation))
    || (social === true && isSocialV1Operation(operation))
    || (connectedProduct === true && isConnectedV1Operation(operation))
    || (branding === true && isBrandingV1Operation(operation))
    || (media === true && isMediaV1Operation(operation));
  return Object.freeze({
    status: connected ? 'connected' : 'foundation-disabled',
    async execute(operation, params = {}, options = {}) {
      if (!permitted(operation)) {
        throw new TorneosBoundaryError('TORNEOS_OUTSIDE_STAGING_V1');
      }
      if (!connected) throw new TorneosBoundaryError('TORNEOS_TRANSPORT_NOT_CONNECTED');
      if (params === null || typeof params !== 'object' || Array.isArray(params)) {
        throw new TorneosBoundaryError('TORNEOS_INVALID_REQUEST');
      }
      return transport.rpc(operation, normalizeRpcParams(params), options);
    },
    async select(table, query = {}, options = {}) {
      if (!isStagingV1Table(table)) {
        throw new TorneosBoundaryError('TORNEOS_OUTSIDE_STAGING_V1');
      }
      if (!connected || typeof transport.select !== 'function') {
        throw new TorneosBoundaryError('TORNEOS_TRANSPORT_NOT_CONNECTED');
      }
      return transport.select(table, query, options);
    },
    async checkout(body, options = {}) {
      if (!commerceEnabled) throw new TorneosBoundaryError('TORNEOS_OUTSIDE_STAGING_V1');
      if (!connected || typeof transport.commerce !== 'function') {
        throw new TorneosBoundaryError('TORNEOS_TRANSPORT_NOT_CONNECTED');
      }
      return transport.commerce(SEASON_CHECKOUT_PATH, body, options);
    },
    // COMMERCE-PRODUCTION: the purchase refresh ("I already paid"), the same commerce scope as the checkout.
    async refreshPurchase(body, options = {}) {
      if (!commerceEnabled) throw new TorneosBoundaryError('TORNEOS_OUTSIDE_STAGING_V1');
      if (!connected || typeof transport.commerce !== 'function') {
        throw new TorneosBoundaryError('TORNEOS_TRANSPORT_NOT_CONNECTED');
      }
      return transport.commerce(PURCHASE_REFRESH_PATH, body, options);
    },
    // BRANDING-V1: store (POST, with the file) or remove (DELETE) one versioned branding object.
    async brandingObject(method, path, file = undefined, options = {}) {
      if (branding !== true) throw new TorneosBoundaryError('TORNEOS_OUTSIDE_STAGING_V1');
      if (!['POST', 'DELETE'].includes(method) || !BRANDING_OBJECT_PATH.test(String(path))) {
        throw new TorneosBoundaryError('TORNEOS_INVALID_REQUEST');
      }
      if (!connected || typeof transport.brandingObject !== 'function') {
        throw new TorneosBoundaryError('TORNEOS_TRANSPORT_NOT_CONNECTED');
      }
      return transport.brandingObject(method, path, file, options);
    },
    // MEDIA-V1: one normalized photo to a gallery (the gateway verifies, stores and registers it), with real byte progress.
    // `file` is the photo followed by its JPEG thumbnail; `thumbnailSize` says where the photo ends (0 = no thumbnail).
    async mediaUpload({ galleryId, idempotencyKey, file, thumbnailSize = 0 }, options = {}) {
      if (media !== true) throw new TorneosBoundaryError('TORNEOS_OUTSIDE_STAGING_V1');
      if (!UUID.test(String(galleryId)) || !UUID.test(String(idempotencyKey)) || !file || typeof file.size !== 'number'
        || !Number.isInteger(thumbnailSize) || thumbnailSize < 0 || thumbnailSize > MEDIA_THUMBNAIL_MAX_BYTES
        || file.size - thumbnailSize <= 0 || file.size - thumbnailSize > MEDIA_UPLOAD_MAX_BYTES
        || !MEDIA_UPLOAD_TYPES.includes(file.type)) {
        throw new TorneosBoundaryError('TORNEOS_INVALID_REQUEST');
      }
      if (!connected || typeof transport.mediaUpload !== 'function') {
        throw new TorneosBoundaryError('TORNEOS_TRANSPORT_NOT_CONNECTED');
      }
      return transport.mediaUpload({ galleryId, idempotencyKey, file, thumbnailSize }, options);
    },
    // MEDIA-V1: short-lived read URLs for the assets the caller may see.
    async mediaUrls(items, options = {}) {
      if (media !== true) throw new TorneosBoundaryError('TORNEOS_OUTSIDE_STAGING_V1');
      if (!Array.isArray(items) || items.length === 0 || items.length > MEDIA_URLS_MAX_ITEMS
        || items.some((item) => !item || !UUID.test(String(item.assetId)) || !MEDIA_READ_KINDS.includes(item.kind))) {
        throw new TorneosBoundaryError('TORNEOS_INVALID_REQUEST');
      }
      if (!connected || typeof transport.mediaUrls !== 'function') {
        throw new TorneosBoundaryError('TORNEOS_TRANSPORT_NOT_CONNECTED');
      }
      return transport.mediaUrls(items.map(({ assetId, kind }) => ({ assetId, kind })), options);
    },
    clear() { transport?.clear?.(); },
    dispose() { transport?.dispose?.(); },
  });
}

// COMPETITION-V1: the anonymous public read-only client (the public tournament page). It carries no
// session at all and permits exactly the public scope; everything else fails closed before the network.
// CONNECTED-V1: `connected: true` adds exactly the public catalog RPCs. BRANDING-V1: `branding: true` adds exactly
// the public page's logos (get_public_tournament_branding).
export function createTorneosPublicClient({ transport = null, connected: connectedProduct = false, branding = false } = {}) {
  const connected = Boolean(transport) && typeof transport.publicRpc === 'function';
  return Object.freeze({
    status: connected ? 'connected' : 'foundation-disabled',
    async execute(operation, params = {}, options = {}) {
      if (!isCompetitionV1PublicOperation(operation)
        && !(connectedProduct === true && isConnectedV1PublicOperation(operation))
        && !(branding === true && isBrandingV1PublicOperation(operation))) {
        throw new TorneosBoundaryError('TORNEOS_OUTSIDE_STAGING_V1');
      }
      if (!connected) throw new TorneosBoundaryError('TORNEOS_TRANSPORT_NOT_CONNECTED');
      if (params === null || typeof params !== 'object' || Array.isArray(params)) {
        throw new TorneosBoundaryError('TORNEOS_INVALID_REQUEST');
      }
      return transport.publicRpc(operation, normalizeRpcParams(params), options);
    },
  });
}
