import { act, render, screen } from '@testing-library/react';
import { Capacitor } from '@capacitor/core';

let mockKeyboardState = { keyboardHeight: 0, isKeyboardOpen: false };

jest.mock('../hooks/useKeyboard', () => ({
  useKeyboard: jest.fn(() => mockKeyboardState),
}));

const Modal = require('../components/Modal').default;
const { useKeyboard } = require('../hooks/useKeyboard');

describe('Modal keyboard layout', () => {
  let getPlatformSpy = null;

  beforeEach(() => {
    mockKeyboardState = { keyboardHeight: 0, isKeyboardOpen: false };
    useKeyboard.mockImplementation(() => mockKeyboardState);
    getPlatformSpy = jest.spyOn(Capacitor, 'getPlatform').mockImplementation(() => 'android');
  });

  afterEach(() => {
    getPlatformSpy?.mockRestore();
    jest.clearAllMocks();
  });

  test('no descuenta dos veces la altura del teclado en Android nativo', () => {
    mockKeyboardState = { keyboardHeight: 320, isKeyboardOpen: true };

    render(
      <Modal isOpen onClose={jest.fn()} title="Editar datos del partido">
        <label htmlFor="cancha-cost">Costo cancha</label>
        <input id="cancha-cost" defaultValue="6500" />
      </Modal>,
    );

    const modalRoot = document.querySelector('[data-modal-root="true"]');
    const modalRootStyle = modalRoot.getAttribute('style');
    expect(modalRoot).toBeInTheDocument();
    expect(modalRoot.style.getPropertyValue('--keyboard-height')).toBe('320px');
    expect(modalRootStyle).not.toMatch(/padding-bottom:[^;]*320px/);
    expect(modalRoot.style.alignItems).toBe('flex-start');
  });

  test('el body del modal queda como area scrolleable real', () => {
    render(
      <Modal isOpen onClose={jest.fn()} title="Editar datos del partido">
        <form data-testid="edit-match-form">
          <input aria-label="Costo cancha" defaultValue="6500" />
        </form>
      </Modal>,
    );

    const form = screen.getByTestId('edit-match-form');
    const content = form.parentElement;
    const modalPanel = content.parentElement;

    expect(content).toHaveClass('min-h-0');
    expect(content).toHaveClass('overflow-y-auto');
    expect(content).toHaveClass('flex-1');
    expect(modalPanel).toHaveClass('min-h-0');
    expect(modalPanel).toHaveClass('overflow-hidden');
  });

  test('mantiene visible el campo enfocado cuando el teclado esta abierto', () => {
    mockKeyboardState = { keyboardHeight: 280, isKeyboardOpen: true };
    jest.useFakeTimers();
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = jest.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(
      <Modal isOpen onClose={jest.fn()} title="Editar datos del partido">
        <label htmlFor="cancha-cost">Costo cancha</label>
        <input id="cancha-cost" defaultValue="6500" />
      </Modal>,
    );

    act(() => {
      screen.getByLabelText('Costo cancha').focus();
      jest.advanceTimersByTime(140);
    });

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'center',
      inline: 'nearest',
      behavior: 'smooth',
    });

    jest.useRealTimers();
    if (originalScrollIntoView) {
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    } else {
      delete window.HTMLElement.prototype.scrollIntoView;
    }
  });

  test('mantiene el inset por teclado en iOS cuando el viewport no fue reducido', () => {
    getPlatformSpy.mockImplementation(() => 'ios');
    mockKeyboardState = { keyboardHeight: 260, isKeyboardOpen: true };

    render(
      <Modal isOpen onClose={jest.fn()} title="Editar datos del partido">
        <input aria-label="Costo cancha" defaultValue="6500" />
      </Modal>,
    );

    const modalRoot = document.querySelector('[data-modal-root="true"]');
    expect(modalRoot.getAttribute('style')).toContain('260px');
  });
});
