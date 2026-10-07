import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AmigosView from '../components/AmigosView';

const mockSupabaseFrom = jest.fn();
const mockSearch = jest.fn();

const mockAuth = { user: { id: 'user-1' }, loading: false };
jest.mock('../components/AuthProvider', () => ({
  useAuth: () => mockAuth,
}));

const mockAmigosApi = {
  amigos: [],
  error: null,
  friendsState: 'empty',
  friendsError: null,
  friendsLoading: false,
  pendingRequestsLoading: false,
  getAmigos: async () => [],
  getRelationshipStatus: async () => null,
  sendFriendRequest: async () => null,
  getPendingRequests: async () => [],
  acceptFriendRequest: async () => null,
  rejectFriendRequest: async () => null,
  removeFriend: async () => null,
};

jest.mock('../hooks/useAmigos', () => ({
  FRIENDS_VIEW_STATES: {
    IDLE: 'idle', LOADING: 'loading', SUCCESS: 'success', EMPTY: 'empty', ERROR: 'error',
  },
  useAmigos: () => mockAmigosApi,
}));

const mockNotifications = { markTypeAsRead: () => {} };
jest.mock('../context/NotificationContext', () => ({
  useNotifications: () => mockNotifications,
}));

jest.mock('../supabase', () => ({
  supabase: { from: (...args) => mockSupabaseFrom(...args) },
}));

// The community search goes through the search_usuarios RPC (by name or exact email;
// emails never come back): mockSearch(query) answers it.
jest.mock('../services/db/publicProfiles', () => ({
  searchPublicUsers: async (query) => {
    const { data, error } = await mockSearch(query);
    if (error) throw error;
    return data || [];
  },
}));

jest.mock('../components/ProfileComponents', () => ({
  PlayerCardTrigger: ({ children }) => children,
}));
jest.mock('../components/MiniFriendCard', () => () => null);
jest.mock('../components/ConfirmModal', () => () => null);
jest.mock('../components/ui/InlineNotice', () => () => null);
jest.mock('../components/EmptyStateCard', () => () => null);
jest.mock('../components/friends/PrivateGroupsTab', () => () => null);
jest.mock('../hooks/useRefreshOnVisibility', () => ({ useRefreshOnVisibility: () => {} }));
jest.mock('../hooks/useSupabaseRealtime', () => ({ useSupabaseRealtime: () => {} }));
jest.mock('../components/LoadingSpinner', () => () => <div data-testid="loading-spinner-inline" />);

// Chainable query builder for the other reads of the view (suggestions, location...).
const createBuilder = () => {
  let searchFilter = null;
  const empty = { data: [], error: null };
  const builder = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        const result = searchFilter !== null ? mockSearch(searchFilter) : Promise.resolve(empty);
        return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
      }
      if (prop === 'maybeSingle' || prop === 'single') return async () => ({ data: null, error: null });
      if (prop === 'or') {
        return (filter) => {
          searchFilter = filter;
          return builder;
        };
      }
      return () => builder;
    },
  });
  return builder;
};

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

const renderCommunity = async () => {
  render(
    <MemoryRouter initialEntries={['/amigos?tab=comunidad']}>
      <AmigosView />
    </MemoryRouter>,
  );
  return screen.findByPlaceholderText('Buscar jugador por nombre o email...');
};

const searchCalls = () => mockSearch.mock.calls.map(([filter]) => filter);

