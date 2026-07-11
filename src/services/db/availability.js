import { supabase } from '../../lib/supabaseClient';
import {
  AUTH_REQUIRED_MESSAGE,
  describeDbAccessError,
  getUsableSession,
} from './dbErrors';

const ALLOWED_FORMATS = ['F5', 'F6', 'F7', 'F8', 'F9', 'F11'];

export { AUTH_REQUIRED_MESSAGE, PERMISSION_DENIED_MESSAGE } from './dbErrors';

// The backend RPCs are granted to `authenticated` only; without a usable
// session every call would fail as `anon`, so surface a re-login prompt
// before making the request.
const requireSession = async () => {
  const session = await getUsableSession();
  if (!session) throw new Error(AUTH_REQUIRED_MESSAGE);
  return session;
};

const describeAvailabilityDbError = describeDbAccessError;

const toCoordinate = (value) => {
  // Number('') and Number(null) are 0, which would pin the user to 0,0.
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// ISO weekdays: 1 = lunes … 7 = domingo.
const ALLOWED_DAYS = [1, 2, 3, 4, 5, 6, 7];

// 'HH:MM' -> minutes since midnight. '24:00' is a valid end-of-day bound.
const timeToMinutes = (value) => {
  const match = /^([01]?\d|2[0-4]):([0-5]\d)$/.exec(String(value || '').trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes > 24 * 60 ? null : minutes;
};

export const normalizeAvailabilityInput = (input = {}) => {
  const days = [...new Set((input.days || []).map((value) => Number(value)))]
    .filter((value) => ALLOWED_DAYS.includes(value))
    .sort((a, b) => a - b);
  const timeStart = timeToMinutes(input.timeStart);
  const timeEnd = timeToMinutes(input.timeEnd);
  const formats = [...new Set((input.formats || []).map((value) => String(value).toUpperCase()))]
    .filter((value) => ALLOWED_FORMATS.includes(value));
  const maxDistanceKm = Math.max(1, Math.min(50, Math.round(Number(input.maxDistanceKm) || 8)));
  const latitude = toCoordinate(input.latitude);
  const longitude = toCoordinate(input.longitude);

  if (days.length === 0) {
    throw new Error('Elegí al menos un día de la semana.');
  }
  if (timeStart === null || timeEnd === null) {
    throw new Error('Elegí un rango horario válido.');
  }
  if (timeEnd <= timeStart) {
    throw new Error('El horario de finalización debe ser posterior al inicio.');
  }
  if (timeEnd - timeStart < 60) {
    // The whole matching pipeline requires 60 shared minutes, so shorter
    // windows could never produce a match.
    throw new Error('La franja tiene que durar al menos una hora.');
  }
  if (formats.length === 0) {
    throw new Error('Elegí al menos un formato de partido.');
  }

  return {
    days,
    timeStart: String(input.timeStart).trim(),
    timeEnd: String(input.timeEnd).trim(),
    formats,
    maxDistanceKm,
    latitude,
    longitude,
  };
};

export const saveMyAvailability = async (input) => {
  const normalized = normalizeAvailabilityInput(input);
  const session = await requireSession();
  const { data, error } = await supabase.rpc('upsert_my_availability', {
    p_days: normalized.days,
    p_time_start: normalized.timeStart,
    p_time_end: normalized.timeEnd,
    p_formats: normalized.formats,
    p_max_distance_km: normalized.maxDistanceKm,
    p_latitude: normalized.latitude,
    p_longitude: normalized.longitude,
  });
  if (error) {
    throw describeAvailabilityDbError(error, {
      operation: 'saveMyAvailability', target: 'rpc:upsert_my_availability', userId: session.user?.id,
    });
  }
  return data;
};

export const cancelMyAvailability = async () => {
  const session = await requireSession();
  const { error } = await supabase.rpc('cancel_my_availability');
  if (error) {
    throw describeAvailabilityDbError(error, {
      operation: 'cancelMyAvailability', target: 'rpc:cancel_my_availability', userId: session.user?.id,
    });
  }
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
  const session = await requireSession();
  const { data, error } = await supabase.rpc('find_my_availability_matches', { p_limit: safeLimit });
  if (error) {
    throw describeAvailabilityDbError(error, {
      operation: 'findMyAvailabilityMatches', target: 'rpc:find_my_availability_matches', userId: session.user?.id,
    });
  }
  return data || [];
};

export const createMyAutoMatchProposal = async (format) => {
  const normalized = String(format || '').toUpperCase();
  if (!ALLOWED_FORMATS.includes(normalized)) throw new Error('Elegí un formato válido.');
  const session = await requireSession();
  const { data, error } = await supabase.rpc('create_my_auto_match_proposal', { p_format: normalized });
  if (error) {
    throw describeAvailabilityDbError(error, {
      operation: 'createMyAutoMatchProposal', target: 'rpc:create_my_auto_match_proposal', userId: session.user?.id,
    });
  }
  return data;
};

export const respondToAutoMatchProposal = async (proposalId, response) => {
  const normalized = String(response || '').toLowerCase();
  if (!['accepted', 'declined'].includes(normalized)) throw new Error('Respuesta inválida.');
  const session = await requireSession();
  const { data, error } = await supabase.rpc('respond_to_auto_match_proposal', {
    p_proposal_id: Number(proposalId),
    p_response: normalized,
  });
  if (error) {
    throw describeAvailabilityDbError(error, {
      operation: 'respondToAutoMatchProposal', target: 'rpc:respond_to_auto_match_proposal', userId: session.user?.id,
    });
  }
  return data;
};

export const getMyActiveProposals = async (userId) => {
  if (!userId) return [];
  const { data: memberships, error: membershipError } = await supabase
    .from('auto_match_proposal_members')
    .select('proposal_id, response, auto_match_proposals(*)')
    .eq('user_id', userId);
  if (membershipError) throw membershipError;
  const now = Date.now();
  return (memberships || [])
    .map((row) => ({ ...row.auto_match_proposals, my_response: row.response }))
    .filter((proposal) => proposal?.id && ['collecting', 'ready'].includes(proposal.status))
    // Nothing flips status when expires_at passes (there is no cron): a stale
    // 'collecting' proposal would otherwise stay on screen forever, and
    // responding to it can only fail with proposal_not_open.
    .filter((proposal) => !proposal.expires_at || new Date(proposal.expires_at).getTime() > now);
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
