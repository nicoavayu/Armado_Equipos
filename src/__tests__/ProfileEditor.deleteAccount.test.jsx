import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProfileEditor from '../components/ProfileEditor';
import {
  APPLE_NO_REAUTH_NOTICE,
  APPLE_REAUTH_DECLINED,
  APPLE_REAUTH_NOTICE,
  APPLE_UNLINK_MANUAL,
} from '../legal/accountDeletion';

// Perfil → Eliminar cuenta with Sign in with Apple (PLAN-FOTOS-CORE-Y-APPLE.md §2): on the iPhone app an Apple account
// confirms with Apple first (fresh authorizationCode → delete-account revokes); closing the Apple sheet asks and lets the
// person delete anyway (Apple TN3194); when the tokens were not revoked the modal shows how to unlink by hand.

const mockInvoke = jest.fn();
const mockClearLocalAuthSession = jest.fn();
const mockRequestAppleCode = jest.fn();
const mockOnClose = jest.fn();
let mockIsIos = true;
let mockAuthValue;

jest.mock('../components/AuthProvider', () => ({ useAuth: () => mockAuthValue }));
jest.mock('../components/ProfileCard', () => function MockProfileCard() { return null; });
jest.mock('../components/ConfirmModal', () => function MockConfirmModal() { return null; });
jest.mock('../services/locationService', () => {
  const actual = jest.requireActual('../services/locationService');
  return {
    ...actual,
    getCurrentPosition: jest.fn(),
    getLocationPlatformInfo: () => ({ platform: 'web', isNative: false, hasCapacitorGeolocation: true, hasWebGeolocation: true, hasWebPermissionsApi: true }),
    reverseGeocode: jest.fn(),
  };
});
jest.mock('../utils/locationSettings', () => ({ openNativeLocationSettings: jest.fn() }));
jest.mock('../supabase', () => ({
  updateProfile: jest.fn(async (_id, patch) => patch),
  calculateProfileCompletion: jest.fn(() => 100),
  supabase: {
    auth: { updateUser: jest.fn() },
    functions: { invoke: (...args) => mockInvoke(...args) },
    storage: { from: jest.fn(() => ({ upload: jest.fn(), getPublicUrl: jest.fn(() => ({ data: { publicUrl: '' } })) })) },
  },
}));
jest.mock('../services/authLogoutService', () => ({
  clearLocalAuthSession: (...args) => mockClearLocalAuthSession(...args),
  getLogoutErrorMessage: jest.fn(() => 'No se pudo cerrar sesión.'),
  signOutWithPushDeactivation: jest.fn(),
}));
jest.mock('utils/notifyBlockingError', () => ({ notifyBlockingError: jest.fn() }));
jest.mock('../services/auth/appleDeletionReauth', () => ({
  isIosNativePlatform: () => mockIsIos,
  requestAppleAuthorizationCodeForDeletion: (...args) => mockRequestAppleCode(...args),
}));

const profile = {
  id: 'user-123', nombre: 'Nico', email: 'nico@example.com', telefono: '', nacionalidad: 'Argentina', pais_codigo: 'AR',
  posicion: 'DEF', localidad: 'Palermo, CABA', latitud: -34.6, longitud: -58.38, location_label: 'Palermo, CABA',
  location_city: '', location_state: '', location_country: '', location_updated_at: '2026-07-14T11:00:00.000Z', ranking: 5,
  acepta_invitaciones: true,
};
const appleUser = { id: 'user-123', email: 'x@privaterelay.appleid.com', app_metadata: { provider: 'apple', providers: ['apple'] },
  user_metadata: {}, identities: [{ provider: 'apple', provider_id: '000123.abc.0456' }] };
const googleUser = { id: 'user-123', email: 'nico@example.com', app_metadata: { provider: 'google', providers: ['google'] },
  user_metadata: {}, identities: [{ provider: 'google', provider_id: 'g-1' }] };

const setUser = (user) => {
  mockAuthValue = { user, profile, refreshProfile: jest.fn(), updateLocalProfile: jest.fn(), localEditMode: false };
};
const renderEditor = () => render(
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <ProfileEditor isOpen onClose={mockOnClose} isEmbedded />
  </MemoryRouter>,
);
const openModalAndConfirm = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar cuenta' }));
  fireEvent.change(screen.getByPlaceholderText('ELIMINAR'), { target: { value: 'ELIMINAR' } });
};
const submitDeletion = () => {
  const form = screen.getByPlaceholderText('ELIMINAR').closest('form');
  fireEvent.click(within(form).getByRole('button', { name: 'Eliminar cuenta' }));
};

