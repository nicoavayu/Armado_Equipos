import { Capacitor } from '@capacitor/core';

const GOOGLE_MAPS_SCRIPT_TOKEN = 'maps.googleapis.com/maps/api/js';
const DEFAULT_LIBRARIES = ['places'];
const DEFAULT_TIMEOUT_MS = 10000;

let googleMapsLoaderPromise = null;

const getSafeWindow = () => (typeof window === 'undefined' ? null : window);
const getSafeDocument = () => (typeof document === 'undefined' ? null : document);

const normalizeLibraryList = (libraries = DEFAULT_LIBRARIES) => {
  const safeLibraries = Array.isArray(libraries) ? libraries : DEFAULT_LIBRARIES;
  const uniqueLibraries = safeLibraries
    .map((library) => String(library || '').trim())
    .filter(Boolean)
    .filter((library, index, list) => list.indexOf(library) === index);

  return uniqueLibraries.length ? uniqueLibraries : DEFAULT_LIBRARIES;
};

const getSelectedApiKey = () => {
  const webKey = String(process.env.REACT_APP_GOOGLE_MAPS_API_KEY || '').trim();
  const mobileKey = String(process.env.REACT_APP_GOOGLE_MAPS_API_KEY_MOBILE || '').trim();
  let isNative = false;

  try {
    isNative = Boolean(Capacitor?.isNativePlatform?.());
  } catch (_error) {
    isNative = false;
  }

  const selectedKey = (isNative ? mobileKey : webKey) || mobileKey || webKey;

  return {
    selectedKey,
    isNative,
    hasWebKey: Boolean(webKey),
    hasMobileKey: Boolean(mobileKey),
    usingMobileKey: selectedKey === mobileKey && Boolean(mobileKey),
  };
};

const findGoogleMapsScript = () => {
  const safeDocument = getSafeDocument();
  if (!safeDocument) return null;

  return Array.from(safeDocument.querySelectorAll('script[src]'))
    .find((node) => String(node.src || '').includes(GOOGLE_MAPS_SCRIPT_TOKEN)) || null;
};

const getScriptKey = (script) => {
  try {
    return String(new URL(script?.src || '').searchParams.get('key') || '');
  } catch (_error) {
    return '';
  }
};

const buildGoogleMapsScriptUrl = (apiKey, libraries = DEFAULT_LIBRARIES) => {
  const params = new URLSearchParams({
    key: apiKey,
    loading: 'async',
  });

  const libraryList = normalizeLibraryList(libraries);
  if (libraryList.length) {
    params.set('libraries', libraryList.join(','));
  }

  return `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
};

const createLoaderError = (message, code, cause = null) => {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
};

export const getGoogleMapsLoaderState = () => {
  const safeWindow = getSafeWindow();
  const script = findGoogleMapsScript();
  const keyInfo = getSelectedApiKey();

  return {
    hasWindow: Boolean(safeWindow),
    hasDocument: Boolean(getSafeDocument()),
    hasGoogleMaps: Boolean(safeWindow?.google?.maps),
    hasGeocoder: Boolean(safeWindow?.google?.maps?.Geocoder),
    hasImportLibrary: Boolean(safeWindow?.google?.maps?.importLibrary),
    hasExistingScript: Boolean(script),
    scriptStatus: script?.getAttribute('data-google-maps-loader-status') || null,
    hasSelectedKey: Boolean(keyInfo.selectedKey),
    hasWebKey: keyInfo.hasWebKey,
    hasMobileKey: keyInfo.hasMobileKey,
    isNative: keyInfo.isNative,
    usingMobileKey: keyInfo.usingMobileKey,
  };
};

export const loadGoogleMapsScript = ({
  libraries = DEFAULT_LIBRARIES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  const safeWindow = getSafeWindow();
  const safeDocument = getSafeDocument();

  if (safeWindow?.google?.maps) {
    return Promise.resolve(safeWindow.google.maps);
  }

  if (!safeWindow || !safeDocument) {
    return Promise.reject(createLoaderError(
      'Google Maps JS API requiere window/document',
      'GOOGLE_MAPS_DOCUMENT_UNAVAILABLE',
    ));
  }

  if (googleMapsLoaderPromise) return googleMapsLoaderPromise;

  const keyInfo = getSelectedApiKey();
  if (!keyInfo.selectedKey) {
    return Promise.reject(createLoaderError(
      'Google Maps API key ausente (REACT_APP_GOOGLE_MAPS_API_KEY/REACT_APP_GOOGLE_MAPS_API_KEY_MOBILE)',
      'GOOGLE_MAPS_API_KEY_MISSING',
    ));
  }

  const loaderPromise = new Promise((resolve, reject) => {
    let script = findGoogleMapsScript();
    const existingKey = getScriptKey(script);

    if (
      script
      && !safeWindow.google?.maps
      && (
        script.getAttribute('data-google-maps-loader-status') === 'error'
        || (existingKey && existingKey !== keyInfo.selectedKey)
      )
    ) {
      script.remove();
      script = null;
    }

    let settled = false;
    let timeoutId = null;

    const finish = () => {
      if (settled) return;

      if (safeWindow.google?.maps) {
        settled = true;
        if (timeoutId) safeWindow.clearTimeout(timeoutId);
        if (script) script.setAttribute('data-google-maps-loader-status', 'loaded');
        resolve(safeWindow.google.maps);
        return;
      }

      settled = true;
      if (timeoutId) safeWindow.clearTimeout(timeoutId);
      reject(createLoaderError(
        'Google Maps JS API cargó sin exponer window.google.maps',
        'GOOGLE_MAPS_RUNTIME_UNAVAILABLE',
      ));
    };

    const fail = (eventOrError) => {
      if (settled) return;
      settled = true;
      if (timeoutId) safeWindow.clearTimeout(timeoutId);
      if (script) script.setAttribute('data-google-maps-loader-status', 'error');
      reject(createLoaderError(
        'No se pudo cargar Google Maps JS API',
        'GOOGLE_MAPS_SCRIPT_LOAD_FAILED',
        eventOrError,
      ));
    };

    timeoutId = safeWindow.setTimeout(() => {
      if (settled) return;
      settled = true;
      if (script) script.setAttribute('data-google-maps-loader-status', 'timeout');
      reject(createLoaderError(
        'Tiempo agotado cargando Google Maps JS API',
        'GOOGLE_MAPS_SCRIPT_LOAD_TIMEOUT',
      ));
    }, timeoutMs);

    if (!script) {
      script = safeDocument.createElement('script');
      script.async = true;
      script.defer = true;
      script.src = buildGoogleMapsScriptUrl(keyInfo.selectedKey, libraries);
      script.setAttribute('data-google-maps-loader', 'runtime');
      script.setAttribute('data-google-maps-loader-status', 'loading');
      script.addEventListener('load', finish, { once: true });
      script.addEventListener('error', fail, { once: true });
      safeDocument.head.appendChild(script);
      return;
    }

    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', fail, { once: true });

    if (
      safeWindow.google?.maps
      || script.getAttribute('data-google-maps-loader-status') === 'loaded'
    ) {
      finish();
    }
  });

  googleMapsLoaderPromise = loaderPromise;
  loaderPromise.then(
    () => {
      if (googleMapsLoaderPromise === loaderPromise) googleMapsLoaderPromise = null;
    },
    () => {
      if (googleMapsLoaderPromise === loaderPromise) googleMapsLoaderPromise = null;
    },
  );

  return loaderPromise;
};
