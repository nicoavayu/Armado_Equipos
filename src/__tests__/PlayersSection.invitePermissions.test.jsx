import { fireEvent, render, screen } from '@testing-library/react';
import PlayersSection from '../components/admin/PlayersSection';

const PLAYER_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

jest.mock('../components/ProfileComponents', () => ({
  PlayerCardTrigger: ({ children }) => children,
}));

jest.mock('../components/ConfirmModal', () => () => null);

jest.mock('../utils/calendarInvite', () => ({
  openMatchCalendarInvite: jest.fn(),
}));

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(() => {
      const builder = {
        select: jest.fn(() => builder),
        eq: jest.fn(() => builder),
        order: jest.fn(() => builder),
        limit: jest.fn(() => builder),
        maybeSingle: jest.fn(async () => ({ data: null, error: null })),
      };
      return builder;
    }),
  },
}));

jest.mock('framer-motion', () => {
  const React = require('react');
  return {
    AnimatePresence: ({ children }) => children,
    motion: {
      div: React.forwardRef(({ children, ...props }, ref) => (
        <div ref={ref} {...props}>{children}</div>
      )),
    },
  };
});

const player = {
  id: 21,
  uuid: 'player-row-uuid',
  partido_id: 55,
  usuario_id: PLAYER_ID,
  nombre: 'Jugador',
  is_substitute: false,
};

const baseProps = {
  isAdmin: false,
  jugadores: [player],
  partidoActual: {
    id: 55,
    creado_por: ADMIN_ID,
    estado: 'active',
    cupo_jugadores: 10,
    modalidad: 'F5',
    player_invites_enabled: true,
  },
  duplicatesDetected: 0,
  votantesConNombres: [],
  votantes: [],
  transferirAdmin: jest.fn(),
  user: { id: PLAYER_ID },
  eliminarJugador: jest.fn(),
  isClosing: false,
  isPlayerInMatch: true,
  pendingInvitation: false,
  aceptarInvitacion: jest.fn(),
  rechazarInvitacion: jest.fn(),
  invitationLoading: false,
  setShowInviteModal: jest.fn(),
  currentPlayerInMatch: player,
  invitationStatus: 'accepted',
  onShareRosterUpdate: jest.fn(),
  unirseAlPartido: jest.fn(),
};

describe('PlayersSection player invite CTA', () => {
  test('shows and opens Invitar amigos for an eligible registered participant', () => {
    const onInviteFriends = jest.fn();

    render(<PlayersSection {...baseProps} onInviteFriends={onInviteFriends} />);

    fireEvent.click(screen.getByRole('button', { name: 'Invitar amigos' }));
    expect(onInviteFriends).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Agregar al calendario' })).toBeInTheDocument();
  });

  test('hides Invitar amigos when player invitations are disabled', () => {
    render(
      <PlayersSection
        {...baseProps}
        partidoActual={{ ...baseProps.partidoActual, player_invites_enabled: false }}
        onInviteFriends={jest.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Invitar amigos' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar al calendario' })).toBeInTheDocument();
  });
});
