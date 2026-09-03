import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthCallback from '../components/AuthCallback';
import { clearAuthReturnTo, setAuthReturnTo } from '../utils/authReturnTo';

const RETURN_TO_KEY = 'auth:returnTo';
const DEEP_ROUTE = '/torneos/organizaciones/liga-demo/temporadas/2026/fixture';
const PRODUCT_HOME = '/home';

const mockNavigate = jest.fn();
const mockExchangeCodeForSession = jest.fn();
const mockGetSession = jest.fn();
const mockSetSession = jest.fn();

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      exchangeCodeForSession: (...args) => mockExchangeCodeForSession(...args),
      getSession: (...args) => mockGetSession(...args),
      setSession: (...args) => mockSetSession(...args),
    },
  },
}));

jest.mock('../utils/authFlowState', () => ({
  clearPendingAuthFlow: jest.fn(),
  markPendingAuthSessionRestored: jest.fn(),
  readPendingAuthFlow: () => ({ provider: 'google' }),
  setAuthFlowResult: jest.fn(),
}));

jest.mock('../utils/monitoring/analytics', () => ({
  track: jest.fn(),
}));

// The fallback must be an assertion, not an environment side effect.
jest.mock('../utils/runtimePlatform', () => ({
  getAuthenticatedProductHome: () => '/home',
}));

const renderCallback = (ui) => render(
  <MemoryRouter>
    {ui}
  </MemoryRouter>,
);

// `authReturnTo` is deliberately NOT mocked here: the regression lives in the
// interaction between the real read-and-clear store and a callback that
// resolves twice.
describe('AuthCallback returnTo idempotence', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockExchangeCodeForSession.mockReset();
    mockGetSession.mockReset();
    mockSetSession.mockReset();
    window.localStorage.clear();
    clearAuthReturnTo();
    window.history.replaceState({}, '', '/auth/callback?code=test-code');

    mockExchangeCodeForSession.mockResolvedValue({ error: null });
    mockSetSession.mockResolvedValue({ error: null });
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-123' } } },
      error: null,
    });
  });

  test('navigates once to the deep route when the callback runs once', async () => {
    setAuthReturnTo(DEEP_ROUTE);

    renderCallback(<AuthCallback />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(DEEP_ROUTE, { replace: true });
    });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(RETURN_TO_KEY)).toBeNull();
  });

  test('keeps the deep route when StrictMode runs the callback twice', async () => {
    setAuthReturnTo(DEEP_ROUTE);

    renderCallback(
      <React.StrictMode>
        <AuthCallback />
      </React.StrictMode>,
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });
    mockNavigate.mock.calls.forEach(([target, options]) => {
      expect(target).toBe(DEEP_ROUTE);
      expect(options).toEqual({ replace: true });
    });
    expect(mockNavigate).not.toHaveBeenCalledWith(PRODUCT_HOME, { replace: true });
  });

  test('keeps the deep route when the callback remounts after navigating', async () => {
    setAuthReturnTo(DEEP_ROUTE);

    const first = renderCallback(<AuthCallback />);
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(DEEP_ROUTE, { replace: true });
    });
    first.unmount();

    mockNavigate.mockReset();
    renderCallback(<AuthCallback />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(DEEP_ROUTE, { replace: true });
    });
    expect(mockNavigate).not.toHaveBeenCalledWith(PRODUCT_HOME, { replace: true });
  });

  test('falls back to the product home when no returnTo was stored', async () => {
    renderCallback(
      <React.StrictMode>
        <AuthCallback />
      </React.StrictMode>,
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(PRODUCT_HOME, { replace: true });
    });
  });

  test('falls back to the product home for a hostile stored returnTo', async () => {
    window.localStorage.setItem(RETURN_TO_KEY, 'https://evil.example/pwn');

    renderCallback(
      <React.StrictMode>
        <AuthCallback />
      </React.StrictMode>,
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(PRODUCT_HOME, { replace: true });
    });
    mockNavigate.mock.calls.forEach(([target]) => {
      expect(target).toBe(PRODUCT_HOME);
    });
  });

  test('a second login attempt does not replay the previous deep route', async () => {
    setAuthReturnTo(DEEP_ROUTE);

    const first = renderCallback(<AuthCallback />);
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(DEEP_ROUTE, { replace: true });
    });
    first.unmount();

    mockNavigate.mockReset();
    window.history.replaceState({}, '', '/auth/callback?code=second-code');
    renderCallback(<AuthCallback />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(PRODUCT_HOME, { replace: true });
    });
    expect(mockNavigate).not.toHaveBeenCalledWith(DEEP_ROUTE, { replace: true });
  });
});
