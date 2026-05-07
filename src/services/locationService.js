import { Capacitor } from '@capacitor/core';
import { Geolocation as CapacitorGeolocation } from '@capacitor/geolocation';

export const LOCATION_REFRESH_MAX_AGE_MS = 15 * 60 * 1000;
export const LOCATION_SIGNIFICANT_MOVE_M = 500;

const ALLOWED_SHORT_LOCATION_CODES = new Set(['CABA']);
const GENERIC_CABA_LOCALITY_TOKENS = new Set([
  'ciudad autónoma de buenos aires',
  'ciudad autonoma de buenos aires',
  'autonomous city of buenos aires',
  'buenos aires',
  'caba',
]);
const LOCATION_ERROR_MESSAGES = {
  PERMISSION_DENIED: 'Permiso denegado',
  POSITION_UNAVAILABLE: 'Ubicación no disponible',
  TIMEOUT: 'Tiempo agotado',
  UNAVAILABLE: 'Geolocalización no disponible',
};
const GEOLOCATION_PERMISSION = 'geolocation';
const PROMPT_PERMISSION_STATES = new Set(['prompt', 'prompt-with-rationale']);
const GRANTED_PERMISSION_STATES = new Set(['granted']);
const DENIED_PERMISSION_STATES = new Set(['denied', 'restricted']);
const DEV_LOCATION_OVERRIDE_SESSION_KEY = 'arma_dev_location_override';
const DEV_LOCATION_OVERRIDE_LOCAL_KEY = 'arma_dev_location_override';
const PROFILE_GEO_DEBUG_STORAGE_KEY = 'arma_profile_geo_debug';
const PROFILE_GEO_DEBUG_QUERY_PARAM = 'profileGeoDebug';
const DEFAULT_DEV_LOCALHOST_LOCATION = {
  lat: -34.6037347,
  lng: -58.3815704,
};

const NATIVE_PERMISSION_DENIED_CODES = new Set([
  'OS-PLUG-GLOC-0003',
  'OS-PLUG-GLOC-0008',
]);
const NATIVE_LOCATION_SERVICES_DISABLED_CODES = new Set([
  'OS-PLUG-GLOC-0007',
  'OS-PLUG-GLOC-0009',
]);
const NATIVE_TIMEOUT_CODES = new Set(['OS-PLUG-GLOC-0010']);
const NATIVE_POSITION_UNAVAILABLE_CODES = new Set([
  'OS-PLUG-GLOC-0002',
  'OS-PLUG-GLOC-0014',
  'OS-PLUG-GLOC-0015',
  'OS-PLUG-GLOC-0016',
]);

const normalizeNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value.trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const isValidCoordinates = (lat, lng) => (
  Number.isFinite(lat)
  && Number.isFinite(lng)
  && lat >= -90
  && lat <= 90
  && lng >= -180
  && lng <= 180
  && !(Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001)
);

const sanitizeToken = (value) => {
  if (value === null || value === undefined) return null;

  const cleaned = String(value)
    .replace(/\bCP\s*[A-Z]?\d{4,}[A-Z0-9-]*\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/(^[\s,.-]+|[\s,.-]+$)/g, '')
    .trim();

  if (!cleaned) return null;
  if (cleaned.toLowerCase() === 'argentina') return null;

  const lettersOnly = cleaned.replace(/[^A-Za-zÁÉÍÓÚÜÑ]/g, '');
  if (/^[A-Z]{2,4}$/.test(lettersOnly) && !ALLOWED_SHORT_LOCATION_CODES.has(lettersOnly)) {
    return null;
  }

  return cleaned;
};

const normalizeComparableToken = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const isComunaToken = (value) => /^comuna\s+\d+$/i.test(String(value || '').trim());

const isGenericCabaToken = (value) => GENERIC_CABA_LOCALITY_TOKENS.has(normalizeComparableToken(value));

const normalizeState = (value) => {
  const safeValue = sanitizeToken(value);
  if (!safeValue) return null;

  const normalized = safeValue.toLowerCase();
  if (normalized === 'ciudad autónoma de buenos aires' || normalized === 'autonomous city of buenos aires') {
    return 'CABA';
  }

  return safeValue;
};

const getAddressComponent = (components, preferredTypes = []) => {
  for (const component of components) {
    const types = Array.isArray(component?.types) ? component.types : [];
    if (preferredTypes.some((type) => types.includes(type))) {
      return sanitizeToken(component?.long_name) || sanitizeToken(component?.short_name) || null;
    }
  }

  return null;
};

