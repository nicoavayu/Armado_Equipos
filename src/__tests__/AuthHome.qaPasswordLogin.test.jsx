import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import AuthHome from '../components/AuthHome';
import logger from '../utils/logger';

const mockSignInWithPassword = jest.fn();
const mockSignInWithOtp = jest.fn();
const mockSetAuthReturnTo = jest.fn();

jest.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: jest.fn(() => false),
  },
}));

jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: (...args) => mockSignInWithOtp(...args),
      signInWithPassword: (...args) => mockSignInWithPassword(...args),
    },
  },
}));

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

jest.mock('../components/AppleAuth', () => function MockAppleAuth() {
  return <button type="button">Apple</button>;
});

jest.mock('../components/GoogleAuth', () => function MockGoogleAuth() {
  return <button type="button">Google</button>;
});

jest.mock('../hooks/usePendingAuthFlow', () => () => null);

jest.mock('../utils/authReturnTo', () => ({
  setAuthReturnTo: (...args) => mockSetAuthReturnTo(...args),
}));

jest.mock('../utils/authRedirectUrl', () => ({
  getAuthRedirectUrl: () => 'https://preview.example/auth/callback',
}));

jest.mock('../utils/authFlowState', () => ({
  consumeAuthFlowResult: () => null,
  subscribeAuthFlowState: () => () => {},
}));

const originalEnvironment = process.env;

const renderLogin = () => render(
  <MemoryRouter initialEntries={['/login']}>
    <AuthHome />
  </MemoryRouter>,
);

const enableQaPasswordLogin = () => {
  process.env = {
    ...originalEnvironment,
    REACT_APP_DEPLOY_ENV: 'staging',
    REACT_APP_TORNEOS_DATA_ENV: 'staging',
    REACT_APP_QA_PASSWORD_LOGIN_ENABLED: 'true',
  };
};

describe('AuthHome QA password login', () => {
  beforeEach(() => {
    process.env = { ...originalEnvironment };
    delete process.env.REACT_APP_DEPLOY_ENV;
    delete process.env.REACT_APP_TORNEOS_DATA_ENV;
    delete process.env.REACT_APP_QA_PASSWORD_LOGIN_ENABLED;
    Capacitor.isNativePlatform.mockReturnValue(false);
    mockSignInWithPassword.mockReset();
    mockSignInWithOtp.mockReset();
    mockSetAuthReturnTo.mockReset();
  });

  afterAll(() => {
    process.env = originalEnvironment;
  });

  test('shows the QA password form for staging with the explicit flag', () => {
    enableQaPasswordLogin();
    renderLogin();

    expect(screen.getByRole('heading', { name: 'Acceso de prueba' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ingresar' })).toBeInTheDocument();
  });

  test.each([
    ['disabled flag', {
      REACT_APP_DEPLOY_ENV: 'staging',
      REACT_APP_TORNEOS_DATA_ENV: 'staging',
      REACT_APP_QA_PASSWORD_LOGIN_ENABLED: 'false',
    }],
    ['production', {
      REACT_APP_DEPLOY_ENV: 'production',
      REACT_APP_TORNEOS_DATA_ENV: 'staging',
      REACT_APP_QA_PASSWORD_LOGIN_ENABLED: 'true',
    }],
    ['incomplete environment', {
      REACT_APP_DEPLOY_ENV: 'staging',
      REACT_APP_QA_PASSWORD_LOGIN_ENABLED: 'true',
    }],
  ])('hides the QA password form for %s', (_label, environment) => {
    process.env = { ...originalEnvironment, ...environment };
    renderLogin();

    expect(screen.queryByRole('heading', { name: 'Acceso de prueba' })).not.toBeInTheDocument();
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  test('submits valid credentials once and clears the password field', async () => {
    enableQaPasswordLogin();
    mockSignInWithPassword.mockResolvedValue({ error: null });
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'synthetic@staging.example.com' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'temporary-test-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));

    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledTimes(1);
    });
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'synthetic@staging.example.com',
      password: 'temporary-test-password',
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Contraseña')).toHaveValue('');
    });
    expect(screen.getByText('Acceso verificado. Ingresando…')).toBeInTheDocument();
  });

  test('sanitizes invalid credential errors', async () => {
    enableQaPasswordLogin();
    mockSignInWithPassword.mockResolvedValue({
      error: new Error('internal Supabase auth detail'),
    });
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'synthetic@staging.example.com' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'incorrect-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(await screen.findByText('No pudimos ingresar con esas credenciales.')).toBeInTheDocument();
    expect(screen.queryByText(/internal Supabase auth detail/i)).not.toBeInTheDocument();
  });

  test('blocks a double submit while the first request is pending', async () => {
    enableQaPasswordLogin();
    let resolveLogin;
    mockSignInWithPassword.mockReturnValue(new Promise((resolve) => {
      resolveLogin = resolve;
    }));
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'synthetic@staging.example.com' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'temporary-test-password' },
    });
    const submitButton = screen.getByRole('button', { name: 'Ingresar' });
    fireEvent.click(submitButton);
    fireEvent.submit(submitButton.closest('form'));

    expect(mockSignInWithPassword).toHaveBeenCalledTimes(1);
    resolveLogin({ error: null });
    await screen.findByText('Acceso verificado. Ingresando…');
  });

  test('never writes the password to application logs', async () => {
    enableQaPasswordLogin();
    mockSignInWithPassword.mockResolvedValue({ error: null });
    const loggerSpies = [
      jest.spyOn(logger, 'debug'),
      jest.spyOn(logger, 'info'),
      jest.spyOn(logger, 'warn'),
      jest.spyOn(logger, 'error'),
    ];
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'synthetic@staging.example.com' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'password-that-must-not-be-logged' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
    await screen.findByText('Acceso verificado. Ingresando…');

    const loggedValues = JSON.stringify(loggerSpies.flatMap((spy) => spy.mock.calls));
    expect(loggedValues).not.toContain('password-that-must-not-be-logged');
    loggerSpies.forEach((spy) => spy.mockRestore());
  });

  test('keeps the existing magic-link flow working', async () => {
    enableQaPasswordLogin();
    mockSignInWithOtp.mockResolvedValue({ error: null });
    renderLogin();

    fireEvent.click(screen.getByRole('button', { name: 'Continuar con email' }));
    fireEvent.change(screen.getByPlaceholderText('tu@email.com'), {
      target: { value: 'magic-link@staging.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }));

    await waitFor(() => {
      expect(mockSignInWithOtp).toHaveBeenCalledTimes(1);
    });
    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: 'magic-link@staging.example.com',
      options: {
        emailRedirectTo: 'https://preview.example/auth/callback',
      },
    });
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });
});
