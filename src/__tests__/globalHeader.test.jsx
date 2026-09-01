import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GlobalHeader from '../components/global-header/GlobalHeader';

let mockCurrentSpace = 'arma2';
const mockSwitchSpace = jest.fn();
const mockIsSpaceAvailable = jest.fn(() => true);
const mockSetMyGlobalAvailability = jest.fn().mockResolvedValue(undefined);
const mockOpenLatestStory = jest.fn().mockResolvedValue(true);
let mockAwardsStory = {
  hasStory: false,
  hasPendingStory: false,
  openLatestStory: mockOpenLatestStory,
};

jest.mock('../features/space-navigation', () => ({
  APP_SPACE: { ARMA2: 'arma2', TORNEOS: 'torneos' },
  useSpaceNavigation: () => ({
    currentSpace: mockCurrentSpace,
    switchSpace: mockSwitchSpace,
    isSpaceAvailable: mockIsSpaceAvailable,
  }),
}));

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-123', email: 'ana@example.com', user_metadata: {} },
    profile: { nombre: 'Ana Jugadora', acepta_invitaciones: true },
    refreshProfile: jest.fn(),
  }),
}));

jest.mock('../context/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: { total: 3 }, notifications: [] }),
}));

jest.mock('../services/db/availability', () => ({
  setMyGlobalAvailability: (...args) => mockSetMyGlobalAvailability(...args),
}));

jest.mock('../components/global-header/AwardsStoryContext', () => ({
  useAwardsStory: () => mockAwardsStory,
}));

describe('GlobalHeader', () => {
  beforeEach(() => {
    mockCurrentSpace = 'arma2';
    mockSwitchSpace.mockClear();
    mockIsSpaceAvailable.mockReturnValue(true);
    mockSetMyGlobalAvailability.mockClear();
    mockOpenLatestStory.mockClear();
    mockAwardsStory = {
      hasStory: false,
      hasPendingStory: false,
      openLatestStory: mockOpenLatestStory,
    };
  });

  test('renders Arma2 brand, avatar and notification bell', () => {
    render(<GlobalHeader />);
    expect(screen.getByTestId('global-header')).toBeInTheDocument();
    expect(document.querySelector('[data-space-brand="arma2"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir menú de usuario' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir notificaciones' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Abrir selector de espacio/i }))
      .toHaveAttribute('aria-expanded', 'false');
  });

  test('renders the official Torneos brand without a provisional fallback', () => {
    mockCurrentSpace = 'torneos';
    render(<GlobalHeader />);
    expect(document.querySelector('img[data-space-brand="torneos"]')).toBeInTheDocument();
    expect(document.querySelector('[data-brand-fallback="true"]')).not.toBeInTheDocument();
  });

  test('renders a standalone gradient chevron as the only selector affordance', () => {
    render(<GlobalHeader />);
    const trigger = screen.getByRole('button', { name: /Abrir selector de espacio/i });
    const chevron = trigger.querySelector('svg[data-space-affordance="chevron"]');
    const gradient = chevron?.querySelector('linearGradient');
    const path = chevron?.querySelector('path');

    expect(chevron).toBeInTheDocument();
    expect(chevron?.parentElement).toBe(trigger);
    expect(gradient).toBeInTheDocument();
    expect(path?.getAttribute('stroke')).toBe(`url(#${gradient?.id})`);
    expect(trigger.querySelector('[data-space-affordance] > svg')).not.toBeInTheDocument();
  });

  test('opening and closing the selector never changes space', () => {
    render(<GlobalHeader />);
    fireEvent.click(screen.getByRole('button', { name: /Abrir selector de espacio/i }));
    expect(screen.getByRole('dialog', { name: /dónde querés estar/i })).toBeInTheDocument();
    expect(mockSwitchSpace).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /dónde querés estar/i })).not.toBeInTheDocument();
    expect(mockSwitchSpace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Abrir selector de espacio/i }));
    fireEvent.mouseDown(screen.getByTestId('space-selector-backdrop'));
    expect(mockSwitchSpace).not.toHaveBeenCalled();
  });

  test('only the explicit alternative option switches space; current option does not navigate', () => {
    render(<GlobalHeader />);
    fireEvent.click(screen.getByRole('button', { name: /Abrir selector de espacio/i }));
    const currentOption = screen.getByRole('button', { name: /Arma2 Partidos con amigos Actual/i });
    expect(currentOption).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Torneos Competencias.*Ir a Torneos/i }));
    expect(mockSwitchSpace).toHaveBeenCalledWith('torneos');
  });

  test('selector cards use the logos as the only visible brand labels', () => {
    render(<GlobalHeader />);
    fireEvent.click(screen.getByRole('button', { name: /Abrir selector de espacio/i }));
    const dialog = screen.getByRole('dialog', { name: /dónde querés estar/i });

    expect(dialog.querySelectorAll('[data-space-brand="arma2"]')).toHaveLength(1);
    expect(dialog.querySelectorAll('[data-space-brand="torneos"]')).toHaveLength(1);
    expect(dialog.querySelector('[data-brand-fallback="true"]')).not.toBeInTheDocument();
    expect(screen.queryByText('Arma2', { selector: 'strong' })).not.toBeInTheDocument();
    expect(screen.queryByText('Torneos', { selector: 'strong' })).not.toBeInTheDocument();
  });

  test('avatar always opens the menu with full name, availability and Profile', () => {
    render(<GlobalHeader />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú de usuario' }));
    expect(screen.getByRole('heading', { name: 'Ana Jugadora' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Disponible / })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Aparecés en Jugadores y podés recibir nuevas invitaciones para jugar.'))
      .toBeInTheDocument();
    expect(screen.getByText('No aparecés en Jugadores ni recibís nuevas invitaciones mientras esté activo.'))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Perfil Ver y editar/i }));
    expect(mockSwitchSpace).toHaveBeenCalledWith('arma2', { route: '/profile' });
  });

  test('pending and already-viewed awards stay accessible inside the avatar menu', () => {
    mockAwardsStory = {
      hasStory: true,
      hasPendingStory: true,
      openLatestStory: mockOpenLatestStory,
    };
    const { rerender } = render(<GlobalHeader />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú de usuario' }));
    fireEvent.click(screen.getByRole('button', { name: /Ver nuevos premios/i }));
    expect(mockOpenLatestStory).toHaveBeenCalledTimes(1);

    mockAwardsStory = {
      hasStory: true,
      hasPendingStory: false,
      openLatestStory: mockOpenLatestStory,
    };
    rerender(<GlobalHeader />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú de usuario' }));
    expect(screen.getByRole('button', { name: /Volver a ver premios/i })).toBeInTheDocument();
  });

  test('availability remains actionable from the avatar menu', async () => {
    render(<GlobalHeader />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú de usuario' }));
    fireEvent.click(screen.getByRole('button', { name: /^No disponible / }));
    await waitFor(() => expect(mockSetMyGlobalAvailability).toHaveBeenCalledWith(false));
  });
});
