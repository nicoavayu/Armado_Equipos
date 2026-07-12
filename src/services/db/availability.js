import { supabase } from '../../lib/supabaseClient';
import { requestImmediatePushDispatchSafe } from '../pushDispatchService';
import {
  AUTH_REQUIRED_MESSAGE,
  describeDbAccessError,
  getUsableSession,
} from './dbErrors';

const ALLOWED_FORMATS = ['F5', 'F6', 'F7', 'F8', 'F9', 'F11'];
const AUTO_MATCH_PUSH_TYPES = [
  'auto_match_gestating',
  'auto_match_almost_full',
  'auto_match_ready',
  'auto_match_organizing',
  'auto_match_created',
  'auto_match_cancelled',
];

export { AUTH_REQUIRED_MESSAGE, PERMISSION_DENIED_MESSAGE } from './dbErrors';

const requireSession = async () => {
  const session = await getUsableSession();
  if (!session) throw new Error(AUTH_REQUIRED_MESSAGE);
  return session;
};

const describeAvailabilityDbError = describeDbAccessError;

const kickAutoMatchPushes = () => {
  AUTO_MATCH_PUSH_TYPES.forEach((eventType) => {
    requestImmediatePushDispatchSafe({ eventType, limit: 100 });
  });
};

const toCoordinate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const ALLOWED_DAYS = [1, 2, 3, 4, 5, 6, 7];

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
  const canOrganize = input.canOrganize === true;

  if (days.length === 0) throw new Error('Elegí al menos un día de la semana.');
  if (timeStart === null || timeEnd === null) throw new Error('Elegí un rango horario válido.');
  if (timeEnd <= timeStart) throw new Error('El horario de finalización debe ser posterior al inicio.');
  if (timeEnd - timeStart < 60) throw new Error('La franja tiene que durar al menos una hora.');
  if (formats.length === 0) throw new Error('Elegí al menos un formato de partido.');

  return {
    days,
    timeStart: String(input.timeStart).trim(),
    timeEnd: String(input.timeEnd).trim(),
    formats,
    maxDistanceKm,
    latitude,
    longitude,
    canOrganize,
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
    p_can_organize: normalized.canOrganize,
  });
  if (error) {
    throw describeAvailabilityDbError(error, {
      operation: 'saveMyAvailability', target: 'rpc:upsert_my_availability', userId: session.user?.id,
    });
  }
  kickAutoMatchPushes();
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

export const syncMyAutoMatchGestations = async () => {
  const session = await requireSession();
  const { data, error } = await supabase.rpc('sync_my_auto_match_gestations');
  if (error) {
    throw describeAvailabilityDbError(error, {
      operation: 'syncMyAutoMatchGestations', target: 'rpc:sync_my_auto_match_gestations', userId: session.user?.id,
    });
  }
  kickAutoMatchPushes();
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
  kickAutoMatchPushes();
  return data;
};

export const respondToAutoMatchProposal = async (proposalId, response, { canOrganize = false } = {}) => {
  const normalized = String(response || '').toLowerCase();
  if (!['accepted', 'declined'].includes(normalized)) throw new Error('Respuesta inválida.');
  const session = await requireSession();
  const { data, error } = await supabase.rpc('respond_to_auto_match_proposal', {
    p_proposal_id: Number(proposalId),
    p_response: normalized,
    p_can_organize: canOrganize === true,
  });
  if (error) {
    throw describeAvailabilityDbError(error, {
      operation: 'respondToAutoMatchProposal', target: 'rpc:respond_to_auto_match_proposal', userId: session.user?.id,
    });
  }
  kickAutoMatchPushes();
  return data;
};

export const claimAutoMatchOrganizer = async (proposalId) => {
  const session = await requireSession();
  const { data, error } = await supabase.rpc('claim_auto_match_organizer', {
    p_proposal_id: Number(proposalId),
  });
  if (error) {
    throw describeAvailabilityDbError(error, {
      operation: 'claimAutoMatchOrganizer', target: 'rpc:claim_auto_match_organizer', userId: session.user?.id,
    });
  }
  kickAutoMatchPushes();
  return data;
};

const toNullableTrimmed = (value) => {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
};

export const finalizeAutoMatchProposal = async (proposalId, {
  nombre,
  fecha = null,
  hora = null,
  tipoPartido = 'Masculino',
  precio = null,
  sede = null,
  sedePlaceId = null,
  sedeDireccion = null,
  sedeLatitud = null,
  sedeLongitud = null,
} = {}) => {
  const normalizedNombre = toNullableTrimmed(nombre);
  if (!normalizedNombre) throw new Error('Poné un nombre para el partido.');
  const normalizedPrecio = precio === null || precio === undefined || precio === ''
    ? null
    : Number(precio);
  if (normalizedPrecio !== null && (!Number.isFinite(normalizedPrecio) || normalizedPrecio < 0)) {
    throw new Error('El precio no es válido.');
  }

  const session = await requireSession();
  const { data, error } = await supabase.rpc('finalize_auto_match_proposal', {
    p_proposal_id: Number(proposalId),
    p_nombre: normalizedNombre,
    p_fecha: toNullableTrimmed(fecha),
    p_hora: toNullableTrimmed(hora),
    p_tipo_partido: toNullableTrimmed(tipoPartido) || 'Masculino',
    p_precio: normalizedPrecio,
    p_sede: toNullableTrimmed(sede),
    p_sede_place_id: toNullableTrimmed(sedePlaceId),
    p_sede_direccion: toNullableTrimmed(sedeDireccion),
    p_sede_latitud: toCoordinate(sedeLatitud),
    p_sede_longitud: toCoordinate(sedeLongitud),
  });
  if (error) {
    throw describeAvailabilityDbError(error, {
      operation: 'finalizeAutoMatchProposal', target: 'rpc:finalize_auto_match_proposal', userId: session.user?.id,
    });
  }
  kickAutoMatchPushes();
  return data;
};

export const getAutoMatchProposalMembers = async (proposalId) => {
  const session = await requireSession();
  const { data, error } = await supabase.rpc('get_auto_match_proposal_members', {
    p_proposal_id: Number(proposalId),
  });
  if (error) {
    throw describeAvailabilityDbError(error, {
      operation: 'getAutoMatchProposalMembers', target: 'rpc:get_auto_match_proposal_members', userId: session.user?.id,
    });
  }
  return data || [];
};

export const getMyActiveProposals = async (userId) => {
  if (!userId) return [];
  const session = await requireSession();
  const { data, error } = await supabase.rpc('get_my_auto_match_proposals');
  if (error) {
    throw describeAvailabilityDbError(error, {
      operation: 'getMyActiveProposals', target: 'rpc:get_my_auto_match_proposals', userId: session.user?.id,
    });
  }
  return data || [];
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
      gestationThreshold: Math.max(4, Math.ceil(playersNeeded * 0.4)),
      gestating: compatiblePlayers >= Math.max(4, Math.ceil(playersNeeded * 0.4)),
    };
  }).sort((a, b) => (
    Number(b.gestating) - Number(a.gestating)
    || Number(b.ready) - Number(a.ready)
    || a.missingPlayers - b.missingPlayers
    || a.playersNeeded - b.playersNeeded
  ));
};

export { ALLOWED_FORMATS };