const getDetectedPlatform = () => {
  try {
    return Capacitor?.getPlatform?.() || 'web';
  } catch (_error) {
    return 'web';
  }
};

const isTruthyDebugValue = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

export const isLocationDebugEnabled = () => {
  if (process.env.NODE_ENV === 'development') return true;
  if (isTruthyDebugValue(process.env.REACT_APP_PROFILE_GEO_DEBUG)) return true;
  if (typeof window === 'undefined') return false;

  try {
    const searchParams = new URLSearchParams(window.location?.search || '');
    if (isTruthyDebugValue(searchParams.get(PROFILE_GEO_DEBUG_QUERY_PARAM))) return true;
    return isTruthyDebugValue(window.sessionStorage?.getItem(PROFILE_GEO_DEBUG_STORAGE_KEY))
      || isTruthyDebugValue(window.localStorage?.getItem(PROFILE_GEO_DEBUG_STORAGE_KEY));
  } catch (_error) {
    return false;
  }
};

export const logLocationDebug = (event, details = {}) => {
  if (!isLocationDebugEnabled()) return;
  console.info('[PROFILE_GEO]', event, details);
};

const waitForGoogleMapsGeocoder = async ({ timeoutMs = 5000, intervalMs = 100 } = {}) => {
  if (typeof window === 'undefined') return null;
  if (window.google?.maps?.Geocoder) return window.google.maps.Geocoder;

  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if (window.google?.maps?.Geocoder) return window.google.maps.Geocoder;
  }

  return null;
};

const createLocationError = (message, code, error = {}, context = {}) => {
  const locationError = new Error(message);
  locationError.code = code;
  locationError.permissionState = context.permissionState || error?.permissionState || null;
  locationError.platform = context.platform || error?.platform || getDetectedPlatform();
  locationError.source = context.source || error?.source || null;
  locationError.rawCode = error?.rawCode || error?.code || null;
  locationError.rawMessage = error?.rawMessage || error?.message || null;
  locationError.permissionBefore = context.permissionBefore ?? error?.permissionBefore ?? null;
  locationError.permissionAfter = context.permissionAfter ?? error?.permissionAfter ?? null;
  return locationError;
};

const normalizeLocationError = (error, context = {}) => {
  if (!error) {
    return createLocationError(LOCATION_ERROR_MESSAGES.UNAVAILABLE, 'UNAVAILABLE', {}, context);
  }

  const rawCode = error?.rawCode || error?.code || null;
  const rawMessage = String(error?.rawMessage || error?.message || '').toLowerCase();
  const permissionState = context.permissionState || error?.permissionState || null;
  const normalizedPermissionState = permissionState ? String(permissionState).toLowerCase() : null;

  if (
    NATIVE_LOCATION_SERVICES_DISABLED_CODES.has(rawCode)
    || rawMessage.includes('location services are not enabled')
    || rawMessage.includes('location settings error')
  ) {
    return createLocationError('Ubicación del dispositivo desactivada', 'LOCATION_SERVICES_DISABLED', error, {
      ...context,
      permissionState: normalizedPermissionState || 'unknown',
    });
  }

  if (
    error.code === 1
    || rawCode === 'PERMISSION_DENIED'
    || NATIVE_PERMISSION_DENIED_CODES.has(rawCode)
    || DENIED_PERMISSION_STATES.has(normalizedPermissionState)
    || rawMessage.includes('user denied geolocation')
    || rawMessage.includes('permission denied')
    || rawMessage.includes('permission request was denied')
    || rawMessage.includes('permiso denegado')
  ) {
    return createLocationError(LOCATION_ERROR_MESSAGES.PERMISSION_DENIED, 'PERMISSION_DENIED', error, {
      ...context,
      permissionState: normalizedPermissionState || 'denied',
    });
  }

  if (error.code === 2 || rawCode === 'POSITION_UNAVAILABLE' || NATIVE_POSITION_UNAVAILABLE_CODES.has(rawCode)) {
    return createLocationError(LOCATION_ERROR_MESSAGES.POSITION_UNAVAILABLE, 'POSITION_UNAVAILABLE', error, context);
  }

  if (error.code === 3 || rawCode === 'TIMEOUT' || NATIVE_TIMEOUT_CODES.has(rawCode)) {
    return createLocationError(LOCATION_ERROR_MESSAGES.TIMEOUT, 'TIMEOUT', error, context);
  }

  return createLocationError(error.message || LOCATION_ERROR_MESSAGES.UNAVAILABLE, error.code || 'UNAVAILABLE', error, context);
};

