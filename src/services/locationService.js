import { Capacitor } from '@capacitor/core';
import { Geolocation as CapacitorGeolocation } from '@capacitor/geolocation';

export const LOCATION_REFRESH_MAX_AGE_MS = 15 * 60 * 1000;
export const LOCATION_SIGNIFICANT_MOVE_M = 500;

const ALLOWED_SHORT_LOCATION_CODES = new Set(['CABA']);
const LOCATION_ERROR_MESSAGES = {
  PERMISSION_DENIED: 'Permiso denegado',
  POSITION_UNAVAILABLE: 'Ubicación no disponible',
  TIMEOUT: 'Tiempo agotado',
  UNAVAILABLE: 'Geolocalización no disponible',
};

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

const normalizeLocationError = (error) => {
  if (!error) {
    const genericError = new Error(LOCATION_ERROR_MESSAGES.UNAVAILABLE);
    genericError.code = 'UNAVAILABLE';
    return genericError;
  }

  if (error.code === 1 || error.code === 'PERMISSION_DENIED' || error?.message?.toLowerCase?.().includes('denied')) {
    const permissionError = new Error(LOCATION_ERROR_MESSAGES.PERMISSION_DENIED);
    permissionError.code = 'PERMISSION_DENIED';
    return permissionError;
  }

  if (error.code === 2 || error.code === 'POSITION_UNAVAILABLE') {
    const unavailableError = new Error(LOCATION_ERROR_MESSAGES.POSITION_UNAVAILABLE);
    unavailableError.code = 'POSITION_UNAVAILABLE';
    return unavailableError;
  }

  if (error.code === 3 || error.code === 'TIMEOUT') {
    const timeoutError = new Error(LOCATION_ERROR_MESSAGES.TIMEOUT);
    timeoutError.code = 'TIMEOUT';
    return timeoutError;
  }

  const fallbackError = new Error(error.message || LOCATION_ERROR_MESSAGES.UNAVAILABLE);
  fallbackError.code = error.code || 'UNAVAILABLE';
  return fallbackError;
};

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

const getWebPosition = (options) => new Promise((resolve, reject) => {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    reject(normalizeLocationError({ code: 'UNAVAILABLE' }));
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      try {
        resolve(toLocationResult(position, 'web'));
      } catch (error) {
        reject(normalizeLocationError(error));
      }
    },
    (error) => reject(normalizeLocationError(error)),
    options,
  );
});

const getNativePosition = async (options) => {
  if (!Capacitor?.isNativePlatform?.() || !CapacitorGeolocation?.getCurrentPosition) return null;

  if (CapacitorGeolocation?.requestPermissions) {
    const permission = await CapacitorGeolocation.requestPermissions();
    if (permission?.location === 'denied' || permission?.coarseLocation === 'denied') {
      throw normalizeLocationError({ code: 'PERMISSION_DENIED' });
    }
  }

  const position = await CapacitorGeolocation.getCurrentPosition(options);
  return toLocationResult(position, 'capacitor');
};

const toRadians = (value) => value * (Math.PI / 180);

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

  try {
    const nativePosition = await getNativePosition(resolvedOptions);
    if (nativePosition) return nativePosition;
  } catch (error) {
    throw normalizeLocationError(error);
  }

  return getWebPosition(resolvedOptions);
};

export const reverseGeocode = async (lat, lng) => {
  const latitude = normalizeNumber(lat);
  const longitude = normalizeNumber(lng);

  if (!isValidCoordinates(latitude, longitude)) {
    throw new Error('Coordenadas inválidas para reverse geocoding');
  }

  if (typeof window === 'undefined' || !window.google?.maps?.Geocoder) {
    throw new Error('Google Maps Geocoder no disponible');
  }

  const geocoder = new window.google.maps.Geocoder();
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
  const neighborhood = sanitizeToken(location?.neighborhood || location?.barrio);
  const city = sanitizeToken(location?.city || location?.ciudad);
  const state = normalizeState(location?.state || location?.provincia);

  let secondary = city || state || null;
  if (state === 'CABA' && city && city.toLowerCase().includes('buenos aires')) {
    secondary = 'CABA';
  }

  if (neighborhood) {
    if (secondary && secondary.toLowerCase() !== neighborhood.toLowerCase()) {
      return `${neighborhood}, ${secondary}`;
    }
    return neighborhood;
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
  || String(error?.message || '').toLowerCase().includes('permiso denegado')
  || String(error?.message || '').toLowerCase().includes('permission denied')
);
