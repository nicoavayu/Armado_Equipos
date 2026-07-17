import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { OnboardingContext } from '../features/onboarding/OnboardingContext';

jest.mock('../features/onboarding/haptics', () => ({ onboardingHaptic: jest.fn() }));
jest.mock('../features/onboarding/useOnboardingChecklist', () => ({ useOnboardingChecklist: jest.fn() }));
jest.mock('framer-motion', () => {
  const ReactLib = require('react');
  const strip = (p) => { const { initial, animate, exit, transition, variants, whileHover, whileTap, layout, ...rest } = p; return rest; };
  const passthrough = (tag) => ReactLib.forwardRef(({ children, ...props }, ref) => ReactLib.createElement(tag, { ...strip(props), ref }, children));
  return {
    motion: new Proxy({}, { get: (_t, k) => passthrough(k) }),
    AnimatePresence: ({ children }) => ReactLib.createElement(ReactLib.Fragment, null, children),
    useReducedMotion: () => false,
  };
});

const OnboardingChecklist = require('../features/onboarding/OnboardingChecklist').default;
const OnboardingDiscoveryCard = require('../features/onboarding/OnboardingDiscoveryCard').default;
const OnboardingReplayButton = require('../features/onboarding/OnboardingReplayButton').default;
const { useOnboardingChecklist } = require('../features/onboarding/useOnboardingChecklist');

const renderWithCtx = (ctx, ui) => render(
  <MemoryRouter>
    <OnboardingContext.Provider value={ctx}>{ui}</OnboardingContext.Provider>
  </MemoryRouter>,
);

const baseChecklist = (over = {}) => ({
  title: 'Primeros pasos',
  items: [
    { key: 'profile', label: 'Completá tu perfil', done: true, route: '/profile' },
    { key: 'create_match', label: 'Creá un partido', done: true, route: '/nuevo-partido' },
    { key: 'invite', label: 'Invitá jugadores', done: false, route: '/nuevo-partido' },
    { key: 'vote', label: 'Participá en una votación', done: false, route: '/' },
  ],
  completedCount: 2,
  total: 4,
  allDone: false,
  loading: false,
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('OnboardingChecklist card', () => {
  test('shows progress and items for the chosen path', () => {
    useOnboardingChecklist.mockReturnValue(baseChecklist());
    renderWithCtx(
      { enabled: true, stateLoaded: true, state: { chosenPath: 'organizer', checklist: {} }, dismissChecklist: jest.fn(), markChecklistCelebrated: jest.fn() },
      <OnboardingChecklist />,
    );
    expect(screen.getByText('Primeros pasos')).toBeInTheDocument();
    expect(screen.getByText('2/4 completado')).toBeInTheDocument();
    expect(screen.getByText('Invitá jugadores')).toBeInTheDocument();
  });

  test('renders nothing when no path was chosen', () => {
    useOnboardingChecklist.mockReturnValue(baseChecklist());
    const { container } = renderWithCtx(
      { enabled: true, stateLoaded: true, state: { chosenPath: null, checklist: {} }, dismissChecklist: jest.fn(), markChecklistCelebrated: jest.fn() },
      <OnboardingChecklist />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing when dismissed', () => {
    useOnboardingChecklist.mockReturnValue(baseChecklist());
    const { container } = renderWithCtx(
      { enabled: true, stateLoaded: true, state: { chosenPath: 'organizer', checklist: { dismissed: true } }, dismissChecklist: jest.fn(), markChecklistCelebrated: jest.fn() },
      <OnboardingChecklist />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('dismiss button hides the checklist', async () => {
    useOnboardingChecklist.mockReturnValue(baseChecklist());
    const dismissChecklist = jest.fn();
    renderWithCtx(
      { enabled: true, stateLoaded: true, state: { chosenPath: 'organizer', checklist: {} }, dismissChecklist, markChecklistCelebrated: jest.fn() },
      <OnboardingChecklist />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar checklist' }));
    expect(dismissChecklist).toHaveBeenCalledTimes(1);
  });

  test('completion celebrates and marks onboarding done', async () => {
    useOnboardingChecklist.mockReturnValue(baseChecklist({ items: baseChecklist().items.map((i) => ({ ...i, done: true })), completedCount: 4, allDone: true }));
    const markChecklistCelebrated = jest.fn();
    renderWithCtx(
      { enabled: true, stateLoaded: true, state: { chosenPath: 'organizer', checklist: {} }, dismissChecklist: jest.fn(), markChecklistCelebrated },
      <OnboardingChecklist />,
    );
    expect(await screen.findByText('¡Listo! Ya conocés Arma2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '¡Listo!' }));
    expect(markChecklistCelebrated).toHaveBeenCalledTimes(1);
  });

  test('does not re-show once celebrated', () => {
    useOnboardingChecklist.mockReturnValue(baseChecklist({ allDone: true }));
    const { container } = renderWithCtx(
      { enabled: true, stateLoaded: true, state: { chosenPath: 'organizer', checklist: { celebrated: true } }, dismissChecklist: jest.fn(), markChecklistCelebrated: jest.fn() },
      <OnboardingChecklist />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('OnboardingDiscoveryCard (existing users)', () => {
  const ctx = (over = {}) => ({
    canShowDiscoveryCard: true,
    isActive: false,
    openOnboarding: jest.fn(),
    dismissDiscoveryCard: jest.fn(),
    ...over,
  });

  test('offers the tour and can start it', async () => {
    const c = ctx();
    renderWithCtx(c, <OnboardingDiscoveryCard />);
    expect(screen.getByText('Conocé todo lo que podés hacer con Arma2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Ver ahora/i }));
    expect(c.openOnboarding).toHaveBeenCalled();
  });

  test('can be dismissed', async () => {
    const c = ctx();
    renderWithCtx(c, <OnboardingDiscoveryCard />);
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(c.dismissDiscoveryCard).toHaveBeenCalled();
  });

  test('renders nothing when not eligible', () => {
    const { container } = renderWithCtx(ctx({ canShowDiscoveryCard: false }), <OnboardingDiscoveryCard />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing outside the provider', () => {
    const { container } = render(<MemoryRouter><OnboardingDiscoveryCard /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('OnboardingReplayButton (Perfil → Ayuda)', () => {
  test('replays when enabled', async () => {
    const replayOnboarding = jest.fn();
    renderWithCtx({ enabled: true, replayOnboarding }, <OnboardingReplayButton />);
    await userEvent.click(screen.getByRole('button', { name: /Conocer Arma2/i }));
    await waitFor(() => expect(replayOnboarding).toHaveBeenCalled());
  });

  test('hidden when the feature is disabled for the user', () => {
    const { container } = renderWithCtx({ enabled: false, replayOnboarding: jest.fn() }, <OnboardingReplayButton />);
    expect(container).toBeEmptyDOMElement();
  });

  test('hidden with no provider', () => {
    const { container } = render(<MemoryRouter><OnboardingReplayButton /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
