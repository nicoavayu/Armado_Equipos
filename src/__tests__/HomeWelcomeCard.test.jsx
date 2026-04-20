import { fireEvent, render, screen } from '@testing-library/react';
import HomeWelcomeCard, { HOME_WELCOME_CARD_SEEN_KEY } from '../components/HomeWelcomeCard';

jest.mock('../Logo.png', () => 'logo-mock');

describe('HomeWelcomeCard', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('se muestra en la primera entrada a Home', () => {
    render(<HomeWelcomeCard />);

    expect(screen.getByRole('heading', { name: /Tu punto de partida/i })).toBeInTheDocument();
    expect(screen.getByText(/seguir la actividad reciente/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aceptar/i })).toBeInTheDocument();
  });

  test('guarda el dismiss y no vuelve a mostrarse tras entendido', () => {
    render(<HomeWelcomeCard />);

    fireEvent.click(screen.getByRole('button', { name: /Aceptar/i }));

    expect(window.localStorage.getItem(HOME_WELCOME_CARD_SEEN_KEY)).toBe('1');
    expect(screen.queryByRole('heading', { name: /Tu punto de partida/i })).not.toBeInTheDocument();
  });

  test('permanece oculta cuando ya fue vista', () => {
    window.localStorage.setItem(HOME_WELCOME_CARD_SEEN_KEY, '1');

    render(<HomeWelcomeCard />);

    expect(screen.queryByRole('heading', { name: /Tu punto de partida/i })).not.toBeInTheDocument();
  });
});
