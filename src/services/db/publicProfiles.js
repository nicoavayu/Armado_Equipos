import { supabase } from '../../lib/supabaseClient';
import logger from '../../utils/logger';

// What other accounts may read of public.usuarios is an explicit list, the same one the
// database uses (app_private.usuarios_public_columns(), 20261010128000). Everything else —
// email, phone, birth date, exact location, activity and push settings, any new column — is
// private by default. Rollout in two phases:
//   A (20261010124000 + 20261010128000): the RPCs below exist and this client reads through
//     them (the phone only through get_match_contact_phone);
//   B (docs/database/core-review/phase-b-usuarios-private-columns.sql): SELECT on every
//     other column is revoked, once no installed app still reads the profile with select('*').
// Until A is applied, each read falls back to the table and keeps only the public list, so
// this client can ship before the migration. Never select '*' of another user.
export const PUBLIC_PROFILE_FIELDS = Object.freeze([
  'id', 'nombre', 'avatar_url', 'avatar_zoom', 'avatar_pos_x', 'avatar_pos_y',
  'ciudad', 'localidad', 'location_label', 'location_city', 'location_state', 'location_country',
  'posicion', 'posiciones', 'pierna_habil', 'nivel', 'numero', 'bio', 'nacionalidad', 'pais_codigo',
  'disponible_arquero', 'acepta_invitaciones', 'lesion_activa', 'is_active',
  'ranking', 'partidos_jugados', 'partidos_ganados', 'partidos_perdidos', 'partidos_empatados',
  'partidos_abandonados', 'mvps', 'guantes_dorados', 'tarjetas_rojas',
  'perfil_completo', 'profile_completion', 'created_at', 'updated_at',
]);

// The sensitive ones, named for tests and reviews (the rule is the allowlist above).
export const PRIVATE_PROFILE_FIELDS = Object.freeze([
  'email',
  'telefono',
  'fecha_nacimiento',
  'latitud',
  'longitud',
  'location_accuracy_m',
]);

const MAX_IDS_PER_CALL = 500;

export const isMissingRpcError = (error) => {
  const code = String(error?.code || '').trim();
  return code === 'PGRST202' || code === '42883';
};

const uniqueIds = (ids) => Array.from(new Set(
  (Array.isArray(ids) ? ids : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean),
)).slice(0, MAX_IDS_PER_CALL);

const PUBLIC_FIELD_SET = new Set(PUBLIC_PROFILE_FIELDS);
const withPublicFieldsOnly = (row) => {
  if (!row || typeof row !== 'object') return row;
  return Object.fromEntries(Object.entries(row).filter(([field]) => PUBLIC_FIELD_SET.has(field)));
};

/**
 * The signed-in user's own profile row, private fields included. Same `{ data, error }`
 * shape as a PostgREST read: `single` keeps PGRST116 when there is no row.
 * @param {{ columns?: string, single?: boolean }} [options]
 */
export async function readMyProfile({ columns = '*', single = false } = {}) {
  let request = supabase.rpc('get_my_profile');
  if (columns !== '*') request = request.select(columns);
  const response = single ? await request.single() : await request.maybeSingle();
  if (!response?.error || !isMissingRpcError(response.error)) return response;

  // Backend without phase A yet: the owner's own row, read from the table as before.
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) return { data: null, error: response.error };
  const fallback = supabase.from('usuarios').select(columns).eq('id', userId);
  return single ? fallback.single() : fallback.maybeSingle();
}

/** The signed-in user's own profile row, or null; throws on errors. */
export async function fetchMyProfile(columns = '*') {
  const { data, error } = await readMyProfile({ columns });
  if (error) throw error;
  return data || null;
}

/** Other users' public profiles (only PUBLIC_PROFILE_FIELDS), in no particular order. */
export async function fetchPublicProfiles(userIds) {
  const ids = uniqueIds(userIds);
  if (ids.length === 0) return [];
  const { data, error } = await supabase.rpc('get_public_profiles', { p_user_ids: ids });
  if (error && isMissingRpcError(error)) {
    const legacy = await supabase.from('usuarios').select('*').in('id', ids);
    if (legacy.error) throw legacy.error;
    return (legacy.data || []).map(withPublicFieldsOnly);
  }
  if (error) throw error;
  return Array.isArray(data) ? data.filter(Boolean) : [];
}

/** Map of user id → { latitud, longitud } rounded to ~1 km (users without a location are absent). */
export async function fetchApproxLocations(userIds) {
  const ids = uniqueIds(userIds);
  const locations = new Map();
  if (ids.length === 0) return locations;
  const { data, error } = await supabase.rpc('get_usuarios_approx_location', { p_user_ids: ids });
  if (error && isMissingRpcError(error)) return locations;
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
  if (error && isMissingRpcError(error)) {
    // Backend without phase A yet: by name only (never by part of an email).
    const term = String(query || '').trim().replace(/[%_,()]/g, ' ');
    const { data: { session } = {} } = await supabase.auth.getSession();
    let request = supabase
      .from('usuarios')
      .select('id, nombre, avatar_url, localidad, ranking, posicion, partidos_jugados')
      .ilike('nombre', `%${term}%`)
      .limit(limit);
    if (session?.user?.id) request = request.neq('id', session.user.id);
    const legacy = await request;
    if (legacy.error) throw legacy.error;
    return legacy.data || [];
  }
  if (error) throw error;
  return data || [];
}
