import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MemoryRouter,
  Routes,
  Route,
  useLocation,
} from 'react-router-dom';

import OnboardingProvider, { useOnboarding } from '../features/onboarding/OnboardingProvider';
import OnboardingHost from '../features/onboarding/OnboardingHost';
import useProfileTourTrigger from '../features/onboarding/useProfileTourTrigger';
import { createDefaultOnboardingState } from '../features/onboarding/storage';

jest.mock('../components/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../hooks/usePendingAuthFlow', () => ({ __esModule: true, default: jest.fn(() => null) }));
jest.mock('../features/onboarding/storage', () => {
  const actual = jest.requireActual('../features/onboarding/storage');
  return { ...actual, loadOnboardingState: jest.fn(), saveOnboardingState: jest.fn() };
});
jest.mock('@capacitor/app', () => ({
  App: { addListener: jest.fn(() => Promise.resolve({ remove: jest.fn() })) },
}));
jest.mock('../features/onboarding/haptics', () => ({ onboardingHaptic: jest.fn() }));
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
    useReducedMotion: () => true,
  };
});

const { useAuth } = require('../components/AuthProvider');
const { loadOnboardingState, saveOnboardingState } = require('../features/onboarding/storage');

const NEW_USER = { id: 'u-1', email: 'p@arma2.com', created_at: '2026-08-01T00:00:00.000Z' };
const OTHER_USER = { id: 'u-2', email: 'q@arma2.com', created_at: '2026-08-02T00:00:00.000Z' };
// Existing account (created before the onboarding launch cutoff): never
// auto-opens the general flow, so integrated tests can drive it deterministically.
const OLD_USER = { id: 'u-old', email: 'old@arma2.com', created_at: '2025-01-01T00:00:00.000Z' };

// ---- Standalone (manual-entry) harness: Perfil mounted directly at /profile ----
function ProfileProbe() {
  useProfileTourTrigger();
  const onboarding = useOnboarding();
  return (
    <div>
      <span data-testid="loaded">{String(onboarding.stateLoaded)}</span>
      <span data-testid="tour-open">{String(onboarding.profileTourOpen)}</span>
      <div data-profile-tour-target="telefono">
        <input aria-label="Teléfono" />
      </div>
    </div>
  );
}

function renderProfile(initialEntries = ['/profile']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <OnboardingProvider>
        <ProfileProbe />
        <OnboardingHost />
      </OnboardingProvider>
    </MemoryRouter>,
  );
}

// ---- Integrated harness: general flow + a /profile route that hosts the tour ----
function Harness() {
  const onboarding = useOnboarding();
  return (
    <div>
      <button type="button" onClick={() => onboarding.openOnboarding()}>harness-open</button>
      <span data-testid="loaded">{String(onboarding.stateLoaded)}</span>
      <span data-testid="active">{String(onboarding.isActive)}</span>
      <span data-testid="tour-open">{String(onboarding.profileTourOpen)}</span>
    </div>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="pathname">{location.pathname}</span>;
}

// No testids here (avoids collisions with Harness); only the trigger + target.
function ProfileRoute() {
  useProfileTourTrigger();
  return (
    <div data-profile-tour-target="telefono">
      <input aria-label="Teléfono" />
    </div>
  );
}

function renderIntegrated() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <OnboardingProvider>
        <Harness />
        <Routes>
          <Route path="/" element={<div>home</div>} />
          <Route path="/profile" element={<ProfileRoute />} />
          <Route path="/nuevo-partido" element={<div>nuevo</div>} />
          <Route path="/quiero-jugar" element={<div>jugar</div>} />
        </Routes>
        <OnboardingHost />
        <LocationProbe />
      </OnboardingProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  useAuth.mockReturnValue({ user: NEW_USER, profile: { nombre: 'P' }, authResolved: true });
  loadOnboardingState.mockResolvedValue({ state: createDefaultOnboardingState(), source: 'default' });
  saveOnboardingState.mockResolvedValue({ state: createDefaultOnboardingState(), remoteOk: true });
});

async function waitLoaded() {
  await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('true'));
}

function seenFlags() {
  return saveOnboardingState.mock.calls.map((call) => call[1]?.checklist || {});
}

// Drives the profile tour to its final slide (three slides).
async function advanceToFinalSlide() {
  await userEvent.click(await screen.findByRole('button', { name: 'Siguiente' }));
  await screen.findByRole('heading', { name: 'Contá cómo jugás' });
  await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  await screen.findByRole('heading', { name: 'Tu puntaje habla de responsabilidad' });
}

