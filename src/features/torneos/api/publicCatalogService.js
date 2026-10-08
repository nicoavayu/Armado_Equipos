import { supabase } from '../../../services/api/supabase';

// Explorar torneos on the single-project LOCAL stack: the three public catalog RPCs as anon (or as the signed-in
// user, who sees exactly the same safe projection). The hybrid composition uses the gateway's public route instead
// (stagingV1/publicTournamentComposition.js); both send the same arguments.
const PUBLIC_SLUG = /^[a-z0-9](?:[a-z0-9-]{1,94}[a-z0-9])$/;

export function catalogSearchParams({
  query = '',
  locality = '',
  sport = '',
  gender = '',
  scope = 'open',
  from = '',
  to = '',
  sort = 'closing',
  page = 1,
} = {}) {
  const text = (value) => {
    const trimmed = String(value || '').trim().replace(/\s+/g, ' ');
    return trimmed ? trimmed.slice(0, 80) : null;
  };
  return {
    p_query: text(query),
    p_locality: text(locality),
    p_sport: sport || null,
    p_gender: gender || null,
    p_scope: scope === 'all' ? 'all' : 'open',
    p_from: from || null,
    p_to: to || null,
    p_sort: ['closing', 'starting', 'recent'].includes(sort) ? sort : 'closing',
    p_page: String(Math.min(Math.max(Number.parseInt(page, 10) || 1, 1), 50)),
  };
}

function unwrap(result, message) {
  if (result?.error) throw new Error(message);
  return result?.data ?? null;
}

export const publicCatalogService = Object.freeze({
  mode: 'legacy-local',
  async search(filters = {}) {
    return unwrap(await supabase.rpc('search_tournament_catalog', catalogSearchParams(filters)),
      'No pudimos cargar las convocatorias.');
  },
  async loadFacets() {
    return unwrap(await supabase.rpc('get_tournament_catalog_facets', {}), 'No pudimos cargar los filtros.');
  },
  async loadEntry(publicSlug) {
    if (!PUBLIC_SLUG.test(publicSlug || '')) return null;
    return unwrap(await supabase.rpc('get_tournament_catalog_entry', { p_public_slug: publicSlug }),
      'No pudimos cargar la convocatoria.');
  },
});