const normalizeNativePermissionState = (permission = {}) => {
  const states = [permission?.location, permission?.coarseLocation]
    .filter(Boolean)
    .map((state) => String(state).toLowerCase());

  if (!states.length) return 'prompt';
  if (states.some((state) => GRANTED_PERMISSION_STATES.has(state))) return 'granted';
  if (states.some((state) => PROMPT_PERMISSION_STATES.has(state))) return 'prompt';
  if (states.every((state) => DENIED_PERMISSION_STATES.has(state))) return 'denied';

  return 'prompt';
};

const getWebPermissionState = async () => {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown';

  try {
    const status = await navigator.permissions.query({ name: GEOLOCATION_PERMISSION });
    return status?.state || 'unknown';
  } catch (_error) {
    return 'unknown';
  }
};

const isNativeCapacitorPlatform = () => {
  if (Capacitor?.isNativePlatform?.()) return true;
  const platform = Capacitor?.getPlatform?.();
  return platform === 'ios' || platform === 'android';
};

export const getLocationPlatformInfo = () => ({
  platform: getDetectedPlatform(),
  isNative: isNativeCapacitorPlatform(),
  hasCapacitorGeolocation: Boolean(CapacitorGeolocation?.getCurrentPosition),
  hasWebGeolocation: typeof navigator !== 'undefined' && Boolean(navigator.geolocation),
  hasWebPermissionsApi: typeof navigator !== 'undefined' && Boolean(navigator.permissions?.query),
});

const toLocationResult = (position, source) => {
  const lat = normalizeNumber(position?.coords?.latitude);
  const lng = normalizeNumber(position?.coords?.longitude);
  const accuracy = normalizeNumber(position?.coords?.accuracy);
  const timestamp = normalizeNumber(position?.timestamp) || Date.now();

  if (!isValidCoordinates(lat, lng)) {
    throw normalizeLocationError({ code: 'POSITION_UNAVAILABLE' });
  }

  return {
    lat,
    lng,
    accuracy_m: accuracy,
    timestamp: new Date(timestamp).toISOString(),
    source,
  };
};

const requestWebPosition = (options, context = {}) => new Promise((resolve, reject) => {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    reject(normalizeLocationError({ code: 'UNAVAILABLE' }, context));
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      try {
        resolve(toLocationResult(position, 'web'));
      } catch (error) {
        reject(normalizeLocationError(error, context));
      }
    },
    (error) => reject(normalizeLocationError(error, context)),
    options,
  );
});

const getWebPosition = async (options) => {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw normalizeLocationError({ code: 'UNAVAILABLE' }, {
      platform: getDetectedPlatform(),
      source: 'web.navigator',
    });
  }

  const permissionBefore = await getWebPermissionState();
  logLocationDebug('permission_before', {
    ...getLocationPlatformInfo(),
    method: 'web navigator',
    permissionState: permissionBefore,
  });

  try {
    const position = await requestWebPosition(options, {
      platform: getDetectedPlatform(),
      source: 'web.navigator',
      permissionBefore,
      permissionState: permissionBefore === 'denied' ? 'denied' : null,
    });
    logLocationDebug('position_success', {
      platform: getDetectedPlatform(),
      method: 'web navigator',
      source: position.source,
      coords: {
        latitude: position.lat,
        longitude: position.lng,
        accuracy: position.accuracy_m,
        timestamp: position.timestamp,
      },
      lat: position.lat,
      lng: position.lng,
      accuracy_m: position.accuracy_m,
      timestamp: position.timestamp,
    });
    return {
      ...position,
      platform: getDetectedPlatform(),
      permissionState: permissionBefore,
    };
  } catch (error) {
    throw normalizeLocationError(error, {
      platform: getDetectedPlatform(),
      source: 'web.navigator',
      permissionBefore,
      permissionState: error?.permissionState || (permissionBefore === 'denied' ? 'denied' : null),
    });
  }
};

