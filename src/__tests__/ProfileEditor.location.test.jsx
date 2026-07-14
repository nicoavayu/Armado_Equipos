import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProfileEditor, { shouldAttemptProfileAutoLocation } from '../components/ProfileEditor';

const mockGetCurrentPosition = jest.fn();
const mockReverseGeocode = jest.fn();
const mockGeocodeManualLocation = jest.fn();
const mockUpdateProfile = jest.fn();
const mockRefreshProfile = jest.fn();
const mockUpdateLocalProfile = jest.fn();
const mockOnClose = jest.fn();
const originalGoogleMapsApiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
const originalGoogleMapsMobileApiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY_MOBILE;
const originalProfileGeoDebug = process.env.REACT_APP_PROFILE_GEO_DEBUG;

let mockAuthValue;

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => mockAuthValue,
}));

jest.mock('../components/ProfileCard', () => {
  const React = require('react');
  return function MockProfileCard() {
    return React.createElement('div', { 'data-testid': 'profile-card' });
  };
});

jest.mock('../components/ConfirmModal', () => {
  const React = require('react');
  return function MockConfirmModal() {
    return React.createElement('div', { 'data-testid': 'confirm-modal' });
  };
});

jest.mock('../services/locationService', () => {
  const actual = jest.requireActual('../services/locationService');
  return {
    ...actual,
    getCurrentPosition: (...args) => mockGetCurrentPosition(...args),
    geocodeManualLocation: (...args) => mockGeocodeManualLocation(...args),
    reverseGeocode: (...args) => mockReverseGeocode(...args),
  };
});

jest.mock('../supabase', () => ({
  updateProfile: (...args) => mockUpdateProfile(...args),
  calculateProfileCompletion: jest.fn(() => 100),
  supabase: {
    auth: {
      updateUser: jest.fn(),
    },
    functions: {
      invoke: jest.fn(),
    },
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn(),
        getPublicUrl: jest.fn(() => ({ data: { publicUrl: '' } })),
      })),
    },
  },
}));

jest.mock('../services/authLogoutService', () => ({
  clearLocalAuthSession: jest.fn(),
  getLogoutErrorMessage: jest.fn(() => 'No se pudo cerrar sesión.'),
  signOutWithPushDeactivation: jest.fn(),
}));

jest.mock('utils/notifyBlockingError', () => ({
  notifyBlockingError: jest.fn(),
}));

const baseUser = {
  id: 'user-123',
  email: 'nico@example.com',
  app_metadata: {},
  user_metadata: {},
};

const makeProfile = (overrides = {}) => ({
  id: 'user-123',
  nombre: 'Nico',
  email: 'nico@example.com',
  telefono: '',
  nacionalidad: 'Argentina',
  pais_codigo: 'AR',
  posicion: 'DEF',
  localidad: '',
  latitud: null,
  longitud: null,
  location_label: '',
  location_city: '',
  location_state: '',
  location_country: '',
  ranking: 5,
  acepta_invitaciones: true,
  ...overrides,
});

const renderProfileEditor = () => render(
  <MemoryRouter>
    <ProfileEditor isOpen onClose={mockOnClose} isEmbedded />
  </MemoryRouter>,
);

const clearGoogleMapsRuntime = () => {
  delete window.google;
  document
    .querySelectorAll('script[src*="maps.googleapis.com/maps/api/js"]')
    .forEach((script) => script.remove());
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

const restoreEnvValue = (key, value) => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};

