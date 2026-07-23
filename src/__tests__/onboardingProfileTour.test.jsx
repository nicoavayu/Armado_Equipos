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
  useNavigate,
  useNavigationType,
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

// ---- Consume-once of the navigation-state marker (onboardingProfileTour) -------
// Arriving from the onboarding profile step carries `state.onboardingProfileTour`
// on a single /profile history entry. The trigger must capture the origin and
// then consume the marker EXACTLY ONCE (via replace), so a browser back/forward
// or an in-place account switch on that same entry cannot reopen the tour as an
// onboarding continuation for the wrong user.
function LocationStateProbe() {
  const location = useLocation();
  const navigationType = useNavigationType();
  return (
    <div>
      <span data-testid="loc-pathname">{location.pathname}</span>
      <span data-testid="loc-search">{location.search}</span>
      <span data-testid="loc-hash">{location.hash}</span>
      <span data-testid="loc-state">{JSON.stringify(location.state)}</span>
      <span data-testid="nav-type">{navigationType}</span>
    </div>
  );
}

function NavControls() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate(-1)}>go-back</button>
      <button type="button" onClick={() => navigate(1)}>go-forward</button>
    </>
  );
}

// Perfil surface hosting the trigger; also exposes loaded/tour-open like the other
// harnesses so waitLoaded() works.
function ConsumeProfileProbe() {
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

function consumeTree() {
  return (
    <OnboardingProvider>
      <Routes>
        <Route path="/home" element={<div>home-route</div>} />
        <Route path="/profile" element={<ConsumeProfileProbe />} />
      </Routes>
      <LocationStateProbe />
      <NavControls />
      <OnboardingHost />
    </OnboardingProvider>
  );
}

// A prior /home entry sits under the /profile entry so we can prove `replace`
// (going back must land on /home, never a duplicate /profile).
function renderConsume(entry) {
  return render(
    <MemoryRouter initialEntries={['/home', entry]} initialIndex={1}>
      {consumeTree()}
    </MemoryRouter>,
  );
}

describe('consume-once del navigation state (onboardingProfileTour)', () => {
  test('captures the onboarding origin, then strips ONLY the marker via replace, keeping search, hash and sibling state', async () => {
    renderConsume({
      pathname: '/profile',
      search: '?ref=abc',
      hash: '#seccion',
      state: { onboardingProfileTour: true, returnTo: '/home' },
    });
    await waitLoaded();

    // The origin was captured as 'onboarding': the final CTA reads "Continuar".
    await advanceToFinalSlide();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument();

    // Only the marker was removed; the rest of the entry survived intact.
    await waitFor(() => expect(screen.getByTestId('loc-state')).toHaveTextContent('{"returnTo":"/home"}'));
    expect(screen.getByTestId('loc-state')).not.toHaveTextContent('onboardingProfileTour');
    expect(screen.getByTestId('loc-pathname')).toHaveTextContent('/profile');
    expect(screen.getByTestId('loc-search')).toHaveTextContent('?ref=abc');
    expect(screen.getByTestId('loc-hash')).toHaveTextContent('#seccion');
    // It replaced the current entry (no extra history push) and never stacked overlays.
    expect(screen.getByTestId('nav-type')).toHaveTextContent('REPLACE');
    expect(onboardingRootCount()).toBe(1);
  });

  test('when the marker is the only state, the entry state resets to null (not left dangling)', async () => {
    renderConsume({ pathname: '/profile', state: { onboardingProfileTour: true } });
    await waitLoaded();
    await screen.findByRole('heading', { name: 'Completá tu perfil' });

    await waitFor(() => expect(screen.getByTestId('loc-state').textContent).toBe('null'));
    expect(screen.getByTestId('nav-type')).toHaveTextContent('REPLACE');
  });

  test('consumes the marker exactly once: back returns to the previous entry and forward carries no marker', async () => {
    renderConsume({ pathname: '/profile', state: { onboardingProfileTour: true } });
    await waitLoaded();
    await screen.findByRole('heading', { name: 'Completá tu perfil' });
    await waitFor(() => expect(screen.getByTestId('loc-state').textContent).toBe('null'));

    // Because we replaced (not pushed), going back lands on /home directly — there
    // is no duplicate /profile entry still holding the marker.
    await userEvent.click(screen.getByText('go-back'));
    await waitFor(() => expect(screen.getByTestId('loc-pathname')).toHaveTextContent('/home'));
    expect(screen.getByText('home-route')).toBeInTheDocument();

    // Forward returns to the same (already-consumed) /profile entry: still no marker.
    await userEvent.click(screen.getByText('go-forward'));
    await waitFor(() => expect(screen.getByTestId('loc-pathname')).toHaveTextContent('/profile'));
    expect(screen.getByTestId('loc-state').textContent).toBe('null');
  });

  test('an in-place account switch on the same /profile entry does NOT inherit the onboarding origin', async () => {
    useAuth.mockReturnValue({ user: NEW_USER, profile: { nombre: 'P' }, authResolved: true });

    const { rerender } = render(
      <MemoryRouter
        initialEntries={['/home', { pathname: '/profile', state: { onboardingProfileTour: true } }]}
        initialIndex={1}
      >
        {consumeTree()}
      </MemoryRouter>,
    );
    await waitLoaded();

    // Account A: onboarding-origin tour ("Continuar"); marker already consumed.
    await advanceToFinalSlide();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('loc-state').textContent).toBe('null'));

    // Switch to account B (fresh, tutorial not seen) on the SAME history entry.
    // MemoryRouter keeps its evolved history across rerenders, so B lands on the
    // already-cleared /profile entry.
    useAuth.mockReturnValue({ user: OTHER_USER, profile: { nombre: 'Q' }, authResolved: true });
    rerender(
      <MemoryRouter
        initialEntries={['/home', { pathname: '/profile', state: { onboardingProfileTour: true } }]}
        initialIndex={1}
      >
        {consumeTree()}
      </MemoryRouter>,
    );
    await waitLoaded();

    // B's tour opens as a MANUAL entry. Closing it (X) must keep B in Perfil and
    // never resume the general onboarding — proving B did not inherit 'onboarding'.
    await screen.findByRole('button', { name: 'Siguiente' });
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar tutorial' }));
    await waitFor(() => expect(screen.getByTestId('tour-open')).toHaveTextContent('false'));
    expect(screen.queryByText('¿Qué querés hacer primero?')).not.toBeInTheDocument();
  });
});