const ensureNativeLocationPermission = async () => {
  const platform = getDetectedPlatform();

  if (!CapacitorGeolocation?.checkPermissions && !CapacitorGeolocation?.requestPermissions) {
    return {
      permissionBefore: 'unknown',
      permissionAfter: 'granted',
    };
  }

  const checkedPermission = CapacitorGeolocation?.checkPermissions
    ? await CapacitorGeolocation.checkPermissions().catch((error) => {
      throw normalizeLocationError(error, {
        platform,
        source: 'capacitor.checkPermissions',
      });
    })
    : null;
  let permissionState = normalizeNativePermissionState(checkedPermission);

  logLocationDebug('permission_before', {
    ...getLocationPlatformInfo(),
    method: 'Capacitor Geolocation',
    permissionState,
    rawPermission: checkedPermission,
  });

  if (permissionState === 'denied') {
    throw normalizeLocationError({ code: 'PERMISSION_DENIED', permissionState }, {
      platform,
      source: 'capacitor.checkPermissions',
      permissionBefore: permissionState,
      permissionState,
    });
  }

  if (permissionState === 'prompt') {
    if (!CapacitorGeolocation?.requestPermissions) {
      throw normalizeLocationError({ code: 'PERMISSION_DENIED', permissionState }, {
        platform,
        source: 'capacitor.requestPermissions.unavailable',
        permissionBefore: permissionState,
        permissionState,
      });
    }

    const requestedPermission = await CapacitorGeolocation.requestPermissions().catch((error) => {
      throw normalizeLocationError(error, {
        platform,
        source: 'capacitor.requestPermissions',
        permissionBefore: permissionState,
        permissionState,
      });
    });
    permissionState = normalizeNativePermissionState(requestedPermission);

    logLocationDebug('permission_after', {
      ...getLocationPlatformInfo(),
      method: 'Capacitor Geolocation',
      permissionState,
      rawPermission: requestedPermission,
    });

    if (permissionState !== 'granted') {
      throw normalizeLocationError({ code: 'PERMISSION_DENIED', permissionState }, {
        platform,
        source: 'capacitor.requestPermissions',
        permissionBefore: 'prompt',
        permissionAfter: permissionState,
        permissionState,
      });
    }
  }

  return {
    permissionBefore: normalizeNativePermissionState(checkedPermission),
    permissionAfter: permissionState,
  };
};

const getNativePosition = async (options) => {
  if (!isNativeCapacitorPlatform() || !CapacitorGeolocation?.getCurrentPosition) return null;

  const platform = getDetectedPlatform();
  const permission = await ensureNativeLocationPermission();

  logLocationDebug('position_request', {
    ...getLocationPlatformInfo(),
    method: 'Capacitor Geolocation',
    permissionState: permission.permissionAfter,
  });

  try {
    const position = await CapacitorGeolocation.getCurrentPosition(options);
    const result = toLocationResult(position, 'capacitor');
    logLocationDebug('position_success', {
      platform,
      method: 'Capacitor Geolocation',
      source: result.source,
      permissionState: permission.permissionAfter,
      coords: {
        latitude: result.lat,
        longitude: result.lng,
        accuracy: result.accuracy_m,
        timestamp: result.timestamp,
      },
      lat: result.lat,
      lng: result.lng,
      accuracy_m: result.accuracy_m,
      timestamp: result.timestamp,
    });
    return {
      ...result,
      platform,
      permissionState: permission.permissionAfter,
    };
  } catch (error) {
    throw normalizeLocationError(error, {
      platform,
      source: 'capacitor.getCurrentPosition',
      permissionBefore: permission.permissionBefore,
      permissionAfter: permission.permissionAfter,
      permissionState: permission.permissionAfter,
    });
  }
};

const toRadians = (value) => value * (Math.PI / 180);

const isLocalhostHostname = (value) => {
  const host = String(value || '').trim().toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
};

const parseOverrideLocation = (value) => {
  if (!value) return null;

  if (typeof value === 'string') {
    try {
      const parsedJson = JSON.parse(value);
      return parseOverrideLocation(parsedJson);
    } catch (_error) {
      const [latToken, lngToken] = value.split(',').map((token) => token?.trim());
      const lat = normalizeNumber(latToken);
      const lng = normalizeNumber(lngToken);
      if (isValidCoordinates(lat, lng)) {
        return { lat, lng };
      }
      return null;
    }
  }

  if (typeof value === 'object') {
    const lat = normalizeNumber(value?.lat ?? value?.latitude);
    const lng = normalizeNumber(value?.lng ?? value?.longitude);
    if (isValidCoordinates(lat, lng)) {
      return { lat, lng };
    }
  }

  return null;
};

