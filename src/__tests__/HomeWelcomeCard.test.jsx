import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomeWelcomeCard, { HOME_WELCOME_CARD_SEEN_KEY } from '../components/HomeWelcomeCard';
import { useAuth } from '../components/AuthProvider';
import { useOnboardingOptional } from '../features/onboarding/OnboardingContext';

jest.mock('../Logo.png', () => 'logo-mock');
jest.mock('../components/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../features/onboarding/OnboardingContext', () => ({ useOnboardingOptional: jest.fn() }));

const renderCard = (entry = '/') => render(
  <MemoryRouter initialEntries={[entry]}>
    <HomeWelcomeCard />
  </MemoryRouter>,
);

const onboardingState = (over = {}) => ({
  stateLoaded: true,
  state: { welcomeCardDismissed: false },
  dismissWelcomeCard: jest.fn(),
  ...over,
});

describe('HomeWelcomeCard', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAuth.mockReturnValue({ user: { id: 'user-a' } });
    useOnboardingOptional.mockReturnValue(onboardingState());
  });

  test('se muestra en la primera entrada de la cuenta a Home', () => {
    renderCard();

    expect(screen.getByRole('heading', { name: /Tu punto de partida/i })).toBeInTheDocument();
    expect(screen.getByText(/seguir la actividad reciente/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aceptar/i })).toBeInTheDocument();
  });

  test('al aceptar queda registrado para esa cuenta (local y en su estado)', () => {
    const onboarding = onboardingState();
    useOnboardingOptional.mockReturnValue(onboarding);
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: /Aceptar/i }));

    expect(window.localStorage.getItem(`${HOME_WELCOME_CARD_SEEN_KEY}:user-a`)).toBe('1');
    expect(onboarding.dismissWelcomeCard).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: /Tu punto de partida/i })).not.toBeInTheDocument();
  });

  test('otra cuenta en el mismo teléfono tiene su propia marca', () => {
    window.localStorage.setItem(`${HOME_WELCOME_CARD_SEEN_KEY}:user-a`, '1');
    useAuth.mockReturnValue({ user: { id: 'user-b' } });

    renderCard();

    expect(screen.getByRole('heading', { name: /Tu punto de partida/i })).toBeInTheDocument();
  });

  test('no aparece si la cuenta ya la descartó (estado guardado), aunque el teléfono sea nuevo', () => {
    useOnboardingOptional.mockReturnValue(onboardingState({ state: { welcomeCardDismissed: true } }));
    renderCard();
    expect(screen.queryByRole('heading', { name: /Tu punto de partida/i })).not.toBeInTheDocument();
  });

  test('no aparece en una cuenta que ya pasó por el tutorial (terminado, salteado o a medias)', () => {
    ['completed', 'skipped', 'in_progress'].forEach((status) => {
      useOnboardingOptional.mockReturnValue(onboardingState({ state: { status, welcomeCardDismissed: false } }));
      const { unmount } = renderCard();
      expect(screen.queryByRole('heading', { name: /Tu punto de partida/i })).not.toBeInTheDocument();
      unmount();
    });
  });

  test('no aparece mientras el estado de la cuenta se está cargando', () => {
    useOnboardingOptional.mockReturnValue(onboardingState({ stateLoaded: false }));
    renderCard();
    expect(screen.queryByRole('heading', { name: /Tu punto de partida/i })).not.toBeInTheDocument();
  });

  test('no tapa un enlace que llega con parámetros (partido, encuesta, invitación)', () => {
    renderCard('/?codigo=ABC123');
    expect(screen.queryByRole('heading', { name: /Tu punto de partida/i })).not.toBeInTheDocument();
  });

  test('quien la vio antes en este teléfono no la vuelve a ver y queda registrado en su cuenta', () => {
    window.localStorage.setItem(HOME_WELCOME_CARD_SEEN_KEY, '1');
    const onboarding = onboardingState();
    useOnboardingOptional.mockReturnValue(onboarding);

    renderCard();

    expect(screen.queryByRole('heading', { name: /Tu punto de partida/i })).not.toBeInTheDocument();
    expect(onboarding.dismissWelcomeCard).toHaveBeenCalledTimes(1);
  });
});
