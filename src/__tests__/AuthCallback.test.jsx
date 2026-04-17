import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthCallback from '../components/AuthCallback';

const mockNavigate = jest.fn();
const mockExchangeCodeForSession = jest.fn();
const mockGetSession = jest.fn();
const mockSetSession = jest.fn();
const mockConsumeAuthReturnTo = jest.fn();
const mockReadPendingAuthFlow = jest.fn();
const mockMarkPendingAuthSessionRestored = jest.fn();
const mockClearPendingAuthFlow = jest.fn();
const mockSetAuthFlowResult = jest.fn();
const mockTrack = jest.fn();

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

jest.mock('../utils/authReturnTo', () => ({
  consumeAuthReturnTo: (...args) => mockConsumeAuthReturnTo(...args),
}));

jest.mock('../utils/authFlowState', () => ({
  clearPendingAuthFlow: (...args) => mockClearPendingAuthFlow(...args),
  markPendingAuthSessionRestored: (...args) => mockMarkPendingAuthSessionRestored(...args),
  readPendingAuthFlow: (...args) => mockReadPendingAuthFlow(...args),
  setAuthFlowResult: (...args) => mockSetAuthFlowResult(...args),
}));

jest.mock('../utils/monitoring/analytics', () => ({
  track: (...args) => mockTrack(...args),
}));

describe('AuthCallback', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockExchangeCodeForSession.mockReset();
    mockGetSession.mockReset();
    mockSetSession.mockReset();
    mockConsumeAuthReturnTo.mockReset();
    mockReadPendingAuthFlow.mockReset();
    mockMarkPendingAuthSessionRestored.mockReset();
    mockClearPendingAuthFlow.mockReset();
    mockSetAuthFlowResult.mockReset();
    mockTrack.mockReset();

    window.history.replaceState({}, '', '/auth/callback?code=test-code');

    mockReadPendingAuthFlow.mockReturnValue({ provider: 'google' });
    mockConsumeAuthReturnTo.mockReturnValue('/home');
    mockSetSession.mockResolvedValue({ error: null });
  });

  test('continues when session already exists after code exchange failure', async () => {
    const exchangeError = new Error('code verifier mismatch');
    mockExchangeCodeForSession.mockResolvedValue({ error: exchangeError });
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: { id: 'user-123' },
        },
      },
      error: null,
    });

    render(
      <MemoryRouter>
        <AuthCallback />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/home', { replace: true });
    });

    expect(mockMarkPendingAuthSessionRestored).toHaveBeenCalledWith({
      provider: 'google',
      userId: 'user-123',
    });
    expect(mockTrack).toHaveBeenCalledWith('login_success', {
      provider: 'google',
      user_id: 'user-123',
      method: 'oauth_callback',
    });
    expect(mockClearPendingAuthFlow).not.toHaveBeenCalled();
    expect(mockSetAuthFlowResult).not.toHaveBeenCalled();
    expect(screen.queryByText(/No pudimos completar el login/i)).not.toBeInTheDocument();
  });
});

