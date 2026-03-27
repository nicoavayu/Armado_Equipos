import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import InviteAmigosModal from '../components/InviteAmigosModal';

const OWNER_USER_ID = '11111111-1111-4111-8111-111111111111';
const FRIEND_USER_ID = '22222222-2222-4222-8222-222222222222';

const mockGetAmigos = jest.fn();
const mockGetPrivateGroupsByOwner = jest.fn();
const mockResolveInviteRecipientsFromGroups = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockAuthGetUser = jest.fn();
const mockShowGlobalNotice = jest.fn();
const mockNotifyBlockingError = jest.fn();
const mockRequestImmediatePushDispatchSafe = jest.fn();
const mockTrack = jest.fn();

jest.mock('../supabase', () => ({
  getAmigos: (...args) => mockGetAmigos(...args),
  getPrivateGroupsByOwner: (...args) => mockGetPrivateGroupsByOwner(...args),
  resolveInviteRecipientsFromGroups: (...args) => mockResolveInviteRecipientsFromGroups(...args),
  supabase: {
    auth: {
      getUser: (...args) => mockAuthGetUser(...args),
    },
    from: (...args) => mockFrom(...args),
    rpc: (...args) => mockRpc(...args),
  },
}));

jest.mock('../utils/globalNoticeModal', () => ({
  showGlobalNotice: (...args) => mockShowGlobalNotice(...args),
}));

jest.mock('utils/notifyBlockingError', () => ({
  notifyBlockingError: (...args) => mockNotifyBlockingError(...args),
}));

jest.mock('../services/pushDispatchService', () => ({
  requestImmediatePushDispatchSafe: (...args) => mockRequestImmediatePushDispatchSafe(...args),
}));

jest.mock('../utils/monitoring/analytics', () => ({
  track: (...args) => mockTrack(...args),
}));

const createQueryBuilder = (result) => {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    in: jest.fn(() => builder),
    or: jest.fn(() => builder),
    not: jest.fn(() => builder),
    order: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => result),
    single: jest.fn(async () => result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };

  return builder;
};

