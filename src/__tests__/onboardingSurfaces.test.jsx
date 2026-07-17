import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { OnboardingContext } from '../features/onboarding/OnboardingContext';

let mockReducedMotion = false;

jest.mock('../features/onboarding/haptics', () => ({ onboardingHaptic: jest.fn() }));
jest.mock('@capacitor/app', () => ({ App: { addListener: jest.fn(() => Promise.resolve({ remove: jest.fn() })) } }));
jest.mock('framer-motion', () => {
  const ReactLib = require('react');
  const strip = (props) => {
    const {
      initial, animate, exit, transition, variants, whileHover, whileTap,
      layout, layoutId, drag, ...rest
    } = props;
    return rest;
  };
  const passthrough = (tag) => ReactLib.forwardRef(({ children, ...props }, ref) => (
    ReactLib.createElement(tag, { ...strip(props), ref }, children)
  ));
  return {
    motion: new Proxy({}, { get: (_target, key) => passthrough(key) }),
    AnimatePresence: ({ children }) => ReactLib.createElement(ReactLib.Fragment, null, children),
    useReducedMotion: () => mockReducedMotion,
  };
});

const OnboardingIntroModal = require('../features/onboarding/OnboardingIntroModal').default;
const OnboardingFirstStepsModal = require('../features/onboarding/OnboardingFirstStepsModal').default;
const OnboardingCompletedModal = require('../features/onboarding/OnboardingCompletedModal').default;
const OnboardingGoalSelector = require('../features/onboarding/OnboardingGoalSelector').default;
const OnboardingStepArt = require('../features/onboarding/OnboardingStepArt').default;
const OnboardingReplayButton = require('../features/onboarding/OnboardingReplayButton').default;

const checklist = (overrides = {}) => ({
  title: 'Primeros pasos',
  items: [
    { key: 'profile', label: 'Completá tu perfil', done: true, route: '/profile' },
    { key: 'create', label: 'Creá un partido', done: true, route: '/nuevo-partido' },
    { key: 'invite', label: 'Invitá jugadores', done: false, route: '/nuevo-partido' },
    { key: 'vote', label: 'Participá en una votación', done: false, route: '/' },
  ],
  completedCount: 2,
  total: 4,
  allDone: false,
  loading: false,
  ...overrides,
});

const renderWithContext = (context, ui) => render(
  <MemoryRouter>
    <OnboardingContext.Provider value={context}>{ui}</OnboardingContext.Provider>
  </MemoryRouter>,
);

beforeEach(() => {
  jest.clearAllMocks();
  mockReducedMotion = false;
});

describe('shared onboarding modal system', () => {
  test('intro is a real modal with only Empezar and Ahora no', async () => {
    const onStart = jest.fn();
    const onDismiss = jest.fn();
    render(<OnboardingIntroModal onStart={onStart} onDismiss={onDismiss} />);

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Tu partido empieza acá.')).toBeInTheDocument();
    expect(screen.getByText('Organizá con tu grupo, encontrá un partido o descubrí jugadores para sumarte.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Omitir' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cerrar' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Empezar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ahora no' }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test('first steps shows real progress and navigates without completing a task', async () => {
    const onNavigate = jest.fn();
    render(<OnboardingFirstStepsModal checklist={checklist()} onClose={jest.fn()} onNavigate={onNavigate} />);

    expect(screen.getByText('2/4 completados')).toBeInTheDocument();
    expect(screen.getByText('Invitá jugadores')).not.toHaveClass('line-through');
    await userEvent.click(screen.getByRole('button', { name: /Invitá jugadores/i }));
    expect(onNavigate).toHaveBeenCalledWith('/nuevo-partido');
    expect(screen.getByText('Invitá jugadores')).not.toHaveClass('line-through');
  });

  test('completion is a one-purpose premium modal without party emoji/icon copy', () => {
    render(<OnboardingCompletedModal onClose={jest.fn()} />);
    expect(screen.getByText('¡Listo! Ya conocés Arma2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seguir jugando' })).toBeInTheDocument();
    expect(screen.queryByText(/🎉|🥳/)).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Formación completa/i })).toBeInTheDocument();
  });

  test('all modal states share safe-area-aware lower spacing', () => {
    render(<OnboardingIntroModal onStart={jest.fn()} onDismiss={jest.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('pb-[max(calc(env(safe-area-inset-bottom)+18px),28px)]');
  });
});

describe('selector and semantic visuals', () => {
  test('selector uses the real display font and the three differentiated choices', () => {
    render(<OnboardingGoalSelector labelledById="goal-title" onSelect={jest.fn()} />);
    expect(screen.getByText('¿Qué querés hacer primero?')).toHaveClass('font-bebas-real');
    expect(screen.getByText('Organizar un partido')).toBeInTheDocument();
    expect(screen.getByText('Encontrar un partido')).toBeInTheDocument();
    expect(screen.getByText('Explorar para jugar')).toBeInTheDocument();
    expect(screen.queryByText('Conocer Arma2')).not.toBeInTheDocument();
  });

  test('reduced motion still renders complete, understandable art states', () => {
    mockReducedMotion = true;
    const { rerender } = render(<OnboardingStepArt name="create" />);
    expect(screen.getByRole('img', { name: /Card de partido/i })).toHaveTextContent('PARTIDO F5');
    rerender(<OnboardingStepArt name="explore_players" />);
    expect(screen.getByRole('img', { name: /Fichas de jugadores disponibles/i })).toHaveTextContent('JUGADOR DISPONIBLE');
  });
});

describe('Home and Perfil integration', () => {
  test('Home source contains no inline onboarding cards or placeholders', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/components/FifaHomeContent.js'), 'utf8');
    expect(source).not.toMatch(/OnboardingDiscoveryCard/);
    expect(source).not.toMatch(/OnboardingChecklist/);
    expect(source).not.toMatch(/data-onboarding-(?:card|checklist)/);
    expect(source).toMatch(/<QuickAccessRail[\s\S]*?<HomeNextStepCard[\s\S]*?Actividad reciente/);
  });

  test('Jugar records only real open/review interactions for the explore checklist', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/pages/QuieroJugar.js'), 'utf8');
    expect(source).toMatch(/markOnboardingAction\?\.\('openedPlay'\)/);
    expect(source).toMatch(/markOnboardingAction\?\.\('reviewedMatch'\)/);
    expect(source).toMatch(/markOnboardingAction\?\.\('reviewedPlayer'\)/);
    expect(source).toMatch(/onClick=\{\(\) => handleOpenMatch\(partido/);
  });

  test('Perfil can replay the tour and open pending first steps manually', async () => {
    const replayOnboarding = jest.fn();
    const showFirstSteps = jest.fn();
    renderWithContext({
      enabled: true,
      replayOnboarding,
      showFirstSteps,
      state: { chosenPath: 'organizer', checklist: {} },
    }, <OnboardingReplayButton />);

    await userEvent.click(screen.getByRole('button', { name: 'Conocer Arma2' }));
    await waitFor(() => expect(replayOnboarding).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Ver primeros pasos' }));
    await waitFor(() => expect(showFirstSteps).toHaveBeenCalledTimes(1));
  });

  test('manual entry stays hidden when rollout is disabled', () => {
    const { container } = renderWithContext({ enabled: false }, <OnboardingReplayButton />);
    expect(container).toBeEmptyDOMElement();
  });
});
