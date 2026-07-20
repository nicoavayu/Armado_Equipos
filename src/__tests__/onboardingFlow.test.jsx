import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

import HomeWelcomeCard from '../components/HomeWelcomeCard';
import OnboardingProvider, { useOnboarding } from '../features/onboarding/OnboardingProvider';
import OnboardingHost from '../features/onboarding/OnboardingHost';
import { createDefaultOnboardingState } from '../features/onboarding/storage';
import { ONBOARDING_STATUS } from '../features/onboarding/content';

const mockBackButtonListeners = [];

jest.mock('../components/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../hooks/usePendingAuthFlow', () => ({ __esModule: true, default: jest.fn(() => null) }));
jest.mock('../features/onboarding/storage', () => {
  const actual = jest.requireActual('../features/onboarding/storage');
  return { ...actual, loadOnboardingState: jest.fn(), saveOnboardingState: jest.fn() };
});
jest.mock('@capacitor/app', () => ({
  App: {
    addListener: jest.fn((_event, callback) => {
      mockBackButtonListeners.push(callback);
      return Promise.resolve({ remove: jest.fn() });
    }),
  },
}));
jest.mock('../Logo.png', () => 'logo-mock');
jest.mock('framer-motion', () => {
  const ReactLib = require('react');
  const strip = (props) => {
    const {
      initial, animate, exit, transition, variants, whileHover, whileTap,
      whileInView, layout, layoutId, drag, ...rest
    } = props;
    return rest;
  };
  const passthrough = (tag) => ReactLib.forwardRef(({ children, ...props }, ref) => (
    ReactLib.createElement(tag, { ...strip(props), ref }, children)
  ));
  const motionCache = {};
  const motion = new Proxy({}, { get: (_target, key) => (motionCache[key] ||= passthrough(key)) });
  return {
    motion,
    AnimatePresence: ({ children }) => ReactLib.createElement(ReactLib.Fragment, null, children),
    useReducedMotion: () => false,
  };
});

const { useAuth } = require('../components/AuthProvider');
const usePendingAuthFlow = require('../hooks/usePendingAuthFlow').default;
const { loadOnboardingState, saveOnboardingState } = require('../features/onboarding/storage');

const NEW_USER = { id: 'u-new', email: 'new@arma2.com', created_at: '2026-08-01T00:00:00.000Z' };
const OLD_USER = { id: 'u-old', email: 'old@arma2.com', created_at: '2025-01-01T00:00:00.000Z' };

function Harness() {
  const onboarding = useOnboarding();
  return (
    <div>
      <button type="button" onClick={() => onboarding.openOnboarding()}>harness-open</button>
      <button type="button" onClick={() => onboarding.closeOnboarding()}>harness-close</button>
      <span data-testid="loaded">{String(onboarding.stateLoaded)}</span>
      <span data-testid="active">{String(onboarding.isActive)}</span>
      <span data-testid="status">{onboarding.state.status}</span>
      <span data-testid="path">{onboarding.state.chosenPath || 'none'}</span>
      <span data-testid="v">{onboarding.state.completedVersion}</span>
    </div>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="pathname">{location.pathname}</span>;
}

function renderApp({ initialEntries = ['/'], withHomeWelcome = false } = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <OnboardingProvider>
        <Harness />
        {withHomeWelcome && <HomeWelcomeCard />}
        <OnboardingHost />
        <LocationProbe />
      </OnboardingProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBackButtonListeners.length = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  usePendingAuthFlow.mockReturnValue(null);
  useAuth.mockReturnValue({ user: OLD_USER, profile: { nombre: 'X' }, authResolved: true });
  loadOnboardingState.mockResolvedValue({ state: createDefaultOnboardingState(), source: 'default' });
  saveOnboardingState.mockResolvedValue({ state: createDefaultOnboardingState(), remoteOk: true });
});

async function waitLoaded() {
  await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('true'));
}

