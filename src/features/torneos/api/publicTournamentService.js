import { supabase } from '../../../services/api/supabase';

const PUBLIC_SLUG = /^[a-z0-9](?:[a-z0-9-]{1,94}[a-z0-9])$/;
const CATEGORY_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])$/;

export async function loadPublicTournamentPage({ publicSlug, categorySlug = null }) {
  if (!PUBLIC_SLUG.test(publicSlug || '')) return null;
  if (categorySlug && !CATEGORY_SLUG.test(categorySlug)) return null;

  const { data, error } = await supabase.rpc('get_public_tournament_page', {
    p_public_slug: publicSlug,
    p_category_slug: categorySlug || null,
  });
  if (error) throw new Error('No pudimos cargar el torneo público.');
  return data || null;
}

export function resolvePublicTeamShieldUrl(shieldPath) {
  if (!shieldPath || /^https?:\/\//i.test(shieldPath)) return null;
  const { data } = supabase.storage.from('team-crests').getPublicUrl(shieldPath);
  return data?.publicUrl || null;
}

export const publicTournamentService = Object.freeze({
  loadPage: loadPublicTournamentPage,
  resolveTeamShieldUrl: resolvePublicTeamShieldUrl,
});