function onboardingRootCount() {
  return document.querySelectorAll('[data-onboarding-root="true"]').length;
}

describe('Perfil-tab tutorial (entrada manual)', () => {
  test('auto-opens on the first Perfil visit with three slides and the responsibility "5"', async () => {
    renderProfile();
    await waitLoaded();

    expect(await screen.findByRole('heading', { name: 'Completá tu perfil' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByRole('heading', { name: 'Contá cómo jugás' })).toBeInTheDocument();
    expect(screen.getByText(/elegí hasta dos posiciones/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByRole('heading', { name: 'Tu puntaje habla de responsabilidad' })).toBeInTheDocument();
    expect(screen.getByText('El puntaje no mide qué tan bien jugás al fútbol.')).toBeInTheDocument();
    expect(screen.getByText(/Todos comienzan con 5 puntos/)).toBeInTheDocument();
    expect(screen.getByText('Jugá, cumplí y cuidá a la comunidad.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /número cinco/ })).toBeInTheDocument();
  });

  test('the phone slide states who can contact the user and never claims it is public', async () => {
    renderProfile();
    await waitLoaded();
    await userEvent.click(await screen.findByRole('button', { name: 'Siguiente' }));

    expect(await screen.findByText(
      'Tu teléfono permite que los administradores puedan contactarte cuando sea necesario para organizar un partido.',
    )).toBeInTheDocument();
    const tour = document.querySelector('[data-onboarding-profile-tour="true"]');
    expect(tour.textContent).not.toMatch(/toda la comunidad|cualquier jugador|público|visible para todos/i);
  });

  test('never claims the score measures skill, ranking, quality or level of play', async () => {
    renderProfile();
    await waitLoaded();
    await advanceToFinalSlide();

    const tour = document.querySelector('[data-onboarding-profile-tour="true"]');
    expect(tour.textContent).not.toMatch(/ranking|calidad|habilidad|nivel de juego/i);
  });

  test('the final CTA closes the tutorial, keeps the user in Perfil and marks it seen', async () => {
    renderProfile();
    await waitLoaded();
    await advanceToFinalSlide();
    await userEvent.click(screen.getByRole('button', { name: 'Completar mi perfil' }));

    await waitFor(() => expect(screen.getByTestId('tour-open')).toHaveTextContent('false'));
    expect(seenFlags().some((c) => c.profileTourSeen === true)).toBe(true);
    // Manual entry never opens the general-flow selector.
    expect(screen.queryByText('¿Qué querés hacer primero?')).not.toBeInTheDocument();
  });

  test('the secondary action closes without editing, stays in Perfil and marks it seen', async () => {
    renderProfile();
    await waitLoaded();
    await advanceToFinalSlide();
    await userEvent.click(screen.getByRole('button', { name: 'Ahora no' }));

    await waitFor(() => expect(screen.getByTestId('tour-open')).toHaveTextContent('false'));
    expect(seenFlags().some((c) => c.profileTourSeen === true)).toBe(true);
    expect(screen.queryByText('¿Qué querés hacer primero?')).not.toBeInTheDocument();
  });

  test('does not auto-open when the tutorial was already seen', async () => {
    loadOnboardingState.mockResolvedValue({
      state: createDefaultOnboardingState({ checklist: { profileTourSeen: true } }),
      source: 'remote',
    });
    renderProfile();
    await waitLoaded();

    await waitFor(() => expect(screen.getByTestId('tour-open')).toHaveTextContent('false'));
    expect(screen.queryByRole('heading', { name: 'Completá tu perfil' })).not.toBeInTheDocument();
  });

  test('shows for a completed profile too, with a "Ver mi perfil" CTA', async () => {
    useAuth.mockReturnValue({
      user: NEW_USER,
      profile: { nombre: 'P', telefono: '+54 9 11 5555', posiciones: ['DEL', 'MED'], nivel: 3 },
      authResolved: true,
    });
    renderProfile();
    await waitLoaded();
    await advanceToFinalSlide();

    expect(screen.getByRole('button', { name: 'Ver mi perfil' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Completar mi perfil' })).not.toBeInTheDocument();
  });

  test('the profile-step seen flag is independent from the profile-tour seen flag', async () => {
    loadOnboardingState.mockResolvedValue({
      state: createDefaultOnboardingState({ checklist: { profileStepSeen: true } }),
      source: 'remote',
    });
    renderProfile();
    await waitLoaded();

    // The tour still auto-opens: the two flags do not hide each other.
    expect(await screen.findByRole('heading', { name: 'Completá tu perfil' })).toBeInTheDocument();
  });

  test('an unexpected unmount (no explicit close) never marks the tutorial as seen', async () => {
    const { unmount } = renderProfile();
    await waitLoaded();
    await screen.findByRole('heading', { name: 'Completá tu perfil' });

    unmount();
    expect(seenFlags().some((c) => c.profileTourSeen === true)).toBe(false);
  });

  test('switching account resets the transient tour state (no open/origin leak)', async () => {
    // The switched-to account already saw the tutorial, so after the reset it must
    // stay closed — proving the previous account's open/origin did not carry over.
    loadOnboardingState.mockImplementation((uid) => Promise.resolve({
      state: uid === OTHER_USER.id
        ? createDefaultOnboardingState({ checklist: { profileTourSeen: true } })
        : createDefaultOnboardingState(),
      source: 'remote',
    }));

    const { rerender } = renderProfile();
    await waitLoaded();
    await screen.findByRole('heading', { name: 'Completá tu perfil' });
    expect(screen.getByTestId('tour-open')).toHaveTextContent('true');

    useAuth.mockReturnValue({ user: OTHER_USER, profile: { nombre: 'Q' }, authResolved: true });
    rerender(
      <MemoryRouter initialEntries={['/profile']}>
        <OnboardingProvider>
          <ProfileProbe />
          <OnboardingHost />
        </OnboardingProvider>
      </MemoryRouter>,
    );
    // On account switch the provider clears open/origin before reloading state, and
    // the new (already-seen) account never re-opens the tutorial.
    await waitFor(() => expect(screen.getByTestId('tour-open')).toHaveTextContent('false'));
    expect(screen.queryByRole('heading', { name: 'Completá tu perfil' })).not.toBeInTheDocument();
  });
});

describe('continuidad: onboarding → Perfil → selector', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ user: OLD_USER, profile: { nombre: 'O' }, authResolved: true });
  });

  async function openProfileStepAndComplete() {
    await userEvent.click(screen.getByText('harness-open'));
    await userEvent.click(await screen.findByRole('button', { name: 'Empezar' }));
    await screen.findByRole('heading', { name: 'Completá tu perfil' });
    // The general-flow profile step's primary CTA.
    await userEvent.click(screen.getByRole('button', { name: 'Completar mi perfil' }));
    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/profile'));
  }

  test('completing the tour resumes the goal selector, without repeating the profile step or stacking overlays', async () => {
    renderIntegrated();
    await waitLoaded();
    await openProfileStepAndComplete();

    // The Perfil tour opened (Siguiente present) and only one overlay is visible.
    expect(await screen.findByRole('button', { name: 'Siguiente' })).toBeInTheDocument();
    expect(onboardingRootCount()).toBe(1);

    await advanceToFinalSlide();
    // Onboarding-origin final CTA reads "Continuar", not "Completar mi perfil".
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText('¿Qué querés hacer primero?')).toBeInTheDocument();
    expect(onboardingRootCount()).toBe(1);
    // The profile step is not shown again, and the tour is gone.
    expect(screen.queryByRole('button', { name: 'Siguiente' })).not.toBeInTheDocument();
    expect(document.querySelector('[data-onboarding-profile-tour="true"]')).not.toBeInTheDocument();
    expect(seenFlags().some((c) => c.profileTourSeen === true)).toBe(true);
  });

  test('closing the tour with the secondary CTA also resumes the selector', async () => {
    renderIntegrated();
    await waitLoaded();
    await openProfileStepAndComplete();
    await advanceToFinalSlide();
    await userEvent.click(screen.getByRole('button', { name: 'Ahora no' }));

    expect(await screen.findByText('¿Qué querés hacer primero?')).toBeInTheDocument();
    expect(onboardingRootCount()).toBe(1);
  });

  test('closing the tour with the X button resumes the selector', async () => {
    renderIntegrated();
    await waitLoaded();
    await openProfileStepAndComplete();
    await screen.findByRole('button', { name: 'Siguiente' });
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar tutorial' }));

    expect(await screen.findByText('¿Qué querés hacer primero?')).toBeInTheDocument();
  });

  test('closing the tour with Escape resumes the selector', async () => {
    renderIntegrated();
    await waitLoaded();
    await openProfileStepAndComplete();
    await screen.findByRole('button', { name: 'Siguiente' });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(await screen.findByText('¿Qué querés hacer primero?')).toBeInTheDocument();
  });
});