describe('InviteAmigosModal', () => {
  beforeEach(() => {
    localStorage.clear();
    mockGetAmigos.mockReset();
    mockGetPrivateGroupsByOwner.mockReset();
    mockResolveInviteRecipientsFromGroups.mockReset();
    mockFrom.mockReset();
    mockRpc.mockReset();
    mockAuthGetUser.mockReset();
    mockShowGlobalNotice.mockReset();
    mockNotifyBlockingError.mockReset();
    mockRequestImmediatePushDispatchSafe.mockReset();
    mockTrack.mockReset();
    mockAuthGetUser.mockResolvedValue({
      data: {
        user: {
          id: OWNER_USER_ID,
        },
      },
      error: null,
    });
  });

  test('shows a clear message when selected groups produce no inviteable recipients', async () => {
    mockGetAmigos.mockResolvedValueOnce([]);
    mockGetPrivateGroupsByOwner.mockResolvedValueOnce([
      {
        id: 'group-1',
        name: 'Futbol 7',
        member_count: 2,
        members: [],
      },
    ]);
    mockResolveInviteRecipientsFromGroups.mockResolvedValueOnce({
      recipients: [],
      skipped: {
        already_in_match: [],
        already_invited: [],
        duplicate: [],
        ineligible: [],
      },
    });

    render(
      <InviteAmigosModal
        isOpen
        onClose={jest.fn()}
        currentUserId={OWNER_USER_ID}
        partidoActual={{ id: 55, nombre: 'Partido test' }}
        jugadores={[]}
        mode="direct"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'GRUPOS' }));
    fireEvent.click(await screen.findByRole('button', { name: /Futbol 7/i }));
    fireEvent.click(screen.getByRole('button', { name: /Invitar grupo/i }));

    await waitFor(() => {
      expect(mockResolveInviteRecipientsFromGroups).toHaveBeenCalledWith({
        matchId: 55,
        ownerUserId: OWNER_USER_ID,
        selectedGroupIds: ['group-1'],
      });
    });

    await waitFor(() => {
      expect(mockShowGlobalNotice).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Sin destinatarios',
        message: 'Los grupos seleccionados no tienen amigos disponibles para invitar.',
      }));
    });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockRequestImmediatePushDispatchSafe).not.toHaveBeenCalled();
  });

  test('hides a group after inviting it to the current match', async () => {
    mockGetAmigos.mockResolvedValueOnce([]);
    mockGetPrivateGroupsByOwner.mockResolvedValueOnce([
      {
        id: 'group-1',
        name: 'Futbol 7',
        member_count: 2,
        members: [],
      },
    ]);
    mockResolveInviteRecipientsFromGroups.mockResolvedValueOnce({
      recipients: [{ user_id: FRIEND_USER_ID, id: FRIEND_USER_ID }],
      skipped: {
        already_in_match: [],
        already_invited: [],
        duplicate: [],
        ineligible: [],
      },
    });

    mockFrom.mockImplementation((table) => {
      if (table === 'usuarios') {
        return createQueryBuilder({
          data: { nombre: 'Capitán' },
          error: null,
        });
      }

      throw new Error(`Unexpected table requested in InviteAmigosModal group test: ${table}`);
    });

    mockRpc.mockResolvedValueOnce({ data: { status: 'sent' }, error: null });

    render(
      <InviteAmigosModal
        isOpen
        onClose={jest.fn()}
        currentUserId={OWNER_USER_ID}
        partidoActual={{ id: 55, nombre: 'Partido test', fecha: '2026-03-20', hora: '20:00' }}
        jugadores={[]}
        mode="direct"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'GRUPOS' }));
    fireEvent.click(await screen.findByRole('button', { name: /Futbol 7/i }));
    fireEvent.click(screen.getByRole('button', { name: /Invitar grupo/i }));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('send_match_invite', expect.objectContaining({
        p_user_id: FRIEND_USER_ID,
        p_partido_id: 55,
        p_invite_mode: 'direct',
      }));
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Futbol 7/i })).not.toBeInTheDocument();
    });

    expect(screen.getByText('Ya invitaste a todos tus grupos a este partido.')).toBeInTheDocument();
  });

  test('shows a load error instead of a false empty state when friends cannot be fetched', async () => {
    mockGetAmigos.mockRejectedValueOnce(new Error('No se pudieron cargar tus amigos.'));
    mockGetPrivateGroupsByOwner.mockResolvedValueOnce([]);

    render(
      <InviteAmigosModal
        isOpen
        onClose={jest.fn()}
        currentUserId={OWNER_USER_ID}
        partidoActual={{ id: 55, nombre: 'Partido test' }}
        jugadores={[]}
        mode="direct"
      />,
    );

    expect(await screen.findByText('No se pudieron cargar tus amigos.')).toBeInTheDocument();
    expect(screen.queryByText('No tenés amigos para invitar')).not.toBeInTheDocument();
  });

  test('keeps the direct selected invite flow working for one friend', async () => {
    mockGetAmigos.mockResolvedValueOnce([
      {
        id: 'relationship-1',
        relationshipId: 'relationship-1',
        nombre: 'Ana',
        avatar_url: null,
        profile: {
          id: FRIEND_USER_ID,
          nombre: 'Ana',
          avatar_url: null,
        },
      },
    ]);

    mockFrom.mockImplementation((table) => {
      if (table === 'notifications_ext') {
        return createQueryBuilder({ data: [], error: null });
      }

      if (table === 'usuarios') {
        return createQueryBuilder({
          data: { nombre: 'Capitán' },
          error: null,
        });
      }

      throw new Error(`Unexpected table requested in InviteAmigosModal test: ${table}`);
    });

    mockRpc.mockResolvedValueOnce({ data: { status: 'sent' }, error: null });

    render(
      <InviteAmigosModal
        isOpen
        onClose={jest.fn()}
        currentUserId={OWNER_USER_ID}
        partidoActual={{ id: 55, nombre: 'Partido test', fecha: '2026-03-20', hora: '20:00' }}
        jugadores={[]}
        mode="direct"
      />,
    );

    expect(await screen.findByText('Ana')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Ana/i }));
    fireEvent.click(screen.getByRole('button', { name: /Invitar amigo/i }));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('send_match_invite', expect.objectContaining({
        p_user_id: FRIEND_USER_ID,
        p_partido_id: 55,
        p_invite_mode: 'direct',
      }));
    });

    expect(mockResolveInviteRecipientsFromGroups).not.toHaveBeenCalled();
    expect(mockRequestImmediatePushDispatchSafe).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'match_invite',
      matchId: 55,
      recipientUserId: FRIEND_USER_ID,
    }));
    expect(mockTrack).toHaveBeenCalledWith('match_invite_sent', expect.objectContaining({
      match_id: 55,
      recipient_user_id: FRIEND_USER_ID,
      source: 'invite_amigos_modal',
      invite_result: 'sent',
    }));
    expect(mockNotifyBlockingError).not.toHaveBeenCalled();
  });

  test('allows selecting and inviting multiple friends in one action', async () => {
    const SECOND_FRIEND_USER_ID = '33333333-3333-4333-8333-333333333333';

    mockGetAmigos.mockResolvedValueOnce([
      {
        id: 'relationship-1',
        relationshipId: 'relationship-1',
        nombre: 'Ana',
        avatar_url: null,
        profile: {
          id: FRIEND_USER_ID,
          nombre: 'Ana',
          avatar_url: null,
        },
      },
      {
        id: 'relationship-2',
        relationshipId: 'relationship-2',
        nombre: 'Beto',
        avatar_url: null,
        profile: {
          id: SECOND_FRIEND_USER_ID,
          nombre: 'Beto',
          avatar_url: null,
        },
      },
    ]);

    mockFrom.mockImplementation((table) => {
      if (table === 'notifications_ext') {
        return createQueryBuilder({ data: [], error: null });
      }

      if (table === 'usuarios') {
        return createQueryBuilder({
          data: { nombre: 'Capitán' },
          error: null,
        });
      }

      throw new Error(`Unexpected table requested in InviteAmigosModal multi test: ${table}`);
    });

    mockRpc
      .mockResolvedValueOnce({ data: { status: 'sent' }, error: null })
      .mockResolvedValueOnce({ data: { status: 'sent' }, error: null });

    render(
      <InviteAmigosModal
        isOpen
        onClose={jest.fn()}
        currentUserId={OWNER_USER_ID}
        partidoActual={{ id: 55, nombre: 'Partido test', fecha: '2026-03-20', hora: '20:00' }}
        jugadores={[]}
        mode="direct"
      />,
    );

    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Beto')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Ana/i }));
    fireEvent.click(screen.getByRole('button', { name: /Beto/i }));
    fireEvent.click(screen.getByRole('button', { name: /Invitar amigos/i }));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledTimes(2);
    });

    expect(mockRpc).toHaveBeenNthCalledWith(1, 'send_match_invite', expect.objectContaining({
      p_user_id: FRIEND_USER_ID,
      p_partido_id: 55,
      p_invite_mode: 'direct',
    }));
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'send_match_invite', expect.objectContaining({
      p_user_id: SECOND_FRIEND_USER_ID,
      p_partido_id: 55,
      p_invite_mode: 'direct',
    }));
    expect(mockRequestImmediatePushDispatchSafe).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'match_invite',
      matchId: 55,
    }));
    expect(mockShowGlobalNotice).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Resultado de invitaciones',
      message: 'Se enviaron 2 invitaciones.',
    }));
  });

  test('shows unavailable friends with a red-status label', async () => {
    mockGetAmigos.mockResolvedValueOnce([
      {
        id: 'relationship-1',
        relationshipId: 'relationship-1',
        nombre: 'Ana',
        avatar_url: null,
        acepta_invitaciones: false,
        profile: {
          id: FRIEND_USER_ID,
          nombre: 'Ana',
          avatar_url: null,
        },
      },
    ]);
    mockGetPrivateGroupsByOwner.mockResolvedValueOnce([]);
    mockFrom.mockImplementation((table) => {
      if (table === 'notifications_ext') {
        return createQueryBuilder({ data: [], error: null });
      }

      throw new Error(`Unexpected table requested in InviteAmigosModal unavailable test: ${table}`);
    });

    render(
      <InviteAmigosModal
        isOpen
        onClose={jest.fn()}
        currentUserId={OWNER_USER_ID}
        partidoActual={{ id: 55, nombre: 'Partido test' }}
        jugadores={[]}
        mode="direct"
      />,
    );

    expect(await screen.findByText('No disponible')).toBeInTheDocument();
    expect(screen.queryByText('Disponible')).not.toBeInTheDocument();
  });
});
