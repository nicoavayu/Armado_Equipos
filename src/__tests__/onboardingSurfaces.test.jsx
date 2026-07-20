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
  const motionCache = {};
  return {
    motion: new Proxy({}, { get: (_target, key) => (motionCache[key] ||= passthrough(key)) }),
    AnimatePresence: ({ children }) => ReactLib.createElement(ReactLib.Fragment, null, children),
    useReducedMotion: () => mockReducedMotion,
  };
});

const OnboardingIntroModal = require('../features/onboarding/OnboardingIntroModal').default;
const OnboardingShell = require('../features/onboarding/OnboardingShell').default;
const OnboardingGoalSelector = require('../features/onboarding/OnboardingGoalSelector').default;
const OnboardingStepArt = require('../features/onboarding/OnboardingStepArt').default;
const OnboardingReplayButton = require('../features/onboarding/OnboardingReplayButton').default;
const { PrimaryButton, GhostButton } = require('../features/onboarding/OnboardingUI');

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
    expect(screen.queryByText('Tu grupo · Tu próximo partido')).not.toBeInTheDocument();

    const title = screen.getByRole('heading', { name: 'Tu partido empieza acá.' });
    expect(title).toHaveClass('whitespace-nowrap');
    for (const button of [
      screen.getByRole('button', { name: 'Empezar' }),
      screen.getByRole('button', { name: 'Ahora no' }),
    ]) {
      expect(button).toHaveClass('font-sans');
      expect(button).not.toHaveClass('font-bebas-real', 'font-bebas', 'font-oswald');
      expect(button.querySelector('svg')).toBeNull();
    }

    await userEvent.click(screen.getByRole('button', { name: 'Empezar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ahora no' }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test('all modal states share safe-area-aware lower spacing', () => {
    render(<OnboardingIntroModal onStart={jest.fn()} onDismiss={jest.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('pb-[max(calc(env(safe-area-inset-bottom)+18px),28px)]');
  });

  test('fullscreen tour uses the viewport as the pitch frame and the voting X pattern', () => {
    render(
      <OnboardingShell onDismiss={jest.fn()} labelledById="shell-title">
        <h2 id="shell-title">Tutorial</h2>
      </OnboardingShell>,
    );
    const frame = document.querySelector('[data-onboarding-fullscreen-frame="true"]');
    expect(frame).toHaveClass('h-[100dvh]', 'w-full', 'rounded-none', 'border-0');
    expect(frame.className).not.toMatch(/max-w-\[520px\]|sm:rounded|sm:border/);
    expect(document.querySelector('[data-onboarding-pitch="fullscreen"]')).toBeInTheDocument();
    const dismiss = screen.getByRole('button', { name: 'Omitir tutorial' });
    expect(dismiss).toHaveClass('h-10', 'w-10', 'text-white/92');
    expect(dismiss).toContainElement(dismiss.querySelector('svg'));
  });
});

describe('selector and semantic visuals', () => {
  test('selector is centered and exposes five differentiated choices', () => {
    render(<OnboardingGoalSelector labelledById="goal-title" onSelect={jest.fn()} />);
    expect(screen.getByText('¿Qué querés hacer primero?')).toHaveClass('font-bebas-real', 'text-center');
    expect(screen.getByText('Organizar un partido')).toBeInTheDocument();
    expect(screen.getByText('Partido Automático')).toBeInTheDocument();
    expect(screen.getByText('Explorar para jugar')).toBeInTheDocument();
    expect(screen.getByText('Desafíos')).toBeInTheDocument();
    expect(screen.getByText('Estadísticas')).toBeInTheDocument();
    expect(screen.queryByText('Conocer Arma2')).not.toBeInTheDocument();
    expect(screen.queryByText('1/1')).not.toBeInTheDocument();
    expect(document.querySelector('[data-onboarding-goal-list="true"]')).toHaveClass('overflow-y-auto');
    screen.getAllByRole('button').forEach((button) => {
      expect(button).toHaveAttribute('data-preserve-button-case', 'true');
    });
  });

  test('shared CTA labels keep an uppercase initial without display typography', () => {
    render(
      <>
        <PrimaryButton>empezar</PrimaryButton>
        <GhostButton>ahora no</GhostButton>
      </>,
    );
    const primary = screen.getByRole('button', { name: 'Empezar' });
    const ghost = screen.getByRole('button', { name: 'Ahora no' });
    [primary, ghost].forEach((button) => {
      expect(button).toHaveAttribute('data-preserve-button-case', 'true');
      expect(button).toHaveAttribute('data-onboarding-cta', 'true');
      expect(button).toHaveClass('font-sans', 'normal-case');
    });
  });

  test('reduced motion still renders complete, understandable art states', () => {
    mockReducedMotion = true;
    const { rerender } = render(<OnboardingStepArt name="create" />);
    expect(screen.getByRole('img', { name: /Card de partido/i })).toHaveTextContent('PARTIDO F5');
    rerender(<OnboardingStepArt name="explore_players" />);
    expect(screen.getByRole('img', { name: /Fichas de jugadores disponibles/i })).toHaveTextContent('JUGADOR DISPONIBLE');
    rerender(<OnboardingStepArt name="history" />);
    expect(screen.getByRole('img', { name: /Lista cronológica/i })).toHaveTextContent('PARTIDO F5');
    expect(screen.getByRole('img', { name: /Lista cronológica/i })).not.toHaveTextContent(/PARTIDO FINALIZADO|Guardado|Resultado|3\s*[-–]\s*2/i);
    rerender(<OnboardingStepArt name="stats" />);
    expect(screen.getByRole('img', { name: /Resumen anual/i })).toHaveTextContent('JUGADOS');
    expect(screen.getByRole('img', { name: /Resumen anual/i })).toHaveTextContent('GANADOS');
    expect(screen.getByRole('img', { name: /Resumen anual/i })).toHaveTextContent('EMPATADOS');
    expect(screen.getByRole('img', { name: /Resumen anual/i })).toHaveTextContent('LESIONES');
  });

  test('each closing and single-screen feature selects its own visual', () => {
    const arts = ['organizer_closing', 'auto_closing', 'explore_closing', 'challenges', 'stats'];
    const { rerender } = render(<OnboardingStepArt name={arts[0]} />);
    arts.forEach((name) => {
      rerender(<OnboardingStepArt name={name} />);
      expect(document.querySelector(`[data-onboarding-art="${name}"]`)).toBeInTheDocument();
    });
    expect(new Set(arts).size).toBe(arts.length);
  });

  test('onboarding source contains no stored-score claims, intro badge or display-font CTAs', () => {
    const featureDir = path.join(process.cwd(), 'src/features/onboarding');
    const source = fs.readdirSync(featureDir)
      .filter((file) => /\.(?:js|jsx)$/.test(file))
      .map((file) => fs.readFileSync(path.join(featureDir, file), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/Guardá resultados|Todo queda registrado|PARTIDO FINALIZADO|Guardado en tu historial|Tu grupo · Tu próximo partido/);
    expect(source).not.toMatch(/Abrí la pestaña Jugar|Entrá a Jugar para completar|Visitá Estadísticas para terminar/);
    expect(source).not.toMatch(/data-onboarding-cta="true"[^>]*font-(?:bebas|bebas-real|oswald)/);
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

  test('Jugar no longer wires the removed "Primeros pasos" checklist tracking', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/pages/QuieroJugar.js'), 'utf8');
    expect(source).not.toMatch(/markOnboardingAction/);
    expect(source).not.toMatch(/markChecklistAction/);
    expect(source).not.toMatch(/useOnboardingOptional/);
  });

  test('Perfil can replay the tour and never offers a "Primeros pasos" entry', async () => {
    const replayOnboarding = jest.fn();
    renderWithContext({
      enabled: true,
      replayOnboarding,
      state: { chosenPath: 'organizer' },
    }, <OnboardingReplayButton />);

    await userEvent.click(screen.getByRole('button', { name: 'Conocer Arma2' }));
    await waitFor(() => expect(replayOnboarding).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Ver primeros pasos' })).not.toBeInTheDocument();
  });

  test('manual entry stays hidden when rollout is disabled', () => {
    const { container } = renderWithContext({ enabled: false }, <OnboardingReplayButton />);
    expect(container).toBeEmptyDOMElement();
  });
});