export const distanceInMeters = (fromLat, fromLng, toLat, toLng) => {
  const lat1 = normalizeNumber(fromLat);
  const lng1 = normalizeNumber(fromLng);
  const lat2 = normalizeNumber(toLat);
  const lng2 = normalizeNumber(toLng);

  if (!isValidCoordinates(lat1, lng1) || !isValidCoordinates(lat2, lng2)) return null;

  const earthRadiusM = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusM * c;
};

export const getCurrentPosition = async (options = {}) => {
  const resolvedOptions = {
    enableHighAccuracy: false,
    timeout: 15000,
    maximumAge: 0,
    ...options,
  };
  const platformInfo = getLocationPlatformInfo();

  logLocationDebug('position_start', {
    ...platformInfo,
    method: platformInfo.isNative ? 'Capacitor Geolocation' : 'web navigator',
    options: resolvedOptions,
  });

  try {
    const nativePosition = await getNativePosition(resolvedOptions);
    if (nativePosition) return nativePosition;
  } catch (error) {
    const normalizedError = normalizeLocationError(error, {
      platform: platformInfo.platform,
      source: error?.source || 'capacitor',
    });
    logLocationDebug('position_error', {
      platform: normalizedError.platform,
      method: 'Capacitor Geolocation',
      source: normalizedError.source,
      permissionState: normalizedError.permissionState,
      permissionBefore: normalizedError.permissionBefore,
      permissionAfter: normalizedError.permissionAfter,
      code: normalizedError.code,
      rawCode: normalizedError.rawCode,
      rawMessage: normalizedError.rawMessage,
      message: normalizedError.message,
    });
    throw normalizedError;
  }

  try {
    return await getWebPosition(resolvedOptions);
  } catch (error) {
    const normalizedError = normalizeLocationError(error, {
      platform: platformInfo.platform,
      source: error?.source || 'web.navigator',
    });
    logLocationDebug('position_error', {
      platform: normalizedError.platform,
      method: 'web navigator',
      source: normalizedError.source,
      permissionState: normalizedError.permissionState,
      permissionBefore: normalizedError.permissionBefore,
      permissionAfter: normalizedError.permissionAfter,
      code: normalizedError.code,
      rawCode: normalizedError.rawCode,
      rawMessage: normalizedError.rawMessage,
      message: normalizedError.message,
    });
    throw normalizedError;
  }
};

export const getLocalhostDevelopmentLocation = () => {
  if (process.env.NODE_ENV !== 'development') return null;
  if (typeof window === 'undefined') return null;
  if (!isLocalhostHostname(window.location?.hostname)) return null;

  const searchParams = new URLSearchParams(window.location?.search || '');
  const queryLat = normalizeNumber(searchParams.get('devLat'));
  const queryLng = normalizeNumber(searchParams.get('devLng'));
  if (isValidCoordinates(queryLat, queryLng)) {
    return {
      lat: queryLat,
      lng: queryLng,
      accuracy_m: null,
      timestamp: new Date().toISOString(),
      source: 'localhost_query_override',
    };
  }

  const sessionOverride = parseOverrideLocation(window.sessionStorage?.getItem(DEV_LOCATION_OVERRIDE_SESSION_KEY));
  if (sessionOverride) {
    return {
      ...sessionOverride,
      accuracy_m: null,
      timestamp: new Date().toISOString(),
      source: 'localhost_session_override',
    };
  }

  const localOverride = parseOverrideLocation(window.localStorage?.getItem(DEV_LOCATION_OVERRIDE_LOCAL_KEY));
  if (localOverride) {
    return {
      ...localOverride,
      accuracy_m: null,
      timestamp: new Date().toISOString(),
      source: 'localhost_local_override',
    };
  }

  return {
    ...DEFAULT_DEV_LOCALHOST_LOCATION,
    accuracy_m: null,
    timestamp: new Date().toISOString(),
    source: 'localhost_default_caba',
  };
};

export const reverseGeocode = async (lat, lng) => {
  const latitude = normalizeNumber(lat);
  const longitude = normalizeNumber(lng);

  if (!isValidCoordinates(latitude, longitude)) {
    throw new Error('Coordenadas inválidas para reverse geocoding');
  }

  if (typeof window === 'undefined' || !window.google?.maps?.Geocoder) {
    const Geocoder = await waitForGoogleMapsGeocoder();
    if (!Geocoder) {
      throw new Error('Google Maps Geocoder no disponible');
    }

    const geocoder = new Geocoder();
    return reverseGeocodeWithGeocoder(geocoder, latitude, longitude);
  }

  const geocoder = new window.google.maps.Geocoder();
  return reverseGeocodeWithGeocoder(geocoder, latitude, longitude);
};