describe('ProfileEditor geolocation flow', () => {
  let warnSpy;

  beforeEach(() => {
    mockGetCurrentPosition.mockReset();
    mockReverseGeocode.mockReset();
    mockGeocodeManualLocation.mockReset();
    mockUpdateProfile.mockReset();
    mockRefreshProfile.mockReset();
    mockUpdateLocalProfile.mockReset();
    mockOnClose.mockReset();

    mockRefreshProfile.mockResolvedValue();
    mockUpdateProfile.mockResolvedValue(makeProfile());
    mockAuthValue = {
      user: baseUser,
      profile: makeProfile(),
      refreshProfile: mockRefreshProfile,
      updateLocalProfile: mockUpdateLocalProfile,
      localEditMode: false,
    };
    process.env.REACT_APP_GOOGLE_MAPS_API_KEY = '';
    process.env.REACT_APP_GOOGLE_MAPS_API_KEY_MOBILE = '';
    process.env.REACT_APP_PROFILE_GEO_DEBUG = '';
    clearGoogleMapsRuntime();

    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  afterAll(() => {
    restoreEnvValue('REACT_APP_GOOGLE_MAPS_API_KEY', originalGoogleMapsApiKey);
    restoreEnvValue('REACT_APP_GOOGLE_MAPS_API_KEY_MOBILE', originalGoogleMapsMobileApiKey);
    restoreEnvValue('REACT_APP_PROFILE_GEO_DEBUG', originalProfileGeoDebug);
  });

  test('detecta ubicación automáticamente y completa localidad cuando no hay ciudad previa', async () => {
    mockGetCurrentPosition.mockResolvedValue({
      lat: -34.6037347,
      lng: -58.3815704,
      accuracy_m: 30,
      timestamp: '2026-05-05T12:00:00.000Z',
      source: 'capacitor',
    });
    mockReverseGeocode.mockResolvedValue({
      neighborhood: 'Palermo',
      city: 'Buenos Aires',
      state: 'CABA',
      country: 'Argentina',
    });

    renderProfileEditor();

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith('user-123', expect.objectContaining({
        localidad: 'Palermo, CABA',
        location_label: 'Palermo, CABA',
        location_city: 'Buenos Aires',
        location_state: 'CABA',
        location_country: 'Argentina',
        latitud: -34.6037347,
        longitud: -58.3815704,
      }));
    });
    expect(mockGetCurrentPosition).toHaveBeenCalledTimes(1);
    expect(mockReverseGeocode).toHaveBeenCalledWith(-34.6037347, -58.3815704);
  });

  test('GPS exitoso con Geocoder ausente carga Google Maps y aplica localidad detectada', async () => {
    process.env.REACT_APP_GOOGLE_MAPS_API_KEY = 'test-web-key';
    process.env.REACT_APP_PROFILE_GEO_DEBUG = 'true';
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    mockGetCurrentPosition.mockResolvedValue({
      lat: -34.6007,
      lng: -58.5136,
      accuracy_m: 22,
      timestamp: '2026-05-07T14:20:00.000Z',
      source: 'web',
      platform: 'web',
    });
    mockReverseGeocode.mockImplementation((...args) => (
      jest.requireActual('../services/locationService').reverseGeocode(...args)
    ));

    renderProfileEditor();

    await waitFor(() => {
      expect(document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]')).toBeTruthy();
    });
    const script = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    installMockGeocoder([
      { long_name: 'Villa Devoto', short_name: 'Villa Devoto', types: ['neighborhood'] },
      { long_name: 'Buenos Aires', short_name: 'Buenos Aires', types: ['locality'] },
      { long_name: 'Ciudad Autónoma de Buenos Aires', short_name: 'CABA', types: ['administrative_area_level_1'] },
      { long_name: 'Argentina', short_name: 'AR', types: ['country'] },
    ]);
    script.dispatchEvent(new Event('load'));

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith('user-123', expect.objectContaining({
        localidad: 'Villa Devoto, CABA',
        location_label: 'Villa Devoto, CABA',
        location_city: 'Buenos Aires',
        location_state: 'CABA',
        location_country: null,
        latitud: -34.6007,
        longitud: -58.5136,
      }));
    });
    expect(infoSpy).toHaveBeenCalledWith('[PROFILE_GEO]', 'google_maps_loader_start', expect.objectContaining({
      hasGeocoder: false,
    }));
    expect(infoSpy).toHaveBeenCalledWith('[PROFILE_GEO]', 'google_maps_loader_success', expect.objectContaining({
      hasGeocoder: true,
    }));

    infoSpy.mockRestore();
  });

  test('no ejecuta detección automática si el perfil ya tiene localidad', async () => {
    mockAuthValue = {
      ...mockAuthValue,
      profile: makeProfile({
        localidad: 'Villa Devoto',
        location_label: 'Villa Devoto',
      }),
    };

    renderProfileEditor();

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(mockGetCurrentPosition).not.toHaveBeenCalled();
  });

  test('si el permiso está denegado muestra mensaje y el pin permite reintentar', async () => {
    const deniedError = Object.assign(new Error('Permiso denegado'), {
      code: 'PERMISSION_DENIED',
    });
    mockGetCurrentPosition.mockRejectedValueOnce(deniedError).mockResolvedValueOnce({
      lat: -34.6037347,
      lng: -58.3815704,
      accuracy_m: 30,
      timestamp: '2026-05-05T12:00:00.000Z',
      source: 'web',
    });
    mockReverseGeocode.mockResolvedValue({
      city: 'Buenos Aires',
      state: 'CABA',
      country: 'Argentina',
    });

    renderProfileEditor();

    expect(await screen.findByText(/No pudimos acceder a tu ubicación/i)).toBeInTheDocument();
    expect(mockGetCurrentPosition).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle(/Habilitar ubicación/i));

    await waitFor(() => {
      expect(mockGetCurrentPosition).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith('user-123', expect.objectContaining({
        localidad: 'CABA',
        latitud: -34.6037347,
        longitud: -58.3815704,
      }));
    });
  });

  test('GPS manual pisa localidad previa San Isidro cuando reverse geocode detecta Devoto/CABA', async () => {
    mockAuthValue = {
      ...mockAuthValue,
      profile: makeProfile({
        localidad: 'San Isidro',
        location_label: 'San Isidro',
        latitud: -34.4708,
        longitud: -58.5286,
        location_updated_at: '2026-05-05T12:00:00.000Z',
      }),
    };
    mockGetCurrentPosition.mockResolvedValue({
      lat: -34.6007,
      lng: -58.5136,
      accuracy_m: 22,
      timestamp: '2026-05-07T14:20:00.000Z',
      source: 'web',
      platform: 'web',
    });
    mockReverseGeocode.mockResolvedValue({
      neighborhood: 'Villa Devoto',
      city: 'Buenos Aires',
      state: 'CABA',
      country: 'Argentina',
    });

    renderProfileEditor();

    fireEvent.click(screen.getAllByTitle(/Actualizar ubicación/i)[1]);

    await waitFor(() => {
      expect(mockGetCurrentPosition).toHaveBeenCalledWith(expect.objectContaining({
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      }));
    });
    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith('user-123', expect.objectContaining({
        localidad: 'Villa Devoto, CABA',
        location_label: 'Villa Devoto, CABA',
        location_city: 'Buenos Aires',
        location_state: 'CABA',
        latitud: -34.6007,
        longitud: -58.5136,
      }));
    });
    expect(screen.getByRole('button', { name: 'Villa Devoto, CABA' })).toBeInTheDocument();
  });

  test('si falla la detección conserva la localidad guardada visible', async () => {
    mockAuthValue = {
      ...mockAuthValue,
      profile: makeProfile({
        localidad: 'Villa Devoto',
        location_label: 'Villa Devoto',
      }),
    };
    const deniedError = Object.assign(new Error('Permiso denegado'), {
      code: 'PERMISSION_DENIED',
    });
    mockGetCurrentPosition.mockRejectedValue(deniedError);

    renderProfileEditor();

    fireEvent.click(screen.getAllByTitle(/Actualizar ubicación/i)[1]);

    expect(await screen.findByText(/Conservamos la anterior/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Villa Devoto' })).toBeInTheDocument();
  });

  test('si GPS funciona pero reverse geocode no devuelve localidad usable conserva San Isidro como fallback', async () => {
    mockAuthValue = {
      ...mockAuthValue,
      profile: makeProfile({
        localidad: 'San Isidro',
        location_label: 'San Isidro',
      }),
    };
    mockGetCurrentPosition.mockResolvedValue({
      lat: -34.6007,
      lng: -58.5136,
      accuracy_m: 40,
      timestamp: '2026-05-07T14:25:00.000Z',
      source: 'web',
    });
    mockReverseGeocode.mockResolvedValue({});

    renderProfileEditor();

    fireEvent.click(screen.getAllByTitle(/Actualizar ubicación/i)[1]);

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith('user-123', expect.objectContaining({
        localidad: 'San Isidro',
        location_label: 'San Isidro',
        latitud: -34.6007,
        longitud: -58.5136,
      }));
    });
    expect(screen.getByRole('button', { name: 'San Isidro' })).toBeInTheDocument();
  });

  test('si GPS funciona pero Google Maps no carga conserva localidad manual y loguea fallback', async () => {
    process.env.REACT_APP_PROFILE_GEO_DEBUG = 'true';
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    mockAuthValue = {
      ...mockAuthValue,
      profile: makeProfile({
        localidad: 'San Isidro',
        location_label: 'San Isidro',
      }),
    };
    mockGetCurrentPosition.mockResolvedValue({
      lat: -34.6007,
      lng: -58.5136,
      accuracy_m: 40,
      timestamp: '2026-05-07T14:25:00.000Z',
      source: 'web',
    });
    mockReverseGeocode.mockImplementation((...args) => (
      jest.requireActual('../services/locationService').reverseGeocode(...args)
    ));

    renderProfileEditor();

    fireEvent.click(screen.getAllByTitle(/Actualizar ubicación/i)[1]);

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith('user-123', expect.objectContaining({
        localidad: 'San Isidro',
        location_label: 'San Isidro',
        latitud: -34.6007,
        longitud: -58.5136,
      }));
    });
    expect(await screen.findByText(/Detectamos tu GPS, pero no pudimos resolver la localidad/i)).toBeInTheDocument();
    expect(infoSpy).toHaveBeenCalledWith('[PROFILE_GEO]', 'google_maps_loader_error', expect.objectContaining({
      code: 'GOOGLE_MAPS_API_KEY_MISSING',
    }));
    expect(infoSpy).toHaveBeenCalledWith('[PROFILE_GEO]', 'manual_fallback', expect.objectContaining({
      source: 'reverse_geocode',
      finalLocalityApplied: 'San Isidro',
      reasonCode: 'GOOGLE_MAPS_API_KEY_MISSING',
    }));

    infoSpy.mockRestore();
  });

  test('si el dispositivo tiene ubicación apagada y no hay localidad sugiere carga manual', async () => {
    const servicesDisabledError = Object.assign(new Error('Ubicación del dispositivo desactivada'), {
      code: 'LOCATION_SERVICES_DISABLED',
      rawCode: 'OS-PLUG-GLOC-0007',
    });
    mockGetCurrentPosition.mockRejectedValue(servicesDisabledError);

    renderProfileEditor();

    expect(await screen.findByText(/La ubicación del dispositivo está desactivada/i)).toBeInTheDocument();
    expect(await screen.findByText(/elegí tu localidad manualmente/i)).toBeInTheDocument();
  });

  test('si el origen web está denegado muestra mensaje de producto sin nombres técnicos', async () => {
    const browserDeniedError = Object.assign(new Error('Permiso denegado'), {
      code: 'PERMISSION_DENIED',
      platform: 'web',
      source: 'web.navigator',
      permissionBefore: 'granted',
      permissionState: 'denied',
      rawMessage: 'User denied Geolocation',
    });
    mockGetCurrentPosition.mockRejectedValue(browserDeniedError);

    renderProfileEditor();

    expect(await screen.findByText(/No pudimos acceder a tu ubicación/i)).toBeInTheDocument();
    expect(screen.queryByText(/Chrome\/localhost/i)).not.toBeInTheDocument();
  });

  test('ofrece fallback manual y guarda nombre visible con latitud y longitud', async () => {
    mockAuthValue = {
      ...mockAuthValue,
      profile: makeProfile({
        localidad: 'Villa Devoto',
        location_label: 'Villa Devoto',
      }),
    };

    renderProfileEditor();

    mockGeocodeManualLocation.mockResolvedValue({
      label: 'Villa Urquiza, CABA',
      lat: -34.5732,
      lng: -58.4869,
      city: 'Buenos Aires',
      state: 'CABA',
      country: 'Argentina',
    });
    fireEvent.change(screen.getByPlaceholderText('Localidad, provincia'), { target: { value: 'Villa Urquiza' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar ubicación' }));

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith('user-123', expect.objectContaining({
      localidad: 'Villa Urquiza, CABA',
      location_label: 'Villa Urquiza, CABA',
      latitud: -34.5732,
      longitud: -58.4869,
    })));
  });

  test('shouldAttemptProfileAutoLocation evita loops y permite retry manual', () => {
    expect(shouldAttemptProfileAutoLocation({ userId: 'user-123' })).toBe(true);
    expect(shouldAttemptProfileAutoLocation({
      alreadyAttempted: true,
      userId: 'user-123',
    })).toBe(false);
    expect(shouldAttemptProfileAutoLocation({
      hasLocationLabel: true,
      userId: 'user-123',
    })).toBe(false);
    expect(shouldAttemptProfileAutoLocation({
      force: true,
      hasLocationLabel: true,
      userId: 'user-123',
    })).toBe(true);
  });
});