describe('modal → selector → recorridos', () => {
  test('intro modal advances directly to selector and organizer keeps its real CTA', async () => {
    renderApp();
    await waitLoaded();

    await userEvent.click(screen.getByText('harness-open'));
    expect(await screen.findByRole('heading', { name: 'Tu partido empieza acá.' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Empezar' }));
    expect(await screen.findByText('¿Qué querés hacer primero?')).toBeInTheDocument();
    expect(screen.queryByText('Tu partido empieza acá.')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Organizar un partido'));
    expect(await screen.findByText('Creá el partido')).toBeInTheDocument();

    for (let index = 0; index < 5; index += 1) {
      await userEvent.click(screen.getByRole('button', { name: /Siguiente/i }));
    }
    expect(await screen.findByText('Ya sabés todo lo necesario.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Crear mi primer partido' }));

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('false'));
    expect(screen.getByTestId('pathname')).toHaveTextContent('/nuevo-partido');
    const completedCall = saveOnboardingState.mock.calls
      .map((call) => call[1])
      .find((saved) => saved.status === ONBOARDING_STATUS.COMPLETED);
    expect(completedCall).toMatchObject({ completedVersion: 1, chosenPath: 'organizer' });
  });

  test('Anterior from the first path step returns to the selector', async () => {
    renderApp();
    await waitLoaded();
    await userEvent.click(screen.getByText('harness-open'));
    await userEvent.click(await screen.findByRole('button', { name: 'Empezar' }));
    await userEvent.click(await screen.findByText('Partido Automático'));
    expect(await screen.findByText('Decinos cuándo podés jugar')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Anterior/i }));
    expect(await screen.findByText('¿Qué querés hacer primero?')).toBeInTheDocument();
  });

  test('Ahora no keeps the version pending and suppresses the rest of the session', async () => {
    jest.useFakeTimers();
    try {
      renderApp();
      await act(async () => { await Promise.resolve(); });
      fireEvent.click(screen.getByText('harness-open'));
      fireEvent.click(await screen.findByRole('button', { name: 'Ahora no' }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByTestId('active')).toHaveTextContent('false');
      const skipCall = saveOnboardingState.mock.calls
        .map((call) => call[1])
        .find((saved) => saved.status === ONBOARDING_STATUS.SKIPPED);
      expect(skipCall).toMatchObject({ completedVersion: 0 });
      await act(async () => { jest.advanceTimersByTime(2500); });
      expect(screen.queryByText('Tu partido empieza acá.')).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('Explorar para jugar has two useful steps and navigates to Jugar', async () => {
    renderApp({ initialEntries: ['/profile'] });
    await waitLoaded();
    await userEvent.click(screen.getByText('harness-open'));
    await userEvent.click(await screen.findByRole('button', { name: 'Empezar' }));

    expect(screen.queryByText('Conocer Arma2')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByText('Explorar para jugar'));
    expect(await screen.findByText('Encontrá dónde jugar')).toBeInTheDocument();
    expect(screen.queryByText('1/1')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Siguiente/i }));
    expect(await screen.findByText('Descubrí jugadores')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Siguiente/i }));
    expect(await screen.findByText('Tu próximo partido puede estar acá.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ir a Jugar' }));
    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/quiero-jugar'));
  });

  test('Desafíos is a single educational screen that only completes and navigates', async () => {
    renderApp();
    await waitLoaded();
    await userEvent.click(screen.getByText('harness-open'));
    await userEvent.click(await screen.findByRole('button', { name: 'Empezar' }));
    await userEvent.click(await screen.findByText('Desafíos'));

    expect(await screen.findByRole('heading', { name: 'Armá tu equipo. Encontrá rival.' })).toBeInTheDocument();
    expect(screen.getByText(/encontrar o publicar propuestas/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Cartelera de desafíos/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Siguiente' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ir a Desafíos' }));

    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/desafios'));
    const completedCall = saveOnboardingState.mock.calls
      .map((call) => call[1])
      .find((saved) => saved.status === ONBOARDING_STATUS.COMPLETED);
    expect(completedCall).toMatchObject({ completedVersion: 1, chosenPath: null });
  });

  test('Estadísticas is a single informational screen with no checklist path or product mutations', async () => {
    renderApp();
    await waitLoaded();
    await userEvent.click(screen.getByText('harness-open'));
    await userEvent.click(await screen.findByRole('button', { name: 'Empezar' }));
    await userEvent.click(await screen.findByText('Estadísticas'));

    expect(await screen.findByRole('heading', { name: 'Tu año en números' })).toBeInTheDocument();
    expect(screen.getByText(/partidos jugados, ganados, empatados y las lesiones/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Resumen anual/i })).toBeInTheDocument();
    expect(screen.queryByText(/marcador|resultado exacto|porcentaje/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ver mis estadísticas' }));

    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/stats'));
    expect(saveOnboardingState.mock.calls.map((call) => call[1].chosenPath)).not.toContain('stats');
  });

  test('a reached final screen shows Cerrar, never Omitir or premature Completado', async () => {
    renderApp();
    await waitLoaded();
    await userEvent.click(screen.getByText('harness-open'));
    await userEvent.click(await screen.findByRole('button', { name: 'Empezar' }));
    await userEvent.click(await screen.findByText('Organizar un partido'));
    for (let index = 0; index < 5; index += 1) {
      await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    }

    expect(await screen.findByText('Ya sabés todo lo necesario.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Cerrar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Omitir tutorial' })).not.toBeInTheDocument();
    expect(screen.queryByText('Completado')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Dos equipos formados/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('false'));
    expect(screen.getByTestId('pathname')).toHaveTextContent('/');
  });

  test('soft close keeps an in-progress path resumable', async () => {
    renderApp();
    await waitLoaded();
    await userEvent.click(screen.getByText('harness-open'));
    await userEvent.click(await screen.findByRole('button', { name: 'Empezar' }));
    await userEvent.click(await screen.findByText('Organizar un partido'));
    await userEvent.click(screen.getByText('harness-close'));
    expect(screen.getByTestId('status')).toHaveTextContent(ONBOARDING_STATUS.IN_PROGRESS);
    expect(screen.getByTestId('path')).toHaveTextContent('organizer');
  });
});

