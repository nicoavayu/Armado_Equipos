import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PartidoInvitacion from '../pages/PartidoInvitacion';
import { TopSafeAreaAppliedContext } from '../context/TopSafeAreaContext';
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

// PageTitle owns the inset through `respectSafeArea` (jsdom drops its
// max(var(--safe-top)) inline value), so the double exposes that prop.
jest.mock('../components/PageTitle', () => function MockPageTitle({ title, respectSafeArea }) {
  return (
    <div data-testid="page-title" data-respect-safe-area={String(Boolean(respectSafeArea))}>
      <h2>{title}</h2>
    </div>
  );
});

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


// What a registered player sees and can do on an in-app invitation: the real match type,
// price and kickoff, and a 'Rechazar' that actually answers the invitation.
const renderInvite = async () => {
  render(
    <MemoryRouter
      initialEntries={[`/partido/${MATCH_ID}/invitacion?codigo=ABC123`]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/partido/:partidoId/invitacion" element={<PartidoInvitacion mode="invite" />} />
      </Routes>
    </MemoryRouter>,
  );
};

const pendingInvite = {
  id: 'n-1',
  type: 'match_invite',
  data: { matchId: MATCH_ID, status: 'pending', codigo: 'ABC123' },
  read: false,
  send_at: null,
  created_at: '2026-10-07T00:00:00Z',
  partido_id: MATCH_ID,
};

describe('PartidoInvitacion invitation details and answer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = { id: PLAYER_ID, email: 'player@example.com' };
    mockMatchRow = buildMatch({ nombre: 'Fútbol del jueves' });
    mockPlayersRows = [buildPlayerRow(ADMIN_ID)];
    isUserMemberOfMatch.mockResolvedValue({ isMember: false, jugadorRow: null });

    supabase.from.mockImplementation((table) => {
      if (table === 'notifications_ext') {
        return createQueryBuilder({ data: [pendingInvite], error: null });
      }
      if (table === 'notifications') {
        const builder = createQueryBuilder({ data: [pendingInvite], error: null });
        builder.or = jest.fn(() => builder);
        return builder;
      }
      if (table === 'jugadores') {
        return createQueryBuilder({ data: mockPlayersRows, count: mockPlayersRows.length, error: null });
      }
      if (table === 'partidos') {
        return createQueryBuilder({ data: { player_invites_enabled: true }, error: null });
      }
      return createQueryBuilder({ data: null, error: null });
    });
    supabase.rpc.mockImplementation(async (name) => (name === 'get_partido_by_invite'
      ? { data: [mockMatchRow], error: null }
      : { data: null, error: null }));
  });

  test('the invitee sees the real match type, price and a HH:MM time', async () => {
    // get_partido_by_invite returns neither tipo_partido nor the price, and a SQL time.
    mockMatchRow = { id: MATCH_ID, nombre: 'Fútbol del jueves', fecha: '2099-01-01', hora: '21:00:00', sede: 'Club Test', modalidad: 'F5', cupo: 10, codigo: 'ABC123' };
    const baseFrom = supabase.from.getMockImplementation();
    supabase.from.mockImplementation((table) => (table === 'partidos'
      ? createQueryBuilder({ data: { player_invites_enabled: true, busca_arquero: false, falta_jugadores: true, tipo_partido: 'Femenino', precio_cancha_por_persona: 6000 }, error: null })
      : baseFrom(table)));

    await renderInvite();
    expect(await screen.findByText('TE INVITARON A JUGAR')).toBeInTheDocument();
    expect(screen.getByText('Femenino')).toBeInTheDocument();
    expect(screen.queryByText('Masculino')).not.toBeInTheDocument();
    expect(screen.getByText('21:00')).toBeInTheDocument();
    expect(screen.queryByText('21:00:00')).not.toBeInTheDocument();
    expect(screen.getByText(/\$6\.000/)).toBeInTheDocument();
  });

  test('Rechazar answers the invitation (rejected) instead of leaving it pending', async () => {
    const updates = [];
    const baseFrom = supabase.from.getMockImplementation();
    supabase.from.mockImplementation((table) => {
      if (table !== 'notifications') return baseFrom(table);
      const builder = createQueryBuilder({ data: [pendingInvite], error: null });
      builder.or = jest.fn(() => builder);
      builder.update = jest.fn((payload) => { updates.push(payload); return builder; });
      return builder;
    });

    await renderInvite();
    const reject = await screen.findByRole('button', { name: 'Rechazar' });
    reject.click();

    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toEqual(expect.objectContaining({
      read: true,
      data: expect.objectContaining({ status: 'rejected', rejected_at: expect.any(String) }),
    }));
  });

});
