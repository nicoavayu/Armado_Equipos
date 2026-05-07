const mockIsNativePlatform = jest.fn();
const mockGetPlatform = jest.fn();
const mockCheckPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockNativeGetCurrentPosition = jest.fn();
const originalGoogleMapsApiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
const originalGoogleMapsMobileApiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY_MOBILE;
const originalProfileGeoDebug = process.env.REACT_APP_PROFILE_GEO_DEBUG;

jest.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: (...args) => mockIsNativePlatform(...args),
    getPlatform: (...args) => mockGetPlatform(...args),
  },
}));

jest.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    checkPermissions: (...args) => mockCheckPermissions(...args),
    requestPermissions: (...args) => mockRequestPermissions(...args),
    getCurrentPosition: (...args) => mockNativeGetCurrentPosition(...args),
  },
}));

const {
  buildLabel,
  getCurrentPosition,
  isLocationServicesDisabledError,
  isPermissionDeniedError,
  reverseGeocode,
} = require('../services/locationService');

const makePosition = ({
  latitude = -34.6037347,
  longitude = -58.3815704,
  accuracy = 35,
} = {}) => ({
  coords: {
    latitude,
    longitude,
    accuracy,
  },
  timestamp: Date.parse('2026-05-05T12:00:00.000Z'),
});

const setNavigatorValue = (key, value) => {
  Object.defineProperty(navigator, key, {
    configurable: true,
    value,
  });
};

const clearGoogleMapsRuntime = () => {
  if (typeof window !== 'undefined') {
    delete window.google;
  }
  if (typeof document !== 'undefined') {
    document
      .querySelectorAll('script[src*="maps.googleapis.com/maps/api/js"]')
      .forEach((script) => script.remove());
  }
};

const installMockGeocoder = (components) => {
  window.google = {
    maps: {
      Geocoder: class MockGeocoder {
        geocode(_request, callback) {
          callback([{ address_components: components }], 'OK');
        }
      },
    },
  };
};

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const restoreEnvValue = (key, value) => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};

