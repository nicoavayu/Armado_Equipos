import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PartidoInvitacion from '../pages/PartidoInvitacion';
import { supabase } from '../supabase';
import { isUserMemberOfMatch } from '../utils/membershipCheck';

const ADMIN_ID = 'admin-user';
const PLAYER_ID = 'player-user';
const MATCH_ID = 55;

let mockAuthUser = { id: PLAYER_ID, email: 'player@example.com' };
let mockMatchRow = {};
let mockPlayersRows = [];
let mockIsMember = true;
let mockPlayerInvitesFallback;

const mockInviteAmigosModal = jest.fn();

jest.mock('../components/AuthProvider', () => ({
  useAuth: () => ({ user: mockAuthUser }),
}));

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('../utils/membershipCheck', () => ({
  clearGuestMembership: jest.fn(),
  isUserMemberOfMatch: jest.fn(),
}));

jest.mock('../components/InviteAmigosModal', () => {
  const React = require('react');

  return function MockInviteAmigosModal(props) {
    mockInviteAmigosModal(props);

    if (!props.isOpen) return null;

    return React.createElement('div', {
      'data-testid': 'registered-invite-modal',
      'data-mode': props.mode,
      'data-current-user-id': props.currentUserId,
      'data-match-id': String(props.partidoActual?.id || ''),
    }, 'registered direct invite modal');
  };
});

jest.mock('../components/ProfileComponents', () => ({
  PlayerCardTrigger: ({ children }) => children,
}));

jest.mock('../components/TabBar', () => () => null);

jest.mock('../hooks/useRefreshOnVisibility', () => ({
  useRefreshOnVisibility: jest.fn(),
}));

jest.mock('../hooks/useSupabaseRealtime', () => ({
  useSupabaseRealtime: jest.fn(),
}));

jest.mock('../hooks/useInterval', () => ({
  useInterval: () => ({
    setIntervalSafe: jest.fn(),
    clearIntervalSafe: jest.fn(),
  }),
}));

jest.mock('../hooks/useSmartBackNavigation', () => ({
  useSmartBackNavigation: () => jest.fn(),
}));

jest.mock('../utils/calendarInvite', () => ({
  openMatchCalendarInvite: jest.fn(),
}));

jest.mock('utils/notifyBlockingError', () => ({
  notifyBlockingError: jest.fn(),
}));

jest.mock('../services/db/matchScheduling', () => ({
  findUserScheduleConflicts: jest.fn(),
}));

jest.mock('../services/matchJoinNotificationService', () => ({
  notifyAdminJoinRequest: jest.fn(),
  notifyAdminPlayerJoined: jest.fn(),
}));

jest.mock('../services/pushDispatchService', () => ({
  requestImmediatePushDispatch: jest.fn(),
}));

const createQueryBuilder = (result) => {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    in: jest.fn(() => builder),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => result),
    single: jest.fn(async () => result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };

  return builder;
};

const buildMatch = (overrides = {}) => ({
  id: MATCH_ID,
  nombre: 'Partido abierto',
  fecha: '2099-01-01',
  hora: '20:00',
  sede: 'Club Test',
  modalidad: 'F5',
  tipo_partido: 'Masculino',
  cupo_jugadores: 10,
  creado_por: ADMIN_ID,
  estado: 'activo',
  player_invites_enabled: true,
  ...overrides,
});

const buildPlayerRow = (userId = PLAYER_ID) => ({
  id: `row-${userId}`,
  partido_id: MATCH_ID,
  usuario_id: userId,
  nombre: userId === ADMIN_ID ? 'Admin' : 'Jugador',
  is_substitute: false,
});

const renderPublicMatch = async () => {
  render(
    <MemoryRouter
      initialEntries={[`/partido-publico/${MATCH_ID}`]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route
          path="/partido-publico/:partidoId"
          element={<PartidoInvitacion mode="public" />}
        />
      </Routes>
    </MemoryRouter>,
  );

  await screen.findByRole('button', { name: /Agregar al calendario/i });
};

describe('PartidoInvitacion registered player invites', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockAuthUser = { id: PLAYER_ID, email: 'player@example.com' };
    mockMatchRow = buildMatch();
    mockPlayersRows = [buildPlayerRow(PLAYER_ID)];
    mockIsMember = true;
    mockPlayerInvitesFallback = undefined;

    isUserMemberOfMatch.mockImplementation(async () => ({
      isMember: mockIsMember,
      jugadorRow: mockIsMember ? buildPlayerRow(mockAuthUser?.id) : null,
    }));

    supabase.from.mockImplementation((table) => {
      if (table === 'partidos_view') {
        return createQueryBuilder({ data: mockMatchRow, error: null });
      }

      if (table === 'jugadores') {
        return createQueryBuilder({
          data: mockPlayersRows,
          count: mockPlayersRows.length,
          error: null,
        });
      }

      if (table === 'partidos') {
        return createQueryBuilder({
          data: { player_invites_enabled: mockPlayerInvitesFallback },
          error: null,
        });
      }

      return createQueryBuilder({ data: null, error: null });
    });

    supabase.rpc.mockResolvedValue({ data: null, error: null });
  });

  test('participante no-admin ve Invitar amigos cuando player_invites_enabled está habilitado', async () => {
    await renderPublicMatch();

    const inviteButton = screen.getByRole('button', { name: 'Invitar amigos' });
    expect(inviteButton).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Agregar al calendario/i })).toBeInTheDocument();
    expect(screen.queryByText(/WhatsApp/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Compartir link/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sumarte rapido|Sumarte rápido/i)).not.toBeInTheDocument();

    fireEvent.click(inviteButton);

    const modal = await screen.findByTestId('registered-invite-modal');
    expect(modal).toHaveAttribute('data-mode', 'direct');
    expect(modal).toHaveAttribute('data-current-user-id', PLAYER_ID);
    expect(modal).toHaveAttribute('data-match-id', String(MATCH_ID));
    expect(mockInviteAmigosModal).toHaveBeenLastCalledWith(expect.objectContaining({
      mode: 'direct',
      currentUserId: PLAYER_ID,
      partidoActual: expect.objectContaining({
        id: MATCH_ID,
        player_invites_enabled: true,
      }),
      jugadores: mockPlayersRows,
    }));
    expect(supabase.rpc).not.toHaveBeenCalledWith('create_guest_match_invite', expect.anything());
  });

  test('participante no-admin no ve Invitar amigos cuando player_invites_enabled está apagado', async () => {
    mockMatchRow = buildMatch({ player_invites_enabled: false });

    await renderPublicMatch();

    expect(screen.queryByRole('button', { name: 'Invitar amigos' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Agregar al calendario/i })).toBeInTheDocument();
    expect(screen.queryByText(/WhatsApp/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Compartir link/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('registered-invite-modal')).not.toBeInTheDocument();
  });

  test('player_invites_enabled undefined se trata como false', async () => {
    mockMatchRow = buildMatch();
    delete mockMatchRow.player_invites_enabled;
    mockPlayerInvitesFallback = undefined;

    await renderPublicMatch();

    expect(screen.queryByRole('button', { name: 'Invitar amigos' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Agregar al calendario/i })).toBeInTheDocument();
  });

  test('admin no recibe el botón de jugador en la vista pública', async () => {
    mockAuthUser = { id: ADMIN_ID, email: 'admin@example.com' };
    mockPlayersRows = [buildPlayerRow(ADMIN_ID), buildPlayerRow(PLAYER_ID)];

    await renderPublicMatch();

    expect(screen.queryByRole('button', { name: 'Invitar amigos' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Agregar al calendario/i })).toBeInTheDocument();
  });
});
