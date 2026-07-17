import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

import OnboardingProvider, { useOnboarding } from '../features/onboarding/OnboardingProvider';
import OnboardingHost from '../features/onboarding/OnboardingHost';
import { createDefaultOnboardingState } from '../features/onboarding/storage';
import { ONBOARDING_STATUS } from '../features/onboarding/content';

// --- Mocks ---------------------------------------------------------------
jest.mock('../components/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../hooks/usePendingAuthFlow', () => ({ __esModule: true, default: jest.fn(() => null) }));
jest.mock('../features/onboarding/storage', () => {
  const actual = jest.requireActual('../features/onboarding/storage');
  return { ...actual, loadOnboardingState: jest.fn(), saveOnboardingState: jest.fn() };
});
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
  const motion = new Proxy({}, { get: (_t, key) => passthrough(key) });
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
  const ob = useOnboarding();
  return (
    <div>
      <button type="button" onClick={() => ob.openOnboarding()}>harness-open</button>
      <button type="button" onClick={() => ob.closeOnboarding()}>harness-close</button>
      <span data-testid="loaded">{String(ob.stateLoaded)}</span>
      <span data-testid="active">{String(ob.isActive)}</span>
      <span data-testid="status">{ob.state.status}</span>
      <span data-testid="path">{ob.state.chosenPath || 'none'}</span>
      <span data-testid="v">{ob.state.completedVersion}</span>
    </div>
  );
}

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="pathname">{loc.pathname}</span>;
}

function renderApp({ initialEntries = ['/'] } = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <OnboardingProvider>
        <Harness />
        <OnboardingHost />
        <LocationProbe />
      </OnboardingProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  usePendingAuthFlow.mockReturnValue(null);
  useAuth.mockReturnValue({ user: OLD_USER, profile: { nombre: 'X' }, authResolved: true });
  loadOnboardingState.mockResolvedValue({ state: createDefaultOnboardingState(), source: 'default' });
  saveOnboardingState.mockResolvedValue({ state: createDefaultOnboardingState(), remoteOk: true });
});

async function waitLoaded() {
  await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('true'));
}

describe('flow navigation (manual open, existing user — no auto timers)', () => {
  test('welcome → goal selector → organizer path → complete navigates to real route', async () => {
    renderApp();
    await waitLoaded();

    await userEvent.click(screen.getByText('harness-open'));
    expect(await screen.findByText('Tu partido empieza acá.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Empezar' }));
    expect(await screen.findByText('¿Qué querés hacer primero?')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Organizar un partido'));
    expect(await screen.findByText('Creá el partido')).toBeInTheDocument();

    // Advance through all 5 organizer steps to the closing card.
    for (let i = 0; i < 5; i += 1) {
      await userEvent.click(screen.getByRole('button', { name: /Siguiente/i }));
    }
    expect(await screen.findByText('Ya sabés todo lo necesario.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Crear mi primer partido' }));

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('false'));
    expect(screen.getByTestId('pathname')).toHaveTextContent('/nuevo-partido');

    const completedCall = saveOnboardingState.mock.calls
      .map((c) => c[1])
      .find((s) => s.status === ONBOARDING_STATUS.COMPLETED);
    expect(completedCall).toBeTruthy();
    expect(completedCall.completedVersion).toBe(1);
  });

  test('goal → back returns to welcome; path step → Anterior returns to goal', async () => {
    renderApp();
    await waitLoaded();

    await userEvent.click(screen.getByText('harness-open'));
    await userEvent.click(await screen.findByRole('button', { name: 'Empezar' }));
    await userEvent.click(await screen.findByRole('button', { name: /Volver/i }));
    expect(await screen.findByText('Tu partido empieza acá.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Empezar' }));
    await userEvent.click(await screen.findByText('Encontrar un partido'));
    expect(await screen.findByText('Decinos cuándo podés jugar')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Anterior/i }));
    expect(await screen.findByText('¿Qué querés hacer primero?')).toBeInTheDocument();
  });

  test('"Ahora no" on welcome skips (persists skipped + version), closes overlay', async () => {
    renderApp();
    await waitLoaded();

    await userEvent.click(screen.getByText('harness-open'));
    await screen.findByText('Tu partido empieza acá.');
    // The welcome's secondary "Ahora no" (dismiss) action.
    await userEvent.click(document.querySelector('[data-onboarding-action="dismiss"]'));

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('false'));
    const skipCall = saveOnboardingState.mock.calls.map((c) => c[1]).find((s) => s.status === ONBOARDING_STATUS.SKIPPED);
    expect(skipCall).toBeTruthy();
    expect(skipCall.completedVersion).toBe(1);
  });

  test('overview path CTA navigates to Home', async () => {
    renderApp({ initialEntries: ['/profile'] });
    await waitLoaded();

    await userEvent.click(screen.getByText('harness-open'));
    await userEvent.click(await screen.findByRole('button', { name: 'Empezar' }));
    await userEvent.click(await screen.findByText('Conocer Arma2'));
    // overview has a single summary step, then closing.
    await userEvent.click(await screen.findByRole('button', { name: /Siguiente/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ir a Arma2' }));
    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/'));
  });

  test('soft close keeps in-progress so it can resume', async () => {
    renderApp();
    await waitLoaded();

    await userEvent.click(screen.getByText('harness-open'));
    await userEvent.click(await screen.findByRole('button', { name: 'Empezar' }));
    await userEvent.click(await screen.findByText('Organizar un partido'));
    await userEvent.click(screen.getByText('harness-close'));

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('false'));
    expect(screen.getByTestId('status')).toHaveTextContent(ONBOARDING_STATUS.IN_PROGRESS);
    expect(screen.getByTestId('path')).toHaveTextContent('organizer');
  });
});

describe('auto-open gating (new user, fake timers)', () => {
  test('new user on idle Home auto-opens after the settle delay', async () => {
    jest.useFakeTimers();
    useAuth.mockReturnValue({ user: NEW_USER, profile: { nombre: 'N' }, authResolved: true });
    try {
      renderApp();
      await act(async () => { await Promise.resolve(); }); // flush load
      await act(async () => { jest.advanceTimersByTime(800); });
      expect(screen.getByText('Tu partido empieza acá.')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('does NOT auto-open when a deep link / pending intent is active', async () => {
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

  test('does NOT auto-open on a non-Home (public) surface', async () => {
    jest.useFakeTimers();
    useAuth.mockReturnValue({ user: NEW_USER, profile: { nombre: 'N' }, authResolved: true });
    try {
      renderApp({ initialEntries: ['/votar-equipos?codigo=abc'] });
      await act(async () => { await Promise.resolve(); });
      await act(async () => { jest.advanceTimersByTime(1500); });
      expect(screen.queryByText('Tu partido empieza acá.')).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('existing user never auto-opens', async () => {
    jest.useFakeTimers();
    useAuth.mockReturnValue({ user: OLD_USER, profile: { nombre: 'O' }, authResolved: true });
    try {
      renderApp();
      await act(async () => { await Promise.resolve(); });
      await act(async () => { jest.advanceTimersByTime(1500); });
      expect(screen.queryByText('Tu partido empieza acá.')).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});
