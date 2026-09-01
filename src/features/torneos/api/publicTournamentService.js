import { supabase } from '../../../services/api/supabase';
import { resolveBrandingAssetUrl } from '../domain/brandingAssets';

const PUBLIC_SLUG = /^[a-z0-9](?:[a-z0-9-]{1,94}[a-z0-9])$/;
const CATEGORY_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])$/;

export async function loadPublicTournamentPage({ publicSlug, categorySlug = null }) {
  if (!PUBLIC_SLUG.test(publicSlug || '')) return null;
  if (categorySlug && !CATEGORY_SLUG.test(categorySlug)) return null;

  const [pageResult, brandingResult] = await Promise.all([
    supabase.rpc('get_public_tournament_page', {
      p_public_slug: publicSlug,
      p_category_slug: categorySlug || null,
    }),
    supabase.rpc('get_public_tournament_branding', {
      p_public_slug: publicSlug,
    }),
  ]);
  if (pageResult.error || brandingResult.error) {
    throw new Error('No pudimos cargar el torneo público.');
  }
  if (!pageResult.data) return null;
  return {
    ...pageResult.data,
    organization: {
      ...pageResult.data.organization,
      ...(brandingResult.data?.organization || {}),
    },
    tournament: {
      ...pageResult.data.tournament,
      ...(brandingResult.data?.tournament || {}),
      organizationLogoPath: brandingResult.data?.organization?.logoPath || null,
    },
  };
}

export function resolvePublicTeamShieldUrl(shieldPath) {
  return resolveBrandingAssetUrl({ kind: 'team', path: shieldPath });
}

export const publicTournamentService = Object.freeze({
  loadPage: loadPublicTournamentPage,
  resolveTeamShieldUrl: resolvePublicTeamShieldUrl,
});