const reverseGeocodeWithGeocoder = async (geocoder, latitude, longitude) => {
  const results = await new Promise((resolve, reject) => {
    geocoder.geocode({ location: { lat: latitude, lng: longitude } }, (geocodeResults, status) => {
      if (status === 'OK') {
        resolve(Array.isArray(geocodeResults) ? geocodeResults : []);
        return;
      }
      reject(new Error(`Google Geocoder status: ${status}`));
    });
  });

  const addressComponents = results
    .flatMap((result) => (Array.isArray(result?.address_components) ? result.address_components : []));

  const neighborhood = getAddressComponent(addressComponents, [
    'neighborhood',
    'sublocality_level_1',
    'sublocality',
    'administrative_area_level_3',
  ]);

  const city = getAddressComponent(addressComponents, [
    'locality',
    'administrative_area_level_2',
  ]);

  const state = normalizeState(getAddressComponent(addressComponents, [
    'administrative_area_level_1',
  ]));

  const country = getAddressComponent(addressComponents, ['country']);

  return {
    neighborhood: sanitizeToken(neighborhood),
    city: sanitizeToken(city),
    state: sanitizeToken(state),
    country: sanitizeToken(country),
  };
};

export const buildLabel = (location = {}) => {
  const rawNeighborhood = sanitizeToken(location?.neighborhood || location?.barrio);
  const neighborhood = rawNeighborhood && !isComunaToken(rawNeighborhood) ? rawNeighborhood : null;
  const city = sanitizeToken(location?.city || location?.ciudad);
  const state = normalizeState(location?.state || location?.provincia);

  let secondary = city || state || null;
  if (state === 'CABA' && city && isGenericCabaToken(city)) {
    secondary = 'CABA';
  }

  if (neighborhood) {
    if (secondary && secondary.toLowerCase() !== neighborhood.toLowerCase()) {
      return `${neighborhood}, ${secondary}`;
    }
    return neighborhood;
  }

  if (state === 'CABA' && (!city || isGenericCabaToken(city))) {
    return 'CABA';
  }

  return city || state || null;
};

export const shouldRefresh = ({
  lastLocation = {},
  nextPosition = null,
  now = Date.now(),
  maxAgeMs = LOCATION_REFRESH_MAX_AGE_MS,
  minDistanceM = LOCATION_SIGNIFICANT_MOVE_M,
} = {}) => {
  const previousLat = normalizeNumber(lastLocation?.lat ?? lastLocation?.latitud);
  const previousLng = normalizeNumber(lastLocation?.lng ?? lastLocation?.longitud);
  const previousUpdatedAt = lastLocation?.updated_at || lastLocation?.location_updated_at || null;

  if (!isValidCoordinates(previousLat, previousLng)) return true;
  if (!previousUpdatedAt) return true;

  const previousTimestamp = new Date(previousUpdatedAt).getTime();
  if (!Number.isFinite(previousTimestamp)) return true;
  if ((Number(now) - previousTimestamp) > maxAgeMs) return true;

  const nextLat = normalizeNumber(nextPosition?.lat);
  const nextLng = normalizeNumber(nextPosition?.lng);
  if (!isValidCoordinates(nextLat, nextLng)) return false;

  const distanceM = distanceInMeters(previousLat, previousLng, nextLat, nextLng);
  if (!Number.isFinite(distanceM)) return true;

  return distanceM > minDistanceM;
};

export const isPermissionDeniedError = (error) => (
  error?.code === 'PERMISSION_DENIED'
  || error?.code === 1
  || DENIED_PERMISSION_STATES.has(String(error?.permissionState || '').toLowerCase())
  || String(error?.message || '').toLowerCase().includes('permiso denegado')
  || String(error?.message || '').toLowerCase().includes('permission denied')
);

export const isLocationServicesDisabledError = (error) => (
  error?.code === 'LOCATION_SERVICES_DISABLED'
  || NATIVE_LOCATION_SERVICES_DISABLED_CODES.has(error?.rawCode)
  || String(error?.message || '').toLowerCase().includes('ubicación del dispositivo desactivada')
  || String(error?.rawMessage || '').toLowerCase().includes('location services are not enabled')
);
