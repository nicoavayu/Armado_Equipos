import React, { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';

const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn();
const mockGetProfile = jest.fn();
const mockCreateOrUpdateProfile = jest.fn();

jest.mock('../supabase', () => ({
  __esModule: true,
  supabase: {
    auth: {
      getSession: (...args) => mockGetSession(...args),
      onAuthStateChange: (...args) => mockOnAuthStateChange(...args),
      signInAnonymously: jest.fn(),
    },
    from: jest.fn(() => ({ update: () => ({ eq: async () => ({ error: null }) }) })),
  },
  getProfile: (...args) => mockGetProfile(...args),
  createOrUpdateProfile: (...args) => mockCreateOrUpdateProfile(...args),
}));

jest.mock('../services/auth/socialAuth', () => ({
  clearAuthFlowIfSessionSettled: jest.fn(),
}));

jest.mock('../utils/monitoring/sentry', () => ({
  clearSentryUser: jest.fn(),
  setSentryUser: jest.fn(),
}));

jest.mock('../components/AppLoadingScreen', () => ({
  __esModule: true,
  default: () => <div>loading</div>,
}));

// eslint-disable-next-line import/first
import AuthProvider, { useAuth } from '../components/AuthProvider';

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

// supabase-js re-reads the stored session on every hidden→visible transition and emits
// SIGNED_IN with a freshly parsed user object, so identity must not depend on the reference.
const userA = () => ({ id: 'user-a', email: 'a@arma2.lab', updated_at: '2026-10-01T00:00:00Z', user_metadata: { full_name: 'A' }, app_metadata: { provider: 'email' } });
const userB = () => ({ id: 'user-b', email: 'b@arma2.lab', updated_at: '2026-10-01T00:00:00Z', user_metadata: { full_name: 'B' }, app_metadata: { provider: 'email' } });
const sessionFor = (user) => ({ user, access_token: `token-${user.id}` });

let emit;
let userEffectRuns;

function Probe() {
  const { user, profile } = useAuth();
  useEffect(() => {
    if (user) userEffectRuns += 1;
  }, [user]);
  return (
    <div>
      <span data-testid="user">{user?.id || 'none'}</span>
      <span data-testid="profile">{profile?.nombre || 'none'}</span>
    </div>
  );
}

const renderProvider = () => render(<AuthProvider><Probe /></AuthProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  userEffectRuns = 0;
  mockOnAuthStateChange.mockImplementation((callback) => {
    emit = callback;
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });
});

test('a late profile response of the previous account never replaces the new account profile', async () => {
  const profileA = deferred();
  mockGetSession.mockResolvedValue({ data: { session: sessionFor(userA()) } });
  mockGetProfile.mockImplementation((id) => (id === 'user-a'
    ? profileA.promise
    : Promise.resolve({ id: 'user-b', nombre: 'Perfil de B' })));

  renderProvider();
  await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-a'));

  await act(async () => {
    emit('SIGNED_OUT', null);
    emit('SIGNED_IN', sessionFor(userB()));
  });
  await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('Perfil de B'));

  await act(async () => {
    profileA.resolve({ id: 'user-a', nombre: 'Perfil de A' });
    await profileA.promise;
  });

  expect(screen.getByTestId('user')).toHaveTextContent('user-b');
  expect(screen.getByTestId('profile')).toHaveTextContent('Perfil de B');
});

test('signing out while a profile request is in flight leaves no profile behind', async () => {
  const profileA = deferred();
  mockGetSession.mockResolvedValue({ data: { session: sessionFor(userA()) } });
  mockGetProfile.mockImplementation(() => profileA.promise);

  renderProvider();
  await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-a'));

  await act(async () => { emit('SIGNED_OUT', null); });
  await act(async () => {
    profileA.resolve({ id: 'user-a', nombre: 'Perfil de A' });
    await profileA.promise;
  });

  expect(screen.getByTestId('user')).toHaveTextContent('none');
  expect(screen.getByTestId('profile')).toHaveTextContent('none');
});

test('switching accounts hides the previous profile immediately, before the new one loads', async () => {
  const profileB = deferred();
  mockGetSession.mockResolvedValue({ data: { session: sessionFor(userA()) } });
  mockGetProfile.mockImplementation((id) => (id === 'user-a'
    ? Promise.resolve({ id: 'user-a', nombre: 'Perfil de A' })
    : profileB.promise));

  renderProvider();
  await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('Perfil de A'));

  await act(async () => { emit('SIGNED_IN', sessionFor(userB())); });
  expect(screen.getByTestId('user')).toHaveTextContent('user-b');
  expect(screen.getByTestId('profile')).toHaveTextContent('none');

  await act(async () => {
    profileB.resolve({ id: 'user-b', nombre: 'Perfil de B' });
    await profileB.promise;
  });
  expect(screen.getByTestId('profile')).toHaveTextContent('Perfil de B');
});

test('returning to the app with the same account keeps the user identity and does not refetch the profile', async () => {
  mockGetSession.mockResolvedValue({ data: { session: sessionFor(userA()) } });
  mockGetProfile.mockResolvedValue({ id: 'user-a', nombre: 'Perfil de A' });

  renderProvider();
  await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('Perfil de A'));
  expect(mockGetProfile).toHaveBeenCalledTimes(1);
  expect(userEffectRuns).toBe(1);

  await act(async () => {
    emit('SIGNED_IN', sessionFor(userA()));
    emit('TOKEN_REFRESHED', sessionFor(userA()));
    emit('SIGNED_IN', sessionFor(userA()));
  });

  expect(mockGetProfile).toHaveBeenCalledTimes(1);
  expect(userEffectRuns).toBe(1);
  expect(screen.getByTestId('profile')).toHaveTextContent('Perfil de A');
});

test('a real change of the same account (USER_UPDATED) still refreshes user and profile', async () => {
  mockGetSession.mockResolvedValue({ data: { session: sessionFor(userA()) } });
  mockGetProfile
    .mockResolvedValueOnce({ id: 'user-a', nombre: 'Perfil de A' })
    .mockResolvedValueOnce({ id: 'user-a', nombre: 'Perfil de A editado' });

  renderProvider();
  await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('Perfil de A'));

  const updated = { ...userA(), updated_at: '2026-10-07T00:00:00Z', user_metadata: { full_name: 'A editado' } };
  await act(async () => { emit('USER_UPDATED', sessionFor(updated)); });

  await waitFor(() => expect(screen.getByTestId('profile')).toHaveTextContent('Perfil de A editado'));
  expect(mockGetProfile).toHaveBeenCalledTimes(2);
  expect(userEffectRuns).toBe(2);
});
