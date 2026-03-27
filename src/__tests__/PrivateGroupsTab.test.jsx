import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PrivateGroupsTab from '../components/friends/PrivateGroupsTab';

const mockGetPrivateGroupsByOwner = jest.fn();
const mockCreatePrivateGroup = jest.fn();
const mockNotifyBlockingError = jest.fn();

jest.mock('../services/db/privateFriendGroups', () => ({
  getPrivateGroupsByOwner: (...args) => mockGetPrivateGroupsByOwner(...args),
  createPrivateGroup: (...args) => mockCreatePrivateGroup(...args),
  renamePrivateGroup: jest.fn(),
  archivePrivateGroup: jest.fn(),
  addFriendsToPrivateGroup: jest.fn(),
  removeFriendFromPrivateGroup: jest.fn(),
}));

jest.mock('utils/notifyBlockingError', () => ({
  notifyBlockingError: (...args) => mockNotifyBlockingError(...args),
}));

jest.mock('../components/friends/InviteGroupToMatchModal', () => (
  function MockInviteGroupToMatchModal({ isOpen }) {
    return isOpen ? <div>invite-group-modal</div> : null;
  }
));

describe('PrivateGroupsTab', () => {
  beforeEach(() => {
    mockGetPrivateGroupsByOwner.mockReset();
    mockCreatePrivateGroup.mockReset();
    mockNotifyBlockingError.mockReset();
  });

  test('creates a group from the Groups tab with selected friends', async () => {
    mockGetPrivateGroupsByOwner.mockResolvedValueOnce([]);
    mockCreatePrivateGroup.mockResolvedValueOnce({
      id: 'group-1',
      name: 'Futbol 7',
      created_at: '2026-03-19T12:00:00Z',
      updated_at: '2026-03-19T12:00:00Z',
      archived_at: null,
      member_count: 1,
      members: [
        {
          id: 'member-1',
          friend_user_id: 'friend-1',
          profile: {
            id: 'friend-1',
            nombre: 'Ana',
            email: 'ana@example.com',
            avatar_url: null,
            localidad: null,
          },
        },
      ],
    });

    const onInlineNotice = jest.fn();

    render(
      <PrivateGroupsTab
        currentUserId="owner-1"
        friends={[
          {
            id: 'relationship-1',
            profile: {
              id: 'friend-1',
              nombre: 'Ana',
              email: 'ana@example.com',
              avatar_url: null,
              localidad: null,
            },
          },
        ]}
        onInlineNotice={onInlineNotice}
      />,
    );

    expect(await screen.findByText('Todavía no creaste grupos')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Crear grupo/i }));
    fireEvent.change(screen.getByLabelText(/Nombre del grupo/i), {
      target: { value: 'Futbol 7' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Ana/i }));
    fireEvent.click(screen.getByRole('button', { name: /Aceptar/i }));

    await waitFor(() => {
      expect(mockCreatePrivateGroup).toHaveBeenCalledWith({
        ownerUserId: 'owner-1',
        name: 'Futbol 7',
        memberUserIds: ['friend-1'],
      });
    });

    expect((await screen.findAllByText('Futbol 7')).length).toBeGreaterThan(0);
    expect(onInlineNotice).toHaveBeenCalledWith(expect.objectContaining({
      type: 'success',
      message: 'Grupo creado correctamente.',
    }));
  });

  test('handles create failures without leaving an uncaught modal error path', async () => {
    mockGetPrivateGroupsByOwner.mockResolvedValueOnce([]);
    mockCreatePrivateGroup.mockRejectedValueOnce(new Error('No tenés permisos para crear o modificar este grupo.'));

    render(
      <PrivateGroupsTab
        currentUserId="owner-1"
        friends={[]}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Crear grupo/i }));
    fireEvent.change(screen.getByLabelText(/Nombre del grupo/i), {
      target: { value: 'Futbol 7' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Aceptar/i }));

    await waitFor(() => {
      expect(mockNotifyBlockingError).toHaveBeenCalledWith('No tenés permisos para crear o modificar este grupo.');
    });

    expect(screen.getByRole('heading', { name: /Crear grupo/i })).toBeInTheDocument();
  });

  test('renders raw groups from the base query without waiting for enrichment', async () => {
    mockGetPrivateGroupsByOwner.mockResolvedValueOnce([
      {
        id: 'group-1',
        name: 'Futbol 7',
        created_at: '2026-03-19T12:00:00Z',
        updated_at: '2026-03-19T12:00:00Z',
        archived_at: null,
        member_count: 1,
        members: [
          {
            id: 'member-1',
            friend_user_id: 'friend-1',
            profile: {
              id: 'friend-1',
              nombre: 'Ana',
              email: 'ana@example.com',
              avatar_url: null,
              localidad: 'Villa Devoto',
            },
          },
        ],
      },
    ]);

    render(
      <PrivateGroupsTab
        currentUserId="owner-1"
        friends={[
          {
            id: 'relationship-1',
            profile: {
              id: 'friend-1',
              nombre: 'Ana',
              email: 'ana@example.com',
              avatar_url: null,
              localidad: 'Villa Devoto',
            },
          },
          {
            id: 'relationship-2',
            profile: {
              id: 'friend-2',
              nombre: 'Matias',
              email: 'matias@example.com',
              avatar_url: null,
              localidad: 'San Isidro',
            },
          },
        ]}
      />,
    );

    expect(await screen.findByText('Futbol 7')).toBeInTheDocument();
    expect(await screen.findByText('1 integrante')).toBeInTheDocument();
    expect(screen.queryByText('invite-group-modal')).not.toBeInTheDocument();
  });
});
