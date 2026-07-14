export const AUTO_MATCH_REFRESH_STEPS = Object.freeze({
  profileLocation: Object.freeze({
    operation: 'load_profile_location',
    target: 'rest:usuarios',
    method: 'GET',
  }),
  availability: Object.freeze({
    operation: 'load_active_availability',
    target: 'rest:player_availability',
    method: 'GET',
  }),
  sync: Object.freeze({
    operation: 'sync_gestations',
    target: 'rpc:sync_my_auto_match_gestations',
    method: 'POST',
  }),
  location: Object.freeze({
    operation: 'sync_profile_location',
    target: 'rpc:sync_my_auto_match_location_from_profile',
    method: 'POST',
  }),
  proposals: Object.freeze({
    operation: 'load_active_proposals',
    target: 'rpc:get_my_auto_match_proposals',
    method: 'POST',
  }),
  members: Object.freeze({
    operation: 'load_proposal_members',
    target: 'rpc:get_auto_match_proposal_members',
    method: 'POST',
  }),
});

export const isAutoMatchOnline = () => (
  typeof navigator === 'undefined' || navigator.onLine !== false
);

export const runAutoMatchRefreshStep = async (step, request) => {
  try {
    return await request();
  } catch (cause) {
    const error = new Error('auto_match_refresh_request_failed');
    error.name = 'AutoMatchRefreshError';
    error.cause = cause;
    error.operation = step.operation;
    error.target = step.target;
    error.method = step.method;
    throw error;
  }
};

export const getAutoMatchRetryDelay = (attempt, { online = true } = {}) => {
  const delays = online
    ? [5000, 15000, 30000, 60000]
    : [30000, 60000];
  const index = Math.min(Math.max(Number(attempt) || 1, 1) - 1, delays.length - 1);
  return delays[index];
};

export const getAutoMatchRefreshMessage = ({ online = true } = {}) => (
  online
    ? 'No pudimos actualizar la búsqueda. Vamos a volver a intentarlo.'
    : 'No pudimos actualizar la búsqueda. Revisá tu conexión.'
);
