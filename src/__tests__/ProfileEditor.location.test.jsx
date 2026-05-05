import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProfileEditor, {
  buildManualLocationPatch,
  shouldAttemptProfileAutoLocation,
} from '../components/ProfileEditor';

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

const baseProfile = {
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
};

const renderProfileEditor = () => render(
  <MemoryRouter>
    <ProfileEditor isOpen onClose={mockOnClose} isEmbedded />
  </MemoryRouter>,
);

describe('ProfileEditor location fallback', () => {
  let warnSpy;

  beforeEach(() => {
    mockGetCurrentPosition.mockReset();
    mockReverseGeocode.mockReset();
    mockUpdateProfile.mockReset();
    mockRefreshProfile.mockReset();
    mockUpdateLocalProfile.mockReset();
    mockOnClose.mockReset();

    mockRefreshProfile.mockResolvedValue();
    mockUpdateProfile.mockResolvedValue({ ...baseProfile });
    mockAuthValue = {
      user: baseUser,
      profile: baseProfile,
      refreshProfile: mockRefreshProfile,
      updateLocalProfile: mockUpdateLocalProfile,
      localEditMode: false,
    };

    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('muestra fallback manual y evita repetir geolocation cuando el permiso fue denegado', async () => {
    const deniedError = Object.assign(new Error('Permiso denegado'), {
      code: 'PERMISSION_DENIED',
    });
    mockGetCurrentPosition.mockRejectedValue(deniedError);

    renderProfileEditor();

    await waitFor(() => {
      expect(mockGetCurrentPosition).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/No pudimos detectar tu ubicación/i)).toBeInTheDocument();
    expect(await screen.findByPlaceholderText('Tu ciudad')).toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(mockGetCurrentPosition).toHaveBeenCalledTimes(1);
  });

  test('permite guardar una ciudad manual sin latitud ni longitud', async () => {
    const deniedError = Object.assign(new Error('Permiso denegado'), {
      code: 'PERMISSION_DENIED',
    });
    mockGetCurrentPosition.mockRejectedValue(deniedError);

    renderProfileEditor();

    const cityInput = await screen.findByPlaceholderText('Tu ciudad');
    fireEvent.change(cityInput, { target: { value: 'Villa Devoto' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar Cambios/i }));

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith('user-123', expect.objectContaining({
        localidad: 'Villa Devoto',
        location_label: 'Villa Devoto',
        location_city: 'Villa Devoto',
        latitud: null,
        longitud: null,
      }));
    });
    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  test('buildManualLocationPatch limpia coordenadas al editar ciudad manualmente', () => {
    expect(buildManualLocationPatch('Rosario', { location_country: 'Argentina' })).toMatchObject({
      localidad: 'Rosario',
      location_label: 'Rosario',
      location_city: 'Rosario',
      location_country: 'Argentina',
      latitud: null,
      longitud: null,
      location_accuracy_m: null,
      location_updated_at: null,
    });
  });

  test('shouldAttemptProfileAutoLocation bloquea reintentos automáticos y permite retry manual', () => {
    expect(shouldAttemptProfileAutoLocation({ userId: 'user-123' })).toBe(true);
    expect(shouldAttemptProfileAutoLocation({
      alreadyAttempted: true,
      userId: 'user-123',
    })).toBe(false);
    expect(shouldAttemptProfileAutoLocation({
      permissionDenied: true,
      userId: 'user-123',
    })).toBe(false);
    expect(shouldAttemptProfileAutoLocation({
      force: true,
      permissionDenied: true,
      userId: 'user-123',
    })).toBe(true);
  });
});
