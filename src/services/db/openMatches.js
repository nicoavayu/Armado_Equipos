import { supabase } from '../../lib/supabaseClient';
import { hasValidCoordinates, toCoordinateNumber } from '../../utils/matchLocation';

// v2 surface: goalkeeper-aware open matches (falta_jugadores OR busca_arquero),
// exposing `busca_arquero`. The legacy `*` objects are kept untouched for apps
// already installed (which must not start seeing busca_arquero-only matches).
export const QUIERO_JUGAR_OPEN_MATCHES_VIEW = 'partidos_abiertos_operativos_v2';
export const QUIERO_JUGAR_OPEN_MATCHES_RPC = 'get_open_matches_for_quiero_jugar_v2';
export const QUIERO_JUGAR_AUDIT_RPC = 'debug_quiero_jugar_match_audit_v2';

const clampDistanceKm = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(30, Math.max(1, Math.round(parsed)));
};

const mapOpenMatchRow = (row) => ({
  ...row,
  distanceKm: Number.isFinite(Number(row?.distance_km)) ? Number(row.distance_km) : null,
  kickoffAt: row?.kickoff_at || null,
  userHasLocation: Boolean(row?.user_has_location),
  matchHasCoordinates: Boolean(row?.match_has_coordinates),
});

export const fetchOpenMatchesForQuieroJugar = async ({
  userLocation = null,
  maxDistanceKm = 30,
}) => {
  const safeLat = hasValidCoordinates(userLocation?.lat, userLocation?.lng)
    ? toCoordinateNumber(userLocation.lat)
    : null;
  const safeLng = hasValidCoordinates(userLocation?.lat, userLocation?.lng)
    ? toCoordinateNumber(userLocation.lng)
    : null;

  const { data, error } = await supabase.rpc(QUIERO_JUGAR_OPEN_MATCHES_RPC, {
    p_user_lat: safeLat,
    p_user_lng: safeLng,
    p_max_distance_km: clampDistanceKm(maxDistanceKm),
  });

  if (error) throw error;
  return (data || []).map(mapOpenMatchRow);
};

export const countOperationallyOpenMatches = async () => {
  const { count, error } = await supabase
    .from(QUIERO_JUGAR_OPEN_MATCHES_VIEW)
    .select('id', { count: 'exact', head: true });

  if (error) throw error;
  return Number(count || 0);
};

export const fetchQuieroJugarMatchAudit = async ({
  userLocation = null,
  maxDistanceKm = 30,
}) => {
  const safeLat = hasValidCoordinates(userLocation?.lat, userLocation?.lng)
    ? toCoordinateNumber(userLocation.lat)
    : null;
  const safeLng = hasValidCoordinates(userLocation?.lat, userLocation?.lng)
    ? toCoordinateNumber(userLocation.lng)
    : null;

  const { data, error } = await supabase.rpc(QUIERO_JUGAR_AUDIT_RPC, {
    p_user_lat: safeLat,
    p_user_lng: safeLng,
    p_max_distance_km: clampDistanceKm(maxDistanceKm),
  });

  if (error) throw error;
  return data || [];
};
