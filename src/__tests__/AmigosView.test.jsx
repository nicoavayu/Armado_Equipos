import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AmigosView from '../components/AmigosView';

const mockUseAuth = jest.fn();
const mockUseAmigos = jest.fn();
const mockMarkTypeAsRead = jest.fn();
const mockGetAmigos = jest.fn();
const mockGetPendingRequests = jest.fn();
const mockSupabaseFrom = jest.fn();

jest.mock('../components/AuthProvider', () => ({
  useAuth: (...args) => mockUseAuth(...args),
}));

jest.mock('../hooks/useAmigos', () => ({
  FRIENDS_VIEW_STATES: {
    IDLE: 'idle',
    LOADING: 'loading',
    SUCCESS: 'success',
    EMPTY: 'empty',
    ERROR: 'error',
  },
  useAmigos: (...args) => mockUseAmigos(...args),
}));

jest.mock('../context/NotificationContext', () => ({
  useNotifications: () => ({
    markTypeAsRead: (...args) => mockMarkTypeAsRead(...args),
  }),
}));

jest.mock('../supabase', () => ({
  supabase: {
    from: (...args) => mockSupabaseFrom(...args),
  },
}));

jest.mock('../components/ProfileComponents', () => ({
  PlayerCardTrigger: ({ children }) => children,
}));

jest.mock('../components/MiniFriendCard', () => (
  function MockMiniFriendCard({ friend }) {
    return <div>{friend?.profile?.nombre || 'friend-card'}</div>;
  }
));

jest.mock('../components/ConfirmModal', () => () => null);
jest.mock('../components/ui/InlineNotice', () => () => null);
jest.mock('../components/EmptyStateCard', () => (
  function MockEmptyStateCard({ title, description }) {
    return (
      <div>
        <div>{title}</div>
        <div>{description}</div>
      </div>
    );
  }
));
jest.mock('../components/friends/PrivateGroupsTab', () => () => <div>groups-tab</div>);
jest.mock('../hooks/useRefreshOnVisibility', () => ({
  useRefreshOnVisibility: () => {},
}));
jest.mock('../hooks/useSupabaseRealtime', () => ({
  useSupabaseRealtime: () => {},
}));
jest.mock('../components/LoadingSpinner', () => (
  function MockLoadingSpinner({ fullScreen = false }) {
    return <div data-testid={fullScreen ? 'loading-spinner-fullscreen' : 'loading-spinner-inline'} />;
  }
));

const createLocationQueryBuilder = () => {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => ({ data: null, error: null })),
  };

  return builder;
};

describe('AmigosView', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseAmigos.mockReset();
    mockMarkTypeAsRead.mockReset();
    mockGetAmigos.mockReset();
    mockGetPendingRequests.mockReset();
    mockSupabaseFrom.mockReset();

    mockUseAuth.mockReturnValue({
      user: { id: 'user-1' },
      loading: false,
    });

    mockGetAmigos.mockResolvedValue([]);
    mockGetPendingRequests.mockResolvedValue([]);

    mockUseAmigos.mockReturnValue({
      amigos: [],
      error: null,
      friendsState: 'empty',
      friendsError: null,
      friendsLoading: false,
      pendingRequestsLoading: false,
      getAmigos: (...args) => mockGetAmigos(...args),
      getRelationshipStatus: jest.fn(),
      sendFriendRequest: jest.fn(),
      getPendingRequests: (...args) => mockGetPendingRequests(...args),
      acceptFriendRequest: jest.fn(),
      rejectFriendRequest: jest.fn(),
      removeFriend: jest.fn(),
    });

    mockSupabaseFrom.mockImplementation((table) => {
      if (table === 'usuarios') {
        return createLocationQueryBuilder();
      }

      throw new Error(`Unexpected table requested in AmigosView test: ${table}`);
    });
  });

  test('renders the friends view after auth is already resolved globally', async () => {
    render(
      <MemoryRouter initialEntries={['/amigos']}>
        <AmigosView />
      </MemoryRouter>,
    );

    expect(await screen.findByPlaceholderText('Buscar en mis amigos...')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockGetAmigos).toHaveBeenCalledWith({ silent: false });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('loading-spinner-inline')).not.toBeInTheDocument();
    });
  });

  test('renders the friends list instead of the loading card when renderable friends already exist', async () => {
    mockUseAmigos.mockReturnValue({
      amigos: [
        {
          id: 'relationship-1',
          profile: {
            id: 'friend-1',
            nombre: 'Ana',
          },
        },
      ],
      error: null,
      friendsState: 'loading',
      friendsError: null,
      friendsLoading: true,
      pendingRequestsLoading: false,
      getAmigos: (...args) => mockGetAmigos(...args),
      getRelationshipStatus: jest.fn(),
      sendFriendRequest: jest.fn(),
      getPendingRequests: (...args) => mockGetPendingRequests(...args),
      acceptFriendRequest: jest.fn(),
      rejectFriendRequest: jest.fn(),
      removeFriend: jest.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/amigos']}>
        <AmigosView />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText('Cargando amigos...')).not.toBeInTheDocument();
  });
});