describe('prioridades y controles del modal', () => {
  test('waits for the existing Home welcome modal and never stacks both', async () => {
    jest.useFakeTimers();
    useAuth.mockReturnValue({ user: NEW_USER, profile: { nombre: 'N' }, authResolved: true });
    try {
      renderApp({ withHomeWelcome: true });
      await act(async () => { await Promise.resolve(); });
      await act(async () => { jest.advanceTimersByTime(900); });
      expect(screen.getByText('Tu punto de partida')).toBeInTheDocument();
      expect(screen.queryByText('Tu partido empieza acá.')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Aceptar' }));
      await act(async () => { await Promise.resolve(); });
      await act(async () => { jest.advanceTimersByTime(900); });
      expect(screen.queryByText('Tu punto de partida')).not.toBeInTheDocument();
      expect(screen.getByText('Tu partido empieza acá.')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('new user auto-opens only on idle Home', async () => {
    jest.useFakeTimers();
    useAuth.mockReturnValue({ user: NEW_USER, profile: { nombre: 'N' }, authResolved: true });
    try {
      renderApp();
      await act(async () => { await Promise.resolve(); });
      await act(async () => { jest.advanceTimersByTime(800); });
      expect(screen.getByText('Tu partido empieza acá.')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('pending auth/deep-link intent wins over onboarding', async () => {
    jest.useFakeTimers();
    useAuth.mockReturnValue({ user: NEW_USER, profile: { nombre: 'N' }, authResolved: true });
    usePendingAuthFlow.mockReturnValue({ provider: 'google', status: 'started' });
    try {
      renderApp();
      await act(async () => { await Promise.resolve(); });
      await act(async () => { jest.advanceTimersByTime(1500); });
      expect(screen.queryByText('Tu partido empieza acá.')).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('existing user never auto-opens but can launch it manually', async () => {
    jest.useFakeTimers();
    try {
      renderApp();
      await act(async () => { await Promise.resolve(); });
      await act(async () => { jest.advanceTimersByTime(1200); });
      expect(screen.queryByText('Tu partido empieza acá.')).not.toBeInTheDocument();
      fireEvent.click(screen.getByText('harness-open'));
      expect(screen.getByText('Tu partido empieza acá.')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('Escape and Android back both close the active surface', async () => {
    renderApp();
    await waitLoaded();
    await userEvent.click(screen.getByText('harness-open'));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByTestId('active')).toHaveTextContent('false');

    await userEvent.click(screen.getByText('harness-open'));
    const { App: CapacitorApp } = require('@capacitor/app');
    await waitFor(() => expect(CapacitorApp.addListener).toHaveBeenCalled());
    const backListener = CapacitorApp.addListener.mock.calls[CapacitorApp.addListener.mock.calls.length - 1][1];
    act(() => backListener());
    expect(screen.getByTestId('active')).toHaveTextContent('false');
  });
});

describe('el tutorial no deja rastro de "Primeros pasos"', () => {
  test('a completed tour never surfaces a first-steps modal on idle Home', async () => {
    jest.useFakeTimers();
    loadOnboardingState.mockResolvedValueOnce({
      state: createDefaultOnboardingState({
        status: ONBOARDING_STATUS.COMPLETED,
        completedVersion: 1,
        chosenPath: 'organizer',
      }),
      source: 'remote',
    });
    try {
      renderApp();
      await act(async () => { await Promise.resolve(); });
      await act(async () => { jest.advanceTimersByTime(2500); });
      expect(screen.queryByText('Primeros pasos')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cerrar primeros pasos' })).not.toBeInTheDocument();
      expect(screen.queryByText('¡Listo! Ya conocés Arma2')).not.toBeInTheDocument();
      expect(document.querySelector('[data-onboarding-card]')).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});
