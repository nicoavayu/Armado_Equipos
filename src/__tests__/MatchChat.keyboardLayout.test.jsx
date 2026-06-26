import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Capacitor } from '@capacitor/core';
import MatchChat, { resolveMatchChatViewportMetrics } from '../components/MatchChat';

let mockKeyboardState = { keyboardHeight: 0, isKeyboardOpen: false };

jest.mock('../hooks/useKeyboard', () => ({
  useKeyboard: jest.fn(() => mockKeyboardState),
}));

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'nixon@example.com' },
    profile: { nombre: 'Nixon' },
  }),
}));

jest.mock('utils/notifyBlockingError', () => ({
  notifyBlockingError: jest.fn(),
}));

const createChannel = () => {
  const channel = {
    on: jest.fn(() => channel),
    subscribe: jest.fn(() => channel),
    send: jest.fn(() => Promise.resolve('ok')),
  };
  return channel;
};

const createMessagesQuery = () => {
  const query = {
    select: jest.fn(() => query),
    order: jest.fn(() => query),
    eq: jest.fn(() => Promise.resolve({ data: [], error: null })),
  };
  return query;
};

jest.mock('../supabase', () => ({
  supabase: {
    channel: jest.fn(() => createChannel()),
    removeChannel: jest.fn(),
    from: jest.fn(() => createMessagesQuery()),
    rpc: jest.fn(),
  },
}));

const { useKeyboard } = require('../hooks/useKeyboard');
const { supabase } = require('../supabase');

const createVisualViewport = ({ height, offsetTop = 0 }) => ({
  height,
  offsetTop,
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
});

describe('MatchChat keyboard layout', () => {
  let getPlatformSpy = null;
  let originalInnerHeight = null;
  let originalMatchMedia = null;
  let originalScrollIntoView = null;
  let originalScrollTo = null;
  let originalVisualViewport = null;

  beforeEach(() => {
    mockKeyboardState = { keyboardHeight: 0, isKeyboardOpen: false };
    useKeyboard.mockImplementation(() => mockKeyboardState);
    supabase.channel.mockImplementation(() => createChannel());
    supabase.from.mockImplementation(() => createMessagesQuery());
    supabase.removeChannel.mockImplementation(() => undefined);
    getPlatformSpy = jest.spyOn(Capacitor, 'getPlatform').mockImplementation(() => 'android');
    originalInnerHeight = window.innerHeight;
    originalMatchMedia = window.matchMedia;
    originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    originalScrollTo = window.scrollTo;
    originalVisualViewport = window.visualViewport;
    window.HTMLElement.prototype.scrollIntoView = jest.fn();
    window.scrollTo = jest.fn();

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: jest.fn(() => ({
        matches: true,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        addListener: jest.fn(),
        removeListener: jest.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    getPlatformSpy?.mockRestore();
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: originalInnerHeight,
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      writable: true,
      value: originalVisualViewport,
    });
    if (originalScrollIntoView) {
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    } else {
      delete window.HTMLElement.prototype.scrollIntoView;
    }
    window.scrollTo = originalScrollTo;
    jest.clearAllMocks();
  });

  test('Android no descuenta dos veces keyboardHeight cuando el WebView ya redujo el viewport', () => {
    const metrics = resolveMatchChatViewportMetrics({
      fallbackHeight: 520,
      visualViewportHeight: 520,
      isCompactLayout: true,
      isKeyboardOpen: true,
      keyboardHeight: 320,
      platform: 'android',
    });

    expect(metrics.height).toBe('520px');
    expect(metrics.shouldSubtractKeyboard).toBe(false);
  });

  test('mantiene el fallback de iOS cuando el viewport no fue reducido', () => {
    const metrics = resolveMatchChatViewportMetrics({
      fallbackHeight: 844,
      visualViewportHeight: 844,
      isCompactLayout: true,
      isKeyboardOpen: true,
      keyboardHeight: 320,
      platform: 'ios',
    });

    expect(metrics.height).toBe('524px');
    expect(metrics.shouldSubtractKeyboard).toBe(true);
  });

  test('ancla el composer al panel visible y deja los mensajes scrolleables', async () => {
    mockKeyboardState = { keyboardHeight: 320, isKeyboardOpen: true };
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 520,
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      writable: true,
      value: createVisualViewport({ height: 520 }),
    });

    render(<MatchChat partidoId="123" isOpen onClose={jest.fn()} />);

    const modalRoot = document.querySelector('[data-match-chat-root="true"]');
    await waitFor(() => expect(modalRoot.style.height).toBe('520px'));

    expect(modalRoot.style.paddingBottom).toBe('');
    expect(screen.getByTestId('match-chat-panel')).toHaveClass('h-full', 'min-h-0', 'overflow-hidden');
    expect(screen.getByTestId('match-chat-messages')).toHaveClass('flex-1', 'min-h-0', 'overflow-y-auto');
    expect(screen.getByTestId('match-chat-composer')).toHaveClass('shrink-0');
  });

  test('restaura el alto normal cuando se cierra el teclado', async () => {
    mockKeyboardState = { keyboardHeight: 320, isKeyboardOpen: true };
    const visualViewport = createVisualViewport({ height: 520 });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 520,
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      writable: true,
      value: visualViewport,
    });

    const { rerender } = render(<MatchChat partidoId="123" isOpen onClose={jest.fn()} />);
    const modalRoot = document.querySelector('[data-match-chat-root="true"]');
    await waitFor(() => expect(modalRoot.style.height).toBe('520px'));

    mockKeyboardState = { keyboardHeight: 0, isKeyboardOpen: false };
    window.innerHeight = 844;
    visualViewport.height = 844;
    rerender(<MatchChat partidoId="123" isOpen onClose={jest.fn()} />);

    await waitFor(() => expect(modalRoot.style.height).toBe('844px'));
  });
});
