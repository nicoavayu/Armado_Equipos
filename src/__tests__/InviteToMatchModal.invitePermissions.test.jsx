import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import InviteToMatchModal from '../components/InviteToMatchModal';

const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';
const PLAYER_USER_ID = '22222222-2222-4222-8222-222222222222';
const FRIEND_USER_ID = '33333333-3333-4333-8333-333333333333';

const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockNotifyBlockingError = jest.fn();
const mockShowGlobalNotice = jest.fn();
const mockRequestImmediatePushDispatchSafe = jest.fn();
const mockTrack = jest.fn();

jest.mock('../supabase', () => ({
  supabase: {
    from: (...args) => mockFrom(...args),
    rpc: (...args) => mockRpc(...args),
  },
}));

jest.mock('utils/notifyBlockingError', () => ({
  notifyBlockingError: (...args) => mockNotifyBlockingError(...args),
}));

jest.mock('../utils/globalNoticeModal', () => ({
  showGlobalNotice: (...args) => mockShowGlobalNotice(...args),
}));

jest.mock('../services/pushDispatchService', () => ({
  requestImmediatePushDispatchSafe: (...args) => mockRequestImmediatePushDispatchSafe(...args),
}));

jest.mock('../utils/monitoring/analytics', () => ({
  track: (...args) => mockTrack(...args),
}));

jest.mock('../components/Modal', () => (
  function MockModal({ isOpen, children, footer }) {
    if (!isOpen) return null;
    return (
      <div>
        {children}
        <div>{footer}</div>
      </div>
    );
  }
));

jest.mock('../components/LoadingSpinner', () => (
  function MockLoadingSpinner() {
    return <span>Cargando</span>;
  }
));

const createQueryBuilder = (result) => {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    in: jest.fn(() => builder),
    order: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => result),
    single: jest.fn(async () => result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };

  return builder;
};

const makeMatch = (overrides = {}) => ({
  id: 55,
  nombre: 'Partido test',
  fecha: '2026-03-20',
  hora: '20:00',
  sede: 'Cancha Norte',
  modalidad: 'F7',
  cupo_jugadores: 14,
  tipo_partido: 'Mixto',
  creado_por: ADMIN_USER_ID,
  estado: 'active',
  deleted_at: null,
  survey_status: null,
  result_status: null,
  finished_at: null,
  player_invites_enabled: false,
  falta_jugadores: false,
  ...overrides,
});

const enqueueSupabaseResults = (entries) => {
  const queue = [...entries];
  mockFrom.mockImplementation((table) => {
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected table requested: ${table}`);
    expect(table).toBe(next.table);
    return createQueryBuilder(next.result);
  });
};

const baseFriend = {
  profile: {
    id: FRIEND_USER_ID,
    nombre: 'Ana',
  },
};

const renderInviteModal = (currentUserId) => render(
  <InviteToMatchModal
    isOpen
    onClose={jest.fn()}
    friend={baseFriend}
    currentUserId={currentUserId}
  />,
);

const enqueueFetchMatches = ({
  currentUserId,
  match,
  myPlayerRows = [],
  myAdminRows = [],
  playersInMatch = [],
}) => {
  enqueueSupabaseResults([
    {
      table: 'jugadores',
      result: { data: myPlayerRows, error: null },
    },
    {
      table: 'partidos',
      result: { data: myAdminRows, error: null },
    },
    {
      table: 'cleared_matches',
      result: { data: [], error: null },
    },
    {
      table: 'partidos',
      result: { data: [match], error: null },
    },
    {
      table: 'jugadores',
      result: { data: playersInMatch, error: null },
    },
    {
      table: 'notifications_ext',
      result: { data: [], error: null },
    },
    {
      table: 'jugadores',
      result: { data: null, count: playersInMatch.length, error: null },
    },
    {
      table: 'usuarios',
      result: { data: { nombre: currentUserId === ADMIN_USER_ID ? 'Organizador' : 'Jugador' }, error: null },
    },
  ]);
};

describe('InviteToMatchModal invite permissions', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockRpc.mockReset();
    mockNotifyBlockingError.mockReset();
    mockShowGlobalNotice.mockReset();
    mockRequestImmediatePushDispatchSafe.mockReset();
    mockTrack.mockReset();
    mockRpc.mockResolvedValue({ data: { status: 'sent' }, error: null });
  });

  test('permite al organizador invitar aunque el opt-in de jugadores esté apagado', async () => {
    const match = makeMatch({ nombre: 'Partido admin', player_invites_enabled: false });
    enqueueFetchMatches({
      currentUserId: ADMIN_USER_ID,
      match,
      myAdminRows: [{ id: match.id }],
      playersInMatch: [{ id: 1, partido_id: match.id, usuario_id: ADMIN_USER_ID }],
    });

    renderInviteModal(ADMIN_USER_ID);

    expect(await screen.findByText('Partido admin')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Invitar al partido/i }));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('send_match_invite', expect.objectContaining({
        p_user_id: FRIEND_USER_ID,
        p_partido_id: match.id,
        p_invite_mode: 'direct',
      }));
    });
  });

  test('permite a un jugador confirmado invitar usuarios registrados cuando el opt-in está encendido', async () => {
    const match = makeMatch({ nombre: 'Partido habilitado', player_invites_enabled: true });
    enqueueFetchMatches({
      currentUserId: PLAYER_USER_ID,
      match,
      myPlayerRows: [{ partido_id: match.id, usuario_id: PLAYER_USER_ID }],
      playersInMatch: [{ id: 1, partido_id: match.id, usuario_id: PLAYER_USER_ID }],
    });

    renderInviteModal(PLAYER_USER_ID);

    expect(await screen.findByText('Partido habilitado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Invitar al partido/i }));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('send_match_invite', expect.objectContaining({
        p_user_id: FRIEND_USER_ID,
        p_partido_id: match.id,
        p_invite_mode: 'direct',
      }));
    });
  });

  test('bloquea a un jugador confirmado cuando el organizador no habilitó invitaciones de jugadores', async () => {
    const match = makeMatch({ nombre: 'Partido bloqueado', player_invites_enabled: false });
    enqueueSupabaseResults([
      {
        table: 'jugadores',
        result: { data: [{ partido_id: match.id, usuario_id: PLAYER_USER_ID }], error: null },
      },
      {
        table: 'partidos',
        result: { data: [], error: null },
      },
      {
        table: 'cleared_matches',
        result: { data: [], error: null },
      },
      {
        table: 'partidos',
        result: { data: [match], error: null },
      },
      {
        table: 'jugadores',
        result: { data: [{ id: 1, partido_id: match.id, usuario_id: PLAYER_USER_ID }], error: null },
      },
      {
        table: 'notifications_ext',
        result: { data: [], error: null },
      },
    ]);

    renderInviteModal(PLAYER_USER_ID);

    expect(await screen.findByText('Partido bloqueado')).toBeInTheDocument();
    expect(screen.getByText('Sólo organizador')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Invitar al partido/i })).toBeDisabled();

    fireEvent.click(screen.getByText('Partido bloqueado'));

    expect(mockShowGlobalNotice).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Sólo el organizador puede invitar',
      message: 'El organizador no habilitó invitaciones de jugadores para este partido.',
    }));
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