describe('locationService', () => {
  beforeEach(() => {
    mockIsNativePlatform.mockReset();
    mockGetPlatform.mockReset();
    mockCheckPermissions.mockReset();
    mockRequestPermissions.mockReset();
    mockNativeGetCurrentPosition.mockReset();

    mockIsNativePlatform.mockReturnValue(false);
    mockGetPlatform.mockReturnValue('web');
    setNavigatorValue('geolocation', undefined);
    setNavigatorValue('permissions', undefined);
    process.env.REACT_APP_GOOGLE_MAPS_API_KEY = '';
    process.env.REACT_APP_GOOGLE_MAPS_API_KEY_MOBILE = '';
    process.env.REACT_APP_PROFILE_GEO_DEBUG = '';
    clearGoogleMapsRuntime();
  });

  afterAll(() => {
    restoreEnvValue('REACT_APP_GOOGLE_MAPS_API_KEY', originalGoogleMapsApiKey);
    restoreEnvValue('REACT_APP_GOOGLE_MAPS_API_KEY_MOBILE', originalGoogleMapsMobileApiKey);
    restoreEnvValue('REACT_APP_PROFILE_GEO_DEBUG', originalProfileGeoDebug);
  });

  test('usa geolocalización nativa cuando el permiso ya está concedido', async () => {
    mockIsNativePlatform.mockReturnValue(true);
    mockCheckPermissions.mockResolvedValue({ location: 'granted' });
    mockNativeGetCurrentPosition.mockResolvedValue(makePosition());

    const position = await getCurrentPosition();

    expect(position).toMatchObject({
      lat: -34.6037347,
      lng: -58.3815704,
      accuracy_m: 35,
      source: 'capacitor',
    });
    expect(mockCheckPermissions).toHaveBeenCalledTimes(1);
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockNativeGetCurrentPosition).toHaveBeenCalledTimes(1);
  });

  test('pide permiso nativo una sola vez cuando el estado está en prompt', async () => {
    mockIsNativePlatform.mockReturnValue(true);
    mockCheckPermissions.mockResolvedValue({ location: 'prompt' });
    mockRequestPermissions.mockResolvedValue({ location: 'granted' });
    mockNativeGetCurrentPosition.mockResolvedValue(makePosition());

    await expect(getCurrentPosition()).resolves.toMatchObject({
      source: 'capacitor',
    });

    expect(mockCheckPermissions).toHaveBeenCalledTimes(1);
    expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
    expect(mockNativeGetCurrentPosition).toHaveBeenCalledTimes(1);
  });

  test('no vuelve a pedir permiso nativo cuando ya está denegado', async () => {
    mockIsNativePlatform.mockReturnValue(true);
    mockCheckPermissions.mockResolvedValue({ location: 'denied' });

    await expect(getCurrentPosition()).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      permissionBefore: 'denied',
      permissionState: 'denied',
      source: 'capacitor.checkPermissions',
    });

    expect(mockCheckPermissions).toHaveBeenCalledTimes(1);
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockNativeGetCurrentPosition).not.toHaveBeenCalled();
  });

  test('distingue servicios de ubicación apagados de permiso denegado nativo', async () => {
    mockIsNativePlatform.mockReturnValue(true);
    const nativeError = Object.assign(new Error('Location services are not enabled.'), {
      code: 'OS-PLUG-GLOC-0007',
    });
    mockCheckPermissions.mockRejectedValue(nativeError);

    await expect(getCurrentPosition()).rejects.toMatchObject({
      code: 'LOCATION_SERVICES_DISABLED',
      rawCode: 'OS-PLUG-GLOC-0007',
      source: 'capacitor.checkPermissions',
    });

    try {
      await getCurrentPosition();
    } catch (error) {
      expect(isLocationServicesDisabledError(error)).toBe(true);
      expect(isPermissionDeniedError(error)).toBe(false);
    }
  });

  test('preserva código crudo cuando getCurrentPosition nativo informa permiso denegado', async () => {
    mockIsNativePlatform.mockReturnValue(true);
    mockCheckPermissions.mockResolvedValue({ location: 'granted' });
    mockNativeGetCurrentPosition.mockRejectedValue(Object.assign(new Error('Location permission request was denied.'), {
      code: 'OS-PLUG-GLOC-0003',
    }));

    await expect(getCurrentPosition()).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      rawCode: 'OS-PLUG-GLOC-0003',
      source: 'capacitor.getCurrentPosition',
      permissionBefore: 'granted',
      permissionAfter: 'granted',
    });
  });

  test('falla de forma controlada cuando geolocation web no existe', async () => {
    await expect(getCurrentPosition()).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });

  test('web funciona aunque navigator.permissions no exista', async () => {
    const webGetCurrentPosition = jest.fn((resolve) => resolve(makePosition()));
    setNavigatorValue('geolocation', {
      getCurrentPosition: webGetCurrentPosition,
    });
    setNavigatorValue('permissions', undefined);

    await expect(getCurrentPosition()).resolves.toMatchObject({
      lat: -34.6037347,
      lng: -58.3815704,
      source: 'web',
    });
    expect(webGetCurrentPosition).toHaveBeenCalledTimes(1);
  });

  test('web con permiso prompt llama getCurrentPosition para disparar el popup del navegador', async () => {
    const webGetCurrentPosition = jest.fn((resolve) => resolve(makePosition()));
    const query = jest.fn().mockResolvedValue({ state: 'prompt' });
    setNavigatorValue('geolocation', {
      getCurrentPosition: webGetCurrentPosition,
    });
    setNavigatorValue('permissions', { query });

    await expect(getCurrentPosition()).resolves.toMatchObject({
      source: 'web',
    });
    expect(query).toHaveBeenCalledWith({ name: 'geolocation' });
    expect(webGetCurrentPosition).toHaveBeenCalledTimes(1);
  });

  test('web usa getCurrentPosition aunque permissions informe denied', async () => {
    const webGetCurrentPosition = jest.fn((_resolve, reject) => reject({ code: 1 }));
    const query = jest.fn().mockResolvedValue({ state: 'denied' });
    setNavigatorValue('geolocation', {
      getCurrentPosition: webGetCurrentPosition,
    });
    setNavigatorValue('permissions', { query });

    await expect(getCurrentPosition()).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(query).toHaveBeenCalledWith({ name: 'geolocation' });
    expect(webGetCurrentPosition).toHaveBeenCalledTimes(1);
  });

  test('usa plataforma nativa si getPlatform devuelve ios', async () => {
    mockGetPlatform.mockReturnValue('ios');
    mockCheckPermissions.mockResolvedValue({ location: 'granted' });
    mockNativeGetCurrentPosition.mockResolvedValue(makePosition());

    await expect(getCurrentPosition()).resolves.toMatchObject({
      source: 'capacitor',
    });
    expect(mockNativeGetCurrentPosition).toHaveBeenCalledTimes(1);
  });

  test('buildLabel prioriza barrio de CABA cuando Google devuelve Villa Devoto', () => {
    expect(buildLabel({
      neighborhood: 'Villa Devoto',
      city: 'Buenos Aires',
      state: 'CABA',
    })).toBe('Villa Devoto, CABA');
  });

  test('buildLabel normaliza localidad genérica de CABA sin conservar comuna', () => {
    expect(buildLabel({
      neighborhood: 'Comuna 11',
      city: 'Buenos Aires',
      state: 'Ciudad Autónoma de Buenos Aires',
    })).toBe('CABA');
  });

  test('reverseGeocode carga Google Maps si Geocoder no está disponible inicialmente', async () => {
    process.env.REACT_APP_GOOGLE_MAPS_API_KEY = 'test-web-key';
    process.env.REACT_APP_PROFILE_GEO_DEBUG = 'true';
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    const reversePromise = reverseGeocode(-34.6007, -58.5136);
    await flushPromises();
    const script = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');

    expect(script).toBeTruthy();
    expect(script.src).toContain('test-web-key');

    installMockGeocoder([
      { long_name: 'Villa Devoto', short_name: 'Villa Devoto', types: ['neighborhood'] },
      { long_name: 'Buenos Aires', short_name: 'Buenos Aires', types: ['locality'] },
      { long_name: 'Ciudad Autónoma de Buenos Aires', short_name: 'CABA', types: ['administrative_area_level_1'] },
      { long_name: 'Argentina', short_name: 'AR', types: ['country'] },
    ]);
    script.dispatchEvent(new Event('load'));

    await expect(reversePromise).resolves.toEqual({
      neighborhood: 'Villa Devoto',
      city: 'Buenos Aires',
      state: 'CABA',
      country: null,
    });
    expect(infoSpy).toHaveBeenCalledWith('[PROFILE_GEO]', 'google_maps_loader_start', expect.objectContaining({
      hasGeocoder: false,
    }));
    expect(infoSpy).toHaveBeenCalledWith('[PROFILE_GEO]', 'google_maps_loader_success', expect.objectContaining({
      hasGeocoder: true,
    }));

    infoSpy.mockRestore();
  });

  test('reverseGeocode informa loader error cuando falta la API key de Google Maps', async () => {
    process.env.REACT_APP_PROFILE_GEO_DEBUG = 'true';
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    await expect(reverseGeocode(-34.6007, -58.5136)).rejects.toMatchObject({
      code: 'GOOGLE_MAPS_API_KEY_MISSING',
    });
    expect(infoSpy).toHaveBeenCalledWith('[PROFILE_GEO]', 'google_maps_loader_error', expect.objectContaining({
      code: 'GOOGLE_MAPS_API_KEY_MISSING',
    }));

    infoSpy.mockRestore();
  });
});
