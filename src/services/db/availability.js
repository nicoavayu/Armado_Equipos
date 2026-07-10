import { supabase } from '../../lib/supabaseClient';

const ALLOWED_FORMATS = ['F5', 'F6', 'F7', 'F8', 'F9', 'F11'];

export const normalizeAvailabilityInput = (input = {}) => {
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  const formats = [...new Set((input.formats || []).map((value) => String(value).toUpperCase()))]
    .filter((value) => ALLOWED_FORMATS.includes(value));
  const maxDistanceKm = Math.max(1, Math.min(50, Math.round(Number(input.maxDistanceKm) || 8)));
  const latitude = Number.isFinite(Number(input.latitude)) ? Number(input.latitude) : null;
  const longitude = Number.isFinite(Number(input.longitude)) ? Number(input.longitude) : null;

  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new Error('Elegí un día y horario válidos.');
  }
  if (endsAt <= startsAt) {
    throw new Error('El horario de finalización debe ser posterior al inicio.');
  }
  if (formats.length === 0) {
    throw new Error('Elegí al menos un formato de partido.');
  }

  return {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    formats,
    maxDistanceKm,
    latitude,
    longitude,
  };
};

export const saveMyAvailability = async (input) => {
  const normalized = normalizeAvailabilityInput(input);
  const { data, error } = await supabase.rpc('upsert_my_availability', {
    p_starts_at: normalized.startsAt,
    p_ends_at: normalized.endsAt,
    p_formats: normalized.formats,
    p_max_distance_km: normalized.maxDistanceKm,
    p_latitude: normalized.latitude,
    p_longitude: normalized.longitude,
  });
  if (error) throw error;
  return data;
};

export const cancelMyAvailability = async () => {
  const { error } = await supabase.rpc('cancel_my_availability');
  if (error) throw error;
};

export const getMyActiveAvailability = async (userId) => {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('player_availability')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
};

export const findMyAvailabilityMatches = async (limit = 30) => {
  const safeLimit = Math.max(1, Math.min(100, Math.round(Number(limit) || 30)));
  const { data, error } = await supabase.rpc('find_my_availability_matches', { p_limit: safeLimit });
  if (error) throw error;
  return data || [];
};

export const createMyAutoMatchProposal = async (format) => {
  const normalized = String(format || '').toUpperCase();
  if (!ALLOWED_FORMATS.includes(normalized)) throw new Error('Elegí un formato válido.');
  const { data, error } = await supabase.rpc('create_my_auto_match_proposal', { p_format: normalized });
  if (error) throw error;
  return data;
};

export const respondToAutoMatchProposal = async (proposalId, response) => {
  const normalized = String(response || '').toLowerCase();
  if (!['accepted', 'declined'].includes(normalized)) throw new Error('Respuesta inválida.');
  const { data, error } = await supabase.rpc('respond_to_auto_match_proposal', {
    p_proposal_id: Number(proposalId),
    p_response: normalized,
  });
  if (error) throw error;
  return data;
};

export const getMyActiveProposals = async (userId) => {
  if (!userId) return [];
  const { data: memberships, error: membershipError } = await supabase
    .from('auto_match_proposal_members')
    .select('proposal_id, response, auto_match_proposals(*)')
    .eq('user_id', userId);
  if (membershipError) throw membershipError;
  return (memberships || [])
    .map((row) => ({ ...row.auto_match_proposals, my_response: row.response }))
    .filter((proposal) => proposal?.id && ['collecting', 'ready'].includes(proposal.status));
};

export const buildMatchOpportunitySummary = (matches = [], preferredFormats = []) => {
  const countsByFormat = new Map();
  for (const row of matches) {
    for (const format of row.shared_formats || []) {
      countsByFormat.set(format, (countsByFormat.get(format) || 0) + 1);
    }
  }

  const formats = [...new Set(preferredFormats)].filter((format) => ALLOWED_FORMATS.includes(format));
  return formats.map((format) => {
    const playersNeeded = Number(format.slice(1)) * 2;
    const compatiblePlayers = (countsByFormat.get(format) || 0) + 1;
    return {
      format,
      playersNeeded,
      compatiblePlayers,
      missingPlayers: Math.max(0, playersNeeded - compatiblePlayers),
      ready: compatiblePlayers >= playersNeeded,
    };
  }).sort((a, b) => (
    Number(b.ready) - Number(a.ready)
    || a.missingPlayers - b.missingPlayers
    || a.playersNeeded - b.playersNeeded
  ));
};

export { ALLOWED_FORMATS };
