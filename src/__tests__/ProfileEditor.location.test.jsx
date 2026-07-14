import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProfileEditor, { shouldAttemptProfileAutoLocation } from '../components/ProfileEditor';

const mockGetCurrentPosition = jest.fn();
const mockReverseGeocode = jest.fn();
const mockUpdateProfile = jest.fn();
const mockRefreshProfile = jest.fn();
const mockUpdateLocalProfile = jest.fn();
const mockOpenLocationSettings = jest.fn();
const mockOnClose = jest.fn();
let mockPlatformInfo;
let mockAuthValue;

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => mockAuthValue,
}));

jest.mock('../components/ProfileCard', () => {
  const React = require('react');
  return function MockProfileCard({ profile }) {
    return React.createElement('div', {
      'data-testid': 'profile-card',
      'data-latitude': String(profile?.latitud ?? ''),
      'data-longitude': String(profile?.longitud ?? ''),
    });
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
    getLocationPlatformInfo: () => mockPlatformInfo,
    reverseGeocode: (...args) => mockReverseGeocode(...args),
  };
});

jest.mock('../utils/locationSettings', () => ({
  openNativeLocationSettings: (...args) => mockOpenLocationSettings(...args),
}));

jest.mock('../supabase', () => ({
  updateProfile: (...args) => mockUpdateProfile(...args),
  calculateProfileCompletion: jest.fn(() => 100),
  supabase: {
    auth: { updateUser: jest.fn() },
    functions: { invoke: jest.fn() },
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
  location_updated_at: null,
  ranking: 5,
  acepta_invitaciones: true,
  ...overrides,
});

const setProfile = (profile) => {
  mockAuthValue = {
    user: baseUser,
    profile,
    refreshProfile: mockRefreshProfile,
    updateLocalProfile: mockUpdateLocalProfile,
    localEditMode: false,
  };
};

const renderProfileEditor = () => render(
  <MemoryRouter>
    <ProfileEditor isOpen onClose={mockOnClose} isEmbedded />
  </MemoryRouter>,
);

const gpsPosition = (overrides = {}) => ({
  lat: -34.6037347,
  lng: -58.3815704,
  accuracy_m: 30,
  timestamp: '2026-07-14T12:00:00.000Z',
  source: 'web',
  platform: 'web',
  ...overrides,
});

const reverseLocation = (overrides = {}) => ({
  neighborhood: 'Palermo',
  city: 'Buenos Aires',
  state: 'CABA',
  country: 'Argentina',
  ...overrides,
});

describe('ProfileEditor automatic geolocation flow', () => {
  let warnSpy;

  beforeEach(() => {
    mockGetCurrentPosition.mockReset();
    mockReverseGeocode.mockReset();
    mockUpdateProfile.mockReset();
    mockRefreshProfile.mockReset();
    mockUpdateLocalProfile.mockReset();
    mockOpenLocationSettings.mockReset();
    mockOnClose.mockReset();
    mockPlatformInfo = {
      platform: 'web',
      isNative: false,
      hasCapacitorGeolocation: true,
      hasWebGeolocation: true,
      hasWebPermissionsApi: true,
    };
    mockRefreshProfile.mockResolvedValue();
    mockUpdateProfile.mockImplementation(async (_userId, patch) => patch);
    mockReverseGeocode.mockResolvedValue(reverseLocation());
    setProfile(makeProfile({
      localidad: 'Palermo, CABA',
      location_label: 'Palermo, CABA',
      latitud: -34.6037347,
      longitud: -58.3815704,
      location_updated_at: '2026-07-14T11:00:00.000Z',
    }));
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('muestra la zona detectada en el control de Localidad sin edición ni opciones manuales', () => {
    setProfile(makeProfile({
      localidad: 'Villa Devoto, CABA',
      location_label: 'Villa Devoto, CABA',
      latitud: -34.6007,
      longitud: -58.5136,
      location_updated_at: '2026-07-14T11:00:00.000Z',
    }));

    renderProfileEditor();

    expect(screen.getByText(/^Localidad$/i)).toBeInTheDocument();
    expect(screen.getByText('Villa Devoto, CABA')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Localidad, provincia/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Elegir manualmente|Elegir manual|Agregar ubicación/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ubicación lista|Actualizar ubicación$/i)).not.toBeInTheDocument();

    const localityControl = screen.getByRole('textbox', { name: 'Localidad detectada automáticamente' });
    expect(localityControl.tagName).toBe('DIV');
    expect(localityControl).toHaveAttribute('aria-readonly', 'true');
    expect(localityControl).not.toHaveAttribute('contenteditable');
    fireEvent.click(localityControl);
    expect(mockGetCurrentPosition).not.toHaveBeenCalled();
  });

  test('permiso concedido guarda automáticamente latitud y longitud', async () => {
    setProfile(makeProfile());
    mockGetCurrentPosition.mockResolvedValue(gpsPosition());

    renderProfileEditor();

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith('user-123', expect.objectContaining({
        localidad: 'Palermo, CABA',
        location_label: 'Palermo, CABA',
        latitud: -34.6037347,
        longitud: -58.3815704,
      }));
    });
    expect(mockGetCurrentPosition).toHaveBeenCalledTimes(1);
    expect(mockReverseGeocode).toHaveBeenCalledWith(-34.6037347, -58.3815704);
    expect(await screen.findByText('Palermo, CABA')).toBeInTheDocument();
  });

  test('un perfil histórico con localidad escrita pero sin coordenadas solicita GPS', async () => {
    setProfile(makeProfile({
      localidad: 'Villa Devoto',
      location_label: 'Villa Devoto',
    }));
    mockGetCurrentPosition.mockResolvedValue(gpsPosition());

    renderProfileEditor();

    await waitFor(() => expect(mockGetCurrentPosition).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith(
      'user-123',
      expect.objectContaining({ latitud: -34.6037347, longitud: -58.3815704 }),
    ));
  });

  test('permiso rechazado muestra un mensaje entendible y permite reintentar', async () => {
    setProfile(makeProfile());
    mockGetCurrentPosition.mockRejectedValue(Object.assign(new Error('User denied Geolocation'), {
      code: 'PERMISSION_DENIED',
      rawCode: 'OS-PLUG-GLOC-0003',
      source: 'capacitor.getCurrentPosition',
    }));

    renderProfileEditor();

    expect((await screen.findAllByText('Necesitamos acceso a tu ubicación. Permitilo para continuar.')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Volver a intentar' })).toBeInTheDocument();
    expect(screen.queryByText(/User denied|OS-PLUG|TypeError|Failed to fetch|Capacitor/i)).not.toBeInTheDocument();
  });

  test('permiso bloqueado en mobile ofrece Abrir ajustes', async () => {
    setProfile(makeProfile());
    mockPlatformInfo = { ...mockPlatformInfo, platform: 'ios', isNative: true };
    mockGetCurrentPosition.mockRejectedValue(Object.assign(new Error('blocked'), {
      code: 'PERMISSION_DENIED',
      permissionState: 'denied',
    }));
    mockOpenLocationSettings.mockResolvedValue(true);

    renderProfileEditor();

    const settingsButton = await screen.findByRole('button', { name: 'Abrir ajustes' });
    fireEvent.click(settingsButton);
    expect(mockOpenLocationSettings).toHaveBeenCalledTimes(1);
  });

  test('Actualizar ubicación siempre usa GPS de alta precisión', async () => {
    mockGetCurrentPosition.mockResolvedValue(gpsPosition({
      lat: -34.6007,
      lng: -58.5136,
      source: 'capacitor',
      platform: 'ios',
    }));
    mockReverseGeocode.mockResolvedValue(reverseLocation({ neighborhood: 'Villa Devoto' }));

    renderProfileEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar ubicación' }));

    await waitFor(() => expect(mockGetCurrentPosition).toHaveBeenCalledWith({
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000,
    }));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith(
      'user-123',
      expect.objectContaining({ latitud: -34.6007, longitud: -58.5136 }),
    ));
  });

  test('un fallo temporal conserva las coordenadas válidas anteriores', async () => {
    mockGetCurrentPosition.mockRejectedValue(Object.assign(new Error('temporary native error'), {
      code: 'POSITION_UNAVAILABLE',
    }));

    renderProfileEditor();
    const card = screen.getByTestId('profile-card');
    expect(card).toHaveAttribute('data-latitude', '-34.6037347');
    expect(card).toHaveAttribute('data-longitude', '-58.3815704');

    fireEvent.click(screen.getByRole('button', { name: 'Actualizar ubicación' }));

    expect((await screen.findAllByText('No pudimos actualizar tu ubicación. Conservamos la anterior.')).length).toBeGreaterThan(0);
    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(card).toHaveAttribute('data-latitude', '-34.6037347');
    expect(card).toHaveAttribute('data-longitude', '-58.3815704');
  });

  test('si falla el reverse geocoding igualmente guarda coordenadas GPS sin fallback manual', async () => {
    setProfile(makeProfile());
    mockGetCurrentPosition.mockResolvedValue(gpsPosition());
    mockReverseGeocode.mockRejectedValue(new Error('Failed to fetch'));

    renderProfileEditor();

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith(
      'user-123',
      expect.objectContaining({
        latitud: -34.6037347,
        longitud: -58.3815704,
        localidad: '',
        location_label: '',
      }),
    ));
    expect(await screen.findByText('Detectar mi ubicación')).toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch|Elegir manual/i)).not.toBeInTheDocument();
  });

  test('la geolocalización asíncrona no bloquea el render inicial', () => {
    setProfile(makeProfile());
    mockGetCurrentPosition.mockReturnValue(new Promise(() => {}));

    renderProfileEditor();

    expect(screen.getByTestId('profile-card')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('Detectando…')).toBeInTheDocument();
  });

  test('no vuelve a pedir ubicación automáticamente con coordenadas válidas', async () => {
    renderProfileEditor();

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(mockGetCurrentPosition).not.toHaveBeenCalled();
  });

  test('shouldAttemptProfileAutoLocation evita loops, exige coordenadas y permite retry', () => {
    expect(shouldAttemptProfileAutoLocation({ userId: 'user-123' })).toBe(true);
    expect(shouldAttemptProfileAutoLocation({
      alreadyAttempted: true,
      userId: 'user-123',
    })).toBe(false);
    expect(shouldAttemptProfileAutoLocation({
      hasValidLocation: true,
      userId: 'user-123',
    })).toBe(false);
    expect(shouldAttemptProfileAutoLocation({
      force: true,
      hasValidLocation: true,
      userId: 'user-123',
    })).toBe(true);
  });
});
