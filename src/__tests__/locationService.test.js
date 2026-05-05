const mockIsNativePlatform = jest.fn();
const mockCheckPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockNativeGetCurrentPosition = jest.fn();

jest.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: (...args) => mockIsNativePlatform(...args),
  },
}));

jest.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    checkPermissions: (...args) => mockCheckPermissions(...args),
    requestPermissions: (...args) => mockRequestPermissions(...args),
    getCurrentPosition: (...args) => mockNativeGetCurrentPosition(...args),
  },
}));

const { getCurrentPosition } = require('../services/locationService');

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

describe('locationService', () => {
  beforeEach(() => {
    mockIsNativePlatform.mockReset();
    mockCheckPermissions.mockReset();
    mockRequestPermissions.mockReset();
    mockNativeGetCurrentPosition.mockReset();

    mockIsNativePlatform.mockReturnValue(false);
    setNavigatorValue('geolocation', undefined);
    setNavigatorValue('permissions', undefined);
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
    });

    expect(mockCheckPermissions).toHaveBeenCalledTimes(1);
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockNativeGetCurrentPosition).not.toHaveBeenCalled();
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

  test('web no dispara getCurrentPosition si permissions informa denied', async () => {
    const webGetCurrentPosition = jest.fn();
    const query = jest.fn().mockResolvedValue({ state: 'denied' });
    setNavigatorValue('geolocation', {
      getCurrentPosition: webGetCurrentPosition,
    });
    setNavigatorValue('permissions', { query });

    await expect(getCurrentPosition()).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(query).toHaveBeenCalledWith({ name: 'geolocation' });
    expect(webGetCurrentPosition).not.toHaveBeenCalled();
  });
});