beforeEach(() => {
  mockIsIos = true;
  mockInvoke.mockReset();
  mockClearLocalAuthSession.mockReset().mockResolvedValue({ success: true });
  mockRequestAppleCode.mockReset();
  mockOnClose.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

test('iPhone + Apple account: the modal says it will ask Apple; the Apple sheet runs BEFORE delete-account; revoked → straight out', async () => {
  setUser(appleUser);
  const order = [];
  mockRequestAppleCode.mockImplementation(async () => { order.push('apple'); return 'c-fresh'; });
  mockInvoke.mockImplementation(async () => { order.push('invoke'); return { data: { ok: true, torneos: 'erased', apple: 'revoked' }, error: null }; });
  renderEditor();
  openModalAndConfirm();
  expect(screen.getByText(APPLE_REAUTH_NOTICE)).toBeInTheDocument();
  submitDeletion();
  await waitFor(() => expect(mockClearLocalAuthSession).toHaveBeenCalledTimes(1));
  expect(order).toEqual(['apple', 'invoke']);
  expect(mockInvoke).toHaveBeenCalledWith('delete-account', { body: { confirm: true, apple_authorization_code: 'c-fresh' } });
  await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
  expect(screen.queryByText(APPLE_UNLINK_MANUAL)).not.toBeInTheDocument();
});

test('iPhone + Apple account, the person closes the Apple sheet: nothing deleted, the modal asks; «Eliminar igual» deletes and shows how to unlink; «Entendido» signs out', async () => {
  setUser(appleUser);
  mockRequestAppleCode.mockRejectedValue(Object.assign(new Error('No se confirmó con Apple.'), { name: 'AppleReauthCancelledError' }));
  mockInvoke.mockResolvedValue({ data: { ok: true, torneos: 'erased', apple: 'no_code' }, error: null });
  renderEditor();
  openModalAndConfirm();
  submitDeletion();
  expect(await screen.findByText(APPLE_REAUTH_DECLINED)).toBeInTheDocument();
  expect(mockInvoke).not.toHaveBeenCalled();

  // «Volver» goes back to the confirmation without deleting
  fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
  expect(screen.getByPlaceholderText('ELIMINAR')).toBeInTheDocument();
  submitDeletion();
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar igual' }));

  expect(await screen.findByText(APPLE_UNLINK_MANUAL)).toBeInTheDocument();
  expect(screen.getByText('Cuenta eliminada')).toBeInTheDocument();
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(mockInvoke).toHaveBeenCalledWith('delete-account', { body: { confirm: true } });
  expect(mockRequestAppleCode).toHaveBeenCalledTimes(2);
  expect(mockClearLocalAuthSession).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Entendido' }));
  await waitFor(() => expect(mockClearLocalAuthSession).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
});

test('iPhone, not an Apple account: no Apple sheet and no Apple text', async () => {
  setUser(googleUser);
  mockInvoke.mockResolvedValue({ data: { ok: true, torneos: 'erased', apple: 'not_apple' }, error: null });
  renderEditor();
  openModalAndConfirm();
  expect(screen.queryByText(APPLE_REAUTH_NOTICE)).not.toBeInTheDocument();
  submitDeletion();
  await waitFor(() => expect(mockClearLocalAuthSession).toHaveBeenCalledTimes(1));
  expect(mockRequestAppleCode).not.toHaveBeenCalled();
  expect(mockInvoke).toHaveBeenCalledWith('delete-account', { body: { confirm: true } });
});

test('Android / web with an Apple account: no sheet; says it cannot unlink from here; after deleting, the manual steps', async () => {
  mockIsIos = false;
  setUser(appleUser);
  mockInvoke.mockResolvedValue({ data: { ok: true, torneos: 'erased', apple: 'no_code' }, error: null });
  renderEditor();
  openModalAndConfirm();
  expect(screen.getByText(APPLE_NO_REAUTH_NOTICE)).toBeInTheDocument();
  submitDeletion();
  expect(await screen.findByText(APPLE_UNLINK_MANUAL)).toBeInTheDocument();
  expect(mockRequestAppleCode).not.toHaveBeenCalled();
  // closing the modal at this point finishes the deletion (signs out)
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar modal' }));
  await waitFor(() => expect(mockClearLocalAuthSession).toHaveBeenCalledTimes(1));
});

test('the photos step failing: the honest message, the session is kept', async () => {
  const { notifyBlockingError } = require('utils/notifyBlockingError');
  setUser(googleUser);
  mockInvoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ ok: false, message: 'storage_erasure_failed', retryable: true }) } } });
  renderEditor();
  openModalAndConfirm();
  submitDeletion();
  await waitFor(() => expect(notifyBlockingError).toHaveBeenCalledWith(expect.stringMatching(/no pudimos borrar tus fotos/)));
  expect(mockClearLocalAuthSession).not.toHaveBeenCalled();
});
