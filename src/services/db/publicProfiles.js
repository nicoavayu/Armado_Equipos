import { supabase } from '../../lib/supabaseClient';
import logger from '../../utils/logger';

// Columns of public.usuarios that nobody reads through the API (20261010124000): the owner
// reads them through get_my_profile(); other accounts get the public profile, coordinates
// rounded to ~1 km and an exact-email search. Never select these (or '*') from usuarios.
export const PRIVATE_PROFILE_FIELDS = Object.freeze([
  'email',
  'fecha_nacimiento',
  'latitud',
  'longitud',
  'location_accuracy_m',
]);

const MAX_IDS_PER_CALL = 500;

const uniqueIds = (ids) => Array.from(new Set(
  (Array.isArray(ids) ? ids : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean),
)).slice(0, MAX_IDS_PER_CALL);

/**
 * The signed-in user's own profile row, private fields included (null when signed out).
 * @param {string} [columns] PostgREST select list; '*' for the whole row.
 */
export async function fetchMyProfile(columns = '*') {
  const request = supabase.rpc('get_my_profile');
  const { data, error } = await (columns === '*' ? request : request.select(columns)).maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Other users' public profiles (every column except the private ones), in no particular order. */
export async function fetchPublicProfiles(userIds) {
  const ids = uniqueIds(userIds);
  if (ids.length === 0) return [];
  const { data, error } = await supabase.rpc('get_public_profiles', { p_user_ids: ids });
  if (error) throw error;
  return Array.isArray(data) ? data.filter(Boolean) : [];
}

/** Map of user id → { latitud, longitud } rounded to ~1 km (users without a location are absent). */
export async function fetchApproxLocations(userIds) {
  const ids = uniqueIds(userIds);
  const locations = new Map();
  if (ids.length === 0) return locations;
  const { data, error } = await supabase.rpc('get_usuarios_approx_location', { p_user_ids: ids });
  if (error) throw error;
  (data || []).forEach((row) => {
    if (row?.id) locations.set(String(row.id), { latitud: row.latitud, longitud: row.longitud });
  });
  return locations;
}

/**
 * Returns rows with `latitud`/`longitud` taken from the approximate locations of their users.
 * A failed lookup leaves rows without coordinates (distance sorting falls back to name/rating).
 * @param {Array<object>} rows
 * @param {(row: object) => string} [getUserId]
 */
export async function withApproxLocations(rows, getUserId = (row) => row?.id) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return list;
  try {
    const locations = await fetchApproxLocations(list.map(getUserId));
    return list.map((row) => {
      const location = locations.get(String(getUserId(row) || ''));
      return { ...row, latitud: location?.latitud ?? null, longitud: location?.longitud ?? null };
    });
  } catch (error) {
    logger.warn('[PROFILES] approximate locations unavailable', error);
    return list.map((row) => ({ ...row, latitud: null, longitud: null }));
  }
}

/** Name search (or an exact email) over other users; never returns emails. */
export async function searchPublicUsers(query, limit = 10) {
  const { data, error } = await supabase.rpc('search_usuarios', { p_query: query, p_limit: limit });
  if (error) throw error;
  return data || [];
}
