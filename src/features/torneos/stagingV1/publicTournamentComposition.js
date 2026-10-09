// COMPETITION-V1: which service the anonymous public tournament page (/torneos/publico/:slug) uses.
//
//   hybrid        Torneos enabled + public pages flag + the static map's public_pages →
//                 the gateway's public read-only route (no session, no credential, anon);
//   legacy-local  the single-project LOCAL QA stack → the legacy service (unchanged);
//   anything else → a closed service that answers "not found" without any network call.
//
// Never the Core project for Torneos data in a hybrid or closed build.
import { resolveTorneosBackendMode, resolveTorneosBranding, resolveTorneosConnectedProduct } from '../foundation/config';
import { createTorneosPublicTransport } from '../foundation/torneosTransport';
import { createTorneosPublicClient } from '../foundation/torneosClient';
import { stagingV1Features } from './stagingV1Features';
import { catalogSearchParams } from '../api/publicCatalogService';
import { authorizedBrandingUrl } from '../domain/brandingUrlRegistry';
import { withSignedBranding } from './brandingUrls';

const PUBLIC_SLUG = /^[a-z0-9](?:[a-z0-9-]{1,94}[a-z0-9])$/;
const CATEGORY_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])$/;
// Branding in the hybrid composition comes only from URLs the gateway signed (BRANDING-V1): a stored logo/shield path
// is kept only next to its signed URL; anything else is dropped and the page renders the initials. A path never
// resolves against the Core project's storage.
export const closedPublicTournamentService = Object.freeze({
  mode: 'closed',
  loadPage: async () => null,
  resolveTeamShieldUrl: () => null,
});

export function createHybridPublicTournamentService({ gatewayUrl, fetchImpl, branding = false } = {}) {
  const client = createTorneosPublicClient({
    transport: createTorneosPublicTransport({ gatewayUrl, ...(fetchImpl ? { fetchImpl } : {}) }),
    branding: branding === true,
  });
  return Object.freeze({
    mode: 'hybrid',
    async loadPage({ publicSlug, categorySlug = null } = {}) {
      if (!PUBLIC_SLUG.test(publicSlug || '')) return null;
      if (categorySlug && !CATEGORY_SLUG.test(categorySlug)) return null;
      let page;
      let logos = null;
      try {
        [page, logos] = await Promise.all([
          client.execute('get_public_tournament_page', {
            p_public_slug: publicSlug,
            p_category_slug: categorySlug || null,
          }),
          // BRANDING-V1: the page's logos, as the LOCAL service composes them; without them the page still loads.
          branding === true
            ? client.execute('get_public_tournament_branding', { p_public_slug: publicSlug }).catch(() => null)
            : null,
        ]);
      } catch {
        throw new Error('No pudimos cargar el torneo público.');
      }
      if (!page || typeof page !== 'object') return null;
      if (!logos || typeof logos !== 'object') return withSignedBranding(page);
      return withSignedBranding({
        ...page,
        organization: { ...(page.organization || {}), ...(logos.organization || {}) },
        tournament: {
          ...(page.tournament || {}),
          ...(logos.tournament || {}),
          organizationLogoPath: logos.organization?.logoPath || null,
          organizationLogoUrl: logos.organization?.logoUrl || null,
        },
      });
    },
    resolveTeamShieldUrl: (path) => authorizedBrandingUrl(path),
  });
}

export function resolvePublicTournamentService({
  env = process.env,
  flags,
  features = stagingV1Features,
  legacyService = null,
  fetchImpl,
} = {}) {
  if (!flags?.torneosEnabled || !flags?.publicPages) return closedPublicTournamentService;
  const backendMode = resolveTorneosBackendMode(env);
  if (backendMode.mode === 'hybrid') {
    return features.public_pages === true
      ? createHybridPublicTournamentService({
        gatewayUrl: backendMode.gatewayUrl, fetchImpl, branding: resolveTorneosBranding(env, { backendMode }),
      })
      : closedPublicTournamentService;
  }
  if (backendMode.mode === 'legacy-local' && legacyService) return legacyService;
  return closedPublicTournamentService;
}

// CONNECTED-V1: which service Explorar torneos (the catalog and its call block) uses. Same composition rule as the
// public page: the gateway's public route in hybrid (only with the connected opt-in), the legacy service on the LOCAL
// stack, and a closed service (empty catalog, no call, no request) anywhere else.
export const closedPublicCatalogService = Object.freeze({
  mode: 'closed',
  search: async () => ({ items: [], page: 1, pageSize: 12, total: 0, hasMore: false, sort: 'closing', scope: 'open' }),
  loadFacets: async () => ({ localities: [], sports: [], genders: [], total: 0 }),
  loadEntry: async () => null,
});

export function createHybridPublicCatalogService({ gatewayUrl, fetchImpl } = {}) {
  const client = createTorneosPublicClient({
    transport: createTorneosPublicTransport({ gatewayUrl, ...(fetchImpl ? { fetchImpl } : {}) }),
    connected: true,
  });
  const execute = async (name, params, message) => {
    try {
      return await client.execute(name, params);
    } catch {
      throw new Error(message);
    }
  };
  return Object.freeze({
    mode: 'hybrid',
    // Same branding rule as the public page: only what the gateway signed (published pages) becomes an image.
    search: async (filters = {}) => withSignedBranding(await execute('search_tournament_catalog', catalogSearchParams(filters),
      'No pudimos cargar las convocatorias.')),
    loadFacets: () => execute('get_tournament_catalog_facets', {}, 'No pudimos cargar los filtros.'),
    async loadEntry(publicSlug) {
      if (!PUBLIC_SLUG.test(publicSlug || '')) return null;
      return withSignedBranding(
        await execute('get_tournament_catalog_entry', { p_public_slug: publicSlug }, 'No pudimos cargar la convocatoria.'),
      );
    },
  });
}

export function resolvePublicCatalogService({
  env = process.env,
  flags,
  legacyService = null,
  fetchImpl,
} = {}) {
  if (!flags?.torneosEnabled || !flags?.publicPages) return closedPublicCatalogService;
  const backendMode = resolveTorneosBackendMode(env);
  if (!resolveTorneosConnectedProduct(env, { backendMode })) return closedPublicCatalogService;
  if (backendMode.mode === 'hybrid') return createHybridPublicCatalogService({ gatewayUrl: backendMode.gatewayUrl, fetchImpl });
  if (backendMode.mode === 'legacy-local' && legacyService) return legacyService;
  return closedPublicCatalogService;
}
