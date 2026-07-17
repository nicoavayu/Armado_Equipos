import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { OnboardingContext } from '../features/onboarding/OnboardingContext';

jest.mock('framer-motion', () => {
  const ReactLib = require('react');
  const strip = (p) => { const { initial, animate, exit, transition, variants, ...rest } = p; return rest; };
  const passthrough = (tag) => ReactLib.forwardRef(({ children, ...props }, ref) => ReactLib.createElement(tag, { ...strip(props), ref }, children));
  const motionCache = {};
  return {
    motion: new Proxy({}, { get: (_t, k) => (motionCache[k] ||= passthrough(k)) }),
    AnimatePresence: ({ children }) => ReactLib.createElement(ReactLib.Fragment, null, children),
    useReducedMotion: () => false,
  };
});
// Avoid a pending native-push redirect / recovery URL being seen as an intent.
jest.mock('../features/onboarding/pendingIntent', () => ({
  ...jest.requireActual('../features/onboarding/pendingIntent'),
  hasPendingIntent: jest.fn(() => false),
}));

const OnboardingCoachMark = require('../features/onboarding/OnboardingCoachMark').default;
const { hasPendingIntent } = require('../features/onboarding/pendingIntent');

// jsdom lacks scrollIntoView.
beforeAll(() => { window.HTMLElement.prototype.scrollIntoView = jest.fn(); });

function makeCtx(over = {}) {
  const seen = {};
  return {
    enabled: true,
    isActive: false,
    stateLoaded: true,
    isCoachMarkGroupDone: jest.fn(() => false),
    markCoachMarkGroupDone: jest.fn(),
    markCoachMarkSeen: jest.fn((s, id) => { seen[`${s}:${id}`] = true; }),
    ...over,
  };
}

function renderCoach(ctx, { withTargets = true } = {}) {
  return render(
    <OnboardingContext.Provider value={ctx}>
      {withTargets && (
        <>
          <button data-tour-id="new-match-manual" type="button">manual</button>
          <button data-tour-id="new-match-whatsapp" type="button">whatsapp</button>
        </>
      )}
      <OnboardingCoachMark screenKey="new-match" />
    </OnboardingContext.Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  hasPendingIntent.mockReturnValue(false);
});

describe('OnboardingCoachMark', () => {
  test('shows the first mark when its target exists, with progress', async () => {
    renderCoach(makeCtx());
    expect(await screen.findByText('Creá tu partido')).toBeInTheDocument();
    expect(screen.getByText('1 de 2')).toBeInTheDocument();
  });

  test('Siguiente / Anterior navigate the marks', async () => {
    renderCoach(makeCtx());
    await screen.findByText('Creá tu partido');
    await userEvent.click(screen.getByRole('button', { name: /Siguiente/i }));
    expect(await screen.findByText('¿Ya tenés la lista?')).toBeInTheDocument();
    expect(screen.getByText('2 de 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Anterior/i }));
    expect(await screen.findByText('Creá tu partido')).toBeInTheDocument();
  });

  test('finishing (Entendido on last) marks the group done, does not loop', async () => {
    const ctx = makeCtx();
    renderCoach(ctx);
    await screen.findByText('Creá tu partido');
    await userEvent.click(screen.getByRole('button', { name: /Siguiente/i }));
    await userEvent.click(await screen.findByRole('button', { name: /Entendido/i }));
    await waitFor(() => expect(ctx.markCoachMarkGroupDone).toHaveBeenCalledWith('new-match', 1));
    expect(screen.queryByText('¿Ya tenés la lista?')).not.toBeInTheDocument();
  });

  test('the borderless X dismisses and marks the group done', async () => {
    const ctx = makeCtx();
    renderCoach(ctx);
    await screen.findByText('Creá tu partido');
    await userEvent.click(screen.getByRole('button', { name: 'Omitir tutorial' }));
    await waitFor(() => expect(ctx.markCoachMarkGroupDone).toHaveBeenCalledWith('new-match', 1));
  });

  test('does not run when the group is already done (no repeat)', async () => {
    const ctx = makeCtx({ isCoachMarkGroupDone: jest.fn(() => true) });
    renderCoach(ctx);
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    expect(screen.queryByText('Creá tu partido')).not.toBeInTheDocument();
  });

  test('with no target present, marks the group done and renders nothing (no loop)', async () => {
    const ctx = makeCtx();
    renderCoach(ctx, { withTargets: false });
    await waitFor(() => expect(ctx.markCoachMarkGroupDone).toHaveBeenCalledWith('new-match', 1));
    expect(screen.queryByText('Creá tu partido')).not.toBeInTheDocument();
  });

  test('does not run during a pending deep-link / urgent intent', async () => {
    hasPendingIntent.mockReturnValue(true);
    renderCoach(makeCtx());
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    expect(screen.queryByText('Creá tu partido')).not.toBeInTheDocument();
  });

  test('does not run over an active fullscreen flow', async () => {
    renderCoach(makeCtx({ isActive: true }));
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    expect(screen.queryByText('Creá tu partido')).not.toBeInTheDocument();
  });

  test('renders nothing with no provider', () => {
    const { container } = render(<OnboardingCoachMark screenKey="new-match" />);
    expect(container).toBeEmptyDOMElement();
  });
});
