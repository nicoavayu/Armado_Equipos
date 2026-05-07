import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProfileEditor, { shouldAttemptProfileAutoLocation } from '../components/ProfileEditor';

const mockGetCurrentPosition = jest.fn();
const mockReverseGeocode = jest.fn();
const mockUpdateProfile = jest.fn();
const mockRefreshProfile = jest.fn();
const mockUpdateLocalProfile = jest.fn();
const mockOnClose = jest.fn();

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

describe('ProfileEditor geolocation flow', () => {
  let warnSpy;

  beforeEach(() => {
    mockGetCurrentPosition.mockReset();
    mockReverseGeocode.mockReset();
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

    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
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

    expect(await screen.findByText(/Permiso de ubicación bloqueado/i)).toBeInTheDocument();
    expect(mockGetCurrentPosition).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle(/Habilitar ubicación/i));

    await waitFor(() => {
      expect(mockGetCurrentPosition).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith('user-123', expect.objectContaining({
        localidad: 'Buenos Aires',
        latitud: -34.6037347,
        longitud: -58.3815704,
      }));
    });
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

    expect(await screen.findByText(/Mantenemos tu localidad cargada/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Villa Devoto' })).toBeInTheDocument();
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

  test('si Chrome deniega el origen web aunque permissions haya dicho granted muestra mensaje específico', async () => {
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

    expect(await screen.findByText(/Chrome\/localhost sigue devolviendo permiso denegado/i)).toBeInTheDocument();
  });

  test('no muestra botones manuales extra', () => {
    mockAuthValue = {
      ...mockAuthValue,
      profile: makeProfile({
        localidad: 'Villa Devoto',
        location_label: 'Villa Devoto',
      }),
    };

    renderProfileEditor();

    expect(screen.queryByRole('button', { name: /Usar mi ubicación/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Elegir ciudad manualmente/i })).not.toBeInTheDocument();
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