describe('AmigosView community search', () => {
  beforeEach(() => {
    mockSupabaseFrom.mockReset();
    mockSearch.mockReset();
    mockSupabaseFrom.mockImplementation(() => createBuilder());
    mockSearch.mockImplementation(async () => ({
      data: [{ id: 'u-thomas', nombre: 'Thomas Rivas', email: 't@example.com' }],
      error: null,
    }));
  });

  test('0, 1 and 2 characters never query the backend nor show results', async () => {
    const input = await renderCommunity();

    for (const value of ['', 'T', 'Th', '  Th  ']) {
      fireEvent.change(input, { target: { value } });
      // Longer than the debounce: nothing may fire.
      // eslint-disable-next-line no-await-in-loop
      await act(() => new Promise((r) => { setTimeout(r, 350); }));
    }

    expect(mockSearch).not.toHaveBeenCalled();
    expect(screen.queryByText('Thomas Rivas')).not.toBeInTheDocument();
    expect(screen.queryByText('No se encontraron usuarios')).not.toBeInTheDocument();
    expect(screen.getByText('Escribí al menos 3 letras para buscar')).toBeInTheDocument();
  });

  test('empty input shows neither hint nor results', async () => {
    const input = await renderCommunity();
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.queryByText('Escribí al menos 3 letras para buscar')).not.toBeInTheDocument();
    expect(screen.queryByText('Buscando...')).not.toBeInTheDocument();
  });

  test('3+ characters search once after the debounce, trimmed', async () => {
    const input = await renderCommunity();

    fireEvent.change(input, { target: { value: 'Tho' } });
    fireEvent.change(input, { target: { value: 'Thom' } });
    fireEvent.change(input, { target: { value: ' Thomas ' } });

    expect(await screen.findByText('Thomas Rivas')).toBeInTheDocument();
    expect(searchCalls()).toEqual(['Thomas']);
    expect(screen.queryByText('Escribí al menos 3 letras para buscar')).not.toBeInTheDocument();
  });

  test('dropping under the minimum clears results and ignores the late response', async () => {
    const pending = deferred();
    mockSearch.mockImplementationOnce(() => pending.promise);
    const input = await renderCommunity();

    fireEvent.change(input, { target: { value: 'Tho' } });
    await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Buscando...')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'T' } });
    await act(async () => {
      pending.resolve({ data: [{ id: 'u-late', nombre: 'Tomás Viejo' }], error: null });
      await pending.promise;
    });

    expect(screen.queryByText('Tomás Viejo')).not.toBeInTheDocument();
    expect(screen.queryByText('Buscando...')).not.toBeInTheDocument();
    expect(screen.getByText('Escribí al menos 3 letras para buscar')).toBeInTheDocument();
  });

  test('a slower earlier query never overwrites a newer one', async () => {
    const slow = deferred();
    mockSearch
      .mockImplementationOnce(() => slow.promise)
      .mockImplementationOnce(async () => ({ data: [{ id: 'u-new', nombre: 'Thomas Nuevo' }], error: null }));
    const input = await renderCommunity();

    fireEvent.change(input, { target: { value: 'Tho' } });
    await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: 'Thomas' } });
    expect(await screen.findByText('Thomas Nuevo')).toBeInTheDocument();

    await act(async () => {
      slow.resolve({ data: [{ id: 'u-old', nombre: 'Thor Viejo' }], error: null });
      await slow.promise;
    });

    expect(screen.getByText('Thomas Nuevo')).toBeInTheDocument();
    expect(screen.queryByText('Thor Viejo')).not.toBeInTheDocument();
  });

  test('results never render another user\'s email, even when the payload carries it', async () => {
    mockSearch.mockImplementation(async () => ({
      data: [
        {
          id: 'u-relay',
          nombre: 'Thomas Relay',
          email: 'abc123xyz@privaterelay.appleid.com',
          avatar_url: 'https://example.com/avatar.png',
        },
        { id: 'u-plain', nombre: 'Thomas Plano', email: 'thomas.plano@gmail.com' },
      ],
      error: null,
    }));
    const input = await renderCommunity();

    fireEvent.change(input, { target: { value: 'Thomas' } });

    expect(await screen.findByText('Thomas Relay')).toBeInTheDocument();
    expect(screen.getByText('Thomas Plano')).toBeInTheDocument();
    expect(screen.getByAltText('Thomas Relay')).toHaveAttribute('src', 'https://example.com/avatar.png');
    expect(document.body.textContent).not.toMatch(/@/);
    expect(screen.queryByText(/privaterelay/i)).not.toBeInTheDocument();
    expect(screen.queryByText('thomas.plano@gmail.com')).not.toBeInTheDocument();
  });
});
